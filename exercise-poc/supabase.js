/**
 * MayaMind Exercise POC — Supabase Client
 *
 * Initializes Supabase client for template storage.
 * Uses the @supabase/supabase-js library from CDN.
 */

// Import Supabase from CDN (ESM)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

let supabase = null;
let initPromise = null;

/**
 * Initialize Supabase client
 * Fetches config from server and creates client
 */
async function initSupabase() {
  if (supabase) return supabase;

  try {
    // Fetch config from server (contains public URL + anon key)
    const res = await fetch('/api/config');
    if (!res.ok) {
      console.warn('[Supabase] Failed to fetch config:', res.status);
      return null;
    }

    const config = await res.json();
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      console.warn('[Supabase] Missing URL or anon key in config');
      return null;
    }

    supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
    console.log('[Supabase] Client initialized');
    return supabase;
  } catch (err) {
    console.error('[Supabase] Init error:', err);
    return null;
  }
}

/**
 * Get Supabase client (initializes if needed)
 */
export async function getSupabase() {
  if (supabase) return supabase;
  if (!initPromise) {
    initPromise = initSupabase();
  }
  return initPromise;
}

/**
 * Check if Supabase is available and connected
 */
export async function isSupabaseAvailable() {
  const client = await getSupabase();
  return client !== null;
}

// ── Template Table Operations ─────────────────────────────────────────────────

const TABLE_NAME = 'exercise_templates';

/**
 * Fetch all templates from Supabase
 */
export async function fetchTemplates() {
  const client = await getSupabase();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from(TABLE_NAME)
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      // Table might not exist yet - that's OK
      if (error.code === '42P01') {
        console.log('[Supabase] Table does not exist yet');
        return [];
      }
      console.error('[Supabase] Fetch error:', error);
      return [];
    }

    console.log(`[Supabase] Fetched ${data.length} templates`);
    return data;
  } catch (err) {
    console.error('[Supabase] Fetch exception:', err);
    return [];
  }
}

/**
 * Save a template to Supabase (upsert)
 */
export async function saveTemplate(template) {
  const client = await getSupabase();
  if (!client) return false;

  try {
    // Convert template to DB format
    const record = {
      id: template.id,
      name: template.name,
      exercise_type: template.exerciseType,
      sequence_data: template.sequence,  // JSON column
      metadata: template.metadata,        // JSON column
      created_at: new Date(template.createdAt).toISOString(),
      updated_at: new Date(template.updatedAt).toISOString(),
    };

    const { error } = await client
      .from(TABLE_NAME)
      .upsert(record, { onConflict: 'id' });

    if (error) {
      console.error('[Supabase] Save error:', error);
      return false;
    }

    console.log(`[Supabase] Saved template: ${template.id}`);
    return true;
  } catch (err) {
    console.error('[Supabase] Save exception:', err);
    return false;
  }
}

/**
 * Delete a template from Supabase
 */
export async function deleteTemplate(templateId) {
  const client = await getSupabase();
  if (!client) return false;

  try {
    const { error } = await client
      .from(TABLE_NAME)
      .delete()
      .eq('id', templateId);

    if (error) {
      console.error('[Supabase] Delete error:', error);
      return false;
    }

    console.log(`[Supabase] Deleted template: ${templateId}`);
    return true;
  } catch (err) {
    console.error('[Supabase] Delete exception:', err);
    return false;
  }
}

/**
 * Clear all templates from Supabase
 */
export async function clearTemplates() {
  const client = await getSupabase();
  if (!client) return false;

  try {
    const { error } = await client
      .from(TABLE_NAME)
      .delete()
      .neq('id', '');  // Delete all rows

    if (error) {
      console.error('[Supabase] Clear error:', error);
      return false;
    }

    console.log('[Supabase] Cleared all templates');
    return true;
  } catch (err) {
    console.error('[Supabase] Clear exception:', err);
    return false;
  }
}

// ── SQL for creating the table ────────────────────────────────────────────────
// Run this in Supabase SQL Editor to create the table:
/*
CREATE TABLE IF NOT EXISTS exercise_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  exercise_type TEXT NOT NULL,
  sequence_data JSONB NOT NULL,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster queries by exercise type
CREATE INDEX IF NOT EXISTS idx_exercise_templates_type ON exercise_templates(exercise_type);

-- Enable RLS but allow all operations for now (POC)
ALTER TABLE exercise_templates ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for POC (remove in production)
CREATE POLICY "Allow anonymous access" ON exercise_templates
  FOR ALL
  USING (true)
  WITH CHECK (true);
*/
