/**
 * MayaMind Exercise POC — Exercise Detector
 *
 * Real-time exercise detection using sliding window DTW.
 * Identifies exercise type and phase from live pose stream.
 */

import { extractFeatures, featuresToVector, FeatureSequence } from './features.js';
import { dtw, classifySequence } from './dtw.js';
import { getTemplateStore, ExerciseType, ExerciseTemplate } from './templates.js';

/**
 * Detection states
 */
export const DetectionState = {
  IDLE: 'idle',           // No exercise detected
  DETECTING: 'detecting', // Possible exercise in progress
  MATCHED: 'matched',     // Exercise confidently detected
  COMPLETED: 'completed', // Rep/exercise completed
};

/**
 * Real-time exercise detector
 */
export class ExerciseDetector {
  constructor(options = {}) {
    // Configuration
    this.windowSize = options.windowSize || 90;      // Frames to keep in buffer (~3s at 30fps)
    this.minMatchFrames = options.minMatchFrames || 30; // Min frames for a match
    this.matchThreshold = options.matchThreshold || 0.8; // DTW distance threshold for match
    this.subsampleTarget = options.subsampleTarget || 45; // Subsample templates for speed

    // State
    this.state = DetectionState.IDLE;
    this.buffer = [];           // Rolling buffer of feature vectors
    this.currentExercise = null;
    this.confidence = 0;
    this.matchHistory = [];     // Recent match results for smoothing
    this.noMatchCount = 0;      // Count of consecutive no-match frames for IDLE hysteresis
    this.noMatchThreshold = 30; // Require 30 consecutive no-matches (~3s) before going IDLE

    // Template store
    this.templateStore = options.templateStore || getTemplateStore();
    this.cachedTemplates = null; // Cached subsampled templates

    // Callbacks
    this.onExerciseDetected = options.onExerciseDetected || null;
    this.onStateChange = options.onStateChange || null;
    this.onMatchUpdate = options.onMatchUpdate || null;

    // Performance tracking
    this.lastDetectionTime = 0;
    this.detectionInterval = options.detectionInterval || 100; // ms between detections
  }

  /**
   * Update cached templates (call when templates change)
   */
  refreshTemplates() {
    const allTemplates = this.templateStore.getAllVectorsGrouped(this.subsampleTarget);
    this.cachedTemplates = {};

    for (const [type, templates] of Object.entries(allTemplates)) {
      this.cachedTemplates[type] = templates.map(t => ({
        id: t.id,
        name: t.name,
        vectors: t.vectors,
      }));
    }

    console.log('[ExerciseDetector] Refreshed templates:', Object.keys(this.cachedTemplates));

    // Debug: log vector counts per template
    for (const [type, templates] of Object.entries(this.cachedTemplates)) {
      for (const t of templates) {
        const vecLen = t.vectors?.length || 0;
        const firstVecLen = t.vectors?.[0]?.length || 0;
        console.log(`[ExerciseDetector] ${type}/${t.name}: ${vecLen} vectors, first vec has ${firstVecLen} elements`);
      }
    }
  }

  /**
   * Process a new frame of pose data
   *
   * @param {Array} worldLandmarks - 3D world landmarks from MediaPipe
   * @param {Array} landmarks2D - 2D normalized landmarks
   * @param {number} timestamp - Frame timestamp
   * @returns {Object} Detection status
   */
  update(worldLandmarks, landmarks2D, timestamp = Date.now()) {
    // Extract features
    const features = extractFeatures(worldLandmarks, landmarks2D);
    if (!features) {
      return this.getStatus();
    }

    const vector = featuresToVector(features);
    if (!vector) {
      return this.getStatus();
    }

    // Add to rolling buffer
    this.buffer.push({
      vector,
      timestamp,
      features,
    });

    // Trim buffer to window size
    while (this.buffer.length > this.windowSize) {
      this.buffer.shift();
    }

    // Run detection at intervals (not every frame)
    if (timestamp - this.lastDetectionTime >= this.detectionInterval) {
      this.lastDetectionTime = timestamp;
      this.detectExercise();
    }

    return this.getStatus();
  }

  /**
   * Run exercise detection on current buffer
   */
  detectExercise() {
    if (this.buffer.length < this.minMatchFrames) {
      return;
    }

    // Refresh templates if needed
    if (!this.cachedTemplates) {
      this.refreshTemplates();
    }

    if (!this.cachedTemplates || Object.keys(this.cachedTemplates).length === 0) {
      // No templates to match against
      return;
    }

    // Get buffer vectors
    const bufferVectors = this.buffer.map(f => f.vector);

    // Debug: log buffer state and angle values once per second
    if (Date.now() % 1000 < 100) {
      const validVectors = bufferVectors.filter(v => v && v.length > 0).length;
      // Extract angles from the latest frame (8 angles: L/R for knee, hip, elbow, shoulder)
      const latestVec = this.buffer[this.buffer.length - 1]?.features?.angles;
      if (latestVec) {
        const angleNames = ['L.Knee', 'R.Knee', 'L.Hip', 'R.Hip', 'L.Elbow', 'R.Elbow', 'L.Shldr', 'R.Shldr'];
        const angleStr = latestVec.map((a, i) => `${angleNames[i]}:${(a * 180).toFixed(0)}°`).join(' ');
        console.log(`[DTW Angles] ${angleStr}`);
      }
    }

    // Compare against all templates
    const results = [];

    for (const [exerciseType, templates] of Object.entries(this.cachedTemplates)) {
      for (const template of templates) {
        // Calculate bandWidth that accounts for length difference
        // Must be at least abs(len1 - len2) to allow a valid warping path
        const lenDiff = Math.abs(bufferVectors.length - template.vectors.length);
        const baseBand = Math.ceil(Math.max(bufferVectors.length, template.vectors.length) * 0.3);
        const adjustedBandWidth = Math.max(baseBand, lenDiff + 5);

        // Use DTW to compare
        const dtwResult = dtw(bufferVectors, template.vectors, {
          bandWidth: adjustedBandWidth,
          normalize: true,
        });

        results.push({
          exerciseType,
          templateId: template.id,
          templateName: template.name,
          distance: dtwResult.normalized,
          rawDistance: dtwResult.distance,
        });
      }
    }

    // Sort by distance
    results.sort((a, b) => a.distance - b.distance);
    const best = results[0];

    if (!best) return;

    // Add to match history for smoothing
    this.matchHistory.push({
      exerciseType: best.exerciseType,
      distance: best.distance,
      timestamp: Date.now(),
    });

    // Keep last N matches
    while (this.matchHistory.length > 10) {
      this.matchHistory.shift();
    }

    // Calculate smoothed confidence
    const avgDistance = this.matchHistory.reduce((sum, m) => sum + m.distance, 0) / this.matchHistory.length;
    const confidence = Math.max(0, 1 - (avgDistance / this.matchThreshold));

    // Check if we have a confident match
    const prevState = this.state;
    const prevExercise = this.currentExercise;

    if (best.distance < this.matchThreshold) {
      // Good match - reset no-match counter
      this.noMatchCount = 0;

      if (this.state === DetectionState.IDLE) {
        this.state = DetectionState.DETECTING;
      }

      // Check for consistent match
      const recentMatches = this.matchHistory.slice(-5);
      const consistentType = recentMatches.every(m => m.exerciseType === best.exerciseType);

      if (consistentType && recentMatches.length >= 5) {
        this.state = DetectionState.MATCHED;
        this.currentExercise = best.exerciseType;
        this.confidence = confidence;

        if (prevExercise !== this.currentExercise && this.onExerciseDetected) {
          this.onExerciseDetected({
            exerciseType: this.currentExercise,
            confidence: this.confidence,
            templateId: best.templateId,
            templateName: best.templateName,
          });
        }
      }
    } else {
      // No confident match - increment counter
      this.noMatchCount++;

      // Only go IDLE after sustained no-match (hysteresis prevents flickering)
      if (this.state === DetectionState.MATCHED && this.noMatchCount >= this.noMatchThreshold) {
        console.log(`[ExerciseDetector] Going IDLE after ${this.noMatchCount} no-match frames`);
        this.state = DetectionState.IDLE;
        this.currentExercise = null;
        this.confidence = 0;
        this.noMatchCount = 0;
      }
    }

    // Fire state change callback
    if (this.state !== prevState && this.onStateChange) {
      this.onStateChange(this.state, prevState);
    }

    // Fire match update callback
    if (this.onMatchUpdate) {
      this.onMatchUpdate({
        best,
        all: results.slice(0, 5),
        smoothedConfidence: confidence,
        state: this.state,
      });
    }
  }

  /**
   * Get current detection status
   */
  getStatus() {
    return {
      state: this.state,
      currentExercise: this.currentExercise,
      confidence: this.confidence,
      bufferLength: this.buffer.length,
      templateCount: this.cachedTemplates
        ? Object.values(this.cachedTemplates).reduce((sum, t) => sum + t.length, 0)
        : 0,
    };
  }

  /**
   * Reset detector state
   */
  reset() {
    this.state = DetectionState.IDLE;
    this.buffer = [];
    this.currentExercise = null;
    this.confidence = 0;
    this.matchHistory = [];
    this.noMatchCount = 0;
  }

  /**
   * Clear buffer without resetting state
   */
  clearBuffer() {
    this.buffer = [];
  }
}

/**
 * Template recorder for capturing new exercise templates
 */
export class TemplateRecorder {
  constructor(options = {}) {
    this.isRecording = false;
    this.isCountingDown = false;
    this.sequence = null;
    this.startTime = null;
    this.frameCount = 0;
    this.countdownTimer = null;
    this.autoStopTimer = null;

    // Configuration
    this.countdownSeconds = options.countdownSeconds ?? 5;  // Countdown before recording
    this.recordDuration = options.recordDuration || 10000;  // Auto-stop after 10 seconds
    this.maxDuration = options.maxDuration || 30000;        // Absolute max (safety)
    this.minDuration = options.minDuration || 1000;         // 1 second min

    // Template metadata
    this.exerciseType = options.exerciseType || ExerciseType.UNKNOWN;
    this.templateName = options.templateName || 'New Template';
    this.metadata = options.metadata || {};

    // Callbacks
    this.onCountdown = options.onCountdown || null;
    this.onRecordingStart = options.onRecordingStart || null;
    this.onRecordingStop = options.onRecordingStop || null;
    this.onFrameRecorded = options.onFrameRecorded || null;
    this.onMaxDurationReached = options.onMaxDurationReached || null;

    // Template store
    this.templateStore = options.templateStore || getTemplateStore();
  }

  /**
   * Start recording with countdown
   */
  start(exerciseType = null, templateName = null) {
    if (this.isRecording || this.isCountingDown) {
      this.cancel();
    }

    if (exerciseType) this.exerciseType = exerciseType;
    if (templateName) this.templateName = templateName;

    // Start countdown
    if (this.countdownSeconds > 0) {
      this.isCountingDown = true;
      let remaining = this.countdownSeconds;

      if (this.onCountdown) {
        this.onCountdown({ remaining, total: this.countdownSeconds, phase: 'countdown' });
      }

      this.countdownTimer = setInterval(() => {
        remaining--;
        if (remaining <= 0) {
          clearInterval(this.countdownTimer);
          this.countdownTimer = null;
          this.isCountingDown = false;
          this._startRecording();
        } else if (this.onCountdown) {
          this.onCountdown({ remaining, total: this.countdownSeconds, phase: 'countdown' });
        }
      }, 1000);

      console.log(`[TemplateRecorder] Countdown started: ${this.countdownSeconds}s`);
    } else {
      this._startRecording();
    }
  }

  /**
   * Internal: actually start recording (after countdown)
   */
  _startRecording() {
    this.isRecording = true;
    this.sequence = new FeatureSequence();
    this.startTime = Date.now();
    this.frameCount = 0;

    if (this.onRecordingStart) {
      this.onRecordingStart({
        exerciseType: this.exerciseType,
        templateName: this.templateName,
        recordDuration: this.recordDuration,
      });
    }

    // Set auto-stop timer
    if (this.recordDuration > 0) {
      this.autoStopTimer = setTimeout(() => {
        console.log(`[TemplateRecorder] Auto-stopping after ${this.recordDuration}ms`);
        this.stop(true);
      }, this.recordDuration);
    }

    console.log(`[TemplateRecorder] Started recording: ${this.exerciseType} - ${this.templateName}`);
  }

  /**
   * Record a frame
   */
  recordFrame(worldLandmarks, landmarks2D) {
    if (!this.isRecording) return false;

    // Check max duration
    const elapsed = Date.now() - this.startTime;
    if (elapsed > this.maxDuration) {
      if (this.onMaxDurationReached) {
        this.onMaxDurationReached(elapsed);
      }
      this.stop();
      return false;
    }

    const added = this.sequence.addFrame(worldLandmarks, landmarks2D);
    if (added) {
      this.frameCount++;
      if (this.onFrameRecorded) {
        this.onFrameRecorded({
          frameCount: this.frameCount,
          duration: elapsed,
        });
      }
    }

    return added;
  }

  /**
   * Stop recording and optionally save template
   */
  stop(save = true) {
    // Clear auto-stop timer
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }

    if (!this.isRecording) return null;

    this.isRecording = false;
    const duration = Date.now() - this.startTime;

    console.log(`[TemplateRecorder] Stopped recording: ${this.frameCount} frames, ${duration}ms`);

    // Check minimum duration
    if (duration < this.minDuration) {
      console.warn('[TemplateRecorder] Recording too short, not saving');
      if (this.onRecordingStop) {
        this.onRecordingStop({ saved: false, reason: 'too_short' });
      }
      return null;
    }

    // Check minimum frames
    if (this.frameCount < 15) {
      console.warn('[TemplateRecorder] Not enough frames, not saving');
      if (this.onRecordingStop) {
        this.onRecordingStop({ saved: false, reason: 'not_enough_frames' });
      }
      return null;
    }

    let template = null;

    if (save) {
      // Create and save template
      template = new ExerciseTemplate({
        name: this.templateName,
        exerciseType: this.exerciseType,
        sequence: this.sequence,
        metadata: {
          ...this.metadata,
          duration,
          frameCount: this.frameCount,
        },
      });

      this.templateStore.add(template);
      console.log(`[TemplateRecorder] Saved template: ${template.id}`);
    }

    if (this.onRecordingStop) {
      this.onRecordingStop({
        saved: save,
        template,
        duration,
        frameCount: this.frameCount,
      });
    }

    // Reset
    this.sequence = null;
    this.startTime = null;
    this.frameCount = 0;

    return template;
  }

  /**
   * Cancel recording without saving
   */
  cancel() {
    // Clear timers
    if (this.countdownTimer) {
      clearInterval(this.countdownTimer);
      this.countdownTimer = null;
    }
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    this.isCountingDown = false;
    return this.stop(false);
  }

  /**
   * Get recording status
   */
  getStatus() {
    return {
      isRecording: this.isRecording,
      isCountingDown: this.isCountingDown,
      frameCount: this.frameCount,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      recordDuration: this.recordDuration,
      exerciseType: this.exerciseType,
      templateName: this.templateName,
    };
  }
}
