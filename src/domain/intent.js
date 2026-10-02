import { checkContentGovernance } from './governance.js';

const INTENT_RULES = [
  ['Orbital', /太空|空间站|轨道|星际|近地轨道|零重力|外太空|宇航员|space|orbital|satellite|zero-g|astronaut/i, 'era'],
  ['Modern High-Tech', /隐形战机|蜂群|无人机蜂群|激光防空|电子战|外骨骼|五代机|hypersonic|stealth|swarm|exoskeleton/i, 'era'],
  // 时代规则必须「具体优先、泛化兜底」：Modern 的关键词（夜战 / 现代 / 无人机）太泛，
  // 放在 Gulf War / WWII / Pacific 之前会把它们全部锁死 —— 实测「海湾战争夜战防空导弹
  // 阵地伏击」因为命中「夜战」被判成 Modern，整个海湾战争资产池（以及二战 / 太平洋）永远进不了片。
  ['Gulf War', /海湾战争|沙漠风暴|沙漠军刀|gulf war|desert storm|desert sabre/i, 'era'],
  ['Iraq War', /伊拉克战争|iraq war/i, 'era'],
  ['Cold War', /冷战|cold war|fulda|富尔达/i, 'era'],
  ['WWII', /二战|诺曼底|斯大林格勒|盟军|德军|sherman|wwii|world war 2/i, 'era'],
  ['Pacific', /太平洋|中途岛|瓜岛|硫磺岛|冲绳|塞班|pacific|midway|iwo jima/i, 'era'],
  ['Modern', /现代|特战|无人机|夜战|cqb|night vision|modern|recon|csar/i, 'era'],
  ['rescue', /营救|搜救|撤离|撤侨|疏散|rescue|evacuation|csar/i, 'task'],
  ['combat', /交战|进攻|突击|伏击|防守|combat|assault|ambush/i, 'task'],
  ['patrol', /巡逻|侦察|警戒|patrol|reconnaissance/i, 'task'],
  ['space', /太空|空间站|轨道|失重|外太空|space|orbital|zero-g/i, 'setting'],
  ['naval', /航母|舰载|远海|海洋|舰队|carrier|naval|ocean|fleet/i, 'setting'],
  ['urban', /城市|巷战|公寓|废墟|街道|urban|city|street/i, 'setting'],
  ['desert', /沙漠|荒漠|沙丘|desert|dunes/i, 'setting'],
  ['snow', /雪山|暴风雪|极地|雪原|snow|blizzard|arctic/i, 'weather'],
  ['rain', /暴雨|大雨|雷雨|降雨|rain|storm/i, 'weather'],
  ['night', /夜间|黑夜|月光|夜视|night|midnight/i, 'lightingCondition']
];

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

  // task 回落默认值：若无关键词命中，则默认 combat
  if (!out.task) out.task = 'combat';

  // 二战特定题材启发式派生
  if (!out.era && /太平洋/i.test(out.theme)) {
    out.era = 'Pacific';
  } else if (!out.era && /航母|舰载机/i.test(out.theme)) {
    out.era = 'Gulf War'; // 资产库中航母舰载机主力（CHR-005, AIR-001/002）属于海湾战争
  }

  out.confidence = Math.min(1, Number(out.confidence.toFixed(2)));
  out.needsConfirmation = !out.era;

  return out;
}
