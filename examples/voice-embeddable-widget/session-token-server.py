#!/usr/bin/env python3
"""Tiny ephemeral-token minting server for grok-voice-widget.js (stdlib only).

Holds XAI_API_KEY on the server and exposes POST /session for the browser.

    set XAI_API_KEY=...
    python session-token-server.py
    # listens on http://127.0.0.1:8787

Env:
    XAI_API_KEY          required for minting
    XAI_API_BASE         default https://api.x.ai
    TOKEN_TTL_SECONDS    default 300
    HOST / PORT          default 127.0.0.1 / 8787
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


API_BASE = os.environ.get("XAI_API_BASE", "https://api.x.ai").rstrip("/")
API_KEY = os.environ.get("XAI_API_KEY", "")
TTL = int(os.environ.get("TOKEN_TTL_SECONDS", "300"))
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "8787"))


def mint_token() -> dict:
    if not API_KEY:
        raise RuntimeError("XAI_API_KEY is not set")
    payload = json.dumps({"expires_after": {"seconds": TTL}}).encode("utf-8")
    req = urllib.request.Request(
        f"{API_BASE}/v1/realtime/client_secrets",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"client_secrets HTTP {e.code}: {body[:400]}") from e


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quieter default logs
        sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header(
            "Access-Control-Allow-Headers", "Content-Type,Authorization,Accept"
        )

    def _json(self, status: int, obj: dict) -> None:
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self._cors()
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path in ("/", "/health"):
            self._json(
                200,
                {
                    "ok": True,
                    "service": "grok-voice-widget-session-token-server",
                    "hasApiKey": bool(API_KEY),
                },
            )
            return
        self._json(404, {"error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        path = self.path.split("?", 1)[0]
        if path not in ("/session", "/sessions"):
            self._json(404, {"error": "not found"})
            return
        try:
            data = mint_token()
            self._json(
                200,
                {"value": data.get("value"), "expires_at": data.get("expires_at")},
            )
        except Exception as e:  # noqa: BLE001 - surface mint errors to client
            self._json(500, {"error": str(e)})


def main() -> None:
    # Allow --port / --host overrides like the Node server.
    host, port = HOST, PORT
    args = sys.argv[1:]
    if "--host" in args:
        host = args[args.index("--host") + 1]
    if "--port" in args:
        port = int(args[args.index("--port") + 1])

    httpd = ThreadingHTTPServer((host, port), Handler)
    real_port = httpd.server_address[1]
    print(f"listening on http://{host}:{real_port}", flush=True)
    if not API_KEY:
        print("warning: XAI_API_KEY is not set; POST /session will fail", flush=True)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nbye", flush=True)


if __name__ == "__main__":
    main()
