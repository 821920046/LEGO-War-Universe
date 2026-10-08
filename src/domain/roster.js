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

/**
 * 国籍识别规则（顺序敏感：越具体越靠前）。
 *
 * 为什么需要它：`faction` 只分「盟军 / 轴心」这一层，而二战盟军内部还有美军、苏军、英军、
 * 法国抵抗组织。仅按 faction 选角，一部「诺曼底登陆抢滩」里会同时站着美军步兵、苏军政委
 * 与英军步兵 —— 观众一眼就知道是拼凑。国籍是比阵营更细一层的一致性约束。
 *
 * 依据是资产的 nameZh / name / kw 三处文本，中文标记优先（最可靠）。
 */
const NATION_RULES = [
  ['soviet', /苏军|苏联|红军|华约|soviet|russian|red army|warsaw pact/i],
  ['british', /英军|英国|皇家空军|皇家海军|british|royal air force|\braf\b|tommy|cromwell|churchill tank|challenger/i],
  ['german', /德军|德国|纳粹|国防军|党卫|german|wehrmacht|panzer|luftwaffe|stuka|bismarck|fallschirm/i],
  ['japanese', /日军|日本|帝国陆军|帝国海军|japanese|ija|ijn|shokaku|akagi|chi-ha|ha-go/i],
  ['french', /法军|法国|自由法国|抵抗组织|french|resistance/i],
  // 海湾 / 伊拉克战争的反方是伊拉克：不写这一条，「伊拉克共和国卫队士兵」判定不出国籍，
  // 会被兜底池分到桥本（日式名字），与画面里的中东战场直接对不上。
  // 伊拉克的**强标记**只保留真正指向政权的词：共和国卫队 / 萨达姆 / 复兴党。
  // 裸的「伊拉克 / iraq」是弱标记（见 NATION_WEAK_RULES）—— 它既是国名也是战区名，
  // 「联军战斗医护兵（伊拉克）」「US Marine (Iraq)」里的伊拉克指的是**战场**。
  ['iraqi', /共和国卫队|萨达姆|复兴党|republican guard|saddam|baath/i],
  // 这里**不能**写裸的 `海军陆战队` / `陆战队`：那不是美国专有的。
  // 「敌方海军陆战队员（Adversary Naval Infantryman）」「轨道陆战队员（Orbital Marine）」
  // 「轨道陆战队医务兵（Orbital Corpsman）」都会命中，于是敌方被标成美军、轨道兵被标成美军
  // ——定妆表上直接出现「反方势力 · 美军」。真正属于美军的资产（美国海军陆战队员 /
  // 美军海军陆战队喷火兵 / USMC Flamethrower Operator）都带 美国 / 美军 / usmc 标记，
  // 由下面的显式标记命中即可。
  ['us', /美军|美国|游骑兵|伞兵|美(?:国|军)海军陆战队|usmc|\bus\b|american|u\.s\.|sherman|hellcat|dauntless|catalina|fletcher|iowa|patton|abrams|phantom|huey|thunderbolt|liberator/i]
];

/**
 * 弱国籍标记：既是国名、也是战区名的词。只在**非友军阵营**资产上才作数。
 *
 * 为什么必须分强弱：「伊拉克」在联军资产上指的是**战场** ——
 * 「联军战斗医护兵（伊拉克）」＝在伊拉克作战的联军医护兵，「US Marine (Iraq)」同理。
 * 若一律按国名处理，这两个都会被判成伊军，于是「伊拉克战争城市清剿」里
 * 我方联军被标成伊军、与敌方同国籍（定妆表上直接自相矛盾）。
 * 而在敌方资产上，「伊拉克指挥官」就是伊拉克指挥官 —— 此时弱标记成立。
 */
const NATION_WEAK_RULES = [
  ['iraqi', /伊拉克|iraq/i]
];

/**
 * 判定资产的具体国籍；无法判定时返回 null（调用方应把 null 视为「不限制」）。
 * @param {object} asset 资产
 * @returns {'soviet'|'british'|'german'|'japanese'|'french'|'iraqi'|'us'|null}
 */
export function nationOf(asset) {
  if (!asset) return null;
  // 括号里的内容通常是**战场/战区**标注，不是国籍标注，先剥掉再做匹配。
  const hay = `${asset.nameZh || ''} ${asset.name || ''} ${asset.kw || ''}`
    .replace(/[（(][^）)]*[）)]/g, ' ');

  // 第一轮：强标记（美军 / 德军 / 共和国卫队 …），与阵营无关，命中即可判定
  for (const [key, re] of NATION_RULES) {
    if (re.test(hay)) return key;
  }
  // 第二轮：弱标记。友军阵营的「伊拉克」一定是战区，不作数。
  if (!FRIENDLY_FACTIONS.has(asset.faction)) {
    for (const [key, re] of NATION_WEAK_RULES) {
      if (re.test(hay)) return key;
    }
  }
  return null;
}

/**
 * 国籍键 → 中文短标签。用于定妆表卡片与全家福 Prompt。
 *
 * 为什么需要：国籍一致性（敌我分属不同国籍、同阵营内部统一）是 6.6.0 修掉的一类
 * 穿帮，但界面上一直只显示 `series`（时代），用户无从核对「我方全是美军、敌方全是
 * 伊军」这条约束是否真的生效。显示出来才能被验证。
 */
const NATION_LABELS_ZH = {
  us: '美军',
  british: '英军',
  soviet: '苏军',
  german: '德军',
  japanese: '日军',
  french: '法军',
  iraqi: '伊军'
};

/** 国籍中文标签；无法判定时返回空串（调用方自行决定是否显示） */
export function nationLabelOf(entry) {
  const key = typeof entry === 'string' ? entry : entry?.nation;
  return (key && NATION_LABELS_ZH[key]) || '';
}

/**
 * 题材里点名的参战国。只用于二战 / 太平洋这类「同阵营内部多国混编」的时代；
 * 现代题材的联军本来就是多国部队，不做这一层限制。
 */
const NATION_HINTS = [
  ['soviet', /斯大林格勒|库尔斯克|莫斯科|列宁格勒|东线|苏军|苏联|红军|kursk|stalingrad/i],
  ['british', /英军|英国|不列颠|蒙哥马利|阿拉曼|敦刻尔克|皇家空军|british|dunkirk|el alamein/i],
  ['us', /美军|美国|诺曼底|奥马哈|犹他海滩|巴顿|太平洋|中途岛|硫磺岛|冲绳|瓜岛|塞班|normandy|midway|iwo jima|okinawa|guadalcanal/i],
  ['french', /法军|法国|抵抗组织|french resistance/i]
];

/** 由题材推断参战国；无法判定返回 null */
export function nationHintOf(theme) {
  const hay = String(theme || '');
  for (const [key, re] of NATION_HINTS) {
    if (re.test(hay)) return key;
  }
  return null;
}

/**
 * 个人姓名池（按国籍分）。
 *
 * 为什么需要它：代号（【CAPTAIN】）只是身份锚点，不是「人」。
 * 「【MERIDIAN】动力外骨骼特战队员」观众记不住；「【MERIDIAN】科瓦奇」才是一个角色。
 * 姓名按国籍取，避免给苏军角色起一个英美名字这种低级穿帮。
 *
 * defaultFriendly / defaultOpposing 这两级兜底**必须分开**：
 * 早期只有一个 default 池，于是一部现代题材里「我方突击队长」与「敌方指挥官」
 * 会从同一个池子抽名字，两个米勒同框；更糟的是中东战场的敌方指挥官抽到「桥本」。
 * 国籍判不出来时，至少阵营不能混。
 */
const PERSONA_NAMES = {
  us: ['米勒', '哈里森', '邓肯', '沃克', '佩德罗', '奥尔特加', '凯恩', '兰斯', '雷诺兹', '布莱迪'],
  british: ['阿什顿', '哈格里夫斯', '克劳福德', '布莱克', '诺里斯', '埃文斯', '惠特克', '莫里斯'],
  soviet: ['科瓦奇', '伊万诺夫', '谢尔盖', '沃尔科夫', '列别杰夫', '莫罗佐夫', '库兹涅佐夫', '彼得罗夫'],
  german: ['施密特', '克劳斯', '雷曼', '沃尔夫', '鲍尔', '凯斯勒', '霍夫曼', '布兰特'],
  japanese: ['山本', '桥本', '佐藤', '中村', '小林', '高田', '石井', '森田'],
  french: ['杜兰', '勒克莱尔', '莫罗', '拉方', '贝尔纳', '吉拉尔'],
  iraqi: ['哈桑', '卡里姆', '阿卜杜拉', '纳赛尔', '萨利姆', '塔里克', '拉希德', '法里斯'],
  defaultFriendly: ['米勒', '哈里森', '邓肯', '沃克', '佩德罗', '奥尔特加', '凯恩', '兰斯', '雷诺兹', '布莱迪'],
  defaultOpposing: ['科瓦奇', '伊万诺夫', '施密特', '克劳斯', '雷曼', '沃尔夫', '鲍尔', '凯斯勒', '霍夫曼', '布兰特'],
  // 中立（记者 / 平民 / 承包商）不站队，用一个不属于任何一方的中性池
  default: ['阿隆', '罗西', '诺瓦克', '索恩', '维加', '马雷克']
};

/** 职务池（按兵种分）：让小队里每个人在故事里各司其职，而不是一排「作战员」 */
const ROLE_LABELS = {
  Infantry: ['突击队长', '步枪手', '机枪手', '爆破手', '副队长'],
  'Special Forces': ['小队指挥官', '突击手', '破门手', '狙击手', '通信兵'],
  Airborne: ['空降组长', '伞兵', '机枪手', '爆破手'],
  Armor: ['车长', '炮手', '驾驶员', '装填手'],
  Aviation: ['长机飞行员', '僚机飞行员', '武器系统官', '地面引导员'],
  'Naval Aviation': ['长机飞行员', '僚机飞行员', '后座武器官'],
  Naval: ['舰长', '航海长', '损管长', '声呐兵'],
  Command: ['指挥官', '作战参谋', '通信官'],
  Medical: ['军医', '卫生员', '担架兵'],
  Engineer: ['工兵', '爆破手', '架桥手'],
  Reconnaissance: ['侦察组长', '观察手', '狙击手'],
  'Recon / Sniper': ['狙击组长', '观察手', '狙击手'],
  Irregular: ['抵抗组织联络员', '游击队员', '向导'],
  JTAC: ['前沿引导员', '火力协调员'],
  CSAR: ['救援组长', '随机医护', '绞车手'],
  EOD: ['排爆组长', '拆弹手', '机器人操作员'],
  CBRN: ['防化组长', '侦检员'],
  'EW / Cyber': ['电子战官', '频谱分析员'],
  'Air Defense': ['防空组长', '雷达操作员', '发射手'],
  Logistics: ['后勤主管', '补给兵'],
  PMC: ['承包商队长', '承包商射手'],
  'Orbital Infantry': ['轨道突击组长', '舱外作业员', '姿态控制手'],
  'Space Operations': ['空间站指挥官', '系统工程师', '舱外作业员'],
  'Strategic Fires': ['发射指挥员', '发射控制军官', '目标规划员'],
  'Strategic Aviation': ['机长', '副驾驶', '武器系统官'],
  'Strategic Rocket Forces': ['值班指挥官', '发射控制员'],
  'Orbital Marines': ['轨道陆战队长', '突击手', '破门手']
};

const DEFAULT_ROLES = ['队长', '副队长', '机枪手', '爆破手', '通信兵', '医护兵'];

/** 从职务池里取一个本片尚未使用的职务（确定性：由下标决定起点，环形扫描） */
function personaRoleOf(unit, idx, used) {
  const pool = ROLE_LABELS[unit] || DEFAULT_ROLES;
  for (let k = 0; k < pool.length; k++) {
    const candidate = pool[(idx + k) % pool.length];
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  const base = pool[idx % pool.length];
  let n = 2;
  while (used.has(`${base}${n}`)) n += 1;
  const candidate = `${base}${n}`;
  used.add(candidate);
  return candidate;
}

/** 从姓名池里取一个本片尚未使用的姓名 */
function personaNameOf(nation, idx, used) {
  const pool = PERSONA_NAMES[nation] || PERSONA_NAMES.default;
  for (let k = 0; k < pool.length; k++) {
    const candidate = pool[(idx + k) % pool.length];
    if (!used.has(candidate)) { used.add(candidate); return candidate; }
  }
  const base = pool[idx % pool.length];
  let n = 2;
  while (used.has(`${base}${n}`)) n += 1;
  used.add(`${base}${n}`);
  return `${base}${n}`;
}

/**
 * 一方之内出现最多的国籍。
 *
 * 用途：给同一方里**没标国籍**的同伴补姓名池。
 * 「海湾战争」里我方是一水儿美军、敌方是一水儿伊拉克人，但总有几个资产名里
 * 没写国名；按本方多数国籍补齐，比丢进一个敌我不分的兜底池可靠得多。
 */
function dominantNation(entries) {
  const counts = new Map();
  for (const e of entries) {
    if (!e.nation) continue;
    counts.set(e.nation, (counts.get(e.nation) || 0) + 1);
  }
  let best = null;
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n > bestN) { best = key; bestN = n; }
  }
  return best;
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
        // 人物层：代号只是身份锚点，persona 才是「一个人」。
        // 剧本里写「【CAPTAIN】米勒」，比写「【CAPTAIN】美军步兵（二战）」可读得多。
        unit: asset.unit || null,
        persona: '',
        personaRole: '',
        nation: nationOf(asset),
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

  // 姓名与职务只在**人仔**之间分配：载具不该有姓名，也不该占掉「机枪手」这种职务。
  const usedNames = { coalition: new Set(), opposing: new Set(), neutral: new Set() };
  const usedRoles = { coalition: new Set(), opposing: new Set(), neutral: new Set() };

  // 本片每一方的「主导国籍」：给没标国籍的同伴补姓名池（详见 dominantNation 注释）
  const sideNation = {
    coalition: dominantNation(all.filter(e => e.side === 'coalition')),
    opposing: dominantNation(all.filter(e => e.side === 'opposing')),
    neutral: null
  };

  // 敌我同国籍是自相矛盾的：战争片的对立阵营按定义就不是同一个国家。
  // 两侧由「本方多数国籍」推出来的国籍若撞在一起，说明至少一侧推错了 ——
  // 此时放弃敌方的推断（退回 defaultOpposing 姓名池、不显示国籍）。
  // 宁可留空，也不能在定妆表上把反方势力标成「美军」。
  if (sideNation.coalition && sideNation.opposing && sideNation.coalition === sideNation.opposing) {
    sideNation.opposing = null;
  }

  // 第二遍：**按资产 ID 升序**分配代号。
  // 这一步必须与出场顺序无关，否则「规划器生成时算出的代号」会和「事后 buildRoster
  // 重新聚合时算出的代号」不一致 —— 分镜里写着 GHOST，定妆表里却变成 FALCON。
  const ordered = [...all].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  ordered.forEach((entry, idx) => {
    const asset = registry?.byId?.get(entry.id);
    const side = entry.side === 'opposing' ? 'opposing' : 'coalition';

    const priorCall = inherited.get(entry.id);
    if (priorCall && !taken.has(priorCall)) {
      entry.callsign = priorCall;
      taken.add(priorCall);
    } else {
      // 已占用集合 = 本版已分配 ∪ 历史保留（防止新角色复用别人的代号）
      entry.callsign = assignCallsign(asset, side, new Set([...taken, ...reserved]));
      taken.add(entry.callsign);
    }

    if (entry.kind !== 'character') return;
    const bucket = entry.side === 'opposing' ? 'opposing' : (entry.side === 'neutral' ? 'neutral' : 'coalition');
    // 国籍优先级：资产自身标记 > 本方多数国籍 > 按阵营分的兜底池。
    // 最后一级必须分阵营，否则敌方指挥官会抽到我方名字池里的名字（详见 PERSONA_NAMES 注释）。
    const inferred = entry.nation || sideNation[bucket] || null;
    const pool = inferred || (bucket === 'opposing' ? 'defaultOpposing' : (bucket === 'neutral' ? 'default' : 'defaultFriendly'));
    entry.persona = personaNameOf(pool, idx, usedNames[bucket]);
    entry.personaRole = personaRoleOf(entry.unit, idx, usedRoles[bucket]);
    // 由本方多数国籍推断出来的国籍要回填：定妆表才能显示「美军 / 伊军」，而不是一片空白
    if (!entry.nation && inferred) entry.nation = inferred;
  });

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
      unit: raw.unit || null,
      persona: raw.persona || '',
      personaRole: raw.personaRole || '',
      nation: raw.nation || null,
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
 * 角色在界面上「叫什么」的唯一口径。
 *
 * 为什么必须只有一处：名册条目同时带着两个名字 —— `name`（资产名，如「弹道导弹
 * 核潜艇艇长」，那是**单位类型**）与 `persona`（人物姓名，如「邓肯」）。剧本正文、
 * 定妆表卡片、全家福生图 Prompt、时间轴导出如果各自决定用哪个，就会出现「剧本里
 * 是邓肯、定妆表里是潜艇艇长」这种同片两套口径的串戏。6.7.0 引入 persona 后，
 * 剧本层已统一，但定妆表与生图 Prompt 仍在使用 `name`，本函数即为收口点。
 *
 * 优先级：persona（一个具体的人）> name / nameZh（资产名）> id。
 * 载具没有 persona，自然退回资产名，不需要特判。
 *
 * @param {object} entry 名册条目（buildRoster 产物）或任何带这些字段的对象
 * @returns {string} 非空显示名
 */
export function displayNameOf(entry) {
  if (!entry) return '';
  return entry.persona || entry.name || entry.nameZh || String(entry.id ?? '') || '未知角色';
}

/**
 * 生成「【代号】人物姓名 (真实ID)」标签。没有名册命中时原样返回 ID，
 * 保证任何调用点都不会因为缺名册而崩或显示空白。
 */
export function labelFor(roster, id, { withId = true } = {}) {
  const entry = roster?.byId?.get(id);
  if (!entry) return String(id ?? '');
  return `【${entry.callsign}】${displayNameOf(entry)}${withId ? ` (${id})` : ''}`;
}

/** 只取代号；无名册命中时返回空串（便于调用方自行兜底） */
export function callsignOf(roster, id) {
  return roster?.byId?.get(id)?.callsign || '';
}

/**
 * 生成「【代号】人名」短标签（不带 ID），用于卡片与脚本正文。
 * 有 persona（人物姓名）时优先用它 —— 剧本里出现的是「【CAPTAIN】米勒」，
 * 而不是「【CAPTAIN】美军步兵（二战）」这种单位类型，观众才记得住角色。
 * 没有名册命中时退化为纯名称，保证任何调用点都不会显示空白。
 */
export function aliasLabel(roster, id, fallbackName = '') {
  const entry = roster?.byId?.get(id);
  if (!entry) return String(fallbackName || id || '');
  return `【${entry.callsign}】${displayNameOf(entry)}`;
}

/**
 * 把名册渲染成可注入 Prompt 的英文演员表行。
 *
 * 必须带上 persona：大模型要靠它写出「邓肯，你左边」这种一致的台词。早期只给
 * `nameEn`（如 "Navy SEAL"），模型拿到的是兵种而不是人，写出来的对白自然也没有人。
 * 格式保持 `[CALLSIGN] 人物名 "资产名" (ID) — 职务`，末尾三段是既有契约，不要动。
 *
 * @param {object} roster buildRoster 的产物
 * @returns {string[]} 演员表行
 */
export function rosterPromptLines(roster) {
  const lines = [];
  const fmt = (list) => list
    .map(e => {
      const person = displayNameOf(e);
      const asset = e.nameEn && e.nameEn !== person ? ` "${e.nameEn}"` : '';
      return `[${e.callsign}] ${person}${asset} (${e.id}) — ${e.role}`;
    })
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
    // 轨道域必须排在最前：`太空战机` 里含「战机」、`轨道轰炸机` 里含「轰炸机」，
    // 若排在 air 之后会被 air 截走，于是轨道题材永远拿不到本域的镜头与演员。
    // （此前 DOMAIN_RULES 根本没有 orbital，导致 story.js 里所有 domains:['orbital']
    //   的质感节拍是**不可达的死代码**，轨道片一直在用陆战通用池。）
    key: 'orbital',
    classes: ['aircraft', 'ground', 'ship', 'drone', 'ugv'],
    re: /orbital|astronaut|zero-?g|space ?(?:station|craft|marine|warfare|walk)|近地轨道|地球轨道|轨道|太空|航天|宇航|空间站|零重力|失重|气闸舱|舱外|月面/i,
    // 角色专用关键词：轨道题材里上镜的应该是宇航员与轨道陆战队员，而不是地面步兵。
    charRe: /orbital|astronaut|zero-?g|space|轨道|太空|航天|宇航|空间站|零重力|失重|舱外|月面/i
  },
  {
    key: 'naval',
    classes: ['ship', 'submarine'],
    re: /navy|naval|\bship\b|fleet|carrier|destroyer|frigate|cruiser|submarine|warship|ocean|sea|maritime|amphibious|torpedo|sonar|海军|舰|航母|潜艇|驱逐舰|护卫舰|巡洋舰|舰队|海上|远海|深海|两栖|登陆舰|鱼雷|声纳|水雷/i,
    // 角色专用关键词：海军题材里上镜的应该是舰员与潜水员，而不是步兵班长。
    charRe: /navy|naval|marine|sailor|deck|submarine|sonar|diver|coxswain|舰|艇|海军|船员|水兵|声呐|潜水|登陆/i
  },
  {
    key: 'air',
    classes: ['aircraft', 'helicopter', 'drone'],
    re: /air ?force|aircraft|bomber|fighter|\bjet\b|airbase|airborne|aerial|air superiority|sortie|stealth|aviation|空军|轰炸机|轰炸|战斗机|战机|制空|空中|空袭|空战|僚机|加油机|预警机|侦察机|直升机|伞降|空降/i,
    // 角色专用关键词：制空题材里上镜的应该是飞行员与引导员，而不是战斗工兵与潜水员。
    charRe: /aviation|pilot|aviator|flight|aircrew|airborne|\bjtac\b|\bwso\b|\bcsar\b|\buas\b|air defense|counter-uas|航空|飞行|领航|伞降|空降|引导|防空/i
  },
  {
    key: 'strategic',
    classes: ['ground', 'ship', 'aircraft'],
    re: /icbm|intercontinental|ballistic missile|missile silo|\bsilo\b|nuclear deterrent|strategic (?:strike|deterrence|rocket|bomber)|洲际|弹道导弹|发射井|战略打击|战略轰炸|核威慑|导弹基地|战略值班/i,
    // 这里**不能**写裸的 `strategic` / `command`：单位名 "Strategic Aviation"
    // （战略轰炸机机组）会把空战域的角色误判成战略火箭军，在制空题材里被跨域惩罚扣分，
    // 结果「B-2 轰炸敌方雷达站」的主角变成无人机操作员。只认真正与导弹/火箭连用的组合。
    charRe: /missile|rocket|silo|launch control|icbm|strategic (?:rocket|fires|missile)|导弹|火箭|发射井|发射控制|战略火力|核打击/i
  },
  {
    key: 'ground',
    classes: ['ground', 'ugv'],
    re: /\btank\b|armou?r|infantry|urban|\bcity\b|street|convoy|artillery|装甲|坦克|步兵|巷战|城市|街区|车队|炮兵|阵地|堑壕/i,
    // 这里**不能**写成 `\bcrew\b`：ARCHETYPE_RULES 已经踩过一次同样的坑
    // （"Armour Crew" 之外还有 "Carrier Deck Crew"）。写成 \bcrew\b 会让
    // 「航母甲板人员（黄衫）」在陆战题材里拿到 +10，把真正的飞行员挤出去。
    // 因此只认与装甲明确连用的组合。
    charRe: /infantry|rifle|armou?r|tank|tank ?crew|armou?red ?crew|assault|sniper|recon|步兵|坦克|装甲|车组|突击|狙击|侦察|游骑/i
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
  const hay = assetText(asset).toLowerCase();
  let score = 0;
  if (asset?.class && domain.classes.includes(asset.class)) score += 10;
  // 角色没有 class 字段（class 是载具概念）。若角色也沿用载具关键词，
  // 制空题材里的「战斗机」会把「战斗工兵」一并命中，飞行员永远排不到前面。
  // 因此角色走 charRe（兵种关键词），载具走 re（装备关键词）。
  const re = (asset?.kind === 'character' && domain.charRe) ? domain.charRe : domain.re;
  // 角色的域信号必须与载具的类别匹配同权（+10）：否则会被 themeMatch 里
  // 「战斗工兵」与「战斗机」共享的「战斗」二字（+6）盖过去，飞行员永远排不上来。
  if (re.test(hay)) score += (asset?.kind === 'character') ? 10 : 4;

  // 跨域惩罚（只作用于角色）。
  //
  // 起因：题材「海湾战争夜战防空导弹阵地伏击」识别为 air 域，候选池凑不满名额时，
  // 剩下的位置按 ID 升序硬填，于是「航母甲板人员（黄衫）」（unit = Navy）被拉进了
  // 沙漠阵地，第 7 镜里一个航母甲板兵站在打空的导弹阵地上收枪 —— 一眼假。
  // 角色同时命中**另一个**域的兵种关键词时扣分，让它自然沉底。
  //
  // 扣 6 而不是扣满 10：必须**小于**本域的命中分，否则「舰队题材里的舰载机飞行员」
  // 这类合法的跨域兵种（naval + aviation 双命中）会被自己人挤掉。
  // 载具不做这一步：载具的 class 已经是强信号（+10），再罚会误伤合法跨域资产。
  if (asset?.kind === 'character') {
    for (const other of DOMAIN_RULES) {
      if (other.key === domain.key) continue;
      const ore = other.charRe || other.re;
      if (ore.test(hay)) score -= 6;
    }
  }
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
function pickDiverse(pool, limit, domain = null, keyOf = null) {
  const out = [];
  const used = new Set();
  const clsOf = keyOf || ((a) => a?.class || a?.kind || 'other');
  // domain 既可以是战场域对象，也可以是「是否属于本片首选装备」的判定函数。
  // 后者用于「任务原型点名了装备、但没有对应战场域」的情形（例如抢滩要登陆艇）。
  const inDomain = typeof domain === 'function'
    ? domain
    : ((a) => !!domain && domain.classes.includes(a?.class));
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
export function selectCast(registry, { era = 'Modern', task = 'combat', theme = '', setting = '', vehicleHint = null, maxHeroes = 4, maxEnemies = 3, maxVehicles = 3 } = {}) {
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

  const rankVehicles = (list) => {
    const hint = vehicleHint ? (vehicleHint instanceof RegExp ? vehicleHint : new RegExp(vehicleHint, 'i')) : null;
    return [...list].sort((a, b) => {
      const hintA = hint && hint.test(assetText(a)) ? 8 : 0;
      const hintB = hint && hint.test(assetText(b)) ? 8 : 0;
      // 国籍偏好是**弱信号**（+3）：它只在同分时起作用，绝不能压过任务原型的装备点名（+8）。
      // 早期把它写成排序后再做一次稳定排序，结果「抢滩要登陆艇」被「登陆艇不是美军制式」顶掉，
      // 诺曼底片里出现的是 M4 谢尔曼坦克「撞开反登陆障碍」。
      const nationA = nationWanted && nationScoped && nationOf(a) === nationWanted ? 3 : 0;
      const nationB = nationWanted && nationScoped && nationOf(b) === nationWanted ? 3 : 0;
      const da = domainScore(a, domain) + themeMatch(a, theme) + hintA + nationA;
      const db = domainScore(b, domain) + themeMatch(b, theme) + hintB + nationB;
      if (da !== db) return db - da;
      const ta = taskAffinity(a, task) ? 0 : 1;
      const tb = taskAffinity(b, task) ? 0 : 1;
      if (ta !== tb) return ta - tb;
      return a.id < b.id ? -1 : (a.id > b.id ? 1 : 0);
    });
  };

  // 角色同样吃战场域：海军题材优先舰艇船员/潜水员，空战题材优先飞行员/引导员，
  // 否则「核潜艇」题材里上镜的仍会是步兵班长与核生化专家。
  //
  // 国籍一致性：二战 / 太平洋的盟军内部还有美军、苏军、英军、法国抵抗组织。
  // 仅按 faction 选角会拼出「美军步兵 + 苏军政委 + 英军步兵」同框的诺曼底 —— 一眼假。
  // 因此先按题材（或排名第一的角色）确定本片国籍，再在同国籍内挑选。
  const nationScoped = (era === 'WWII' || era === 'Pacific');
  const heroPool = rank(bySide(characters, 'coalition'));
  const nationWanted = nationScoped
    ? (nationHintOf(theme) || nationOf(heroPool[0]) || null)
    : null;
  const nationPool = (nationWanted && nationScoped)
    ? heroPool.filter(a => nationOf(a) === nationWanted)
    : [];
  // 过滤后至少要有 2 人，否则放弃这一层限制（宁可混编，也不能让名册空掉）
  const heroCandidates = nationPool.length >= 2 ? nationPool : heroPool;

  // 兵种多样性：小队里每人一个职务（队长 / 机枪手 / 爆破手 / 医护兵…），
  // 而不是一排「作战员」。这直接决定剧本里能不能写出「谁在做什么」。
  const heroes = pickDiverse(heroCandidates, maxHeroes, null, a => a?.unit || 'character');

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
  const vehiclePool = rankVehicles(coalitionVehicles.concat(namedOpposing));

  // 战场域优先；没有战场域时（例如「抢滩」既不是海战也不是陆战），
  // 退化为「任务原型的装备偏好」——否则多样性规则会把登陆艇挤掉、只留坦克。
  const hintRe = vehicleHint
    ? (vehicleHint instanceof RegExp ? vehicleHint : new RegExp(vehicleHint, 'i'))
    : null;
  const diversityScope = domain || (hintRe ? ((a) => hintRe.test(assetText(a))) : null);
  const chosenVehicles = pickDiverse(
    vehiclePool.length ? vehiclePool : rankVehicles(vehicles),
    maxVehicles,
    diversityScope
  );

  return {
    heroes, enemies, vehicles: chosenVehicles, enemyFallback, era,
    domain: domain ? domain.key : null,
    nation: nationWanted || null
  };
}
