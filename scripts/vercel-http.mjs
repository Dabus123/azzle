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
  const headers = result.headers ?? { "Content-Type": "application/json" };
  const body = result.json == null ? "" : JSON.stringify(result.json);
  if (typeof res.status === "function") {
    if (result.json == null) {
      res.status(result.status).set(headers).end();
      return;
    }
    res.status(result.status).set(headers).json(result.json);
    return;
  }
  res.writeHead(result.status, headers);
  res.end(body);
}

export function requestUrl(req, fallbackPath = "/") {
  const host = req.headers?.host || "azzle.org";
  return new URL(req.url || fallbackPath, `https://${host}`);
}
