/**
 * LEGO War Universe - ShotSpec 严格物理与叙事规则校验器
 * 涵盖：基础资产类型/配额、时代一致性、阵营冲突校验、载具与动作/环境兼容、环境与天气兼容、叙事阶段顺行。
 */
import { validateContinuityChain } from './continuity.js';

const EXPECTED_KINDS = {
  environment: 'environment',
  camera: 'camera',
  lighting: 'lighting',
  colorGrade: 'colorGrade'
};

const HOSTILE_PAIRS = [
  ['Allies', 'Axis'],
  ['NATO', 'Warsaw Pact'],
  ['Coalition', 'Opposing Force']
];

const COMBAT_ACTION_REGEX = /(?:combat|engage|fire|firing|shoot|clash|vs|ambush|intercept|capture|assault|suppress|交战|开火|对抗|拦截|伏击|对峙|突袭|压制)/i;
const COOPERATIVE_ACTION_REGEX = /(?:together|cooperate|escort|wingman|side by side|并肩|护航|编队协同|共同作战)/i;

const PHASE_ORDER = {
  opening: 0,
  establish: 0,
  build: 1,
  buildup: 1,
  climax: 2,
  resolve: 3,
  resolution: 3
};

/**
 * 校验单镜头规范 (ShotSpec)
 * @param {object} s 镜头规范对象
 * @param {object} r 资产注册表
 * @param {object} intent 规划意图
 * @returns {{ ok: boolean, value: object, violations: Array<object> }}
 */
export function validateShotSpec(s, r, intent = {}) {
  const violations = [];
  const resolvedAssets = {
    subjects: []
  };

  const checkAsset = (id, expectedKind, field) => {
    const a = r.byId.get(id);
    if (!a) {
      violations.push({ code: 'UNKNOWN_ID', field, id });
      return null;
    }
    if (expectedKind && a.kind !== expectedKind) {
      violations.push({
        code: 'INVALID_KIND',
        field,
        expected: expectedKind,
        actual: a.kind
      });
      return null;
    }
    if (intent.era && a.series !== 'shared' && a.series !== intent.era) {
      violations.push({ code: 'ERA_MISMATCH', field, id, era: a.series, targetEra: intent.era });
    }
    return a;
  };

  // 1. 基础单项类型检查
  for (const [field, kind] of Object.entries(EXPECTED_KINDS)) {
    const asset = checkAsset(s[field], kind, field);
    if (asset) resolvedAssets[field] = asset;
  }

  // 2. 主体配额与检索
  if (!Array.isArray(s.subjects) || s.subjects.length < 1 || s.subjects.length > 3) {
    violations.push({ code: 'SUBJECT_QUOTA' });
  } else {
    for (const subId of s.subjects) {
      const asset = checkAsset(subId, null, 'subjects');
      if (asset) resolvedAssets.subjects.push(asset);
    }
  }

  // 3. 特效与音频配额
  if ((s.fx || []).length > 3) violations.push({ code: 'FX_QUOTA' });
  if ((s.audio || []).length > 2) violations.push({ code: 'AUDIO_QUOTA' });

  // 4. 动作描述必填
  const actionText = String(s.action || '').trim();
  if (!actionText) {
    violations.push({ code: 'MISSING_ACTION' });
  }

  // 5. 阵营冲突校验 (Faction Conflict)
  if (resolvedAssets.subjects.length >= 2) {
    const factions = resolvedAssets.subjects.map(a => a.faction).filter(Boolean);
    let isHostile = false;
    for (const [f1, f2] of HOSTILE_PAIRS) {
      if (factions.includes(f1) && factions.includes(f2)) {
        isHostile = true;
        break;
      }
    }
    if (isHostile) {
      if (COOPERATIVE_ACTION_REGEX.test(actionText) || !COMBAT_ACTION_REGEX.test(actionText)) {
        violations.push({
          code: 'FACTION_CONFLICT_INVALID',
          field: 'action',
          message: '对立阵营实体同框时，动作必须体现对抗或交战交互，禁止无冲突或协同动作。'
        });
      }
    }
  }

  // 6. 载具与环境/动作物理兼容 (Vehicle Motion Compatibility)
  const env = resolvedAssets.environment;
  const envName = env ? `${env.name} ${env.nameZh || ''}`.toLowerCase() : '';
  for (const subject of resolvedAssets.subjects) {
    if (subject.kind === 'vehicle') {
      const vClass = subject.class; // 'aircraft' | 'ground' | 'sea' | 'submarine'
      // 陆地车辆在深海潜行冲突
      if (vClass === 'ground' && (envName.includes('ocean') || envName.includes('sea') || envName.includes('深海'))) {
        if (!actionText.includes('deck') && !actionText.includes('ship') && !actionText.includes('landing craft') && !actionText.includes('甲板')) {
          violations.push({
            code: 'VEHICLE_MOTION_INCOMPATIBLE',
            field: 'environment',
            message: `地面载具 [${subject.id}] 不能在无搭载平台的开阔海域环境运行。`
          });
        }
      }
      // 潜艇在陆地/荒漠冲突
      if (vClass === 'submarine' && (envName.includes('desert') || envName.includes('mountain') || envName.includes('沙漠'))) {
        violations.push({
          code: 'VEHICLE_MOTION_INCOMPATIBLE',
          field: 'environment',
          message: `潜艇载具 [${subject.id}] 无法在陆地或荒漠环境中部署。`
        });
      }
    }
  }

  // 7. 环境与天气物理兼容 (Environment & Weather Compatibility)
  if (env) {
    const weather = intent.weather || '';
    if ((envName.includes('desert') || envName.includes('沙丘')) && weather === 'snow') {
      violations.push({
        code: 'ENVIRONMENT_WEATHER_CONFLICT',
        field: 'weather',
        message: '干旱沙漠环境与暴风雪气象存在物理逻辑冲突。'
      });
    }
  }

  return {
    ok: violations.length === 0,
    value: s,
    violations
  };
}

/**
 * 校验整部影片的镜头计划 (Film Plan)
 * @param {object} plan 影片计划对象
 * @param {object} r 资产注册表
 * @returns {{ ok: boolean, value: object, violations: Array<object> }}
 */
export function validateFilmPlan(plan, r) {
  const violations = [];
  const shots = plan.shots || [];

  let highestPhaseScore = -1;

  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    const specResult = validateShotSpec(s, r, plan.intent);
    violations.push(...specResult.violations);

    // 8. 叙事阶段流转顺序检查 (Narrative Phase Order)
    const phaseKey = s.phase || 'build';
    const currentScore = PHASE_ORDER[phaseKey] ?? 1;

    // 若未标明是 flashback，且阶段严重回退（如 resolve 后又回到 establish）
    if (!s.isFlashback && highestPhaseScore >= 3 && currentScore <= 0) {
      violations.push({
        code: 'NARRATIVE_PHASE_DISORDER',
        shotIndex: i,
        message: `镜头 S${String(i + 1).padStart(3, '0')} 出现叙事阶段严重倒退（在结局 resolve 后突现 establish 铺垫），需显式声明 flashback。`
      });
    }
    if (currentScore > highestPhaseScore) {
      highestPhaseScore = currentScore;
    }
  }

  // 连续性链条校验
  const contResult = validateContinuityChain(shots, r);
  if (!contResult.ok) {
    violations.push(...contResult.violations);
  }

  return {
    ok: violations.length === 0,
    value: plan,
    violations
  };
}
