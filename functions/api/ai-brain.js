/**
 * LEGO War Universe - 后台免费大模型统一调度中枢 (/api/ai-brain)
 * 功能：
 * 1. 后端集中托管 Groq / OpenRouter / Gemini 等免费大模型 API Key，前端免配置开箱即用
 * 2. 本地打底 + AI 润色（6.9.0）：结构永远来自确定性本地引擎，AI 只改写三个文本字段
 * 3. 多通道自动故障转移（Groq -> OpenRouter -> Gemini）+ 熔断器：模型过载时跳过空等
 * 4. 严格审计与速率限制保护
 *
 * **6.9.0 架构变更：AI 从「生成整部电影」退位到「润色三句文案」**
 *
 * 旧模式：AI 可用时，整部分镜（含资产 ID / 结构 / 台词）由模型自由生成；
 * AI 不可用时，才整部落回本地引擎。两个后果：模型的幻觉面覆盖整部电影
 * （6.8.8 的资产幻觉、6.8.9 的导演幻觉都源于此）；模型过载时（线上实测
 * 503 风暴）用户每次白等几十秒才拿到本来毫秒级就能给出的本地基底。
 *
 * 新模式：**基底先行** —— 每次请求先用确定性本地引擎产出完整分镜（真实资产、
 * 固定代号、节拍弧、连续性，全过校验），再把基底交给 AI 做文本润色。
 * AI 不可用（无 Key / 全失败 / 熔断中）时基底已在手，回退零等待；
 * AI 可用时，合并层（mergePolish）只放行三个文本字段，结构零改动。
 * 详见 src/domain/polish-contract.js 的契约说明。
 */

import { transpileMovieToLego, matchCuratedFilm } from '../../src/domain/cinema-homage.js';
import { generateLocally, OFFLINE_ENGINES } from '../../src/domain/local-engine.js';
import { checkContentGovernance } from '../../src/domain/governance.js';
import { parseIntent } from '../../src/domain/intent.js';
import { hasHostileFraming } from '../../src/domain/shot-spec.js';
import { buildAssetCatalog, formatCatalogForPrompt, collectValidIds } from '../../src/domain/asset-catalog.js';
import { assets as ASSET_REGISTRY, profiles as ASSET_PROFILES } from '../../src/domain/assets-data.js';
import { createRegistry } from '../../src/domain/registry.js';
import { selectCast, buildRoster, rosterToJSON, rosterPromptLines, rosterFromJSON } from '../../src/domain/roster.js';
import { diversifyShots, tagDramaticFunctions } from '../../src/domain/narrative.js';
import {
  POLISHABLE_FIELDS,
  buildPolishSystemPrompt,
  buildPolishUserPrompt,
  mergePolish,
  callsignSetOfRoster
} from '../../src/domain/polish-contract.js';

/**
 * 后端侧的资产注册表。
 *
 * 存在的意义：后台必须和前端用**同一套算法**从资产库里挑演员并分配代号，
 * 否则「大模型脚本里的角色」与「前端定妆表里的角色」会对不上。
 *
 * **6.9.2 修正**：这里曾用一个 `durations: [8]` 的占位 profile（当时只依赖
 * byId / byKind 挑演员，档位用不上）。但 6.9.0 起后端会真的跑
 * `generateLocally` —— `planFilm` 用 `profile.durations` 落档，
 * 占位 profile 于是把**每一镜都压成 8 秒**：前端本地规划出来的 4 秒快切
 * 在服务端全部消失，节奏设计（6.7.4 的档位语法 + 6.9.1 的内容预算）
 * 对线上产出完全无效。线上实测 8 镜全 8s，本地同一题材是 [8,6,6,4,6,4,6,4]。
 * 现在改为直接使用资产包里的**真实** model profiles（assets-data.js）。
 */
const REGISTRY = (() => {
  try {
    return createRegistry(ASSET_REGISTRY, ASSET_PROFILES);
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

// now 参数是给测试用的时钟探针：窗口轮转（60s）不可能在测试里真的等，
// 没有这个探针，「过期后计数重置」这条行为就是不可测的。
export function checkRateLimit(clientId, now = Date.now()) {

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

// ── 熔断器（6.9.0）────────────────────────────────────────────────────────
// 起因（线上实测 2026-10-16）：Gemini 免费档 503 风暴，一次请求里三个候选模型
// 全挂（0.4s / 12.3s / 27.5s），而本地基底是毫秒级就能给出的。没有熔断时，
// **模型过载期间每一次请求都要按顺序把所有候选再撞一遍** —— 用户等了半天，
// 拿到的却正是第一毫秒就能拿到的东西。熔断器的意义只有一个：**让失败路径也快**。
//
// 语义（每个 provider 独立计数）：
//   · 连续失败 FAILURE_THRESHOLD 次 → 开闸，冷却期内直接跳过该 provider（不再发起调用）；
//   · 冷却结束 → 自动半开：放行一次尝试，成功即关闸、失败即以新冷却期重新开闸；
//   · 任何一次成功 → 计数归零、关闸。
//
// Workers 的模块级状态只在单个 isolate 内有效且随时可能被回收，因此熔断是
// **优化而不是正确性依赖**：状态丢失的最坏结果只是「多试一次本来会失败的调用」，
// 绝不影响「AI 不可用时基底照常交付」这条主线。也因此它不需要持久化。
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 60 * 1000;
/** providerId -> { failures, openedAt }。openedAt 非空即处于「已开闸」状态。 */
const circuitState = new Map();

/**
 * 查询某 provider 的熔断状态。
 * @param {string} providerId
 * @param {number} now 时钟探针（测试注入；窗口轮转不可能真等 60 秒）
 * @returns {{ open: boolean, failures: number, retryAfterMs: number, halfOpen: boolean }}
 */
export function circuitStatus(providerId, now = Date.now()) {
  const state = circuitState.get(providerId);
  if (!state) return { open: false, failures: 0, retryAfterMs: 0, halfOpen: false };
  if (state.openedAt == null) {
    return { open: false, failures: state.failures, retryAfterMs: 0, halfOpen: false };
  }
  const elapsed = now - state.openedAt;
  if (elapsed >= CIRCUIT_COOLDOWN_MS) {
    // 冷却已过：半开放行（返回 open:false，调用方会真的去试一次）
    return { open: false, failures: state.failures, retryAfterMs: 0, halfOpen: true };
  }
  return { open: true, failures: state.failures, retryAfterMs: CIRCUIT_COOLDOWN_MS - elapsed, halfOpen: false };
}

/**
 * 记录一次 provider 调用的结果，驱动熔断状态机。
 *
 * 半开失败必须**重开冷却期**（而不是沿用旧 openedAt 无限期半开）——
 * 否则「到期放行一次 → 失败 → 又立刻放行」会把熔断退化成定时重试。
 */
export function recordCircuitOutcome(providerId, ok, now = Date.now()) {
  if (ok) {
    circuitState.delete(providerId);
    return;
  }
  const state = circuitState.get(providerId) || { failures: 0, openedAt: null };
  state.failures += 1;
  if (state.openedAt != null || state.failures >= CIRCUIT_FAILURE_THRESHOLD) {
    state.openedAt = now;
  }
  circuitState.set(providerId, state);
}

/** 测试专用：清空熔断状态（否则用例之间会互相开门）。 */
export function resetCircuitForTests() {
  circuitState.clear();
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

// ── AI 可用性诊断（6.8.4）────────────────────────────────────────────────
// 存在的意义：前端在云端不可用时**静默回退本地引擎**，而此前响应体里没有任何
// 字段说明「为什么没走 AI」。于是用户配了 Key、以为生效了，实际永远在跑本地，
// 却看不出原因 —— 只能来问「AI 不是已经配了 api 了吗」。
//
// 这里把「后台到底有没有 Key、每个 provider 是成功还是失败」如实报出来。
// 两条互补的入口：
//   · GET  /api/ai-brain?probe=1 → 只读自检，只回答「配了没」（零外部调用、零额度消耗）
//   · POST /api/ai-brain         → 响应体带 aiStatus，回答「为什么没用上」（含真实 HTTP 错误）
// ── provider 表（6.8.5 起模型名可配置，且带候选列表）──────────────────────
// 为什么必须有「候选列表」：**模型名会腐烂。**
//
// 6.8.5 实测发现，代码里硬编码的 `gemini-1.5-flash` 早已退役
// （Google 官方退役表里连条目都没有；连 2.0 系列也已在 2026-06-01 关停），
// 于是 Gemini 这条路**长期静默 404**，而用户在界面上完全看不出 ——
// 因为失败只写进 console.warn、徽章又无条件显示绿色。
//
// 单点硬编码一个模型名 = 一次退役就永久失效；
// 候选列表 + 环境变量覆盖，才能让「模型下线」退化成「换下一个」，
// 而不是「整条路哑掉、还没人知道」。
export const PROVIDERS = [
  {
    id: 'groq',
    label: 'Groq',
    envVar: 'GROQ_API_KEY',
    modelEnvVar: 'GROQ_MODEL',
    // 6.9.5：llama-3.3-70b-versatile 已退役 —— Groq 官方 deprecations 页：
    // 公告 2026-06-17、关停 2026-08-16，适用范围为免费/开发者档（企业合同
    // 客户除外，所以模型文档页仍挂着、标 Enterprise）。退役后对该 ID 的请求
    // 返回 404 model_not_found —— 2026-10-21 在用户的 Groq 控制台日志里
    // 实测到（Key 有效、请求进日志，但模型找不到）。
    //
    // 教训：这条路的 Key 长期 403，404 被叠在 403 后面藏了两个月没人发现 ——
    // 「从没成功过的 provider」会把下一层故障藏得严严实实，第一次真实调用
    // 才暴露模型已死。
    //
    // 替代：官方首选 openai/gpt-oss-120b，备选 openai/gpt-oss-20b ——
    // 同属 Production 档、均实测支持 JSON Object Mode；免费档 30 RPM /
    // 1K RPD / 8K TPM / 200K TPD（Groq rate-limits 页 Free Plan 表）。
    models: ['openai/gpt-oss-120b', 'openai/gpt-oss-20b'],
    url: 'https://api.groq.com/openai/v1/chat/completions',
    extraHeaders: {},
    jsonMode: true
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    envVar: 'OPENROUTER_API_KEY',
    modelEnvVar: 'OPENROUTER_MODEL',
    // 免费档候选（6.8.7 建 8 个 → 6.9.3 实测裁为 4 个）。
    //
    // 名单来源：OpenRouter 公开模型接口 /api/v1/models 实拉，
    // 2026-10-14 共 462 个模型，其中 `:free` 后缀 14 个、纯文本输出 14 个。
    // 按用途排除：coding agent（poolside/laguna-*、cohere/north-mini-code）、
    // 内容安全分类器（nemotron-3.5-content-safety，它是判别器不是生成器）、
    // 多模态感知（nemotron-3-nano-omni）。
    //
    // jsonMode 是**逐个模型**从接口的 supported_parameters 读出来的实测事实，
    // 不是猜的：对不支持 response_format 的模型发这个参数，上游直接 4xx ——
    // 同一家 provider 里混着支持与不支持，所以不能再按 provider 一把切。
    //
    // 顺序按 6.9.3 端到端基准排序（2026-10-19，8 候选 × 4 题材，
    // 走 onRequest 真实链路、每候选前重置熔断防测量污染）：
    //   · lfm-2.5-2.6b        4/4 可用，均 12.3s，16/16 镜过润色守卫
    //   · nemotron-3-super-120b 4/4 可用，均 41.5s，16/16 镜
    //   · dots-3-note-preview 4/4 可用，均 44.7s，16/16 镜
    //   · nemotron-3-ultra-550b 2/4 可用（两次 90s 超时未测到），均 21.0s，
    //     8/8 镜过守卫 —— 快但抖，放最后兜底
    // 本轮出局（0 次成功，各 3 轮全败）：gemma-4-31b / gemma-4-26b 三次
    // HTTP 429（免费配额）、inkling 三次 HTTP 403、nemotron-3.5-lightning
    // 三次 90s 超时未读完响应体（本就超生产 60s 单次上限，留也无用）。
    // 措辞纪律：这是「本次实测」，模型会腐烂；429 疑为账号级配额而非模型
    // 本身，出局可逆 —— 重跑 `node scripts/bench-openrouter.mjs` 即可重新入列。
    // 线上通过 OPENROUTER_MODEL 环境变量可强制单模型（基准同款变量）。
    models: [
      { id: 'liquid/lfm-2.5-2.6b:free', jsonMode: true },              // 4/4 · 均 12.3s · 最快
      { id: 'nvidia/nemotron-3-super-120b-a12b:free', jsonMode: true }, // 4/4 · 均 41.5s
      { id: 'dots-studio/dots-3-note-preview:free', jsonMode: true },    // 4/4 · 均 44.7s
      { id: 'nvidia/nemotron-3-ultra-550b-a55b:free', jsonMode: false }  // 2/4 · 均 21.0s · 兜底
    ],
    url: 'https://openrouter.ai/api/v1/chat/completions',
    extraHeaders: { 'HTTP-Referer': 'https://legowaruniverse.pages.dev', 'X-Title': 'LEGO War Universe' },
    jsonMode: false
  },
  {
    id: 'gemini',
    label: 'Gemini',
    envVar: 'GEMINI_API_KEY',
    modelEnvVar: 'GEMINI_MODEL',
    // 顺序按 6.8.6 发布后实测（2026-10-14，两次真实采样）重排：
    //   · gemini-3.8-flash          两次都 HTTP 503（1.8s / 0.7s 快速失败）
    //   · gemini-3.5-flash-lite     一次成功（41.4s）、一次 503 但耗了 40.5s 才失败
    //   · gemini-2.5-flash          一次成功（36.8s）
    // 把「从未成功过」的挪到最后：它失败虽快（约 1.8s），但没必要拿它开头赌。
    // 任一模型退役/过载都不会让整条路彻底哑掉，只是退化成「换下一个」。
    models: ['gemini-2.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
    url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
    extraHeaders: {},
    jsonMode: true
  }
];

/**
 * 解析某 provider 实际要尝试的模型列表。
 * 环境变量（逗号 / 分号 / 空白分隔）优先，否则用内置候选。
 * 这让「模型名退役」可以在不改代码的前提下由运维直接修掉。
 */
/**
 * 归一化模型候选条目。
 *
 * 6.8.7 起因：`jsonMode`（是否要求模型强制输出 JSON）原本是 **provider 级** 的，
 * 但 OpenRouter 上各免费模型**支持情况不一致** —— 同一家 provider 里有的模型支持
 * `response_format: json_object`，有的不支持。对不支持的模型发这个参数，
 * 上游直接 4xx，于是「明明配了 Key 却整个 provider 都跑不通」。
 * 因此把它下沉到 **模型级**：provider 级只作为未显式声明时的默认值。
 *
 * @param {string|{id:string, jsonMode?:boolean}} entry
 * @returns {{id: string, jsonMode: boolean|null}} jsonMode 为 null 表示沿用 provider 默认
 */
function normalizeModelEntry(entry) {
  if (typeof entry === 'string') return { id: entry, jsonMode: null };
  const jsonMode = entry && typeof entry.jsonMode === 'boolean' ? entry.jsonMode : null;
  return { id: String(entry && entry.id), jsonMode };
}

function modelsFor(provider, env = {}) {
  const raw = String(env[provider.modelEnvVar] == null ? '' : env[provider.modelEnvVar]).trim();
  if (raw) {
    // 环境变量覆盖只给模型名，JSON 模式沿用 provider 默认值
    return raw.split(/[,;\s]+/).map(s => s.trim()).filter(Boolean).map(normalizeModelEntry);
  }
  return provider.models.map(normalizeModelEntry);
}

// ── 超时与总预算（6.8.6）────────────────────────────────────────────────
// 起因：6.8.5 修好模型名之后，Gemini 这条路**真的通了** —— 于是线上出现了新症状：
// 「点一次深度转译，页面长时间没反应」。实测线上（2026-10-13）：
//   · requestedShots=1 → HTTP 200，但耗时 30.7s / 59.0s 两次；
//   · requestedShots=4 → 客户端 60s / 90s 都没等到，看起来就是死机。
//
// 也就是说：**它不是挂死，是真的很慢**；但代码里的 fetch **完全没有超时**，
// 于是「慢」和「挂死」在行为上完全一样 —— 上游一旦不返回，请求就永远挂着，
// 前端既不报错也不回退，用户只能干等。
//
// 加两层上限，且都可用环境变量覆盖（默认值不合适时不必改代码）：
//   · AI_PROVIDER_TIMEOUT_MS —— 单次模型调用上限，一次上游卡死不会吃掉整次请求；
//   · AI_REQUEST_BUDGET_MS   —— 整次请求总预算，无论多少 provider / 候选模型，总时长有界。
//
// 默认值刻意给得比实测耗时宽松（单次 60s / 总计 120s）：
// 先把「无界」变成「有界」并**测出真实耗时分布**，再依据数据收紧 ——
// 而不是凭感觉定一个会把当前可用路径掐死的数字。
const DEFAULT_PROVIDER_TIMEOUT_MS = 60000;
const DEFAULT_REQUEST_BUDGET_MS = 120000;

/** 解析超时配置：环境变量优先，非法值一律退回默认。 */
function timeoutsFor(env = {}) {
  const positive = (value, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    perModelMs: positive(env.AI_PROVIDER_TIMEOUT_MS, DEFAULT_PROVIDER_TIMEOUT_MS),
    totalMs: positive(env.AI_REQUEST_BUDGET_MS, DEFAULT_REQUEST_BUDGET_MS)
  };
}

/**
 * 给任意 Promise 加超时，超时后触发 onTimeout（用于 abort 底层连接）。
 *
 * 两个细节都不能省，否则会引入新 bug：
 *   1. 必须给原始 promise 挂一个空 catch。Promise.race 一旦被 guard 抢先结束，
 *      原始 promise 之后再 reject（abort 触发的 AbortError）就没有接收者，
 *      会变成 unhandled rejection —— Node 会直接让测试进程失败。
 *   2. onTimeout 只在**真的超时**时才调用，不能在 finally 里无条件调用。
 */
async function withTimeout(promise, timeoutMs, onTimeout) {
  let timer = null;
  let timedOut = false;
  const guard = new Promise((_, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      reject(new Error(`TIMEOUT_${timeoutMs}ms`));
    }, timeoutMs);
  });
  promise.catch(() => { /* 见上：避免 race 结束后再抛成为 unhandled rejection */ });
  try {
    return await Promise.race([promise, guard]);
  } finally {
    clearTimeout(timer);
    if (timedOut && typeof onTimeout === 'function') onTimeout();
  }
}

const isTimeoutError = (err) => /^TIMEOUT_\d+ms$/.test(String(err && err.message ? err.message : ''));

/**
 * 把 provider 的原始 HTTP 错误翻译成「人话 + 下一步怎么办」。
 * 光有 `Groq HTTP 403` 用户仍然不知道该干什么 —— 这一层才是可操作的信息。
 */
function adviseProviderError(provider, model, message) {
  // 超时没有 HTTP 状态码，必须单独判，否则会掉进兜底那句无信息量的「调用失败」。
  if (/超时/.test(String(message == null ? '' : message))) {
    return `${provider.label} 在限定时间内没有返回（超时）：多半是该模型当前排队严重或上游卡住。可以换更快的模型（环境变量 ${provider.modelEnvVar}），或调大 AI_PROVIDER_TIMEOUT_MS。`;
  }
  const matched = /HTTP (\d{3})/.exec(String(message == null ? '' : message));
  const status = matched ? Number(matched[1]) : null;
  if (status === 401) {
    return `${provider.label} 拒绝了这把 Key（401 未授权）：请到控制台重新生成并完整复制（注意别带多余空格），然后更新环境变量 ${provider.envVar} 并重新部署。`;
  }
  if (status === 403) {
    return `${provider.label} 拒绝了这把 Key（403 禁止访问）：常见原因是 Key 无效 / 已撤销 / 账户受限或未完成验证 / 所在地区不支持。请到控制台确认 Key 状态，或换一把新 Key。`;
  }
  if (status === 404) {
    return `${provider.label} 找不到模型「${model}」（404）：多半是这个模型名已经退役。用环境变量 ${provider.modelEnvVar} 指定一个当前可用的模型名即可，无需改代码。`;
  }
  if (status === 429) {
    return `${provider.label} 额度用尽或触发限流（429）：换一个 provider，或等额度重置。`;
  }
  if (status === 413) {
    return `${provider.label} 提示请求体积过大（413）：可减少镜头数或资产目录后再试。`;
  }
  return `${provider.label} 调用失败：${message}`;
}

/**
 * 密钥掩码：只保留长度与后四位，**绝不返回密钥本身**。
 * 后四位足以让用户确认「这是我新配的那把 key」，而不构成泄露。
 */
function maskKey(value) {
  const key = String(value == null ? '' : value);
  if (!key) return null;
  return key.length <= 4 ? `••••（长度 ${key.length}）` : `••••${key.slice(-4)}（长度 ${key.length}）`;
}

/** 每个 provider 的「配置态」报告（不发起任何外部调用）。 */
function providerReport(env = {}) {
  return PROVIDERS.map(p => ({
    id: p.id,
    envVar: p.envVar,
    modelEnvVar: p.modelEnvVar,
    // 自检只报模型名（保持对外契约稳定）；每个模型是否要求 JSON 模式
    // 从条目里解析出来一并带出，方便运维核对上游支持情况。
    models: modelsFor(p, env).map(m => m.id),
    jsonModes: modelsFor(p, env).map(m => (m.jsonMode === null ? Boolean(p.jsonMode) : m.jsonMode)),
    configured: Boolean(env[p.envVar]),
    keyHint: maskKey(env[p.envVar])
  }));
}

/**
 * 汇总本次请求的 AI 使用结论。
 * @param {Array} attempts 逐个 provider 的尝试记录（含各自的 calls 逐次耗时）
 * @param {object} env 运行时环境变量
 * @param {object} meta 本次请求的预算 / 耗时 / 熔断 / 润色信息
 */
function buildAiStatus(attempts, env = {}, meta = {}) {
  const configured = PROVIDERS.filter(p => env[p.envVar]).length;
  const won = attempts.find(a => a.ok) || null;
  // 6.8.9 → 6.9.0：模型如实回答「查无此片」不再是故障路径，而是「元数据留空、
  // 润色照常」的结论。unrecognized 作为透明标记回传，不再单独构成 reason。
  const unrecognized = attempts.find(a => a.unrecognized) || null;
  const breakerSkipped = Array.isArray(meta.breakerSkipped) ? meta.breakerSkipped : [];
  const polish = meta.polish || null;
  // 云端返回了、但没有任何一字段通过合并守卫：必须与「润色成功」和
  // 「全部失败」都区分开 —— 否则「AI 没润成」会显示成「润色成功」。
  const polishRejected = Boolean(won) && Boolean(polish) && polish.merged === 0;
  const allBreakerSkipped = breakerSkipped.length > 0
    && attempts.filter(a => a.configured).length > 0
    && attempts.filter(a => a.configured).every(a => breakerSkipped.includes(a.id));

  const reason = polishRejected ? 'POLISH_REJECTED'
    : won ? 'OK'
      : allBreakerSkipped ? 'CIRCUIT_OPEN'
        : (configured === 0 ? 'NO_KEYS_CONFIGURED' : 'ALL_PROVIDERS_FAILED');

  // 「哪个模型慢、哪个模型挂」必须能从响应里直接读出来 ——
  // 这正是 6.8.6 之前读不出来的东西：attemptedModels 只记了名字，
  // 记不下「这个名字失败了、失败在哪、花了多久」。
  const calls = attempts.flatMap(a => (a.calls || []).map(c => ({ provider: a.id, ...c })));
  const timedOutCalls = calls.filter(c => c.timedOut);
  const budgetExhausted = Boolean(meta.budgetExhausted);

  let hint;
  if (polishRejected) {
    hint = '云端模型返回了内容，但没有任何一个字段通过润色合并守卫（未知角色代号 / 文本超长 / 镜头对不上，明细见响应体 polish.rejected）。本次交付未润色的本地基底，内容完全可用。';
  } else if (won) {
    hint = null;
  } else if (configured === 0) {
    hint = '后台未配置任何模型 Key，本次由本地引擎生成。启用云端 AI：Cloudflare Pages → Settings → Environment variables → Production 配置 GROQ_API_KEY（类型选 Secret），然后重新部署。';
  } else if (allBreakerSkipped) {
    hint = '模型通道连续失败，已进入熔断冷却期，本次跳过云端调用、直接交付本地基底（毫秒级出片，不再空等）。冷却结束后会自动重试；若持续失败，请按各 provider 的 advice 检查 Key 与模型可用性。';
  } else {
    hint = '后台已配置模型 Key，但本次调用全部失败 —— 请看 providers 里每个 provider 的 advice 字段（已把 HTTP 状态码翻译成具体怎么办：401/403=Key 被拒绝，404=模型名可能已退役，429=额度或限流）。本地基底分镜不受影响。';
    if (timedOutCalls.length) {
      hint += ` 另有 ${timedOutCalls.length} 次是**超时**（${timedOutCalls.map(c => `${c.provider}/${c.model}`).join('、')}）：说明该模型排队严重或上游卡住，可换更快的模型或调大 AI_PROVIDER_TIMEOUT_MS。`;
    }
    if (budgetExhausted) {
      hint += ' 本次请求还触发了总预算上限（AI_REQUEST_BUDGET_MS），后续候选模型未再尝试。';
    }
  }

  return {
    aiAvailable: Boolean(won),
    reason,
    activeProvider: won ? won.id : null,
    // 6.8.9：输入未被模型识别为真实影片时如实标记（防幻觉标记，非故障信号）
    unrecognized: Boolean(unrecognized),
    configuredCount: configured,
    providers: attempts,
    // 6.9.0：熔断跳过与润色账本也必须可见 —— 否则「跳过了几个模型」
    // 「润色到底进没进」这两个用户最关心的问题又只能靠猜。
    breakerSkipped,
    polish: polish ? { merged: polish.merged, kept: polish.kept, rejectedTotal: polish.rejectedTotal ?? 0 } : null,
    // ── 6.8.6：让「慢」可测量 ────────────────────────────────────────
    // 有了逐次耗时，才能回答「到底是哪个模型慢/挂」，
    // 而不是像 6.8.4 那样拿总耗时（latencyMs=193）去反推结论、反推出错。
    calls,
    timedOut: timedOutCalls.length > 0,
    timedOutCalls: timedOutCalls.map(c => ({ provider: c.provider, model: c.model, ms: c.ms })),
    budgetExhausted,
    budgetMs: meta.budgetMs == null ? null : meta.budgetMs,
    elapsedMs: meta.elapsedMs == null ? null : meta.elapsedMs,
    hint
  };
}

/** GET /api/ai-brain?probe=1 的响应体：只读、无副作用、不泄露密钥。 */
function buildProbeReport(env = {}) {
  const providers = providerReport(env);
  const anyConfigured = providers.some(p => p.configured);
  const { perModelMs, totalMs } = timeoutsFor(env);
  return {
    ok: true,
    probe: true,
    aiAvailable: anyConfigured,
    configuredCount: providers.filter(p => p.configured).length,
    providerOrder: PROVIDERS.map(p => p.id),
    providers,
    // 6.9.0：熔断状态必须能在自检里直接看到 —— 否则「为什么这次没试 Gemini」
    // 只能靠猜。状态是 isolate 内尽力而为，丢了最坏只是多试一次。
    circuit: Object.fromEntries(PROVIDERS.map(p => [p.id, circuitStatus(p.id)])),
    // 6.8.6：超时与预算是「为什么慢/为什么没反应」的直接答案，必须能一眼看到当前生效值。
    timeouts: {
      perModelMs,
      totalMs,
      perModelEnvVar: 'AI_PROVIDER_TIMEOUT_MS',
      totalEnvVar: 'AI_REQUEST_BUDGET_MS'
    },
    diagnosis: anyConfigured
      ? '后台至少配置了一个模型 Key。若「深度转译」仍显示本地引擎，请点一次「深度转译」，响应里的 aiStatus.providers[].calls 会逐次给出每个模型的耗时与真实失败原因（401=Key 无效，429=额度或限流，404=模型不可用，超时=该模型排队严重）。'
      : '后台没有配置任何模型 Key（GROQ_API_KEY / OPENROUTER_API_KEY / GEMINI_API_KEY 均为空），因此所有生成都会走本地引擎 —— 功能完整、不联网、不花钱。想启用云端 AI，请按 howToFix 操作。',
    howToFix: [
      'Cloudflare 控制台 → 你的 Pages 项目 → Settings → Environment variables → Production',
      '新增 GROQ_API_KEY，类型必须选 Secret（加密），不要选 Text',
      '点一次 Redeploy / 重新部署 —— 环境变量改动不重新部署不生效（最高频的坑）',
      '重新打开本地址，确认对应 provider 的 configured 变成 true'
    ],
    docs: 'docs/AI启用时机与配置.md',
    note: '本接口只报告 Key 是否存在（掩码显示后四位与长度），绝不返回密钥本身，也不会发起任何外部请求、不消耗任何额度。'
  };
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

/** 把确定性阵容渲染成 Prompt 片段（真实资产 + 固定代号） */
function buildCastSection(castRoster) {
  const lines = castRoster ? rosterPromptLines(castRoster) : [];
  if (!lines.length) return '';
  return `
【本片固定阵容（由系统从资产库确定性挑选，代号全片固定）】
${lines.join('\n')}
`;
}

/**
 * 确保敌方阵营真的上镜。
 *
 * 6.9.0 起作用点前移：**AI 调用之前**先修基底，再把修好的基底交给 AI 润色。
 * 为什么必须保留这道守卫：实测本地规划器对部分题材（如「现代特战城市巷战」）
 * 产出的名册里敌方为 0 —— 结构冻结之后，AI 也没有机会再补。若删掉它，
 * 「敌对双方都要出场」这条产品不变式会直接回归。
 *
 * 大模型（旧模式）常常「只在台词里提敌人，subjects 里却全是友军」；
 * 本地规划器则是「名册里就没挑敌方」。两种病、同一味药：只在
 * 「build / climax 阶段 + 动作已含交战语义 + 主体不足 3 个」的镜头上补入敌军，
 * 既不触发阵营冲突校验（对立阵营同框必须有对抗动作），也不会挤掉已有主体。
 *
 * 交战语义必须复用 shot-spec 的 hasHostileFraming，绝不能自己再写一份正则：
 * 两份判定不一致时，补进去的镜头会直接在校验阶段报 FACTION_CONFLICT_INVALID。
 */
export function ensureOpposingPresence(shots = [], opposingIds = []) {
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
 * 调一次指定 provider 的指定模型。
 *
 * 6.8.5 起由「每个 provider 一个写死模型的函数」改为「通用函数 + 模型候选列表」——
 * 起因是 `gemini-1.5-flash` 退役后整条路静默 404，而模型名硬编码在函数体里，
 * 除了改代码没有任何办法修。现在模型名来自 PROVIDERS / 环境变量，可运维。
 *
 * 失败时抛出带 provider 名与 HTTP 状态码的错误，供 aiStatus 诊断字段使用。
 *
 * 6.8.6 起**每一次网络等待都有上限**：响应头、响应体分别计时，
 * 超时既 abort 底层连接、也抛出可读的错误（否则「慢」与「挂死」行为一致）。
 */
export async function callProviderModel(provider, model, systemPrompt, userPrompt, apiKey, timeoutMs, jsonMode) {
  const body = {
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.7
  };
  // 6.8.7：jsonMode 由**模型级**条目解析后传入，不再读 provider.jsonMode ——
  // OpenRouter 的免费模型对这个参数支持不一致，provider 级一把切会让
  // 「不支持的模型」整个 provider 都失败。
  if (jsonMode) body.response_format = { type: 'json_object' };

  const controller = new AbortController();
  const abort = () => { try { controller.abort(); } catch { /* abort 失败不影响超时语义 */ } };

  let res;
  try {
    res = await withTimeout(fetch(provider.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        ...provider.extraHeaders
      },
      body: JSON.stringify(body),
      signal: controller.signal
    }), timeoutMs, abort);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(`${provider.label} 超时：${timeoutMs}ms 内未返回响应头（模型「${model}」）`);
    }
    throw err;
  }

  if (!res.ok) throw new Error(`${provider.label} HTTP ${res.status}`);

  let data;
  try {
    // 响应头到了不代表响应体到齐：流式响应可能卡在传输中途，这里同样要计时。
    data = await withTimeout(res.json(), timeoutMs, abort);
  } catch (err) {
    if (isTimeoutError(err)) {
      throw new Error(`${provider.label} 超时：${timeoutMs}ms 内未读完响应体（模型「${model}」）`);
    }
    throw err;
  }

  const content = data.choices?.[0]?.message?.content;
  return cleanAndParseJson(content);
}

/**
 * 跑一次「云端润色」尝试（转译模式与计划模式共用同一条多通道故障转移链）。
 *
 * 与 6.8.x 的内联循环的差别：
 *   1. 抽成函数 —— 两个模式（/api/ai-brain 转译、mode:'plan' 自由模式）共用，
 *      否则同一套熔断 + 候选 + 预算逻辑会写两份然后漂移；
 *   2. 熔断开闸的 provider 直接跳过，不再发起调用（线上 503 风暴时每次请求
 *      原本要把所有候选再撞一遍，用户白等几十秒拿到毫秒级就能给的东西）；
 *   3. recognized:false 不再把成功调用作废 —— 6.9.0 起它只意味着「元数据留空」，
 *      润色照常进行（详见 polish-contract 的识别判定段）。
 *
 * @returns {{ result: object|null, usedEngine: string|null, attempts: Array, budgetExhausted: boolean, breakerSkipped: string[] }}
 */
async function attemptCloudPolish({ systemPrompt, userPrompt, env = {}, perModelMs, totalMs }) {
  const deadline = Date.now() + totalMs;
  let result = null;
  let usedEngine = null;
  let budgetExhausted = false;
  const breakerSkipped = [];

  // 逐个 provider 的尝试记录 —— 这是「为什么没用上 AI」的唯一证据来源。
  const attempts = PROVIDERS.map(p => ({
    id: p.id,
    envVar: p.envVar,
    modelEnvVar: p.modelEnvVar,
    configured: Boolean(env[p.envVar]),
    tried: false,
    skipped: false,
    ok: false,
    model: null,
    ms: null,
    attemptedModels: [],
    calls: [],
    totalMs: 0,
    error: null,
    advice: null
  }));

  for (const provider of PROVIDERS) {
    if (result || budgetExhausted) break;
    const record = attempts.find(a => a.id === provider.id);
    if (!record.configured) continue;

    // 熔断开闸期内直接跳过：不再发起注定失败的调用。
    // 跳过本身不记失败（不能拿熔断自己的跳过延续熔断），只如实记账。
    const circuit = circuitStatus(provider.id);
    if (circuit.open) {
      record.skipped = true;
      record.error = `熔断中：连续失败 ${circuit.failures} 次，${Math.ceil(circuit.retryAfterMs / 1000)} 秒后自动重试`;
      record.advice = '该模型通道连续失败，已进入熔断冷却期，本次直接跳过（不再空等）；本地基底分镜照常交付。';
      breakerSkipped.push(provider.id);
      continue;
    }

    const models = modelsFor(provider, env);
    record.tried = true;
    record.attemptedModels = models.map(m => m.id);
    let lastError = null;

    for (const entry of models) {
      const model = entry.id;
      // 6.8.7：JSON 模式按模型解析 —— 模型没显式声明就沿用 provider 默认。
      const jsonMode = entry.jsonMode === null ? Boolean(provider.jsonMode) : entry.jsonMode;
      // 开始下一次调用之前先看预算：剩余时间不够就不要再发起，
      // 否则「总预算」只是装饰 —— 一次 60s 的调用就能把 120s 的预算吃掉一半以上。
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        budgetExhausted = true;
        record.calls.push({ model, ok: false, ms: 0, error: '跳过：整次请求总预算已耗尽', timedOut: false, skipped: true });
        break;
      }
      // 单次上限再被剩余预算夹一次，保证「总时长有界」是硬保证。
      const callTimeout = Math.min(perModelMs, remaining);
      const callStart = Date.now();

      try {
        result = await callProviderModel(provider, model, systemPrompt, userPrompt, env[provider.envVar], callTimeout, jsonMode);
        const ms = Date.now() - callStart;
        record.calls.push({ model, ok: true, ms, error: null, timedOut: false, skipped: false });
        recordCircuitOutcome(provider.id, true);
        // 6.8.9 → 6.9.0：模型如实回答「查无此片」不再是「作废这次调用」，
        // 而是「元数据留空、润色照常」的结论。unrecognized 只作为透明标记随
        // aiStatus 回传，前端据此提示「未识别为已知影片」。
        if (result && result.recognized === false) record.unrecognized = true;
        usedEngine = `${provider.label} (${model})`;
        record.ok = true;
        record.model = model;
        record.ms = ms;
        break;
      } catch (e) {
        const ms = Date.now() - callStart;
        lastError = e;
        recordCircuitOutcome(provider.id, false);
        record.calls.push({
          model,
          ok: false,
          ms,
          error: e.message,
          timedOut: /超时/.test(e.message),
          skipped: false
        });
        console.warn(`${provider.id}/${model} 调度失败（${ms}ms）:`, e.message);
      }
    }

    record.totalMs = record.calls.reduce((sum, c) => sum + (c.ms || 0), 0);
    if (!record.ok && !record.skipped && lastError) {
      record.error = lastError.message;
      // 把 HTTP 状态码 / 超时翻译成「人话 + 下一步怎么办」——
      // 光有 `Groq HTTP 403` 用户仍然不知道该干什么。
      record.advice = adviseProviderError(provider, models[models.length - 1].id, lastError.message);
    }
  }

  return { result, usedEngine, attempts, budgetExhausted, breakerSkipped };
}

/** 把一次润色合并的结果整理成响应体里的「如实账本」 */
function polishStats(merged, diversified, functioned, usedEngine) {
  return {
    model: usedEngine,
    merged: merged.merged,
    kept: merged.kept,
    applied: merged.applied,
    rejected: merged.rejected.slice(0, 8),
    rejectedTotal: merged.rejected.length,
    callsignGuard: merged.callsignGuard,
    repetitionFixed: diversified.fixed,
    functionRetagged: functioned.retagged,
    monotoneGuard: functioned.monotone
  };
}

export async function onRequest({ request, env = {} }) {
  const startTime = Date.now();
  const headers = cors(request, env);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type'
      }
    });
  }

  // 只读自检：GET /api/ai-brain?probe=1
  // 必须在 405 之前拦截，但不能放宽「非 POST 一律 405」的既有契约 ——
  // 因此只认带 probe 参数的 GET，其余方法原样 405。
  const url = new URL(request.url);
  const isProbe = request.method === 'GET' && url.searchParams.has('probe');

  if (!isProbe && request.method !== 'POST') {
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405, headers);
  }

  // 基础限流保护（probe 与生成共用同一窗口）
  const clientIp = request.headers.get('cf-connecting-ip') || 'anonymous';
  const rl = checkRateLimit(clientIp);
  if (rl.limited) {
    return json({ error: 'RATE_LIMITED', retryAfterMs: rl.retryAfterMs }, 429, headers);
  }

  if (isProbe) {
    return json(buildProbeReport(env), 200, headers);
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

  // ── 6.9.0：基底先行 ────────────────────────────────────────────────────
  // 无论 AI 是否可用，先用确定性本地引擎产出完整分镜：真实资产、固定代号、
  // 节拍弧、连续性、戏剧功能，全部已过校验。AI 的职责从「生成整部电影」
  // 收缩为「润色三个文本字段」—— 结构冻结，幻觉面随之塌缩。
  // 详见 src/domain/polish-contract.js 的契约说明。
  const intent = parseIntent(query);
  const catalog = buildAssetCatalog(ASSET_REGISTRY, { era: intent.era, keywords: query });
  const catalogText = formatCatalogForPrompt(catalog);
  const validIds = collectValidIds(ASSET_REGISTRY);
  const { perModelMs, totalMs } = timeoutsFor(env);

  // ── mode:'plan'：自由战术分镜（前端本地出基底，云端只润色文案）────────
  // 前端拿 planVariants 的四方案是毫秒级、可离线的；把当前方案的基底发来，
  // 后端只做「AI 润色」这一件事。两边都不重复实现对方的核心能力。
  if (body.mode === 'plan') {
    const baseShots = Array.isArray(body.base?.shots) ? body.base.shots : [];
    if (baseShots.length < 1 || baseShots.length > 12) {
      return json({ error: 'INVALID_BASE', message: 'base.shots 必须是 1–12 个镜头的数组' }, 400, headers);
    }
    const baseRoster = Array.isArray(body.base?.roster) ? body.base.roster : [];
    const allowedCallsigns = callsignSetOfRoster(baseRoster);
    const castText = baseRoster.length ? buildCastSection(rosterFromJSON(baseRoster)) : '';
    const systemPrompt = buildPolishSystemPrompt({
      catalogText, era: intent.era, castText, recognize: false
    });
    const userPrompt = buildPolishUserPrompt({
      query, requestedShots: baseShots.length, baseShots, recognize: false
    });

    const planAttempt = await attemptCloudPolish({ systemPrompt, userPrompt, env, perModelMs, totalMs });

    let planShots = baseShots;
    let planPolish = null;
    if (planAttempt.result) {
      const merged = mergePolish(baseShots, planAttempt.result, { allowedCallsigns });
      const diversified = diversifyShots(merged.shots);
      const functioned = tagDramaticFunctions(diversified.shots);
      planShots = functioned.shots;
      planPolish = polishStats(merged, diversified, functioned, planAttempt.usedEngine);
    }
    // 合并后再回填一次状态：润色全部被守卫拒绝时，reason 必须是 POLISH_REJECTED
    // 而不是 OK —— 否则「云端返回了但一字段都没进来」会显示成润色成功。
    const planStatusFinal = buildAiStatus(planAttempt.attempts, env, {
      budgetExhausted: planAttempt.budgetExhausted,
      budgetMs: totalMs,
      perModelMs,
      elapsedMs: Date.now() - startTime,
      breakerSkipped: planAttempt.breakerSkipped,
      polish: planPolish
    });

    const planBody = {
      ok: true,
      mode: 'plan',
      shots: planShots,
      polish: planPolish,
      latencyMs: Date.now() - startTime,
      aiStatus: planStatusFinal
    };
    const governedPlan = governResponse(planBody, inputGovernance);
    return json(governedPlan.body, governedPlan.status, headers);
  }

  // 确定性阵容：只为「敌方登场守卫」提供对立阵营 ID。
  // 注意 prompt 里的固定阵容**不**用它 —— 那必须来自基底自己的名册，
  // 否则会告诉模型一套基底里并不存在的代号。
  const cast = REGISTRY ? selectCast(REGISTRY, { era: intent.era || 'Modern', task: 'combat', theme: query }) : null;
  const castIds = cast ? [...cast.heroes, ...cast.enemies, ...cast.vehicles].map(a => a.id) : [];
  const castRoster = REGISTRY && castIds.length ? buildRoster([{ subjects: castIds }], REGISTRY) : null;
  const opposingIds = castRoster ? castRoster.opposing.map(e => e.id) : [];

  // ── 基底：策展复刻（手写、事实元数据）或自主想象（按题材原创）──────────
  const curated = matchCuratedFilm(query);
  let base = null;
  if (curated.film) {
    const local = transpileMovieToLego(query, requestedShots, REGISTRY);
    base = {
      kind: 'curated',
      shots: local.shots,
      roster: Array.isArray(local.roster) ? local.roster : [],
      matchedMovie: local.matchedMovie,
      movieId: local.movieId,
      matchKind: local.matchKind,
      director: local.director,
      year: local.year,
      genre: local.genre,
      dramaticConflict: local.dramaticConflict,
      visualGrammar: local.visualGrammar,
      legoAdaptation: local.legoAdaptation,
      creatorTips: local.creatorTips,
      themeZh: local.themeZh,
      originality: local.originality || null,
      era: local.era || intent.era,
      // 手写库的元数据是影片自身的事实，绝不拿去问 AI —— 问就等于把
      // 「事实陈述」降级成「模型回忆」，平白制造幻觉面。
      recognize: false,
      engineOffline: OFFLINE_ENGINES.curated,
      enginePolished: '润色策展复刻'
    };
  } else {
    const generated = generateLocally({ theme: query, requestedShots, registry: REGISTRY });
    if (generated) {
      // 敌方登场守卫必须作用在**AI 之前**：实测本地规划器对「现代特战城市巷战」
      // 这类题材产出的名册里敌方为 0。结构冻结之后 AI 没机会补，所以这里补。
      const foeFixed = ensureOpposingPresence(generated.shots, opposingIds);
      base = {
        kind: 'generated',
        shots: foeFixed.shots,
        roster: Array.isArray(generated.roster) ? generated.roster : [],
        matchedMovie: null,
        movieId: null,
        matchKind: 'none',
        director: null,
        year: null,
        genre: generated.genre,
        dramaticConflict: null,
        visualGrammar: null,
        legoAdaptation: null,
        creatorTips: null,
        themeZh: generated.themeZh,
        originality: generated.originality || null,
        era: generated.era || intent.era,
        variants: generated.variants || [],
        variant: generated.variant || null,
        score: generated.score || null,
        recognize: true,
        engineOffline: OFFLINE_ENGINES.generated,
        enginePolished: '润色本地基底'
      };
    }
  }

  // 极端兜底：连基底都产不出来（注册表缺失等），仍要出片，且如实标注
  if (!base) {
    const fallback = transpileMovieToLego(query, requestedShots, REGISTRY, { genericFallback: true });
    base = {
      kind: 'curated',
      shots: fallback.shots,
      roster: Array.isArray(fallback.roster) ? fallback.roster : [],
      matchedMovie: fallback.matchedMovie,
      movieId: fallback.movieId,
      matchKind: fallback.matchKind,
      director: fallback.director,
      year: fallback.year,
      genre: fallback.genre,
      dramaticConflict: fallback.dramaticConflict,
      visualGrammar: fallback.visualGrammar,
      legoAdaptation: fallback.legoAdaptation,
      creatorTips: fallback.creatorTips,
      themeZh: fallback.themeZh,
      originality: fallback.originality || null,
      era: fallback.era || intent.era,
      recognize: false,
      engineOffline: `${OFFLINE_ENGINES.curated} · 生成引擎不可用，已退回通用军事分镜`,
      enginePolished: '润色策展复刻'
    };
  }

  // ── 云端润色尝试（熔断 + 多通道故障转移）──────────────────────────────
  const castText = base.roster.length ? buildCastSection(rosterFromJSON(base.roster)) : '';
  const systemPrompt = buildPolishSystemPrompt({
    catalogText, era: base.era || intent.era, castText, recognize: base.recognize
  });
  const userPrompt = buildPolishUserPrompt({
    query, requestedShots: base.shots.length, baseShots: base.shots, recognize: base.recognize
  });

  const attempt = await attemptCloudPolish({ systemPrompt, userPrompt, env, perModelMs, totalMs });

  // ── 合并：结构冻结，只放行三个文本字段 ────────────────────────────────
  const allowedCallsigns = callsignSetOfRoster(base.roster);
  let shots = base.shots;
  let polish = null;
  if (attempt.result) {
    const merged = mergePolish(base.shots, attempt.result, { allowedCallsigns });
    const diversified = diversifyShots(merged.shots);
    const functioned = tagDramaticFunctions(diversified.shots);
    shots = functioned.shots;
    polish = polishStats(merged, diversified, functioned, attempt.usedEngine);
  }

  // 6.8.9 防幻觉的最终形态：元数据只可能来自两个可信来源 ——
  //   ① 手写策展库的影片事实；② 模型对「它确切知道的真实影片」的回答。
  // recognized:false 或 AI 不可用时，director/year 一律留空，绝不现编。
  const recognized = Boolean(attempt.result) && attempt.result.recognized !== false;
  const aiResult = recognized ? attempt.result : null;
  const metadata = base.kind === 'curated'
    ? {
      matchedMovie: base.matchedMovie, movieId: base.movieId, matchKind: base.matchKind,
      director: base.director, year: base.year, genre: base.genre,
      dramaticConflict: base.dramaticConflict, visualGrammar: base.visualGrammar,
      legoAdaptation: base.legoAdaptation, creatorTips: base.creatorTips
    }
    : {
      matchedMovie: aiResult?.matchedMovie || null,
      movieId: null,
      matchKind: 'none',
      director: aiResult?.director || null,
      year: aiResult?.year || null,
      genre: aiResult?.genre || base.genre,
      dramaticConflict: aiResult?.dramaticConflict || null,
      visualGrammar: aiResult?.visualGrammar || null,
      legoAdaptation: aiResult?.legoAdaptation || null,
      creatorTips: aiResult?.creatorTips || null
    };

  // 名册以基底代号为准重建（prior）：老 ID 沿用旧代号，守卫补入的敌军拿到新代号。
  // 绝不能用 selectCast 的名册做 prior —— 那会改写基底台词里的称呼。
  const finalRoster = REGISTRY ? buildRoster(shots, REGISTRY, { prior: base.roster }) : null;

  const latencyMs = Date.now() - startTime;
  const polished = Boolean(polish) && polish.merged > 0;
  const engine = polished
    ? `Cloud Free AI (${attempt.usedEngine}) · ${base.enginePolished}`
    : base.engineOffline;

  const aiStatus = buildAiStatus(attempt.attempts, env, {
    budgetExhausted: attempt.budgetExhausted,
    budgetMs: totalMs,
    perModelMs,
    elapsedMs: latencyMs,
    breakerSkipped: attempt.breakerSkipped,
    polish
  });

  // 资产引用全部来自基底（真实 ID），这里如实统计而不是假装匹配过
  const usedIds = shots.flatMap(s => [
    ...(Array.isArray(s.subjects) ? s.subjects : []),
    s.environment, s.camera, s.lighting, s.colorGrade,
    ...(Array.isArray(s.fx) ? s.fx : []), ...(Array.isArray(s.audio) ? s.audio : [])
  ]).filter(Boolean);

  const engineNote = polished ? base.enginePolished : '本地引擎';
  const titleSource = base.kind === 'curated' ? base.matchedMovie : (metadata.matchedMovie || query);
  const responseBody = {
    ok: true,
    ...metadata,
    contentKind: base.kind === 'curated' ? 'curated' : 'generated',
    themeZh: `【${titleSource || query} · ${engineNote}】${(shots[0]?.action || '').slice(0, 35)}…`,
    shots,
    originality: (base.kind === 'generated' && aiResult?.originality) || base.originality || null,
    roster: finalRoster ? rosterToJSON(finalRoster) : base.roster,
    variant: base.variant || null,
    variants: base.variants || [],
    score: base.score ?? null,
    // 6.9.0：润色过程的如实账本（合并了几镜、拒绝了几字段、为什么）
    polish,
    repetitionFixed: polish?.repetitionFixed || 0,
    functionRetagged: polish?.functionRetagged || 0,
    monotoneGuard: polish?.monotoneGuard || false,
    isAiGenerated: polished,
    engine,
    era: base.era || intent.era,
    assetUsage: {
      catalogSize: validIds.size,
      matched: usedIds.filter(id => validIds.has(id)).length,
      unknown: [...new Set(usedIds.filter(id => !validIds.has(id)))]
    },
    // 模型建议新增、但资产库暂缺的现代/未来战争装备 —— 交给前端进化引擎锻造落地
    proposedAssets: Array.isArray(attempt.result?.proposedAssets) ? attempt.result.proposedAssets.slice(0, 8) : [],
    latencyMs,
    aiStatus
  };
  const governed = governResponse(responseBody, inputGovernance);
  return json(governed.body, governed.status, headers);
}
