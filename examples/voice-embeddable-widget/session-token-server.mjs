#!/usr/bin/env node
/**
 * Tiny ephemeral-token minting server for grok-voice-widget.js.
 *
 * Holds XAI_API_KEY on the server and exposes POST /session for the browser.
 * Zero npm dependencies (Node 18+).
 *
 *   set XAI_API_KEY=...
 *   node session-token-server.mjs
 *   # listens on http://127.0.0.1:8787
 *
 * Optional:
 *   --port 8787 --host 127.0.0.1
 *   XAI_API_BASE=https://api.x.ai   (override for tests)
 *   TOKEN_TTL_SECONDS=300
 */
import http from "node:http";
import { URL } from "node:url";

function argValue(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

const HOST = argValue("--host", process.env.HOST || "127.0.0.1");
const PORT = Number(argValue("--port", process.env.PORT || "8787"));
const API_BASE = (process.env.XAI_API_BASE || "https://api.x.ai").replace(
  /\/$/,
  ""
);
const TTL = Number(process.env.TOKEN_TTL_SECONDS || "300");
const API_KEY = process.env.XAI_API_KEY || "";

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,Accept",
  });
  res.end(body);
}

async function mintToken() {
  if (!API_KEY) {
    const err = new Error("XAI_API_KEY is not set");
    err.status = 500;
    throw err;
  }
  const res = await fetch(`${API_BASE}/v1/realtime/client_secrets`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ expires_after: { seconds: TTL } }),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(
      `client_secrets HTTP ${res.status}: ${text.slice(0, 400)}`
    );
    err.status = res.status;
    err.payload = json;
    throw err;
  }
  return json;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,Accept",
    });
    res.end();
    return;
  }

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    sendJson(res, 200, {
      ok: true,
      service: "grok-voice-widget-session-token-server",
      hasApiKey: Boolean(API_KEY),
    });
    return;
  }

  if (
    req.method === "POST" &&
    (url.pathname === "/session" || url.pathname === "/sessions")
  ) {
    try {
      const json = await mintToken();
      sendJson(res, 200, {
        value: json.value,
        expires_at: json.expires_at,
      });
    } catch (err) {
      sendJson(res, err.status || 500, {
        error: err.message || String(err),
      });
    }
    return;
  }

  sendJson(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : PORT;
  console.log(`listening on http://${HOST}:${port}`);
  if (!API_KEY) {
    console.warn("warning: XAI_API_KEY is not set; POST /session will fail");
  }
});
