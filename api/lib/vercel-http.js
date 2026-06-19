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

export function requestUrl(req, fallbackPath = "/") {
  const host = req.headers?.host || "azzle.org";
  return new URL(req.url || fallbackPath, `https://${host}`);
}
