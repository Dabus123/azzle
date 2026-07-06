/**
 * Edge middleware — CORS preflight for /snap (Farcaster emulator runs in browser).
 */
export default function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";
  if (path !== "/snap") return;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept, X-Snap-Payload",
        "Access-Control-Max-Age": "86400",
      },
    });
  }
}

export const config = {
  matcher: ["/snap", "/snap/"],
};
