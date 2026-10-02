/**
 * LEGO War Universe - 前端 AI 智能大脑调度客户端 (AI Brain Client)
 *
 * 生成策略（与产品需求一致）：
 *   1. 优先请求后台 /api/ai-brain —— 后台会把「与本片题材相关的真实资产目录」
 *      注入 Prompt，大模型据此产出引用了真实资产 ID 的分镜脚本；
 *   2. 若网络断网 / 后端未就绪 / 纯离线打开，则无缝回退到本地高保真引擎，
 *      由本地资产库（CINEMA_DATABASE + 注册表）生成影片脚本。
 *
 * 两条路径返回的数据结构完全一致，调用方无需区分处理。
 */

import { transpileMovieToLego } from './cinema-homage.js';

/**
 * 调度 AI 大脑（优先后台免费大模型服务，无缝自动容灾降级）
 * @param {{ query: string, requestedShots?: number, registry?: object|null, onProgress?: (msg: string) => void }} params
 */
export async function callAiBrain({ query, requestedShots = 4, registry = null, onProgress = null }) {
  if (onProgress) onProgress('正在构建题材资产目录并连接后台免费 AI 导演大脑 (Groq / OpenRouter / Gemini)…');

  try {
    const res = await fetch('/api/ai-brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, requestedShots })
    });

    if (res.ok) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.shots) && data.shots.length > 0) {
        return {
          ...data,
          themeZh: data.themeZh || `【${data.matchedMovie || query}】${(data.shots[0]?.action || '').slice(0, 35)}…`
        };
      }
    }
  } catch (err) {
    console.warn('后台 /api/ai-brain 接口不可达或处于离线纯静态模式，转由前端内置引擎直接出片:', err);
  }

  // 离线环境或后端未就绪时，前端内置高保真引擎秒级响应。
  // 必须把注册表传进去：否则本地兜底路径挑不出真实资产、也就没有角色代号，
  // 与「角色从资产库里挑」的产品诉求直接冲突。
  if (onProgress) onProgress('云端大脑不可用，正在调用内置本地资产引擎生成影片脚本…');
  const localResult = transpileMovieToLego(query, requestedShots, registry);
  return {
    ...localResult,
    isAiGenerated: false,
    engine: 'Built-in Engine (本地高保真离线引擎)',
    assetUsage: null,
    proposedAssets: []
  };
}
