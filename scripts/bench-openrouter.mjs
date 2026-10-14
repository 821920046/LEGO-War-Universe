/**
 * OpenRouter 免费模型基准测试（6.8.7）
 *
 * 设计原则：**直接驱动线上同一条代码路径**（functions/api/ai-brain.js 的 onRequest），
 * 而不是自己另写一遍调用逻辑。这样测到的东西与生产行为无法偏移 ——
 * 6.8.4 的教训就是「用间接指标推断」会错，这里连推理都省掉。
 *
 * 评分口径完全采用本项目自己的判定标准（而不是通用跑分）：
 *   - JSON 是否解析成功
 *   - assetUsage.unknown：模型编造了多少个清单外的资产 ID（幻觉）
 *   - repetitionFixed：有多少镜头因为复读而被确定性引擎强制变奏
 *   - functionRetagged：有多少镜头因为戏剧功能缺失/雷同而被强制补齐
 *   - 镜头数、耗时
 * 一个好模型的标志是**让确定性兜底少干活**。
 *
 * 用法：OR_KEY=sk-or-v1-xxx node _bench_openrouter.mjs
 */
import { onRequest } from './functions/api/ai-brain.js';

const KEY = process.env.OR_KEY;
if (!KEY) {
  console.error('缺少 OR_KEY 环境变量（OpenRouter API Key）');
  process.exit(2);
}

// 候选名单：先从 462 个模型里筛出「免费 + 纯文本输出」共 14 个，
// 再按用途排除：coding agent（poolside/cohere）、内容安全分类器（nemotron-content-safety）、
// 多模态感知（nemotron-nano-omni）。剩下 8 个进入实测。
const CANDIDATES = [
  'google/gemma-4-31b-it:free',              // 31B dense，JSON 模式支持
  'google/gemma-4-26b-a4b-it:free',          // 26B MoE，JSON 模式支持
  'nvidia/nemotron-3-super-120b-a12b:free',  // 120B MoE，JSON 模式支持
  'dots-studio/dots-3-note-preview:free',    // 16B active MoE，JSON 模式支持
  'nvidia/nemotron-3-ultra-550b-a55b:free',  // 550B MoE 推理型，无 JSON 模式
  'thinkingmachines/inkling:free',           // 41B active MoE，无 JSON 模式
  'nvidia/nemotron-3.5-lightning:free',      // 3B active，无 JSON 模式
  'liquid/lfm-2.5-2.6b:free'                 // 2.6B 小型推理模型，64k 上下文
];

// 三个不同难度的真实题材（覆盖：现代战争 / 历史 / 科幻创意）
const QUERIES = [
  '冷战时期北欧峡湾的潜艇对峙',
  ' medieval castle siege with trebuchets', // 中世纪攻城
  '火星殖民地的武装起义'                     // 科幻创意
];

const rows = [];

for (const model of CANDIDATES) {
  for (const query of QUERIES) {
    const env = {
      // 只配 OpenRouter，并强制只试当前被测模型
      OPENROUTER_API_KEY: KEY,
      OPENROUTER_MODEL: model,
      // 放宽超时：2.6B/550B 都可能慢，别让测量被上限截断
      AI_PROVIDER_TIMEOUT_MS: '90000',
      AI_REQUEST_BUDGET_MS: '120000'
    };

    const req = new Request('http://bench.local/api/ai-brain', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // 每个被测模型一个独立限流桶：否则 24 次请求共用 'anonymous' 桶
        // 会被 30 次 / 60s 的限流干扰，把「限流失败」误读成「模型不行」。
        'cf-connecting-ip': `10.0.0.${CANDIDATES.indexOf(model) + 1}`
      },
      body: JSON.stringify({ query, requestedShots: 4 })
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

    const call = (d && d.aiStatus && d.aiStatus.providers || [])
      .find(p => p.id === 'openrouter');
    const lastCall = call && call.calls && call.calls.length ? call.calls[call.calls.length - 1] : null;
    const usedAi = d && d.isAiGenerated === true;

    rows.push({
      model,
      query: query.slice(0, 18),
      wall,
      usedAi,
      callMs: lastCall ? lastCall.ms : null,
      callError: lastCall ? lastCall.error : null,
      engine: d && d.engine,
      shots: d && Array.isArray(d.shots) ? d.shots.length : null,
      // 质量口径：确定性引擎被迫干了多少活
      unknownIds: d && d.assetUsage ? d.assetUsage.unknown.length : null,
      matchedAssets: d && d.assetUsage ? d.assetUsage.matched : null,
      repetitionFixed: d ? d.repetitionFixed : null,
      functionRetagged: d ? d.functionRetagged : null,
      latencyMs: d ? d.latencyMs : null
    });

    const status = usedAi ? '✅' : '❌';
    console.log(`${status} ${model.padEnd(44)} ${query.slice(0, 14).padEnd(16)} ` +
      `${String(wall).padStart(6)}ms | ai=${usedAi ? 'Y' : 'N'} shots=${String(d && d.shots ? d.shots.length : '-').padStart(2)} ` +
      `未知ID=${String(rows[rows.length - 1].unknownIds).padStart(2)} 复读修正=${String(rows[rows.length - 1].repetitionFixed).padStart(2)} ` +
      `功能重标=${String(rows[rows.length - 1].functionRetagged).padStart(2)}` +
      (lastCall && lastCall.error ? ` | err=${lastCall.error.slice(0, 40)}` : ''));

    // 限流保护：线上是 30 次 / 60s，本地同一 IP 也会命中
    await new Promise(r => setTimeout(r, 2500));
  }
}

// 汇总排名
console.log('\n================ 汇总（按「确定性兜底负担」排序，越小越好） ================');
const byModel = {};
for (const r of rows) {
  if (!byModel[r.model]) byModel[r.model] = { n: 0, ok: 0, ms: [], unknown: [], rep: [], fn: [], shots: [] };
  const b = byModel[r.model];
  b.n++;
  if (r.usedAi) {
    b.ok++;
    if (r.callMs != null) b.ms.push(r.callMs);
    b.unknown.push(r.unknownIds || 0);
    b.rep.push(r.repetitionFixed || 0);
    b.fn.push(r.functionRetagged || 0);
    b.shots.push(r.shots || 0);
  }
}
const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null;
const ranked = Object.entries(byModel)
  .map(([model, b]) => ({
    model,
    success: `${b.ok}/${b.n}`,
    avgMs: avg(b.ms),
    avgUnknown: avg(b.unknown),
    avgRep: avg(b.rep),
    avgFn: avg(b.fn),
    avgShots: avg(b.shots)
  }))
  .sort((a, b) => {
    // 先按成功率，再按兜底负担（未知ID + 复读修正 + 功能重标），再按速度
    const sa = parseInt(a.success), sb = parseInt(b.success);
    if (sb !== sa) return sb - sa;
    const loadA = (a.avgUnknown || 0) + (a.avgRep || 0) + (a.avgFn || 0);
    const loadB = (b.avgUnknown || 0) + (b.avgRep || 0) + (b.avgFn || 0);
    if (loadB !== loadA) return loadB - loadA;
    return (a.avgMs || 1e9) - (b.avgMs || 1e9);
  });

console.table(ranked);

// 落盘原始数据，供报告引用
const out = await import('node:fs');
out.writeFileSync('_bench_result.json', JSON.stringify({ rows, ranked, at: new Date().toISOString() }, null, 2));
console.log('\n原始数据已写入 _bench_result.json');
