/**
 * MayaMind Exercise POC — Voice Workflow
 *
 * Voice-driven state machine for exercise selection and coaching.
 * Uses Web Speech API for STT, ElevenLabs for natural TTS, and Claude for conversation.
 */

import { generateResponse, parseResponse, EXERCISE_DISPLAY_NAMES } from './llm.js';

// ── Voice Workflow States ────────────────────────────────────────────────────

export const VoiceState = {
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

// ── Exercise Mapping (fallback for pattern matching) ────────────────────────

const EXERCISE_MAP = {
  // Squats (including common misrecognitions)
  'squat': 'squat',
  'squats': 'squat',
  'chair squat': 'squat',
  'chair squats': 'squat',
  'score': 'squat',
  'scores': 'squat',
  'squad': 'squat',

  // Lunges
  'lunge': 'reverse_lunge',
  'lunges': 'reverse_lunge',
  'reverse lunge': 'reverse_lunge',
  'reverse lunges': 'reverse_lunge',

  // Biceps curls
  'curl': 'biceps_curl',
  'curls': 'biceps_curl',
  'bicep curl': 'biceps_curl',
  'bicep curls': 'biceps_curl',
  'biceps curl': 'biceps_curl',
  'biceps curls': 'biceps_curl',

  // Push-ups
  'pushup': 'knee_pushup',
  'pushups': 'knee_pushup',
  'push up': 'knee_pushup',
  'push ups': 'knee_pushup',
  'push-up': 'knee_pushup',
  'push-ups': 'knee_pushup',
  'knee pushup': 'knee_pushup',
  'knee pushups': 'knee_pushup',
};

// ── Pattern Matching (fallback) ─────────────────────────────────────────────

const YES_PATTERNS = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'yea', 'ya', 'uh huh', 'absolutely', 'definitely'];
const NO_PATTERNS = ['no', 'nope', 'nah', "don't", 'not', 'negative'];

// ── Voice Workflow Class ─────────────────────────────────────────────────────

export class VoiceWorkflow {
  constructor(options = {}) {
    this.state = VoiceState.IDLE;
    this.speechRecognition = null;
    this.speechSynthesis = window.speechSynthesis;
    this.speechInitialized = false;
    this.audioContext = null;

    // LLM mode (can be disabled for testing)
    this.useLLM = options.useLLM !== false;

    // Current exercise state
    this.activeExercise = null;
    this.exerciseSpokenByLLM = false; // Flag to prevent double speech
    this.repCount = 0;
    this.idleTimeoutId = null;
    this.idleTimeoutMs = options.idleTimeoutMs || 10000;  // Increased from 5s to 10s
    this.initialTimeoutMs = options.initialTimeoutMs || 15000;
    this.hasFirstRep = false;
    this.lastRepTime = null;

    // Session context for LLM
    this.sessionContext = {
      sessionStartTime: null,
      exercisesCompleted: [],
      currentExercise: null,
      currentReps: 0,
      lastRepTime: null,
    };

    // Callbacks
    this.onStateChange = options.onStateChange || null;
    this.onExerciseStart = options.onExerciseStart || null;
    this.onExerciseEnd = options.onExerciseEnd || null;
    this.onRepUpdate = options.onRepUpdate || null;
    this.onSpeakStart = options.onSpeakStart || null;
    this.onSpeakEnd = options.onSpeakEnd || null;
    this.onThinkingStart = options.onThinkingStart || null;
    this.onThinkingEnd = options.onThinkingEnd || null;

    // Listening state
    this.isListening = false;
    this.isSpeaking = false;
    this.currentAudioSource = null; // Track ElevenLabs audio for cancellation
    this.ttsAbortController = null; // Track in-flight TTS requests for cancellation
    this.hasSpokenFarewell = false; // Guard against double farewell

    // Bind methods
    this.handleSpeechResult = this.handleSpeechResult.bind(this);
    this.handleSpeechError = this.handleSpeechError.bind(this);
    this.handleSpeechEnd = this.handleSpeechEnd.bind(this);
  }

  // ── Public Methods ─────────────────────────────────────────────────────────

  /**
   * Start the voice workflow (call after camera is ready)
   */
  start() {
    console.log('[Voice] Starting workflow');
    this.sessionContext.sessionStartTime = Date.now();
    this.hasSpokenFarewell = false; // Reset farewell guard
    this.initSpeech();
    this.initSpeechRecognition();
    this.initAudioContext();
    this.transitionTo(VoiceState.GREETING);
  }

  /**
   * Stop the voice workflow
   */
  stop() {
    console.log('[Voice] Stopping workflow');
    this.stopListening();
    this.clearIdleTimer();
    this.activeExercise = null;
    this.state = VoiceState.IDLE;
  }

  /**
   * Called by detectors when a rep is completed
   */
  onRepCompleted(exerciseKey) {
    const countingStates = [VoiceState.EXERCISE_ACTIVE, VoiceState.COMPLETION_CHECK, VoiceState.WAITING_DONE];
    if (!countingStates.includes(this.state)) return;
    if (exerciseKey !== this.activeExercise) return;

    this.repCount++;
    this.hasFirstRep = true;
    this.lastRepTime = Date.now();
    this.sessionContext.currentReps = this.repCount;
    this.sessionContext.lastRepTime = this.lastRepTime;

    // If we're in completion check or waiting done, a new rep means user is still exercising
    // Interrupt Maya and return to exercise active state
    if (this.state === VoiceState.COMPLETION_CHECK || this.state === VoiceState.WAITING_DONE) {
      console.log('[Voice] Rep detected during completion check - user is still exercising');
      this.bargeIn(); // Stop Maya from asking "Are you done?"
      this.stopListening();
      this.state = VoiceState.EXERCISE_ACTIVE;
      if (this.onStateChange) {
        this.onStateChange(VoiceState.EXERCISE_ACTIVE, VoiceState.COMPLETION_CHECK);
      }
    }

    // Always reset idle timer when a rep is completed (in any counting state)
    this.resetIdleTimer();

    if (this.onRepUpdate) {
      this.onRepUpdate(exerciseKey, this.repCount);
    }
  }

  // ── Audio Context (for ElevenLabs playback) ───────────────────────────────

  initAudioContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
  }

  // ── Speech Synthesis (Dual TTS) ───────────────────────────────────────────

  initSpeech() {
    if (this.speechInitialized || !this.speechSynthesis) return;

    const unlock = new SpeechSynthesisUtterance('');
    this.speechSynthesis.speak(unlock);
    this.speechInitialized = true;
  }

  /**
   * Speak using Web Speech API (quick, for rep counts and form feedback)
   */
  speakQuick(text, onEnd = null) {
    if (!this.speechSynthesis || !this.speechInitialized) {
      if (onEnd) onEnd();
      return;
    }

    // Cancel any ongoing speech (both Web Speech and ElevenLabs)
    this.speechSynthesis.cancel();
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
      } catch (e) { /* ignore */ }
      this.currentAudioSource = null;
    }
    this.isSpeaking = true;

    if (this.onSpeakStart) this.onSpeakStart();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
      this.isSpeaking = false;
      if (this.onSpeakEnd) this.onSpeakEnd();
      if (onEnd) onEnd();
    };

    utterance.onerror = (e) => {
      console.error('[Voice] Speech error:', e.error);
      this.isSpeaking = false;
      if (this.onSpeakEnd) this.onSpeakEnd();
      if (onEnd) onEnd();
    };

    this.speechSynthesis.speak(utterance);
  }

  /**
   * Speak using ElevenLabs (natural voice, for conversational responses)
   * Supports barge-in: user can interrupt by speaking
   */
  async speakElevenLabs(text, mood = 'neutral') {
    // Don't stop recognition - allow barge-in (user can interrupt by speaking)
    // The handleSpeechResult will call bargeIn() if user speaks during TTS

    // Cancel any ongoing speech AND in-flight TTS requests
    this.speechSynthesis.cancel();
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
      } catch (e) { /* ignore */ }
      this.currentAudioSource = null;
    }
    // Abort any in-flight TTS fetch request
    if (this.ttsAbortController) {
      this.ttsAbortController.abort();
      this.ttsAbortController = null;
    }

    this.isSpeaking = true;
    if (this.onSpeakStart) this.onSpeakStart();

    // Create new abort controller for this request
    this.ttsAbortController = new AbortController();
    const { signal } = this.ttsAbortController;

    try {
      // Adjust voice settings based on mood
      const voiceSettings = this.getVoiceSettingsForMood(mood);

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice_settings: voiceSettings,
        }),
        signal, // Allow aborting in-flight requests
      });

      // Check if aborted during fetch
      if (signal.aborted) {
        throw new Error('TTS request aborted');
      }

      if (!response.ok) {
        throw new Error(`TTS error: ${response.status}`);
      }

      const data = await response.json();

      // Check if aborted during decode
      if (signal.aborted) {
        throw new Error('TTS request aborted');
      }

      // Decode and play audio
      const audioBytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
      const audioBuffer = await this.audioContext.decodeAudioData(audioBytes.buffer);

      // Check if aborted before playing
      if (signal.aborted) {
        throw new Error('TTS request aborted');
      }

      return new Promise((resolve) => {
        const source = this.audioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(this.audioContext.destination);
        this.currentAudioSource = source; // Track for cancellation

        source.onended = () => {
          this.currentAudioSource = null;
          this.ttsAbortController = null;
          this.isSpeaking = false;
          if (this.onSpeakEnd) this.onSpeakEnd();

          // Ensure recognition is running after speech ends (for quick responses)
          if (this.isWaitingForInput() && !this.isListening) {
            setTimeout(() => this.startListening(), 50);
          }
          resolve();
        };

        source.start(0);
      });
    } catch (err) {
      // Don't log abort errors - they're intentional
      if (err.name !== 'AbortError' && !err.message.includes('aborted')) {
        console.error('[Voice] ElevenLabs TTS error:', err.message);
      }
      this.ttsAbortController = null;
      this.isSpeaking = false;
      if (this.onSpeakEnd) this.onSpeakEnd();

      // Only fallback to Web Speech for actual errors, not aborts
      if (err.name !== 'AbortError' && !err.message.includes('aborted')) {
        return new Promise((resolve) => {
          this.speakQuick(text, resolve);
        });
      }
    }
  }

  /**
   * Get ElevenLabs voice settings based on mood
   */
  getVoiceSettingsForMood(mood) {
    const settings = {
      neutral: { stability: 0.5, similarity_boost: 0.75 },
      happy: { stability: 0.4, similarity_boost: 0.8 },
      love: { stability: 0.6, similarity_boost: 0.8 },
      sad: { stability: 0.7, similarity_boost: 0.6 },
    };
    return settings[mood] || settings.neutral;
  }

  /**
   * Main speak method - always uses ElevenLabs for consistent voice
   */
  async speak(text, options = {}) {
    const { mood = 'neutral', onEnd = null } = options;

    // Always use ElevenLabs for consistent, natural voice
    // Web Speech API is only used for STT (speech recognition)
    await this.speakElevenLabs(text, mood);
    if (onEnd) onEnd();
  }

  // ── Speech Recognition ─────────────────────────────────────────────────────

  initSpeechRecognition() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('[Voice] Speech recognition not supported');
      return;
    }

    this.speechRecognition = new SpeechRecognition();
    this.speechRecognition.continuous = false;
    this.speechRecognition.interimResults = false;
    this.speechRecognition.lang = 'en-US';

    this.speechRecognition.onresult = this.handleSpeechResult;
    this.speechRecognition.onerror = this.handleSpeechError;
    this.speechRecognition.onend = this.handleSpeechEnd;
  }

  startListening() {
    if (!this.speechRecognition) return;
    if (this.isListening) return;
    if (this.isSpeaking) return; // Don't listen while speaking

    try {
      this.speechRecognition.start();
      this.isListening = true;
      console.log('[Voice] Speech recognition started');
    } catch (e) {
      console.error('[Voice] Failed to start recognition:', e.message);
      this.isListening = false;

      // If recognition failed, try recreating the speech recognition object
      if (e.message?.includes('already started') || e.name === 'InvalidStateError') {
        console.log('[Voice] Recreating speech recognition object...');
        this.initSpeechRecognition();
        // Retry after a short delay
        setTimeout(() => {
          if (this.isWaitingForInput() && !this.isSpeaking) {
            this.startListening();
          }
        }, 500);
      }
    }
  }

  stopListening() {
    if (!this.speechRecognition) return;
    if (!this.isListening) return;

    try {
      this.speechRecognition.stop();
      this.isListening = false;
    } catch (e) {
      // Ignore errors when stopping
    }
  }

  async handleSpeechResult(event) {
    const transcript = event.results[0][0].transcript.toLowerCase().trim();
    console.log(`[Voice] Heard: "${transcript}"`);
    this.isListening = false;

    // Barge-in: if user speaks while Maya is speaking, interrupt her
    if (this.isSpeaking) {
      console.log('[Voice] Barge-in detected - interrupting speech');
      this.bargeIn();
    }

    // Await processing to prevent race conditions with state transitions
    await this.processSpeechInput(transcript);
  }

  /**
   * Handle barge-in: user interrupted Maya while she was speaking
   * Stops current TTS playback immediately
   */
  bargeIn() {
    // Stop ElevenLabs audio
    if (this.currentAudioSource) {
      try {
        this.currentAudioSource.stop();
      } catch (e) { /* ignore */ }
      this.currentAudioSource = null;
    }

    // Abort any in-flight TTS requests
    if (this.ttsAbortController) {
      this.ttsAbortController.abort();
      this.ttsAbortController = null;
    }

    // Cancel Web Speech TTS (fallback)
    this.speechSynthesis.cancel();

    this.isSpeaking = false;
    if (this.onSpeakEnd) this.onSpeakEnd();
  }

  handleSpeechError(event) {
    this.isListening = false;

    // Don't log errors for intentional aborts, especially in ended/idle states
    if (event.error === 'aborted') {
      // Only log if we're in an active state (helps with debugging, but not noise at end)
      if (this.state !== VoiceState.ENDED && this.state !== VoiceState.IDLE) {
        console.log('[Voice] Recognition aborted (intentional stop)');
      }
      return; // Don't try to restart after abort
    }

    console.error(`[Voice] Speech error: ${event.error} (state: ${this.state}, isSpeaking: ${this.isSpeaking})`);

    switch (event.error) {
      case 'no-speech':
        // No speech detected - restart if we're waiting for input and not speaking
        if (this.isWaitingForInput() && !this.isSpeaking) {
          setTimeout(() => {
            if (this.isWaitingForInput() && !this.isSpeaking && !this.isListening) {
              this.startListening();
            }
          }, 500);
        }
        break;

      case 'audio-capture':
        this.speak("I can't hear you. Please check your microphone.", { quick: true });
        break;

      case 'not-allowed':
        this.speak("Microphone access was denied.", { quick: true });
        break;

      default:
        if (this.isWaitingForInput() && !this.isSpeaking) {
          setTimeout(() => {
            if (this.isWaitingForInput() && !this.isSpeaking && !this.isListening) {
              this.startListening();
            }
          }, 1000);
        }
    }
  }

  handleSpeechEnd() {
    console.log(`[Voice] Speech recognition ended (state: ${this.state}, isSpeaking: ${this.isSpeaking})`);
    this.isListening = false;

    // Only restart if we're in a waiting state AND not speaking
    // The delay helps avoid rapid start/stop cycles
    if (this.isWaitingForInput() && !this.isSpeaking) {
      setTimeout(() => {
        // Double-check conditions before restarting (state may have changed)
        if (this.isWaitingForInput() && !this.isSpeaking && !this.isListening) {
          this.startListening();
        }
      }, 300);
    }
  }

  isWaitingForInput() {
    // Never wait for input if session has ended
    if (this.state === VoiceState.ENDED || this.state === VoiceState.IDLE) {
      return false;
    }
    return [
      VoiceState.WAITING_START,
      VoiceState.WAITING_SELECTION,
      VoiceState.WAITING_DONE,
      VoiceState.WAITING_MORE,
    ].includes(this.state);
  }

  // ── State Machine ──────────────────────────────────────────────────────────

  async transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    console.log(`[Voice] State: ${oldState} → ${newState}`);

    if (this.onStateChange) {
      this.onStateChange(newState, oldState);
    }

    // Handle state entry
    switch (newState) {
      case VoiceState.GREETING:
        await this.handleGreeting();
        break;

      case VoiceState.WAITING_START:
        // Small delay after speaking to ensure recognition API is ready
        setTimeout(() => this.startListening(), 100);
        break;

      case VoiceState.MENU:
        await this.handleMenu();
        break;

      case VoiceState.WAITING_SELECTION:
        // Small delay after speaking to ensure recognition API is ready
        setTimeout(() => this.startListening(), 100);
        break;

      case VoiceState.EXERCISE_ACTIVE:
        await this.handleExerciseActive();
        break;

      case VoiceState.COMPLETION_CHECK:
        await this.handleCompletionCheck();
        break;

      case VoiceState.WAITING_DONE:
        // Small delay after speaking to ensure recognition API is ready
        setTimeout(() => this.startListening(), 100);
        break;

      case VoiceState.REPORT:
        await this.handleReport();
        break;

      case VoiceState.WAITING_MORE:
        // Small delay after speaking to ensure recognition API is ready
        setTimeout(() => this.startListening(), 100);
        break;

      case VoiceState.ENDED:
        await this.handleEnded();
        break;
    }
  }

  // ── State Handlers (with LLM integration) ─────────────────────────────────

  async handleGreeting() {
    if (this.useLLM) {
      if (this.onThinkingStart) this.onThinkingStart();
      const response = await generateResponse(this.sessionContext, '__greeting__');
      if (this.onThinkingEnd) this.onThinkingEnd();
      await this.speak(response.cleanText, { mood: response.mood });
    } else {
      await this.speak("Would you like to exercise today?");
    }
    this.transitionTo(VoiceState.WAITING_START);
  }

  async handleMenu() {
    if (this.useLLM) {
      if (this.onThinkingStart) this.onThinkingStart();
      const response = await generateResponse(this.sessionContext, '__menu__');
      if (this.onThinkingEnd) this.onThinkingEnd();
      await this.speak(response.cleanText, { mood: response.mood });
    } else {
      await this.speak("Great! You can do squats, lunges, bicep curls, or push-ups. Which exercise would you like?");
    }
    this.transitionTo(VoiceState.WAITING_SELECTION);
  }

  async handleExerciseActive() {
    // Only speak if LLM didn't already speak about starting this exercise
    if (!this.exerciseSpokenByLLM) {
      const displayName = EXERCISE_DISPLAY_NAMES[this.activeExercise] || this.activeExercise;
      await this.speak(`Go ahead, I'll count your ${displayName}.`, { quick: true });
    }
    this.exerciseSpokenByLLM = false; // Reset flag

    this.repCount = 0;
    this.hasFirstRep = false;
    this.lastRepTime = null;
    this.sessionContext.currentExercise = this.activeExercise;
    this.sessionContext.currentReps = 0;
    this.sessionContext.lastRepTime = null;

    this.resetIdleTimer(this.initialTimeoutMs);

    if (this.onExerciseStart) {
      this.onExerciseStart(this.activeExercise);
    }
  }

  async handleCompletionCheck() {
    this.clearIdleTimer();

    if (this.useLLM) {
      if (this.onThinkingStart) this.onThinkingStart();
      const response = await generateResponse(this.sessionContext, '__completion_check__');
      if (this.onThinkingEnd) this.onThinkingEnd();
      await this.speak(response.cleanText, { mood: response.mood });
    } else {
      await this.speak("Are you done?");
    }
    this.transitionTo(VoiceState.WAITING_DONE);
  }

  async handleReport() {
    // Record completed exercise
    this.sessionContext.exercisesCompleted.push({
      exercise: this.activeExercise,
      reps: this.repCount,
      duration: this.lastRepTime ? this.lastRepTime - this.sessionContext.sessionStartTime : 0,
    });

    if (this.onExerciseEnd) {
      this.onExerciseEnd();
    }

    if (this.useLLM) {
      if (this.onThinkingStart) this.onThinkingStart();
      const response = await generateResponse(this.sessionContext, '__report__');
      if (this.onThinkingEnd) this.onThinkingEnd();
      await this.speak(response.cleanText, { mood: response.mood });
    } else {
      const exerciseName = EXERCISE_DISPLAY_NAMES[this.activeExercise] || this.activeExercise;
      await this.speak(`You completed ${this.repCount} ${exerciseName}. Would you like to do another exercise?`);
    }

    // Clear current exercise from context
    this.sessionContext.currentExercise = null;
    this.sessionContext.currentReps = 0;

    this.transitionTo(VoiceState.WAITING_MORE);
  }

  async handleEnded() {
    // Guard against double farewell (can happen if user says "no" twice quickly)
    if (this.hasSpokenFarewell) {
      console.log('[Voice] Farewell already spoken, skipping duplicate');
      return;
    }
    this.hasSpokenFarewell = true;

    if (this.useLLM) {
      if (this.onThinkingStart) this.onThinkingStart();
      const response = await generateResponse(this.sessionContext, '__farewell__');
      if (this.onThinkingEnd) this.onThinkingEnd();
      await this.speak(response.cleanText, { mood: response.mood });
    } else {
      await this.speak("Great workout! See you next time.");
    }
    this.cleanup();
  }

  // ── Speech Input Processing ───────────────────────────────────────────────

  async processSpeechInput(transcript) {
    if (this.useLLM) {
      await this.processWithLLM(transcript);
    } else {
      await this.processWithPatterns(transcript);
    }
  }

  /**
   * Process speech input using Claude LLM
   */
  async processWithLLM(transcript) {
    if (this.onThinkingStart) this.onThinkingStart();
    const response = await generateResponse(this.sessionContext, transcript);
    if (this.onThinkingEnd) this.onThinkingEnd();
    const { cleanText, mood, intent, exerciseKey } = response;

    // Handle intent-based actions
    switch (intent) {
      case 'start_exercise':
        if (exerciseKey) {
          this.activeExercise = exerciseKey;
          this.exerciseSpokenByLLM = true; // Prevent handleExerciseActive from speaking again
          await this.speak(cleanText, { mood });
          this.transitionTo(VoiceState.EXERCISE_ACTIVE);
        }
        break;

      case 'show_menu':
        await this.speak(cleanText, { mood });
        // Stay in current state (waiting for selection)
        this.startListening();
        break;

      case 'confirm_yes':
        await this.handleConfirmYes(cleanText, mood);
        break;

      case 'confirm_no':
        await this.handleConfirmNo(cleanText, mood);
        break;

      case 'end_session':
        // Mark farewell as spoken so handleEnded doesn't speak again
        this.hasSpokenFarewell = true;
        await this.speak(cleanText, { mood });
        // Skip transitionTo(ENDED) which would call handleEnded and speak again
        const prevState = this.state;
        this.state = VoiceState.ENDED;
        console.log(`[Voice] State: ${prevState} → ended (via end_session intent)`);
        if (this.onStateChange) {
          this.onStateChange(VoiceState.ENDED, prevState);
        }
        this.cleanup();
        break;

      case 'continue':
        await this.speak(cleanText, { mood, quick: true });
        if (this.state === VoiceState.WAITING_DONE) {
          this.state = VoiceState.EXERCISE_ACTIVE;
          this.resetIdleTimer();
          if (this.onStateChange) {
            this.onStateChange(VoiceState.EXERCISE_ACTIVE, VoiceState.WAITING_DONE);
          }
        }
        break;

      case 'next_exercise':
        await this.speak(cleanText, { mood });
        this.transitionTo(VoiceState.MENU);
        break;

      default:
        // No clear intent - use fallback pattern matching
        await this.processWithPatterns(transcript);
        break;
    }
  }

  async handleConfirmYes(text, mood) {
    switch (this.state) {
      case VoiceState.WAITING_START:
        await this.transitionTo(VoiceState.MENU);
        break;
      case VoiceState.WAITING_DONE:
        await this.transitionTo(VoiceState.REPORT);
        break;
      case VoiceState.WAITING_MORE:
        await this.transitionTo(VoiceState.MENU);
        break;
    }
  }

  async handleConfirmNo(text, mood) {
    switch (this.state) {
      case VoiceState.WAITING_START:
        await this.transitionTo(VoiceState.ENDED);
        break;
      case VoiceState.WAITING_DONE:
        await this.speak(text || "Okay, keep going!", { mood, quick: true });
        this.state = VoiceState.EXERCISE_ACTIVE;
        this.resetIdleTimer();
        if (this.onStateChange) {
          this.onStateChange(VoiceState.EXERCISE_ACTIVE, VoiceState.WAITING_DONE);
        }
        break;
      case VoiceState.WAITING_MORE:
        await this.transitionTo(VoiceState.ENDED);
        break;
    }
  }

  /**
   * Fallback: Process speech input using pattern matching
   */
  async processWithPatterns(transcript) {
    switch (this.state) {
      case VoiceState.WAITING_START:
        if (this.matchesYes(transcript)) {
          await this.transitionTo(VoiceState.MENU);
        } else if (this.matchesNo(transcript)) {
          await this.transitionTo(VoiceState.ENDED);
        } else {
          await this.speak("Sorry, I didn't catch that. Would you like to exercise today? Say yes or no.", { quick: true });
          await this.transitionTo(VoiceState.WAITING_START);
        }
        break;

      case VoiceState.WAITING_SELECTION:
        const exercise = this.matchExercise(transcript);
        if (exercise) {
          this.activeExercise = exercise;
          await this.transitionTo(VoiceState.EXERCISE_ACTIVE);
        } else {
          await this.speak("I didn't recognize that exercise. You can say squats, lunges, bicep curls, or push-ups.", { quick: true });
          await this.transitionTo(VoiceState.WAITING_SELECTION);
        }
        break;

      case VoiceState.WAITING_DONE:
        if (this.matchesYes(transcript)) {
          await this.transitionTo(VoiceState.REPORT);
        } else if (this.matchesNo(transcript)) {
          await this.speak("Okay, keep going!", { quick: true });
          this.state = VoiceState.EXERCISE_ACTIVE;
          this.resetIdleTimer();
          if (this.onStateChange) {
            this.onStateChange(VoiceState.EXERCISE_ACTIVE, VoiceState.WAITING_DONE);
          }
        } else {
          await this.speak("Say yes if you're done, or no to continue.", { quick: true });
          await this.transitionTo(VoiceState.WAITING_DONE);
        }
        break;

      case VoiceState.WAITING_MORE:
        if (this.matchesYes(transcript)) {
          await this.transitionTo(VoiceState.MENU);
        } else if (this.matchesNo(transcript)) {
          await this.transitionTo(VoiceState.ENDED);
        } else {
          await this.speak("Would you like to do another exercise? Say yes or no.", { quick: true });
          await this.transitionTo(VoiceState.WAITING_MORE);
        }
        break;
    }
  }

  // ── Pattern Matching ───────────────────────────────────────────────────────

  matchesYes(transcript) {
    return YES_PATTERNS.some(p => transcript.includes(p));
  }

  matchesNo(transcript) {
    return NO_PATTERNS.some(p => transcript.includes(p));
  }

  matchExercise(transcript) {
    for (const [alias, key] of Object.entries(EXERCISE_MAP)) {
      if (transcript.includes(alias)) {
        return key;
      }
    }
    return null;
  }

  // ── Idle Timer ─────────────────────────────────────────────────────────────

  resetIdleTimer(timeoutMs = null) {
    this.clearIdleTimer();

    const timeout = timeoutMs ?? (this.hasFirstRep ? this.idleTimeoutMs : this.initialTimeoutMs);

    this.idleTimeoutId = setTimeout(() => {
      if (this.state === VoiceState.EXERCISE_ACTIVE) {
        this.transitionTo(VoiceState.COMPLETION_CHECK);
      }
    }, timeout);
  }

  clearIdleTimer() {
    if (this.idleTimeoutId) {
      clearTimeout(this.idleTimeoutId);
      this.idleTimeoutId = null;
    }
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────

  cleanup() {
    this.stopListening();
    this.clearIdleTimer();
    this.activeExercise = null;
    this.repCount = 0;

    if (this.onExerciseEnd) {
      this.onExerciseEnd();
    }
  }

  // ── Pause/Resume (for dashboard navigation) ─────────────────────────────────

  /**
   * Pause the workflow (when navigating away from exercise section)
   * Preserves state for later resumption
   */
  pause() {
    console.log('[Voice] Pausing workflow');
    this.stopListening();
    this.clearIdleTimer();
    this.bargeIn(); // Stop any ongoing speech

    // Save state for restoration
    this.pausedState = {
      state: this.state,
      activeExercise: this.activeExercise,
      repCount: this.repCount,
      hasFirstRep: this.hasFirstRep,
      lastRepTime: this.lastRepTime,
      sessionContext: { ...this.sessionContext },
    };

    return this.pausedState;
  }

  /**
   * Resume the workflow (when returning to exercise section)
   * Restores state from pause
   */
  resume(savedState = null) {
    console.log('[Voice] Resuming workflow');

    const stateToRestore = savedState || this.pausedState;
    if (!stateToRestore) {
      console.log('[Voice] No state to restore, starting fresh');
      return;
    }

    // Restore state
    this.state = stateToRestore.state;
    this.activeExercise = stateToRestore.activeExercise;
    this.repCount = stateToRestore.repCount;
    this.hasFirstRep = stateToRestore.hasFirstRep;
    this.lastRepTime = stateToRestore.lastRepTime;
    this.sessionContext = stateToRestore.sessionContext || this.sessionContext;

    console.log(`[Voice] Restored state: ${this.state}, exercise: ${this.activeExercise}, reps: ${this.repCount}`);

    // Restart timers and listening based on state
    if (this.state === VoiceState.EXERCISE_ACTIVE) {
      this.resetIdleTimer();
    }

    if (this.isWaitingForInput()) {
      setTimeout(() => this.startListening(), 100);
    }

    // Notify state change
    if (this.onStateChange) {
      this.onStateChange(this.state, null);
    }

    // Clear paused state
    this.pausedState = null;
  }

  /**
   * Get current state for external persistence
   */
  getFullState() {
    return {
      state: this.state,
      activeExercise: this.activeExercise,
      repCount: this.repCount,
      hasFirstRep: this.hasFirstRep,
      lastRepTime: this.lastRepTime,
      sessionContext: { ...this.sessionContext },
    };
  }
}
