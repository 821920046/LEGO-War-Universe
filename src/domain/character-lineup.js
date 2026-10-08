/**
 * LEGO War Universe - 全片全阵营角色定妆表引擎 v5.0 (Character Lineup Engine)
 * 功能：
 * 1. 取本片实际出场的正反两大阵营角色名册（每人一个唯一代号）
 * 2. 编译【正反派双排站位 + 代号名牌标签】的全员合影生图 Prompt
 * 3. 锁死全片角色的服装、头盔、装备配色，杜绝视频中途换脸穿帮
 *
 * ── v5.0 的重大变化：不再自带一套写死的虚构角色模板 ──
 *
 * v4.x 在 FACTION_TEMPLATES 里手写了 Modern / Modern High-Tech / WWII / Orbital
 * 四套「幽灵队长 / 猎鹰狙击手」阵容，并给每人编号 CHR-C01 / CHR-O01。于是同一部片子
 * 里并存两套角色口径：
 *   · 剧本正文与真实名册走 roster.js —— 真实资产 + persona 人名（「邓肯」）；
 *   · 定妆表与全家福 Prompt 走 FACTION_TEMPLATES —— 虚构角色 + 单位类型当人名
 *     （「弹道导弹核潜艇艇长」）。
 * 后果有两层：定妆表可能展示一支**既不在资产库里、也不在本片里**的队伍；即便走真实
 * 名册，全家福 Prompt 也会把「潜艇艇长」当成一个人的名字，让模型画出一个没有面孔的角色。
 *
 * v5.0 起本模块只做一件事：**把 roster.js 的选角结果适配成定妆表 / 全家福需要的形状**。
 *   · 有分镜 → 聚合本片实际出场的真实资产（与剧本正文同源，同一个人同一个代号）；
 *   · 无分镜 → 用 selectCast 按题材从资产库预选一支队伍。
 * 两条路径都出自同一个选角引擎，因此永远不会出现「预览是幽灵队长、生成后变成邓肯」。
 */

import { assets as embeddedAssets, profiles as embeddedProfiles } from './assets-data.js';
import { createRegistry } from './registry.js';
import { buildRoster, selectCast, displayNameOf, nationLabelOf } from './roster.js';

/** 内嵌注册表缓存（与页面启动用的是同一份数据），仅在调用方没传 registry 时兜底 */
let embeddedRegistryCache = null;

function embeddedRegistry() {
  if (embeddedRegistryCache) return embeddedRegistryCache;
  try {
    embeddedRegistryCache = createRegistry(embeddedAssets, embeddedProfiles, { references: [] });
  } catch (err) {
    // 内嵌数据损坏属于构建期问题，这里必须安全降级而不是拖崩定妆表
    console.warn('定妆表：内嵌注册表构建失败，将返回空名册', err);
    embeddedRegistryCache = null;
  }
  return embeddedRegistryCache;
}

/** 只有真正可用的注册表才接受；否则退回内嵌注册表 */
function resolveRegistry(registry) {
  return (registry && registry.byId && registry.byKind) ? registry : embeddedRegistry();
}

/**
 * 从本片实际出场的资产反推时代。
 *
 * 旧实现靠硬编码 ID 前缀猜测（`CHR-1xx` → WWII、`CHR-7xx` → Orbital、`CHR-63x` →
 * Modern High-Tech）。这套前缀在 6.5 / 6.6 两轮扩容后已大面积失配（例如 CHR-63x
 * 区间根本不存在），绝大多数情况下一个都命中不了，等于没有推断。
 * 现在直接读资产的 `series` 字段取众数 —— 数据里写着什么就以什么为准，不再猜 ID。
 *
 * @returns {string|null} 出现次数最多的 series；无法判定返回 null
 */
function inferEraFromShots(shots, registry) {
  const counts = new Map();
  for (const s of (Array.isArray(shots) ? shots : [])) {
    for (const id of (s?.subjects || [])) {
      const series = registry?.byId?.get(id)?.series;
      if (!series || series === 'shared') continue;
      counts.set(series, (counts.get(series) || 0) + 1);
    }
  }
  let best = null;
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n > bestN) { best = key; bestN = n; }
  }
  return best;
}

/**
 * 取本片的正反双阵营角色名册。
 *
 * 返回的每一项都是注册表里**真实存在**的资产（含 id / callsign / persona / nation /
 * outfit / kind），形状与 roster.js 的 buildRoster 产物完全一致，不再有 CHR-C01 这类
 * 只存在于模板里的虚构 ID。
 *
 * @param {Array} shots 分镜脚本数组（可为空）
 * @param {object|null} registry 资产注册表；缺省时使用内嵌注册表
 * @param {string} era 影片时代标签
 * @param {string} theme 影片主题文本
 * @returns {{ coalition: Array, opposing: Array, neutral: Array, all: Array, byId: Map, isPreview: boolean }}
 */
export function extractCharacterLineup(shots = [], registry = null, era = 'Modern', theme = '') {
  const empty = { coalition: [], opposing: [], neutral: [], all: [], byId: new Map(), isPreview: false };

  const reg = resolveRegistry(registry);
  if (!reg) return empty;

  const list = Array.isArray(shots) ? shots : [];

  // 路径一：本片已有分镜 —— 聚合实际出场角色。与剧本正文同源，同一个人同一个代号。
  let roster = buildRoster(list, reg);
  let isPreview = false;

  // 路径二：没有分镜，或分镜里只有环境 / 特效 —— 按题材从资产库预选一支队伍。
  // 预选同样走 selectCast → buildRoster，所以形状与真实名册一致，不会「预览一套、生成另一套」。
  if (roster.all.length === 0) {
    const inferred = (era && era !== 'Modern') ? era : (inferEraFromShots(list, reg) || era || 'Modern');
    let cast = null;
    try {
      cast = selectCast(reg, { era: inferred, theme, task: 'combat' });
    } catch (err) {
      console.warn('定妆表：按题材预选角色失败，返回空名册', err);
    }
    const ids = cast
      ? [...cast.heroes, ...cast.enemies, ...cast.vehicles].map(a => a?.id).filter(Boolean)
      : [];
    if (ids.length) {
      roster = buildRoster([{ subjects: ids }], reg);
      isPreview = true;
    }
  }

  return {
    coalition: roster.coalition,
    opposing: roster.opposing,
    neutral: roster.neutral,
    all: roster.all,
    byId: roster.byId,
    isPreview
  };
}

/**
 * 生成【正反派双排站位 + 代号名牌标签】的全员合影定妆照生图 Prompt
 * 极致兼容性设计：支持传入 { coalition, opposing } 阵营对象，也兼容传入纯数组 characters
 *
 * @param {object|Array} factions 双阵营角色数据或角色数组
 * @param {string} filmTheme 影片主题
 * @param {string} era 时代
 * @param {string} aspectRatio 画幅比例
 * @returns {object} 包含 promptEn, promptZh, characterCount, factions, aspectRatio
 */
export function generateLineupPrompt(factions = { coalition: [], opposing: [] }, filmTheme = '', era = 'Modern', aspectRatio = '9:16') {
  let normalizedFactions = { coalition: [], opposing: [] };

  // 兼容模式 1：如果传入的是纯平铺数组
  if (Array.isArray(factions)) {
    const half = Math.ceil(factions.length / 2);
    normalizedFactions.coalition = factions.slice(0, half).map((c, i) => ({
      ...c,
      callsign: c.callsign || `ALPHA-${i + 1}`,
      faction: 'coalition'
    }));
    normalizedFactions.opposing = factions.slice(half).map((c, i) => ({
      ...c,
      callsign: c.callsign || `ENEMY-${i + 1}`,
      faction: 'opposing'
    }));
  } else if (factions && typeof factions === 'object') {
    normalizedFactions.coalition = Array.isArray(factions.coalition) ? factions.coalition : [];
    normalizedFactions.opposing = Array.isArray(factions.opposing) ? factions.opposing : [];
  }

  // 全家福 = 人仔合影，载具绝不能混进来。
  // 早期把真实名册直接喂进来时，载具被当成「distinct LEGO minifigures」计数，
  // 生成出来的 Prompt 会要求模型画一架人仔大小的直升机，全家福直接废掉。
  const onlyMinifigures = list => list.filter(c => c && c.kind !== 'vehicle');
  const clean = () => {
    normalizedFactions.coalition = onlyMinifigures(normalizedFactions.coalition);
    normalizedFactions.opposing = onlyMinifigures(normalizedFactions.opposing);
  };
  clean();

  // 兜底补齐：若完全为空，按题材从资产库预选（同样出自 roster.js，不是虚构模板）
  if (normalizedFactions.coalition.length === 0 && normalizedFactions.opposing.length === 0) {
    normalizedFactions = extractCharacterLineup([], null, era, filmTheme);
    clean();
  }

  const allChars = [...normalizedFactions.coalition, ...normalizedFactions.opposing];
  const totalCount = allChars.length;
  const coalitionCount = normalizedFactions.coalition.length;
  const opposingCount = normalizedFactions.opposing.length;

  // 角色描述统一走 displayNameOf：有 persona 就用人物姓名。
  // 这里曾经直接用 `c.name`，于是 Prompt 写着 "弹道导弹核潜艇艇长" —— 模型会照着
  // 画一个「职位」，而不是一张脸。全家福要的是人。
  const describe = (c, idx) => {
    const nation = nationLabelOf(c);
    return {
      position: idx + 1,
      person: displayNameOf(c),
      callsign: c.callsign || 'AGENT',
      role: [c.role, c.series, nation].filter(Boolean).join(' / '),
      outfit: c.outfit || '标准作战配置'
    };
  };

  const coalitionRows = normalizedFactions.coalition.map(describe);
  const opposingRows = normalizedFactions.opposing.map(describe);

  const rowDesc = (rows, rowName) => rows.map(r =>
    `${rowName} Position ${r.position}: "${r.person}" (callsign [${r.callsign}], ${r.role}), wearing ${r.outfit}. A small white printed nameplate label at their feet reads "[${r.callsign}]".`
  ).join(' ');

  const coalitionDesc = rowDesc(coalitionRows, 'Front Row');
  const opposingDesc = rowDesc(opposingRows, 'Back Row');

  // 纯英文高保真 Prompt (适用于 Midjourney v6 / FLUX.1 / DALL-E 3)
  const promptEn = [
    `A studio character lineup portrait of ${totalCount} distinct LEGO minifigures arranged in two clear rows facing forward towards the camera, full body shot on a LEGO collector display stand.`,
    `FRONT ROW (${coalitionCount} protagonist coalition forces, standing shoulder to shoulder): ${coalitionDesc}`,
    `BACK ROW (${opposingCount} antagonist opposing forces, standing slightly elevated behind the front row): ${opposingDesc}`,
    `Each minifigure has a small white printed nameplate label on the display stand at their feet showing their callsign code in bold black text.`,
    `The two rows are visually separated: front row protagonists on a dark blue base section, back row antagonists on a dark red base section.`,
    `Studio lighting, clean solid neutral grey background, crisp soft shadows beneath their plastic feet, 35mm tilt-shift macro lens photography, sharp focus, authentic ABS plastic glossy injection texture, micro plastic mold seams and studs visible, high-end toy photography, masterpiece, photorealistic, 8k, --ar ${aspectRatio}`
  ].join(' ');

  // 中文对照说明
  const promptZh = [
    `【全片角色定妆全家福参考图 · 正反派双排站位 · 代号名牌标签】`,
    `在纯净中性灰影棚背景前，${totalCount} 位乐高人仔角色分两排正面全身站立于收藏展示台上。`,
    ``,
    `🔵 前排（正方联军 · ${coalitionCount} 人）：`,
    ...coalitionRows.map(r => `  ${r.position}. 【${r.person}】代号 [${r.callsign}] · ${r.role} · ${r.outfit}`),
    ``,
    `🔴 后排（反方势力 · ${opposingCount} 人）：`,
    ...opposingRows.map(r => `  ${r.position}. 【${r.person}】代号 [${r.callsign}] · ${r.role} · ${r.outfit}`),
    ``,
    `每个角色脚下的展示台上有白色代号名牌标签 [CALLSIGN]，正方底座为深蓝色，反方底座为暗红色。`,
    `棚拍柔光箱，脚底微弱阴影，35mm 移轴微距摄影，真实 ABS 塑料注塑反光与微观接缝细节清晰可见。`
  ].join('\n');

  return {
    characterCount: totalCount,
    factions: normalizedFactions,
    promptEn,
    promptZh,
    aspectRatio
  };
}
