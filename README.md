# xai-cookbook

Fork of [xai-org/xai-cookbook](https://github.com/xai-org/xai-cookbook) for feature requests and experiments.

## Examples in this fork

| Example | Description |
|---------|-------------|
| [`examples/voice-embeddable-widget`](./examples/voice-embeddable-widget) | Single-file, zero-dependency embeddable Speech-to-Speech voice widget (script-tag drop-in + ephemeral token companion) |

Upstream cookbook examples (voice-agent-web, WebRTC, telephony, and more) live in the [parent repository](https://github.com/xai-org/xai-cookbook).

## Status

UAT-verified on `main` at tag `v0.1.1` (unit/contract tests for `examples/voice-embeddable-widget`: 13 passed on Node 22; ephemeral token `GET /health` ok). Live mic + Realtime WSS session was not exercised in the UAT seat (no browser + no API key in the job environment).

See [`docs/vision.md`](./docs/vision.md) for success metrics.