/**
 * MayaMind — conversation pipeline
 *
 * Flow:  mic → Deepgram STT → Claude (SSE) → sentence buffer
 *        → ElevenLabs TTS with-timestamps → TalkingHead speakAudio
 *
 * See: TalkingHead README Appendix G for speakAudio() input format.
 * Adjust AVATAR_URL to match the actual GLB filename after running setup.sh.
 */

import { TalkingHead } from './modules/talkinghead.mjs';

// ── Config ────────────────────────────────────────────────────────────────────
// Update AVATAR_URL to the actual filename placed in public/avatars/ by setup.sh
const AVATAR_URL = './avatars/brunette.glb';   // <-- update if filename differs
const DG_WS_URL  = `ws://${location.host}/ws/deepgram`;
const CHAT_URL   = '/api/chat';
const TTS_URL    = '/api/tts';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const avatarEl    = document.getElementById('avatar');
const loadingEl   = document.getElementById('loading');
const transcriptEl = document.getElementById('transcript');
const statusEl    = document.getElementById('status');
const micBtn      = document.getElementById('mic-btn');

// ── App state ─────────────────────────────────────────────────────────────────
let head;                          // TalkingHead instance (manages its own AudioContext)
let conversationHistory = [];      // Claude message history (last 20)
let isListening = false;
let mediaStream, mediaRecorder, dgWs;
let lastInterimTranscript = '';

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  setStatus('Loading avatar…', '');

  // TalkingHead with external TTS (we call speakAudio ourselves).
  // lipsyncLang defaults to 'fi' in the library — must override to 'en'.
  head = new TalkingHead(avatarEl, {
    ttsEndpoint: null,
    cameraView: 'upper',
    cameraRotateEnable: true,
    lipsyncLang: 'en',
    lipsyncModules: ['en'],
  });

  try {
    await head.showAvatar({
      url: AVATAR_URL,
      body: 'F',
      avatarMood: 'happy',
      lipsyncLang: 'en',
    });
    loadingEl.classList.add('hidden');
    setStatus('Ready — press Speak', '');
    micBtn.disabled = false;
  } catch (err) {
    console.error('[Avatar] load failed:', err);
    loadingEl.textContent = `Avatar load failed: ${err.message}. Check console & AVATAR_URL.`;
    setStatus('Avatar error', 'error');
    return;
  }

  micBtn.addEventListener('click', toggleListening);
}

// ── Mic / Deepgram ────────────────────────────────────────────────────────────
async function toggleListening() {
  if (isListening) {
    stopListening();
  } else {
    await startListening();
  }
}

async function startListening() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setStatus('Mic access denied', 'error');
    console.error('[Mic] getUserMedia error:', err);
    return;
  }

  isListening = true;
  lastInterimTranscript = '';
  micBtn.textContent = '⏹ Stop';
  micBtn.classList.add('recording');
  setStatus('Listening…', 'active');

  dgWs = new WebSocket(DG_WS_URL);
  dgWs.binaryType = 'arraybuffer';

  dgWs.onopen = () => {
    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0 && dgWs.readyState === WebSocket.OPEN) {
        dgWs.send(e.data);
      }
    };

    mediaRecorder.start(100); // 100ms chunks for low latency
  };

  dgWs.onmessage = (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }

    if (msg.type === 'Results') {
      const alt = msg.channel?.alternatives?.[0];
      if (!alt?.transcript) return;

      if (msg.is_final) {
        lastInterimTranscript = alt.transcript;
        appendTranscript('user', alt.transcript, false);
      } else {
        showInterim(alt.transcript);
      }
    }

    // UtteranceEnd fires after 1s of silence — trigger the LLM pipeline
    if (msg.type === 'UtteranceEnd') {
      const text = lastInterimTranscript.trim();
      if (text) {
        stopListening();
        runConversation(text);
      }
    }
  };

  dgWs.onerror = (err) => console.error('[Deepgram] WS error:', err);
  dgWs.onclose = () => console.log('[Deepgram] WS closed');
}

function stopListening() {
  isListening = false;
  micBtn.textContent = '🎤 Speak';
  micBtn.classList.remove('recording');

  if (mediaRecorder?.state !== 'inactive') {
    try { mediaRecorder.stop(); } catch (_) {}
  }
  mediaStream?.getTracks().forEach(t => t.stop());
  if (dgWs?.readyState < WebSocket.CLOSING) {
    try { dgWs.close(); } catch (_) {}
  }
}

// ── Conversation pipeline ─────────────────────────────────────────────────────
async function runConversation(userText) {
  micBtn.disabled = true;
  setStatus('Thinking…', 'think');

  // Add to history; trim to last 20 messages (10 turns)
  conversationHistory.push({ role: 'user', content: userText });
  if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

  let fullResponse = '';
  let buffer = '';

  // TTS chain: sentences are processed serially to preserve ordering.
  // Each .then() call starts TTS for the next sentence only after the
  // previous TTS request has received its audio from ElevenLabs.
  // TalkingHead's internal queue handles playback ordering automatically.
  let ttsChain = Promise.resolve();

  function scheduleSpeak(sentence) {
    ttsChain = ttsChain.then(() => speakSentence(sentence));
  }

  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory }),
    });

    if (!res.ok) throw new Error(`Chat request failed: ${res.status}`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();

    // Read SSE stream
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;

        let parsed;
        try { parsed = JSON.parse(payload); } catch { continue; }

        if (parsed.error) throw new Error(parsed.error);
        if (!parsed.text) continue;

        buffer += parsed.text;
        fullResponse += parsed.text;

        // Flush complete sentences immediately to ElevenLabs
        const match = buffer.match(/[.!?]\s/);
        if (match) {
          const sentence = buffer.substring(0, match.index + 1).trim();
          buffer = buffer.substring(match.index + 2);
          if (sentence) scheduleSpeak(sentence);
        }
      }
    }

    // Flush any remaining text
    if (buffer.trim()) scheduleSpeak(buffer.trim());

    // Wait for all TTS fetch calls to complete (not for playback to finish)
    await ttsChain;

    conversationHistory.push({ role: 'assistant', content: fullResponse });
    if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

    appendTranscript('assistant', fullResponse, false);

  } catch (err) {
    console.error('[Chat] error:', err);
    setStatus('Error — try again', 'error');
  } finally {
    micBtn.disabled = false;
    setStatus('Ready — press Speak', '');
  }
}

// ── TTS + lip-sync ────────────────────────────────────────────────────────────
async function speakSentence(text) {
  if (!text.trim()) return;
  setStatus('Speaking…', 'speak');

  try {
    const res = await fetch(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`TTS ${res.status}: ${errBody}`);
    }

    const data = await res.json();

    // data.audio_base64 — base64 encoded audio (MP3 by default) from ElevenLabs
    // data.normalized_alignment — { chars, charStartTimesMs, charDurationsMs }
    // data.alignment             — { characters, character_start_times_seconds, ... }

    // speakAudio() expects ArrayBuffer (raw bytes), NOT a Web Audio AudioBuffer.
    // TalkingHead decodes the audio internally using its own AudioContext.
    const audioArrayBuffer = base64ToArrayBuffer(data.audio_base64);
    const alignment        = data.normalized_alignment || data.alignment;
    const wordTiming       = alignmentToWords(alignment);

    // speakAudio(r, opt, onsubtitles) — synchronous, queues audio internally.
    // Multiple calls queue up and play in order automatically.
    head.speakAudio(
      {
        audio: audioArrayBuffer,
        words: wordTiming.words,
        wtimes: wordTiming.wtimes,
        wdurations: wordTiming.wdurations,
      },
      { lipsyncLang: 'en' }
    );

  } catch (err) {
    console.error('[TTS] error:', err);
    // Don't throw — partial failures shouldn't abort the whole response
  }
}

// ── Audio helpers ─────────────────────────────────────────────────────────────

/**
 * Decode base64 string → ArrayBuffer.
 * TalkingHead's speakAudio() expects raw ArrayBuffer (MP3/WAV/OGG bytes).
 * It decodes audio internally using its own AudioContext.
 */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Convert ElevenLabs character-level alignment to word-level timing
 * expected by TalkingHead's speakAudio().
 *
 * Handles both ElevenLabs alignment formats:
 *   normalized_alignment: { chars[], charStartTimesMs[], charDurationsMs[] }
 *   alignment:            { characters[], character_start_times_seconds[], character_end_times_seconds[] }
 */
function alignmentToWords(alignment) {
  let chars, startMs, durationMs;

  if (alignment.chars) {
    // normalized_alignment (milliseconds already)
    chars      = alignment.chars;
    startMs    = alignment.charStartTimesMs;
    durationMs = alignment.charDurationsMs;
  } else if (alignment.characters) {
    // raw alignment (seconds — convert to ms)
    chars      = alignment.characters;
    const startSecs = alignment.character_start_times_seconds;
    const endSecs   = alignment.character_end_times_seconds;
    startMs    = startSecs.map(s => s * 1000);
    durationMs = startSecs.map((s, i) => (endSecs[i] - s) * 1000);
  } else {
    console.warn('[TTS] Unrecognised alignment format:', alignment);
    return { words: [], wtimes: [], wdurations: [] };
  }

  const words = [], wtimes = [], wdurations = [];
  let wordChars = [], wordStart = null, wordLastEnd = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];

    if (ch === ' ' || ch === '\n' || ch === '\t') {
      if (wordChars.length > 0) {
        words.push(wordChars.join(''));
        wtimes.push(wordStart);
        wdurations.push(wordLastEnd - wordStart);
        wordChars = []; wordStart = null; wordLastEnd = null;
      }
    } else {
      if (wordStart === null) wordStart = startMs[i];
      wordLastEnd = startMs[i] + durationMs[i];
      wordChars.push(ch);
    }
  }

  // Final word (no trailing space)
  if (wordChars.length > 0) {
    words.push(wordChars.join(''));
    wtimes.push(wordStart);
    wdurations.push(wordLastEnd - wordStart);
  }

  return { words, wtimes, wdurations };
}

// ── Transcript helpers ────────────────────────────────────────────────────────
function showInterim(text) {
  let el = transcriptEl.querySelector('.interim');
  if (!el) {
    el = document.createElement('div');
    el.className = 'msg user interim';
    transcriptEl.appendChild(el);
  }
  el.textContent = text;
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function appendTranscript(role, text, isInterim) {
  // Remove any existing interim bubble
  transcriptEl.querySelector('.interim')?.remove();

  const el = document.createElement('div');
  el.className = `msg ${role}${isInterim ? ' interim' : ''}`;
  el.textContent = text;
  transcriptEl.appendChild(el);

  // Keep transcript from growing unbounded
  while (transcriptEl.childElementCount > 30) {
    transcriptEl.removeChild(transcriptEl.firstElementChild);
  }

  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || '';
}

// ── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
