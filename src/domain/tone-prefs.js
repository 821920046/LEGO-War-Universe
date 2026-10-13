/**
 * 基调（tone）→ 视觉语言偏好（6.8.0 新增）。
 *
 * 一张**小而显式**的偏好表：每个基调点名它偏爱的机位 / 灯光 / 调色特征词。
 * 命中就给 +6 的加分 —— 刻意压在「光质冲突 −150」与「域命中 +100」之下，
 * 让基调只能做**同分或接近时的决胜**，不能把画面推向物理矛盾。
 */

const TONE_PREFS = {
  // 纪实：手持、自然光、纪录片调色。像 "restrepo / 地狱六月" 一类的一手素材。
  documentary: { camera: /handheld|shaky|documentary|observational|long lens|zoom/i, lighting: /natural|overcast|available|practical|daylight/i, grade: /documentary|desaturat|muted|bleach/i },
  // 史诗：宽画幅、大景别、金色时刻、饱和度高的宽调。
  epic: { camera: /anamorphic|wide|aerial|crane|sweeping|establishing|long shot/i, lighting: /golden|sunset|sunrise|epic|dusk|dawn|haze/i, grade: /epic|cinematic|warm|teal|orange|golden/i },
  // 惊悚：近景、夜、高对比、冷蓝。
  thriller: { camera: /close-?up|insert|macro|dolly|slow push|over-?the-?shoulder|handheld/i, lighting: /night|noir|hard|contrast|practical|red|blue/i, grade: /thriller|noir|contrast|blue|cold|cyan/i },
  // 冷峻写实：粗糙、阴天、低饱和、粗颗粒。
  gritty: { camera: /handheld|shaky|long lens|telephoto/i, lighting: /overcast|flat|grey|gray|diffuse|cloudy/i, grade: /gritty|desaturat|bleach|muted|grey|gray/i }
};

export function tonePrefs(tone) {
  return TONE_PREFS[String(tone || '')] || null;
}

/** 资产是否命中该基调的某个特征（按 kind 取对应正则） */
export function toneHit(asset, tone, kind) {
  const prefs = tonePrefs(tone);
  if (!prefs) return false;
  const re = prefs[kind];
  if (!re) return false;
  const text = `${asset?.name || ''} ${asset?.nameZh || ''} ${asset?.kw || ''} ${(asset?.lines || []).join(' ')}`;
  return re.test(text);
}
