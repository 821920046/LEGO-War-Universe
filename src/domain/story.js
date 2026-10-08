/**
 * LEGO War Universe - 剧本内核引擎 v1.0 (Story Core)
 *
 * 解决的问题（第一性原则）：
 *
 *   6.6.0 之前，一部片子 = n 个「通用节拍模板」+ 轮换资产。它能保证「不重复」，
 *   但保证不了「有剧情」—— 因为节拍模板本身与题材无关，镜头之间也没有因果关系。
 *   用户的原话是：「完全没有什么可观赏的价值，内容太单一，就是简单的拼凑，没有剧情。」
 *
 *   根因有三，且互相独立：
 *     A. **没有人物** —— {heroCallsign} 展开是「【MERIDIAN】动力外骨骼特战队员」，
 *        那是单位类型，不是人。观众记不住、也无从在乎。
 *     B. **没有因果** —— 节拍在阶段内被洗牌后按戏剧弧线取用，
 *        于是第 3 镜的结果不会导致第 4 镜，片子是一叠并置的卡片而不是一条链。
 *     C. **没有题材** —— 所有 action 只插 {env}，正文里没有一个题材名词。
 *        二战片、现代片、海战片读起来是同一部片子，只是地名不同。
 *
 *   本模块用三件事分别对应 A/B/C：
 *     1. ARCS —— 按题材识别**任务原型**（抢滩 / 舰队 / 制空 / 战略打击 / 潜艇猎杀 …），
 *        每个原型是一份**有序的剧本骨架**：这一镜发生什么、为什么必须紧接着上一镜。
 *     2. resolveNouns —— 从题材文本、选中资产、环境资产里解析出
 *        目标物 / 威胁 / 赌注 / 时限 等具体名词，注入骨架文本，
 *        让「情报错了，目标不是一个机枪巢，是整片炮兵阵地」这种句子真的出现在脚本里。
 *     3. linkFor —— 逐镜**因果连接词**（「枪声未停，」「情报已经被推翻，」），
 *        让「因为 / 所以 / 于是 / 代价是」落到文本上。
 *
 * 设计约束（与整个仓库一致）：
 *   - 全流程确定性：同一 (题材, 镜头数) 永远产出同一份剧本，便于复现与测试。
 *   - 不引入外部依赖，不联网，纯函数。
 *   - 骨架文本只使用白名单占位符；focus 决定该占位符是否可能被填上。
 */

import { fnv1a, domainOfText } from './roster.js';

/* ================================================================== *
 * 0. 时代词汇表
 *
 * 「舰队对抗」在 1942 年用的是鱼雷与瞭望哨，在 2026 年用的是反舰导弹与雷达告警。
 * 骨架若写死一种，另一半时代就会穿帮（中途岛片里出现雷达告警）。
 * 因此凡是有时代特征的词一律走 {vocab.xxx}，由这里按时代取词。
 * ================================================================== */

const ERA_VOCAB = {
  'WWII': {
    antiship: '鱼雷', interceptor: '高射炮火', warning: '瞭望哨', sensor: '瞭望与测距仪',
    fighter: '螺旋桨战斗机', strike: '俯冲轰炸机', guidance: '目视瞄准', shield: '烟幕',
    armorRound: '穿甲弹', antiArmor: '反坦克炮',
    droneSwarm: '俯冲轰炸机群', counterDrone: '高射炮火网', datalink: '旗语与无线电报', jamming: '无线电欺骗'
  },
  'Pacific': {
    antiship: '鱼雷', interceptor: '高射炮火', warning: '瞭望哨', sensor: '瞭望与测距仪',
    fighter: '舰载战斗机', strike: '俯冲轰炸机', guidance: '目视瞄准', shield: '烟幕',
    armorRound: '穿甲弹', antiArmor: '反坦克炮',
    droneSwarm: '舰载攻击机群', counterDrone: '高射炮火网', datalink: '旗语与无线电报', jamming: '无线电欺骗'
  },
  'Cold War': {
    antiship: '反舰导弹', interceptor: '防空导弹', warning: '雷达告警', sensor: '舰载雷达',
    fighter: '喷气战斗机', strike: '攻击机', guidance: '雷达制导', shield: '箔条干扰',
    armorRound: '尾翼稳定脱壳穿甲弹', antiArmor: '反坦克导弹',
    droneSwarm: '攻击机群', counterDrone: '防空导弹与高炮', datalink: '战术数据链', jamming: '电子干扰'
  },
  'Gulf War': {
    antiship: '反舰导弹', interceptor: '拦截弹', warning: '雷达告警', sensor: '舰载雷达',
    fighter: '第三代战斗机', strike: '攻击机', guidance: '激光制导', shield: '干扰弹',
    armorRound: '贫铀穿甲弹', antiArmor: '反坦克导弹',
    droneSwarm: '攻击机群', counterDrone: '近防炮与拦截弹', datalink: '战术数据链', jamming: '电子干扰'
  },
  'Iraq War': {
    antiship: '反舰导弹', interceptor: '拦截弹', warning: '雷达告警', sensor: '舰载雷达',
    fighter: '第三代战斗机', strike: '攻击机', guidance: '激光制导', shield: '干扰弹',
    armorRound: '贫铀穿甲弹', antiArmor: '反坦克导弹',
    droneSwarm: '攻击机群', counterDrone: '近防炮与拦截弹', datalink: '战术数据链', jamming: '电子干扰'
  },
  'Modern': {
    antiship: '反舰导弹', interceptor: '拦截弹', warning: '雷达告警', sensor: '相控阵雷达',
    fighter: '战斗机', strike: '攻击机', guidance: '精确制导', shield: '干扰弹',
    armorRound: '尾翼稳定脱壳穿甲弹', antiArmor: '反坦克导弹',
    droneSwarm: '无人机蜂群', counterDrone: '反无人机干扰与近防炮', datalink: '战术数据链', jamming: '全频段干扰'
  },
  'Modern High-Tech': {
    antiship: '高超音速反舰导弹', interceptor: '定向能拦截', warning: '被动告警阵列', sensor: '有源相控阵',
    fighter: '第五代隐身战斗机', strike: '隐身轰炸机', guidance: '多模复合制导', shield: '电磁干扰幕',
    armorRound: '电磁炮穿甲弹', antiArmor: '攻顶弹药',
    droneSwarm: '自主打击蜂群', counterDrone: '定向能拦截', datalink: '加密数据链', jamming: '电磁压制'
  },
  'Orbital': {
    antiship: '动能拦截弹', interceptor: '点防御激光', warning: '接近告警', sensor: '光电阵列',
    fighter: '轨道拦截器', strike: '动能杆', guidance: '光学锁定', shield: '气溶胶幕',
    armorRound: '动能弹丸', antiArmor: '定向能',
    droneSwarm: '动能弹群', counterDrone: '点防御激光', datalink: '激光通信链路', jamming: '频段遮蔽'
  }
};

const DEFAULT_VOCAB = ERA_VOCAB['Modern'];

/**
 * 取该时代的词汇表。
 *
 * 与 DEFAULT_VOCAB **合并**而不是替换：`expandVocab` 遇到未定义的键会原样保留
 * `{vocab.xxx}`，于是任何一个新键漏写在某个时代里，都会直接漏进成片正文。
 * 合并之后新增词汇键只需写在需要的时代，其余时代自动继承现代写法。
 */
export function vocabFor(era) {
  return { ...DEFAULT_VOCAB, ...(ERA_VOCAB[era] || {}) };
}

/* ================================================================== *
 * 0b. 场景氛围词
 *
 * 6.7.1 之前 `{weather}` 只有四个来源：snow → 风雪、rain → 暴雨、night → 夜色、
 * 其余一律「尘雾」。实测 20 个题材里 **19 个都是尘雾** —— 这正是用户抱怨的
 * 「内容太单一」在环境层的残留：换一个题材，句子骨架换了、氛围词还是同一个。
 *
 * 更严重的是语义错配：尘雾是**地面**现象，却出现在海面、高空与轨道上 ——
 * 「山谷低空在尘雾下方摊成一整张地图」「核心舱检修口在尘雾里无声自转」。
 *
 * 因此氛围词改为**按战场域取词池**，并在域内按题材哈希做确定性轮转。
 * 池里的词必须同时满足两个条件，改词前请先验证：
 *   1. 能与骨架句法搭配 —— 这些词会被塞进「在{weather}里 / 在{weather}下方」；
 *   2. 真的能**遮蔽视线** —— 骨架里有「{weather}替他掩去了大半轮廓」这类句子。
 * 所以「热浪」不能进池（它不遮挡轮廓），「夜色」也不进地面池（那是光照条件，不是气象）。
 * ================================================================== */

const WEATHER_BY_DOMAIN = {
  // 轨道没有气象：真空里不下雪、也不起雾。池里的词描述的是**光照与可见性**。
  orbital: ['真空', '地球反照的冷光', '背阴面的黑暗'],
  naval: ['海雾', '低垂的云', '涌浪激起的水汽', '雨幕'],
  // 空战池必须都是**层状**的：骨架句是「{place}在{weather}下方摊成一整张地图」。
  air: ['云层', '低云', '薄云', '逆温层'],
  strategic: ['夜幕', '低云', '尘霾'],
  ground: ['尘雾', '扬尘', '薄雾', '硝烟', '沙尘'],
  default: ['尘雾', '薄雾', '阴云']
};

/**
 * 取本片的场景氛围词。
 *
 * 优先级：显式气象（雪 / 雨）> 显式光照（夜）> 战场域词池轮转。
 * 唯一例外是轨道：那里既不下雪也不下雨，显式气象一律忽略。
 *
 * @param {{ domain?: string|null, intent?: object, seed?: number }} params
 * @returns {string}
 */
export function weatherFor({ domain = null, intent = {}, seed = 0 } = {}) {
  const pool = WEATHER_BY_DOMAIN[domain] || WEATHER_BY_DOMAIN.default;
  const pick = () => pool[Math.abs(Number(seed) || 0) % pool.length];

  if (domain === 'orbital') return pick();
  if (intent.weather === 'snow') return '风雪';
  if (intent.weather === 'rain') return '雨幕';
  if (intent.lightingCondition === 'night') {
    // 夜里的海面仍然是湿的：写成「夜色」会丢掉海雾这一层，写成「夜里的海雾」更准。
    return domain === 'naval' ? '夜里的海雾' : '夜色';
  }
  return pick();
}

/* ================================================================== *
 * 1. 任务原型
 *
 * 顺序即优先级：越具体越靠前。
 * 「中途岛航母对决」同时命中「航母」与「对决」，必须由舰队原型接管；
 * 「诺曼底登陆抢滩」同时命中「登陆」与「滩头」，由抢滩原型接管。
 * ================================================================== */

const ARCS = [
  /* ---- 未来 / 高科技原型（必须排在最前：它们的关键词最具体，被历史原型截走就不可达）---- */
  {
    id: 'counter-uas',
    label: '反无人机防御',
    re: /反无人机|反无人|无人机防御|激光防空|定向能防空|微波武器|counter-?uas|anti-?drone|drone ?defen[cs]e/i,
    objective: '守住{target}',
    target: '被蜂群盯上的阵地',
    threat: '低空压过来的自杀式蜂群',
    stake: '整条防线会在一个波次里被捅穿',
    deadline: '下一波蜂群进入末端俯冲前的七分钟',
    locations: ['阵地东北角的开阔扇面', '雷达车周围的环形警戒圈', '弹药堆放区上方的低空', '天线阵与掩体之间的空隙'],
    vehicleHint: /激光|微波|干扰|反无人机|防空|directed energy|counter|jammer/i
  },
  {
    id: 'swarm-strike',
    label: '蜂群突防',
    re: /蜂群|无人机群|巡飞弹|自杀式无人机|无人机母车|忠诚僚机|swarm|loitering|drone ?(?:swarm|mothership)/i,
    objective: '打瘫{target}',
    target: '敌方防空节点',
    threat: '逐层点亮的近程防空火力',
    stake: '后面的有人机编队会被迫取消整个波次',
    deadline: '有人机进入包线前的十二分钟',
    locations: ['投放空域的低云下方', '防空雷达的探测边缘', '目标上空的悬停层', '两栋楼之间的峡谷走廊'],
    vehicleHint: /蜂群|无人机|巡飞弹|swarm|drone|loitering|忠诚僚机/i
  },
  {
    id: 'hypersonic-strike',
    label: '高超音速打击',
    re: /高超音速|高超声速|滑翔弹头|反导|中段拦截|末端拦截|hypersonic|glide vehicle|midcourse/i,
    objective: '在{target}上打出不可拦截的一击',
    target: '敌方反导阵地',
    threat: '从发现到命中的九分钟窗口',
    stake: '对手的第二次齐射会落在本土',
    deadline: '弹道交汇前的九分钟',
    locations: ['发射阵地的遮蔽网下', '大气层边缘的滑翔段', '中段拦截的会合点', '目标区上空的再入走廊'],
    vehicleHint: /高超音速|滑翔|反导|interceptor|hypersonic|中段/i
  },
  {
    id: 'ew-cyber',
    label: '电磁网络压制',
    re: /电子战|网络战|电磁脉冲|电磁干扰|赛博|频谱压制|干扰压制|指挥节点|cyber|electronic warfare|\bemp\b|jamming/i,
    objective: '让{target}变成瞎子和聋子',
    target: '敌方联合作战指挥节点',
    threat: '对手的反辐射打击与备份链路',
    stake: '突击队会在没有电子掩护的情况下撞进对方的火力网',
    deadline: '突击队越过出发线前的十分钟',
    locations: ['电子战车展开的侧坡', '天线阵背向的阴影区', '地下指挥掩体的信号舱', '频谱图上那片全黑的地带'],
    vehicleHint: /电子战|干扰|网络|数据链|jammer|cyber|微波|指挥/i
  },
  {
    id: 'mech-assault',
    label: '外骨骼突击',
    re: /外骨骼|机甲|动力装甲|无人战车|战斗机器人|机器人部队|exoskeleton|powered armor|robotic/i,
    objective: '在{target}上碾开一条通路',
    target: '敌方预设的坚固阵地',
    threat: '埋在废墟里的智能地雷与反装甲伏击',
    stake: '整条进攻轴线都要停在原地',
    deadline: '火力准备结束后的六分钟',
    locations: ['废墟街区的进攻出发线', '被炸塌的楼体缺口', '地雷区之间的窄通道', '阵地纵深的第二道墙'],
    vehicleHint: /外骨骼|无人战车|机器人|机甲|装甲|exoskeleton|ugv|robot/i
  },
  {
    id: 'embassy-evac',
    label: '使馆撤侨',
    re: /撤侨|使馆|大使馆|领事馆|非战斗人员|平民撤离|侨民|embassy|noncombatant|evacuat/i,
    objective: '把{target}一个不剩地带出去',
    target: '被困在使馆院落里的侨民',
    threat: '正在向院落合拢的武装人群',
    stake: '围墙上的人会在天亮前被冲开',
    deadline: '最后一批车队出城窗口关闭前的四十分钟',
    locations: ['使馆院落的大铁门前', '围墙上的沙袋射击位', '楼顶停机坪的警戒圈', '撤离线上的第一道路障'],
    vehicleHint: /装甲|输送车|直升机|mrap|apc|convoy|helicopter/i
  },
  {
    id: 'submarine-hunt',
    label: '潜艇猎杀',
    re: /潜艇|深海|潜航|声呐|鱼雷管|submarine|sonar|torpedo|u-?boat/i,
    objective: '咬住并击沉{target}',
    target: '敌方战略潜艇',
    threat: '对方的被动声呐阵列',
    stake: '己方编队会在进入海峡时被伏击',
    deadline: '编队进入海峡前的两小时',
    // 「潜望深度」是**一个深度值**，不是一个区域；把它塞进「{place}在{weather}里被压成
    // 一条发白的线」会写出「潜望深度在尘雾里被压成一条发白的线」这种病句。
    // 所有 locations 必须能同时通过「在{place}里 / 在{place}边缘 / 往{place}深处」三种句法。
    locations: ['跃变层下的静默区', '海底峡谷的阴影', '潜望深度上方的水层', '海峡口'],
    vehicleHint: /潜艇|潜航|submarine|u-?boat/i
  },
  {
    id: 'fleet-ops',
    label: '舰队作战',
    re: /航母|舰载|驱逐舰|巡洋舰|护卫舰|两栖攻击舰|舰队|编队|远海|carrier|destroyer|fleet|naval/i,
    objective: '打掉{target}',
    target: '敌方水面编队',
    threat: '反舰火力的饱和攻击',
    stake: '整支战斗群会被迫退出作战海域',
    deadline: '下一波次放飞前的十五分钟',
    locations: ['编队外围的警戒线', '海天线一带', '母舰左舷海域', '海峡口'],
    vehicleHint: /航母|舰载|驱逐舰|巡洋舰|护卫舰|战列舰|两栖攻击舰|carrier|destroyer|cruiser|frigate|battleship/i
  },
  {
    id: 'air-superiority',
    label: '制空作战',
    re: /制空|空战|战斗机|五代机|隐身战机|f-?22|f-?35|歼|dogfight|空中巡逻|加油空域/i,
    objective: '清空{target}',
    target: '敌方制空编队',
    threat: '地面防空网与敌方预警机',
    stake: '己方打击编队会在没有掩护的情况下被逐个击落',
    deadline: '突击编队进入包线前的六分钟',
    locations: ['高空云层之上', '云底下方的突防走廊', '山谷低空', '返航加油空域'],
    vehicleHint: /战斗机|制空|fighter|interceptor|歼击/i
  },
  {
    id: 'strategic-strike',
    label: '战略打击',
    re: /轰炸|战略打击|巡航导弹|洲际|弹道导弹|发射井|纵深|核打击|icbm|b-?2|b-?21|bomber/i,
    objective: '摧毁{target}',
    target: '敌方纵深指挥节点',
    threat: '多层防空网',
    stake: '整条战线会在三天内失去指挥',
    deadline: '打击窗口关闭前的四十分钟',
    locations: ['高空突防航线', '雷达缝隙里的低空走廊', '目标区外缘', '返航跑道'],
    vehicleHint: /轰炸机|bomber|导弹|missile|发射车|发射井|tel/i
  },
  {
    id: 'beach-landing',
    label: '两栖登陆',
    re: /登陆|抢滩|滩头|两栖|诺曼底|冲绳|硫磺岛|塞班|瓜岛|d-?day|landing|amphibious/i,
    objective: '夺取{target}',
    target: '滩头防御枢纽',
    threat: '崖顶的交叉机枪火力',
    stake: '后续梯队会被压在滩上打成筛子',
    deadline: '潮水转向前的三十分钟',
    locations: ['登陆艇跳板前', '浅水区与反登陆障碍', '防波堤下的死角', '崖顶炮位'],
    vehicleHint: /登陆艇|登陆车|两栖|抢滩|希金斯|lvt|lcvp|landing ?craft|amphibious|谢尔曼|sherman|坦克|tank|装甲|armou?r/i
  },
  {
    id: 'armor-clash',
    label: '装甲对决',
    re: /坦克|装甲|对决|库尔斯克|反坦克|钢铁洪流|armor|tank|panzer/i,
    objective: '挡住{target}',
    target: '敌方装甲集群',
    threat: '侧翼的反坦克伏击阵地',
    stake: '整条防线会被撕开一个无法封闭的缺口',
    deadline: '天黑前的两小时',
    locations: ['开阔地边缘', '反坦克壕一线', '村庄的矮墙后', '公路桥路口'],
    vehicleHint: /坦克|装甲|tank|armou?r|panzer/i
  },
  {
    id: 'orbital-ops',
    label: '轨道作战',
    re: /轨道|空间站|零重力|失重|太空|宇航|星际|orbital|\bspace\b|zero-?g/i,
    objective: '修复并夺回{target}',
    target: '失控的空间站核心',
    threat: '真空、碎片带与失压',
    stake: '轨道上所有人会在四十分钟内失去补给与氧气',
    deadline: '轨道衰减到不可逆前的四十分钟',
    // 「核心舱检修口」是**一个零件**，不是一片区域；它会写出「核心舱检修口在真空里无声自转」。
    // 改成有延展性的空间段，句法才成立。
    locations: ['对接舱外侧', '外部桁架的中段', '核心舱与太阳翼之间的连接段', '太阳翼根部'],
    vehicleHint: /轨道|航天|空间站|orbital|space ?station/i
  },
  {
    id: 'rescue-extract',
    label: '营救撤离',
    re: /营救|搜救|撤离|撤侨|人质|跳伞飞行员|落难|csar|rescue|evacuation|extraction/i,
    objective: '把{target}带出来',
    target: '被困的机组',
    threat: '正在合拢的包围圈',
    stake: '被困的机组就再也带不回来了',
    deadline: '包围圈合拢前的二十五分钟',
    locations: ['坠机点', '河谷低空', '撤离着陆场', '云层下方'],
    vehicleHint: /直升机|救援|搜救|运输机|helicopter|rescue|huey|hind|black ?hawk/i
  },
  {
    id: 'urban-raid',
    label: '城市突袭',
    re: /巷战|城市|废墟|突袭|破门|室内|公寓|街道|夜间渗透|urban|city|cqb|raid/i,
    objective: '摸进{target}',
    target: '敌方指挥掩体',
    threat: '街道两侧的交叉火力',
    stake: '己方会在接下来的巷战里彻底失去主动权',
    deadline: '天亮前的四十分钟',
    locations: ['街区入口', '楼梯间', '地下室走廊', '楼顶'],
    vehicleHint: /装甲车|步兵战车|输送车|ifv|apc|mrap|坦克|tank/i
  },
  {
    id: 'general-combat',
    label: '正面交战',
    re: /.*/,
    objective: '拿下{target}',
    target: '敌方阵地',
    threat: '纵深火力与侧后包抄',
    stake: '任务失败，所有人白死一场',
    deadline: '天亮前的一个小时',
    locations: ['出发线', '开阔地', '掩体一线', '敌方阵地'],
    vehicleHint: null
  }
];

/** 由题材 + 意图识别任务原型（顺序敏感：先命中先算） */
export function detectArc(theme, intent = {}) {
  const hay = `${theme || ''} ${intent.era || ''} ${intent.task || ''} ${intent.setting || ''}`;
  for (const arc of ARCS) {
    if (arc.re.test(hay)) return arc;
  }
  return ARCS[ARCS.length - 1];
}

/* ================================================================== *
 * 2. 名词解析 —— 让题材里真的出现「具体的东西」
 * ================================================================== */

/** 题材点名的目标物（优先于原型默认值，让「碉堡 / 机场 / 雷达站」这类词能落地） */
const TARGET_HINTS = [
  [/碉堡|地堡|机枪巢|bunker|pillbox/i, '崖顶碉堡'],
  [/机场|跑道|airfield|runway|airbase/i, '敌方前线机场'],
  [/雷达|radar/i, '远程预警雷达站'],
  [/桥梁|大桥|渡口|bridge/i, '关键桥梁'],
  [/港口|码头|军港|port|harbou?r/i, '敌方补给港口'],
  [/指挥所|指挥部|地下掩体|hq|command/i, '敌方指挥掩体'],
  [/发射井|导弹阵地|导弹旅|missile|icbm/i, '导弹发射阵地'],
  [/电站|电厂|变电站|发电|power ?plant/i, '敌方电力枢纽'],
  [/水坝|大坝|dam/i, '上游水坝'],
  [/仓库|补给站|后勤|油库|supply|depot|fuel/i, '敌方后勤枢纽'],
  [/桥梁|桥|bridge/i, '关键桥梁'],
  [/工厂|军工厂|制造|factory/i, '敌方军工厂']
];

/** 题材点名的威胁 */
const THREAT_HINTS = [
  [/防空|sam|地空导弹|防空导弹/i, '多层防空网'],
  [/雷区|地雷|minefield/i, '预先布设的雷区'],
  [/伏击|ambush/i, '预设的伏击阵地'],
  [/狙击|sniper/i, '隐蔽的狙击手'],
  [/装甲|坦克|armor|tank/i, '敌方装甲预备队'],
  [/电子战|干扰|jamming|electronic/i, '全频段电子压制'],
  [/无人机|蜂群|drone|swarm/i, '蜂群无人机'],
  [/生化|化学|nbc|cbrn/i, '沾染区']
];

function firstHit(hints, text, fallback) {
  for (const [re, value] of hints) {
    if (re.test(text)) return value;
  }
  return fallback;
}

/**
 * 解析本次行动的「具体名词」。
 *
 * 优先级：题材点名词 > 原型默认词 > 环境资产名。
 * 这样「轰炸敌方雷达站」与「轰炸敌方指挥所」会得到不同的 {target}，
 * 而不是共用原型里那句「敌方纵深指挥节点」。
 */
export function resolveNouns({ arc, theme = '', cast = {}, env = null } = {}) {
  const text = String(theme || '');
  const place = (env && (env.nameZh || env.name)) || '战场';

  // 目标物：题材点名词优先，其次原型默认词。
  // 早期还有一条「用题材点名的载具当目标」的兜底，但 cast.vehicles 是**我方**装备，
  // 于是「F-22 制空巡逻」被写成「清空 F-22 所在的目标区」——语义完全反了，已删除。
  const target = firstHit(TARGET_HINTS, text, arc.target);

  const threat = firstHit(THREAT_HINTS, text, arc.threat);
  // objective 里含 {target}，这里一次填掉，避免下游出现「夺取{target}」这种半成品
  const objective = String(arc.objective).replace('{target}', target);
  return { place, target, threat, objective, stake: arc.stake, deadline: arc.deadline };
}

/* ================================================================== *
 * 3. 因果连接词
 *
 * 这是「有剧情」与「一叠卡片」的分界：后一镜必须承接前一镜的结果。
 * 按**前一镜的戏剧功能**取词，因此与骨架具体写了哪一句无关，
 * 骨架换词、换原型都不会让连接词失配。
 * ================================================================== */

const LINK_BY_PREV = {
  goal: '目标已经明确，',
  world: '局势铺开之后，',
  character: '',
  approach: '队伍已经摸到近处，',
  observe: '观察结束，',
  plan: '计划定下了，',
  contact: '刚接上火，',
  escalate: '压力还在加码，',
  reveal: '情报已经被推翻，',
  decision: '决定已经做出，',
  reversal: '形势刚刚反转，',
  clash: '双方已经绞在一起，',
  cost: '代价刚刚发生，',
  quiet: '枪声忽然停了，',
  aftermath: '',
  reaction: '',
  close: ''
};

/**
 * 这几类镜头自带收束语气，前面再挂一个「因为…」反而会读成病句
 * （实测「交火还没停，炮位哑了」自相矛盾）。它们一律不加连接词。
 */
const NO_LINK_CUR = new Set(['goal', 'world', 'character', 'aftermath', 'close', 'reaction']);

/**
 * 取本镜的因果连接词。
 * @param {string|null} prevFn 前一镜的戏剧功能
 * @param {string} curFn 本镜的戏剧功能
 */
export function linkFor(prevFn, curFn) {
  if (!prevFn) return '';
  if (NO_LINK_CUR.has(curFn)) return '';
  return LINK_BY_PREV[prevFn] || '';
}

/* ================================================================== *
 * 4. 共享「质感节拍」
 *
 * 这些功能（铺陈规模 / 人物时刻 / 接近 / 观察 / 静默 / 反应）在任何一个战争题材里
 * 都是同一件事，真正的题材差异由 {place}{target}{threat}{deadline} 承担。
 * 因此它们不必逐原型重写，但**必须**带上题材名词，否则又退回通用模板。
 * ================================================================== */

const TEXTURE = {
  world: [
    {
      fn: 'world', phase: 'establish', focus: 'hero', domains: ['naval'],
      action: '{link}镜头贴着海面低掠，{place}在{weather}里被压成一条发白的线，浪从画面两侧切进来。',
      audioCue: '浪声压过一切 · 船体结构低频呻吟',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'world', phase: 'establish', focus: 'hero', domains: ['air'],
      action: '{link}镜头从云层上方拉开，{place}在{weather}下方摊成一整张地图，机影只是上面几个缓慢移动的点。',
      audioCue: '高空风噪 · 座舱增压的持续底噪',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'world', phase: 'establish', focus: 'hero', domains: ['strategic'],
      action: '{link}镜头从发射位上方缓慢横移，{place}在{weather}里安静得不像在打仗，只有设备指示灯在一格格闪。',
      audioCue: '电流嗡鸣 · 空调低频 · 没有任何人声',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'world', phase: 'establish', focus: 'hero', domains: ['orbital'],
      action: '{link}镜头沿舱体外壁缓慢滑行，{place}在{weather}里无声自转，地球的弧线压在画面下缘。',
      audioCue: '结构应力声 · 完全真空的静默',
      radioVoice: '【无线电】（静默）'
    },
    // 无 domains = 通用兜底（陆战域与识别不出战场域的题材走这一条）
    {
      fn: 'world', phase: 'establish', focus: 'hero',
      action: '{link}镜头缓缓升起，{place}在{weather}里铺开成一片没有尽头的灰色，人影缩成几个几乎看不见的黑点。',
      audioCue: '风声铺满整个声场 · 没有任何人声',
      radioVoice: '【无线电】（静默）'
    }
  ],
  character: [
    {
      fn: 'character', phase: 'establish', focus: 'squad',
      action: '{link}{supportCallsign}把一张被汗浸皱的照片塞回胸袋，低声说：「{deadline}，够吗？」{heroCallsign}没回答，只是把弹匣压紧。',
      audioCue: '布料摩擦 · 金属弹匣入位的轻响',
      radioVoice: '【无线电】（没有按下通话键）'
    },
    {
      fn: 'character', phase: 'establish', focus: 'squad', domains: ['naval'],
      action: '{link}{supportCallsign}在声呐屏的余光里看了{heroCallsign}一眼，低声说：「{deadline}，够吗？」{heroCallsign}没回答，只是把手按在冰凉的舱壁上，感受那台机器的心跳。',
      audioCue: '声呐滴答 · 舱壁传导的机械低鸣',
      radioVoice: '【无线电】（没有按下通话键）'
    },
    {
      fn: 'character', phase: 'establish', focus: 'squad', domains: ['air'],
      action: '{link}{supportCallsign}在数据链上敲了一行字给{heroCallsign}：「{deadline}，够吗？」{heroCallsign}在座舱盖的反光里看了自己一眼，把一张折了角的照片塞进飞行服内袋，按平，扣好。',
      audioCue: '座舱通风声 · 织物扣合的轻响',
      radioVoice: '【无线电】（没有按下通话键）'
    },
    {
      fn: 'character', phase: 'establish', focus: 'squad', domains: ['orbital'],
      action: '{link}{supportCallsign}把家人的照片贴在舷窗内侧，让它和外面那道地球的弧线并排挂着。{heroCallsign}看了一眼，什么也没说。',
      audioCue: '通风系统白噪 · 极轻的弦乐单音',
      radioVoice: '【无线电】（没有按下通话键）'
    },
    {
      // focus 必须是 squad：这句同时写到了主角与声呐手两个人。
      // 写成 hero 时 subjects 只有主角一人，{supportCallsign} 会塌回主角自己，
      // 渲染成「邓肯把手按在舱壁上……邓肯在声呐屏的余光里看了他一眼」。
      fn: 'character', phase: 'establish', focus: 'squad', domains: ['naval'],
      action: '{link}{heroCallsign}把手按在冰凉的舱壁上，隔着钢板感受那台机器的心跳。{supportCallsign}在声呐屏的余光里看了他一眼：「{deadline}，够吗？」',
      audioCue: '声呐滴答 · 舱壁传导的机械低鸣',
      radioVoice: '【无线电】（没有按下通话键）'
    },
    {
      fn: 'character', phase: 'establish', focus: 'hero', domains: ['air'],
      action: '{link}{heroCallsign}在座舱盖的反光里看了自己一眼，把一张折了角的照片塞进飞行服内袋，按平，扣好。',
      audioCue: '座舱通风声 · 织物扣合的轻响',
      radioVoice: '【无线电】（没有按下通话键）'
    },
    {
      fn: 'character', phase: 'establish', focus: 'hero', domains: ['orbital'],
      action: '{link}{heroCallsign}把家人的照片贴在舷窗内侧，让它和外面那道地球的弧线并排挂着，谁也没说话。',
      audioCue: '通风系统白噪 · 极轻的弦乐单音',
      radioVoice: '【无线电】（没有按下通话键）'
    },
    {
      fn: 'character', phase: 'establish', focus: 'hero',
      action: '{link}{heroCallsign}从胸袋里摸出一张被汗浸皱的照片，看了两秒，又塞了回去。',
      audioCue: '布料摩擦 · 极轻的弦乐单音',
      radioVoice: '【无线电】（没有按下通话键）'
    }
  ],
  approach: [
    {
      fn: 'approach', phase: 'establish', focus: 'hero', domains: ['naval'],
      action: '{link}{heroCallsign}把航速一档一档往下压，让艇体贴着{place}的边缘滑行，每转一次舵就停三秒，听。',
      audioCue: '螺旋桨转速一点点掉下去 · 只有水声',
      radioVoice: '【无线电】我在往里摸，别出声。'
    },
    {
      fn: 'approach', phase: 'establish', focus: 'hero', domains: ['air'],
      action: '{link}{heroCallsign}压低高度，让机影贴着{place}的地形起伏走，每越过一道山脊就偏一次航向。',
      audioCue: '发动机转速变化 · 气流刮过机体',
      radioVoice: '【无线电】我在低空进，保持无线电静默。'
    },
    {
      fn: 'approach', phase: 'establish', focus: 'hero', domains: ['orbital'],
      action: '{link}{heroCallsign}一格一格地收放系绳，沿着{place}的桁架往前挪，每挪一米就确认一次姿态。',
      audioCue: '系绳卷收的咔哒声 · 呼吸在头盔里被放大',
      radioVoice: '【无线电】我在外侧移动，注意我的位置。'
    },
    {
      fn: 'approach', phase: 'establish', focus: 'hero',
      action: '{link}{heroCallsign}沿{place}的边缘一寸寸前移，每三米停一次，听。',
      audioCue: '衣料刮擦地面 · 呼吸被刻意放慢',
      radioVoice: '【无线电】我在往里摸，别出声。'
    }
  ],
  observe: [
    {
      fn: 'observe', phase: 'establish', focus: 'enemy', domains: ['naval'],
      action: '{link}{vocab.sensor}上，{enemyCallsign}的编队正从{place}另一侧经过。{heroCallsign}没有下令开火，只是报出方位和距离。',
      audioCue: '声呐接触音 · 极克制的口令',
      radioVoice: '【无线电】接触，方位零九零，等它进杀伤区。'
    },
    {
      fn: 'observe', phase: 'establish', focus: 'enemy', domains: ['air'],
      action: '{link}{enemyCallsign}的编队正从{place}边缘切入。{heroCallsign}没有立刻开火，只是数了数对方的数量。',
      audioCue: '雷达告警的间隔提示音 · 呼吸被放慢',
      radioVoice: '【无线电】目标四机，别急，让它先进来。'
    },
    {
      fn: 'observe', phase: 'establish', focus: 'enemy',
      action: '{link}准星里，{enemyCallsign}的巡逻队正从{place}尽头经过。{heroCallsign}没有开火，只是数人数。',
      audioCue: '远处口令声 · 风声掩盖脚步',
      radioVoice: '【无线电】目标在动，等他们全部进入杀伤区。'
    },
    {
      fn: 'observe', phase: 'build', focus: 'hero',
      action: '{link}{heroCallsign}蹲在{place}的阴影里校准瞄具，呼吸压到最低，{weather}替他掩去了大半轮廓。',
      audioCue: '瞄具微调咔哒声 · 压抑的呼吸',
      radioVoice: '【无线电】我已就位，等我的信号。'
    }
  ],
  quiet: [
    {
      fn: 'quiet', phase: 'climax', focus: 'hero', domains: ['naval'],
      action: '{link}全片第一次彻底安静。{place}里只剩艇壳在压力下偶尔发出的一声脆响，{heroCallsign}数着自己的心跳。',
      audioCue: '金属受压的脆响 · 心跳 · 除此之外什么都没有',
      radioVoice: '【无线电】（没有人说话）'
    },
    {
      fn: 'quiet', phase: 'climax', focus: 'hero', domains: ['air'],
      action: '{link}全片第一次彻底安静。{place}里只剩燃油泵的低鸣，{heroCallsign}盯着油量数字一格一格往下掉。',
      audioCue: '燃油泵低鸣 · 告警灯无声闪烁',
      radioVoice: '【无线电】（没有人说话）'
    },
    {
      fn: 'quiet', phase: 'climax', focus: 'hero', domains: ['orbital'],
      action: '{link}全片第一次彻底安静。{place}里只剩通风系统的白噪，{heroCallsign}数着自己的呼吸。',
      audioCue: '通风白噪 · 呼吸在头盔里被放大',
      radioVoice: '【无线电】（没有人说话）'
    },
    {
      fn: 'quiet', phase: 'climax', focus: 'hero',
      action: '{link}全片第一次彻底安静。{place}里只有水滴砸在钢板上的声音，{heroCallsign}数着自己的心跳。',
      audioCue: '水滴 · 心跳 · 除此之外什么都没有',
      radioVoice: '【无线电】（没有人说话）'
    }
  ],
  reaction: [
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero', domains: ['naval'],
      action: '{link}镜头怼在{heroCallsign}的脸上。海面在他身后重新合拢，他什么都没说，但所有人都读懂了。',
      audioCue: '完全静音 · 只有海水拍打艇壳的声音',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero', domains: ['naval'],
      action: '{link}镜头怼在{heroCallsign}的脸上。舱内没人敢先开口，只有深度计还在缓慢跳字。',
      audioCue: '完全静音 · 深度计的机械跳字声',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero', domains: ['naval'],
      action: '{link}镜头怼在{heroCallsign}的脸上。他摘下耳机，耳边那点声呐的余音还没散。',
      audioCue: '完全静音 · 耳机里残留的电流噪声',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero', domains: ['air'],
      action: '{link}镜头怼在{heroCallsign}的脸上。座舱盖外的天光从他面罩上滑过去，他什么都没说，但所有人都读懂了。',
      audioCue: '完全静音 · 只有发动机慢慢冷却的滴答',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero', domains: ['air'],
      action: '{link}镜头怼在{heroCallsign}的脸上。他摘下头盔，头发被汗压在额头上，很久没有说话。',
      audioCue: '完全静音 · 地面人员跑动的脚步',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero', domains: ['air'],
      action: '{link}镜头怼在{heroCallsign}的脸上。他一直在看油量，直到指针不再动了。',
      audioCue: '完全静音 · 液压系统泄压的长音',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero', domains: ['strategic'],
      action: '{link}镜头怼在{heroCallsign}的脸上。屏幕上那行确认字符还在闪，他什么都没说，但所有人都读懂了。',
      audioCue: '完全静音 · 只剩设备指示灯的电流声',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero', domains: ['orbital'],
      action: '{link}镜头怼在{heroCallsign}的脸上。地球的弧线从他面罩上一寸寸移过去，他什么都没说，但所有人都读懂了。',
      audioCue: '完全静音 · 只有结构应力的持续低鸣',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}镜头怼在{heroCallsign}的脸上。他什么都没说，但所有人都读懂了。',
      audioCue: '完全静音 · 只有远处的零星燃烧声',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}镜头怼在{heroCallsign}的脸上，停了三秒。他抬手抹了一把脸，手在抖。',
      audioCue: '完全静音 · 只有他自己的呼吸',
      radioVoice: '【无线电】（静默）'
    },
    {
      fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}镜头怼在{heroCallsign}的脸上。他盯着画面外的某一点，很久没有眨眼。',
      audioCue: '完全静音 · 远处有人开始喊撤',
      radioVoice: '【无线电】（静默）'
    }
  ]
};

/* ================================================================== *
 * 5. 各原型的剧本骨架
 *
 * 每个原型写 11 个「剧情承载」功能。文本里的占位符：
 *   {heroCallsign}{supportCallsign}{enemyCallsign}{vehicle}  —— 由名册填
 *   {env}{weather}                                           —— 环境与气象
 *   {place}{target}{threat}{stake}{deadline}                  —— 由 resolveNouns 填
 *   {link}                                                    —— 因果连接词
 *   {vocab.xxx}                                               —— 时代词汇
 * ================================================================== */

const SLOTS = {
  /* ---------------------------------------------------------------- 反无人机防御 */
  'counter-uas': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '阵地的告警灯在无风的天里一排排亮起来。{heroCallsign}盯着低空搜索雷达：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '告警音由低到高 · 发电机转速上扬',
      radioVoice: '【无线电】全阵地进入反无人机状态，非必要人员进掩体。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「把{vocab.counterDrone}架到最外圈，先放它们进来再打。」{heroCallsign}在沙盘上画出一个漏斗，「近了才打得中。」',
      audioCue: '沙盘推杆 · 装填手拉开电源柜',
      radioVoice: '【无线电】漏斗部署，放近了再打。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}第一波蜂群从低云下面钻出来，{vocab.counterDrone}同时开火，天空被点成一串断续的光点——{enemyCallsign}的蜂群开始分散突防，双方在{place}上空交战。',
      audioCue: '定向能充能的啸叫 · 小型旋翼的密集嗡鸣',
      radioVoice: '【无线电】接触！低空，数量三十以上！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}把发射阵列抬到最大仰角，{heroCallsign}看着电容一格一格充满，手指悬在放电键上方。',
        audioCue: '电容充能上扬 · 冷却泵启动',
        radioVoice: '【无线电】一号阵位充能中，再给我五秒。' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}连续放电，把突入内圈的蜂群一架架打下来，{heroCallsign}在{place}的烟尘里报出下一个扇区。',
        audioCue: '连续放电的爆响 · 残骸落在钢板上的脆声',
        radioVoice: '【无线电】扇区三清了，转扇区四！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}频谱屏上多出一段不该有的信号。{heroCallsign}放大波形：「前面这批是诱饵——它们在测我们的开火节奏。」',
      audioCue: '频谱仪的扫描音 · 阵地突然安静',
      radioVoice: '【无线电】……这批是诱饵。真正的目标还没出现。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}按现在的节奏打，节奏就会被对方摸透；改成三发一停，火力密度要掉一半。{heroCallsign}选了后者。',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】改节奏。三发一停，都听我的。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}节奏刚改，对面的主力就从{place}的另一侧压了下来——它们一直在等这个缺口。{heroCallsign}把最后两台阵位全推了上去。',
      audioCue: '低频轰鸣由远及近 · 告警音连成一片',
      radioVoice: '【无线电】第二波！从西边！全部阵位转向！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}与{enemyCallsign}在{place}上空绞在一起交战，近程火力在几百米内织成一堵墙，被打碎的机骸像雨一样落在阵地上。',
      audioCue: '近防火力连射 · 碎片砸落金属棚顶',
      radioVoice: '【无线电】压住它！别让它进内圈！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}一台阵位在过载中烧了。{supportCallsign}扑上去切电源，手背被烫掉一层皮，却把剩下的阵列保住了。',
      audioCue: '电弧爆响 · 灭火器喷放',
      radioVoice: '【无线电】三号阵位弃了！别管它，保住剩下的！' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}天空空了。{heroCallsign}摘下耳机，耳朵里还有一层没散掉的嗡鸣。',
      audioCue: '余烬落地 · 发电机慢慢降速',
      radioVoice: '【无线电】空域干净，蜂群全灭。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}阵地上落满烧焦的塑料壳。{heroCallsign}蹲下去捡起一架还算完整的残骸，翻过来看了看编号，然后放进口袋。',
      audioCue: '塑料壳相碰的轻响 · 极静的配乐',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}{heroCallsign}站起来，把口袋里那架残骸按了按，转向下一处阵位。',
      audioCue: '脚步踩过碎片 · 低频配乐收束',
      radioVoice: '【无线电】收队。下一波还会来。' }]
  },

  /* ---------------------------------------------------------------- 蜂群突防 */
  'swarm-strike': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '机库的灯只开了一半。{heroCallsign}把投放箱的盖子拍上：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '箱盖扣合 · 无人机自检的电子音',
      radioVoice: '【无线电】蜂群已上电，等投放窗口。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「分三股走，走不同高度。」{heroCallsign}在投放图上标出三条线，「第一股先去把他们的雷达叫醒。」',
      audioCue: '投放图翻动 · 战术口令',
      radioVoice: '【无线电】三股分进，第一股负责诱饵。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}第一股刚进到{place}，地面的{vocab.counterDrone}就亮了。{enemyCallsign}的防空火力把天空切成一块块，{heroCallsign}下令第二股立刻压低高度，双方在低空交战。',
      audioCue: '近防炮连射 · 小型旋翼被撕碎的脆响',
      radioVoice: '【无线电】第一股被打掉了！第二股压到五十米！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}从投放箱里一架接一架弹出去，在{place}编成一张网，{heroCallsign}盯着屏幕上跳动的编号。',
        audioCue: '弹射器连续击发 · 旋翼嗡鸣叠成一片',
        radioVoice: '【无线电】蜂群展开完毕，网格成形。' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}贴着楼顶掠过，把{vocab.jamming}压在对方雷达头上，{heroCallsign}在频谱屏上看着那片噪声越铺越开。',
        audioCue: '干扰噪声铺满 · 数据链提示音',
        radioVoice: '【无线电】压制到位，第三股可以进了。' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}频谱上冒出一个新的辐射源。{heroCallsign}盯着它：「他们关了主雷达，改用备用的——而且这个备用机在动，是车载的。」',
      audioCue: '频谱仪扫描音 · 舱内突然安静',
      radioVoice: '【无线电】……他们换了备用雷达。目标在移动。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}撤回去明天再来，还是把剩下的蜂群全压上去赌一次。{heroCallsign}把最后一箱推上了发射位。',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】全投。今天必须打掉它。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}蜂群刚进入末端，对方的{vocab.jamming}突然反卷回来——链路上三成的编号同时变灰。{heroCallsign}只能把剩下的全部切成自主模式。',
      audioCue: '链路告警音 · 编号一个个熄灭的电子声',
      radioVoice: '【无线电】链路被压了！剩下的全部自主！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}剩下的蜂群在{place}上空与{enemyCallsign}的拦截火力正面交战，一架接一架撞在雷达阵面上，把整座天线拖进火里。',
      audioCue: '连续撞击爆炸 · 结构垮塌',
      radioVoice: '【无线电】它在烧！天线倒了！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}最后一批蜂群的链路彻底断了，屏幕上一片灰。{supportCallsign}还戴着耳机在等回波，什么也没等到。',
      audioCue: '链路彻底静默 · 只剩机库的电流声',
      radioVoice: '【无线电】……没有回波了。全都没了。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}目标区的火还在烧。{heroCallsign}把空掉的投放箱盖子合上，坐回椅子上。',
      audioCue: '远处燃烧 · 空调低频',
      radioVoice: '【无线电】雷达站已瘫痪，波次取消。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}机库里只剩他自己。{heroCallsign}把屏幕上最后一条航迹回放到第一架起飞的那一刻，看了一遍，然后关掉。',
      audioCue: '完全静音 · 只有设备散热的细响',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}{heroCallsign}把空箱子推回架子上，拍了拍箱盖。',
      audioCue: '空箱滑轨声 · 低频配乐收束',
      radioVoice: '【无线电】收队。箱子明天再补。' }]
  },

  /* ---------------------------------------------------------------- 高超音速打击 */
  'hypersonic-strike': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '发射阵地上的伪装网被掀开一角。{heroCallsign}把装着坐标的平板按在发射箱上：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '伪装网摩擦 · 液压起竖的低频',
      radioVoice: '【无线电】发射阵位展开，进入倒计时。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「走最高弹道，把滑翔段压在{threat}的盲区里。」{heroCallsign}在弹道图上划出一条几乎贴着大气层边缘的弧。',
      audioCue: '弹道图推演音 · 口令交替',
      radioVoice: '【无线电】弹道已装订，滑翔段规避中段拦截。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}升空后第四分钟，{enemyCallsign}的{vocab.interceptor}从三个方向同时爬升，锁定告警在屏幕上连成一片。{heroCallsign}必须让滑翔体在交汇前完成机动，双方在拦截窗口里正面交战。',
      audioCue: '拦截弹上升的呼啸 · 告警音连响',
      radioVoice: '【无线电】被拦截弹跟踪！准备机动！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}在大气层边缘压出一个剧烈的横向机动，{heroCallsign}看着过载数字顶到结构上限又退回来。',
        audioCue: '结构应力声 · 遥测数据流',
        radioVoice: '【无线电】机动完成，拦截弹在往外甩。' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}在再入段拉出一道等离子尾迹，{heroCallsign}把最后的修正量压进指令，屏幕上的交汇倒计时只剩两位数。',
        audioCue: '等离子包裹的电流声 · 倒计时提示音',
        radioVoice: '【无线电】再入正常，末端三十秒。' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}光电画面上，目标不是固定阵地，是一列正在转移的发射车。{heroCallsign}盯着那串坐标：「他们知道我们要来。」',
      audioCue: '光电画面电子音 · 作战室安静',
      radioVoice: '【无线电】……目标在转移。是机动发射车。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}修正坐标会把剩下的燃料吃光，打出去就没有第二次。{heroCallsign}报了「修正」。',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】修正坐标，照打。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}修正刚发出去，第二组拦截弹从侧面进入——对面早就把机动也预案好了。{heroCallsign}把最后一组诱饵全放了出去。',
      audioCue: '诱饵分离的爆破音 · 告警连响',
      radioVoice: '【无线电】第二组拦截弹！放诱饵！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}让滑翔体在{place}与{enemyCallsign}的拦截弹群正面对抗，诱饵一个个炸开，把拦截弹引向空处。',
      audioCue: '连续分离爆响 · 遥测链路雪花声',
      radioVoice: '【无线电】它在躲！保持链路！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}最后一个诱饵用完，遥测链路在{place}断了。{supportCallsign}还在报数据，报到最后一句戛然而止。',
      audioCue: '链路中断的电流噪声 · 完全静默',
      radioVoice: '【无线电】……链路丢了。我们看不见它了。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}十二分钟后，远方的传感器确认了命中。{heroCallsign}把平板放下，没有去看欢呼的人。',
      audioCue: '远处低沉的一声闷响 · 随后安静',
      radioVoice: '【无线电】目标确认摧毁，拦截失败。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}作战室里开始有人说话。{heroCallsign}一个人走到外面，站在伪装网下面，抬头看了一会儿天，什么也没说。',
      audioCue: '夜风 · 远处发电机的低频',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}{heroCallsign}回到屏幕前，把下一次值班的名单调出来。',
      audioCue: '键盘声 · 低频配乐收束',
      radioVoice: '【无线电】收队。弹道参数归档。' }]
  },

  /* ---------------------------------------------------------------- 电磁网络压制 */
  'ew-cyber': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '{heroCallsign}在频谱屏前站定，指着图上那片空白：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '频谱仪的扫描音 · 机房风扇底噪',
      radioVoice: '【无线电】电子战分队就位，等突击队的信号。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「先把他们的数据链压掉，再灌一段假的进去。」{heroCallsign}在频谱图上圈出三个频段，「真的那一段留给我们自己用。」',
      audioCue: '键盘连击 · 频谱波形在屏幕上滚动',
      radioVoice: '【无线电】压制顺序定了，第一段三分钟。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}压制一开，{enemyCallsign}的反辐射分队立刻顺着辐射源找过来，{vocab.jamming}在{place}铺开，和对方的反干扰绞在一起——他们先在频谱上打了一场交战。',
      audioCue: '干扰噪声铺满 · 反辐射告警连响',
      radioVoice: '【无线电】被反辐射锁定了！天线车撤！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}把天线阵转到背向，{heroCallsign}一边看着功率曲线，一边数着对方的测向周期。',
        audioCue: '天线阵转动的伺服声 · 功率计滴答',
        radioVoice: '【无线电】我在躲它的测向，再给我两分钟。' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}把一段伪造的指令灌进对方的{vocab.datalink}，{heroCallsign}在屏幕上看着对面的火力开始往错误的方向压。',
        audioCue: '数据灌入的连续电子音 · 无线电里出现被劫持的口令',
        radioVoice: '【无线电】假指令进去了，他们在往空地打。' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}链路里突然出现一段不该存在的回执。{heroCallsign}把它解出来，脸色变了：「他们早就知道我们会用这一段——这封回执是给我们的。」',
      audioCue: '解码完成的提示音 · 机房突然安静',
      radioVoice: '【无线电】……这是回执。他们一直在等我们开口。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}继续用这一段，就等于把突击队的位置送出去；停掉，突击队就没有掩护。{heroCallsign}选择把整段链路烧掉。',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】烧链路。现在。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}链路一断，对方的电子战飞机立刻顶了上来，把压制反推回己方——{heroCallsign}的屏幕上第一次出现了全频段的噪声底。',
      audioCue: '噪声底抬升 · 所有频道同时失聪',
      radioVoice: '【无线电】我们被压了！所有频道都是噪声！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}与{enemyCallsign}在同一片频谱上正面对抗，功率曲线互相咬着往上顶，谁先关机会谁就先暴露位置。',
      audioCue: '功率过载的电流嘶声 · 设备风扇全速',
      radioVoice: '【无线电】顶住！谁先关谁死！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}功率顶到极限，末级功放烧了。{supportCallsign}把手从发烫的机柜上拿开，掌心上是一道红印。',
      audioCue: '功放烧毁的爆响 · 灭火器喷放',
      radioVoice: '【无线电】末级烧了！阵位还在！' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}频谱慢慢安静下来。{heroCallsign}摘下耳机，听见外面突击队的直升机已经过去了。',
      audioCue: '风扇降速 · 远处旋翼由近及远',
      radioVoice: '【无线电】突击队已通过，掩护任务完成。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}机房里全是烧焦的气味。{heroCallsign}把烧掉的那台功放的日志导出来，看了很久，才合上盖子。',
      audioCue: '完全静音 · 只有散热风扇的余响',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}{heroCallsign}把备用机柜的电源推上去，指示灯一排排亮起来。',
      audioCue: '继电器合闸的连响 · 低频配乐收束',
      radioVoice: '【无线电】收队。备用阵位已接管。' }]
  },

  /* ---------------------------------------------------------------- 外骨骼突击 */
  'mech-assault': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '{heroCallsign}在出发线上把外骨骼的锁扣一个个扣紧，然后敲了敲胸前的装甲板：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '液压锁扣闭合 · 伺服电机自检',
      radioVoice: '【无线电】外骨骼满电，突击组就位。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'squad',
      action: '{link}「让无人战车走前面蹚雷，我们从它压出来的缺口进去。」{heroCallsign}在头盔里把路线推给每个人。',
      audioCue: '头盔显示器启动音 · 战术口令',
      radioVoice: '【无线电】无人战车先导，人跟车走。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}无人战车刚压上第一片废墟，{enemyCallsign}的反装甲伏击就从{place}两侧同时开火，{heroCallsign}被冲击波掀得后退两步，双方在废墟里立刻交战。',
      audioCue: '反装甲命中爆响 · 碎石砸在装甲板上',
      radioVoice: '【无线电】伏击！两侧！找掩体！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}用机械臂扒开塌掉的楼板，{heroCallsign}借着它的车体当掩体往前跃进，外骨骼的伺服声盖过了枪声。',
        audioCue: '机械臂液压声 · 伺服电机高转',
        radioVoice: '【无线电】缺口打开了，跟上来！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}把武器站转向第二道墙，{heroCallsign}在它后面完成换弹，肩上的后坐力被外骨骼整个吃掉。',
        audioCue: '武器站转向的伺服声 · 大口径射击',
        radioVoice: '【无线电】第二道墙压制住了，我上！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}墙后面不是守军，是一排还在待机的战斗机器人。{heroCallsign}愣了一瞬：「他们是准备放机器人反冲的——我们提前了三分钟。」',
      audioCue: '机器人待机的低频嗡鸣 · 音乐骤然停住',
      radioVoice: '【无线电】……是机器人。它们还没启动。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}趁它们没启动全部打掉，还是留着抢回去。{heroCallsign}选择了全部打掉。',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】全打掉。不留一台。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}第一台机器人被击中时，整排同时亮了。对方的备用链路把它们全部唤醒，{heroCallsign}的弹药计数器第一次掉到两位数。',
      audioCue: '机器人集体启动的齐响 · 弹药告警',
      radioVoice: '【无线电】它们醒了！全都醒了！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      // 「正面对轰」不含 COMBAT_ACTION_REGEX 里的任何交战词，会直接触发
      // FACTION_CONFLICT_INVALID（对立阵营同框却没有对抗语义）。这里必须出现
      // 交战 / 交火 / 压制 之类的显式对抗词。
      action: '{link}{heroCallsign}在外骨骼的助力下与{enemyCallsign}的机器人近身交战，机械臂把扑上来的一台按进墙里，装甲板上留下一道道划痕。',
      audioCue: '金属撞击 · 液压过载的嘶叫',
      radioVoice: '【无线电】近战！压住它们！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}外骨骼的右腿伺服被打穿，{supportCallsign}替{heroCallsign}挡住了第二发。{heroCallsign}把他拖到墙后，自己卸掉了报废的腿部支架。',
      audioCue: '伺服失效的泄气声 · 拖拽装甲板的摩擦',
      radioVoice: '【无线电】我腿废了，还能走。别管我，继续。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}废墟里只剩还在冒烟的铁壳。{heroCallsign}把报废的腿部支架解下来靠在墙上，自己站了起来。',
      audioCue: '余烬噼啪 · 远处零星枪声',
      radioVoice: '【无线电】突破口已打开，后续梯队可以进了。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}他靠着墙站了一会儿，才把头盔摘下来。{heroCallsign}看着那一排不再亮的机器人，很久没有动。',
      audioCue: '风声穿过废墟 · 配乐极轻',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}{heroCallsign}把报废的支架留在原地，一步一步走向突破口。',
      audioCue: '脚步落在碎石上 · 低频配乐收束',
      radioVoice: '【无线电】收队。路是开的了。' }]
  },

  /* ---------------------------------------------------------------- 使馆撤侨 */
  'embassy-evac': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '围墙上的探照灯扫过院落。{heroCallsign}把撤离名单按在沙袋上：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '远处人群的低频喧嚣 · 探照灯电流声',
      radioVoice: '【无线电】所有人注意，撤离顺序已经定了，不要乱。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'squad',
      action: '{link}「车队从侧门走，直升机在楼顶接最后一批。」{heroCallsign}把名单分成两叠，「女人和孩子先走。」',
      audioCue: '纸张翻动 · 车门关合的闷响',
      radioVoice: '【无线电】侧门车队三分钟后出发，楼顶待命。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}车队刚出侧门，{enemyCallsign}的武装人群就从街角压上来，把{place}堵死，石块和曳光一起砸在车身上，{heroCallsign}不得不下令车队就地停下、就地交战。',
      audioCue: '石块砸在装甲上 · 短点射 · 人群的喊声',
      radioVoice: '【无线电】车队被拦住了！就地防御！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}横在侧门口把通道封住，{heroCallsign}借着车体掩护，把第一批人一个个推上车。',
        audioCue: '发动机空转 · 人群推挤的嘈杂',
        radioVoice: '【无线电】车挡住路了，快上！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}贴着围墙慢慢往楼顶平台靠，{heroCallsign}在下面用信号灯引导它降落，旋翼把院子里的沙袋吹翻了一片。',
        audioCue: '旋翼下洗 · 沙袋被吹翻的连续闷响',
        radioVoice: '【无线电】直升机进场，楼顶的人准备登机！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}最后清点人数时少了一个。{heroCallsign}翻着名单：「名单上写了四十七个，院子里只有四十六个——有一个人没进来。」',
      audioCue: '纸张被风掀起 · 音乐骤然停住',
      radioVoice: '【无线电】……少一个。名单上有四十七个。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}车队再等十分钟就会被合围，回去找那个人也一样。{heroCallsign}把头盔扣上，往门外走。',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】车队先走。我去找人。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}他刚跨出门，大门就被从外面顶住了。对方的人已经堵在门口，{heroCallsign}被挤回院内，大门在他身后合上。',
      audioCue: '铁门被撞击的巨响 · 人群的喊声骤然放大',
      radioVoice: '【无线电】大门被堵了！出不去了！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}带着剩下的人在围墙一线与{enemyCallsign}近距离交战，把冲上墙头的人一次次压回去，沙袋被打得不停往下漏沙。',
      audioCue: '近距离对射 · 沙袋漏沙的细响',
      radioVoice: '【无线电】守住墙！再守十分钟！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}{supportCallsign}在楼顶把最后一批人送上直升机，自己没上。{heroCallsign}在无线电里喊他，只听见旋翼声越来越远。',
      audioCue: '旋翼渐远 · 无线电只剩电流',
      radioVoice: '【无线电】……人走了。门关上了。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}天亮了，围墙上安静下来。{heroCallsign}靠在沙袋上，看着最后一架直升机变成一个点。',
      audioCue: '晨风 · 远处零星人声',
      radioVoice: '【无线电】最后一批已离开使馆区，任务完成。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}院子里散落着被踩烂的行李。{heroCallsign}蹲下去，把一只小箱子扶正，摆回墙边，然后站起来。',
      audioCue: '风声 · 配乐极轻',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}{heroCallsign}走到大门口，把门闩拉开，一个人走了出去。',
      audioCue: '铁门开合的吱呀声 · 低频配乐收束',
      radioVoice: '【无线电】收队。使馆已封闭。' }]
  },

  /* ---------------------------------------------------------------- 潜艇猎杀 */
  'submarine-hunt': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '指挥舱里只有声呐的滴答声。{heroCallsign}指着海图上一片空白：「{deadline}之内找到{target}，否则{stake}。」',
      audioCue: '声呐滴答 · 通风机低频 · 无人说话',
      radioVoice: '【无线电】全艇静默，只听声呐。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「关掉主动声呐，贴着跃变层走。」{heroCallsign}把航速降到最低，「谁先出声，谁先死。」',
      audioCue: '艇体受压的吱呀声 · 阀门轻响',
      radioVoice: '【无线电】航向已定，保持静默。' }],
    // 「声呐兵的手停住了」是硬编码兵种泛称：这一镜里操作声呐的其实是**有代号的配角**，
    // 写成泛称会让观众看到一个无名角色，而定妆表上明明有他。凡有专属角色承担的动作
    // 一律用 {supportCallsign}，泛称只留给真的没有对应资产的群体。
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}声呐屏上那根线忽然平了——接触。对方的螺旋桨音从{place}另一侧压过来，距离比推算的近得多，{heroCallsign}立刻下令转入交战航向。',
      audioCue: '螺旋桨音由远及近 · 心跳被放大',
      radioVoice: '【无线电】接触！方位零九零，距离三千！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}贴着跃变层缓慢机动，艇壳被水压压得呻吟，{heroCallsign}下令关掉最后一台非必要设备。',
        audioCue: '金属受压呻吟 · 设备逐台断电',
        radioVoice: '【无线电】深度两百，继续下潜，别出声。' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}全速切入对方的盲区，{heroCallsign}把鱼雷管注水，手指按在发射钮上等一个角度。',
        audioCue: '鱼雷管注水 · 深度计滴答',
        radioVoice: '【无线电】一号管准备好，等我的口令。' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}接触不是一个，是两个。{heroCallsign}盯着瀑布屏：「它们已经知道我们在这里了——这是猎杀阵型。」',
      audioCue: '声呐屏电子音 · 音乐骤然停住',
      radioVoice: '【无线电】……两个接触。我们才是被猎的那一方。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}上浮发报呼叫水面舰艇，还是继续静默单独咬住。{heroCallsign}选了静默：「发报就等于告诉它我在哪。」',
      audioCue: '呼吸声 · 低频压迫音铺满',
      radioVoice: '【无线电】不发报。继续咬住。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}鱼雷管注水的声音从船壳另一边传来——对方先动手了。{heroCallsign}愣了一瞬，立刻喊出规避口令。',
      audioCue: '金属撞击 · 尖锐的主动声呐脉冲',
      radioVoice: '【无线电】鱼雷来袭！右满舵！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}的艇体急转规避，与{enemyCallsign}在{place}深处近距离交战，声呐里全是泡沫噪声与金属呻吟。',
      audioCue: '泡沫噪声 · 艇体呻吟 · 爆炸闷响',
      radioVoice: '【无线电】它在转向！跟着它！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}一枚鱼雷擦过艇尾，{supportCallsign}所在的舱室开始进水。{heroCallsign}喊了三遍关闭水密门，回话的是水声。',
      audioCue: '进水声 · 无线电只剩电流',
      radioVoice: '【无线电】关闭水密门！快！' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}海面恢复了平静。{heroCallsign}看着声呐屏上消失的接触点，下令上浮。',
      audioCue: '压载水舱排气 · 风声渐起',
      radioVoice: '【无线电】接触消失，任务完成。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}舱内灯一盏盏亮起来。{heroCallsign}靠着舱壁坐下，手还在抖，他把它按在膝盖上压住，然后抬头看了一圈活着的人。',
      audioCue: '设备重启的电流声 · 有人长长地吐出一口气',
      radioVoice: '【无线电】（全艇静默）' }],
    // 这一镜的物理动作（指挥塔破水、艇长探头）**只属于潜艇**，而 {vehicle} 是本片主载具
    // 轮转的结果，可能是反潜护卫舰 —— 实测写出过「反潜护卫舰冲破海面，指挥塔舱盖打开」。
    // 收尾因此改成人物焦点：动作落在人身上，平台由画面暗示，不再依赖载具型号。
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}海面破开一道白痕，指挥塔舱盖掀开，{heroCallsign}探出头，第一次呼吸到海风。',
      audioCue: '海浪拍击艇体 · 低频配乐升华',
      radioVoice: '【无线电】已上浮，收队。' }]
  },

  /* ---------------------------------------------------------------- 舰队作战 */
  'fleet-ops': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '舰桥的战术屏亮起，{heroCallsign}指着编队外围的一串光点：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '战术屏电子音 · 舰体低频震动',
      radioVoice: '【无线电】全编队注意，进入一级战备。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「把{vocab.sensor}顶到最前面，驱逐舰拉到左翼。」{heroCallsign}在航图上划出拦截线，「母舰不进对方的包线。」',
      audioCue: '航图翻动 · 战术口令',
      radioVoice: '【无线电】编队变阵，左翼前出。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}{vocab.warning}突然嘶叫，{enemyCallsign}的{vocab.antiship}从海天线以下跃出，{place}的{vocab.interceptor}同时点火，海面炸开一排白色水柱，编队被迫正面交战。',
      audioCue: '告警嘶叫 · 防空火力点火 · 水柱爆开',
      radioVoice: '【无线电】来袭！全编队防空机动！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}拉满舵位在编队外侧打出{vocab.shield}，把掠海目标引向空处，{heroCallsign}盯着航迹把编队压成一个更紧的环形。',
        audioCue: '舵机满转 · 干扰弹连续爆开',
        radioVoice: '【无线电】干扰已投放，各舰靠拢！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}顶着烟幕冲到编队最外侧，{heroCallsign}用数据链把目标逐个分给各舰，整片{place}全是交织的航迹。',
        audioCue: '数据链电子音 · 连续发射的闷响',
        radioVoice: '【无线电】目标分配完成，各自开火！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}战损屏跳出第二波次。{heroCallsign}盯着数量，声音低下去：「这不是袭扰，是饱和攻击——他们在逼我们转身。」',
      audioCue: '战损屏告警 · 舰桥突然安静',
      radioVoice: '【无线电】第二波次，数量翻倍。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}掉头保母舰，还是迎着火力把舰载机放出去。{heroCallsign}把手按在放飞铃上：「放飞。」',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】甲板准备，放飞。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}第一架舰载机刚离舰，甲板就中了弹。倾斜的甲板上有人开始打滑，{heroCallsign}死死抓住扶手。',
      audioCue: '命中爆炸 · 金属滑移的刺耳声',
      radioVoice: '【无线电】甲板中弹！消防班上去！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}指挥编队收拢成环形防御，与{enemyCallsign}的突入编队在{place}正面交战，近防火力在几公里内织出一堵墙。',
      audioCue: '近防炮连射 · 海面被弹幕打白',
      radioVoice: '【无线电】环形防御建立，集中火力！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}左翼的{supportCallsign}号舰失去动力，正在进水。{heroCallsign}没有下令救援——环形防御不能散。',
      audioCue: '损管警报 · 无线电里的呼救被掐断',
      radioVoice: '【无线电】……保持队形。不许过去。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}海面安静下来，只剩下浮油和救生筏。{heroCallsign}看着战术屏上归零的接触点。',
      audioCue: '海浪 · 远处零星燃烧声',
      radioVoice: '【无线电】接触全部消失，海域已控制。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}舰桥的玻璃上还留着冲击的白痕。{heroCallsign}把望远镜放回架子，久久没说话——海面上一根桅杆都没有了。',
      audioCue: '海风 · 损管队远处的喊声 · 配乐压到最低',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'vehicle',
      action: '{link}受损的{vehicle}在海面上缓缓调头，重新回到编队里自己的位置，甲板上的水幕在晨光里拉出一道彩虹。',
      audioCue: '发动机低鸣 · 水幕洒落声',
      radioVoice: '【无线电】全员归位，返航。' }]
  },

  /* ---------------------------------------------------------------- 制空作战 */
  'air-superiority': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '座舱里告警灯安静地亮着。{heroCallsign}在数据链上圈出一片空域：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '座舱通风声 · 数据链提示音',
      radioVoice: '【无线电】编队进入巡逻空域，武器解除保险。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「我走高空诱敌，僚机压在云下。」{heroCallsign}推杆前说，「别跟进来，这是我的活。」',
      audioCue: '油门推杆 · 呼吸声压重',
      radioVoice: '【无线电】我上高空，你在云下待机。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}云层被撕开，{enemyCallsign}的双机编队从太阳方向俯冲下来，{place}的第一次交汇只持续了四秒，双方立刻进入交战。',
      audioCue: '气流爆响 · 雷达锁定单音',
      radioVoice: '【无线电】敌机！两点钟方向，俯冲！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}打开加力，在{place}拉出一道长长的尾迹，把两架敌机拽进己方的发射包线。',
        audioCue: '加力燃烧的低频咆哮 · 气流呼啸',
        radioVoice: '【无线电】我在把它们往里带，准备好。' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}贴着云顶急转，{heroCallsign}在高过载里咬牙把机头压向第三个目标，视野边缘开始发黑。',
        audioCue: '过载喘息 · 座舱结构轻响',
        radioVoice: '【无线电】我在咬第三个，别管我！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}雷达上又冒出四个光点。{heroCallsign}吸了口气：「情报说一个中队，实际来了两个——而且他们带着预警机。」',
      audioCue: '雷达告警连响 · 呼吸声变重',
      radioVoice: '【无线电】……四个新目标。我们被算计了。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}油量只够再打一轮。{heroCallsign}选择不脱离：「打完这一轮再说，掩护不能断。」',
      audioCue: '燃油泵提示音 · 音乐抽走',
      radioVoice: '【无线电】不脱离。再来一轮。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}导弹告警响起。{heroCallsign}才发现自己被咬住了——对面等的就是这一刻。',
      audioCue: '导弹告警尖叫 · 座舱内寂静',
      radioVoice: '【无线电】我被锁定了！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}与{enemyCallsign}在{place}缠斗交战，机炮在极近距离打出一串曳光，两机擦身而过时座舱几乎贴在一起。',
      audioCue: '机炮连射 · 气流撕扯机身',
      radioVoice: '【无线电】咬住了！开火！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}僚机{supportCallsign}的座舱盖炸开，飞机拖着黑烟向海面坠去。无线电里最后只剩一句「你继续」。',
      audioCue: '无线电杂音 · 随后彻底静默',
      radioVoice: '【无线电】……你继续。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}空域清了。{heroCallsign}在归航途中看着燃油表，一句话都没说。',
      audioCue: '发动机稳定巡航音 · 无人说话',
      radioVoice: '【无线电】空域已清空，申请返航。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}座舱里只剩下自己的呼吸。{heroCallsign}看着告警屏上重新变得干净的空域，慢慢松开操纵杆，手心里全是汗。',
      audioCue: '座舱增压底噪 · 呼吸被放大',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'vehicle',
      action: '{link}{vehicle}缓缓滑入机库，地勤围上来。{heroCallsign}打开座舱盖，先摘的是手套。',
      audioCue: '发动机停转 · 地面机械声',
      radioVoice: '【无线电】落地，关车。' }]
  },

  /* ---------------------------------------------------------------- 战略打击 */
  'strategic-strike': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '作战室里只有空调声。{heroCallsign}把目标坐标推到屏幕中央：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '空调低频 · 键盘与口令',
      radioVoice: '【无线电】任务代号已下达，准备执行。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「航线贴着{threat}的缝隙走，进场高度三百米。」{heroCallsign}在地图上画出一条几乎贴着地面的曲线。',
      audioCue: '航图翻动 · 战术口令',
      radioVoice: '【无线电】航线已定，低空进场。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}编队进入{place}，{enemyCallsign}的搜索雷达突然开机，锁定告警在座舱里连成一片尖叫，突防编队被迫与防空火力正面交战。',
      audioCue: '锁定告警尖叫 · 座舱震动',
      radioVoice: '【无线电】被照射了！机动规避！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}压到山谷高度，用山脊挡住雷达视线，{heroCallsign}的手一直放在释放按钮上。',
        audioCue: '气流呼啸 · 地形警告音',
        radioVoice: '【无线电】进入盲区，保持高度。' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}在{threat}的夹缝里爬升到投弹高度，{heroCallsign}开始最后一遍核对坐标。',
        audioCue: '高度计滴答 · 呼吸被刻意放慢',
        radioVoice: '【无线电】投弹前三十秒，最后一次核对。' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}目标区不是一座楼，是一片伪装成民居的发射阵地。{heroCallsign}盯着光电画面：「打这个，等于提前开战。」',
      audioCue: '光电画面电子音 · 作战室寂静',
      radioVoice: '【无线电】……目标性质与情报不符。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}打，还是带回情报让上面决定。{heroCallsign}沉默了六秒，然后报了「投弹」。',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】……投弹。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}投弹前一秒，目标动了——整片阵地开始转移，伪装网被一辆辆车顶开。{heroCallsign}喊出了修正口令。',
      audioCue: '无线电急促口令 · 引擎轰鸣',
      radioVoice: '【无线电】目标在转移！修正坐标！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}强行修正弹道，与{enemyCallsign}的防空火力在{place}正面交战，近炸引信在机腹外炸开一团团黑烟。',
      audioCue: '近炸爆响 · 破片打在机身上',
      radioVoice: '【无线电】保持航线！别躲！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}僚机{supportCallsign}被破片打穿了发动机。为了不暴露主目标，他没有呼叫，直接转向了无人区。',
      audioCue: '发动机失速声 · 无线电静默',
      radioVoice: '【无线电】（没有按下通话键）' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}目标区烧成一片红。{heroCallsign}在返航路上反复回放那六秒。',
      audioCue: '远处燃烧声 · 低频配乐',
      radioVoice: '【无线电】目标已摧毁，返航。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}座舱外天已经亮了。{heroCallsign}低头看了一眼相机里的胶片，没有第二次通过，他把头盔抵在舷窗上闭了会儿眼。',
      audioCue: '四台发动机的稳定轰鸣 · 无人说话',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'vehicle',
      action: '{link}{vehicle}在夜色里降落在跑道尽头，机务打开舱门时，{heroCallsign}还坐在座舱里没动。',
      audioCue: '发动机停转 · 夜风',
      radioVoice: '【无线电】落地。关车。' }]
  },

  /* ---------------------------------------------------------------- 两栖登陆 */
  'beach-landing': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '登陆艇在浪里起伏，{heroCallsign}把被海水泡软的地图按在膝盖上：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '登陆艇柴油机低频 · 浪头拍打钢板 · 舱内无人说话',
      radioVoice: '【无线电】各艇注意，{deadline}准时放跳板。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'squad',
      action: '{link}「左翼是死区，右翼有暗礁。」{heroCallsign}在颠簸中用指北针标出两个坐标，「我们走中间那道浅滩。」',
      audioCue: '指北针开合 · 压低的交谈',
      radioVoice: '【无线电】走中间，一分钟后放跳板。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}跳板砸进浅水，第一排人还没站稳，{enemyCallsign}的机枪就从{place}高处扫下来，水面瞬间被打成一片白，双方在滩头正面交战。',
      audioCue: '机枪连射 · 水花与弹壳声混成一片',
      radioVoice: '【无线电】压制点！崖顶！压制点！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}的船首撞开反登陆障碍，{heroCallsign}借着艇体掩护把爆破筒塞进铁丝网桩，炸开一个能过人的缺口。',
        audioCue: '金属撞击 · 爆破闷响',
        radioVoice: '【无线电】缺口打开了！往里冲！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}第二次抢滩，把后续梯队直接送到防波堤下，{heroCallsign}抓着艇舷在弹雨里往岸上爬。',
        audioCue: '发动机吼叫 · 子弹打在钢板上',
        radioVoice: '【无线电】第二梯队上岸！继续推！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}{heroCallsign}爬过防波堤，抬头愣住了：情报说{target}是机枪巢，实际是整片崖顶的炮兵阵地，炮口正对着滩头。',
      audioCue: '炮闩闭合 · 音乐骤然停住',
      radioVoice: '【无线电】……这不是机枪巢。是炮兵阵地。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}按原计划硬冲，全排在滩上活不过十分钟。{heroCallsign}把绳子甩上崖壁：「跟我爬，端掉炮位。」',
      audioCue: '绳索甩上岩壁 · 呼吸声',
      radioVoice: '【无线电】跟我上崖，端掉那些炮。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}爬到一半，火力突然转向了另一个滩段——敌人把预备队压了上来，崖顶的炮口开始转动，{heroCallsign}只能加快攀爬。',
      audioCue: '炮口转向的机械声 · 碎石滑落',
      radioVoice: '【无线电】他们在转炮！快爬！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}翻上崖沿，与{enemyCallsign}在战壕里近距离交战，手榴弹在几步外炸开，泥土混着塑料碎片泼了两人一身。',
      audioCue: '手榴弹爆响 · 近身搏斗的喘息',
      radioVoice: '【无线电】崖顶拿下！继续清剿！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}{supportCallsign}倒在炮位边上没再起来。{heroCallsign}只来得及把他拖进弹坑，就抓起炸药包继续往前。',
      audioCue: '无线电只剩电流 · 心跳被放大',
      radioVoice: '【无线电】……对不起。继续走。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}炮位哑了。滩头的枪声一段段稀下来，{heroCallsign}站在崖边看着后续梯队的登陆艇靠上沙滩。',
      audioCue: '海风 · 远处零星枪声',
      radioVoice: '【无线电】滩头已控制，后续梯队可以上岸。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}浪退下去，沙上留下一排排脚印和别的东西。{heroCallsign}跪在湿沙里用手撑着地，好一会儿才站起来。',
      audioCue: '退潮声 · 远处零星枪声 · 配乐极轻',
      radioVoice: '【无线电】（静默）' }],
    // focus 必须是 squad：这一镜里除了主角，还有**倒下的那个人**在画面里。
    // 写成 hero 时 subjects 只有主角，{supportCallsign} 会塌回主角自己，
    // 渲染成「佩德罗蹲下把佩德罗的铭牌收进口袋」。
    close: [{ fn: 'close', phase: 'resolve', focus: 'squad',
      action: '{link}{heroCallsign}蹲下把{supportCallsign}的铭牌收进口袋，然后站起来，向下一个滩段走去。',
      audioCue: '铭牌相碰 · 低频配乐升华',
      radioVoice: '【无线电】收队。还有下一个滩头。' }]
  },

  /* ---------------------------------------------------------------- 装甲对决 */
  'armor-clash': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '{heroCallsign}在炮塔上摊开地图：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '地图压过装甲板 · 引擎怠速',
      radioVoice: '【无线电】全车注意，任务已下达。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'squad',
      action: '{link}「把坦克藏在村子的矮墙后面，等他们进开阔地再打。」{heroCallsign}敲了敲地图上的{place}。',
      audioCue: '铅笔划图 · 装填手检查弹药',
      radioVoice: '【无线电】进入伏击位，发动机熄火待机。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}第一发{vocab.armorRound}从侧翼打来，在{heroCallsign}的炮塔边上炸开——{enemyCallsign}的伏击比预想的早了一步，两车在{place}正面交战。',
      audioCue: '穿甲弹命中 · 车内金属回响',
      radioVoice: '【无线电】中弹！右侧！倒车！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}推倒半堵矮墙冲进开阔地，{heroCallsign}在颠簸中完成装填，炮口转向对面的第一辆。',
        audioCue: '发动机高转 · 装填机械咔嚓声',
        radioVoice: '【无线电】装填完毕，目标坦克！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}一边倒车一边开火，{heroCallsign}把车体摆成正面迎弹的角度，硬扛着对面的火力往里挤。',
        audioCue: '连续开火 · 装甲被击中的闷响',
        radioVoice: '【无线电】正面顶住！别让他们过去！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}烟尘散开，{heroCallsign}看清了：不是几辆，是整条公路上的纵队，一直排到地平线。',
      audioCue: '引擎轰鸣由远及近 · 车内寂静',
      radioVoice: '【无线电】……这是一个集群。我们挡不住。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}退回村子能活，但桥会被他们拿走。{heroCallsign}选择留在原地：「守住这个路口，谁来都一样。」',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】不退。守路口。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}弹药架快空了，而对面还在往里填。{heroCallsign}看见对方的指挥车开始绕向侧后。',
      audioCue: '弹药架清空提示 · 无线电杂音',
      radioVoice: '【无线电】弹药告急！他们在包抄！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}两车在不到两百米处互相开火交战，{heroCallsign}的车体被打出几个洞，他借着烟幕绕到{enemyCallsign}的侧后。',
      audioCue: '炮声与金属撕裂 · 烟幕弹爆开',
      radioVoice: '【无线电】侧后！就是现在！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}僚车{supportCallsign}起火，车组没人出来。{heroCallsign}用无线电喊了三遍，然后下令继续装填。',
      audioCue: '燃烧声 · 无线电里的电流',
      radioVoice: '【无线电】……装填。继续。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}公路安静了，只剩下燃烧的钢铁。{heroCallsign}从舱盖探出身，看了一遍那片焦土。',
      audioCue: '余烬噼啪 · 远处零星枪声',
      radioVoice: '【无线电】公路已封锁。敌人退了。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}炮塔里全是硝烟味。{heroCallsign}推开舱盖透气，看见旁边的车已经不动了，他盯着看了很久，才缩回去关上舱盖。',
      audioCue: '炮塔液压停转 · 车外风声',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'vehicle',
      action: '{link}{vehicle}缓缓驶过烧毁的敌车，{heroCallsign}没有看它们，只是看着前方的路口。',
      audioCue: '履带碾过碎片 · 低频配乐',
      radioVoice: '【无线电】收队。路口还在我们手里。' }]
  },

  /* ---------------------------------------------------------------- 轨道作战 */
  'orbital-ops': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '舱内一片失重的安静。{heroCallsign}抓住扶手，看着舷窗外的结构：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '通风系统低频 · 结构应力声',
      radioVoice: '【无线电】全舱注意，任务时钟已启动。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'squad',
      action: '{link}「我从外部桁架绕过去，你在气闸待命。」{heroCallsign}扣上系绳，「碎片带每四分钟过一次。」',
      audioCue: '系绳卡扣 · 气闸泄压声',
      radioVoice: '【无线电】我出舱，你守住气闸。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}系绳被一块高速碎片削断。{heroCallsign}在旋转中抓住{place}的边缘，{enemyCallsign}的信号在同一频段里插了进来，双方在轨道上正面交战。',
      audioCue: '碎片撞击 · 通讯频段被插入杂音',
      radioVoice: '【无线电】我的系绳断了！有人在我的频道里！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}喷出姿态修正气流，把{heroCallsign}推向核心舱的检修口，两人在零重力下撞成一团。',
        audioCue: '姿态喷气短促爆响 · 舱体轻震',
        radioVoice: '【无线电】推力给足了，抓住检修口！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}绕到太阳翼背面，用结构臂挡住对方的视线，{heroCallsign}趁机钻进核心舱。',
        audioCue: '结构臂液压声 · 金属摩擦',
        radioVoice: '【无线电】我在挡它，你进去！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}检修口后面不是故障，是有人手动切断了线路。{heroCallsign}看着整齐的切口：「这是故意的。」',
      audioCue: '舱内突然安静 · 只有呼吸声',
      radioVoice: '【无线电】……这不是事故。是破坏。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}恢复供电会把整段轨道暴露给对方，但不恢复就没人能活着下来。{heroCallsign}选择了合闸。',
      audioCue: '呼吸声 · 继电器预备音',
      radioVoice: '【无线电】合闸。后果我担。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}合闸的瞬间，太阳翼开始转动——不是朝向太阳，是朝向对方的接近轨道。{heroCallsign}意识到自己刚刚给他们开了路。',
      audioCue: '伺服电机转动 · 告警音连响',
      radioVoice: '【无线电】……它在对着他们转。我上当了。' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}在核心舱内与{enemyCallsign}在零重力下近身交战，两人撞在舱壁上，工具与碎片在舱内缓慢漂浮。',
      audioCue: '舱壁撞击 · 失重下的闷响',
      radioVoice: '【无线电】我在核心舱跟他们交上了！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}{supportCallsign}的航天服被击穿，他在气闸里做了最后的处置——把舱门关上，把{heroCallsign}留在内侧。',
      audioCue: '气闸闭合的闷响 · 通讯彻底中断',
      radioVoice: '【无线电】别开门。让我留在外面。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}核心舱的灯一盏盏亮起来。{heroCallsign}隔着舷窗看着轨道上安静下来的结构。',
      audioCue: '系统重启提示音 · 低频配乐',
      radioVoice: '【无线电】核心已恢复，轨道稳定。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}舱外只剩地球的弧线。{heroCallsign}把面罩贴在舷窗上，看着下面那片亮起来又暗下去的大陆，谁也没有叫他。',
      audioCue: '生命维持系统的低频嗡鸣 · 完全真空的静默',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}{heroCallsign}摘下面罩，在失重里静静漂了几秒，然后转向下一个检修口。',
      audioCue: '呼吸声 · 通风系统低频',
      radioVoice: '【无线电】还有下一个检修口。继续。' }]
  },

  /* ---------------------------------------------------------------- 营救撤离 */
  'rescue-extract': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      // 「飞行员的照片」指向的是**被营救的人**，不是名册里的任何角色 —— 用泛称反而更准，
      // 但必须写成「被击落的机组」，否则读者会以为照片上就是{heroCallsign}自己。
      action: '简报板上钉着被击落机组的照片。{heroCallsign}敲了敲：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '照片被按在板上 · 简报室安静',
      radioVoice: '【无线电】任务只有一个目标：把人带回来。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'squad',
      action: '{link}「直升机贴河谷进去，固定翼在高空压住{threat}。」{heroCallsign}在地图上点出{place}，「着陆场只有两分钟窗口。」',
      audioCue: '地图折叠 · 旋翼启动的闷响',
      radioVoice: '【无线电】进场路线已定，两分钟窗口。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}刚落地就挨了打。{enemyCallsign}的机枪从河谷两侧同时开火，{heroCallsign}扑进泥里，被迫就地交战。',
      audioCue: '机枪连射 · 泥土被掀起',
      radioVoice: '【无线电】两侧都有火力！趴下！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}贴着河谷低空掠进{place}，旋翼把水面吹成一圈一圈的白浪，{heroCallsign}抱着伤员往舱门冲。',
        audioCue: '旋翼轰鸣 · 水面被吹散',
        radioVoice: '【无线电】我到了！把人带过来！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}拉起一个大角度爬升，躲开追来的火力，{heroCallsign}在舱门口死死按住担架。',
        audioCue: '旋翼变距 · 子弹擦过机身',
        radioVoice: '【无线电】拉起来！别管后面！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}找到的不是一个人。{heroCallsign}看着弹坑里挤着的三名机组：「情报说一个，这里有三个。」',
      audioCue: '伤员喘息 · 音乐骤然停住',
      radioVoice: '【无线电】……这里有三个。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}直升机油量只够一次起飞。{heroCallsign}选择先送伤员：「我留下，你们走。」',
      audioCue: '燃油泵提示 · 呼吸声',
      radioVoice: '【无线电】先送他们。我留下。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}直升机拉起时被击中，尾桨冒着烟转向了河对岸——撤离窗口没有了。{heroCallsign}把手里的信号弹塞回口袋。',
      audioCue: '命中爆响 · 旋翼音调失稳',
      radioVoice: '【无线电】它被打下来了。窗口没了。' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}依托坠机残骸与{enemyCallsign}交战，把最后一梭子子弹打完，然后换上伤员的手枪。',
      audioCue: '点射到空仓 · 手枪上膛',
      radioVoice: '【无线电】弹尽了。谁还有弹匣？' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}{supportCallsign}留下掩护，把弹匣全部推给{heroCallsign}，然后转身迎向包围圈。',
      audioCue: '弹匣落地的轻响 · 随后是连续的枪声',
      radioVoice: '【无线电】走！我数到十！' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}第二架直升机在清晨的雾里落下来。{heroCallsign}把最后一个人推上舱门，自己才上去。',
      audioCue: '旋翼由远及近 · 晨风',
      radioVoice: '【无线电】第二架进场，人都在。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}舱门关上的那一刻，外面的风一下子就听不见了。{heroCallsign}坐在机舱地板上，把伤员的毯子往上拉了拉，手一直没有收回来。',
      audioCue: '旋翼渐远 · 舱内只剩呼吸',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'vehicle',
      action: '{link}{vehicle}拉起来，越过河谷。{heroCallsign}透过舷窗看着下面越来越小的{place}。',
      audioCue: '旋翼稳定巡航 · 低频配乐升华',
      radioVoice: '【无线电】全部登机，返航。' }]
  },

  /* ---------------------------------------------------------------- 城市突袭 */
  'urban-raid': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '{heroCallsign}蹲在装甲车后，用粉笔在地上画出楼体结构：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '粉笔划过水泥 · 远处零星枪声',
      radioVoice: '【无线电】各队注意，进去之前再对一次表。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'squad',
      action: '{link}「一队走楼梯，二队从楼顶下去。」{heroCallsign}把破门器递给{supportCallsign}，「断电之后三十秒动手。」',
      audioCue: '破门器金属碰撞 · 战术口令',
      radioVoice: '【无线电】断电三十秒后动手，收到请回答。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}门被踹开的瞬间，{enemyCallsign}的枪口已经在走廊尽头等着——他们知道我们要来，双方在{place}立刻交火。',
      audioCue: '突击步枪连射 · 弹壳落地脆响',
      radioVoice: '【无线电】接触！走廊尽头！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'squad',
        action: '{link}{heroCallsign}与{supportCallsign}一左一右交替掩护，沿{place}逐间清理，每扇门后都要先扔一颗震爆弹。',
        audioCue: '震爆弹闷响 · 房门被撞开',
        radioVoice: '【无线电】左清右进，交替掩护！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}撞开街区尽头的路障，把{heroCallsign}直接送到楼下，车体挡住街口的火力。',
        audioCue: '撞击碎裂 · 发动机高转',
        radioVoice: '【无线电】车到了，从这边上楼！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}地下室不是指挥所，是一间挂着地图的审讯室。{heroCallsign}看着墙上的照片：「我们找的人早就不在这里了。」',
      audioCue: '纸张翻动 · 音乐骤然停住',
      radioVoice: '【无线电】……目标不在这里。这是空的。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}撤退，还是继续往楼上打。{heroCallsign}选择往上：「人质可能还在楼上。」',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】继续往上。人还在楼上。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}楼梯间传来爆破声——退路被炸断了，对面把整栋楼变成了陷阱。{heroCallsign}只能往上走。',
      audioCue: '定向爆破闷响 · 结构崩裂',
      radioVoice: '【无线电】退路没了！只能往上！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}在楼梯间与{enemyCallsign}近距离交战，两人隔着半层楼对射，水泥碎块不断从头顶砸下来。',
      audioCue: '近距离对射 · 水泥碎块落地',
      radioVoice: '【无线电】楼梯间！压制他！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}{supportCallsign}为了挡住走廊口没有再退。{heroCallsign}把他拖进房间，关上门。',
      audioCue: '房门关上 · 无线电只剩电流',
      radioVoice: '【无线电】……我把他留在里面了。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}楼里安静下来。{heroCallsign}坐在楼梯上，把手套一只一只摘下来。',
      audioCue: '手套落地的轻响 · 远处警笛',
      radioVoice: '【无线电】楼已清空。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}楼道里全是灰。{heroCallsign}坐在楼梯上，把弹匣一颗一颗退出来数，数到一半停下来，抬头看着天花板。',
      audioCue: '远处零星枪声 · 灰烬落下 · 极静的配乐',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}天快亮了。{heroCallsign}带着剩下的人从后门走出去，没有回头。',
      audioCue: '脚步声 · 晨风 · 低频配乐',
      radioVoice: '【无线电】收队。回家。' }]
  },

  /* ---------------------------------------------------------------- 正面交战（兜底） */
  'general-combat': {
    goal: [{ fn: 'goal', phase: 'establish', focus: 'hero',
      action: '{heroCallsign}把地图摊在{place}的断墙上：「{deadline}之内{objective}，否则{stake}。」',
      audioCue: '纸张压过碎石 · 远处低频轰鸣',
      radioVoice: '【无线电】都听清楚了：进去，带人，出来。没有第二次机会。' }],
    plan: [{ fn: 'plan', phase: 'build', focus: 'hero',
      action: '{link}「正面压制，侧翼绕过去。」{heroCallsign}在图上画出两条箭头，「三分钟后同时动。」',
      audioCue: '地图折叠 · 战术口令',
      radioVoice: '【无线电】改走二号路线，三分钟。' }],
    contact: [{ fn: 'contact', phase: 'build', focus: 'clash',
      action: '{link}刚越过出发线，{enemyCallsign}的火力就把{place}打成一片扬尘，{heroCallsign}被压在掩体后，双方就地交战。',
      audioCue: '机枪连射 · 弹壳与碎石声',
      radioVoice: '【无线电】接触！两点钟方向，压制他们！' }],
    escalate: [
      { fn: 'escalate', phase: 'build', focus: 'vehicle',
        action: '{link}{vehicle}碾过障碍推进到侧翼，{heroCallsign}借着车体掩护向前跃进，弹壳在脚边堆成一小堆。',
        audioCue: '履带碾碎障碍 · 压制射击',
        radioVoice: '【无线电】车到位了，跟着它走！' },
      { fn: 'escalate', phase: 'climax', focus: 'vehicle',
        action: '{link}{vehicle}冲上斜坡抢占制高点，{heroCallsign}在车尾架起武器向{place}深处扫射压制。',
        audioCue: '发动机高转 · 大口径机枪压制',
        radioVoice: '【无线电】高地已占，视野良好！' }
    ],
    reveal: [{ fn: 'reveal', phase: 'build', focus: 'hero',
      action: '{link}{heroCallsign}摸到近处才发现，情报上的一个火力点，实际是一整条战壕。',
      audioCue: '音乐骤然停住 · 只有风声',
      radioVoice: '【无线电】……这不是火力点。是战壕。' }],
    decision: [{ fn: 'decision', phase: 'climax', focus: 'hero',
      action: '{link}退回去重新组织，还是趁现在打进去。{heroCallsign}选择了打进去。',
      audioCue: '呼吸声 · 音乐抽走只留低频',
      radioVoice: '【无线电】不等了。现在进去。' }],
    reversal: [{ fn: 'reversal', phase: 'climax', focus: 'hero',
      action: '{link}打进去之后，对方从背后的方向开了火——他们早就等着这一刻。',
      audioCue: '背后突然响起的枪声 · 耳鸣',
      radioVoice: '【无线电】后面！他们绕到后面了！' }],
    clash: [{ fn: 'clash', phase: 'climax', focus: 'clash',
      action: '{link}{heroCallsign}与{enemyCallsign}在战壕里正面交战，双方在几米内对射，泥土和碎片溅满镜头。',
      audioCue: '全自动连射 · 弹壳与碎片四溅',
      radioVoice: '【无线电】就是现在！全体开火！' }],
    cost: [{ fn: 'cost', phase: 'climax', focus: 'squad',
      action: '{link}{supportCallsign}倒在{heroCallsign}身边。{heroCallsign}没有停下。',
      audioCue: '脚步声少了一半 · 音乐断裂',
      radioVoice: '【无线电】继续走。别回头。' }],
    aftermath: [{ fn: 'aftermath', phase: 'resolve', focus: 'hero',
      action: '{link}枪声停了。{heroCallsign}站在打空的阵地上，慢慢把枪放下。',
      audioCue: '风声渐起 · 低沉克制的配乐',
      radioVoice: '【无线电】阵地已肃清，任务完成。' }],
    reaction: [{ fn: 'reaction', phase: 'resolve', focus: 'hero',
      action: '{link}风把硝烟吹散了一角。{heroCallsign}站在{place}中间，把手里的枪垂到身侧，很久没有动。',
      audioCue: '风穿过废墟 · 耳鸣声 · 配乐收束',
      radioVoice: '【无线电】（静默）' }],
    close: [{ fn: 'close', phase: 'resolve', focus: 'hero',
      action: '{link}{heroCallsign}转身离开{place}，没有再看身后。',
      audioCue: '脚步渐远 · 配乐收束',
      radioVoice: '【无线电】收队，回家。' }]
  }
};

/* ================================================================== *
 * 5b. 景别
 *
 * 骨架步骤若沿用结构节拍的 shotType，会出现「正文写跳板砸进浅水、景别写拐角遭遇」
 * 这种自相矛盾。景别由戏剧功能决定，载具镜再加一个前缀。
 * ================================================================== */

const SHOT_TYPE_BY_FN = {
  goal: '任务简报中景 (Mission Briefing Medium)',
  world: '环境铺陈大远景 (Establishing Extreme Wide)',
  character: '人物时刻特写 (Character Beat Close-Up)',
  approach: '低姿渗透跟拍 (Low Crawl Tracking)',
  observe: '隐蔽观察远摄 (Concealed Observation Telephoto)',
  plan: '临场计划中景 (Plan B Medium)',
  contact: '首次接触手持近景 (Contact Handheld)',
  escalate: '压力升级跟拍 (Escalation Tracking)',
  reveal: '揭示推轨镜头 (Reveal Dolly)',
  decision: '抉择面部特写 (The Choice Close-Up)',
  reversal: '反转静场中景 (Reversal Still)',
  clash: '正面对轰主视角 (Point-Blank Duel)',
  cost: '代价特写硬切 (Cost Hard Cut)',
  quiet: '开火前静默长镜 (The Silence Before)',
  aftermath: '残局静默收尾 (Silent Aftermath)',
  reaction: '反应镜头面部特写 (Reaction Close-Up)',
  close: '收束特写 (Closing Close-Up)'
};

/** 由戏剧功能 + focus 推出景别，保证与正文一致 */
export function shotTypeFor(step) {
  const base = SHOT_TYPE_BY_FN[step?.fn] || '常规中景 (Standard Medium)';
  if (step?.focus === 'vehicle') return `载具主导 · ${base}`;
  if (step?.focus === 'clash') return `双人对轰 · ${base}`;
  if (step?.focus === 'enemy') return `敌方视角 · ${base}`;
  if (step?.focus === 'squad') return `双人调度 · ${base}`;
  return base;
}

/* ================================================================== *
 * 6. 装配
 * ================================================================== */

/** 把 {vocab.xxx} 展开为时代词汇；未知键原样保留以便排查 */
function expandVocab(text, vocab) {
  return String(text ?? '').replace(/\{vocab\.(\w+)\}/g, (m, key) => (
    vocab[key] !== undefined ? String(vocab[key]) : m
  ));
}

/**
 * 取某个原型 + 某个戏剧功能的候选骨架步骤（已做门控过滤）。
 *
 * 门控的必要性：focus='vehicle' 的步骤需要片子里真的有载具，
 * focus='clash'/'enemy' 需要真的有敌军，focus='squad' 需要第二名友军。
 * 不可用的步骤直接剔除，由调用方回退到通用节拍模板（那条路径自带门控）。
 *
 * @param {string} arcId 原型 id
 * @param {string} fn 戏剧功能
 * @param {{hasEnemy:boolean, hasSupport:boolean, hasVehicle:boolean}} gates
 * @returns {Array<object>} 可用步骤（已展开时代词汇）
 */
export function storySteps(arcId, fn, gates = {}) {
  const { hasEnemy = false, hasSupport = false, hasVehicle = false, domain = null } = gates;
  const own = (SLOTS[arcId] || {})[fn] || [];
  const shared = (TEXTURE[fn] || []);
  const vocab = gates.vocab || DEFAULT_VOCAB;

  // 共享「质感节拍」按战场域排序：命中本域的排前面，无 domains 标记的通用条垫底。
  // 没有这一层，潜艇片与制空片会共用同一句「镜头缓缓升起，…铺开成一片灰色」——
  // 这正是用户说的「简单的拼凑」：换了个题材，句子一模一样。
  const matched = domain
    ? shared.filter(s => Array.isArray(s.domains) && s.domains.includes(domain))
    : [];
  const generic = shared.filter(s => !Array.isArray(s.domains));

  // 组内按题材哈希做**确定性轮转**：同一战场域的两部片子（中途岛 vs 太平洋岛屿抢滩）
  // 不该连收尾特写都用同一句。轮转只发生在组内，因此不会把 naval 条挤到 generic 后面。
  const rotate = (arr) => {
    if (arr.length < 2 || !Number.isInteger(gates.seed)) return arr;
    const k = ((gates.seed % arr.length) + arr.length) % arr.length;
    return k === 0 ? arr : [...arr.slice(k), ...arr.slice(0, k)];
  };
  const sharedOrdered = [...rotate(matched), ...rotate(generic)];

  const usable = (s) => {
    if ((s.focus === 'clash' || s.focus === 'enemy') && !hasEnemy) return false;
    if (s.focus === 'squad' && !hasSupport) return false;
    if (s.focus === 'vehicle' && !hasVehicle) return false;
    return true;
  };

  // 先本原型专属，再共享质感节拍（同样按 focus 门控）
  return [...own, ...sharedOrdered].filter(usable).map(s => ({
    ...s,
    action: expandVocab(s.action, vocab),
    audioCue: expandVocab(s.audioCue, vocab),
    radioVoice: expandVocab(s.radioVoice, vocab)
  }));
}

/** 该原型是否为本题材识别出的（供测试与 UI 展示） */
export function arcLabel(arcId) {
  return (ARCS.find(a => a.id === arcId) || {}).label || '正面交战';
}

/**
 * 组装一份剧本内核。
 *
 * 返回的 slots 是 `{ [fn]: 步骤数组 }`，由 planner 逐镜按戏剧功能取用；
 * 数组内顺序固定，取尽后由调用方回退通用节拍，保证「同一部片子里不出现重复文本」。
 */
export function buildStory({ theme = '', intent = {}, cast = {}, env = null, registry = null, gates = {} } = {}) {
  const arc = detectArc(theme, intent);
  const vocab = vocabFor(intent.era);
  const nouns = resolveNouns({ arc, theme, cast, env });
  // 战场域：与 roster.selectCast 用同一套判定，保证「挑出来的演员」与「写出来的镜头」
  // 描述的是同一个战场（潜艇片不会拿到「镜头从云层上方拉开」）。
  const domain = domainOfText(`${theme} ${intent.setting || ''}`)?.key || null;

  // 轮转键同时取题材与原型：只取题材时，「中途岛航母对决」与「太平洋岛屿抢滩」这类
  // 同域不同原型的片子有 1/2 概率抽到同一条收尾特写；混入原型哈希后两边一起变。
  const withGates = { ...gates, vocab, domain, seed: (fnv1a(String(theme || '')) ^ fnv1a(arc.id)) >>> 0 };
  const fns = new Set(Object.keys(SLOTS[arc.id] || {}).concat(Object.keys(TEXTURE)));
  const slots = {};
  for (const fn of fns) {
    const steps = storySteps(arc.id, fn, withGates);
    if (steps.length) slots[fn] = steps;
  }

  const eraLabel = {
    WWII: '二战', Pacific: '太平洋战场', 'Cold War': '冷战', 'Gulf War': '海湾战争',
    'Iraq War': '伊拉克战争', Modern: '现代', 'Modern High-Tech': '现代高科技战场', Orbital: '近地轨道'
  }[intent.era] || '现代';

  return {
    arc: arc.id,
    arcLabel: arc.label,
    eraLabel,
    vocab,
    nouns,
    domain,
    locations: arc.locations,
    vehicleHint: arc.vehicleHint || null,
    slots,
    // 一句话故事：主角 + 目标 + 时限 + 赌注。由 planner 在选角后补上主角姓名。
    // 环境名与时代名互相包含时（「太平洋战场，太平洋」）不再重复念一遍。
    premise: `${eraLabel}${eraLabel.includes(nouns.place) || nouns.place.includes(eraLabel) ? '' : `，${nouns.place}`}。`
      + `必须在${nouns.deadline}之内${nouns.objective}——否则${nouns.stake}。`
  };
}
