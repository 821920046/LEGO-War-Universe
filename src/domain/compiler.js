/**
 * LEGO War Universe - 提示词编译器（含连续性锚点注入）
 */
import { validateShotSpec } from './shot-spec.js';

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
  const audioCue = String(s.audioCue || '').trim();
  const radioVoice = String(s.radioVoice || '').trim();

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
    `Action: ${s.action}`,
    '',
    // 声音。Veo 3 是**带音频生成**的模型，而此前编译出来的 prompt 里
    // 一个声音字都没有 —— `audioCue` 与 `radioVoice` 在 180/180 个镜头里都有内容，
    // 却全部被丢掉。等于把一半的创作能力留在库里没用。
    audioCue ? `Sound design (diegetic only, no music score): ${audioCue}.` : null,
    radioVoice ? `Radio dialogue (spoken in Chinese, playing over the action): ${radioVoice}` : null,    '',
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
