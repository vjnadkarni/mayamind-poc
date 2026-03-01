/**
 * MayaMind Dashboard — Maya Conversation Section
 *
 * TalkingHead avatar integration with Web Speech API for STT.
 * Supports pause/resume lifecycle for session persistence.
 * Integrates personalization system for learning user preferences.
 */

import { AudioManager } from '../../core/audio-manager.js';
import { personalization } from '../../core/personalization-store.js';
import { consentManager } from '../../core/consent-manager.js';
import { detectVoiceCommand, handleVoiceCommand, mightBeVoiceCommand, isMuteCommand, isUnmuteCommand } from '../../core/voice-commands.js';
import { processSessionEnd, extractInlinePreferences } from '../../core/extraction-pipeline.js';
import { checkContentSafety } from '../../core/content-safety.js';
import { showWhatMayaKnows } from '../../components/consent-modal.js';

// Avatar and module paths (absolute from server root - public/ is served at /)
const AVATAR_URL = '/avatars/brunette.glb';
const CHAT_URL = '/api/chat';
const TTS_URL = '/api/tts';

// Valid moods for TalkingHead
const VALID_MOODS = ['neutral', 'happy', 'angry', 'sad', 'fear', 'disgust', 'love', 'sleep'];

// Voice settings per mood
const MOOD_VOICE_SETTINGS = {
  neutral: { stability: 0.55, similarity_boost: 0.75 },
  happy:   { stability: 0.45, similarity_boost: 0.75 },
  angry:   { stability: 0.70, similarity_boost: 0.75 },
  sad:     { stability: 0.50, similarity_boost: 0.80 },
  fear:    { stability: 0.65, similarity_boost: 0.75 },
  disgust: { stability: 0.65, similarity_boost: 0.75 },
  love:    { stability: 0.50, similarity_boost: 0.80 },
  sleep:   { stability: 0.80, similarity_boost: 0.70 },
};

// Background options
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

// Default settings
const DEFAULT_SETTINGS = {
  cameraView: 'upper',
  background: 'default',
  mood: 'happy',
  lighting: 'studio',
};

// State constants
const State = {
  LOADING: 'loading',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
  PAUSED: 'paused',
};

export class MayaSection {
  constructor(options = {}) {
    this.ttsService = options.ttsService;
    this.isMuted = options.isMuted || (() => false);
    this.setMuted = options.setMuted || (() => {});
    this.onStateChange = options.onStateChange || null;

    // TalkingHead instance
    this.head = null;
    this.container = null;
    this.avatarContainer = null;

    // State
    this.state = State.LOADING;
    this.conversationHistory = [];
    this.currentMood = 'happy';

    // Settings
    this.settings = { ...DEFAULT_SETTINGS };

    // Speech recognition
    this.speechRecognition = null;
    this.isListening = false;

    // Abort controller for conversation
    this.currentAbort = null;

    // UI elements
    this.statusEl = null;
    this.transcriptEl = null;
    this.settingsPanel = null;
    this.settingsOverlay = null;

    // Personalization state
    this.personalizationReady = false;
    this.pendingConsentResponse = false;
    this.sessionTranscript = '';  // Accumulates for extraction
    this.exchangeCount = 0;       // Number of completed exchanges in this session
    this.tier2PromptShown = false; // Whether we've shown Tier 2 prompt this session

    // Echo detection: track what Maya is currently saying
    this.currentMayaSpeech = '';  // Text Maya is currently speaking

    // Input serialization: prevent overlapping handleUserInput calls
    this.processingInput = false;
    this.pendingInput = null;  // Queued input while processing

    // Consent injection: weave consent question into next Claude response
    this.pendingConsentInject = false;
  }

  /**
   * Mount the section
   */
  async mount(container, savedState) {
    console.log('[Maya] Mounting section');
    this.container = container;

    // Create UI
    this.createUI();

    // Restore state if provided
    if (savedState) {
      this.conversationHistory = savedState.conversationHistory || [];
      this.currentMood = savedState.mood || 'happy';
      if (savedState.settings) {
        this.settings = { ...DEFAULT_SETTINGS, ...savedState.settings };
      }
      this.sessionTranscript = savedState.sessionTranscript || '';
      this.exchangeCount = savedState.exchangeCount || 0;
      this.tier2PromptShown = savedState.tier2PromptShown || false;
      this.restoreTranscript();
      this.syncSettingsUI();
    }

    // Ensure AudioContext is ready
    await AudioManager.resume();

    // Initialize personalization system
    await this.initPersonalization();

    // Load TalkingHead module dynamically
    this.setStatus(State.LOADING, 'Loading avatar...');
    await this.loadTalkingHead();

    // Initialize TalkingHead
    await this.initAvatar();

    // Initialize speech recognition
    this.initSpeechRecognition();

    // Start listening
    this.setStatus(State.LISTENING, 'Listening...');
    this.startListening();

    // Check for consent reminders (after a brief delay to not interrupt greeting)
    setTimeout(() => this.checkConsentReminder(), 5000);
  }

  /**
   * Initialize the personalization system
   */
  async initPersonalization() {
    try {
      await personalization.initialize();
      this.personalizationReady = true;
      console.log('[Maya] Personalization initialized');

      // Log stats
      const stats = personalization.getStats();
      console.log('[Maya] Personalization stats:', stats);
    } catch (err) {
      console.error('[Maya] Personalization init failed:', err);
      this.personalizationReady = false;
    }
  }

  /**
   * Check if we should show a consent reminder
   */
  checkConsentReminder() {
    if (!this.personalizationReady) return;
    if (consentManager.shouldShowConsentReminder()) {
      const reminder = consentManager.generateConsentReminder();
      if (reminder) {
        // Queue Maya to speak the reminder
        this.queueMayaResponse(reminder);
      }
    }
  }

  /**
   * Create the UI elements
   */
  createUI() {
    this.container.innerHTML = `
      <div class="maya-container" id="maya-bg-container">
        <!-- Settings Button -->
        <button class="maya-settings-btn" id="maya-settings-btn" title="Settings">&#9881;</button>

        <!-- Settings Overlay -->
        <div class="maya-settings-overlay" id="maya-settings-overlay"></div>

        <!-- Settings Panel -->
        <div class="maya-settings-panel" id="maya-settings-panel">
          <div class="settings-header">
            <h3>Settings</h3>
            <button id="maya-settings-close">&#10005;</button>
          </div>

          <div class="settings-section">
            <label>Camera View</label>
            <div class="btn-group" data-setting="cameraView">
              <button data-value="head">Head</button>
              <button data-value="upper" class="active">Upper Body</button>
              <button data-value="mid">Torso Up</button>
              <button data-value="full">Full Body</button>
            </div>
          </div>

          <div class="settings-section">
            <label>Background</label>
            <div class="btn-group" data-setting="background">
              <button data-value="default" class="active">Default</button>
              <button data-value="office">Office</button>
              <button data-value="living">Living Room</button>
              <button data-value="nature">Nature</button>
              <button data-value="beach">Beach</button>
            </div>
          </div>

          <div class="settings-section">
            <label>Mood</label>
            <div class="btn-group" data-setting="mood">
              <button data-value="neutral">Neutral</button>
              <button data-value="happy" class="active">Happy</button>
              <button data-value="angry">Angry</button>
              <button data-value="sad">Sad</button>
              <button data-value="fear">Fear</button>
              <button data-value="disgust">Disgust</button>
              <button data-value="love">Love</button>
              <button data-value="sleep">Sleep</button>
            </div>
          </div>

          <div class="settings-section">
            <label>Lighting</label>
            <div class="btn-group" data-setting="lighting">
              <button data-value="studio" class="active">Studio</button>
              <button data-value="warm">Warm</button>
              <button data-value="cool">Cool</button>
              <button data-value="dramatic">Dramatic</button>
              <button data-value="soft">Soft</button>
            </div>
          </div>
        </div>

        <div class="maya-avatar" id="maya-avatar-container"></div>
        <div class="maya-hud">
          <div class="maya-status">
            <span class="status-dot"></span>
            <span class="status-text">Loading...</span>
          </div>
          <div class="maya-transcript" id="maya-transcript"></div>
        </div>
      </div>
      <style>
        .maya-container {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          background: #0a0a10;
          background-size: cover;
          background-position: center;
          background-repeat: no-repeat;
          position: relative;
        }
        .maya-avatar {
          flex: 1;
          position: relative;
        }
        .maya-avatar canvas {
          width: 100% !important;
          height: 100% !important;
        }
        .maya-hud {
          background: rgba(0, 0, 0, 0.8);
          padding: 16px;
          border-top: 1px solid rgba(255, 255, 255, 0.1);
        }
        .maya-status {
          display: flex;
          align-items: center;
          gap: 12px;
          margin-bottom: 12px;
        }
        .status-dot {
          width: 12px;
          height: 12px;
          border-radius: 50%;
          background: #666;
          animation: pulse 2s ease-in-out infinite;
        }
        .status-dot.listening { background: #4aff9f; }
        .status-dot.processing { background: #ffb84a; }
        .status-dot.speaking { background: #4a9eff; }
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        .status-text {
          color: #a0a0b0;
          font-size: 14px;
        }
        .maya-transcript {
          max-height: 150px;
          overflow-y: auto;
          font-size: 14px;
          line-height: 1.5;
        }
        .transcript-msg {
          padding: 8px 0;
          border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }
        .transcript-msg.user { color: #4aff9f; }
        .transcript-msg.assistant { color: #fff; }
        .transcript-msg .role {
          font-weight: 600;
          margin-right: 8px;
        }

        /* Settings Button */
        .maya-settings-btn {
          position: absolute;
          top: 12px;
          left: 12px;
          z-index: 20;
          background: rgba(30,30,46,0.85);
          border: 1px solid #333;
          border-radius: 10px;
          color: #999;
          font-size: 20px;
          width: 44px;
          height: 44px;
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .maya-settings-btn:hover { border-color: #555; color: #ddd; }

        /* Settings Overlay */
        .maya-settings-overlay {
          position: absolute;
          inset: 0;
          z-index: 30;
          background: rgba(0,0,0,0.5);
          backdrop-filter: blur(3px);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.25s;
        }
        .maya-settings-overlay.open { opacity: 1; pointer-events: auto; }

        /* Settings Panel */
        .maya-settings-panel {
          position: absolute;
          top: 0;
          left: 0;
          z-index: 31;
          width: 320px;
          max-width: 90%;
          height: 100%;
          background: #13131f;
          border-right: 1px solid #2a2a3a;
          overflow-y: auto;
          padding: 16px;
          transform: translateX(-100%);
          transition: transform 0.25s ease;
        }
        .maya-settings-panel.open { transform: translateX(0); }

        .settings-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 16px;
        }
        .settings-header h3 { font-size: 16px; color: #ccc; font-weight: 500; margin: 0; }
        #maya-settings-close {
          background: none;
          border: none;
          color: #777;
          font-size: 20px;
          cursor: pointer;
          padding: 4px 8px;
        }
        #maya-settings-close:hover { color: #ddd; }

        .settings-section {
          margin-bottom: 14px;
        }
        .settings-section label {
          display: block;
          font-size: 11px;
          color: #666;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          margin-bottom: 6px;
        }

        .btn-group {
          display: flex;
          flex-wrap: wrap;
          gap: 5px;
        }
        .btn-group button {
          background: #1e1e2e;
          border: 1px solid #2a2a3a;
          border-radius: 6px;
          color: #888;
          font-size: 12px;
          padding: 5px 10px;
          cursor: pointer;
          transition: all 0.15s;
        }
        .btn-group button:hover { border-color: #444; color: #bbb; }
        .btn-group button.active {
          background: #1a3a5c;
          border-color: #2a6090;
          color: #8cc8ff;
        }
      </style>
    `;

    this.avatarContainer = this.container.querySelector('#maya-avatar-container');
    this.transcriptEl = this.container.querySelector('#maya-transcript');
    this.statusEl = {
      dot: this.container.querySelector('.status-dot'),
      text: this.container.querySelector('.status-text'),
    };
    this.bgContainer = this.container.querySelector('#maya-bg-container');
    this.settingsPanel = this.container.querySelector('#maya-settings-panel');
    this.settingsOverlay = this.container.querySelector('#maya-settings-overlay');

    // Set up settings panel events
    this.setupSettingsEvents();
  }

  /**
   * Set up settings panel event handlers
   */
  setupSettingsEvents() {
    const settingsBtn = this.container.querySelector('#maya-settings-btn');
    const settingsClose = this.container.querySelector('#maya-settings-close');

    const openPanel = () => {
      this.settingsOverlay.classList.add('open');
      this.settingsPanel.classList.add('open');
    };

    const closePanel = () => {
      this.settingsOverlay.classList.remove('open');
      this.settingsPanel.classList.remove('open');
    };

    settingsBtn.addEventListener('click', openPanel);
    this.settingsOverlay.addEventListener('click', closePanel);
    settingsClose.addEventListener('click', closePanel);

    // Button group handlers
    const applyFns = {
      cameraView: (v) => this.applyCameraView(v),
      background: (v) => this.applyBackground(v),
      mood: (v) => this.applyMoodSetting(v),
      lighting: (v) => this.applyLighting(v),
    };

    this.container.querySelectorAll('.btn-group').forEach(group => {
      const setting = group.dataset.setting;
      group.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
          // Update active state
          group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          // Apply setting
          const value = btn.dataset.value;
          if (applyFns[setting]) applyFns[setting](value);
        });
      });
    });
  }

  /**
   * Apply camera view setting
   */
  applyCameraView(view) {
    this.settings.cameraView = view;
    this.head?.setView(view);
    this.updateBackgroundCSS();
  }

  /**
   * Apply background setting
   */
  applyBackground(bg) {
    this.settings.background = bg;
    this.updateBackgroundCSS();
  }

  /**
   * Apply mood setting from settings panel
   */
  applyMoodSetting(mood) {
    this.settings.mood = mood;
    this.currentMood = mood;
    this.head?.setMood(mood);
  }

  /**
   * Apply lighting setting
   */
  applyLighting(lighting) {
    this.settings.lighting = lighting;
    if (this.head && LIGHTING_PRESETS[lighting]) {
      this.head.setLighting(LIGHTING_PRESETS[lighting]);
    }
  }

  /**
   * Update background CSS based on settings
   */
  updateBackgroundCSS() {
    if (!this.bgContainer) return;

    const bg = BACKGROUNDS[this.settings.background] || BACKGROUNDS.default;

    if (bg.type === 'image') {
      const view = BG_VIEW[this.settings.cameraView] || BG_VIEW.full;
      this.bgContainer.style.backgroundColor = '#0a0a10';
      this.bgContainer.style.backgroundImage = `url('${bg.value}')`;
      this.bgContainer.style.backgroundSize = view.size;
      this.bgContainer.style.backgroundPosition = view.pos;
    } else {
      this.bgContainer.style.backgroundImage = 'none';
      this.bgContainer.style.backgroundColor = bg.value;
    }
  }

  /**
   * Sync settings UI buttons with current settings state
   */
  syncSettingsUI() {
    if (!this.settingsPanel) return;

    const current = {
      cameraView: this.settings.cameraView,
      background: this.settings.background,
      mood: this.settings.mood,
      lighting: this.settings.lighting,
    };

    this.settingsPanel.querySelectorAll('.btn-group').forEach(group => {
      const setting = group.dataset.setting;
      const activeValue = current[setting];
      group.querySelectorAll('button').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.value === activeValue);
      });
    });
  }

  /**
   * Load TalkingHead module
   */
  async loadTalkingHead() {
    try {
      // TalkingHead is served from /modules/ (public/ is the static root)
      const module = await import('/modules/talkinghead.mjs');
      this.TalkingHead = module.TalkingHead;
      console.log('[Maya] TalkingHead module loaded');
    } catch (err) {
      console.error('[Maya] Failed to load TalkingHead:', err);
      throw err;
    }
  }

  /**
   * Initialize the TalkingHead avatar
   */
  async initAvatar() {
    const audioCtx = AudioManager.getContext();

    this.head = new this.TalkingHead(this.avatarContainer, {
      ttsEndpoint: null,
      audioCtx: audioCtx,
      cameraView: this.settings.cameraView,
      cameraRotateEnable: true,
      lipsyncLang: 'en',
      lipsyncModules: ['en'],
    });

    await this.head.showAvatar({
      url: AVATAR_URL,
      body: 'F',
      avatarMood: this.settings.mood,
      lipsyncLang: 'en',
    });

    // Apply initial settings
    this.head.setMood(this.settings.mood);
    if (LIGHTING_PRESETS[this.settings.lighting]) {
      this.head.setLighting(LIGHTING_PRESETS[this.settings.lighting]);
    }
    this.updateBackgroundCSS();

    console.log('[Maya] Avatar loaded');
  }

  /**
   * Initialize Web Speech API for recognition
   */
  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('[Maya] Speech recognition not supported');
      return;
    }

    this.speechRecognition = new SpeechRecognition();
    this.speechRecognition.continuous = false;
    this.speechRecognition.interimResults = false;
    this.speechRecognition.lang = 'en-US';

    this.speechRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const confidence = event.results[0][0].confidence;
      const avatarSpeaking = !!this.head?.isSpeaking;
      console.log('[Maya] Heard:', transcript, `(confidence: ${(confidence * 100).toFixed(0)}%, state: ${this.state}, avatarSpeaking: ${avatarSpeaking})`);
      this.isListening = false;

      // ── Global mute check (must be first) ──────────────────────────────
      if (this.isMuted()) {
        if (isUnmuteCommand(transcript)) {
          console.log('[Maya] Unmute command detected');
          this.setMuted(false);
          this.speakResponse("I'm back! What can I help you with?");
        } else {
          console.log('[Maya] Muted, ignoring:', transcript.substring(0, 40));
          setTimeout(() => this.startListening(), 300);
        }
        return;
      }

      if (isMuteCommand(transcript)) {
        console.log('[Maya] Mute command detected');
        this.appendTranscript('user', transcript);
        this.speakResponse("I'll be quiet. Say unmute when you need me.").then(() => {
          this.setMuted(true);
        });
        return;
      }

      // Check if avatar is actually speaking (more reliable than state flag)
      if (avatarSpeaking) {
        // Echo detection: check if this is Maya's voice being picked up
        if (this.isLikelyEcho(transcript)) {
          console.log('[Maya] Ignoring likely echo');
          setTimeout(() => this.startListening(), 300);
          return;
        }
        // Real barge-in: user is speaking different content while Maya talks
        console.log('[Maya] Barge-in detected (avatar still speaking)');
        this.bargeIn();
      }

      // Serialize input processing: if already processing, queue this input
      if (this.processingInput) {
        console.log('[Maya] Queuing input (already processing):', transcript.substring(0, 40));
        this.pendingInput = transcript;
        return;
      }

      this.processInput(transcript);
    };

    this.speechRecognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        // Restart listening
        if (this.state === State.LISTENING) {
          setTimeout(() => this.startListening(), 500);
        }
        return;
      }
      console.error('[Maya] Speech error:', event.error);
    };

    this.speechRecognition.onend = () => {
      this.isListening = false;
      // Restart if we should be listening
      if (this.state === State.LISTENING) {
        setTimeout(() => this.startListening(), 300);
      }
    };
  }

  /**
   * Start listening for speech
   */
  startListening() {
    if (!this.speechRecognition) return;
    if (this.isListening) return;
    if (this.state === State.PAUSED) return;

    try {
      this.speechRecognition.start();
      this.isListening = true;
    } catch (e) {
      console.error('[Maya] Failed to start recognition:', e.message);
    }
  }

  /**
   * Stop listening
   */
  stopListening() {
    if (!this.speechRecognition) return;
    if (!this.isListening) return;

    try {
      this.speechRecognition.stop();
      this.isListening = false;
    } catch (e) {
      // Ignore
    }
  }

  /**
   * Check if a transcript is likely echo from Maya's speech
   * Uses word overlap detection to filter out Maya's voice being picked up by the mic
   */
  isLikelyEcho(transcript) {
    if (!this.currentMayaSpeech) {
      console.log('[Maya] Echo check: no currentMayaSpeech set');
      return false;
    }

    // Normalize both strings for comparison
    const normalize = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const heardWords = normalize(transcript).split(/\s+/).filter(w => w.length > 2);
    const mayaWords = normalize(this.currentMayaSpeech).split(/\s+/);

    console.log('[Maya] Echo check - heard:', heardWords.join(', '));
    console.log('[Maya] Echo check - maya:', mayaWords.slice(0, 20).join(', '), mayaWords.length > 20 ? '...' : '');

    if (heardWords.length === 0 || mayaWords.length === 0) return false;

    // Count how many heard words appear in Maya's speech
    let matchCount = 0;
    for (const word of heardWords) {
      if (mayaWords.includes(word)) {
        matchCount++;
      }
    }

    // If more than 50% of significant words match Maya's speech, likely echo
    const matchRatio = matchCount / heardWords.length;
    console.log(`[Maya] Echo check: ${matchCount}/${heardWords.length} words match = ${(matchRatio * 100).toFixed(0)}%`);

    if (matchRatio > 0.5) {
      console.log('[Maya] Echo detection: LIKELY ECHO');
      return true;
    }

    return false;
  }

  /**
   * Process input with serialization (prevents overlapping conversations)
   */
  async processInput(transcript) {
    this.processingInput = true;
    try {
      await this.handleUserInput(transcript);
    } finally {
      this.processingInput = false;
      // Process any queued input
      if (this.pendingInput) {
        const next = this.pendingInput;
        this.pendingInput = null;
        console.log('[Maya] Processing queued input:', next.substring(0, 40));
        this.processInput(next);
      }
    }
  }

  /**
   * Handle user input (speech transcript)
   */
  async handleUserInput(userText) {
    // Accumulate transcript for end-of-session extraction
    this.sessionTranscript += `User: ${userText}\n`;

    // Check for voice commands first (privacy/data management)
    if (this.personalizationReady && mightBeVoiceCommand(userText)) {
      const command = detectVoiceCommand(userText);
      if (command) {
        console.log('[Maya] Voice command detected:', command.type);

        // Show visual modal for LIST_PREFERENCES
        if (command.type === 'LIST_PREFERENCES') {
          this.appendTranscript('user', userText);
          await this.showWhatMayaKnows();
          return;
        }

        const result = await handleVoiceCommand(command);
        if (result) {
          if (result.response) {
            this.appendTranscript('user', userText);
            await this.speakResponse(result.response);
            return;
          }
          // Handle special actions
          if (result.action === 'prompt_tier_2') {
            this.appendTranscript('user', userText);
            await this.startConsentFlow('tier_2');
            return;
          }
          if (result.action === 'prompt_tier_3') {
            this.appendTranscript('user', userText);
            await this.startConsentFlow('tier_3');
            return;
          }
        }
      }
    }

    // Check if we're waiting for a consent response
    if (this.pendingConsentResponse && consentManager.hasPendingConsent()) {
      const isAffirmative = consentManager.isAffirmativeResponse(userText);
      const isNegative = consentManager.isNegativeResponse(userText);
      console.log('[Maya] Checking consent response:', userText, '→ affirmative:', isAffirmative, 'negative:', isNegative);

      if (isAffirmative || isNegative) {
        // Clear yes/no response: process as consent
        this.appendTranscript('user', userText);
        const result = consentManager.processConsentResponse(userText);
        if (result) {
          this.pendingConsentResponse = false;
          console.log('[Maya] Consent result:', result.accepted ? 'ACCEPTED' : 'DECLINED');
          await this.speakResponse(result.script);
          return;
        }
      } else {
        // Ambiguous response — user is continuing the conversation, not answering consent
        // Cancel consent and let the conversation flow naturally
        console.log('[Maya] Consent response unclear, cancelling consent — will retry later');
        this.pendingConsentResponse = false;
        this.tier2PromptShown = false;  // Allow retry
        consentManager.cancelPendingConsent();
        // Fall through to normal conversation processing
      }
    }

    // Extract inline preferences in real-time (if Tier 2+ enabled)
    if (this.personalizationReady) {
      const consent = personalization.getConsentSettings();
      if (consent.tier_2_enabled) {
        const inlinePrefs = extractInlinePreferences(userText);
        if (inlinePrefs.length > 0) {
          console.log('[Maya:Personalization] Inline preferences detected:', inlinePrefs);
        }
        for (const pref of inlinePrefs) {
          personalization.addPreference(pref.key, pref.value, 'inline_detected');
          console.log(`[Maya:Personalization] Saved preference: ${pref.key} = ${pref.value}`);
        }
      }

    }

    this.appendTranscript('user', userText);
    console.log('[Maya] Starting conversation for:', userText.substring(0, 50));
    const wasAborted = await this.runConversation(userText);

    // If conversation was aborted (barge-in), skip consent check
    if (wasAborted) {
      console.log('[Maya] Conversation was aborted, skipping consent check');
      return;
    }

    // After exchange 2+, schedule consent question for next exchange
    // (woven naturally into Maya's response instead of a separate prompt)
    this.exchangeCount++;
    console.log('[Maya] Exchange count:', this.exchangeCount, 'tier2PromptShown:', this.tier2PromptShown);
    if (this.exchangeCount >= 2 && !this.tier2PromptShown && this.personalizationReady) {
      const consent = personalization.getConsentSettings();
      if (!consent.tier_2_enabled && consentManager.shouldPromptTier2()) {
        console.log('[Maya] Scheduling Tier 2 consent question for next exchange');
        this.pendingConsentInject = true;  // Will be injected into next Claude call
      }
    }
  }

  /**
   * Show "What Maya Knows" transparency modal
   */
  async showWhatMayaKnows() {
    // Run extraction first so topics are up-to-date
    const response = "Let me think about what I remember...";
    this.appendTranscript('assistant', response);
    await this.queueMayaResponse(response);

    // Extract any new signals from the current session before showing
    await this.extractSessionSignals();

    // Show the modal
    showWhatMayaKnows(personalization, async () => {
      // Handle "Forget Everything" action
      await personalization.resetToTier1();
      const confirmResponse = "Done. I've forgotten everything about you. We can start fresh whenever you're ready.";
      this.appendTranscript('assistant', confirmResponse);
      await this.queueMayaResponse(confirmResponse);
    });
  }

  /**
   * Start a consent flow
   */
  async startConsentFlow(tier) {
    let result;
    if (tier === 'tier_2') {
      result = consentManager.startTier2Consent();
    } else if (tier === 'tier_3') {
      result = consentManager.startTier3Consent();
    }
    if (result) {
      this.pendingConsentResponse = true;
      await this.speakResponse(result.script);
    }
  }

  /**
   * Speak a response directly (for commands, consent, etc.)
   */
  async speakResponse(text) {
    console.log('[Maya] Speaking (direct):', text.substring(0, 80) + (text.length > 80 ? '...' : ''));

    // Accumulate for extraction
    this.sessionTranscript += `Maya: ${text}\n`;

    this.setStatus(State.SPEAKING, 'Speaking...');
    this.appendTranscript('assistant', text);

    // Add to history
    this.conversationHistory.push({ role: 'assistant', content: text });

    // Queue TTS
    await this.queueMayaResponse(text);
  }

  /**
   * Build personalization context for Claude prompts
   */
  buildPersonalizationContext(userText) {
    if (!this.personalizationReady) return null;

    const consent = personalization.getConsentSettings();
    if (!consent.tier_2_enabled) return null;

    const context = personalization.retrieveContext(userText);
    if (!context) return null;

    // Format context for Claude
    const lines = [];
    for (const pref of (context.preferences || [])) {
      lines.push(`- User preference: ${pref.key} = ${pref.value}`);
    }
    for (const profile of (context.profiles || [])) {
      lines.push(`- ${profile.profile_type}: ${profile.summary_text}`);
    }
    for (const topic of (context.topics || [])) {
      lines.push(`- Interest (${topic.engagement_level}): ${topic.display_name} - ${topic.summary}`);
    }
    for (const session of (context.recentSessions || [])) {
      lines.push(`- Recent session: ${session.summary_text}`);
    }

    if (lines.length === 0) return null;

    const contextStr = lines.join('\n');
    console.log('[Maya:Personalization] Context injected into prompt:\n', contextStr);
    return contextStr;
  }

  /**
   * Queue Maya to speak text via TTS
   */
  async queueMayaResponse(text) {
    // Track what Maya is saying for echo detection
    this.currentMayaSpeech = text;

    const abort = new AbortController();
    this.currentAbort = abort;

    try {
      const res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text,
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

      // Wait for speech to end
      await this.waitForSpeechEnd();

    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[Maya TTS] error:', err);
      }
    }

    // Clear echo detection tracking
    this.currentMayaSpeech = '';

    // Resume listening
    this.setStatus(State.LISTENING, 'Listening...');
    this.startListening();
  }

  /**
   * Run conversation with Claude
   */
  async runConversation(userText) {
    // Abort any in-flight conversation
    if (this.currentAbort) {
      this.currentAbort.abort();
    }
    const abort = new AbortController();
    this.currentAbort = abort;

    this.setStatus(State.PROCESSING, 'Thinking...');

    // Content safety check
    const safety = checkContentSafety(userText);
    if (safety.sensitiveTopics.length > 0 && safety.suggestedResponse) {
      // Handle sensitive topic with care
      console.log('[Maya] Sensitive topic detected:', safety.sensitiveTopics);
      await this.speakResponse(safety.suggestedResponse);
      return false;  // Completed normally (not aborted)
    }

    // Build personalization context
    const personalizationContext = this.buildPersonalizationContext(userText);

    // Build the user message with optional context injections
    let userMessage = userText;
    if (personalizationContext) {
      userMessage += `\n\n[PERSONALIZATION CONTEXT]\n${personalizationContext}`;
    }

    // Inject consent question into this exchange if scheduled
    let consentInjected = false;
    if (this.pendingConsentInject) {
      this.pendingConsentInject = false;
      this.tier2PromptShown = true;
      consentInjected = true;
      console.log('[Maya] Injecting Tier 2 consent question into Claude prompt');
      userMessage += `\n\n[SYSTEM NOTE - IMPORTANT]: After responding naturally to what the user just said, ask them a brief, conversational question about whether they'd like you to remember their preferences (like their name, interests, and things they share with you) so you can personalize future conversations. Mention that everything stays private on their device. Keep it natural and brief — just 1-2 sentences woven into your response, not a separate formal request.`;
    }

    this.conversationHistory.push({ role: 'user', content: userMessage });
    if (this.conversationHistory.length > 20) {
      this.conversationHistory.splice(0, 2);
    }

    let fullResponse = '';
    let buffer = '';
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
            this.setStatus(State.SPEAKING, 'Speaking...');
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
        console.error(`[Maya TTS] seq ${seq} error:`, err);
        audioCache[seq] = null;
      }
      flushAudioQueue();
    };

    const scheduleTTS = (sentence) => {
      if (!sentence.trim()) return;
      const seq = enqueueSeq++;
      ttsTasks.push(fetchTTS(sentence, seq));
    };

    // Stream Claude response
    try {
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.conversationHistory,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
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

          // Track for echo detection
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

          // Strip any additional [MOOD:xxx] tags (web search may produce multiple text blocks)
          buffer = buffer.replace(/\[MOOD:\w+\]\s*/g, '');
          fullResponse = fullResponse.replace(/\[MOOD:\w+\]\s*/g, '');

          // Flush complete sentences to TTS
          const m = buffer.match(/[.!?]\s/);
          if (m) {
            scheduleTTS(buffer.substring(0, m.index + 1).trim());
            buffer = buffer.substring(m.index + 2);
          }
        }
      }

      // Flush trailing text
      if (buffer.trim()) scheduleTTS(buffer.trim());

      // Wait for TTS
      await Promise.all(ttsTasks);

      // Add to history
      this.conversationHistory.push({ role: 'assistant', content: fullResponse });
      if (this.conversationHistory.length > 20) {
        this.conversationHistory.splice(0, 2);
      }

      this.appendTranscript('assistant', fullResponse);
      console.log('[Maya] Speaking (conversation):', fullResponse.substring(0, 120) + (fullResponse.length > 120 ? '...' : ''));

      // Accumulate for session-end extraction
      this.sessionTranscript += `Maya: ${fullResponse}\n`;

      // If consent question was woven into this response, expect consent reply next
      if (consentInjected) {
        console.log('[Maya] Consent question was part of response — awaiting user reply');
        this.pendingConsentResponse = true;
        consentManager.startTier2Consent();  // Track pending consent state
      }

    } catch (err) {
      if (abort.signal.aborted) {
        console.log('[Maya] Conversation aborted (barge-in), partial response:', fullResponse.substring(0, 80));
        if (fullResponse.trim()) {
          this.conversationHistory.push({ role: 'assistant', content: fullResponse.trim() });
          this.appendTranscript('assistant', fullResponse.trim() + ' ...');
        }
        // If consent was injected but response was aborted, allow retry
        if (consentInjected) {
          console.log('[Maya] Consent response aborted — will retry next exchange');
          this.tier2PromptShown = false;
        }
        return true;  // Was aborted
      }
      console.error('[Maya Chat] error:', err);
    }

    // Wait for avatar to finish speaking
    await this.waitForSpeechEnd();

    // Clear echo detection tracking
    this.currentMayaSpeech = '';

    // Resume listening
    this.setStatus(State.LISTENING, 'Listening...');
    this.startListening();

    // Notify state change
    this.notifyStateChange();

    return false;  // Completed normally
  }

  /**
   * Wait for avatar to finish speaking
   */
  async waitForSpeechEnd() {
    return new Promise(resolve => {
      const check = () => {
        if (!this.head?.isSpeaking) {
          resolve();
        } else {
          setTimeout(check, 100);
        }
      };
      check();
    });
  }

  /**
   * Barge-in: interrupt current speech
   */
  bargeIn() {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    this.head?.stopSpeaking();
    this.currentMayaSpeech = '';  // Clear echo detection tracking

    // Cancel any pending consent flow — user interrupted the question
    if (this.pendingConsentResponse) {
      console.log('[Maya] Barge-in cancelled pending consent flow — will retry next exchange');
      this.pendingConsentResponse = false;
      this.tier2PromptShown = false;  // Allow retry on next exchange
      consentManager.cancelPendingConsent();
    }

    this.setStatus(State.LISTENING, 'Listening...');
  }

  /**
   * Apply mood to avatar
   */
  applyMood(mood) {
    if (!VALID_MOODS.includes(mood)) mood = 'neutral';
    this.currentMood = mood;
    this.head?.setMood(mood);
  }

  /**
   * Set status display
   */
  setStatus(state, text) {
    this.state = state;
    if (this.statusEl) {
      this.statusEl.text.textContent = text;
      this.statusEl.dot.className = 'status-dot ' + state;
    }
  }

  /**
   * Append to transcript
   */
  appendTranscript(role, text) {
    if (!this.transcriptEl) return;

    const div = document.createElement('div');
    div.className = `transcript-msg ${role}`;
    div.innerHTML = `<span class="role">${role === 'user' ? 'You' : 'Maya'}:</span>${text}`;
    this.transcriptEl.appendChild(div);
    this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;

    // Limit messages
    while (this.transcriptEl.children.length > 20) {
      this.transcriptEl.firstChild.remove();
    }
  }

  /**
   * Restore transcript from conversation history
   */
  restoreTranscript() {
    if (!this.transcriptEl) return;
    this.transcriptEl.innerHTML = '';

    for (const msg of this.conversationHistory) {
      // Skip mood tags in display
      let content = msg.content;
      const moodMatch = content.match(/^\[MOOD:\w+\]\s*/);
      if (moodMatch) {
        content = content.slice(moodMatch[0].length);
      }
      this.appendTranscript(msg.role, content);
    }
  }

  /**
   * Convert base64 to ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  /**
   * Convert ElevenLabs alignment to word timing
   */
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

  /**
   * Notify parent of state change
   */
  notifyStateChange() {
    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  /**
   * Get current state for persistence
   */
  getState() {
    return {
      conversationHistory: this.conversationHistory,
      mood: this.currentMood,
      settings: { ...this.settings },
      sessionTranscript: this.sessionTranscript,
      exchangeCount: this.exchangeCount,
      tier2PromptShown: this.tier2PromptShown,
    };
  }

  /**
   * Pause the section
   */
  pause() {
    console.log('[Maya] Pausing section');
    this.stopListening();
    this.bargeIn();
    this.state = State.PAUSED;

    // Trigger extraction in background (don't await)
    this.extractSessionSignals();

    return this.getState();
  }

  /**
   * Extract personality signals from the session transcript
   */
  async extractSessionSignals() {
    if (!this.personalizationReady) return;
    if (!this.sessionTranscript || this.sessionTranscript.trim().length < 50) {
      console.log('[Maya:Extraction] Session too short for extraction (< 50 chars)');
      return;
    }

    try {
      console.log('[Maya:Extraction] Starting session extraction...');
      console.log('[Maya:Extraction] Transcript length:', this.sessionTranscript.length, 'chars');
      console.log('[Maya:Extraction] Transcript preview:', this.sessionTranscript.substring(0, 200) + '...');

      const result = await processSessionEnd(this.sessionTranscript, 'maya_conversation');

      if (result.skipped) {
        console.log('[Maya:Extraction] Skipped:', result.reason);
        return;
      }

      if (result.success && result.extraction) {
        const ext = result.extraction;
        console.log('[Maya:Extraction] === EXTRACTION RESULTS ===');
        console.log('[Maya:Extraction] Explicit preferences:', ext.explicitPreferences?.length || 0);
        if (ext.explicitPreferences?.length > 0) {
          console.table(ext.explicitPreferences);
        }
        console.log('[Maya:Extraction] Personality observations:', ext.personalityObservations?.length || 0);
        if (ext.personalityObservations?.length > 0) {
          console.table(ext.personalityObservations);
        }
        console.log('[Maya:Extraction] Topics:', ext.topics?.length || 0);
        if (ext.topics?.length > 0) {
          console.table(ext.topics);
        }
        if (ext.sessionSummary) {
          console.log('[Maya:Extraction] Session summary:', ext.sessionSummary.text);
        }
        console.log('[Maya:Extraction] === END RESULTS ===');

        // Persist after extraction
        personalization.persist();
        console.log('[Maya:Extraction] Data persisted to localStorage');
      }
    } catch (err) {
      console.error('[Maya:Extraction] Session extraction failed:', err);
    }
  }

  /**
   * Resume the section
   */
  async resume(savedState) {
    console.log('[Maya] Resuming section');

    if (savedState) {
      this.conversationHistory = savedState.conversationHistory || this.conversationHistory;
      this.currentMood = savedState.mood || this.currentMood;
    }

    // Resume AudioContext
    await AudioManager.resume();

    // Resume listening
    this.setStatus(State.LISTENING, 'Listening...');
    this.startListening();
  }

  /**
   * Unmount the section
   */
  unmount() {
    console.log('[Maya] Unmounting section');
    this.stopListening();
    this.bargeIn();

    // Extract signals before unmounting (session ended)
    this.extractSessionSignals();

    // Clear session transcript since session is ending
    this.sessionTranscript = '';

    if (this.head) {
      // TalkingHead doesn't have a destroy method, but we can clear the container
      this.head = null;
    }

    if (this.container) {
      this.container.innerHTML = '';
    }
  }

  /**
   * Reset session transcript (called after 15-min timeout extraction)
   */
  resetSessionTranscript() {
    this.sessionTranscript = '';
  }
}
