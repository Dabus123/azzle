import { handleSiteApi } from "../scripts/site-api.mjs";

async function readJsonBody(req) {
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

export default async function handler(req, res) {
  const segments = req.query.path;
  const parts = segments ? (Array.isArray(segments) ? segments : [segments]) : [];
  const pathname = "/api/" + parts.map(decodeURIComponent).join("/");
  const url = new URL(req.url ?? pathname, "https://azzle.org");

  let body = {};
  try {
    body = await readJsonBody(req);
  } catch {
    sendApiResult(res, {
      status: 400,
      headers: { "Content-Type": "application/json" },
      json: { error: "Invalid JSON body" },
    });
    return;
  }

  const result = await handleSiteApi({
    method: req.method ?? "GET",
    pathname,
    searchParams: url.searchParams,
    body,
  });

  sendApiResult(res, result);
}

function sendApiResult(res, result) {
  const headers = result.headers ?? { "Content-Type": "application/json" };
  if (result.json == null) {
    res.status(result.status).set(headers).end();
    return;
  }
  res.status(result.status).set(headers).json(result.json);
}
