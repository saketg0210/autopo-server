import fetch from "node-fetch";

function extractGeminiOutput(data) {
    const maybeText =
        data?.text ??
        data?.output?.[0]?.content?.[0]?.text ??
        data?.candidates?.[0]?.content?.[0]?.text ??
        null;

    let parsed = null;
    if (typeof maybeText === "string") {
        const trimmed = maybeText.trim();
        if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
            try { parsed = JSON.parse(trimmed); } catch (e) { }
        }
    }

    return { raw: data, text: maybeText, parsed };
}

export default async function handler(req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
     if (req.method === "OPTIONS") return res.status(200).end();


    if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
    }

    const GEMINI_KEY = process.env.GEMINI_API_KEY;
    if (!GEMINI_KEY) return res.status(500).json({ error: "Missing GEMINI_API_KEY" });

    try {
        const { prompt, model = "gemini-2.5-flash" } = req.body;

        if (!prompt)
            return res.status(400).json({ error: "Missing 'prompt' field" });

        const body = {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
        };

        const url =
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

        const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });

        const data = await r.json();
        const extracted = extractGeminiOutput(data);

        return res.status(r.status).json({ status: r.status, extracted, raw: data });
    } catch (err) {
        console.error("Error /api/generate:", err);
        return res.status(500).json({ error: "Proxy failed", details: String(err) });
    }
}
