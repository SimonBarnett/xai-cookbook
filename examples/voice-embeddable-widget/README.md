# Embeddable Grok Voice Widget

> **Example only.** Harden before production (auth on `/session`, rate limits, CSP, HTTPS).

A **single-file, zero-dependency** Speech-to-Speech widget you can drop onto any website with one `<script>` tag â€” no React, no build step, no bundler.

Compared with [`examples/voice-agent-web`](https://github.com/xai-org/xai-cookbook/tree/main/examples/voice-agent-web) (full React client + FastAPI/Express backends), this path is for â€œpaste a script tag and talk.â€

## Quick start

```bash
# 1) Mint ephemeral tokens (API key stays on the server)
export XAI_API_KEY=your_key          # Windows: set XAI_API_KEY=your_key
node session-token-server.mjs        # or: python session-token-server.py

# 2) Serve this folder over localhost (mic needs a secure context)
#    e.g. python -m http.server 5500
# 3) Open http://127.0.0.1:5500/demo.html â†’ floating mic â†’ Start
```

### Drop-in sketch

```html
<script
  src="https://cdn.example.com/grok-voice-widget.js"
  data-token-endpoint="https://your-api.example.com/session"
  data-voice="eve"
  data-instructions="You are a helpful website assistant. Keep answers short and spoken-style."
  data-greeting="Hi! How can I help?"
  data-color="#4a90d9"
  data-position="right"
></script>
```

Or call from your own JS:

```html
<script src="./grok-voice-widget.js"></script>
<script>
  const widget = GrokVoiceWidget.init({
    tokenEndpoint: "http://127.0.0.1:8787/session",
    voice: "eve",
    textFallback: true,
  });
</script>
```

## What it does

| Piece | Behavior |
|-------|----------|
| Floating button | Customizable position / color / label |
| Voice panel | Start, mute, end-call, optional live transcript |
| Mic capture | Web Audio API â†’ PCM16 mono @ **24 kHz** (API default) |
| Turn-taking | `server_vad` (no manual commit required) |
| Playback | `response.output_audio.delta` (and `response.audio.delta`) |
| Text fallback | Optional `data-text-fallback="true"` for users without a mic |

## Auth modes

### 1. Ephemeral tokens (recommended)

1. Browser `POST`s your `data-token-endpoint`.
2. Companion server calls `POST https://api.x.ai/v1/realtime/client_secrets` with `XAI_API_KEY`.
3. Browser opens:

```js
new WebSocket(
  "wss://api.x.ai/v1/realtime?model=grok-voice-latest",
  [`xai-client-secret.${token}`]
);
```

**Never put `XAI_API_KEY` in client-side code or in this widget.**

Shipped companions (stdlib / zero npm deps):

- `session-token-server.mjs` â€” Node 18+
- `session-token-server.py` â€” Python 3.8+

Both expose:

- `GET /health` â†’ `{ ok: true }`
- `POST /session` â†’ `{ value, expires_at }`

### 2. Hosted proxy mode (optional)

If you prefer the browser never to see even an ephemeral token, point the widget at a backend that already holds the API key and proxies the Realtime WebSocket (same idea as `voice-agent-web`):

```html
<script
  src="./grok-voice-widget.js"
  data-mode="proxy"
  data-ws-url="ws://127.0.0.1:8000/ws/demo-session"
></script>
```

A full proxy implementation lives in the upstream web-agent backends; this example focuses on the ephemeral drop-in path. `proxy-server.mjs` is a minimal sketch that requires the optional [`ws`](https://www.npmjs.com/package/ws) package.

## `data-*` attributes

| Attribute | Default | Meaning |
|-----------|---------|---------|
| `data-token-endpoint` | â€” | URL that returns `{ value }` (ephemeral mode) |
| `data-mode` | `ephemeral` | `ephemeral` or `proxy` |
| `data-ws-url` | â€” | WebSocket URL when `data-mode="proxy"` |
| `data-model` | `grok-voice-latest` | Realtime model query param |
| `data-voice` | `eve` | Built-in or custom voice id |
| `data-instructions` | short spoken assistant | System prompt |
| `data-greeting` | empty | Optional first user text turn |
| `data-color` | `#4a90d9` | Accent / FAB color |
| `data-position` | `right` | `right` or `left` |
| `data-label` | `Voice` | FAB / panel title |
| `data-transcript` | `true` | Show live transcript |
| `data-text-fallback` | `false` | Show text input |
| `data-max-session-seconds` | `600` | Auto-end after N seconds |

## Audio defaults

Open questions from the FR, answered here:

- **Format:** PCM16 mono @ **24 kHz** (API default). The widget downsamples from the browserâ€™s native rate when needed.
- **Text fallback:** supported via `data-text-fallback="true"`.
- **Hosted mint:** documenting the ephemeral flow + the tiny companion servers in this folder is enough for the cookbook; a SaaS mint endpoint is out of scope.

## Tests

UAT-verified: `node --test tests/widget.test.mjs` → **13 passed** (Node 22).

`ash
# from this directory â€” use Node 18+ (Node 22 shown)
/path/to/node22 --test tests/widget.test.mjs
```

Coverage: package shape, PCM round-trip, `data-*` parsing, `session.update` shape, mocked token-server contract.

## Files

| File | Role |
|------|------|
| `grok-voice-widget.js` | The embeddable widget (only required client file) |
| `session-token-server.mjs` / `.py` | Ephemeral token companions |
| `proxy-server.mjs` | Optional WS proxy sketch (`npm i ws`) |
| `demo.html` | Local demo page |
| `tests/widget.test.mjs` | Unit / contract tests |

## References

- [Speech to Speech](https://docs.x.ai/developers/model-capabilities/audio/speech-to-speech)
- [Ephemeral tokens](https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens)
- [Voice REST reference](https://docs.x.ai/developers/rest-api-reference/inference/voice)
