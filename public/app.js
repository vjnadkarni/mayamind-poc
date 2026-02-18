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

// ── Settings presets ──────────────────────────────────────────────────────────
const BACKGROUNDS = {
  default:  '#0a0a10',
  office:   'linear-gradient(160deg, #1a1a2e 0%, #16213e 40%, #0f3460 100%)',
  living:   'linear-gradient(160deg, #2d1b00 0%, #3d2b1f 50%, #4a3728 100%)',
  nature:   'linear-gradient(160deg, #0d3b0d 0%, #1a4d2e 50%, #0a3d5c 100%)',
  city:     'linear-gradient(160deg, #0c0c1a 0%, #1a1a2e 40%, #2d2d44 100%)',
  beach:    'linear-gradient(160deg, #0c2d48 0%, #1a6b8a 50%, #c4956a 100%)',
};

const LIGHTING_PRESETS = {
  studio:   { lightAmbientColor: 0xffffff, lightAmbientIntensity: 2,
              lightDirectColor: 0x8888aa, lightDirectIntensity: 30,
              lightSpotIntensity: 0 },
  warm:     { lightAmbientColor: 0xffd4a0, lightAmbientIntensity: 2.5,
              lightDirectColor: 0xff9944, lightDirectIntensity: 25,
              lightSpotIntensity: 0 },
  cool:     { lightAmbientColor: 0xc0d0ff, lightAmbientIntensity: 2,
              lightDirectColor: 0x4488cc, lightDirectIntensity: 25,
              lightSpotIntensity: 0 },
  dramatic: { lightAmbientColor: 0x222244, lightAmbientIntensity: 0.8,
              lightDirectColor: 0xffffff, lightDirectIntensity: 40,
              lightSpotColor: 0x3388ff, lightSpotIntensity: 100,
              lightSpotDispersion: 0.5 },
  soft:     { lightAmbientColor: 0xffe8d6, lightAmbientIntensity: 3,
              lightDirectColor: 0xccbbaa, lightDirectIntensity: 10,
              lightSpotIntensity: 0 },
};

const VOICES = {
  '21m00Tcm4TlvDq8ikWAM': 'Rachel',
  'EXAVITQu4vr4xnSDxMaL': 'Bella',
  'AZnzlk1XvdvUeBnXmlld': 'Domi',
  'TxGEqnHWrfWFTfGW9XjX': 'Josh',
  'VR6AewLTigWG4xSOukaG': 'Arnold',
};

const DEFAULT_SETTINGS = {
  cameraView: 'upper',
  background: 'default',
  mood: 'happy',
  lighting: 'studio',
  voiceId: '21m00Tcm4TlvDq8ikWAM',
};

// Current settings (modified live, persisted via profiles)
const settings = { ...DEFAULT_SETTINGS };

// ── DOM refs ──────────────────────────────────────────────────────────────────
const avatarEl      = document.getElementById('avatar');
const loadingEl     = document.getElementById('loading');
const startOverlay  = document.getElementById('start-overlay');
const transcriptEl  = document.getElementById('transcript');
const statusTextEl  = document.getElementById('status-text');
const statusDotEl   = document.getElementById('status-dot');
const muteBtn       = document.getElementById('mute-btn');

// ── State ─────────────────────────────────────────────────────────────────────
const S = { LOADING: 'loading', LISTENING: 'listening', PROCESSING: 'processing', SPEAKING: 'speaking' };
let state = S.LOADING;

let head;                       // TalkingHead instance
let sharedAudioCtx;             // AudioContext we own and pass to TalkingHead
let mediaStream, mediaRecorder, dgWs;
let isMicMuted  = false;        // gate on ondataavailable — true while processing/speaking
let keepAliveId = null;         // interval id for Deepgram KeepAlive while muted
let accFinal    = '';           // accumulated is_final Deepgram segments this utterance
let conversationHistory = [];   // Claude messages array (capped at 20)

// ── Settings: apply functions ─────────────────────────────────────────────────
function applyCameraView(v) { settings.cameraView = v; head?.setView(v); }
function applyBackground(v) { settings.background = v; document.body.style.background = BACKGROUNDS[v] || BACKGROUNDS.default; }
function applyMood(v)       { settings.mood = v; head?.setMood(v); }
function applyLighting(v)   { settings.lighting = v; if (head && LIGHTING_PRESETS[v]) head.setLighting(LIGHTING_PRESETS[v]); }
function applyVoice(v)      { settings.voiceId = v; }

function applyAllSettings(s) {
  applyCameraView(s.cameraView || DEFAULT_SETTINGS.cameraView);
  applyBackground(s.background || DEFAULT_SETTINGS.background);
  applyMood(s.mood || DEFAULT_SETTINGS.mood);
  applyLighting(s.lighting || DEFAULT_SETTINGS.lighting);
  applyVoice(s.voiceId || DEFAULT_SETTINGS.voiceId);
  updateSettingsUI();
}

// ── Settings: UI wiring ──────────────────────────────────────────────────────
function initSettingsUI() {
  const settingsBtn     = document.getElementById('settings-btn');
  const settingsOverlay = document.getElementById('settings-overlay');
  const settingsPanel   = document.getElementById('settings-panel');
  const settingsClose   = document.getElementById('settings-close');
  const profileSelect   = document.getElementById('profile-select');
  const profileSave     = document.getElementById('profile-save');
  const profileDelete   = document.getElementById('profile-delete');

  function openPanel()  { settingsOverlay.classList.add('open'); settingsPanel.classList.add('open'); }
  function closePanel() { settingsOverlay.classList.remove('open'); settingsPanel.classList.remove('open'); }

  settingsBtn.addEventListener('click', openPanel);
  settingsOverlay.addEventListener('click', closePanel);
  settingsClose.addEventListener('click', closePanel);

  // Button groups — each group has data-setting and buttons with data-value
  const APPLY = { cameraView: applyCameraView, background: applyBackground, mood: applyMood,
                  lighting: applyLighting, voice: applyVoice };
  for (const group of document.querySelectorAll('.btn-group[data-setting]')) {
    const key = group.dataset.setting;
    group.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-value]');
      if (!btn) return;
      group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const val = btn.dataset.value;
      if (key === 'voice') applyVoice(val);
      else if (APPLY[key]) APPLY[key](val);
    });
  }

  // Profile: load on select change
  profileSelect.addEventListener('change', () => {
    const name = profileSelect.value;
    if (name) loadProfile(name);
  });

  // Profile: save
  profileSave.addEventListener('click', () => {
    let name = profileSelect.value;
    if (!name) {
      name = prompt('Profile name:');
      if (!name || !name.trim()) return;
      name = name.trim();
    }
    saveProfile(name);
  });

  // Profile: delete
  profileDelete.addEventListener('click', () => {
    const name = profileSelect.value;
    if (!name) return;
    if (!confirm(`Delete profile "${name}"?`)) return;
    deleteProfile(name);
  });

  refreshProfileDropdown();
}

function updateSettingsUI() {
  // Sync active buttons with current settings
  const map = {
    cameraView: settings.cameraView,
    background: settings.background,
    mood: settings.mood,
    lighting: settings.lighting,
    voice: settings.voiceId,
  };
  for (const [key, val] of Object.entries(map)) {
    const group = document.querySelector(`.btn-group[data-setting="${key}"]`);
    if (!group) continue;
    group.querySelectorAll('button').forEach(b => {
      b.classList.toggle('active', b.dataset.value === val);
    });
  }
}

// ── Settings: profile persistence (localStorage) ────────────────────────────
const LS_PROFILES = 'mayamind_profiles';
const LS_ACTIVE   = 'mayamind_active_profile';

function getProfiles() {
  try { return JSON.parse(localStorage.getItem(LS_PROFILES) || '[]'); }
  catch { return []; }
}

function saveProfile(name) {
  const profiles = getProfiles();
  const data = { name, ...settings };
  const idx = profiles.findIndex(p => p.name === name);
  if (idx >= 0) profiles[idx] = data;
  else profiles.push(data);
  localStorage.setItem(LS_PROFILES, JSON.stringify(profiles));
  localStorage.setItem(LS_ACTIVE, name);
  refreshProfileDropdown(name);
}

function loadProfile(name) {
  const profile = getProfiles().find(p => p.name === name);
  if (!profile) return;
  applyAllSettings(profile);
  localStorage.setItem(LS_ACTIVE, name);
  refreshProfileDropdown(name);
}

function deleteProfile(name) {
  const profiles = getProfiles().filter(p => p.name !== name);
  localStorage.setItem(LS_PROFILES, JSON.stringify(profiles));
  if (localStorage.getItem(LS_ACTIVE) === name) localStorage.removeItem(LS_ACTIVE);
  refreshProfileDropdown();
}

function refreshProfileDropdown(selected) {
  const sel = document.getElementById('profile-select');
  if (!sel) return;
  const active = selected || localStorage.getItem(LS_ACTIVE) || '';
  const profiles = getProfiles();
  sel.innerHTML = '<option value="">-- No profile --</option>';
  for (const p of profiles) {
    const opt = document.createElement('option');
    opt.value = p.name;
    opt.textContent = p.name;
    if (p.name === active) opt.selected = true;
    sel.appendChild(opt);
  }
}

function loadLastProfile() {
  const name = localStorage.getItem(LS_ACTIVE);
  if (name) loadProfile(name);
  else applyAllSettings(DEFAULT_SETTINGS);
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
async function init() {
  setStatus(S.LOADING, 'Loading avatar…');

  // Create the AudioContext ourselves so we can resume() it after the user gesture.
  // Chrome starts it in "suspended" state; we resume inside the tap handler below.
  // Passing it to TalkingHead prevents it from creating a second, unresumable context.
  sharedAudioCtx = new AudioContext();
  console.log('[AudioCtx] created, state:', sharedAudioCtx.state);

  head = new TalkingHead(avatarEl, {
    ttsEndpoint: null,          // we drive TTS ourselves via speakAudio()
    audioCtx: sharedAudioCtx,   // share our context so we control resume()
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

    // Initialize settings UI and load last saved profile
    initSettingsUI();
    loadLastProfile();

    // Show the start overlay. The user's tap provides the Chrome user gesture
    // required to resume the AudioContext for audio playback.
    startOverlay.classList.remove('hidden');
    setStatus(S.LOADING, 'Tap anywhere to start');
  } catch (err) {
    console.error('[Avatar] load failed:', err);
    loadingEl.textContent = `Avatar failed to load: ${err.message}. Check AVATAR_URL and console.`;
    return;
  }

  // Wait for the user's tap, then resume AudioContext inside the gesture handler.
  await new Promise(resolve => {
    startOverlay.addEventListener('click', () => {
      // resume() must be called synchronously within the user-gesture handler
      sharedAudioCtx.resume().then(() => {
        console.log('[AudioCtx] resumed, state:', sharedAudioCtx.state);
        resolve();
      }).catch(err => {
        console.error('[AudioCtx] resume failed:', err);
        resolve(); // continue anyway
      });
    }, { once: true });
  });
  startOverlay.classList.add('hidden');

  // Now open mic + Deepgram (AudioContext is running, playback will work)
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
    dgWs.onerror = (e) => {
      console.error('[Deepgram] WS error event:', e);
      reject(new Error('Deepgram WS error'));
    };

    dgWs.onopen = () => {
      console.log('[Deepgram] browser WS open');
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      console.log('[Deepgram] MediaRecorder mimeType:', mimeType);

      mediaRecorder = new MediaRecorder(mediaStream, { mimeType });

      let chunkCount = 0;
      // Gate: only forward audio when mic is unmuted
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0 && dgWs.readyState === WebSocket.OPEN && !isMicMuted) {
          dgWs.send(e.data);
          chunkCount++;
          if (chunkCount <= 5 || chunkCount % 50 === 0) {
            console.log(`[Deepgram] sent chunk #${chunkCount}, size=${e.data.size}`);
          }
        }
      };

      mediaRecorder.start(100); // 100ms chunks → low latency to Deepgram
      console.log('[Deepgram] MediaRecorder started');
      resolve();
    };

    dgWs.onmessage = handleDG;

    dgWs.onclose = (ev) => {
      console.warn('[Deepgram] connection closed — code:', ev.code, '| reason:', ev.reason || '(none)');
      // For the POC we don't auto-reconnect; reload the page if this happens
    };
  });
}

// ── Deepgram message handler ──────────────────────────────────────────────────
function handleDG(e) {
  let msg;
  try { msg = JSON.parse(e.data); } catch { return; }

  // Log non-Results messages (Metadata, SpeechStarted, UtteranceEnd, etc.)
  if (msg.type !== 'Results') {
    console.log('[Deepgram] msg type:', msg.type, msg);
  }

  if (msg.type === 'Results') {
    const alt        = msg.channel?.alternatives?.[0];
    const transcript = alt?.transcript?.trim() || '';

    if (transcript) {
      console.log(`[Deepgram] ${msg.is_final ? 'FINAL' : 'interim'} | speech_final=${msg.speech_final} | "${transcript}"`);
    }

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

// ── Deepgram KeepAlive ─────────────────────────────────────────────────────────
// Deepgram closes the WS if no audio arrives within its timeout window.
// While mic is muted (processing/speaking), send KeepAlive to hold the connection.
function startKeepAlive() {
  stopKeepAlive();
  keepAliveId = setInterval(() => {
    if (dgWs && dgWs.readyState === WebSocket.OPEN) {
      dgWs.send(JSON.stringify({ type: 'KeepAlive' }));
    }
  }, 5000); // every 5s
}
function stopKeepAlive() {
  if (keepAliveId) { clearInterval(keepAliveId); keepAliveId = null; }
}

// ── Conversation pipeline ─────────────────────────────────────────────────────
async function runConversation(userText) {
  // Transition → PROCESSING; mute mic immediately to block avatar echo
  state     = S.PROCESSING;
  isMicMuted = true;
  startKeepAlive();
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
        body: JSON.stringify({ text: sentence, voice_id: settings.voiceId }),
      });
      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
      const data      = await res.json();
      const arrayBuf  = base64ToArrayBuffer(data.audio_base64);
      // speakAudio expects a decoded AudioBuffer, not a raw ArrayBuffer
      const audioBuf  = await sharedAudioCtx.decodeAudioData(arrayBuf);
      const timing    = alignmentToWords(data.normalized_alignment || data.alignment);
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
  stopKeepAlive();
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
