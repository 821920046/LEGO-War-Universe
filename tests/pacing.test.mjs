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
import { BEATS, FUNCTION_DURATION, PHASES } from '../src/domain/narrative.js';
import { SLOTS } from '../src/domain/story.js';

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
