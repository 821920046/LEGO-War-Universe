# AI 启用时机与配置（6.8.3 实况）

> 这份文档描述的是**代码里的真实行为**，逐条对得上 `functions/api/ai-brain.js` 与
> `src/domain/ai-brain.js`。如果你之前照着 `06_Deploy/README.md` 配过，那份文档
> 描述的是一套**代码里并不存在**的系统（详见文末「常见坑」）。

---

## 一、什么时候会走云端 AI（真实路由）

| 入口 | 走哪条路 |
| --- | --- |
| 影院模式「🎬 深度转译」 | 先 `POST /api/ai-brain`；成功 → 云端 AI；失败或未配 Key → 本地引擎 |
| 自由模式「⚡ 自由战术分镜策划」 | **从不调 AI**，纯本地 `planVariants`（确定性、毫秒级） |
| 角色定妆表 / 编译 Prompt / 导出 CSV | 纯本地 |

**关键：前端没有「启用 AI」开关。** 用不用 AI，完全由「后台有没有配 Key」决定 ——
配了就走 AI，没配就走本地，用户无从选择，也没有开关可点。

### 后台的 provider 顺序（`functions/api/ai-brain.js`）

按顺序尝试，**只要一个成功就停**：

| 顺序 | 环境变量 | 模型 |
| --- | --- | --- |
| 1 | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| 2 | `OPENROUTER_API_KEY` | `meta-llama/llama-3.3-70b-instruct:free` |
| 3 | `GEMINI_API_KEY` | `gemini-1.5-flash` |

三个都没有 / 三个都失败 → 自动回退本地引擎，**不报错**。

### 怎么判断「这一次到底用的是不是 AI」

看返回里的 `engine` 字段 —— 页面顶部那个「本次引擎」小标签就是它：

| `engine` 文案 | 含义 |
| --- | --- |
| `Cloud Free AI (Groq (llama-3.3-70b-versatile))` | ✅ 云端 AI 生效 |
| `本地自主想象引擎 · 离线生成（非云端 AI）` | 本地按题材原创（未配 Key 或接口不可达） |
| `策展致敬库 · 离线复刻（手写分镜，非 AI 生成）` | 命中 9 部策展影片，交付手写复刻 |
| `策展致敬库 · 离线复刻… · 生成引擎不可用，已退回通用军事分镜` | 极端兜底 |

---

## 二、什么时候**该**用 AI（设计判断，不是配置）

AI 值得用的，是**本地规则引擎天生做不好**的那三类：

| 场景 | 例子 | 为什么本地不行 |
| --- | --- | --- |
| 抽象 / 叙事型主题 | 「一个老兵在废墟里回忆战友」 | 关键词太少，匹配不到东西 |
| 风格迁移 | 「像《黑鹰坠落》那种感觉」 | 本地没有「风格」这个维度 |
| 需要原创立意 | logline / twist / hook | 本地是模板 + 节拍池，不产出立意 |

反过来，**这几种情况用 AI 是浪费**：

- **明确的历史战役 / 装备题材**（「二战诺曼底登陆抢滩」「海湾战争防空阵地」）——
  本地有 810 项真实资产 + 时代门控，选型确定、毫秒级、还免费。
- **已经点名了 9 部策展影片**——手写复刻本来就比模型稳，AI 反而可能跑偏。
- **需要可复现**——本地是确定性的（同一输入必得同一输出）；AI 带 `temperature: 0.7`，
  同一输入两次结果不同。

### 一条容易被忽略的边界

**AI 只负责「选资产 + 写动作句 + 声明戏剧功能」。**
最终交付的 Prompt 仍然由本地编译器按 Production Bible 模板组装 ——
风格块、混合写实规则、negative、角色一致性描述**不会被 AI 改写**。
所以「用 AI」不会让风格漂移，这是刻意的设计。

### 成本

一次调用约 3–5k input token + 200–800 output token。三个 provider 都有免费层，
个人使用基本在额度内。

---

## 三、怎么配置

### 生产环境（Cloudflare Pages，推荐）

1. Cloudflare 控制台 → 你的 Pages 项目 → **Settings → Environment variables → Production**
2. 添加上表里的 Key，**类型必须选 `Secret`（加密）**，不要选 Text
3. 可选变量：

   | 变量 | 说明 |
   | --- | --- |
   | `ALLOWED_ORIGIN` | 跨域白名单，必须精确匹配；留空则只允许同源 |
   | `ENVIRONMENT` | 设 `production` 激活安全检查 |
   | `AUTH_MODE` | 设 `access` 强制要求 Cloudflare Access 身份标头 |

4. **点一次 Redeploy / 重新部署** —— 环境变量的改动**必须重新部署才生效**，
   这是最容易踩的坑
5. 验证：页面上输入任意题材 → 点「深度转译」→ 看顶部「本次引擎」标签
   是否变成 `Cloud Free AI (…)`

### 本地开发（想用 AI 必须这样起）

README 里写的 `python -m http.server 8080` 或 `npx serve .` **只提供静态文件，
没有 Functions** —— 所以本地这么起**永远走本地引擎**，配了 Key 也不会用上。

要在本地用 AI：

```bash
npx wrangler pages dev . --port 8080
```

然后在**仓库根目录**建 `.dev.vars`（Cloudflare 的本地环境变量约定）：

```
GROQ_API_KEY=gsk_...
```

> **为什么不是 `.env`**：代码里**没有任何 dotenv 加载**（`grep dotenv` 为空），
> `.env` 根本不会被读取。`.env.example` 早先写的「本地开发时配置到 .env 中」
> 是错的，6.8.3 已更正。

### 备选：独立 Cloudflare Worker（不推荐）

`06_Deploy/worker.js` + `wrangler.toml` 是早期方案，**只支持 `gemini` / `openai`
两个 provider**（由 `PROVIDER` 变量切换），且前端写死调用同源 `/api/ai-brain` ——
要用它必须自己改前端。除非你确实需要把 AI 后端和网站分开部署，否则别走这条。

---

## 四、常见坑（都是真实踩过的）

1. **`06_Deploy/README.md` 描述的是一套不存在的系统。** 它说 AI 端点是
   `/api/compose`、有 10 个 provider、支持 `MODELS` / `ROTATE` / `TIMEOUT_MS`、
   网页里有「启用 AI 增强」勾选框 —— 这些在代码里**全都没有**。
   真实的 AI 端点是 `/api/ai-brain`，只有 3 个 provider，前端也没有开关。
   （`functions/api/compose.js` 是**纯本地**端点，一个 Key 都不读。）
2. **改了环境变量不 Redeploy → 不生效。** 这是最高频的「配了但没用」。
3. **`.dev.vars` 必须进 `.gitignore`。** 6.8.3 之前它**没有被忽略** ——
   按标准流程建 `.dev.vars` 填真 Key，会被 git 提交上去，密钥直接泄露。已修。
4. **`/api/ai-brain` 只接受 POST。** 用浏览器直接打开会返回
   `405 METHOD_NOT_ALLOWED` —— 这不是故障，也没有 GET 自检接口。
5. **限流是 60 秒滑动窗口内 30 次 / IP**，超出返回 `429 RATE_LIMITED`。
6. **没配 Key 不是故障。** 系统会如实标注「离线生成（非云端 AI）」，
   功能完整、不联网、不花钱 —— 这也是当前线上的状态。

---

## 五、一句话总结

- **想用 AI**：配 Key（`GROQ_API_KEY` 优先）+ **Redeploy**。
- **不想用 AI**：什么都不用做。
- **想知道有没有在用**：看页面顶部的「本次引擎」标签。
