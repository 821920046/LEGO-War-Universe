/**
 * LEGO War Universe - 叙事变奏与原创引擎 v1.0 (Narrative Variation & Originality)
 *
 * 解决的问题（第一性原则）：
 *   1. 重复 —— 早期本地规划器对全片只用「一个主体 + 一句模板动作」，8 个镜头看起来像 1 个镜头复制 8 遍。
 *      根因是「主体/摄影机/动作」在规划期就是常量。修法：把它们变成**逐镜变量**，
 *      并以「同一阶段内不重复使用同一节拍模板」为硬约束。
 *   2. 不像智能 —— 早期脚本只是把参考电影的桥段照搬。修法：引入**原创层**，
 *      由主题派生独立的 logline / 转折 / 开场钩子，参考片只作为视听语言的致敬对象。
 *
 * 所有随机都走确定性种子（fnv1a + mulberry32），同一主题每次生成结果一致，便于复现与测试。
 */

import { fnv1a } from './roster.js';

/** 四阶段叙事顺序（与 shot-spec 的 PHASE_ORDER 对齐） */
export const PHASES = ['establish', 'build', 'climax', 'resolve'];

/** 确定性 PRNG —— 同一 seed 永远产出同一序列 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 由任意字符串派生稳定种子 */
export function seedOf(str) {
  return fnv1a(str);
}

/** 用种子对数组做确定性洗牌（不改原数组） */
export function seededShuffle(list, seed) {
  const out = [...list];
  const rand = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * 节拍模板库。
 *
 * focus 语义：
 *   hero    —— 主角单人或主观视角
 *   squad   —— 两名友军协同（需要 support）
 *   vehicle —— 载具为主（需要 vehicle）
 *   clash   —— 正反同框交战（需要 enemy；动作必须含交战语义，否则触发阵营冲突校验）
 *   enemy   —— 敌方为主视角（需要 enemy；同样必须含交战语义）
 *
 * 占位符：{hero}{heroCallsign}{support}{supportCallsign}{enemy}{enemyCallsign}{vehicle}{env}{weather}
 */
const BEATS = [
  // ---------- establish ----------
  { id: 'est-hero-1', phase: 'establish', focus: 'hero', shotType: '环境铺陈全景 (Establishing Wide)',
    action: '{heroCallsign} 率队进入 {env}，压低身形展开扇形搜索，{weather}里只剩装备摩擦与呼吸声。',
    audioCue: '空旷环境底噪 · 战术装备轻微摩擦声', radioVoice: '【无线电】已进入目标区域，保持无线电静默，注意两侧高点。' },
  { id: 'est-hero-2', phase: 'establish', focus: 'hero', shotType: '战术手势中近景 (Hand Signal Medium)',
    action: '{heroCallsign} 半跪在 {env} 的断墙后展开战术地图，指尖划过目标点，{weather}把所有声音都压得很低。',
    audioCue: '纸张摩擦 · 低频环境轰鸣', radioVoice: '【无线电】目标点确认，两组分头包抄，十分钟后同步。' },
  { id: 'est-hero-3', phase: 'establish', focus: 'hero', shotType: '静默校准特写 (Silent Zeroing Close-Up)',
    action: '{heroCallsign} 蹲在 {env} 的阴影里校准瞄具，呼吸压到最低，{weather}替他掩去了大半轮廓。',
    audioCue: '瞄具微调咔哒声 · 压抑的呼吸', radioVoice: '【无线电】我已就位，等我的信号。' },
  { id: 'est-hero-4', phase: 'establish', focus: 'hero', shotType: '低姿渗透跟拍 (Low Crawl Tracking)',
    action: '{heroCallsign} 独自沿 {env} 的排水沟低姿爬行，每前进几米就停下来听一次四周动静。',
    audioCue: '衣物摩擦泥土 · 远处零星金属碰撞', radioVoice: '【无线电】保持静默，我在往里摸。' },
  { id: 'est-squad-1', phase: 'establish', focus: 'squad', shotType: '交替跃进中景 (Bounding Overwatch)',
    action: '{heroCallsign} 与 {supportCallsign} 一前一后交替跃进，在 {env} 边缘建立临时观察位。',
    audioCue: '脚步落地声 · 枪械保险轻响', radioVoice: '【无线电】我到位了，掩护你前进。' },
  { id: 'est-vehicle-1', phase: 'establish', focus: 'vehicle', shotType: '载具低角度跟拍 (Low Vehicle Tracking)',
    action: '{vehicle} 低吼着碾过 {env}，车灯在 {weather}中切出两道长锥，{heroCallsign} 探头确认前方通路。',
    audioCue: '重载发动机低频轰鸣 · 履带/轮胎碾压碎石', radioVoice: '【无线电】车组就位，可以开始推进。' },
  { id: 'est-enemy-1', phase: 'establish', focus: 'enemy', shotType: '敌方视角远摄 (Enemy POV Telephoto)',
    action: '{enemyCallsign} 的巡逻队在 {env} 另一侧列队经过，尚未察觉阴影里已经架起的枪口——{heroCallsign} 静静等待伏击时机。',
    audioCue: '远处口令声 · 风声掩盖脚步', radioVoice: '【无线电】敌人在动，等他们全部进入杀伤区。' },
  { id: 'est-vehicle-2', phase: 'establish', focus: 'vehicle', shotType: '隐蔽待机特写 (Concealed Idle Close-Up)',
    action: '{vehicle} 在 {env} 外缘熄火待机，{heroCallsign} 借着掩护用测距仪标定第一个目标，镜头贴近积木接缝。',
    audioCue: '金属冷却滴答声 · 电子测距提示音', radioVoice: '【无线电】距离已锁定，等待开火命令。' },

  // ---------- build ----------
  { id: 'bld-clash-1', phase: 'build', focus: 'clash', shotType: '遭遇交火手持近景 (Contact Handheld)',
    action: '{heroCallsign} 与 {enemyCallsign} 的哨兵在 {env} 拐角正面遭遇，双方几乎同时开火，短促交火撕裂 {weather}。',
    audioCue: '突击步枪连射 · 弹壳落地脆响', radioVoice: '【无线电】接触！接触！两点钟方向，压制他们！' },
  { id: 'bld-hero-1', phase: 'build', focus: 'hero', shotType: '掩体推进贴身跟拍 (Cover-to-Cover Push)',
    action: '{heroCallsign} 贴着 {env} 的掩体侧身推进，每三步一次火力压制，弹壳在积水上跳开。',
    audioCue: '点射节奏 · 跳弹与碎石声', radioVoice: '【无线电】我在推进，火力别停！' },
  { id: 'bld-hero-2', phase: 'build', focus: 'hero', shotType: '换弹间隙贴身特写 (Reload Under Fire)',
    action: '{heroCallsign} 换弹匣的间隙被流弹擦过墙面，他贴着 {env} 的钢筋缩身，重新架枪继续推进。',
    audioCue: '弹匣脱落与上膛 · 跳弹擦墙', radioVoice: '【无线电】我在换弹，帮我顶十秒！' },
  { id: 'bld-hero-3', phase: 'build', focus: 'hero', shotType: '负伤推进长镜头 (Wounded Advance One-Take)',
    action: '{heroCallsign} 拖着受伤的腿在 {env} 里挪动，每挪一步就用点射把对面的枪口压回去。',
    audioCue: '沉重拖行声 · 断续点射', radioVoice: '【无线电】我还走得动，别管我。' },
  { id: 'bld-clash-2', phase: 'build', focus: 'clash', shotType: '爆破掀翻升格镜头 (Blast Slow-Motion)',
    action: '{enemyCallsign} 的火箭弹擦着 {vehicle} 车体炸开，{heroCallsign} 把伤员拖进掩体后重新校准射击，向敌人发起反击突袭。',
    audioCue: '爆炸低频轰击 · 随后两秒高频耳鸣', radioVoice: '【无线电】车体受损！医护上来，其余人继续压制！' },
  { id: 'bld-vehicle-1', phase: 'build', focus: 'vehicle', shotType: '载具抢占制高点 (Vehicle Crest Assault)',
    action: '{vehicle} 冲上斜坡抢占制高点，{heroCallsign} 在车尾架起武器向 {env} 深处扫射压制。',
    audioCue: '发动机高转 · 大口径机枪压制扫射', radioVoice: '【无线电】高地已占，视野良好，可以引导打击。' },
  { id: 'bld-enemy-1', phase: 'build', focus: 'enemy', shotType: '敌方伏击突袭 (Enemy Ambush)',
    action: '{enemyCallsign} 从 {env} 高处掷下震爆弹并发起伏击，{heroCallsign} 被冲击波掀翻，耳中只剩尖锐耳鸣。',
    audioCue: '震爆弹闷响 · 耳鸣与心跳', radioVoice: '【无线电】中埋伏了！散开！找掩体！' },
  { id: 'bld-squad-1', phase: 'build', focus: 'squad', shotType: '交叉火力双人调度 (Crossfire Choreography)',
    action: '{heroCallsign} 打出交替掩护手势，{supportCallsign} 越位前出，两人在 {env} 中织出交叉火力网。',
    audioCue: '两侧交替射击 · 战术口令', radioVoice: '【无线电】交叉火力建立，敌人被钉住了！' },

  // ---------- climax ----------
  { id: 'clx-clash-1', phase: 'climax', focus: 'clash', shotType: '零距离对轰主视角 (Point-Blank Duel)',
    action: '{heroCallsign} 与 {enemyCallsign} 在 {env} 正面撞上，双方在几米内直接交战对轰，塑料零件与火星四散飞溅。',
    audioCue: '全自动连射 · 弹壳与碎片四溅', radioVoice: '【无线电】就是现在！全体开火，压制他们！' },
  { id: 'clx-hero-1', phase: 'climax', focus: 'hero', shotType: '孤身突入长镜头 (Solo Breach One-Take)',
    action: '{heroCallsign} 顶着压制冲进开阔地，肩部武器全速连射，{env} 在爆炸中剧烈震颤。',
    audioCue: '持续射击 · 环境结构崩裂声', radioVoice: '【无线电】掩护我！我要冲过去炸掉它！' },
  { id: 'clx-hero-3', phase: 'climax', focus: 'hero', shotType: '孤点死守广角 (Last Stand Wide)',
    action: '{heroCallsign} 在 {env} 的火光中独自顶住整条防线，弹药见底仍不肯后退半步。',
    audioCue: '稀疏而坚决的射击 · 燃烧爆裂声', radioVoice: '【无线电】我钉在这里，谁也别想过去！' },
  { id: 'clx-hero-4', phase: 'climax', focus: 'hero', shotType: '纵身跃下升格 (Leap Slow-Motion)',
    action: '{heroCallsign} 从 {env} 的断口纵身跃下，落地翻滚的同时举枪指向最后的目标方向。',
    audioCue: '风声与衣料撕裂 · 落地闷响', radioVoice: '【无线电】我下来了，往哪打？' },
  // 注意：clash/enemy 节拍的 action **必须**含 shot-spec 的敌对语义关键词（交战/开火/对抗/突袭…），
  // 否则校验器看到「正反双方同框却没有敌对语义」会判定 FACTION_CONFLICT_INVALID，
  // 编译阶段直接抛错。此前本条写作「贴身缠斗…硬撼」，正是踩了这个坑。
  { id: 'clx-clash-2', phase: 'climax', focus: 'clash', shotType: '贴身缠斗微距 (Point-Blank Grapple)',
    action: '{heroCallsign} 与 {enemyCallsign} 贴身缠斗、近身对抗，枪械被打飞后改用工程工具硬撼，{weather}中全是金属摩擦的尖啸。',
    audioCue: '金属剧烈摩擦 · 急促喘息', radioVoice: '【无线电】别管我，完成任务！' },
  { id: 'clx-vehicle-1', phase: 'climax', focus: 'vehicle', shotType: '载具强突核心 (Vehicle Breach)',
    action: '{vehicle} 撞穿 {env} 的路障直插核心，{heroCallsign} 在颠簸中完成最后装填。',
    audioCue: '撞击碎裂 · 装填机械咔嚓声', radioVoice: '【无线电】撞进去了！准备下车强攻！' },
  { id: 'clx-enemy-1', phase: 'climax', focus: 'enemy', shotType: '敌方引爆反扑 (Enemy Counterattack)',
    action: '{enemyCallsign} 引爆预设炸药发动反扑，{env} 整片塌陷，{heroCallsign} 在坠落的积木碎块间强行稳住身形继续对抗。',
    audioCue: '连环爆炸 · 结构垮塌低频', radioVoice: '【无线电】地面在塌！抓住固定物！' },
  { id: 'clx-hero-2', phase: 'climax', focus: 'hero', shotType: '一击决胜特写 (The Decisive Shot)',
    action: '{heroCallsign} 抓住唯一的窗口，一发命中 {enemyCallsign} 的火力点，爆炸的冲击波把两人同时掀倒。',
    audioCue: '单发命中 · 随后骤然静默', radioVoice: '【无线电】命中！目标火力点已瘫痪！' },

  // ---------- resolve ----------
  { id: 'res-hero-1', phase: 'resolve', focus: 'hero', shotType: '残骸之巅静默收尾 (Silent Aftermath)',
    action: '{heroCallsign} 站在 {env} 的残骸顶端，摘下头盔，{weather}慢慢冲淡了硝烟。',
    audioCue: '风声渐起 · 低沉克制的配乐', radioVoice: '【无线电】阵地已肃清，任务完成。' },
  { id: 'res-squad-1', phase: 'resolve', focus: 'squad', shotType: '互相搀扶撤离 (Extraction Walk)',
    action: '{heroCallsign} 与 {supportCallsign} 互相搀扶着穿过 {env}，身后是仍在燃烧的战场。',
    audioCue: '沉重脚步 · 远处零星燃烧声', radioVoice: '【无线电】所有人都带回来了，一个都没落下。' },
  { id: 'res-vehicle-1', phase: 'resolve', focus: 'vehicle', shotType: '载具远去长镜头 (Departure Long Shot)',
    action: '{vehicle} 载着归队的队员缓缓驶离 {env}，{heroCallsign} 回头望向逐渐安静的天际线。',
    audioCue: '发动机低鸣远去 · 无线电静噪', radioVoice: '【无线电】全员登车，返航。' },
  { id: 'res-hero-2', phase: 'resolve', focus: 'hero', shotType: '信号标记特写 (Signal Marker Close-Up)',
    action: '{heroCallsign} 在 {env} 上点亮信号标记，救援部队的灯光在 {weather}中由远及近。',
    audioCue: '信号灯电子音 · 直升机桨叶由远及近', radioVoice: '【无线电】标记已点亮，救援可以进场。' },
  { id: 'res-enemy-1', phase: 'resolve', focus: 'enemy', shotType: '最后清剿收束 (Final Sweep)',
    action: '{enemyCallsign} 的残部仍据守 {env} 一角负隅顽抗，{heroCallsign} 率队发起最后的清剿突袭。',
    audioCue: '短促点射 · 随后彻底安静', radioVoice: '【无线电】最后一个火力点已清除，战区安全。' },
  { id: 'res-hero-3', phase: 'resolve', focus: 'hero', shotType: '手套特写收镜 (Glove Close-Up Outro)',
    action: '镜头停在 {heroCallsign} 的手上——沾满灰烬的积木手套缓缓松开，远处传来收队的无线电。',
    audioCue: '无线电收队呼叫 · 环境音渐弱', radioVoice: '【无线电】收队，回家。' },
  { id: 'res-hero-4', phase: 'resolve', focus: 'hero', shotType: '摘机静默特写 (Radio Off Close-Up)',
    action: '{heroCallsign} 摘下通讯耳机，{weather}里只剩下自己的呼吸和远处零星的燃烧声。',
    audioCue: '耳机摘下时的电流断响 · 风声', radioVoice: '【无线电】（已断开）' },
  { id: 'res-hero-5', phase: 'resolve', focus: 'hero', shotType: '清点收束中景 (Roll Call Medium)',
    action: '{heroCallsign} 蹲在 {env} 一角清点弹药与人数，把散落的铭牌逐一收进口袋。',
    audioCue: '金属铭牌相碰 · 极低的弦乐', radioVoice: '【无线电】名单核对完了，我们走。' }
];

/** 变奏后缀池：给「撞车」的镜头补一个独一无二的细节，消除文本重复 */
const VARIATION_SUFFIXES = [
  '（镜头贴近积木注塑合缝线，微距呈现塑料颗粒反光）',
  '（切换为超低机位贴地视角，前景有积木碎块掠过）',
  '（改为手持剧烈晃动，快门开角抽帧顿挫）',
  '（拉远为高空俯瞰，人物缩成积木般的小点）',
  '（推进至头盔面罩反射，画面边缘出现塑料划痕）',
  '（切换热成像伪彩，冷热反差强烈）',
  '（改为长焦压缩空间，前后景叠成一层）',
  '（加入雨水/尘土在镜头前的实拍遮挡）'
];

/** 替换 {placeholder}；未提供的占位符原样保留以便排查 */
export function fillTemplate(text, ctx = {}) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (m, key) => (
    ctx[key] !== undefined && ctx[key] !== null && ctx[key] !== '' ? String(ctx[key]) : m
  ));
}

/**
 * 溢出变奏的前置机位短句。
 *
 * 为什么需要它：BEATS 是手写模板，数量有限；而一部片子最多可以有 150 个镜头。
 * 当某个阶段的节拍池被镜头数用尽时，早期实现用 `pool[k % pool.length]` 循环取用，
 * 于是同一阶段里出现了**完全相同的 action 文本** —— 这正是用户反馈的「脚本重复」。
 * 现在改为：池内取尽后派生出「同节拍、不同机位」的变奏节拍，id 唯一、文本不重复。
 */
const FRAMING_PREFIXES = [
  '镜头压低到积木注塑接缝的高度：',
  '改用长焦从远处压缩空间：',
  '切换为手持剧烈晃动的主观视角：',
  '拉成一条不间断的长镜头：',
  '从高空俯瞰俯冲而下：',
  '改为贴身跟拍，几乎贴住头盔：',
  '用极浅景深把背景压成一片光斑：',
  '改成固定机位的对称构图：'
];

/** 按可用性（敌人 / 僚机 / 载具）过滤出全库可用节拍 */
function usableBeats({ hasEnemy = false, hasSupport = false, hasVehicle = false } = {}) {
  return BEATS.filter(b => {
    if ((b.focus === 'enemy' || b.focus === 'clash') && !hasEnemy) return false;
    if (b.focus === 'squad' && !hasSupport) return false;
    if (b.focus === 'vehicle' && !hasVehicle) return false;
    return true;
  });
}

/**
 * 由一个基础节拍派生第 round 轮变奏。
 * 确定性：同一 (base.id, round) 永远得到同一条变奏，便于复现与测试。
 * 唯一性：id 带 `~v{round}` 后缀，保证整片不会出现两条相同 id 的节拍。
 */
function deriveBeat(base, round) {
  const idx = (fnv1a(base.id) + round * 0x9e3779b1) >>> 0;
  const prefix = FRAMING_PREFIXES[idx % FRAMING_PREFIXES.length];
  const suffix = VARIATION_SUFFIXES[(idx >>> 3) % VARIATION_SUFFIXES.length];
  return {
    ...base,
    id: `${base.id}~v${round}`,
    shotType: `${base.shotType} · 变奏 ${round}`,
    action: `${prefix}${base.action}${suffix}`,
    derivedFrom: base.id
  };
}

/**
 * 某一阶段的确定性节拍池（已做可用性过滤 + 洗牌），池内 id 天然唯一。
 * @param {'establish'|'build'|'climax'|'resolve'} phase
 */
export function phaseBeatPool(phase, { seed = 1, hasEnemy = false, hasSupport = false, hasVehicle = false, excludeIds = [] } = {}) {
  const exclude = new Set(excludeIds);
  const usable = usableBeats({ hasEnemy, hasSupport, hasVehicle })
    .filter(b => b.phase === phase && !exclude.has(b.id));
  return seededShuffle(usable, seed ^ fnv1a(phase));
}

/**
 * 取 need 条该阶段节拍：先取池内节拍，池被用尽后按轮次派生变奏。
 *
 * 硬不变式：返回数组内 id 两两不同 —— 这是「脚本不重复」的根基，
 * 也是「同一阶段内绝不重复使用同一节拍」这句承诺真正被兑现的地方。
 */
export function expandBeats(phase, { need = 0, seed = 1, hasEnemy = false, hasSupport = false, hasVehicle = false, excludeIds = [] } = {}) {
  const want = Math.max(0, Number(need) || 0);
  const pool = phaseBeatPool(phase, { seed, hasEnemy, hasSupport, hasVehicle, excludeIds });
  if (pool.length === 0) return [];
  const out = [];
  for (let k = 0; k < want; k++) {
    const base = pool[k % pool.length];
    out.push(k < pool.length ? base : deriveBeat(base, Math.floor(k / pool.length)));
  }
  return out;
}

/**
 * 选出 n 个**互不重复**的节拍，并按四阶段均匀铺开。
 *
 * @param {object} params
 * @param {number} params.n 镜头数
 * @param {number} params.seed 确定性种子
 * @param {boolean} params.hasEnemy 名册里是否有敌军
 * @param {boolean} params.hasSupport 是否有第二名友军
 * @param {boolean} params.hasVehicle 是否有载具
 * @returns {Array<object>} 长度为 n 的节拍数组（id 全局唯一）
 */
export function selectBeats({ n, seed = 1, hasEnemy = false, hasSupport = false, hasVehicle = false }) {
  const count = Math.max(1, Number(n) || 1);
  const gates = { hasEnemy, hasSupport, hasVehicle };

  // 统计每阶段应分配的镜头数（与 phaseIndex = floor(i*4/n) 完全一致）
  const phaseCounts = PHASES.map(() => 0);
  for (let i = 0; i < count; i++) {
    phaseCounts[Math.min(3, Math.floor((i * 4) / count))]++;
  }

  const picked = [];
  PHASES.forEach((phase, pi) => {
    picked.push(...expandBeats(phase, { need: phaseCounts[pi], seed, ...gates }));
  });

  // 极端兜底（正常不会触发）：某阶段池为空导致长度不足时，用全局可用池按轮次补齐。
  // 用 id 去重 + 轮次上限双重保护，既不会死循环，也不会产出重复节拍。
  if (picked.length < count) {
    const used = new Set(picked.map(b => b.id));
    const globalPool = usableBeats(gates);
    for (let round = 1; picked.length < count && globalPool.length && round <= count + 1; round++) {
      for (const base of globalPool) {
        if (picked.length >= count) break;
        const cand = deriveBeat(base, round);
        if (used.has(cand.id)) continue;
        used.add(cand.id);
        picked.push(cand);
      }
    }
  }

  return picked.slice(0, count);
}

/**
 * 取某个叙事阶段内可用的节拍（已做可用性过滤 + 确定性洗牌 + 溢出变奏）。
 * 供「参考片桥段 + 原创扩展节拍」混合编排时复用，保证扩展镜头既不与原桥段撞车，
 * 也不会因为池子被用尽而退化成复制同一条模板。
 *
 * @param {'establish'|'build'|'climax'|'resolve'} phase
 * @param {{ seed?: number, hasEnemy?: boolean, hasSupport?: boolean, hasVehicle?: boolean, limit?: number, excludeIds?: string[] }} options
 * @returns {Array<object>}
 */
export function beatsForPhase(phase, { limit = 3, ...opts } = {}) {
  return expandBeats(phase, { need: Math.max(0, Number(limit) || 0), ...opts });
}

/**
 * 原创层：由主题派生独立的立意、转折与开场钩子。
 * 参考影片只贡献视听语言，不贡献情节 —— 这是「像智能」与「照抄」的分界线。
 *
 * @param {{ theme?: string, intent?: object, reference?: object, seed?: number }} params
 */
export function buildOriginality({ theme = '', intent = {}, reference = null, seed = 1 } = {}) {
  const rand = mulberry32(seed >>> 0);

  const twist = TWIST_DEVICES[Math.floor(rand() * TWIST_DEVICES.length)];
  const hook = HOOK_DEVICES[Math.floor(rand() * HOOK_DEVICES.length)];

  const eraLabel = ERA_LABELS[intent.era] || ERA_LABELS[reference?.era] || '现代';
  const settingLabel = SETTING_LABELS[intent.setting] || '开阔战场';
  const taskLabel = TASK_LABELS[intent.task] || '高风险战术行动';
  const brief = String(theme || '').trim();

  // 立意句的可读性（第一性原则）：主题既可能是「黑鹰坠落」这种短名词，也可能是
  // 「特战小队在城市废墟中执行夜间突袭，营救被困飞行员」这种完整句。
  // 早期实现无条件把主题当成句子的主语，于是拼出
  // 「…营救被困飞行员被投入一场争分夺秒的搜救任务」这种病句。
  // 现在按长度分流：短主题当主语，长主题作为「背景」独立成句。
  const shortSubject = brief && brief.length <= 14;
  const sceneLine = !brief
    ? `${eraLabel}的${settingLabel}，一支小队被投入一场${taskLabel}`
    : shortSubject
      ? `${eraLabel}的${settingLabel}，${brief}被投入一场${taskLabel}`
      : `${eraLabel}的${settingLabel}：${brief}。这支小队被投入一场${taskLabel}`;

  const logline = `${sceneLine}；`
    + `他们必须在局势彻底失控之前达成目标，而${twist.replace(/。$/, '')}。`;

  const homageNote = reference
    ? `本片在视听语言上致敬《${reference.title}》（${reference.director || '经典导演'}），但情节走向为独立原创，不复述原作桥段。`
    : '本片为完全原创的乐高微缩战争短片。';

  return {
    logline,
    twist,
    hook,
    homageNote,
    originality: Math.min(1, 0.6 + (String(theme).length % 5) * 0.08)
  };
}

const TWIST_DEVICES = [
  '情报其实是诱饵，真正的目标并不在地图标注的位置',
  '撤离窗口被提前关闭，小队只能在没有支援的情况下自行撕开一条生路',
  '通讯早已被敌方接管，他们听到的“指挥部命令”来自敌人',
  '本应被营救的那个人，恰恰是整场行动的策划者',
  '天气骤变让双方的精确制导同时失效，战斗被迫退回到最原始的距离',
  '战场下方埋着双方都不敢引爆的东西，谁先动手谁先输',
  '主角必须在“完成任务”和“带回所有队友”之间做一次不可逆的选择',
  '敌方指挥官曾是主角的教官，两人用同一套战术互相拆解',
  '整场行动只是更大规模行动的佯动，主角直到最后一刻才察觉',
  '唯一的逃生通道只够一人通过，而队伍有两个人'
];

const HOOK_DEVICES = [
  '开场 3 秒用一个极近的积木特写 + 一声撕裂式音效把观众钉在屏幕上',
  '开场先给结果再给过程：先看见倒下的主角，再倒叙回到行动开始前',
  '开场用绝对静默铺垫，让第一声枪响成为全片最响的一声',
  '开场用一个长镜头从高空俯冲进人物视角，不做任何剪辑',
  '开场用无线电杂音交代危机，画面却是最平静的日常',
  '开场让敌我先各说一句台词，制造“双方都有道理”的张力'
];

const SETTING_LABELS = {
  space: '轨道空间',
  naval: '远洋海域',
  urban: '城市废墟',
  desert: '荒漠地带',
  snow: '极寒雪原'
};

/** 时代的中文标签 —— 早期直接把 intent.era（英文枚举）拼进中文立意，写出「Modern的城市废墟」 */
const ERA_LABELS = {
  'WWII': '二战',
  'Pacific': '太平洋战场',
  'Cold War': '冷战',
  'Gulf War': '海湾战争',
  'Iraq War': '伊拉克战争',
  'Modern': '现代',
  'Modern High-Tech': '现代高科技战场',
  'Orbital': '近地轨道'
};

const TASK_LABELS = {
  rescue: '争分夺秒的搜救任务',
  combat: '高烈度正面交战',
  patrol: '深入敌后的侦察行动'
};

/**
 * 反重复兜底：把「撞车」的镜头改写为独一无二的变奏。
 *
 * 本地规划器在规划期就已保证不重复；但云端大模型返回的分镜可能偷懒复制，
 * 因此这里对最终结果做一次后处理：凡是 action 完全相同的镜头，
 * 从第二处起追加一个未使用过的变奏后缀（而不是粗暴删改模型内容）。
 *
 * @param {Array<object>} shots 镜头数组
 * @returns {{ shots: Array<object>, fixed: number, duplicates: string[] }}
 */
export function diversifyShots(shots = []) {
  const list = Array.isArray(shots) ? shots : [];
  const seenActions = new Map();
  const usedSuffixes = new Set();
  const duplicates = [];
  let fixed = 0;

  const out = list.map((shot, idx) => {
    const action = String(shot?.action || '').trim();
    if (!action) return shot;

    if (!seenActions.has(action)) {
      seenActions.set(action, idx);
      return shot;
    }

    // 撞车：找第一个没被用过的变奏后缀
    let suffix = VARIATION_SUFFIXES.find(s => !usedSuffixes.has(s));
    if (!suffix) {
      suffix = `（第 ${idx + 1} 镜专属机位：换用不同焦段与走位重新取景）`;
    }
    usedSuffixes.add(suffix);
    duplicates.push(action.slice(0, 24));
    fixed++;
    return { ...shot, action: `${action}${suffix}`, variationOf: seenActions.get(action) };
  });

  return { shots: out, fixed, duplicates };
}
