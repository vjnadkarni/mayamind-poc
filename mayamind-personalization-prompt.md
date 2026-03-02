# MayaMind Personalization System — Claude Code Implementation Prompt

## Context

You are extending an existing iPad-based MayaMind application that already has a working TalkingHead avatar interface with conversational AI (Claude Sonnet 4.6), Deepgram STT, ElevenLabs TTS, MediaPipe pose estimation, and Hume emotion detection. The app is built for senior wellness — Maya is an AI companion that provides conversational engagement and exercise coaching.

We are now implementing a **personalization system** that allows Maya to learn and remember each senior's personality, preferences, and interaction patterns over time. This is privacy-critical functionality targeting a vulnerable population.

---

## Architecture Overview

The personalization system uses a **hybrid storage architecture**:

### Local Storage (on iPad — personal/private data)
- **SQLite-vec** — Local vector database storing all personal data:
  - Personality profile vectors and interaction style models
  - Explicit preference facts (e.g., "prefers morning exercise", "has knee pain in left knee")
  - Session summaries and conversational continuity data
  - Consent settings and tier selections
- **NSUbiquitousKeyValueStore** — Lightweight iCloud key-value backup (1MB max, 1024 keys max) for Tier 2 preference facts only. Acts as a safety net if the local SQLite-vec database is lost without a full iCloud backup. This syncs automatically via iCloud with no user configuration required.

### Cloud Storage (system-wide, non-personal data)
- **Pinecone** (or equivalent cloud vector DB) — for system-wide proprietary data:
  - Exercise program templates and content library
  - Maya's base prompts and system configuration
  - Anonymized, aggregated usage analytics (session duration, feature usage — no personal content)
  - Application updates and model configurations

**Critical principle:** Cloud services never see or store personal data. They provide content, configuration, and LLM processing. All personalization storage and retrieval happens locally on the iPad.

---

## Tiered Consent Model

Implement three tiers of personalization, each independently controllable by the user:

### Tier 1 — Session-Only Memory (Default, no opt-in required)
- Maya remembers context within a single conversation session
- Nothing is persisted after the session ends
- This is the baseline experience for all new users

### Tier 2 — Preference Memory (Requires explicit opt-in)
- Maya remembers **explicit, user-declared facts** — not inferred information
- Examples: preferred name, exercise schedule preference, physical limitations, communication preferences
- User can review stored preferences anytime via voice: "Maya, what do you remember about me?"
- User can delete any preference via voice: "Maya, forget that" or "Maya, forget everything about me"
- Stored in both SQLite-vec (primary) and NSUbiquitousKeyValueStore (backup)
- Opt-in is obtained through a clear, plain-language explanation voiced by Maya during onboarding

### Tier 3 — Personality Modeling (Requires explicit, informed opt-in)
- Full RAG-powered personalization where Maya builds understanding of:
  - Communication style and pace preferences
  - Emotional tone patterns and humor receptivity
  - Topics that engage the user
  - Exercise preferences and capabilities observed over time
- Uses a **summarization-and-forget** pipeline (described below)
- Requires explicit informed consent with plain-language explanation
- Stored only in SQLite-vec locally
- Opt-in confirmed by the senior, with optional validation by a designated trusted person

**Each tier is independently revocable. Stepping down a tier triggers immediate deletion of higher-tier data.**

---

## SQLite-vec Database Schema

Design and implement the local SQLite-vec database with the following data model:

### Tables

```
preference_facts
- id: TEXT PRIMARY KEY (UUID)
- key: TEXT (e.g., "preferred_name", "exercise_time", "physical_limitation")
- value: TEXT
- source: TEXT ("user_declared" or "maya_confirmed")
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
- consent_tier: INTEGER (2)

personality_profiles
- id: TEXT PRIMARY KEY (UUID)
- profile_type: TEXT ("communication_style", "emotional_baseline", "humor_receptivity", "topic_interests", "exercise_capability")
- summary_text: TEXT (human-readable summary)
- embedding: FLOAT[1536] (vector embedding for similarity search via sqlite-vec)
- confidence: FLOAT (0.0-1.0, increases with more observations)
- observation_count: INTEGER
- created_at: TIMESTAMP
- updated_at: TIMESTAMP
- consent_tier: INTEGER (3)

session_summaries
- id: TEXT PRIMARY KEY (UUID)
- session_date: DATE
- summary_text: TEXT (condensed session notes, NOT raw conversation)
- key_observations: TEXT (JSON array of personality signals observed)
- embedding: FLOAT[1536] (vector for similarity retrieval)
- created_at: TIMESTAMP
- expires_at: TIMESTAMP (6 months from creation — lifecycle policy)
- consent_tier: INTEGER (3)

consent_settings
- id: TEXT PRIMARY KEY
- tier_1_enabled: BOOLEAN DEFAULT TRUE
- tier_2_enabled: BOOLEAN DEFAULT FALSE
- tier_2_opted_in_at: TIMESTAMP
- tier_3_enabled: BOOLEAN DEFAULT FALSE
- tier_3_opted_in_at: TIMESTAMP
- tier_3_trusted_person_confirmed: BOOLEAN DEFAULT FALSE
- last_consent_reminder: TIMESTAMP
- updated_at: TIMESTAMP
```

### Vector Search Setup
- Use sqlite-vec extension for vector similarity search on personality_profiles and session_summaries tables
- Embedding dimension: 1536 (matching the embedding model used)
- Implement cosine similarity search for retrieving relevant personality context at session start

---

## NSUbiquitousKeyValueStore Sync

### Initialization
- Initialize on first app launch — no user configuration required
- Requires iCloud capability and key-value store entitlement in Xcode project

### Sync Strategy
- Every time a Tier 2 preference fact is written to SQLite-vec, simultaneously write it to NSUbiquitousKeyValueStore
- Key format: `pref_{key}` (e.g., `pref_preferred_name`, `pref_exercise_time`)
- Value: JSON string containing `{value, source, updated_at}`
- On app launch, reconcile NSUbiquitousKeyValueStore with local SQLite-vec:
  - If local DB exists and is populated → it is authoritative (no-op)
  - If local DB is empty/missing but key-value store has data → restore preferences from key-value store
  - This handles the new-device/database-loss scenario

### Constraints
- 1MB total storage limit — sufficient for hundreds of structured preference facts
- 1024 maximum keys — more than enough for Tier 2 data
- Do NOT store Tier 3 data (embeddings, session summaries) here — too large
- Sync is not real-time (minutes to hours) — this is acceptable as it's a backup mechanism

---

## Personality Extraction Pipeline (Summarization-and-Forget)

After each conversation session, run the following pipeline:

### Step 1: Extract Personality Signals
Send the session transcript to Claude with a structured extraction prompt:

```
You are analyzing a conversation between Maya (an AI wellness companion) and a senior user. Extract personality signals from this conversation. Do NOT include any raw conversation text in your output.

Extract the following categories:
1. EXPLICIT PREFERENCES: Things the user directly stated they prefer or want
2. COMMUNICATION STYLE: Observations about pace, verbosity, formality, humor use
3. EMOTIONAL PATTERNS: Emotional tone, topics that energize or concern them
4. EXERCISE OBSERVATIONS: Physical capabilities, limitations, preferences observed
5. TOPIC INTERESTS: Subjects they showed enthusiasm or engagement about

For each signal, provide:
- category: one of the above
- observation: a concise summary (1-2 sentences max)
- confidence: low/medium/high based on how clear the signal was
- is_new: whether this appears to be new information vs. reinforcing known patterns

Output as JSON array.
```

### Step 2: Update Stores
- New explicit preferences → write to both SQLite-vec `preference_facts` table and NSUbiquitousKeyValueStore
- Personality observations → generate embeddings, upsert into `personality_profiles` table (update confidence and observation_count for existing profiles, insert new ones)
- Session summary → generate embedding, insert into `session_summaries` table

### Step 3: Discard Raw Conversation
- The raw session transcript is NOT stored anywhere
- Only the extracted signals and summaries persist
- This minimizes data exposure surface

---

## Session Start: Context Retrieval

When a new session begins, retrieve personalization context to warm-start the conversation:

1. Load all `preference_facts` (Tier 2) — these are always included if Tier 2 is enabled
2. Load current `personality_profiles` (Tier 3) — include summary_text for each profile type
3. Retrieve the 3-5 most recent/relevant `session_summaries` (Tier 3) using vector similarity against a context query like "What has this user been discussing and working on recently?"
4. Compose this into a system prompt addition for Claude:

```
## User Personalization Context

### Preferences (user-declared):
- Preferred name: Margaret
- Exercise preference: Morning sessions, gentle stretching
- Physical limitation: Arthritis in left knee
- Communication: Prefers slower pace, appreciates humor

### Personality Profile:
- Communication style: Warm, conversational, likes to share stories about family before exercises
- Emotional baseline: Generally positive, can become anxious when discussing health changes
- Exercise capability: Good upper body mobility, limited lower body flexibility

### Recent Context:
- Last session: Discussed daughter's upcoming visit, completed 15-min chair yoga
- Recent pattern: Has been more engaged with balance exercises this week
```

---

## Voice Command Interface for Preference Management

Implement voice-activated preference management:

- **"Maya, what do you remember about me?"** → Maya reads back all Tier 2 preference facts in natural language
- **"Maya, forget that"** → Deletes the most recently discussed/added preference
- **"Maya, forget everything about me"** → Immediately deletes ALL data across all tiers, resets consent to Tier 1 only. Executes instantly with no multi-step confirmation. Maya confirms: "Done. I've forgotten everything. We can start fresh whenever you're ready."
- **"Maya, stop learning about me"** → Revokes Tier 3 consent, deletes all Tier 3 data, retains Tier 2
- **"Maya, what tier am I on?"** → Explains current consent level in plain language

---

## Consent Reminder System

Implement periodic (monthly) consent reminders:

- Track `last_consent_reminder` in consent_settings
- When 30 days have elapsed, Maya naturally weaves in a reminder:
  - "Margaret, I just want to check in — I remember that you enjoy talking about your garden and prefer gentle stretching exercises in the morning. Would you like me to keep remembering these things, or would you prefer I forget anything?"
- Keep the tone warm and non-threatening
- If the user confirms, update `last_consent_reminder` timestamp
- If the user wants to change, process the tier change immediately

---

## Data Lifecycle Policy

- Session summaries older than 6 months: consolidate key observations into personality_profiles, then delete the summary
- Implement a background task that runs on app launch to check for expired session_summaries
- Personality profiles are retained indefinitely (as long as consent is active) but are updated/refined with new observations

---

## Privacy Safeguards

- **No data sharing by design**: Even if family dashboards or physician reports are built later, they must use separate session-level activity data (exercise completed, session duration) with separate consent — NEVER from the personality profile
- **Audit logging without content**: Log that a personalization query happened, but NOT what was queried or returned
- **No network transmission of personal data**: Personal data never leaves the iPad except through iCloud backup (which the user controls) and NSUbiquitousKeyValueStore sync (encrypted by Apple)
- **Filesystem encryption**: Rely on iPad's iOS Data Protection for encryption at rest — when the device is locked, the SQLite-vec database is encrypted automatically

---

## Implementation Priority

1. **Phase 1**: Implement consent_settings table and Tier 1 (session-only memory) — this may already be partially working via Claude's natural conversational coherence
2. **Phase 2**: Implement Tier 2 — preference_facts table, NSUbiquitousKeyValueStore sync, voice commands for preference management, session-start context retrieval for preferences
3. **Phase 3**: Implement Tier 3 — personality_profiles table, session_summaries table, extraction pipeline, vector search, consent reminders, data lifecycle
4. **Phase 4**: Testing and refinement with beta users — validate that personalization measurably improves the experience

---

## Technical Notes

- The app runs on iPad (M-series chips available) with iOS/iPadOS
- SQLite is native to iOS — sqlite-vec is loaded as an extension
- Embedding generation will require a cloud API call (send abstracted summaries, not raw conversation)
- Build the extraction and embedding pipeline as an async background task that runs after session end, so it doesn't block the user experience
- All database operations should be wrapped in proper error handling — graceful degradation if the DB is unavailable (fall back to Tier 1 session-only behavior)
