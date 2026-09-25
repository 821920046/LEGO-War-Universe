/**
 * LEGO War Universe - 前端 AI 智能大脑调度客户端 (AI Brain Client)
 * 优先请求后台 /api/ai-brain (接入 Groq / OpenRouter / Gemini 等免费大模型)
 * 用户无需在前端填写任何 API Key；若网络断网或纯离线打开，前端无缝平滑回退至本地离线引擎。
 */

import { transpileMovieToLego } from './cinema-homage.js';
import { alignShotsToLego } from './lego-aligner.js';

/**
 * 调度 AI 大脑（优先后台免费大模型服务，无缝自动容灾降级）
 */
export async function callAiBrain({ query, requestedShots = 4, onProgress = null }) {
  if (onProgress) onProgress('正在连接后台免费 AI 导演大脑 (Groq / OpenRouter / Gemini)…');

  try {
    const res = await fetch('/api/ai-brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, requestedShots })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.shots) {
        return {
          ...data,
          themeZh: data.themeZh || `【${data.matchedMovie || query}】${(data.shots[0]?.action || '').slice(0, 35)}…`
        };
      }
    }
  } catch (err) {
    console.warn('后台 /api/ai-brain 接口不可达或处于离线纯静态模式，转由前端内置引擎直接出片:', err);
  }

  // 离线环境或后端未就绪时，前端内置高保真引擎秒级响应
  if (onProgress) onProgress('正在调用内置好莱坞视听转译引擎…');
  const localResult = transpileMovieToLego(query, requestedShots);
  return {
    ...localResult,
    isAiGenerated: false,
    engine: 'Built-in Engine (本地高保真离线引擎)'
  };
}
