import { createServer, type Server } from "node:http";
import type { ForceContext } from "../context.js";
import {
  handleResendInboundWebhook,
  verifySvixWebhook,
} from "./resend-inbound.js";

export interface ReplyWebhookServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

function readBody(req: import("node:http").IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export async function startReplyWebhookServer(ctx: ForceContext): Promise<ReplyWebhookServer | null> {
  const port = Number(process.env.RESEND_WEBHOOK_PORT ?? "4025");
  const secret = process.env.RESEND_WEBHOOK_SECRET ?? "";

  if (!process.env.RESEND_API_KEY) {
    console.warn("[reply-webhook] RESEND_API_KEY unset — inbound replies disabled");
    return null;
  }

  const server = createServer(async (req, res) => {
    const url = req.url?.split("?")[0] ?? "/";

    if (req.method === "GET" && url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "azzle-force-reply-webhook" }));
      return;
    }

    if (req.method !== "POST" || url !== "/webhooks/resend") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    try {
      const raw = await readBody(req);
      let event: Record<string, unknown>;

      if (secret) {
        event = verifySvixWebhook(raw, req.headers, secret);
      } else {
        console.warn("[reply-webhook] RESEND_WEBHOOK_SECRET unset — accepting unsigned webhook (dev only)");
        event = JSON.parse(raw) as Record<string, unknown>;
      }

      const result = await handleResendInboundWebhook(ctx, event);
      res.writeHead(result.ok ? 200 : 422, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[reply-webhook] error:", message);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, message }));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => resolve());
  });

  console.log(
    `[reply-webhook] Resend inbound → http://localhost:${port}/webhooks/resend` +
      (secret ? " (signed)" : " (unsigned — set RESEND_WEBHOOK_SECRET)")
  );

  return {
    server,
    port,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}
