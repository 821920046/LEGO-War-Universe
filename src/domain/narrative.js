/**
 * LEGO War Universe - 叙事变奏与原创引擎 v2.0 (Narrative Variation & Originality)
 *
 * 解决的问题（第一性原则）：
 *
 *   1. 重复 —— 早期本地规划器对全片只用「一个主体 + 一句模板动作」，8 个镜头看起来像 1 个镜头复制 8 遍。
 *      根因是「主体/摄影机/动作」在规划期就是常量。修法：把它们变成**逐镜变量**，
 *      并以「同一阶段内不重复使用同一节拍」为硬约束。
 *
 *   2. **动作单一、不成电影** —— 这是更深的一层。v1 的节拍库只标注了 focus
 *      （hero/squad/vehicle/clash/enemy），而 focus 回答的是「谁在画面里」，
 *      回答不了「这一镜对故事做了什么」。于是按 focus 选出来的片子，每一镜都在干同一件
 *      戏剧上的事：「战斗员执行一个战斗动作」。那是蒙太奇，不是电影。
 *      真正的电影需要的是**戏剧功能**：交代目标、建立人物、制造静默、给出反应、
 *      揭示情报有变、逼迫抉择、兑现代价、完成反转。
 *      v2 因此引入 fn（dramatic function）作为与 focus 正交的第二根轴，并新增
 *      duration（镜头时长）用于节奏，再以 PHASE_ARC 按「戏剧优先级」选节拍，
 *      保证**相邻两镜不承担同一功能**、整片覆盖多种功能。
 *
 * 所有随机都走确定性种子（fnv1a + mulberry32），同一主题每次生成结果一致，便于复现与测试。
 */

import { fnv1a } from './roster.js';

/** 四阶段叙事顺序（与 shot-spec 的 PHASE_ORDER 对齐） */
export const PHASES = ['establish', 'build', 'climax', 'resolve'];

/**
 * 戏剧功能（dramatic function）—— 与 focus 正交的第二根轴。
 *
 * focus 决定「谁在画面里、需要哪些占位符、是否需要敌对语义」；
 * fn 决定「这一镜在故事里承担什么职责」。二者必须同时满足，片子才既有画面又有戏。
 */
export const FUNCTIONS = {
  goal: '交代目标（让观众知道什么算赢）',
  world: '铺陈规模（让人显得渺小）',
  character: '人物时刻（让观众开始在乎）',
  approach: '接近（过程，不是结果）',
  observe: '观察/等待（张力来自不开枪）',
  plan: '临场计划（策略可见）',
  contact: '首次接触（打破平静）',
  escalate: '升级（压力加码）',
  reveal: '揭示（信息改变认知）',
  decision: '抉择（人物由选择定义）',
  reversal: '反转（预期被推翻）',
  cost: '代价（赌注变成现实）',
  clash: '正面交锋（动作高潮）',
  quiet: '静默（开火前的那几秒）',
  aftermath: '残局（后果的静物）',
  reaction: '反应（最便宜也最有力的戏剧单位）',
  close: '收束（结束一个念头，而不是结束一场战斗）'
};

/**
 * 戏剧功能的中文短标签（UI 用）。
 * 显示它的意义：用户抱怨「动作太单一、完全不能构成电影」时，
 * 面板上能直接看到「这一镜在故事里做什么」，而不是只能看到 phase（第几幕）。
 */
export const FUNCTION_LABELS = {
  goal: '🎯 交代目标',
  world: '🌍 铺陈规模',
  character: '❤️ 人物时刻',
  approach: '🥾 接近',
  observe: '👁️ 观察等待',
  plan: '🗺️ 临场计划',
  contact: '⚡ 首次接触',
  escalate: '📈 压力升级',
  reveal: '🔍 情报有变',
  decision: '⚖️ 抉择',
  reversal: '🔄 反转',
  cost: '💔 代价',
  clash: '💥 正面交锋',
  quiet: '🤫 静默',
  aftermath: '🏚️ 残局',
  reaction: '😶 反应',
  close: '🌅 收束'
};

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
 * 各 focus 允许使用的占位符。
 *
 * 这是「占位符自洽性」的单一事实来源：focus=hero 的节拍只有主角，
 * 因此绝不允许在 action 里写 {enemyCallsign} 或 {vehicle} ——
 * 否则规划器会退化成「用主角自己的代号去填敌人位」，
 * 生成「【A】一发命中【A】的火力点」这种自指错句（v1 真实存在过）。
 */
export const FOCUS_ROLES = {
  hero: ['heroCallsign', 'env', 'weather'],
  squad: ['heroCallsign', 'supportCallsign', 'env', 'weather'],
  vehicle: ['heroCallsign', 'vehicle', 'env', 'weather'],
  clash: ['heroCallsign', 'enemyCallsign', 'env', 'weather'],
  enemy: ['heroCallsign', 'enemyCallsign', 'env', 'weather']
};

/**
 * 节拍模板库。
 *
 * focus 语义（谁在画面里 / 需要哪些占位符）：
 *   hero    —— 主角单人或主观视角
 *   squad   —— 两名友军协同（需要 support）
 *   vehicle —— 载具为主（需要 vehicle）
 *   clash   —— 正反同框交战（需要 enemy；动作**必须**含交战语义，否则触发阵营冲突校验）
 *   enemy   —— 敌方为主视角（需要 enemy；同样必须含交战语义）
 *
 * fn 语义见 FUNCTIONS。
 * duration —— 镜头时长（秒），必须是模型 profile 支持的档位之一（见 model-profiles.json）。
 *             快切 4s / 常规 6s / 长镜 8s，让整片有节奏起伏而不是等权重的幻灯片。
 *
 * 占位符：{heroCallsign}{supportCallsign}{enemyCallsign}{vehicle}{env}{weather}
 *         —— 只能使用 FOCUS_ROLES[focus] 里声明过的占位符。
 */
const BEATS = [
  // ============================== establish ==============================
  { id: 'est-goal-1', phase: 'establish', focus: 'hero', fn: 'goal', duration: 8, shotType: '任务简报中景 (Mission Briefing Medium)',
    action: '「九十秒后起爆，目标就在这片 {env} 里。」{heroCallsign} 把平面图摊在断墙上，手指压住红圈，{weather}从缺口灌进来。',
    audioCue: '纸张压过碎石 · 远处低频轰鸣', radioVoice: '【无线电】都听清楚了：进去，带人，出来。没有第二次机会。' },
  { id: 'est-world-1', phase: 'establish', focus: 'hero', fn: 'world', duration: 8, shotType: '环境铺陈大远景 (Establishing Extreme Wide)',
    action: '镜头缓缓升起，{env} 在 {weather}里铺开成一片没有尽头的灰色，人影缩成几个几乎看不见的黑点。',
    audioCue: '风声铺满整个声场 · 没有任何人声', radioVoice: '【无线电】（静默）' },
  { id: 'est-char-1', phase: 'establish', focus: 'hero', fn: 'character', duration: 6, shotType: '私人物件特写 (Personal Token Close-Up)',
    action: '{heroCallsign} 从胸前口袋里摸出一张被汗浸皱的照片，看了两秒，又塞了回去。',
    audioCue: '布料摩擦 · 极轻的弦乐单音', radioVoice: '【无线电】（没有按下通话键）' },
  { id: 'est-char-2', phase: 'establish', focus: 'squad', fn: 'character', duration: 6, shotType: '低声对话双人中景 (Low Exchange Two-Shot)',
    action: '「回去之后这顿算你的。」{supportCallsign} 低声说。{heroCallsign} 没笑，但点了下头。',
    audioCue: '压低的交谈 · 装备轻响', radioVoice: '【无线电】别废话，跟上。' },
  { id: 'est-approach-1', phase: 'establish', focus: 'hero', fn: 'approach', duration: 6, shotType: '低姿渗透跟拍 (Low Crawl Tracking)',
    action: '{heroCallsign} 沿 {env} 的排水沟一寸寸前移，每三米停一次，听。',
    audioCue: '衣料刮擦地面 · 呼吸被刻意放慢', radioVoice: '【无线电】我在往里摸，别出声。' },
  { id: 'est-approach-2', phase: 'establish', focus: 'squad', fn: 'approach', duration: 6, shotType: '交替跃进中景 (Bounding Overwatch)',
    action: '{heroCallsign} 与 {supportCallsign} 一前一后交替跃进，在 {env} 边缘占住一个临时观察位。',
    audioCue: '脚步落地 · 枪械保险轻响', radioVoice: '【无线电】我到位了，掩护你前进。' },
  { id: 'est-observe-1', phase: 'establish', focus: 'enemy', fn: 'observe', duration: 6, shotType: '敌方视角远摄 (Enemy POV Telephoto)',
    action: '准星里，{enemyCallsign} 的巡逻队正从 {env} 尽头列队经过。{heroCallsign} 没有开火，只是数人数——七个。',
    audioCue: '远处口令声 · 风声掩盖脚步', radioVoice: '【无线电】敌人在动，等他们全部进入杀伤区。' },
  { id: 'est-observe-2', phase: 'establish', focus: 'hero', fn: 'observe', duration: 6, shotType: '静默校准特写 (Silent Zeroing Close-Up)',
    action: '{heroCallsign} 蹲在 {env} 的阴影里校准瞄具，呼吸压到最低，{weather}替他掩去了大半轮廓。',
    audioCue: '瞄具微调咔哒声 · 压抑的呼吸', radioVoice: '【无线电】我已就位，等我的信号。' },
  { id: 'est-observe-3', phase: 'establish', focus: 'vehicle', fn: 'observe', duration: 6, shotType: '隐蔽待机特写 (Concealed Idle Close-Up)',
    action: '{vehicle} 在 {env} 外缘熄火待机，{heroCallsign} 借着掩护用测距仪标定第一个目标，镜头贴着积木接缝。',
    audioCue: '金属冷却滴答声 · 电子测距提示音', radioVoice: '【无线电】距离已锁定，等开火命令。' },
  { id: 'est-approach-3', phase: 'establish', focus: 'vehicle', fn: 'approach', duration: 8, shotType: '载具低角度跟拍 (Low Vehicle Tracking)',
    action: '{vehicle} 低吼着碾过 {env}，车灯在 {weather}中切出两道长锥，{heroCallsign} 探头确认前方通路。',
    audioCue: '重载发动机低频轰鸣 · 履带碾碎碎石', radioVoice: '【无线电】车组就位，可以推进。' },

  // ================================ build ================================
  { id: 'bld-plan-1', phase: 'build', focus: 'hero', fn: 'plan', duration: 6, shotType: '临场改计划中景 (Plan B Medium)',
    action: '「原路线封了。」{heroCallsign} 把地图折起来，指向 {env} 侧面，「走上面。」',
    audioCue: '地图折叠 · 战术口令', radioVoice: '【无线电】改走二号路线，三分钟。' },
  { id: 'bld-contact-1', phase: 'build', focus: 'clash', fn: 'contact', duration: 4, shotType: '拐角遭遇手持近景 (Contact Handheld)',
    action: '拐角。两米。{heroCallsign} 与 {enemyCallsign} 同时抬枪开火，短促交火撕裂 {weather}。',
    audioCue: '突击步枪连射 · 弹壳落地脆响', radioVoice: '【无线电】接触！接触！两点钟方向，压制他们！' },
  { id: 'bld-reveal-1', phase: 'build', focus: 'hero', fn: 'reveal', duration: 8, shotType: '揭示推轨镜头 (Reveal Dolly)',
    action: '{heroCallsign} 掀开伪装网，手停住了：{env} 深处不是一个小队，是一整片帐篷。情报错了。',
    audioCue: '伪装网滑落 · 音乐骤然停住', radioVoice: '【无线电】……这不对。人数对不上。' },
  { id: 'bld-escalate-1', phase: 'build', focus: 'hero', fn: 'escalate', duration: 6, shotType: '掩体推进贴身跟拍 (Cover-to-Cover Push)',
    action: '{heroCallsign} 贴着 {env} 的掩体侧身推进，每三步一次压制射击，弹壳在积水上跳开。',
    audioCue: '点射节奏 · 跳弹与碎石声', radioVoice: '【无线电】我在推进，火力别停！' },
  { id: 'bld-escalate-2', phase: 'build', focus: 'vehicle', fn: 'escalate', duration: 6, shotType: '载具抢占制高点 (Vehicle Crest Assault)',
    action: '{vehicle} 冲上斜坡抢占制高点，{heroCallsign} 在车尾架起武器向 {env} 深处扫射压制。',
    audioCue: '发动机高转 · 大口径机枪压制扫射', radioVoice: '【无线电】高地已占，视野良好，可以引导打击。' },
  { id: 'bld-cost-1', phase: 'build', focus: 'squad', fn: 'cost', duration: 4, shotType: '代价特写硬切 (Cost Hard Cut)',
    action: '{supportCallsign} 没有回应。{heroCallsign} 又叫了一次。还是没有。',
    audioCue: '无线电只剩电流声 · 心跳被放大', radioVoice: '【无线电】回话！你回话！' },
  { id: 'bld-observe-1', phase: 'build', focus: 'enemy', fn: 'observe', duration: 6, shotType: '敌方伏击突袭 (Enemy Ambush)',
    action: '{enemyCallsign} 从 {env} 高处掷下震爆弹并发起伏击，{heroCallsign} 被冲击波掀翻，耳中只剩尖锐耳鸣。',
    audioCue: '震爆弹闷响 · 耳鸣与心跳', radioVoice: '【无线电】中埋伏了！散开！找掩体！' },
  { id: 'bld-escalate-3', phase: 'build', focus: 'squad', fn: 'escalate', duration: 6, shotType: '交叉火力双人调度 (Crossfire Choreography)',
    action: '{heroCallsign} 打出交替掩护手势，{supportCallsign} 越位前出，两人在 {env} 中织出交叉火力网。',
    audioCue: '两侧交替射击 · 战术口令', radioVoice: '【无线电】交叉火力建立，敌人被钉住了！' },
  { id: 'bld-escalate-4', phase: 'build', focus: 'hero', fn: 'escalate', duration: 4, shotType: '换弹间隙贴身特写 (Reload Under Fire)',
    action: '{heroCallsign} 换弹匣的间隙被流弹擦过墙面，他贴着 {env} 的钢筋缩身，重新架枪。',
    audioCue: '弹匣脱落与上膛 · 跳弹擦墙', radioVoice: '【无线电】我在换弹，帮我顶十秒！' },
  { id: 'bld-escalate-5', phase: 'build', focus: 'clash', fn: 'escalate', duration: 6, shotType: '爆破掀翻升格镜头 (Blast Slow-Motion)',
    action: '{enemyCallsign} 的火箭弹在 {heroCallsign} 身侧炸开，他被冲击波掀进掩体，爬起来重新校准射击，向敌人发起反击突袭。',
    audioCue: '爆炸低频轰击 · 随后两秒高频耳鸣', radioVoice: '【无线电】车体受损！医护上来，其余人继续压制！' },

  // =============================== climax ================================
  { id: 'clx-escalate-1', phase: 'climax', focus: 'hero', fn: 'escalate', duration: 6, shotType: '孤身突入长镜头 (Solo Breach One-Take)',
    action: '{heroCallsign} 顶着压制冲进开阔地，肩部武器全速连射，{env} 在爆炸中剧烈震颤。',
    audioCue: '持续射击 · 环境结构崩裂声', radioVoice: '【无线电】掩护我！我要冲过去炸掉它！' },
  // 注意：clash/enemy 节拍的 action **必须**含 shot-spec 的敌对语义关键词（交战/开火/对抗/突袭…），
  // 否则校验器看到「正反双方同框却没有敌对语义」会判定 FACTION_CONFLICT_INVALID，编译阶段直接抛错。
  { id: 'clx-clash-1', phase: 'climax', focus: 'clash', fn: 'clash', duration: 4, shotType: '零距离对轰主视角 (Point-Blank Duel)',
    action: '{heroCallsign} 与 {enemyCallsign} 在 {env} 正面撞上，双方在几米内直接交战对轰，塑料零件与火星四散飞溅。',
    audioCue: '全自动连射 · 弹壳与碎片四溅', radioVoice: '【无线电】就是现在！全体开火！' },
  { id: 'clx-decision-1', phase: 'climax', focus: 'hero', fn: 'decision', duration: 6, shotType: '抉择面部特写 (The Choice Close-Up)',
    action: '两条路，都是死路。{heroCallsign} 用两秒钟选了人少的那条，然后把决定咽了下去。',
    audioCue: '呼吸声 · 音乐抽走只留低频', radioVoice: '【无线电】听我的。走左。' },
  { id: 'clx-reversal-1', phase: 'climax', focus: 'hero', fn: 'reversal', duration: 8, shotType: '反转静场中景 (Reversal Still)',
    action: '无线电里没有支援，只有沙沙的电流声。{heroCallsign} 等了八秒，确认不会有人回话了。',
    audioCue: '无线电白噪音 · 彻底没有人声', radioVoice: '【无线电】（只有电流声）' },
  { id: 'clx-cost-1', phase: 'climax', focus: 'squad', fn: 'cost', duration: 4, shotType: '代价短切 (Cost Beat)',
    action: '{supportCallsign} 的位置空了。{heroCallsign} 只看了一眼，没有停下来。',
    audioCue: '脚步声突然少了一半 · 音乐断裂', radioVoice: '【无线电】继续走。别回头。' },
  { id: 'clx-quiet-1', phase: 'climax', focus: 'hero', fn: 'quiet', duration: 8, shotType: '开火前静默长镜 (The Silence Before)',
    action: '全片第一次彻底安静。{env} 里只有水滴砸在钢板上的声音，{heroCallsign} 数着自己的心跳。',
    audioCue: '水滴 · 心跳 · 除此之外什么都没有', radioVoice: '【无线电】（没有人说话）' },
  { id: 'clx-clash-2', phase: 'climax', focus: 'clash', fn: 'clash', duration: 4, shotType: '贴身缠斗微距 (Point-Blank Grapple)',
    action: '{heroCallsign} 与 {enemyCallsign} 贴身缠斗、近身对抗，枪械被打飞后改用工程工具硬撼，{weather}中全是金属摩擦的尖啸。',
    audioCue: '金属剧烈摩擦 · 急促喘息', radioVoice: '【无线电】别管我，完成任务！' },
  { id: 'clx-escalate-2', phase: 'climax', focus: 'vehicle', fn: 'escalate', duration: 6, shotType: '载具强突核心 (Vehicle Breach)',
    action: '{vehicle} 撞穿 {env} 的路障直插核心，{heroCallsign} 在颠簸中完成最后装填。',
    audioCue: '撞击碎裂 · 装填机械咔嚓声', radioVoice: '【无线电】撞进去了！准备下车强攻！' },
  { id: 'clx-escalate-3', phase: 'climax', focus: 'enemy', fn: 'escalate', duration: 6, shotType: '敌方引爆反扑 (Enemy Counterattack)',
    action: '{enemyCallsign} 引爆预设炸药发动反扑，{env} 整片塌陷，{heroCallsign} 在坠落的积木碎块间强行稳住身形继续对抗。',
    audioCue: '连环爆炸 · 结构垮塌低频', radioVoice: '【无线电】地面在塌！抓住固定物！' },
  { id: 'clx-escalate-4', phase: 'climax', focus: 'clash', fn: 'escalate', duration: 6, shotType: '一击决胜特写 (The Decisive Shot)',
    action: '{heroCallsign} 抓住唯一的窗口开火，一发命中 {enemyCallsign} 的火力点，爆炸的冲击波把两人同时掀倒。',
    audioCue: '单发命中 · 随后骤然静默', radioVoice: '【无线电】命中！目标火力点已瘫痪！' },

  // =============================== resolve ===============================
  { id: 'res-after-1', phase: 'resolve', focus: 'hero', fn: 'aftermath', duration: 8, shotType: '残骸之巅静默收尾 (Silent Aftermath)',
    action: '{env} 还在烧。{heroCallsign} 站在废墟顶端，把头盔摘了下来。',
    audioCue: '风声渐起 · 低沉克制的配乐', radioVoice: '【无线电】阵地已肃清，任务完成。' },
  { id: 'res-react-1', phase: 'resolve', focus: 'hero', fn: 'reaction', duration: 4, shotType: '反应镜头面部特写 (Reaction Close-Up)',
    action: '镜头怼在 {heroCallsign} 的脸上，五秒。他什么都没说，但所有人都读懂了。',
    audioCue: '完全静音 · 只有远处的零星燃烧声', radioVoice: '【无线电】（静默）' },
  { id: 'res-react-2', phase: 'resolve', focus: 'squad', fn: 'reaction', duration: 6, shotType: '互相搀扶撤离 (Extraction Walk)',
    action: '{heroCallsign} 与 {supportCallsign} 互相搀扶着穿过 {env}，身后是仍在燃烧的战场。',
    audioCue: '沉重脚步 · 远处零星燃烧声', radioVoice: '【无线电】所有人都带回来了，一个都没落下。' },
  { id: 'res-cost-1', phase: 'resolve', focus: 'hero', fn: 'cost', duration: 4, shotType: '名单核对特写 (The Names)',
    action: '{heroCallsign} 蹲在 {env} 一角清点人数，数到一半停住了，然后从头又数了一遍。',
    audioCue: '金属铭牌相碰 · 极低的弦乐', radioVoice: '【无线电】名单……对不上。' },
  { id: 'res-quiet-1', phase: 'resolve', focus: 'hero', fn: 'quiet', duration: 8, shotType: '摘机静默特写 (Radio Off Close-Up)',
    action: '{heroCallsign} 摘下通讯耳机，{weather}里只剩下自己的呼吸和远处零星的燃烧声。',
    audioCue: '耳机摘下时的电流断响 · 风声', radioVoice: '【无线电】（已断开）' },
  { id: 'res-close-1', phase: 'resolve', focus: 'hero', fn: 'close', duration: 6, shotType: '手套特写收镜 (Glove Close-Up Outro)',
    action: '{heroCallsign} 的手从枪上松开，摊平，掌心朝上。',
    audioCue: '枪械落地轻响 · 环境音渐弱', radioVoice: '【无线电】收队，回家。' },
  { id: 'res-close-2', phase: 'resolve', focus: 'vehicle', fn: 'close', duration: 6, shotType: '载具远去长镜头 (Departure Long Shot)',
    action: '{vehicle} 载着归队的队员缓缓驶离 {env}，{heroCallsign} 回头望向逐渐安静的天际线。',
    audioCue: '发动机低鸣远去 · 无线电静噪', radioVoice: '【无线电】全员登车，返航。' },
  { id: 'res-close-3', phase: 'resolve', focus: 'hero', fn: 'close', duration: 6, shotType: '信号标记特写 (Signal Marker Close-Up)',
    action: '{heroCallsign} 在 {env} 上点亮信号标记，救援部队的灯光在 {weather}中由远及近。',
    audioCue: '信号灯电子音 · 直升机桨叶由远及近', radioVoice: '【无线电】标记已点亮，救援可以进场。' },
  { id: 'res-after-2', phase: 'resolve', focus: 'enemy', fn: 'aftermath', duration: 6, shotType: '最后清剿收束 (Final Sweep)',
    action: '{enemyCallsign} 的残部仍据守 {env} 一角负隅顽抗，{heroCallsign} 率队发起最后的清剿突袭。',
    audioCue: '短促点射 · 随后彻底安静', radioVoice: '【无线电】最后一个火力点已清除，战区安全。' }
];

/**
 * 各阶段的戏剧弧线：按**优先级**排列的功能序列。
 *
 * 取「前 m 个」即可得到一个 m 镜的完整戏剧形状，例如 climax：
 *   m=1 → 升级                m=2 → 升级·交锋
 *   m=3 → 升级·交锋·抉择      m=4 → 升级·交锋·抉择·反转
 * 这样短片的每一镜都在推进故事，而不是把同一个动作做三遍。
 */
export const PHASE_ARC = {
  establish: ['goal', 'character', 'world', 'approach', 'observe'],
  build: ['plan', 'contact', 'reveal', 'escalate', 'cost', 'observe'],
  climax: ['escalate', 'clash', 'decision', 'reversal', 'cost', 'quiet'],
  resolve: ['aftermath', 'reaction', 'close', 'cost', 'quiet']
};

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

/** 中日韩字符与标点区段 */
const CJK_CLASS = '\\u2E80-\\u9FFF\\u3000-\\u303F\\uFF00-\\uFFEF';

/**
 * 中文排版收尾：删掉「两侧都是中文」的空格。
 *
 * 模板为了源码可读性写成 `{heroCallsign} 把平面图摊在断墙上`，
 * 占位符展开后变成「【SEXTANT】无人机操作员 把平面图摊在断墙上」——
 * 中文之间不该有空格，读起来像机器拼接。
 * 只处理「两边都是中文/中文标点」的空格，因此
 * 「LEGO minifigure」「AR-15 步枪」这类中英混排完全不受影响。
 *
 * 必须用**前瞻**而不是把右侧字符一起吃掉：
 * 写成 `([CJK])\s+([CJK])` 时，「兵 与 【」只会消掉「兵 与」这一处，
 * 因为「与」已被上一次匹配消费掉，第二次匹配无法从「与」重新开始，
 * 结果是「医疗兵与 【PILGRIM】」这种半拉子修复。前瞻只消费左侧字符，
 * 右侧字符留给下一次匹配，于是连续的中文空格能被一次扫干净。
 */
export function tidySpacing(text) {
  return String(text ?? '')
    .replace(new RegExp(`([${CJK_CLASS}])[ \\t]+(?=[${CJK_CLASS}])`, 'g'), '$1')
    .replace(new RegExp(`([${CJK_CLASS}])[ \\t]+(?=[，。、；：！？）」』】])`, 'g'), '$1');
}

/**
 * 填充占位符 + 中文排版收尾。
 * 规划器与电影转译器统一走这个入口，保证「模板 → 成片文本」只有一条路径。
 */
export function renderTemplate(text, ctx) {
  return tidySpacing(fillTemplate(text, ctx));
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
 * fn / duration 原样继承，因此变奏不会破坏戏剧形状与节奏。
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
 * 取 need 条该阶段节拍：**按戏剧弧线选择**，池内取尽后按轮次派生变奏。
 *
 * 两条硬不变式：
 *   1. 返回数组内 id 两两不同（不重复）；
 *   2. 相邻两镜尽量不承担同一 fn（不单调）—— 这是「像电影」与「像幻灯片」的分界。
 *
 * 退化路径是有序的：目标功能不可用（例如没有敌军 → clash 不可用）
 * → 沿弧线顺延到下一个可用功能 → 全部功能用尽则取任意未用过且功能不同的节拍
 * → 池彻底耗尽才派生变奏。
 *
 * @param {string|null} [options.prevFn] 上一阶段最后一镜的戏剧功能。
 *        跨阶段也要传，否则「上一阶段收尾」与「下一阶段开场」可能撞成同一功能
 *        （例如 build 收在 escalate、climax 又开在 escalate，连看两镜一模一样）。
 */
export function expandBeats(phase, { need = 0, seed = 1, hasEnemy = false, hasSupport = false, hasVehicle = false, excludeIds = [], prevFn: seedPrevFn = null } = {}) {
  const want = Math.max(0, Number(need) || 0);
  const pool = phaseBeatPool(phase, { seed, hasEnemy, hasSupport, hasVehicle, excludeIds });
  if (pool.length === 0 || want === 0) return [];

  const arc = PHASE_ARC[phase] || [];
  const used = new Set();
  const out = [];
  let prevFn = seedPrevFn;

  // 同一功能有多个候选时，优先选载具镜 —— 只要本阶段还没出现过载具。
  //
  // 这是「载具必须上镜」的第一道保障：PHASE_ARC 靠前的功能（goal/character/plan/contact…）
  // 没有载具镜，而 escalate / close 有。让 escalate 位置优先落在载具镜上，n=4 也能自然出现载具，
  // 不必依赖后面的强制替换。fn 不变，因此戏剧弧线不受影响。
  const takeByFn = (fn) => {
    const cands = pool.filter(b => b.fn === fn && !used.has(b.id));
    if (cands.length === 0) return undefined;
    if (hasVehicle && !out.some(b => b.focus === 'vehicle')) {
      const v = cands.find(b => b.focus === 'vehicle');
      if (v) return v;
    }
    return cands[0];
  };
  const fnAvailable = (fn) => pool.some(b => b.fn === fn && !used.has(b.id));

  for (let k = 0; k < want; k++) {
    let desired = arc[Math.min(k, arc.length - 1)];

    // 相邻两镜不重复同一戏剧功能：若弧线这一步撞上前一镜，就换一个仍可用的功能
    if (desired === prevFn) {
      const alt = arc.find(fn => fn !== prevFn && fnAvailable(fn));
      if (alt) desired = alt;
    }

    let chosen = takeByFn(desired);

    if (!chosen) {
      // 目标功能在当前门控下不可用 → 沿弧线顺延
      for (const alt of arc) {
        if (alt === desired) continue;
        chosen = takeByFn(alt);
        if (chosen) break;
      }
    }
    if (!chosen) {
      // 所有功能都已用过 → 取任意未用过、且功能不同于前一镜的节拍
      chosen = pool.find(b => !used.has(b.id) && b.fn !== prevFn)
        || pool.find(b => !used.has(b.id));
    }
    if (!chosen) {
      // 池彻底耗尽 → 派生变奏（保持 id 唯一、文本不重复、fn/duration 继承）
      const base = pool[k % pool.length];
      chosen = deriveBeat(base, Math.floor(k / pool.length));
    }

    used.add(chosen.id);
    out.push(chosen);
    prevFn = chosen.fn;
  }

  return out;
}

/**
 * 选出 n 个**互不重复**的节拍，按四阶段均匀铺开，并让每一镜承担不同的戏剧功能。
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
  let prevFn = null;
  PHASES.forEach((phase, pi) => {
    const batch = expandBeats(phase, { need: phaseCounts[pi], seed, ...gates, prevFn });
    picked.push(...batch);
    if (batch.length) prevFn = batch[batch.length - 1].fn;
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

  // 载具必须真的上镜。
  //
  // PHASE_ARC 把「goal / character / plan / contact / aftermath …」这类通用功能排在弧线前段，
  // 而 focus='vehicle' 的节拍恰好都落在 observe / approach / escalate / close 这些靠后的功能上，
  // 于是 n 较小时（4 / 8 镜）载具镜几乎永远轮不到 —— 资产库再大，片子里也见不到 F-22、
  // B-2、航母、潜艇，用户感知就是「装备太单一」。
  //
  // 修法：在不改变戏剧功能（fn）的前提下，把已有的一两镜**换成同 fn 的载具镜**。
  // 因为 fn 不变，戏剧弧线与「相邻功能互异」两条不变式都自动保持。
  if (hasVehicle) {
    const wantVehicles = count >= 8 ? 2 : 1;
    let have = picked.filter(b => b.focus === 'vehicle').length;
    if (have < wantVehicles) {
      const vehiclePool = usableBeats(gates).filter(b => b.focus === 'vehicle');
      const enemyShots = () => picked.filter(b => b.focus === 'enemy' || b.focus === 'clash').length;
      for (let i = picked.length - 1; i >= 0 && have < wantVehicles; i--) {
        const cur = picked[i];
        if (cur.focus === 'vehicle') continue;
        // 不能为了塞载具把仅剩的敌我对峙镜也换掉 —— 那样就变成「没有敌人的战争片」
        if ((cur.focus === 'enemy' || cur.focus === 'clash') && enemyShots() <= 1) continue;
        const swap = vehiclePool.find(b => b.fn === cur.fn && !picked.some(p => p.id === b.id));
        if (swap) {
          picked[i] = swap;
          have += 1;
        }
      }
    }
  }

  return picked.slice(0, count);
}

/**
 * 取某个叙事阶段内可用的节拍（已做可用性过滤 + 戏剧弧线选择 + 溢出变奏）。
 * 供「参考片桥段 + 原创扩展节拍」混合编排时复用。
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

/**
 * 关键词 → 戏剧功能。顺序即优先级（先命中先算）。
 * 仅用于给**云端大模型返回**的镜头补标 fn —— 本地规划器/致敬引擎的节拍本就带 fn，不需要推断。
 */
const FN_KEYWORDS = [
  ['clash', /交战|开火|对轰|交火|缠斗|火拼|突袭|命中|引爆|对射|驳火/],
  ['reveal', /情报|人数对不上|不对|错了|原来|掀开|伪装网|揭示|才发现|没想到|增援|圈套|诱饵/],
  ['cost', /没有回应|没了|空了|名单|牺牲|倒下|没回来|最后一个|别回头|少了一半|再也|阵亡/],
  ['plan', /计划|路线|方案|地图|改走|部署|分工|原定|布防|安排/],
  ['contact', /首次接触|遭遇|接触|撞见|拐角|正面遇上|狭路/],
  ['quiet', /安静|静默|心跳|水滴|没有声音|屏住|无声|死寂/],
  ['reaction', /反应|脸上|什么都没说|读懂|沉默|对视|点了下头|没笑|眼神/],
  ['close', /收队|返航|回家|摘下|松开|驶离|撤离|登车|渐弱|收镜/],
  ['aftermath', /残骸|废墟|还在烧|清点|残局|打扫|余烬|肃清|焦土/],
  ['goal', /目标|任务|简报|带人|进去|红圈|赌注|必须|倒计时/],
  ['character', /照片|摸出|口袋里|私人物件|低声说|回忆|家人|铭牌|旧伤/],
  ['world', /远景|铺开|升起|渺小|全景|没有尽头|俯瞰|天际线/],
  ['observe', /观察|等待|校准|待机|潜伏|数人数|瞄准|静候|蹲守/],
  ['approach', /渗透|前进|接近|逼近|摸进|匍匐|前移|迂回/],
  ['escalate', /压制|推进|冲锋|突入|加码|升级|顶住|强攻|扫射|逼近核心/]
];

/**
 * 各戏剧功能的默认镜头时长（秒）：快切 4s / 常规 6s / 长镜 8s。
 * 云端模型往往不返回 duration，导致全片每镜都是同一个长度、节奏扁平；
 * 这里按功能给出默认值，让「静默/铺陈/残局」这类镜头自然变长、
 * 「交锋/接触/代价」这类镜头自然变短，整片才有起伏。
 */
const FUNCTION_DURATION = {
  goal: 8, world: 8, character: 6, approach: 6, observe: 6, plan: 6,
  contact: 4, escalate: 6, reveal: 8, decision: 6, reversal: 8, cost: 4,
  clash: 4, quiet: 8, aftermath: 8, reaction: 4, close: 6
};

/** 单镜戏剧功能推断（文本优先，其次回退到该阶段弧线首项） */
export function inferFunction(shot = {}) {
  const text = `${shot.action || ''} ${shot.radioVoice || ''} ${shot.audioCue || ''}`;
  for (const [fn, re] of FN_KEYWORDS) {
    if (re.test(text)) return fn;
  }
  const phase = PHASES.includes(shot.phase) ? shot.phase : 'build';
  return PHASE_ARC[phase][0];
}

/**
 * 给任意镜头数组补齐并规整戏剧功能 —— 让**云端大模型脚本**也具备可读的戏剧弧线。
 *
 * 用户的原话是「动作太单一了，完全不能构成电影」。对大模型返回的镜头，这里做四件事：
 *   1. 逐镜定 fn：模型给了合法 fn 就尊重；没给或非法则按文本/阶段推断。
 *   2. 单调兜底：若整片功能种类 ≤2 且镜头 ≥4（典型的「全程对轰」），
 *      直接按各阶段弧线整体重排，保证任何云端脚本都至少长出一条完整的戏剧弧线。
 *      （必须先于相邻去重：否则只会把对轰打散成「对轰/非对轰」的伪变化，一半镜头仍在交锋。）
 *   3. 相邻不得同功能：这是「单一」最直接的病灶 —— 连续两镜干同一件戏剧上的事，
 *      观感就是同一镜重复。命中则从该阶段弧线里挑一个既不同于前一镜、也不同于后一镜的功能。
 *   4. 补 duration：模型不返回时长时，按戏剧功能给默认值，避免全片每镜同一长度、节奏扁平。
 *
 * 全流程确定性、无副作用（不改原数组）。
 *
 * @param {Array<object>} shots
 * @returns {{ shots: Array<object>, retagged: number, monotone: boolean, functions: string[] }}
 */
export function tagDramaticFunctions(shots = []) {
  const list = Array.isArray(shots) ? shots : [];
  if (!list.length) return { shots: list, retagged: 0, monotone: false, functions: [] };

  // 1) 逐镜定 fn
  let out = list.map((shot) => {
    const given = typeof shot?.fn === 'string' && FUNCTIONS[shot.fn] ? shot.fn : null;
    return { ...shot, fn: given || inferFunction(shot) };
  });

  // 2) 单调兜底（必须**先于**相邻去重）。
  //    判据是「推断出来的功能只有 ≤2 种」——典型的「全程对轰」。
  //    此时若只做相邻去重，只会把对轰打散成「对轰/非对轰/对轰/非对轰」的伪变化，
  //    一半镜头仍在交锋，仍然不成电影。因此直接按各阶段弧线整体重排，
  //    让每一镜落到弧线上各自不同的位置，长出一条完整的戏剧弧线。
  const inferredDistinct = new Set(out.map(s => s.fn)).size;
  const monotone = out.length >= 4 && inferredDistinct <= 2;
  let retagged = 0;
  if (monotone) {
    const cursor = {};
    out = out.map((shot) => {
      const phase = PHASES.includes(shot.phase) ? shot.phase : 'build';
      const arc = PHASE_ARC[phase];
      const k = cursor[phase] || 0;
      cursor[phase] = k + 1;
      const next = arc[Math.min(k, arc.length - 1)];
      if (next !== shot.fn) retagged++;
      return { ...shot, fn: next };
    });
  }

  // 3) 相邻不得同功能（收尾：弧线重排后阶段边界仍可能撞车，这里再兜一次）
  for (let i = 1; i < out.length; i++) {
    if (out[i].fn !== out[i - 1].fn) continue;
    const phase = PHASES.includes(out[i].phase) ? out[i].phase : 'build';
    const nextFn = out[i + 1]?.fn;
    const alt = PHASE_ARC[phase].find(f => f !== out[i - 1].fn && f !== nextFn)
      || PHASES.flatMap(p => PHASE_ARC[p]).find(f => f !== out[i - 1].fn);
    if (alt && alt !== out[i].fn) {
      out[i] = { ...out[i], fn: alt };
      retagged++;
    }
  }

  // 4) 补时长：只给「模型没给时长」的镜头按最终 fn 兜底，模型自己给了就尊重。
  out = out.map((shot) => {
    const given = Number(shot?.duration);
    return {
      ...shot,
      duration: given > 0 ? given : (FUNCTION_DURATION[shot.fn] || 6)
    };
  });

  return { shots: out, retagged, monotone, functions: out.map(s => s.fn) };
}
