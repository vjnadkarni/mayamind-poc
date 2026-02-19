'use strict';

// Load .env from project root (one level up from server/)
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const Anthropic = require('@anthropic-ai/sdk');

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

// Serve frontend from public/
app.use(express.static(path.join(__dirname, '..', 'public')));

// ── Anthropic client ──────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Maya, a warm and caring wellness companion for seniors. You speak in short, clear sentences. Keep responses to 2-3 sentences maximum — this is a spoken conversation, not written text. Be encouraging, patient, and positive. Never use markdown, bullet points, or special formatting. Speak naturally as if talking to a friend.

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

The tag must be the very first text, followed by a space, then your spoken words. Example: [MOOD:happy] That sounds wonderful!`;

// ── POST /api/chat — Anthropic streaming proxy (SSE) ─────────────────────────
app.post('/api/chat', async (req, res) => {
  const { messages } = req.body;

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
      system: SYSTEM_PROMPT,
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
        text: text.trim(),
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
  console.log('[Deepgram] connecting to:', dgUrl.replace(/api\.deepgram\.com/, 'api.deepgram.com'));

  const dgWs = new WebSocket(dgUrl, {
    headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` },
  });

  let dgConnected = false;
  let audioChunks = 0;
  const pendingChunks = [];  // buffer audio arriving before Deepgram WS opens

  // Forward browser messages to Deepgram, preserving frame type.
  // Audio arrives as binary; KeepAlive arrives as text JSON.
  // ws v8+ passes (data, isBinary) — we must use { binary: isBinary }
  // so Deepgram receives text frames as text (required for KeepAlive).
  clientWs.on('message', (data, isBinary) => {
    if (dgWs.readyState === WebSocket.OPEN) {
      // Flush any buffered chunks first (preserves order)
      while (pendingChunks.length > 0) {
        const buffered = pendingChunks.shift();
        dgWs.send(buffered);
        audioChunks++;
        console.log(`[Deepgram] flushed buffered chunk #${audioChunks}, size=${buffered.length || buffered.byteLength}`);
      }
      dgWs.send(data, { binary: isBinary });
      if (isBinary) {
        audioChunks++;
        if (audioChunks <= 10 || audioChunks % 100 === 0) {
          console.log(`[Deepgram] forwarded audio chunk #${audioChunks}, size=${data.length || data.byteLength}`);
        }
      } else {
        console.log(`[Deepgram] forwarded text msg: ${data.toString().substring(0, 80)}`);
      }
    } else if (dgWs.readyState === WebSocket.CONNECTING) {
      pendingChunks.push(data);
      console.log(`[Deepgram] buffered chunk while connecting (${pendingChunks.length}), size=${data.length || data.byteLength}`);
    }
  });

  dgWs.on('open', () => {
    dgConnected = true;
    console.log('[Deepgram] upstream connected ✓');
    // Flush any chunks that arrived during the handshake
    while (pendingChunks.length > 0) {
      const buffered = pendingChunks.shift();
      dgWs.send(buffered);
      audioChunks++;
      console.log(`[Deepgram] flushed buffered chunk #${audioChunks}, size=${buffered.length || buffered.byteLength}`);
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
  let msgCount = 0;
  dgWs.on('message', (data, isBinary) => {
    msgCount++;
    try {
      const parsed = JSON.parse(data.toString());
      if (parsed.type !== 'Results') {
        console.log(`[Deepgram] msg #${msgCount} type=${parsed.type}`);
      } else if (parsed.channel?.alternatives?.[0]?.transcript?.trim()) {
        console.log(`[Deepgram] transcript: "${parsed.channel.alternatives[0].transcript.trim()}" final=${parsed.is_final} speech_final=${parsed.speech_final}`);
      }
    } catch { /* binary or non-JSON — ignore */ }
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(data, { binary: isBinary });
    }
  });

  dgWs.on('close', (code, reason) => {
    const reasonStr = reason?.toString() || '(none)';
    console.log(`[Deepgram] upstream closed — code: ${code} | reason: ${reasonStr} | wasConnected: ${dgConnected} | audioChunks: ${audioChunks} | msgsReceived: ${msgCount}`);
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
  console.log(`  Model:  claude-sonnet-4-6`);
  console.log(`  Voice:  ${process.env.ELEVENLABS_VOICE_ID}`);
  await verifyDeepgramKey();
});
