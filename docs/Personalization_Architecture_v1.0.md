# MayaMind Personalization Architecture v1.0

## 1. Overview

MayaMind's personalization system enables Maya to build a deep understanding of each senior user over time, creating conversations and exercise coaching that feel genuinely personal. The system is designed with privacy as a foundational principle: personality data is stored locally on the user's iPad, encrypted, and never accessible to administrators, family members, or healthcare providers.

### Goals

1. **Meaningful Personalization** - Maya remembers names, preferences, health context, and conversation history
2. **Privacy by Design** - Local-only storage, user-controlled, opt-in
3. **Cross-Section Intelligence** - Both Maya Conversation and Exercise Coaching contribute to and benefit from personalization
4. **Transparency** - Users can view, edit, and delete what Maya knows about them
5. **Graceful Growth** - System learns progressively through onboarding and ongoing interaction

### Non-Goals (for POC)

- Cloud-based vector search
- Sharing personality data with family/professionals
- Advanced semantic embeddings (keyword + recency-based retrieval for now)

---

## 2. Privacy Model

### Data Classification

| Data Type | Storage | Accessible To | Cloud Sync |
|-----------|---------|---------------|------------|
| Personality Nuggets | Local encrypted SQLite | User only | Never (iCloud backup only) |
| Conversation Transcripts | Not stored | N/A | Never |
| Engagement Metrics | Local SQLite | User, opt-in to family/professionals | Opt-in Supabase |
| Exercise Scores | Local SQLite | User, opt-in to family/professionals | Opt-in Supabase |

### Privacy Guarantees

1. **Local-Only Storage**: Personality data never leaves the device except via iOS system backup
2. **Encryption at Rest**: SQLite database encrypted using iOS Data Protection (NSFileProtectionComplete)
3. **No Admin Access**: Even MayaMind administrators cannot access personality data
4. **No Professional Access**: Healthcare providers see engagement metrics only (if user opts in), never personality
5. **No Family Access**: Family members see summaries and trends only (if user opts in), never personality
6. **User Control**: Complete ability to view, edit, and delete any stored information

### Backup Strategy

- **Primary**: iOS iCloud Backup (user's iCloud subscription)
- **Mechanism**: App's SQLite files in the app container are automatically included in iOS backups
- **Recovery**: When restoring iPad from iCloud backup, personality data is restored automatically
- **No iCloud Warning**: Users who decline iCloud backup are warned that personality data cannot be recovered if device is lost

---

## 3. Data Model

### Nugget Schema

```javascript
{
  // Identity
  id: "uuid-v4",
  version: 1,

  // Classification
  category: "relationship",     // See categories below
  subcategory: "family",        // Optional refinement

  // Content
  subject: "Sarah",             // Who/what this nugget is about
  relation: "granddaughter",    // Relationship to user (if applicable)
  facts: [                      // Array of discrete facts
    "12 years old",
    "plays soccer",
    "goalie position",
    "lives in Boston with Susan"
  ],
  summary: "Granddaughter Sarah, 12, plays soccer (goalie) in Boston",

  // Emotional Context
  sentiment: "proud",           // User's emotional association
  importance: "high",           // high, medium, low

  // Metadata
  source: "conversation",       // conversation, onboarding, exercise, inferred
  confidence: 0.9,              // 0.0 - 1.0
  firstMentioned: "2026-01-15T10:30:00Z",
  lastMentioned: "2026-02-24T14:22:00Z",
  mentionCount: 8,

  // For retrieval (POC: keywords; future: embeddings)
  keywords: ["sarah", "granddaughter", "soccer", "boston", "susan"],

  // User edits
  userVerified: false,          // User explicitly confirmed this
  userEdited: false             // User modified this
}
```

### Categories

| Category | Subcategories | Example Nuggets | Target Count |
|----------|---------------|-----------------|--------------|
| **identity** | name, demographics, history | "Prefers to be called Betty", "Retired teacher, 35 years", "Born in Chicago" | 10-15 |
| **relationship** | family, friends, pets, caregivers | "Daughter Susan, nurse in Boston", "Cat named Whiskers, passed 2025" | 30-50 |
| **health** | conditions, medications, mobility, diet | "Hip replacement 2023", "Blood pressure medication 8am", "Lactose intolerant" | 10-20 |
| **preference** | likes, dislikes, communication | "Loves jazz, especially Ella", "Hates broccoli", "Appreciates directness" | 20-30 |
| **routine** | daily, weekly, seasonal | "Wakes at 7am", "Calls Susan on Sundays", "Bridge club Wednesdays" | 10-15 |
| **interest** | hobbies, topics, media | "Gardening (roses)", "Mystery novels", "WWII history" | 10-20 |
| **personality** | traits, values, style | "Values independence", "Dry sense of humor", "Worries about being a burden" | 5-10 |
| **memory** | conversations, events, milestones | "Trip to Italy 1985", "Grandson's wedding last June" | 20-40 |
| **exercise** | fitness, preferences, patterns | "Morning exerciser", "Prefers strength over cardio", "Nike brand preference" | 15-25 |

**Target Total: 150-250 nuggets for well-personalized experience**

---

## 4. Three-Tier Onboarding

### Tier 1: Registration Data (Immediate)

Pre-populated from account setup:

```javascript
// Automatically created nuggets from registration
[
  { category: "identity", subject: "name", facts: ["Elizabeth", "Betty (preferred)"] },
  { category: "identity", subject: "age", facts: ["78 years old"], source: "registration" },
  { category: "identity", subject: "gender", facts: ["Female"], source: "registration" },
  { category: "identity", subject: "location", facts: ["Phoenix, Arizona"], source: "registration" }
]
```

### Tier 2: Guided Onboarding ("Getting to Know You")

After opt-in consent, Maya initiates a warm, conversational onboarding:

```
Maya: "I'd love to learn a bit about you so our conversations can be more personal.
       Would you like to tell me about your family? No pressure - we can skip
       anything you'd rather not share."

[User responds naturally - Maya extracts nuggets]

Maya: "Susan sounds wonderful! A nurse in Boston - you must be so proud.
       Does she have any children?"

[Continues for 5-10 minutes, covering:]
- Family members (names, relationships, where they live)
- Interests and hobbies
- Daily routine preferences
- Health considerations (gently)
- What they hope to get from MayaMind
```

**Onboarding Topics Checklist:**
- [ ] Immediate family (spouse, children)
- [ ] Extended family (grandchildren, siblings)
- [ ] Close friends
- [ ] Pets (current and remembered)
- [ ] Career/professional background
- [ ] Hobbies and interests
- [ ] Daily routine (wake time, meals, activities)
- [ ] Health considerations (mobility, conditions)
- [ ] Communication preferences
- [ ] Goals for using MayaMind

### Tier 3: Ongoing Organic Learning

Every conversation and exercise session can yield new nuggets:

```javascript
// Example: User mentions something new in conversation
User: "I'm a bit tired today. Sarah had her championship game yesterday
       and we video-called for two hours celebrating!"

// Extracted/updated nuggets:
[
  {
    category: "memory",
    subject: "Sarah's championship",
    facts: ["Soccer championship", "They won", "Video call celebration"],
    sentiment: "joyful",
    source: "conversation"
  },
  {
    // Update existing Sarah nugget
    id: "existing-sarah-nugget-id",
    facts: [...existingFacts, "championship-winning team"],
    lastMentioned: "2026-02-24T...",
    mentionCount: 9
  }
]
```

---

## 5. Storage Architecture

### SQLite Schema

```sql
-- Core nuggets table
CREATE TABLE nuggets (
  id TEXT PRIMARY KEY,
  version INTEGER DEFAULT 1,
  category TEXT NOT NULL,
  subcategory TEXT,
  subject TEXT NOT NULL,
  relation TEXT,
  facts TEXT NOT NULL,           -- JSON array
  summary TEXT,
  sentiment TEXT,
  importance TEXT DEFAULT 'medium',
  source TEXT NOT NULL,
  confidence REAL DEFAULT 0.8,
  first_mentioned TEXT NOT NULL,  -- ISO timestamp
  last_mentioned TEXT NOT NULL,
  mention_count INTEGER DEFAULT 1,
  keywords TEXT NOT NULL,         -- JSON array
  user_verified INTEGER DEFAULT 0,
  user_edited INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Indexes for retrieval
CREATE INDEX idx_nuggets_category ON nuggets(category);
CREATE INDEX idx_nuggets_subject ON nuggets(subject);
CREATE INDEX idx_nuggets_last_mentioned ON nuggets(last_mentioned DESC);
CREATE INDEX idx_nuggets_importance ON nuggets(importance);

-- Full-text search for keyword matching
CREATE VIRTUAL TABLE nuggets_fts USING fts5(
  subject,
  summary,
  keywords,
  content='nuggets',
  content_rowid='rowid'
);

-- Consent and settings
CREATE TABLE personalization_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Audit log (for transparency)
CREATE TABLE nugget_access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nugget_id TEXT,
  action TEXT,              -- 'retrieved', 'created', 'updated', 'deleted'
  context TEXT,             -- 'maya_conversation', 'exercise_session', 'user_review'
  timestamp TEXT NOT NULL
);
```

### Encryption

Using iOS Data Protection:
- Database file created with `NSFileProtectionComplete`
- Automatically encrypted when device is locked
- Decrypted only when device is unlocked and authenticated

```javascript
// For web-based POC, use Web Crypto API
const ENCRYPTION_KEY = await deriveKeyFromUserAuth(userPIN);

async function encryptNugget(nugget) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    ENCRYPTION_KEY,
    new TextEncoder().encode(JSON.stringify(nugget))
  );
  return { iv: Array.from(iv), data: Array.from(new Uint8Array(encrypted)) };
}
```

---

## 6. Insight Extraction Pipeline

### Real-Time Extraction (During Conversation)

Piggyback on Claude response generation:

```javascript
const EXTRACTION_SYSTEM_PROMPT = `
${MAYA_BASE_PROMPT}

IMPORTANT: After your response, include an insights block if you learned anything new
about the user. Format:

<!--INSIGHTS:
{
  "new": [
    {
      "category": "relationship",
      "subject": "Sarah",
      "relation": "granddaughter",
      "facts": ["plays soccer", "goalie"],
      "sentiment": "proud",
      "confidence": 0.9
    }
  ],
  "updates": [
    {
      "subject": "Susan",
      "addFacts": ["visiting next month"],
      "newSentiment": "excited"
    }
  ]
}
-->

Only include the insights block if there's something new. Keep your response natural.
`;
```

### Extraction Processing

```javascript
async function processClaudeResponse(response) {
  // Extract insights block
  const insightsMatch = response.match(/<!--INSIGHTS:\n([\s\S]*?)\n-->/);

  if (insightsMatch) {
    const insights = JSON.parse(insightsMatch[1]);

    // Process new nuggets
    for (const nugget of insights.new || []) {
      await personalizationStore.createNugget({
        ...nugget,
        source: 'conversation',
        keywords: extractKeywords(nugget)
      });
    }

    // Process updates
    for (const update of insights.updates || []) {
      await personalizationStore.updateNugget(update.subject, update);
    }
  }

  // Return clean response (without insights block)
  return response.replace(/<!--INSIGHTS:[\s\S]*?-->\n?/, '').trim();
}
```

### Exercise Session Extraction

After each exercise session:

```javascript
async function extractExerciseInsights(sessionData) {
  const insights = [];

  // Fitness level assessment
  if (sessionData.completedExercises.length > 0) {
    insights.push({
      category: 'exercise',
      subject: 'fitness_assessment',
      facts: [
        `Completed ${sessionData.repCount} reps`,
        `Form score: ${sessionData.avgFormScore}%`,
        `Exercise: ${sessionData.exerciseType}`
      ],
      source: 'exercise'
    });
  }

  // Preference detection
  if (sessionData.skippedExercises.length > 0) {
    insights.push({
      category: 'exercise',
      subject: 'exercise_preferences',
      facts: [`Skipped: ${sessionData.skippedExercises.join(', ')}`],
      sentiment: 'dislikes',
      source: 'exercise'
    });
  }

  // Time preference
  const hour = new Date().getHours();
  insights.push({
    category: 'exercise',
    subject: 'exercise_timing',
    facts: [hour < 12 ? 'Morning exerciser' : 'Afternoon/evening exerciser'],
    source: 'exercise'
  });

  return insights;
}
```

---

## 7. RAG Retrieval System

### Query Flow

```
User speaks → Extract query intent → Retrieve relevant nuggets →
Inject into Claude prompt → Generate personalized response
```

### Retrieval Strategy (POC)

For POC, use hybrid keyword + recency scoring (no embeddings):

```javascript
class PersonalizationStore {
  async retrieveRelevant(query, options = {}) {
    const { limit = 5, categories = null } = options;

    // 1. Keyword matching using FTS
    const keywords = this.extractKeywords(query);
    const keywordMatches = await this.db.query(`
      SELECT n.*,
             bm25(nuggets_fts) as keyword_score
      FROM nuggets_fts
      JOIN nuggets n ON nuggets_fts.rowid = n.rowid
      WHERE nuggets_fts MATCH ?
      ${categories ? `AND n.category IN (${categories.map(c => `'${c}'`).join(',')})` : ''}
    `, [keywords.join(' OR ')]);

    // 2. Recency boost
    const now = Date.now();
    const scoredNuggets = keywordMatches.map(nugget => ({
      ...nugget,
      score: this.calculateScore(nugget, now)
    }));

    // 3. Sort and limit
    return scoredNuggets
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  calculateScore(nugget, now) {
    const keywordScore = nugget.keyword_score || 0;

    // Recency: decay over 30 days
    const daysSinceLastMention = (now - new Date(nugget.last_mentioned)) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.exp(-daysSinceLastMention / 30);

    // Importance multiplier
    const importanceMultiplier = { high: 1.5, medium: 1.0, low: 0.7 }[nugget.importance];

    // Mention frequency boost
    const frequencyBoost = Math.min(nugget.mention_count / 10, 1);

    return (keywordScore * 0.4 + recencyScore * 0.3 + frequencyBoost * 0.3) * importanceMultiplier;
  }
}
```

### Context Injection

```javascript
function buildPersonalizedPrompt(basePrompt, relevantNuggets, userName) {
  if (relevantNuggets.length === 0) {
    return basePrompt;
  }

  const contextBlock = `
What you know about ${userName}:
${relevantNuggets.map(n => `- ${n.summary}`).join('\n')}

Use this context naturally in your response when relevant. Don't force references
if they don't fit the conversation.
`;

  return basePrompt + '\n\n' + contextBlock;
}
```

---

## 8. Cross-Section Integration

### Shared Personalization Store

```javascript
// dashboard/core/personalization-store.js

class PersonalizationStore {
  static instance = null;

  static getInstance() {
    if (!PersonalizationStore.instance) {
      PersonalizationStore.instance = new PersonalizationStore();
    }
    return PersonalizationStore.instance;
  }

  // Used by both Maya and Exercise sections
  async getContext(query, section) {
    const categories = section === 'exercise'
      ? ['exercise', 'health', 'preference', 'routine']
      : null; // All categories for Maya

    return this.retrieveRelevant(query, { categories });
  }

  // Section-specific extraction
  async addInsight(nugget, section) {
    nugget.source = section; // 'maya_conversation' or 'exercise_session'
    return this.createNugget(nugget);
  }
}

export const personalization = PersonalizationStore.getInstance();
```

### Exercise Section Usage

```javascript
// In ExerciseSection
async startSession() {
  // Retrieve exercise-relevant context
  const context = await personalization.getContext(
    'exercise fitness health preferences',
    'exercise'
  );

  // Adapt session based on context
  if (context.some(n => n.facts.includes('hip replacement'))) {
    this.excludeExercises(['lunges', 'deep squats']);
    this.voiceWorkflow.speak(
      "I remember your hip - we'll focus on exercises that are gentle on it today."
    );
  }

  if (context.some(n => n.facts.includes('Morning exerciser'))) {
    // Adjust energy level of coaching
    this.coachingStyle = 'energetic';
  }
}

async endSession(sessionData) {
  // Extract and store exercise insights
  const insights = await extractExerciseInsights(sessionData);
  for (const insight of insights) {
    await personalization.addInsight(insight, 'exercise_session');
  }
}
```

### Maya Using Exercise Data

```javascript
// Maya can reference exercise history
const exerciseContext = await personalization.retrieveRelevant(
  'exercise fitness recent',
  { categories: ['exercise'] }
);

// In conversation:
// "I see you did 15 chair squats yesterday - that's 5 more than last week!
//  How are you feeling today?"
```

---

## 9. Consent and Transparency UI

### Opt-In Flow

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│                    [Maya Avatar Image]                      │
│                                                             │
│           Help Maya Get to Know You                         │
│                                                             │
│   Maya can remember things about you to make our            │
│   conversations more personal and helpful.                  │
│                                                             │
│   What Maya will remember:                                  │
│   • Names of family and friends you mention                 │
│   • Your preferences and interests                          │
│   • Topics we've talked about                               │
│   • Your exercise progress and preferences                  │
│                                                             │
│   Your privacy is protected:                                │
│   ✓ Stored only on YOUR iPad                                │
│   ✓ Protected by your device passcode                       │
│   ✓ Nobody else can see it - not family, not doctors        │
│   ✓ You can view or delete anytime                          │
│                                                             │
│   ┌─────────────────────────────────────────────────────┐   │
│   │            Yes, Help Maya Know Me                   │   │
│   └─────────────────────────────────────────────────────┘   │
│                                                             │
│                    Maybe Later                              │
│                                                             │
│   You can change this anytime in Settings                   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### "What Maya Knows" Screen

```
┌─────────────────────────────────────────────────────────────┐
│  ←  What Maya Knows About You                               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Family & Friends                                    Edit   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 👨‍👩‍👧 Susan - Daughter                                   │   │
│  │    Nurse in Boston, visits monthly                  │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ ⚽ Sarah - Granddaughter                              │   │
│  │    12 years old, plays soccer (goalie)              │   │
│  ├─────────────────────────────────────────────────────┤   │
│  │ 💑 Robert - Husband                                   │   │
│  │    Married 52 years, enjoys golf                    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Health & Wellness                                   Edit   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🏥 Hip replacement (2023)                            │   │
│  │ 💊 Blood pressure medication - morning               │   │
│  │ 🚶 Uses walker for outdoor walks                     │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Exercise Preferences                                Edit   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 🌅 Morning exerciser                                 │   │
│  │ 💪 Prefers strength exercises                        │   │
│  │ ✓ Chair squats - comfortable                        │   │
│  │ ✗ Lunges - avoids (hip)                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │          Delete All Maya Knows                      │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Edit Nugget Modal

```
┌─────────────────────────────────────────────────────────────┐
│  Edit: Sarah                                            X   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Relationship:  [ Granddaughter      ▼ ]                    │
│                                                             │
│  What Maya knows:                                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 12 years old                                    [x] │   │
│  │ plays soccer                                    [x] │   │
│  │ goalie position                                 [x] │   │
│  │ lives in Boston with Susan                      [x] │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  Add detail: [                                      ] [+]   │
│                                                             │
│  ┌──────────────┐              ┌──────────────────────┐    │
│  │    Save      │              │   Delete This Entry  │    │
│  └──────────────┘              └──────────────────────┘    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 10. File Structure

```
dashboard/
├── core/
│   ├── personalization-store.js    # Singleton store, CRUD, retrieval
│   ├── insight-extractor.js        # Claude-based extraction
│   ├── encryption.js               # Web Crypto API helpers
│   └── consent-manager.js          # Opt-in state management
│
├── sections/
│   ├── maya/
│   │   └── maya-section.js         # Uses personalization for context
│   ├── exercise/
│   │   └── exercise-section.js     # Contributes exercise insights
│   └── settings/
│       ├── settings-section.js     # Settings hub
│       └── what-maya-knows.js      # Transparency UI
│
└── ui/
    └── consent-modal.js            # Opt-in consent flow
```

---

## 11. Implementation Phases

### Phase 1: Foundation (POC)
- [ ] PersonalizationStore class with SQLite storage
- [ ] Basic encryption using Web Crypto API
- [ ] Consent opt-in modal
- [ ] Tier 1 onboarding (registration data)

### Phase 2: Extraction
- [ ] Claude-based insight extraction in Maya conversations
- [ ] Exercise session insight extraction
- [ ] Keyword-based retrieval

### Phase 3: Transparency
- [ ] "What Maya Knows" settings screen
- [ ] Edit/delete nugget functionality
- [ ] Audit log display

### Phase 4: Guided Onboarding
- [ ] Tier 2 "Getting to Know You" conversation flow
- [ ] Onboarding progress tracking
- [ ] Skip/defer functionality

### Phase 5: Enhancement
- [ ] Recency + importance scoring refinement
- [ ] Cross-section context sharing
- [ ] Nugget consolidation (merge duplicates)

### Future: Vector Search
- [ ] On-device embedding generation (Transformers.js)
- [ ] Semantic similarity search
- [ ] Embedding-based retrieval

---

## 12. Technical Considerations

### Memory Budget

| Component | Size |
|-----------|------|
| SQLite database (300 nuggets) | ~200KB |
| In-memory nugget cache | ~100KB |
| FTS index | ~50KB |
| **Total** | **<500KB** |

Comfortably coexists with TalkingHead (~120MB) and MediaPipe (~150MB).

### Performance Targets

| Operation | Target | Notes |
|-----------|--------|-------|
| Nugget retrieval (5 results) | <50ms | Keyword + FTS |
| Insight extraction | 0ms additional | Piggybacked on Claude call |
| Full database load | <100ms | On app startup |
| Nugget write | <10ms | Single INSERT |

### Browser Compatibility

- **SQLite**: Use sql.js (WebAssembly SQLite) for browser
- **Encryption**: Web Crypto API (Safari 11+, all modern browsers)
- **Storage**: IndexedDB for persistence (sql.js database file)

---

## 13. Security Considerations

### Threat Model

| Threat | Mitigation |
|--------|------------|
| Device theft | iOS encryption + passcode required |
| Cloud interception | Data never transmitted (except iCloud backup) |
| Admin access | No admin interface to personality data |
| Family snooping | Separate from shared engagement metrics |
| Malicious app update | Code signing + App Store review |

### Data Minimization

- Store summaries, not raw transcripts
- Prune low-confidence nuggets after 90 days without mention
- Cap total nuggets at 500 (consolidate or prune oldest)

---

## Appendix: Example Personalized Interaction

### Without Personalization
```
Maya: "Good morning! How are you today?"
User: "I'm tired, but happy."
Maya: "I'm glad to hear you're happy! What's making you feel that way?"
```

### With Personalization (5 nuggets retrieved)
```
[Retrieved nuggets:
 - Sarah: granddaughter, 12, plays soccer
 - Susan: daughter, nurse, Boston
 - User: prefers morning exercise
 - Recent: Sarah's championship game mentioned yesterday
 - Health: hip bothering user recently]

Maya: "Good morning, Betty! How are you feeling today? Is your hip doing
       any better?"
User: "I'm tired, but happy. Sarah's team won the championship!"
Maya: "Oh wonderful! I remember you mentioning her big game was coming up.
       A championship win - Susan must be over the moon! Did you get to
       watch it?"
```

The difference is palpable: Maya feels like she *knows* Betty, not like she's meeting her for the first time every conversation.
