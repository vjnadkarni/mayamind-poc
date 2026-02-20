
# MayaMind — CLAUDE.md

## Project Overview

MayaMind is an AI-powered companion and wellness platform for seniors, delivered through a single iPad. It combines a lifelike 3D avatar with camera-based exercise coaching — two capabilities no competitor offers together.

The **proof-of-concept** (tagged `v0.1.0`) validated the core conversation loop: User speaks → speech recognized → Claude generates response → ElevenLabs synthesizes speech → TalkingHead 3D avatar lip-syncs the audio. End-to-end latency: sub-3 seconds. Supports barge-in and mood-aware responses.

The project is now moving to **production implementation**, starting with a web-based MediaPipe exercise detection prototype.

## Product Documents

All product documents live in `docs/` as Markdown:

- `docs/MayaMind_Executive_Summary.md` — v1.01, high-level overview
- `docs/MayaMind_MRD_v1.02.md` — Market Requirements Document
- `docs/MayaMind_PRD_v1.04.md` — Product Requirements Document (authoritative spec)

Original `.docx` versions are also in `docs/` for reference but are no longer maintained.

## Production Technology Stack (from PRD v1.04)

| Component | Technology | Where It Runs | Cost |
|-----------|-----------|---------------|------|
| AI Avatar | TalkingHead (ThreeJS/WebGL) | On-device | Free (open-source) |
| Speech Recognition | Apple Speech framework | On-device | Free (bundled with iPadOS) |
| Pose Estimation | MediaPipe | On-device (Neural Engine) | Free |
| LLM | Claude API (Anthropic) | Cloud | Per-token |
| Text-to-Speech | ElevenLabs | Cloud | Per-character |
| Emotion Detection | Text-based via Claude `[MOOD:xxx]` tags | Cloud (piggybacked on LLM) | Free (included in LLM call) |
| Local Database | SQLite | On-device | Free |
| Cloud Database | Supabase (opt-in) | Cloud | Free tier / $25/mo Pro |
| Web Portals | React + REST API | Cloud | — |
| Device Management | Apple Business Manager + MDM | Cloud | — |

Key principle: **Only two cloud APIs incur per-use charges** (Claude and ElevenLabs). Everything else is on-device or free.

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
│   ├── MayaMind_Executive_Summary.md    # v1.01
│   ├── MayaMind_MRD_v1.02.md
│   ├── MayaMind_PRD_v1.04.md
│   ├── MayaMind_Executive_Summary.docx  # Original (not maintained)
│   ├── MayaMind_MRD_v1.01.docx         # Original (not maintained)
│   └── MayaMind_PRD_v1.03.docx         # Original (not maintained)
├── server/
│   ├── server.js           # Express server: static files + API proxies
│   └── package.json
└── public/
    ├── index.html          # Single page UI
    ├── app.js              # Conversation pipeline orchestration
    ├── modules/            # TalkingHead JS modules (from GitHub release)
    ├── avatars/            # GLB avatar file(s)
    ├── backgrounds/        # JPG background images for settings panel
    └── animations/         # FBX Mixamo animations
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

### Running the POC

```bash
chmod +x setup.sh && ./setup.sh   # First time only
node server/server.js
# Open http://localhost:3000 in Chrome or Safari
```

### Key POC Implementation Details

**Claude API:**
- Model: `claude-sonnet-4-6` (no date suffix)
- `max_tokens: 300`, `stream: true` — SSE streaming
- Do NOT enable extended thinking
- System prompt: Maya is a warm wellness companion; short sentences; no markdown; `[MOOD:xxx]` tag at start of each response

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
- Frontend parses tag, calls `head.setMood()`, adjusts ElevenLabs voice settings per mood

**Barge-In:**
- Mic stays open during avatar speech; Deepgram transcript triggers `bargeIn()`
- Aborts in-flight Claude stream + TTS fetches, calls `head.stopSpeaking()`
- WebRTC `echoCancellation: true` prevents false triggers

## Next Phase: MediaPipe Exercise Detection Prototype

Web-based prototype using Safari (to use Apple's speech engine via Web Speech API, matching production iPad's Apple Speech framework).

Target exercises for pilot:
1. Chair squats (sit-to-stand)
2. Inclined push-ups (wall push-ups)
3. Single-leg stand
4. Brisk walking (on treadmill)

Prototype goals: Exercise auto-detection, rep counting, form assessment with quality scoring. Computational load must be low-to-medium for eventual iPad portability.

Development machine: MacBook M3 Pro with built-in webcam (narrower FOV than iPad's 122° ultra-wide — user stands further back for full-body visibility).

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
