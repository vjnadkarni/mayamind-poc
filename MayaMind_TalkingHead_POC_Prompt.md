# MayaMind Interactive Avatar POC — Claude Code Prompt

## Objective

Build a proof-of-concept web application that demonstrates a real-time interactive conversation between a human user and a 3D cartoon avatar. The user speaks, their speech is transcribed, sent to an LLM, and the LLM's response is spoken by the avatar with real-time lip-sync. Target end-to-end latency from user finishing speaking to avatar starting to speak: ~3 seconds.

This is a fast POC — prioritize getting the conversation loop working over polish. No authentication, no database, no production hardening needed.

## Architecture

```
User speaks into mic
       ↓
Deepgram STT (streaming WebSocket)
       ↓
Transcribed text
       ↓
Claude Sonnet 4.6 API (streaming)
       ↓
Response text (streamed in chunks)
       ↓
ElevenLabs TTS (WebSocket streaming)
       ↓
Audio chunks + word timestamps
       ↓
TalkingHead 3D avatar (on-screen, lip-synced)
```

## Tech Stack

| Component | Technology | Role |
|-----------|-----------|------|
| Avatar rendering | TalkingHead 3D (github.com/met4citizen/TalkingHead) | 3D avatar with real-time lip-sync in browser via ThreeJS/WebGL |
| Speech-to-text | Deepgram Nova-3 (WebSocket streaming API) | Real-time transcription of user speech |
| LLM | Claude Sonnet 4.6 (`claude-sonnet-4-6-20260217`) via Anthropic API | Generate conversational responses |
| Text-to-speech | ElevenLabs (WebSocket streaming API) | Natural voice synthesis with word-level timestamps |
| Backend | Node.js + Express | API proxy server (protects API keys, handles CORS) |
| Frontend | Vanilla HTML/JS (single page) | Hosts TalkingHead, manages conversation pipeline |

## Project Structure

```
mayamind-poc/
├── server/
│   ├── server.js              # Express server with API proxies
│   ├── package.json
│   └── .env                   # API keys (gitignored)
├── public/
│   ├── index.html             # Main page
│   ├── app.js                 # Conversation pipeline orchestration
│   ├── modules/               # TalkingHead modules (copied from repo)
│   ├── avatars/               # GLB avatar file(s)
│   └── animations/            # FBX Mixamo animations
└── README.md
```

## Detailed Implementation Instructions

### Step 1: Project Setup

```bash
mkdir mayamind-poc && cd mayamind-poc
npm init -y
npm install express cors dotenv @anthropic-ai/sdk ws
```

Clone or download the TalkingHead modules from https://github.com/met4citizen/TalkingHead/releases — you need the JavaScript modules from `modules/`, not the full repo. Copy them into `public/modules/`.

For the avatar model: Download a sample GLB avatar. Since Ready Player Me is shutting down, use one of the sample avatars included in the TalkingHead repo's `avatars/` directory, or create one using Blender with Mixamo-compatible rig and ARKit/Oculus viseme blend shapes.

Similarly, copy a few basic animations from the TalkingHead repo's `animations/` directory (idle, talking, gestures).

### Step 2: Environment Variables

Create `server/.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
DEEPGRAM_API_KEY=...
ELEVENLABS_API_KEY=...
ELEVENLABS_VOICE_ID=...
PORT=3000
```

For the ElevenLabs voice, choose a warm, friendly female or male voice from the ElevenLabs voice library. The voice ID can be found in the ElevenLabs dashboard.

### Step 3: Backend Server (server/server.js)

The server has three responsibilities:
1. Serve static files from `public/`
2. Proxy the Anthropic API (so the API key isn't exposed to the browser)
3. Proxy WebSocket connections for ElevenLabs and Deepgram (so API keys stay server-side)

#### 3A: Anthropic API Proxy

Create a POST endpoint `/api/chat` that:
- Accepts `{ messages: [...], system: "..." }` from the frontend
- Calls the Anthropic Messages API with streaming enabled
- Uses model `claude-sonnet-4-6-20260217`
- Streams the response back to the frontend using Server-Sent Events (SSE)
- Set `max_tokens: 300` to keep responses concise and fast (this is a conversation, not an essay)

The system prompt should be:
```
You are Maya, a warm and caring wellness companion for seniors. You speak in short,
clear sentences. Keep responses to 2-3 sentences maximum — this is a spoken conversation,
not written text. Be encouraging, patient, and positive. Never use markdown, bullet points,
or special formatting. Speak naturally as if talking to a friend.

IMPORTANT: Begin every response with a mood tag [MOOD:xxx] where xxx is one of:
neutral, happy, angry, sad, fear, disgust, love, sleep.

Choose the mood that best serves the user emotionally:
- User is happy or positive → [MOOD:happy]
- User is angry or frustrated → [MOOD:neutral] (stay calm, de-escalate)
- User is sad or lonely → [MOOD:love] (warm, empathetic)
- User is fearful or anxious → [MOOD:neutral] (calm, reassuring)
- User is disgusted or annoyed → [MOOD:neutral] (understanding, non-judgmental)
- User expresses love or gratitude → [MOOD:love]
- User seems tired or sleepy → [MOOD:happy] (gently encouraging)
- Default or unclear → [MOOD:neutral]

The tag must be the very first text, followed by a space, then your spoken words.
Example: [MOOD:happy] That sounds wonderful!
```

**Critical for latency:** Stream the Claude response and begin sending text to ElevenLabs as soon as the first complete sentence arrives — do NOT wait for the full response. Split on sentence boundaries (period, question mark, exclamation mark followed by a space).

#### 3B: Deepgram WebSocket Proxy

Create a WebSocket endpoint `/ws/deepgram` that:
- Accepts raw audio from the browser's MediaRecorder
- Forwards it to Deepgram's streaming WebSocket API (`wss://api.deepgram.com/v1/listen`)
- Deepgram config: `{ model: "nova-3", language: "en", smart_format: true, interim_results: true, endpointing: 300, utterance_end_ms: 1000 }`
- The `endpointing: 300` setting detects end-of-speech after 300ms of silence — critical for latency
- The `utterance_end_ms: 1000` sends an utterance_end event after 1 second of silence
- Forwards Deepgram's transcription results back to the browser

#### 3C: ElevenLabs WebSocket Proxy

Create a WebSocket endpoint `/ws/elevenlabs` that:
- Accepts text chunks from the browser
- Opens/maintains a connection to ElevenLabs' WebSocket streaming API (`wss://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream-input?model_id=eleven_turbo_v2_5&output_format=pcm_16000`)
- Use `eleven_turbo_v2_5` model for lowest latency (or `eleven_flash_v2_5` if available)
- In the initial message to ElevenLabs, set:
  ```json
  {
    "text": " ",
    "voice_settings": { "stability": 0.5, "similarity_boost": 0.75 },
    "generation_config": { "chunk_length_schedule": [120, 160, 250, 290] },
    "xi_api_key": "...",
    "try_trigger_generation": true
  }
  ```
- Forward subsequent text chunks as: `{ "text": "sentence text ", "try_trigger_generation": true }`
- When the LLM response is complete, send the flush signal: `{ "text": "" }`
- Forward audio chunks and alignment data (word timestamps) back to the browser
- The alignment data from ElevenLabs provides word-level timing, which TalkingHead needs for lip-sync

### Step 4: Frontend (public/app.js)

The frontend orchestrates the full conversation pipeline.

#### 4A: Initialize TalkingHead

```javascript
import { TalkingHead } from './modules/talkinghead.mjs';

const head = new TalkingHead(document.getElementById('avatar'), {
  ttsEndpoint: null,       // We handle TTS externally
  cameraView: 'upper',     // Head and shoulders view
  cameraRotateEnable: true
});

// Load avatar
await head.showAvatar({
  url: './avatars/your-avatar.glb',
  body: 'F',              // or 'M' for male
  avatarMood: 'happy',
  lipsyncLang: 'en'
});
```

#### 4B: Audio Capture and Deepgram STT

Use the browser's `navigator.mediaDevices.getUserMedia()` to capture microphone audio. Connect to the Deepgram proxy WebSocket at `ws://localhost:3000/ws/deepgram`.

Implement a **push-to-talk** or **voice activity detection** approach:
- Simpler (recommended for POC): Use a "Hold to Talk" button, or detect the Deepgram `utterance_end` event to know when the user has stopped speaking
- When `utterance_end` fires or the user releases the button, collect the final transcript and trigger the LLM call

Use `MediaRecorder` with `mimeType: 'audio/webm;codecs=opus'` or a raw PCM approach using AudioWorklet/ScriptProcessorNode, depending on what Deepgram accepts. Deepgram's streaming API accepts various formats — linear16 PCM at 16kHz is ideal.

#### 4C: LLM Call (Claude Streaming via SSE)

When a complete user utterance is available:
1. Add it to the conversation history array
2. POST to `/api/chat` with the message history
3. Read the SSE stream
4. As each sentence-sized chunk arrives, immediately forward it to the ElevenLabs WebSocket

**Sentence buffering logic:**
```javascript
let buffer = '';
// As SSE tokens arrive:
buffer += token;
// Check for sentence boundary
const sentenceEnd = buffer.match(/[.!?]\s/);
if (sentenceEnd) {
  const sentence = buffer.substring(0, sentenceEnd.index + 1);
  buffer = buffer.substring(sentenceEnd.index + 2);
  sendToElevenLabs(sentence);
}
// When SSE stream ends, flush remaining buffer
if (buffer.trim()) sendToElevenLabs(buffer);
flushElevenLabs();
```

#### 4D: ElevenLabs TTS → TalkingHead Lip-Sync

Connect to the ElevenLabs proxy WebSocket at `ws://localhost:3000/ws/elevenlabs`.

When audio and alignment data arrive from ElevenLabs:
- ElevenLabs streams back audio chunks and alignment JSON with word-level timestamps
- Use TalkingHead's `speakAudio` method to feed the audio with timing data:

```javascript
// When receiving from ElevenLabs WebSocket:
// audio = ArrayBuffer of PCM audio
// alignment = { chars: [...], charStartTimesMs: [...], charDurationsMs: [...] }

// Convert to the format TalkingHead expects:
const audioObj = {
  audio: audioBuffer,           // AudioBuffer or PCM chunks
  words: alignment.words,       // Array of words
  wtimes: alignment.wordStartTimesMs,  // Start times in ms
  wdurations: alignment.wordDurationsMs // Durations in ms
};

head.speakAudio(audioObj);
```

Note: ElevenLabs alignment data uses character-level timing. You may need to aggregate characters into words for TalkingHead's `speakAudio` method. Refer to the TalkingHead README Appendix G for the exact `speakAudio` input format and how to handle streaming audio.

Alternatively, you can use TalkingHead's built-in ElevenLabs integration if it fits — the repo's `index.html` test app already has this wired up. Study how it connects to ElevenLabs via WebSocket in the source code and replicate that pattern. This may be the fastest path for the POC.

#### 4E: Conversation State

Maintain a simple in-memory conversation history:
```javascript
const conversationHistory = [];

function addUserMessage(text) {
  conversationHistory.push({ role: 'user', content: text });
  // Keep last 20 messages to limit context size and cost
  if (conversationHistory.length > 20) conversationHistory.splice(0, 2);
}

function addAssistantMessage(text) {
  conversationHistory.push({ role: 'assistant', content: text });
}
```

### Step 5: UI Layout (public/index.html)

Keep it minimal:
- Full-screen canvas for the TalkingHead 3D avatar (takes up ~80% of the viewport)
- A small transcript panel at the bottom showing recent messages (user in gray, assistant in blue)
- A microphone button or indicator showing recording state
- A status indicator: "Listening...", "Thinking...", "Speaking..."

Use a dark background to make the 3D avatar pop. No complex CSS frameworks needed — basic flexbox layout is fine.

### Step 6: Latency Optimization Checklist

These are critical to hitting the ~3 second target:

1. **Deepgram `endpointing: 300`** — Detects end-of-speech in 300ms (default is 800ms). Saves ~500ms.
2. **Stream Claude response** — Don't wait for full response. Begin TTS on first sentence. Saves 1-2 seconds.
3. **ElevenLabs `eleven_turbo_v2_5`** — Lowest latency model. Use `chunk_length_schedule: [120, 160, 250, 290]` for fast first-chunk delivery.
4. **Claude `max_tokens: 300`** — Short responses = faster generation. The system prompt enforces 2-3 sentences.
5. **Sentence-level pipelining** — Send each sentence to ElevenLabs as it completes from Claude, not after the full response.
6. **WebSocket keep-alive** — Maintain persistent WebSocket connections to Deepgram and ElevenLabs. Don't reconnect per utterance.
7. **Disable extended thinking** — Do NOT enable Claude's extended thinking / adaptive thinking for this use case. We want fast token generation, not deep reasoning. Use a standard `messages.create()` call with streaming.

### Step 7: Running the POC

```bash
cd mayamind-poc/server
node server.js
# Open http://localhost:3000 in Chrome
```

## Mood-Aware Responses

The avatar automatically detects the user's emotion from their transcribed text and responds with an appropriate mood — affecting facial expression, voice tone, and word choice — with zero additional cost or latency.

### How It Works

1. **Claude detects emotion** — The system prompt instructs Claude to output a `[MOOD:xxx]` tag at the start of each response
2. **Frontend parses and strips the tag** — before sending text to TTS
3. **Three systems adapt simultaneously**:
   - `head.setMood(mood)` — TalkingHead facial expression
   - ElevenLabs `voice_settings` — mood-specific `stability` / `similarity_boost`
   - Claude's word choice — system prompt instructs appropriate tone per mood

### Valid Moods (TalkingHead's exact 8)

`neutral`, `happy`, `angry`, `sad`, `fear`, `disgust`, `love`, `sleep`

**Note**: "surprised" is NOT a valid TalkingHead mood and will crash with "Unknown mood." error.

### Voice Settings per Mood

| Mood | Stability | Similarity | Effect |
|------|-----------|------------|--------|
| neutral | 0.55 | 0.75 | Balanced, conversational |
| happy | 0.45 | 0.75 | More expressive |
| angry | 0.70 | 0.75 | Calm, steady |
| sad | 0.50 | 0.80 | Soft, warm |
| fear | 0.65 | 0.75 | Steady, reassuring |
| disgust | 0.65 | 0.75 | Even, non-judgmental |
| love | 0.50 | 0.80 | Warm, gentle |
| sleep | 0.80 | 0.70 | Very steady, quiet |

### Barge-In Support

The user can interrupt the avatar at any time by speaking. Deepgram detects speech during the avatar's response, aborts in-flight Claude and TTS requests, stops the avatar speaking, and immediately begins processing the new user utterance. The mic stays open at all times (WebRTC echo cancellation prevents false triggers from the avatar's own audio).

## Success Criteria

The POC is successful if:
1. ✅ User speaks into the microphone and their speech appears as transcribed text
2. ✅ Claude generates a conversational response
3. ✅ The 3D avatar speaks the response with visible, synced lip movements
4. ✅ The avatar's voice sounds natural (ElevenLabs quality, not robotic)
5. ✅ End-to-end latency from user stopping to avatar starting to speak is ≤5 seconds (target 3s)
6. ✅ Multiple back-and-forth exchanges work (conversation context is maintained)
7. ✅ Avatar adapts facial expression and voice tone based on user's emotional state
8. ✅ User can interrupt the avatar mid-response (barge-in)

## API Reference Quick Links

- **TalkingHead**: https://github.com/met4citizen/TalkingHead — Pay close attention to README Appendix G (streaming audio with lip-sync) and the ElevenLabs integration in `index.html`
- **Deepgram Streaming STT**: https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
- **ElevenLabs WebSocket Streaming**: https://elevenlabs.io/docs/api-reference/text-to-speech/stream-with-websockets
- **Anthropic Messages API (streaming)**: https://docs.anthropic.com/en/api/messages-streaming — Use model `claude-sonnet-4-6-20260217`, set `stream: true`

## Important Notes

- This is a browser-based app. The 3D avatar renders locally using WebGL — no cloud GPU needed for the avatar.
- All API keys must stay server-side. The browser connects to local WebSocket proxies on the Express server, which forward to the actual APIs.
- Test in Chrome on desktop first (best WebGL/WebGPU support). Safari and mobile can be tested later.
- If you can't find a suitable GLB avatar from the TalkingHead repo, use any Mixamo-rigged GLB with ARKit blend shapes. The TalkingHead repo's `/blender` directory has resources for creating compatible avatars.
- For the ElevenLabs integration, strongly consider studying TalkingHead's existing ElevenLabs WebSocket code in its `index.html` and `modules/talkinghead.mjs` — it already handles the audio chunk → lip-sync pipeline. Reusing that code path is the fastest route.
