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
 * 按 focus 给一句英文站位描述。
 *
 * 首帧是 image-to-video 的锚点：它必须是一张**能站住的静止构图**，
 * 而不是一段叙事。此前这一格写的是整段中文正文（「压力还在加码，X 与 Y 在战壕里
 * 正面交战，双方在几米内对射…」），生图模型拿到的是中英混杂的一整段剧情，
 * 而不是「谁站在哪、镜头多近」。
 */
const POSE_BY_FOCUS = {
  hero: 'the lead minifigure in the foreground, centred, weapon up',
  squad: 'two friendly minifigures side by side, medium two-shot',
  vehicle: 'the vehicle dominant in frame, crew visible at the hatch',
  clash: 'the two opposing minifigures locked at close quarters, filling the frame',
  enemy: 'the opposing minifigure in the foreground, facing camera-left',
  default: 'the subjects held in a battle-ready stance'
};

/** 从景别标签里取出英文部分：「拐角遭遇手持近景 (Contact Handheld)」→「Contact Handheld」 */
function shotTypeEn(shotType) {
  const m = String(shotType || '').match(/\(([A-Za-z][A-Za-z0-9 /\-]*)\)\s*$/);
  return m ? m[1].trim() : '';
}

/** 取正文的第一个视觉分句，作为「这一刻画面上在发生什么」的短提示（不塞整段） */
function firstBeat(action) {
  const visual = String(action || '').replace(/「[^」]*」/g, '').replace(/^【无线电】/, '');
  const seg = visual.split(/[。；！？]/).map(s => s.trim()).filter(Boolean)[0] || '';
  return seg.split(/[，,]/).map(s => s.trim()).filter(Boolean)[0] || seg;
}

/**
 * 编译镜头首帧参考图 Prompt
 * @param {object} shot 镜头对象
 * @param {object} registry 资产注册表
 * @param {object|null} [roster] 角色名册（可选；用于把代号/角色名写进首帧 Prompt）
 * @returns {{ prompt: string, negativePrompt: string, styleZh: string }}
 */
export function compileKeyframeImage(shot, registry, roster = null) {
  const parts = [...STATIC_STYLE_HEADER];

  // 1. 场景与环境
  const env = registry?.byId?.get(shot.environment);
  if (env) {
    parts.push(`Setting: ${env.name}, ${env.lines ? env.lines.slice(0, 2).join(', ') : ''}`);
  }

  // 2. 主体角色与载具（带代号，保证首帧与视频脚本用同一套角色身份）
  const subjectLines = [];
  for (const sid of shot.subjects || []) {
    const asset = registry?.byId?.get(sid);
    if (asset) {
      const entry = roster?.byId?.get(sid);
      const head = entry
        ? `【${entry.callsign}】${entry.name} / ${asset.name} (${sid})`
        : `${asset.name} (${sid})`;
      const damage = shot.damageState ? `[condition: ${shot.damageState}]` : '';
      const variant = shot.variant ? `[variant: ${shot.variant}]` : '';
      subjectLines.push(`${head} ${damage} ${variant}: ${asset.lines ? asset.lines[0] : ''}`);
    }
  }
  if (subjectLines.length > 0) {
    parts.push(`Subjects: ${subjectLines.join('; ')}`);
  }

  // 3. 静态瞬间站位与构图
  //
  //    这一格必须回答「谁站在哪、镜头多近」，不是复述剧情。
  //    英文构图在前（生图模型吃英文），正文只留**第一个视觉分句**作为画面提示。
  const cam = registry?.byId?.get(shot.camera);
  const lgt = registry?.byId?.get(shot.lighting);
  const clr = registry?.byId?.get(shot.colorGrade);

  const framing = [
    shotTypeEn(shot.shotType),
    POSE_BY_FOCUS[shot.focus] || POSE_BY_FOCUS.default,
    'frozen single instant, static pose, no motion blur on the subject'
  ].filter(Boolean).join(', ');
  parts.push(`Framing & Pose: ${framing}`);

  const beat = firstBeat(shot.action);
  if (beat) parts.push(`Action context (Chinese): ${beat}`);

  if (cam) parts.push(`Camera angle: ${cam.name}`);
  if (lgt) parts.push(`Lighting: ${lgt.name}`);
  if (clr) parts.push(`Color grading: ${clr.name}`);

  // 5. 屏幕朝向锚点与画幅比例
  if (shot.screenDirection) {
    parts.push(`Subject orientation: facing ${shot.screenDirection}`);
  }
  const ar = shot.aspectRatio || '9:16';
  parts.push(`Aspect ratio: ${ar}`);

  const prompt = parts
    .filter(Boolean)
    .map(p => String(p).replace(/[.。]+$/, ''))
    .join('. ') + '.';
  const negativePrompt = STATIC_NEGATIVE_PROMPT.join(', ');

  return {
    prompt,
    negativePrompt,
    styleZh: `35mm 微距定格摄影 · 浅景深 · 真实积木质感 · 画幅: ${ar} · 轴向: ${shot.screenDirection || 'neutral'}`
  };
}
