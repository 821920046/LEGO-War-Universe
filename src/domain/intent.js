import { checkContentGovernance } from './governance.js';

const INTENT_RULES = [
  ['Modern', /现代|特战|无人机|夜战|cqb|night vision|modern|recon|csar/i, 'era'],
  ['Gulf War', /海湾战争|沙漠风暴|gulf war|desert storm/i, 'era'],
  ['Iraq War', /伊拉克战争|iraq war/i, 'era'],
  ['Cold War', /冷战|cold war|fulda|富尔达/i, 'era'],
  ['WWII', /二战|诺曼底|盟军|德军|sherman|wwii|world war 2/i, 'era'],
  ['Pacific', /太平洋|中途岛|瓜岛|pacific/i, 'era'],
  ['rescue', /营救|搜救|撤离|撤侨|疏散|rescue|evacuation|csar/i, 'task'],
  ['combat', /交战|进攻|突击|伏击|防守|combat|assault|ambush/i, 'task'],
  ['patrol', /巡逻|侦察|警戒|patrol|reconnaissance/i, 'task'],
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
