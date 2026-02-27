/**
 * MayaMind Personalization Store
 *
 * Singleton store managing the local SQLite database for personalization data.
 * Uses sql.js (WebAssembly SQLite) with localStorage persistence.
 *
 * Data is stored locally and never transmitted to cloud services.
 * Three-tier consent model: Tier 1 (session-only), Tier 2 (preferences), Tier 3 (full personalization)
 */

const STORAGE_KEY = 'mayamind_personalization_db';
const DB_VERSION = 1;

class PersonalizationStore {
  static instance = null;
  db = null;
  SQL = null;
  initialized = false;

  /**
   * Get singleton instance
   */
  static getInstance() {
    if (!PersonalizationStore.instance) {
      PersonalizationStore.instance = new PersonalizationStore();
    }
    return PersonalizationStore.instance;
  }

  /**
   * Initialize the database
   * Must be called before using any other methods
   */
  async initialize() {
    if (this.initialized) {
      console.log('[PersonalizationStore] Already initialized');
      return;
    }

    try {
      // Load sql.js
      this.SQL = await initSqlJs({
        locateFile: file => `/dashboard/lib/${file}`
      });

      // Try to load existing database from localStorage
      const savedDb = localStorage.getItem(STORAGE_KEY);

      if (savedDb) {
        try {
          const data = Uint8Array.from(atob(savedDb), c => c.charCodeAt(0));
          this.db = new this.SQL.Database(data);
          console.log('[PersonalizationStore] Loaded existing database from localStorage');

          // Check if we need to migrate
          await this.migrateIfNeeded();
        } catch (e) {
          console.warn('[PersonalizationStore] Failed to load saved database, creating new one:', e);
          this.db = new this.SQL.Database();
          await this.createTables();
        }
      } else {
        // Create new database
        this.db = new this.SQL.Database();
        await this.createTables();
        console.log('[PersonalizationStore] Created new database');
      }

      this.initialized = true;
      console.log('[PersonalizationStore] Initialization complete');
    } catch (error) {
      console.error('[PersonalizationStore] Initialization failed:', error);
      throw error;
    }
  }

  /**
   * Create database tables
   */
  async createTables() {
    const schema = `
      -- Database version tracking
      CREATE TABLE IF NOT EXISTS db_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      -- Tier 2: Explicit preference facts
      CREATE TABLE IF NOT EXISTS preference_facts (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user_declared',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        consent_tier INTEGER NOT NULL DEFAULT 2
      );

      CREATE INDEX IF NOT EXISTS idx_pref_key ON preference_facts(key);

      -- Tier 3: Universal personality profiles (6 categories)
      CREATE TABLE IF NOT EXISTS personality_profiles (
        id TEXT PRIMARY KEY,
        profile_type TEXT NOT NULL UNIQUE,
        summary_text TEXT NOT NULL,
        keywords TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        observation_count INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        consent_tier INTEGER NOT NULL DEFAULT 3
      );

      CREATE INDEX IF NOT EXISTS idx_profile_type ON personality_profiles(profile_type);

      -- Tier 3: Emergent topics (flexible, grows over time)
      CREATE TABLE IF NOT EXISTS topics (
        id TEXT PRIMARY KEY,
        topic_tag TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        keywords TEXT NOT NULL,
        engagement_level TEXT NOT NULL DEFAULT 'medium',
        confidence REAL NOT NULL DEFAULT 0.5,
        observation_count INTEGER NOT NULL DEFAULT 1,
        first_mentioned TEXT NOT NULL,
        last_mentioned TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        consent_tier INTEGER NOT NULL DEFAULT 3
      );

      CREATE INDEX IF NOT EXISTS idx_topic_tag ON topics(topic_tag);
      CREATE INDEX IF NOT EXISTS idx_topic_engagement ON topics(engagement_level);
      CREATE INDEX IF NOT EXISTS idx_topic_last_mentioned ON topics(last_mentioned DESC);

      -- Tier 3: Session summaries
      CREATE TABLE IF NOT EXISTS session_summaries (
        id TEXT PRIMARY KEY,
        session_date TEXT NOT NULL,
        summary_text TEXT NOT NULL,
        key_observations TEXT NOT NULL,
        keywords TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        consent_tier INTEGER NOT NULL DEFAULT 3
      );

      CREATE INDEX IF NOT EXISTS idx_session_date ON session_summaries(session_date DESC);
      CREATE INDEX IF NOT EXISTS idx_session_expires ON session_summaries(expires_at);

      -- Consent settings
      CREATE TABLE IF NOT EXISTS consent_settings (
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
      CREATE TABLE IF NOT EXISTS access_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        table_name TEXT NOT NULL,
        record_count INTEGER,
        context TEXT,
        timestamp TEXT NOT NULL
      );

      -- Safety log (for tracking safety events without content)
      CREATE TABLE IF NOT EXISTS safety_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_type TEXT NOT NULL,
        category TEXT NOT NULL,
        action_taken TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );
    `;

    this.db.run(schema);

    // Set database version
    this.db.run(`INSERT OR REPLACE INTO db_meta (key, value) VALUES ('version', '${DB_VERSION}')`);

    // Initialize consent settings if not exists
    const existing = this.db.exec("SELECT * FROM consent_settings WHERE id = 'user_consent'");
    if (existing.length === 0 || existing[0].values.length === 0) {
      const now = new Date().toISOString();
      this.db.run(`
        INSERT INTO consent_settings (id, tier_1_enabled, tier_2_enabled, tier_3_enabled, updated_at)
        VALUES ('user_consent', 1, 0, 0, '${now}')
      `);
    }

    this.persist();
  }

  /**
   * Migrate database if needed
   */
  async migrateIfNeeded() {
    const result = this.db.exec("SELECT value FROM db_meta WHERE key = 'version'");
    const currentVersion = result.length > 0 && result[0].values.length > 0
      ? parseInt(result[0].values[0][0])
      : 0;

    if (currentVersion < DB_VERSION) {
      console.log(`[PersonalizationStore] Migrating from v${currentVersion} to v${DB_VERSION}`);
      // Add migration logic here as needed
      await this.createTables(); // Ensures all tables exist
    }
  }

  /**
   * Persist database to localStorage
   */
  persist() {
    if (!this.db) return;

    try {
      const data = this.db.export();
      const base64 = btoa(String.fromCharCode(...data));
      localStorage.setItem(STORAGE_KEY, base64);
      console.log('[PersonalizationStore] Database persisted to localStorage');
    } catch (error) {
      console.error('[PersonalizationStore] Failed to persist database:', error);
    }
  }

  /**
   * Generate a UUID v4
   */
  generateId() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Get current timestamp in ISO format
   */
  now() {
    return new Date().toISOString();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSENT SETTINGS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get current consent settings
   */
  getConsentSettings() {
    const result = this.db.exec("SELECT * FROM consent_settings WHERE id = 'user_consent'");

    if (result.length === 0 || result[0].values.length === 0) {
      return {
        tier_1_enabled: true,
        tier_2_enabled: false,
        tier_2_opted_in_at: null,
        tier_3_enabled: false,
        tier_3_opted_in_at: null,
        tier_3_trusted_person_confirmed: false,
        last_consent_reminder: null
      };
    }

    const columns = result[0].columns;
    const values = result[0].values[0];
    const settings = {};

    columns.forEach((col, i) => {
      if (col === 'tier_1_enabled' || col === 'tier_2_enabled' || col === 'tier_3_enabled' || col === 'tier_3_trusted_person_confirmed') {
        settings[col] = values[i] === 1;
      } else {
        settings[col] = values[i];
      }
    });

    return settings;
  }

  /**
   * Enable Tier 2 (preference memory)
   */
  enableTier2() {
    const now = this.now();
    this.db.run(`
      UPDATE consent_settings
      SET tier_2_enabled = 1, tier_2_opted_in_at = '${now}', updated_at = '${now}'
      WHERE id = 'user_consent'
    `);
    this.logAccess('updated', 'consent_settings', 1, 'tier_2_enable');
    this.persist();
    console.log('[PersonalizationStore] Tier 2 enabled');
  }

  /**
   * Enable Tier 3 (full personalization)
   */
  enableTier3(trustedPersonConfirmed = false) {
    const now = this.now();
    this.db.run(`
      UPDATE consent_settings
      SET tier_3_enabled = 1,
          tier_3_opted_in_at = '${now}',
          tier_3_trusted_person_confirmed = ${trustedPersonConfirmed ? 1 : 0},
          updated_at = '${now}'
      WHERE id = 'user_consent'
    `);
    this.logAccess('updated', 'consent_settings', 1, 'tier_3_enable');
    this.persist();
    console.log('[PersonalizationStore] Tier 3 enabled');
  }

  /**
   * Revoke Tier 3 (delete Tier 3 data, keep Tier 2)
   */
  async revokeTier3() {
    const now = this.now();

    // Delete all Tier 3 data
    this.db.run("DELETE FROM personality_profiles");
    this.db.run("DELETE FROM topics");
    this.db.run("DELETE FROM session_summaries");

    // Update consent settings
    this.db.run(`
      UPDATE consent_settings
      SET tier_3_enabled = 0,
          tier_3_opted_in_at = NULL,
          tier_3_trusted_person_confirmed = 0,
          updated_at = '${now}'
      WHERE id = 'user_consent'
    `);

    this.logAccess('deleted', 'tier_3_data', null, 'tier_3_revoke');
    this.persist();
    console.log('[PersonalizationStore] Tier 3 revoked, data deleted');
  }

  /**
   * Reset to Tier 1 (delete all personalization data)
   */
  async resetToTier1() {
    const now = this.now();

    // Delete all personalization data
    this.db.run("DELETE FROM preference_facts");
    this.db.run("DELETE FROM personality_profiles");
    this.db.run("DELETE FROM topics");
    this.db.run("DELETE FROM session_summaries");

    // Reset consent settings
    this.db.run(`
      UPDATE consent_settings
      SET tier_2_enabled = 0,
          tier_2_opted_in_at = NULL,
          tier_3_enabled = 0,
          tier_3_opted_in_at = NULL,
          tier_3_trusted_person_confirmed = 0,
          updated_at = '${now}'
      WHERE id = 'user_consent'
    `);

    this.logAccess('deleted', 'all_data', null, 'reset_to_tier_1');
    this.persist();
    console.log('[PersonalizationStore] Reset to Tier 1, all data deleted');
  }

  /**
   * Update last consent reminder timestamp
   */
  updateLastConsentReminder() {
    const now = this.now();
    this.db.run(`
      UPDATE consent_settings
      SET last_consent_reminder = '${now}', updated_at = '${now}'
      WHERE id = 'user_consent'
    `);
    this.persist();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PREFERENCE FACTS (Tier 2)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Add a preference fact
   */
  addPreference(key, value, source = 'user_declared') {
    const consent = this.getConsentSettings();
    if (!consent.tier_2_enabled) {
      console.warn('[PersonalizationStore] Cannot add preference: Tier 2 not enabled');
      return null;
    }

    const id = this.generateId();
    const now = this.now();

    // Check if key already exists, update if so
    const existing = this.db.exec(`SELECT id FROM preference_facts WHERE key = '${key}'`);

    if (existing.length > 0 && existing[0].values.length > 0) {
      const existingId = existing[0].values[0][0];
      this.db.run(`
        UPDATE preference_facts
        SET value = ?, source = ?, updated_at = ?
        WHERE id = ?
      `, [value, source, now, existingId]);
      this.logAccess('updated', 'preference_facts', 1, 'add_preference');
      this.persist();
      return existingId;
    }

    this.db.run(`
      INSERT INTO preference_facts (id, key, value, source, created_at, updated_at, consent_tier)
      VALUES (?, ?, ?, ?, ?, ?, 2)
    `, [id, key, value, source, now, now]);

    this.logAccess('created', 'preference_facts', 1, 'add_preference');
    this.persist();
    console.log(`[PersonalizationStore] Added preference: ${key} = "${value}" (source: ${source})`);
    return id;
  }

  /**
   * Get all preferences
   */
  getAllPreferences() {
    const result = this.db.exec("SELECT * FROM preference_facts ORDER BY updated_at DESC");
    return this.resultToObjects(result);
  }

  /**
   * Get preference by key
   */
  getPreference(key) {
    const result = this.db.exec(`SELECT * FROM preference_facts WHERE key = '${key}'`);
    const objects = this.resultToObjects(result);
    return objects.length > 0 ? objects[0] : null;
  }

  /**
   * Get the most recently added preference
   */
  getLastAddedPreference() {
    const result = this.db.exec("SELECT * FROM preference_facts ORDER BY created_at DESC LIMIT 1");
    const objects = this.resultToObjects(result);
    return objects.length > 0 ? objects[0] : null;
  }

  /**
   * Delete a preference by ID
   */
  deletePreference(id) {
    this.db.run(`DELETE FROM preference_facts WHERE id = '${id}'`);
    this.logAccess('deleted', 'preference_facts', 1, 'delete_preference');
    this.persist();
  }

  /**
   * Delete a preference by key
   */
  deletePreferenceByKey(key) {
    this.db.run(`DELETE FROM preference_facts WHERE key = '${key}'`);
    this.logAccess('deleted', 'preference_facts', 1, 'delete_preference');
    this.persist();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSONALITY PROFILES (Tier 3 - Universal Categories)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all personality profiles
   */
  getAllProfiles() {
    const result = this.db.exec("SELECT * FROM personality_profiles ORDER BY profile_type");
    return this.resultToObjects(result);
  }

  /**
   * Get profile by type
   */
  getProfile(profileType) {
    const result = this.db.exec(`SELECT * FROM personality_profiles WHERE profile_type = '${profileType}'`);
    const objects = this.resultToObjects(result);
    return objects.length > 0 ? objects[0] : null;
  }

  /**
   * Create or update a personality profile
   */
  upsertProfile(profileType, summaryText, keywords, confidence = 0.5) {
    const consent = this.getConsentSettings();
    if (!consent.tier_3_enabled) {
      console.warn('[PersonalizationStore] Cannot upsert profile: Tier 3 not enabled');
      return null;
    }

    const now = this.now();
    const keywordsJson = JSON.stringify(keywords);
    const existing = this.getProfile(profileType);

    if (existing) {
      // Update existing profile
      const newCount = existing.observation_count + 1;
      this.db.run(`
        UPDATE personality_profiles
        SET summary_text = ?, keywords = ?, confidence = ?, observation_count = ?, updated_at = ?
        WHERE profile_type = ?
      `, [summaryText, keywordsJson, confidence, newCount, now, profileType]);

      this.logAccess('updated', 'personality_profiles', 1, 'upsert_profile');
      this.persist();
      console.log(`[PersonalizationStore] Updated profile: ${profileType}, confidence: ${confidence.toFixed(2)}`);
      return existing.id;
    } else {
      // Create new profile
      const id = this.generateId();
      this.db.run(`
        INSERT INTO personality_profiles (id, profile_type, summary_text, keywords, confidence, observation_count, created_at, updated_at, consent_tier)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?, 3)
      `, [id, profileType, summaryText, keywordsJson, confidence, now, now]);

      this.logAccess('created', 'personality_profiles', 1, 'upsert_profile');
      this.persist();
      console.log(`[PersonalizationStore] Created profile: ${profileType} - "${summaryText.substring(0, 50)}..."`);
      return id;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TOPICS (Tier 3 - Emergent Category)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Get all topics
   */
  getAllTopics() {
    const result = this.db.exec("SELECT * FROM topics ORDER BY last_mentioned DESC");
    return this.resultToObjects(result);
  }

  /**
   * Get topics by engagement level
   */
  getTopicsByEngagement(level) {
    const result = this.db.exec(`SELECT * FROM topics WHERE engagement_level = '${level}' ORDER BY last_mentioned DESC`);
    return this.resultToObjects(result);
  }

  /**
   * Get topic by tag
   */
  getTopic(topicTag) {
    const result = this.db.exec(`SELECT * FROM topics WHERE topic_tag = '${topicTag}'`);
    const objects = this.resultToObjects(result);
    return objects.length > 0 ? objects[0] : null;
  }

  /**
   * Create or update a topic
   */
  upsertTopic(topicTag, displayName, summaryText, keywords, engagementLevel = 'medium', confidence = 0.5) {
    const consent = this.getConsentSettings();
    if (!consent.tier_2_enabled) {
      console.warn('[PersonalizationStore] Cannot upsert topic: Tier 2 not enabled');
      return null;
    }

    const now = this.now();
    const keywordsJson = JSON.stringify(keywords);
    const existing = this.getTopic(topicTag);

    if (existing) {
      // Update existing topic
      const newCount = existing.observation_count + 1;
      this.db.run(`
        UPDATE topics
        SET display_name = ?, summary_text = ?, keywords = ?, engagement_level = ?,
            confidence = ?, observation_count = ?, last_mentioned = ?, updated_at = ?
        WHERE topic_tag = ?
      `, [displayName, summaryText, keywordsJson, engagementLevel, confidence, newCount, now, now, topicTag]);

      this.logAccess('updated', 'topics', 1, 'upsert_topic');
      this.persist();
      console.log(`[PersonalizationStore] Updated topic: "${displayName}" (${topicTag}), engagement: ${engagementLevel}`);
      return existing.id;
    } else {
      // Create new topic
      const id = this.generateId();
      this.db.run(`
        INSERT INTO topics (id, topic_tag, display_name, summary_text, keywords, engagement_level,
                           confidence, observation_count, first_mentioned, last_mentioned, created_at, updated_at, consent_tier)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, 3)
      `, [id, topicTag, displayName, summaryText, keywordsJson, engagementLevel, confidence, now, now, now, now]);

      this.logAccess('created', 'topics', 1, 'upsert_topic');
      this.persist();
      console.log(`[PersonalizationStore] Created new topic: "${displayName}" (${topicTag}), engagement: ${engagementLevel}`);
      return id;
    }
  }

  /**
   * Delete a topic
   */
  deleteTopic(topicTag) {
    this.db.run(`DELETE FROM topics WHERE topic_tag = '${topicTag}'`);
    this.logAccess('deleted', 'topics', 1, 'delete_topic');
    this.persist();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SESSION SUMMARIES (Tier 3)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Create a session summary
   */
  createSessionSummary(summaryText, keyObservations, keywords) {
    const consent = this.getConsentSettings();
    if (!consent.tier_3_enabled) {
      console.warn('[PersonalizationStore] Cannot create session summary: Tier 3 not enabled');
      return null;
    }

    const id = this.generateId();
    const now = this.now();
    const sessionDate = now.split('T')[0]; // Just the date part

    // Sessions expire after 6 months
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + 6);

    const keyObsJson = JSON.stringify(keyObservations);
    const keywordsJson = JSON.stringify(keywords);

    this.db.run(`
      INSERT INTO session_summaries (id, session_date, summary_text, key_observations, keywords, created_at, expires_at, consent_tier)
      VALUES (?, ?, ?, ?, ?, ?, ?, 3)
    `, [id, sessionDate, summaryText, keyObsJson, keywordsJson, now, expiresAt.toISOString()]);

    this.logAccess('created', 'session_summaries', 1, 'create_session_summary');
    this.persist();
    return id;
  }

  /**
   * Get recent session summaries
   */
  getRecentSessions(limit = 5) {
    const now = this.now();
    const result = this.db.exec(`
      SELECT * FROM session_summaries
      WHERE expires_at > '${now}'
      ORDER BY session_date DESC
      LIMIT ${limit}
    `);
    return this.resultToObjects(result);
  }

  /**
   * Delete expired session summaries
   */
  deleteExpiredSessions() {
    const now = this.now();
    const result = this.db.exec(`SELECT COUNT(*) as count FROM session_summaries WHERE expires_at <= '${now}'`);
    const count = result.length > 0 ? result[0].values[0][0] : 0;

    if (count > 0) {
      this.db.run(`DELETE FROM session_summaries WHERE expires_at <= '${now}'`);
      this.logAccess('deleted', 'session_summaries', count, 'delete_expired');
      this.persist();
      console.log(`[PersonalizationStore] Deleted ${count} expired session summaries`);
    }

    return count;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONTEXT RETRIEVAL
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Retrieve personalization context for a conversation
   */
  retrieveContext(query, options = {}) {
    const {
      limit = 5,
      section = 'maya',
      includeTier2 = true,
      includeTier3 = true
    } = options;

    const consent = this.getConsentSettings();
    const results = {
      preferences: [],
      profiles: [],
      topics: [],
      recentSessions: []
    };

    // Tier 2: Always include all preferences if enabled
    if (includeTier2 && consent.tier_2_enabled) {
      results.preferences = this.getAllPreferences();
      this.logAccess('retrieved', 'preference_facts', results.preferences.length, section);
    }

    // Tier 3: Full personalization
    if (includeTier3 && consent.tier_3_enabled) {
      const keywords = this.extractKeywords(query);

      // Get all universal profiles
      results.profiles = this.getAllProfiles();

      // Get relevant topics (high engagement + keyword matches)
      results.topics = this.getRelevantTopics(keywords);

      // Get recent session summaries
      results.recentSessions = this.searchSessions(keywords, limit);

      this.logAccess('retrieved', 'tier_3_context',
        results.profiles.length + results.topics.length + results.recentSessions.length, section);
    }

    return results;
  }

  /**
   * Get relevant topics based on engagement and keywords
   */
  getRelevantTopics(keywords) {
    // Always include high-engagement topics
    const highEngagement = this.getTopicsByEngagement('high');

    // Get medium/low topics that match keywords
    const allOther = [
      ...this.getTopicsByEngagement('medium'),
      ...this.getTopicsByEngagement('low')
    ];

    const matchingTopics = allOther.filter(topic => {
      const topicKeywords = JSON.parse(topic.keywords || '[]');
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
   * Search session summaries by keywords with recency weighting
   */
  searchSessions(keywords, limit = 5) {
    const sessions = this.getRecentSessions(20);

    // Score by keyword match + recency
    const scored = sessions.map(session => {
      const sessionKeywords = JSON.parse(session.keywords || '[]');
      const keywordScore = keywords.filter(k =>
        sessionKeywords.some(sk => sk.includes(k) || k.includes(sk))
      ).length / Math.max(keywords.length, 1);

      const daysSince = (Date.now() - new Date(session.session_date)) / (1000 * 60 * 60 * 24);
      const recencyScore = Math.exp(-daysSince / 30); // Decay over 30 days

      return {
        ...session,
        score: (keywordScore * 0.6) + (recencyScore * 0.4)
      };
    });

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /**
   * Extract keywords from text
   */
  extractKeywords(text) {
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'i', 'you', 'we', 'they', 'it',
      'to', 'for', 'of', 'and', 'or', 'but', 'in', 'on', 'at', 'with', 'about',
      'how', 'what', 'when', 'where', 'why', 'do', 'does', 'did', 'have', 'has',
      'had', 'be', 'been', 'being', 'my', 'your', 'our', 'their', 'this', 'that',
      'these', 'those', 'can', 'could', 'would', 'should', 'will', 'shall', 'may',
      'might', 'must', 'am', 'im', 'its', 'just', 'like', 'so', 'very', 'too',
      'also', 'well', 'really', 'get', 'got', 'going', 'go', 'know', 'think',
      'want', 'need', 'see', 'look', 'make', 'take', 'come', 'say', 'said'
    ]);

    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // AUDIT LOGGING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Log a data access event (no content, only metadata)
   */
  logAccess(action, tableName, recordCount, context) {
    const now = this.now();
    this.db.run(`
      INSERT INTO access_log (action, table_name, record_count, context, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `, [action, tableName, recordCount, context, now]);
  }

  /**
   * Log a safety event (no content, only category)
   */
  logSafetyEvent(eventType, category, actionTaken) {
    const now = this.now();
    this.db.run(`
      INSERT INTO safety_log (event_type, category, action_taken, timestamp)
      VALUES (?, ?, ?, ?)
    `, [eventType, category, actionTaken, now]);
    this.persist();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Convert sql.js result to array of objects
   */
  resultToObjects(result) {
    if (result.length === 0) return [];

    const columns = result[0].columns;
    const values = result[0].values;

    return values.map(row => {
      const obj = {};
      columns.forEach((col, i) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  /**
   * Get database statistics
   */
  getStats() {
    const stats = {
      preferences: 0,
      profiles: 0,
      topics: 0,
      sessions: 0
    };

    try {
      let result = this.db.exec("SELECT COUNT(*) FROM preference_facts");
      stats.preferences = result[0]?.values[0]?.[0] || 0;

      result = this.db.exec("SELECT COUNT(*) FROM personality_profiles");
      stats.profiles = result[0]?.values[0]?.[0] || 0;

      result = this.db.exec("SELECT COUNT(*) FROM topics");
      stats.topics = result[0]?.values[0]?.[0] || 0;

      result = this.db.exec("SELECT COUNT(*) FROM session_summaries");
      stats.sessions = result[0]?.values[0]?.[0] || 0;
    } catch (e) {
      console.warn('[PersonalizationStore] Error getting stats:', e);
    }

    return stats;
  }

  /**
   * Export database for debugging
   */
  exportDebugData() {
    return {
      consent: this.getConsentSettings(),
      stats: this.getStats(),
      preferences: this.getAllPreferences(),
      profiles: this.getAllProfiles(),
      topics: this.getAllTopics()
    };
  }

  /**
   * Clear all data (for testing)
   */
  clearAll() {
    this.db.run("DELETE FROM preference_facts");
    this.db.run("DELETE FROM personality_profiles");
    this.db.run("DELETE FROM topics");
    this.db.run("DELETE FROM session_summaries");
    this.db.run("DELETE FROM access_log");
    this.db.run("DELETE FROM safety_log");
    this.persist();
    console.log('[PersonalizationStore] All data cleared');
  }
}

// Export singleton instance
export const personalization = PersonalizationStore.getInstance();
export { PersonalizationStore };
