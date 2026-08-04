/**
 * LEGO War Universe — AI 增强后端 (Cloudflare Worker)
 * ---------------------------------------------------
 * 接收前端主题 + 资产索引，让大模型挑选最合适的资产并给出动作描述，
 * 返回 { selectedIds:[...], action:"..." }，由前端用 Production Bible 的模板
 * 组装成最终 Flow 提示词（风格块 / negative / 一致性规则不交给 AI，避免被破坏）。
 *
 * 支持：Gemini（默认）、任意 OpenAI 兼容接口。
 * 密钥用 Cloudflare Secret 存储，绝不写进前端。
 * 部署说明见 06_Deploy/README.md
 */

const CORS = {
	"Access-Control-Allow-Origin": "*",
	"Access-Control-Allow-Methods": "POST, OPTIONS",
	"Access-Control-Allow-Headers": "Content-Type, Authorization",
	"Access-Control-Max-Age": "86400",
}

function json(obj, status = 200) {
	return new Response(JSON.stringify(obj), {
		status,
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

export default {
	async fetch(request, env) {
		if (request.method === "OPTIONS") return new Response(null, { headers: CORS })
		if (request.method === "GET")
			return json({ ok: true, service: "LWU AI Compose", provider: env.PROVIDER || "gemini" })
		if (request.method !== "POST") return json({ error: "Use POST" }, 405)

		// 可选访问口令：设置 Secret ACCESS_TOKEN 后，前端必须填同样的 API Key
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
			// 返回非 2xx，前端会自动回退到本地智能匹配
			return json({ error: String((e && e.message) || e) }, 502)
		}
	},
}
