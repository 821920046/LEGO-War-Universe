/**
 * LEGO War Universe - 资产目录构建与 AI 引用解析 (Asset Catalog)
 *
 * 为什么需要这个模块：
 * 早前 /api/ai-brain 只把 { query, requestedShots } 丢给大模型，大模型对
 * 项目里 390 项认证积木资产一无所知，只能凭空编造「LEGO 坦克」这类含糊描述，
 * 再由 alignShotsToLego 用写死的默认资产兜底 —— 结果是「AI 生成」的脚本
 * 根本没用上资产库，与本地引擎的差别仅在于文字更华丽。
 *
 * 这里把资产库压缩成一份「与题材相关」的紧凑目录注入 Prompt，并要求模型
 * 只能引用目录内真实存在的 ID；模型返回后再用 resolveShotAssets 校验，
 * 非法 / 不存在的 ID 会被安全地降级为默认资产，而不是直接污染注册表。
 */

export const GROUP_TO_KIND = {
  characters: 'character',
  vehicles: 'vehicle',
  weapons: 'weapon',
  props: 'prop',
  fx: 'fx',
  environments: 'environment',
  cameras: 'camera',
  lighting: 'lighting',
  colorGrades: 'colorGrade',
  audio: 'audio'
};

const GROUP_LABELS_ZH = {
  characters: '角色人仔',
  vehicles: '载具',
  weapons: '武器',
  props: '道具',
  fx: '特效',
  environments: '环境',
  cameras: '运镜',
  lighting: '灯光',
  colorGrades: '调色',
  audio: '音效'
};

// 「现代高科技 / 轨道」等新题材在旧目录里往往没有专门资产，
// 因此把同属现代范畴的系列视为可互通的候选池。
const ERA_AFFINITY = {
  'Modern High-Tech': ['Modern High-Tech', 'Modern', 'Orbital'],
  'Modern': ['Modern', 'Modern High-Tech'],
  'Orbital': ['Orbital', 'Modern High-Tech'],
  'Iraq War': ['Iraq War', 'Gulf War'],
  'Gulf War': ['Gulf War', 'Iraq War'],
  'Pacific': ['Pacific', 'WWII'],
  'WWII': ['WWII', 'Pacific'],
  'Cold War': ['Cold War']
};

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s,，、/|;；:：()（）【】\[\]"'`]+/)
    .map(t => t.trim())
    .filter(t => t.length >= 2);
}

function haystack(asset) {
  return `${asset.name || ''} ${asset.nameZh || ''} ${asset.kw || ''} ${(asset.lines || []).join(' ')}`.toLowerCase();
}

/**
 * 构建与题材相关的紧凑资产目录
 * @param {object} registryData 原始资产库 JSON（含 characters/vehicles/... 分组数组）
 * @param {{ era?: string, keywords?: string, perGroup?: number }} options
 * @returns {{ era: string|null, groups: Record<string, Array<object>> }}
 */
export function buildAssetCatalog(registryData, { era = null, keywords = '', perGroup = 14 } = {}) {
  const tokens = tokenize(keywords);
  const affinity = era ? (ERA_AFFINITY[era] || [era]) : null;
  const groups = {};

  for (const [group, kind] of Object.entries(GROUP_TO_KIND)) {
    const all = Array.isArray(registryData?.[group]) ? registryData[group] : [];
    const scored = all.map(asset => {
      let score = 0;
      const series = asset.series || 'shared';
      if (series === 'shared') score += 4;
      if (affinity) {
        if (affinity.includes(series)) score += series === era ? 120 : 60;
        else score -= 25;
      }
      const hay = haystack(asset);
      for (const t of tokens) {
        if (hay.includes(t)) score += 32;
      }
      return { asset, score };
    });

    scored.sort((a, b) => b.score - a.score || String(a.asset.id).localeCompare(String(b.asset.id)));
    groups[group] = scored.slice(0, perGroup).map(({ asset }) => ({
      id: asset.id,
      kind,
      name: asset.name || '',
      nameZh: asset.nameZh || '',
      series: asset.series || 'shared',
      kw: asset.kw || ''
    }));
  }

  return { era, groups };
}

/**
 * 把目录渲染成注入 Prompt 的紧凑文本
 */
export function formatCatalogForPrompt(catalog, { maxPerGroup = 14 } = {}) {
  if (!catalog?.groups) return '';
  const lines = [];
  for (const [group, list] of Object.entries(catalog.groups)) {
    const items = (list || []).slice(0, maxPerGroup)
      .map(a => `${a.id}=${a.nameZh || a.name}${a.series && a.series !== 'shared' ? `(${a.series})` : ''}`);
    if (items.length) lines.push(`【${GROUP_LABELS_ZH[group] || group}】${items.join('、')}`);
  }
  return lines.join('\n');
}

/** 收集资产库中全部合法 ID */
export function collectValidIds(registryData) {
  const ids = new Set();
  for (const group of Object.keys(GROUP_TO_KIND)) {
    for (const asset of registryData?.[group] || []) {
      if (asset?.id) ids.add(asset.id);
    }
  }
  return ids;
}

function asIdList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean);
  return String(value).split(/[,，、\s|]+/).map(v => v.trim()).filter(Boolean);
}

/**
 * 从大模型返回的镜头对象中解析资产引用。
 * 兼容两种风格：结构化 assets 字段，或散落在顶层的中英文字段。
 */
export function extractAssetRefs(shot = {}) {
  const src = shot.assets && typeof shot.assets === 'object' ? shot.assets : shot;
  return {
    subjects: asIdList(src.subjects ?? src.subject ?? src.characters ?? src.vehicles),
    environment: String(src.environment ?? src.env ?? '').trim(),
    camera: String(src.camera ?? '').trim(),
    lighting: String(src.lighting ?? src.light ?? '').trim(),
    colorGrade: String(src.colorGrade ?? src.color ?? '').trim(),
    fx: asIdList(src.fx),
    audio: asIdList(src.audio)
  };
}

/**
 * 把镜头里的资产引用对齐到真实存在的 ID 集合。
 * @returns {{ refs: object, unknown: string[] }}
 */
export function resolveShotAssets(shot, validIds) {
  const refs = extractAssetRefs(shot);
  const unknown = [];
  const keep = id => {
    if (!id) return '';
    if (validIds.has(id)) return id;
    unknown.push(id);
    return '';
  };
  const keptSubjects = refs.subjects.filter(id => {
    if (validIds.has(id)) return true;
    unknown.push(id);
    return false;
  });

  return {
    refs: {
      subjects: keptSubjects,
      environment: keep(refs.environment),
      camera: keep(refs.camera),
      lighting: keep(refs.lighting),
      colorGrade: keep(refs.colorGrade),
      fx: refs.fx.filter(id => validIds.has(id)),
      audio: refs.audio.filter(id => validIds.has(id))
    },
    unknown
  };
}
