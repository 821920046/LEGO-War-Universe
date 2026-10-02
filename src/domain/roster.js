/**
 * LEGO War Universe - 角色名册引擎 v5.0 (Character Roster Engine)
 *
 * 第一性原则：角色不是「凭空编造的人设」，而是「从真实乐高资产库里挑出来的资产」，
 * 只是额外挂了一个便于口播/生图调用的代号 (callsign)。
 *
 * 因此本模块做两件事：
 *   1. selectCast() —— 按时代/任务，从**真实资产库**里挑选正反双方演员（不含虚构 ID）。
 *   2. buildRoster() —— 把一部片子实际用到的资产聚合成名册，并为每个**真实资产 ID**
 *      确定性地分配唯一代号；同名册重复调用结果完全一致（可持久化、可复现）。
 *
 * 代号必须唯一：两个不同角色共用一个代号，视频生成时会直接串戏。
 * 代号还必须稳定：同一资产在任意一次生成里都应拿到同一个代号，否则分镜与定妆表会对不上。
 */

/** 友军阵营标识（来自资产库 faction 字段） */
export const FRIENDLY_FACTIONS = new Set(['Coalition', 'NATO', 'Allies']);
/** 敌军阵营标识 */
export const ENEMY_FACTIONS = new Set(['Opposing Force', 'Axis', 'Warsaw Pact']);

import { isEraCompatible } from './shot-spec.js';

/** 时代亲和分组：某时代缺编时，用组内其它时代补齐（如 Modern High-Tech 库里没有敌军角色） */
export const ERA_AFFINITY = {
  'WWII': ['WWII', 'Pacific'],
  'Pacific': ['Pacific', 'WWII'],
  'Cold War': ['Cold War', 'Gulf War'],
  'Gulf War': ['Gulf War', 'Cold War', 'Iraq War'],
  'Iraq War': ['Iraq War', 'Gulf War', 'Modern'],
  'Modern': ['Modern', 'Iraq War', 'Gulf War', 'Modern High-Tech'],
  'Modern High-Tech': ['Modern High-Tech', 'Modern', 'Orbital'],
  'Orbital': ['Orbital', 'Modern High-Tech', 'Modern']
};

/**
 * 判定资产属于哪一方。中立资产（记者/平民/承包商）不进正反名册。
 * @param {object} asset 资产对象
 * @returns {'coalition'|'opposing'|'neutral'}
 */
export function sideOf(asset) {
  const f = asset && asset.faction;
  if (FRIENDLY_FACTIONS.has(f)) return 'coalition';
  if (ENEMY_FACTIONS.has(f)) return 'opposing';
  return 'neutral';
}

/**
 * 32 位 FNV-1a 字符串哈希 —— 用于把资产 ID 稳定映射到代号池的起点。
 * 只依赖字符串本身，跨会话/跨设备结果一致。
 */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  const s = String(str ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 角色原型识别规则（顺序敏感：越具体越靠前） */
const ARCHETYPE_RULES = [
  { key: 'command', re: /command|officer|commander|leader|admiral|captain|指挥|军官|舰长|长官|外交/i },
  // 必须写成 \bew\b：早期写成 `ew\b`，结果 "Armour Crew" 里的 "Crew" 也命中，
  // 坦克车组被误判成电子战，拿到的代号是 SIGNAL 而不是 IRONHIDE。
  { key: 'ew', re: /\bew\b|cyber|signal|jam|electronic|datalink|电子|网络|通信|干扰|数据链/i },
  { key: 'medical', re: /medical|medic|surgeon|csar|rescue|医护|医疗|医生|救生|救援/i },
  { key: 'sniper', re: /sniper|recon|scout|狙击|侦察|观察/i },
  // `special` 不加词边界会命中 "Specialist"，把 CBRN/电子战等专家全部误判成突击手
  { key: 'specops', re: /\bspecial\b|assault|breach|demolition|commando|\bsf\b|突击|特战|破门|潜水/i },
  { key: 'aviation', re: /aviation|pilot|airborne|flight|aircraft|\bair\b|飞行|伞降|空降|航空/i },
  // `crew` 不加边界会命中 "Screwdriver"，`ship` 会命中 "Leadership"，同理加边界/换词
  { key: 'armor', re: /armor|armour|tank|\bcrew\b|mech|坦克|装甲|车组|车长/i },
  { key: 'naval', re: /navy|naval|marine|deck|boat|warship|submarine|海军|舰|艇|甲板|登陆/i },
  // `eod` 不加边界会命中 "method"
  { key: 'engineer', re: /engineer|\beod\b|robotic|uav|uas|drone|logistics|工兵|拆弹|机器|无人|补给|运输/i },
  { key: 'orbital', re: /orbital|space|astronaut|zero-g|轨道|太空|航天|宇航/i },
  { key: 'infantry', re: /infantry|rifle|irregular|guard|trooper|步兵|步枪|游击|武装|警卫|士兵/i }
];

/** 识别资产的角色原型 */
export function archetypeOf(asset) {
  const hay = `${asset?.unit || ''} ${asset?.name || ''} ${asset?.nameZh || ''} ${asset?.kind || ''}`;
  for (const rule of ARCHETYPE_RULES) {
    if (rule.re.test(hay)) return rule.key;
  }
  return 'default';
}

/** 正方代号池：按原型分组，军事感强、易口播 */
const COALITION_POOLS = {
  command: ['ACTUAL', 'EAGLE', 'OVERLORD', 'KINGPIN'],
  sniper: ['HAWKEYE', 'GHOST', 'LONGSHOT', 'OWL'],
  medical: ['DOC', 'LIFELINE', 'SAWBONES', 'TRIAGE'],
  armor: ['IRONHIDE', 'ANVIL', 'BULWARK', 'HAMMERHEAD'],
  aviation: ['MAVERICK', 'ROOSTER', 'JETSTREAM', 'ANGEL'],
  naval: ['ANCHOR', 'TRIDENT', 'SEAWOLF', 'TIDE'],
  ew: ['SIGNAL', 'CIPHER', 'RELAY', 'GHOSTWIRE'],
  engineer: ['TINKER', 'WIRECUTTER', 'SPARK', 'GIZMO'],
  specops: ['REAPER', 'SPECTRE', 'PHANTOM', 'NOMAD'],
  orbital: ['ORBIT', 'NOVA', 'HALO', 'PULSE'],
  infantry: ['RANGER', 'SABER', 'VANGUARD', 'SENTINEL'],
  default: ['FALCON', 'HORNET', 'BADGER', 'KESTREL']
};

/** 反方代号池：与正方不重叠，辨识度高 */
const OPPOSING_POOLS = {
  command: ['WARLORD', 'VIPER', 'OVERSEER', 'PREACHER'],
  sniper: ['SHADOW', 'WRAITH', 'CROW', 'SILENCE'],
  medical: ['QUACK', 'STITCH', 'BANDAGE', 'PLASMA'],
  armor: ['PANZER', 'HAMMER', 'RUST', 'BRUTE'],
  aviation: ['COBRA', 'TALON', 'VULTURE', 'RAPTOR'],
  naval: ['KRAKEN', 'BARNACLE', 'LEVIATHAN', 'RIPTIDE'],
  ew: ['STATIC', 'JAMMER', 'SCRAMBLE', 'PARASITE'],
  engineer: ['SCORPION', 'LOCUST', 'VERMIN', 'RATCHET'],
  specops: ['JACKAL', 'HYENA', 'MARAUDER', 'WOLF'],
  orbital: ['VOID', 'DEBRIS', 'GRAVITY', 'ECLIPSE'],
  infantry: ['MOB', 'THUG', 'CONSCRIPT', 'BRIGAND'],
  default: ['HYDRA', 'MANTIS', 'BASILISK', 'CARRION']
};

/**
 * 中立备用池（双方共用）。
 *
 * 为什么需要它：早期实现把「对方阵营的默认池」当作最后兜底，结果我方军医拿到了
 * MANTIS / CARRION 这种明显带反派味道的代号 —— 代号唯一但阵营语义错乱。
 * 现在改成先落入这组中立军事代号，跨阵营串味的情况基本消除。
 */
const RESERVE_POOL = [
  'VECTOR', 'ECHO', 'TANGO', 'SIERRA', 'DELTA', 'OSCAR', 'ROMEO', 'KILO',
  'ZULU', 'PILGRIM', 'CROSSBOW', 'LANTERN', 'MERIDIAN', 'OBSIDIAN', 'QUARRY', 'SEXTANT'
];

/**
 * 为一个资产确定性地挑选唯一代号。
 *
 * 算法：以 fnv1a(assetId) 决定在原型代号池里的起始下标，环形扫描取第一个未被占用的代号；
 * 池耗尽时追加序号（如 GHOST-2）。同一批输入 → 同一批输出。
 *
 * 契约：返回的代号会被**就地写入 used**。早期实现只在 JSDoc 里声称会更新、
 * 实际却不更新，任何照着文档调用的地方都会拿到重复代号 —— 这是会直接串戏的坑。
 *
 * @param {object} asset 资产
 * @param {'coalition'|'opposing'} side 阵营
 * @param {Set<string>} used 已被占用的代号集合（会被就地更新）
 * @returns {string} 唯一代号
 */
export function assignCallsign(asset, side, used = new Set()) {
  const pools = side === 'opposing' ? OPPOSING_POOLS : COALITION_POOLS;
  const arch = archetypeOf(asset);
  // 原型池优先 → 本阵营默认池 → 中立备用池。绝不借用对方阵营的池，避免我方拿反派代号。
  const pool = [
    ...(pools[arch] || []),
    ...pools.default,
    ...RESERVE_POOL
  ];
  const start = fnv1a(asset?.id || '') % pool.length;

  for (let step = 0; step < pool.length; step++) {
    const candidate = pool[(start + step) % pool.length];
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }

  // 池完全耗尽：用原型名 + 递增序号保证唯一
  const base = (pools[arch] || pools.default)[0] || 'AGENT';
  let n = 2;
  while (used.has(`${base}-${n}`)) n++;
  const fallback = `${base}-${n}`;
  used.add(fallback);
  return fallback;
}

/** 从资产提取一段简短外观描述（用于定妆表卡片） */
function outfitOf(asset) {
  const lines = Array.isArray(asset?.lines) ? asset.lines : [];
  // lines[0] 通常是「LEGO minifigure, standard minifigure height」这类通用行，跳过
  const specific = lines.slice(1).filter(Boolean);
  const picked = specific.slice(0, 3).join('，');
  return picked || lines[0] || '标准乐高微缩造型';
}

/** 从 prior 入参（名册对象 / 名册数组）提取 { id -> callsign } 映射 */
function priorCallsignMap(prior) {
  const map = new Map();
  if (!prior) return map;
  const list = Array.isArray(prior) ? prior : (Array.isArray(prior.all) ? prior.all : []);
  for (const e of list) {
    if (e && e.id && e.callsign) map.set(String(e.id), String(e.callsign));
  }
  return map;
}

/**
 * 把一部影片实际用到的真实资产聚合成正反双方名册。
 *
 * 第一性原则（代号冻结）：代号是「一部片子的演员身份」，一旦分配就必须冻结。
 * 因为生成流程是「规划器先写台词（内含代号）→ 自我进化再往镜头里补资产 → UI 重新聚合名册」，
 * 如果每次都按当前集合重算代号，补进来的新资产会把老资产挤出原代号，
 * 结果就是台词里写着 GHOST、定妆表里却变成 FALCON —— 视频生成直接串戏。
 *
 * 因此支持传入 prior（上一版名册）：老 ID 一律沿用旧代号，只有全新 ID 才分配新代号，
 * 且已退役的旧代号会被保留占用，避免「新角色捡走旧角色的代号」。
 *
 * @param {Array<object>} shots 镜头序列
 * @param {object} registry 资产注册表
 * @param {{ prior?: object|Array }} [options] prior = 上一版名册（对象或序列化数组）
 * @returns {{ coalition: Array, opposing: Array, neutral: Array, all: Array, byId: Map }}
 */
export function buildRoster(shots = [], registry = null, { prior = null } = {}) {
  const byId = new Map();
  const all = [];
  const list = Array.isArray(shots) ? shots : [];

  // 第一遍：按「首次出场顺序」收集演员（这个顺序对展示友好，但不参与代号分配）
  for (const shot of list) {
    for (const id of (shot?.subjects || [])) {
      if (!id || byId.has(id)) continue;
      const asset = registry?.byId?.get(id);
      if (!asset) continue;
      // 名册只收人仔与载具；武器/道具/特效不算「角色」
      if (asset.kind !== 'character' && asset.kind !== 'vehicle') continue;

      const entry = {
        id,
        callsign: '',
        side: sideOf(asset),
        name: asset.nameZh || asset.name,
        nameEn: asset.name,
        role: asset.unit || (asset.kind === 'vehicle' ? '载具' : '作战员'),
        series: asset.series || 'shared',
        faction: asset.faction || null,
        outfit: outfitOf(asset),
        kind: asset.kind
      };
      byId.set(id, entry);
      all.push(entry);
    }
  }

  const inherited = priorCallsignMap(prior);
  const reserved = new Set(inherited.values()); // 退役代号也不允许被新角色复用
  const taken = new Set();

  // 第二遍：**按资产 ID 升序**分配代号。
  // 这一步必须与出场顺序无关，否则「规划器生成时算出的代号」会和「事后 buildRoster
  // 重新聚合时算出的代号」不一致 —— 分镜里写着 GHOST，定妆表里却变成 FALCON。
  for (const entry of [...all].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    const asset = registry?.byId?.get(entry.id);
    const side = entry.side === 'opposing' ? 'opposing' : 'coalition';

    const priorCall = inherited.get(entry.id);
    if (priorCall && !taken.has(priorCall)) {
      entry.callsign = priorCall;
      taken.add(priorCall);
      continue;
    }
    // 已占用集合 = 本版已分配 ∪ 历史保留（防止新角色复用别人的代号）
    entry.callsign = assignCallsign(asset, side, new Set([...taken, ...reserved]));
    taken.add(entry.callsign);
  }

  return {
    coalition: all.filter(e => e.side === 'coalition'),
    opposing: all.filter(e => e.side === 'opposing'),
    neutral: all.filter(e => e.side === 'neutral'),
    all,
    byId
  };
}

/** 把名册序列化为可持久化 / 可 JSON 传输的纯数组（byId Map 不能进 localStorage） */
export function rosterToJSON(roster) {
  return Array.isArray(roster?.all) ? roster.all.map(e => ({ ...e })) : [];
}

/**
 * 从持久化数据还原名册。任何非法输入一律返回 null，由调用方决定是否重算，
 * 绝不让损坏的工程数据把整个界面拖崩。
 */
export function rosterFromJSON(data) {
  if (!data) return null;
  const list = Array.isArray(data) ? data : (Array.isArray(data.all) ? data.all : null);
  if (!list) return null;

  const byId = new Map();
  const all = [];
  for (const raw of list) {
    if (!raw || !raw.id) continue;
    const entry = {
      id: String(raw.id),
      callsign: String(raw.callsign || ''),
      side: raw.side === 'opposing' ? 'opposing' : (raw.side === 'neutral' ? 'neutral' : 'coalition'),
      name: raw.name || '',
      nameEn: raw.nameEn || '',
      role: raw.role || '',
      series: raw.series || 'shared',
      faction: raw.faction || null,
      outfit: raw.outfit || '',
      kind: raw.kind || 'character'
    };
    if (!entry.callsign) continue; // 无代号的条目没有意义，丢弃
    byId.set(entry.id, entry);
    all.push(entry);
  }

  // 一条可用条目都没解析出来 → 视同「没有历史名册」，由调用方重新分配
  if (all.length === 0) return null;

  return {
    coalition: all.filter(e => e.side === 'coalition'),
    opposing: all.filter(e => e.side === 'opposing'),
    neutral: all.filter(e => e.side === 'neutral'),
    all,
    byId
  };
}

/**
 * 生成「【代号】中文名 (真实ID)」标签。没有名册命中时原样返回 ID，
 * 保证任何调用点都不会因为缺名册而崩或显示空白。
 */
export function labelFor(roster, id, { withId = true } = {}) {
  const entry = roster?.byId?.get(id);
  if (!entry) return String(id ?? '');
  return `【${entry.callsign}】${entry.name}${withId ? ` (${id})` : ''}`;
}

/** 只取代号；无名册命中时返回空串（便于调用方自行兜底） */
export function callsignOf(roster, id) {
  return roster?.byId?.get(id)?.callsign || '';
}

/**
 * 生成「【代号】中文名」短标签（不带 ID），用于卡片与脚本正文。
 * 没有名册命中时退化为纯名称，保证任何调用点都不会显示空白。
 */
export function aliasLabel(roster, id, fallbackName = '') {
  const entry = roster?.byId?.get(id);
  if (!entry) return String(fallbackName || id || '');
  return `【${entry.callsign}】${entry.name}`;
}

/**
 * 把名册渲染成可注入 Prompt 的英文演员表行。
 * @param {object} roster buildRoster 的产物
 * @returns {string[]} 演员表行
 */
export function rosterPromptLines(roster) {
  const lines = [];
  const fmt = (list) => list
    .map(e => `[${e.callsign}] ${e.nameEn} (${e.id}) — ${e.role}`)
    .join('; ');
  if (roster?.coalition?.length) lines.push(`COALITION CAST: ${fmt(roster.coalition)}`);
  if (roster?.opposing?.length) lines.push(`OPPOSING CAST: ${fmt(roster.opposing)}`);
  return lines;
}

/** 判断任务关键词是否命中某个原型 */
export function taskAffinity(asset, task) {
  const hay = `${asset?.unit || ''} ${asset?.name || ''} ${asset?.nameZh || ''}`;
  if (task === 'rescue') return /medical|medic|csar|rescue|surgeon|aviation|pilot|医护|医疗|救援|救生|飞行/i.test(hay);
  if (task === 'patrol') return /recon|scout|sniper|infantry|侦察|观察|狙击|步兵/i.test(hay);
  // 必须给 tank / armour 加词边界：早期写成裸 `tank` 会命中 "KC-46 **Tank**er"，
  // 于是「空中加油机」成了所有现代战斗题材里排名第一的载具。
  if (task === 'combat') return /special|assault|infantry|\barmou?r\b|\btank\b|突击|特战|步兵|装甲|坦克/i.test(hay);
  return false;
}

/**
 * 战场域规则（顺序敏感：越具体越靠前）。
 *
 * 存在的意义：旧实现把 `theme` 传进 selectCast 却**完全没有解构使用**，
 * 载具因此只按 ID 升序取前 3 个 —— 「核潜艇在深海猎杀敌方舰队」拿到的却是
 * 空中加油机 + 突击艇 + 越野车，而且任何现代题材拿到的都是同一组。
 * 资产库再大也白搭：题材里说什么，片子里就该出什么。
 *
 * classes —— 该域优先的载具类别（与 assets.schema.json 的 vehicle.class 对齐）；
 * re      —— 域识别正则，同时用于给单个资产打分（命中即说明它属于这个域）。
 */
const DOMAIN_RULES = [
  {
    key: 'naval',
    classes: ['ship', 'submarine'],
    re: /navy|naval|\bship\b|fleet|carrier|destroyer|frigate|cruiser|submarine|warship|ocean|sea|maritime|amphibious|torpedo|sonar|海军|舰|航母|潜艇|驱逐舰|护卫舰|巡洋舰|舰队|海上|远海|深海|两栖|登陆舰|鱼雷|声纳|水雷/i
  },
  {
    key: 'air',
    classes: ['aircraft', 'helicopter', 'drone'],
    re: /air ?force|aircraft|bomber|fighter|\bjet\b|airbase|airborne|aerial|air superiority|sortie|stealth|aviation|空军|轰炸机|战斗机|战机|制空|空中|空袭|空战|僚机|加油机|预警机|侦察机|直升机|伞降|空降/i
  },
  {
    key: 'strategic',
    classes: ['ground', 'ship', 'aircraft'],
    re: /icbm|intercontinental|ballistic missile|missile silo|\bsilo\b|nuclear deterrent|strategic (?:strike|deterrence|rocket|bomber)|洲际|弹道导弹|发射井|战略打击|战略轰炸|核威慑|导弹基地|战略值班/i
  },
  {
    key: 'ground',
    classes: ['ground', 'ugv'],
    re: /\btank\b|armou?r|infantry|urban|\bcity\b|street|convoy|artillery|装甲|坦克|步兵|巷战|城市|街区|车队|炮兵|阵地|堑壕/i
  }
];

/**
 * 战区互斥规则（仅作用于 WWII / Pacific）。
 *
 * 存在的意义：`ERA_COMPATIBILITY` 允许 WWII ⇄ Pacific 互借资产（二者同属二战），
 * 但**战区不能混**。资产库补全日军/美军陆战队之前，太平洋题材唯一的敌军是德军士兵，
 * 于是「中途岛航母对决」里出现了德国兵 —— 这是比装备单一严重得多的硬穿帮。
 *
 * 判定刻意保守：**只有资产与题材双方都带明确战区标记、且两者冲突时才剔除**。
 * 北非、缅甸这类中立题材不带标记，德军（隆美尔的非洲军团）仍可正常上镜。
 */
const THEATER_RULES = [
  {
    key: 'european',
    re: /德军|德意志|国防军|党卫|german|wehrmacht|fallschirm|panzer|panther|tiger|诺曼底|斯大林格勒|柏林|阿登|欧洲|东线|西线|normandy|stalingrad|berlin|ardennes|europe/i
  },
  {
    key: 'pacific',
    re: /日本|日军|帝国海军|帝国陆军|ijn|ija|japanese|zero|零式|翔鹤|赤城|大和|武藏|太平洋|瓜岛|硫磺岛|中途岛|瓜达尔卡纳尔|冲绳|塞班|iwo|midway|guadalcanal|okinawa|saipan|pacific/i
  }
];

/** 文本 → 战区；无明确标记返回 null（null 表示「不参与互斥」）。 */
export function theaterOf(text) {
  const hay = String(text || '');
  if (!hay.trim()) return null;
  for (const rule of THEATER_RULES) {
    if (rule.re.test(hay)) return rule.key;
  }
  return null;
}

/** 资产的战区标记取自这些字段（与 domainScore / themeMatch 的取材保持一致）。 */
function assetText(a) {
  return `${a?.unit || ''} ${a?.name || ''} ${a?.nameZh || ''} ${a?.kw || ''}`;
}

/**
 * 判定一段文本（题材 / 战场环境）属于哪个战场域。
 * @returns {{ key: string, classes: string[], re: RegExp }|null}
 */
export function domainOfText(text) {
  const hay = String(text || '');
  if (!hay.trim()) return null;
  for (const rule of DOMAIN_RULES) {
    if (rule.re.test(hay)) return rule;
  }
  return null;
}

/**
 * 资产与战场域的契合分。
 *
 * 权重设计：类别匹配（+10）是强信号 —— 海军题材里的「舰艇/潜艇」必然优于飞机；
 * 域关键词命中（+4）是弱信号，用来在同一类别内部排序（题材提到「潜艇」时，
 * 潜艇要排在驱逐舰前面）。
 */
function domainScore(asset, domain) {
  if (!domain) return 0;
  const hay = `${asset?.unit || ''} ${asset?.name || ''} ${asset?.nameZh || ''} ${asset?.kw || ''}`.toLowerCase();
  let score = 0;
  if (asset?.class && domain.classes.includes(asset.class)) score += 10;
  if (domain.re.test(hay)) score += 4;
  return score;
}

/**
 * 归一化：小写 + 去掉所有分隔符。
 *
 * 去掉连字符是必需的：题材写「F-22」而资产名写「F-22 Raptor」，两者去掉分隔符后
 * 都是 `f22…` 才能对上；否则 `b-2` 与 `b-52` 会因为共享 `b-` 而互相误命中。
 */
function normalizeMatchText(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_/·.,()（）【】[\]]+/g, '');
}

/** 最长公共子串（滚动数组，O(n·m)）。资产与题材都很短，开销可忽略。 */
function longestCommonSubstrFull(a, b) {
  if (!a || !b) return { len: 0, str: '' };
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1).fill(0);
  let best = 0;
  let bestAt = 0;
  for (let i = 1; i <= m; i += 1) {
    const cur = new Array(n + 1).fill(0);
    const ai = a[i - 1];
    for (let j = 1; j <= n; j += 1) {
      if (ai === b[j - 1]) {
        const v = prev[j - 1] + 1;
        cur[j] = v;
        if (v > best) { best = v; bestAt = i; }
      }
    }
    prev = cur;
  }
  return { len: best, str: best ? a.slice(bestAt - best, bestAt) : '' };
}

/** 最长公共子串长度。 */
function longestCommonSubstr(a, b) {
  return longestCommonSubstrFull(a, b).len;
}

/** 型号 token：F-22 / B-2 / M1A2 / SEPv3 / HIMARS 等带数字的型号标识。 */
const MODEL_TOKEN_RE = /[a-z]{1,6}[-\s]?\d{1,4}[a-z0-9-]*|\d{1,4}[a-z]{1,4}/g;

/** 从题材里抽出型号 token（保留连字符，用于带边界的精确命中）。 */
function modelTokens(theme) {
  const raw = String(theme || '').toLowerCase();
  const out = new Set();
  for (const m of raw.match(MODEL_TOKEN_RE) || []) {
    const t = m.trim();
    if (t.length >= 2) out.add(t);
  }
  return [...out];
}

/** 带字母数字边界的命中：`b-2` 不能命中 `b-21`。 */
function hasBoundedToken(hayLower, token) {
  const esc = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${esc}([^a-z0-9]|$)`).test(hayLower);
}

/**
 * 题材点名度：题材里**明确说出的装备**必须排到同类前面。
 *
 * 这是「装备太单一」的第二层根治点。仅有战场域还不够 —— 域只保证「海军题材给舰艇」，
 * 但「核潜艇」题材里排第一的仍可能是两栖攻击舰、「F-22」题材里排第一的仍可能是
 * 电子侦察机（因为 taskAffinity 的 patrol 命中「侦察」）。这里直接拿题材文本与资产
 * 的名称/中文名/关键词求最长公共子串：题材说了「驱逐舰」，驱逐舰就赢。
 *
 * 分两档：
 *   · 通用点名 —— 最长公共子串（封顶 10 字 × 3，最高 30）。题材说「航母」「驱逐舰」
 *     「洲际弹道导弹」时靠它命中。
 *   · 型号点名 —— 额外 +12。**必须单独一档**：否则「F-22 战斗机」题材里，所有
 *     「战斗机」都会因泛类别命中而拿到同样的分，点名型号反而被 ID 排序挤掉
 *     （实测 F-35A 会排在 F-22 前面）。型号命中还做了边界保护，`B-2` 不会命中 `B-21`。
 */
export function themeMatch(asset, theme) {
  const t = normalizeMatchText(theme);
  if (t.length < 2) return 0;
  const hayRaw = `${asset?.unit || ''} ${asset?.name || ''} ${asset?.nameZh || ''} ${asset?.kw || ''}`;
  const hay = normalizeMatchText(hayRaw);
  if (hay.length < 2) return 0;

  const len = longestCommonSubstr(hay, t);
  let score = len >= 2 ? Math.min(len, 10) * 3 : 0;

  for (const tok of modelTokens(theme)) {
    if (hasBoundedToken(hayRaw.toLowerCase(), tok)) { score += 12; break; }
    // 兜底：题材写 `F22`、资产写 `F-22` 时连字符不一致，退化为归一化包含判断，
    // 但右侧不允许紧跟数字，避免 `b2` 命中 `b21`。
    const nTok = normalizeMatchText(tok);
    if (nTok.length < 2) continue;
    const i = hay.indexOf(nTok);
    if (i !== -1 && !/\d/.test(hay[i + nTok.length] || '')) { score += 12; break; }
  }
  return score;
}

/**
 * 阵营 / 国名停用词：题材里提到「伊拉克」，不等于点名了「伊拉克 T-72 坦克」。
 *
 * 没有这一层，敌方载具放行条件会被国名词轻易击穿 —— 实测「伊拉克战争费卢杰巷战」
 * 会把伊军的 T-72 当成**英雄载具**推上镜头，这比不放行更糟。
 */
const FACTION_STOP_RE = /^(伊拉克|美军|苏军|联军|德军|日军|英军|俄军|法军|敌军|敌方|我军|中国|美国|俄罗斯|苏联|乌克兰|伊朗|朝鲜|韩国|以色列|阿富汗|叙利亚|越南|日本|德国|北约|华约|共和国卫队|陆战队|海军|空军|陆军|士兵|部队|载具|装备)$/;

/**
 * 题材是否**点名**了这件具体装备（而非仅仅提到它的阵营 / 类别）。
 *
 * 与 themeMatch 的分值不同，这里要的是布尔判定，用于决定敌方载具能否上英雄镜头。
 * 判定：归一化后的最长公共子串长度 ≥ 3，且该子串不是阵营停用词。
 *   · 「虎式坦克对决」  vs 「虎式坦克」      → 命中（子串「虎式坦克」）
 *   · 「T-72 坦克战」    vs 「伊拉克 T-72 坦克」→ 命中（子串「t72坦克」）
 *   · 「伊拉克战争费卢杰巷战」 vs 同上        → 不命中（子串「伊拉克」被停用）
 */
export function themeNamesAsset(asset, theme) {
  const t = normalizeMatchText(theme);
  const hay = normalizeMatchText(assetText(asset));
  if (t.length < 2 || hay.length < 2) return false;
  const m = longestCommonSubstrFull(hay, t);
  if (m.len < 3) return false;
  if (FACTION_STOP_RE.test(m.str)) return false;
  return true;
}


/**
 * 类别多样性挑选：同类只取一个，避免「三部片子都是主战坦克」。
 *
 * **域感知**是这里的关键。只认类别、不认战场域的版本会制造硬穿帮：
 * 「二战北非沙漠装甲追击」是陆战域，却因为「每类取一个」被硬塞一艘埃塞克斯级航母；
 * 「中途岛航母对决」是海战域，却被硬塞一辆克伦威尔巡洋坦克。
 * 因此次序改为：域内类别每类一个 → 域内放开类别重复继续补 → 其余类别每类一个 → 原顺序兜底。
 * 第二步是必需的：中途岛要的是三艘舰，不是「一舰一坦一机」的伪多样性。
 *
 * 域内一个候选都没有时（例如角色没有 class），行为与旧版完全一致。
 */
function pickDiverse(pool, limit, domain = null) {
  const out = [];
  const used = new Set();
  const clsOf = (a) => a?.class || a?.kind || 'other';
  const inDomain = (a) => !!domain && domain.classes.includes(a?.class);
  let haveInDomain = false;

  if (domain) {
    for (const a of pool) {
      if (out.length >= limit) break;
      if (!inDomain(a)) continue;
      haveInDomain = true;
      const cls = clsOf(a);
      if (used.has(cls)) continue;
      used.add(cls);
      out.push(a);
    }
    if (out.length < limit) {
      for (const a of pool) {
        if (out.length >= limit) break;
        // out.includes 是必需的：第一步只登记了「类别」，不登记 ID，
        // 少了这一判断会把同一艘航母推两次（中途岛实测出现「埃塞克斯 ×2」）。
        if (!inDomain(a) || out.includes(a)) continue;
        out.push(a);
      }
    }
  }
  if (!haveInDomain) used.clear();

  if (out.length < limit) {
    for (const a of pool) {
      if (out.length >= limit) break;
      const cls = clsOf(a);
      if (used.has(cls) || out.includes(a)) continue;
      used.add(cls);
      out.push(a);
    }
  }
  if (out.length < limit) {
    for (const a of pool) {
      if (out.length >= limit) break;
      if (!out.includes(a)) out.push(a);
    }
  }
  return out;
}

/**
 * 按时代/任务，从**真实资产库**挑选一组演员（正反双方 + 载具）。
 *
 * 这是「角色从资产库里挑」这一诉求的落地点：返回的每一项都是注册表里真实存在的资产，
 * 不含任何虚构 ID。当某时代库内没有敌军资产时（如 Modern High-Tech / Orbital），
 * 会自动降级到时代亲和组里的敌军，并置 enemyFallback=true 供上层提示。
 *
 * @param {object} registry 资产注册表
 * @param {{ era?: string, task?: string, theme?: string, setting?: string, maxHeroes?: number, maxEnemies?: number, maxVehicles?: number }} options
 * @returns {{ heroes: Array, enemies: Array, vehicles: Array, enemyFallback: boolean, era: string, domain: string|null }}
 */
export function selectCast(registry, { era = 'Modern', task = 'combat', theme = '', setting = '', maxHeroes = 4, maxEnemies = 3, maxVehicles = 3 } = {}) {
  const affinity = ERA_AFFINITY[era] || [era, 'Modern'];

  // 题材 / 战场环境 → 战场域。这是「装备太单一」的根治点：
  // 海军题材选舰艇与潜艇、空战题材选飞机、战略题材选导弹与轰炸机、陆战题材选装甲与步兵。
  const domain = domainOfText(`${theme} ${setting}`);

  // 战区互斥只在二战这个兼容组内生效：WWII ⇄ Pacific 可以互借，但不能跨战区借。
  const guardTheater = (era === 'WWII' || era === 'Pacific');
  const targetTheater = guardTheater ? theaterOf(`${theme} ${setting}`) : null;

  // 只收「与目标时代视觉兼容」的资产，避免挑出一个必然触发 ERA_MISMATCH 穿帮的演员
  // （例如给 Orbital 题材硬塞 Modern 装备）。亲和顺序仅用于排序偏好。
  const collect = (kind) => {
    const out = [];
    for (const a of (registry?.byKind?.get(kind) || [])) {
      if (!isEraCompatible(a.series, era)) continue;
      if (targetTheater) {
        const at = theaterOf(assetText(a));
        if (at && at !== targetTheater) continue;
      }
      out.push(a);
    }
    // 亲和度高的时代排在前面
    out.sort((a, b) => {
      const ia = affinity.indexOf(a.series);
      const ib = affinity.indexOf(b.series);
      const ra = ia === -1 ? affinity.length : ia;
      const rb = ib === -1 ? affinity.length : ib;
      if (ra !== rb) return ra - rb;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
    return out;
  };

  const characters = collect('character');
  const vehicles = collect('vehicle');

  const bySide = (list, side) => list.filter(a => sideOf(a) === side);

  /**
   * 排序信号（从强到弱）：
   *   1. 战场域契合（题材说了海军，就别给空军装备）—— 这是「题材里说什么，片子里出什么」的保证；
   *   2. 题材点名度（题材里写了「驱逐舰 / F-22 / 洲际弹道导弹」，点名的那件就排第一）；
   *   3. 任务契合（救援题材优先医护 / 搜救人员）；
   *   4. ID 稳定排序，保证同一输入跨会话可复现。
   */
  const rank = (list) => [...list].sort((a, b) => {
    const da = domainScore(a, domain) + themeMatch(a, theme);
    const db = domainScore(b, domain) + themeMatch(b, theme);
    if (da !== db) return db - da;
    const ta = taskAffinity(a, task) ? 0 : 1;
    const tb = taskAffinity(b, task) ? 0 : 1;
    if (ta !== tb) return ta - tb;
    return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
  });

  // 角色同样吃战场域：海军题材优先舰艇船员/潜水员，空战题材优先飞行员/引导员，
  // 否则「核潜艇」题材里上镜的仍会是步兵班长与核生化专家。
  const heroes = pickDiverse(rank(bySide(characters, 'coalition')), maxHeroes, null);

  const enemyPool = rank(bySide(characters, 'opposing'));
  // 该时代（含兼容时代）确实没有敌军角色时才会为空 —— 例如 Orbital 库里没有任何反派角色。
  // 这种情况下必须诚实地返回空名单，而不是硬塞一个会造成时代穿帮的敌人。
  const enemyFallback = enemyPool.length === 0;
  const enemies = enemyPool.slice(0, maxEnemies);

  // 载具：优先与已选英雄同阵营，保证镜头里不会出现「孤零零一辆敌车」的穿帮。
  //
  // 唯一的例外是**题材点名**：用户写「大和号战列舰的最后一战」却看不到大和号，
  // 等于库里有也白有 —— 虎式、零式、T-72、米格-29 这些敌方平台会被阵营过滤全部挡在门外，
  // 中途岛、库尔斯克坦克对决这类题材根本拍不了。因此命中题材点名的敌方载具放行，
  // 且因为 themeMatch 计入排序分，它会自然排到最前。
  const namedByTheme = (a) => themeNamesAsset(a, theme);
  const coalitionVehicles = bySide(vehicles, 'coalition');
  const namedOpposing = vehicles.filter(a => sideOf(a) !== 'coalition' && namedByTheme(a));
  const vehiclePool = rank(coalitionVehicles.concat(namedOpposing));
  const chosenVehicles = pickDiverse(vehiclePool.length ? vehiclePool : rank(vehicles), maxVehicles, domain);

  return { heroes, enemies, vehicles: chosenVehicles, enemyFallback, era, domain: domain ? domain.key : null };
}
