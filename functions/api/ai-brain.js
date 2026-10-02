/**
 * LEGO War Universe - 后台免费大模型统一调度中枢 (/api/ai-brain)
 * 功能：
 * 1. 后端集中托管 Groq / OpenRouter / Gemini 等免费大模型 API Key，前端免配置开箱即用
 * 2. 具备多通道自动故障转移 (Failover Engine)：Groq -> OpenRouter -> Gemini -> 本地离线引擎
 * 3. 严格审计与速率限制保护
 */

import { transpileMovieToLego } from '../../src/domain/cinema-homage.js';
import { alignShotsToLego } from '../../src/domain/lego-aligner.js';
import { checkContentGovernance } from '../../src/domain/governance.js';
import { parseIntent } from '../../src/domain/intent.js';
import { hasHostileFraming } from '../../src/domain/shot-spec.js';
import { buildAssetCatalog, formatCatalogForPrompt, collectValidIds, resolveShotAssets } from '../../src/domain/asset-catalog.js';
import { assets as ASSET_REGISTRY } from '../../src/domain/assets-data.js';
import { createRegistry } from '../../src/domain/registry.js';
import { selectCast, buildRoster, rosterToJSON, rosterPromptLines } from '../../src/domain/roster.js';
import { diversifyShots } from '../../src/domain/narrative.js';

/**
 * 后端侧的资产注册表。
 *
 * 存在的意义：后台必须和前端用**同一套算法**从资产库里挑演员并分配代号，
 * 否则「大模型脚本里的角色」与「前端定妆表里的角色」会对不上。
 * 这里只依赖 byId / byKind，因此用一个占位 profile 即可。
 */
const REGISTRY = (() => {
  try {
    return createRegistry(ASSET_REGISTRY, { profiles: [{ id: '__backend__', durations: [8], aspectRatios: ['9:16'] }] });
  } catch (err) {
    console.warn('后端资产注册表构建失败，将退化为无阵容模式:', err?.message);
    return null;
  }
})();

// 简易限流配置
// 注意：Cloudflare Workers 的模块级 Map 只在单个 isolate 内有效，且随时可能被回收，
// 因此这里只是「尽力而为」的单点保护，不能当作严格的配额系统。
// 更重要的是必须定期清理过期条目：早期实现只增不删，任何访问过的 IP 都会永久驻留，
// 构成明确的内存泄漏 / 内存耗尽型 DoS 面。
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const RATE_LIMIT_MAX_TRACKED = 5000;
let lastSweep = 0;

function sweepExpired(now) {
  for (const [key, record] of rateLimits) {
    if (now - record.windowStart > RATE_LIMIT_WINDOW_MS) rateLimits.delete(key);
  }
  lastSweep = now;
}

function checkRateLimit(clientId) {
  const now = Date.now();

  // 周期性清理 + 容量硬上限，双重保证 Map 不会无界增长
  if (now - lastSweep > RATE_LIMIT_WINDOW_MS) sweepExpired(now);
  if (rateLimits.size > RATE_LIMIT_MAX_TRACKED) sweepExpired(now);
  if (rateLimits.size > RATE_LIMIT_MAX_TRACKED) {
    // 极端情况下（全部条目都在窗口内）丢弃最早写入的一批，保住 isolate 内存
    const overflow = rateLimits.size - RATE_LIMIT_MAX_TRACKED;
    let dropped = 0;
    for (const key of rateLimits.keys()) {
      if (dropped++ >= overflow) break;
      rateLimits.delete(key);
    }
  }

  let record = rateLimits.get(clientId);
  if (!record || (now - record.windowStart) > RATE_LIMIT_WINDOW_MS) {
    record = { count: 0, windowStart: now };
  }
  record.count++;
  rateLimits.set(clientId, record);

  if (record.count > RATE_LIMIT_MAX) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - record.windowStart);
    return { limited: true, retryAfterMs };
  }
  return { limited: false };
}

const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  }
});

function cors(request, env = {}) {
  const origin = request.headers.get('origin');
  const expected = env.ALLOWED_ORIGIN;
  // Same-origin requests need no CORS header. Cross-origin callers are allowed only
  // when they exactly match the configured deployment origin; never fall back to '*'.
  if (origin && expected && origin === expected) {
    return { 'access-control-allow-origin': origin, 'vary': 'Origin' };
  }
  return {};
}

function governResponse(responseBody, inputGovernance) {
  const outputGovernance = checkContentGovernance(JSON.stringify(responseBody));
  if (outputGovernance.status === 'blocked') {
    return {
      status: 502,
      body: {
        error: 'GENERATED_CONTENT_BLOCKED',
        flags: outputGovernance.flags,
        reasons: outputGovernance.reasons
      }
    };
  }

  const flags = [...new Set([
    ...(inputGovernance.flags || []),
    ...(outputGovernance.flags || [])
  ])];
  const reasons = [...new Set([
    ...(inputGovernance.reasons || []),
    ...(outputGovernance.reasons || [])
  ])];
  const reviewRequired = inputGovernance.status === 'review_required' || outputGovernance.status === 'review_required';
  responseBody.governance = { status: reviewRequired ? 'review_required' : 'passed', flags, reasons };
  if (reviewRequired) {
    responseBody.reviewRequired = true;
    responseBody.flags = flags;
    responseBody.reasons = reasons;
  }
  return { status: 200, body: responseBody };
}

const DIRECTOR_SYSTEM_PROMPT_HEADER = `你是一位好莱坞顶级电影摄影指导与微缩定格动画导演（擅长诺兰、雷德利·斯科特、丹尼斯·维伦纽瓦的视听语言，精通乐高定格微缩物理美学）。
用户的输入可能是一部电影名称（如《长津湖》《阿凡达》《星际穿越》《狂怒》《黑客帝国》等），或者任意战术/科幻创意大纲。
你的任务是将该内容深度解构并转译为一部乐高微缩定格大片分镜剧本。

【最高优先级一：必须使用真实资产 ID】
下方是 LEGO War Universe 资产库中与本片题材最相关的真实资产清单（格式：ID=名称(时代)）。
每一个镜头都必须从清单中挑选真实存在的 ID 填入 assets 字段，严禁编造清单以外的 ID。
- subjects：1–3 个角色或载具 ID（从【角色人仔】【载具】里选）
- environment / camera / lighting / colorGrade：各 1 个对应分组的 ID
- fx / audio：各 0–3 / 0–2 个 ID（可选）
如果题材所需的现代/未来战争装备在清单中确实不存在，请照常发挥想象力描写动作，并在顶层 proposedAssets 数组里给出建议新增的资产（含 name / nameZh / group / lines），但镜头里仍必须使用清单内最接近的真实 ID 兜底。

【最高优先级二：原创性，不许照着原作抄】
参考片只贡献**视听语言与戏剧母题**，绝不贡献情节。你必须给出独立于原作的立意：
- originality.logline：一句话立意（谁、在哪、要做什么、赌注是什么）
- originality.twist：一个能翻转局势的转折（例如情报是诱饵、撤离窗口提前关闭、通讯已被敌方接管、敌方指挥官是主角的教官）
- originality.hook：前 3 秒抓人的开场钩子
禁止复述原作的经典桥段；允许在视听语法上致敬，但情节必须自己长出来。

【最高优先级三：禁止复读】
每个镜头的 action 必须**彼此明显不同**：主体、机位、动作、环境互动都要变化。
严禁把同一句话复制到多个镜头，严禁只改几个字充数。系统会对重复文本做去重惩罚。

【最高优先级四：敌对双方都要出场】
若下方【本片固定阵容】中存在对立阵营角色，则至少有两个镜头必须让敌方实际出场并产生对抗；
同时，每个镜头的 subjects 必须与 action 里实际描写的角色保持一致，不得出现「写的是敌人、填的是友军」。

【角色代号纪律】
阵容里给出的代号是该角色在全片的唯一身份，action / radioVoice 中必须用【代号】称呼角色，
且同一角色全片同名，绝不换称呼。镜头间保持同一套外观与损伤状态。

你必须严格以合法的 JSON 格式输出，不要包含任何多余的开场白或解释。JSON 结构必须符合以下格式：
{
  "matchedMovie": "电影中文全名 (英文原名)",
  "director": "导演姓名",
  "year": "上映年份",
  "genre": "电影流派题材",
  "dramaticConflict": "一句话核心危机与戏剧生死矛盾",
  "visualGrammar": {
    "cameraMotion": "标志性摄影机运动与景别法则",
    "lightingTone": "色彩影调与明暗反差设计",
    "soundDesign": "声音设计与配乐灵魂"
  },
  "legoAdaptation": "如何用乐高微缩积木、微距景深、特技烟雾与真实塑料材质进行定格微缩还原的专业建议",
  "creatorTips": "给自媒体创作者提升前3秒完播率与声画对齐的实战拉片教学秘籍",
  "originality": {
    "logline": "独立原创的一句话立意",
    "twist": "能翻转局势的原创转折",
    "hook": "前3秒开场钩子",
    "homageNote": "说明本片在视听语言上致敬了谁，但情节为独立原创"
  },
  "proposedAssets": [],
  "shots": [
    {
      "phase": "establish",
      "shotType": "景别类型（如：超低空掠地全景 / 驾驶舱微型特写）",
      "action": "详细的乐高微缩动作描述，必须指明乐高人仔、载具、建筑积木细节，并用【代号】称呼角色",
      "screenDirection": "towards-camera",
      "damageState": "clean",
      "audioCue": "环境音效与伴随音乐描述",
      "radioVoice": "【台词/无线电】核心角色对白或战术呼叫",
      "assets": {
        "subjects": ["CHR-401"],
        "environment": "ENV-001",
        "camera": "CAM-001",
        "lighting": "LGT-001",
        "colorGrade": "CLR-001",
        "fx": [],
        "audio": []
      }
    }
  ]
}`;

function buildDirectorSystemPrompt(catalogText, era, castText = '') {
  return `${DIRECTOR_SYSTEM_PROMPT_HEADER}

【本片时代判定】${era || '未明确（默认 Modern 现代）'}
${castText}
【可用真实资产清单】
${catalogText || '（资产库目录为空，请使用 CHR-401 / ENV-001 / CAM-001 / LGT-001 / CLR-001 作为兜底）'}`;
}

/** 把确定性阵容渲染成 Prompt 片段（真实资产 + 固定代号） */
function buildCastSection(castRoster) {
  const lines = castRoster ? rosterPromptLines(castRoster) : [];
  if (!lines.length) return '';
  return `
【本片固定阵容（由系统从资产库确定性挑选，代号全片固定）】
${lines.join('\n')}
`;
}

function buildUserPrompt(query, requestedShots) {
  return `请深度解构并转译：${query}。输出正好 ${requestedShots} 个镜头的完整分镜（四阶段叙事：铺垫 establish -> 展开 build -> 决战 climax -> 尾声 resolve）。每个镜头的 assets 字段必须使用上方清单中的真实 ID。若上方【本片固定阵容】给了代号，请在 action 与 radioVoice 中始终用【代号】称呼角色，并确保 ${requestedShots} 个镜头的 action 描述各不相同。`;
}

/** 判定一段动作描述是否已包含交战语义（用于安全地补入敌方角色） */
/**
 * 确保敌方阵营确实上镜。
 *
 * 大模型常常「只在台词里提敌人，subjects 里却全是友军」。这里做一次保守修补：
 * 只在「build / climax 阶段 + 动作已含交战语义 + 主体不足 3 个」的镜头上补入敌军，
 * 既不触发阵营冲突校验（对立阵营同框必须有对抗动作），也不会挤掉已有主体。
 *
 * 交战语义必须复用 shot-spec 的 hasHostileFraming，绝不能自己再写一份正则：
 * 两份判定不一致时，补进去的镜头会直接在校验阶段报 FACTION_CONFLICT_INVALID。
 */
function ensureOpposingPresence(shots = [], opposingIds = []) {
  if (!opposingIds.length) return { shots, injected: 0 };
  const hasFoe = shots.some(s => (s.subjects || []).some(id => opposingIds.includes(id)));
  if (hasFoe) return { shots, injected: 0 };

  let injected = 0;
  const out = shots.map((s, i) => {
    if (injected >= 2) return s;
    const phase = s.phase || 'build';
    if (phase !== 'build' && phase !== 'climax') return s;
    if (!hasHostileFraming(s.action)) return s;
    const subjects = Array.isArray(s.subjects) ? s.subjects : [];
    if (subjects.length >= 3) return s;
    const foe = opposingIds[i % opposingIds.length];
    if (subjects.includes(foe)) return s;
    injected++;
    return { ...s, subjects: [...subjects, foe] };
  });
  return { shots: out, injected };
}

function cleanAndParseJson(text) {
  if (!text || typeof text !== 'string') throw new Error('Empty AI response');
  let clean = text.trim();
  const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) {
    clean = match[1].trim();
  }
  return JSON.parse(clean);
}

/**
 * 尝试调用 Groq 极速免费接口
 */
async function callGroq(systemPrompt, userPrompt, apiKey) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) throw new Error(`Groq HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return cleanAndParseJson(content);
}

/**
 * 尝试调用 OpenRouter 免费模型接口
 */
async function callOpenRouter(systemPrompt, userPrompt, apiKey) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://legowaruniverse.pages.dev',
      'X-Title': 'LEGO War Universe'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct:free',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7
    })
  });
  if (!res.ok) throw new Error(`OpenRouter HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return cleanAndParseJson(content);
}

/**
 * 尝试调用 Google Gemini 免费接口 (通过 OpenAI 兼容端点)
 */
async function callGemini(systemPrompt, userPrompt, apiKey) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gemini-1.5-flash',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  return cleanAndParseJson(content);
}

export async function onRequest({ request, env = {} }) {
  const startTime = Date.now();
  const headers = cors(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type'
      }
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, headers);
  }

  // 基础限流保护
  const clientIp = request.headers.get('cf-connecting-ip') || 'anonymous';
  const rl = checkRateLimit(clientIp);
  if (rl.limited) {
    return json({ error: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs }, 429, headers);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'INVALID_JSON' }, 400, headers);
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return json({ error: 'INVALID_BODY' }, 400, headers);
  }

  const query = String(body.query || '').trim();
  if (!query) {
    return json({ error: 'MISSING_QUERY' }, 400, headers);
  }
  if (query.length > 1200) {
    return json({ error: 'QUERY_TOO_LONG', maxLength: 1200 }, 413, headers);
  }

  const requestedShots = body.requestedShots == null ? 4 : Number(body.requestedShots);
  if (!Number.isInteger(requestedShots) || requestedShots < 1 || requestedShots > 12) {
    return json({ error: 'INVALID_REQUESTED_SHOTS', allowedRange: [1, 12] }, 400, headers);
  }

  const inputGovernance = checkContentGovernance(query);
  if (inputGovernance.status === 'blocked') {
    return json({
      error: 'CONTENT_BLOCKED',
      flags: inputGovernance.flags,
      reasons: inputGovernance.reasons
    }, 403, headers);
  }

  // 依据题材解析时代，构建「与题材相关」的真实资产目录，注入 Prompt。
  // 这是「AI 优先且必须使用资产库」的关键：模型拿到的是真实 ID，而不是空白想象。
  const intent = parseIntent(query);
  const catalog = buildAssetCatalog(ASSET_REGISTRY, { era: intent.era, keywords: query });
  const catalogText = formatCatalogForPrompt(catalog);
  const validIds = collectValidIds(ASSET_REGISTRY);

  // 确定性阵容：后台先按时代从资产库里挑出正反双方 + 载具，并分配固定代号，
  // 再把这份「演员表」交给大模型 —— 模型因此无法凭空发明角色，只能按代号排戏。
  const cast = REGISTRY ? selectCast(REGISTRY, { era: intent.era || 'Modern', task: 'combat', theme: query }) : null;
  const castIds = cast ? [...cast.heroes, ...cast.enemies, ...cast.vehicles].map(a => a.id) : [];
  const castRoster = REGISTRY && castIds.length ? buildRoster([{ subjects: castIds }], REGISTRY) : null;
  const opposingIds = castRoster ? castRoster.opposing.map(e => e.id) : [];

  const systemPrompt = buildDirectorSystemPrompt(catalogText, intent.era, buildCastSection(castRoster));
  const userPrompt = buildUserPrompt(query, requestedShots);

  let result = null;
  let usedEngine = 'None';

  // 1. 尝试 Groq 免费通道
  if (env.GROQ_API_KEY && !result) {
    try {
      result = await callGroq(systemPrompt, userPrompt, env.GROQ_API_KEY);
      usedEngine = 'Groq (llama-3.3-70b-versatile)';
    } catch (e) {
      console.warn('Groq 调度跳过或失败:', e.message);
    }
  }

  // 2. 尝试 OpenRouter 免费通道
  if (env.OPENROUTER_API_KEY && !result) {
    try {
      result = await callOpenRouter(systemPrompt, userPrompt, env.OPENROUTER_API_KEY);
      usedEngine = 'OpenRouter (llama-3.3:free)';
    } catch (e) {
      console.warn('OpenRouter 调度跳过或失败:', e.message);
    }
  }

  // 3. 尝试 Google Gemini 免费通道
  if (env.GEMINI_API_KEY && !result) {
    try {
      result = await callGemini(systemPrompt, userPrompt, env.GEMINI_API_KEY);
      usedEngine = 'Google Gemini (gemini-1.5-flash)';
    } catch (e) {
      console.warn('Gemini 调度跳过或失败:', e.message);
    }
  }

  // 4. 若无云端 Key 或调用均异常，自动由本地高保真引擎无缝兜底
  if (!result) {
    // 兜底路径同样要把真实注册表传进去：否则本地引擎挑不出真实资产、也就没有代号
    const local = transpileMovieToLego(query, requestedShots, REGISTRY);
    const latencyMs = Date.now() - startTime;
    const responseBody = {
      ok: true,
      matchedMovie: local.matchedMovie,
      director: local.director,
      year: local.year,
      genre: local.genre,
      dramaticConflict: local.dramaticConflict,
      visualGrammar: local.visualGrammar,
      legoAdaptation: local.legoAdaptation,
      creatorTips: local.creatorTips,
      themeZh: local.themeZh,
      shots: local.shots,
      originality: local.originality || null,
      roster: Array.isArray(local.roster) ? local.roster : [],
      repetitionFixed: local.repetitionFixed || 0,
      isAiGenerated: false,
      engine: 'Built-in Cinema Engine (本地高保真离线引擎)',
      era: local.era || intent.era,
      assetUsage: { catalogSize: validIds.size, matched: 0, unknown: [] },
      proposedAssets: [],
      latencyMs
    };
    const governed = governResponse(responseBody, inputGovernance);
    return json(governed.body, governed.status, headers);
  }

  // 5. 校验大模型返回的资产引用：只保留真实存在的 ID，非法 ID 降级为默认资产。
  const rawShots = Array.isArray(result.shots) ? result.shots : [];
  const unknownIds = new Set();
  let matchedRefs = 0;
  const sanitizedShots = rawShots.map(shot => {
    const { refs, unknown } = resolveShotAssets(shot, validIds);
    unknown.forEach(id => unknownIds.add(id));
    matchedRefs += refs.subjects.length
      + ['environment', 'camera', 'lighting', 'colorGrade'].filter(k => refs[k]).length
      + refs.fx.length + refs.audio.length;
    return {
      ...shot,
      subjects: refs.subjects.length ? refs.subjects : undefined,
      environment: refs.environment || undefined,
      camera: refs.camera || undefined,
      lighting: refs.lighting || undefined,
      colorGrade: refs.colorGrade || undefined,
      fx: refs.fx,
      audio: refs.audio
    };
  });

  // 5b. 保证敌方阵营真的上镜（只在含交战语义的镜头里保守补入，绝不制造阵营冲突）
  const foeFixed = ensureOpposingPresence(sanitizedShots, opposingIds);

  // 6. 与乐高资产规范对齐（含连续性链条强制注入）
  const alignedShots = alignShotsToLego(foeFixed.shots, {}, intent.era || 'Modern');

  // 6b. 反重复兜底：大模型最爱偷懒复制同一句话，这里对撞车的 action 做确定性变奏
  const diversified = diversifyShots(alignedShots);

  // 6c. 以「最终真正上镜的镜头」为准聚合名册，并继承 Prompt 阶段已分配的代号，
  //     保证「模型脚本里的称呼」与「前端定妆表 / 编译 Prompt」完全一致。
  const finalRoster = REGISTRY
    ? buildRoster(diversified.shots, REGISTRY, { prior: castRoster })
    : null;

  const latencyMs = Date.now() - startTime;

  const responseBody = {
    ok: true,
    matchedMovie: result.matchedMovie || query,
    director: result.director || 'AI 导演中枢',
    year: result.year || '2026',
    genre: result.genre || '好莱坞大片',
    dramaticConflict: result.dramaticConflict || '高危战术突破与终极对决',
    visualGrammar: result.visualGrammar || {},
    legoAdaptation: result.legoAdaptation || '高精度乐高微缩定格美学',
    creatorTips: result.creatorTips || '把握前3秒视听钩子',
    themeZh: `【${result.matchedMovie || query} · AI 大脑转译】${(diversified.shots[0]?.action || '').slice(0, 35)}…`,
    shots: diversified.shots,
    originality: result.originality || null,
    roster: finalRoster ? rosterToJSON(finalRoster) : [],
    repetitionFixed: diversified.fixed,
    isAiGenerated: true,
    engine: `Cloud Free AI (${usedEngine})`,
    era: intent.era,
    assetUsage: {
      catalogSize: validIds.size,
      matched: matchedRefs,
      unknown: [...unknownIds]
    },
    // 模型建议新增、但资产库暂缺的现代/未来战争装备 —— 交给前端进化引擎锻造落地
    proposedAssets: Array.isArray(result.proposedAssets) ? result.proposedAssets.slice(0, 8) : [],
    latencyMs
  };
  const governed = governResponse(responseBody, inputGovernance);
  return json(governed.body, governed.status, headers);
}
