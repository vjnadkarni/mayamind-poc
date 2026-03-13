'use strict';

// Load .env from project root (one level up from server/)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const { execFile } = require('child_process');

// Twilio (optional — only if configured)
let twilioClient = null;
if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
  const twilio = require('twilio');
  twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  console.log('[Twilio] Client initialized');
}

// Multer for voice file uploads (preserve .webm extension for proper MIME detection)
const multer = require('multer');
const tempDir = path.join(__dirname, 'temp');
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
const storage = multer.diskStorage({
  destination: tempDir,
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// ── Validate required env vars ────────────────────────────────────────────────
const REQUIRED_VARS = ['ANTHROPIC_API_KEY', 'DEEPGRAM_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID'];
const missing = REQUIRED_VARS.filter(v => !process.env[v]);
if (missing.length) {
  console.error('Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false })); // Twilio webhooks use form-encoded

// Supabase auth callback page - handles both implicit (hash) and PKCE (query) flows
const AUTH_CALLBACK_HTML = `
<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MayaMind</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a10;
      color: white;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      margin: 0;
    }
    .container { padding: 40px; max-width: 400px; width: 100%; }
    .icon { font-size: 60px; margin-bottom: 20px; text-align: center; }
    h1 { color: #f97316; margin-bottom: 16px; text-align: center; }
    p { color: #9ca3af; line-height: 1.6; text-align: center; margin-bottom: 24px; }
    .form-group { margin-bottom: 16px; }
    label { display: block; color: #9ca3af; font-size: 14px; margin-bottom: 6px; }
    input[type="password"] {
      width: 100%; padding: 14px; border: 1px solid #333;
      border-radius: 8px; background: #1a1a2e; color: white;
      font-size: 16px; box-sizing: border-box;
    }
    input:focus { outline: none; border-color: #f97316; }
    button {
      width: 100%; padding: 14px; background: #f97316; color: white;
      border: none; border-radius: 8px; font-size: 16px; font-weight: 600;
      cursor: pointer; margin-top: 8px;
    }
    button:hover { background: #ea580c; }
    button:disabled { background: #666; cursor: not-allowed; }
    .error { color: #ef4444; font-size: 14px; margin-top: 8px; text-align: center; }
    .requirements { color: #6b7280; font-size: 12px; margin-top: 8px; }
    .requirements li { margin: 4px 0; }
    .loading { text-align: center; }
    .spinner {
      border: 3px solid #333; border-top: 3px solid #f97316;
      border-radius: 50%; width: 40px; height: 40px;
      animation: spin 1s linear infinite; margin: 20px auto;
    }
    @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <div id="loading" class="loading">
      <div class="spinner"></div>
      <p>Processing...</p>
    </div>
    <div id="passwordReset" style="display: none;">
      <div class="icon">🔐</div>
      <h1>Reset Password</h1>
      <p>Enter your new password below.</p>
      <form id="resetForm">
        <div class="form-group">
          <label>New Password</label>
          <input type="password" id="password" required minlength="8" autocomplete="new-password" />
        </div>
        <div class="form-group">
          <label>Confirm Password</label>
          <input type="password" id="confirmPassword" required autocomplete="new-password" />
        </div>
        <ul class="requirements">
          <li>At least 8 characters</li>
          <li>One uppercase letter</li>
          <li>One number</li>
        </ul>
        <button type="submit" id="submitBtn">Update Password</button>
        <div id="message"></div>
      </form>
    </div>
    <div id="emailVerified" style="display: none;">
      <div class="icon">✓</div>
      <h1 style="color: #22c55e;">Email Verified!</h1>
      <p>Your email has been successfully verified.</p>
      <p>You can now return to the <span style="color: #f97316; font-weight: 600;">MayaMind</span> app and sign in.</p>
      <p style="margin-top: 24px; font-size: 14px;">You may close this browser tab.</p>
    </div>
    <div id="passwordSuccess" style="display: none;">
      <div class="icon">✓</div>
      <h1 style="color: #22c55e;">Password Updated!</h1>
      <p>Your password has been successfully changed.</p>
      <p>You can now return to the <span style="color: #f97316; font-weight: 600;">MayaMind</span> app and sign in with your new password.</p>
      <p style="margin-top: 24px; font-size: 14px;">You may close this browser tab.</p>
    </div>
    <div id="errorView" style="display: none;">
      <div class="icon">⚠️</div>
      <h1 style="color: #ef4444;">Error</h1>
      <p id="errorMessage">Something went wrong.</p>
      <p>Please try again from the MayaMind app.</p>
    </div>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
  <script>
    const supabaseClient = window.supabase.createClient(
      'https://plroxdjxliuecdfjjmyz.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBscm94ZGp4bGl1ZWNkZmpqbXl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTIyNDEsImV4cCI6MjA4NzI4ODI0MX0.Il6D6yjKHugnZWyT71VSGoVh3RCpmFcaTtoA7WFgL9o'
    );

    const views = {
      loading: document.getElementById('loading'),
      passwordReset: document.getElementById('passwordReset'),
      emailVerified: document.getElementById('emailVerified'),
      passwordSuccess: document.getElementById('passwordSuccess'),
      errorView: document.getElementById('errorView')
    };

    function showView(viewName, errorMsg) {
      Object.values(views).forEach(v => v.style.display = 'none');
      views[viewName].style.display = 'block';
      if (errorMsg) document.getElementById('errorMessage').textContent = errorMsg;
    }

    async function init() {
      try {
        // Parse auth params from BOTH query string and hash fragment
        const queryParams = new URLSearchParams(window.location.search);
        const hashParams = window.location.hash ? new URLSearchParams(window.location.hash.substring(1)) : null;

        // Get auth type and tokens from either location
        const type = queryParams.get('type') || (hashParams && hashParams.get('type'));
        const accessToken = hashParams && hashParams.get('access_token');
        const refreshToken = hashParams && hashParams.get('refresh_token');
        const code = queryParams.get('code');
        const tokenHash = queryParams.get('token_hash');

        console.log('Auth params:', { type, hasAccessToken: !!accessToken, hasCode: !!code, hasTokenHash: !!tokenHash });
        console.log('Full URL:', window.location.href);

        // Handle implicit flow (tokens in hash)
        if (accessToken && refreshToken) {
          console.log('Implicit flow: setting session from hash tokens');
          const { error } = await supabaseClient.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          });
          if (error) throw new Error('Session error: ' + error.message);
        }
        // Handle PKCE flow (code in query)
        else if (code) {
          console.log('PKCE flow: exchanging code for session');
          const { error } = await supabaseClient.auth.exchangeCodeForSession(code);
          if (error) throw new Error('Code exchange failed: ' + error.message);
        }

        // Verify we have a session
        const { data: { session } } = await supabaseClient.auth.getSession();
        console.log('Session:', session ? 'exists' : 'none');

        // Route based on auth type
        if (type === 'recovery') {
          if (!session) throw new Error('Reset link expired. Please request a new one.');
          showView('passwordReset');
        } else if (type === 'signup' || tokenHash) {
          showView('emailVerified');
        } else if (session) {
          // Has session but unknown type - probably recovery
          showView('passwordReset');
        } else {
          // No auth params and no session - redirect to dashboard
          window.location.href = '/dashboard/';
        }

      } catch (err) {
        console.error('Init error:', err);
        showView('errorView', err.message);
      }
    }

    // Handle password reset form
    document.getElementById('resetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const confirmPassword = document.getElementById('confirmPassword').value;
      const messageEl = document.getElementById('message');
      const submitBtn = document.getElementById('submitBtn');

      messageEl.textContent = '';

      if (password !== confirmPassword) {
        messageEl.className = 'error';
        messageEl.textContent = 'Passwords do not match';
        return;
      }
      if (password.length < 8) {
        messageEl.className = 'error';
        messageEl.textContent = 'Password must be at least 8 characters';
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Updating...';

      try {
        const { error } = await supabaseClient.auth.updateUser({ password });
        if (error) throw error;

        await supabaseClient.auth.signOut();
        showView('passwordSuccess');
      } catch (err) {
        console.error('Update error:', err);
        messageEl.className = 'error';
        messageEl.textContent = err.message || 'Failed to update password';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Update Password';
      }
    });

    init();
  </script>
</body>
</html>
`;

// Handle Supabase auth callbacks at root
app.get('/', (req, res, next) => {
  const { type, code, token_hash } = req.query;

  // If there are auth-related query params, serve the auth callback page
  if (type || code || token_hash) {
    return res.send(AUTH_CALLBACK_HTML);
  }

  // Otherwise, pass to static file handler (public/index.html)
  // But first check if this might be an implicit flow callback (hash fragment)
  // We can't detect hash on server, so we'll handle it client-side
  // by redirecting to a known auth callback route
  next();
});

// Dedicated auth callback route (handles implicit flow where hash isn't visible to server)
app.get('/auth/callback', (req, res) => {
  res.send(AUTH_CALLBACK_HTML);
});

// App redirect - redirects from web to native app via custom URL scheme
// This is needed because email clients can't directly open custom URL schemes
app.get('/app-reset', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Reset Password - MayaMind</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0a0a10;
          color: white;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          text-align: center;
        }
        .container { padding: 40px; max-width: 400px; }
        .icon { font-size: 60px; margin-bottom: 20px; }
        h1 { color: #f97316; margin-bottom: 16px; }
        p { color: #9ca3af; line-height: 1.6; margin-bottom: 24px; }
        .button {
          display: inline-block; padding: 16px 32px;
          background: #f97316; color: white; text-decoration: none;
          border-radius: 12px; font-weight: 600; font-size: 18px;
          -webkit-tap-highlight-color: transparent;
        }
        .button:active { background: #ea580c; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">🔐</div>
        <h1>Reset Your Password</h1>
        <p>Tap the button below to open MayaMind and set your new password.</p>
        <a id="openApp" class="button" href="#">Open MayaMind App</a>
      </div>
      <script>
        // Build the app URL with the hash fragment
        const appUrl = 'mayamind://auth/callback' + window.location.hash;
        console.log('App URL:', appUrl);

        // Set the href directly - Safari requires this for custom URL schemes
        const button = document.getElementById('openApp');
        button.href = appUrl;

        // Also handle click event as backup
        button.addEventListener('click', function(e) {
          // Try iframe method (works on some iOS versions)
          const iframe = document.createElement('iframe');
          iframe.style.display = 'none';
          iframe.src = appUrl;
          document.body.appendChild(iframe);

          // Also try location change after small delay
          setTimeout(function() {
            window.location.href = appUrl;
          }, 100);
        });
      </script>
    </body>
    </html>
  `);
});

// Serve frontend from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve exercise POC from exercise-poc/
app.use('/exercise-poc', express.static(path.join(__dirname, '..', 'exercise-poc')));

// Serve unified dashboard
app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));

// Serve landing page images
app.use('/images', express.static(path.join(__dirname, '..', 'images')));

// ── GET /api/config — Public config for browser (Supabase URL + anon key) ────
app.get('/api/config', (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || null,
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || null,
  });
});

// ── POST /api/setup-templates-table — Create Supabase templates table ────────
app.post('/api/setup-templates-table', async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const sql = `
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

    -- Enable RLS
    ALTER TABLE exercise_templates ENABLE ROW LEVEL SECURITY;

    -- Drop existing policy if it exists, then create new one
    DROP POLICY IF EXISTS "Allow anonymous access" ON exercise_templates;
    CREATE POLICY "Allow anonymous access" ON exercise_templates
      FOR ALL
      USING (true)
      WITH CHECK (true);
  `;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    // If exec_sql RPC doesn't exist, try the raw SQL endpoint
    if (!response.ok) {
      // Use Supabase's SQL endpoint directly
      const sqlResponse = await fetch(`${SUPABASE_URL}/rest/v1/`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
          'Prefer': 'return=minimal',
        },
      });

      // Return instructions if direct creation fails
      return res.json({
        success: false,
        message: 'Please create the table manually in Supabase SQL Editor',
        sql: sql.trim(),
      });
    }

    res.json({ success: true, message: 'Table created successfully' });
  } catch (err) {
    console.error('Setup table error:', err);
    res.json({
      success: false,
      message: 'Please create the table manually in Supabase SQL Editor',
      sql: sql.trim(),
    });
  }
});

// ── POST /api/setup-preferences-table — Create Supabase preferences table ───
app.post('/api/setup-preferences-table', async (req, res) => {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const sql = `
    CREATE TABLE IF NOT EXISTS user_preferences (
      device_id TEXT NOT NULL,
      category TEXT NOT NULL,
      preferences JSONB NOT NULL DEFAULT '{}',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      PRIMARY KEY (device_id, category)
    );

    CREATE INDEX IF NOT EXISTS idx_user_preferences_device ON user_preferences(device_id);

    ALTER TABLE user_preferences ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Allow anonymous access" ON user_preferences;
    CREATE POLICY "Allow anonymous access" ON user_preferences
      FOR ALL
      USING (true)
      WITH CHECK (true);
  `;

  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!response.ok) {
      return res.json({
        success: false,
        message: 'Please create the table manually in Supabase SQL Editor',
        sql: sql.trim(),
      });
    }

    res.json({ success: true, message: 'Preferences table created successfully' });
  } catch (err) {
    console.error('Setup preferences table error:', err);
    res.json({
      success: false,
      message: 'Please create the table manually in Supabase SQL Editor',
      sql: sql.trim(),
    });
  }
});

// Serve exercise POC from exercise-poc/ (separate mini-project)
app.use('/exercise', express.static(path.join(__dirname, '..', 'exercise-poc')));

// ── Anthropic client ──────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function buildSystemPrompt(timezone) {
  const tz = timezone || 'America/Los_Angeles';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  });

  return `You are Maya, a warm and caring wellness companion for seniors. You speak in short, clear sentences. Keep responses to 2-3 sentences maximum — this is a spoken conversation, not written text. Be encouraging, patient, and positive. Never use markdown, bullet points, or special formatting — your words will be spoken aloud by a text-to-speech engine, so write only plain spoken words. Never use symbols like °, ", %, or other special characters — always spell them out (for example say "degrees" instead of °, "percent" instead of %, "inches" instead of "). Speak naturally as if talking to a friend.

Current date and time: ${dateStr}, ${timeStr} (${tz}).
Use this to answer questions about "today", "tomorrow", "this week", etc.

IMPORTANT: Begin every response with a mood tag [MOOD:xxx] where xxx is one of: neutral, happy, angry, sad, fear, disgust, love, sleep.

Choose the mood that best serves the user emotionally:
- User is happy or positive → [MOOD:happy]
- User is angry or frustrated → [MOOD:neutral] (stay calm, de-escalate)
- User is sad or lonely → [MOOD:love] (warm, empathetic)
- User is fearful or anxious → [MOOD:neutral] (calm, reassuring)
- User is disgusted or annoyed → [MOOD:neutral] (understanding, non-judgmental)
- User expresses love or gratitude → [MOOD:love]
- User seems tired or sleepy → [MOOD:happy] (gently encouraging)
- Default or unclear → [MOOD:neutral]

The tag must be the very first text, followed by a space, then your spoken words. Do NOT include the mood tag anywhere else in your response — only at the very beginning. Example: [MOOD:happy] That sounds wonderful!

When the user asks about current events, weather, news, sports scores, recent happenings, or anything that requires up-to-date information, use your web search tool to find accurate answers. Present search results naturally in conversation — never mention URLs, sources, or that you "searched the web." Just share the information as if you know it. Keep your answer to 2-3 sentences even when using search results.`;
}

// ── POST /api/chat — Anthropic streaming proxy (SSE) ─────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages, timezone } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: buildSystemPrompt(timezone),
      tools: [
        { type: 'web_search_20250305', name: 'web_search', max_uses: 2 }
      ],
      messages,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('Anthropic stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    await stream.finalMessage();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Anthropic error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ── POST /api/chat/exercise — Exercise coaching with custom system prompt ───
app.post('/api/chat/exercise', async (req, res) => {
  const { messages, systemPrompt } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (!systemPrompt) {
    return res.status(400).json({ error: 'systemPrompt is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 150,  // Shorter responses for exercise coaching
      system: systemPrompt,
      messages,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('Anthropic stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    await stream.finalMessage();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('Anthropic error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ── POST /api/extract-personality — Extract personality signals from transcript ─
// Used by the personalization system to analyze conversations
app.post('/api/extract-personality', async (req, res) => {
  const { transcript, systemPrompt } = req.body;

  console.log('[ExtractAPI] Received extraction request');
  console.log('[ExtractAPI] Transcript length:', transcript?.length || 0, 'chars');

  if (!transcript || !transcript.trim()) {
    return res.status(400).json({ error: 'transcript is required' });
  }

  if (!systemPrompt) {
    return res.status(400).json({ error: 'systemPrompt is required' });
  }

  try {
    console.log('[ExtractAPI] Calling Claude for extraction...');
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: `Analyze this conversation transcript and extract personality signals as specified:\n\n${transcript}`
        }
      ]
    });

    // Extract the text content from the response
    const extractionText = response.content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('');

    console.log('[ExtractAPI] Claude raw response:', extractionText.substring(0, 500) + (extractionText.length > 500 ? '...' : ''));

    // Try to parse as JSON (Claude sometimes wraps in markdown code fences)
    let jsonStr = extractionText.trim();
    const fullFenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
    if (fullFenceMatch) {
      jsonStr = fullFenceMatch[1].trim();
      console.log('[ExtractAPI] Stripped markdown code fences from response');
    } else if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').trim();
      jsonStr = jsonStr.replace(/\n?\s*```$/, '').trim();
      console.log('[ExtractAPI] Stripped opening code fence from response');
    }

    try {
      const extraction = JSON.parse(jsonStr);
      console.log('[ExtractAPI] Parsed successfully. Preferences:', extraction.explicitPreferences?.length || 0,
                  'Observations:', extraction.personalityObservations?.length || 0,
                  'Topics:', extraction.topics?.length || 0);
      res.json({ extraction });
    } catch (parseError) {
      console.log('[ExtractAPI] JSON parse failed:', parseError.message);
      // If parsing fails, return the raw text
      res.json({ extraction: extractionText, parseError: parseError.message });
    }

  } catch (err) {
    console.error('[ExtractAPI] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── TTS text sanitization ────────────────────────────────────────────────────
// Replace symbols that TTS engines mispronounce with spoken equivalents
function sanitizeForTTS(text) {
  return text
    .replace(/°F/g, ' degrees Fahrenheit')
    .replace(/°C/g, ' degrees Celsius')
    .replace(/°/g, ' degrees')
    .replace(/(\d)"/g, '$1 inches')
    .replace(/(\d)'/g, '$1 feet')
    .replace(/(\d)%/g, '$1 percent')
    .replace(/(\d)\s*mph/gi, '$1 miles per hour')
    .replace(/(\d)\s*km\/h/gi, '$1 kilometers per hour')
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ')
    .replace(/\bvs\.?\b/gi, 'versus')
    .replace(/\[MOOD:\w+\]\s*/g, '')     // strip any leaked mood tags
    // Strip emoji Unicode ranges (catch-all for any emojis TTS cannot pronounce)
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '')   // emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '')   // misc symbols & pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '')   // transport & map
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')   // flags
    .replace(/[\u{2600}-\u{26FF}]/gu, '')     // misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')     // dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')     // variation selectors
    .replace(/[\u{200D}]/gu, '')              // zero-width joiner
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '')   // supplemental symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '')   // symbols extended-A
    .replace(/\s{2,}/g, ' ')             // collapse double spaces
    .trim();
}

// ── POST /api/tts — ElevenLabs with-timestamps proxy ─────────────────────────
// Returns JSON: { audio_base64, alignment, normalized_alignment }
// The browser uses audio_base64 + alignment to call head.speakAudio()
app.post('/api/tts', async (req, res) => {
  const { text, voice_settings } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const voiceId = req.body.voice_id || process.env.ELEVENLABS_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;
  const vs = voice_settings || { stability: 0.5, similarity_boost: 0.75 };

  try {
    const elRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
      },
      body: JSON.stringify({
        text: sanitizeForTTS(text),
        model_id: 'eleven_turbo_v2_5',
        voice_settings: vs,
      }),
    });

    if (!elRes.ok) {
      const errBody = await elRes.text();
      console.error(`ElevenLabs error ${elRes.status}:`, errBody);
      return res.status(elRes.status).json({ error: errBody });
    }

    const data = await elRes.json();
    res.json(data);
  } catch (err) {
    console.error('TTS proxy error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── WhatsApp SSE clients ──────────────────────────────────────────────────────
const whatsappSSEClients = new Set();

function broadcastWhatsAppMessage(msg) {
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const client of whatsappSSEClients) {
    client.write(data);
  }
}

// ── GET /api/whatsapp/events — SSE stream for real-time WhatsApp notifications ─
app.get('/api/whatsapp/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  whatsappSSEClients.add(res);
  req.on('close', () => {
    whatsappSSEClients.delete(res);
    clearInterval(heartbeat);
  });

  // Heartbeat every 30 seconds
  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
});

// ── POST /api/whatsapp/send — Send a WhatsApp message (text or voice) ─────────
app.post('/api/whatsapp/send', upload.single('audio'), async (req, res) => {
  if (!twilioClient) {
    return res.status(500).json({ error: 'Twilio not configured' });
  }

  const { to, body } = req.body;
  if (!to) return res.status(400).json({ error: 'to is required' });

  try {
    if (req.file) {
      // Voice message — convert WebM/Opus → MP3 (universally supported by WhatsApp)
      const webmPath = req.file.path;
      const mp3Filename = req.file.filename.replace('.webm', '.mp3');
      const mp3Path = path.join(tempDir, mp3Filename);

      await new Promise((resolve, reject) => {
        execFile('ffmpeg', [
          '-i', webmPath,
          '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '1',
          '-y', mp3Path,
        ], (err, stdout, stderr) => {
          if (err) { console.error('[WhatsApp] ffmpeg error:', stderr); reject(err); }
          else resolve();
        });
      });
      console.log(`[WhatsApp] Converted ${req.file.filename} → ${mp3Filename}`);

      const ngrokUrl = process.env.NGROK_URL || `${req.protocol}://${req.get('host')}`;
      const publicUrl = `${ngrokUrl}/api/whatsapp/media/${mp3Filename}`;

      console.log(`[WhatsApp] Sending voice message to ${to}, mediaUrl: ${publicUrl}`);

      const message = await twilioClient.messages.create({
        from: process.env.TWILIO_WHATSAPP_NUMBER,
        to: `whatsapp:${to}`,
        mediaUrl: [publicUrl],
      });
      console.log(`[WhatsApp] Voice message accepted, SID: ${message.sid}`);
      return res.json({ success: true, messageSid: message.sid });
    }

    // Text message
    if (!body) return res.status(400).json({ error: 'body is required for text messages' });

    const message = await twilioClient.messages.create({
      from: process.env.TWILIO_WHATSAPP_NUMBER,
      to: `whatsapp:${to}`,
      body,
    });
    res.json({ success: true, messageSid: message.sid });

  } catch (err) {
    console.error('[WhatsApp] Send error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/whatsapp/webhook — Receive incoming WhatsApp messages ───────────
app.post('/api/whatsapp/webhook', async (req, res) => {
  const { From, Body, NumMedia, MediaUrl0, MediaContentType0 } = req.body;

  console.log(`[WhatsApp] Incoming from ${From}: ${Body || '(media)'}`);

  // Strip 'whatsapp:' prefix from phone number
  const phone = From ? From.replace('whatsapp:', '') : '';

  let localMediaUrl = null;
  let mediaType = null;

  // If the message has media, download it from Twilio (requires auth) and save locally
  if (parseInt(NumMedia) > 0 && MediaUrl0) {
    mediaType = MediaContentType0 || 'audio/ogg';
    try {
      const ext = mediaType.includes('ogg') ? '.ogg'
        : mediaType.includes('mp3') || mediaType.includes('mpeg') ? '.mp3'
        : mediaType.includes('mp4') ? '.mp4'
        : mediaType.includes('jpeg') || mediaType.includes('jpg') ? '.jpg'
        : mediaType.includes('png') ? '.png'
        : mediaType.includes('gif') ? '.gif'
        : mediaType.includes('webp') ? '.webp'
        : '.bin';
      const localFilename = `incoming-${Date.now()}${ext}`;
      const localPath = path.join(tempDir, localFilename);

      // Fetch from Twilio with Basic Auth
      const authHeader = 'Basic ' + Buffer.from(
        `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
      ).toString('base64');

      const mediaRes = await fetch(MediaUrl0, {
        headers: { Authorization: authHeader },
      });

      if (mediaRes.ok) {
        const buffer = Buffer.from(await mediaRes.arrayBuffer());
        fs.writeFileSync(localPath, buffer);
        localMediaUrl = `/api/whatsapp/media/${localFilename}`;
        console.log(`[WhatsApp] Downloaded media: ${localFilename} (${buffer.length} bytes, ${mediaType})`);
      } else {
        console.error(`[WhatsApp] Failed to download media: ${mediaRes.status}`);
      }
    } catch (err) {
      console.error('[WhatsApp] Media download error:', err.message);
    }
  }

  const msg = {
    type: 'message',
    from: phone,
    body: Body || '',
    mediaUrl: localMediaUrl,
    mediaType: mediaType,
    timestamp: new Date().toISOString(),
  };

  // Push to all SSE clients
  broadcastWhatsAppMessage(msg);

  // Return empty TwiML (no auto-reply)
  res.type('text/xml');
  res.send('<Response></Response>');
});

// ── GET /api/whatsapp/media/:filename — Serve media files (audio, images) ─────
app.get('/api/whatsapp/media/:filename', (req, res) => {
  const filePath = path.join(tempDir, req.params.filename);
  console.log(`[WhatsApp] Media fetch: ${req.params.filename} from ${req.get('user-agent') || 'unknown'}`);
  if (!fs.existsSync(filePath)) {
    console.warn(`[WhatsApp] Media file not found: ${filePath}`);
    return res.status(404).json({ error: 'File not found' });
  }
  const ext = path.extname(req.params.filename).toLowerCase();
  const CONTENT_TYPES = {
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.webm': 'audio/webm', '.mp4': 'audio/mp4',
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.webp': 'image/webp',
  };
  res.setHeader('Content-Type', CONTENT_TYPES[ext] || 'application/octet-stream');
  res.sendFile(filePath);
});

// ── Connect section system prompt ─────────────────────────────────────────────
function buildConnectSystemPrompt(timezone, contacts) {
  const tz = timezone || 'America/Los_Angeles';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  });

  const contactList = contacts && contacts.length > 0
    ? contacts.map(c => `- ${c.name}: ${c.phone}`).join('\n')
    : 'No contacts yet.';

  return `You are Maya, a warm and caring companion helping a senior stay connected with loved ones via WhatsApp messages.

Current contacts:
${contactList}

Current date and time: ${dateStr}, ${timeStr} (${tz}).

RULES:
- Short responses (1-2 sentences). This is spoken conversation.
- Never use markdown, symbols, or special characters. Spell out numbers naturally.
- Begin every response with [MOOD:xxx] tag where xxx is one of: neutral, happy, angry, sad, fear, disgust, love, sleep.
- Use [ACTION:xxx] tags when you need the app to do something (see below).
- Be warm, patient, and encouraging. Seniors may mishear or need to repeat.
- When collecting phone numbers, always repeat them back for confirmation before adding.
- If a contact name is ambiguous, ask to clarify.
- After completing an action, ask if they want to do something else.
- Phone numbers must include country code (e.g., +14085551234).

EMOJI HANDLING FOR OUTGOING MESSAGES:
- When the user describes an emoji verbally (e.g., "with a heart", "smiley face", "thumbs up"), include the actual emoji in the SEND_TEXT message parameter.
- Common verbal-to-emoji: "heart" → ❤️, "smile"/"smiley" → 😊, "laugh"/"haha" → 😂, "thumbs up" → 👍, "hug"/"hugs" → 🤗, "kiss" → 😘, "pray"/"folded hands" → 🙏, "flowers" → 💐, "wave" → 👋, "party"/"celebrate" → 🎉
- Only add emojis when the user explicitly describes them. Never add emojis on your own.
- In your spoken confirmation, describe the emoji naturally (e.g., "I'll send Carol: I miss you, with a heart").

ACTIONS (place AFTER the mood tag, BEFORE your spoken words):
[ACTION:ADD_CONTACT name="Carol" phone="+14085551234"]
[ACTION:SEND_TEXT to="Carol" message="Hi Carol, thinking of you!"]
[ACTION:SEND_VOICE to="Carol"]
[ACTION:PLAY_MESSAGE]
[ACTION:CANCEL]

FLOW EXAMPLES:
- Adding contact: Collect name, then collect phone number, then repeat number back for confirmation, then on user confirmation use [ACTION:ADD_CONTACT].
- Sending text: Identify which contact, ask what to say, user dictates the message, repeat message back for confirmation, then on user confirmation use [ACTION:SEND_TEXT].
- Sending voice: Identify which contact, confirm they want voice, then use [ACTION:SEND_VOICE] and say "Go ahead, I'm recording."
- Playing messages: If unread messages exist, use [ACTION:PLAY_MESSAGE] and Maya will read them.
- After sending: Confirm delivery, ask if they want to send another or do something else.

The tag must be the very first text, followed by any action tag, then your spoken words. Example:
[MOOD:happy] [ACTION:ADD_CONTACT name="Carol" phone="+14085551234"] I've added Carol to your contacts! Would you like to send her a message?`;
}

// ── POST /api/chat/connect — Claude streaming for Connect section ─────────────
app.post('/api/chat/connect', async (req, res) => {
  const { messages, timezone, contacts } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: buildConnectSystemPrompt(timezone, contacts),
      messages,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('[Connect Chat] stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    await stream.finalMessage();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[Connect Chat] error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ── Health Chat — System prompt + endpoint ──────────────────────────────────────

function buildHealthSystemPrompt(timezone, vitals, withingsData) {
  const tz = timezone || 'America/Los_Angeles';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz,
  });
  const timeStr = now.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: tz,
  });

  // Format current vitals for context
  let vitalsContext = 'No health data available yet.';
  if (vitals) {
    const v = vitals.vitals || {};
    const parts = [];
    if (v.heartRate?.value != null) parts.push(`Heart Rate: ${Math.round(v.heartRate.value)} BPM`);
    if (v.hrv?.value != null) parts.push(`HRV: ${Math.round(v.hrv.value)} ms`);
    if (v.spo2?.value != null) parts.push(`SpO2: ${Math.round(v.spo2.value)} percent`);
    if (v.steps?.value != null) parts.push(`Steps today: ${v.steps.value}`);
    if (v.moveMinutes?.value != null) parts.push(`Move minutes: ${Math.round(v.moveMinutes.value)}`);
    if (v.exerciseMinutes?.value != null) parts.push(`Exercise minutes: ${Math.round(v.exerciseMinutes.value)}`);
    if (vitals.sleep) {
      const hrs = Math.floor(vitals.sleep.totalHours);
      const mins = Math.round((vitals.sleep.totalHours - hrs) * 60);
      parts.push(`Last night sleep: ${hrs} hours ${mins} minutes`);
    }
    if (parts.length > 0) vitalsContext = parts.join('\n');
  }

  let bodyContext = '';
  if (withingsData?.measures) {
    const m = withingsData.measures;
    const bodyParts = [];
    if (m.weight) bodyParts.push(`Weight: ${(m.weight.value * 2.20462).toFixed(1)} lbs`);
    if (m.fatPercent) bodyParts.push(`Body fat: ${m.fatPercent.value.toFixed(1)} percent`);
    if (m.muscleMass) bodyParts.push(`Muscle mass: ${(m.muscleMass.value * 2.20462).toFixed(1)} lbs`);
    if (bodyParts.length > 0) bodyContext = '\n\nBody Composition:\n' + bodyParts.join('\n');
  }

  return `You are Maya, a warm and caring wellness companion for seniors. You are currently in the Health Monitoring section, helping the user understand their health data from their Apple Watch and smart scale.

Current date and time: ${dateStr}, ${timeStr} (${tz}).

CURRENT HEALTH DATA:
${vitalsContext}${bodyContext}

RULES:
- Short responses (2-3 sentences maximum). This is a spoken conversation.
- Never use markdown, bullet points, or special formatting. Your words will be spoken aloud.
- Never use symbols like degrees, percent sign, or other special characters — always spell them out.
- Begin every response with a mood tag [MOOD:xxx] where xxx is one of: neutral, happy, angry, sad, fear, disgust, love, sleep.
- Be warm, encouraging, and reassuring. Many seniors worry about health numbers.
- When discussing vitals, provide context (e.g., "Your heart rate of 72 is right in the healthy range").
- NEVER diagnose medical conditions. If the user asks medical questions, gently suggest discussing with their doctor.
- If asked about vitals not currently available, say they are not being tracked right now.
- Proactively offer helpful observations about the data when asked.
- If the user asks about trends, refer to what you can see in the current data.

Choose the mood that best serves the user emotionally:
- Good health data → [MOOD:happy]
- User is worried → [MOOD:neutral] (calm, reassuring)
- User is confused → [MOOD:neutral] (patient, explaining)
- User is happy about progress → [MOOD:happy]
- Default → [MOOD:neutral]

The tag must be the very first text, followed by a space, then your spoken words.`;
}

app.post('/api/chat/health', async (req, res) => {
  const { messages, timezone, vitals, withingsData } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 300,
      system: buildHealthSystemPrompt(timezone, vitals, withingsData),
      messages,
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('[Health Chat] stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    await stream.finalMessage();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[Health Chat] error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ── ToDos Chat — Custom system prompt for JSON parsing ──────────────────────────
app.post('/api/chat/todos', async (req, res) => {
  const { message, system } = req.body;

  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (!system) {
    return res.status(400).json({ error: 'system prompt is required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 500,
      system: system,
      messages: [{ role: 'user', content: message }],
    });

    stream.on('text', (text) => {
      res.write(`data: ${JSON.stringify({ text })}\n\n`);
    });

    stream.on('error', (err) => {
      console.error('[ToDos Chat] stream error:', err.message);
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    });

    await stream.finalMessage();
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[ToDos Chat] error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    } else {
      res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
      res.end();
    }
  }
});

// ── Health Monitoring — In-memory vitals store ──────────────────────────────────
const healthVitals = {
  latest: null,           // Most recent vitals payload from iPhone companion
  history: [],            // Ring buffer of readings (max 60, ~1 per minute)
  maxHistory: 60,
  withingsTokens: null,   // { accessToken, refreshToken, expiresAt }
  withingsData: null,     // Latest Withings body composition
};

// ── Health SSE clients ────────────────────────────────────────────────────────
const healthSSEClients = new Set();

function broadcastHealthUpdate(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of healthSSEClients) {
    client.write(msg);
  }
}

// ── GET /api/health/events — SSE stream for real-time health updates ─────────
app.get('/api/health/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  healthSSEClients.add(res);

  // Send current state immediately so client doesn't start blank
  if (healthVitals.latest) {
    res.write(`data: ${JSON.stringify({ type: 'vitals', ...healthVitals.latest })}\n\n`);
  }
  if (healthVitals.withingsData) {
    res.write(`data: ${JSON.stringify({ type: 'withings', ...healthVitals.withingsData })}\n\n`);
  }

  const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 30000);
  req.on('close', () => {
    healthSSEClients.delete(res);
    clearInterval(heartbeat);
  });
});

// ── POST /api/health/vitals — Receive vitals from iPhone companion ──────────
app.post('/api/health/vitals', (req, res) => {
  const payload = req.body;
  if (!payload || !payload.timestamp) {
    return res.status(400).json({ error: 'Missing timestamp' });
  }

  healthVitals.latest = payload;
  healthVitals.history.push({ ...payload, receivedAt: Date.now() });
  if (healthVitals.history.length > healthVitals.maxHistory) {
    healthVitals.history.shift();
  }

  broadcastHealthUpdate({ type: 'vitals', ...payload });
  console.log(`[Health] Received vitals from ${payload.deviceName || 'unknown'}`);
  res.json({ ok: true });
});

// ── GET /api/health/vitals/latest — iPad pulls current state ─────────────────
app.get('/api/health/vitals/latest', (req, res) => {
  res.json({
    latest: healthVitals.latest,
    history: healthVitals.history,
    withings: healthVitals.withingsData,
  });
});

// ── GET /api/health/test — Generate mock vitals for UI testing ──────────────
app.get('/api/health/test', (req, res) => {
  const now = new Date().toISOString();
  const mockPayload = {
    timestamp: now,
    deviceName: 'Test Device',
    vitals: {
      heartRate: { value: 68 + Math.floor(Math.random() * 15), unit: 'BPM', timestamp: now, range24h: { min: 55 + Math.floor(Math.random() * 5), max: 120 + Math.floor(Math.random() * 30) } },
      hrv: { value: 35 + Math.floor(Math.random() * 25), unit: 'ms', timestamp: now, range24h: { min: 18 + Math.floor(Math.random() * 10), max: 65 + Math.floor(Math.random() * 20) } },
      spo2: { value: 95 + Math.floor(Math.random() * 5), unit: '%', timestamp: now, range24h: { min: 93 + Math.floor(Math.random() * 3), max: 98 + Math.floor(Math.random() * 2) } },
      steps: { value: 2000 + Math.floor(Math.random() * 5000), unit: 'count', sinceDate: now.split('T')[0] + 'T00:00:00' },
      moveMinutes: { value: 20 + Math.floor(Math.random() * 60), unit: 'min', sinceDate: now.split('T')[0] + 'T00:00:00' },
      exerciseMinutes: { value: 5 + Math.floor(Math.random() * 30), unit: 'min', sinceDate: now.split('T')[0] + 'T00:00:00' },
    },
    sleep: {
      totalHours: 6.5 + Math.random() * 2,
      stages: { deep: 0.8 + Math.random(), core: 3 + Math.random() * 2, rem: 1 + Math.random(), awake: 0.2 + Math.random() * 0.5 },
      startTime: '2026-02-28T22:30:00',
      endTime: '2026-03-01T06:00:00',
    },
  };

  // Store and broadcast like a real push
  healthVitals.latest = mockPayload;
  healthVitals.history.push({ ...mockPayload, receivedAt: Date.now() });
  if (healthVitals.history.length > healthVitals.maxHistory) {
    healthVitals.history.shift();
  }
  broadcastHealthUpdate({ type: 'vitals', ...mockPayload });

  // Also broadcast mock Withings body composition if not already connected
  if (!healthVitals.withingsData) {
    const mockWithings = {
      measures: {
        weight: { value: 72 + Math.random() * 10, timestamp: now },
        fatPercent: { value: 18 + Math.random() * 12, timestamp: now },
        visceralFat: { value: 5 + Math.floor(Math.random() * 10), timestamp: now },
        boneMass: { value: 2.5 + Math.random() * 1.5, timestamp: now },
        muscleMass: { value: 28 + Math.random() * 8, timestamp: now },
      },
      fetchedAt: now,
    };
    healthVitals.withingsData = mockWithings;
    broadcastHealthUpdate({ type: 'withings', ...mockWithings });
  }

  console.log('[Health] Sent mock vitals + body composition');
  res.json({ ok: true, mock: mockPayload });
});

// ── Withings OAuth2 (optional — only if configured) ─────────────────────────
const WITHINGS_CLIENT_ID = process.env.WITHINGS_CLIENT_ID;
const WITHINGS_CLIENT_SECRET = process.env.WITHINGS_CLIENT_SECRET;
const withingsConfigured = !!(WITHINGS_CLIENT_ID && WITHINGS_CLIENT_SECRET);
if (withingsConfigured) console.log('[Withings] Client configured');

// GET /api/health/withings/status — Check if Withings is configured
app.get('/api/health/withings/status', (req, res) => {
  res.json({
    configured: withingsConfigured,
    connected: !!(healthVitals.withingsTokens && healthVitals.withingsTokens.accessToken),
  });
});

// GET /api/health/withings/auth — Start OAuth2 flow
app.get('/api/health/withings/auth', (req, res) => {
  if (!withingsConfigured) {
    return res.status(500).json({ error: 'Withings not configured' });
  }
  const ngrokUrl = process.env.NGROK_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUri = `${ngrokUrl}/api/health/withings/callback`;
  const authUrl = `https://account.withings.com/oauth2_user/authorize2?response_type=code&client_id=${WITHINGS_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user.metrics&state=mayamind`;
  res.redirect(authUrl);
});

// GET /api/health/withings/callback — Handle OAuth2 callback
app.get('/api/health/withings/callback', async (req, res) => {
  const { code } = req.query;
  if (!code) return res.status(400).send('Missing authorization code');

  const ngrokUrl = process.env.NGROK_URL || `${req.protocol}://${req.get('host')}`;
  const redirectUri = `${ngrokUrl}/api/health/withings/callback`;

  try {
    const tokenRes = await fetch('https://wbsapi.withings.net/v2/oauth2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        action: 'requesttoken',
        grant_type: 'authorization_code',
        client_id: WITHINGS_CLIENT_ID,
        client_secret: WITHINGS_CLIENT_SECRET,
        code,
        redirect_uri: redirectUri,
      }),
    });
    const tokenData = await tokenRes.json();

    if (tokenData.status !== 0) {
      console.error('[Withings] Token exchange failed:', tokenData);
      return res.status(400).send(`Withings error: ${JSON.stringify(tokenData)}`);
    }

    healthVitals.withingsTokens = {
      accessToken: tokenData.body.access_token,
      refreshToken: tokenData.body.refresh_token,
      expiresAt: Date.now() + tokenData.body.expires_in * 1000,
    };
    console.log('[Withings] OAuth tokens obtained');

    // Redirect back to dashboard health section
    res.redirect('/dashboard#health');
  } catch (err) {
    console.error('[Withings] OAuth callback error:', err.message);
    res.status(500).send('OAuth error: ' + err.message);
  }
});

// GET /api/health/withings/data — Fetch latest body composition
app.get('/api/health/withings/data', async (req, res) => {
  if (!healthVitals.withingsTokens || !healthVitals.withingsTokens.accessToken) {
    return res.status(401).json({ error: 'Withings not connected' });
  }

  // Refresh token if expired
  if (Date.now() > healthVitals.withingsTokens.expiresAt - 60000) {
    try {
      const refreshRes = await fetch('https://wbsapi.withings.net/v2/oauth2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          action: 'requesttoken',
          grant_type: 'refresh_token',
          client_id: WITHINGS_CLIENT_ID,
          client_secret: WITHINGS_CLIENT_SECRET,
          refresh_token: healthVitals.withingsTokens.refreshToken,
        }),
      });
      const refreshData = await refreshRes.json();
      if (refreshData.status === 0) {
        healthVitals.withingsTokens = {
          accessToken: refreshData.body.access_token,
          refreshToken: refreshData.body.refresh_token,
          expiresAt: Date.now() + refreshData.body.expires_in * 1000,
        };
        console.log('[Withings] Token refreshed');
      } else {
        console.error('[Withings] Token refresh failed:', refreshData);
        return res.status(401).json({ error: 'Token refresh failed' });
      }
    } catch (err) {
      console.error('[Withings] Token refresh error:', err.message);
      return res.status(500).json({ error: 'Token refresh error' });
    }
  }

  try {
    const measRes = await fetch('https://wbsapi.withings.net/measure?action=getmeas&meastypes=1,6,8,76,88,170&category=1&lastupdate=' + Math.floor((Date.now() - 30 * 24 * 3600 * 1000) / 1000), {
      headers: { Authorization: `Bearer ${healthVitals.withingsTokens.accessToken}` },
    });
    const measData = await measRes.json();

    if (measData.status !== 0) {
      console.error('[Withings] Measure API error:', measData);
      return res.status(400).json({ error: 'Withings API error' });
    }

    // Parse Withings measure groups — extract latest values
    // meastypes: 1=weight, 6=fat ratio, 8=fat mass, 76=muscle mass, 88=bone mass, 170=visceral fat
    const measures = {};
    const typeNames = { 1: 'weight', 6: 'fatPercent', 8: 'fatMass', 76: 'muscleMass', 88: 'boneMass', 170: 'visceralFat' };
    const groups = measData.body?.measuregrps || [];

    for (const group of groups) {
      for (const m of group.measures || []) {
        const name = typeNames[m.type];
        if (name && !measures[name]) {
          measures[name] = {
            value: m.value * Math.pow(10, m.unit),
            timestamp: new Date(group.date * 1000).toISOString(),
          };
        }
      }
    }

    // Calculate BMI if we have weight (assume height from profile or skip)
    if (measures.weight) {
      // Withings weight is in kg
      measures.weightLbs = { value: (measures.weight.value * 2.20462).toFixed(1), timestamp: measures.weight.timestamp };
    }

    healthVitals.withingsData = { measures, fetchedAt: new Date().toISOString() };
    broadcastHealthUpdate({ type: 'withings', ...healthVitals.withingsData });
    console.log('[Withings] Data fetched:', Object.keys(measures).join(', '));
    res.json(healthVitals.withingsData);
  } catch (err) {
    console.error('[Withings] Data fetch error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── HTTP server + WebSocket upgrade routing ───────────────────────────────────
const server = http.createServer(app);
const wss = new WebSocket.Server({ noServer: true });

server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/ws/deepgram') {
    wss.handleUpgrade(req, socket, head, (ws) => handleDeepgram(ws));
  } else {
    socket.destroy();
  }
});

// ── Verify Deepgram API key at startup ───────────────────────────────────────
async function verifyDeepgramKey() {
  try {
    const res = await fetch('https://api.deepgram.com/v1/projects', {
      headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
    });
    if (res.ok) {
      const body = await res.json();
      console.log(`  Deepgram: API key valid ✓ (${body.projects?.length || 0} project(s))`);
    } else {
      const errText = await res.text();
      console.error(`  Deepgram: API key INVALID — HTTP ${res.status}: ${errText}`);
    }
  } catch (err) {
    console.error(`  Deepgram: connectivity check failed — ${err.message}`);
  }
}

// ── WS /ws/deepgram — Deepgram streaming STT proxy ───────────────────────────
function handleDeepgram(clientWs) {
  const params = new URLSearchParams({
    model: 'nova-2',           // nova-2 is most broadly available
    language: 'en',
    smart_format: 'true',
    interim_results: 'true',
    endpointing: '500',        // 500ms silence → speech_final:true (primary trigger)
    utterance_end_ms: '1500',  // fallback UtteranceEnd event if speech_final missed
  });

  const dgUrl = `wss://api.deepgram.com/v1/listen?${params}`;

  const dgWs = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
  });

  let dgConnected = false;
  const pendingChunks = [];  // buffer audio arriving before Deepgram WS opens

  // Forward browser messages to Deepgram, preserving frame type.
  // Audio arrives as binary; KeepAlive arrives as text JSON.
  // ws v8+ passes (data, isBinary) — we must use { binary: isBinary }
  // so Deepgram receives text frames as text (required for KeepAlive).
  clientWs.on('message', (data, isBinary) => {
    if (dgWs.readyState === WebSocket.OPEN) {
      // Flush any buffered chunks first (preserves order)
      while (pendingChunks.length > 0) {
        dgWs.send(pendingChunks.shift());
      }
      dgWs.send(data, { binary: isBinary });
    } else if (dgWs.readyState === WebSocket.CONNECTING) {
      pendingChunks.push(data);
    }
  });

  dgWs.on('open', () => {
    dgConnected = true;
    console.log('[Deepgram] upstream connected ✓');
    // Flush any chunks that arrived during the handshake
    while (pendingChunks.length > 0) {
      dgWs.send(pendingChunks.shift());
    }
  });

  // Catch HTTP-level errors during WS handshake (e.g. 401, 402, 403)
  dgWs.on('unexpected-response', (req, res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      console.error(`[Deepgram] handshake rejected — HTTP ${res.statusCode}: ${body}`);
      if (clientWs.readyState < WebSocket.CLOSING) {
        clientWs.close(4000, `Deepgram HTTP ${res.statusCode}`);
      }
    });
  });

  // Forward Deepgram transcriptions → browser
  // ws v8+ passes (data, isBinary). Deepgram sends text frames; we must
  // forward them as text so the browser receives a string, not a Blob.
  dgWs.on('message', (data, isBinary) => {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  dgWs.on('close', (code, reason) => {
    const reasonStr = reason?.toString() || '(none)';
    console.log(`[Deepgram] upstream closed — code: ${code} | reason: ${reasonStr}`);
    if (clientWs.readyState < WebSocket.CLOSING) {
      clientWs.close(code || 1000, reasonStr);
    }
  });

  dgWs.on('error', (err) => {
    console.error('[Deepgram] upstream WS error:', err.message);
    if (clientWs.readyState < WebSocket.CLOSING) clientWs.close();
  });

  clientWs.on('close', (code, reason) => {
    console.log(`[Client] WS closed — code: ${code} | reason: ${reason?.toString() || '(none)'}`);
    if (dgWs.readyState < WebSocket.CLOSING) dgWs.close();
  });

  clientWs.on('error', (err) => console.error('[Client] WS error:', err.message));
}

// ── Auth: 2FA Code Delivery ───────────────────────────────────────────────────

// Resend client for email delivery
let resendClient = null;
if (process.env.RESEND_API_KEY) {
  const { Resend } = require('resend');
  resendClient = new Resend(process.env.RESEND_API_KEY);
  console.log('[Resend] Email client initialized');
}

// POST /api/auth/send-2fa — Send 2FA code via email or SMS
app.post('/api/auth/send-2fa', async (req, res) => {
  const { method, destination, code, userName } = req.body;

  if (!method || !destination || !code) {
    return res.status(400).json({ error: 'Missing required fields: method, destination, code' });
  }

  try {
    if (method === 'email') {
      // Send via Resend
      if (!resendClient) {
        return res.status(500).json({ error: 'Email service not configured' });
      }

      const { error } = await resendClient.emails.send({
        from: 'MayaMind <noreply@mayamind.ai>',
        to: destination,
        subject: 'Your MayaMind Verification Code',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
            <h1 style="color: #FF8C00; margin-bottom: 20px;">MayaMind</h1>
            <p>Hi ${userName || 'there'},</p>
            <p>Your verification code is:</p>
            <div style="background: #f5f5f5; padding: 20px; text-align: center; border-radius: 8px; margin: 20px 0;">
              <span style="font-size: 32px; font-weight: bold; letter-spacing: 8px; color: #333;">${code}</span>
            </div>
            <p>This code will expire in 10 minutes.</p>
            <p style="color: #888; font-size: 14px;">If you didn't request this code, you can safely ignore this email.</p>
            <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
            <p style="color: #888; font-size: 12px;">MayaMind - Your AI Wellness Companion</p>
          </div>
        `,
      });

      if (error) {
        console.error('[Auth] Resend error:', error);
        return res.status(500).json({ error: 'Failed to send email' });
      }

      console.log(`[Auth] 2FA code sent via email to ${destination}`);
      res.json({ success: true, method: 'email' });

    } else if (method === 'sms') {
      // Send via Twilio
      if (!twilioClient) {
        return res.status(500).json({ error: 'SMS service not configured' });
      }

      await twilioClient.messages.create({
        body: `Your MayaMind verification code is: ${code}. This code expires in 10 minutes.`,
        from: process.env.TWILIO_WHATSAPP_NUMBER?.replace('whatsapp:', '') || process.env.TWILIO_PHONE_NUMBER,
        to: destination,
      });

      console.log(`[Auth] 2FA code sent via SMS to ${destination}`);
      res.json({ success: true, method: 'sms' });

    } else {
      res.status(400).json({ error: 'Invalid method. Use "email" or "sms".' });
    }
  } catch (err) {
    console.error('[Auth] Error sending 2FA code:', err);
    res.status(500).json({ error: 'Failed to send verification code' });
  }
});

// ── Auth Callback (email verification redirect) ──────────────────────────────
app.get('/auth/callback', (req, res) => {
  // Supabase redirects here after email verification
  // Show a success page that tells user to return to the app
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta name="viewport" content="width=device-width, initial-scale=1">
      <title>Email Verified - MayaMind</title>
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          background: #0a0a10;
          color: white;
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 100vh;
          margin: 0;
          text-align: center;
        }
        .container {
          padding: 40px;
          max-width: 400px;
        }
        .icon {
          font-size: 80px;
          margin-bottom: 20px;
        }
        h1 {
          color: #22c55e;
          margin-bottom: 16px;
        }
        p {
          color: #9ca3af;
          line-height: 1.6;
        }
        .highlight {
          color: #f97316;
          font-weight: 600;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">✓</div>
        <h1>Email Verified!</h1>
        <p>Your email has been successfully verified.</p>
        <p>You can now return to the <span class="highlight">MayaMind</span> app and sign in with your email and password.</p>
      </div>
    </body>
    </html>
  `);
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, async () => {
  console.log(`MayaMind POC → http://localhost:${PORT}`);
  console.log(`  Dashboard     → http://localhost:${PORT}/dashboard`);
  console.log(`  Exercise POC  → http://localhost:${PORT}/exercise`);
  console.log(`  Model:  claude-sonnet-4-6`);
  console.log(`  Voice:  ${process.env.ELEVENLABS_VOICE_ID}`);
  console.log(`  Twilio: ${twilioClient ? 'configured' : 'not configured (Connect section disabled)'}`);
  console.log(`  Withings: ${withingsConfigured ? 'configured' : 'not configured (body composition disabled)'}`);
  console.log(`  Resend: ${resendClient ? 'configured' : 'not configured (email 2FA disabled)'}`);
  console.log(`  Health test: http://localhost:${PORT}/api/health/test`);
  if (process.env.NGROK_URL) console.log(`  ngrok:  ${process.env.NGROK_URL}`);
  await verifyDeepgramKey();
});
