/**
 * LEGO War Universe - 前端 AI 智能大脑调度客户端 (AI Brain Client)
 *
 * 生成策略（与产品需求一致）：
 *   1. 优先请求后台 /api/ai-brain —— 后台会把「与本片题材相关的真实资产目录」
 *      注入 Prompt，大模型据此产出引用了真实资产 ID 的分镜脚本；
 *   2. 若网络断网 / 后端未就绪 / 纯静态离线打开，则回退到**本地引擎**。
 *
 * **离线回退必须分两种情况，不能混为一谈（6.8.1 修复）**
 *
 * 本地引擎里其实有两套东西，产出物的性质完全不同（详见 `local-engine.js`）：
 *   · **策展致敬库** —— 9 部影片的**手写**分镜，内容固定，同一部片点一百次都一样；
 *   · **自主想象引擎** —— `planVariants` 真的按题材写一部，输入变了片子就变。
 *
 * 旧实现把两者混成一条路：任何没命中那 9 部影片的输入都静默退回《黑鹰坠落》，
 * 于是「换了两次内容，第一个脚本永远是同一句」。现在的口径：
 *   · 命中策展影片 → 交付致敬复刻，并如实标注「离线复刻，非 AI 生成」；
 *   · 未命中       → 交给自主想象引擎真的生成一部，脚本随输入变化。
 */

import { transpileMovieToLego, matchCuratedFilm } from './cinema-homage.js';
import { generateLocally, OFFLINE_ENGINES } from './local-engine.js';

export { generateLocally, OFFLINE_ENGINES };

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

  // ── 离线 / 后端未就绪 ────────────────────────────────────────────────
  // 命中策展影片：交付手写复刻，并**如实标注**它不是 AI 生成的。
  // 必须把注册表传进去：否则本地路径挑不出真实资产、也就没有角色代号。
  const curated = matchCuratedFilm(query);
  if (curated.film) {
    if (onProgress) onProgress(`云端大脑不可用，正在调用内置致敬库复刻《${curated.film.title}》…`);
    const localResult = transpileMovieToLego(query, requestedShots, registry);
    return {
      ...localResult,
      isAiGenerated: false,
      contentKind: 'curated',
      engine: OFFLINE_ENGINES.curated
    };
  }

  // 没命中任何策展影片：**不再伪装成《黑鹰坠落》**，改用自主想象引擎真的写一部。
  // 这是「换了输入脚本却不变」这个投诉的正解：输入真正参与生成。
  if (onProgress) onProgress('未命中策展影片，改用本地自主想象引擎按题材生成（含 4 方案择优）…');
  const generated = generateLocally({ theme: query, requestedShots, registry });
  if (generated) return generated;

  // 生成也失败（极端情况）才退回策展兜底，但仍然如实标注
  const fallback = transpileMovieToLego(query, requestedShots, registry, { genericFallback: true });
  return {
    ...fallback,
    isAiGenerated: false,
    contentKind: 'curated',
    engine: `${OFFLINE_ENGINES.curated} · 生成引擎不可用，已退回通用军事分镜`
  };
}
