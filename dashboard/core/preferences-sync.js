/**
 * MayaMind Dashboard — Preferences Sync (Supabase)
 *
 * Persists user preferences (appearance settings, user profile) to Supabase.
 * Falls back gracefully to localStorage if Supabase is unavailable.
 * Uses a device ID (generated once, stored in localStorage) as the row key.
 *
 * Categories:
 *   - maya_appearance   : { cameraView, background, mood, lighting }
 *   - connect_appearance: { cameraView, background, mood, lighting }
 *   - user_settings     : { name, phone, email, dob, sex }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const TABLE = 'user_preferences';
const DEVICE_ID_KEY = 'mayamind_device_id';

let supabase = null;
let deviceId = null;
let initPromise = null;

// ── Device ID ────────────────────────────────────────────────────────────────

function getDeviceId() {
  if (deviceId) return deviceId;
  deviceId = localStorage.getItem(DEVICE_ID_KEY);
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, deviceId);
  }
  return deviceId;
}

// ── Initialization ───────────────────────────────────────────────────────────

async function initClient() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) {
      console.warn('[PreferencesSync] Failed to fetch config');
      return null;
    }
    const config = await res.json();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.warn('[PreferencesSync] Supabase not configured');
      return null;
    }
    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    console.log('[PreferencesSync] Supabase client initialized');
    return supabase;
  } catch (err) {
    console.error('[PreferencesSync] Init error:', err);
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialize the sync module. Call once at app startup.
 * Returns true if Supabase is available.
 */
async function init() {
  if (supabase) return true;
  if (!initPromise) initPromise = initClient();
  const client = await initPromise;
  return client !== null;
}

/**
 * Load all preferences for this device from Supabase.
 * Returns an object keyed by category: { maya_appearance: {...}, ... }
 */
async function loadAll() {
  await init();
  if (!supabase) return {};

  const id = getDeviceId();

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('category, preferences')
      .eq('device_id', id);

    if (error) {
      if (error.code === '42P01') {
        console.log('[PreferencesSync] Table does not exist yet');
        return {};
      }
      console.error('[PreferencesSync] Load error:', error);
      return {};
    }

    const result = {};
    for (const row of data) {
      result[row.category] = row.preferences;
    }
    console.log('[PreferencesSync] Loaded preferences:', Object.keys(result).join(', ') || '(none)');
    return result;
  } catch (err) {
    console.error('[PreferencesSync] Load exception:', err);
    return {};
  }
}

/**
 * Save preferences for a specific category.
 * Upserts the row (insert or update on conflict).
 */
async function save(category, preferences) {
  await init();
  if (!supabase) return false;

  const id = getDeviceId();

  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        {
          device_id: id,
          category,
          preferences,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'device_id,category' }
      );

    if (error) {
      console.error(`[PreferencesSync] Save error (${category}):`, error);
      return false;
    }

    console.log(`[PreferencesSync] Saved ${category}`);
    return true;
  } catch (err) {
    console.error(`[PreferencesSync] Save exception (${category}):`, err);
    return false;
  }
}

/**
 * Load a single category's preferences.
 */
async function load(category) {
  const all = await loadAll();
  return all[category] || null;
}

// ── Singleton export ─────────────────────────────────────────────────────────

export const preferencesSync = { init, loadAll, load, save };
