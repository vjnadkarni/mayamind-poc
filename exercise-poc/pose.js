/**
 * MayaMind Exercise POC — MediaPipe Pose Integration
 *
 * Captures webcam feed, runs MediaPipe Pose Landmarker,
 * draws skeleton overlay, displays real-time joint angles,
 * counts squat reps, and records data for export.
 */

import {
  SKELETON_CONNECTIONS,
  LANDMARKS,
  calculateJointAngles,
  AngleSmoother,
} from './joints.js';

import { formatAngle } from './utils.js';
import { SquatDetector, Orientation } from './exercises/squat.js';
import { BicepsCurlDetector } from './exercises/bicepsCurl.js';
import { LungeDetector } from './exercises/lunge.js';
import { PushupDetector } from './exercises/pushup.js';
import { DataRecorder } from './recorder.js';
import {
  ExerciseDetector,
  TemplateRecorder,
  getTemplateStore,
  ExerciseType,
  DetectionState,
} from './similarity/index.js';
import {
  initAudio,
  countdownBeep,
  startBeep,
  completeBeep,
} from './audio.js';
import { VoiceWorkflow, VoiceState } from './voice.js';

// ── Speech Synthesis for Exercise Announcements ───────────────────────────────
let lastAnnouncedExercise = null;
let speechSynthesis = window.speechSynthesis;
let speechInitialized = false;

const EXERCISE_NAMES = {
  squat: 'Squat',
  reverse_lunge: 'Reverse lunge',
  biceps_curl: 'Biceps curl',
  knee_pushup: 'Push-up',
};

/**
 * Initialize speech synthesis (must be called after user interaction)
 */
function initSpeech() {
  if (speechInitialized || !speechSynthesis) return;

  // Speak empty string to unlock speech synthesis (browser security)
  const unlock = new SpeechSynthesisUtterance('');
  speechSynthesis.speak(unlock);
  speechInitialized = true;
  console.log('[Speech] Initialized');
}

function announceExercise(exerciseType) {
  if (!speechSynthesis || !speechInitialized) {
    console.warn('[Speech] Not initialized, skipping announcement');
    return;
  }

  const name = EXERCISE_NAMES[exerciseType] || exerciseType;
  if (name === lastAnnouncedExercise) return; // Don't repeat

  lastAnnouncedExercise = name;

  // Cancel any ongoing speech
  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(name);
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  utterance.onerror = (e) => {
    console.error('[Speech] Error:', e.error);
  };

  speechSynthesis.speak(utterance);
  console.log(`[Speech] Announced: ${name}`);
}

function announceNoneDetected() {
  if (!speechSynthesis || !speechInitialized) return;
  if (lastAnnouncedExercise === 'None detected') return; // Don't repeat

  lastAnnouncedExercise = 'None detected';

  speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance('None detected');
  utterance.rate = 1.0;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  utterance.onerror = (e) => {
    console.error('[Speech] Error:', e.error);
  };

  speechSynthesis.speak(utterance);
  console.log('[Speech] Announced: None detected');
}

// ── DOM Elements ─────────────────────────────────────────────────────────────
const videoEl = document.getElementById('video');
const canvasEl = document.getElementById('overlay');
const ctx = canvasEl.getContext('2d');
const startBtn = document.getElementById('start-btn');
const stopBtn = document.getElementById('stop-btn');
const resetBtn = document.getElementById('reset-btn');
const statusEl = document.getElementById('status');
const fpsEl = document.getElementById('fps');
const idleTimerEl = document.getElementById('idle-timer');

// Recording controls
const recordBtn = document.getElementById('record-btn');
const downloadBtn = document.getElementById('download-btn');
const recordStatusEl = document.getElementById('record-status');

// Squat counter elements (legacy)
const squatStateEl = document.getElementById('squat-state');
const orientationEl = document.getElementById('orientation');

// Per-exercise rep count elements
const exerciseRepEls = {
  squat: document.getElementById('reps-squat'),
  reverse_lunge: document.getElementById('reps-reverse_lunge'),
  biceps_curl: document.getElementById('reps-biceps_curl'),
  knee_pushup: document.getElementById('reps-knee_pushup'),
};

// Per-exercise rep counts (cumulative)
const exerciseReps = {
  squat: 0,
  reverse_lunge: 0,
  biceps_curl: 0,
  knee_pushup: 0,
};

// Idle timer state
let lastExerciseTime = 0;
let idleCheckInterval = null;
const IDLE_TIMEOUT_MS = 60000; // 1 minute

// Angle display elements
const angleEls = {
  leftKnee: document.getElementById('angle-left-knee'),
  rightKnee: document.getElementById('angle-right-knee'),
  leftHip: document.getElementById('angle-left-hip'),
  rightHip: document.getElementById('angle-right-hip'),
  leftElbow: document.getElementById('angle-left-elbow'),
  rightElbow: document.getElementById('angle-right-elbow'),
  leftShoulder: document.getElementById('angle-left-shoulder'),
  rightShoulder: document.getElementById('angle-right-shoulder'),
};

// Template recording elements
const templateTypeEl = document.getElementById('template-type');
const templateNameEl = document.getElementById('template-name');
const templateRecordBtn = document.getElementById('template-record-btn');
const templateExportBtn = document.getElementById('template-export-btn');
const templateStatusEl = document.getElementById('template-status');
const templateListEl = document.getElementById('template-list');
const templateCountEl = document.getElementById('template-count');

// Detection display elements
const detectedExerciseEl = document.getElementById('detected-exercise');
const detectionConfidenceEl = document.getElementById('detection-confidence-value');
const confidenceFillEl = document.getElementById('confidence-fill');
const detectionStateEl = document.getElementById('detection-state');

// Countdown overlay elements
const countdownOverlayEl = document.getElementById('countdown-overlay');
const countdownNumberEl = document.getElementById('countdown-number');
const countdownLabelEl = document.getElementById('countdown-label');

// ── State ────────────────────────────────────────────────────────────────────
let poseLandmarker = null;
let stream = null;
let isRunning = false;
let lastFrameTime = 0;
let frameCount = 0;
let fpsUpdateTime = 0;

// Angle smoother (alpha=0.3 gives moderate smoothing)
const angleSmoother = new AngleSmoother(0.3);

// Squat detector
const squatDetector = new SquatDetector({
  onRepComplete: (repData) => {
    // Voice workflow mode: notify workflow if squat is active
    if (voiceWorkflow.activeExercise === 'squat') {
      exerciseReps.squat++;
      updateExerciseRepDisplay('squat');
      updateRepDisplay(repData);
      console.log(`[Reps] squat: ${exerciseReps.squat}`);
      voiceWorkflow.onRepCompleted('squat');
    }
    lastExerciseTime = Date.now();
  },
  onStateChange: (newState, oldState) => {
    updateSquatStateDisplay(newState);
  },
  onOrientationChange: (newOrientation, oldOrientation) => {
    updateOrientationDisplay(newOrientation);
  },
});

// Biceps curl detector
const bicepsCurlDetector = new BicepsCurlDetector({
  onRepComplete: (repData) => {
    // Voice workflow mode: notify workflow if biceps curl is active
    if (voiceWorkflow.activeExercise === 'biceps_curl') {
      exerciseReps.biceps_curl++;
      updateExerciseRepDisplay('biceps_curl');
      console.log(`[Reps] biceps_curl: ${exerciseReps.biceps_curl} (ROM: ${repData.rangeOfMotion}°)`);
      voiceWorkflow.onRepCompleted('biceps_curl');
    }
    lastExerciseTime = Date.now();
  },
});

// Lunge detector
const lungeDetector = new LungeDetector({
  onRepComplete: (repData) => {
    // Voice workflow mode: notify workflow if lunge is active
    if (voiceWorkflow.activeExercise === 'reverse_lunge') {
      exerciseReps.reverse_lunge++;
      updateExerciseRepDisplay('reverse_lunge');
      console.log(`[Reps] reverse_lunge: ${exerciseReps.reverse_lunge} (leg: ${repData.activeLeg})`);
      voiceWorkflow.onRepCompleted('reverse_lunge');
    }
    lastExerciseTime = Date.now();
  },
});

// Push-up detector
const pushupDetector = new PushupDetector({
  onRepComplete: (repData) => {
    // Voice workflow mode: notify workflow if pushup is active
    if (voiceWorkflow.activeExercise === 'knee_pushup') {
      exerciseReps.knee_pushup++;
      updateExerciseRepDisplay('knee_pushup');
      console.log(`[Reps] knee_pushup: ${exerciseReps.knee_pushup} (depth: ${repData.depthScore}%)`);
      voiceWorkflow.onRepCompleted('knee_pushup');
    }
    lastExerciseTime = Date.now();
  },
});

// Voice workflow for exercise selection
const voiceWorkflow = new VoiceWorkflow({
  idleTimeoutMs: 5000,
  useLLM: true, // Enable conversational LLM mode
  onStateChange: (newState, oldState) => {
    updateVoiceStatusDisplay(newState);
  },
  onSpeakStart: () => {
    // Show speaking indicator, hide others
    if (speakingIndicatorEl) speakingIndicatorEl.classList.remove('hidden');
    if (micIndicatorEl) micIndicatorEl.classList.add('hidden');
    if (thinkingIndicatorEl) thinkingIndicatorEl.classList.add('hidden');
  },
  onSpeakEnd: () => {
    // Hide speaking indicator
    if (speakingIndicatorEl) speakingIndicatorEl.classList.add('hidden');
  },
  onThinkingStart: () => {
    // Show thinking indicator, hide others
    if (thinkingIndicatorEl) thinkingIndicatorEl.classList.remove('hidden');
    if (micIndicatorEl) micIndicatorEl.classList.add('hidden');
    if (speakingIndicatorEl) speakingIndicatorEl.classList.add('hidden');
  },
  onThinkingEnd: () => {
    // Hide thinking indicator
    if (thinkingIndicatorEl) thinkingIndicatorEl.classList.add('hidden');
  },
  onExerciseStart: (exerciseKey) => {
    console.log(`[Voice] Exercise started: ${exerciseKey}`);
    // Reset the detector for the selected exercise
    switch (exerciseKey) {
      case 'squat':
        squatDetector.reset();
        break;
      case 'reverse_lunge':
        lungeDetector.reset();
        break;
      case 'biceps_curl':
        bicepsCurlDetector.reset();
        break;
      case 'knee_pushup':
        pushupDetector.reset();
        break;
    }
    updateVoiceExerciseDisplay(exerciseKey);
    updateVoiceRepDisplay(0);
  },
  onExerciseEnd: () => {
    console.log('[Voice] Exercise ended');
    updateVoiceExerciseDisplay(null);
  },
  onRepUpdate: (exerciseKey, count) => {
    updateVoiceRepDisplay(count);
  },
});

// Data recorder (100 MB limit)
const dataRecorder = new DataRecorder({
  maxSizeBytes: 100 * 1024 * 1024,
  onMaxSizeReached: (size) => {
    recordBtn.textContent = 'Start Recording';
    recordBtn.classList.remove('recording');
    downloadBtn.disabled = false;
    recordStatusEl.textContent = `Max size reached (${dataRecorder.getEstimatedSizeFormatted()}). Recording stopped.`;
    recordStatusEl.style.color = '#ff9800';
  },
});

// Template store and recorder
const templateStore = getTemplateStore();

const templateRecorder = new TemplateRecorder({
  templateStore,
  countdownSeconds: 5,   // 5 second countdown to get into position
  recordDuration: 10000, // 10 seconds of recording then auto-stop
  onCountdown: ({ remaining, phase }) => {
    // Show large countdown overlay
    countdownOverlayEl.classList.add('visible');
    countdownOverlayEl.classList.remove('recording');
    countdownNumberEl.textContent = remaining;
    countdownLabelEl.textContent = 'Get Ready';
    // Play countdown beep (5, 4, 3, 2, 1)
    countdownBeep();
    // Also update button/status
    templateRecordBtn.textContent = `Cancel`;
    templateRecordBtn.classList.add('recording');
    templateStatusEl.textContent = `Get into position!`;
    templateStatusEl.style.color = '#ff9800';
  },
  onRecordingStart: ({ exerciseType, recordDuration }) => {
    // Play start beep (long beep at 0)
    startBeep();
    // Switch overlay to recording mode
    countdownOverlayEl.classList.add('recording');
    countdownNumberEl.textContent = Math.round(recordDuration / 1000);
    countdownLabelEl.textContent = 'Recording';
    // Update button/status
    templateRecordBtn.textContent = 'Cancel';
    templateStatusEl.textContent = `Recording ${exerciseType}...`;
    templateStatusEl.style.color = '#ff9800';
  },
  onRecordingStop: ({ saved, template, duration, frameCount }) => {
    // Hide countdown overlay
    countdownOverlayEl.classList.remove('visible', 'recording');
    // Update button/status
    templateRecordBtn.textContent = 'Record Template';
    templateRecordBtn.classList.remove('recording');
    if (saved && template) {
      // Play double beep for successful recording
      completeBeep();
      templateStatusEl.textContent = `Saved: ${frameCount} frames (${(duration/1000).toFixed(1)}s)`;
      templateStatusEl.style.color = '#4caf50';
      refreshTemplateList();
      exerciseDetector.refreshTemplates();
    } else {
      templateStatusEl.textContent = 'Recording cancelled or too short';
      templateStatusEl.style.color = '#888';
    }
  },
  onFrameRecorded: ({ frameCount, duration }) => {
    // Update countdown number during recording
    const remaining = Math.max(0, Math.ceil((templateRecorder.recordDuration - duration) / 1000));
    countdownNumberEl.textContent = remaining;
    templateStatusEl.textContent = `Recording: ${frameCount} frames`;
  },
});

// Exercise tracking state
// DTW identifies which exercise is being performed, angle-based detectors count reps
let currentExerciseForReps = null;  // Confirmed exercise (after first rep)
let candidateExercise = null;       // Exercise DTW thinks is being done (stable)
let repConfirmedForExercise = false; // Has at least one rep been completed?

// Classification stability tracking with hysteresis
// Require many consecutive frames before switching candidateExercise
let currentBestMatch = null;        // Current frame's DTW best match
let consecutiveBestMatchCount = 0;  // How many frames in a row with same best match
const STABILITY_FRAMES_TO_ENTER = 15;  // Frames to set initial candidateExercise (~500ms at 30fps)
const STABILITY_FRAMES_TO_SWITCH = 45; // Frames to switch AWAY from current exercise (~1.5s) - high hysteresis

// Exercise detector - uses DTW to identify which exercise is being performed
// Rep counting is handled by the angle-based detectors (SquatDetector, BicepsCurlDetector, etc.)
const exerciseDetector = new ExerciseDetector({
  templateStore,
  matchThreshold: 2.5, // Lenient matching for exercise classification
  onExerciseDetected: () => {
    // Reset idle timer when exercise detected
    lastExerciseTime = Date.now();
    updateIdleDisplay(0);

    // Note: candidateExercise is now managed in onMatchUpdate with stability tracking
    // This callback is just for logging and idle timer reset
  },
  onStateChange: (newState, prevState) => {
    updateDetectionStateDisplay(newState);

    // When going from MATCHED to IDLE, reset tracking
    if (prevState === DetectionState.MATCHED && newState === DetectionState.IDLE) {
      // Only announce "None detected" if we had confirmed an exercise
      if (currentExerciseForReps) {
        announceNoneDetected();
      }

      // Reset exercise tracking state
      candidateExercise = null;
      currentExerciseForReps = null;
      repConfirmedForExercise = false;

      // Reset classification stability tracking
      currentBestMatch = null;
      consecutiveBestMatchCount = 0;

      // Reset all detectors when user stops exercising
      squatDetector.reset();
      bicepsCurlDetector.reset();
      lungeDetector.reset();
      pushupDetector.reset();
    }

    // Update active highlighting
    updateActiveExerciseHighlight(currentExerciseForReps);
  },
  onMatchUpdate: ({ best, smoothedConfidence, state }) => {
    updateDetectionDisplay(best, smoothedConfidence, state);

    // Track classification stability with hysteresis
    if (best) {
      if (best.exerciseType === currentBestMatch) {
        consecutiveBestMatchCount++;
      } else {
        currentBestMatch = best.exerciseType;
        consecutiveBestMatchCount = 1;
      }

      // Hysteresis: easier to enter (set initial), harder to switch away
      const framesRequired = candidateExercise === null
        ? STABILITY_FRAMES_TO_ENTER   // No exercise yet - use lower threshold
        : STABILITY_FRAMES_TO_SWITCH; // Already have exercise - require more frames to switch

      // Only switch candidateExercise after sufficient stable classification
      if (consecutiveBestMatchCount >= framesRequired &&
          candidateExercise !== currentBestMatch) {
        candidateExercise = currentBestMatch;
        repConfirmedForExercise = false;

        // NOTE: We deliberately DO NOT reset detectors on exercise change.
        // Let them maintain state - they just won't count reps if the exercise doesn't match.
        // This prevents mid-rep resets when classification flickers.
      }
    }

  },
});

/**
 * Update rep count display for a specific exercise
 */
function updateExerciseRepDisplay(exerciseType) {
  const el = exerciseRepEls[exerciseType];
  if (el) {
    el.textContent = exerciseReps[exerciseType];
  }
}

// Voice UI elements
const voiceStatusEl = document.getElementById('voice-status');
const voiceExerciseEl = document.getElementById('voice-exercise');
const voiceRepsEl = document.getElementById('voice-reps');
const micIndicatorEl = document.getElementById('mic-indicator');
const thinkingIndicatorEl = document.getElementById('thinking-indicator');
const speakingIndicatorEl = document.getElementById('speaking-indicator');

const VOICE_STATE_LABELS = {
  idle: 'Waiting...',
  greeting: 'Speaking...',
  waiting_start: 'Listening...',
  menu: 'Speaking...',
  waiting_selection: 'Listening...',
  exercise_active: 'Counting reps...',
  completion_check: 'Speaking...',
  waiting_done: 'Listening...',
  report: 'Speaking...',
  waiting_more: 'Listening...',
  ended: 'Session ended',
};

function updateVoiceStatusDisplay(state) {
  if (voiceStatusEl) {
    voiceStatusEl.textContent = VOICE_STATE_LABELS[state] || state;
  }
  // Show/hide mic indicator based on listening states
  const isListening = ['waiting_start', 'waiting_selection', 'waiting_done', 'waiting_more'].includes(state);
  if (micIndicatorEl) {
    micIndicatorEl.classList.toggle('hidden', !isListening);
  }
  // Hide other indicators when listening
  if (isListening) {
    if (speakingIndicatorEl) speakingIndicatorEl.classList.add('hidden');
    if (thinkingIndicatorEl) thinkingIndicatorEl.classList.add('hidden');
  }
}

const EXERCISE_DISPLAY_NAMES = {
  squat: 'Squats',
  reverse_lunge: 'Lunges',
  biceps_curl: 'Bicep Curls',
  knee_pushup: 'Push-ups',
};

function updateVoiceExerciseDisplay(exerciseKey) {
  if (voiceExerciseEl) {
    voiceExerciseEl.textContent = exerciseKey ? EXERCISE_DISPLAY_NAMES[exerciseKey] : '--';
  }
}

function updateVoiceRepDisplay(count) {
  if (voiceRepsEl) {
    voiceRepsEl.textContent = `${count} rep${count === 1 ? '' : 's'}`;
  }
}

/**
 * Update active exercise highlighting
 */
function updateActiveExerciseHighlight(activeExercise) {
  // Remove active from all
  document.querySelectorAll('.exercise-rep-row').forEach(row => {
    row.classList.remove('active');
  });

  // Add active to current
  if (activeExercise) {
    const el = exerciseRepEls[activeExercise];
    if (el && el.parentElement) {
      el.parentElement.classList.add('active');
    }
  }
}

/**
 * Update idle timer display
 */
function updateIdleDisplay(seconds) {
  if (seconds > 0) {
    idleTimerEl.style.display = 'block';
    idleTimerEl.textContent = `Idle: ${seconds}s`;
  } else {
    idleTimerEl.style.display = 'none';
  }
}

/**
 * Reset all exercise rep counts
 */
function resetAllReps() {
  for (const type of Object.keys(exerciseReps)) {
    exerciseReps[type] = 0;
    updateExerciseRepDisplay(type);
  }
  updateActiveExerciseHighlight(null);
}

/**
 * Start idle timer checking
 */
function startIdleChecker() {
  lastExerciseTime = Date.now();

  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
  }

  idleCheckInterval = setInterval(() => {
    if (!isRunning) return;

    const idleMs = Date.now() - lastExerciseTime;
    const idleSec = Math.floor(idleMs / 1000);

    updateIdleDisplay(idleSec);

    // Auto-stop after 1 minute idle
    if (idleMs >= IDLE_TIMEOUT_MS) {
      announceAutoStop();
      stopSession();
    }
  }, 1000);
}

/**
 * Stop idle timer checking
 */
function stopIdleChecker() {
  if (idleCheckInterval) {
    clearInterval(idleCheckInterval);
    idleCheckInterval = null;
  }
  updateIdleDisplay(0);
}

/**
 * Announce auto-stop
 */
function announceAutoStop() {
  if (!speechSynthesis) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance('Session ended due to inactivity');
  utterance.rate = 1.0;
  speechSynthesis.speak(utterance);
}

/**
 * Stop the exercise session
 */
function stopSession() {
  if (!isRunning) return;

  // Trigger the same logic as clicking start button when running
  startBtn.click();
}

// ── Drawing Config ───────────────────────────────────────────────────────────
const DRAW = {
  // Skeleton lines
  lineColor: 'rgba(0, 200, 255, 0.7)',
  lineWidth: 3,

  // Landmark points
  pointColor: 'rgba(255, 100, 100, 0.9)',
  pointRadius: 5,

  // Low-visibility styling
  lowVisibilityAlpha: 0.3,

  // Visibility threshold
  visibilityThreshold: 0.5,
};

// ── MediaPipe Setup ──────────────────────────────────────────────────────────

/**
 * Load the MediaPipe Pose Landmarker model
 */
async function loadPoseLandmarker() {
  setStatus('Loading MediaPipe model...', '');

  // Import MediaPipe Tasks Vision
  const { PoseLandmarker, FilesetResolver } = await import(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/+esm'
  );

  // Load the vision WASM files
  const vision = await FilesetResolver.forVisionTasks(
    'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm'
  );

  // Create Pose Landmarker
  poseLandmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath:
        'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task',
      delegate: 'GPU', // Use GPU acceleration if available
    },
    runningMode: 'VIDEO',
    numPoses: 1, // Single person for now
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputSegmentationMasks: false, // Not needed for pose
  });

  setStatus('Model loaded — click Start Camera', '');
  startBtn.disabled = false;
}

// ── Camera ───────────────────────────────────────────────────────────────────

/**
 * Start webcam capture
 */
async function startCamera() {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: 'user',
      },
      audio: false,
    });

    videoEl.srcObject = stream;

    // Wait for video metadata to load
    await new Promise((resolve) => {
      videoEl.onloadedmetadata = () => {
        // Set canvas size to match video
        canvasEl.width = videoEl.videoWidth;
        canvasEl.height = videoEl.videoHeight;
        resolve();
      };
    });

    await videoEl.play();
    return true;
  } catch (err) {
    console.error('Camera error:', err);
    setStatus(`Camera error: ${err.message}`, 'error');
    return false;
  }
}

/**
 * Stop webcam
 */
function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
  videoEl.srcObject = null;
}

// ── Detection Loop ───────────────────────────────────────────────────────────

/**
 * Main detection loop — runs on each animation frame
 */
function detectLoop(timestamp) {
  if (!isRunning) return;

  // Calculate FPS
  frameCount++;
  if (timestamp - fpsUpdateTime >= 1000) {
    fpsEl.textContent = `${frameCount} FPS`;
    frameCount = 0;
    fpsUpdateTime = timestamp;
  }

  // Run pose detection
  if (poseLandmarker && videoEl.readyState >= 2) {
    const results = poseLandmarker.detectForVideo(videoEl, timestamp);
    processResults(results, timestamp);
  }

  requestAnimationFrame(detectLoop);
}

/**
 * Process pose detection results
 */
function processResults(results, timestamp) {
  // Clear canvas
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  if (!results.landmarks || results.landmarks.length === 0) {
    // No pose detected
    updateAngleDisplay(null);
    return;
  }

  // Get first (and only) detected pose
  const landmarks2D = results.landmarks[0]; // Normalized 2D coords
  const worldLandmarks = results.worldLandmarks[0]; // 3D metric coords

  // Draw skeleton using 2D landmarks
  drawSkeleton(landmarks2D);

  // Calculate joint angles using 3D world landmarks
  const rawAngles = calculateJointAngles(worldLandmarks, DRAW.visibilityThreshold);
  const smoothedAngles = angleSmoother.update(rawAngles);

  // Update angle display
  updateAngleDisplay(smoothedAngles);

  // ═══════════════════════════════════════════════════════════════════════════
  // VOICE WORKFLOW MODE: Update detector based on voice-selected exercise
  // ═══════════════════════════════════════════════════════════════════════════

  const activeExercise = voiceWorkflow.activeExercise;

  // Debug: Log detector state periodically when exercise is active
  if (activeExercise && frameCount % 30 === 0) {  // Every ~1 second at 30fps
    const status = activeExercise === 'squat' ? squatDetector.getStatus() :
                   activeExercise === 'biceps_curl' ? bicepsCurlDetector.getStatus() :
                   activeExercise === 'reverse_lunge' ? lungeDetector.getStatus() :
                   pushupDetector.getStatus();

    // Detailed debug for squat - show angles, visibility, and orientation
    if (activeExercise === 'squat') {
      const hipL = smoothedAngles?.leftHip;
      const hipR = smoothedAngles?.rightHip;
      const kneeL = smoothedAngles?.leftKnee;
      const kneeR = smoothedAngles?.rightKnee;

      const isFrontal = status.orientation === 'frontal' || status.orientation === 'unknown';
      const standingHipThreshold = isFrontal ? '145' : '155';
      const standingKneeThreshold = isFrontal ? '135' : '155';

      console.log(`[Squat Debug] State: ${status.state} | Orientation: ${status.orientation}`);
      console.log(`  Hip  L: ${hipL?.angle?.toFixed(0) || '--'}° (vis: ${hipL?.visibility?.toFixed(2) || '--'}) | R: ${hipR?.angle?.toFixed(0) || '--'}° (vis: ${hipR?.visibility?.toFixed(2) || '--'})`);
      console.log(`  Knee L: ${kneeL?.angle?.toFixed(0) || '--'}° (vis: ${kneeL?.visibility?.toFixed(2) || '--'}) | R: ${kneeR?.angle?.toFixed(0) || '--'}° (vis: ${kneeR?.visibility?.toFixed(2) || '--'})`);
      console.log(`  Standing threshold: Hip > ${standingHipThreshold}°, Knee > ${standingKneeThreshold}° | Bottom: Hip < 120° OR Knee < 120°`);
    } else {
      console.log(`[Debug] Exercise: ${activeExercise}, State: ${status.state}, KneeL: ${smoothedAngles?.leftKnee?.angle?.toFixed(0) || '--'}°, KneeR: ${smoothedAngles?.rightKnee?.angle?.toFixed(0) || '--'}°`);
    }
  }

  if (activeExercise === 'squat') {
    squatDetector.update(smoothedAngles, timestamp, landmarks2D);
  } else if (activeExercise === 'biceps_curl') {
    bicepsCurlDetector.update(smoothedAngles, timestamp);
  } else if (activeExercise === 'reverse_lunge') {
    lungeDetector.update(smoothedAngles, timestamp);
  } else if (activeExercise === 'knee_pushup') {
    pushupDetector.update(smoothedAngles, timestamp);
  }

  // Record data if recording
  if (dataRecorder.isRecording && activeExercise) {
    const activeStatus =
      activeExercise === 'squat' ? squatDetector.getStatus() :
      activeExercise === 'biceps_curl' ? bicepsCurlDetector.getStatus() :
      activeExercise === 'reverse_lunge' ? lungeDetector.getStatus() :
      activeExercise === 'knee_pushup' ? pushupDetector.getStatus() : null;
    dataRecorder.record(smoothedAngles, activeStatus);
    updateRecordStatus();
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────────

/**
 * Draw skeleton overlay on canvas
 */
function drawSkeleton(landmarks) {
  if (!landmarks) return;

  const w = canvasEl.width;
  const h = canvasEl.height;

  // Helper to convert normalized coords to canvas coords
  const toCanvas = (landmark) => ({
    x: landmark.x * w,
    y: landmark.y * h,
    visibility: landmark.visibility ?? 1,
  });

  // Draw connections (lines)
  ctx.lineWidth = DRAW.lineWidth;
  ctx.lineCap = 'round';

  for (const [startIdx, endIdx] of SKELETON_CONNECTIONS) {
    const start = toCanvas(landmarks[startIdx]);
    const end = toCanvas(landmarks[endIdx]);

    // Use lower alpha if either point has low visibility
    const minVis = Math.min(start.visibility, end.visibility);
    const alpha = minVis >= DRAW.visibilityThreshold ? 1 : DRAW.lowVisibilityAlpha;

    ctx.strokeStyle = DRAW.lineColor.replace('0.7', (0.7 * alpha).toFixed(2));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }

  // Draw landmark points
  for (let i = 0; i < landmarks.length; i++) {
    // Skip face landmarks except nose (reduce clutter)
    if (i >= 1 && i <= 10) continue;

    const pt = toCanvas(landmarks[i]);
    const alpha = pt.visibility >= DRAW.visibilityThreshold ? 1 : DRAW.lowVisibilityAlpha;

    ctx.fillStyle = DRAW.pointColor.replace('0.9', (0.9 * alpha).toFixed(2));
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, DRAW.pointRadius, 0, 2 * Math.PI);
    ctx.fill();
  }
}

/**
 * Update the joint angle display panel
 * DIAGNOSTIC MODE: Shows visibility status with color coding and visibility scores
 */
function updateAngleDisplay(angles) {
  for (const [jointKey, el] of Object.entries(angleEls)) {
    if (!angles || !angles[jointKey]) {
      el.textContent = '--° (0.00)';
      el.classList.remove('low-confidence', 'visible', 'occluded');
      el.classList.add('occluded');
    } else {
      const { angle, visible, visibility } = angles[jointKey];
      const visStr = (visibility ?? 0).toFixed(2);
      if (visible && angle !== null) {
        el.textContent = `${formatAngle(angle)} (${visStr})`;
        el.classList.remove('low-confidence', 'occluded');
        el.classList.add('visible');
      } else {
        el.textContent = `--° (${visStr})`;
        el.classList.remove('low-confidence', 'visible');
        el.classList.add('occluded');
      }
    }
  }
}

/**
 * Update squat state display (called on state change)
 */
function updateSquatStateDisplay(state) {
  squatStateEl.textContent = state;
  squatStateEl.className = 'squat-state ' + state;
}

/**
 * Update last rep info (called on rep complete)
 */
function updateRepDisplay(_repData) {
  // Rep info is now shown in the exercise grid
}

/**
 * Update orientation display
 */
function updateOrientationDisplay(orientation) {
  const labels = {
    [Orientation.UNKNOWN]: 'detecting...',
    [Orientation.FRONTAL]: 'frontal view',
    [Orientation.SAGITTAL]: 'side view ✓',
    [Orientation.OBLIQUE]: '45° angle',
  };
  orientationEl.textContent = labels[orientation] || orientation;
  orientationEl.className = 'orientation-badge ' + orientation;
}

/**
 * Update recording status display
 */
function updateRecordStatus() {
  const frames = dataRecorder.getFrameCount();
  const duration = dataRecorder.getDuration().toFixed(1);
  const size = dataRecorder.getEstimatedSizeFormatted();
  recordStatusEl.textContent = `Recording: ${frames} frames (${duration}s) · ${size}`;
  recordStatusEl.style.color = ''; // Reset color
}

/**
 * Update detection display
 */
function updateDetectionDisplay(best, confidence, state) {
  if (best && state === DetectionState.MATCHED) {
    detectedExerciseEl.textContent = best.exerciseType.replace('_', ' ');
    detectedExerciseEl.classList.add('matched');
  } else if (best && state === DetectionState.DETECTING) {
    detectedExerciseEl.textContent = best.exerciseType.replace('_', ' ') + '?';
    detectedExerciseEl.classList.remove('matched');
  } else {
    detectedExerciseEl.textContent = '--';
    detectedExerciseEl.classList.remove('matched');
  }

  const confPercent = Math.max(0, Math.min(100, confidence * 100));
  detectionConfidenceEl.textContent = `${confPercent.toFixed(0)}%`;
  confidenceFillEl.style.width = `${confPercent}%`;
}

/**
 * Update detection state display
 */
function updateDetectionStateDisplay(state) {
  detectionStateEl.textContent = state;
  detectionStateEl.className = 'detection-state ' + state;
}

/**
 * Refresh the template list display
 */
function refreshTemplateList() {
  const templates = templateStore.getAll();
  templateListEl.innerHTML = '';

  for (const template of templates) {
    const item = document.createElement('div');
    item.className = 'template-item';
    item.innerHTML = `
      <div>
        <span class="template-item-name">${template.name}</span>
        <span class="template-item-type">${template.exerciseType}</span>
      </div>
      <button class="template-item-delete" data-id="${template.id}">×</button>
    `;
    templateListEl.appendChild(item);
  }

  // Add delete handlers
  templateListEl.querySelectorAll('.template-item-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const id = e.target.dataset.id;
      templateStore.delete(id);
      refreshTemplateList();
      exerciseDetector.refreshTemplates();
    });
  });

  // Show template count with cloud sync indicator
  const cloudIcon = templateStore.supabaseReady ? ' ☁️' : '';
  templateCountEl.textContent = `${templates.length} template${templates.length !== 1 ? 's' : ''} stored${cloudIcon}`;
  templateExportBtn.disabled = templates.length === 0;
}

// ── UI Helpers ───────────────────────────────────────────────────────────────

function setStatus(text, type = '') {
  statusEl.textContent = text;
  statusEl.className = type;
}

// ── Event Handlers ───────────────────────────────────────────────────────────

startBtn.addEventListener('click', async () => {
  if (isRunning) {
    // Stop
    isRunning = false;
    stopCamera();
    voiceWorkflow.stop();
    startBtn.textContent = 'Start Camera';
    setStatus('Stopped', '');
    angleSmoother.reset();
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    fpsEl.textContent = '-- FPS';

    // Disable controls
    resetBtn.disabled = true;
    recordBtn.disabled = true;
    downloadBtn.disabled = dataRecorder.getFrameCount() === 0;
    templateRecordBtn.disabled = true;
    templateStatusEl.textContent = 'Camera not started';

    // Stop recording if active
    if (dataRecorder.isRecording) {
      dataRecorder.stop();
      recordBtn.textContent = 'Start Recording';
      recordBtn.classList.remove('recording');
    }

    // Stop template recording if active (including countdown)
    if (templateRecorder.isRecording || templateRecorder.isCountingDown) {
      templateRecorder.cancel();
      countdownOverlayEl.classList.remove('visible', 'recording');
      templateRecordBtn.textContent = 'Record Template';
      templateRecordBtn.classList.remove('recording');
    }

    // Reset detection
    exerciseDetector.reset();
    updateDetectionDisplay(null, 0, DetectionState.IDLE);

    // Stop idle checker
    stopIdleChecker();

    // Disable stop button, enable start
    stopBtn.disabled = true;
  } else {
    // Start
    startBtn.disabled = true;
    setStatus('Starting camera...', '');

    const success = await startCamera();
    if (success) {
      isRunning = true;
      startBtn.textContent = 'Start Camera';
      startBtn.disabled = false;
      stopBtn.disabled = false;
      setStatus('Running', 'ready');

      // Initialize audio and speech (requires user interaction)
      initAudio();
      initSpeech();

      // Start voice workflow
      voiceWorkflow.start();

      // Enable controls
      resetBtn.disabled = false;
      recordBtn.disabled = false;
      templateRecordBtn.disabled = false;
      templateStatusEl.textContent = 'Ready to record';

      // DIAGNOSTIC MODE: Templates and idle checker disabled
      // exerciseDetector.refreshTemplates();
      // startIdleChecker();

      requestAnimationFrame(detectLoop);
    } else {
      startBtn.disabled = false;
    }
  }
});

// Stop button handler
stopBtn.addEventListener('click', () => {
  if (isRunning) {
    startBtn.click(); // Trigger stop via start button logic
  }
});

resetBtn.addEventListener('click', () => {
  // Reset all exercise detectors
  squatDetector.reset();
  bicepsCurlDetector.reset();
  lungeDetector.reset();
  pushupDetector.reset();

  // Reset rep counts and UI
  resetAllReps();
  squatStateEl.textContent = 'idle';
  squatStateEl.className = 'squat-state';
  orientationEl.textContent = '--';
  orientationEl.className = 'orientation-badge';

  // Reset exercise tracking state
  candidateExercise = null;
  currentExerciseForReps = null;
  repConfirmedForExercise = false;
  lastAnnouncedExercise = null;

  // Reset classification stability tracking
  currentBestMatch = null;
  consecutiveBestMatchCount = 0;

  lastExerciseTime = Date.now(); // Reset idle timer too
});

recordBtn.addEventListener('click', () => {
  if (dataRecorder.isRecording) {
    // Stop recording
    dataRecorder.stop();
    recordBtn.textContent = 'Start Recording';
    recordBtn.classList.remove('recording');
    downloadBtn.disabled = false;
    recordStatusEl.textContent = `Recorded ${dataRecorder.getFrameCount()} frames`;
  } else {
    // Start recording
    dataRecorder.start();
    recordBtn.textContent = 'Stop Recording';
    recordBtn.classList.add('recording');
    downloadBtn.disabled = true;
    recordStatusEl.textContent = 'Recording...';
  }
});

downloadBtn.addEventListener('click', () => {
  dataRecorder.downloadCSV();
});

// ── Template Recording Event Handlers ────────────────────────────────────────

templateRecordBtn.addEventListener('click', () => {
  // Initialize audio on user gesture (required by browsers)
  initAudio();

  if (templateRecorder.isRecording || templateRecorder.isCountingDown) {
    // Cancel recording/countdown
    templateRecorder.cancel();
    countdownOverlayEl.classList.remove('visible', 'recording');
    templateRecordBtn.textContent = 'Record Template';
    templateRecordBtn.classList.remove('recording');
    templateStatusEl.textContent = 'Cancelled';
    templateStatusEl.style.color = '#888';
  } else {
    // Start recording (with countdown)
    const exerciseType = templateTypeEl.value;
    const templateName = templateNameEl.value.trim() ||
      `${exerciseType}_${new Date().toLocaleTimeString()}`;
    templateRecorder.start(exerciseType, templateName);
  }
});

templateExportBtn.addEventListener('click', () => {
  const date = new Date().toISOString().slice(0, 10);
  templateStore.exportToFile(`exercise_templates_${date}.json`);
});

// ── Dashboard Communication (when embedded as iframe) ─────────────────────────

/**
 * Pause the camera (turns off LED but keeps stream alive for fast resume)
 */
function pauseCamera() {
  if (stream) {
    stream.getVideoTracks().forEach(track => {
      track.enabled = false;
    });
    console.log('[Camera] Paused (tracks disabled)');
  }
}

/**
 * Resume the camera (turns LED back on)
 */
function resumeCamera() {
  if (stream) {
    stream.getVideoTracks().forEach(track => {
      track.enabled = true;
    });
    console.log('[Camera] Resumed (tracks enabled)');
  }
}

/**
 * Handle messages from parent dashboard window
 */
window.addEventListener('message', (event) => {
  // Security: only accept messages from same origin
  if (event.origin !== window.location.origin) return;

  const { action, data } = event.data || {};
  console.log('[ExercisePOC] Received message:', action, data);

  switch (action) {
    case 'pauseCamera':
      pauseCamera();
      break;

    case 'resumeCamera':
      resumeCamera();
      break;

    case 'pauseWorkflow':
      if (voiceWorkflow) {
        const savedState = voiceWorkflow.pause();
        // Send state back to parent
        window.parent.postMessage({
          type: 'workflowPaused',
          state: savedState,
        }, '*');
      }
      pauseCamera();
      break;

    case 'resumeWorkflow':
      resumeCamera();
      if (voiceWorkflow && data?.state) {
        voiceWorkflow.resume(data.state);
      } else if (voiceWorkflow) {
        voiceWorkflow.resume();
      }
      break;

    case 'getState':
      // Return full state for session persistence
      const fullState = {
        isRunning,
        voiceState: voiceWorkflow ? voiceWorkflow.getFullState() : null,
        exerciseReps: { ...exerciseReps },
      };
      window.parent.postMessage({
        type: 'stateResponse',
        state: fullState,
      }, '*');
      break;

    case 'restoreState':
      // Restore state from saved session
      if (data?.state) {
        // Restore rep counts
        if (data.state.exerciseReps) {
          Object.assign(exerciseReps, data.state.exerciseReps);
          Object.keys(exerciseReps).forEach(updateExerciseRepDisplay);
        }
        // Restore voice workflow state
        if (data.state.voiceState && voiceWorkflow) {
          voiceWorkflow.resume(data.state.voiceState);
        }
      }
      break;

    case 'start':
      // Start the session if not already running
      if (!isRunning && !startBtn.disabled) {
        startBtn.click();
      }
      break;

    case 'stop':
      // Stop the session if running
      if (isRunning) {
        startBtn.click();
      }
      break;
  }
});

// Notify parent when ready (for iframe embedding)
if (window.parent !== window) {
  window.addEventListener('load', () => {
    window.parent.postMessage({ type: 'exercisePocReady' }, '*');
  });
}

// ── Initialize ───────────────────────────────────────────────────────────────

// Disable buttons until model loads
startBtn.disabled = true;
resetBtn.disabled = true;
recordBtn.disabled = true;
downloadBtn.disabled = true;
templateRecordBtn.disabled = true;

// Load initial template list
refreshTemplateList();

// Check for Supabase sync completion and refresh template list
(async function waitForSupabaseSync() {
  // Wait for Supabase sync (up to 5 seconds)
  for (let i = 0; i < 10; i++) {
    await new Promise(r => setTimeout(r, 500));
    if (templateStore.supabaseReady && !templateStore.syncInProgress) {
      refreshTemplateList();
      exerciseDetector.refreshTemplates();
      console.log('[Init] Supabase sync complete, templates refreshed');
      break;
    }
  }
})();

// Load model on page load
loadPoseLandmarker().catch((err) => {
  console.error('Failed to load MediaPipe:', err);
  setStatus(`Failed to load: ${err.message}`, 'error');
});
