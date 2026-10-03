#!/usr/bin/env node
/**
 * Optional WebSocket proxy sketch for data-mode="proxy".
 *
 * Browser  --ws-->  this process  --ws-->  wss://api.x.ai/v1/realtime
 *
 * Requires the `ws` package (not bundled):
 *   npm install ws
 *   set XAI_API_KEY=...
 *   node proxy-server.mjs
 *
 * For a production-shaped proxy with session REST, prefer the full
 * examples/voice-agent-web backends in xai-org/xai-cookbook.
 */
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let WebSocket;
try {
  ({ WebSocket } = require("ws"));
} catch {
  console.error(
    "proxy-server.mjs needs the optional 'ws' package. Run: npm install ws"
  );
  process.exit(1);
}

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || "8790");
const API_KEY = process.env.XAI_API_KEY || "";
const MODEL = process.env.XAI_VOICE_MODEL || "grok-voice-latest";
const UPSTREAM = `wss://api.x.ai/v1/realtime?model=${encodeURIComponent(MODEL)}`;

if (!API_KEY) {
  console.warn("warning: XAI_API_KEY is not set; upstream auth will fail");
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, mode: "proxy" }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("Grok voice widget WS proxy. Connect via ws://host/ws\n");
});

const wss = new WebSocket.Server({ server, path: "/ws" });

wss.on("connection", (client) => {
  const upstream = new WebSocket(UPSTREAM, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  const pending = [];
  let open = false;

  upstream.on("open", () => {
    open = true;
    while (pending.length) upstream.send(pending.shift());
  });
  upstream.on("message", (data, isBinary) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data, { binary: isBinary });
    }
  });
  upstream.on("close", () => client.close());
  upstream.on("error", () => client.close());

  client.on("message", (data, isBinary) => {
    if (!open) {
      pending.push(data);
      return;
    }
    if (upstream.readyState === WebSocket.OPEN) {
      upstream.send(data, { binary: isBinary });
    }
  });
  client.on("close", () => {
    try {
      upstream.close();
    } catch {
      /* ignore */
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`listening on http://${HOST}:${PORT}  (ws path /ws)`);
});
