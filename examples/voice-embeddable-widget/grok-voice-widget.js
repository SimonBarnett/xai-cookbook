/*!
 * grok-voice-widget.js — single-file, zero-dependency embeddable Speech-to-Speech widget.
 *
 * Drop onto any page:
 *   <script
 *     src="./grok-voice-widget.js"
 *     data-token-endpoint="http://localhost:8787/session"
 *     data-voice="eve"
 *     data-instructions="You are a helpful website assistant. Keep answers short."
 *     data-greeting="Hi! How can I help?"
 *     data-color="#4a90d9"
 *     data-position="right"
 *   ></script>
 *
 * Auth: fetch an ephemeral token from data-token-endpoint (server holds XAI_API_KEY),
 * then connect with WebSocket protocol `xai-client-secret.<token>`.
 * Optional proxy mode: set data-mode="proxy" and data-ws-url to a backend that
 * already holds the API key (see README).
 *
 * Defaults: PCM16 mono @ 24 kHz, server_vad turn-taking.
 */
(function (root) {
  "use strict";

  var SAMPLE_RATE = 24000;
  var DEFAULTS = {
    tokenEndpoint: "",
    wsUrl: "",
    mode: "ephemeral", // "ephemeral" | "proxy"
    model: "grok-voice-latest",
    voice: "eve",
    instructions:
      "You are a helpful website assistant. Keep answers short and spoken-style.",
    greeting: "",
    color: "#4a90d9",
    position: "right", // "right" | "left"
    label: "Voice",
    transcript: true,
    textFallback: false,
    maxSessionSeconds: 600,
    zIndex: 2147483000,
  };

  function float32ToBase64PCM16(float32Array) {
    var pcm16 = new Int16Array(float32Array.length);
    for (var i = 0; i < float32Array.length; i++) {
      var s = Math.max(-1, Math.min(1, float32Array[i]));
      pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    var bytes = new Uint8Array(pcm16.buffer);
    var chunk = 0x8000;
    var binary = "";
    for (var offset = 0; offset < bytes.length; offset += chunk) {
      var slice = bytes.subarray(offset, Math.min(offset + chunk, bytes.length));
      binary += String.fromCharCode.apply(null, slice);
    }
    return btoa(binary);
  }

  function base64PCM16ToFloat32(base64String) {
    var binaryString = atob(base64String);
    var bytes = new Uint8Array(binaryString.length);
    for (var i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    var pcm16 = new Int16Array(bytes.buffer);
    var float32 = new Float32Array(pcm16.length);
    for (var j = 0; j < pcm16.length; j++) {
      float32[j] = pcm16[j] / 32768.0;
    }
    return float32;
  }

  function truthy(v, fallback) {
    if (v == null || v === "") return fallback;
    if (typeof v === "boolean") return v;
    var s = String(v).toLowerCase();
    if (s === "true" || s === "1" || s === "yes") return true;
    if (s === "false" || s === "0" || s === "no") return false;
    return fallback;
  }

  /** Escape text for safe interpolation into HTML attribute/text contexts. */
  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function safePosition(v) {
    var p = String(v == null ? "" : v).toLowerCase();
    return p === "left" || p === "right" ? p : DEFAULTS.position;
  }

  function parseScriptConfig(scriptEl) {
    if (!scriptEl || !scriptEl.getAttribute) return Object.assign({}, DEFAULTS);
    function attr(name) {
      return scriptEl.getAttribute(name);
    }
    return {
      tokenEndpoint: attr("data-token-endpoint") || DEFAULTS.tokenEndpoint,
      wsUrl: attr("data-ws-url") || DEFAULTS.wsUrl,
      mode: (attr("data-mode") || DEFAULTS.mode).toLowerCase(),
      model: attr("data-model") || DEFAULTS.model,
      voice: attr("data-voice") || DEFAULTS.voice,
      instructions: attr("data-instructions") || DEFAULTS.instructions,
      greeting: attr("data-greeting") || DEFAULTS.greeting,
      color: attr("data-color") || DEFAULTS.color,
      position: safePosition(attr("data-position") || DEFAULTS.position),
      label: attr("data-label") || DEFAULTS.label,
      transcript: truthy(attr("data-transcript"), DEFAULTS.transcript),
      textFallback: truthy(attr("data-text-fallback"), DEFAULTS.textFallback),
      maxSessionSeconds: parseInt(
        attr("data-max-session-seconds") || String(DEFAULTS.maxSessionSeconds),
        10
      ),
      zIndex: parseInt(attr("data-z-index") || String(DEFAULTS.zIndex), 10),
    };
  }

  function buildSessionUpdate(cfg) {
    return {
      type: "session.update",
      session: {
        voice: cfg.voice || DEFAULTS.voice,
        instructions: cfg.instructions || DEFAULTS.instructions,
        turn_detection: { type: "server_vad" },
        audio: {
          input: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
          output: { format: { type: "audio/pcm", rate: SAMPLE_RATE } },
        },
      },
    };
  }

  function buildRealtimeUrl(model) {
    return (
      "wss://api.x.ai/v1/realtime?model=" +
      encodeURIComponent(model || DEFAULTS.model)
    );
  }

  function clientSecretProtocol(token) {
    return "xai-client-secret." + token;
  }

  function downsample(float32, fromRate, toRate) {
    if (fromRate === toRate) return float32;
    var ratio = fromRate / toRate;
    var newLen = Math.round(float32.length / ratio);
    var result = new Float32Array(newLen);
    for (var i = 0; i < newLen; i++) {
      var idx = Math.floor(i * ratio);
      result[i] = float32[idx];
    }
    return result;
  }

  function cssEscapeColor(c) {
    return String(c || DEFAULTS.color).replace(/[^-#a-zA-Z0-9(),.%\s]/g, "");
  }

  function injectStyles(color, zIndex) {
    var id = "grok-voice-widget-styles";
    if (typeof document === "undefined") return;
    if (document.getElementById(id)) return;
    var style = document.createElement("style");
    style.id = id;
    style.textContent = [
      "#grok-voice-root{all:initial;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}",
      "#grok-voice-root *{box-sizing:border-box;font-family:inherit;}",
      "#grok-voice-fab{",
      "position:fixed;bottom:24px;width:56px;height:56px;border-radius:50%;",
      "border:none;cursor:pointer;color:#fff;font-size:22px;line-height:1;",
      "box-shadow:0 4px 16px rgba(0,0,0,.25);z-index:" + zIndex + ";",
      "background:" + color + ";",
      "display:flex;align-items:center;justify-content:center;",
      "}",
      "#grok-voice-fab.left{left:24px;right:auto;}",
      "#grok-voice-fab.right{right:24px;left:auto;}",
      "#grok-voice-panel{",
      "position:fixed;bottom:92px;width:320px;max-width:calc(100vw - 24px);",
      "background:#111;color:#f5f5f5;border-radius:16px;padding:16px;",
      "box-shadow:0 8px 32px rgba(0,0,0,.35);z-index:" + (zIndex + 1) + ";",
      "display:none;flex-direction:column;gap:12px;",
      "}",
      "#grok-voice-panel.open{display:flex;}",
      "#grok-voice-panel.left{left:24px;right:auto;}",
      "#grok-voice-panel.right{right:24px;left:auto;}",
      "#grok-voice-panel h2{margin:0;font-size:15px;font-weight:600;}",
      "#grok-voice-status{font-size:12px;opacity:.8;min-height:1.2em;}",
      "#grok-voice-controls{display:flex;gap:8px;flex-wrap:wrap;}",
      "#grok-voice-controls button{",
      "flex:1;min-width:70px;border:none;border-radius:10px;padding:10px 8px;",
      "cursor:pointer;background:#2a2a2a;color:#fff;font-size:13px;",
      "}",
      "#grok-voice-controls button.primary{background:" + color + ";}",
      "#grok-voice-controls button:disabled{opacity:.45;cursor:not-allowed;}",
      "#grok-voice-transcript{",
      "max-height:160px;overflow:auto;font-size:12px;line-height:1.4;",
      "background:#1a1a1a;border-radius:10px;padding:8px;display:none;",
      "}",
      "#grok-voice-transcript.show{display:block;}",
      "#grok-voice-transcript .u{color:#9cdcfe;}",
      "#grok-voice-transcript .a{color:#ce9178;}",
      "#grok-voice-textrow{display:none;gap:6px;}",
      "#grok-voice-textrow.show{display:flex;}",
      "#grok-voice-textrow input{",
      "flex:1;border-radius:8px;border:1px solid #333;background:#1a1a1a;",
      "color:#fff;padding:8px;font-size:13px;",
      "}",
      "#grok-voice-textrow button{",
      "border:none;border-radius:8px;padding:8px 12px;background:" +
        color +
        ";color:#fff;cursor:pointer;",
      "}",
    ].join("");
    document.head.appendChild(style);
  }

  function createWidget(userConfig) {
    var cfg = Object.assign({}, DEFAULTS, userConfig || {});
    cfg.color = cssEscapeColor(cfg.color);
    cfg.position = cfg.position === "left" ? "left" : "right";
    cfg.mode = cfg.mode === "proxy" ? "proxy" : "ephemeral";

    if (typeof document === "undefined") {
      return { config: cfg, destroy: function () {} };
    }

    injectStyles(cfg.color, cfg.zIndex);

    var existing = document.getElementById("grok-voice-root");
    if (existing) existing.remove();

    var rootEl = document.createElement("div");
    rootEl.id = "grok-voice-root";
    var safeLabel = escapeHtml(cfg.label);
    var safePos = safePosition(cfg.position);
    rootEl.innerHTML =
      '<button id="grok-voice-fab" class="' +
      safePos +
      '" type="button" aria-label="' +
      safeLabel +
      '" title="' +
      safeLabel +
      '">🎤</button>' +
      '<div id="grok-voice-panel" class="' +
      safePos +
      '" role="dialog" aria-label="Grok voice assistant">' +
      "<h2>" +
      safeLabel +
      "</h2>" +
      '<div id="grok-voice-status">Idle</div>' +
      '<div id="grok-voice-controls">' +
      '<button type="button" class="primary" data-act="start">Start</button>' +
      '<button type="button" data-act="mute" disabled>Mute</button>' +
      '<button type="button" data-act="end" disabled>End</button>' +
      "</div>" +
      '<div id="grok-voice-transcript"></div>' +
      '<div id="grok-voice-textrow">' +
      '<input type="text" placeholder="Type a message…" autocomplete="off" />' +
      '<button type="button" data-act="send">Send</button>' +
      "</div>" +
      "</div>";
    document.body.appendChild(rootEl);

    var fab = rootEl.querySelector("#grok-voice-fab");
    var panel = rootEl.querySelector("#grok-voice-panel");
    var statusEl = rootEl.querySelector("#grok-voice-status");
    var transcriptEl = rootEl.querySelector("#grok-voice-transcript");
    var textRow = rootEl.querySelector("#grok-voice-textrow");
    var textInput = textRow.querySelector("input");
    var btnStart = panel.querySelector('[data-act="start"]');
    var btnMute = panel.querySelector('[data-act="mute"]');
    var btnEnd = panel.querySelector('[data-act="end"]');
    var btnSend = panel.querySelector('[data-act="send"]');

    if (cfg.transcript) transcriptEl.classList.add("show");
    if (cfg.textFallback) textRow.classList.add("show");

    var state = {
      open: false,
      ws: null,
      audioCtx: null,
      mediaStream: null,
      processor: null,
      source: null,
      muted: false,
      playing: false,
      nextPlayTime: 0,
      sessionTimer: null,
      destroyed: false,
    };

    function setStatus(msg) {
      statusEl.textContent = msg;
    }

    function appendTranscript(role, text) {
      if (!cfg.transcript || !text) return;
      var line = document.createElement("div");
      line.className = role === "user" ? "u" : "a";
      line.textContent = (role === "user" ? "You: " : "Grok: ") + text;
      transcriptEl.appendChild(line);
      transcriptEl.scrollTop = transcriptEl.scrollHeight;
    }

    function setConnectedUi(connected) {
      btnStart.disabled = connected;
      btnMute.disabled = !connected;
      btnEnd.disabled = !connected;
      btnMute.textContent = state.muted ? "Unmute" : "Mute";
    }

    function stopMic() {
      try {
        if (state.processor) {
          state.processor.disconnect();
          state.processor.onaudioprocess = null;
        }
      } catch (e) {}
      try {
        if (state.source) state.source.disconnect();
      } catch (e2) {}
      state.processor = null;
      state.source = null;
      if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(function (t) {
          t.stop();
        });
        state.mediaStream = null;
      }
    }

    function closeAudio() {
      stopMic();
      if (state.audioCtx) {
        try {
          state.audioCtx.close();
        } catch (e) {}
        state.audioCtx = null;
      }
      state.nextPlayTime = 0;
    }

    function cleanupSession() {
      if (state.sessionTimer) {
        clearTimeout(state.sessionTimer);
        state.sessionTimer = null;
      }
      if (state.ws) {
        try {
          state.ws.onopen = state.ws.onmessage = state.ws.onerror = state.ws.onclose = null;
          if (
            state.ws.readyState === WebSocket.OPEN ||
            state.ws.readyState === WebSocket.CONNECTING
          ) {
            state.ws.close();
          }
        } catch (e) {}
        state.ws = null;
      }
      closeAudio();
      state.muted = false;
      setConnectedUi(false);
    }

    function playPcmBase64(b64) {
      if (!state.audioCtx || !b64) return;
      var float32 = base64PCM16ToFloat32(b64);
      var buffer = state.audioCtx.createBuffer(1, float32.length, SAMPLE_RATE);
      buffer.copyToChannel(float32, 0);
      var src = state.audioCtx.createBufferSource();
      src.buffer = buffer;
      src.connect(state.audioCtx.destination);
      var now = state.audioCtx.currentTime;
      if (state.nextPlayTime < now) state.nextPlayTime = now;
      src.start(state.nextPlayTime);
      state.nextPlayTime += buffer.duration;
    }

    function sendJson(obj) {
      if (state.ws && state.ws.readyState === WebSocket.OPEN) {
        state.ws.send(JSON.stringify(obj));
      }
    }

    function sendGreeting() {
      if (!cfg.greeting) return;
      sendJson({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: cfg.greeting }],
        },
      });
      sendJson({ type: "response.create" });
      appendTranscript("user", cfg.greeting);
    }

    function sendText(text) {
      var t = (text || "").trim();
      if (!t) return;
      sendJson({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: t }],
        },
      });
      sendJson({ type: "response.create" });
      appendTranscript("user", t);
      textInput.value = "";
    }

    async function startMic() {
      state.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      if (!state.audioCtx) {
        state.audioCtx = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: SAMPLE_RATE,
        });
      }
      if (state.audioCtx.state === "suspended") {
        await state.audioCtx.resume();
      }
      state.source = state.audioCtx.createMediaStreamSource(state.mediaStream);
      // ScriptProcessor is deprecated but zero-dep and widely available.
      var bufferSize = 4096;
      state.processor = state.audioCtx.createScriptProcessor(bufferSize, 1, 1);
      state.processor.onaudioprocess = function (ev) {
        if (state.muted || !state.ws || state.ws.readyState !== WebSocket.OPEN) {
          return;
        }
        var input = ev.inputBuffer.getChannelData(0);
        var fromRate = state.audioCtx.sampleRate;
        var pcm = downsample(input, fromRate, SAMPLE_RATE);
        var audio = float32ToBase64PCM16(pcm);
        sendJson({ type: "input_audio_buffer.append", audio: audio });
      };
      state.source.connect(state.processor);
      state.processor.connect(state.audioCtx.destination);
    }

    async function fetchEphemeralToken() {
      if (!cfg.tokenEndpoint) {
        throw new Error(
          "data-token-endpoint is required in ephemeral mode (API key must stay on the server)."
        );
      }
      var res = await fetch(cfg.tokenEndpoint, {
        method: "POST",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        var body = await res.text();
        throw new Error("Token endpoint HTTP " + res.status + ": " + body);
      }
      var json = await res.json();
      var token = json.value || json.client_secret || json.token;
      if (!token) throw new Error("Token endpoint response missing value");
      return token;
    }

    function handleServerEvent(event) {
      if (!event || !event.type) return;
      switch (event.type) {
        case "session.updated":
        case "session.created":
          setStatus("Listening…");
          break;
        case "input_audio_buffer.speech_started":
          setStatus("Hearing you…");
          break;
        case "input_audio_buffer.speech_stopped":
          setStatus("Thinking…");
          break;
        case "response.output_audio.delta":
        case "response.audio.delta":
          playPcmBase64(event.delta || event.audio);
          setStatus("Speaking…");
          break;
        case "response.output_audio_transcript.delta":
        case "response.audio_transcript.delta":
          break;
        case "response.output_audio_transcript.done":
        case "response.audio_transcript.done":
          appendTranscript("assistant", event.transcript || "");
          break;
        case "conversation.item.input_audio_transcription.completed":
          appendTranscript("user", event.transcript || "");
          break;
        case "response.done":
          setStatus("Listening…");
          break;
        case "error":
          setStatus(
            "Error: " +
              ((event.error && (event.error.message || event.error.code)) ||
                "unknown")
          );
          break;
        default:
          break;
      }
    }

    async function startSession() {
      cleanupSession();
      setStatus("Connecting…");
      setConnectedUi(true);

      try {
        if (!state.audioCtx) {
          state.audioCtx = new (window.AudioContext ||
            window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        }

        var ws;
        if (cfg.mode === "proxy") {
          if (!cfg.wsUrl) throw new Error("data-ws-url required in proxy mode");
          ws = new WebSocket(cfg.wsUrl);
        } else {
          var token = await fetchEphemeralToken();
          var url = buildRealtimeUrl(cfg.model);
          ws = new WebSocket(url, [clientSecretProtocol(token)]);
        }

        state.ws = ws;
        ws.addEventListener("open", function () {
          sendJson(buildSessionUpdate(cfg));
          startMic()
            .then(function () {
              setStatus("Listening…");
              sendGreeting();
            })
            .catch(function (err) {
              setStatus("Mic error: " + (err && err.message ? err.message : err));
            });
        });
        ws.addEventListener("message", function (ev) {
          if (typeof ev.data !== "string") return;
          try {
            handleServerEvent(JSON.parse(ev.data));
          } catch (e) {}
        });
        ws.addEventListener("error", function () {
          setStatus("WebSocket error");
        });
        ws.addEventListener("close", function () {
          setStatus("Disconnected");
          cleanupSession();
        });

        if (cfg.maxSessionSeconds > 0) {
          state.sessionTimer = setTimeout(function () {
            setStatus("Session limit reached");
            cleanupSession();
          }, cfg.maxSessionSeconds * 1000);
        }
      } catch (err) {
        setStatus("Failed: " + (err && err.message ? err.message : err));
        cleanupSession();
      }
    }

    fab.addEventListener("click", function () {
      state.open = !state.open;
      panel.classList.toggle("open", state.open);
    });
    btnStart.addEventListener("click", function () {
      startSession();
    });
    btnMute.addEventListener("click", function () {
      state.muted = !state.muted;
      btnMute.textContent = state.muted ? "Unmute" : "Mute";
      setStatus(state.muted ? "Muted" : "Listening…");
    });
    btnEnd.addEventListener("click", function () {
      cleanupSession();
      setStatus("Ended");
    });
    btnSend.addEventListener("click", function () {
      sendText(textInput.value);
    });
    textInput.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        sendText(textInput.value);
      }
    });

    return {
      config: cfg,
      open: function () {
        state.open = true;
        panel.classList.add("open");
      },
      close: function () {
        state.open = false;
        panel.classList.remove("open");
      },
      start: startSession,
      end: function () {
        cleanupSession();
        setStatus("Ended");
      },
      destroy: function () {
        if (state.destroyed) return;
        state.destroyed = true;
        cleanupSession();
        rootEl.remove();
      },
    };
  }

  function autoInit() {
    if (typeof document === "undefined") return null;
    var script =
      document.currentScript ||
      (function () {
        var scripts = document.getElementsByTagName("script");
        for (var i = scripts.length - 1; i >= 0; i--) {
          if (
            scripts[i].src &&
            scripts[i].src.indexOf("grok-voice-widget") !== -1
          ) {
            return scripts[i];
          }
        }
        return null;
      })();
    if (!script) return null;
    var cfg = parseScriptConfig(script);
    if (cfg.mode === "ephemeral" && !cfg.tokenEndpoint && !cfg.wsUrl) {
      // Still mount UI so authors see the widget; Start will explain the missing endpoint.
    }
    function mount() {
      return createWidget(cfg);
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", mount);
      return null;
    }
    return mount();
  }

  var api = {
    init: createWidget,
    mount: createWidget,
    VERSION: "0.1.0",
    _internals: {
      SAMPLE_RATE: SAMPLE_RATE,
      DEFAULTS: DEFAULTS,
      float32ToBase64PCM16: float32ToBase64PCM16,
      base64PCM16ToFloat32: base64PCM16ToFloat32,
      parseScriptConfig: parseScriptConfig,
      buildSessionUpdate: buildSessionUpdate,
      buildRealtimeUrl: buildRealtimeUrl,
      clientSecretProtocol: clientSecretProtocol,
      downsample: downsample,
      escapeHtml: escapeHtml,
      safePosition: safePosition,
    },
  };

  root.GrokVoiceWidget = api;
  autoInit();
})(typeof window !== "undefined" ? window : globalThis);
