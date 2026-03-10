
# MayaMind — CLAUDE.md

## Project Overview

MayaMind is an AI-powered companion and wellness platform for seniors, delivered through a single iPad. It combines a lifelike 3D avatar with camera-based exercise coaching — two capabilities no competitor offers together.

The **proof-of-concept** (tagged `v0.1.0`) validated the core conversation loop: User speaks → speech recognized → Claude generates response → ElevenLabs synthesizes speech → TalkingHead 3D avatar lip-syncs the audio. End-to-end latency: sub-3 seconds. Supports barge-in and mood-aware responses.

The project is now building a **unified dashboard** that combines the avatar conversation with exercise coaching, personalization, health monitoring, and Connect (WhatsApp messaging) into a single iPad-optimized interface. The conversation pipeline includes Claude's native web search tool for real-time information (weather, news, sports scores).

A **native iOS app** (SwiftUI) is in development to replace the web-based dashboard. iPhone is the primary device (always with the senior); iPad serves as the exercise companion with camera-based coaching.

**Production deployment:** https://companion.mayamind.ai/dashboard/

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
| Health Monitoring | Apple HealthKit (direct + iCloud sync) | On-device | Free |
| Body Composition | HealthKit (any connected scale) | On-device | Free |

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
├── deploy/                 # Production deployment configs
│   ├── DEPLOYMENT.md       # Step-by-step VPS deployment guide
│   ├── nginx-companion.conf # Nginx reverse proxy config
│   ├── mayamind.service    # Systemd service file
│   └── env.production.template # .env template for production
├── images/                 # Landing page slideshow images
│   └── *.jpg               # Senior activity photos (Unsplash/Pexels)
├── docs/
│   ├── MayaMind_Executive_Summary.md    # v1.03
│   ├── MayaMind_MRD_v1.04.md
│   ├── MayaMind_PRD_v1.06.md
│   ├── Personalization_Architecture_v1.0.md   # Personalization system design
│   ├── CONFIGURE_TWILIO_WHATSAPP_NUMBER.md   # WhatsApp Business setup guide
│   └── *.docx                           # Original versions (not maintained)
├── server/
│   ├── server.js           # Express server: static files + API proxies
│   └── package.json
├── dashboard/              # Unified dashboard app (current development)
│   ├── index.html          # Dashboard shell with 4-block grid
│   ├── avatar-ios.html     # TalkingHead avatar for iOS WKWebView
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
│   │   ├── preferences-sync.js       # Supabase cloud sync for user preferences
│   │   ├── consent-manager.js       # Three-tier consent model
│   │   ├── extraction-pipeline.js   # Claude-based personality extraction
│   │   ├── content-safety.js        # Content safety filtering
│   │   └── voice-commands.js        # Voice command detection
│   ├── components/         # Shared UI components
│   │   └── consent-modal.js         # "What Maya Knows" transparency modal
│   └── sections/           # Feature sections
│       ├── maya/            # TalkingHead conversation
│       │   └── maya-section.js      # Full conversation pipeline + personalization
│       ├── exercise/        # Exercise coaching (native camera + MediaPipe + avatar)
│       │   └── exercise-section.js
│       ├── health/          # Health monitoring (Apple Watch + Withings)
│       │   └── health-section.js
│       └── connect/         # WhatsApp messaging via Twilio
│           └── connect-section.js
├── MayaMind/                # Native iOS app (iPhone + iPad Universal)
│   └── MayaMind/
│       ├── App/             # SwiftUI app entry point
│       │   └── MayaMindApp.swift      # App + AppState + AppSection enum
│       ├── Core/            # Shared services
│       │   ├── Services/
│       │   │   ├── ClaudeAPIService.swift    # Claude API with SSE streaming
│       │   │   ├── SpeechRecognitionService.swift  # Apple Speech framework
│       │   │   ├── CameraService.swift       # AVCaptureSession management
│       │   │   └── TTSService.swift          # ElevenLabs TTS via server
│       │   ├── PoseEstimation/               # MediaPipe integration
│       │   │   └── PoseEstimationService.swift
│       │   └── ExerciseDetection/            # Exercise detectors
│       │       └── ExerciseDetectors.swift   # Squat, Lunge, BicepsCurl, Pushup
│       ├── Features/        # Feature modules
│       │   ├── Maya/        # Maya conversation
│       │   │   └── MayaView.swift
│       │   ├── Exercise/    # Exercise coaching
│       │   │   ├── ExerciseView.swift        # Camera + pose detection + voice
│       │   │   └── CameraPreviewView.swift   # AVCaptureVideoPreviewLayer wrapper
│       │   ├── Health/      # Health monitoring (placeholder)
│       │   │   └── HealthView.swift
│       │   ├── Connect/     # WhatsApp messaging (placeholder)
│       │   │   └── ConnectView.swift
│       │   ├── Settings/    # App settings
│       │   │   └── SettingsView.swift
│       │   └── ToDos/       # To Dos (placeholder)
│       │       └── ToDosView.swift
│       ├── iPhone/          # iPhone-specific views
│       │   └── iPhoneTabView.swift
│       ├── iPad/            # iPad-specific views
│       │   └── iPadSplitView.swift
│       ├── WebView/         # WKWebView wrapper for TalkingHead
│       │   └── AvatarWebView.swift    # WKWebView + JS bridge for lip-sync
│       └── Resources/
│           ├── Info.plist
│           └── pose_landmarker_heavy.task   # MediaPipe model
├── companion-ios/           # iPhone companion app (HealthKit → server)
│   ├── README.md            # Xcode project setup instructions
│   └── MayaMindCompanion/
│       ├── MayaMindCompanionApp.swift
│       ├── ContentView.swift
│       ├── HealthKitManager.swift
│       ├── ServerConnection.swift
│       └── MayaMindCompanion.entitlements
├── public/                 # TalkingHead conversation POC (v0.1.0)
│   ├── index.html          # Single page UI
│   ├── app.js              # Conversation pipeline orchestration
│   ├── modules/            # TalkingHead JS modules (from GitHub release)
│   ├── avatars/            # GLB avatar file(s)
│   ├── backgrounds/        # JPG background images for settings panel
│   └── animations/         # FBX Mixamo animations
└── exercise-poc/           # Exercise detection prototype (standalone + reused by dashboard)
    ├── index.html          # Standalone UI with video feed, voice panel
    ├── pose.js             # Pose estimation + detector integration
    ├── voice.js            # Voice workflow state machine
    ├── llm.js              # LLM service (Claude API for exercise coaching)
    ├── joints.js           # Skeleton connections, angle calculation, smoothing
    ├── exercises/          # Per-exercise detectors (imported by dashboard too)
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
- `WITHINGS_CLIENT_ID` — Withings developer app client ID (optional)
- `WITHINGS_CLIENT_SECRET` — Withings developer app client secret (optional)

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

## Landing Page

The dashboard opens with a full-screen landing page featuring:

- **Image slideshow:** 10 senior activity photos with Ken Burns zoom/pan animations
- **8-second transitions:** Crossfade between images with random animation selection
- **Branding:** "MayaMind" title (orange) and tagline positioned at 2/3 down, 2/3 right
- **Tap to enter:** Tap anywhere to dismiss and enter the dashboard
- **Settings access:** Gear icon in top-right corner

### Key Files

| File | Purpose |
|------|---------|
| `dashboard/landing.js` | Slideshow logic, Ken Burns animations, image preloading |
| `dashboard/styles.css` | Ken Burns keyframe animations, landing page layout |
| `images/*.jpg` | Senior activity photos (Unsplash/Pexels) |

### Ken Burns Animations

Four animation types cycle randomly:
- `ken-burns-zoom-in` — Scale 1.0 → 1.15
- `ken-burns-zoom-out` — Scale 1.15 → 1.0
- `ken-burns-pan-left` — Translate 5% → -5%
- `ken-burns-pan-right` — Translate -5% → 5%

Respects `prefers-reduced-motion` for accessibility.

## Unified Dashboard (dashboard/)

The dashboard combines all features into a single iPad-optimized interface. Accessible at `http://localhost:3000/dashboard/` (local) or `https://companion.mayamind.ai/dashboard/` (production).

### Navigation

- 2x2 grid: Maya Conversation (active), Exercise Guidance (active), Health Monitoring (active), Connect with Loved Ones (active)
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
| `dashboard/landing.js` | Landing page slideshow with Ken Burns animations |
| `dashboard/sections/maya/maya-section.js` | Full Maya conversation pipeline with personalization |
| `dashboard/sections/connect/connect-section.js` | WhatsApp messaging: TalkingHead avatar, voice, Claude conversation, ACTION tags |
| `dashboard/sections/exercise/exercise-section.js` | Native exercise coaching: camera, MediaPipe, TalkingHead avatar, voice workflow |
| `dashboard/sections/health/health-section.js` | Health monitoring dashboard: real-time vitals, moving averages, SSE client |
| `dashboard/core/personalization-store.js` | SQLite database via sql.js with localStorage persistence |
| `dashboard/core/preferences-sync.js` | Supabase cloud sync for user preferences (opt-in) |
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

## Exercise Guidance Section (Dashboard)

The Exercise Guidance section is a **native implementation** (not an iframe) that combines camera-based pose detection with a TalkingHead avatar coach. It imports exercise detectors and LLM modules directly from `/exercise-poc/` via absolute URL imports.

### Layout

```
┌───────────────────────────────────────┬──────────────────┐
│                                       │  Exercise Name   │
│                                       │  REP COUNT       │ 25%
│    Camera Video Feed                  │  Quality: --     │
│    + Skeleton Overlay                 ├──────────────────┤
│    (75% width)                        │  Maya Avatar     │ 25%
│                                       │  (TalkingHead)   │
│                                       ├──────────────────┤
│                                       │  Chat Window     │ 50%
│                                       │  (transcript)    │
└───────────────────────────────────────┴──────────────────┘
```

### Cross-Path Module Imports

The dashboard imports detectors and utilities from `exercise-poc/` using absolute URLs (works because Express serves both directories):

| Module | Imports |
|--------|---------|
| `/exercise-poc/exercises/squat.js` | `SquatDetector` |
| `/exercise-poc/exercises/lunge.js` | `LungeDetector` |
| `/exercise-poc/exercises/bicepsCurl.js` | `BicepsCurlDetector` |
| `/exercise-poc/exercises/pushup.js` | `PushupDetector` |
| `/exercise-poc/joints.js` | `SKELETON_CONNECTIONS`, `calculateJointAngles`, `AngleSmoother` |
| `/exercise-poc/llm.js` | `generateResponse`, `parseResponse`, `EXERCISE_DISPLAY_NAMES` |

### Workflow State Machine

11-state voice-driven workflow using `generateResponse()` from `llm.js`:

```
IDLE → GREETING → WAITING_START → MENU → WAITING_SELECTION → EXERCISE_ACTIVE
                                                                    │
                                                              (idle timeout)
                                                                    ↓
                                                            COMPLETION_CHECK → WAITING_DONE
                                                                              │       │
                                                                        (yes)↓   (no)→ back
                                                                            REPORT → WAITING_MORE
                                                                                      │       │
                                                                                (yes)↓   (no)→ ENDED
                                                                                    MENU
```

### Dual TTS System

- **TalkingHead + ElevenLabs:** For conversational speech (greetings, instructions, reports) — lip-synced avatar
- **Web Speech API (`speechSynthesis`):** For rep count announcements — low-latency, no network round-trip

### Key Implementation Details

- **MediaPipe Pose Landmarker:** GPU delegate, heavy model, 0.5 confidence threshold
- **Skeleton overlay:** Canvas with `object-fit: contain` matching video, `scaleX(-1)` for mirror, clipped to canvas bounds
- **Avatar race condition:** `applyMood()` and `speakText()` guard with `this.avatarLoaded` flag — `showAvatar()` is async and may not complete before greeting
- **Audio fallback:** When avatar not yet loaded, TTS audio plays directly via `AudioManager.playBuffer()` instead of being silently skipped
- **Idle timer:** 15s before first rep, 10s after first rep → triggers completion check
- **Echo detection:** `isLikelyEcho()` compares speech transcript against `currentMayaSpeech` (60% word overlap threshold)
- **Chat transcript:** Color-coded messages (green for user, white for Maya), auto-scroll, 20-message limit

## Preferences Cloud Sync (Supabase)

Optional cloud sync of user preferences to Supabase. Requires Supabase project URL and anon key in Settings.

### Architecture

- `dashboard/core/preferences-sync.js` — sync engine using Supabase JS client (loaded from CDN)
- Preferences stored in `user_preferences` table with composite PK `(device_id, category)`
- Categories: `personal` (name, DOB, sex, address), `app` (theme, voice)
- Sync triggered on settings save; merge strategy: cloud wins for conflicts
- Device ID generated per browser (stored in localStorage)

### Settings Address Fields

Settings overlay includes address fields for local service recommendations:
- Street Address (full-width text input)
- City, State, Zip Code (on one row — State is a dropdown with all 50 US states + DC)

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

### WhatsApp Number Options

**Production (recommended):** Register a dedicated Twilio phone number as a WhatsApp Business sender. No opt-in required, permanent messaging.

- See `docs/CONFIGURE_TWILIO_WHATSAPP_NUMBER.md` for detailed setup instructions
- Example: `TWILIO_WHATSAPP_NUMBER=whatsapp:+13412014043`
- Webhook URL: `https://companion.mayamind.ai/api/whatsapp/webhook`

**Sandbox (development only):** For quick testing without Meta Business approval.

1. Activate sandbox: Twilio Console → Messaging → Try it out → Send a WhatsApp message
2. Each contact must opt in by sending `join <sandbox-code>` to `+14155238886`
3. Configure webhook URL in Sandbox Settings → "When a message comes in" → `https://<ngrok-url>/api/whatsapp/webhook` (POST)
4. **Limitation:** Opt-in expires every 72 hours

### Key Implementation Details

- ConnectSection follows same patterns as MayaSection: TalkingHead avatar, Web Speech API, echo detection, barge-in, TTS queue
- SSE via EventSource for real-time incoming message notifications
- Section lifecycle: mount/pause/resume/unmount with state preservation
- Twilio client is optional — server starts without it if env vars are missing

## Health Monitoring Section

Real-time health vitals from Apple Watch (via iPhone companion app) and body composition from Withings Smart Scale. Display-only monitoring — no safety alerts.

### Architecture

```
Apple Watch → iPhone (HealthKit) → Companion App → POST /api/health/vitals → Server (in-memory)
                                                                                    ↓
iPad Dashboard ← SSE /api/health/events ← Server broadcasts on each POST ──────────┘

Withings Scale → WiFi → Withings Cloud → Server OAuth2 + REST → iPad Health Section
```

**Key constraint:** Apple Watch can only pair with iPhone (not iPad). HealthKit is iPhone-only. The lightweight iPhone companion app reads HealthKit and pushes data to the MayaMind server every 60 seconds.

### Health Metrics

| Metric | Source | Display |
|--------|--------|---------|
| Heart Rate | Apple Watch | BPM + 10-min avg |
| Heart Rate Variability (HRV) | Apple Watch | ms + 10-min avg |
| Blood Oxygen (SpO2) | Apple Watch | % + 10-min avg |
| Steps | Apple Watch | Count since midnight |
| Move Minutes | Apple Watch | Min since midnight |
| Exercise Minutes | Apple Watch | Min since midnight |
| Sleep | Apple Watch | Duration + stages (deep/core/REM/awake) |
| Weight | Withings Scale | lbs/kg |
| Body Fat | Withings Scale | % |
| Muscle Mass | Withings Scale | lbs/kg |

**Note:** SpO2 may be unavailable on US Apple Watch Series 9+ (Masimo patent dispute).

### Server Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/health/events` | GET | SSE stream for real-time health updates |
| `/api/health/vitals` | POST | Receive vitals from iPhone companion |
| `/api/health/vitals/latest` | GET | iPad fetches current state + history |
| `/api/health/test` | GET | Generate mock vitals for UI testing |
| `/api/health/withings/status` | GET | Check if Withings is configured/connected |
| `/api/health/withings/auth` | GET | Start Withings OAuth2 flow |
| `/api/health/withings/callback` | GET | Handle Withings OAuth2 callback |
| `/api/health/withings/data` | GET | Fetch latest body composition from Withings |

### Server-Side Data Store

- **In-memory** ring buffer (60 entries, ~1 per minute)
- No persistent storage — vitals are transient, server restart clears data
- Withings OAuth tokens stored in memory (re-auth required after restart)

### iPad Health Section UI

- Grid layout: 3 columns of vital cards
- Row 1: Heart Rate (red), HRV (purple), SpO2 (blue) — with 10-min moving averages
- Row 2: Steps (green), Move Minutes (amber), Exercise Minutes (pink)
- Row 3: Sleep (2-col, purple) with stage breakdown, Body Composition (1-col, green)
- Connection status bar: Watch (green/amber/gray), Withings (green/gray)
- "Waiting for data" overlay when no vitals received yet
- SSE connection for real-time updates, initial fetch on mount

### iPhone Companion App

Located in `companion-ios/MayaMindCompanion/`. See `companion-ios/README.md` for Xcode project setup.

| File | Purpose |
|------|---------|
| `MayaMindCompanionApp.swift` | SwiftUI app entry point |
| `ContentView.swift` | Minimal status screen (connection state, server URL) |
| `HealthKitManager.swift` | HealthKit authorization + observer queries + data fetching |
| `ServerConnection.swift` | HTTP POST to MayaMind server |

The app uses `HKObserverQuery` for real-time HealthKit updates plus a 60-second timer fallback. Requires iPhone with paired Apple Watch (Series 9+). HealthKit does not work in the iOS Simulator.

### Withings Integration

- OAuth2 flow managed server-side (optional — server starts without Withings if env vars missing)
- User clicks "Connect Withings Scale" button in Health section → opens OAuth popup
- After authorization, server fetches weight/body composition from Withings Measure API
- Supports automatic token refresh

### Testing Without Hardware

Hit `http://localhost:3000/api/health/test` in a browser to generate mock vitals data. This pushes a randomized vitals payload via SSE to any connected Health section, allowing UI development without the iPhone companion or Apple Watch.

## Native iOS App (MayaMind/)

Native SwiftUI app for iPhone and iPad, replacing the web-based dashboard with a native experience. iPhone is the primary device (always with the user); iPad serves as the exercise companion with camera-based coaching.

### Architecture

- **Universal app:** Single codebase, device-specific UIs via `iPhoneTabView` and `iPadSplitView`
- **SwiftUI:** Declarative UI with `@StateObject`, `@Published`, `@EnvironmentObject`
- **Server dependency:** Uses same `https://companion.mayamind.ai` backend as web dashboard

### Tech Stack

| Component | Technology |
|-----------|-----------|
| UI Framework | SwiftUI |
| Speech Recognition | Apple Speech framework (`SFSpeechRecognizer`) |
| Text-to-Speech | ElevenLabs via server `/api/tts` endpoint |
| LLM | Claude API via server `/api/chat` endpoint |
| Avatar | TalkingHead via WKWebView (`/dashboard/avatar-ios.html`) |
| Audio Playback | WKWebView AudioContext (lip-synced), AVAudioPlayer (fallback) |
| Health Data | Apple HealthKit (direct device access, iCloud synced) |
| Pose Detection | MediaPipe Pose Landmarker (via CocoaPods) |

### Navigation

- **5 tabs:** Maya, Exercise, Health, Connect, To Dos
- **Settings:** Accessed via gear icon in top-right of all screens (not in tab bar)
- Settings opens as a sheet overlay

### Key Implementation Details

**Speech Recognition (`SpeechRecognitionService.swift`):**
- Uses `SFSpeechAudioBufferRecognitionRequest` for real-time streaming
- 2-second silence timer auto-finalizes transcript (no tap required)
- `lastGoodTranscript` workaround for Apple's empty final result bug
- `hasSentFinalTranscript` flag prevents duplicate callbacks (silence timeout + final result)
- `onError` callback enables auto-retry on transient "No speech detected" errors
- `skipAudioSessionConfig` parameter avoids redundant audio session setup
- `requiresOnDeviceRecognition = false` — allows server-based recognition without Siri enabled

**TTS (`TTSService.swift`):**
- Fetches audio from `/api/tts` which returns JSON `{ audio_base64: "..." }`
- Decodes base64, saves to temp `.mp3` file, plays via `AVAudioPlayer`
- `AVAudioPlayerDelegate` fires `onSpeechComplete` callback when audio finishes

**Conversation Flow (`MayaViewModel`):**
- Auto-starts listening on view appear (after authorization)
- User speaks → silence timeout → send to Claude → receive response → TTS plays → auto-restart listening
- Continuous hands-free conversation without mic button taps
- `cleanup()` deactivates audio session on view disappear (releases for Exercise camera)

**SwiftUI Threading:**
- All UI updates wrapped in `Task { @MainActor in }` for proper observation
- Callbacks from services use `DispatchQueue.main.async` or `@MainActor`

### Running the iOS App

1. Install CocoaPods dependencies:
   ```bash
   cd MayaMind && pod install
   ```
2. Open `MayaMind/MayaMind.xcworkspace` in Xcode (not `.xcodeproj`)
3. Select iPhone or iPad simulator/device
4. Build and Run (Cmd+R)
5. Tap "Get Started" → Maya auto-starts listening

**Dependencies (via CocoaPods):**
- `MediaPipeTasksVision` — pose detection for exercise coaching

### TalkingHead Avatar (WKWebView)

The 3D avatar runs in WKWebView, loading from the server at `/dashboard/avatar-ios.html`. Key implementation details:

**Audio Session Management:**
- Swift deactivates `AVAudioSession` before calling `startLipsync()` to avoid AudioContext conflicts
- WKWebView handles both audio playback and lip animation
- Speech recognition stops during TTS, restarts after `speakingEnd` event

**Manual Lip-Sync Implementation:**
- TalkingHead's internal animation queue doesn't work reliably in WKWebView
- Solution: Direct morph target manipulation via `setTimeout` scheduling
- Uses ElevenLabs word timing data (`wtimes`, `wdurations`) for precise viseme placement
- `lipsyncWordsToVisemes()` converts words to Oculus viseme set (aa, E, I, O, U, PP, FF, TH, DD, kk, CH, SS, nn, RR, sil)

**Swift-JavaScript Bridge:**
- `WKScriptMessageHandler` receives events: `ready`, `speakingStart`, `speakingEnd`, `error`
- `evaluateJavaScript()` calls `setMood()`, `startLipsync()`, `stopSpeaking()`
- Audio data passed as base64-encoded string with JSON word timing arrays

### Exercise Coaching (`ExerciseView.swift`)

Camera-based exercise coaching with MediaPipe pose detection and voice feedback:

**Layout:**
- Camera preview (48% height) with skeleton overlay
- Maya avatar thumbnail (100x100) + chat window
- Control buttons: Start/Stop + Camera switch + Mic mute
- Exercise selection: Quick selector (recent) + dropdown menu

**Features:**
- MediaPipe Pose Landmarker (heavy model, GPU delegate)
- 4 exercises: Squats, Lunges, Bicep Curls, Push-ups
- Rep counting with form feedback (milestone announcements every 5 reps)
- Voice-driven "Are you done?" prompt after 10s idle
- Recent exercises persisted in UserDefaults (max 5)
- TalkingHead avatar with lip-synced coaching

**AVAudioSession Management:**
- Deactivates before WKWebView audio playback
- Reactivates after avatar finishes speaking
- Enables seamless camera + speech recognition coexistence

### Health Monitoring (`HealthView.swift`)

Real-time health data from Apple HealthKit with 24-hour trends and tap-to-expand details:

**Data Sources:**
- Apple Watch (heart rate, HRV, SpO2, steps, exercise minutes, sleep)
- Smart Scale via HealthKit (weight, body fat %, lean body mass, BMI)
- iCloud sync enables data sharing across devices on same Apple ID

**Metrics Displayed:**
- Heart Rate: Current BPM + 24h min/max + sparkline chart
- HRV: Current ms + 24h range + sparkline
- Blood Oxygen (SpO2): Current % + 24h range + sparkline (unavailable on US Apple Watch Series 9+ due to Masimo patent)
- Steps: Today's count (live updating)
- Exercise Minutes: Today's active minutes
- Sleep: Total hours + stage breakdown (Deep/Core/REM/Awake) - requires wearing watch to bed

**Body Composition:**
- Weight, Body Fat %, Lean Body Mass, BMI
- Shows most recent HealthKit reading (may be historical)

**Tap-to-Expand Details:**
- Large 24-hour trend chart with labeled axes
- Hourly readings breakdown
- Sleep stages with percentages and duration

**Implementation:**
- `HealthKitService.swift`: Authorization, observer queries, data fetching
- Observer queries for real-time updates (heart rate, steps, HRV, SpO2, exercise, weight)
- 24-hour sample history for sparkline charts
- Connection badges show Watch/Scale data availability

**Key Files:**
| File | Purpose |
|------|---------|
| `Features/Health/HealthView.swift` | UI with cards, sparklines, detail sheets |
| `Core/Services/HealthKitService.swift` | HealthKit authorization and queries |
| `MayaMind.entitlements` | HealthKit entitlement |
| `Resources/Info.plist` | NSHealthShareUsageDescription |

### Current Status

| Feature | Status |
|---------|--------|
| Maya conversation (voice) | Working |
| Speech recognition | Working (auto-silence detection) |
| TTS (Maya speaks) | Working |
| Claude API integration | Working |
| TalkingHead avatar | Working (WKWebView + lip-sync) |
| Exercise coaching | Working (MediaPipe + voice feedback) |
| Health monitoring | Working (HealthKit + sparklines) |
| Connect (WhatsApp) | Working (voice-driven messaging) |
| To Dos | Placeholder |

### Connect Section (iOS)

Voice-driven WhatsApp messaging with TalkingHead avatar, matching the web dashboard implementation.

**Architecture:**
- `ConnectView.swift` — UI with avatar, chat transcript, contacts bar
- `ConnectViewModel` — Voice pipeline, Claude conversation, ACTION tag parsing
- `TwilioService.swift` — Send messages, SSE listener for incoming
- `ClaudeAPIService.swift` — Uses `/api/chat/connect` endpoint

**Features:**
- Voice-driven conversation: "Send a message to Carol saying hello"
- ACTION tag parsing: ADD_CONTACT, SEND_TEXT, SEND_VOICE, PLAY_MESSAGE
- SSE listener for real-time incoming message notifications
- Unread message banner with "Play" button
- Contact quick-access bar with add contact support
- TalkingHead avatar with lip-sync (same as Maya section)
- Contacts persisted to UserDefaults

**Key Implementation Details:**
- SSE implemented via URLSessionDataDelegate for streaming connection
- Contacts passed to Claude for context-aware responses
- Incoming photo messages display inline thumbnails
- Maya announces new messages when they arrive

## Production Deployment

MayaMind is deployed at **https://companion.mayamind.ai** on a Hostinger VPS running Ubuntu 24.04 LTS.

### Server Details

| Component | Value |
|-----------|-------|
| VPS | Hostinger (srv949461.hstgr.cloud) |
| IP | 31.97.42.20 |
| OS | Ubuntu 24.04 LTS |
| Web Server | Nginx (reverse proxy) |
| Process Manager | systemd |
| SSL | Let's Encrypt (auto-renewal via Certbot) |
| App Port | 3001 |

### Deployment Files

| File | Purpose |
|------|---------|
| `deploy/DEPLOYMENT.md` | Complete step-by-step deployment guide |
| `deploy/nginx-companion.conf` | Nginx reverse proxy configuration |
| `deploy/mayamind.service` | Systemd service file |
| `deploy/env.production.template` | Environment variables template |

### Useful Commands

```bash
# SSH into server
ssh root@31.97.42.20

# Service management
sudo systemctl status mayamind
sudo systemctl restart mayamind
sudo journalctl -u mayamind -f

# Deploy updates
cd ~/venv/mayamind-poc
rsync -avz --exclude 'node_modules' --exclude '.env' --exclude '.git' \
  ./ root@31.97.42.20:/var/www/mayamind/
ssh root@31.97.42.20 "sudo systemctl restart mayamind"
```

### Related Documentation

- `deploy/DEPLOYMENT.md` — Full deployment walkthrough
- `docs/CONFIGURE_TWILIO_WHATSAPP_NUMBER.md` — WhatsApp Business number setup

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
- Twilio WhatsApp API: https://www.twilio.com/docs/whatsapp
- Let's Encrypt / Certbot: https://certbot.eff.org/
