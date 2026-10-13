/**
 * 方案择优（6.8.0）—— 给每部候选电影打分，前端只显示最好的那一部。
 *
 * **打分标准必须与生成实现「语义独立」。**
 *
 * 6.7.6 的元发现：探针与实现共用同一套粗糙正则时，探针永远无法证伪自身
 * （「炮塔」命中「炮」，两边都认为有武器语义）。本模块因此**不重新跑任何选择逻辑**，
 * 只对**已经编译出来的 plan** 做测量 —— 每一条都读产物，不复用生成器的判断：
 *
 *   · 时代自洽   —— 逐镜看灯光/机位/调色的 series 与 intent.era 是否相容
 *   · 光质自洽   —— 主灯光的 `sky` 与调色的 `sky` 是否冲突（6.7.5 修过的那类）
 *   · 物理自洽   —— 地面载具不得开进纯海环境（与 planner 的 vehicleFitsEnv 同标准，
 *                   但这里是对**产物**复核，不是生成时过滤）
 *   · 戏剧覆盖   —— 用了多少种戏剧功能、相邻功能是否真的互异
 *   · 对白密度   —— 有人话的镜头占比（25% 曾是「静默」舞台提示冒充台词）
 *   · 骨架多样   —— 一部片内部不同句子骨架的比例（跨片 34.6% 重复的片内版本）
 *   · 切题度     —— 用户描述里的实词，有多少真的出现在成片正文里
 *
 * 权重按「错了有多刺眼」排：物理与时代矛盾 > 自洽 > 覆盖 > 密度 > 多样 > 切题。
 */

import { isEraCompatible } from './shot-spec.js';
import { themeTokens } from './environment-pick.js';

/** 主题里的功能词（不参与切题度统计） */
const FILLER = new Set([
  '一支', '一名', '一个', '一群', '一队', '两台', '两名', '两人', '几个',
  '敌军', '敌方', '敌人', '我方', '我军', '进行', '执行', '时候'
]);

/** 主题实词：长度 ≥2 的二元词，剥掉功能词 */
export function themeContentWords(theme) {
  const t = String(theme || '');
  const out = new Set();
  for (const seg of (t.match(/[\u4e00-\u9fa5]+/g) || [])) {
    for (let i = 0; i + 2 <= seg.length; i++) {
      const w = seg.slice(i, i + 2);
      if (!FILLER.has(w)) out.add(w);
    }
  }
  return [...out];
}

/** 场景是否纯海（与 planner.vehicleFitsEnv 同标准，这里用于复核产物） */
function isSeaEnv(env) {
  if (!env) return false;
  const n = `${env.name || ''} ${env.nameZh || ''}`.toLowerCase();
  return /ocean|sea|深海|海域|海面|航母|ocean|carrier|underwater|submarine/i.test(n);
}

/**
 * 从名册里取出「正文里可能出现的人名」。
 *
 * 正文里角色写作 `【代号】人名`（`aliasLabel` 的产物），人名取 `persona || name || nameZh`。
 * 骨架归一必须先知道这份名单，理由见 `skeletonOf`。
 *
 * @param {Array|object|null} roster `plan.roster`（rosterToJSON 的产物）
 * @returns {string[]} 长度 ≥2 的人名，去重
 */
export function rosterNames(roster) {
  const list = Array.isArray(roster) ? roster : (Array.isArray(roster?.all) ? roster.all : []);
  const out = new Set();
  for (const e of list) {
    for (const n of [e?.persona, e?.name, e?.nameZh]) {
      const s = String(n || '').trim();
      if (s.length >= 2) out.add(s);
    }
  }
  return [...out];
}

/**
 * 句子骨架化：用于骨架多样性与跨方案去重。
 *
 * **`【代号】人名` 必须整段归一成一个 `P`。** 6.8.0 实测：不归一的话，
 * 「【PHANTOM】邓肯把照片塞回胸袋」与「【OBSIDIAN】哈里森把照片塞回胸袋」
 * 是两个不同骨架 —— 于是**只换了人名**的两部片被算成「完全不同」，
 * 重合率 0% 这个数字是假的。骨架要衡量的是**发生了什么**，不是**谁**。
 *
 * **6.8.1 修正：人名不能靠正则猜长度。** 原先写 `【[^】]*】[\u4e00-\u9fa5]{2,4}`，
 * 贪心的 `{2,4}` 会按「后面还有多少汉字」吃掉 4 个字：
 *   · `【TANGO】米勒从胸袋里…`  → 吃掉「米勒从胸」→ `P袋里摸出…`
 *   · `【LANTERN】伊万诺夫从胸袋里…` → 只能吃 4 字「伊万诺夫」→ `P从胸袋里摸出…`
 *   · `【OVERSEER】施密特从胸袋里…` → 吃掉「施密特从」→ `P胸袋里摸出…`
 * **同一个节拍、只换了人名，被算成三个不同骨架**，重复率因此被系统性低估。
 * 度量不准比没有度量更危险，所以改成「先按名册人名整段替换，再兜底」。
 *
 * @param {string} action 正文句子
 * @param {string[]} [names] `rosterNames(plan.roster)`；缺省时退化为正则猜测（仅供无名册的调用方）
 */
export function skeletonOf(action, names = []) {
  let s = String(action || '');
  // 长名优先，避免「伊万诺夫」被更短的「伊万」抢先切掉
  for (const n of [...names].sort((a, b) => b.length - a.length)) {
    if (n && s.includes(n)) s = s.split(n).join('N');
  }
  return s
    .replace(/「[^」]*」/g, 'Q')
    .replace(/【[^】]*】[\u4e00-\u9fa5]{2,4}/g, 'P')
    .replace(/（[A-Z][A-Z0-9-]*）/g, 'X')
    .replace(/【[^】]*】/g, '')
    .replace(/[0-9０-９]+/g, 'N')
    .replace(/[，。、；：！？·\s「」（）()\[\]]/g, '');
}

/**
 * 给一个已编译的 plan 打分。
 * @returns {{ total: number, parts: object }}
 */
export function scoreCandidate(plan, r) {
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  const n = shots.length;
  if (n === 0) return { total: -Infinity, parts: { empty: 1 } };

  const intent = plan.intent || {};
  const byId = id => (r?.byId ? r.byId.get(id) : null);
  const env = byId(plan.shots?.[0]?.environment);

  // ── 1. 时代自洽：灯光 / 机位 / 调色必须与时代相容 ──────────────────
  let eraBad = 0;
  for (const s of shots) {
    for (const id of [s.camera, s.lighting, s.colorGrade]) {
      const a = byId(id);
      if (a && !isEraCompatible(a.series, intent.era)) eraBad++;
    }
  }

  // ── 2. 光质自洽：主灯光 sky 与调色 sky 不得冲突 ────────────────────
  let skyConflict = 0;
  const skyOf = a => (Array.isArray(a?.sky) ? (a.sky.find(x => x !== 'any') || 'any') : 'any');
  {
    const lit = byId(shots[0].lighting);
    const cg = byId(shots[0].colorGrade);
    const ls = skyOf(lit), cs = skyOf(cg);
    if (ls !== 'any' && cs !== 'any' && ls !== cs) skyConflict++;
  }

  // ── 3. 物理自洽：地面载具不得开进纯海环境 ─────────────────────────
  let physicsBad = 0;
  if (isSeaEnv(env)) {
    for (const vid of plan.cast?.vehicles || []) {
      const v = byId(vid);
      if (v && v.class === 'ground') physicsBad++;
    }
  }

  // ── 4. 戏剧覆盖 ──────────────────────────────────────────────────
  const fns = shots.map(s => s.fn).filter(Boolean);
  const coverage = new Set(fns).size / Math.max(1, n);
  let adjacentDup = 0;
  for (let i = 1; i < fns.length; i++) if (fns[i] === fns[i - 1]) adjacentDup++;

  // ── 5. 对白密度：有人话的镜头占比 ────────────────────────────────
  const spoken = shots.filter(s => {
    const t = String(s.radioVoice || '').replace(/【[^】]*】/g, '').replace(/[（(][^）)]*[）)]/g, '');
    return t.replace(/[\s。，、！？：:「」]/g, '').length > 0;
  }).length;
  const dialogueRatio = spoken / n;
  // 理想区间 0.35–0.8：没有对白是哑剧，满嘴对白是广播剧。区间外按距离扣分。
  const dialogueFit = dialogueRatio < 0.35 ? dialogueRatio / 0.35 : (dialogueRatio > 0.8 ? Math.max(0, (1 - dialogueRatio) / 0.2) : 1);

  // ── 6. 骨架多样（片内）───────────────────────────────────────────
  // 必须带名册人名：否则「只换了人名」的重复句会被算成不同骨架（见 skeletonOf）
  const skelNames = rosterNames(plan.roster);
  const skels = shots.map(s => skeletonOf(s.action, skelNames));
  const diversity = new Set(skels).size / n;

  // ── 7. 切题度：主题实词有多少出现在成片正文里 ───────────────────
  const words = themeContentWords(plan.intent?.theme || plan.story?.premise ? (plan.intent?.theme || '') : '');
  const body = shots.map(s => String(s.action || '')).join(' ');
  const hitWords = words.filter(w => body.includes(w));
  const topicality = words.length ? hitWords.length / words.length : 0.5;

  // ── 加权汇总 ───────────────────────────────────────────────────
  const parts = {
    era: 1 - Math.min(1, eraBad / Math.max(1, n * 3)),
    sky: 1 - skyConflict,
    physics: 1 - Math.min(1, physicsBad / 3),
    coverage,
    adjacent: adjacentDup === 0 ? 1 : Math.max(0, 1 - adjacentDup / n),
    dialogue: dialogueFit,
    diversity,
    topicality
  };
  const W = {
    era: 22, sky: 18, physics: 16, coverage: 14, adjacent: 8,
    dialogue: 8, diversity: 8, topicality: 6
  };
  const total = Object.keys(W).reduce((s, k) => s + parts[k] * W[k], 0);
  return { total: Math.round(total * 100) / 100, parts, meta: { eraBad, skyConflict, physicsBad, adjacentDup, dialogueRatio, diversity, topicality, n } };
}

/**
 * 跨方案去重加罚。
 *
 * 四个方案里出现三个近乎相同的电影，比只有一个方案更糟 —— 用户会以为
 * 「多方案」是假的。判据：与某个更高分的方案相比，
 * **骨架重合率 > 60% 或环境与原型都相同且骨架重合 > 40%**，按重合率折减分数。
 */
export function diversify(candidates) {
  // 原始分：扣分只在原始分上算一次。
  // 早期直接改 `score`，重复调用会把惩罚**叠加**（第二次再砍 40%），
  // 于是「同一批候选，换个调用顺序分数就不同」——同一个候选集必须给出同一个答案。
  const baseOf = c => {
    const b = c?.detail?.baseScore;
    return Number.isFinite(b) ? b : (Number.isFinite(c?.score) ? c.score : 0);
  };
  const ordered = [...candidates].sort((a, b) => (baseOf(b) - baseOf(a)) || (a.index - b.index));
  // `film` 是 planFilm 的返回值（{ intent, plan, … }），镜头与故事原型都在 `plan` 里。
  // 早期写成 `c.film.shots` 恒为 undefined，整个去重加罚被静默跳过 ——
  // 「4 个方案里 3 个是同一部片」因此一次都没被抓到过。
  // 骨架必须带名册人名：不带的话「只换了角色」会被算成不同骨架（见 skeletonOf）。
  const skelOf = c => {
    const names = rosterNames(c?.film?.plan?.roster);
    return (c?.film?.plan?.shots || []).map(s => skeletonOf(s.action, names));
  };
  const keyOf = c => `${c?.film?.plan?.shots?.[0]?.environment || ''}|${c?.film?.plan?.story?.arc || c?.film?.story?.arc || ''}`;

  for (let i = 1; i < ordered.length; i++) {
    const cur = ordered[i];
    if (!cur.film) continue;
    const curS = skelOf(cur);
    for (let j = 0; j < i; j++) {
      const prev = ordered[j];
      if (!prev.film) continue;
      const prevS = skelOf(prev);
      if (!curS.length || !prevS.length) continue;
      const set = new Set(prevS);
      const overlap = curS.filter(s => set.has(s)).length / curS.length;
      const sameKey = keyOf(cur) === keyOf(prev);
      const dupRatio = sameKey ? overlap * 1.25 : overlap;
      if (dupRatio > 0.4) {
        // 按重合率线性折减，最多砍掉 40% 的分数
        const penalty = Math.min(0.4, (dupRatio - 0.4) * 1.6);
        cur.detail = cur.detail || {};
        cur.detail.baseScore = baseOf(cur);
        cur.score = Math.round(cur.detail.baseScore * (1 - penalty) * 100) / 100;
        cur.detail.diversityPenalty = Math.round(penalty * 100) / 100;
        break;
      }
    }
  }
  // 扣分之后**必须重排**：否则排在最前面的可能正是那个被判为「换皮」的方案，
  // 前端会把它当作「最优方案」展示 —— 择优器于是把重复品推到了台前。
  return [...ordered].sort((a, b) => (b.score - a.score) || (a.index - b.index));
}
