// server/index.js
import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import fetch from "node-fetch"; // if Node >=18 you can remove this import and use global fetch

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_KEY) {
  console.error("GEMINI_API_KEY missing in server .env");
  process.exit(1);
}

app.use(cors({
  origin: ["http://localhost:5173"], // adjust to your frontend origin(s)
}));
app.use(express.json({ limit: "30mb" })); // allow large payloads for file base64

app.get("/api/health", (req, res) => res.json({ ok: true }));

/**
 * Helper: extract textual output (and JSON parse if possible) from Gemini response shapes.
 * Returns { raw, text, parsed } where parsed is null if JSON parse failed.
 */
function extractGeminiOutput(data) {
  if (!data) return { raw: data, text: null, parsed: null };

  // Try common candidate/output locations
  const maybeText =
    data?.text ??
    data?.output?.[0]?.content?.[0]?.text ??
    data?.candidates?.[0]?.content?.[0]?.text ??
    data?.candidates?.[0]?.content?.[0]?.text ??
    data?.output?.[0]?.content?.[0]?.text ??
    null;

  if (!maybeText) {
    // fallback: stringify small parts for debugging
    return { raw: data, text: null, parsed: null };
  }

  let parsed = null;
  if (typeof maybeText === "string") {
    const trimmed = maybeText.trim();
    try {
      // Try to parse JSON if it looks like JSON (starts with { or [ ).
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        parsed = JSON.parse(trimmed);
      }
    } catch (err) {
      // ignore parse error; leave parsed as null
      parsed = null;
    }
  }

  return { raw: data, text: maybeText, parsed };
}

/**
 * POST /api/generate
 * Body: { prompt: string, model?: string }
 * Proxy a simple text prompt to Gemini.
 */
app.post("/api/generate", async (req, res) => {
  try {
    const { prompt, model = "gemini-2.5-flash" } = req.body;
    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "Missing 'prompt' string in request body." });
    }

    const body = {
      contents: [
        {
          parts: [
            { text: prompt }
          ]
        }
      ],
      // optional generation config for simple text responses
      generationConfig: {
        // you can tweak temperature / maxOutputTokens etc here if needed
        temperature: 0.2
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await r.json();
    const extracted = extractGeminiOutput(data);

    return res.status(r.status).json({ status: r.status, extracted, raw: data });
  } catch (err) {
    console.error("Proxy /api/generate error:", err);
    return res.status(500).json({ error: "Proxy failed", details: String(err) });
  }
});

/**
 * POST /api/analyzeDocument
 * Body: {
 *   fileBase64: string (base64 of file),
 *   mimeType: string (e.g., "application/pdf"),
 *   textParts?: Array<{ text: string }>,
 *   model?: string,
 *   responseSchema?: object (optional)
 * }
 *
 * This builds contents -> parts -> [textParts..., prompt, inlineData]
 * and sets generationConfig with responseMimeType and optional responseSchema.
 */
app.post("/api/analyzeDocument", async (req, res) => {
  try {
    const {
      fileBase64,
      mimeType,
      textParts = [], // array of { text: '...' } or strings
      model = "gemini-2.5-flash",
      responseSchema = null
    } = req.body;

    if (!fileBase64 || !mimeType) {
      return res.status(400).json({ error: "Missing fileBase64 or mimeType in request body." });
    }

    // Normalize textParts to objects with text
    const normalizedTextParts = Array.isArray(textParts)
      ? textParts.map(p => (typeof p === "string" ? { text: p } : p))
      : [];

    // Your extraction prompt (customize or accept from frontend)
    const promptText = `Analyze this Purchase Order. Extract ONLY these fields (return JSON matching the schema if possible):
- customerInternalId
- customerRequestDate
- poNumber
- shipToSelect
- lineItems (array of { item, quantity })

Return a pure JSON object only.`;

    // Build parts: text parts first, then prompt, then inlineData
    const parts = [
      ...normalizedTextParts.map(p => ({ text: p.text })),
      { text: promptText },
      {
        inlineData: {
          mimeType,
          data: fileBase64
        }
      }
    ];

    const body = {
      contents: [
        {
          parts
        }
      ],
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
      body: JSON.stringify(body),
    });

    const data = await r.json();

    // For debugging: log brief info but avoid logging huge base64
    console.log(`/api/analyzeDocument -> status ${r.status}`);

    const extracted = extractGeminiOutput(data);

    // Return helpful structure: raw Gemini response + best-effort parsed JSON (if any)
    return res.status(r.status).json({ status: r.status, extracted, raw: data });
  } catch (err) {
    console.error("Proxy /api/analyzeDocument error:", err);
    return res.status(500).json({ error: "Proxy failed", details: String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`Gemini proxy running on http://localhost:${PORT}`);
});
