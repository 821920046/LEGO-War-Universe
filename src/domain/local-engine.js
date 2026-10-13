/**
 * LEGO War Universe - 本地生成引擎（6.8.1）
 *
 * 为什么单独一个文件：本地引擎有两套性质完全不同的东西，**前端与后台都要用**，
 * 所以不能把它塞进前端调度客户端 `ai-brain.js`（后台 worker 去 import 前端客户端
 * 是说不通的）。
 *
 *   ┌──────────────┬──────────────────────────────────────────────────────┐
 *   │ 策展致敬库     │ 9 部影片的**手写**分镜（`cinema-homage.js`）。         │
 *   │              │ 内容固定 —— 同一部片，点一百次都是同一句台词。          │
 *   ├──────────────┼──────────────────────────────────────────────────────┤
 *   │ 自主想象引擎   │ `planVariants` 真的按题材写一部（视角×重心×基调×4 案择优）。│
 *   │              │ 输入变了，片子就变。                                    │
 *   └──────────────┴──────────────────────────────────────────────────────┘
 *
 * 旧实现把两者混成一条路：**任何没命中那 9 部影片的输入，都静默退回
 * 《黑鹰坠落》的手写分镜**。用户实测反馈：「换了两次内容了，每次第一个脚本的内容
 * 都是『两架战术直升机在灰尘弥漫的城市街道低空悬停…』，这到底是什么意思，
 * 没有使用AI吗」—— 那句确实是手写文本而不是 AI 生成的，而且**输入根本没参与选片**，
 * 所以换多少次都一样。
 */

import { planVariants } from './variants.js';
import { scoreCandidate, diversify } from './variant-score.js';

/** 离线引擎的两种性质，UI 据此如实告知用户 */
export const OFFLINE_ENGINES = {
  curated: '策展致敬库 · 离线复刻（手写分镜，非 AI 生成）',
  generated: '本地自主想象引擎 · 离线生成（非云端 AI）'
};

/**
 * 用本地生成引擎按题材真的写一部片子（含多方案择优）。
 *
 * 返回结构与 `transpileMovieToLego` 对齐，调用方无需分支处理；
 * 额外带上 `variants`，前端可让用户在 4 个方案之间切换。
 *
 * @returns {object|null} 注册表缺失或全部方案失败时返回 null
 */
export function generateLocally({ theme, requestedShots = 4, profileId = undefined, registry = null, count = 4 }) {
  if (!registry?.profileById) return null;
  // 调用方（尤其是后台）常常拿不到 UI 的 profile 选择框，这里必须自己挑一个默认档，
  // 否则 planFilm 会抛 `Unknown profile`，整条生成链路静默失效 —— 6.8.1 修复前
  // 后端就是这么一路静默退回《黑鹰坠落》的（探针实测 generateLocally 恒返回 null）。
  const pid = profileId || registry.profileById.keys().next().value;
  if (!pid) return null;

  const { candidates } = planVariants({
    theme,
    requestedShots,
    profileId: pid,
    count,
    score: scoreCandidate
  }, registry);
  const ranked = diversify(candidates).filter(c => c.film);
  if (!ranked.length) return null;

  const film = ranked[0].film;
  const plan = film.plan;
  return {
    matchedMovie: null,
    movieId: null,
    matchKind: 'none',
    contentKind: 'generated',
    themeZh: theme,
    era: film.intent?.era || null,
    // 生成片没有「被解构的导演」——这些字段留空，UI 不该显示拉片面版
    director: null,
    year: null,
    genre: '原创战争短片',
    dramaticConflict: null,
    visualGrammar: null,
    legoAdaptation: null,
    creatorTips: null,
    shots: plan.shots,
    assets: null,
    originality: plan.originality || null,
    roster: plan.roster || null,
    story: plan.story || null,
    variant: plan.variant || null,
    variants: ranked,
    score: ranked[0].score,
    isAiGenerated: false,
    engine: OFFLINE_ENGINES.generated,
    assetUsage: null,
    proposedAssets: []
  };
}
