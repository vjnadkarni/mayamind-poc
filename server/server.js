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

const SYSTEM_PROMPT = `You are Maya, a warm and caring wellness companion for seniors. You speak in short, clear sentences. Keep responses to 2-3 sentences maximum — this is a spoken conversation, not written text. Be encouraging, patient, and positive. Never use markdown, bullet points, or special formatting. Speak naturally as if talking to a friend.`;

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
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'text is required' });
  }

  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/with-timestamps`;

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
        voice_settings: { stability: 0.5, similarity_boost: 0.75 },
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

// ── WS /ws/deepgram — Deepgram streaming STT proxy ───────────────────────────
function handleDeepgram(clientWs) {
  const params = new URLSearchParams({
    model: 'nova-3',
    language: 'en',
    smart_format: 'true',
    interim_results: 'true',
    endpointing: '300',        // detect silence after 300ms (saves ~500ms vs default 800ms)
    utterance_end_ms: '1000',  // emit UtteranceEnd after 1s of silence
  });

  const dgWs = new WebSocket(
    `wss://api.deepgram.com/v1/listen?${params}`,
    { headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` } }
  );

  dgWs.on('open', () => {
    console.log('[Deepgram] connected');
    // Forward browser audio → Deepgram
    clientWs.on('message', (data) => {
      if (dgWs.readyState === WebSocket.OPEN) dgWs.send(data);
    });
  });

  // Forward Deepgram transcriptions → browser
  dgWs.on('message', (data) => {
    if (clientWs.readyState === WebSocket.OPEN) clientWs.send(data);
  });

  dgWs.on('close', (code, reason) => {
    console.log('[Deepgram] closed:', code, reason.toString());
    if (clientWs.readyState < WebSocket.CLOSING) clientWs.close();
  });

  dgWs.on('error', (err) => {
    console.error('[Deepgram] WS error:', err.message);
    if (clientWs.readyState < WebSocket.CLOSING) clientWs.close();
  });

  clientWs.on('close', () => {
    if (dgWs.readyState < WebSocket.CLOSING) dgWs.close();
  });

  clientWs.on('error', (err) => console.error('[Client] WS error:', err.message));
}

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3000', 10);
server.listen(PORT, () => {
  console.log(`MayaMind POC → http://localhost:${PORT}`);
  console.log(`  Model:  claude-sonnet-4-6`);
  console.log(`  Voice:  ${process.env.ELEVENLABS_VOICE_ID}`);
});
