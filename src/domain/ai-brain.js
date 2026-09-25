/**
 * LEGO War Universe - 云端 AI 智能大脑与大模型调度引擎 (AI Brain)
 * 功能：
 * 1. 支持纯前端无后端运行，支持配置 OpenAI / DeepSeek / Kimi / 自定义大模型 API Key
 * 2. 好莱坞微缩定格导演级 System Prompt 构建器
 * 3. 健壮的流式/阻塞 JSON 提取与容错清洗
 * 4. 离线/未配置时自动智能降级至本地 3.0 视听转译引擎
 */

import { transpileMovieToLego } from './cinema-homage.js';
import { alignShotsToLego } from './lego-aligner.js';

const STORAGE_KEY = 'lwu_ai_brain_config';

export const DEFAULT_AI_CONFIG = {
  provider: 'deepseek', // 'deepseek' | 'openai' | 'custom'
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: '',
  model: 'deepseek-chat',
  temperature: 0.7
};

/**
 * 获取本地存储的 AI 大脑配置
 */
export function getAiConfig() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_AI_CONFIG };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_AI_CONFIG };
    return { ...DEFAULT_AI_CONFIG, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_AI_CONFIG };
  }
}

/**
 * 保存 AI 大脑配置到本地存储
 */
export function saveAiConfig(cfg) {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
}

/**
 * 导演级 System Prompt
 */
export const DIRECTOR_SYSTEM_PROMPT = `你是一位好莱坞顶级电影摄影指导与微缩定格动画导演（擅长诺兰、雷德利·斯科特、丹尼斯·维伦纽瓦的视听语言，精通乐高定格微缩物理美学）。
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

/**
 * 健壮的 JSON 清洗提取器
 */
export function cleanAndParseJson(text) {
  if (!text || typeof text !== 'string') throw new Error('Empty AI response');
  let clean = text.trim();

  // 剔除 markdown ```json ... ``` 标记
  const match = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (match) {
    clean = match[1].trim();
  }

  return JSON.parse(clean);
}

/**
 * 调用云端 AI 大脑（若无配置则自动优雅降级）
 */
export async function callAiBrain({ query, requestedShots = 4, config = null, onProgress = null }) {
  const currentConfig = config || getAiConfig();

  // 若未配置 API Key，无缝走本地内置 3.0 转译引擎
  if (!currentConfig.apiKey || !currentConfig.apiKey.trim()) {
    if (onProgress) onProgress('正在调用本地 3.0 影视视听知识库…');
    const localResult = transpileMovieToLego(query, requestedShots);
    return {
      ...localResult,
      isAiGenerated: false,
      engine: 'Local Offline Engine (本地启发式引擎)'
    };
  }

  if (onProgress) onProgress('AI 智慧大脑正在深度拉片并构思好莱坞视听分镜…');

  const userPrompt = `请深度解构并转译：${query}。输出正好 ${requestedShots} 个镜头的完整分镜（四阶段叙事：铺垫 establish -> 展开 build -> 决战 climax -> 尾声 resolve）。`;

  let endpoint = currentConfig.baseUrl.replace(/\/+$/, '') + '/chat/completions';

  const bodyPayload = {
    model: currentConfig.model || 'deepseek-chat',
    messages: [
      { role: 'system', content: DIRECTOR_SYSTEM_PROMPT },
      { role: 'user', content: userPrompt }
    ],
    temperature: currentConfig.temperature ?? 0.7,
    response_format: { type: 'json_object' }
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30秒超时

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${currentConfig.apiKey.trim()}`
      },
      body: JSON.stringify(bodyPayload),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`AI 大脑接口响应异常 [${res.status}]: ${errText.slice(0, 100)}`);
    }

    const data = await res.json();
    const rawContent = data.choices?.[0]?.message?.content;
    const parsed = cleanAndParseJson(rawContent);

    // 将大模型输出的分镜与乐高资产与连续性规范对齐
    const alignedShots = alignShotsToLego(parsed.shots || [], {}, 'Modern');

    return {
      matchedMovie: parsed.matchedMovie || query,
      director: parsed.director || 'AI 导演中枢',
      year: parsed.year || '2026',
      genre: parsed.genre || '好莱坞大片',
      dramaticConflict: parsed.dramaticConflict || '高危战术突破与终极对决',
      visualGrammar: parsed.visualGrammar || {},
      legoAdaptation: parsed.legoAdaptation || '高精度乐高微缩定格美学',
      creatorTips: parsed.creatorTips || '把握前3秒视听钩子',
      themeZh: `【${parsed.matchedMovie || query} · AI 大脑原创】${(alignedShots[0]?.action || '').slice(0, 35)}…`,
      shots: alignedShots,
      isAiGenerated: true,
      engine: `Cloud AI Brain (${currentConfig.model})`
    };
  } catch (err) {
    console.warn('AI Brain 调用失败，自动降级至本地引擎:', err);
    if (onProgress) onProgress('AI 接口调用异常，已平滑切换至本地视听引擎保障出片…');
    const localFallback = transpileMovieToLego(query, requestedShots);
    return {
      ...localFallback,
      isAiGenerated: false,
      engine: `Fallback to Local Engine (降级保障: ${err.message || '网络超时'})`
    };
  }
}
