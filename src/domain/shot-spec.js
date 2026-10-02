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

/**
 * 「交战语义」判定正则。
 *
 * 必须导出为单一事实来源：任何「把敌方角色补进镜头」的逻辑都要用它来把关，
 * 否则补进去的镜头会在校验阶段报 FACTION_CONFLICT_INVALID（对立阵营同框却无对抗动作）。
 */
export const COMBAT_ACTION_REGEX = /(?:combat|engage|fire|firing|shoot|clash|vs|ambush|intercept|capture|assault|suppress|交战|开火|对抗|拦截|伏击|对峙|突袭|压制)/i;
export const COOPERATIVE_ACTION_REGEX = /(?:together|cooperate|escort|wingman|side by side|并肩|护航|编队协同|共同作战)/i;

/**
 * 对立阵营同框时，这段动作是否构成「合法对抗」。
 *
 * 校验器与「补入敌方」逻辑共用这一个判定，避免两处正则各写一份而漂移：
 * 一旦不一致，补进去的镜头会直接在校验阶段报错，用户看到的是红色阻断提示。
 */
export function hasHostileFraming(actionText) {
  const text = String(actionText || '');
  return COMBAT_ACTION_REGEX.test(text) && !COOPERATIVE_ACTION_REGEX.test(text);
}

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
 * 时代兼容分组。
 * 时代校验的目的只有一个：防止画面出现肉眼可见的穿帮（谢尔曼坦克开进现代城市）。
 * 因此「现代」与「现代高科技」是同一时期的不同题材，混用并不构成穿帮；
 * 而「二战」装备出现在现代场景才是真正必须拦下的错误。
 */
const ERA_COMPATIBILITY = {
  'Modern': ['Modern', 'Modern High-Tech'],
  'Modern High-Tech': ['Modern', 'Modern High-Tech'],
  'Gulf War': ['Gulf War', 'Iraq War'],
  'Iraq War': ['Gulf War', 'Iraq War'],
  'WWII': ['WWII', 'Pacific'],
  'Pacific': ['WWII', 'Pacific'],
  'Cold War': ['Cold War'],
  'Orbital': ['Orbital']
};

export function isEraCompatible(assetSeries, targetEra) {
  if (!targetEra) return true;
  if (!assetSeries || assetSeries === 'shared') return true;
  if (assetSeries === targetEra) return true;
  const group = ERA_COMPATIBILITY[targetEra];
  return Array.isArray(group) ? group.includes(assetSeries) : false;
}

/**
 * 时代不一致的严重度分级。
 * 主体（人仔 / 载具 / 武器）携带强烈的时代视觉特征，不一致即为穿帮 → error。
 * 环境（沙漠、山地、海岸）本身几乎没有时代特征，且资产库各时代覆盖极不均衡
 * （Modern 有 45 个环境，Modern High-Tech 只有 1 个），不一致仅作提示 → warning。
 */
const ERA_SEVERITY_BY_KIND = {
  character: 'error',
  vehicle: 'error',
  weapon: 'error',
  environment: 'warning'
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
      violations.push({ code: 'UNKNOWN_ID', field, id, severity: 'error' });
      return null;
    }
    if (expectedKind && a.kind !== expectedKind) {
      violations.push({
        code: 'INVALID_KIND',
        field,
        expected: expectedKind,
        actual: a.kind,
        severity: 'error'
      });
      return null;
    }
    if (intent.era && !isEraCompatible(a.series, intent.era)) {
      violations.push({
        code: 'ERA_MISMATCH',
        field,
        id,
        era: a.series,
        targetEra: intent.era,
        severity: ERA_SEVERITY_BY_KIND[a.kind] || 'warning'
      });
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
    violations.push({ code: 'SUBJECT_QUOTA', severity: 'error' });
  } else {
    for (const subId of s.subjects) {
      const asset = checkAsset(subId, null, 'subjects');
      if (asset) resolvedAssets.subjects.push(asset);
    }
  }

  // 3. 特效与音频配额
  if ((s.fx || []).length > 3) violations.push({ code: 'FX_QUOTA', severity: 'error' });
  if ((s.audio || []).length > 2) violations.push({ code: 'AUDIO_QUOTA', severity: 'error' });

  // 4. 动作描述必填
  const actionText = String(s.action || '').trim();
  if (!actionText) {
    violations.push({ code: 'MISSING_ACTION', severity: 'error' });
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
      if (!hasHostileFraming(actionText)) {
        violations.push({
          code: 'FACTION_CONFLICT_INVALID',
          field: 'action',
          message: '对立阵营实体同框时，动作必须体现对抗或交战交互，禁止无冲突或协同动作。',
          severity: 'error'
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
            message: `地面载具 [${subject.id}] 不能在无搭载平台的开阔海域环境运行。`,
            severity: 'error'
          });
        }
      }
      // 潜艇在陆地/荒漠冲突
      if (vClass === 'submarine' && (envName.includes('desert') || envName.includes('mountain') || envName.includes('沙漠'))) {
        violations.push({
          code: 'VEHICLE_MOTION_INCOMPATIBLE',
          field: 'environment',
            message: `潜艇载具 [${subject.id}] 无法在陆地或荒漠环境中部署。`,
            severity: 'error'
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
        message: '干旱沙漠环境与暴风雪气象存在物理逻辑冲突。',
        severity: 'error'
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
        message: `镜头 S${String(i + 1).padStart(3, '0')} 出现叙事阶段严重倒退（在结局 resolve 后突现 establish 铺垫），需显式声明 flashback。`,
        severity: 'error'
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

  // 统一补齐 severity 并分级。
  // ok 只表示「没有阻断级错误」——提示级问题不应把整份分镜判为非法，
  // 否则一次转译就会在界面上刷出十几条红色警告，真正的穿帮反而被淹没。
  const errors = [];
  const warnings = [];
  for (const v of violations) {
    const severity = v.severity === 'warning' ? 'warning' : 'error';
    const item = { ...v, severity };
    (severity === 'warning' ? warnings : errors).push(item);
  }

  return {
    ok: errors.length === 0,
    value: plan,
    violations: [...errors, ...warnings],
    errors,
    warnings
  };
}
