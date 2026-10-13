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
 *
 * **6.8.6：请求必须有上限，等待必须看得见**
 *
 * 6.8.5 把模型名修好之后云端 AI 真的通了，于是暴露出新问题：线上实测
 * 单镜就要 30–59 秒。此前这个 fetch **没有任何超时**，后端一旦长时间不返回，
 * 前端就一直 await —— 按钮灰着、进度条不动、既不报错也不回退，用户看到的就是「死机」。
 *
 * 所以这里补两件事：
 *   · 给 fetch 加超时（超时即 abort），到点就回退本地引擎，并如实说明是「等待超时」；
 *   · 等待期间每 5 秒刷新一次进度文案，让用户知道**还在跑、跑了多久、上限多少**。
 */

import { transpileMovieToLego, matchCuratedFilm } from './cinema-homage.js';
import { generateLocally, OFFLINE_ENGINES } from './local-engine.js';

export { generateLocally, OFFLINE_ENGINES };

/**
 * 前端等待云端结果的上限。
 *
 * 取得比后端总预算（默认 120s）短，理由是：后端在预算耗尽时会返回一份
 * **带完整诊断的响应**，那才是用户最需要的信息；前端上限只是「连接本身死了」的兜底，
 * 不该抢在后端给出诊断之前就把请求掐掉。
 * 但也不能太长 —— 用户不能对着一个不动的界面等上几分钟。
 */
export const FRONTEND_TIMEOUT_MS = 100000;

/**
 * 调度 AI 大脑（优先后台免费大模型服务，无缝自动容灾降级）
 * @param {{ query: string, requestedShots?: number, registry?: object|null, onProgress?: (msg: string) => void, timeoutMs?: number, progressIntervalMs?: number }} params
 */
export async function callAiBrain({
  query,
  requestedShots = 4,
  registry = null,
  onProgress = null,
  timeoutMs = FRONTEND_TIMEOUT_MS,
  progressIntervalMs = 5000
}) {
  if (onProgress) onProgress('正在构建题材资产目录并连接后台免费 AI 导演大脑 (Groq / OpenRouter / Gemini)…');

  // 失败原因必须一路带到兜底结果里，否则徽章又只能含糊地说「未使用云端 AI」。
  let fallbackReason = null;

  // 等待期间的心跳：每隔一段时间告诉用户还在跑、跑了多久。
  // 没有这个，几十秒的合法等待与「界面卡死」在观感上完全一样。
  const startedAt = Date.now();
  const ticker = onProgress && progressIntervalMs > 0 ? setInterval(() => {
    const secs = Math.round((Date.now() - startedAt) / 1000);
    onProgress(`⏳ 云端 AI 正在生成，已等待 ${secs} 秒（最多 ${Math.round(timeoutMs / 1000)} 秒，超时将自动回退本地引擎）…`);
  }, progressIntervalMs) : null;

  const controller = new AbortController();
  let timer = null;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { controller.abort(); } catch { /* abort 失败不影响超时语义 */ }
      reject(new Error('FRONTEND_TIMEOUT'));
    }, timeoutMs);
  });

  try {
    const pending = fetch('/api/ai-brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, requestedShots }),
      signal: controller.signal
    });
    // race 结束后 fetch 仍可能以 AbortError 抛错，先挂个空 catch 防止 unhandled rejection
    pending.catch(() => {});

    const res = await Promise.race([pending, guard]);

    if (res.ok) {
      const data = await res.json();
      if (data.ok && Array.isArray(data.shots) && data.shots.length > 0) {
        return {
          ...data,
          themeZh: data.themeZh || `【${data.matchedMovie || query}】${(data.shots[0]?.action || '').slice(0, 35)}…`
        };
      }
      // 后端回了 200 但内容不可用：也要说清楚，不能装作没事发生
      fallbackReason = {
        aiAvailable: false,
        reason: 'BACKEND_EMPTY_RESULT',
        providers: [],
        hint: '后台返回了 200，但响应里没有可用的分镜，已回退本地引擎。'
      };
    } else {
      // 非 2xx 同样是「云端没生效」：不回显状态码，用户就只能看到一句含糊的「未使用云端 AI」。
      let detail = '';
      try {
        const errBody = await res.json();
        if (errBody && errBody.error) detail = `（${errBody.error}）`;
      } catch { /* 响应体不是 JSON，忽略即可，状态码本身已经够用 */ }
      fallbackReason = {
        aiAvailable: false,
        reason: 'BACKEND_ERROR',
        providers: [],
        hint: `后台返回 HTTP ${res.status}${detail}，已回退本地引擎。`
      };
    }
  } catch (err) {
    if (err && err.message === 'FRONTEND_TIMEOUT') {
      fallbackReason = {
        aiAvailable: false,
        reason: 'FRONTEND_TIMEOUT',
        providers: [],
        hint: `前端等待超过 ${Math.round(timeoutMs / 1000)} 秒仍未拿到云端结果，已中断请求并回退本地引擎。可调大 AI_PROVIDER_TIMEOUT_MS / AI_REQUEST_BUDGET_MS，或换一个更快的模型。`
      };
      console.warn(`后台 /api/ai-brain 超过 ${timeoutMs}ms 未返回，已中断并转本地引擎`);
    } else {
      fallbackReason = {
        aiAvailable: false,
        reason: 'FRONTEND_UNREACHABLE',
        providers: [],
        hint: '后台 /api/ai-brain 接口不可达（纯静态打开、网络中断或后端未部署），已回退本地引擎。'
      };
      console.warn('后台 /api/ai-brain 接口不可达或处于离线纯静态模式，转由前端内置引擎直接出片:', err);
    }
  } finally {
    clearTimeout(timer);
    if (ticker) clearInterval(ticker);
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
      engine: OFFLINE_ENGINES.curated,
      aiStatus: fallbackReason
    };
  }

  // 没命中任何策展影片：**不再伪装成《黑鹰坠落》**，改用自主想象引擎真的写一部。
  // 这是「换了输入脚本却不变」这个投诉的正解：输入真正参与生成。
  if (onProgress) onProgress('未命中策展影片，改用本地自主想象引擎按题材生成（含 4 方案择优）…');
  const generated = generateLocally({ theme: query, requestedShots, registry });
  if (generated) return { ...generated, aiStatus: fallbackReason };

  // 生成也失败（极端情况）才退回策展兜底，但仍然如实标注
  const fallback = transpileMovieToLego(query, requestedShots, registry, { genericFallback: true });
  return {
    ...fallback,
    isAiGenerated: false,
    contentKind: 'curated',
    engine: `${OFFLINE_ENGINES.curated} · 生成引擎不可用，已退回通用军事分镜`,
    aiStatus: fallbackReason
  };
}
