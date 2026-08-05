import { metadataTrust, validateTaskMetadata } from "./lib/marketplace-metadata.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== "GET") {
    res.writeHead(405, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "method_not_allowed" }));
    return;
  }
  const raw = new URL(req.url || "/api/get-market-profile", `https://${req.headers?.host || "azzle.org"}`).searchParams.get("metadata");
  if (!raw) {
    res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "metadata_required" }));
    return;
  }
  try {
    const metadata = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const validation = validateTaskMetadata(metadata);
    res.writeHead(validation.valid ? 200 : 422, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ metadata, validation, trust: metadataTrust(metadata) }));
  } catch (error) {
    res.writeHead(400, { ...CORS, "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "invalid_metadata", message: error?.message ?? String(error) }));
  }
}
