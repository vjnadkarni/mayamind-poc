# MayaMind TalkingHead POC — CLAUDE.md

## Project Overview

A real-time interactive avatar web app. User speaks → Deepgram transcribes → Claude generates response → ElevenLabs synthesizes speech → TalkingHead 3D avatar lip-syncs the audio. Target end-to-end latency: ~3 seconds.

This is a fast POC. No auth, no database, no production hardening. Get the conversation loop working.

## Architecture

```
User mic → Deepgram STT (WebSocket) → Claude Sonnet 4.6 (SSE streaming)
         → ElevenLabs TTS (WebSocket) → TalkingHead 3D avatar (lip-sync)
```

All API keys stay server-side. Browser only talks to localhost WebSocket/HTTP proxies.

## Directory Structure

```
mayamind-poc/
├── .env                    # API keys — in ROOT (not server/), gitignored
├── CLAUDE.md
├── MayaMind_TalkingHead_POC_Prompt.md
├── setup.sh                # Downloads TalkingHead assets from GitHub
├── server/
│   ├── server.js           # Express server: static files + API proxies
│   └── package.json
└── public/
    ├── index.html          # Single page UI
    ├── app.js              # Conversation pipeline orchestration
    ├── modules/            # TalkingHead JS modules (from GitHub release)
    ├── avatars/            # GLB avatar file(s)
    └── animations/         # FBX Mixamo animations
```

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Avatar | TalkingHead 3D (github.com/met4citizen/TalkingHead) — ThreeJS/WebGL |
| STT | Deepgram Nova-3, WebSocket streaming |
| LLM | Claude Sonnet 4.6 (`claude-sonnet-4-6`) via Anthropic API |
| TTS | ElevenLabs `eleven_turbo_v2_5`, WebSocket streaming |
| Backend | Node.js + Express |
| Frontend | Vanilla HTML/JS, no framework |

## Environment Variables

`.env` lives in the **project root** (not `server/`). `server.js` loads it with `require('dotenv').config({ path: '../.env' })` or `path.join(__dirname, '..', '.env')`.

All required keys are present in `.env` **except** `ELEVENLABS_VOICE_ID`, which must be added:

```
ELEVENLABS_VOICE_ID=21m00Tcm4TlvDq8ikWAM   # Rachel — warm conversational female
```

Keys used by this project:
- `ANTHROPIC_API_KEY` ✅
- `DEEPGRAM_API_KEY` ✅
- `ELEVENLABS_API_KEY` ✅
- `ELEVENLABS_VOICE_ID` — **ADD THIS** (Rachel: `21m00Tcm4TlvDq8ikWAM`)
- `PORT=3000` — add if not present

## Setup

### 1. Run the setup script (first time only)

```bash
chmod +x setup.sh && ./setup.sh
```

This clones TalkingHead, copies modules/avatars/animations, and runs `npm install`.

### 2. Update avatar filename if needed

```bash
ls public/avatars/      # see what GLB was copied
# Update AVATAR_URL constant at top of public/app.js if filename differs from brunette.glb
```

### 3. Run

```bash
node server/server.js
# Open http://localhost:3000 in Chrome
```

## Key Implementation Details

### Claude API

- Model: `claude-sonnet-4-6` (do NOT add a date suffix — use this exact ID)
- `max_tokens: 300` — keeps responses short and fast
- `stream: true` — SSE streaming
- **Do NOT enable extended thinking** — we want fast token generation
- Endpoint: `POST /api/chat` — accepts `{ messages, system }`, returns SSE
- System prompt: Maya is a warm wellness companion for seniors; short sentences; no markdown

### Deepgram WebSocket Proxy (`/ws/deepgram`)

- Upstream: `wss://api.deepgram.com/v1/listen`
- Config: `{ model: "nova-3", language: "en", smart_format: true, interim_results: true, endpointing: 300, utterance_end_ms: 1000 }`
- `endpointing: 300` = detects end-of-speech after 300ms silence (default 800ms saves ~500ms)
- Trigger Claude call on `utterance_end` event or final transcript

### ElevenLabs WebSocket Proxy (`/ws/elevenlabs`)

- Upstream: `wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_16000`
- Model: `eleven_turbo_v2_5` (lowest latency)
- Init message: `{ text: " ", voice_settings: { stability: 0.5, similarity_boost: 0.75 }, generation_config: { chunk_length_schedule: [120, 160, 250, 290] }, xi_api_key: "...", try_trigger_generation: true }`
- Text chunk messages: `{ text: "sentence ", try_trigger_generation: true }`
- Flush signal (end of LLM response): `{ text: "" }`
- Returns audio (PCM) + alignment JSON (character-level timestamps) — forward both to browser

### Sentence-Level Pipelining (Critical for Latency)

Do NOT wait for the full Claude response. As SSE tokens arrive, buffer and detect sentence boundaries:

```javascript
let buffer = '';
// On each token:
buffer += token;
const match = buffer.match(/[.!?]\s/);
if (match) {
  const sentence = buffer.substring(0, match.index + 1);
  buffer = buffer.substring(match.index + 2);
  sendToElevenLabs(sentence);
}
// On SSE stream end:
if (buffer.trim()) sendToElevenLabs(buffer);
flushElevenLabs();
```

### TalkingHead Integration

- Import: `import { TalkingHead } from './modules/talkinghead.mjs'`
- Init with `ttsEndpoint: null` (we handle TTS externally)
- `cameraView: 'upper'` (head and shoulders)
- Use `head.speakAudio(audioObj)` where:
  ```javascript
  { audio: audioBuffer, words: [...], wtimes: [...], wdurations: [...] }
  ```
- ElevenLabs returns char-level alignment — aggregate chars into words before passing to `speakAudio`
- **Refer to TalkingHead README Appendix G** for exact `speakAudio` format
- Also study `index.html` in the TalkingHead repo — it already has ElevenLabs WebSocket wired up. Reuse that pattern.

### Audio Capture (Frontend)

- `navigator.mediaDevices.getUserMedia({ audio: true })`
- `MediaRecorder` with `mimeType: 'audio/webm;codecs=opus'` OR AudioWorklet for raw PCM at 16kHz
- Deepgram prefers linear16 PCM at 16kHz for lowest latency

### Conversation State

```javascript
const conversationHistory = [];
// Keep last 20 messages (trim oldest pair when > 20)
```

### UI

- Dark background, full-screen WebGL canvas (~80% viewport)
- Small transcript panel at bottom (user messages gray, assistant blue)
- Mic button / hold-to-talk
- Status text: "Listening..." / "Thinking..." / "Speaking..."
- No CSS framework — basic flexbox

## Latency Optimization Checklist

1. `endpointing: 300` on Deepgram (saves ~500ms vs default)
2. Stream Claude, start ElevenLabs on first sentence (saves 1–2s)
3. `eleven_turbo_v2_5` + `chunk_length_schedule: [120, 160, 250, 290]`
4. `max_tokens: 300` forces short responses
5. Keep WebSocket connections alive — do NOT reconnect per utterance
6. No extended thinking on Claude

## Testing

- Test in Chrome on desktop first (best WebGL support)
- Safari and mobile are out of scope for POC
- Success: 5 back-and-forth exchanges with ≤5s latency (target 3s)

## Reference Links

- TalkingHead: https://github.com/met4citizen/TalkingHead (README Appendix G + index.html)
- Deepgram streaming: https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
- ElevenLabs WebSocket TTS: https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-websockets
- Anthropic streaming: https://docs.anthropic.com/en/api/messages-streaming

## GitHub

- Account: https://github.com/vjnadkarni
- Remote repo: `git@github.com:vjnadkarni/mayamind-poc.git`
- **Always use SSH** (`git@github.com:...`) — HTTPS and username/password are disabled
- Ask the user for the SSH git command if needed before pushing
