# Farcaster Snap on azzle.org

Production URL: **https://azzle.org/snap**

## Vercel domain setup (required for browser / emulator CORS)

The Farcaster emulator fetches snaps from the browser. If `azzle.org` **domain-redirects** to `www.azzle.org` in the Vercel dashboard, the 308 response has no CORS headers and the emulator shows "Network error".

**Fix in Vercel → Project → Settings → Domains:**

1. Open both `azzle.org` and `www.azzle.org`
2. Set **both** to **Production** (not "Redirect to …")
3. `vercel.json` redirects all apex paths **except** `/snap` to `www`

After that, `https://azzle.org/snap` is served directly with snap JSON + CORS.

## Verify

```bash
curl -fsS -D - -H "Accept: application/vnd.farcaster.snap+json" "https://azzle.org/snap" -o /dev/null
```

Expect `200`, `Content-Type: application/vnd.farcaster.snap+json`, and `Access-Control-Allow-Origin: *` — **not** `308`.

## Emulator

Use `https://azzle.org/snap` (or `https://www.azzle.org/snap` — both work once domains are configured).
