export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

/** Works on Vercel serverless (no Express res.status/.json required). */
export function sendJson(res, status, body) {
  const headers = { ...CORS, "Content-Type": "application/json" };
  if (body == null) {
    res.writeHead(status, headers);
    res.end();
    return;
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(body));
}
