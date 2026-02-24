/**
 * MayaMind Exercise POC — Voice Workflow
 *
 * Voice-driven state machine for exercise selection and coaching.
 * Uses Web Speech API for both speech recognition and synthesis.
 */

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

// ── Exercise Mapping ─────────────────────────────────────────────────────────

const EXERCISE_MAP = {
  // Squats (including common misrecognitions)
  'squat': 'squat',
  'squats': 'squat',
  'chair squat': 'squat',
  'chair squats': 'squat',
  'score': 'squat',   // Common misrecognition
  'scores': 'squat',  // Common misrecognition
  'squad': 'squat',   // Common misrecognition

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

const EXERCISE_DISPLAY_NAMES = {
  squat: 'squats',
  reverse_lunge: 'lunges',
  biceps_curl: 'bicep curls',
  knee_pushup: 'push-ups',
};

// ── Pattern Matching ─────────────────────────────────────────────────────────

const YES_PATTERNS = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'yea', 'ya', 'uh huh', 'absolutely', 'definitely'];
const NO_PATTERNS = ['no', 'nope', 'nah', "don't", 'not', 'negative'];

// ── Voice Workflow Class ─────────────────────────────────────────────────────

export class VoiceWorkflow {
  constructor(options = {}) {
    this.state = VoiceState.IDLE;
    this.speechRecognition = null;
    this.speechSynthesis = window.speechSynthesis;
    this.speechInitialized = false;

    // Current exercise state
    this.activeExercise = null;
    this.repCount = 0;
    this.idleTimeoutId = null;
    this.idleTimeoutMs = options.idleTimeoutMs || 5000;
    this.initialTimeoutMs = options.initialTimeoutMs || 15000; // More time to get into position
    this.hasFirstRep = false; // Track if first rep has occurred

    // Callbacks
    this.onStateChange = options.onStateChange || null;
    this.onExerciseStart = options.onExerciseStart || null;
    this.onExerciseEnd = options.onExerciseEnd || null;
    this.onRepUpdate = options.onRepUpdate || null;

    // Listening state
    this.isListening = false;

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
    this.initSpeech();
    this.initSpeechRecognition();
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
    // Count reps during EXERCISE_ACTIVE or while asking "Are you done?"
    const countingStates = [VoiceState.EXERCISE_ACTIVE, VoiceState.COMPLETION_CHECK, VoiceState.WAITING_DONE];
    if (!countingStates.includes(this.state)) return;
    if (exerciseKey !== this.activeExercise) return;

    this.repCount++;
    this.hasFirstRep = true;

    // Reset idle timer only if actively exercising
    if (this.state === VoiceState.EXERCISE_ACTIVE) {
      this.resetIdleTimer();
    }

    // Notify callback
    if (this.onRepUpdate) {
      this.onRepUpdate(exerciseKey, this.repCount);
    }
  }

  // ── Speech Synthesis ───────────────────────────────────────────────────────

  initSpeech() {
    if (this.speechInitialized || !this.speechSynthesis) return;

    // Speak empty string to unlock (browser security)
    const unlock = new SpeechSynthesisUtterance('');
    this.speechSynthesis.speak(unlock);
    this.speechInitialized = true;
    console.log('[Voice] Speech synthesis initialized');
  }

  speak(text, onEnd = null) {
    if (!this.speechSynthesis || !this.speechInitialized) {
      console.warn('[Voice] Speech not initialized');
      if (onEnd) onEnd();
      return;
    }

    // Cancel any ongoing speech
    this.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.volume = 1.0;

    utterance.onend = () => {
      if (onEnd) onEnd();
    };

    utterance.onerror = (e) => {
      console.error('[Voice] Speech error:', e.error);
      if (onEnd) onEnd();
    };

    this.speechSynthesis.speak(utterance);
    console.log(`[Voice] Speaking: "${text}"`);
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

    console.log('[Voice] Speech recognition initialized');
  }

  startListening() {
    if (!this.speechRecognition) {
      console.warn('[Voice] Speech recognition not available');
      return;
    }

    if (this.isListening) return;

    try {
      this.speechRecognition.start();
      this.isListening = true;
    } catch (e) {
      console.error('[Voice] Failed to start recognition:', e);
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

  handleSpeechResult(event) {
    const transcript = event.results[0][0].transcript.toLowerCase().trim();
    console.log(`[Voice] Heard: "${transcript}"`);
    this.isListening = false;
    this.processSpeechInput(transcript);
  }

  handleSpeechError(event) {
    console.error('[Voice] Speech error:', event.error);
    this.isListening = false;

    switch (event.error) {
      case 'no-speech':
        // No speech detected - restart listening if waiting for input
        if (this.isWaitingForInput()) {
          setTimeout(() => this.startListening(), 500);
        }
        break;

      case 'audio-capture':
        this.speak("I can't hear you. Please check your microphone.");
        break;

      case 'not-allowed':
        this.speak("Microphone access was denied. Please enable it in your browser settings.");
        break;

      default:
        // Retry after brief delay
        if (this.isWaitingForInput()) {
          setTimeout(() => this.startListening(), 1000);
        }
    }
  }

  handleSpeechEnd() {
    this.isListening = false;

    // Auto-restart if still waiting for input
    if (this.isWaitingForInput()) {
      setTimeout(() => this.startListening(), 300);
    }
  }

  isWaitingForInput() {
    return [
      VoiceState.WAITING_START,
      VoiceState.WAITING_SELECTION,
      VoiceState.WAITING_DONE,
      VoiceState.WAITING_MORE,
    ].includes(this.state);
  }

  // ── State Machine ──────────────────────────────────────────────────────────

  transitionTo(newState) {
    const oldState = this.state;
    this.state = newState;
    console.log(`[Voice] State: ${oldState} → ${newState}`);

    // Notify callback
    if (this.onStateChange) {
      this.onStateChange(newState, oldState);
    }

    // Handle state entry
    switch (newState) {
      case VoiceState.GREETING:
        this.speak("Would you like to exercise today?", () => {
          this.transitionTo(VoiceState.WAITING_START);
        });
        break;

      case VoiceState.WAITING_START:
        this.startListening();
        break;

      case VoiceState.MENU:
        this.speak("Great! You can do squats, lunges, bicep curls, or push-ups. Which exercise would you like?", () => {
          this.transitionTo(VoiceState.WAITING_SELECTION);
        });
        break;

      case VoiceState.WAITING_SELECTION:
        this.startListening();
        break;

      case VoiceState.EXERCISE_ACTIVE:
        const displayName = EXERCISE_DISPLAY_NAMES[this.activeExercise] || this.activeExercise;
        this.speak(`Go ahead, I'll count your ${displayName}.`);
        this.repCount = 0;
        this.hasFirstRep = false;
        // Use longer initial timeout to give user time to get into position
        this.resetIdleTimer(this.initialTimeoutMs);

        // Notify exercise start
        if (this.onExerciseStart) {
          this.onExerciseStart(this.activeExercise);
        }
        break;

      case VoiceState.COMPLETION_CHECK:
        this.clearIdleTimer();
        this.speak("Are you done?", () => {
          this.transitionTo(VoiceState.WAITING_DONE);
        });
        break;

      case VoiceState.WAITING_DONE:
        this.startListening();
        break;

      case VoiceState.REPORT:
        // End exercise
        if (this.onExerciseEnd) {
          this.onExerciseEnd();
        }

        const reps = this.repCount;
        const plural = reps === 1 ? '' : 's';
        const exerciseName = EXERCISE_DISPLAY_NAMES[this.activeExercise] || this.activeExercise;
        this.speak(`You completed ${reps} ${exerciseName}. Would you like to do another exercise?`, () => {
          this.transitionTo(VoiceState.WAITING_MORE);
        });
        break;

      case VoiceState.WAITING_MORE:
        this.startListening();
        break;

      case VoiceState.ENDED:
        this.speak("Great workout! See you next time.");
        this.cleanup();
        break;
    }
  }

  processSpeechInput(transcript) {
    switch (this.state) {
      case VoiceState.WAITING_START:
        if (this.matchesYes(transcript)) {
          this.transitionTo(VoiceState.MENU);
        } else if (this.matchesNo(transcript)) {
          this.transitionTo(VoiceState.ENDED);
        } else {
          this.speak("Sorry, I didn't catch that. Would you like to exercise today? Say yes or no.", () => {
            this.transitionTo(VoiceState.WAITING_START);
          });
        }
        break;

      case VoiceState.WAITING_SELECTION:
        const exercise = this.matchExercise(transcript);
        if (exercise) {
          this.activeExercise = exercise;
          this.transitionTo(VoiceState.EXERCISE_ACTIVE);
        } else {
          this.speak("I didn't recognize that exercise. You can say squats, lunges, bicep curls, or push-ups.", () => {
            this.transitionTo(VoiceState.WAITING_SELECTION);
          });
        }
        break;

      case VoiceState.WAITING_DONE:
        if (this.matchesYes(transcript)) {
          this.transitionTo(VoiceState.REPORT);
        } else if (this.matchesNo(transcript)) {
          this.speak("Okay, keep going!");
          // Resume exercise without resetting state - just restart idle timer
          this.state = VoiceState.EXERCISE_ACTIVE;
          this.resetIdleTimer(); // Will use short timeout since hasFirstRep is true
          if (this.onStateChange) {
            this.onStateChange(VoiceState.EXERCISE_ACTIVE, VoiceState.WAITING_DONE);
          }
        } else {
          this.speak("Say yes if you're done, or no to continue.", () => {
            this.transitionTo(VoiceState.WAITING_DONE);
          });
        }
        break;

      case VoiceState.WAITING_MORE:
        if (this.matchesYes(transcript)) {
          this.transitionTo(VoiceState.MENU);
        } else if (this.matchesNo(transcript)) {
          this.transitionTo(VoiceState.ENDED);
        } else {
          this.speak("Would you like to do another exercise? Say yes or no.", () => {
            this.transitionTo(VoiceState.WAITING_MORE);
          });
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
    // Check each alias
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

    // Use provided timeout, or default based on whether first rep has occurred
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
}
