/**
 * LEGO War Universe - 内容治理与安全拦截引擎
 * 遵循 CONTENT_POLICY.md 与合规安全基线：
 * 1. BLOCKED (直接拦截)：真实政治敏感人物、极端主义恐怖组织、真实暴行血腥、现实危害制造指南。
 * 2. REVIEW_REQUIRED (转人工审核)：现实敏感热点冲突、涉及平民战区撤离、高强度战损交战。
 * 3. PASSED (合规放行)：常规虚拟/经典历史乐高微缩军事题材。
 */

// 阻断级关键词规则库（真实政治人物、恐怖主义宣扬、极端暴行、危害制造）
const BLOCKED_RULES = [
  {
    category: 'REAL_POLITICAL_FIGURE',
    regex: /(?:普京|拜登|特朗普|泽连斯基|习近平|奥巴马|金正恩|putin|biden|trump|zelensky|xi jinping)/i,
    reason: '严禁生成或模拟真实在世国家领导人与政治公众人物。'
  },
  {
    category: 'EXTREMISM_AND_TERROR',
    regex: /(?:isis|isil|al-qaeda|基地组织|伊斯兰国|纳粹大屠杀|genocide|holocaust|suicide vest|自杀式炸弹背心)/i,
    reason: '严禁宣扬极端主义、受制裁恐怖组织及反人类暴行。'
  },
  {
    category: 'GRAPHIC_VIOLENCE_AND_HARM',
    regex: /(?:decapitation|斩首|肢解|虐杀|血肉横飞|disembowel|torture|酷刑|制造爆炸物指南|ied blueprint)/i,
    reason: '严禁呈现真实血腥残害及现实破坏行动指南。'
  }
];

// 人工审核级关键词规则库（敏感热点、平民与人道主义撤离、严重战损）
const REVIEW_RULES = [
  {
    category: 'SENSITIVE_MODERN_CONFLICT',
    regex: /(?:俄乌|俄乌冲突|巴以|加沙|gaza|ukraine war|russia-ukraine|taiwan strait|台海)/i,
    reason: '涉及当代现实敏感热点冲突，需转交人工编辑合规评估。'
  },
  {
    category: 'CIVILIAN_CASUALTY_RISK',
    regex: /(?:平民伤亡|难民营受袭|使馆被围困|民用设施轰炸|hospital strike|civilian casualties)/i,
    reason: '涉及平民伤亡或高风险人道主义场景，需人工审核确认非血腥微缩表现。'
  },
  {
    category: 'EXTREME_HOSTILITY',
    regex: /(?:全面毁灭|同归于尽|饱和核打击|nuclear launch|dirty bomb|脏弹)/i,
    reason: '涉及大规模毁灭性武器设定，需人工核对剧作尺度。'
  }
];

/**
 * 内容治理评估
 * @param {string} text 输入的主题或动作描述
 * @returns {{
 *   status: 'passed' | 'review_required' | 'blocked',
 *   flags: string[],
 *   reasons: string[],
 *   matchedRules: Array<{ category: string, reason: string }>
 * }}
 */
export function checkContentGovernance(text) {
  const input = String(text || '').trim();
  if (!input) {
    return {
      status: 'passed',
      flags: [],
      reasons: [],
      matchedRules: []
    };
  }

  const blockedMatches = [];
  for (const rule of BLOCKED_RULES) {
    if (rule.regex.test(input)) {
      blockedMatches.push({ category: rule.category, reason: rule.reason });
    }
  }

  if (blockedMatches.length > 0) {
    return {
      status: 'blocked',
      flags: blockedMatches.map(m => m.category),
      reasons: blockedMatches.map(m => m.reason),
      matchedRules: blockedMatches
    };
  }

  const reviewMatches = [];
  for (const rule of REVIEW_RULES) {
    if (rule.regex.test(input)) {
      reviewMatches.push({ category: rule.category, reason: rule.reason });
    }
  }

  if (reviewMatches.length > 0) {
    return {
      status: 'review_required',
      flags: reviewMatches.map(m => m.category),
      reasons: reviewMatches.map(m => m.reason),
      matchedRules: reviewMatches
    };
  }

  return {
    status: 'passed',
    flags: [],
    reasons: [],
    matchedRules: []
  };
}
