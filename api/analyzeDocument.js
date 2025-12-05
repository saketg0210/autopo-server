import fetch from "node-fetch";
import dotenv from "dotenv";

dotenv.config();

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const GEMINI_KEY = process.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return res.status(500).json({ error: "GEMINI_API_KEY not set" });
  }

  try {
    const { fileBase64, mimeType, textParts = [], model = "gemini-2.5-flash", responseSchema = null } = req.body;

    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ error: "Missing fileBase64 or mimeType in request body." });
    }

    // Normalize textParts
    const normalizedTextParts = Array.isArray(textParts)
      ? textParts.map(p => (typeof p === "string" ? { text: p } : p))
      : [];

    const promptText = `Analyze this Purchase Order. Extract ONLY these fields:
- customerInternalId
- customerRequestDate
- poNumber
- shipToSelect
- lineItems (array of { item, quantity })
Return a pure JSON object only.`;

    const parts = [
      ...normalizedTextParts.map(p => ({ text: p.text })),
      { text: promptText },
      { inlineData: { mimeType, data: fileBase64 } }
    ];

    const body = {
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: "application/json",
        ...(responseSchema ? { responseSchema } : {}),
        temperature: 0.05
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await r.json();

    // Extract text (best-effort)
    const maybeText =
      data?.text ||
      data?.output?.[0]?.content?.[0]?.text ||
      data?.candidates?.[0]?.content?.[0]?.text ||
      null;

    let parsed = null;
    if (maybeText && typeof maybeText === "string") {
      try {
        if (maybeText.trim().startsWith("{") || maybeText.trim().startsWith("[")) {
          parsed = JSON.parse(maybeText);
        }
      } catch {}
    }

    return res.status(r.status).json({ status: r.status, extracted: { raw: data, text: maybeText, parsed }, raw: data });
  } catch (err) {
    console.error("Error /api/analyzeDocument:", err);
    return res.status(500).json({ error: "Proxy failed", details: String(err) });
  }
}
