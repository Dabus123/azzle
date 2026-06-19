export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function apiJson(status, body, extraHeaders = {}) {
  return {
    status,
    headers: { ...CORS, "Content-Type": "application/json", ...extraHeaders },
    json: body,
  };
}

export async function readJsonBody(req) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return {};
  const raw = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
  if (!raw) return {};
  return JSON.parse(raw);
}

export function sendApiResult(res, result) {
  const headers = result.headers ?? { "Content-Type": "application/json", ...CORS };
  if (result.json == null) {
    res.writeHead(result.status, headers);
    res.end();
    return;
  }
  res.writeHead(result.status, headers);
  res.end(JSON.stringify(result.json));
}

export function requestUrl(req, fallbackPath = "/") {
  const host = req.headers?.host || "azzle.org";
  return new URL(req.url || fallbackPath, `https://${host}`);
}
