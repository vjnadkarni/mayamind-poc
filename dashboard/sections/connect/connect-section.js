/**
 * MayaMind Dashboard — Connect Section
 *
 * WhatsApp messaging via Twilio, driven by conversational voice interface.
 * Full TalkingHead 3D avatar, Web Speech API, Claude conversation with ACTION tags.
 */

import { AudioManager } from '../../core/audio-manager.js';
import { ConnectStore } from '../../core/connect-store.js';
import { convertEmojisToSpeech, extractDominantEmojiMood, isEmojiOnly } from '../../core/emoji-utils.js';
import { isMuteCommand, isUnmuteCommand } from '../../core/voice-commands.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const AVATAR_URL = '/avatars/brunette.glb';
const CHAT_URL = '/api/chat/connect';
const TTS_URL = '/api/tts';
const SSE_URL = '/api/whatsapp/events';
const SEND_URL = '/api/whatsapp/send';

const VALID_MOODS = ['neutral', 'happy', 'angry', 'sad', 'fear', 'disgust', 'love', 'sleep'];

const MOOD_VOICE_SETTINGS = {
  neutral: { stability: 0.55, similarity_boost: 0.75 },
  happy:   { stability: 0.45, similarity_boost: 0.75 },
  sad:     { stability: 0.50, similarity_boost: 0.80 },
  love:    { stability: 0.50, similarity_boost: 0.80 },
  angry:   { stability: 0.70, similarity_boost: 0.75 },
  fear:    { stability: 0.65, similarity_boost: 0.75 },
  disgust: { stability: 0.65, similarity_boost: 0.75 },
  sleep:   { stability: 0.80, similarity_boost: 0.70 },
};

// Background options (same as Maya section)
const BACKGROUNDS = {
  default: { type: 'color', value: '#0a0a10' },
  office:  { type: 'image', value: '/backgrounds/office.jpg' },
  living:  { type: 'image', value: '/backgrounds/living.jpg' },
  nature:  { type: 'image', value: '/backgrounds/nature.jpg' },
  beach:   { type: 'image', value: '/backgrounds/beach.jpg' },
};

// Background position per camera view
const BG_VIEW = {
  full:  { size: 'cover', pos: 'center bottom' },
  upper: { size: '130%', pos: 'center 25%' },
  mid:   { size: '150%', pos: 'center 15%' },
  head:  { size: '200%', pos: 'center top' },
};

// Lighting presets
const LIGHTING_PRESETS = {
  studio:   { ambientLightColor: 0xffffff, ambientLightIntensity: 0.7, directionalLightColor: 0xffffff, directionalLightIntensity: 1.2, directionalLightPhi: 0.8, directionalLightTheta: 0 },
  warm:     { ambientLightColor: 0xffd6aa, ambientLightIntensity: 0.6, directionalLightColor: 0xffcc88, directionalLightIntensity: 1.0, directionalLightPhi: 0.7, directionalLightTheta: 0.3 },
  cool:     { ambientLightColor: 0xaaccff, ambientLightIntensity: 0.6, directionalLightColor: 0xaaddff, directionalLightIntensity: 1.0, directionalLightPhi: 0.9, directionalLightTheta: -0.2 },
  dramatic: { ambientLightColor: 0x444466, ambientLightIntensity: 0.3, directionalLightColor: 0xffffee, directionalLightIntensity: 1.5, directionalLightPhi: 0.5, directionalLightTheta: 0.5 },
  soft:     { ambientLightColor: 0xffeedd, ambientLightIntensity: 0.8, directionalLightColor: 0xffffff, directionalLightIntensity: 0.6, directionalLightPhi: 1.0, directionalLightTheta: 0 },
};

const DEFAULT_APPEARANCE = {
  cameraView: 'head',
  background: 'default',
  mood: 'happy',
  lighting: 'studio',
};

const State = {
  LOADING: 'loading',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  RECORDING: 'recording',
  PAUSED: 'paused',
};

// ── ConnectSection Class ──────────────────────────────────────────────────────

export class ConnectSection {
  constructor(options = {}) {
    this.ttsService = options.ttsService;
    this.isMuted = options.isMuted || (() => false);
    this.setMuted = options.setMuted || (() => {});
    this.onStateChange = options.onStateChange || null;
    this.onAppearanceChange = options.onAppearanceChange || null;
    this.cloudAppearance = options.cloudAppearance || null;

    // TalkingHead
    this.TalkingHead = null;
    this.head = null;
    this.container = null;
    this.avatarContainer = null;

    // State
    this.state = State.LOADING;
    this.conversationHistory = [];
    this.currentMood = 'happy';

    // Speech recognition
    this.speechRecognition = null;
    this.isListening = false;

    // Abort controller
    this.currentAbort = null;

    // Echo detection
    this.currentMayaSpeech = '';

    // Input serialization
    this.processingInput = false;
    this.pendingInput = null;

    // ConnectStore
    this.store = null;

    // SSE for incoming messages
    this.eventSource = null;

    // Voice recording
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;
    this.voiceRecordTarget = null; // contact name for current recording

    // UI elements
    this.els = {};

    // Selected contact
    this.selectedContactId = null;

    // Appearance settings
    this.appearance = { ...DEFAULT_APPEARANCE };
  }

  // ── Mount / Lifecycle ───────────────────────────────────────────────────────

  async mount(container, savedState) {
    console.log('[Connect] Mounting section');
    this.container = container;

    // Initialize store
    this.store = ConnectStore.getInstance();
    await this.store.initialize();

    // Restore saved state
    if (savedState) {
      this.conversationHistory = savedState.conversationHistory || [];
      this.currentMood = savedState.mood || 'happy';
      if (savedState.appearance) {
        this.appearance = { ...DEFAULT_APPEARANCE, ...savedState.appearance };
      }
    } else if (this.cloudAppearance) {
      // First mount — apply cloud-persisted appearance
      this.appearance = { ...DEFAULT_APPEARANCE, ...this.cloudAppearance };
      this.currentMood = this.appearance.mood || 'happy';
    }

    // Build UI
    this.createUI();

    // Ensure AudioContext is ready
    await AudioManager.resume();

    // Load TalkingHead
    this.state = State.LOADING;
    await this.loadTalkingHead();
    await this.initAvatar();

    // Init speech recognition
    this.initSpeechRecognition();

    // Connect SSE for incoming messages
    this.connectSSE();

    // Start listening
    this.state = State.LISTENING;
    this.updateStatusUI('Listening...');
    this.startListening();

    // Render contacts
    this.renderContacts();

    // Greet user
    this.greet();
  }

  pause() {
    console.log('[Connect] Pausing');
    this.stopListening();
    this.disconnectSSE();
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    this.head?.stopSpeaking();
    this.currentMayaSpeech = '';
    this.state = State.PAUSED;
    return this.getState();
  }

  async resume(savedState) {
    console.log('[Connect] Resuming');
    if (savedState) {
      this.conversationHistory = savedState.conversationHistory || this.conversationHistory;
      this.currentMood = savedState.mood || this.currentMood;
    }
    await AudioManager.resume();
    this.connectSSE();
    this.state = State.LISTENING;
    this.updateStatusUI('Listening...');
    this.startListening();
  }

  unmount() {
    console.log('[Connect] Unmounting');
    this.stopListening();
    this.disconnectSSE();
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    this.head = null;
    if (this.container) this.container.innerHTML = '';
  }

  getState() {
    return {
      conversationHistory: this.conversationHistory,
      appearance: this.appearance,
      mood: this.currentMood,
    };
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  createUI() {
    this.container.innerHTML = `
      <div class="connect-wrapper">
        <div class="connect-layout">
          <div class="connect-sidebar">
            <div class="sidebar-header">Contacts</div>
            <div class="contact-list" id="connect-contact-list"></div>
            <button class="add-contact-btn" id="connect-add-btn">+ Add Contact</button>
          </div>
          <div class="connect-main" id="connect-bg-container">
            <!-- Appearance Button -->
            <button class="connect-appearance-btn" id="connect-appearance-btn" title="Appearance">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <rect x="2" y="2" width="20" height="20" rx="3"/>
                <circle cx="8.5" cy="8.5" r="1.5"/>
                <path d="M21 15l-5-5L5 21"/>
              </svg>
            </button>
            <!-- Appearance Overlay -->
            <div class="connect-appearance-overlay" id="connect-appearance-overlay"></div>
            <!-- Appearance Panel -->
            <div class="connect-appearance-panel" id="connect-appearance-panel">
              <div class="appearance-header">
                <h3>Appearance</h3>
                <button id="connect-appearance-close">&#10005;</button>
              </div>
              <div class="appearance-section">
                <label>Camera View</label>
                <div class="appearance-btn-group" data-setting="cameraView">
                  <button data-value="head" class="active">Head</button>
                  <button data-value="upper">Upper Body</button>
                  <button data-value="mid">Torso Up</button>
                  <button data-value="full">Full Body</button>
                </div>
              </div>
              <div class="appearance-section">
                <label>Background</label>
                <div class="appearance-btn-group" data-setting="background">
                  <button data-value="default" class="active">Default</button>
                  <button data-value="office">Office</button>
                  <button data-value="living">Living Room</button>
                  <button data-value="nature">Nature</button>
                  <button data-value="beach">Beach</button>
                </div>
              </div>
              <div class="appearance-section">
                <label>Mood</label>
                <div class="appearance-btn-group" data-setting="mood">
                  <button data-value="neutral">Neutral</button>
                  <button data-value="happy" class="active">Happy</button>
                  <button data-value="angry">Angry</button>
                  <button data-value="sad">Sad</button>
                  <button data-value="love">Love</button>
                </div>
              </div>
              <div class="appearance-section">
                <label>Lighting</label>
                <div class="appearance-btn-group" data-setting="lighting">
                  <button data-value="studio" class="active">Studio</button>
                  <button data-value="warm">Warm</button>
                  <button data-value="cool">Cool</button>
                  <button data-value="dramatic">Dramatic</button>
                  <button data-value="soft">Soft</button>
                </div>
              </div>
            </div>
            <div class="connect-avatar-area" id="connect-avatar-container"></div>
          </div>
        </div>
        <div class="connect-bottom-area">
          <div class="connect-messages" id="connect-messages">
            <div class="messages-placeholder">Select a contact to view messages</div>
          </div>
          <div class="connect-bottom-bar">
            <div class="connect-status" id="connect-status">Loading...</div>
            <div class="connect-transcript" id="connect-transcript"></div>
            <div class="connect-recording hidden" id="connect-recording">
              <div class="recording-indicator"></div>
              <span>Recording...</span>
              <button class="recording-stop-btn" id="connect-stop-record">Stop</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Cache elements
    this.avatarContainer = this.container.querySelector('#connect-avatar-container');
    this.bgContainer = this.container.querySelector('#connect-bg-container');
    this.els.contactList = this.container.querySelector('#connect-contact-list');
    this.els.addBtn = this.container.querySelector('#connect-add-btn');
    this.els.messages = this.container.querySelector('#connect-messages');
    this.els.status = this.container.querySelector('#connect-status');
    this.els.transcript = this.container.querySelector('#connect-transcript');
    this.els.recording = this.container.querySelector('#connect-recording');
    this.els.stopRecord = this.container.querySelector('#connect-stop-record');
    this.els.appearancePanel = this.container.querySelector('#connect-appearance-panel');
    this.els.appearanceOverlay = this.container.querySelector('#connect-appearance-overlay');

    // Event listeners
    this.els.addBtn.addEventListener('click', () => {
      this.processInput("I'd like to add a new contact");
    });

    this.els.stopRecord.addEventListener('click', () => {
      this.stopVoiceRecording();
    });

    // Appearance panel events
    this.setupAppearanceEvents();

    // Sync appearance button states to current values
    this.syncAppearanceUI();
  }

  // ── Appearance Panel ──────────────────────────────────────────────────────

  setupAppearanceEvents() {
    const openBtn = this.container.querySelector('#connect-appearance-btn');
    const closeBtn = this.container.querySelector('#connect-appearance-close');
    const overlay = this.els.appearanceOverlay;
    const panel = this.els.appearancePanel;

    const openPanel = () => { overlay.classList.add('open'); panel.classList.add('open'); };
    const closePanel = () => { overlay.classList.remove('open'); panel.classList.remove('open'); };

    openBtn.addEventListener('click', openPanel);
    overlay.addEventListener('click', closePanel);
    closeBtn.addEventListener('click', closePanel);

    const applyFns = {
      cameraView: (v) => { this.appearance.cameraView = v; this.head?.setView(v); this.updateBackgroundCSS(); },
      background: (v) => { this.appearance.background = v; this.updateBackgroundCSS(); },
      mood: (v) => { this.appearance.mood = v; this.currentMood = v; this.head?.setMood(v); },
      lighting: (v) => { this.appearance.lighting = v; if (this.head && LIGHTING_PRESETS[v]) this.head.setLighting(LIGHTING_PRESETS[v]); },
    };

    this.container.querySelectorAll('.appearance-btn-group').forEach(group => {
      const setting = group.dataset.setting;
      group.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          if (applyFns[setting]) applyFns[setting](btn.dataset.value);
          // Persist appearance to Supabase
          if (this.onAppearanceChange) this.onAppearanceChange({ ...this.appearance });
        });
      });
    });
  }

  syncAppearanceUI() {
    const panel = this.els.appearancePanel;
    if (!panel) return;
    const current = this.appearance;
    panel.querySelectorAll('.appearance-btn-group').forEach(group => {
      const setting = group.dataset.setting;
      const activeValue = current[setting];
      group.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === activeValue);
      });
    });
  }

  updateBackgroundCSS() {
    if (!this.bgContainer) return;
    const bg = BACKGROUNDS[this.appearance.background] || BACKGROUNDS.default;
    if (bg.type === 'image') {
      const view = BG_VIEW[this.appearance.cameraView] || BG_VIEW.full;
      this.bgContainer.style.backgroundColor = '#0a0a10';
      this.bgContainer.style.backgroundImage = `url('${bg.value}')`;
      this.bgContainer.style.backgroundSize = view.size;
      this.bgContainer.style.backgroundPosition = view.pos;
    } else {
      this.bgContainer.style.backgroundImage = 'none';
      this.bgContainer.style.backgroundColor = bg.value;
    }
  }

  updateStatusUI(text) {
    if (this.els.status) this.els.status.textContent = text;
  }

  renderContacts() {
    const contacts = this.store.getContacts();
    const list = this.els.contactList;
    if (!list) return;

    if (contacts.length === 0) {
      list.innerHTML = '<div class="no-contacts">No contacts yet. Say "Add a contact" to get started.</div>';
      return;
    }

    list.innerHTML = contacts.map(c => {
      const isSelected = c.id === this.selectedContactId;
      // Count unread for this contact
      const msgs = this.store.getMessages(c.id, 100);
      const unread = msgs.filter(m => m.direction === 'received' && !m.read).length;
      return `
        <div class="contact-item ${isSelected ? 'selected' : ''}" data-contact-id="${c.id}">
          <div class="contact-avatar">${c.name.charAt(0).toUpperCase()}</div>
          <div class="contact-info">
            <div class="contact-name">${c.name}</div>
            <div class="contact-phone">${c.phone}</div>
          </div>
          ${unread > 0 ? `<div class="contact-badge">${unread}</div>` : ''}
        </div>
      `;
    }).join('');

    // Click handlers
    list.querySelectorAll('.contact-item').forEach(el => {
      el.addEventListener('click', () => {
        const contactId = parseInt(el.dataset.contactId);
        this.selectContact(contactId);
      });
    });
  }

  selectContact(contactId) {
    this.selectedContactId = contactId;
    this.store.markRead(contactId);
    this.renderContacts();
    this.renderMessages(contactId);
  }

  renderMessages(contactId) {
    const messages = this.store.getMessages(contactId);
    const container = this.els.messages;
    if (!container) return;

    if (messages.length === 0) {
      container.innerHTML = '<div class="messages-placeholder">No messages yet</div>';
      return;
    }

    const esc = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

    container.innerHTML = messages.map(m => {
      const time = new Date(m.timestamp + 'Z').toLocaleTimeString('en-US', {
        hour: 'numeric', minute: '2-digit',
      });
      let content;
      if (m.type === 'image' && m.media_url) {
        const caption = m.body ? `<div class="message-text">${esc(m.body)}</div>` : '';
        content = `<img class="message-image" src="${esc(m.media_url)}" alt="Photo" loading="lazy">${caption}`;
      } else if (m.type === 'voice') {
        content = '<div class="message-text">(voice message)</div>';
      } else {
        content = `<div class="message-text">${esc(m.body || '')}</div>`;
      }
      return `
        <div class="message-bubble ${m.direction}">
          ${content}
          <div class="message-time">${time}</div>
        </div>
      `;
    }).join('');

    // Scroll to bottom
    container.scrollTop = container.scrollHeight;
  }

  // ── TalkingHead Avatar ──────────────────────────────────────────────────────

  async loadTalkingHead() {
    try {
      const module = await import('/modules/talkinghead.mjs');
      this.TalkingHead = module.TalkingHead;
      console.log('[Connect] TalkingHead module loaded');
    } catch (err) {
      console.error('[Connect] Failed to load TalkingHead:', err);
      throw err;
    }
  }

  async initAvatar() {
    const audioCtx = AudioManager.getContext();

    this.head = new this.TalkingHead(this.avatarContainer, {
      ttsEndpoint: null,
      audioCtx: audioCtx,
      cameraView: this.appearance.cameraView,
      cameraRotateEnable: true,
      lipsyncLang: 'en',
      lipsyncModules: ['en'],
    });

    await this.head.showAvatar({
      url: AVATAR_URL,
      body: 'F',
      avatarMood: this.appearance.mood,
      lipsyncLang: 'en',
    });

    this.head.setMood(this.appearance.mood);
    this.updateBackgroundCSS();
    console.log('[Connect] Avatar loaded');
  }

  // ── Speech Recognition ──────────────────────────────────────────────────────

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('[Connect] Speech recognition not supported');
      return;
    }

    this.speechRecognition = new SpeechRecognition();
    this.speechRecognition.continuous = false;
    this.speechRecognition.interimResults = false;
    this.speechRecognition.lang = 'en-US';

    this.speechRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const avatarSpeaking = !!this.head?.isSpeaking;
      console.log('[Connect] Heard:', transcript, `(avatarSpeaking: ${avatarSpeaking})`);
      this.isListening = false;

      // ── Global mute check (must be first) ──────────────────────────────
      if (this.isMuted()) {
        if (isUnmuteCommand(transcript)) {
          console.log('[Connect] Unmute command detected');
          this.setMuted(false);
          this.speakText("I'm back! What can I help you with?");
        } else {
          console.log('[Connect] Muted, ignoring:', transcript.substring(0, 40));
          setTimeout(() => this.startListening(), 300);
        }
        return;
      }

      if (isMuteCommand(transcript)) {
        console.log('[Connect] Mute command detected');
        this.speakText("I'll be quiet. Say unmute when you need me.").then(() => {
          this.setMuted(true);
        });
        return;
      }

      // Update transcript display
      if (this.els.transcript) this.els.transcript.textContent = transcript;

      if (avatarSpeaking) {
        if (this.isLikelyEcho(transcript)) {
          console.log('[Connect] Ignoring likely echo');
          setTimeout(() => this.startListening(), 300);
          return;
        }
        console.log('[Connect] Barge-in detected');
        this.bargeIn();
      }

      if (this.processingInput) {
        this.pendingInput = transcript;
        return;
      }

      this.processInput(transcript);
    };

    this.speechRecognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        if (this.state === State.LISTENING) {
          setTimeout(() => this.startListening(), 500);
        }
        return;
      }
      console.error('[Connect] Speech error:', event.error);
    };

    this.speechRecognition.onend = () => {
      this.isListening = false;
      if (this.state === State.LISTENING) {
        setTimeout(() => this.startListening(), 300);
      }
    };
  }

  startListening() {
    if (!this.speechRecognition) return;
    if (this.isListening) return;
    if (this.state === State.PAUSED) return;
    if (this.state === State.RECORDING) return;

    try {
      this.speechRecognition.start();
      this.isListening = true;
    } catch (e) {
      console.error('[Connect] Failed to start recognition:', e.message);
    }
  }

  stopListening() {
    if (!this.speechRecognition) return;
    if (!this.isListening) return;

    try {
      this.speechRecognition.stop();
      this.isListening = false;
    } catch (e) { /* ignore */ }
  }

  // ── Echo Detection ──────────────────────────────────────────────────────────

  isLikelyEcho(transcript) {
    if (!this.currentMayaSpeech) return false;

    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const heardWords = normalize(transcript).split(/\s+/).filter(w => w.length > 2);
    const mayaWords = normalize(this.currentMayaSpeech).split(/\s+/);

    if (heardWords.length === 0 || mayaWords.length === 0) return false;

    let matchCount = 0;
    for (const word of heardWords) {
      if (mayaWords.includes(word)) matchCount++;
    }

    const matchRatio = matchCount / heardWords.length;
    return matchRatio > 0.5;
  }

  // ── Barge-In ────────────────────────────────────────────────────────────────

  bargeIn() {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    this.head?.stopSpeaking();
    this.currentMayaSpeech = '';
    this.state = State.LISTENING;
    this.updateStatusUI('Listening...');
  }

  // ── Input Processing ────────────────────────────────────────────────────────

  async processInput(text) {
    if (!text || !text.trim()) return;

    this.processingInput = true;
    this.state = State.PROCESSING;
    this.updateStatusUI('Thinking...');

    try {
      await this.runConversation(text);
    } catch (err) {
      console.error('[Connect] processInput error:', err);
    }

    this.processingInput = false;

    // Process pending input
    if (this.pendingInput) {
      const next = this.pendingInput;
      this.pendingInput = null;
      await this.processInput(next);
    } else if (this.state !== State.RECORDING && this.state !== State.PAUSED) {
      this.state = State.LISTENING;
      this.updateStatusUI('Listening...');
      this.startListening();
    }
  }

  // ── Claude Conversation ─────────────────────────────────────────────────────

  async runConversation(userText) {
    // Abort any in-flight conversation
    if (this.currentAbort) this.currentAbort.abort();
    const abort = new AbortController();
    this.currentAbort = abort;

    // Add user message
    this.conversationHistory.push({ role: 'user', content: userText });
    if (this.conversationHistory.length > 20) this.conversationHistory.splice(0, 2);

    // Get contacts for system prompt
    const contacts = this.store.getContacts().map(c => ({ name: c.name, phone: c.phone }));

    let buffer = '';
    let fullResponse = '';
    let moodParsed = false;
    let responseMood = 'neutral';

    // TTS queue for ordered playback
    let enqueueSeq = 0;
    let nextSpeakSeq = 0;
    const audioCache = {};
    const ttsTasks = [];

    const flushAudioQueue = () => {
      while (Object.hasOwn(audioCache, nextSpeakSeq)) {
        const entry = audioCache[nextSpeakSeq];
        delete audioCache[nextSpeakSeq];
        nextSpeakSeq++;
        if (abort.signal.aborted) continue;
        if (entry) {
          if (this.state === State.PROCESSING) {
            this.state = State.SPEAKING;
            this.updateStatusUI('Speaking...');
          }
          this.head.speakAudio(
            { audio: entry.audioBuf, words: entry.timing.words,
              wtimes: entry.timing.wtimes, wdurations: entry.timing.wdurations },
            { lipsyncLang: 'en' }
          );
        }
      }
    };

    const fetchTTS = async (sentence, seq) => {
      try {
        const res = await fetch(TTS_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: sentence,
            voice_settings: MOOD_VOICE_SETTINGS[responseMood] || MOOD_VOICE_SETTINGS.neutral,
          }),
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
        const data = await res.json();
        const arrayBuf = this.base64ToArrayBuffer(data.audio_base64);
        const audioBuf = await AudioManager.decodeAudio(arrayBuf);
        const timing = this.alignmentToWords(data.normalized_alignment || data.alignment);
        audioCache[seq] = { audioBuf, timing };
      } catch (err) {
        if (abort.signal.aborted) return;
        console.error(`[Connect TTS] seq ${seq} error:`, err);
        audioCache[seq] = null;
      }
      flushAudioQueue();
    };

    const scheduleTTS = (sentence) => {
      if (!sentence.trim()) return;
      const seq = enqueueSeq++;
      ttsTasks.push(fetchTTS(sentence, seq));
    };

    try {
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.conversationHistory,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          contacts,
        }),
        signal: abort.signal,
      });
      if (!res.ok) throw new Error(`Chat HTTP ${res.status}`);

      const reader = res.body.getReader();
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
          if (!parsed.text) continue;

          buffer += parsed.text;
          fullResponse += parsed.text;
          this.currentMayaSpeech = fullResponse;

          // Parse [MOOD:xxx] tag
          if (!moodParsed) {
            if (fullResponse.includes(']')) {
              const moodMatch = fullResponse.match(/^\[MOOD:(\w+)\]\s*/);
              if (moodMatch) {
                responseMood = moodMatch[1].toLowerCase();
                const tagLen = moodMatch[0].length;
                fullResponse = fullResponse.slice(tagLen);
                buffer = buffer.slice(tagLen);
                this.applyMood(responseMood);
              }
              moodParsed = true;
            } else if (fullResponse.length > 20 && !fullResponse.startsWith('[MOOD:')) {
              moodParsed = true;
            }
            if (!moodParsed) continue;
          }

          // Strip any additional [MOOD:xxx] tags
          buffer = buffer.replace(/\[MOOD:\w+\]\s*/g, '');
          fullResponse = fullResponse.replace(/\[MOOD:\w+\]\s*/g, '');

          // Flush complete sentences to TTS
          const m = buffer.match(/[.!?]\s/);
          if (m) {
            const sentence = buffer.substring(0, m.index + 1).trim();
            buffer = buffer.substring(m.index + 2);
            // Check for ACTION tags in the sentence — strip before TTS
            const cleaned = this.stripActionTags(sentence);
            if (cleaned.trim()) scheduleTTS(cleaned);
          }
        }
      }

      // Flush trailing text
      if (buffer.trim()) {
        const cleaned = this.stripActionTags(buffer.trim());
        if (cleaned.trim()) scheduleTTS(cleaned);
      }

      // Wait for TTS to complete
      await Promise.all(ttsTasks);

      // Add to history
      this.conversationHistory.push({ role: 'assistant', content: fullResponse });
      if (this.conversationHistory.length > 20) this.conversationHistory.splice(0, 2);

      // Parse and execute ACTION tags from the full response
      await this.parseAndExecuteActions(fullResponse);

      // Wait for avatar to finish speaking
      await this.waitForSpeechEnd();

      this.currentMayaSpeech = '';

    } catch (err) {
      if (abort.signal.aborted) {
        console.log('[Connect] Conversation aborted (barge-in)');
        return;
      }
      console.error('[Connect] Conversation error:', err);
    }
  }

  // ── ACTION Tag Parsing ──────────────────────────────────────────────────────

  stripActionTags(text) {
    return text.replace(/\[ACTION:[^\]]*\]\s*/g, '');
  }

  async parseAndExecuteActions(text) {
    // Find all ACTION tags in the response
    const actionRegex = /\[ACTION:(\w+)([^\]]*)\]/g;
    let match;

    while ((match = actionRegex.exec(text)) !== null) {
      const action = match[1];
      const paramsStr = match[2].trim();
      console.log(`[Connect] Action: ${action}, params: ${paramsStr}`);

      await this.executeAction(action, paramsStr);
    }
  }

  parseActionParams(paramsStr) {
    const params = {};
    const regex = /(\w+)="([^"]*)"/g;
    let m;
    while ((m = regex.exec(paramsStr)) !== null) {
      params[m[1]] = m[2];
    }
    return params;
  }

  async executeAction(action, paramsStr) {
    const params = this.parseActionParams(paramsStr);

    switch (action) {
      case 'ADD_CONTACT': {
        const { name, phone } = params;
        if (name && phone) {
          const contact = this.store.addContact(name, phone);
          if (contact) {
            console.log(`[Connect] Added contact: ${name} (${phone})`);
            this.renderContacts();
            this.selectContact(contact.id);
          }
        }
        break;
      }

      case 'SEND_TEXT': {
        const { to, message } = params;
        if (to && message) {
          const contact = this.store.findContactByName(to);
          if (contact) {
            try {
              const res = await fetch(SEND_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ to: contact.phone, body: message }),
              });
              const data = await res.json();
              if (data.success) {
                console.log(`[Connect] Sent text to ${to}: ${message}`);
                this.store.addMessage(contact.id, 'sent', 'text', message, null);
                this.selectContact(contact.id);
              } else {
                console.error('[Connect] Send failed:', data.error);
              }
            } catch (err) {
              console.error('[Connect] Send error:', err);
            }
          } else {
            console.warn(`[Connect] Contact not found: ${to}`);
          }
        }
        break;
      }

      case 'SEND_VOICE': {
        const { to } = params;
        if (to) {
          this.voiceRecordTarget = to;
          await this.startVoiceRecording();
        }
        break;
      }

      case 'PLAY_MESSAGE': {
        await this.playUnreadMessages();
        break;
      }

      case 'CANCEL': {
        this.voiceRecordTarget = null;
        if (this.isRecording) this.stopVoiceRecording();
        break;
      }
    }
  }

  // ── Voice Recording ─────────────────────────────────────────────────────────

  async startVoiceRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm;codecs=opus',
      });

      this.recordedChunks = [];

      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) this.recordedChunks.push(e.data);
      };

      this.mediaRecorder.onstop = async () => {
        // Stop all tracks
        stream.getTracks().forEach(t => t.stop());

        const audioBlob = new Blob(this.recordedChunks, { type: 'audio/webm;codecs=opus' });
        await this.sendVoiceMessage(audioBlob);
      };

      this.mediaRecorder.start();
      this.isRecording = true;
      this.state = State.RECORDING;
      this.stopListening();

      // Show recording UI
      this.els.recording?.classList.remove('hidden');
      this.updateStatusUI('Recording voice message...');

      // Auto-stop after 30 seconds
      this._recordingTimeout = setTimeout(() => {
        if (this.isRecording) this.stopVoiceRecording();
      }, 30000);

      console.log('[Connect] Voice recording started');
    } catch (err) {
      console.error('[Connect] Failed to start recording:', err);
    }
  }

  stopVoiceRecording() {
    if (!this.isRecording || !this.mediaRecorder) return;

    clearTimeout(this._recordingTimeout);
    this.mediaRecorder.stop();
    this.isRecording = false;

    // Hide recording UI
    this.els.recording?.classList.add('hidden');

    console.log('[Connect] Voice recording stopped');
  }

  async sendVoiceMessage(audioBlob) {
    const contactName = this.voiceRecordTarget;
    if (!contactName) return;

    const contact = this.store.findContactByName(contactName);
    if (!contact) {
      console.warn(`[Connect] Contact not found for voice: ${contactName}`);
      return;
    }

    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'voice.webm');
      formData.append('to', contact.phone);

      const res = await fetch(SEND_URL, { method: 'POST', body: formData });
      const data = await res.json();

      if (data.success) {
        console.log(`[Connect] Voice message sent to ${contactName}`);
        this.store.addMessage(contact.id, 'sent', 'voice', null, null);
        this.selectContact(contact.id);

        // Maya confirms
        await this.speakText(`Your voice message has been sent to ${contactName}!`);
      } else {
        console.error('[Connect] Voice send failed:', data.error);
        await this.speakText(`Sorry, I couldn't send that voice message. ${data.error}`);
      }
    } catch (err) {
      console.error('[Connect] Voice send error:', err);
      await this.speakText("Sorry, something went wrong sending your voice message.");
    }

    this.voiceRecordTarget = null;
    this.state = State.LISTENING;
    this.updateStatusUI('Listening...');
    this.startListening();
  }

  // ── Play Unread Messages ────────────────────────────────────────────────────

  async playUnreadMessages() {
    const unread = this.store.getUnreadMessages();
    if (unread.length === 0) return;

    for (const msg of unread) {
      if (msg.type === 'text' && msg.body) {
        const { spokenText, emojis } = convertEmojisToSpeech(msg.body);

        // Set avatar mood from emoji sentiment
        const emojiMood = extractDominantEmojiMood(emojis);
        if (emojiMood) this.applyMood(emojiMood);

        // Emoji-only messages get summarized ("Carol sent: with love.")
        if (isEmojiOnly(msg.body) && emojis.length > 0) {
          const unique = [...new Set(emojis.map(e => e.speech))];
          await this.speakText(`${msg.contact_name} sent: ${unique.join(' and ')}.`);
        } else {
          await this.speakText(`${msg.contact_name} says: ${spokenText}`);
        }
      } else if (msg.type === 'image') {
        const caption = msg.body ? `, with the caption: ${msg.body}` : '';
        await this.speakText(`${msg.contact_name} sent a photo${caption}.`);
      } else if (msg.type === 'voice' && msg.media_url) {
        await this.speakText(`Voice message from ${msg.contact_name}.`);
        // Play the voice audio (served from our local server)
        try {
          const audioRes = await fetch(msg.media_url);
          if (!audioRes.ok) throw new Error(`HTTP ${audioRes.status}`);
          const arrayBuf = await audioRes.arrayBuffer();

          // Try decoding via AudioContext (supports ogg, mp3, mp4, etc.)
          const actx = new (window.AudioContext || window.webkitAudioContext)();
          const audioBuf = await actx.decodeAudioData(arrayBuf);
          const source = actx.createBufferSource();
          source.buffer = audioBuf;
          source.connect(actx.destination);
          source.start();

          // Wait for playback to finish
          await new Promise(resolve => { source.onended = resolve; });
          actx.close();
        } catch (err) {
          console.error('[Connect] Failed to play voice message:', err);
          await this.speakText("Sorry, I couldn't play that voice message.");
        }
      }
      // Mark as read
      this.store.markRead(msg.contact_id);
    }

    this.renderContacts();
    if (this.selectedContactId) this.renderMessages(this.selectedContactId);
  }

  // ── SSE for Incoming Messages ───────────────────────────────────────────────

  connectSSE() {
    if (this.eventSource) this.disconnectSSE();

    this.eventSource = new EventSource(SSE_URL);

    this.eventSource.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'message') {
          this.handleIncomingMessage(msg);
        }
      } catch (err) {
        console.error('[Connect] SSE parse error:', err);
      }
    };

    this.eventSource.onerror = () => {
      console.warn('[Connect] SSE connection error, will auto-reconnect');
    };

    console.log('[Connect] SSE connected');
  }

  disconnectSSE() {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  async handleIncomingMessage(msg) {
    console.log(`[Connect] Incoming message from ${msg.from}: ${msg.body || '(media)'}`);

    // Find or create contact
    let contact = this.store.findContactByPhone(msg.from);
    if (!contact) {
      // Unknown sender — save with phone as name
      contact = this.store.addContact(msg.from, msg.from);
    }

    // Determine message type
    const type = (msg.mediaType && msg.mediaType.startsWith('audio')) ? 'voice'
      : (msg.mediaType && msg.mediaType.startsWith('image')) ? 'image'
      : 'text';

    // Save message
    this.store.addMessage(
      contact.id,
      'received',
      type,
      msg.body || null,
      msg.mediaUrl || null
    );

    // Update UI
    this.renderContacts();
    if (this.selectedContactId === contact.id) {
      this.renderMessages(contact.id);
    }

    // Announce if not currently speaking
    if (this.state !== State.SPEAKING && this.state !== State.PROCESSING) {
      const name = contact.name || 'someone';
      await this.speakText(`You have a message from ${name}. Would you like to hear it?`);
    }
  }

  // ── TTS Helpers ─────────────────────────────────────────────────────────────

  async speakText(text) {
    this.currentMayaSpeech = text;
    this.state = State.SPEAKING;
    this.updateStatusUI('Speaking...');

    const abort = new AbortController();
    this.currentAbort = abort;

    try {
      const res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice_settings: MOOD_VOICE_SETTINGS[this.currentMood] || MOOD_VOICE_SETTINGS.neutral,
        }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

      const data = await res.json();
      const arrayBuf = this.base64ToArrayBuffer(data.audio_base64);
      const audioBuf = await AudioManager.decodeAudio(arrayBuf);
      const timing = this.alignmentToWords(data.normalized_alignment || data.alignment);

      this.head.speakAudio(
        { audio: audioBuf, words: timing.words, wtimes: timing.wtimes, wdurations: timing.wdurations },
        { lipsyncLang: 'en' }
      );

      await this.waitForSpeechEnd();
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[Connect TTS] error:', err);
      }
    }

    this.currentMayaSpeech = '';
    this.state = State.LISTENING;
    this.updateStatusUI('Listening...');
    this.startListening();
  }

  async greet() {
    const contacts = this.store.getContacts();
    const unread = this.store.getUnreadCount();

    let greeting;
    if (unread > 0) {
      greeting = `You have ${unread} new message${unread > 1 ? 's' : ''}! Would you like to hear them?`;
    } else if (contacts.length === 0) {
      greeting = "Hi! I can help you send messages to your family and friends. Would you like to add a contact?";
    } else {
      greeting = "Hi! Would you like to send a message to someone, or check for new messages?";
    }

    await this.speakText(greeting);
  }

  // ── Mood ────────────────────────────────────────────────────────────────────

  applyMood(mood) {
    if (!VALID_MOODS.includes(mood)) mood = 'neutral';
    this.currentMood = mood;
    this.head?.setMood(mood);
  }

  // ── Audio Utilities ─────────────────────────────────────────────────────────

  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  alignmentToWords(alignment) {
    if (!alignment?.characters) {
      return { words: [], wtimes: [], wdurations: [] };
    }

    const chars = alignment.characters || [];
    const starts = alignment.character_start_times_seconds || [];
    const ends = alignment.character_end_times_seconds || [];

    const words = [];
    const wtimes = [];
    const wdurations = [];
    let word = '';
    let wordStart = 0;

    for (let i = 0; i < chars.length; i++) {
      const ch = chars[i];
      const start = starts[i] || 0;
      const end = ends[i] || start;

      if (ch === ' ' || i === chars.length - 1) {
        if (i === chars.length - 1 && ch !== ' ') word += ch;
        if (word) {
          words.push(word);
          wtimes.push(Math.round(wordStart * 1000));
          wdurations.push(Math.round((end - wordStart) * 1000));
        }
        word = '';
        wordStart = 0;
      } else {
        if (!word) wordStart = start;
        word += ch;
      }
    }

    return { words, wtimes, wdurations };
  }

  waitForSpeechEnd() {
    return new Promise((resolve) => {
      const check = () => {
        if (!this.head?.isSpeaking) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      setTimeout(check, 200);
    });
  }
}
