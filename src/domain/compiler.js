/**
 * LEGO War Universe - 提示词编译器（含连续性锚点注入）
 */
import { validateShotSpec } from './shot-spec.js';
import { sizeForShot, framingInstruction } from './visual-language.js';
import { rewriteInternalMarkers, hasSpokenDialogue } from './prompt-hygiene.js';

/**
 * 编译单镜头为 Google Flow (Veo) 可用的提示词字符串
 *
 * 角色代号（callsign）会被写进 Subject(s) 行：这是「角色名字必须出现在视频脚本中」
 * 的落地点 —— 喂给视频模型的就是这段文本，代号必须真的在里面，而不只是 UI 装饰。
 *
 * @param {object} s 镜头规范对象（应携带连续性状态）
 * @param {object} r 资产注册表
 * @param {object} p 模型配置（profile）
 * @param {object|null} [roster] 角色名册（可选；缺省时退化为纯资产描述，行为向后兼容）
 * @returns {{ prompt: string, promptZh: string }}
 */
export function compileShot(s, r, p, roster = null) {
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

  // 时长优先取镜头自带值（叙事层按戏剧功能给了快切/长镜的节奏差），
  // 但必须落在模型 profile 真正支持的档位里，否则回退到 8s / 首个档位。
  const supported = Array.isArray(p.durations) ? p.durations : [];
  const duration = supported.includes(s.duration)
    ? s.duration
    : (supported.includes(8) ? 8 : supported[0]);
  const aspectRatio = s.aspectRatio || p.selectedAspectRatio || p.aspectRatios[0];

  // 连续性锚点（屏幕方向、损伤状态、参考帧）
  const screenDir = s.screenDirection || s.continuityIn?.screenDirection || 'neutral';
  const damageState = s.damageState || s.continuityOut?.damageState || 'weathered';
  const variant = s.variant || s.continuityOut?.variant || 'standard';
  const refFrame = s.referenceFrame || s.continuityIn?.referenceFrame || null;

  // 声音：Veo 3 带音频生成，这两个字段是分镜里写好的音效与无线电对白。
  // 内部标记转写成安全形式（见 prompt-hygiene.js）。
  const audioCue = rewriteInternalMarkers(String(s.audioCue || '')).trim();
  const radioVoice = rewriteInternalMarkers(String(s.radioVoice || '')).trim();
  //
  // **整条只有舞台提示时，Radio dialogue 行整行不发。**
  // `narrative.js` 的私密节拍把「（静默）」「（没有按下通话键）」「（全艇静默）」写进了
  // `radioVoice` 字段，而本行的语义是 "spoken in Chinese, playing over the action" ——
  // 不拦的话，等于命令 Veo 把「静默」两个字念出声。实测 78/312 镜（25%）如此。
  // 设计本意是「这一镜没有无线电通讯」，编译器的正确表达是**不发这一行**。
  const radioLine = hasSpokenDialogue(radioVoice)
    ? `Radio dialogue (spoken in Chinese, playing over the action): ${radioVoice}`
    : null;
  //
  // **【代号】转写成圆括号。** `【DELTA】` 是名册标签，中文书名号可能被视频模型
  // 渲染成屏幕文字 —— 而 negative prompt 恰恰写着 `no on-screen text`，自相矛盾。
  // 但不能直接删：`Cast` 行绑定了 `DELTA ↔ CHR-106`，删掉标记会让 Action 里的
  // 人物名与 Subject(s) 里的资产断了联系。所以改成 `（DELTA）`：既净，又留住归属。
  const actionText = rewriteInternalMarkers(s.action).trim();
  //
  // **景别必须发射（6.7.6）。** `shotType` 此前被 image-compiler 消费，
  // 而**视频编译器对它的引用数为 0** —— 分镜设计好的景别（特写 / 中景 / 大远景）
  // 只进了首帧图，从未进视频 prompt。实测仅 34% 镜头靠机位资产碰巧捎带景别词，
  // 其余 66% 把画面构图完全交给 Veo 决定。
  const framing = framingInstruction(sizeForShot(s.shotType, s.fn));

  const continuityLine = [
    `Screen direction: ${screenDir}.`,
    `Subject state: ${damageState} / ${variant}.`,
    refFrame ? `Continuity anchor: match visual appearance from [${refFrame}].` : null
  ].filter(Boolean).join(' ');

  const subjectLines = s.subjects
    .map(id => {
      const asset = get(id);
      const entry = roster?.byId?.get(id);
      // 代号 + 中英名 + 技术描述：既满足「脚本里出现角色名」，又不丢真实资产细节
      const head = entry
        ? `[${id}] 【${entry.callsign}】${entry.name}${asset.name && asset.name !== entry.name ? ` / ${asset.name}` : ''}`
        : `[${id}]${asset.nameZh ? ` ${asset.nameZh}` : ''}`;
      return `${head} — ${(asset.lines || []).join(', ')}`;
    })
    .join('; ');

  const castLine = roster && roster.all && roster.all.length
    ? `Cast (must keep identical appearance across all shots): ${roster.all
      .filter(e => s.subjects.includes(e.id))
      .map(e => `【${e.callsign}】${e.name} (${e.id})`)
      .join('; ')}.`
    : null;

  const lines = [
    ...(r.styleBlock.lines || []),
    '',
    `Scene: ${(env.lines || []).join(', ')}.`,
    `Subject(s): ${subjectLines}.`,
    castLine,
    `Action: ${actionText}`,
    '',
    // 声音。Veo 3 是**带音频生成**的模型，而此前编译出来的 prompt 里
    // 一个声音字都没有 —— `audioCue` 与 `radioVoice` 在 180/180 个镜头里都有内容，
    // 却全部被丢掉。等于把一半的创作能力留在库里没用。
    audioCue ? `Sound design (diegetic only, no music score): ${audioCue}.` : null,
    radioLine, '',
    // 景别与运镜分开声明：前者是「这台机器拍出来有多大」，后者是「它怎么动」。
    // 二者此前各说各话 —— 远景建镜头拿到「tight insert close-up on hands」，
    // 74 镜双侧可判景别的镜头里 46 镜（62%）互相矛盾（6.7.6）。
    framing ? `Shot framing: ${framing}.` : null,
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
