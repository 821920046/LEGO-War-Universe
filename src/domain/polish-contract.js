/**
 * LEGO War Universe - 本地打底 + AI 润色契约（6.9.0）
 *
 * **为什么需要这份契约**
 *
 * 6.9.0 之前，云端 AI 与本地引擎是「二选一」的关系：AI 可用时整部分镜由模型
 * 自由生成（结构也归它），AI 不可用时才整部落回本地。两个后果：
 *   1. 模型的幻觉面覆盖**整部电影** —— 资产 ID 会编、导演会编、结构会塌
 *      （6.8.8/6.8.9 治的两类幻觉都源于此）；
 *   2. 模型过载时（线上实测 503 风暴：三个 Gemini 候选全挂，0.4s–27s），
 *      用户每次都要白等几十秒才拿到本来毫秒级就能给出的本地基底。
 *
 * 本契约把两者的位置摆正：
 *   · **结构永远来自本地基底**（资产 ID / 机位 / 节拍 / 戏剧功能 / 连续性 /
 *     角色代号）—— 由确定性规划器产出，已过 validateShotSpec 与代号纪律；
 *   · **AI 只能改写三个文本字段**：action / audioCue / radioVoice。
 *     模型的创造力全部释放在「这句话怎么写才有电影感」，而不是「这一镜用什么资产」。
 *
 * 于是幻觉面从「整部电影」收缩到「三句文案」，而合并层（mergePolish）再用
 * 代号守卫与字段白名单把最后这点面也焊死：AI 输出里任何不在白名单里的东西
 * （包括它自创的镜头、自创的资产 ID、自创的代号）都进不了最终分镜。
 *
 * 这个模块是纯函数、零网络依赖，前端（自由模式就地润色）与后台
 * （/api/ai-brain 转译润色）共用同一份实现 —— 两份实现必然漂移，一份不会。
 */

/** AI 唯一被允许改写的字段。结构字段（subjects/phase/fn/shotId/…）一律不在此列。 */
export const POLISHABLE_FIELDS = ['action', 'audioCue', 'radioVoice'];

/**
 * 单字段长度上限。
 *
 * 为什么需要：润色提示词鼓励「更生动」，而模型对「生动」的理解偶尔是
 * 「写一篇小作文」。action 是要进时间线卡片、CSV、编译 Prompt 的字段，
 * 无上限增长会直接冲击前端存储配额（localStorage 5MB）与渲染性能。
 * 600 字符约为本地基底 action 的 8–10 倍，足够任何正常润色，又拦得住小作文。
 * 超限不是截断（截断会留下半句话），是**整字段保留基底**并如实记录原因。
 */
export const POLISH_FIELD_MAX_CHARS = 600;

/**
 * 台词里的【代号】正则。
 *
 * 与 tests/script-callsign.test.mjs 的口径保持一致（同一份契约的两个消费者）：
 * 名册里的每一个代号都必须以【全大写】形态出现在台词中，且**不得出现名册外
 * 的代号** —— 否则「脚本里的称呼」与「定妆表」会漂移。
 */
const CALLSIGN_RE = /【([A-Z][A-Z0-9-]{1,15})】/g;

/** 抽出一段文本里出现的所有【代号】 */
export function callsignsInText(text) {
  const out = [];
  const re = new RegExp(CALLSIGN_RE.source, 'g');
  let m;
  while ((m = re.exec(String(text == null ? '' : text))) !== null) out.push(m[1]);
  return out;
}

/**
 * 从名册（JSON 形态，即 plan.roster）抽出允许出现的代号集合。
 * 名册为空 / 不是数组时返回 null —— 调用方据此知道「这次没有代号守卫可用」。
 */
export function callsignSetOfRoster(roster) {
  if (!Array.isArray(roster) || !roster.length) return null;
  const set = new Set();
  for (const entry of roster) {
    const cs = entry && typeof entry.callsign === 'string' ? entry.callsign.trim() : '';
    if (cs) set.add(cs);
  }
  return set.size ? set : null;
}

/**
 * 把基底分镜压缩成「给模型看的素材」。
 *
 * 只带润色真正需要的上下文：这一镜是什么节拍、什么戏剧功能、用什么资产、
 * 现在写的是什么。结构字段一个不少地给（模型必须知道自己在润色哪一镜），
 * 但不给 continuIn/Out / story / referenceFrame 这类与文案无关的噪声。
 */
export function baseMaterialForPrompt(shots) {
  return (Array.isArray(shots) ? shots : []).map((s, i) => ({
    shotId: s?.shotId || `shot_${i + 1}`,
    phase: s?.phase || null,
    fn: s?.fn || null,
    shotType: s?.shotType || null,
    subjects: Array.isArray(s?.subjects) ? s.subjects : [],
    environment: s?.environment || null,
    action: s?.action || '',
    audioCue: s?.audioCue || '',
    radioVoice: s?.radioVoice || ''
  }));
}

/**
 * 润色模式的 system prompt。
 *
 * 与 6.8.9 的「最高优先级零：真实性与署名纪律」是同一份纪律的改写：
 * 反幻觉条款一条不少（ recognized 口径 / 只准真实导演 / 致敬只许风格化），
 * 因为**润色模式同样会产生 matchedMovie / director 字段**（非策展基底时）。
 *
 * @param {object} o
 * @param {string} o.catalogText  真实资产清单（格式：ID=名称(时代)）
 * @param {string} o.era          时代判定
 * @param {string} o.castText     固定阵容 + 代号（策展/规划器已冻结）
 * @param {boolean} o.recognize   false = 不询问影片元数据（策展复刻 / 自由模式均为此）
 */
export function buildPolishSystemPrompt({ catalogText = '', era = '', castText = '', recognize = true }) {
  const recognitionBlock = recognize ? `
【识别判定】
· 若用户的输入是你**确切知道**的真实影片 → "recognized": true，并给出该片真实的
  matchedMovie（中文全名 + 英文原名）/ director（**该片真实导演**）/ year / genre。
· 若不是你确知的真实影片（查无此片、片名陌生、明显是用户自编的题材）→
  "recognized": false，且 matchedMovie / director / year / genre 一律给空字符串 ""。
  绝不允许现编，更绝不允许把用户自编的题材挂到任何真实在世导演名下 ——
  2026-10-16 线上实测到该行为（自编片名「热带雨林狙击手生死对决」被说成
  丹尼斯·维伦纽瓦的作品），属于必须根除的幻觉。
· director 只允许填**真实影片的真实导演**（事实陈述，如《狂怒》→ 大卫·阿耶）。
  本片的原创立意（originality）不得挂到任何导演名下；致敬意向只写在 homageNote 里，
  用「诺兰式实拍质感」这类风格化表述，绝不允许写成导演署名。` : `
【不需要识别影片】
本次基底来自系统内置的确定性引擎（策展复刻或本地原创），影片元数据由系统另行提供。
你**不要**输出 recognized / matchedMovie / director / year / genre 字段，也不要提任何导演姓名。`;

  return `你是好莱坞顶级电影摄影指导与微缩定格动画导演（擅长诺兰、雷德利·斯科特、丹尼斯·维伦纽瓦的视听语言，精通乐高微缩定格美学）。

【你的任务：润色，不是重写】
系统已经用确定性本地引擎产出了一份**分镜基底**：镜头数量与顺序、每一镜的节拍
（phase）、戏剧功能（fn）、景别、资产 ID、机位、灯光、调色、连续性、角色代号
**全部已经锁定并经过校验**。你的任务不是重新设计这部电影，而是把每一镜的
三句文案（action / audioCue / radioVoice）润色到「可以直接拿去拍」的完成度。

【润色纪律（最高优先级，先于以下所有规则）】
· **结构冻结**：禁止增删镜头、禁止改顺序、禁止改 shotId、禁止改 phase/fn/shotType、
  禁止改任何资产 ID。你的输出必须与基底**一镜一条、shotId 逐字一致**。
· **只输出三个文本字段**：action（这一镜发生的动作，乐高微缩质感：塑料咬合、
  微距景深、特技烟雾、积木物理）/ audioCue（环境音与音乐）/ radioVoice（台词/无线电）。
· **角色称呼沿用基底里的【代号】**：绝不允许发明新代号，绝不允许改用真实人名，
  绝不允许给角色另起外号。基底里没出现的代号，你一个都不许写。
· **时代与装备必须与基底一致**：基底是二战就不出现现代装备，是现代就不出现
  二战武器。资产细节必须与基底给出的资产清单对得上。
· **每镜 action 必须彼此明显不同**：主体、机位、动作、环境互动都要变化，
  严禁把同一句话复制到多个镜头，严禁只改几个字充数。
· **不开枪的镜头要敢写**：观察、等待、静默、一个反应特写，往往比又一场交火更有力量。
· 保持戏剧功能：基底标注 fn 的镜头（如 goal / reveal / cost / quiet）必须让台词与
  动作**服务这个功能**，不要把人物时刻写成对轰。
· 不写血腥细节、不写政治敏感内容、不写真实在世人物姓名（系统会整批拦截）。

【最高优先级零：真实性与署名纪律】
${recognitionBlock}

【原创性】
参考内容只贡献**视听语言与戏剧母题**，绝不贡献情节。你必须给出独立立意：
- originality.logline：一句话立意（谁、在哪、要做什么、赌注是什么）
- originality.twist：一个能翻转局势的转折（例如情报是诱饵、撤离窗口提前关闭、
  通讯已被敌方接管、敌方指挥官是主角的教官）
- originality.hook：前 3 秒抓人的开场钩子
- originality.homageNote：说明本片在视听语言上致敬了谁（风格化表述，绝不写成导演署名）
禁止复述任何原作的经典桥段；允许在视听语法上致敬，但情节必须自己长出来。

【输出格式】
严格输出合法 JSON，不要任何开场白或解释：
{
  "shots": [
    { "shotId": "shot_1", "action": "…", "audioCue": "…", "radioVoice": "…" }
  ]${recognize ? `,
  "recognized": true,
  "matchedMovie": "", "director": "", "year": "", "genre": "",
  "dramaticConflict": "一句话核心危机",
  "visualGrammar": { "cameraMotion": "…", "lightingTone": "…", "soundDesign": "…" },
  "legoAdaptation": "乐高微缩还原建议",
  "creatorTips": "给自媒体创作者的实战拉片教学"` : ''}
}

【本片时代判定】${era || '未明确（默认 Modern 现代）'}
${castText}
【可用真实资产清单】（润色时描写的装备必须与这些 ID 对得上；名单是参考，你的输出里**不要**出现资产 ID 字段）
${catalogText || '（资产库目录为空）'}`;
}

/**
 * 润色模式的 user prompt：把基底素材原样交给模型。
 *
 * 基底以 JSON 呈现（含 shotId / phase / fn / 资产 / 当前文案），模型要做的
 * 就是「照着一镜一条回三句更好的」。
 */
export function buildPolishUserPrompt({ query, requestedShots, baseShots, recognize = true }) {
  const material = JSON.stringify(baseMaterialForPrompt(baseShots));
  const recognition = recognize
    ? `\n【识别判定】若「${query}」不是你确切知道的真实电影，"recognized" 必须为 false 且 matchedMovie / director / year / genre 全部留空字符串 ""；只有确知真实影片时才允许 recognized: true 并给出该片真实元数据。`
    : '';
  return `请润色以下分镜基底的每一镜文案。共 ${requestedShots} 镜，必须一镜一条、shotId 与基底逐字一致，只改 action / audioCue / radioVoice 三个字段。
用户输入：${query}

【分镜基底（结构已锁定，供润色）】
${material}

要求：${requestedShots} 镜的 action 必须各不相同；角色一律用基底里的【代号】称呼；装备与时代必须与基底的资产清单一致；台词要短、像人说出来的话。${recognition}`;
}

/**
 * 把 AI 的润色结果合并进基底分镜。
 *
 * 这是整个契约的**安全核心**，四条不变式：
 *   1. 结构永不由 AI 提供 —— 合并用展开基底对象再覆盖三个文本字段的方式实现，
 *      AI 响应里除白名单外的任何字段（包括它自创的 subjects / phase / fn）被静默丢弃；
 *   2. 未提供 / 空白的字段保留基底原文 —— 「润色失败一镜」绝不等于「这一镜没了」；
 *   3. 代号守卫 —— 润色文本里出现名册外的【代号】即整字段拒绝（防名册漂移）；
 *   4. 一切拒绝都记账 —— merged / kept / rejected 是响应体里如实可见的统计，
 *      不是内部日志。静默吞掉拒绝就等于把「AI 没润成」显示成「润色成功」。
 *
 * @param {Array} baseShots 基底分镜（结构字段齐全）
 * @param {object} aiResult AI 解析后的 JSON
 * @param {{ allowedCallsigns?: Set<string>|null }} [opts]
 * @returns {{ shots: Array, merged: number, kept: number, applied: object, rejected: Array, callsignGuard: boolean }}
 */
export function mergePolish(baseShots, aiResult, opts = {}) {
  const base = Array.isArray(baseShots) ? baseShots : [];
  const allowedCallsigns = opts.allowedCallsigns instanceof Set ? opts.allowedCallsigns : null;
  const rejected = [];
  const applied = { action: 0, audioCue: 0, radioVoice: 0 };

  if (!base.length) {
    return { shots: base, merged: 0, kept: 0, applied, rejected: [{ reason: 'NO_BASE' }], callsignGuard: Boolean(allowedCallsigns) };
  }

  const aiShots = Array.isArray(aiResult?.shots) ? aiResult.shots : [];
  if (!aiShots.length) {
    return { shots: base, merged: 0, kept: base.length, applied, rejected: [{ reason: 'NO_AI_SHOTS' }], callsignGuard: Boolean(allowedCallsigns) };
  }

  // 基底索引：shotId → 下标。没有 shotId 的基底镜头按位置兜底
  // （规划器一定给 shotId，这里是给手写/外部基底留的兼容）。
  const byId = new Map();
  base.forEach((s, i) => {
    const id = s && typeof s.shotId === 'string' && s.shotId.trim() ? s.shotId.trim() : null;
    if (id && !byId.has(id)) byId.set(id, i);
  });

  // 合并结果以「基底对象副本」为单位，逐镜记录这一镜有没有被改动过
  const mergedShots = base.map(s => ({ ...s }));
  const touched = new Array(base.length).fill(false);
  const usedIndex = new Set();
  /** 已被显式 shotId 消耗掉的 AI 条目（避免同一镜被位置落地重复处理） */
  const consumed = new Set();

  const describe = (index) => mergedShots[index].shotId || `#${index + 1}`;

  /** 把一条 AI 润色条目合并进第 index 镜（只碰三个白名单字段） */
  const mergeInto = (index, aiShot) => {
    usedIndex.add(index);
    for (const field of POLISHABLE_FIELDS) {
      const value = aiShot[field];
      if (value === undefined || value === null) continue; // 没提这个字段：保留基底，不算拒绝
      if (typeof value !== 'string') {
        rejected.push({ shotId: describe(index), field, reason: 'NOT_A_STRING' });
        continue;
      }
      const text = value.trim();
      if (!text) continue; // 空串视为没提供
      if (text.length > POLISH_FIELD_MAX_CHARS) {
        rejected.push({ shotId: describe(index), field, reason: `TOO_LONG(${text.length}>${POLISH_FIELD_MAX_CHARS})` });
        continue;
      }
      if (allowedCallsigns) {
        const unknown = callsignsInText(text).filter(cs => !allowedCallsigns.has(cs));
        if (unknown.length) {
          rejected.push({ shotId: describe(index), field, reason: `UNKNOWN_CALLSIGN(${unknown.join(',')})` });
          continue;
        }
      }
      mergedShots[index] = { ...mergedShots[index], [field]: text };
      touched[index] = true;
      applied[field] += 1;
    }
  };

  // 第一趟：显式 shotId 匹配（id 对不上基底 = 模型自创镜头，记账后丢弃）
  for (const aiShot of aiShots) {
    if (!aiShot || typeof aiShot !== 'object' || Array.isArray(aiShot)) {
      rejected.push({ shotId: null, field: null, reason: 'NOT_AN_OBJECT' });
      consumed.add(aiShot);
      continue;
    }
    const aiId = typeof aiShot.shotId === 'string' && aiShot.shotId.trim() ? aiShot.shotId.trim() : null;
    if (!aiId) continue; // 没有 shotId 的留给第二趟按位置落地
    consumed.add(aiShot);
    if (byId.has(aiId) && !usedIndex.has(byId.get(aiId))) {
      mergeInto(byId.get(aiId), aiShot);
    } else {
      rejected.push({ shotId: aiId, field: null, reason: 'UNMATCHED_SHOT' });
    }
  }

  // 第二趟：**整数组都不带 shotId** 时，才允许按位置落地。
  //
  // 为什么不允许「混合数组里按位置猜」：如果模型有的条目带 ID、有的不带，
  // 说明它已经不按「一镜一条」的约走了 —— 此时把第 2 个无 ID 条目落到第 2 镜，
  // 可能把 B 镜的文案贴到 A 镜上（文本错镜，比不润色更糟）。宁可记账拒绝、
  // 保留基底原文，也不猜。位置落地只在「模型 uniformly 省略 ID」时启用，
  // 那种情况下数组顺序是唯一可信的对应关系。
  const anyExplicitId = aiShots.some(s => s && typeof s === 'object' && typeof s.shotId === 'string' && s.shotId.trim());
  if (!anyExplicitId) {
    aiShots.forEach((aiShot, pos) => {
      if (consumed.has(aiShot)) return;
      if (!aiShot || typeof aiShot !== 'object' || Array.isArray(aiShot)) return; // 第一趟已记账
      if (pos < base.length && !usedIndex.has(pos)) {
        mergeInto(pos, aiShot);
      } else {
        rejected.push({ shotId: null, field: null, reason: 'UNMATCHED_SHOT' });
      }
    });
  } else {
    for (const aiShot of aiShots) {
      if (consumed.has(aiShot)) continue;
      if (!aiShot || typeof aiShot !== 'object' || Array.isArray(aiShot)) continue; // 第一趟已记账
      rejected.push({ shotId: null, field: null, reason: 'UNMATCHED_SHOT' });
    }
  }

  const merged = touched.filter(Boolean).length;
  return {
    shots: mergedShots,
    merged,
    kept: base.length - merged,
    applied,
    rejected,
    callsignGuard: Boolean(allowedCallsigns)
  };
}
