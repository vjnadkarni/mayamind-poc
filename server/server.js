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

// Serve frontend from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// Serve exercise POC from exercise-poc/
app.use('/exercise-poc', express.static(path.join(__dirname, '..', 'exercise-poc')));

// Serve unified dashboard
app.use('/dashboard', express.static(path.join(__dirname, '..', 'dashboard')));

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

// ── GET /api/whatsapp/media/:filename — Serve uploaded voice files ────────────
app.get('/api/whatsapp/media/:filename', (req, res) => {
  const filePath = path.join(tempDir, req.params.filename);
  console.log(`[WhatsApp] Media fetch: ${req.params.filename} from ${req.get('user-agent') || 'unknown'}`);
  if (!fs.existsSync(filePath)) {
    console.warn(`[WhatsApp] Media file not found: ${filePath}`);
    return res.status(404).json({ error: 'File not found' });
  }
  const ext = path.extname(req.params.filename);
  const contentType = ext === '.mp3' ? 'audio/mpeg' : ext === '.ogg' ? 'audio/ogg' : 'audio/webm';
  res.setHeader('Content-Type', contentType);
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

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, async () => {
  console.log(`MayaMind POC → http://localhost:${PORT}`);
  console.log(`  Dashboard     → http://localhost:${PORT}/dashboard`);
  console.log(`  Exercise POC  → http://localhost:${PORT}/exercise`);
  console.log(`  Model:  claude-sonnet-4-6`);
  console.log(`  Voice:  ${process.env.ELEVENLABS_VOICE_ID}`);
  console.log(`  Twilio: ${twilioClient ? 'configured' : 'not configured (Connect section disabled)'}`);
  if (process.env.NGROK_URL) console.log(`  ngrok:  ${process.env.NGROK_URL}`);
  await verifyDeepgramKey();
});
