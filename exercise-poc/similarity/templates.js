/**
 * MayaMind Exercise POC — Template Management
 *
 * Stores and manages exercise templates for similarity search.
 * Templates are stored in localStorage AND synced to Supabase for persistence.
 */

import { FeatureSequence } from './features.js';
import {
  fetchTemplates as supabaseFetch,
  saveTemplate as supabaseSave,
  deleteTemplate as supabaseDelete,
  clearTemplates as supabaseClear,
  isSupabaseAvailable,
} from '../supabase.js';

/**
 * Exercise types supported
 */
export const ExerciseType = {
  SQUAT: 'squat',
  REVERSE_LUNGE: 'reverse_lunge',
  BICEPS_CURL: 'biceps_curl',
  KNEE_PUSHUP: 'knee_pushup',
  UNKNOWN: 'unknown',
};

/**
 * Template metadata structure
 */
export class ExerciseTemplate {
  constructor(options = {}) {
    this.id = options.id || generateId();
    this.name = options.name || 'Unnamed Template';
    this.exerciseType = options.exerciseType || ExerciseType.UNKNOWN;
    this.sequence = options.sequence || new FeatureSequence();
    this.createdAt = options.createdAt || Date.now();
    this.updatedAt = options.updatedAt || Date.now();
    this.metadata = {
      recordedBy: options.recordedBy || 'unknown',
      orientation: options.orientation || 'unknown',
      notes: options.notes || '',
      repCount: options.repCount || 1,
      quality: options.quality || 'good',
      ...options.metadata,
    };
  }

  /**
   * Get vectors for DTW comparison (migrates old 44-dim to 22-dim if needed)
   */
  getVectors() {
    const vectors = this.sequence.getVectors();
    return migrateVectorsToLeftSideOnly(vectors);
  }

  /**
   * Export to JSON (full data for Supabase)
   */
  toJSON() {
    return {
      id: this.id,
      name: this.name,
      exerciseType: this.exerciseType,
      sequence: this.sequence.toJSON(),
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.metadata,
    };
  }

  /**
   * Export to lightweight JSON (metadata only, for localStorage)
   * Sequence data is fetched from Supabase on demand
   */
  toLightJSON() {
    return {
      id: this.id,
      name: this.name,
      exerciseType: this.exerciseType,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      metadata: this.metadata,
      // Store subsampled vectors for quick matching (60 frames instead of ~500)
      subsampledVectors: this.sequence ? this.getSubsampledVectors(60) : [],
    };
  }

  /**
   * Import from JSON (full data)
   */
  static fromJSON(json) {
    const template = new ExerciseTemplate({
      id: json.id,
      name: json.name,
      exerciseType: json.exerciseType,
      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
      metadata: json.metadata,
    });
    template.sequence = FeatureSequence.fromJSON(json.sequence);

    // Debug: verify sequence loaded correctly
    const frameCount = template.sequence?.frames?.length || 0;
    if (frameCount === 0) {
      console.error(`[ExerciseTemplate.fromJSON] ${json.name}: No frames! json.sequence:`, json.sequence);
    } else {
      console.log(`[ExerciseTemplate.fromJSON] ${json.name}: ${frameCount} frames loaded`);
    }

    return template;
  }

  /**
   * Import from lightweight JSON (metadata + subsampled vectors)
   * Used for localStorage cache — full data fetched from Supabase later
   */
  static fromLightJSON(json) {
    const template = new ExerciseTemplate({
      id: json.id,
      name: json.name,
      exerciseType: json.exerciseType,
      createdAt: json.createdAt,
      updatedAt: json.updatedAt,
      metadata: json.metadata,
    });
    // Create a minimal sequence with just the subsampled vectors
    template.sequence = new FeatureSequence();
    template._subsampledVectors = json.subsampledVectors || [];
    template._isLightweight = true;
    return template;
  }

  /**
   * Override getSubsampledVectors to use cached subsampled vectors if available
   * Also migrates old 44-dim vectors to 22-dim left-side-only format
   */
  getSubsampledVectors(targetFrames = 60) {
    let vectors;
    if (this._subsampledVectors && this._subsampledVectors.length > 0) {
      vectors = this._subsampledVectors;
    } else {
      vectors = this.sequence.subsample(targetFrames);
    }
    return migrateVectorsToLeftSideOnly(vectors);
  }
}

/**
 * Template storage manager
 * Stores in localStorage for fast access, syncs to Supabase for persistence
 */
export class TemplateStore {
  constructor(storageKey = 'mayamind_exercise_templates') {
    this.storageKey = storageKey;
    this.templates = new Map();
    this.supabaseReady = false;
    this.syncInProgress = false;
    this.load();
    // Start Supabase sync in background
    this.initSupabaseSync();
  }

  /**
   * Load templates from localStorage (synchronous, fast)
   * Supports both full (v1) and lightweight (v2) formats
   */
  load() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored);

        // Migrate from v1 to v2: clear old large data, will re-fetch from Supabase
        if (!data.version || data.version < 2) {
          console.log('[TemplateStore] Migrating from v1 to v2 format, clearing localStorage');
          localStorage.removeItem(this.storageKey);
          // Don't load from localStorage — full data will come from Supabase
          return;
        }

        const isLightweight = data.version >= 2;

        for (const json of data.templates || []) {
          let template;
          if (isLightweight || json.subsampledVectors) {
            // Lightweight format — metadata + subsampled vectors only
            template = ExerciseTemplate.fromLightJSON(json);
          } else if (json.sequence) {
            // Full format — has complete sequence data
            template = ExerciseTemplate.fromJSON(json);
          } else {
            // Skip invalid entries
            continue;
          }
          this.templates.set(template.id, template);
        }
        console.log(`[TemplateStore] Loaded ${this.templates.size} templates from localStorage (v${data.version || 1})`);
      }
    } catch (err) {
      console.error('[TemplateStore] Failed to load from localStorage:', err);
      // Clear corrupted data
      localStorage.removeItem(this.storageKey);
    }
  }

  /**
   * Initialize Supabase sync (async, runs in background)
   */
  async initSupabaseSync() {
    try {
      const available = await isSupabaseAvailable();
      if (!available) {
        console.log('[TemplateStore] Supabase not available, using localStorage only');
        return;
      }
      this.supabaseReady = true;
      console.log('[TemplateStore] Supabase available, syncing...');
      await this.syncFromSupabase();
    } catch (err) {
      console.error('[TemplateStore] Supabase init error:', err);
    }
  }

  /**
   * Sync templates from Supabase (merge with local)
   */
  async syncFromSupabase() {
    if (!this.supabaseReady || this.syncInProgress) return;
    this.syncInProgress = true;

    try {
      const remoteTemplates = await supabaseFetch();
      let added = 0;
      let updated = 0;

      for (const remote of remoteTemplates) {
        // Convert from Supabase format to local format
        const json = {
          id: remote.id,
          name: remote.name,
          exerciseType: remote.exercise_type,
          sequence: remote.sequence_data,
          metadata: remote.metadata,
          createdAt: new Date(remote.created_at).getTime(),
          updatedAt: new Date(remote.updated_at).getTime(),
        };

        const existing = this.templates.get(remote.id);
        if (!existing) {
          // New template from Supabase
          const template = ExerciseTemplate.fromJSON(json);
          this.templates.set(template.id, template);
          added++;
        } else if (json.updatedAt > existing.updatedAt || existing._isLightweight) {
          // Remote is newer OR local is lightweight (needs full data)
          const template = ExerciseTemplate.fromJSON(json);
          this.templates.set(template.id, template);
          updated++;
        }
      }

      if (added > 0 || updated > 0) {
        this.saveToLocalStorage(); // Update localStorage with merged data
        console.log(`[TemplateStore] Synced from Supabase: +${added} new, ${updated} updated`);
      } else {
        console.log('[TemplateStore] Supabase sync complete, no changes');
      }

      // Push any local-only templates to Supabase (only if they have full data)
      const remoteIds = new Set(remoteTemplates.map(t => t.id));
      for (const [id, template] of this.templates) {
        if (!remoteIds.has(id) && !template._isLightweight) {
          await supabaseSave(template.toJSON());
          console.log(`[TemplateStore] Pushed local template to Supabase: ${id}`);
        }
      }
    } catch (err) {
      console.error('[TemplateStore] Sync error:', err);
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Save templates to localStorage only (lightweight version)
   * Full data is stored in Supabase; localStorage only caches metadata + subsampled vectors
   */
  saveToLocalStorage() {
    try {
      const data = {
        version: 2, // Version 2 = lightweight format
        savedAt: Date.now(),
        templates: Array.from(this.templates.values()).map(t => t.toLightJSON()),
      };
      const json = JSON.stringify(data);

      // Check size before saving (limit to ~2MB to stay well under quota)
      if (json.length > 2 * 1024 * 1024) {
        console.warn('[TemplateStore] Data too large for localStorage, skipping local cache');
        return;
      }

      localStorage.setItem(this.storageKey, json);
    } catch (err) {
      // If quota exceeded, clear and skip localStorage
      if (err.name === 'QuotaExceededError') {
        console.warn('[TemplateStore] localStorage quota exceeded, clearing local cache');
        localStorage.removeItem(this.storageKey);
      } else {
        console.error('[TemplateStore] Failed to save to localStorage:', err);
      }
    }
  }

  /**
   * Save templates to localStorage AND sync to Supabase
   */
  save() {
    this.saveToLocalStorage();
    console.log(`[TemplateStore] Saved ${this.templates.size} templates`);
  }

  /**
   * Add a new template (saves to both localStorage and Supabase)
   */
  add(template) {
    this.templates.set(template.id, template);
    this.save();
    // Async save to Supabase (fire and forget)
    if (this.supabaseReady) {
      supabaseSave(template.toJSON()).catch(err => {
        console.error('[TemplateStore] Supabase save failed:', err);
      });
    }
    return template;
  }

  /**
   * Get a template by ID
   */
  get(id) {
    return this.templates.get(id);
  }

  /**
   * Get all templates
   */
  getAll() {
    return Array.from(this.templates.values());
  }

  /**
   * Get templates by exercise type
   */
  getByType(exerciseType) {
    return this.getAll().filter(t => t.exerciseType === exerciseType);
  }

  /**
   * Delete a template (from both localStorage and Supabase)
   */
  delete(id) {
    const deleted = this.templates.delete(id);
    if (deleted) {
      this.save();
      // Async delete from Supabase (fire and forget)
      if (this.supabaseReady) {
        supabaseDelete(id).catch(err => {
          console.error('[TemplateStore] Supabase delete failed:', err);
        });
      }
    }
    return deleted;
  }

  /**
   * Clear all templates (from both localStorage and Supabase)
   */
  clear() {
    this.templates.clear();
    this.save();
    // Async clear from Supabase (fire and forget)
    if (this.supabaseReady) {
      supabaseClear().catch(err => {
        console.error('[TemplateStore] Supabase clear failed:', err);
      });
    }
  }

  /**
   * Get template count
   */
  get size() {
    return this.templates.size;
  }

  /**
   * Export all templates to JSON file
   */
  exportToFile(filename = 'exercise_templates.json') {
    const data = {
      version: 1,
      exportedAt: new Date().toISOString(),
      templates: Array.from(this.templates.values()).map(t => t.toJSON()),
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  /**
   * Import templates from JSON file
   */
  async importFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = JSON.parse(e.target.result);
          let imported = 0;
          for (const json of data.templates || []) {
            const template = ExerciseTemplate.fromJSON(json);
            // Generate new ID to avoid conflicts
            template.id = generateId();
            this.templates.set(template.id, template);
            imported++;
          }
          this.save();
          resolve(imported);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  /**
   * Get vectors for all templates of a given type
   * Returns Map of {templateId: vectors}
   */
  getVectorsByType(exerciseType, subsample = 60) {
    const result = {};
    for (const template of this.getByType(exerciseType)) {
      result[template.id] = subsample
        ? template.getSubsampledVectors(subsample)
        : template.getVectors();
    }
    return result;
  }

  /**
   * Get all vectors grouped by exercise type
   */
  getAllVectorsGrouped(subsample = 60) {
    const result = {};
    for (const type of Object.values(ExerciseType)) {
      if (type === ExerciseType.UNKNOWN) continue;
      const templates = this.getByType(type);
      if (templates.length > 0) {
        result[type] = templates.map(t => ({
          id: t.id,
          name: t.name,
          vectors: subsample ? t.getSubsampledVectors(subsample) : t.getVectors(),
        }));
      }
    }
    return result;
  }
}

/**
 * Generate unique ID
 */
function generateId() {
  return `tmpl_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Migrate old 44-dimensional vector to new 22-dimensional left-side-only vector
 *
 * Old structure (44 dimensions):
 *   Positions (36): [L_SHOULDER(0-2), R_SHOULDER(3-5), L_ELBOW(6-8), R_ELBOW(9-11),
 *                    L_WRIST(12-14), R_WRIST(15-17), L_HIP(18-20), R_HIP(21-23),
 *                    L_KNEE(24-26), R_KNEE(27-29), L_ANKLE(30-32), R_ANKLE(33-35)]
 *   Angles (8): [leftKnee(36), rightKnee(37), leftHip(38), rightHip(39),
 *                leftElbow(40), rightElbow(41), leftShoulder(42), rightShoulder(43)]
 *
 * New structure (22 dimensions):
 *   Positions (18): [L_SHOULDER(0-2), L_ELBOW(3-5), L_WRIST(6-8),
 *                    L_HIP(9-11), L_KNEE(12-14), L_ANKLE(15-17)]
 *   Angles (4): [leftKnee(18), leftHip(19), leftElbow(20), leftShoulder(21)]
 */
function migrateVectorToLeftSideOnly(oldVector) {
  if (!oldVector || oldVector.length !== 44) {
    // Not an old-format vector, return as-is
    return oldVector;
  }

  const newVector = [];

  // Extract left-side positions (indices 0-2, 6-8, 12-14, 18-20, 24-26, 30-32)
  const leftPosIndices = [0, 1, 2, 6, 7, 8, 12, 13, 14, 18, 19, 20, 24, 25, 26, 30, 31, 32];
  for (const idx of leftPosIndices) {
    newVector.push(oldVector[idx]);
  }

  // Extract left-side angles (indices 36, 38, 40, 42)
  const leftAngleIndices = [36, 38, 40, 42];
  for (const idx of leftAngleIndices) {
    newVector.push(oldVector[idx]);
  }

  return newVector;
}

/**
 * Migration function (currently disabled - using full 44-dim vectors)
 * Kept for potential future use if we switch back to left-side-only mode
 */
export function migrateVectorsToLeftSideOnly(vectors) {
  // No migration needed - using full 44-dim vectors with both sides
  return vectors;
}

/**
 * Singleton store instance
 */
let storeInstance = null;

export function getTemplateStore() {
  if (!storeInstance) {
    storeInstance = new TemplateStore();
  }
  return storeInstance;
}
