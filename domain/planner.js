import { parseIntent } from './intent.js';
import { enforceContinuityChain } from './continuity.js';

/**
 * 依据时代、意图与关键词从注册表中筛选最适资产
 */
const pick = (r, kind, intent, term = '', excludeTerm = '') => {
  const all = r.byKind.get(kind) || [];
  const eraMatches = all.filter(a => a.series === intent.era);
  const pool = eraMatches.length > 0 ? eraMatches : all;

  if (term) {
    const termRegex = new RegExp(term, 'i');
    const matched = pool.find(a => {
      const full = `${a.name} ${a.nameZh || ''} ${a.kw || ''}`;
      if (excludeTerm && new RegExp(excludeTerm, 'i').test(full)) return false;
      return termRegex.test(full);
    });
    if (matched) return matched;
  }

  if (excludeTerm) {
    const exRegex = new RegExp(excludeTerm, 'i');
    const filtered = pool.filter(a => !exRegex.test(`${a.name} ${a.nameZh || ''}`));
    if (filtered.length > 0) return filtered[0];
  }

  return pool[0] || all[0];
};

/**
 * 确定性影片分镜规划器
 * @param {object} params
 * @param {string} params.theme 影片主题
 * @param {number} params.requestedShots 镜头数量
 * @param {string} params.profileId 模型配置文件 ID
 * @param {object} r 资产注册表
 * @returns {{ intent: object, plan: object, warnings: string[], governance: object }}
 */
export function planFilm({ theme, requestedShots = 4, profileId }, r) {
  const intent = parseIntent(theme);
  const n = Math.max(1, Math.min(150, Number(requestedShots) || 4));
  const profile = r.profileById.get(profileId);
  if (!profile) throw new Error('Unknown profile');

  const warnings = [];
  if (intent.needsConfirmation) {
    warnings.push('Era needs confirmation');
  }
  if (intent.needsReview) {
    warnings.push('Content flagged for human review: ' + intent.governance.reasons.join('; '));
  }
  if (intent.isBlocked) {
    warnings.push('Content blocked by safety policy: ' + intent.governance.reasons.join('; '));
  }

  // 1. 资产自适应挑选（考虑环境与气象物理兼容）
  let envTerm = '';
  let envExclude = '';
  if (intent.setting === 'naval') {
    envTerm = 'sea|carrier|ocean|远海|航母';
  } else if (intent.weather === 'snow') {
    envTerm = 'snow|arctic|winter|雪原|雪山';
    envExclude = 'desert|沙丘|沙漠';
  } else if (intent.setting === 'urban') {
    envTerm = 'urban|city|street|城市|巷战';
  }

  const env = pick(r, 'environment', intent, envTerm, envExclude) || pick(r, 'environment', intent);

  // 主体挑选：根据任务是搜救还是空海战挑选角色与载具
  let subjectTerm = '';
  if (intent.task === 'rescue') {
    subjectTerm = 'rescue|medic|pilot|csar|飞行员|救援|医护';
  } else if (intent.setting === 'naval') {
    subjectTerm = 'carrier|aircraft|pilot|f-15|f-16|deck|航母|舰载';
  }

  const subject = pick(r, intent.setting === 'naval' ? 'vehicle' : 'character', intent, subjectTerm) ||
                  pick(r, 'vehicle', intent) ||
                  pick(r, 'character', intent);

  const camera = pick(r, 'camera', intent);
  const lighting = pick(r, 'lighting', intent, intent.lightingCondition === 'night' ? 'night|dusk|暗光' : '');
  const color = pick(r, 'colorGrade', intent);

  // 2. 生成多阶段叙事镜头
  const phases = ['establish', 'build', 'climax', 'resolve'];
  const rawShots = Array.from({ length: n }, (_, i) => {
    const phaseIndex = Math.min(3, Math.floor((i * 4) / n));
    const phase = phases[phaseIndex];

    let action = '';
    if (phase === 'establish') {
      action = `${subject.name} deploys into position across the environment, assessing the operational perimeter.`;
    } else if (phase === 'build') {
      action = `${subject.name} advances through tactical terrain with controlled precision, maintaining scanning discipline.`;
    } else if (phase === 'climax') {
      action = `${subject.name} engages actively in tactical combat operation, navigating high-intensity engagement with smoke.`;
    } else {
      action = `${subject.name} establishes defensive perimeter and signals operational mission accomplishment.`;
    }

    return {
      phase,
      subjects: [subject.id],
      environment: env.id,
      camera: camera.id,
      lighting: lighting.id,
      colorGrade: color.id,
      fx: phase === 'climax' ? (r.byKind.get('fx')?.[0] ? [r.byKind.get('fx')[0].id] : []) : [],
      audio: [],
      action
    };
  });

  // 3. 注入强制连续性链条（角色外观、损伤累积、180度轴线、参考帧）
  const continuousShots = enforceContinuityChain(rawShots);

  const plan = {
    intent,
    profileId,
    shots: continuousShots
  };

  return {
    intent,
    plan,
    warnings,
    governance: intent.governance
  };
}
