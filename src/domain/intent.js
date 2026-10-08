import { checkContentGovernance } from './governance.js';

/**
 * 时代 / 任务 / 战场 识别规则。
 *
 * 顺序即优先级，且**必须「具体优先、泛化兜底」**。
 *
 * 两条被实测打出来的排序约束，改动本表前务必先读：
 *
 *   1. `Modern` 的关键词（夜战 / 现代 / 无人机）太泛，若排在 Gulf War / WWII / Pacific
 *      之前会把它们全部锁死 —— 实测「海湾战争夜战防空导弹阵地伏击」因为命中「夜战」
 *      被判成 Modern，整个海湾战争资产池（以及二战 / 太平洋）永远进不了片。
 *
 *   2. `WWII` 与 `Pacific` 同属二战，但**中途岛 / 硫磺岛 / 冲绳必须落在 Pacific**，
 *      否则太平洋题材会拿到德军装备（战区互斥也拦不住 —— 它们都是 WWII 系列）。
 *      因此 Pacific 排在 WWII 之前。
 *
 *   3. 6.7.2 新增的历史战役名（库尔斯克 / 阿登 / 斯大林格勒 …）必须进 `era` 组：
 *      此前它们一个都没写进去，于是 8/20 个历史题材 `era = null`，静默回落到 Modern，
 *      成片直接变成「现代，中东沙漠」+ M1A2 + 无人战车 —— 而库里明明有 WWII 池。
 */
const INTENT_RULES = [
  // ── 未来 / 高科技时代（必须在 Modern 之前）─────────────────────────────
  ['Orbital', /太空|空间站|轨道|星际|近地轨道|零重力|外太空|宇航员|月面|气闸|舱外|space|orbital|satellite|zero-g|astronaut/i, 'era'],
  ['Modern High-Tech', /隐形战机|五代机|蜂群|无人机蜂群|忠诚僚机|巡飞弹|无人战车|机器人部队|激光防空|定向能|电磁炮|电磁脉冲|外骨骼|高超音速|网络战|电子战|反无人机|hypersonic|stealth|swarm|exoskeleton|railgun|directed energy|counter-uas|loitering|cyber|jamming|electronic warfare/i, 'era'],
  // ── 历史时代（具体战役名优先于泛化关键词）─────────────────────────────
  ['Gulf War', /海湾战争|沙漠风暴|沙漠军刀|沙漠盾牌|科威特|gulf war|desert storm|desert sabre|desert shield|kuwait/i, 'era'],
  ['Iraq War', /伊拉克战争|费卢杰|巴格达|摩苏尔|拉马迪|伊拉克自由|iraq war|fallujah|baghdad|mosul|ramadi/i, 'era'],
  // 冷战排在 WWII 之前：`柏林墙` 必须归冷战，而裸的 `柏林` 仍归二战（见下一条）。
  ['Cold War', /冷战|富尔达|柏林墙|古巴导弹|布拉格之春|铁幕|cold war|fulda|berlin wall|iron curtain/i, 'era'],
  // 太平洋排在 WWII 之前：中途岛 / 硫磺岛 / 冲绳既是二战、也是太平洋，必须由太平洋接管。
  ['Pacific', /太平洋战争|太平洋战场|中途岛|瓜岛|瓜达尔卡纳尔|硫磺岛|冲绳|塞班|塔拉瓦|贝里琉|珊瑚海|莱特湾|珍珠港|pacific|midway|iwo jima|guadalcanal|okinawa|saipan|tarawa|peleliu|coral sea|leyte|pearl harbor/i, 'era'],
  ['WWII', /二战|二次大战|诺曼底|奥马哈|犹他海滩|斯大林格勒|库尔斯克|阿登|突出部|柏林|敦刻尔克|阿拉曼|市场花园|卡昂|瑟堡|齐格菲|巴斯托涅|东线|西线|北非|盟军|德军|sherman|wwii|world war 2|normandy|stalingrad|kursk|ardennes|bulge|dunkirk|el alamein|market garden|caen|bastogne|siegfried/i, 'era'],
  // 撤侨 / 使馆 / 维和 是**现代专属**的军事行动形态（二战与冷战没有这一套）。
  // 不写进来，「使馆撤侨」这类题材会一直挂在「需确认年代」上，属于误报。
  ['Modern', /现代|特战|无人机|夜战|撤侨|使馆|大使馆|领事馆|维和|非战斗人员|cqb|night vision|modern|recon|csar|embassy|noncombatant/i, 'era'],
  // ── 任务 ────────────────────────────────────────────────────────────
  ['rescue', /营救|搜救|撤离|撤侨|疏散|rescue|evacuation|csar/i, 'task'],
  ['combat', /交战|进攻|突击|伏击|防守|combat|assault|ambush/i, 'task'],
  ['patrol', /巡逻|侦察|警戒|patrol|reconnaissance/i, 'task'],
  // ── 战场设定 ────────────────────────────────────────────────────────
  ['space', /太空|空间站|轨道|失重|外太空|space|orbital|zero-g/i, 'setting'],
  ['underground', /地下|掩体|坑道|隧道|地铁|指挥所|bunker|tunnel|subway|command post/i, 'setting'],
  ['naval', /航母|舰载|远海|海洋|舰队|carrier|naval|ocean|fleet/i, 'setting'],
  ['urban', /城市|巷战|公寓|废墟|街道|urban|city|street/i, 'setting'],
  ['desert', /沙漠|荒漠|沙丘|desert|dunes/i, 'setting'],
  // ── 气象 / 光照 ─────────────────────────────────────────────────────
  // 补入 冬季 / 冬天 / 严寒：「阿登森林冬季反击战」此前既判不出年代、也判不出气象，
  // 于是拿到「中东沙漠」当环境。冬季战争片按雪处理是安全的一侧。
  ['snow', /雪山|暴风雪|暴雪|极地|雪原|严寒|冬季|冬天|snow|blizzard|arctic|winter/i, 'weather'],
  ['rain', /暴雨|大雨|雷雨|降雨|rain|storm/i, 'weather'],
  ['night', /夜间|黑夜|月光|夜视|night|midnight/i, 'lightingCondition']
];

/**
 * 平台 → 时代 的第二轮推断。
 *
 * 为什么需要：`INTENT_RULES` 只能识别**时代词与战役名**，但用户经常只写型号 ——
 * 「B-2 轰炸敌方雷达站」「F-22 制空巡逻」「核潜艇深海猎杀」里没有一个时代词，
 * 于是 era 为 null、静默回落 Modern。多数情况结果恰好对，但「B-2」会被判成
 * 泛现代而不是隐身打击体系，「核潜艇」也拿不到该有的现代海军池。
 *
 * 刻意保守：**只在第一轮完全没命中时代时才跑**，且只认真正的型号 token，
 * 不认「坦克 / 战斗机 / 潜艇」这类跨时代通用名词（那是战场域的事，不是时代的事）。
 */
const PLATFORM_ERA_HINTS = [
  ['Modern High-Tech', /\bb-?21\b|\bf-?35\b|忠诚僚机|高超音速|电磁炮|定向能|外骨骼|蜂群|无人战车|巡飞弹|hypersonic|railgun|exoskeleton|loitering/i],
  // 注意：这一档里的型号多数**本来就该是 Modern**，命中它只是把「静默兜底」升级为
  // 「有依据的判定」，顺带消掉那条「需确认年代」的误报。真正的价值在下面 WWII / Cold War 两档
  // ——T-34、零式、米格-29 若不被识别，就会被当成现代装备放进片。
  // 刻意不写「反潜 / 护航 / 坦克 / 战斗机」这类跨时代通用词：它们属于战场域，不属于时代。
  ['Modern', /\bb-?2\b|\bf-?22\b|\bf-?15\b|\bf-?16\b|\bf-?18\b|m1a2|m1a1|艾布拉姆斯|阿帕奇|黑鹰|支奴干|鱼鹰|mrap|斯特赖克|海马斯|himars|宙斯盾|阿利·伯克|尼米兹|福特级|弗吉尼亚级|俄亥俄级|海狼级|洛杉矶级|核潜艇|predator|reaper|mq-?9|apache|blackhawk|abrams|nimitz/i],
  ['Cold War', /\bmig-?2[19]\b|su-?2[27]\b|\bf-?4\b|\bf-?14\b|m60\b|t-?62\b|t-?64\b|富尔达/i],
  // T-72 / T-80 刻意**不列入**：它们既是冷战的，也是伊拉克战争与当代多国现役装备。
  // 写死成冷战会让「伊拉克 T-72 坦克战」这种题材拿不到伊拉克池；留给第一轮与默认值处理。
  ['WWII', /\bt-?34\b|\bis-?2\b|虎式|tiger\b|豹式|panther\b|谢尔曼|sherman|喷火式|spitfire|bf-?109|fw-?190|零式|zero\b|p-?51|p-?47/i]
];

/**
 * 具体战役名。仅用于把 `eraSource` 标成 `battle`（UI 上显示成
 * 「识别为库尔斯克会战 → 二战」），不参与时代判定本身 —— 时代由 INTENT_RULES 负责。
 */
const BATTLE_NAME_RE = /中途岛|瓜岛|瓜达尔卡纳尔|硫磺岛|冲绳|塞班|塔拉瓦|贝里琉|珊瑚海|莱特湾|珍珠港|诺曼底|奥马哈|犹他海滩|斯大林格勒|库尔斯克|阿登|突出部|敦刻尔克|阿拉曼|市场花园|卡昂|瑟堡|齐格菲|巴斯托涅|富尔达|柏林墙|费卢杰|巴格达|摩苏尔|拉马迪|midway|guadalcanal|iwo jima|okinawa|saipan|tarawa|peleliu|coral sea|leyte|pearl harbor|normandy|stalingrad|kursk|ardennes|bulge|dunkirk|el alamein|market garden|caen|bastogne|siegfried|fulda|berlin wall|fallujah|baghdad|mosul|ramadi/i;

/**
 * 解析用户意图并结合内容安全治理判定
 *
 * @param {string} theme 电影主题描述
 * @param {{ era?: string }} [overrides] 用户在界面上显式指定的时代（优先级最高）
 * @returns {object} 解析出的结构化意图
 */
export function parseIntentWithOverrides(theme, overrides = {}) {
  const intent = parseIntent(theme);
  const forced = String(overrides.era || '').trim();
  if (!forced || forced === 'auto') return intent;
  return {
    ...intent,
    era: forced,
    eraSource: 'override',
    // 用户已显式指定时代，就不再需要「确认年代」这一步
    needsConfirmation: false
  };
}

/**
 * 解析用户意图并结合内容安全治理判定
 * @param {string} theme 电影主题描述
 * @returns {object} 解析出的结构化意图
 */
export function parseIntent(theme) {
  const themeText = String(theme || '').trim();
  const governance = checkContentGovernance(themeText);

  const out = {
    theme: themeText,
    era: null,
    // era 的来源。UI 与测试据此区分「识别出来的」与「兜底默认的」：
    //   explicit —— 命中时代词（二战 / 海湾战争 / 近地轨道 …）
    //   battle   —— 命中具体战役名（库尔斯克 / 阿登 / 中途岛 …）
    //   platform —— 命中装备型号（B-2 / F-22 / 核潜艇 …）
    //   none     —— 没有任何时代线索，下游按 Modern 兜底
    eraSource: 'none',
    faction: null,
    task: null,
    setting: null,
    weather: null,
    lightingCondition: null,
    conflict: false,
    safetyTags: governance.flags,
    governance,
    confidence: 0,
    needsConfirmation: false,
    isBlocked: governance.status === 'blocked',
    needsReview: governance.status === 'review_required'
  };

  for (const [value, re, key] of INTENT_RULES) {
    if (re.test(out.theme)) {
      if (!out[key]) {
        out[key] = value;
        out.confidence += 0.2;
      }
    }
  }

  // 第二轮：平台型号推断时代（只在第一轮没命中时代时跑）
  if (!out.era) {
    for (const [value, re] of PLATFORM_ERA_HINTS) {
      if (re.test(out.theme)) {
        out.era = value;
        out.eraSource = 'platform';
        out.confidence += 0.1;
        break;
      }
    }
  }
  if (out.era && out.eraSource === 'none') {
    out.eraSource = BATTLE_NAME_RE.test(out.theme) ? 'battle' : 'explicit';
  }

  // task 回落默认值：若无关键词命中，则默认 combat
  if (!out.task) out.task = 'combat';

  // 二战特定题材启发式派生
  if (!out.era && /太平洋/i.test(out.theme)) {
    out.era = 'Pacific';
    out.eraSource = 'explicit';
  } else if (!out.era && /航母|舰载机/i.test(out.theme)) {
    out.era = 'Gulf War'; // 资产库中航母舰载机主力（CHR-005, AIR-001/002）属于海湾战争
    out.eraSource = 'explicit';
  }

  out.confidence = Math.min(1, Number(out.confidence.toFixed(2)));
  out.needsConfirmation = !out.era;

  return out;
}
