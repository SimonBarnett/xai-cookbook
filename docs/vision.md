# Vision: xai-cookbook (SimonBarnett fork)

## Objective

Ship small, copy-pasteable xAI cookbook examples that lower the barrier versus full multi-service demos, starting with an embeddable Speech-to-Speech voice widget.

## Success

| id | metric | target | how measured | fail-when |
|----|--------|--------|--------------|-----------|
| S1 | Embeddable widget ships | Single-file `grok-voice-widget.js` + demo + README + token companion in `examples/voice-embeddable-widget` | Paths exist on `main`; package-shape tests pass | Missing widget or companions |
| S2 | Zero client API key | Widget never embeds `XAI_API_KEY`; uses ephemeral token endpoint or proxy | Grep widget for secrets; token server holds key | Key in client bundle |
| S3 | Audio defaults | PCM16 mono @ 24 kHz; `server_vad` turn-taking | Unit tests + `buildSessionUpdate` | Wrong rate / no server_vad |
| S4 | Script-tag config | `data-*` attributes (voice, instructions, greeting, color, position, token endpoint) | `parseScriptConfig` tests + demo.html | Config ignored |
| S5 | XSS-safe shell | `data-label` / position escaped before `innerHTML` | `escapeHtml` / `safePosition` tests | Raw attribute injection |
| S6 | Automated contract | `node --test examples/voice-embeddable-widget/tests/widget.test.mjs` green | CI / UAT seat run | Any failing test |
| S7 | Release artefact | GitHub Release includes `grok-voice-widget.js` | `gh release view` lists asset | Missing asset |

## Shape

Primary: embeddable web widget example (static JS) + tiny companion token servers (Node/Python).

## Stack

Vanilla JS (no build), Node 18+ / Python 3.8+ stdlib companions, xAI Realtime / Speech-to-Speech API.