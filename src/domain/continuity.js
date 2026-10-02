/**
 * LEGO War Universe - 镜头连续性状态机与强约束校验
 * 负责角色外观演变、载具战损单调性、180度屏幕轴线方向与上一镜头参考帧锚定。
 */

export const DAMAGE_HIERARCHY = {
  clean: 0,
  weathered: 1,
  damaged: 2,
  destroyed: 3
};

export const SCREEN_DIRECTIONS = new Set([
  'left-to-right',
  'right-to-left',
  'towards-camera',
  'away-from-camera',
  'neutral'
]);

/**
 * 校验多镜头连续性链条
 * @param {Array<object>} shots 镜头列表
 * @param {object} registry 资产注册表（可选）
 * @returns {{ ok: boolean, violations: Array<{ code: string, shotIndex: number, message: string }> }}
 */
export function validateContinuityChain(shots = [], registry = null) {
  const violations = [];
  if (!Array.isArray(shots) || shots.length === 0) {
    return { ok: true, violations: [] };
  }

  // 记录每个实体（角色/载具）的历史最高损伤与外观
  const entityStateHistory = new Map(); // entityId -> { lastDamage, lastVariant, lastShotIndex }
  let lastScreenDir = null;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    const shotLabel = `S${String(i + 1).padStart(3, '0')}`;

    // 1. 验证上一镜头参考帧绑定（第2个镜头起必须有 referenceFrame 锚点）
    if (i > 0) {
      const expectedRef = `shot_${i}_end_frame`;
      const declaredRef = shot.referenceFrame || shot.continuityIn?.referenceFrame;
      if (!declaredRef) {
        violations.push({
          code: 'MISSING_REFERENCE_FRAME',
          shotIndex: i,
          message: `${shotLabel} 缺少前序镜头参考帧锚点，必须声明上一镜头的视觉参考。`
        });
      }
    }

    // 2. 验证屏幕轴线方向合法性与越轴跳跃
    const screenDir = shot.screenDirection || shot.continuityIn?.screenDirection || 'neutral';
    if (!SCREEN_DIRECTIONS.has(screenDir)) {
      violations.push({
        code: 'INVALID_SCREEN_DIRECTION',
        shotIndex: i,
        message: `${shotLabel} 的屏幕运动方向 "${screenDir}" 不在规范枚举中。`
      });
    } else {
      // 180度轴线突变检查：如果不是中性镜头，且直接与上一镜头反向
      if (
        lastScreenDir &&
        lastScreenDir !== 'neutral' &&
        screenDir !== 'neutral' &&
        ((lastScreenDir === 'left-to-right' && screenDir === 'right-to-left') ||
          (lastScreenDir === 'right-to-left' && screenDir === 'left-to-right'))
      ) {
        // 若没有 transition/buffer 标记，则记为越轴跳轴
        if (!shot.isTransitionShot && shot.phase !== 'resolve') {
          violations.push({
            code: 'AXIS_JUMP_ACROSS_LINE',
            shotIndex: i,
            message: `${shotLabel} 存在严重越轴：由 ${lastScreenDir} 突变为 ${screenDir}，破坏180度轴线连续性。`
          });
        }
      }
      lastScreenDir = screenDir;
    }

    // 3. 验证载具损伤状态单调性与角色外观
    const subjectList = shot.subjects || [];
    const damageState = shot.damageState || shot.continuityOut?.damageState || 'weathered';
    const variantState = shot.variant || shot.continuityOut?.variant || 'standard';

    for (const subId of subjectList) {
      const prev = entityStateHistory.get(subId);
      const currentDamageScore = DAMAGE_HIERARCHY[damageState] ?? 1;

      if (prev) {
        const prevDamageScore = DAMAGE_HIERARCHY[prev.lastDamage] ?? 1;
        // 损伤不可逆倒退检查：如从 damaged 突变成 clean
        if (currentDamageScore < prevDamageScore) {
          violations.push({
            code: 'DAMAGE_STATE_REGRESSION',
            shotIndex: i,
            message: `${shotLabel} 中实体 [${subId}] 损伤状态异常回退（从 ${prev.lastDamage} 变为 ${damageState}）。`
          });
        }

        // 角色外观异常突变检查
        if (prev.lastVariant === 'battle-worn' && variantState === 'clean') {
          violations.push({
            code: 'VARIANT_REGRESSION',
            shotIndex: i,
            message: `${shotLabel} 中角色 [${subId}] 从战损外观突变回全新出厂外观。`
          });
        }
      }

      entityStateHistory.set(subId, {
        lastDamage: damageState,
        lastVariant: variantState,
        lastShotIndex: i
      });
    }
  }

  return {
    ok: violations.length === 0,
    violations
  };
}

/**
 * 判断两个相邻镜头轴向是否构成非法越轴（180 度线反转）
 * 中性轴（neutral / 迎面 / 远离）不参与判定，因为它们在摄影学上本就是合法的重新建轴镜头。
 */
function isAxisReversal(prev, next) {
  if (!prev || !next) return false;
  if (prev === 'neutral' || next === 'neutral') return false;
  return (
    (prev === 'left-to-right' && next === 'right-to-left') ||
    (prev === 'right-to-left' && next === 'left-to-right')
  );
}

/**
 * 自动填充并传播连续性状态，确保镜头链条自洽
 *
 * 契约（两条，缺一不可）：
 *   1. 填充 —— 缺失的连续性状态必须被推导出来，使链条完整可编译。
 *   2. 尊重 —— 已被作者显式设定的状态不得被覆盖；只能在其基础上单调推进。
 *
 * 早期实现只做到了「填充」，且是破坏性填充：用运行态无条件覆盖作者设定的
 * screenDirection / damageState，导致整片轴向恒为 left-to-right、战损永远到不了
 * destroyed。本实现修正为「作者设定优先 + 单调推进 + 非法越轴自动修复」。
 *
 * @param {Array<object>} rawShots 原始镜头规划
 * @returns {Array<object>} 具备强制连续性状态的镜头序列
 */
export function enforceContinuityChain(rawShots = []) {
  if (!Array.isArray(rawShots)) return [];
  const out = [];
  let prevShotId = null;
  let runningDamage = 'weathered';
  let runningVariant = 'standard';
  let runningDirection = 'left-to-right';

  for (let i = 0; i < rawShots.length; i++) {
    const s = { ...rawShots[i] };
    const shotId = `shot_${i + 1}`;

    // 随叙事阶段推演战损：climax 阶段演化为 damaged
    if (s.phase === 'climax' && runningDamage !== 'destroyed') {
      runningDamage = 'damaged';
      runningVariant = 'battle-worn';
    }

    // 作者显式设定的状态：首镜作为基线直接采纳，后续镜头只允许单调推进
    const authoredDamage = s.damageState || s.continuityOut?.damageState;
    const authoredVariant = s.variant || s.continuityOut?.variant;
    let authoredDirection = s.screenDirection || s.continuityIn?.screenDirection;

    if (i === 0) {
      if (authoredDamage && DAMAGE_HIERARCHY[authoredDamage] !== undefined) {
        runningDamage = authoredDamage;
      }
      if (authoredVariant) runningVariant = authoredVariant;
      if (SCREEN_DIRECTIONS.has(authoredDirection)) runningDirection = authoredDirection;
    } else {
      // 战损不可逆：只接受更严重的档位，回退一律拒绝
      if (
        authoredDamage &&
        DAMAGE_HIERARCHY[authoredDamage] !== undefined &&
        DAMAGE_HIERARCHY[authoredDamage] > DAMAGE_HIERARCHY[runningDamage]
      ) {
        runningDamage = authoredDamage;
      }
      if (authoredVariant) runningVariant = authoredVariant;

      if (SCREEN_DIRECTIONS.has(authoredDirection)) {
        // 越轴修复：直接反转会破坏 180 度轴线。摄影学上唯一的合法跨越方式
        // 是经由一个骑轴（neutral）镜头重新建轴，因此降级为 neutral 而非告警。
        if (isAxisReversal(runningDirection, authoredDirection)) {
          s.axisRepairedFrom = authoredDirection;
          authoredDirection = 'neutral';
        }
        runningDirection = authoredDirection;
      }
    }

    const continuityIn = {
      previousShotId: prevShotId,
      referenceFrame: i === 0 ? null : `shot_${i}_end_frame`,
      screenDirection: runningDirection,
      damageState: runningDamage,
      variant: runningVariant
    };

    const continuityOut = {
      screenDirection: runningDirection,
      damageState: runningDamage,
      variant: runningVariant,
      endFrame: `${shotId}_end_frame`
    };

    s.shotId = shotId;
    s.referenceFrame = continuityIn.referenceFrame;
    s.screenDirection = runningDirection;
    s.damageState = runningDamage;
    s.variant = runningVariant;
    s.continuityIn = continuityIn;
    s.continuityOut = continuityOut;

    out.push(s);
    prevShotId = shotId;
  }

  return out;
}
