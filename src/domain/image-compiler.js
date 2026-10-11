/**
 * LEGO War Universe - 首帧图像提示词编译器 (Keyframe Image Compiler)
 * 专为现代文生图大模型（FLUX.1 Pro, Midjourney v6, Imagen 3, SDXL）编译
 * 用于在视频生成前，生成高质感、高连续性的首帧定格参考图 (Image-to-Video Anchor)
 */

import { LINK_BY_PREV } from './story.js';

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
  // `hero` 不再写死 —— 见 `poseFor()`：151/312 张首帧的正文毫无武器语义，
  // 却被硬套上 "weapon up"（环境空镜、靠着舱壁坐下、探头呼吸海风都是受害者）。
  hero: 'the lead minifigure in the foreground, centred',
  squad: 'two friendly minifigures side by side, medium two-shot',
  vehicle: 'the vehicle dominant in frame, crew visible at the hatch',
  clash: 'the two opposing minifigures locked at close quarters, filling the frame',
  enemy: 'the opposing minifigure in the foreground, facing camera-left',
  default: 'the subjects held in a battle-ready stance'
};

/**
 * 正文里出现这些词 → 该镜主体确实持械。
 *
 * **只收「主体手上拿着什么」的词，不收战场环境描述。**
 * 「迎着火力把舰载机放出去」「正面压制，侧翼绕过去」里的「火力」「压制」
 * 形容的是战场，不是这个人的手 —— 把它们算进持械，航母舰桥上的舰长
 * 也会被画成举枪站立（实测 9 例）。
 */
const ARMED_HINT = /枪|射击|开火|举枪|端枪|瞄准|弹匣|炮|扫射|刀|武器|手雷|火箭筒|交火|对射|换弹/;
/** 跪 / 坐 / 靠 —— 与 "weapon up" 直接冲突，必须优先于持械判定 */
const REST_HINT = /跪|坐|靠|趴|蹲|倚|躺|撑着|跪在/;
/** 位移 —— 站定举枪也不对 */
const MOVE_HINT = /撤离|穿过|走|跑|奔|撤退|前进|推进|爬向|翻过/;
/**
 * 手部操作 —— 「把手按在放飞铃上」「在图上画出两条箭头」「指着图上那片空白」。
 * 这些镜头主体在**用双手做一件事**，举枪站立会把整镜带偏。
 * 排在 ARMED 之后：真正的「压紧弹匣」会先被 ARMED 命中。
 */
const HANDS_HINT = /按在|画出|拍上|指着|指图|摊开|翻开|塞回|塞进|压在|标定|调试|拨动|抓起|放下|握着|举着|打开|合上/;

/**
 * 主体姿势必须由**正文**决定，不能由 focus 写死。
 *
 * 首帧是 image-to-video 的输入：姿势错了，整镜都会带着这个错姿势走完
 * （「靠着舱壁坐下」的镜头如果首帧是举枪站立，Veo 会先让人站起来再坐下，
 * 或者干脆一直站着）。所以这一句是**全镜的锚**，不是一句修饰。
 */
function poseFor(shot, base) {
  const t = String(shot?.action || '');
  if (REST_HINT.test(t)) return `${base}, seated or braced against a surface, slumped posture`;
  if (MOVE_HINT.test(t)) return `${base}, caught mid-stride, moving through frame`;
  if (ARMED_HINT.test(t)) return `${base}, weapon up`;
  if (HANDS_HINT.test(t)) return `${base}, hands working at a map or control, head lowered`;
  return `${base}, weapon lowered at their side, neutral stance`;
}

/** 从景别标签里取出英文部分：「拐角遭遇手持近景 (Contact Handheld)」→「Contact Handheld」 */
function shotTypeEn(shotType) {
  const m = String(shotType || '').match(/\(([A-Za-z][A-Za-z0-9 /\-]*)\)\s*$/);
  return m ? m[1].trim() : '';
}

/**
 * 剥掉因果连接词。
 *
 * `LINK_BY_PREV` 的连接词是**上一镜的遗留**，被前置到本镜正文开头
 * （「手按住地图，……」里的「手按住地图」描述的是上一镜的收尾动作）。
 * 首帧要的是「本镜画面上正在发生什么」，取到连接词就等于给生图模型
 * 喂了上一镜的画面 —— 实测第 5 镜首帧写成「手按住地图」，而本镜是海上接触。
 */
function stripLink(action) {
  let t = String(action || '');
  for (const l of Object.values(LINK_BY_PREV)) {
    if (l && t.startsWith(l)) { t = t.slice(l.length); break; }
  }
  return t;
}

/** 取正文的第一个视觉分句，作为「这一刻画面上在发生什么」的短提示（不塞整段） */
function firstBeat(action) {
  const visual = stripLink(String(action || '').replace(/「[^」]*」/g, '').replace(/^【无线电】/, ''));
  // 连接词被剥掉后，原句可能以逗号开头
  const seg = visual.split(/[。；！？]/).map(s => s.trim()).filter(Boolean)[0] || '';
  return seg.replace(/^[，,]\s*/, '').split(/[，,]/).map(s => s.trim()).filter(Boolean)[0] || seg;
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

  const basePose = POSE_BY_FOCUS[shot.focus] || POSE_BY_FOCUS.default;
  const framing = [
    shotTypeEn(shot.shotType),
    shot.focus === 'hero' ? poseFor(shot, basePose) : basePose,
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
