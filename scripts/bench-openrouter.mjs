#!/usr/bin/env node
/**
 * OpenRouter 免费模型基准测试（6.8.7 建 · 6.9.3 升级口径）
 * ==========================================================
 *
 * 设计原则：**直接驱动线上同一条代码路径**（`functions/api/ai-brain.js` 的
 * `onRequest`），而不是自己另写一遍调用逻辑。这样测到的东西与生产行为无法
 * 偏移 —— 6.8.4 的教训就是「用间接指标推断」会错，这里连推理都省掉。
 *
 * 6.9.3 升级了什么（口径必须跟着架构走）：
 *   6.8.7 的评分指标是旧 AI 优先架构的兜底负担（`assetUsage.unknown` /
 *   `repetitionFixed` / `functionRetagged`）。6.9.0 起架构是「本地打底 +
 *   AI 只改三个文本字段」，那几个字段要么消失、要么换了含义；继续用旧指标
 *   等于拿上一版的考卷考这一版的学生。新口径（全部来自响应体的既有字段）：
 *
 *     · isAiGenerated / engine —— 云端润色这一跳到底进没进
 *     · aiStatus.reason        —— OK / ALL_PROVIDERS_FAILED / POLISH_REJECTED …
 *     · polish.merged / kept / rejectedTotal —— 润色文案过守卫的比例
 *       （HTTP 200 但整段被 mergePolish 拒绝 = 对本项目不可用，与网络通不通无关）
 *     · 时长档位散度            —— 6.9.2 修复「后端全 8 秒」后新增的回归信号，
 *       一个模型若让 fitDuration 把档位全拱成 8，节奏同样死了
 *
 * 候选名单**不再手抄**：直接从 `PROVIDERS`（ai-brain.js 导出）读 —— 名单会腐烂，
 * 两个副本必然漂移。线上通过 `OPENROUTER_MODEL` 环境变量强制只试当前被测模型。
 *
 * 用法：
 *   node scripts/bench-openrouter.mjs                       # OR_KEY=… 或 .dev.vars
 *   node scripts/bench-openrouter.mjs --key sk-or-…
 *   node scripts/bench-openrouter.mjs --themes 3 --shots 4 --out _bench_result.json
 *
 * 判据纪律：网络错误 / 429 限流记「未测到」并单列，不静默计成失败 ——
 * 失败与没测到是两件不同的事（6.8.8 同型教训）。输出文件默认写
 * `_bench_result.json`（已在 .gitignore，不会把工作区弄脏）。
 */
import { writeFileSync } from 'node:fs';
import { existsSync, readFileSync } from 'node:fs';
import { onRequest, PROVIDERS, resetCircuitForTests } from '../functions/api/ai-brain.js';

/* ────────────────────────── 参数 ────────────────────────── */

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

/** 从 .dev.vars 读 Key（该文件不进库） */
function readKeyFromDevVars(varName) {
  if (!existsSync('.dev.vars')) return null;
  const m = readFileSync('.dev.vars', 'utf8').match(new RegExp(`^\\s*${varName}\\s*=\\s*(.+)$`, 'm'));
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : null;
}

const provider = PROVIDERS.find(p => p.id === 'openrouter');
if (!provider) { console.error('PROVIDERS 里找不到 openrouter provider'); process.exit(2); }

// Key：--key > OR_KEY（向后兼容 6.8.7 用法）> OPENROUTER_API_KEY > .dev.vars
const KEY = flag('key', null)
  || process.env.OR_KEY
  || process.env[provider.envVar]
  || readKeyFromDevVars(provider.envVar);
if (!KEY) {
  console.error(`缺少 OpenRouter Key。四种给法任选一：
  1) node scripts/bench-openrouter.mjs --key sk-or-...
  2) OR_KEY=sk-or-... node scripts/bench-openrouter.mjs
  3) export OPENROUTER_API_KEY=sk-or-...
  4) 在 .dev.vars 写 OPENROUTER_API_KEY=sk-or-...（该文件不进库）`);
  process.exit(2);
}

// 候选名单直读 PROVIDERS：线上名单改了，基准自动跟上。
const CANDIDATES = provider.models.map(m => (typeof m === 'string' ? m : m.id));

const THEMES = flag('themes', 'coldwar,naval,air,urban').split(',').map(s => s.trim()).filter(Boolean);
const QUERIES = {
  coldwar: '冷战时期北欧峡湾的潜艇对峙',
  naval: '驱逐舰编队防空反导作战',
  air: 'F-22 战斗机高空制空巡逻',
  urban: '现代特战城市巷战'
};
const SHOTS = Number(flag('shots', 4));
const OUT = flag('out', '_bench_result.json');
// 放宽超时：免费档模型排队严重，别让测量被上限截断（线上默认 60s/120s，
// 6.8.8 实测单镜 30–59s，按直觉收紧会把能成功的整个误杀）。
const TIMEOUT = flag('timeout', '90000');

/* ────────────────────────── 单次测量（端到端走 onRequest） ────────────────────────── */

const rows = [];

for (const model of CANDIDATES) {
  // **每个被测模型前重置熔断状态（6.9.3 实测教训）**：熔断器是模块级、且按
  // **provider**（不是按模型）计数 —— gemma-4-31b 连吃 3 个 429 后 openrouter
  // 的闸开了，后面 5 个候选全部被 ~500ms 的 CIRCUIT_OPEN 跳过，一次都没真调。
  // 首轮跑的「0/4」有 5 个纯属这个测量污染，不是模型不行。与 6.8.8「共享单例
  // 污染测试」同型：测量工具自己的模块状态会伪造被测对象的结果。
  resetCircuitForTests();
  for (const theme of THEMES) {
    const query = QUERIES[theme] || theme;
    const env = {
      // 只配 OpenRouter，并强制只试当前被测模型（线上同款变量）
      OPENROUTER_API_KEY: KEY,
      OPENROUTER_MODEL: model,
      AI_PROVIDER_TIMEOUT_MS: TIMEOUT
    };

    const req = new Request('http://bench.local/api/ai-brain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 每个被测模型一个独立限流桶：否则 24+ 次请求共用 'anonymous' 桶
        // 会被 30 次 / 60s 的限流干扰，把「限流失败」误读成「模型不行」。
        'cf-connecting-ip': `10.0.0.${CANDIDATES.indexOf(model) + 1}`
      },
      body: JSON.stringify({ query, requestedShots: SHOTS })
    });

    const t0 = Date.now();
    let d = null;
    let raw = '';
    try {
      const res = await onRequest({ request: req, env });
      raw = await res.text();
      try { d = JSON.parse(raw); } catch { d = { __parseError: true, raw: raw.slice(0, 200) }; }
    } catch (e) {
      d = { __threw: true, error: String(e && e.message || e) };
    }
    const wall = Date.now() - t0;

    const call = (d && d.aiStatus && d.aiStatus.providers || []).find(p => p.id === 'openrouter');
    const lastCall = call && call.calls && call.calls.length ? call.calls[call.calls.length - 1] : null;
    const usedAi = d && d.isAiGenerated === true;
    const durs = d && Array.isArray(d.shots) ? d.shots.map(s => s.duration) : [];
    const tiers = [...new Set(durs)].sort();

    const row = {
      model, query: query.slice(0, 18), theme, wall,
      usedAi,
      reason: d?.aiStatus?.reason ?? null,
      // 熔断跳过 = 本工具自己的模块状态导致没测到，与被测模型无关，必须能筛出来
      circuitSkipped: (d?.aiStatus?.breakerSkipped?.length || 0) > 0 || d?.aiStatus?.reason === 'CIRCUIT_OPEN',
      engine: d?.engine ?? null,
      callMs: lastCall ? lastCall.ms : null,
      callError: lastCall ? lastCall.error : null,
      shots: d && Array.isArray(d.shots) ? d.shots.length : null,
      merged: d?.polish?.merged ?? null,
      kept: d?.polish?.kept ?? null,
      rejectedTotal: d?.polish?.rejectedTotal ?? null,
      durationTiers: tiers.length,
      durations: durs.join(',')
    };
    rows.push(row);

    const status = usedAi ? '✅' : (lastCall && lastCall.error ? '❌' : '—');
    console.log(`${status} ${model.padEnd(44)} ${row.query.padEnd(16)} ` +
      `${String(wall).padStart(6)}ms | ai=${usedAi ? 'Y' : 'N'} ${String(row.reason).padEnd(20)} ` +
      `shots=${String(row.shots).padStart(2)} 润色=${String(row.merged).padStart(2)}/${SHOTS} ` +
      `档位=${row.durationTiers}${lastCall && lastCall.error ? ` err=${lastCall.error.slice(0, 42)}` : ''}`);

    // 限流保护：线上是 30 次 / 60s，本地同一 IP 也会命中
    await new Promise(r => setTimeout(r, 2500));
  }
}

/* ────────────────────────── 汇总（6.9.3 口径） ────────────────────────── */

const byModel = {};
for (const r of rows) {
  if (!byModel[r.model]) byModel[r.model] = { n: 0, ok: 0, skipped: 0, ms: [], calls: [], merged: [], tiers: [] };
  const b = byModel[r.model];
  b.n++;
  // 未测到（被熔断跳过）不进分母：0/4 里混着「没测」会把没测到读成模型不行
  if (!r.usedAi && r.circuitSkipped && !r.callError) b.skipped++;
  if (r.usedAi) { b.ok++; if (r.callMs != null) b.ms.push(r.callMs); }
  if (r.merged != null) { b.calls.push(r.merged); b.merged.push(r.merged); }
  if (r.durationTiers != null) b.tiers.push(r.durationTiers);
}
const avg = a => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);

const ranked = Object.entries(byModel)
  .map(([model, b]) => {
    const measured = b.n - b.skipped; // 分母剔除未测到的轮次
    return {
      model,
      success: `${b.ok}/${measured}`,
      measured: `${measured}/${b.n}`,
      avgMs: avg(b.ms),
      avgMerged: avg(b.merged),
      avgTiers: avg(b.tiers),
      mergedTotal: b.merged.reduce((x, y) => x + y, 0)
    };
  })
  .sort((a, b) => {
    const sa = parseInt(a.success), sb = parseInt(b.success);
    if (sb !== sa) return sb - sa;                       // 先可用率
    if ((b.mergedTotal || 0) !== (a.mergedTotal || 0)) return b.mergedTotal - a.mergedTotal; // 再过守卫的镜数
    return (a.avgMs || 1e9) - (b.avgMs || 1e9);          // 最后速度
  });

console.log('\n================ 汇总（先可用率 → 再过守卫镜数 → 再速度） ================');
console.table(ranked);

const usable = ranked.filter(r => parseInt(r.success) > 0);
console.log(`\n建议保留的 4 个（按上述优先级）：`);
if (usable.length >= 4) {
  usable.slice(0, 4).forEach((r, i) => console.log(`  ${i + 1}. ${r.model}（可用 ${r.success}，平均 ${r.avgMs ?? '—'}ms，平均润色 ${r.avgMerged ?? '—'}/${SHOTS} 镜）`));
} else {
  console.log(`  ⚠ 实测可用的候选不足 4（当前 ${usable.length}，且已剔除被熔断跳过的未测轮次）——保持现有队列，不要为凑数塞不可用的`);
}

// 「未测到」必须单列：失败与没测到是两件事，混在一起会得出错误结论。
// 两类未测到：① 有调用错误（429 / 网络 / 5xx）；② 被熔断闸跳过（本工具的
// provider 级熔断状态，重置前属于测量污染，重置后仍出现说明 provider 真的在连败）。
const notMeasured = rows.filter(r => !r.usedAi && (r.callError || r.circuitSkipped));
if (notMeasured.length) {
  const byErr = notMeasured.filter(r => r.callError);
  const byCircuit = notMeasured.filter(r => !r.callError && r.circuitSkipped);
  if (byErr.length) {
    console.log(`\n未测到 · 有调用错误（需人工分辨是限流/网络还是模型问题）：`);
    for (const r of byErr) console.log(`  - ${r.model} · ${r.query} · ${String(r.callError).slice(0, 80)}`);
  }
  if (byCircuit.length) {
    console.log(`\n未测到 · 被熔断跳过（provider 级连续失败开闸，非模型本身结论）：`);
    for (const r of byCircuit) console.log(`  - ${r.model} · ${r.query}`);
  }
}

writeFileSync(OUT, JSON.stringify({ rows, ranked, keyHint: KEY.slice(0, 7) + '…', at: new Date().toISOString() }, null, 2));
console.log(`\n原始数据已写入 ${OUT}（默认已在 .gitignore）。`);
console.log('注意：这份结论是「本次实测」——模型会腐烂，按 6.8.9 起的措辞纪律不写「已定论」。');
console.log('改线上 PROVIDERS 名单走 PR，且上线后在 Cloudflare 生产环境复测一次再合。');
