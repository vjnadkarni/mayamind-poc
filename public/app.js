/**
 * MayaMind — always-on VAD conversation pipeline
 *
 * State machine:
 *   LOADING → LISTENING → PROCESSING → SPEAKING → LISTENING → …
 *
 * Mic is always open. Audio is muted to Deepgram while processing/speaking
 * to prevent echo. Conversation resumes automatically after avatar finishes.
 */

import { TalkingHead } from './modules/talkinghead.mjs';

// ── Config ────────────────────────────────────────────────────────────────────
const AVATAR_URL = './avatars/brunette.glb';   // update if GLB filename differs
const DG_WS_URL  = `ws://${location.host}/ws/deepgram`;
const CHAT_URL   = '/api/chat';
const TTS_URL    = '/api/tts';

// ── DOM refs ──────────────────────────────────────────────────────────────────
const avatarEl     = document.getElementById('avatar');
const loadingEl    = document.getElementById('loading');
const transcriptEl = document.getElementById('transcript');
const statusTextEl = document.getElementById('status-text');
const statusDotEl  = document.getElementById('status-dot');
const muteBtn      = document.getElementById('mute-btn');

// ── State ─────────────────────────────────────────────────────────────────────
const S = { LOADING: 'loading', LISTENING: 'listening', PROCESSING: 'processing', SPEAKING: 'speaking' };
let state = S.LOADING;

let head;                       // TalkingHead instance
let mediaStream, mediaRecorder, dgWs;
let isMicMuted  = false;        // gate on ondataavailable — true while processing/speaking
let accFinal    = '';           // accumulated is_final Deepgram segments this utterance
let conversationHistory = [];   // Claude messages array (capped at 20)

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  setStatus(S.LOADING, 'Loading avatar…');

  head = new TalkingHead(avatarEl, {
    ttsEndpoint: null,          // we drive TTS ourselves via speakAudio()
    cameraView: 'upper',
    cameraRotateEnable: true,
    lipsyncLang: 'en',
    lipsyncModules: ['en'],     // only load English lipsync module
  });

  try {
    await head.showAvatar({
      url: AVATAR_URL,
      body: 'F',
      avatarMood: 'happy',
      lipsyncLang: 'en',
    });
    loadingEl.classList.add('hidden');
  } catch (err) {
    console.error('[Avatar] load failed:', err);
    loadingEl.textContent = `Avatar failed to load: ${err.message}. Check AVATAR_URL and console.`;
    return;
  }

  // Start always-on mic + Deepgram stream
  try {
    await openMic();
  } catch (err) {
    console.error('[Mic] getUserMedia denied:', err);
    setStatus(S.LOADING, 'Microphone access denied — please allow mic and reload.');
    return;
  }

  setStatus(S.LISTENING, 'Listening…');
  state = S.LISTENING;

  muteBtn.removeAttribute('disabled');
  muteBtn.addEventListener('click', toggleMute);
}

// ── Mic + Deepgram (persistent, always-on) ────────────────────────────────────
async function openMic() {
  // Enable WebRTC echo cancellation to reduce avatar-voice pickup
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });

  dgWs = new WebSocket(DG_WS_URL);
  dgWs.binaryType = 'arraybuffer';

  return new Promise((resolve, reject) => {
    dgWs.onerror = (e) => reject(new Error('Deepgram WS error'));

    dgWs.onopen = () => {
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

      // Gate: only forward audio when mic is unmuted
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && dgWs.readyState === WebSocket.OPEN && !isMicMuted) {
          dgWs.send(e.data);
        }
      };

      mediaRecorder.start(100); // 100ms chunks → low latency to Deepgram
      resolve();
    };

    dgWs.onmessage = handleDG;

    dgWs.onclose = (ev) => {
      console.warn('[Deepgram] connection closed:', ev.code, ev.reason);
      // For the POC we don't auto-reconnect; reload the page if this happens
    };
  });
}

// ── Deepgram message handler ──────────────────────────────────────────────────
function handleDG(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }

  if (msg.type === 'Results') {
    const alt        = msg.channel?.alternatives?.[0];
    const transcript = alt?.transcript?.trim() || '';

    // Interim result: show what we're hearing in real time
    if (!msg.is_final) {
      if (transcript && state === S.LISTENING) {
        showInterim((accFinal + ' ' + transcript).trim());
      }
      return;
    }

    // Final segment: accumulate
    if (transcript) accFinal = (accFinal + ' ' + transcript).trim();

    // speech_final = Deepgram endpointing detected ≥500ms of silence after speech
    // This is the lowest-latency trigger — fires well before UtteranceEnd (+1s).
    if (msg.speech_final && state === S.LISTENING && accFinal) {
      const text = accFinal;
      accFinal = '';
      clearInterim();
      appendTranscript('user', text);
      runConversation(text);   // async — don't await here
    }
  }

  // UtteranceEnd is a safety-net fallback (fires after utterance_end_ms silence).
  // If speech_final already triggered above, accFinal will be empty → no-op.
  if (msg.type === 'UtteranceEnd' && state === S.LISTENING && accFinal) {
    const text = accFinal;
    accFinal = '';
    clearInterim();
    appendTranscript('user', text);
    runConversation(text);
  }
}

// ── Mute toggle ───────────────────────────────────────────────────────────────
function toggleMute() {
  isMicMuted = !isMicMuted;
  muteBtn.textContent = isMicMuted ? '🔇' : '🎤';
  muteBtn.title       = isMicMuted ? 'Unmute mic' : 'Mute mic';
  muteBtn.classList.toggle('muted', isMicMuted);
  if (!isMicMuted && state === S.LISTENING) setStatus(S.LISTENING, 'Listening…');
  if (isMicMuted  && state === S.LISTENING) setStatus(S.LISTENING, 'Muted');
}

// ── Conversation pipeline ─────────────────────────────────────────────────────
async function runConversation(userText) {
  // Transition → PROCESSING; mute mic immediately to block avatar echo
  state     = S.PROCESSING;
  isMicMuted = true;
  setStatus(S.PROCESSING, 'Thinking…');

  conversationHistory.push({ role: 'user', content: userText });
  if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

  let fullResponse  = '';
  let buffer        = '';
  let anySpeech     = false;

  // ── Concurrent TTS with strictly ordered speakAudio calls ─────────────────
  // Multiple ElevenLabs requests fire in parallel as sentences arrive from
  // Claude. speakAudio() is only called in sentence order regardless of which
  // TTS response comes back first. This cuts latency on multi-sentence replies.
  let   enqueueSeq    = 0;    // next sequence number to assign
  let   nextSpeakSeq  = 0;    // next sequence number to pass to speakAudio
  const audioCache    = {};   // seq → { audioBuf, timing } | null
  const ttsTasks      = [];   // array of Promises

  // Drain audioCache in order, calling speakAudio for each ready entry
  function flushAudioQueue() {
    while (Object.prototype.hasOwnProperty.call(audioCache, nextSpeakSeq)) {
      const entry = audioCache[nextSpeakSeq];
      delete audioCache[nextSpeakSeq];
      nextSpeakSeq++;

      if (entry) {  // null = sentence was skipped due to TTS error
        anySpeech = true;
        if (state === S.PROCESSING) {
          state = S.SPEAKING;
          setStatus(S.SPEAKING, 'Speaking…');
        }
        head.speakAudio(
          { audio: entry.audioBuf, words: entry.timing.words,
            wtimes: entry.timing.wtimes, wdurations: entry.timing.wdurations },
          { lipsyncLang: 'en' }
        );
      }
    }
  }

  // Fire TTS for one sentence; place result in audioCache at its seq slot
  async function fetchTTS(sentence, seq) {
    try {
      const res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: sentence }),
      });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const data    = await res.json();
      const audioBuf = base64ToArrayBuffer(data.audio_base64);
      const timing   = alignmentToWords(data.normalized_alignment || data.alignment);
      audioCache[seq] = { audioBuf, timing };
    } catch (err) {
      console.error(`[TTS] seq ${seq} error:`, err);
      audioCache[seq] = null;  // skip this sentence, unblock queue
    }
    flushAudioQueue();
  }

  // Schedule a sentence for TTS (called as each sentence emerges from Claude)
  function scheduleTTS(sentence) {
    if (!sentence.trim()) return;
    const seq = enqueueSeq++;
    ttsTasks.push(fetchTTS(sentence, seq));
  }

  // ── Stream Claude response ────────────────────────────────────────────────
  try {
    const res = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: conversationHistory }),
    });
    if (!res.ok) throw new Error(`Chat HTTP ${res.status}`);

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break outer;

        let parsed;
        try { parsed = JSON.parse(payload); } catch { continue; }
        if (parsed.error) throw new Error(parsed.error);
        if (!parsed.text)  continue;

        buffer       += parsed.text;
        fullResponse += parsed.text;

        // Flush complete sentence to TTS as soon as it's ready
        const m = buffer.match(/[.!?]\s/);
        if (m) {
          scheduleTTS(buffer.substring(0, m.index + 1).trim());
          buffer = buffer.substring(m.index + 2);
        }
      }
    }

    // Flush any trailing text (response that didn't end with punctuation)
    if (buffer.trim()) scheduleTTS(buffer.trim());

    // Wait for all concurrent TTS fetches to finish
    await Promise.all(ttsTasks);

    conversationHistory.push({ role: 'assistant', content: fullResponse });
    if (conversationHistory.length > 20) conversationHistory.splice(0, 2);

    appendTranscript('assistant', fullResponse);

  } catch (err) {
    console.error('[Chat] error:', err);
    resumeListening();
    return;
  }

  // ── Wait for avatar to finish speaking, then resume listening ─────────────
  if (anySpeech) {
    // Brief delay so TalkingHead can start playing before we poll isSpeaking
    await sleep(400);
    await waitUntilDoneSpeaking();
  }

  resumeListening();
}

function resumeListening() {
  state      = S.LISTENING;
  isMicMuted = false;
  accFinal   = '';
  setStatus(S.LISTENING, 'Listening…');
}

// Poll head.isSpeaking until the avatar finishes its queue
function waitUntilDoneSpeaking() {
  if (!head.isSpeaking) return Promise.resolve();
  return new Promise(resolve => {
    const id = setInterval(() => {
      if (!head.isSpeaking) { clearInterval(id); resolve(); }
    }, 250);
  });
}

// ── Audio helpers ─────────────────────────────────────────────────────────────

// base64 → ArrayBuffer (what speakAudio expects — TalkingHead decodes internally)
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes  = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// ElevenLabs char-level alignment → word-level timing for speakAudio()
function alignmentToWords(alignment) {
  let chars, startMs, durationMs;

  if (alignment?.chars) {
    // normalized_alignment: already in milliseconds
    chars      = alignment.chars;
    startMs    = alignment.charStartTimesMs;
    durationMs = alignment.charDurationsMs;
  } else if (alignment?.characters) {
    // raw alignment: seconds → ms
    chars      = alignment.characters;
    const s0   = alignment.character_start_times_seconds;
    const s1   = alignment.character_end_times_seconds;
    startMs    = s0.map(t => t * 1000);
    durationMs = s0.map((t, i) => (s1[i] - t) * 1000);
  } else {
    console.warn('[TTS] unknown alignment format:', alignment);
    return { words: [], wtimes: [], wdurations: [] };
  }

  const words = [], wtimes = [], wdurations = [];
  let wch = [], wStart = null, wEnd = null;

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    if (ch === ' ' || ch === '\n' || ch === '\t') {
      if (wch.length) {
        words.push(wch.join(''));
        wtimes.push(wStart);
        wdurations.push(wEnd - wStart);
        wch = []; wStart = null; wEnd = null;
      }
    } else {
      if (wStart === null) wStart = startMs[i];
      wEnd = startMs[i] + durationMs[i];
      wch.push(ch);
    }
  }
  if (wch.length) {
    words.push(wch.join(''));
    wtimes.push(wStart);
    wdurations.push(wEnd - wStart);
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

function clearInterim() {
  transcriptEl.querySelector('.interim')?.remove();
}

function appendTranscript(role, text) {
  clearInterim();
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  el.textContent = text;
  transcriptEl.appendChild(el);
  while (transcriptEl.childElementCount > 30) transcriptEl.removeChild(transcriptEl.firstElementChild);
  transcriptEl.scrollTop = transcriptEl.scrollHeight;
}

// ── Status display ────────────────────────────────────────────────────────────
function setStatus(stateVal, text) {
  statusTextEl.textContent = text;
  statusDotEl.className    = `dot ${stateVal}`;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Start ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
