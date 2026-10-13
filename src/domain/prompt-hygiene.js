/**
 * LEGO War Universe - 交付文本清洁（6.7.6）
 *
 * 编译产物里有两类**内部记号**不该出现在喂给视频模型的文本中：
 *
 *  1. `【代号】` —— 名册标签。`【DELTA】` / `【TANGO】` 是给人看的代号，
 *     写在 Action 与 Radio 行里，视频模型可能把它渲染成屏幕文字，
 *     而 negative prompt 恰恰写着 `no on-screen text, no subtitles` —— 自相矛盾。
 *     角色身份由 `Subject(s)` / `Cast` 两行承载，那里**必须保留**。
 *  2. `【无线电】` —— Radio dialogue 行本来就已经声明了 "spoken in Chinese"，
 *     再写一遍纯属冗余。
 *
 * 另外还有一类**不是台词的舞台提示**：`（静默）` / `（没有按下通话键）` /
 * `（全艇静默）`。narrative.js 的私密节拍把这些写进 `radioVoice` 字段，
 * 而编译器的判定只有「有文本就发射」—— 于是 prompt 里出现
 * `Radio dialogue (spoken in Chinese, playing over the action): 【无线电】（静默）`，
 * 等于命令 Veo 把「静默」两个字念出声。实测 78/312 镜（25%）如此。
 */

/** 剥掉【…】形式的内部标记（人名代号、【无线电】等） */
export function stripInternalMarkers(text) {
  return String(text || '').replace(/【[^】]*】/g, '');
}

/**
 * 把内部标记**转写**成安全形式，而不是一刀删掉。
 *
 *   - `【DELTA】伊万诺夫在炮塔上摊开地图` → `伊万诺夫（DELTA）在炮塔上摊开地图`
 *     中文书名号是「可能被视频模型渲染成屏幕文字」的记号，而圆括号不会。
 *     同时**保留了「这个人在名册里是谁」**：`Cast` 行把 `DELTA ↔ CHR-106` 绑在一起，
 *     删掉标记就等于让 Action 里的人物名和 Subject(s) 里的资产断了联系。
 *   - `【无线电】全车注意` → `全车注意`
 *     中文标签是内部记号；这一行本来就写着 "spoken in Chinese"，再标一遍纯属冗余。
 */
export function rewriteInternalMarkers(text) {
  return String(text || '').replace(/【([^】]+)】/g, (_m, inner) => {
    if (/^[\u4e00-\u9fa5]+$/.test(inner)) return '';
    return `（${inner}）`;
  });
}

/** 去掉引号内的台词，只留画面上正在发生的动作（台词是说出来的，不是做出来的） */
export function withoutDialogue(text) {
  return String(text || '').replace(/「[^」]*」/g, '');
}

/**
 * 一条 radioVoice 里真正「会被念出来」的部分。
 * 剥掉内部标记、舞台提示与全部标点后为空 → 这条不是台词。
 */
export function spokenPart(text) {
  return stripInternalMarkers(String(text || ''))
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[\s。，、！？：:；…·—\-「」『』“”"']/g, '');
}

/** 整条只有舞台提示（没有任何一句被说出口的话）→ 不应发射 Radio dialogue 行 */
export function hasSpokenDialogue(text) {
  return spokenPart(text).length > 0;
}
