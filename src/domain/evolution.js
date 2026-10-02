/**
 * LEGO War Universe - 自我进化学习引擎 (Self-Evolution Engine)
 *
 * 目标：让项目「越用越聪明」。每一次生成都会留下学习痕迹：
 *
 *  1. 资产使用统计 —— 哪些资产被反复选用，哪些长期无人问津。
 *  2. 记忆增强排序 —— 高分资产在本地规划与锻造时被优先考虑，
 *     使影片的「词汇表」随使用自然演化，而不是永远用同一批默认件。
 *  3. 晋升机制 —— 在多个不同题材中被反复复用的资产会被「晋升」为
 *     项目记忆里的主力资产，并打上标记。
 *  4. 遗忘衰减 —— 长期未使用的资产分数按半衰期衰减，避免陈旧偏好固化。
 *  5. 缺口锻造 —— 题材需要而资产库缺失的现代 / 未来战争装备，由
 *     asset-forge 现场生成并纳入记忆，下一次生成即可直接引用。
 *
 * 引擎是纯函数式的（除 localStorage 读写外无副作用），可完整单测。
 */

import { forgeAssets } from './asset-forge.js';
import { collectValidIds } from './asset-catalog.js';
import { enforceContinuityChain } from './continuity.js';

export const LEDGER_VERSION = 1;
export const LEDGER_STORAGE_KEY = 'lwu_evolution_ledger_v1';

/** 资产前缀 → 注册表 kind，用于把锻造资产并入运行时注册表与镜头主体 */
export const KIND_BY_PREFIX = {
  CHR: 'character', VEH: 'vehicle', AIR: 'vehicle', SHP: 'vehicle', WPN: 'weapon',
  ENV: 'environment', CAM: 'camera', LGT: 'lighting', CLR: 'colorGrade',
  PRP: 'prop', FX: 'fx', AUD: 'audio'
};

export function kindFromId(id) {
  return KIND_BY_PREFIX[String(id || '').split('-')[0]] || null;
}

/* ── 基础工具 ─────────────────────────────────────────────────────────── */

const nowIso = (now) => new Date(now ?? Date.now()).toISOString();
const DAY_MS = 24 * 60 * 60 * 1000;

export function createLedger(seed = {}) {
  return {
    version: LEDGER_VERSION,
    createdAt: seed.createdAt || nowIso(),
    updatedAt: seed.updatedAt || nowIso(),
    generations: seed.generations || 0,
    usage: seed.usage || {},
    forged: seed.forged || [],
    promoted: seed.promoted || [],
    history: seed.history || []
  };
}

/** 容错归一化：任何脏数据都不能让引擎崩溃 */
export function normalizeLedger(raw) {
  const base = createLedger();
  if (!raw || typeof raw !== 'object') return base;
  const usage = {};
  for (const [id, rec] of Object.entries(raw.usage || {})) {
    if (!/^[A-Z]{2,5}-[0-9]{3}$/.test(id) || !rec || typeof rec !== 'object') continue;
    usage[id] = {
      count: Number(rec.count) || 0,
      score: Number(rec.score) || 0,
      themes: Array.isArray(rec.themes) ? rec.themes.slice(0, 40) : [],
      lastUsed: rec.lastUsed || null
    };
  }
  return createLedger({
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    generations: Number(raw.generations) || 0,
    usage,
    forged: Array.isArray(raw.forged) ? raw.forged.filter(a => a && a.id) : [],
    promoted: Array.isArray(raw.promoted) ? raw.promoted.filter(id => usage[id]) : [],
    history: Array.isArray(raw.history) ? raw.history.slice(0, 200) : []
  });
}

/* ── 持久化 ───────────────────────────────────────────────────────────── */

export function loadLedger(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(LEDGER_STORAGE_KEY);
    return normalizeLedger(raw ? JSON.parse(raw) : null);
  } catch {
    return createLedger();
  }
}

export function saveLedger(ledger, storage = globalThis.localStorage) {
  try {
    storage?.setItem(LEDGER_STORAGE_KEY, JSON.stringify(ledger));
    return true;
  } catch {
    return false;
  }
}

export function exportLedger(ledger) {
  return JSON.stringify(normalizeLedger(ledger), null, 2);
}

/* ── 学习：记录一次生成 ───────────────────────────────────────────────── */

function bump(usage, id, theme, weight) {
  const rec = usage[id] || { count: 0, score: 0, themes: [], lastUsed: null };
  rec.count += 1;
  rec.score += weight;
  if (theme && !rec.themes.includes(theme)) rec.themes = [...rec.themes, theme].slice(-40);
  rec.lastUsed = nowIso();
  usage[id] = rec;
}

/**
 * 记录一次生成，并返回更新后的 ledger（原地修改并返回同一对象）
 * @param {object} ledger
 * @param {{ theme?: string, engine?: string, shots?: Array<object>, forgedAssets?: Array<object>, now?: number }} event
 */
export function recordGeneration(ledger, { theme = '', engine = '', shots = [], forgedAssets = [], now } = {}) {
  const l = normalizeLedger(ledger);
  l.generations += 1;
  l.updatedAt = nowIso(now);

  const seen = new Set();
  for (const shot of shots || []) {
    const ids = [
      ...(shot.subjects || []),
      shot.environment, shot.camera, shot.lighting, shot.colorGrade,
      ...(shot.fx || []), ...(shot.audio || [])
    ].filter(Boolean);
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      bump(l.usage, id, theme, 1);
    }
  }

  if (forgedAssets?.length) {
    const existing = new Set(l.forged.map(a => a.id));
    for (const asset of forgedAssets) {
      if (!asset?.id || existing.has(asset.id)) continue;
      existing.add(asset.id);
      l.forged.push(asset);
      bump(l.usage, asset.id, theme, 2); // 新锻造的资产给予一次额外权重，帮助其获得曝光
    }
  }

  l.history.unshift({
    at: nowIso(now),
    theme: String(theme).slice(0, 120),
    engine,
    shotCount: (shots || []).length,
    forged: (forgedAssets || []).map(a => a.id)
  });
  l.history = l.history.slice(0, 200);

  return l;
}

/* ── 遗忘衰减 ─────────────────────────────────────────────────────────── */

/**
 * 按半衰期衰减所有资产的分数。只影响排序权重，不删除使用记录。
 * @param {object} ledger
 * @param {{ now?: number, halfLifeDays?: number }} options
 */
export function decayScores(ledger, { now, halfLifeDays = 30 } = {}) {
  const l = normalizeLedger(ledger);
  const t = now ?? Date.now();
  for (const [id, rec] of Object.entries(l.usage)) {
    if (!rec.lastUsed) continue;
    const elapsedDays = (t - new Date(rec.lastUsed).getTime()) / DAY_MS;
    if (elapsedDays <= 0) continue;
    const factor = Math.pow(0.5, elapsedDays / halfLifeDays);
    rec.score = Number((rec.score * factor).toFixed(4));
    // 分数过低时保留一个最小记忆痕迹，避免完全遗忘导致推荐退化
    if (rec.score < 0.01) rec.score = 0.01;
    l.usage[id] = rec;
  }
  l.updatedAt = nowIso(t);
  return l;
}

/* ── 排序与晋升 ───────────────────────────────────────────────────────── */

export function scoreOf(ledger, id) {
  return Number(ledger?.usage?.[id]?.score) || 0;
}

/**
 * 用进化记忆给资产重排序：分数高的排前面，同分时保持原始顺序（稳定排序）。
 */
export function rankAssets(ledger, assets = []) {
  return [...assets]
    .map((asset, index) => ({ asset, index, score: scoreOf(ledger, asset.id) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(x => x.asset);
}

/**
 * 计算应被晋升的资产：在多个不同题材中被反复复用。
 */
export function computePromotions(ledger, { minUses = 3, minThemes = 2 } = {}) {
  const l = normalizeLedger(ledger);
  const result = [];
  for (const [id, rec] of Object.entries(l.usage)) {
    if (rec.count >= minUses && rec.themes.length >= minThemes) result.push(id);
  }
  return result;
}

/** 更新晋升名单，返回新晋的资产 ID */
export function refreshPromotions(ledger, options) {
  const l = normalizeLedger(ledger);
  const next = computePromotions(l, options);
  const previous = new Set(l.promoted);
  const newlyPromoted = next.filter(id => !previous.has(id));
  l.promoted = next;
  return { ledger: l, newlyPromoted };
}

/* ── 缺口锻造 ─────────────────────────────────────────────────────────── */

const MODERN_ERA_HINTS = /现代|高科技|未来|科幻|无人机|巡飞|外骨骼|激光|电磁|高超|太空|轨道|网络|智能|机器人|蜂群|隐身|现代战争|modern|future|drone|laser|emp|hypersonic|space|cyber/i;

/**
 * 判断题材是否需要现代 / 未来战争装备，从而触发锻造。
 */
export function needsForge({ theme = '', era = null } = {}) {
  if (era === 'Modern High-Tech' || era === 'Orbital') return true;
  return MODERN_ERA_HINTS.test(String(theme));
}

/**
 * 根据题材与已有资产库锻造缺口资产
 * @param {{ theme?: string, era?: string, registryData?: object, count?: number, seed?: number|string, extraExistingIds?: Iterable<string> }} options
 */
export function forgeGapAssets({ theme = '', era = null, registryData = {}, count = 6, seed, extraExistingIds = [] } = {}) {
  if (!needsForge({ theme, era })) return [];
  const existingIds = collectValidIds(registryData);
  // 必须把「历史上已锻造出的资产 ID」一并排除，否则不同题材会分配出相同 ID，
  // 导致后锻造的资产在并入 ledger 时被当作重复项静默丢弃。
  for (const id of extraExistingIds) existingIds.add(id);
  return forgeAssets({ theme, era, existingIds: [...existingIds], count, seed });
}

/* ── 编排：一次完整的进化 ─────────────────────────────────────────────── */

/**
 * 生成后的完整进化流程：衰减 → 锻造缺口 → 记录 → 晋升。
 * @returns {{ ledger: object, forgedAssets: Array<object>, newlyPromoted: string[], stats: object }}
 */
export function evolve({
  ledger,
  theme = '',
  engine = '',
  era = null,
  shots = [],
  registryData = {},
  forgeCount = 6,
  now,
  seed,
  halfLifeDays = 30
} = {}) {
  let l = normalizeLedger(ledger);
  l = decayScores(l, { now, halfLifeDays });

  const forgedAssets = forgeGapAssets({
    theme, era, registryData, count: forgeCount, seed,
    extraExistingIds: l.forged.map(a => a.id)
  });
  l = recordGeneration(l, { theme, engine, shots, forgedAssets, now });

  // 记忆有上限：锻造资产只保留最近 120 件，避免 localStorage 无限膨胀
  if (l.forged.length > 120) l.forged = l.forged.slice(-120);

  const { ledger: promotedLedger, newlyPromoted } = refreshPromotions(l);

  return { ledger: promotedLedger, forgedAssets, newlyPromoted, stats: ledgerStats(promotedLedger) };
}

/* ── 统计（供 UI 展示） ───────────────────────────────────────────────── */

export function ledgerStats(ledger) {
  const l = normalizeLedger(ledger);
  const entries = Object.entries(l.usage);
  const totalUses = entries.reduce((sum, [, rec]) => sum + rec.count, 0);
  const top = entries
    .sort((a, b) => b[1].score - a[1].score)
    .slice(0, 8)
    .map(([id, rec]) => ({ id, count: rec.count, score: Number(rec.score.toFixed(2)), themes: rec.themes.length }));
  const distinctThemes = new Set(l.history.map(h => h.theme).filter(Boolean)).size;

  return {
    generations: l.generations,
    distinctThemes,
    trackedAssets: entries.length,
    totalUses,
    forgedCount: l.forged.length,
    promotedCount: l.promoted.length,
    top,
    lastUpdated: l.updatedAt
  };
}

/**
 * 把记忆里锻造出的资产并入运行时注册表（与自定义资产同构），使其可被检索、校验、编译。
 * @returns {{ added: number, skipped: string[] }}
 */
export function applyForgedAssets(registry, forgedAssets = []) {
  const skipped = [];
  let added = 0;
  for (const raw of forgedAssets) {
    const kind = kindFromId(raw?.id);
    if (!kind) { skipped.push(raw?.id); continue; }
    if (registry.byId.has(raw.id)) { skipped.push(raw.id); continue; }
    const asset = { ...raw, kind, series: raw.series || 'shared', forged: true };
    registry.byId.set(asset.id, asset);
    if (!registry.byKind.has(kind)) registry.byKind.set(kind, []);
    registry.byKind.get(kind).push(asset);
    added++;
  }
  return { added, skipped };
}

/**
 * 让刚锻造出的新资产真正「上镜」：为决战镜头注入一个进化出来的主体，
 * 若该镜头没有特效则再补一个进化特效。这样自我进化不是空转的统计，
 * 而是能立刻体现在成片分镜里。
 *
 * 注入后重新跑一遍连续性链条，保证 180° 轴线与战损单调性依然成立。
 *
 * @param {Array<object>} shots
 * @param {Array<object>} forgedAssets
 * @param {object} registry 运行时注册表（含 byId，用于校验资产真实存在）
 * @param {{ maxSubjectSwaps?: number, maxFxAdds?: number }} options
 * @returns {{ shots: Array<object>, applied: Array<{shotId: string, assetId: string, role: string}> }}
 */
export function enrichShotsWithForged(shots = [], forgedAssets = [], registry = null, {
  maxSubjectSwaps = 2,
  maxFxAdds = 1
} = {}) {
  const applied = [];
  if (!forgedAssets.length || !shots.length) return { shots, applied };

  // 锻造资产本身不带 kind（由 ID 前缀决定），这里统一补齐后再按角色/载具/特效分流
  const withKind = forgedAssets.map(a => ({ ...a, kind: a.kind || kindFromId(a.id) }));
  const isUsable = a => a && (!registry || registry.byId.has(a.id));
  const subjects = withKind.filter(a => isUsable(a) && ['character', 'vehicle'].includes(a.kind));
  const fx = withKind.filter(a => isUsable(a) && a.kind === 'fx');

  const next = shots.map(s => ({ ...s, subjects: [...(s.subjects || [])], fx: [...(s.fx || [])] }));
  let subjLeft = maxSubjectSwaps;
  let fxLeft = maxFxAdds;
  let si = 0;
  let fi = 0;

  // 优先让决战镜头用上进化主体
  const order = [...next.keys()].sort((a, b) => {
    const rank = s => (s.phase === 'climax' ? 0 : s.phase === 'build' ? 1 : 2);
    return rank(next[a]) - rank(next[b]) || a - b;
  });

  for (const idx of order) {
    if (subjLeft <= 0 && fxLeft <= 0) break;
    const shot = next[idx];
    if (subjLeft > 0 && subjects[si]) {
      const candidate = subjects[si++];
      if (!shot.subjects.includes(candidate.id)) {
        shot.subjects = [...shot.subjects, candidate.id].slice(-3);
        applied.push({ shotId: shot.shotId, assetId: candidate.id, role: 'subject' });
        subjLeft--;
      }
    }
    if (fxLeft > 0 && fx[fi] && shot.fx.length < 3) {
      const candidate = fx[fi++];
      if (!shot.fx.includes(candidate.id)) {
        shot.fx = [...shot.fx, candidate.id];
        applied.push({ shotId: shot.shotId, assetId: candidate.id, role: 'fx' });
        fxLeft--;
      }
    }
  }

  return { shots: enforceContinuityChain(next), applied };
}
