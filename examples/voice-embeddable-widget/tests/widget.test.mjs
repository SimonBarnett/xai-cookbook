/**
 * Unit tests for grok-voice-widget internals + token server contract.
 * Run:  D:\tools\node\node.exe --test tests/widget.test.mjs
 * (from examples/voice-embeddable-widget)
 */
import assert from "node:assert/strict";
import { describe, it, before, after } from "node:test";
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WIDGET_PATH = path.join(ROOT, "grok-voice-widget.js");
const DEMO_PATH = path.join(ROOT, "demo.html");
const TOKEN_SERVER_PATH = path.join(ROOT, "session-token-server.mjs");
const README_PATH = path.join(ROOT, "README.md");

describe("package shape", () => {
  it("ships the single-file widget", () => {
    assert.ok(fs.existsSync(WIDGET_PATH));
    const src = fs.readFileSync(WIDGET_PATH, "utf8");
    assert.ok(src.includes("GrokVoiceWidget"));
    assert.ok(!/from ['\"]react['\"]/.test(src), "no React import");
    assert.ok(!/require\(['\"]react['\"]\)/.test(src), "no React require");
    assert.ok(src.includes("input_audio_buffer.append"));
    assert.ok(src.includes("response.output_audio.delta") || src.includes("response.audio.delta"));
    assert.ok(src.includes("server_vad"));
    assert.ok(src.includes("xai-client-secret."));
    assert.ok(src.includes("wss://api.x.ai/v1/realtime"));
    assert.ok(src.includes("24000"));
  });

  it("ships demo.html with data-* config sketch", () => {
    assert.ok(fs.existsSync(DEMO_PATH));
    const html = fs.readFileSync(DEMO_PATH, "utf8");
    assert.ok(html.includes("grok-voice-widget.js"));
    assert.ok(html.includes("data-token-endpoint"));
    assert.ok(html.includes("data-voice"));
  });

  it("ships README covering ephemeral tokens and defaults", () => {
    assert.ok(fs.existsSync(README_PATH));
    const md = fs.readFileSync(README_PATH, "utf8");
    assert.ok(md.includes("ephemeral") || md.includes("client_secrets"));
    assert.ok(md.includes("24") && md.toLowerCase().includes("pcm"));
    assert.ok(md.includes("XAI_API_KEY"));
    assert.ok(!/xai-[a-z0-9]{20,}/i.test(md), "no leaked API key material");
  });

  it("ships a session token server", () => {
    assert.ok(fs.existsSync(TOKEN_SERVER_PATH));
    const src = fs.readFileSync(TOKEN_SERVER_PATH, "utf8");
    assert.ok(src.includes("/v1/realtime/client_secrets"));
    assert.ok(src.includes("XAI_API_KEY"));
  });
});

describe("audio helpers", () => {
  let internals;

  before(async () => {
    // Load widget in Node (no DOM). Auto-init is skipped without document.currentScript.
    const modUrl = pathToFileURL(WIDGET_PATH).href;
    await import(modUrl);
    internals = globalThis.GrokVoiceWidget._internals;
    assert.ok(internals, "GrokVoiceWidget._internals exported for tests");
  });

  it("round-trips float32 <-> base64 PCM16", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25]);
    const b64 = internals.float32ToBase64PCM16(samples);
    assert.equal(typeof b64, "string");
    assert.ok(b64.length > 0);
    const back = internals.base64PCM16ToFloat32(b64);
    assert.equal(back.length, samples.length);
    for (let i = 0; i < samples.length; i++) {
      assert.ok(Math.abs(back[i] - samples[i]) < 0.01, `sample ${i}`);
    }
  });

  it("defaults sample rate to 24000", () => {
    assert.equal(internals.SAMPLE_RATE, 24000);
  });

  it("parseScriptConfig reads data-* attributes", () => {
    const fake = {
      getAttribute(name) {
        const map = {
          "data-token-endpoint": "http://localhost:8787/session",
          "data-voice": "eve",
          "data-instructions": "Be brief.",
          "data-greeting": "Hello!",
          "data-color": "#4a90d9",
          "data-position": "left",
          "data-label": "Talk",
          "data-transcript": "true",
          "data-text-fallback": "true",
          "data-max-session-seconds": "120",
        };
        return map[name] ?? null;
      },
    };
    const cfg = internals.parseScriptConfig(fake);
    assert.equal(cfg.tokenEndpoint, "http://localhost:8787/session");
    assert.equal(cfg.voice, "eve");
    assert.equal(cfg.instructions, "Be brief.");
    assert.equal(cfg.greeting, "Hello!");
    assert.equal(cfg.color, "#4a90d9");
    assert.equal(cfg.position, "left");
    assert.equal(cfg.label, "Talk");
    assert.equal(cfg.transcript, true);
    assert.equal(cfg.textFallback, true);
    assert.equal(cfg.maxSessionSeconds, 120);
  });

  it("buildSessionUpdate enables server_vad and PCM 24kHz", () => {
    const msg = internals.buildSessionUpdate({
      voice: "ara",
      instructions: "Help the visitor.",
    });
    assert.equal(msg.type, "session.update");
    assert.equal(msg.session.voice, "ara");
    assert.equal(msg.session.turn_detection.type, "server_vad");
    assert.equal(msg.session.audio.input.format.type, "audio/pcm");
    assert.equal(msg.session.audio.input.format.rate, 24000);
    assert.equal(msg.session.audio.output.format.type, "audio/pcm");
    assert.equal(msg.session.audio.output.format.rate, 24000);
  });

  it("buildRealtimeUrl includes model query", () => {
    const url = internals.buildRealtimeUrl("grok-voice-latest");
    assert.equal(url, "wss://api.x.ai/v1/realtime?model=grok-voice-latest");
  });

  it("clientSecretProtocol prefixes token", () => {
    assert.equal(
      internals.clientSecretProtocol("tok_abc"),
      "xai-client-secret.tok_abc"
    );
  });
});

describe("session token server (mocked upstream)", () => {
  let child;
  let baseUrl;
  const fakeUpstream = { server: null, port: 0 };

  before(async () => {
    fakeUpstream.server = http.createServer((req, res) => {
      if (req.method === "POST" && req.url === "/v1/realtime/client_secrets") {
        let body = "";
        req.on("data", (c) => (body += c));
        req.on("end", () => {
          const auth = req.headers.authorization || "";
          if (!auth.startsWith("Bearer ")) {
            res.writeHead(401);
            res.end("unauthorized");
            return;
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              value: "xai-realtime-client-secret-test",
              expires_at: Math.floor(Date.now() / 1000) + 300,
            })
          );
        });
        return;
      }
      res.writeHead(404);
      res.end("no");
    });
    await new Promise((resolve) => fakeUpstream.server.listen(0, "127.0.0.1", resolve));
    fakeUpstream.port = fakeUpstream.server.address().port;

    const nodeBin = process.execPath;
    child = spawn(
      nodeBin,
      [TOKEN_SERVER_PATH, "--port", "0", "--host", "127.0.0.1"],
      {
        env: {
          ...process.env,
          XAI_API_KEY: "test-key-not-real",
          XAI_API_BASE: `http://127.0.0.1:${fakeUpstream.port}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    baseUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("token server start timeout")), 8000);
      let buf = "";
      child.stdout.on("data", (d) => {
        buf += d.toString();
        const m = buf.match(/listening on (http:\/\/[^\s]+)/i);
        if (m) {
          clearTimeout(timer);
          resolve(m[1].replace(/\/$/, ""));
        }
      });
      child.stderr.on("data", (d) => {
        buf += d.toString();
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`token server exited early: ${code}; ${buf}`));
      });
    });
  });

  after(async () => {
    if (child && !child.killed) {
      child.kill("SIGTERM");
    }
    if (fakeUpstream.server) {
      await new Promise((r) => fakeUpstream.server.close(r));
    }
  });

  it("POST /session returns ephemeral value", async () => {
    const res = await fetch(`${baseUrl}/session`, { method: "POST" });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.value, "xai-realtime-client-secret-test");
    assert.ok(json.expires_at);
  });

  it("GET /health is ok", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
  });
});
