# 06_Deploy — 部署与 AI 配置

> **本文档 6.8.3 重写。**
> 旧版本描述的是一套**代码里并不存在**的系统：它说 AI 端点是 `/api/compose`、
> 有 10 个 provider、支持 `MODELS` / `ROTATE` / `TIMEOUT_MS` 等变量、网页里有
> 「启用 AI 增强」勾选框 —— 这些**全都不存在**。照着配会白忙一场。
> 重写依据是对 `functions/` 与 `src/` 的逐行核对，下面每条都能在代码里找到出处。

**想直接看「什么时候会用 AI + 怎么配 Key」，请读
[`docs/AI启用时机与配置.md`](../docs/AI启用时机与配置.md)。** 本文只讲部署面的东西。

---

## 一、这个仓库里真实存在的两套后端

两套都是 **Cloudflare Pages Functions**，都挂在同源路径下，前端写死调用，不需要填地址：

| 路径 | 源文件 | 是否用 AI | 读哪些环境变量 |
| --- | --- | --- | --- |
| `POST /api/ai-brain` | `functions/api/ai-brain.js` | **是**（唯一会用云端 AI 的端点） | `GROQ_API_KEY` / `OPENROUTER_API_KEY` / `GEMINI_API_KEY` |
| `POST /api/compose` | `functions/api/compose.js` | **否**，纯本地规划器 | 只有 `ALLOWED_ORIGIN` / `ENVIRONMENT` / `AUTH_MODE` |

`/api/compose` 一个模型 Key 都不读 —— 它走的是 `src/domain/` 里的确定性规划器
（`planFilm` → `compileShot` → `checkContentGovernance`），毫秒级、免费、可复现。

> 前端目前只调 `/api/ai-brain`。`/api/compose` 保留给外部工具/自建前端使用。

---

## 二、AI 怎么配

见 [`docs/AI启用时机与配置.md`](../docs/AI启用时机与配置.md)。三句话版本：

1. 生产：Cloudflare Pages → Settings → Environment variables → 加 `GROQ_API_KEY`
   （类型选 **Secret**）→ **Redeploy**（不重部署不生效）。
2. 本地：`npx wrangler pages dev . --port 8080` + 仓库根目录的 `.dev.vars`。
   README 里的 `python -m http.server` / `npx serve` **没有 Functions**，
   那样起永远走本地引擎，配了 Key 也用不上。
3. 验证：页面上点「深度转译」，看顶部「本次引擎」标签是否变成 `Cloud Free AI (…)`。

---

## 三、`POST /api/compose` 接口约定（纯本地）

**请求**

```json
{ "theme": "特种部队在暴雨夜突入公寓", "requestedShots": 8, "profileId": "veo-3.1-lite" }
```

允许的字段（白名单，多传一个就 400）：`theme` `projectId` `assetManifestVersion`
`mode` `requestedShots` `rhythm` `profileId`。

**响应**

```json
{ "ok": true, "requestId": "…", "intent": { … }, "warnings": [], "profileId": "…", "shots": [ … ] }
```

**错误码**：`METHOD_NOT_ALLOWED` / `AUTH_REQUIRED` / `RATE_LIMITED` / `INVALID_JSON` /
`UNSUPPORTED_REQUEST_FIELD` / `MISSING_THEME` / `CONTENT_BLOCKED` / `PLANNING_FAILED`。

**自检**：`GET /api/compose` 返回 `{ "ready": true, "requestId": "…" }`。

---

## 四、安全注意

- **`.dev.vars` 装的是真 Key，必须留在 `.gitignore` 里。** 6.8.3 之前它**没有被忽略** ——
  按标准流程建 `.dev.vars` 会被 git 提交，等于把 Key 推到远端。已修，
  同时补上了 `.dev.vars.*` 和 `.wrangler/`。
- 环境变量类型一律选 **Secret（加密）**，不要选 Text。
- 密钥不要写进任何会进仓库的文件；本地用 `.dev.vars`（已忽略），
  生产用 Cloudflare Pages 后台的 Environment variables。
