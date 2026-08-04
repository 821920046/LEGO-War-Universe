/**
 * LEGO War Universe — AI 增强后端（Cloudflare Pages Function）
 * ---------------------------------------------------------------
 * 路由：同源 POST /api/compose （由 Cloudflare Pages 自动映射 functions/api/compose.js）
 *
 * 前端无需填写任何 Worker 地址：页面直接请求本站的 /api/compose。
 * 所有配置（密钥 / 提供商 / 模型）均在 Cloudflare Pages 项目的
 * “Settings → Environment variables” 里设置，绝不写进前端。
 *
 * 需要的环境变量（在 Pages 项目设置）：
 *   GEMINI_API_KEY   （Secret，默认 Gemini 时必填）
 *   PROVIDER         （可选 Text，默认 gemini；可填 openai）
 *   MODEL            （可选 Text，默认 gemini-2.0-flash）
 *   OPENAI_API_KEY / OPENAI_BASE_URL （仅当 PROVIDER=openai 时）
 *   ACCESS_TOKEN     （可选 Secret；若设置，则调用需带 Authorization: Bearer <token>）
 */

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
}

function json(obj, status) {
	return new Response(JSON.stringify(obj), {
		status: status || 200,
		headers: { "Content-Type": "application/json; charset=utf-8", ...CORS },
	})
}

const SYSTEM = [
	"You are the shot designer for a LEGO stop-motion war film studio called LEGO War Universe (LWU).",
	"",
	"You receive a shot theme (Chinese or English) and a catalogue of available assets.",
	"Your job is ONLY to select assets and write one short action line. You must NOT write the full prompt.",
	"",
	"Hard rules:",
	"1. Pick from the given asset IDs only. Never invent an ID.",
	"2. Era consistency is critical. Series values include: Modern, Gulf War, WWII, Pacific, Cold War. If the theme is modern (drones, night vision, F-35, HIMARS, special forces, urban CQB), pick only Modern-series assets. If the theme is WWII (Normandy, Sherman, Tiger, paratrooper), pick only WWII/Pacific assets. Never mix eras.",
	"3. Faction consistency: do not put opposing factions in one shot unless the theme is explicitly a firefight between them.",
	"4. Select at most: 3 subjects (CHR/VEH/AIR/SHP/WPN/PRP), 1 environment (ENV-*), 1 camera (CAM-*), 1 lighting (LGT-*), 3 effects (FX-*), 2 audio (AUD-*).",
	"5. Hardware is LEGO, weather and combat effects are photoreal. If the theme mentions rain, snow, fog, storm, water, deep sea, river, smoke, sparks or a mushroom cloud, you MUST include the matching FX-5xx asset.",
	"6. The action line is ONE English sentence describing what physically happens within 8 seconds. One continuous action only. No camera instructions, no style words, no quality adjectives.",
	"",
	'Return STRICT JSON only, no markdown fence: {"selectedIds":["CHR-401","ENV-505","CAM-403","LGT-401","FX-501","AUD-501"],"action":"...","reason":"one short sentence"}',
].join("\n")

function buildUserMsg(theme, assets) {
	const lines = assets.map(function (a) {
		const meta = [a.series, a.faction].filter(Boolean).join("/")
		return meta ? a.id + "\t" + a.name + "\t(" + meta + ")" : a.id + "\t" + a.name
	})
	return "THEME: " + theme + "\n\nASSET CATALOGUE (id / name / series / faction):\n" + lines.join("\n")
}

function extractJson(text) {
	if (!text) return null
	let t = String(text).trim()
	t = t.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim()
	const i = t.indexOf("{")
	const j = t.lastIndexOf("}")
	if (i < 0 || j < 0) return null
	try {
		return JSON.parse(t.slice(i, j + 1))
	} catch (e) {
		return null
	}
}

async function callGemini(env, theme, assets) {
	const model = env.MODEL || "gemini-2.0-flash"
	const host = "https://generativelanguage.googleapis.com/v1beta/models"
	const url = host + "/" + model + ":generateContent?key=" + env.GEMINI_API_KEY
	const body = {
		systemInstruction: { parts: [{ text: SYSTEM }] },
		contents: [{ role: "user", parts: [{ text: buildUserMsg(theme, assets) }] }],
		generationConfig: { temperature: 0.4, responseMimeType: "application/json" },
	}
	const r = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(body),
	})
	if (!r.ok) throw new Error("Gemini HTTP " + r.status + ": " + (await r.text()).slice(0, 200))
	const d = await r.json()
	let text = ""
	if (d && d.candidates && d.candidates[0] && d.candidates[0].content) {
		text = (d.candidates[0].content.parts || []).map(function (p) { return p.text || "" }).join("")
	}
	return extractJson(text)
}

async function callOpenAI(env, theme, assets) {
	const base = env.OPENAI_BASE_URL || "https://api.openai.com/v1"
	const model = env.MODEL || "gpt-4o-mini"
	const r = await fetch(base + "/chat/completions", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: "Bearer " + env.OPENAI_API_KEY,
		},
		body: JSON.stringify({
			model: model,
			temperature: 0.4,
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: SYSTEM },
				{ role: "user", content: buildUserMsg(theme, assets) },
			],
		}),
	})
	if (!r.ok) throw new Error("OpenAI HTTP " + r.status + ": " + (await r.text()).slice(0, 200))
	const d = await r.json()
	const content = d && d.choices && d.choices[0] && d.choices[0].message ? d.choices[0].message.content : ""
	return extractJson(content)
}

// Cloudflare Pages Functions 入口：context = { request, env, ... }
export async function onRequest(context) {
	const request = context.request
	const env = context.env || {}

	if (request.method === "OPTIONS") return new Response(null, { headers: CORS })
	if (request.method === "GET")
		return json({ ok: true, service: "LWU AI Compose (Pages Function)", provider: env.PROVIDER || "gemini" })
	if (request.method !== "POST") return json({ error: "Use POST" }, 405)

	// 可选访问口令：若在 Pages 环境变量里设了 ACCESS_TOKEN，则要求 Bearer 匹配
	if (env.ACCESS_TOKEN) {
		const got = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "")
		if (got !== env.ACCESS_TOKEN) return json({ error: "Unauthorized" }, 401)
	}

	let payload
	try {
		payload = await request.json()
	} catch (e) {
		return json({ error: "Invalid JSON body" }, 400)
	}

	const theme = (payload.theme || "").toString().slice(0, 500)
	const assets = Array.isArray(payload.assets) ? payload.assets.slice(0, 400) : []
	if (!theme) return json({ error: "Missing theme" }, 400)
	if (!assets.length) return json({ error: "Missing assets" }, 400)

	const provider = (env.PROVIDER || "gemini").toLowerCase()
	try {
		const out =
			provider === "openai"
				? await callOpenAI(env, theme, assets)
				: await callGemini(env, theme, assets)
		if (!out) return json({ error: "Model returned unparsable output" }, 502)

		const valid = new Set(assets.map(function (a) { return a.id }))
		const ids = (out.selectedIds || out.ids || []).filter(function (x) { return valid.has(x) })
		if (!ids.length) return json({ error: "Model selected no valid assets" }, 502)

		return json({ selectedIds: ids, action: out.action || theme, reason: out.reason || "" })
	} catch (e) {
		return json({ error: String((e && e.message) || e) }, 502)
	}
}
