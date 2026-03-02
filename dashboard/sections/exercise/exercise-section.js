/**
 * MayaMind Dashboard — Exercise Section (Native)
 *
 * Full native implementation replacing the iframe wrapper.
 * Features:
 *   - Camera + MediaPipe pose detection with skeleton overlay
 *   - TalkingHead avatar (Maya) for conversational coaching
 *   - Voice-driven workout state machine (LLM-powered)
 *   - Rep counting with idle timer
 *   - Chat transcript
 */

import { AudioManager } from '../../core/audio-manager.js';

// Exercise detectors (absolute paths — same Express server)
import { SquatDetector } from '/exercise-poc/exercises/squat.js';
import { LungeDetector } from '/exercise-poc/exercises/lunge.js';
import { BicepsCurlDetector } from '/exercise-poc/exercises/bicepsCurl.js';
import { PushupDetector } from '/exercise-poc/exercises/pushup.js';

// Joint/angle utilities
import {
  SKELETON_CONNECTIONS,
  calculateJointAngles,
  AngleSmoother,
} from '/exercise-poc/joints.js';

// LLM service
import {
  generateResponse,
  parseResponse,
  EXERCISE_DISPLAY_NAMES,
} from '/exercise-poc/llm.js';

// ── Constants ────────────────────────────────────────────────────────────────

const AVATAR_URL = '/avatars/brunette.glb';
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

// Skeleton drawing config
const DRAW = {
  lineColor: 'rgba(0, 200, 255, 0.7)',
  lineWidth: 3,
  pointColor: 'rgba(255, 100, 100, 0.9)',
  pointRadius: 5,
  lowVisibilityAlpha: 0.3,
  visibilityThreshold: 0.5,
};

// Workflow states
const WorkflowState = {
  IDLE: 'idle',
  GREETING: 'greeting',
  WAITING_START: 'waiting_start',
  MENU: 'menu',
  WAITING_SELECTION: 'waiting_selection',
  EXERCISE_ACTIVE: 'exercise_active',
  COMPLETION_CHECK: 'completion_check',
  WAITING_DONE: 'waiting_done',
  REPORT: 'report',
  WAITING_MORE: 'waiting_more',
  ENDED: 'ended',
};

// Exercise name mapping (fallback pattern matching)
const EXERCISE_MAP = {
  'squat': 'squat', 'squats': 'squat', 'chair squat': 'squat', 'chair squats': 'squat',
  'score': 'squat', 'scores': 'squat', 'squad': 'squat',
  'lunge': 'reverse_lunge', 'lunges': 'reverse_lunge',
  'reverse lunge': 'reverse_lunge', 'reverse lunges': 'reverse_lunge',
  'curl': 'biceps_curl', 'curls': 'biceps_curl',
  'bicep curl': 'biceps_curl', 'bicep curls': 'biceps_curl',
  'biceps curl': 'biceps_curl', 'biceps curls': 'biceps_curl',
  'pushup': 'knee_pushup', 'pushups': 'knee_pushup',
  'push up': 'knee_pushup', 'push ups': 'knee_pushup',
  'push-up': 'knee_pushup', 'push-ups': 'knee_pushup',
  'knee pushup': 'knee_pushup', 'knee pushups': 'knee_pushup',
};

const YES_PATTERNS = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'yea', 'ya', 'uh huh', 'absolutely', 'definitely'];
const NO_PATTERNS = ['no', 'nope', 'nah', "don't", 'not', 'negative'];

const EXERCISE_NAME_DISPLAY = {
  squat: 'Squats',
  reverse_lunge: 'Lunges',
  biceps_curl: 'Bicep Curls',
  knee_pushup: 'Push-ups',
};

// ── ExerciseSection Class ────────────────────────────────────────────────────

export class ExerciseSection {
  constructor(options = {}) {
    this.ttsService = options.ttsService;
    this.onStateChange = options.onStateChange || null;
    this.onRepUpdate = options.onRepUpdate || null;
    this.isMuted = options.isMuted || (() => false);
    this.setMuted = options.setMuted || (() => {});

    // DOM
    this.container = null;
    this.els = {};
    this.ctx = null;

    // Camera & pose
    this.poseLandmarker = null;
    this.mediaStream = null;
    this.animFrameId = null;
    this.angleSmoother = new AngleSmoother();

    // Detectors
    this.squatDetector = null;
    this.lungeDetector = null;
    this.bicepsCurlDetector = null;
    this.pushupDetector = null;

    // TalkingHead
    this.TalkingHead = null;
    this.head = null;
    this.avatarLoaded = false;

    // Workflow state
    this.workflowState = WorkflowState.IDLE;
    this.activeExercise = null;
    this.exerciseSpokenByLLM = false;
    this.repCount = 0;
    this.hasFirstRep = false;
    this.lastRepTime = null;
    this.hasSpokenFarewell = false;

    // Session context for LLM
    this.sessionContext = {
      sessionStartTime: null,
      exercisesCompleted: [],
      currentExercise: null,
      currentReps: 0,
      lastRepTime: null,
    };

    // Speech recognition
    this.speechRecognition = null;
    this.isListening = false;

    // TTS state
    this.isSpeaking = false;
    this.currentAbort = null;
    this.currentMayaSpeech = '';
    this.currentMood = 'neutral';

    // Quick speech (Web Speech API)
    this.speechSynthesis = window.speechSynthesis;
    this.speechInitialized = false;

    // Idle timer
    this.idleTimeoutId = null;
    this.idleTimeoutMs = 10000;
    this.initialTimeoutMs = 15000;

    // Lifecycle
    this.isActive = false;
    this.savedState = null;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async mount(container, savedState) {
    console.log('[Exercise] Mounting section');
    this.container = container;
    this.savedState = savedState;

    this.createUI();
    this.cacheElements();
    this.initDetectors();

    // Start camera + MediaPipe
    await this.loadMediaPipe();
    await this.startCamera();
    this.startDetectLoop();

    // Load TalkingHead avatar (non-blocking)
    this.loadTalkingHead().then(() => this.initAvatar());

    // Init speech systems
    this.initSpeechSynthesis();
    this.initSpeechRecognition();

    this.isActive = true;

    // Restore state or start fresh
    if (savedState && savedState.workflowState && savedState.workflowState !== WorkflowState.IDLE) {
      this.restoreState(savedState);
    } else {
      this.sessionContext.sessionStartTime = Date.now();
      this.hasSpokenFarewell = false;
      this.transitionTo(WorkflowState.GREETING);
    }
  }

  pause() {
    console.log('[Exercise] Pausing section');

    // Stop detection loop
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    // Disable camera tracks (don't release — fast resume)
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => { t.enabled = false; });
    }

    this.stopListening();
    this.bargeIn();
    this.clearIdleTimer();
    this.isActive = false;

    return this.getState();
  }

  async resume(savedState) {
    console.log('[Exercise] Resuming section');

    if (savedState) {
      this.restoreState(savedState);
    }

    // Re-enable camera tracks
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => { t.enabled = true; });
    }

    this.startDetectLoop();
    this.isActive = true;

    if (this.isWaitingForInput()) {
      setTimeout(() => this.startListening(), 300);
    }

    if (this.workflowState === WorkflowState.EXERCISE_ACTIVE) {
      this.resetIdleTimer();
    }
  }

  unmount() {
    console.log('[Exercise] Unmounting section');

    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }

    this.stopCamera();
    this.stopListening();
    this.bargeIn();
    this.clearIdleTimer();

    if (this.head) {
      try { this.head.stopSpeaking(); } catch (e) { /* ignore */ }
    }

    if (this.container) {
      this.container.innerHTML = '';
    }

    this.isActive = false;
    this.els = {};
    this.ctx = null;
  }

  getState() {
    return {
      workflowState: this.workflowState,
      activeExercise: this.activeExercise,
      repCount: this.repCount,
      hasFirstRep: this.hasFirstRep,
      lastRepTime: this.lastRepTime,
      sessionContext: { ...this.sessionContext },
      exercisesCompleted: this.sessionContext.exercisesCompleted || [],
    };
  }

  restoreState(state) {
    this.workflowState = state.workflowState || WorkflowState.IDLE;
    this.activeExercise = state.activeExercise || null;
    this.repCount = state.repCount || 0;
    this.hasFirstRep = state.hasFirstRep || false;
    this.lastRepTime = state.lastRepTime || null;
    if (state.sessionContext) {
      this.sessionContext = { ...state.sessionContext };
    }

    if (this.activeExercise) {
      this.updateExerciseName(EXERCISE_NAME_DISPLAY[this.activeExercise] || this.activeExercise);
      this.updateRepDisplay(this.repCount);
      this.activateDetector(this.activeExercise);
    }

    console.log(`[Exercise] Restored state: ${this.workflowState}, exercise: ${this.activeExercise}, reps: ${this.repCount}`);
  }

  // ── UI ──────────────────────────────────────────────────────────────────────

  createUI() {
    this.container.innerHTML = `
      <div class="exercise-wrapper">
        <div class="exercise-video-area">
          <div class="exercise-video-wrapper">
            <video id="exercise-video" autoplay playsinline muted></video>
            <canvas id="exercise-canvas"></canvas>
          </div>
        </div>
        <div class="exercise-side-panel">
          <div class="exercise-rep-panel">
            <div class="exercise-name" id="exercise-name">No Exercise</div>
            <div class="exercise-rep-count" id="exercise-rep-count">0</div>
            <div class="exercise-rep-label">reps</div>
            <div class="exercise-quality" id="exercise-quality">Quality: --</div>
          </div>
          <div class="exercise-avatar-panel">
            <div class="exercise-avatar-container" id="exercise-avatar">
              <span class="pip-loading">Loading Maya...</span>
            </div>
            <div class="exercise-pip-status" id="exercise-pip-status">
              <span class="pip-status-dot"></span>
              <span class="pip-status-text">Starting...</span>
            </div>
          </div>
          <div class="exercise-chat-panel">
            <div class="exercise-transcript" id="exercise-transcript">
              <span class="pip-placeholder">Maya will guide your workout...</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  cacheElements() {
    this.els = {
      video: this.container.querySelector('#exercise-video'),
      canvas: this.container.querySelector('#exercise-canvas'),
      exerciseName: this.container.querySelector('#exercise-name'),
      repCount: this.container.querySelector('#exercise-rep-count'),
      quality: this.container.querySelector('#exercise-quality'),
      avatarContainer: this.container.querySelector('#exercise-avatar'),
      pipStatus: this.container.querySelector('#exercise-pip-status'),
      transcript: this.container.querySelector('#exercise-transcript'),
    };
    this.ctx = this.els.canvas?.getContext('2d');
  }

  // ── Camera + MediaPipe ────────────────────────────────────────────────────

  async loadMediaPipe() {
    this.updatePIPStatus('loading', 'Loading pose model...');

    const { PoseLandmarker, FilesetResolver } = await import(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm'
    );

    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
    );

    this.poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
      outputSegmentationMasks: false,
    });

    console.log('[Exercise] MediaPipe model loaded');
  }

  async startCamera() {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });

      this.els.video.srcObject = this.mediaStream;

      await new Promise((resolve) => {
        this.els.video.onloadedmetadata = () => {
          this.els.canvas.width = this.els.video.videoWidth;
          this.els.canvas.height = this.els.video.videoHeight;
          resolve();
        };
      });

      await this.els.video.play();
      console.log('[Exercise] Camera started');
    } catch (err) {
      console.error('[Exercise] Camera error:', err);
      this.updatePIPStatus('error', 'Camera error');
    }
  }

  stopCamera() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.els.video) {
      this.els.video.srcObject = null;
    }
  }

  startDetectLoop() {
    const loop = (timestamp) => {
      if (!this.isActive) return;

      if (this.poseLandmarker && this.els.video?.readyState >= 2) {
        const results = this.poseLandmarker.detectForVideo(this.els.video, timestamp);
        this.processResults(results, timestamp);
      }

      this.animFrameId = requestAnimationFrame(loop);
    };
    this.animFrameId = requestAnimationFrame(loop);
  }

  processResults(results, timestamp) {
    if (!this.ctx) return;
    this.ctx.clearRect(0, 0, this.els.canvas.width, this.els.canvas.height);

    if (!results.landmarks || results.landmarks.length === 0) return;

    const landmarks2D = results.landmarks[0];
    const worldLandmarks = results.worldLandmarks[0];

    this.drawSkeleton(landmarks2D);

    const rawAngles = calculateJointAngles(worldLandmarks, DRAW.visibilityThreshold);
    const smoothedAngles = this.angleSmoother.update(rawAngles);

    if (this.activeExercise && smoothedAngles) {
      switch (this.activeExercise) {
        case 'squat':
          this.squatDetector.update(smoothedAngles, timestamp, landmarks2D);
          break;
        case 'biceps_curl':
          this.bicepsCurlDetector.update(smoothedAngles, timestamp);
          break;
        case 'reverse_lunge':
          this.lungeDetector.update(smoothedAngles, timestamp);
          break;
        case 'knee_pushup':
          this.pushupDetector.update(smoothedAngles, timestamp);
          break;
      }
    }
  }

  // ── Skeleton Drawing ──────────────────────────────────────────────────────

  drawSkeleton(landmarks) {
    if (!landmarks || !this.ctx) return;

    const w = this.els.canvas.width;
    const h = this.els.canvas.height;

    const toCanvas = (lm) => ({
      x: lm.x * w,
      y: lm.y * h,
      visibility: lm.visibility ?? 1,
    });

    // Clip all drawing to canvas bounds (landmarks can exceed 0-1 range)
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(0, 0, w, h);
    this.ctx.clip();

    // Draw connections
    this.ctx.lineWidth = DRAW.lineWidth;
    this.ctx.lineCap = 'round';

    for (const [startIdx, endIdx] of SKELETON_CONNECTIONS) {
      const start = toCanvas(landmarks[startIdx]);
      const end = toCanvas(landmarks[endIdx]);
      const minVis = Math.min(start.visibility, end.visibility);
      const alpha = minVis >= DRAW.visibilityThreshold ? 1 : DRAW.lowVisibilityAlpha;

      this.ctx.strokeStyle = DRAW.lineColor.replace('0.7', (0.7 * alpha).toFixed(2));
      this.ctx.beginPath();
      this.ctx.moveTo(start.x, start.y);
      this.ctx.lineTo(end.x, end.y);
      this.ctx.stroke();
    }

    // Draw landmark points (skip face landmarks 1-10)
    for (let i = 0; i < landmarks.length; i++) {
      if (i >= 1 && i <= 10) continue;
      const pt = toCanvas(landmarks[i]);
      const alpha = pt.visibility >= DRAW.visibilityThreshold ? 1 : DRAW.lowVisibilityAlpha;

      this.ctx.fillStyle = DRAW.pointColor.replace('0.9', (0.9 * alpha).toFixed(2));
      this.ctx.beginPath();
      this.ctx.arc(pt.x, pt.y, DRAW.pointRadius, 0, 2 * Math.PI);
      this.ctx.fill();
    }

    this.ctx.restore();
  }

  // ── Detectors ─────────────────────────────────────────────────────────────

  initDetectors() {
    const repCb = (key) => (repData) => this.handleRepComplete(key, repData);

    this.squatDetector = new SquatDetector({ onRepComplete: repCb('squat') });
    this.lungeDetector = new LungeDetector({ onRepComplete: repCb('reverse_lunge') });
    this.bicepsCurlDetector = new BicepsCurlDetector({ onRepComplete: repCb('biceps_curl') });
    this.pushupDetector = new PushupDetector({ onRepComplete: repCb('knee_pushup') });
  }

  activateDetector(exerciseKey) {
    switch (exerciseKey) {
      case 'squat': this.squatDetector.reset(); break;
      case 'reverse_lunge': this.lungeDetector.reset(); break;
      case 'biceps_curl': this.bicepsCurlDetector.reset(); break;
      case 'knee_pushup': this.pushupDetector.reset(); break;
    }
    this.activeExercise = exerciseKey;
  }

  deactivateDetector() {
    this.activeExercise = null;
  }

  handleRepComplete(exerciseKey, repData) {
    const countingStates = [
      WorkflowState.EXERCISE_ACTIVE,
      WorkflowState.COMPLETION_CHECK,
      WorkflowState.WAITING_DONE,
    ];
    if (!countingStates.includes(this.workflowState)) return;
    if (exerciseKey !== this.activeExercise) return;

    this.repCount++;
    this.hasFirstRep = true;
    this.lastRepTime = Date.now();
    this.sessionContext.currentReps = this.repCount;
    this.sessionContext.lastRepTime = this.lastRepTime;

    // If in completion check/waiting done, rep means user is still exercising
    if (this.workflowState === WorkflowState.COMPLETION_CHECK || this.workflowState === WorkflowState.WAITING_DONE) {
      console.log('[Exercise] Rep during completion check — user still exercising');
      this.bargeIn();
      this.stopListening();
      this.workflowState = WorkflowState.EXERCISE_ACTIVE;
    }

    this.resetIdleTimer();
    this.updateRepDisplay(this.repCount);

    // Quick rep announcement via Web Speech (low latency)
    if (!this.isMuted()) {
      this.speakQuick(`${this.repCount}`);
    }

    if (this.onRepUpdate) {
      this.onRepUpdate(exerciseKey, this.repCount);
    }
  }

  // ── TalkingHead Avatar ────────────────────────────────────────────────────

  async loadTalkingHead() {
    try {
      const module = await import('/modules/talkinghead.mjs');
      this.TalkingHead = module.TalkingHead;
      console.log('[Exercise] TalkingHead module loaded');
    } catch (err) {
      console.error('[Exercise] Failed to load TalkingHead:', err);
    }
  }

  async initAvatar() {
    if (!this.TalkingHead || !this.els.avatarContainer) return;

    try {
      const audioCtx = AudioManager.getContext();

      this.head = new this.TalkingHead(this.els.avatarContainer, {
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

      const loadingEl = this.els.avatarContainer.querySelector('.pip-loading');
      if (loadingEl) loadingEl.remove();

      console.log('[Exercise] Avatar loaded');
    } catch (err) {
      console.error('[Exercise] Avatar init error:', err);
    }
  }

  // ── TTS (ElevenLabs → TalkingHead) ────────────────────────────────────────

  async speakText(text, mood = 'neutral') {
    if (this.isMuted()) return;

    this.currentMayaSpeech = text;
    this.isSpeaking = true;
    this.applyMood(mood);
    this.updatePIPStatus('speaking', 'Speaking...');
    this.appendTranscript('assistant', text);

    const abort = new AbortController();
    this.currentAbort = abort;

    try {
      const res = await fetch(TTS_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice_settings: MOOD_VOICE_SETTINGS[mood] || MOOD_VOICE_SETTINGS.neutral,
        }),
        signal: abort.signal,
      });

      if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);

      const data = await res.json();
      const arrayBuf = this.base64ToArrayBuffer(data.audio_base64);
      const audioBuf = await AudioManager.decodeAudio(arrayBuf);
      const timing = this.alignmentToWords(data.normalized_alignment || data.alignment);

      await AudioManager.resume();

      if (this.head && this.avatarLoaded) {
        this.head.speakAudio(
          { audio: audioBuf, words: timing.words, wtimes: timing.wtimes, wdurations: timing.wdurations },
          { lipsyncLang: 'en' }
        );
        await this.waitForSpeechEnd();
      } else {
        // Avatar not ready yet — play audio directly
        await new Promise((resolve) => {
          const source = AudioManager.playBuffer(audioBuf, resolve);
        });
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        console.error('[Exercise TTS] error:', err);
        // Fallback to Web Speech
        await new Promise(resolve => this.speakQuick(text, resolve));
      }
    }

    this.isSpeaking = false;
    this.currentMayaSpeech = '';
    this.currentAbort = null;

    if (this.isWaitingForInput()) {
      this.updatePIPStatus('listening', 'Listening...');
    }
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

  bargeIn() {
    if (this.currentAbort) {
      this.currentAbort.abort();
      this.currentAbort = null;
    }
    if (this.head) {
      try { this.head.stopSpeaking(); } catch (e) { /* ignore */ }
    }
    this.speechSynthesis?.cancel();
    this.isSpeaking = false;
    this.currentMayaSpeech = '';
  }

  applyMood(mood) {
    if (!VALID_MOODS.includes(mood)) mood = 'neutral';
    this.currentMood = mood;
    if (this.head && this.avatarLoaded) this.head.setMood(mood);
  }

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

  // ── Quick Speech (Web Speech API — for rep counts) ────────────────────────

  initSpeechSynthesis() {
    if (this.speechInitialized || !this.speechSynthesis) return;

    const unlock = new SpeechSynthesisUtterance('');
    this.speechSynthesis.speak(unlock);
    this.speechInitialized = true;
  }

  speakQuick(text, onEnd = null) {
    if (!this.speechSynthesis || !this.speechInitialized) {
      if (onEnd) onEnd();
      return;
    }

    this.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;
    utterance.onend = () => { if (onEnd) onEnd(); };
    utterance.onerror = () => { if (onEnd) onEnd(); };
    this.speechSynthesis.speak(utterance);
  }

  // ── Speech Recognition ────────────────────────────────────────────────────

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('[Exercise] Speech recognition not supported');
      return;
    }

    this.speechRecognition = new SpeechRecognition();
    this.speechRecognition.continuous = false;
    this.speechRecognition.interimResults = false;
    this.speechRecognition.lang = 'en-US';

    this.speechRecognition.onresult = async (event) => {
      const transcript = event.results[0][0].transcript.trim();
      console.log(`[Exercise] Heard: "${transcript}"`);
      this.isListening = false;

      // Mute check
      if (this.isMuted()) {
        setTimeout(() => this.startListening(), 300);
        return;
      }

      // Barge-in: interrupt Maya if she's speaking
      if (this.isSpeaking) {
        if (this.isLikelyEcho(transcript)) {
          setTimeout(() => this.startListening(), 300);
          return;
        }
        console.log('[Exercise] Barge-in detected');
        this.bargeIn();
      }

      this.appendTranscript('user', transcript);
      await this.processSpeechInput(transcript.toLowerCase());
    };

    this.speechRecognition.onerror = (event) => {
      this.isListening = false;
      if (event.error === 'aborted') return;

      if (event.error === 'no-speech') {
        if (this.isWaitingForInput() && !this.isSpeaking) {
          setTimeout(() => this.startListening(), 500);
        }
        return;
      }

      console.error('[Exercise] Speech error:', event.error);
      if (this.isWaitingForInput() && !this.isSpeaking) {
        setTimeout(() => this.startListening(), 1000);
      }
    };

    this.speechRecognition.onend = () => {
      this.isListening = false;
      if (this.isWaitingForInput() && !this.isSpeaking) {
        setTimeout(() => {
          if (this.isWaitingForInput() && !this.isSpeaking && !this.isListening) {
            this.startListening();
          }
        }, 300);
      }
    };
  }

  startListening() {
    if (!this.speechRecognition) return;
    if (this.isListening) return;
    if (this.isSpeaking) return;

    try {
      this.speechRecognition.start();
      this.isListening = true;
    } catch (e) {
      this.isListening = false;
      if (e.message?.includes('already started') || e.name === 'InvalidStateError') {
        this.initSpeechRecognition();
        setTimeout(() => {
          if (this.isWaitingForInput() && !this.isSpeaking) {
            this.startListening();
          }
        }, 500);
      }
    }
  }

  stopListening() {
    if (!this.speechRecognition || !this.isListening) return;
    try {
      this.speechRecognition.stop();
      this.isListening = false;
    } catch (e) { /* ignore */ }
  }

  isLikelyEcho(transcript) {
    if (!this.currentMayaSpeech) return false;
    const spoken = this.currentMayaSpeech.toLowerCase();
    const heard = transcript.toLowerCase();
    const heardWords = heard.split(/\s+/);
    const matchCount = heardWords.filter(w => spoken.includes(w)).length;
    return matchCount / heardWords.length > 0.5;
  }

  isWaitingForInput() {
    if (this.workflowState === WorkflowState.ENDED || this.workflowState === WorkflowState.IDLE) {
      return false;
    }
    return [
      WorkflowState.WAITING_START,
      WorkflowState.WAITING_SELECTION,
      WorkflowState.WAITING_DONE,
      WorkflowState.WAITING_MORE,
    ].includes(this.workflowState);
  }

  // ── Workflow State Machine ────────────────────────────────────────────────

  async transitionTo(newState) {
    const oldState = this.workflowState;
    this.workflowState = newState;
    console.log(`[Exercise] State: ${oldState} → ${newState}`);

    if (this.onStateChange) {
      this.onStateChange(this.getState());
    }

    switch (newState) {
      case WorkflowState.GREETING:
        await this.handleGreeting();
        break;
      case WorkflowState.WAITING_START:
        setTimeout(() => this.startListening(), 100);
        break;
      case WorkflowState.MENU:
        await this.handleMenu();
        break;
      case WorkflowState.WAITING_SELECTION:
        setTimeout(() => this.startListening(), 100);
        break;
      case WorkflowState.EXERCISE_ACTIVE:
        await this.handleExerciseActive();
        break;
      case WorkflowState.COMPLETION_CHECK:
        await this.handleCompletionCheck();
        break;
      case WorkflowState.WAITING_DONE:
        setTimeout(() => this.startListening(), 100);
        break;
      case WorkflowState.REPORT:
        await this.handleReport();
        break;
      case WorkflowState.WAITING_MORE:
        setTimeout(() => this.startListening(), 100);
        break;
      case WorkflowState.ENDED:
        await this.handleEnded();
        break;
    }
  }

  // ── State Handlers ────────────────────────────────────────────────────────

  async handleGreeting() {
    this.updatePIPStatus('thinking', 'Thinking...');
    const response = await generateResponse(this.sessionContext, '__greeting__');
    await this.speakText(response.cleanText, response.mood);
    this.transitionTo(WorkflowState.WAITING_START);
  }

  async handleMenu() {
    this.updatePIPStatus('thinking', 'Thinking...');
    const response = await generateResponse(this.sessionContext, '__menu__');
    await this.speakText(response.cleanText, response.mood);
    this.transitionTo(WorkflowState.WAITING_SELECTION);
  }

  async handleExerciseActive() {
    if (!this.exerciseSpokenByLLM) {
      const displayName = EXERCISE_DISPLAY_NAMES[this.activeExercise] || this.activeExercise;
      await this.speakText(`Go ahead, I'll count your ${displayName}.`, 'happy');
    }
    this.exerciseSpokenByLLM = false;

    this.repCount = 0;
    this.hasFirstRep = false;
    this.lastRepTime = null;
    this.sessionContext.currentExercise = this.activeExercise;
    this.sessionContext.currentReps = 0;
    this.sessionContext.lastRepTime = null;

    this.updateExerciseName(EXERCISE_NAME_DISPLAY[this.activeExercise] || this.activeExercise);
    this.updateRepDisplay(0);
    this.activateDetector(this.activeExercise);
    this.resetIdleTimer(this.initialTimeoutMs);
  }

  async handleCompletionCheck() {
    this.clearIdleTimer();
    this.updatePIPStatus('thinking', 'Thinking...');
    const response = await generateResponse(this.sessionContext, '__completion_check__');
    await this.speakText(response.cleanText, response.mood);
    this.transitionTo(WorkflowState.WAITING_DONE);
  }

  async handleReport() {
    this.sessionContext.exercisesCompleted.push({
      exercise: this.activeExercise,
      reps: this.repCount,
      duration: this.lastRepTime ? this.lastRepTime - this.sessionContext.sessionStartTime : 0,
    });

    this.deactivateDetector();
    this.updatePIPStatus('thinking', 'Thinking...');
    const response = await generateResponse(this.sessionContext, '__report__');
    await this.speakText(response.cleanText, response.mood);

    this.sessionContext.currentExercise = null;
    this.sessionContext.currentReps = 0;

    this.transitionTo(WorkflowState.WAITING_MORE);
  }

  async handleEnded() {
    if (this.hasSpokenFarewell) return;
    this.hasSpokenFarewell = true;

    this.deactivateDetector();
    this.updatePIPStatus('thinking', 'Thinking...');
    const response = await generateResponse(this.sessionContext, '__farewell__');
    await this.speakText(response.cleanText, response.mood);

    this.stopListening();
    this.clearIdleTimer();
    this.updatePIPStatus('idle', 'Session ended');
  }

  // ── Speech Input Processing ───────────────────────────────────────────────

  async processSpeechInput(transcript) {
    this.updatePIPStatus('thinking', 'Thinking...');
    const response = await generateResponse(this.sessionContext, transcript);
    const { cleanText, mood, intent, exerciseKey } = response;

    switch (intent) {
      case 'start_exercise':
        if (exerciseKey) {
          this.activeExercise = exerciseKey;
          this.exerciseSpokenByLLM = true;
          await this.speakText(cleanText, mood);
          this.transitionTo(WorkflowState.EXERCISE_ACTIVE);
        }
        break;

      case 'show_menu':
        await this.speakText(cleanText, mood);
        this.startListening();
        break;

      case 'confirm_yes':
        await this.handleConfirmYes(cleanText, mood);
        break;

      case 'confirm_no':
        await this.handleConfirmNo(cleanText, mood);
        break;

      case 'end_session':
        this.hasSpokenFarewell = true;
        await this.speakText(cleanText, mood);
        this.workflowState = WorkflowState.ENDED;
        if (this.onStateChange) this.onStateChange(this.getState());
        this.stopListening();
        this.clearIdleTimer();
        this.deactivateDetector();
        this.updatePIPStatus('idle', 'Session ended');
        break;

      case 'continue':
        await this.speakText(cleanText, mood);
        if (this.workflowState === WorkflowState.WAITING_DONE) {
          this.workflowState = WorkflowState.EXERCISE_ACTIVE;
          this.resetIdleTimer();
        }
        break;

      case 'next_exercise':
        await this.speakText(cleanText, mood);
        this.transitionTo(WorkflowState.MENU);
        break;

      default:
        await this.processWithPatterns(transcript);
        break;
    }
  }

  async handleConfirmYes(text, mood) {
    switch (this.workflowState) {
      case WorkflowState.WAITING_START:
        await this.transitionTo(WorkflowState.MENU);
        break;
      case WorkflowState.WAITING_DONE:
        await this.transitionTo(WorkflowState.REPORT);
        break;
      case WorkflowState.WAITING_MORE:
        await this.transitionTo(WorkflowState.MENU);
        break;
    }
  }

  async handleConfirmNo(text, mood) {
    switch (this.workflowState) {
      case WorkflowState.WAITING_START:
        await this.transitionTo(WorkflowState.ENDED);
        break;
      case WorkflowState.WAITING_DONE:
        await this.speakText(text || 'Okay, keep going!', mood || 'happy');
        this.workflowState = WorkflowState.EXERCISE_ACTIVE;
        this.resetIdleTimer();
        break;
      case WorkflowState.WAITING_MORE:
        await this.transitionTo(WorkflowState.ENDED);
        break;
    }
  }

  async processWithPatterns(transcript) {
    switch (this.workflowState) {
      case WorkflowState.WAITING_START:
        if (this.matchesYes(transcript)) {
          await this.transitionTo(WorkflowState.MENU);
        } else if (this.matchesNo(transcript)) {
          await this.transitionTo(WorkflowState.ENDED);
        } else {
          await this.speakText("Sorry, I didn't catch that. Would you like to exercise today?", 'neutral');
          await this.transitionTo(WorkflowState.WAITING_START);
        }
        break;

      case WorkflowState.WAITING_SELECTION: {
        const exercise = this.matchExercise(transcript);
        if (exercise) {
          this.activeExercise = exercise;
          await this.transitionTo(WorkflowState.EXERCISE_ACTIVE);
        } else {
          await this.speakText("I didn't recognize that exercise. You can say squats, lunges, bicep curls, or push-ups.", 'neutral');
          await this.transitionTo(WorkflowState.WAITING_SELECTION);
        }
        break;
      }

      case WorkflowState.WAITING_DONE:
        if (this.matchesYes(transcript)) {
          await this.transitionTo(WorkflowState.REPORT);
        } else if (this.matchesNo(transcript)) {
          await this.speakText('Okay, keep going!', 'happy');
          this.workflowState = WorkflowState.EXERCISE_ACTIVE;
          this.resetIdleTimer();
        } else {
          await this.speakText("Say yes if you're done, or no to continue.", 'neutral');
          await this.transitionTo(WorkflowState.WAITING_DONE);
        }
        break;

      case WorkflowState.WAITING_MORE:
        if (this.matchesYes(transcript)) {
          await this.transitionTo(WorkflowState.MENU);
        } else if (this.matchesNo(transcript)) {
          await this.transitionTo(WorkflowState.ENDED);
        } else {
          await this.speakText('Would you like to do another exercise?', 'neutral');
          await this.transitionTo(WorkflowState.WAITING_MORE);
        }
        break;
    }
  }

  matchesYes(transcript) { return YES_PATTERNS.some(p => transcript.includes(p)); }
  matchesNo(transcript) { return NO_PATTERNS.some(p => transcript.includes(p)); }

  matchExercise(transcript) {
    for (const [alias, key] of Object.entries(EXERCISE_MAP)) {
      if (transcript.includes(alias)) return key;
    }
    return null;
  }

  // ── Idle Timer ────────────────────────────────────────────────────────────

  resetIdleTimer(timeoutMs = null) {
    this.clearIdleTimer();
    const timeout = timeoutMs ?? (this.hasFirstRep ? this.idleTimeoutMs : this.initialTimeoutMs);

    this.idleTimeoutId = setTimeout(() => {
      if (this.workflowState === WorkflowState.EXERCISE_ACTIVE) {
        this.transitionTo(WorkflowState.COMPLETION_CHECK);
      }
    }, timeout);
  }

  clearIdleTimer() {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
  }

  // ── UI Updates ────────────────────────────────────────────────────────────

  updateRepDisplay(count) {
    if (this.els.repCount) this.els.repCount.textContent = count;
  }

  updateExerciseName(name) {
    if (this.els.exerciseName) this.els.exerciseName.textContent = name;
  }

  updatePIPStatus(state, text) {
    if (!this.els.pipStatus) return;
    const dot = this.els.pipStatus.querySelector('.pip-status-dot');
    const label = this.els.pipStatus.querySelector('.pip-status-text');

    if (dot) {
      dot.className = 'pip-status-dot';
      if (state === 'listening') dot.classList.add('listening');
      else if (state === 'speaking') dot.classList.add('speaking');
      else if (state === 'thinking') dot.classList.add('thinking');
    }
    if (label) label.textContent = text;
  }

  appendTranscript(role, text) {
    if (!this.els.transcript) return;

    const placeholder = this.els.transcript.querySelector('.pip-placeholder');
    if (placeholder) placeholder.remove();

    const cleanText = text.replace(/\[MOOD:\w+\]\s*/g, '').replace(/\[INTENT:[^\]]+\]\s*/g, '');

    const msg = document.createElement('div');
    msg.className = `pip-msg ${role}`;
    const roleLabel = role === 'user' ? 'You' : 'Maya';
    msg.innerHTML = `<span class="pip-role">${roleLabel}:</span> ${this.escapeHtml(cleanText)}`;
    this.els.transcript.appendChild(msg);

    // Keep last 20 messages
    while (this.els.transcript.children.length > 20) {
      this.els.transcript.removeChild(this.els.transcript.firstChild);
    }

    this.els.transcript.scrollTop = this.els.transcript.scrollHeight;
  }

  escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
