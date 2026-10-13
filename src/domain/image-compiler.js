/**
 * LEGO War Universe - 首帧图像提示词编译器 (Keyframe Image Compiler)
 * 专为现代文生图大模型（FLUX.1 Pro, Midjourney v6, Imagen 3, SDXL）编译
 * 用于在视频生成前，生成高质感、高连续性的首帧定格参考图 (Image-to-Video Anchor)
 */

import { LINK_BY_PREV } from './story.js';
import { stripInternalMarkers, withoutDialogue } from './prompt-hygiene.js';

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
 * 战场物件也含武器词 —— `炮塔`含「炮」、`装甲集群`含「装甲」、`炮兵阵地`含「炮」、
 * `机枪巢`含「机枪」。它们**不是此人手里的东西**，先摘掉再判持械。
 *
 * 6.7.5 第一版只按名词子串判持械，实测 38/312 张首帧因此被画成举枪站立：
 * 库尔斯克车长「在炮塔上摊开地图」被配上 weapon up。
 */
const NOT_HELD = /炮塔|炮火|炮击|炮声|炮弹|装甲|机枪巢|机枪阵地|机枪堡|机枪掩体|炮兵阵地|炮阵地|舰炮|主炮|高射炮|机炮|炮火覆盖|火力点|火力覆盖|枪声|弹着点|弹片|弹幕|曳光弹/g;
/**
 * 明确的持械动作：这个人正在操作一件手持武器。
 *
 * **动作词必须带宾语。** 第一版写的是裸的 `架起` / `端起` / `扛起` / `操起`，
 * 结果「第一架**起飞**」里的「第一架」+「起飞」跨词命中 `架起` ——
 * 一架飞机起飞，人却被画成举枪站立（6.7.6 自引入缺陷，被测试抓出）。
 * 所以这四个词一律要求后接武器宾语；`肩扛` 例外——「肩扛」几乎只用于武器。
 */
const HELD_STRONG = /举枪|端枪|持枪|握枪|扛着枪|肩扛|架起[^。，]{0,6}(枪|炮|筒|武器)|端起[^。，]{0,6}(枪|炮|筒)|扛起[^。，]{0,6}(枪|炮|筒)|操起[^。，]{0,6}(枪|炮|筒)|顶上弹匣|压紧弹匣|压上弹匣|换弹匣|换弹|推弹上膛|扣动|扣住扳机|扣扳机|瞄准|抵肩|火箭筒|反坦克.{0,3}筒|手雷|榴弹|掷弹|匕首|刺刀|步枪在手|机枪在手|手枪在手|冲锋枪在手|武器对准|武器上肩/;
/** 泛化开火动词：本镜人物开火算持械，但「远处开火」「敌方炮火」不算 */
const FIRING = /开火|射击|扫射|对射|倾泻火力|火力倾泻/;
/** 发起者不是本镜人物的标记 */
const REMOTE = /远处|敌阵|敌方|敌军|敌人|对方|阵地|掩体后|战壕对面|对岸|空中|海面|天边|反斜面/;

/**
 * 只取「画面上正在发生的动作」—— 剥掉上一镜的连接词，并去掉引号里的台词。
 * 台词是**说出来的**，不是做出来的：「他说：开火！」不代表这个人举着枪。
 */
function visualOf(shot) {
  return stripLink(String(shot?.action || '').replace(/「[^」]*」/g, ''));
}

/** 本镜人物是否持械（判定顺序：明确持械 > 泛化开火且非他者发起） */
function holdsWeapon(shot) {
  const visual = visualOf(shot);
  if (HELD_STRONG.test(visual)) return true;
  if (!FIRING.test(visual)) return false;
  return !REMOTE.test(visual);
}
/** 跪 / 坐 / 靠 —— 与 "weapon up" 直接冲突，必须优先于持械判定 */
const REST_HINT = /跪|坐|靠|趴|蹲|倚|躺|撑着|跪在/;
/** 位移 —— 站定举枪也不对 */
const MOVE_HINT = /撤离|穿过|走|跑|奔|撤退|前进|推进|爬向|翻过/;
/**
 * 手部操作 —— 「把手按在放飞铃上」「在图上画出两条箭头」「指着图上那片空白」。
 * 这些镜头主体在**用双手做一件事**，举枪站立会把整镜带偏。
 */
const HANDS_HINT = /按在|画出|拍上|指着|指图|摊开|翻开|塞回|塞进|压在|标定|调试|拨动|抓起|放下|握着|举着|打开|合上/;

/**
 * 主体姿势必须由**本镜画面**决定，不能由 focus 写死，也不能被上一镜的连接词带偏。
 *
 * 6.7.5 在这里踩过一次：`firstBeat()` 调了 `stripLink()`，而 `poseFor()` 没有，
 * 于是 `LINK_BY_PREV` 的「枪响了，」被当成本镜持械证据 —— 那是上一镜的枪声。
 * 两个消费者必须用同一套输入。
 */
function poseFor(shot, base) {
  const t = visualOf(shot);
  if (REST_HINT.test(t)) return `${base}, seated or braced against a surface, slumped posture`;
  if (MOVE_HINT.test(t)) return `${base}, caught mid-stride, moving through frame`;
  if (holdsWeapon(shot)) return `${base}, weapon up`;
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
  // 台词与内部标记都不该进首帧的 Action context：前者是说出来的，
  // 后者（【DELTA】）可能被生图模型画成屏幕文字。
  const visual = stripLink(withoutDialogue(stripInternalMarkers(action)));
  // 连接词被剥掉后，原句可能以逗号开头
  const seg = visual.split(/[。；！？]/).map(s => s.trim()).filter(Boolean)[0] || '';
  const beat = seg.replace(/^[，,]\s*/, '').split(/[，,]/).map(s => s.trim()).filter(Boolean)[0] || seg;
  // **必须去掉尾部标点。** 末行 join('. ') 时会再拼一个句号，于是
  // 「在炮塔上摊开地图：」变成「在炮塔上摊开地图：.」—— 一个悬空冒号加句号，
  // 读起来是半句话（旧探针用 `[：:，,]$` 抓不到，因为它的正则只看到行尾）。
  return beat.replace(/[：:，,。；;\s]+$/, '');
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
