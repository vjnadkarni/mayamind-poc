-- MayaMind Authentication Schema
-- Run this in Supabase SQL Editor (https://supabase.com/dashboard/project/plroxdjxliuecdfjjmyz/sql)

-- User Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT,  -- Optional, for SMS 2FA
    street_address TEXT,
    city TEXT,
    state TEXT,
    zip_code TEXT,
    date_of_birth DATE,

    -- 2FA Settings
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    two_factor_method TEXT CHECK (two_factor_method IN ('email', 'sms', NULL)),
    face_id_enabled BOOLEAN DEFAULT FALSE,

    -- Metadata
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Device tokens for 30-day 2FA bypass
CREATE TABLE IF NOT EXISTS public.device_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id TEXT NOT NULL,  -- Unique device identifier
    device_name TEXT,  -- e.g., "iPhone 12"
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 days'),

    UNIQUE(user_id, device_id)
);

-- 2FA Codes (temporary, for verification)
CREATE TABLE IF NOT EXISTS public.two_factor_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    code TEXT NOT NULL,  -- 6-digit code
    method TEXT NOT NULL CHECK (method IN ('email', 'sms')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '10 minutes'),
    used BOOLEAN DEFAULT FALSE
);

-- Account lockouts (failed login attempts)
CREATE TABLE IF NOT EXISTS public.account_lockouts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    failed_attempts INTEGER DEFAULT 0,
    locked_until TIMESTAMPTZ,
    last_attempt_at TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE(email)
);

-- Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.two_factor_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_lockouts ENABLE ROW LEVEL SECURITY;

-- RLS Policies for user_profiles
CREATE POLICY "Users can view own profile"
    ON public.user_profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.user_profiles FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON public.user_profiles FOR INSERT
    WITH CHECK (auth.uid() = id);

-- RLS Policies for device_tokens
CREATE POLICY "Users can view own device tokens"
    ON public.device_tokens FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own device tokens"
    ON public.device_tokens FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own device tokens"
    ON public.device_tokens FOR DELETE
    USING (auth.uid() = user_id);

-- RLS Policies for two_factor_codes (service role only for security)
CREATE POLICY "Service role can manage 2FA codes"
    ON public.two_factor_codes FOR ALL
    USING (auth.role() = 'service_role');

-- RLS Policies for account_lockouts (service role only)
CREATE POLICY "Service role can manage lockouts"
    ON public.account_lockouts FOR ALL
    USING (auth.role() = 'service_role');

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for user_profiles updated_at
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to clean up expired device tokens
CREATE OR REPLACE FUNCTION cleanup_expired_device_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM public.device_tokens WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Function to clean up expired 2FA codes
CREATE OR REPLACE FUNCTION cleanup_expired_2fa_codes()
RETURNS void AS $$
BEGIN
    DELETE FROM public.two_factor_codes WHERE expires_at < NOW() OR used = TRUE;
END;
$$ LANGUAGE plpgsql;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_device_tokens_user_device ON public.device_tokens(user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_device_tokens_expires ON public.device_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_two_factor_codes_user ON public.two_factor_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_account_lockouts_email ON public.account_lockouts(email);
