/**
 * LEGO War Universe - 首帧图像提示词编译器 (Keyframe Image Compiler)
 * 专为现代文生图大模型（FLUX.1 Pro, Midjourney v6, Imagen 3, SDXL）编译
 * 用于在视频生成前，生成高质感、高连续性的首帧定格参考图 (Image-to-Video Anchor)
 */

const STATIC_STYLE_HEADER = [
  'Cinematic still photograph of a miniature LEGO stop-motion set',
  'shot on 35mm anamorphic macro lens, f/2.8 shallow depth of field',
  'photorealistic plastic minifigures and brick-built constructions',
  'subtle injection mold seams, fine plastic texture and genuine LEGO stud logos',
  'volumetric lighting, dust particles, realistic environmental weathering'
];

const STATIC_NEGATIVE_PROMPT = [
  'blurry', 'low resolution', 'deformed minifigure', 'missing limbs', 'human skin',
  'real human eyes', 'melted plastic', 'CGI render look', 'cartoonish', 'text', 'watermark',
  'duplicate characters', 'non-LEGO scale'
];

/**
 * 将镜头的动作描述净化为静态首帧瞬间
 * @param {string} actionText 镜头动作描述
 * @returns {string} 静态构图描述
 */
function toStaticPose(actionText) {
  if (!actionText) return 'Minifigures poised in battle-ready stance.';
  return actionText
    .replace(/\b(moving|running|advancing|flying|firing|sprinting|charging|retreating)\b/gi, 'positioned')
    .replace(/\b(begins to|starts to|proceeds to)\b/gi, 'seen');
}

/**
 * 编译镜头首帧参考图 Prompt
 * @param {object} shot 镜头对象
 * @param {object} registry 资产注册表
 * @returns {{ prompt: string, negativePrompt: string, styleZh: string }}
 */
export function compileKeyframeImage(shot, registry) {
  const parts = [...STATIC_STYLE_HEADER];

  // 1. 场景与环境
  const env = registry?.byId?.get(shot.environment);
  if (env) {
    parts.push(`Setting: ${env.name}, ${env.lines ? env.lines.slice(0, 2).join(', ') : ''}`);
  }

  // 2. 主体角色与载具
  const subjectLines = [];
  for (const sid of shot.subjects || []) {
    const asset = registry?.byId?.get(sid);
    if (asset) {
      const damage = shot.damageState ? `[condition: ${shot.damageState}]` : '';
      const variant = shot.variant ? `[variant: ${shot.variant}]` : '';
      subjectLines.push(`${asset.name} ${damage} ${variant}: ${asset.lines ? asset.lines[0] : ''}`);
    }
  }
  if (subjectLines.length > 0) {
    parts.push(`Subjects: ${subjectLines.join('; ')}`);
  }

  // 3. 静态瞬间站位与构图
  parts.push(`Framing & Pose: ${toStaticPose(shot.action)}`);

  // 4. 摄影机与布光
  const cam = registry?.byId?.get(shot.camera);
  const lgt = registry?.byId?.get(shot.lighting);
  const clr = registry?.byId?.get(shot.colorGrade);

  if (cam) parts.push(`Camera angle: ${cam.name}`);
  if (lgt) parts.push(`Lighting: ${lgt.name}`);
  if (clr) parts.push(`Color grading: ${clr.name}`);

  // 5. 屏幕朝向锚点与画幅比例
  if (shot.screenDirection) {
    parts.push(`Subject orientation: facing ${shot.screenDirection}`);
  }
  const ar = shot.aspectRatio || '16:9';
  parts.push(`Aspect ratio: ${ar}`);

  const prompt = parts.filter(Boolean).join('. ') + '.';
  const negativePrompt = STATIC_NEGATIVE_PROMPT.join(', ');

  return {
    prompt,
    negativePrompt,
    styleZh: `35mm 微距定格摄影 · 浅景深 · 真实积木质感 · 画幅: ${ar} · 轴向: ${shot.screenDirection || 'neutral'}`
  };
}
