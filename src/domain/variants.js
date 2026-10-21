/**
 * 多方案生成引擎（6.8.0）—— 同一句用户描述，产出 N 部**不同**的电影。
 *
 * **为什么需要它**
 *
 * 在此之前，`planFilm` 对一个主题只给**一部**片子：seed 只由 `主题|镜头数` 决定，
 * 视角、叙事重心、基调全部写死。用户输入任何描述，拿到的都是同一条流水线上的
 * 同一部电影 —— 只是名词被换来换去。实测 408 镜里 34.6% 与其它片子共用同一个
 * 句子骨架（「两小时之内…否则…」式台词到处都是），这就是「没有创新能力」
 * 的量化形态。
 *
 * **本模块的做法：把「换一部电影」拆成三个正交旋钮**
 *
 *   ┌────────────┬──────────────────────────────────────────────┐
 *   │ 视角 angle  │ 这部片**站在谁那边**：指挥官 / 士兵 / 敌方 / 装备 │
 *   │ 重心 emph.  │ 这部片**讲什么**：动作 / 人物 / 战术            │
 *   │ 基调 tone   │ 这部片**怎么拍**：纪实 / 史诗 / 惊悚 / 冷峻      │
 *   └────────────┴──────────────────────────────────────────────┘
 *
 * 三个旋钮都通过 `planFilm({ variant })` 落实，互不重叠：
 *   · `angle` 改**谁上场、谁主导**（主角选择与正反方置换）
 *   · `emphasis` 改**戏剧功能弧的顺序**（`selectBeats({ arc })`）
 *   · `tone` 改**视觉偏好**（机位 / 灯光 / 调色的同分决胜）
 * 再叠一个 `seedSalt` 打散节拍与名册的确定性抽样。
 *
 * **确定性是硬约束**：同一个 `(theme, count, specs)` 永远产出同一组方案 ——
 * 否则前端两次渲染会拿到不同的「最优」，用户以为页面在撒谎。
 */

import { planFilm } from './planner.js';
import { skeletonOf, rosterNames } from './variant-score.js';

/**
 * 选方案时的候选池放大倍数。
 *
 * 为什么不能直接生成 `count` 个就交差：三个旋钮（视角 × 重心 × 基调）虽然互不重叠，
 * 但**同一主题下不同旋钮组合仍可能落到同一部片** —— 实测「现代特战小队渗透掩体」
 * 的四个方案里有两部骨架重合 88%（台词、节拍、镜头序列几乎逐字相同），
 * 用户看到的就是「四个换皮方案」。多生成几部再筛掉重合的，比事后扣分诚实。
 */
const SPEC_POOL_FACTOR = 3;
const MAX_SPEC_POOL = 24;
/** 骨架重合超过这个比例就视为「同一部片的换皮」，不进最终名单 */
const SIMILARITY_MAX = 0.45;

/** 两部片子的句子骨架重合率（只看重合，不看顺序） */
function skeletonOverlap(a, b) {
  // 带名册人名：不同方案的正反方是互换的（enemy 视角），不带人名表的话
  // 「只换了角色」会被当成不同骨架，重合率虚低（见 skeletonOf 的说明）
  const sa = (a?.film?.plan?.shots || []).map(s => skeletonOf(s.action, rosterNames(a?.film?.plan?.roster)));
  const sb = (b?.film?.plan?.shots || []).map(s => skeletonOf(s.action, rosterNames(b?.film?.plan?.roster)));
  if (!sa.length || !sb.length) return 0;
  const set = new Set(sb);
  return sa.filter(s => set.has(s)).length / sa.length;
}

/** 视角：这部片站在谁那边 */
export const ANGLES = {
  commander: { label: '指挥官视角', hint: '主角是下达命令的人，镜头跟着决断走' },
  grunt: { label: '士兵视角', hint: '主角是执行层，特写更多落在人脸上而非装备上' },
  enemy: { label: '敌方视角', hint: '正反方互换，观众跟着对面那个人看完这场战斗' },
  machine: { label: '装备视角', hint: '载具主导，飞机/坦克/舰船是真正的主角' }
};

/** 叙事重心：这部片讲什么 */
export const EMPHASES = {
  action: { label: '动作重心', hint: '接触与交锋优先，压力堆在高潮段' },
  character: { label: '人物重心', hint: '人物时刻与反应优先，开火前有静默' },
  tactical: { label: '战术重心', hint: '计划与揭示优先，反转来自情报而不是火力' }
};

/** 基调：这部片怎么拍 */
export const TONES = {
  documentary: { label: '纪实', hint: '手持、自然光、纪录片调色' },
  epic: { label: '史诗', hint: '宽画幅、金色时刻、饱和度高的宽调' },
  thriller: { label: '惊悚', hint: '近景、夜与高对比、冷蓝' },
  gritty: { label: '冷峻', hint: '粗糙、阴天、低饱和' }
};

/** 各重心下的阶段弧（只改顺序，不改功能集合 —— 不变式因此自动保持） */
export const EMPHASIS_ARC = {
  action: {
    // 6.9.8：establish 与默认弧线同调 —— approach（渗透）提到 world/character
    // 前面。动作重心的 8 镜原本是「简报 → 大远景」双文戏开场，与重心名不符。
    establish: ['goal', 'approach', 'observe', 'world', 'character'],
    build: ['contact', 'escalate', 'cost', 'reveal', 'plan', 'observe'],
    climax: ['clash', 'escalate', 'reversal', 'cost', 'decision', 'quiet'],
    resolve: ['aftermath', 'reaction', 'cost', 'close', 'quiet']
  },
  character: {
    establish: ['character', 'goal', 'world', 'observe', 'approach'],
    build: ['observe', 'plan', 'reveal', 'contact', 'escalate', 'cost'],
    climax: ['decision', 'quiet', 'reversal', 'clash', 'cost', 'quiet'],
    resolve: ['reaction', 'aftermath', 'quiet', 'close', 'cost']
  },
  tactical: {
    establish: ['goal', 'plan', 'world', 'character', 'approach', 'observe'],
    build: ['plan', 'reveal', 'escalate', 'contact', 'cost', 'observe'],
    climax: ['decision', 'reversal', 'reveal', 'escalate', 'clash', 'quiet'],
    resolve: ['aftermath', 'close', 'reaction', 'cost', 'quiet']
  }
};

/**
 * 方案规格表：同一主题下 N 个**尽量互不相同**的方案。
 *
 * 组合刻意离散：先按 视角 × 重心 铺开，再轮转基调。
 * 同一个 (angle, emphasis) 不会出现两次 —— 那是换皮不是换片。
 */
export function variantSpecs(theme = '', count = 4) {
  const n = Math.max(1, Math.min(8, Number(count) || 4));
  const angles = Object.keys(ANGLES);
  const emphases = Object.keys(EMPHASES);
  const tones = Object.keys(TONES);
  // 由主题决定起手，让不同主题的方案组合不同（但仍确定）
  const turn = [...theme].reduce((s, ch) => (s * 31 + ch.codePointAt(0)) >>> 0, 7);

  const specs = [];
  const seen = new Set();
  for (let i = 0; i < n; i++) {
    const angle = angles[(turn + i) % angles.length];
    const emphasis = emphases[(turn + i * 2 + 1) % emphases.length];
    const tone = tones[(turn + i * 3 + 2) % tones.length];
    const key = `${angle}|${emphasis}|${tone}`;
    if (seen.has(key)) {
      // 撞车就往后再找一个没用过的组合
      for (let k = 1; k < 64; k++) {
        const a2 = angles[(turn + i + k) % angles.length];
        const e2 = emphases[(turn + i * 2 + k) % emphases.length];
        const t2 = tones[(turn + i * 3 + k) % tones.length];
        const k2 = `${a2}|${e2}|${t2}`;
        if (!seen.has(k2)) {
          specs.push({ angle: a2, emphasis: e2, tone: t2, seedSalt: `v${i}`, label: `${ANGLES[a2].label} · ${EMPHASES[e2].label} · ${TONES[t2].label}` });
          seen.add(k2);
          break;
        }
      }
      continue;
    }
    seen.add(key);
    specs.push({ angle, emphasis, tone, seedSalt: `v${i}`, label: `${ANGLES[angle].label} · ${EMPHASES[emphasis].label} · ${TONES[tone].label}` });
  }
  return specs;
}

/**
 * 生成候选方案集合并打分排序。
 *
 * @param {object} o
 * @param {string} o.theme           用户描述
 * @param {number} o.requestedShots  镜头数
 * @param {string} o.profileId       模型配置文件
 * @param {number} [o.count]         方案数（默认 4）
 * @param {object} r                 资产注册表
 * @param {Function} score           打分函数（由 variant-score.js 提供，注入以便测试替换）
 * @returns {{ candidates: Array, best: object, specs: Array }}
 */
export function planVariants({ theme, requestedShots = 4, profileId, count = 4, era = null, score = null }, r) {
  const want = Math.max(1, Math.min(8, Number(count) || 4));
  const poolSize = Math.min(MAX_SPEC_POOL, Math.max(want, want * SPEC_POOL_FACTOR));
  const specs = variantSpecs(theme, poolSize);
  const candidates = specs.map((spec, i) => {
    let film = null;
    let error = null;
    try {
      film = planFilm({ theme, requestedShots, profileId, era, variant: spec }, r);
    } catch (e) {
      error = String(e?.message || e);
    }
    const entry = { index: i, spec, film, error, score: -Infinity, detail: null };
    if (film && typeof score === 'function') {
      try {
        // `film` 是 planFilm 的返回值（{ intent, plan, … }），打分器要的是 plan 本体。
        entry.detail = score(film.plan || film, r) || null;
        entry.score = typeof entry.detail.total === 'number' ? entry.detail.total : (typeof entry.detail === 'number' ? entry.detail : -Infinity);
      } catch (e) {
        entry.error = `score: ${String(e?.message || e)}`;
      }
    } else if (film) {
      entry.score = 0;
    }
    return entry;
  });

  // 排序：分数高的在前；同分按 index（保证确定性）。
  const ranked = [...candidates].sort((a, b) => (b.score - a.score) || (a.index - b.index));

  const best = selectDistinct(ranked.filter(c => c.film), want);
  return { candidates: best, best: best[0] || null, specs: best.map(c => c.spec) };
}

/**
 * 从候选池里挑出 `want` 部**尽量互不相同**的电影。
 *
 * 单遍贪心（按分数从高到低取、重合过高就跳过）不够 —— 实测「斯大林格勒狙击手」
 * 的 12 个候选里，分数最高的那部会**连带挡掉三个**与自己相似的候选，
 * 单遍贪心凑不满 4 部，回退后又把最像的那部塞了回来（两部重合 75%）。
 * 所以这里**换种子重试**：每个高分候选都当一次起点，各自贪心铺开，
 * 再按「最大两两重合最小、其次总分最高」挑最好的一组。
 * 复杂度 O(种子数 × 池子大小 × 镜头数)，池子上限 24，代价可以忽略。
 */
function selectDistinct(pool, want) {
  if (pool.length <= want) return [...pool];
  const seeds = pool.slice(0, Math.min(8, pool.length));
  const maxOverlapOf = (set) => {
    let m = 0;
    for (let i = 0; i < set.length; i++) {
      for (let j = i + 1; j < set.length; j++) m = Math.max(m, skeletonOverlap(set[i], set[j]));
    }
    return m;
  };
  const overlapWith = (c, set) => set.reduce((m, p) => Math.max(m, skeletonOverlap(p, c)), 0);

  let bestSet = null;
  let bestKey = null;
  for (const seed of seeds) {
    const set = [seed];
    for (const c of pool) {
      if (set.length >= want) break;
      if (set.includes(c)) continue;
      if (overlapWith(c, set) > SIMILARITY_MAX) continue;
      set.push(c);
    }
    if (set.length < want) {
      // 放宽：先按「与已选最不重合」排，其次按分数 —— 宁可分数低一点，
      // 也不能把一部只换了人名的片子当成「另一个方案」。
      const rest = pool.filter(c => !set.includes(c))
        .sort((a, b) => (overlapWith(a, set) - overlapWith(b, set)) || (b.score - a.score));
      while (set.length < want && rest.length) set.push(rest.shift());
    }
    const key = [Math.round(maxOverlapOf(set) * 20) / 20, -set.reduce((s, c) => s + (c.score || 0), 0)];
    if (!bestKey || key[0] < bestKey[0] || (key[0] === bestKey[0] && key[1] < bestKey[1])) {
      bestKey = key;
      bestSet = set;
    }
  }
  return bestSet || [];
}
