/**
 * LEGO War Universe - 后台免费大模型统一调度中枢 (/api/ai-brain)
 * 功能：
 * 1. 后端集中托管 Groq / OpenRouter / Gemini 等免费大模型 API Key，前端免配置开箱即用
 * 2. 具备多通道自动故障转移 (Failover Engine)：Groq -> OpenRouter -> Gemini -> 本地离线引擎
 * 3. 严格审计与速率限制保护
 */

import { transpileMovieToLego } from '../../src/domain/cinema-homage.js';
import { alignShotsToLego } from '../../src/domain/lego-aligner.js';

// 简易限流配置
const rateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX = 30;

function checkRateLimit(clientId) {
  const now = Date.now();
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
  if (origin && expected && origin === expected) {
    return { 'access-control-allow-origin': origin, 'vary': 'Origin' };
  }
  return { 'access-control-allow-origin': '*' };
}

const DIRECTOR_SYSTEM_PROMPT = `你是一位好莱坞顶级电影摄影指导与微缩定格动画导演（擅长诺兰、雷德利·斯科特、丹尼斯·维伦纽瓦的视听语言，精通乐高定格微缩物理美学）。
用户的输入可能是一部电影名称（如《长津湖》《阿凡达》《星际穿越》《狂怒》《黑客帝国》等），或者任意战术/科幻创意大纲。
你的任务是将该内容深度解构并转译为一部乐高微缩定格大片分镜剧本。

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
  "shots": [
    {
      "phase": "establish",
      "shotType": "景别类型（如：超低空掠地全景 / 驾驶舱微型特写）",
      "action": "详细的乐高微缩动作描述，必须指明乐高人仔、载具、建筑积木细节",
      "screenDirection": "towards-camera",
      "damageState": "clean",
      "audioCue": "环境音效与伴随音乐描述",
      "radioVoice": "【台词/无线电】核心角色对白或战术呼叫"
    }
  ]
}`;

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
async function callGroq(query, requestedShots, apiKey) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
        { role: 'user', content: `请深度解构并转译：${query}。输出正好 ${requestedShots} 个镜头的完整分镜（四阶段叙事：铺垫 establish -> 展开 build -> 决战 climax -> 尾声 resolve）。` }
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
async function callOpenRouter(query, requestedShots, apiKey) {
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
        { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
        { role: 'user', content: `请深度解构并转译：${query}。输出正好 ${requestedShots} 个镜头的完整分镜（四阶段叙事：铺垫 establish -> 展开 build -> 决战 climax -> 尾声 resolve）。` }
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
async function callGemini(query, requestedShots, apiKey) {
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gemini-1.5-flash',
      messages: [
        { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
        { role: 'user', content: `请深度解构并转译：${query}。输出正好 ${requestedShots} 个镜头的完整分镜（四阶段叙事：铺垫 establish -> 展开 build -> 决战 climax -> 尾声 resolve）。` }
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

  const query = String(body.query || '').trim();
  if (!query) {
    return json({ error: 'MISSING_QUERY' }, 400, headers);
  }

  const requestedShots = Number(body.requestedShots) || 4;
  let result = null;
  let usedEngine = 'None';

  // 1. 尝试 Groq 免费通道
  if (env.GROQ_API_KEY && !result) {
    try {
      result = await callGroq(query, requestedShots, env.GROQ_API_KEY);
      usedEngine = 'Groq (llama-3.3-70b-versatile)';
    } catch (e) {
      console.warn('Groq 调度跳过或失败:', e.message);
    }
  }

  // 2. 尝试 OpenRouter 免费通道
  if (env.OPENROUTER_API_KEY && !result) {
    try {
      result = await callOpenRouter(query, requestedShots, env.OPENROUTER_API_KEY);
      usedEngine = 'OpenRouter (llama-3.3:free)';
    } catch (e) {
      console.warn('OpenRouter 调度跳过或失败:', e.message);
    }
  }

  // 3. 尝试 Google Gemini 免费通道
  if (env.GEMINI_API_KEY && !result) {
    try {
      result = await callGemini(query, requestedShots, env.GEMINI_API_KEY);
      usedEngine = 'Google Gemini (gemini-1.5-flash)';
    } catch (e) {
      console.warn('Gemini 调度跳过或失败:', e.message);
    }
  }

  // 4. 若无云端 Key 或调用均异常，自动由本地高保真引擎无缝兜底
  if (!result) {
    const local = transpileMovieToLego(query, requestedShots);
    const latencyMs = Date.now() - startTime;
    return json({
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
      isAiGenerated: false,
      engine: 'Built-in Cinema Engine (本地高保真离线引擎)',
      latencyMs
    }, 200, headers);
  }

  // 5. 将大模型输出的分镜与乐高资产规范对齐
  const alignedShots = alignShotsToLego(result.shots || [], {}, 'Modern');
  const latencyMs = Date.now() - startTime;

  return json({
    ok: true,
    matchedMovie: result.matchedMovie || query,
    director: result.director || 'AI 导演中枢',
    year: result.year || '2026',
    genre: result.genre || '好莱坞大片',
    dramaticConflict: result.dramaticConflict || '高危战术突破与终极对决',
    visualGrammar: result.visualGrammar || {},
    legoAdaptation: result.legoAdaptation || '高精度乐高微缩定格美学',
    creatorTips: result.creatorTips || '把握前3秒视听钩子',
    themeZh: `【${result.matchedMovie || query} · AI 大脑转译】${(alignedShots[0]?.action || '').slice(0, 35)}…`,
    shots: alignedShots,
    isAiGenerated: true,
    engine: `Cloud Free AI (${usedEngine})`,
    latencyMs
  }, 200, headers);
}
