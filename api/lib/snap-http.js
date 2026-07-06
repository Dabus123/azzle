export const SNAP_ACCEPT = "application/vnd.farcaster.snap+json";

export const SNAP_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, X-Snap-Payload",
  "Access-Control-Max-Age": "86400",
};

/** Canonical snap URL — apex azzle.org 308s to www (breaks browser CORS). */
export const DEFAULT_SNAP_URL = "https://www.azzle.org/snap";

export function resolveSnapBase(req) {
  const fromEnv = process.env.AZZLE_SNAP_PUBLIC_URL || process.env.AZZLE_SNAP_URL;
  if (fromEnv?.trim()) return fromEnv.trim().replace(/\/$/, "");
  const host = req?.headers?.host || "www.azzle.org";
  if (host === "azzle.org") return DEFAULT_SNAP_URL;
  return `https://${host}/snap`;
}

export function snapLinkHeader(snapUrl) {
  const base = (snapUrl || DEFAULT_SNAP_URL).replace(/\/$/, "");
  return `<${base}>; rel="alternate"; type="${SNAP_ACCEPT}"`;
}

export function snapJsonHeaders(snapUrl) {
  return {
    ...SNAP_CORS,
    "Content-Type": SNAP_ACCEPT,
    Vary: "Accept",
    Link: snapLinkHeader(snapUrl),
  };
}

export function snapHtmlHeaders(snapUrl) {
  return {
    ...SNAP_CORS,
    "Content-Type": "text/html; charset=utf-8",
    Vary: "Accept",
    Link: snapLinkHeader(snapUrl),
  };
}
