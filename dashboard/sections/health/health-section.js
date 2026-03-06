/**
 * MayaMind Dashboard — Health Monitoring Section
 *
 * Displays real-time vitals from Apple Watch (via iPhone companion app)
 * and body composition from Withings Smart Scale.
 *
 * Main page: Clean, glanceable — just big numbers.
 * Detail view: Tap any card to see 24h ranges, averages, color-coded metrics.
 * PIP Avatar: Maya thumbnail at bottom-left with chat panel to its right.
 *
 * Data flow:
 *   iPhone companion → POST /api/health/vitals → Server → SSE → this section
 *   Withings scale → Withings Cloud → Server OAuth → this section
 */

import { AudioManager } from '../../core/audio-manager.js';
import { isMuteCommand, isUnmuteCommand } from '../../core/voice-commands.js';

// ── Constants ─────────────────────────────────────────────────────────────────

const AVATAR_URL = '/avatars/brunette.glb';
const CHAT_URL = '/api/chat/health';
const TTS_URL = '/api/tts';

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

const PipState = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  SPEAKING: 'speaking',
};

export class HealthSection {
  constructor(options = {}) {
    this.container = null;
    this.ttsService = options.ttsService;
    this.isMuted = options.isMuted || (() => false);
    this.setMuted = options.setMuted || (() => {});
    this.onStateChange = options.onStateChange || null;

    // SSE connection
    this.sse = null;

    // Vitals state
    this.latestVitals = null;
    this.vitalsHistory = [];  // For 10-min moving averages
    this.withingsData = null;
    this.lastReceivedAt = null;
    this.staleTimer = null;

    // Health profile (DOB, sex) from unified settings
    this.healthProfile = this.loadHealthProfile();

    // DOM element references
    this.els = {};

    // ── PIP Avatar state ──────────────────────────────────────────────────
    this.TalkingHead = null;
    this.head = null;
    this.avatarContainer = null;
    this.pipState = PipState.IDLE;
    this.conversationHistory = [];
    this.currentMood = 'neutral';
    this.speechRecognition = null;
    this.isListening = false;
    this.currentAbort = null;
    this.currentMayaSpeech = '';
    this.processingInput = false;
    this.pendingInput = null;
    this.avatarLoaded = false;
    this.hasGreeted = false;
  }

  // ── Health Profile (reads from unified settings) ─────────────────────────

  loadHealthProfile() {
    try {
      const stored = localStorage.getItem('mayamind_settings');
      if (!stored) return null;
      const settings = JSON.parse(stored);
      if (!settings.dob && !settings.sex) return null;
      return { dob: settings.dob || '', sex: settings.sex || '' };
    } catch {
      return null;
    }
  }

  getAge() {
    if (!this.healthProfile?.dob) return null;
    const birth = new Date(this.healthProfile.dob);
    const now = new Date();
    let age = now.getFullYear() - birth.getFullYear();
    const m = now.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--;
    return age;
  }

  // Age/sex-adjusted body fat % ranges
  getBodyFatCategory(fatPercent) {
    const age = this.getAge();
    const sex = this.healthProfile?.sex;
    if (fatPercent == null || !age || !sex) return null;

    let ranges;
    if (sex === 'male') {
      if (age < 40)      ranges = [8, 20, 25];
      else if (age < 60) ranges = [11, 22, 28];
      else                ranges = [13, 25, 30];
    } else {
      if (age < 40)      ranges = [21, 33, 39];
      else if (age < 60) ranges = [23, 34, 40];
      else                ranges = [24, 36, 42];
    }

    if (fatPercent < ranges[0]) return 'low';
    if (fatPercent <= ranges[1]) return 'healthy';
    if (fatPercent <= ranges[2]) return 'elevated';
    return 'unhealthy';
  }

  // Visceral fat index (Withings 1–31, universal ranges)
  getVisceralFatCategory(index) {
    if (index == null) return null;
    if (index <= 9) return 'healthy';
    if (index <= 14) return 'elevated';
    return 'unhealthy';
  }

  // Bone mass thresholds by sex and body weight
  getBoneMassCategory(boneMassKg, weightKg) {
    const sex = this.healthProfile?.sex;
    if (boneMassKg == null || weightKg == null || !sex) return null;

    let threshold;
    if (sex === 'male') {
      if (weightKg < 65)      threshold = 2.65;
      else if (weightKg < 95) threshold = 3.29;
      else                    threshold = 3.69;
    } else {
      if (weightKg < 50)      threshold = 1.95;
      else if (weightKg < 75) threshold = 2.40;
      else                    threshold = 2.95;
    }

    return boneMassKg < threshold ? 'low' : 'healthy';
  }

  getCategoryColor(category) {
    const colors = {
      low: '#4a9eff',       // Blue
      healthy: '#4aff9f',   // Green
      elevated: '#ffb84a',  // Amber
      unhealthy: '#ff4a6a', // Red
    };
    return colors[category] || 'var(--text-secondary)';
  }

  getCategoryLabel(category) {
    const labels = { low: 'Low', healthy: 'Healthy', elevated: 'Elevated', unhealthy: 'Unhealthy' };
    return labels[category] || '';
  }

  // ── Mount ──────────────────────────────────────────────────────────────────

  async mount(container, savedState = null) {
    this.container = container;

    // Refresh health profile from unified settings
    this.healthProfile = this.loadHealthProfile();

    // Restore saved state if resuming
    if (savedState) {
      this.vitalsHistory = savedState.vitalsHistory || [];
      this.withingsData = savedState.withingsData || null;
      this.conversationHistory = savedState.conversationHistory || [];
    }

    // Render the dashboard
    this.render();

    // Fetch current state (handles page refresh)
    await this.fetchLatest();

    // Connect SSE for real-time updates
    this.connectSSE();

    // Start stale-data checker
    this.staleTimer = setInterval(() => this.checkStaleData(), 30000);

    // Check Withings status
    this.checkWithingsStatus();

    // Resume AudioContext in user gesture context (click that navigated here)
    await AudioManager.resume();

    // Load PIP avatar (non-blocking — vitals display immediately)
    this.loadPIPAvatar();

    console.log('[HealthSection] Mounted');
  }

  // ── PIP Avatar Loading ──────────────────────────────────────────────────

  async loadPIPAvatar() {
    try {
      await this.loadTalkingHead();
      await this.initAvatar();
      this.initSpeechRecognition();

      // Start listening immediately (always-listening mode)
      this.pipState = PipState.LISTENING;
      this.updatePIPStatus('listening', 'Listening...');
      this.startListening();

      // Greet after short delay to let vitals load
      setTimeout(() => this.greetIfDataAvailable(), 1500);
    } catch (err) {
      console.error('[HealthSection] PIP avatar load failed:', err);
    }
  }

  async loadTalkingHead() {
    const module = await import('/modules/talkinghead.mjs');
    this.TalkingHead = module.TalkingHead;
    console.log('[HealthSection] TalkingHead module loaded');
  }

  async initAvatar() {
    this.avatarContainer = this.container.querySelector('#health-pip-avatar');
    if (!this.avatarContainer) return;

    const audioCtx = AudioManager.getContext();

    this.head = new this.TalkingHead(this.avatarContainer, {
      ttsEndpoint: null,
      audioCtx: audioCtx,
      cameraView: 'head',
      cameraRotateEnable: false,
      lipsyncLang: 'en',
      lipsyncModules: ['en'],
    });

    await this.head.showAvatar({
      url: AVATAR_URL,
      body: 'F',
      avatarMood: 'neutral',
      lipsyncLang: 'en',
    });

    this.head.setMood('neutral');
    this.avatarLoaded = true;

    // Remove loading indicator
    const loadingEl = this.avatarContainer.querySelector('.pip-loading');
    if (loadingEl) loadingEl.remove();

    console.log('[HealthSection] PIP avatar loaded');
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    this.container.innerHTML = `
      <div class="health-wrapper">
      <div class="health-dashboard">
        <!-- Row 1: Vital Signs (tappable for details) -->
        <div class="vital-card heart-rate tappable" id="card-hr" data-detail="heartRate">
          <div class="vital-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
            </svg>
          </div>
          <div class="vital-label">Heart Rate</div>
          <div class="vital-value" id="val-hr">&mdash;</div>
          <div class="vital-unit">BPM</div>
        </div>

        <div class="vital-card hrv tappable" id="card-hrv" data-detail="hrv">
          <div class="vital-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
            </svg>
          </div>
          <div class="vital-label">HRV</div>
          <div class="vital-value" id="val-hrv">&mdash;</div>
          <div class="vital-unit">ms</div>
        </div>

        <div class="vital-card spo2 tappable" id="card-spo2" data-detail="spo2">
          <div class="vital-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 6v6l4 2"/>
            </svg>
          </div>
          <div class="vital-label">Blood Oxygen (SpO2)</div>
          <div class="vital-value" id="val-spo2">&mdash;</div>
          <div class="vital-unit">%</div>
        </div>

        <!-- Row 2: Daily Activity -->
        <div class="vital-card steps" id="card-steps">
          <div class="vital-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
            </svg>
          </div>
          <div class="vital-label">Steps</div>
          <div class="vital-value" id="val-steps">&mdash;</div>
          <div class="vital-unit">today</div>
        </div>

        <div class="vital-card move" id="card-move">
          <div class="vital-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="5" r="3"/>
              <line x1="12" y1="8" x2="12" y2="16"/>
              <path d="M8 21l4-5 4 5"/>
              <path d="M6 13l6-1 6 1"/>
            </svg>
          </div>
          <div class="vital-label">Move</div>
          <div class="vital-value" id="val-move">&mdash;</div>
          <div class="vital-unit">min today</div>
        </div>

        <div class="vital-card exercise" id="card-exercise">
          <div class="vital-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1"/>
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z"/>
              <line x1="6" y1="1" x2="6" y2="4"/>
              <line x1="10" y1="1" x2="10" y2="4"/>
              <line x1="14" y1="1" x2="14" y2="4"/>
            </svg>
          </div>
          <div class="vital-label">Exercise</div>
          <div class="vital-value" id="val-exercise">&mdash;</div>
          <div class="vital-unit">min today</div>
        </div>

        <!-- Row 3: Body Composition (wide, tappable) + Sleep (narrow) -->
        <div class="vital-card body tappable" id="card-body" data-detail="body">
          <div class="vital-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
              <path d="M16 3h-8l-2 4h12z"/>
            </svg>
          </div>
          <div class="vital-label">Body Composition</div>
          <div class="body-summary" id="body-summary">
            <div class="body-summary-item">
              <div class="vital-value" id="val-weight">&mdash;</div>
              <div class="vital-unit">Weight</div>
            </div>
            <div class="body-summary-item">
              <div class="vital-value body-fat-value" id="val-bodyfat">&mdash;</div>
              <div class="vital-unit">Body Fat</div>
            </div>
          </div>
          <button class="withings-connect-btn hidden" id="withings-btn">Connect Withings Scale</button>
        </div>

        <div class="vital-card sleep tappable" id="card-sleep" data-detail="sleep">
          <div class="vital-icon">
            <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          </div>
          <div class="vital-label">Last Night's Sleep</div>
          <div class="vital-value" id="val-sleep">&mdash;</div>
          <div class="sleep-times" id="sleep-times"></div>
        </div>

        <!-- Connection Status Bar -->
        <div class="health-connection" id="connection-bar">
          <div class="connection-item">
            <span class="connection-dot" id="dot-watch"></span>
            <span id="status-watch">Apple Watch: Waiting for data...</span>
          </div>
          <div class="connection-item">
            <span class="connection-dot" id="dot-withings"></span>
            <span id="status-withings">Withings: Not configured</span>
          </div>
        </div>
      </div>

      <!-- Maya PIP Bar: avatar left, chat right — outside health-dashboard grid -->
      <div class="health-pip-bar" id="health-pip-bar">
        <div class="health-pip-left">
          <div class="health-pip-avatar" id="health-pip-avatar">
            <span class="pip-loading">Loading...</span>
          </div>
          <div class="health-pip-status" id="health-pip-status">
            <span class="pip-status-dot"></span>
            <span class="pip-status-text">Starting...</span>
          </div>
          <button class="health-pip-mute-btn" id="health-pip-mute" title="Mute/unmute Maya">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
              <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
              <line x1="12" y1="19" x2="12" y2="23"/>
              <line x1="8" y1="23" x2="16" y2="23"/>
            </svg>
            <span id="mute-label">Listening</span>
          </button>
        </div>
        <div class="health-pip-transcript" id="health-pip-transcript">
          <span class="pip-placeholder">Ask Maya about your health data...</span>
        </div>
      </div>
      </div><!-- end .health-wrapper -->

      <!-- Detail overlay (shown on card tap) -->
      <div class="health-detail-overlay hidden" id="health-detail">
        <div class="health-detail-panel">
          <button class="detail-close" id="detail-close">&times;</button>
          <div class="detail-body" id="detail-body"></div>
        </div>
      </div>

      <!-- Waiting overlay (shown when no data) -->
      <div class="health-waiting" id="health-waiting">
        <div class="waiting-icon">
          <svg viewBox="0 0 24 24" width="80" height="80" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
        </div>
        <h3>Waiting for Health Data</h3>
        <p>Open the MayaMind Companion app on your iPhone to start sending health data from your Apple Watch.</p>
      </div>
    `;

    // Cache DOM references
    this.els = {
      hrVal: this.container.querySelector('#val-hr'),
      hrvVal: this.container.querySelector('#val-hrv'),
      spo2Val: this.container.querySelector('#val-spo2'),
      stepsVal: this.container.querySelector('#val-steps'),
      moveVal: this.container.querySelector('#val-move'),
      exerciseVal: this.container.querySelector('#val-exercise'),
      sleepVal: this.container.querySelector('#val-sleep'),
      sleepTimes: this.container.querySelector('#sleep-times'),
      weightVal: this.container.querySelector('#val-weight'),
      bodyFatVal: this.container.querySelector('#val-bodyfat'),
      dotWatch: this.container.querySelector('#dot-watch'),
      statusWatch: this.container.querySelector('#status-watch'),
      dotWithings: this.container.querySelector('#dot-withings'),
      statusWithings: this.container.querySelector('#status-withings'),
      withingsBtn: this.container.querySelector('#withings-btn'),
      waitingOverlay: this.container.querySelector('#health-waiting'),
      dashboard: this.container.querySelector('.health-dashboard'),
      detailOverlay: this.container.querySelector('#health-detail'),
      detailBody: this.container.querySelector('#detail-body'),
      // PIP elements
      pipBar: this.container.querySelector('#health-pip-bar'),
      pipMuteBtn: this.container.querySelector('#health-pip-mute'),
      pipMuteLabel: this.container.querySelector('#mute-label'),
      pipStatus: this.container.querySelector('#health-pip-status'),
      pipStatusDot: this.container.querySelector('.pip-status-dot'),
      pipStatusText: this.container.querySelector('.pip-status-text'),
      pipTranscript: this.container.querySelector('#health-pip-transcript'),
    };

    // Withings connect button
    this.els.withingsBtn.addEventListener('click', () => {
      window.open('/api/health/withings/auth', '_blank', 'width=600,height=700');
    });

    // Tappable cards — open detail view
    this.container.querySelectorAll('.vital-card.tappable').forEach(card => {
      card.addEventListener('click', () => {
        const detailType = card.dataset.detail;
        if (detailType) this.showDetail(detailType);
      });
    });

    // Close detail overlay
    this.container.querySelector('#detail-close').addEventListener('click', () => this.hideDetail());
    this.els.detailOverlay.addEventListener('click', (e) => {
      if (e.target === this.els.detailOverlay) this.hideDetail();
    });

    // PIP mute button
    this.els.pipMuteBtn.addEventListener('click', () => this.onMuteToggle());

    // If we have data from previous session, show it
    if (this.vitalsHistory.length > 0) {
      this.showDashboard();
      const last = this.vitalsHistory[this.vitalsHistory.length - 1];
      this.updateVitalsDisplay(last);
    }
    if (this.withingsData) {
      this.updateWithingsDisplay(this.withingsData);
    }
  }

  // ── PIP Mute Toggle ─────────────────────────────────────────────────────

  onMuteToggle() {
    const currentlyMuted = this.isMuted();
    this.setMuted(!currentlyMuted);
    this.updateMuteButton(!currentlyMuted);

    if (!currentlyMuted) {
      // Muting — stop listening
      this.stopListening();
      this.pipState = PipState.IDLE;
      this.updatePIPStatus('idle', 'Muted');
    } else {
      // Unmuting — start listening
      this.pipState = PipState.LISTENING;
      this.updatePIPStatus('listening', 'Listening...');
      this.startListening();
    }
  }

  updateMuteButton(muted) {
    if (!this.els.pipMuteBtn || !this.els.pipMuteLabel) return;
    if (muted) {
      this.els.pipMuteBtn.classList.add('muted');
      this.els.pipMuteLabel.textContent = 'Muted';
    } else {
      this.els.pipMuteBtn.classList.remove('muted');
      this.els.pipMuteLabel.textContent = 'Listening';
    }
  }

  updatePIPStatus(state, text) {
    if (!this.els.pipStatusDot || !this.els.pipStatusText) return;

    // Update status dot
    this.els.pipStatusDot.className = 'pip-status-dot' + (state !== 'idle' ? ` ${state}` : '');

    // Update status text
    this.els.pipStatusText.textContent = text;
  }

  appendTranscript(role, text) {
    if (!this.els.pipTranscript) return;

    // Remove placeholder on first message
    const placeholder = this.els.pipTranscript.querySelector('.pip-placeholder');
    if (placeholder) placeholder.remove();

    // Strip mood tags from display
    const cleanText = text.replace(/\[MOOD:\w+\]\s*/g, '');

    const msg = document.createElement('div');
    msg.className = `pip-msg ${role}`;
    const roleLabel = role === 'user' ? 'You' : 'Maya';
    msg.innerHTML = `<span class="pip-role">${roleLabel}:</span>${this.escapeHtml(cleanText)}`;
    this.els.pipTranscript.appendChild(msg);

    // Keep only last 6 messages
    while (this.els.pipTranscript.children.length > 6) {
      this.els.pipTranscript.removeChild(this.els.pipTranscript.firstChild);
    }

    // Scroll to bottom
    this.els.pipTranscript.scrollTop = this.els.pipTranscript.scrollHeight;
  }

  escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ── Speech Recognition ──────────────────────────────────────────────────

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('[HealthSection] Speech recognition not supported');
      return;
    }

    this.speechRecognition = new SpeechRecognition();
    this.speechRecognition.continuous = false;
    this.speechRecognition.interimResults = false;
    this.speechRecognition.lang = 'en-US';

    this.speechRecognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      const avatarSpeaking = !!this.head?.isSpeaking;
      console.log('[HealthSection] Heard:', transcript,
        '| pipState:', this.pipState,
        '| muted:', this.isMuted(),
        '| processing:', this.processingInput,
        '| avatarSpeaking:', avatarSpeaking);
      this.isListening = false;

      // Global mute check
      if (this.isMuted()) {
        if (isUnmuteCommand(transcript)) {
          this.setMuted(false);
          this.speakText("I'm back! What would you like to know about your health?");
        } else {
          setTimeout(() => this.startListening(), 300);
        }
        return;
      }

      if (isMuteCommand(transcript)) {
        this.speakText("I'll be quiet. Say unmute when you need me.").then(() => {
          this.setMuted(true);
        });
        return;
      }

      if (avatarSpeaking) {
        if (this.isLikelyEcho(transcript)) {
          setTimeout(() => this.startListening(), 300);
          return;
        }
        this.bargeIn();
      }

      if (this.processingInput) {
        this.pendingInput = transcript;
        return;
      }

      this.processUserInput(transcript);
    };

    this.speechRecognition.onerror = (event) => {
      if (event.error === 'aborted') return;
      if (event.error === 'no-speech') {
        if (this.pipState === PipState.LISTENING) {
          setTimeout(() => this.startListening(), 500);
        }
        return;
      }
      console.error('[HealthSection] Speech error:', event.error);
    };

    this.speechRecognition.onend = () => {
      this.isListening = false;
      if (this.pipState === PipState.LISTENING) {
        setTimeout(() => this.startListening(), 300);
      }
    };
  }

  startListening() {
    if (!this.speechRecognition) return;
    if (this.isListening) return;
    if (this.pipState !== PipState.LISTENING) return;

    try {
      this.speechRecognition.start();
      this.isListening = true;
    } catch (e) {
      console.error('[HealthSection] Failed to start recognition:', e.message);
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

  // ── Echo Detection ──────────────────────────────────────────────────────

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

    return (matchCount / heardWords.length) > 0.5;
  }

  // ── Barge-In ────────────────────────────────────────────────────────────

  bargeIn() {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    this.head?.stopSpeaking();
    this.currentMayaSpeech = '';
  }

  // ── Input Processing ────────────────────────────────────────────────────

  async processUserInput(text) {
    if (!text || !text.trim()) return;

    this.processingInput = true;
    this.pipState = PipState.PROCESSING;
    this.updatePIPStatus('processing', 'Thinking...');
    this.appendTranscript('user', text);

    try {
      await this.runConversation(text);
    } catch (err) {
      console.error('[HealthSection] processUserInput error:', err);
    }

    this.processingInput = false;

    // Process pending input
    if (this.pendingInput) {
      const next = this.pendingInput;
      this.pendingInput = null;
      await this.processUserInput(next);
    } else {
      this.pipState = PipState.LISTENING;
      this.updatePIPStatus('listening', 'Listening...');
      this.startListening();
    }
  }

  // ── Claude Conversation ─────────────────────────────────────────────────

  async runConversation(userText) {
    if (this.currentAbort) this.currentAbort.abort();
    const abort = new AbortController();
    this.currentAbort = abort;

    this.conversationHistory.push({ role: 'user', content: userText });
    if (this.conversationHistory.length > 20) this.conversationHistory.splice(0, 2);

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
          if (this.pipState === PipState.PROCESSING) {
            this.pipState = PipState.SPEAKING;
            this.updatePIPStatus('speaking', 'Speaking...');
          }
          // Ensure AudioContext is running before playback
          AudioManager.resume();
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
        console.error(`[HealthSection TTS] seq ${seq} error:`, err);
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
      console.log('[HealthSection] Fetching', CHAT_URL, 'with', this.conversationHistory.length, 'messages');
      const res = await fetch(CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: this.conversationHistory,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          vitals: this.latestVitals,
          withingsData: this.withingsData,
        }),
        signal: abort.signal,
      });
      console.log('[HealthSection] Chat response status:', res.status);
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

          // Strip additional mood tags
          buffer = buffer.replace(/\[MOOD:\w+\]\s*/g, '');
          fullResponse = fullResponse.replace(/\[MOOD:\w+\]\s*/g, '');

          // Flush complete sentences to TTS
          const m = buffer.match(/[.!?]\s/);
          if (m) {
            const sentence = buffer.substring(0, m.index + 1).trim();
            buffer = buffer.substring(m.index + 2);
            if (sentence.trim()) scheduleTTS(sentence);
          }
        }
      }

      // Flush trailing text
      if (buffer.trim()) {
        scheduleTTS(buffer.trim());
      }

      // Wait for TTS to complete
      await Promise.all(ttsTasks);

      // Add to history
      this.conversationHistory.push({ role: 'assistant', content: fullResponse });
      if (this.conversationHistory.length > 20) this.conversationHistory.splice(0, 2);

      // Show in transcript
      this.appendTranscript('assistant', fullResponse);

      // Wait for avatar to finish speaking
      await this.waitForSpeechEnd();

      this.currentMayaSpeech = '';

    } catch (err) {
      if (abort.signal.aborted) {
        console.log('[HealthSection] Conversation aborted (barge-in)');
        return;
      }
      console.error('[HealthSection] Conversation error:', err);
    }
  }

  // ── TTS Helpers ─────────────────────────────────────────────────────────

  async speakText(text) {
    this.currentMayaSpeech = text;
    this.pipState = PipState.SPEAKING;
    this.updatePIPStatus('speaking', 'Speaking...');

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

      // Ensure AudioContext is running before playback
      await AudioManager.resume();
      this.head.speakAudio(
        { audio: audioBuf, words: timing.words, wtimes: timing.wtimes, wdurations: timing.wdurations },
        { lipsyncLang: 'en' }
      );

      await this.waitForSpeechEnd();
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[HealthSection TTS] error:', err);
      }
    }

    this.currentMayaSpeech = '';
  }

  // ── Greeting ────────────────────────────────────────────────────────────

  async greetIfDataAvailable() {
    if (!this.avatarLoaded || this.hasGreeted) return;
    this.hasGreeted = true;

    let greeting;
    const v = this.latestVitals?.vitals || {};

    if (v.heartRate?.value && v.steps?.value) {
      const hr = Math.round(v.heartRate.value);
      const steps = v.steps.value.toLocaleString();
      greeting = `Hi! Your heart rate is ${hr} and you've taken ${steps} steps today. Feel free to ask me anything about your health.`;
    } else {
      greeting = "Hi! I'm here whenever you'd like to talk about your health data.";
    }

    await this.speakText(greeting);

    // Return to listening after greeting (always-listening mode)
    this.pipState = PipState.LISTENING;
    this.updatePIPStatus('listening', 'Listening...');
    this.startListening();
  }

  // ── Mood ────────────────────────────────────────────────────────────────

  applyMood(mood) {
    if (!VALID_MOODS.includes(mood)) mood = 'neutral';
    this.currentMood = mood;
    this.head?.setMood(mood);
  }

  // ── Audio Utilities ─────────────────────────────────────────────────────

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

  // ── Detail View ──────────────────────────────────────────────────────────

  showDetail(type) {
    const html = this.renderDetailContent(type);
    if (!html) return;
    this.els.detailBody.innerHTML = html;
    this.els.detailOverlay.classList.remove('hidden');
  }

  hideDetail() {
    this.els.detailOverlay.classList.add('hidden');
  }

  renderDetailContent(type) {
    const v = this.latestVitals?.vitals || {};

    if (type === 'heartRate') {
      const current = v.heartRate?.value != null ? Math.round(v.heartRate.value) : '--';
      const range = v.heartRate?.range24h;
      const avg = this.computeAverage('heartRate');
      return `
        <div class="detail-metric-header heart-rate">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>
          </svg>
          <h3>Heart Rate</h3>
        </div>
        <div class="detail-current">${current} <span class="detail-unit">BPM</span></div>
        ${range ? `<div class="detail-row"><span class="detail-row-label">24-Hour Range</span><span class="detail-row-value">${Math.round(range.min)} – ${Math.round(range.max)} BPM</span></div>` : ''}
        ${avg ? `<div class="detail-row"><span class="detail-row-label">10-Min Average</span><span class="detail-row-value">${avg} BPM</span></div>` : ''}
        ${v.heartRate?.timestamp ? `<div class="detail-row"><span class="detail-row-label">Last Reading</span><span class="detail-row-value">${this.formatTimestamp(v.heartRate.timestamp)}</span></div>` : ''}
      `;
    }

    if (type === 'hrv') {
      const current = v.hrv?.value != null ? Math.round(v.hrv.value) : '--';
      const range = v.hrv?.range24h;
      const avg = this.computeAverage('hrv');
      return `
        <div class="detail-metric-header hrv">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
          </svg>
          <h3>Heart Rate Variability</h3>
        </div>
        <div class="detail-current">${current} <span class="detail-unit">ms</span></div>
        ${range ? `<div class="detail-row"><span class="detail-row-label">24-Hour Range</span><span class="detail-row-value">${Math.round(range.min)} – ${Math.round(range.max)} ms</span></div>` : ''}
        ${avg ? `<div class="detail-row"><span class="detail-row-label">10-Min Average</span><span class="detail-row-value">${avg} ms</span></div>` : ''}
        ${v.hrv?.timestamp ? `<div class="detail-row"><span class="detail-row-label">Last Reading</span><span class="detail-row-value">${this.formatTimestamp(v.hrv.timestamp)}</span></div>` : ''}
      `;
    }

    if (type === 'spo2') {
      const current = v.spo2?.value != null ? Math.round(v.spo2.value) : '--';
      const range = v.spo2?.range24h;
      const avg = this.computeAverage('spo2');
      return `
        <div class="detail-metric-header spo2">
          <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 6v6l4 2"/>
          </svg>
          <h3>Blood Oxygen (SpO2)</h3>
        </div>
        <div class="detail-current">${current}<span class="detail-unit">%</span></div>
        ${range ? `<div class="detail-row"><span class="detail-row-label">24-Hour Range</span><span class="detail-row-value">${Math.round(range.min)} – ${Math.round(range.max)}%</span></div>` : ''}
        ${avg ? `<div class="detail-row"><span class="detail-row-label">10-Min Average</span><span class="detail-row-value">${avg}%</span></div>` : ''}
        ${v.spo2?.timestamp ? `<div class="detail-row"><span class="detail-row-label">Last Reading</span><span class="detail-row-value">${this.formatTimestamp(v.spo2.timestamp)}</span></div>` : ''}
      `;
    }

    if (type === 'body') {
      return this.renderBodyDetail();
    }

    if (type === 'sleep') {
      return this.renderSleepDetail();
    }

    return null;
  }

  renderBodyDetail() {
    const m = this.withingsData?.measures || {};
    if (!m.weight) return '<p>No body composition data available.</p>';

    const weightKg = m.weight.value;
    const weightLbs = (weightKg * 2.20462).toFixed(1);

    let html = `
      <div class="detail-metric-header body">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="2" y="7" width="20" height="14" rx="2" ry="2"/>
          <path d="M16 3h-8l-2 4h12z"/>
        </svg>
        <h3>Body Composition</h3>
      </div>
      <div class="detail-row">
        <span class="detail-row-label">Weight</span>
        <span class="detail-row-value">${weightLbs} lbs (${weightKg.toFixed(1)} kg)</span>
      </div>`;

    if (m.fatPercent) {
      const fatVal = m.fatPercent.value.toFixed(1);
      const cat = this.getBodyFatCategory(m.fatPercent.value);
      const color = this.getCategoryColor(cat);
      const label = this.getCategoryLabel(cat);
      html += `
        <div class="detail-row">
          <span class="detail-row-label">Body Fat</span>
          <span class="detail-row-value">
            ${cat ? `<span class="metric-dot" style="background: ${color}"></span>` : ''}
            ${fatVal}%
            ${cat ? `<span class="metric-cat" style="color: ${color}">${label}</span>` : ''}
          </span>
        </div>`;
    }

    if (m.visceralFat) {
      const vfVal = Math.round(m.visceralFat.value);
      const cat = this.getVisceralFatCategory(vfVal);
      const color = this.getCategoryColor(cat);
      const label = this.getCategoryLabel(cat);
      html += `
        <div class="detail-row">
          <span class="detail-row-label">Visceral Fat</span>
          <span class="detail-row-value">
            ${cat ? `<span class="metric-dot" style="background: ${color}"></span>` : ''}
            ${vfVal}
            ${cat ? `<span class="metric-cat" style="color: ${color}">${label}</span>` : ''}
          </span>
        </div>`;
    }

    if (m.boneMass) {
      const bmPct = ((m.boneMass.value / weightKg) * 100).toFixed(1);
      const cat = this.getBoneMassCategory(m.boneMass.value, weightKg);
      const color = this.getCategoryColor(cat);
      const label = this.getCategoryLabel(cat);
      html += `
        <div class="detail-row">
          <span class="detail-row-label">Bone Mass</span>
          <span class="detail-row-value">
            ${cat ? `<span class="metric-dot" style="background: ${color}"></span>` : ''}
            ${bmPct}% (${m.boneMass.value.toFixed(1)} kg)
            ${cat ? `<span class="metric-cat" style="color: ${color}">${label}</span>` : ''}
          </span>
        </div>`;
    }

    if (m.muscleMass) {
      const mmLbs = (m.muscleMass.value * 2.20462).toFixed(1);
      html += `
        <div class="detail-row">
          <span class="detail-row-label">Muscle Mass</span>
          <span class="detail-row-value">${mmLbs} lbs (${m.muscleMass.value.toFixed(1)} kg)</span>
        </div>`;
    }

    if (m.weight.timestamp) {
      const date = new Date(m.weight.timestamp);
      html += `
        <div class="detail-row detail-date">
          <span class="detail-row-label">Last Measured</span>
          <span class="detail-row-value">${date.toLocaleDateString()}</span>
        </div>`;
    }

    return html;
  }

  renderSleepDetail() {
    const sleep = this.latestVitals?.sleep;
    if (!sleep) return '<p>No sleep data available.</p>';

    const totalHrs = sleep.totalHours;
    const hrs = Math.floor(totalHrs);
    const mins = Math.round((totalHrs - hrs) * 60);

    const fmtTime = (iso) => {
      if (!iso) return '--';
      const d = new Date(iso);
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    };

    let html = `
      <div class="detail-metric-header sleep">
        <svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
        <h3>Last Night's Sleep</h3>
      </div>
      <div class="detail-current">${hrs}h ${mins}m</div>`;

    if (sleep.startTime || sleep.endTime) {
      html += `
        <div class="detail-row">
          <span class="detail-row-label">Time</span>
          <span class="detail-row-value">${fmtTime(sleep.startTime)} – ${fmtTime(sleep.endTime)}</span>
        </div>`;
    }

    if (sleep.stages) {
      const s = sleep.stages;
      html += `
        <div class="detail-row">
          <span class="detail-row-label">Deep</span>
          <span class="detail-row-value">${this.formatHours(s.deep)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row-label">Core</span>
          <span class="detail-row-value">${this.formatHours(s.core)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row-label">REM</span>
          <span class="detail-row-value">${this.formatHours(s.rem)}</span>
        </div>
        <div class="detail-row">
          <span class="detail-row-label">Awake</span>
          <span class="detail-row-value">${this.formatHours(s.awake)}</span>
        </div>`;
    }

    return html;
  }

  // ── SSE Connection ─────────────────────────────────────────────────────────

  connectSSE() {
    if (this.sse) {
      this.sse.close();
    }

    this.sse = new EventSource('/api/health/events');

    this.sse.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'vitals') {
          this.handleVitalsUpdate(data);
        } else if (data.type === 'withings') {
          this.handleWithingsUpdate(data);
        }
      } catch (err) {
        console.error('[HealthSection] SSE parse error:', err);
      }
    };

    this.sse.onerror = () => {
      console.warn('[HealthSection] SSE connection lost, reconnecting...');
    };
  }

  // ── Data Handlers ──────────────────────────────────────────────────────────

  handleVitalsUpdate(data) {
    this.latestVitals = data;
    this.lastReceivedAt = Date.now();

    // Add to history
    this.vitalsHistory.push(data);
    // Keep max 60 minutes of data
    const cutoff = Date.now() - 60 * 60 * 1000;
    this.vitalsHistory = this.vitalsHistory.filter(v =>
      new Date(v.timestamp).getTime() > cutoff
    );

    this.showDashboard();
    this.updateVitalsDisplay(data);
    this.updateConnectionStatus();

    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }
  }

  handleWithingsUpdate(data) {
    this.withingsData = data;
    this.updateWithingsDisplay(data);
  }

  // ── Display Updates ────────────────────────────────────────────────────────

  showDashboard() {
    if (this.els.waitingOverlay) {
      this.els.waitingOverlay.classList.add('hidden');
    }
    if (this.els.dashboard) {
      this.els.dashboard.classList.remove('hidden');
    }
  }

  updateVitalsDisplay(data) {
    const v = data.vitals || {};

    // Heart Rate — just the number
    if (v.heartRate?.value != null) {
      this.els.hrVal.textContent = Math.round(v.heartRate.value);
    }

    // HRV — just the number
    if (v.hrv?.value != null) {
      this.els.hrvVal.textContent = Math.round(v.hrv.value);
    }

    // SpO2 — just the number
    if (v.spo2?.value != null) {
      this.els.spo2Val.textContent = Math.round(v.spo2.value);
    }

    // Steps
    if (v.steps?.value != null) {
      this.els.stepsVal.textContent = v.steps.value.toLocaleString();
    }

    // Move Minutes
    if (v.moveMinutes?.value != null) {
      this.els.moveVal.textContent = Math.round(v.moveMinutes.value);
    }

    // Exercise Minutes
    if (v.exerciseMinutes?.value != null) {
      this.els.exerciseVal.textContent = Math.round(v.exerciseMinutes.value);
    }

    // Sleep
    if (data.sleep) {
      const totalHrs = data.sleep.totalHours;
      const hrs = Math.floor(totalHrs);
      const mins = Math.round((totalHrs - hrs) * 60);
      this.els.sleepVal.textContent = `${hrs}h ${mins}m`;

      // Start/end times only — stages are in detail view
      if (data.sleep.startTime || data.sleep.endTime) {
        const fmtTime = (iso) => {
          if (!iso) return '--';
          const d = new Date(iso);
          return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        };
        this.els.sleepTimes.textContent = `${fmtTime(data.sleep.startTime)} – ${fmtTime(data.sleep.endTime)}`;
      }
    }
  }

  computeAverage(metric, windowMinutes = 10) {
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    const recent = this.vitalsHistory.filter(v =>
      new Date(v.timestamp).getTime() > cutoff
    );
    const values = recent
      .map(v => v.vitals?.[metric]?.value)
      .filter(v => v != null);
    if (values.length === 0) return null;
    return (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);
  }

  updateWithingsDisplay(data) {
    const m = data.measures || {};
    if (!m.weight) return;

    const weightKg = m.weight.value;
    const weightLbs = (weightKg * 2.20462).toFixed(1);
    this.els.weightVal.textContent = `${weightLbs} lbs`;

    // Body Fat % — show on main card
    if (m.fatPercent) {
      this.els.bodyFatVal.textContent = `${m.fatPercent.value.toFixed(1)}%`;
    }

    // Update Withings status
    this.els.dotWithings.className = 'connection-dot connected';
    this.els.statusWithings.textContent = `Withings: Connected`;
    this.els.withingsBtn.classList.add('hidden');
  }

  updateConnectionStatus() {
    if (this.lastReceivedAt) {
      const ago = Math.round((Date.now() - this.lastReceivedAt) / 1000);
      const agoText = ago < 60 ? `${ago}s ago` : `${Math.round(ago / 60)}m ago`;
      const deviceName = this.latestVitals?.deviceName || 'iPhone';

      if (ago > 300) {
        // Stale (>5 min)
        this.els.dotWatch.className = 'connection-dot stale';
        this.els.statusWatch.textContent = `Apple Watch: Stale (${agoText} via ${deviceName})`;
      } else {
        this.els.dotWatch.className = 'connection-dot connected';
        this.els.statusWatch.textContent = `Apple Watch: Connected (${agoText} via ${deviceName})`;
      }
    }
  }

  checkStaleData() {
    this.updateConnectionStatus();
  }

  // ── Withings Status ────────────────────────────────────────────────────────

  async checkWithingsStatus() {
    try {
      const res = await fetch('/api/health/withings/status');
      const data = await res.json();

      if (!data.configured) {
        this.els.dotWithings.className = 'connection-dot';
        this.els.statusWithings.textContent = 'Withings: Not configured';
        this.els.withingsBtn.classList.add('hidden');
      } else if (data.connected) {
        this.els.dotWithings.className = 'connection-dot connected';
        this.els.statusWithings.textContent = 'Withings: Connected';
        this.els.withingsBtn.classList.add('hidden');
        this.fetchWithingsData();
      } else {
        this.els.dotWithings.className = 'connection-dot';
        this.els.statusWithings.textContent = 'Withings: Not connected';
        this.els.withingsBtn.classList.remove('hidden');
      }
    } catch (err) {
      console.error('[HealthSection] Withings status check failed:', err);
    }
  }

  async fetchWithingsData() {
    try {
      const res = await fetch('/api/health/withings/data');
      if (res.ok) {
        const data = await res.json();
        this.handleWithingsUpdate(data);
      }
    } catch (err) {
      console.error('[HealthSection] Withings data fetch failed:', err);
    }
  }

  // ── Fetch Latest (on mount) ────────────────────────────────────────────────

  async fetchLatest() {
    try {
      const res = await fetch('/api/health/vitals/latest');
      const data = await res.json();

      if (data.latest) {
        if (data.history && data.history.length > 0) {
          this.vitalsHistory = data.history;
        }
        this.handleVitalsUpdate({ type: 'vitals', ...data.latest });
      } else {
        // No real data — load mock data for demo purposes
        this.loadMockData();
      }

      if (data.withings) {
        this.handleWithingsUpdate(data.withings);
      }
    } catch (err) {
      console.error('[HealthSection] Failed to fetch latest vitals:', err);
      // On error, also load mock data
      this.loadMockData();
    }
  }

  // ── Mock Data (for demo when no iPhone companion connected) ─────────────────

  loadMockData() {
    console.log('[HealthSection] Loading mock data for demo');

    const now = new Date().toISOString();

    // Mock vitals data (Vijay's typical values)
    const mockVitals = {
      type: 'vitals',
      timestamp: now,
      deviceName: 'Demo Mode',
      vitals: {
        heartRate: {
          value: 52,
          timestamp: now,
          range24h: { min: 48, max: 110 },
        },
        hrv: {
          value: 41,
          timestamp: now,
          range24h: { min: 39, max: 55 },
        },
        spo2: {
          value: 98,
          timestamp: now,
          range24h: { min: 95, max: 99 },
        },
        steps: {
          value: 10539,
          timestamp: now,
        },
        moveMinutes: {
          value: 185,
          timestamp: now,
        },
        exerciseMinutes: {
          value: 66,
          timestamp: now,
        },
      },
      sleep: {
        totalHours: 7.5,
        startTime: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString(),
        endTime: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        stages: {
          deep: 1.2,
          core: 4.0,
          rem: 1.8,
          awake: 0.5,
        },
      },
    };

    // Mock Withings body composition data
    const mockWithings = {
      type: 'withings',
      measures: {
        weight: {
          value: 58.33, // 128.6 lbs in kg
          timestamp: now,
        },
        fatPercent: {
          value: 8.4,
          timestamp: now,
        },
        boneMass: {
          value: 3.58, // 7.9 lbs in kg
          timestamp: now,
        },
        muscleMass: {
          value: 50.8, // estimated
          timestamp: now,
        },
        visceralFat: {
          value: 1,
          timestamp: now,
        },
      },
    };

    // Apply mock data
    this.handleVitalsUpdate(mockVitals);
    this.handleWithingsUpdate(mockWithings);

    // Update connection status to show demo mode
    this.els.dotWatch.className = 'connection-dot connected';
    this.els.statusWatch.textContent = 'Apple Watch: Demo Mode';
    this.els.dotWithings.className = 'connection-dot connected';
    this.els.statusWithings.textContent = 'Withings: Demo Mode';
    this.els.withingsBtn.classList.add('hidden');
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  formatHours(hours) {
    if (hours == null) return '--';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  }

  formatTimestamp(iso) {
    if (!iso) return '--';
    const d = new Date(iso);
    const now = new Date();
    const diffMs = now - d;
    const diffMin = Math.round(diffMs / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return `${diffMin} min ago`;
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  pause() {
    // Stop vitals SSE
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }

    // Stop PIP voice
    this.stopListening();
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    this.head?.stopSpeaking();
    this.currentMayaSpeech = '';
    this.pipState = PipState.IDLE;

    return this.getState();
  }

  async resume(savedState = null) {
    if (savedState) {
      this.vitalsHistory = savedState.vitalsHistory || this.vitalsHistory;
      this.withingsData = savedState.withingsData || this.withingsData;
      this.conversationHistory = savedState.conversationHistory || this.conversationHistory;
    }

    // Re-render and reconnect
    this.render();
    await this.fetchLatest();
    this.connectSSE();
    this.staleTimer = setInterval(() => this.checkStaleData(), 30000);
    this.checkWithingsStatus();

    // Resume AudioContext and re-init PIP avatar (re-render destroys DOM)
    await AudioManager.resume();
    this.loadPIPAvatar();

    console.log('[HealthSection] Resumed');
  }

  unmount() {
    // Stop vitals SSE
    if (this.sse) {
      this.sse.close();
      this.sse = null;
    }
    if (this.staleTimer) {
      clearInterval(this.staleTimer);
      this.staleTimer = null;
    }

    // Stop PIP voice
    this.stopListening();
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    this.head = null;
    this.avatarLoaded = false;
    this.hasGreeted = false;

    if (this.container) {
      this.container.innerHTML = '';
    }
    console.log('[HealthSection] Unmounted');
  }

  getState() {
    return {
      vitalsHistory: this.vitalsHistory,
      withingsData: this.withingsData,
      conversationHistory: this.conversationHistory,
    };
  }
}
