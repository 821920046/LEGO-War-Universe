/**
 * 6.7.4「节奏」回归测试
 *
 * 上一轮（6.7.3）修完了「画面语言」，但把一条**节奏倒挂**如实记进了残余风险：
 *
 *     climax 7.92s > build 7.56s > establish 7.49s > resolve 6.79s
 *
 * ——最高潮是全片最慢的一段。这不是审美问题，是三个 bug 叠在一起：
 *
 *   1. 原型（`story.js` 的 `SLOTS`）里的节拍**全都不写 duration**，
 *      而旧代码是 `Number(beat.duration) || 8` —— 于是**每一条原型节拍都默认 8 秒**，
 *      声明 4 秒的快切（contact / clash / cost）被静默升格成长镜。
 *   2. `clauseSeconds` 是「一律 2 秒/分句」，于是「拐角。两米。」（3+2 字，纯顿挫）
 *      被算成 4 秒，任何快切都装不下。
 *   3. `fitDuration` 取 `max(声明, 内容)` —— 内容一超，声明就被顶掉。
 *
 * 修完之后，这里要守住四件事：
 *
 *   A. `FUNCTION_DURATION` 是**唯一**的节奏语法表，且每个值都必须是模型支持的档位。
 *   B. `BEATS` 里若有节拍想覆盖语法表，必须**逐条登记**在 `JUSTIFIED_OVERRIDES` ——
 *      覆盖是例外，不能变成悄悄漂移。
 *   C. **没有任何镜头被内容顶掉它声明的时长**（这一条是回归的核心）。
 *   D. 曲线必须真的有起伏：铺陈最慢、高潮最快，且落差不能被压平。
 *
 * 断言全部基于**真实编译产物**（`planFilm` 的输出），而不是内部字段 ——
 * 内部字段一致但成片节奏倒挂，正是上一轮没被发现的形态。
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import assets from '../02_Assets/assets.json' with { type: 'json' };
import profiles from '../02_Assets/model-profiles.json' with { type: 'json' };
import { createRegistry } from '../src/domain/registry.js';
import { planFilm, contentSeconds, FIT_TOLERANCE } from '../src/domain/planner.js';
import { BEATS, FUNCTION_DURATION, PHASES, renderTemplate } from '../src/domain/narrative.js';
import { SLOTS, expandVocab, vocabFor } from '../src/domain/story.js';

const registry = createRegistry(assets, profiles, { references: [] });
const PROFILE = [...registry.profileById.keys()][0];

/** 模型支持的档位（见 `02_Assets/model-profiles.json`）—— 语法表只能落在这几个值上 */
const SUPPORTED = new Set(
  [...registry.profileById.values()].flatMap(p => p.durations || []).filter(Number.isFinite)
);

const THEMES = [
  '库尔斯克坦克对决', '核潜艇深海猎杀', '中途岛航母对决', '诺曼底登陆抢滩', 'F-22 制空巡逻',
  '轨道空间站失压事故', '跳伞飞行员敌后营救', '现代特战小队城市废墟夜间突袭', 'B-2 轰炸敌方雷达站',
  '斯大林格勒巷战', '海湾战争夜战防空导弹阵地伏击', '太平洋热带岛屿滩头两栖登陆作战',
  '沙漠风暴装甲突击', '伊拉克战争城市清剿', '二战北非沙漠装甲追击', '航母战斗群远海编队作战',
  '阿登森林冬季反击战', '敌后渗透破坏桥梁', '护航编队反潜警戒', '近地轨道卫星争夺战',
  '无人机蜂群突防压制敌方雷达', '动力外骨骼小队突击城市废墟', '使馆撤侨掩护平民撤离',
  '高超音速滑翔弹打击敌方反导阵地', '电子战与网络战压制敌方指挥节点', '反无人机阵地防御'
];
const SHOT_COUNTS = [9, 12, 18];

/** 节拍自己声明的时长（`BEATS` 里写了 duration 的那些） */
const BEAT_DECL = new Map();
for (const b of BEATS) if (b.id && b.duration !== undefined) BEAT_DECL.set(b.id, b.duration);

/**
 * 允许偏离 `FUNCTION_DURATION` 的节拍 —— **必须逐条给出理由**。
 *
 * 语法表是缺省值，不是铁律：镜头类型本身要求不同的长度时，可以覆盖。
 * 但覆盖一旦可以「随手写」，语法表就退化成注释，节奏会慢慢漂回去。
 */
const JUSTIFIED_OVERRIDES = new Map([
  ['est-approach-3', { duration: 8, why: '载具低角度跟拍长镜：整段是「碾过草原 + 车灯切出长锥」，本身就是长镜' }],
  ['bld-escalate-4', { duration: 4, why: '换弹间隙贴身特写：插帧式的快切，escalate 的 6s 反而拖沓' }],
  ['res-after-2', { duration: 6, why: '最后清剿收束：带一次短促点射，不是纯静场，故短于 aftermath 的 8s' }]
]);

/** 一次编译里每个镜头的「声明时长」—— 节拍自己写了就用它的，否则用语法表 */
const declaredOf = s => BEAT_DECL.get(s.beatId) ?? FUNCTION_DURATION[s.fn];

const films = [];
for (const theme of THEMES) {
  for (const n of SHOT_COUNTS) {
    films.push({ theme, n, plan: planFilm({ theme, requestedShots: n, profileId: PROFILE }, registry).plan });
  }
}

/* ───────────────── A. 语法表必须完整、合法 ───────────────── */

test('6.7.4 · FUNCTION_DURATION 必须覆盖所有用到的戏剧功能，且只落在模型支持的档位上', () => {
  const used = new Set();
  for (const b of BEATS) used.add(b.fn);
  for (const slots of Object.values(SLOTS)) {
    for (const [fn, list] of Object.entries(slots)) {
      for (const b of (Array.isArray(list) ? list : [list])) used.add(b.fn ?? fn);
    }
  }

  for (const fn of used) {
    assert.ok(fn, '存在没有 fn 的节拍');
    assert.ok(FUNCTION_DURATION[fn] !== undefined,
      `戏剧功能「${fn}」没有在 FUNCTION_DURATION 里声明时长 —— 它会掉进 fitDuration 的默认档`);
  }
  for (const [fn, d] of Object.entries(FUNCTION_DURATION)) {
    assert.ok(SUPPORTED.has(d), `FUNCTION_DURATION.${fn} = ${d}s 不是模型支持的档位`);
  }
});

/* ───────────────── B. 覆盖必须逐条登记 ───────────────── */

test('6.7.4 · BEATS 里对语法表的覆盖必须与 JUSTIFIED_OVERRIDES 完全一致', () => {
  const actual = new Map();
  for (const b of BEATS) {
    if (b.duration === undefined) continue;
    if (b.duration === FUNCTION_DURATION[b.fn]) continue; // 与语法表一致，不算覆盖
    actual.set(b.id, b.duration);
  }

  for (const [id, d] of actual) {
    const j = JUSTIFIED_OVERRIDES.get(id);
    assert.ok(j, `节拍 ${id} 声明了 ${d}s（语法表 ${FUNCTION_DURATION[BEATS.find(b => b.id === id).fn]}s）却没有登记理由`);
    assert.equal(d, j.duration, `节拍 ${id} 的声明时长与登记值不符`);
  }
  for (const [id] of JUSTIFIED_OVERRIDES) {
    assert.ok(actual.has(id), `JUSTIFIED_OVERRIDES 里的 ${id} 已经不再覆盖任何时长 —— 陈旧条目要删掉`);
  }
});

/* ───────────────── C. 没有任何镜头被内容顶掉声明时长 ───────────────── */

test('6.7.4 · 没有任何镜头的内容把它的声明时长顶到更高一档', () => {
  // 这一条是整轮的回归靶心。修好之前：原型节拍不写 duration → 默认 8s，
  // 而 contact/clash/cost 声明 4s，被内容顶到 6s/8s，于是「快切」全变成了长镜。
  const offenders = [];
  let shots = 0;

  for (const { theme, n, plan } of films) {
    for (const s of plan.shots) {
      shots++;
      const decl = declaredOf(s);
      if (decl === undefined) continue;
      if (s.duration > decl) {
        const need = contentSeconds(s.action).total;
        offenders.push(
          `${theme} n=${n} ${s.fn}: 声明 ${decl}s 内容需要 ${need.toFixed(2)}s → 编译成 ${s.duration}s\n    ${s.action}`
        );
      }
    }
  }

  assert.ok(shots > 500, `样本量太小（${shots} 镜），断言没有意义`);
  assert.equal(offenders.length, 0,
    `${offenders.length} 个镜头被内容顶掉了声明时长：\n` + offenders.slice(0, 6).join('\n'));
});

test('6.7.4 · 内容超出声明时只能落在容差带内，不能靠容差掩盖错位', () => {
  // 与上一条互补：上一条查「真的升档了」，这一条查「超出的幅度是否失控」。
  // 容差只吸收模型误差量级的偏差（FIT_TOLERANCE），不该掩盖「这一镜放错了节奏位」。
  for (const { theme, n, plan } of films) {
    for (const s of plan.shots) {
      const decl = declaredOf(s);
      if (decl === undefined) continue;
      const need = contentSeconds(s.action).total;
      assert.ok(need <= decl * (1 + FIT_TOLERANCE) + 0.001,
        `${theme} n=${n} ${s.fn}: 内容 ${need.toFixed(2)}s 超出声明 ${decl}s 的容差上限 ` +
        `(${(decl * (1 + FIT_TOLERANCE)).toFixed(2)}s)\n    ${s.action}`);
    }
  }
});

/* ───────────────── D. 曲线必须真的有起伏 ───────────────── */

test('6.7.4 · 节奏曲线：铺陈最慢、高潮最快，落差不能被压平', () => {
  const byPhase = new Map(PHASES.map(p => [p, []]));
  for (const { plan } of films) {
    for (const s of plan.shots) {
      const arr = byPhase.get(s.phase);
      if (arr) arr.push(s.duration);
    }
  }
  const avg = a => a.reduce((x, y) => x + y, 0) / a.length;
  const a = Object.fromEntries([...byPhase].map(([p, v]) => [p, avg(v)]));

  for (const p of PHASES) {
    assert.ok(Number.isFinite(a[p]) && byPhase.get(p).length > 0, `阶段 ${p} 没有任何镜头`);
  }

  // 修好之前实测：climax 7.92 > build 7.56 > establish 7.49 > resolve 6.79（完全倒挂）
  assert.ok(a.establish > a.build,
    `铺陈(${a.establish.toFixed(2)}s) 不比推进(${a.build.toFixed(2)}s) 慢，开场没有沉住气`);
  assert.ok(a.build >= a.climax - 0.05,
    `推进(${a.build.toFixed(2)}s) 比高潮(${a.climax.toFixed(2)}s) 还快，中段就泄了`);
  assert.ok(a.climax <= a.resolve + 0.15,
    `高潮(${a.climax.toFixed(2)}s) 比结局(${a.resolve.toFixed(2)}s) 还慢，最高点被拖住了`);
  assert.ok(a.establish - a.climax >= 1.0,
    `铺陈与高潮只差 ${(a.establish - a.climax).toFixed(2)}s，曲线被压平了`);
});

/* ───────────────── E. 4 秒档必须真的被用上，且不许空转 ───────────────── */

test('6.7.4 · 4 秒快切档必须真的被用到，且短切不能空转', () => {
  const hist = new Map();
  let shots = 0;
  for (const { theme, n, plan } of films) {
    for (const s of plan.shots) {
      shots++;
      hist.set(s.duration, (hist.get(s.duration) || 0) + 1);

      // 修好之前 4 秒档的使用率是 **0%**（6s×87、8s×225）—— 快切这一档整体失效。
      // 一个 4 秒的硬切如果正文只有一两秒，模型会自己补画面，比长镜更伤节奏，
      // 所以这里同时守住「不能空转」：短切的正文至少要占满一半时长。
      if (s.duration === 4) {
        const need = contentSeconds(s.action).total;
        assert.ok(need >= s.duration * 0.5,
          `${theme} n=${n} ${s.fn}: 4 秒快切只有 ${need.toFixed(2)}s 的正文，会空转\n    ${s.action}`);
      }
    }
  }

  const four = hist.get(4) || 0;
  assert.ok(four / shots >= 0.1,
    `4 秒档只占 ${(four / shots * 100).toFixed(1)}%（${four}/${shots}），快切几乎没被用上`);
});

/* ══════════════════════════════════════════════════════════════════════ *
 * F. 内容预算（6.9.1）—— 快切节拍的文本量必须配得上它的档位
 *
 * 症状（用户视角）：最短的镜头塞最多内容。修好前实测 4 秒镜平均 64 字 /
 * 3.6 分句、6 秒镜 55 字、8 秒镜 55 字 —— 最短的桶反而最满。
 *
 * 机制：`fitDuration` 取 `max(声明时长, 内容需要)`，内容一超档位就升格，
 * 于是声明 4 秒的快切（contact / clash / cost / reaction）被静默拱成
 * 6–8 秒长镜，节奏曲线倒挂。上行是**静默**的：没有任何报错，
 * 只是「这一镜变慢了」——这正是它必须被门禁守死的原因。
 *
 * 红线口径（与 FIT_TOLERANCE 同源）：
 *     contentSeconds(text).total ≤ duration × (1 + 0.15)
 *   4s 档接受 ≤4.71s · 6s 档 ≤7.06s · 8s 档 ≤9.41s。
 *
 * 口径注意（探针踩过的坑，与 6.8.8「验证工具自身要干净」同型）：
 *   SLOTS 的文本含 `{vocab.xxx}` 点路径，而 `renderTemplate` 的
 *   `fillTemplate` 只认 `\{\w+\}` —— 必须先用 story.js 的 `expandVocab`
 *   按 era 展开（与 storySteps 装配时同一份口径），否则 `{vocab.armorRound}`
 *   的 20 个 ASCII 字符会被 clauseSeconds 当成内容秒，测出根本不存在的超预算。
 *
 * 分句预算只进报告、不设硬红线的理由：pacing 轮刻意保留的短分句顿挫
 * （如「拐角。两米。」11 字 3 分句仅 2.83s 内容）是节奏资产不是负债，
 * 内容秒已经证明它装得下；硬分句线会把这些全部误判。
 * ══════════════════════════════════════════════════════════════════════ */

/** 中文字符数（代号【】、标点、ASCII 均不计） */
const cjkLen = s => String(s ?? '').replace(/[^\u4e00-\u9fff]/g, '').length;

/** 字数宽松上限：4s ≤40 / 6s ≤60 / 8s ≤90（任务口径） */
const BUDGET_CHARS = { 4: 40, 6: 60, 8: 90 };

/** SLOTS 节拍的档位：原型不写 duration，按戏剧功能语法表走 */
const slotDuration = fn => FUNCTION_DURATION[fn] || 6;

/**
 * 全量原型库节拍（BEATS 通用原型 + SLOTS 题材槽位）。
 * SLOTS 先按各 era 词表展开 vocab —— 每个 era 的词长不同（高射炮火网 →
 * 定向能拦截），都要过一遍预算线。
 */
function budgetCorpus() {
  const ctx = {
    heroCallsign: '【ROMEO】', supportCallsign: '【LANTERN】', enemyCallsign: '【SPECTRE】',
    vehicle: 'F-22 猛禽战斗机', place: '城区断桥', env: '城郊工业区', weather: '暴雨',
    deadline: '九十秒', objective: '拿下桥头', stake: '整个小队都会埋在这里', link: '紧接着，'
  };
  const eras = ['ww2', 'coldwar', 'modern', 'future'];
  const out = [];
  for (const b of BEATS) {
    if (!b.action) continue;
    out.push({ id: b.id, fn: b.fn, duration: b.duration, src: 'BEATS', text: b.action });
  }
  for (const [slot, kernel] of Object.entries(SLOTS)) {
    for (const [group, beats] of Object.entries(kernel)) {
      for (const b of beats) {
        if (!b.action) continue;
        for (const era of eras) {
          const vocab = vocabFor(era);
          const text = expandVocab(b.action, vocab);
          out.push({
            id: `${slot}:${group}`, fn: b.fn, duration: slotDuration(b.fn),
            src: `SLOTS@${era}`, text, vocab
          });
        }
      }
    }
  }
  // BEATS 也可能引用点路径（防御未来新增），同样展开
  for (const b of BEATS) {
    if (!/\{vocab\./.test(b.action)) continue;
    for (const era of eras) {
      out.push({
        id: b.id, fn: b.fn, duration: b.duration, src: `BEATS@${era}`,
        text: expandVocab(b.action, vocabFor(era))
      });
    }
  }
  return { out, ctx };
}

test('6.9.1 · 内容预算：原型库节拍的内容秒数不许顶掉自己声明的档位', () => {
  const { out, ctx } = budgetCorpus();
  const violations = out.map(b => {
    // 装配序与 storySteps 一致：先 expandVocab（budgetCorpus 已做）再 renderTemplate 渲染代号等占位符
    const text = renderTemplate(b.text, ctx);
    const need = contentSeconds(text).total;
    const cap = b.duration * (1 + FIT_TOLERANCE);
    return need > cap ? `${b.id} [${b.src}] need=${need.toFixed(2)}s > ${b.duration}s×1.15=${cap.toFixed(2)}s\n    ${text.slice(0, 60)}` : null;
  }).filter(Boolean);
  assert.equal(violations.length, 0,
    `${violations.length} 条节拍超内容预算（fitDuration 会静默升档、快切被拱成长镜）：\n  ${violations.join('\n  ')}`);
  assert.ok(out.length >= 200, `语料覆盖不足：${out.length} 条`);
});

test('6.9.1 · 内容预算：字数宽松上限（4s ≤40 / 6s ≤60 / 8s ≤90 中文字）', () => {
  const { out, ctx } = budgetCorpus();
  const over = out.map(b => {
    const text = renderTemplate(b.text, ctx);
    const chars = cjkLen(text);
    const cap = BUDGET_CHARS[b.duration];
    if (cap === undefined) return null; // 未登记的档位由 A 节语法表门禁负责
    return chars > cap ? `${b.id} [${b.src}] ${chars}字 > ${b.duration}s 档上限 ${cap} 字\n    ${text.slice(0, 60)}` : null;
  }).filter(Boolean);
  assert.equal(over.length, 0,
    `${over.length} 条节拍超过字数上限（长段落塞进短镜头，观众来不及看）：\n  ${over.join('\n  ')}`);
});

test('6.9.1 · 反向验证：预算判据本身对超长节拍必须会红（门禁不是恒绿）', () => {
  // 构造一条**故意**超载的 4 秒接触镜：分句数远超、内容秒远超 4.71s。
  // 若判据失效（比如 FIT_TOLERANCE 被改成 10），这条会先红 ——
  // 证明上面两条门禁的「绿」是真的量过，而不是永远放行。
  const overlong = {
    id: 'SYNTH-OVERLONG', fn: 'contact', duration: 4,
    action: '【ROMEO】贴着掩体推进，交替掩护，火力压制，烟雾弥漫，弹壳纷飞，伤员后送，无人机临空侦察，电台里指令纷杂，敌方增援正在集结，局势一触即发，每一秒都关乎成败。'
  };
  const text = renderTemplate(overlong.action, {});
  const need = contentSeconds(text).total;
  const cap = overlong.duration * (1 + FIT_TOLERANCE);
  assert.ok(need > cap,
    `构造的超载节拍竟然没超预算（need=${need.toFixed(2)}s ≤ cap=${cap.toFixed(2)}s）—— ` +
    '内容秒模型或容差被改动，上面两条预算门禁的基线已失效，必须重校');
  assert.ok(cjkLen(text) > BUDGET_CHARS[4],
    `构造的超载节拍字数没超上限（${cjkLen(text)} 字）—— 字数判据基线失效`);
});
