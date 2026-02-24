-- MayaMind Exercise Templates Table
-- Run this in the Supabase SQL Editor to create the table

-- Create exercise_templates table
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

-- Enable Row Level Security
ALTER TABLE exercise_templates ENABLE ROW LEVEL SECURITY;

-- Allow anonymous access for POC (remove in production and add proper auth)
DROP POLICY IF EXISTS "Allow anonymous access" ON exercise_templates;
CREATE POLICY "Allow anonymous access" ON exercise_templates
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Grant permissions
GRANT ALL ON exercise_templates TO anon;
GRANT ALL ON exercise_templates TO authenticated;
