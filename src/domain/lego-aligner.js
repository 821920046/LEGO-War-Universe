/**
 * LEGO War Universe - 乐高工程约束与资产对齐适配器 (Lego Aligner)
 * 将大模型自由发散的影视分镜文本，精准对齐为符合 390 项认证积木资产与微缩定格物理规范的数据结构
 */

import { enforceContinuityChain } from './continuity.js';

export function alignShotsToLego(rawShots = [], baseAssets = {}, era = 'Modern') {
  const defaultSubjects = baseAssets.subjects || ['CHR-401'];
  const defaultEnv = baseAssets.environment || 'ENV-001';
  const defaultCam = baseAssets.camera || 'CAM-001';
  const defaultLgt = baseAssets.lighting || 'LGT-001';
  const defaultClr = baseAssets.colorGrade || 'CLR-001';

  const phases = ['establish', 'build', 'climax', 'resolve'];

  const mapped = rawShots.map((shot, idx) => {
    const phase = shot.phase || phases[Math.min(idx, phases.length - 1)] || 'build';
    let damageState = shot.damageState || 'clean';
    if (phase === 'build') damageState = 'weathered';
    if (phase === 'climax') damageState = 'damaged';

    // 智能推断方向
    let screenDirection = shot.screenDirection || 'left-to-right';
    if (phase === 'establish') screenDirection = 'towards-camera';
    if (phase === 'resolve') screenDirection = 'away-from-camera';

    return {
      shotId: shot.shotId || `shot_${idx + 1}`,
      phase,
      shotType: shot.shotType || '中景跟拍 (Medium Tracking Shot)',
      action: shot.action || '乐高特战人员呈战术队形稳步推进，塑料砖块咬合严密。',
      screenDirection,
      damageState,
      audioCue: shot.audioCue || '环境战术音效 · 细微塑料碰撞声',
      radioVoice: shot.radioVoice || '【无线电】全队保持警戒，注意前方动向。',
      aspectRatio: shot.aspectRatio || '16:9',
      subjects: shot.subjects && shot.subjects.length > 0 ? shot.subjects : defaultSubjects,
      environment: shot.environment || defaultEnv,
      camera: shot.camera || defaultCam,
      lighting: shot.lighting || defaultLgt,
      colorGrade: shot.colorGrade || defaultClr
    };
  });

  return enforceContinuityChain(mapped);
}
