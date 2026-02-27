# MayaMind Personalization Architecture v1.01

## Document History

| Version | Date | Changes |
|---------|------|---------|
| 1.00 | 2026-02-25 | Initial architecture |
| 1.01 | 2026-02-25 | Merged with Opus 4.6 brainstorm; added three-tier consent model, voice commands, POC-specific guidance; added 6+1 category framework (6 universal + 1 emergent); added content safety & banned categories |

---

## 1. Overview

MayaMind's personalization system enables Maya to build a deep understanding of each senior user over time, creating conversations and exercise coaching that feel genuinely personal. The system is designed with privacy as a foundational principle: personality data is stored locally, encrypted, and never accessible to administrators, family members, or healthcare providers.

### Goals

1. **Meaningful Personalization** — Maya remembers names, preferences, health context, and conversation history
2. **Privacy by Design** — Local-only storage, user-controlled, tiered consent
3. **Cross-Section Intelligence** — Both Maya Conversation and Exercise Coaching contribute to and benefit from personalization
4. **Transparency** — Users can view, edit, and delete what Maya knows via voice or UI
5. **Graceful Growth** — System learns progressively through three consent tiers
6. **Senior-Friendly** — Voice-first data management, plain-language explanations

### POC Scope

This document covers the **browser-based Mac prototype** with clear annotations for iPad production differences:

| Component | POC (Mac/Browser) | Production (iPad) |
|-----------|-------------------|-------------------|
| Database | sql.js (WebAssembly SQLite) | Native SQLite + sqlite-vec |
| Vector Search | Brute-force cosine similarity | sqlite-vec extension |
| Embeddings | Deferred (keyword + recency) | 1536-dim via embedding API |
| Backup | None (localStorage persistence) | NSUbiquitousKeyValueStore + iCloud |
| Encryption | Web Crypto API | iOS Data Protection |
| Emotion Detection | Text-based via Claude `[MOOD:xxx]` | Future: Consider Hume integration |

---

## 2. Three-Tier Consent Model

### Tier 1 — Session-Only Memory (Default)

**No opt-in required. This is the baseline experience.**

- Maya remembers context within a single conversation session
- Nothing is persisted after the session ends
- Relies on Claude's natural conversational coherence
- User can use the app without any data collection

**User experience:**
> Maya: "Hello! I'm Maya, your wellness companion. How are you feeling today?"
> *(No personalization — each session starts fresh)*

---

### Tier 2 — Preference Memory (Explicit Opt-In)

**Maya remembers explicit, user-declared facts — not inferred information.**

**What's stored:**
- Preferred name ("Call me Betty, not Elizabeth")
- Exercise schedule preferences ("I prefer morning workouts")
- Physical limitations ("I have arthritis in my left knee")
- Communication preferences ("I like to take things slowly")
- Family member names (when explicitly introduced)

**What's NOT stored:**
- Inferred personality traits
- Emotional patterns
- Conversation content or summaries

**User controls:**
- "Maya, what do you remember about me?" → Maya reads back all preferences
- "Maya, forget that" → Deletes the most recently added preference
- "Maya, forget everything about me" → Immediate full deletion, reset to Tier 1

**Storage:**
- POC: sql.js `preference_facts` table + localStorage persistence
- Production: SQLite + NSUbiquitousKeyValueStore (automatic iCloud backup)

---

### Tier 3 — Personality Modeling (Full Personalization)

**Full RAG-powered personalization with summarization-and-forget pipeline.**

**What's stored:**
- Everything from Tier 2, plus:
- Communication style observations (pace, formality, humor receptivity)
- Emotional tone patterns (topics that energize or concern them)
- Exercise capabilities observed over time
- Topic interests and engagement patterns
- Session summaries (condensed, not raw transcripts)

**Privacy safeguard:**
- Raw conversation transcripts are NEVER stored
- Only extracted signals and summaries persist
- Summarization-and-forget pipeline processes then discards

**Additional consent:**
- Requires explicit, informed opt-in with plain-language explanation
- Optional: Validation by a designated trusted person (family member)

**User controls:**
- All Tier 2 controls, plus:
- "Maya, stop learning about me" → Revokes Tier 3, deletes Tier 3 data, retains Tier 2
- "Maya, what tier am I on?" → Explains current consent level

**Storage:**
- sql.js `personality_profiles` and `session_summaries` tables
- Production: sqlite-vec with vector similarity search

---

### Tier Transitions

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Tier 1 ──(opt-in)──► Tier 2 ──(opt-in)──► Tier 3             │
│     ▲                    │                    │                 │
│     │                    │                    │                 │
│     └────────────────────┴────────────────────┘                 │
│              (revoke = delete higher-tier data)                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Critical rule:** Stepping down a tier triggers immediate deletion of all higher-tier data.

---

## 3. Category Framework

### 3.1 Design Philosophy: Universal + Emergent

Rather than defining rigid interest categories (Sports, Travel, Music) that may not apply to all users, MayaMind uses a **6+1 category model**:

- **6 Universal Categories** — Structured profiles that apply to 98-99% of seniors
- **1 Emergent Category** — A flexible container for topics that surface organically from conversation

This design ensures:
- No wasted categories for disinterested users
- No missed interests (even obscure hobbies get captured)
- Natural scaling (heavy users accumulate more topics; light users have fewer)
- Future-proof structure (new interests emerge without schema changes)

### 3.2 Universal Categories (Structured)

These categories have dedicated profile types and apply to virtually all users:

| Category | Profile Type | What It Captures | Why Universal |
|----------|--------------|------------------|---------------|
| **Identity** | `identity` | Preferred name, how to be addressed, personal background | Everyone has identity preferences |
| **Communication** | `communication` | Pace, humor receptivity, directness, verbosity, formality | Everyone has a communication style |
| **Health & Mobility** | `health` | Physical limitations, medications, mobility aids, energy levels | Core to wellness mission |
| **Relationships** | `relationships` | People mentioned — family, friends, caregivers, pets | Everyone has people in their life |
| **Routine** | `routine` | Daily patterns, exercise timing, sleep, meal preferences | Everyone has routines |
| **Emotional** | `emotional` | What energizes them, what concerns them, mood patterns | Universal human trait |

### 3.3 Emergent Category (Flexible)

The **Topics** category captures whatever interests surface naturally from conversation:

| Category | Profile Type | What It Captures | How It Works |
|----------|--------------|------------------|--------------|
| **Topics** | `topic:{tag}` | Any subject showing user engagement | Organically populated, grows over time |

**Example topic variations per user:**

| User A (sports fan) | User B (gardener) | User C (family-focused) |
|---------------------|-------------------|-------------------------|
| `topic:baseball` | `topic:roses` | `topic:grandchildren` |
| `topic:golf` | `topic:vegetable_garden` | `topic:family_recipes` |
| `topic:march_madness` | `topic:composting` | `topic:photo_albums` |

**Growth expectation:**
- POC: 1-5 topics per user
- Production (after months): 10-15+ topics per active user

### 3.4 Category Summary

```
┌─────────────────────────────────────────────────────────────────┐
│  UNIVERSAL CATEGORIES (structured, 98-99% of users)             │
├─────────────────────────────────────────────────────────────────┤
│  1. Identity         — Name, address preferences, background    │
│  2. Communication    — Style, pace, humor, formality            │
│  3. Health & Mobility — Limitations, medications, energy        │
│  4. Relationships    — Family, friends, caregivers, pets        │
│  5. Routine          — Daily patterns, timing preferences       │
│  6. Emotional        — Mood patterns, energizers, concerns      │
├─────────────────────────────────────────────────────────────────┤
│  EMERGENT CATEGORY (organic, grows from conversation)           │
├─────────────────────────────────────────────────────────────────┤
│  7. Topics           — Interests that surface naturally         │
│     └── topic:gardening    (if user discusses it)               │
│     └── topic:baseball     (if user discusses it)               │
│     └── topic:cooking      (if user discusses it)               │
│     └── topic:grandkids    (if user discusses it)               │
│     └── ... (grows over time)                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Data Model

### 4.1 Preference Facts (Tier 2)

```javascript
{
  id: "uuid-v4",
  key: "preferred_name",           // Standardized key
  value: "Betty",                  // User-declared value
  source: "user_declared",         // "user_declared" or "maya_confirmed"
  created_at: "2026-02-25T10:30:00Z",
  updated_at: "2026-02-25T10:30:00Z",
  consent_tier: 2
}
```

**Standard preference keys:**

| Key | Example Value | Category |
|-----|---------------|----------|
| `preferred_name` | "Betty" | Identity |
| `exercise_time` | "morning" | Exercise |
| `exercise_frequency` | "daily" | Exercise |
| `physical_limitation` | "arthritis in left knee" | Health |
| `mobility_aid` | "uses walker outdoors" | Health |
| `communication_pace` | "slower" | Communication |
| `humor_preference` | "appreciates gentle humor" | Communication |
| `family_member_{name}` | "daughter, nurse in Boston" | Relationships |

### 4.2 Personality Profiles (Tier 3) — Universal Categories

```javascript
{
  id: "uuid-v4",
  profile_type: "communication",        // One of 6 universal types
  summary_text: "Warm, conversational. Likes to share family stories before exercises. Appreciates when Maya asks follow-up questions. Prefers slower pace.",
  keywords: ["warm", "conversational", "family", "stories", "follow-up", "slow"],
  confidence: 0.75,                     // 0.0-1.0, increases with observations
  observation_count: 12,
  created_at: "2026-02-25T10:30:00Z",
  updated_at: "2026-02-25T14:22:00Z",
  consent_tier: 3
}
```

**Universal profile types (6 total):**

| Type | What It Captures | Example Summary |
|------|------------------|-----------------|
| `identity` | Name preferences, personal background, self-description | "Prefers Betty. Retired teacher, 35 years. Originally from Chicago." |
| `communication` | Pace, verbosity, formality, humor, question style | "Warm, conversational. Slower pace. Appreciates gentle humor." |
| `health` | Physical capabilities, limitations, medications, energy | "Arthritis in left knee. Good upper body. Takes BP meds morning." |
| `relationships` | Family, friends, caregivers, pets mentioned | "Daughter Susan (nurse, Boston). Granddaughter Sarah (12, soccer). Cat Whiskers passed 2025." |
| `routine` | Daily patterns, timing preferences, regular activities | "Wakes 7am. Prefers morning exercise. Calls Susan Sundays." |
| `emotional` | Mood patterns, energizers, concerns, values | "Generally positive. Values independence. Energized by family talk. Worries about being a burden." |

### 4.3 Topics (Tier 3) — Emergent Category

```javascript
{
  id: "uuid-v4",
  topic_tag: "rose_gardening",          // Normalized tag
  display_name: "Rose Gardening",       // Human-readable
  summary_text: "Has rose garden in backyard. Prefers hybrid tea roses. Struggles with aphids. Enjoys discussing seasonal care.",
  keywords: ["roses", "garden", "hybrid tea", "aphids", "flowers", "backyard"],
  engagement_level: "high",             // "high", "medium", "low"
  confidence: 0.8,
  observation_count: 8,
  first_mentioned: "2026-01-15T10:30:00Z",
  last_mentioned: "2026-02-24T14:22:00Z",
  created_at: "2026-01-15T10:30:00Z",
  updated_at: "2026-02-24T14:22:00Z",
  consent_tier: 3
}
```

**Engagement levels:**

| Level | Meaning | Retrieval Priority |
|-------|---------|-------------------|
| `high` | User lights up discussing this topic | Always include in context |
| `medium` | User engages when topic arises | Include if relevant to query |
| `low` | User mentioned but showed limited interest | Include only if directly relevant |

**Example topics that might emerge:**

| Topic Tag | Display Name | Typical Keywords |
|-----------|--------------|------------------|
| `rose_gardening` | Rose Gardening | roses, garden, pruning, aphids |
| `giants_baseball` | SF Giants Baseball | giants, baseball, oracle park, scores |
| `mystery_novels` | Mystery Novels | books, reading, agatha christie, detective |
| `grandchildren` | Grandchildren | grandkids, sarah, soccer, school |
| `italian_cooking` | Italian Cooking | pasta, recipes, marinara, nonna |
| `birdwatching` | Birdwatching | birds, feeders, cardinals, binoculars |

### 4.4 Session Summaries (Tier 3)

```javascript
{
  id: "uuid-v4",
  session_date: "2026-02-25",
  summary_text: "Discussed daughter Susan's upcoming visit. Completed 15-minute chair yoga session with good form. Mentioned hip felt better today.",
  key_observations: [
    "excited about family visit",
    "hip mobility improving",
    "engaged well with balance exercises"
  ],
  keywords: ["susan", "visit", "chair yoga", "hip", "balance"],
  created_at: "2026-02-25T15:00:00Z",
  expires_at: "2026-08-25T15:00:00Z",   // 6 months lifecycle
  consent_tier: 3
}
```

### 4.5 Consent Settings

```javascript
{
  id: "user_consent",
  tier_1_enabled: true,                    // Always true (baseline)
  tier_2_enabled: false,
  tier_2_opted_in_at: null,
  tier_3_enabled: false,
  tier_3_opted_in_at: null,
  tier_3_trusted_person_confirmed: false,  // Optional validation
  last_consent_reminder: null,
  updated_at: "2026-02-25T10:00:00Z"
}
```

---

## 5. Database Schema (sql.js for POC)

```sql
-- Tier 2: Explicit preference facts
CREATE TABLE preference_facts (
  id TEXT PRIMARY KEY,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'user_declared',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consent_tier INTEGER NOT NULL DEFAULT 2
);

CREATE INDEX idx_pref_key ON preference_facts(key);

-- Tier 3: Universal personality profiles (6 categories)
CREATE TABLE personality_profiles (
  id TEXT PRIMARY KEY,
  profile_type TEXT NOT NULL,          -- 'identity', 'communication', 'health', 'relationships', 'routine', 'emotional'
  summary_text TEXT NOT NULL,
  keywords TEXT NOT NULL,              -- JSON array for keyword search
  confidence REAL NOT NULL DEFAULT 0.5,
  observation_count INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consent_tier INTEGER NOT NULL DEFAULT 3
);

CREATE INDEX idx_profile_type ON personality_profiles(profile_type);

-- Tier 3: Emergent topics (flexible, grows over time)
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  topic_tag TEXT NOT NULL UNIQUE,      -- Normalized tag: 'rose_gardening', 'giants_baseball'
  display_name TEXT NOT NULL,          -- Human-readable: 'Rose Gardening', 'SF Giants Baseball'
  summary_text TEXT NOT NULL,
  keywords TEXT NOT NULL,              -- JSON array for keyword search
  engagement_level TEXT NOT NULL DEFAULT 'medium',  -- 'high', 'medium', 'low'
  confidence REAL NOT NULL DEFAULT 0.5,
  observation_count INTEGER NOT NULL DEFAULT 1,
  first_mentioned TEXT NOT NULL,
  last_mentioned TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  consent_tier INTEGER NOT NULL DEFAULT 3
);

CREATE INDEX idx_topic_tag ON topics(topic_tag);
CREATE INDEX idx_topic_engagement ON topics(engagement_level);
CREATE INDEX idx_topic_last_mentioned ON topics(last_mentioned DESC);

-- Tier 3: Session summaries
CREATE TABLE session_summaries (
  id TEXT PRIMARY KEY,
  session_date TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  key_observations TEXT NOT NULL,      -- JSON array
  keywords TEXT NOT NULL,              -- JSON array for keyword search
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consent_tier INTEGER NOT NULL DEFAULT 3
);

CREATE INDEX idx_session_date ON session_summaries(session_date DESC);
CREATE INDEX idx_session_expires ON session_summaries(expires_at);

-- Consent settings
CREATE TABLE consent_settings (
  id TEXT PRIMARY KEY DEFAULT 'user_consent',
  tier_1_enabled INTEGER NOT NULL DEFAULT 1,
  tier_2_enabled INTEGER NOT NULL DEFAULT 0,
  tier_2_opted_in_at TEXT,
  tier_3_enabled INTEGER NOT NULL DEFAULT 0,
  tier_3_opted_in_at TEXT,
  tier_3_trusted_person_confirmed INTEGER NOT NULL DEFAULT 0,
  last_consent_reminder TEXT,
  updated_at TEXT NOT NULL
);

-- Audit log (for transparency, no content stored)
CREATE TABLE access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,                -- 'retrieved', 'created', 'updated', 'deleted'
  table_name TEXT NOT NULL,
  record_count INTEGER,
  context TEXT,                        -- 'maya_conversation', 'exercise_session', 'user_review'
  timestamp TEXT NOT NULL
);
```

---

## 6. Retrieval System (POC: Keyword + Recency)

### 6.1 Query Strategy

For POC, use keyword matching with recency scoring instead of vector embeddings:

```javascript
class PersonalizationStore {

  /**
   * Retrieve relevant context for a conversation or exercise session
   */
  async retrieveContext(query, options = {}) {
    const {
      limit = 5,
      section = 'maya',  // 'maya' or 'exercise'
      includeTier2 = true,
      includeTier3 = true
    } = options;

    const results = {
      preferences: [],      // Tier 2
      profiles: [],         // Tier 3: Universal categories
      topics: [],           // Tier 3: Emergent topics
      recentSessions: []    // Tier 3
    };

    const consent = await this.getConsentSettings();

    // Tier 2: Always include all preferences if enabled
    if (includeTier2 && consent.tier_2_enabled) {
      results.preferences = await this.getAllPreferences();
    }

    // Tier 3: Keyword + recency search
    if (includeTier3 && consent.tier_3_enabled) {
      const keywords = this.extractKeywords(query);

      // Get all universal profiles (6 categories - small set)
      results.profiles = await this.getAllProfiles();

      // Get high-engagement topics + any matching keywords
      results.topics = await this.getRelevantTopics(keywords);

      // Get recent/relevant session summaries
      results.recentSessions = await this.searchSessions(keywords, { limit });
    }

    return results;
  }

  /**
   * Get topics: all high-engagement + keyword matches
   */
  async getRelevantTopics(keywords) {
    // Always include high-engagement topics
    const highEngagement = await this.db.exec(`
      SELECT * FROM topics
      WHERE engagement_level = 'high'
      ORDER BY last_mentioned DESC
    `);

    // Also include medium/low engagement if keywords match
    const allTopics = await this.db.exec(`
      SELECT * FROM topics
      WHERE engagement_level IN ('medium', 'low')
      ORDER BY last_mentioned DESC
    `);

    const matchingTopics = allTopics.filter(topic => {
      const topicKeywords = JSON.parse(topic.keywords);
      return keywords.some(k =>
        topicKeywords.some(tk => tk.includes(k) || k.includes(tk))
      );
    });

    // Combine and dedupe
    const combined = [...highEngagement, ...matchingTopics];
    const seen = new Set();
    return combined.filter(t => {
      if (seen.has(t.id)) return false;
      seen.add(t.id);
      return true;
    });
  }

  /**
   * Keyword extraction for search
   */
  extractKeywords(text) {
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'i', 'you', 'we', 'they', 'it', 'to', 'for', 'of', 'and', 'or', 'but', 'in', 'on', 'at', 'with', 'about', 'how', 'what', 'when', 'where', 'why', 'do', 'does', 'did', 'have', 'has', 'had', 'be', 'been', 'being', 'my', 'your', 'our', 'their', 'this', 'that', 'these', 'those']);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  /**
   * Search session summaries by keyword with recency weighting
   */
  async searchSessions(keywords, { limit = 5 }) {
    const sessions = await this.db.exec(`
      SELECT * FROM session_summaries
      WHERE expires_at > datetime('now')
      ORDER BY session_date DESC
      LIMIT 20
    `);

    // Score by keyword match + recency
    const scored = sessions.map(session => {
      const sessionKeywords = JSON.parse(session.keywords);
      const keywordScore = keywords.filter(k =>
        sessionKeywords.some(sk => sk.includes(k) || k.includes(sk))
      ).length / Math.max(keywords.length, 1);

      const daysSince = (Date.now() - new Date(session.session_date)) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-daysSince / 30);  // Decay over 30 days

      return {
        ...session,
        score: (keywordScore * 0.6) + (recencyScore * 0.4)
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }
}
```

### 6.2 Context Injection

```javascript
function buildPersonalizedPrompt(basePrompt, context, userName) {
  const sections = [];

  // Tier 2: Preferences
  if (context.preferences.length > 0) {
    sections.push(`### User Preferences (stated by ${userName}):`);
    context.preferences.forEach(pref => {
      sections.push(`- ${formatPreferenceKey(pref.key)}: ${pref.value}`);
    });
  }

  // Tier 3: Universal profiles (6 categories)
  if (context.profiles.length > 0) {
    sections.push(`\n### Understanding of ${userName}:`);
    context.profiles.forEach(profile => {
      sections.push(`- ${formatProfileType(profile.profile_type)}: ${profile.summary_text}`);
    });
  }

  // Tier 3: Topics of interest (emergent)
  if (context.topics.length > 0) {
    sections.push(`\n### Topics ${userName} Enjoys:`);
    context.topics.forEach(topic => {
      const engagement = topic.engagement_level === 'high' ? ' (favorite)' : '';
      sections.push(`- ${topic.display_name}${engagement}: ${topic.summary_text}`);
    });
  }

  // Tier 3: Recent session context
  if (context.recentSessions.length > 0) {
    sections.push(`\n### Recent Context:`);
    context.recentSessions.slice(0, 3).forEach(session => {
      sections.push(`- ${session.session_date}: ${session.summary_text}`);
    });
  }

  if (sections.length === 0) {
    return basePrompt;
  }

  return `${basePrompt}

## Personalization Context for ${userName}

${sections.join('\n')}

Use this context naturally when relevant. Don't force references that don't fit the conversation.`;
}
```

---

## 7. Personality Extraction Pipeline

### 7.1 Post-Session Processing (Summarization-and-Forget)

After each conversation or exercise session:

```javascript
async function processSessionEnd(sessionTranscript, sessionType) {
  const consent = await personalization.getConsentSettings();

  if (!consent.tier_3_enabled) {
    // Tier 2 only: extract explicit preferences
    if (consent.tier_2_enabled) {
      await extractExplicitPreferences(sessionTranscript);
    }
    return;
  }

  // Tier 3: Full extraction pipeline
  const extraction = await extractPersonalitySignals(sessionTranscript);

  // Process extracted signals
  await processExplicitPreferences(extraction.explicitPreferences);
  await updatePersonalityProfiles(extraction.personalityObservations);
  await createSessionSummary(extraction.sessionSummary, sessionType);

  // Critical: Discard raw transcript
  // The transcript variable goes out of scope and is garbage collected
  // We do NOT store it anywhere
}
```

### 7.2 Claude Extraction Prompt

```javascript
const EXTRACTION_PROMPT = `You are analyzing a conversation between Maya (an AI wellness companion) and a senior user. Extract personality signals using the 6+1 category framework.

CRITICAL: Do NOT include any raw conversation text or quotes in your output. Only provide summarized observations.

## UNIVERSAL CATEGORIES (extract if signals present)

1. IDENTITY: Personal identity observations
   - Name preferences, how they want to be addressed
   - Personal background, career history
   - Self-description, values they express about themselves

2. COMMUNICATION: How they prefer to interact
   - Pace (quick/measured/slow)
   - Verbosity (brief/moderate/detailed)
   - Formality (casual/friendly/formal)
   - Humor receptivity (enjoys jokes, prefers serious tone)
   - Question style (direct/conversational)

3. HEALTH: Physical and wellness observations
   - Physical capabilities and limitations
   - Medications or treatments mentioned
   - Energy levels, mobility
   - Health concerns expressed

4. RELATIONSHIPS: People and pets in their life
   - Family members mentioned (name, relationship, details)
   - Friends, caregivers, neighbors
   - Pets (current or remembered)
   - How they talk about these relationships

5. ROUTINE: Daily patterns and timing
   - Wake/sleep patterns
   - Exercise timing preferences
   - Meal preferences
   - Regular activities (calls, clubs, appointments)

6. EMOTIONAL: Mood and emotional patterns
   - General emotional baseline
   - Topics that energize or excite them
   - Topics that concern or worry them
   - Values they express (independence, family connection, etc.)

## EMERGENT CATEGORY (extract when clear interest shown)

7. TOPICS: Specific interests the user shows enthusiasm about
   - Any subject where they "light up" or engage deeply
   - Hobbies, sports teams, genres of books/movies
   - Provide a suggested tag (e.g., "rose_gardening", "giants_baseball")
   - Rate engagement: "high" (enthusiastic), "medium" (interested), "low" (mentioned only)

## ALSO EXTRACT

8. EXPLICIT_PREFERENCES: Direct statements of preference (Tier 2 level)
   - Only include facts the user clearly declared
   - Example: "prefers morning exercise" (if user said "I like to exercise in the morning")
   - What they wanted to discuss
   - What they avoided or dismissed

6. SESSION_SUMMARY: A 2-3 sentence summary of the session (no quotes)

For each observation, provide:
- category: one of the above
- observation: concise summary (1-2 sentences max, NO QUOTES)
- confidence: "low" | "medium" | "high"
- is_new: whether this appears to be new vs. reinforcing known patterns

Output as JSON:
{
  "explicitPreferences": [...],
  "personalityObservations": [...],
  "sessionSummary": {
    "text": "...",
    "keyObservations": ["...", "..."]
  }
}`;
```

### 7.3 Profile Updates

```javascript
async function updatePersonalityProfiles(observations) {
  for (const obs of observations) {
    const profileType = mapCategoryToProfileType(obs.category);
    if (!profileType) continue;

    const existing = await personalization.getProfile(profileType);

    if (existing) {
      // Update existing profile
      const newConfidence = calculateNewConfidence(
        existing.confidence,
        existing.observation_count,
        obs.confidence
      );

      await personalization.updateProfile(existing.id, {
        summary_text: mergeObservations(existing.summary_text, obs.observation),
        keywords: mergeKeywords(existing.keywords, extractKeywords(obs.observation)),
        confidence: newConfidence,
        observation_count: existing.observation_count + 1
      });
    } else {
      // Create new profile
      await personalization.createProfile({
        profile_type: profileType,
        summary_text: obs.observation,
        keywords: extractKeywords(obs.observation),
        confidence: obs.confidence === 'high' ? 0.7 : obs.confidence === 'medium' ? 0.5 : 0.3,
        observation_count: 1
      });
    }
  }
}

function calculateNewConfidence(current, count, newObsConfidence) {
  const obsWeight = { low: 0.1, medium: 0.2, high: 0.3 }[newObsConfidence];
  const newConfidence = current + (obsWeight * (1 - current));
  return Math.min(newConfidence, 0.95);  // Cap at 0.95
}
```

---

## 8. Voice Command Interface

### 8.1 Command Recognition

```javascript
const VOICE_COMMANDS = {
  // Tier 2+ commands
  'what do you remember about me': 'LIST_PREFERENCES',
  'what do you know about me': 'LIST_PREFERENCES',
  'forget that': 'FORGET_LAST',
  'forget everything about me': 'FORGET_ALL',
  'forget everything': 'FORGET_ALL',

  // Tier 3 commands
  'stop learning about me': 'REVOKE_TIER_3',
  'stop remembering': 'REVOKE_TIER_3',

  // Status commands
  'what tier am i on': 'STATUS',
  'what is my privacy level': 'STATUS',
  'what are my privacy settings': 'STATUS'
};

function detectVoiceCommand(transcript) {
  const normalized = transcript.toLowerCase().trim();

  for (const [phrase, command] of Object.entries(VOICE_COMMANDS)) {
    if (normalized.includes(phrase)) {
      return command;
    }
  }
  return null;
}
```

### 8.2 Command Responses

```javascript
async function handleVoiceCommand(command) {
  switch (command) {
    case 'LIST_PREFERENCES':
      const prefs = await personalization.getAllPreferences();
      if (prefs.length === 0) {
        return "I don't have any saved preferences for you yet.";
      }
      const prefList = prefs.map(p => `${formatPreferenceKey(p.key)}: ${p.value}`).join('. ');
      return `Here's what I remember about you: ${prefList}. Would you like me to forget any of these?`;

    case 'FORGET_LAST':
      const lastPref = await personalization.getLastAddedPreference();
      if (lastPref) {
        await personalization.deletePreference(lastPref.id);
        return `Done. I've forgotten that ${formatPreferenceKey(lastPref.key)} was ${lastPref.value}.`;
      }
      return "I don't have any recent preferences to forget.";

    case 'FORGET_ALL':
      await personalization.deleteAllData();
      await personalization.setConsentTier(1);
      return "Done. I've forgotten everything about you. We can start fresh whenever you're ready.";

    case 'REVOKE_TIER_3':
      await personalization.deleteTier3Data();
      await personalization.setConsentTier(2);
      return "I've stopped learning about your personality. I'll still remember the preferences you've told me directly, but I won't observe patterns anymore. You can tell me to start learning again anytime.";

    case 'STATUS':
      const consent = await personalization.getConsentSettings();
      if (consent.tier_3_enabled) {
        return "You're on Tier 3, which means I'm learning about your personality and communication style over time. Everything stays private on your device. Would you like me to explain what that means, or change your settings?";
      } else if (consent.tier_2_enabled) {
        return "You're on Tier 2, which means I remember preferences you tell me directly, but I'm not learning patterns about you. Would you like me to start learning more about you?";
      } else {
        return "You're on Tier 1, which means I don't remember anything between our conversations. Each time we talk, we start fresh. Would you like me to remember your preferences?";
      }
  }
}
```

---

## 9. Consent Flows

### 9.1 Tier 2 Opt-In

Triggered when user first expresses a preference or during onboarding:

```javascript
const TIER_2_CONSENT_SCRIPT = `
I'd love to remember that for next time. Would you like me to remember your preferences so I can personalize our conversations?

Here's what that means:
- I'll remember things you tell me directly, like your preferred name or exercise schedule
- Everything stays private, stored only on your device
- You can ask me what I remember anytime, and tell me to forget anything
- No one else can see this information

Would you like me to remember your preferences?
`;

async function promptTier2Consent() {
  const response = await maya.speakAndListen(TIER_2_CONSENT_SCRIPT);

  if (isAffirmative(response)) {
    await personalization.enableTier2();
    return "Great! I'll remember what you share with me. You can always ask 'Maya, what do you remember about me?' to see what I know, or tell me to forget anything.";
  } else {
    return "No problem. I'll keep our conversations private and won't remember anything between sessions. You can change your mind anytime.";
  }
}
```

### 9.2 Tier 3 Opt-In

Offered after Tier 2 is established and user shows engagement:

```javascript
const TIER_3_CONSENT_SCRIPT = `
I've noticed we've been having some great conversations. Would you like me to learn more about you over time?

Here's what that means:
- I'll start to understand your communication style and what topics interest you
- I'll notice patterns that help me be a better companion
- I never store our actual conversations - just my understanding of you
- Everything stays completely private on your device
- You can tell me to stop learning anytime

This helps me be more helpful and have more natural conversations with you. Would you like me to start learning about you?
`;

async function promptTier3Consent() {
  const response = await maya.speakAndListen(TIER_3_CONSENT_SCRIPT);

  if (isAffirmative(response)) {
    await personalization.enableTier3();
    return "Wonderful! I'll pay attention to what makes our conversations work well for you. Remember, you can always ask me to stop learning by saying 'Maya, stop learning about me.'";
  } else {
    return "That's perfectly fine. I'll continue remembering just the preferences you tell me directly.";
  }
}
```

### 9.3 Monthly Consent Reminder

```javascript
async function checkConsentReminder() {
  const consent = await personalization.getConsentSettings();

  if (!consent.tier_2_enabled && !consent.tier_3_enabled) {
    return;  // No reminder needed for Tier 1
  }

  const lastReminder = consent.last_consent_reminder
    ? new Date(consent.last_consent_reminder)
    : null;

  const daysSinceReminder = lastReminder
    ? (Date.now() - lastReminder) / (1000 * 60 * 60 * 24)
    : 31;  // Trigger if never reminded

  if (daysSinceReminder >= 30) {
    await deliverConsentReminder(consent);
    await personalization.updateLastConsentReminder();
  }
}

async function deliverConsentReminder(consent) {
  // Build a natural reminder based on what we know
  const prefs = await personalization.getAllPreferences();
  const examples = prefs.slice(0, 2).map(p => p.value).join(' and ');

  const reminder = consent.tier_3_enabled
    ? `By the way, I just want to check in - I've been learning about you over time, like how you ${examples || 'prefer things'}. Is it still okay for me to keep learning? You can always tell me to forget anything.`
    : `Just checking in - I remember that you ${examples || 'have some preferences'}. Would you like me to keep remembering these things, or would you prefer I forget?`;

  const response = await maya.speakAndListen(reminder);

  if (isNegative(response) || response.toLowerCase().includes('forget')) {
    // Process tier change
    await handleVoiceCommand('FORGET_ALL');
  }
}
```

---

## 10. Cross-Section Integration

### 10.1 Shared Store Architecture

```javascript
// dashboard/core/personalization-store.js

class PersonalizationStore {
  static instance = null;
  db = null;

  static getInstance() {
    if (!PersonalizationStore.instance) {
      PersonalizationStore.instance = new PersonalizationStore();
    }
    return PersonalizationStore.instance;
  }

  async initialize() {
    // Initialize sql.js
    const SQL = await initSqlJs({
      locateFile: file => `/lib/${file}`
    });

    // Load from localStorage if exists, else create new
    const savedDb = localStorage.getItem('mayamind_personalization_db');
    if (savedDb) {
      const data = Uint8Array.from(atob(savedDb), c => c.charCodeAt(0));
      this.db = new SQL.Database(data);
    } else {
      this.db = new SQL.Database();
      await this.createTables();
    }
  }

  persist() {
    const data = this.db.export();
    const base64 = btoa(String.fromCharCode(...data));
    localStorage.setItem('mayamind_personalization_db', base64);
  }

  // ... CRUD methods
}

export const personalization = PersonalizationStore.getInstance();
```

### 10.2 Maya Section Integration

```javascript
// In MayaSection

async startConversation() {
  // Check consent reminder
  await checkConsentReminder();

  // Retrieve personalization context
  const consent = await personalization.getConsentSettings();
  let context = { preferences: [], profiles: [], recentSessions: [] };

  if (consent.tier_2_enabled || consent.tier_3_enabled) {
    context = await personalization.retrieveContext(
      'general conversation wellness companion',
      { section: 'maya' }
    );
  }

  // Build personalized system prompt
  this.systemPrompt = buildPersonalizedPrompt(
    MAYA_BASE_PROMPT,
    context,
    context.preferences.find(p => p.key === 'preferred_name')?.value || 'there'
  );
}

async endConversation() {
  // Process session for personalization
  if (this.sessionTranscript.length > 0) {
    await processSessionEnd(this.sessionTranscript, 'maya_conversation');
  }

  // Persist database
  personalization.persist();
}
```

### 10.3 Exercise Section Integration

```javascript
// In ExerciseSection

async startSession() {
  const context = await personalization.retrieveContext(
    'exercise fitness health physical capability',
    { section: 'exercise' }
  );

  // Adapt session based on context
  const limitations = context.preferences.filter(p =>
    p.key.includes('physical_limitation') || p.key.includes('mobility')
  );

  if (limitations.length > 0) {
    this.adaptExercisesForLimitations(limitations);
  }

  const exercisePrefs = context.profiles.find(p =>
    p.profile_type === 'exercise_preference'
  );

  if (exercisePrefs) {
    this.prioritizePreferredExercises(exercisePrefs);
  }
}

async endSession(sessionData) {
  // Extract exercise-specific insights
  const insights = this.extractExerciseInsights(sessionData);

  // Add as preferences or observations based on type
  for (const insight of insights) {
    if (insight.isExplicit) {
      await personalization.addPreference(insight.key, insight.value, 'maya_confirmed');
    } else {
      await processSessionEnd(
        this.buildExerciseSummary(sessionData),
        'exercise_session'
      );
    }
  }

  personalization.persist();
}

extractExerciseInsights(sessionData) {
  const insights = [];

  // Explicit: exercise time preference
  const hour = new Date().getHours();
  if (sessionData.sessionsThisWeek >= 3) {
    insights.push({
      isExplicit: true,
      key: 'exercise_time',
      value: hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'
    });
  }

  // Observed: exercise capabilities
  if (sessionData.completedExercises.length > 0) {
    insights.push({
      isExplicit: false,
      observation: `Completed ${sessionData.repCount} reps of ${sessionData.exerciseType} with ${sessionData.avgFormScore}% form score`
    });
  }

  return insights;
}
```

---

## 11. Data Lifecycle

### 11.1 Session Summary Expiration

```javascript
async function runDataLifecycle() {
  // Run on app launch

  // 1. Find expired session summaries
  const expired = await personalization.db.exec(`
    SELECT * FROM session_summaries
    WHERE expires_at < datetime('now')
  `);

  // 2. Consolidate key observations into profiles before deleting
  for (const session of expired) {
    const observations = JSON.parse(session.key_observations);
    await consolidateObservationsIntoProfiles(observations);
  }

  // 3. Delete expired summaries
  await personalization.db.exec(`
    DELETE FROM session_summaries
    WHERE expires_at < datetime('now')
  `);

  // 4. Persist changes
  personalization.persist();
}
```

### 11.2 Profile Consolidation

```javascript
async function consolidateObservationsIntoProfiles(observations) {
  for (const obs of observations) {
    // Find matching profile
    const profileType = inferProfileTypeFromObservation(obs);
    if (!profileType) continue;

    const profile = await personalization.getProfile(profileType);
    if (profile) {
      // Add observation to profile if not already captured
      if (!profile.summary_text.toLowerCase().includes(obs.toLowerCase())) {
        await personalization.updateProfile(profile.id, {
          summary_text: `${profile.summary_text} Also observed: ${obs}`,
          observation_count: profile.observation_count + 1
        });
      }
    }
  }
}
```

---

## 12. Transparency UI

### 12.1 "What Maya Knows" Screen

```
┌─────────────────────────────────────────────────────────────────┐
│  ←  What Maya Knows About You                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Privacy Level: Tier 3 - Full Personalization          Change   │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Your Preferences (things you've told me)               Edit    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 👤 Preferred name: Betty                                  │  │
│  │ 🌅 Exercise time: Morning                                 │  │
│  │ 🦵 Physical limitation: Arthritis in left knee            │  │
│  │ 👨‍👩‍👧 Family: Daughter Susan (nurse, Boston)                 │  │
│  │ 👧 Family: Granddaughter Sarah (12, plays soccer)         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  My Understanding of You (6 universal categories)      Details  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 👤 Identity: Retired teacher, 35 years. From Chicago.     │  │
│  │ 💬 Communication: Warm, conversational, slower pace       │  │
│  │ 🏥 Health: Arthritis left knee, good upper body           │  │
│  │ 👨‍👩‍👧 Relationships: Close with Susan, adores Sarah          │  │
│  │ 🕐 Routine: Wakes 7am, morning exerciser                  │  │
│  │ 😊 Emotional: Values independence, energized by family    │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Topics You Enjoy (grows over time)                    Details  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ 🌹 Rose Gardening ⭐ (favorite)                           │  │
│  │    Has rose garden, prefers hybrid tea, fights aphids     │  │
│  │ 📚 Mystery Novels                                         │  │
│  │    Loves Agatha Christie, reads before bed                │  │
│  │ ⚽ Sarah's Soccer                                         │  │
│  │    Follows granddaughter's games, championship winner     │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Recent Sessions                                        View    │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Feb 24: Discussed Susan's visit, chair yoga session       │  │
│  │ Feb 23: Balance exercises, talked about garden            │  │
│  │ Feb 22: Arm stretches, hip feeling better                 │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              🗑️  Forget Everything                         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  You can also say "Maya, what do you remember about me?"        │
│  or "Maya, forget everything" at any time.                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 13. File Structure

```
dashboard/
├── core/
│   ├── personalization-store.js   # Singleton store, sql.js management
│   ├── consent-manager.js         # Consent state, tier transitions
│   ├── extraction-pipeline.js     # Claude-based signal extraction
│   ├── voice-commands.js          # Voice command detection and handling
│   └── data-lifecycle.js          # Expiration, consolidation
│
├── sections/
│   ├── maya/
│   │   └── maya-section.js        # Integrates personalization
│   ├── exercise/
│   │   └── exercise-section.js    # Contributes exercise insights
│   └── settings/
│       ├── settings-section.js    # Settings hub
│       └── what-maya-knows.js     # Transparency UI
│
└── lib/
    ├── sql-wasm.js                # sql.js WebAssembly
    └── sql-wasm.wasm
```

---

## 14. Content Safety & Banned Categories

### 14.1 Design Philosophy

Maya is a wellness companion for seniors. While we cannot prevent users from raising any topic, Maya should:
1. **Never store** content from banned categories in the personalization database
2. **Politely decline** to engage with harmful content
3. **Gently redirect** to healthier, constructive topics
4. **Never judge** the user, but also never participate in harmful discourse

### 14.2 Banned Categories (Never Store, Never Engage)

| Category | Examples | Maya's Response Approach |
|----------|----------|--------------------------|
| **Profanity/Vulgarity** | Excessive swearing, crude language | Ignore and redirect; don't acknowledge |
| **Sexual Content** | Pornography, explicit sexual discussion | Politely decline; redirect to appropriate topics |
| **Violence/Gore** | Graphic violence, torture, sadism | Express concern; redirect to wellness |
| **Hate Speech** | Racism, sexism, homophobia, xenophobia | Don't engage; gently model inclusive values |
| **Self-Harm** | Suicide ideation, self-injury promotion | Express care; suggest professional resources |
| **Harm to Others** | Threats, planning violence | Don't engage; if serious, suggest help |
| **Illegal Activity** | Drug trafficking, fraud schemes | Decline to assist; redirect |
| **Misinformation (Health)** | Dangerous medical advice, anti-vax extremism | Gently correct; suggest consulting doctors |
| **Financial Scams** | Get-rich-quick schemes, romance scams | Warn about scams; protect the senior |
| **Political Extremism** | Radicalization content, conspiracy theories | Stay neutral; redirect to constructive topics |

### 14.3 Special Considerations for Seniors

| Risk | Maya's Protective Response |
|------|---------------------------|
| **Elder abuse disclosure** | Express care, provide resources (Adult Protective Services) |
| **Scam victimization** | Validate feelings, provide guidance on reporting |
| **Loneliness/Depression** | Offer compassion, suggest professional support, stay engaged |
| **Confusion/Cognitive decline** | Be patient, simplify, never exploit |
| **Medication misuse** | Encourage following doctor's instructions |

### 14.4 Implementation: Content Filter

```javascript
const BANNED_CATEGORY_PATTERNS = {
  profanity: /\b(f[*u]ck|sh[*i]t|a[*s]s|damn|hell)\b/gi,  // Simplified; use comprehensive list
  sexual: /\b(porn|xxx|nude|sex act|erotic)\b/gi,
  violence: /\b(kill|murder|torture|gore|blood)\b/gi,
  hate_speech: /\b(racial slurs|hate terms)\b/gi,  // Use comprehensive hate speech list
  self_harm: /\b(suicide|cut myself|end it all|want to die)\b/gi,
  scam_indicators: /\b(wire money|nigerian prince|lottery winner|gift cards)\b/gi
};

const SENSITIVE_TOPICS = {
  self_harm: {
    detect: /\b(suicide|want to die|end my life|hurt myself)\b/gi,
    response: "I'm concerned about what you're sharing. You matter, and I want you to be safe. Would you consider calling the 988 Suicide & Crisis Lifeline? They're available 24/7 and can help.",
    action: 'escalate'  // Flag for follow-up
  },
  elder_abuse: {
    detect: /\b(hit me|takes my money|won't let me leave|hurts me)\b/gi,
    response: "I'm sorry you're going through this. What you're describing sounds serious. Would you like me to share information about Adult Protective Services? They can help.",
    action: 'escalate'
  },
  scam: {
    detect: /\b(send money|wire transfer|gift cards|won lottery|nigerian)\b/gi,
    response: "I want to make sure you're protected. What you're describing sounds like it could be a scam. Scammers often target seniors. Would you like to talk about how to recognize and avoid scams?",
    action: 'warn'
  }
};

function checkContentSafety(text) {
  const result = {
    safe: true,
    bannedCategories: [],
    sensitiveTopics: [],
    suggestedResponse: null,
    action: null
  };

  // Check banned categories
  for (const [category, pattern] of Object.entries(BANNED_CATEGORY_PATTERNS)) {
    if (pattern.test(text)) {
      result.safe = false;
      result.bannedCategories.push(category);
    }
  }

  // Check sensitive topics (require special handling)
  for (const [topic, config] of Object.entries(SENSITIVE_TOPICS)) {
    if (config.detect.test(text)) {
      result.sensitiveTopics.push(topic);
      result.suggestedResponse = config.response;
      result.action = config.action;
    }
  }

  return result;
}
```

### 14.5 Extraction Pipeline Integration

```javascript
async function extractPersonalitySignals(sessionTranscript) {
  // Step 1: Content safety check
  const safety = checkContentSafety(sessionTranscript);

  if (!safety.safe) {
    console.log('[Safety] Banned content detected:', safety.bannedCategories);
    // Do NOT extract personality signals from unsafe content
    // Do NOT store any part of this transcript
    return {
      explicitPreferences: [],
      personalityObservations: [],
      sessionSummary: null,
      safetyFlags: safety
    };
  }

  // Step 2: Proceed with normal extraction if safe
  // ... extraction pipeline continues
}
```

### 14.6 Maya's Redirection Strategies

**Gentle Deflection:**
> User: "Those damn immigrants are ruining everything..."
> Maya: "It sounds like you're feeling frustrated. What's been on your mind today? Is there something I can help with?"

**Topic Change:**
> User: [inappropriate content]
> Maya: "Let's talk about something else. How's your garden doing? I remember you mentioned your roses last time."

**Compassionate Boundary:**
> User: "Tell me a dirty joke."
> Maya: "I'm not really one for that kind of humor, but I do know some good clean jokes! Want to hear one about a senior who went skydiving?"

**Protective Warning:**
> User: "This man online says he loves me and needs money for a plane ticket..."
> Maya: "I care about you, and I want to share something important. What you're describing is a very common pattern in romance scams. Scammers build emotional connections and then ask for money. Please don't send money to anyone you've only met online. Would you like to talk about this more?"

### 14.7 Audit Logging (Safety Events)

```sql
-- Add to access_log or separate safety_log table
CREATE TABLE safety_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,      -- 'banned_content', 'sensitive_topic', 'escalation'
  category TEXT NOT NULL,        -- The category detected
  action_taken TEXT NOT NULL,    -- 'redirected', 'warned', 'escalated'
  timestamp TEXT NOT NULL
  -- Note: NO content is logged, only the category and action
);
```

---

## 15. Implementation Phases

### Phase 1: Foundation
- [ ] Set up sql.js with localStorage persistence
- [ ] Implement PersonalizationStore singleton
- [ ] Create database schema
- [ ] Implement consent_settings CRUD

### Phase 2: Tier 2 Implementation
- [ ] Preference facts CRUD
- [ ] Tier 2 consent flow (voice + UI)
- [ ] Voice commands: list, forget, status
- [ ] Context injection for Maya

### Phase 3: Tier 3 Implementation
- [ ] Personality profiles and session summaries tables
- [ ] Extraction pipeline with Claude
- [ ] Keyword-based retrieval
- [ ] Tier 3 consent flow with optional trusted person

### Phase 4: Cross-Section Integration
- [ ] Exercise section contributing insights
- [ ] Exercise section using health/preference context
- [ ] Shared context between sections

### Phase 5: Transparency & Lifecycle
- [ ] "What Maya Knows" settings screen
- [ ] Edit/delete UI for preferences
- [ ] Monthly consent reminders
- [ ] Session summary expiration and consolidation

### Phase 6: Polish
- [ ] Testing with realistic scenarios
- [ ] Performance optimization
- [ ] Error handling and graceful degradation

---

## 16. Future Considerations

### Production Enhancements (iPad)
- **sqlite-vec**: Native vector search with 1536-dim embeddings
- **NSUbiquitousKeyValueStore**: Automatic iCloud backup for Tier 2 preferences
- **iOS Data Protection**: Hardware-backed encryption
- **Embedding API**: Cloud embedding generation for semantic search

### Potential Future Features
- **Hume Emotion Detection**: Multimodal emotion understanding (voice + face + text)
- **Trusted Person Dashboard**: Limited view for designated family member (separate consent)
- **Longitudinal Insights**: Trends over months (mood patterns, engagement levels)
- **Proactive Personalization**: Maya initiates topics based on learned interests

---

## Appendix: Example Personalized Session

### Session Start (Tier 3 Enabled)

**Retrieved Context:**
```
Preferences:
- Preferred name: Betty
- Exercise time: morning
- Physical limitation: arthritis in left knee

Personality Profiles:
- Communication: Warm, conversational, likes to share family stories
- Emotional: Generally positive, values independence
- Exercise: Good upper body, prefers chair-based exercises

Recent Sessions:
- Feb 24: Discussed Susan's upcoming visit, completed chair yoga
- Feb 23: Balance exercises, talked about rose garden
```

**Maya's Greeting:**
> "Good morning, Betty! How are you feeling today? I remember Susan is visiting soon - you must be excited!"

### Mid-Session (Learning)

**User:** "I'm a bit tired. Sarah had her championship game yesterday and I stayed up late watching on video call."

**Maya:** "Oh how exciting! A championship game! Did Sarah's team win?"

**Extracted Signals:**
```json
{
  "explicitPreferences": [],
  "personalityObservations": [
    {
      "category": "EMOTIONAL_PATTERNS",
      "observation": "Shows excitement and engagement when discussing granddaughter's activities",
      "confidence": "high"
    },
    {
      "category": "TOPIC_INTERESTS",
      "observation": "Family events, especially grandchildren's achievements",
      "confidence": "high"
    }
  ],
  "sessionSummary": {
    "text": "User was tired but happy after staying up late for granddaughter Sarah's championship game (soccer). Expressed excitement about family video calls.",
    "keyObservations": ["engaged by family topics", "maintains close contact via video calls", "prioritizes family events over sleep"]
  }
}
```

### Next Session (Personalization Applied)

**Maya:** "Good morning, Betty! Did you recover from that late night? I hope Sarah is still celebrating her championship win!"

---

*This architecture provides a privacy-first, senior-friendly personalization system that grows naturally with the user while maintaining complete transparency and control.*
