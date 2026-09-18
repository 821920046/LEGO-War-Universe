/**
 * LEGO War Universe - 提示词编译器（含连续性锚点注入）
 */
import { validateShotSpec } from './shot-spec.js';

/**
 * 编译单镜头为 Google Flow (Veo) 可用的提示词字符串
 * @param {object} s 镜头规范对象（应携带连续性状态）
 * @param {object} r 资产注册表
 * @param {object} p 模型配置（profile）
 * @returns {{ prompt: string, promptZh: string }}
 */
export function compileShot(s, r, p) {
  if (!p) throw new Error('Profile required for compilation');
  const check = validateShotSpec(s, r, {});
  if (!check.ok) {
    throw new Error(check.violations.map(x => x.code).join(','));
  }

  const get = id => {
    const a = r.byId.get(id);
    if (!a) throw new Error(`Asset not found: ${id}`);
    return a;
  };

  const env = get(s.environment);
  const camera = get(s.camera);
  const lighting = get(s.lighting);
  const color = get(s.colorGrade);

  const duration = p.durations.includes(8) ? 8 : p.durations[0];
  const aspectRatio = s.aspectRatio || p.selectedAspectRatio || p.aspectRatios[0];

  // 连续性锚点（屏幕方向、损伤状态、参考帧）
  const screenDir = s.screenDirection || s.continuityIn?.screenDirection || 'neutral';
  const damageState = s.damageState || s.continuityOut?.damageState || 'weathered';
  const variant = s.variant || s.continuityOut?.variant || 'standard';
  const refFrame = s.referenceFrame || s.continuityIn?.referenceFrame || null;

  const continuityLine = [
    `Screen direction: ${screenDir}.`,
    `Subject state: ${damageState} / ${variant}.`,
    refFrame ? `Continuity anchor: match visual appearance from [${refFrame}].` : null
  ].filter(Boolean).join(' ');

  const subjectLines = s.subjects
    .map(id => `[${id}] ${(get(id).lines || []).join(', ')}`)
    .join('; ');

  const lines = [
    ...(r.styleBlock.lines || []),
    '',
    `Scene: ${(env.lines || []).join(', ')}.`,
    `Subject(s): ${subjectLines}.`,
    `Action: ${s.action}`,
    '',
    `Camera: ${(camera.lines || []).join(', ')}.`,
    `Lighting: ${(lighting.lines || []).join(', ')}.`,
    `Color grade: ${(color.lines || []).join(', ')}.`,
    '',
    continuityLine,
    '',
    `Single continuous ${duration}-second shot, ${aspectRatio} aspect ratio.`,
    `Negative prompt: ${(r.negative.lines || []).join(', ')}.`
  ];

  return {
    prompt: lines.filter(l => l !== null).join('\n'),
    promptZh: s.action
  };
}
