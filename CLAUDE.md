
# MayaMind — CLAUDE.md

## Project Overview

MayaMind is an AI-powered companion and wellness platform for seniors, delivered through a single iPad. It combines a lifelike 3D avatar with camera-based exercise coaching — two capabilities no competitor offers together.

The **proof-of-concept** (tagged `v0.1.0`) validated the core conversation loop: User speaks → speech recognized → Claude generates response → ElevenLabs synthesizes speech → TalkingHead 3D avatar lip-syncs the audio. End-to-end latency: sub-3 seconds. Supports barge-in and mood-aware responses.

The project is now building a **unified dashboard** that combines the avatar conversation with exercise coaching, personalization, and Connect (WhatsApp messaging) into a single iPad-optimized interface. The conversation pipeline includes Claude's native web search tool for real-time information (weather, news, sports scores).

## Product Documents

All product documents live in `docs/` as Markdown:

- `docs/MayaMind_Executive_Summary.md` — v1.03, high-level overview
- `docs/MayaMind_MRD_v1.04.md` — Market Requirements Document
- `docs/MayaMind_PRD_v1.06.md` — Product Requirements Document (authoritative spec)

Original `.docx` versions are also in `docs/` for reference but are no longer maintained.

## Production Technology Stack (from PRD v1.06)

| Component | Technology | Where It Runs | Cost |
|-----------|-----------|---------------|------|
| AI Avatar | TalkingHead (ThreeJS/WebGL) | On-device | Free (open-source) |
| Speech Recognition | Apple Speech framework | On-device | Free (bundled with iPadOS) |
| Pose Estimation | MediaPipe | On-device (Neural Engine) | Free |
| LLM | Claude API (Anthropic) | Cloud | Per-token |
| Web Search | Claude native web search (`web_search_20250305`) | Cloud (via Claude API) | $0.01/search |
| Text-to-Speech | ElevenLabs | Cloud | Per-character |
| Emotion Detection | Text-based via Claude `[MOOD:xxx]` tags | Cloud (piggybacked on LLM) | Free (included in LLM call) |
| Local Database | SQLite | On-device | Free |
| Cloud Database | Supabase (opt-in) | Cloud | Free tier / $25/mo Pro |
| Web Portals | React + REST API | Cloud | — |
| Device Management | Apple Business Manager + MDM | Cloud | — |

| WhatsApp Messaging | Twilio WhatsApp API | Cloud | Per-message |

Key principle: **Three cloud APIs incur per-use charges** (Claude/web search, ElevenLabs, and Twilio). Everything else is on-device or free.

## RBAC Roles

| Role | Interface | Access |
|------|-----------|--------|
| Senior (User) | iPad app only | Full companion, exercise, personal data |
| Administrator | Web portal only | User account management, system config; no workout data |
| Authorized Professional | Web portal only | Workout history, scores, trends; no personal details (DOB, payment) |
| Family and Friends | Web portal + notifications | Daily summaries, mood trends, engagement data |

## Data Privacy Model

- **Default:** All data stored locally on iPad only. No cloud sync.
- **Opt-in:** Senior can enable Supabase cloud storage, making structured data (workout scores, engagement metrics, mood trends) visible to authorized professionals and family/friends.
- **Never transmitted:** Exercise video, raw conversation transcripts.

## Directory Structure

```
mayamind-poc/
├── .env                    # API keys — in ROOT (not server/), gitignored
├── CLAUDE.md
├── MayaMind_TalkingHead_POC_Prompt.md   # Original POC prompt
├── setup.sh                # Downloads TalkingHead assets from GitHub
├── docs/
│   ├── MayaMind_Executive_Summary.md    # v1.03
│   ├── MayaMind_MRD_v1.04.md
│   ├── MayaMind_PRD_v1.06.md
│   ├── Personalization_Architecture_v1.0.md   # Personalization system design
│   └── *.docx                           # Original versions (not maintained)
├── server/
│   ├── server.js           # Express server: static files + API proxies
│   └── package.json
├── dashboard/              # Unified dashboard app (current development)
│   ├── index.html          # Dashboard shell with 4-block grid
│   ├── app.js              # Main orchestrator + navigation
│   ├── styles.css          # Touch-friendly iPad styles
│   ├── lib/                # Third-party libraries
│   │   ├── sql-wasm.js     # sql.js (SQLite via WebAssembly)
│   │   └── sql-wasm.wasm
│   ├── core/               # Shared infrastructure
│   │   ├── session-manager.js       # 15-min timeout, state preservation
│   │   ├── audio-manager.js         # Shared AudioContext singleton
│   │   ├── tts-service.js           # Unified ElevenLabs TTS
│   │   ├── personalization-store.js # SQLite database (sql.js + localStorage)
│   │   ├── connect-store.js         # SQLite store for contacts & messages
│   │   ├── emoji-utils.js           # Emoji-to-speech conversion & mood extraction
│   │   ├── consent-manager.js       # Three-tier consent model
│   │   ├── extraction-pipeline.js   # Claude-based personality extraction
│   │   ├── content-safety.js        # Content safety filtering
│   │   └── voice-commands.js        # Voice command detection
│   ├── components/         # Shared UI components
│   │   └── consent-modal.js         # "What Maya Knows" transparency modal
│   └── sections/           # Feature sections
│       ├── maya/            # TalkingHead conversation
│       │   └── maya-section.js      # Full conversation pipeline + personalization
│       ├── exercise/        # Exercise coaching (wraps exercise-poc)
│       │   └── exercise-section.js
│       ├── health/          # Placeholder (Apple HealthKit)
│       │   └── health-section.js
│       └── connect/         # WhatsApp messaging via Twilio
│           └── connect-section.js
├── public/                 # TalkingHead conversation POC (v0.1.0)
│   ├── index.html          # Single page UI
│   ├── app.js              # Conversation pipeline orchestration
│   ├── modules/            # TalkingHead JS modules (from GitHub release)
│   ├── avatars/            # GLB avatar file(s)
│   ├── backgrounds/        # JPG background images for settings panel
│   └── animations/         # FBX Mixamo animations
└── exercise-poc/           # Exercise detection prototype
    ├── index.html          # UI with video feed, voice panel
    ├── pose.js             # Pose estimation + detector integration
    ├── voice.js            # Voice workflow state machine
    ├── exercises/          # Per-exercise detectors
    │   ├── squat.js
    │   ├── lunge.js
    │   ├── bicepsCurl.js
    │   └── pushup.js
    └── similarity/         # DTW-based detection (deprecated)
```

## POC Details (v0.1.0)

The POC uses a slightly different stack than production (web-based, Deepgram for STT). It remains useful as a working reference for the TalkingHead + Claude + ElevenLabs conversation loop.

### POC Tech Stack

| Component | Technology |
|-----------|-----------|
| Avatar | TalkingHead 3D (ThreeJS/WebGL) |
| STT | Deepgram Nova-2, WebSocket streaming |
| LLM | Claude Sonnet 4.6 (`claude-sonnet-4-6`) via Anthropic API |
| TTS | ElevenLabs `eleven_turbo_v2_5`, HTTP per-sentence via `/api/tts` |
| Backend | Node.js + Express |
| Frontend | Vanilla HTML/JS, no framework |

### Environment Variables

`.env` lives in the **project root** (not `server/`). `server.js` loads it with `path.join(__dirname, '..', '.env')`.

Keys used by the POC:
- `ANTHROPIC_API_KEY`
- `DEEPGRAM_API_KEY`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID` (Rachel: `21m00Tcm4TlvDq8ikWAM`)
- `PORT=3000`
- `TWILIO_ACCOUNT_SID` — Twilio account SID (for Connect section)
- `TWILIO_AUTH_TOKEN` — Twilio auth token
- `TWILIO_WHATSAPP_NUMBER` — e.g., `whatsapp:+14155238886` (sandbox)
- `NGROK_URL` — e.g., `https://your-domain.ngrok-free.dev` (for Twilio media webhooks)

### Running the POC

```bash
chmod +x setup.sh && ./setup.sh   # First time only
node server/server.js
# Open http://localhost:3000 in Chrome or Safari
```

### Key POC Implementation Details

**Claude API:**
- Model: `claude-sonnet-4-6` (no date suffix)
- `max_tokens: 500`, `stream: true` — SSE streaming
- Do NOT enable extended thinking
- System prompt: Maya is a warm wellness companion; short sentences; no markdown/symbols; `[MOOD:xxx]` tag at start of each response
- System prompt is **dynamic** — `buildSystemPrompt(timezone)` injects current date/time per request
- Web search tool: `{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }` — Claude searches internally via Brave Search ($0.01/search)
- `stream.on('text', ...)` naturally skips tool_use/tool_result blocks — no client parsing changes needed for web search

**Deepgram WebSocket Proxy (`/ws/deepgram`):**
- Config: `{ model: "nova-2", language: "en", smart_format: true, interim_results: true, endpointing: 500, utterance_end_ms: 1500 }`

**TalkingHead:**
- Constructor: `ttsEndpoint: null`, `lipsyncLang: 'en'`, `lipsyncModules: ['en']`
- Default `lipsyncLang` is `'fi'` (Finnish) — always override to `'en'`
- `speakAudio()` expects `{ audio: ArrayBuffer, words: string[], wtimes: number[], wdurations: number[] }`
- `speakAudio` is synchronous — queues audio and returns immediately

**Mood-Aware Responses:**
- Valid moods (TalkingHead's exact 8): `neutral`, `happy`, `angry`, `sad`, `fear`, `disgust`, `love`, `sleep`
- "surprised" is NOT valid — throws "Unknown mood." error
- Claude detects emotion from transcript, tags response with `[MOOD:xxx]`
- Frontend parses tag at start of response, calls `head.setMood()`, adjusts ElevenLabs voice settings per mood
- **Web search multi-block fix:** Web search causes Claude to produce multiple text blocks, each potentially starting with `[MOOD:xxx]`. Client strips ALL `[MOOD:xxx]` tags globally (not just the first one) to prevent mood tags from being spoken aloud

**Barge-In:**
- Mic stays open during avatar speech; Deepgram transcript triggers `bargeIn()`
- Aborts in-flight Claude stream + TTS fetches, calls `head.stopSpeaking()`
- WebRTC `echoCancellation: true` prevents false triggers

## Exercise Detection Prototype (exercise-poc/)

Web-based prototype validating camera-based exercise coaching. Uses MediaPipe Pose Landmarker for 3D pose estimation and Web Speech API for voice interaction.

### Supported Exercises

| Exercise | Detector | Key Angles |
|----------|----------|------------|
| Chair squats | `SquatDetector` | Knee, hip |
| Reverse lunges | `LungeDetector` | Knee, hip (both legs) |
| Bicep curls | `BicepsCurlDetector` | Elbow |
| Knee push-ups | `PushupDetector` | Elbow |

### Voice-Driven Workout Flow

The prototype uses a voice-driven state machine (`VoiceWorkflow` class) for exercise selection and coaching:

```
Camera starts → "Would you like to exercise today?"
       ↓
User: "Yes" → "Great! You can do squats, lunges, bicep curls, or push-ups."
       ↓
User: "Push-ups" → "Go ahead, I'll count your push-ups."
       ↓
User performs → Detector counts reps, announces count
       ↓
5 seconds no rep → "Are you done?"
       ↓
User: "Yes" → "You completed 5 push-ups. Want another exercise?"
       ↓
User: "No" → "Great workout! See you next time."
```

This voice workflow replaces the earlier DTW-based auto-detection approach, which proved unreliable due to joint visibility issues in sagittal (side) views.

### Production Enhancement: Dual-Mode Selection

For the production iPad app, users will have two options when starting an exercise session:

1. **User Selection Mode:** User verbally chooses which exercise(s) to perform (current POC behavior)
2. **Guided Sequence Mode:** Avatar leads the user through a curated sequence of exercises, adapting based on user's fitness level and preferences

### Running the Exercise POC

```bash
node server/server.js
# Open http://localhost:3000/exercise-poc/ in Chrome or Safari
```

### Key Files

| File | Purpose |
|------|---------|
| `exercise-poc/pose.js` | Main entry point, pose estimation loop, detector integration |
| `exercise-poc/voice.js` | Voice workflow state machine (Web Speech API) |
| `exercise-poc/exercises/squat.js` | Squat detector (angle-based state machine) |
| `exercise-poc/exercises/lunge.js` | Lunge detector |
| `exercise-poc/exercises/bicepsCurl.js` | Biceps curl detector |
| `exercise-poc/exercises/pushup.js` | Push-up detector |
| `exercise-poc/index.html` | UI with video feed, voice panel, rep counters |

Development machine: MacBook M3 Pro with built-in webcam (narrower FOV than iPad's 122° ultra-wide — user stands further back for full-body visibility).

## Unified Dashboard (dashboard/)

The dashboard combines all features into a single iPad-optimized interface. Accessible at `http://localhost:3000/dashboard/`.

### Navigation

- 2x2 grid: Maya Conversation (active), Exercise Guidance (active), Health Monitoring (placeholder), Connect with Loved Ones (active)
- Tap block → full-screen section view
- Dashboard button always visible for single-tap return
- Mute button (green mic / red mic-slash) next to dashboard button for voice mute/unmute
- Session persists 15 minutes when navigating between sections

### Global Mute/Unmute

Prevents background audio (TV, family conversations) from being processed as user input.

- **Voice mute:** "Mute", "Maya mute", "Be quiet", "Stop listening", "Go to sleep"
- **Voice unmute:** "Unmute", "Maya unmute", "Wake up", "I'm back", "Start listening", or just "Maya"
- **Button:** Tap the mic button (top-right, next to Dashboard) to toggle
- When muted, speech recognition stays active but discards all input except unmute commands
- Maya confirms: "I'll be quiet..." on mute, "I'm back!" on unmute (voice only, not button)
- Mute state is global — persists across section navigation, resets on page reload
- Anchored regex patterns (`^mute$`) prevent false triggers from sentences containing "mute"

### Running the Dashboard

```bash
node server/server.js
# Open http://localhost:3000/dashboard/ in Chrome or Safari
```

### Key Files

| File | Purpose |
|------|---------|
| `dashboard/app.js` | Navigation controller, section lifecycle, WhatsApp notification badges, global mute state |
| `dashboard/sections/maya/maya-section.js` | Full Maya conversation pipeline with personalization |
| `dashboard/sections/connect/connect-section.js` | WhatsApp messaging: TalkingHead avatar, voice, Claude conversation, ACTION tags |
| `dashboard/core/personalization-store.js` | SQLite database via sql.js with localStorage persistence |
| `dashboard/core/connect-store.js` | SQLite store for contacts and message history |
| `dashboard/core/emoji-utils.js` | Emoji-to-speech conversion and mood extraction for voice interface |
| `dashboard/core/voice-commands.js` | Voice command detection incl. mute/unmute |
| `dashboard/core/consent-manager.js` | Three-tier consent flow management |
| `dashboard/core/extraction-pipeline.js` | Claude-based personality signal extraction |
| `dashboard/components/consent-modal.js` | "What Maya Knows" transparency modal |

## Personalization System

### Three-Tier Consent Model

| Tier | Name | Data Stored | Trigger |
|------|------|-------------|---------|
| Tier 1 | Session Only | Nothing persisted | Default |
| Tier 2 | Preferences | Name, preferences, topics/interests | User consents after ~2 exchanges |
| Tier 3 | Full Personality | + Communication style, emotional patterns, session summaries | After 3+ days on Tier 2 |

### How Consent Works

- Consent question is **woven into Maya's natural conversation** via Claude prompt injection (not a separate prompt)
- Triggered after exchange 2 if Tier 2 not yet enabled
- User's affirmative/negative response processed by `ConsentManager`
- If user barges in during consent question, consent is cancelled and retried later
- 60-second cooldown between consent prompts (cleared on barge-in cancellation)

### Data Storage

- **sql.js** (SQLite compiled to WebAssembly) runs entirely in-browser
- Database serialized to **localStorage** for persistence across sessions
- Tables: `preferences`, `personality_profiles`, `topics`, `session_summaries`, `consent_settings`
- No server-side storage — all personalization data stays on-device

### Extraction Pipeline

Two extraction modes:

1. **Inline extraction** (real-time): Regex-based, detects name, family members, exercise time during conversation
2. **Session extraction** (Claude API): Full transcript analysis via `/api/extract-personality` endpoint
   - Triggered when user asks "What do you know about me?"
   - Uses Claude Sonnet with the 6+1 category framework (Identity, Communication, Health, Relationships, Routine, Emotional + Topics)
   - Server endpoint: `POST /api/extract-personality` (`max_tokens: 2000`)
   - Claude may wrap JSON in markdown code fences — both server and client strip these before parsing

### Voice Commands

| Command | Trigger Phrases | Action |
|---------|----------------|--------|
| `LIST_PREFERENCES` | "What do you know about me?", "What do you remember?" | Run extraction → show transparency modal |
| `FORGET_ALL` | "Forget everything about me" | Reset to Tier 1, clear all data |
| `STOP_LEARNING` | "Stop learning about me" | Disable Tier 3 |

### Key Implementation Details

**Echo Detection:**
- Speech recognition stays active during Maya's TTS (required for barge-in)
- `isLikelyEcho()` compares heard transcript against `currentMayaSpeech` using word overlap
- Threshold: 60%+ word overlap → classified as echo, discarded

**Barge-In:**
- Detection uses `head.isSpeaking` (actual avatar state) not `this.state` (avoids race condition)
- `bargeIn()` stops audio, aborts TTS requests, processes user's speech immediately
- Cancels pending consent flows on barge-in

**Input Serialization:**
- `processInput()` wrapper prevents overlapping `handleUserInput` calls
- Uses `processingInput` flag and `pendingInput` queue

## Web Search Integration

Maya can answer questions about current events, weather, news, sports scores, and other real-time information using Claude's native web search tool.

### How It Works

- Server-side connector — Anthropic executes searches internally via Brave Search
- No additional API keys required — billed at $0.01/search through existing Claude API key
- Tool config: `{ type: 'web_search_20250305', name: 'web_search', max_uses: 2 }` — limits to 2 searches per turn
- `stream.on('text', ...)` handler naturally skips `server_tool_use` and `web_search_tool_result` content blocks — no client-side parsing changes needed
- System prompt instructs Claude to present search results naturally — no URLs, no "I searched the web" phrasing

### Timezone Awareness

- System prompt is generated dynamically via `buildSystemPrompt(timezone)` on each request
- Client sends `Intl.DateTimeFormat().resolvedOptions().timeZone` with every `/api/chat` request
- Server formats current date/time in the user's timezone and injects into the system prompt
- Enables correct responses for "today", "tomorrow", "this week", etc.

### TTS Text Sanitization

- `sanitizeForTTS()` function in `server/server.js` runs on all text before sending to ElevenLabs
- Converts symbols to spoken words: `°F` → "degrees Fahrenheit", `"` → "inches", `%` → "percent", `mph` → "miles per hour", etc.
- Strips any leaked `[MOOD:xxx]` tags as a safety net
- Strips all emoji Unicode ranges (emoticons, pictographs, symbols, dingbats, etc.) to prevent garbled TTS output
- System prompt additionally instructs Claude to avoid symbols and spell them out

## Connect Section (WhatsApp Messaging via Twilio)

The Connect section enables seniors to send and receive WhatsApp messages to close family/friends through Maya's conversational voice interface. All interactions are voice-driven — no typing required.

### Architecture

```
Senior speaks → Web Speech API → Claude (messaging system prompt)
  → Claude identifies intent + returns [ACTION:xxx] tags
  → Client parses actions, executes (save contact, send WhatsApp, start recording)
  → Maya avatar confirms via TTS + lip-sync

Contact sends WhatsApp → Twilio webhook → POST /api/whatsapp/webhook
  → Server downloads media (with Twilio auth), saves locally
  → Server pushes to SSE clients
  → Maya announces "You have a message from Carol"
  → Senior says "Yes" → Maya reads text aloud / plays voice clip
```

### Server Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat/connect` | POST | Claude streaming with Connect-specific system prompt |
| `/api/whatsapp/send` | POST | Send text or voice WhatsApp message via Twilio |
| `/api/whatsapp/webhook` | POST | Receive incoming WhatsApp messages from Twilio |
| `/api/whatsapp/events` | GET | SSE stream for real-time incoming message notifications |
| `/api/whatsapp/media/:filename` | GET | Serve uploaded/downloaded media files (audio, images) |

### ACTION Tags

Claude uses ACTION tags (alongside MOOD tags) to trigger client-side operations:

```
[ACTION:ADD_CONTACT name="Carol" phone="+14085551234"]
[ACTION:SEND_TEXT to="Carol" message="Hi Carol, thinking of you!"]
[ACTION:SEND_VOICE to="Carol"]
[ACTION:PLAY_MESSAGE]
[ACTION:CANCEL]
```

### Voice Messages

- **Sending:** Browser records via MediaRecorder (WebM/Opus) → server converts to MP3 via ffmpeg → Twilio sends with `mediaUrl`
- **Receiving:** Twilio webhook includes `MediaUrl0` (requires auth) → server downloads with Basic Auth, saves locally → client plays via AudioContext
- ffmpeg required on the host machine (`brew install ffmpeg`)

### Photo Messages (Incoming)

- **Receiving:** Twilio webhook delivers image media (jpeg, png, gif, webp) → server downloads with auth, saves locally → SSE notifies client
- **Display:** Inline image thumbnail in chat bubble with optional caption text below
- **Voice announcement:** Maya says "Carol sent a photo" (with caption if present) during `playUnreadMessages()`
- **Sending photos:** Deferred to native iPad app — requires PHPhotoLibrary API (not available in web browsers)

### Dashboard Notification Badges

- Global SSE listener in `app.js` runs on all pages (not just Connect section)
- When a WhatsApp message arrives while user is NOT in Connect, a pink pulsing "N new" badge appears on the Connect dashboard tile
- Messages received while on dashboard are saved to ConnectStore via `saveIncomingMessage()` so they're available when Connect opens
- Badge clears automatically when user navigates into the Connect section
- Badge priority: Pink notification > Amber "Paused" > Green "Active"
- Uses `EventSource` on `/api/whatsapp/events` — same SSE endpoint as ConnectSection
- ConnectStore is initialized at dashboard startup (not just when Connect section mounts)

### Emoji Support

- **Receiving:** `emoji-utils.js` converts emojis to natural spoken phrases (e.g., ❤️ → "with love") and sets avatar mood
- **Sending:** Claude system prompt converts verbal descriptions ("with a heart") to actual emojis in SEND_TEXT messages
- **Catch-all:** `sanitizeForTTS()` strips any remaining emoji Unicode ranges before ElevenLabs

### ConnectStore (SQLite)

Follows the same sql.js + localStorage pattern as `personalization-store.js`. Storage key: `'mayamind_connect_db'`.

**Tables:**
- `contacts` — id, name, phone (unique), created_at
- `messages` — id, contact_id, direction (sent/received), type (text/voice/image), body, media_url, timestamp, read

### Twilio Sandbox Setup

1. Activate sandbox: Twilio Console → Messaging → Try it out → Send a WhatsApp message
2. Each contact must opt in by sending `join <sandbox-code>` to `+14155238886`
3. Configure webhook URL in Sandbox Settings → "When a message comes in" → `https://<ngrok-url>/api/whatsapp/webhook` (POST)
4. Use a static ngrok domain (`ngrok http 3000 --url=your-domain.ngrok-free.dev`) to avoid URL changes between sessions

### Key Implementation Details

- ConnectSection follows same patterns as MayaSection: TalkingHead avatar, Web Speech API, echo detection, barge-in, TTS queue
- SSE via EventSource for real-time incoming message notifications
- Section lifecycle: mount/pause/resume/unmount with state preservation
- Twilio client is optional — server starts without it if env vars are missing

## GitHub

- Account: https://github.com/vjnadkarni
- Remote repo: `git@github.com:vjnadkarni/mayamind-poc.git`
- **Always use SSH** (`git@github.com:...`) — HTTPS and username/password are disabled

## Reference Links

- TalkingHead: https://github.com/met4citizen/TalkingHead
- MediaPipe Pose: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
- Deepgram streaming: https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio
- ElevenLabs TTS: https://elevenlabs.io/docs/api-reference/text-to-speech
- Anthropic streaming: https://docs.anthropic.com/en/api/messages-streaming
- Supabase: https://supabase.com/docs
