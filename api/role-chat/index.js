import { CORS, sendJson } from "../lib/respond.js";

async function readJsonBody(req) {
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
  if (!raw) return {};
  return JSON.parse(raw);
}

async function proxyRoleChat(body) {
  const key = process.env.BANKR_API_KEY || process.env.BANKR_KEY || "";
  const base = (process.env.OPENAI_BASE_URL || "https://llm.bankr.bot/v1").replace(/\/$/, "");
  const model = process.env.AZZLE_LLM_MODEL || "deepseek-v4-flash";

  if (!key) {
    return { status: 503, json: { error: "BANKR_API_KEY not configured" } };
  }

  const { system, messages } = body;
  if (!system || !Array.isArray(messages)) {
    return { status: 400, json: { error: "system and messages required" } };
  }

  const payload = {
    model: body.model || model,
    messages: [{ role: "system", content: system }, ...messages],
    max_tokens: 400,
    temperature: 0.3,
  };

  const upstream = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "X-API-Key": key,
    },
    body: JSON.stringify(payload),
  });

  const text = await upstream.text();
  if (!upstream.ok) {
    return {
      status: upstream.status,
      json: { error: "Bankr LLM Gateway error", detail: text.slice(0, 500) },
    };
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { status: 502, json: { error: "Invalid JSON from gateway" } };
  }

  const content = data.choices?.[0]?.message?.content ?? "";
  return { status: 200, json: { text: content, model: payload.model } };
}

export default async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== "POST") {
      sendJson(res, 405, { error: "method_not_allowed" });
      return;
    }

    let body = {};
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { error: "Invalid JSON body" });
      return;
    }

    const result = await proxyRoleChat(body);
    sendJson(res, result.status, result.json);
  } catch (err) {
    sendJson(res, 500, { error: err?.message ?? String(err) });
  }
}
