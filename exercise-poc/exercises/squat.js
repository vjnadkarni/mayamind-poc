/**
 * MayaMind Exercise POC — Squat Rep Counter
 *
 * State machine for detecting and counting squat repetitions.
 * Uses hip and knee angles from 3D pose estimation.
 *
 * Detection strategy:
 * - Angles are PRIMARY for ALL orientations (works best for sagittal, oblique, and back-to-camera)
 * - Hip Y displacement is SUPPLEMENTARY for frontal views (helps when angles are unreliable)
 * - Must reach BOTTOM state for a rep to count (prevents partial movement counting)
 * - Timing guards prevent over-counting (min descent duration, rep cooldown)
 *
 * Squat phases:
 *   STANDING → DESCENDING → BOTTOM → ASCENDING → STANDING (rep complete)
 */

import { LANDMARKS } from '../joints.js';

/**
 * Squat detection thresholds (in degrees)
 */
export const SQUAT_THRESHOLDS = {
  // Standing position thresholds
  standingHipMin: 155,      // Hip angle > this = standing
  standingKneeMin: 155,     // Knee angle > this = standing

  // Bottom position thresholds
  bottomHipMax: 120,        // Hip angle < this = at bottom
  bottomKneeMax: 120,       // Knee angle < this = at bottom

  // Transition thresholds (hysteresis to prevent flickering)
  descendingHipMax: 150,    // Hip drops below this = descending
  ascendingHipMin: 125,     // Hip rises above this = ascending

  // Frontal-view hip Y thresholds (normalized Y, 0-1)
  // Used as SUPPLEMENTARY detection when angles don't work
  hipDropThreshold: 0.10,   // Hip must drop by this much (more conservative)
  minSquatDepth: 0.15,      // Minimum total hip drop for valid rep

  // Timing thresholds (ms)
  minDescentDuration: 600,  // Must be in descent at least this long (prevents counting knee bends from other exercises)
  repCooldown: 600,         // Minimum time between rep completions

  // Orientation detection
  visibilityDiffThreshold: 0.25,
};

/**
 * User orientation relative to camera
 */
export const Orientation = {
  UNKNOWN: 'unknown',
  FRONTAL: 'frontal',
  SAGITTAL: 'sagittal',
  OBLIQUE: 'oblique',
};

/**
 * Squat states
 */
export const SquatState = {
  IDLE: 'idle',
  STANDING: 'standing',
  DESCENDING: 'descending',
  BOTTOM: 'bottom',
  ASCENDING: 'ascending',
};

/**
 * Squat detector class
 */
export class SquatDetector {
  constructor(options = {}) {
    this.thresholds = { ...SQUAT_THRESHOLDS, ...options.thresholds };
    this.state = SquatState.IDLE;
    this.repCount = 0;
    this.currentRepStartTime = null;
    this.lastRepDuration = null;

    // Track the lowest angles reached during current rep
    this.currentRepMinHip = 180;
    this.currentRepMinKnee = 180;

    // Hip Y tracking for frontal view fallback
    this.standingHipY = null;
    this.currentRepMaxHipY = 0;
    this.hipYLocked = false;  // Lock standingHipY during a rep

    // Timing for anti-flicker
    this.descentStartTime = null;
    this.lastRepCompletionTime = null;
    this.reachedBottom = false;  // Must reach bottom to count rep

    // Orientation tracking
    this.orientation = Orientation.UNKNOWN;
    this.orientationHistory = [];
    this.orientationWindowSize = 30;  // More frames for stability

    // Rep quality history
    this.repHistory = [];
    this.maxHistoryLength = 20;

    // Callbacks
    this.onRepComplete = options.onRepComplete || null;
    this.onStateChange = options.onStateChange || null;
    this.onOrientationChange = options.onOrientationChange || null;
  }

  /**
   * Detect user orientation based on landmark visibility
   */
  detectOrientation(landmarks) {
    if (!landmarks || landmarks.length < 33) return this.orientation;

    const leftIndices = [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE];
    const rightIndices = [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE];

    let leftVis = 0, rightVis = 0;
    for (const idx of leftIndices) leftVis += landmarks[idx]?.visibility ?? 0;
    for (const idx of rightIndices) rightVis += landmarks[idx]?.visibility ?? 0;
    leftVis /= leftIndices.length;
    rightVis /= rightIndices.length;

    const diff = Math.abs(leftVis - rightVis);

    // Add to rolling window
    this.orientationHistory.push(diff);
    if (this.orientationHistory.length > this.orientationWindowSize) {
      this.orientationHistory.shift();
    }

    // Need enough samples for stable detection
    if (this.orientationHistory.length < 10) return this.orientation;

    // Average over window
    const avgDiff = this.orientationHistory.reduce((a, b) => a + b, 0) / this.orientationHistory.length;

    let newOrientation;
    if (avgDiff > this.thresholds.visibilityDiffThreshold) {
      newOrientation = Orientation.SAGITTAL;
    } else if (avgDiff < this.thresholds.visibilityDiffThreshold * 0.4) {
      newOrientation = Orientation.FRONTAL;
    } else {
      newOrientation = Orientation.OBLIQUE;
    }

    if (newOrientation !== this.orientation) {
      const prevOrientation = this.orientation;
      this.orientation = newOrientation;
      if (this.onOrientationChange) {
        this.onOrientationChange(newOrientation, prevOrientation);
      }
    }

    return this.orientation;
  }

  /**
   * Get average hip Y position from 2D landmarks
   */
  getHipY(landmarks) {
    if (!landmarks) return null;

    const leftHip = landmarks[LANDMARKS.LEFT_HIP];
    const rightHip = landmarks[LANDMARKS.RIGHT_HIP];

    const leftVis = leftHip?.visibility ?? 0;
    const rightVis = rightHip?.visibility ?? 0;

    if (leftVis > 0.5 && rightVis > 0.5) {
      return (leftHip.y + rightHip.y) / 2;
    } else if (leftVis > 0.5) {
      return leftHip.y;
    } else if (rightVis > 0.5) {
      return rightHip.y;
    }
    return null;
  }

  /**
   * Get the best available hip angle (average if both visible, or whichever is visible)
   */
  getBestHipAngle(angles) {
    if (!angles) return null;
    const left = angles.leftHip;
    const right = angles.rightHip;

    if (left?.visible && right?.visible) {
      return { angle: (left.angle + right.angle) / 2, side: 'both' };
    } else if (left?.visible) {
      return { angle: left.angle, side: 'left' };
    } else if (right?.visible) {
      return { angle: right.angle, side: 'right' };
    }
    return null;
  }

  /**
   * Get the best available knee angle (average if both visible, or whichever is visible)
   */
  getBestKneeAngle(angles) {
    if (!angles) return null;
    const left = angles.leftKnee;
    const right = angles.rightKnee;

    if (left?.visible && right?.visible) {
      return { angle: (left.angle + right.angle) / 2, side: 'both' };
    } else if (left?.visible) {
      return { angle: left.angle, side: 'left' };
    } else if (right?.visible) {
      return { angle: right.angle, side: 'right' };
    }
    return null;
  }

  /**
   * Get hip Y drop from standing position
   */
  getHipDrop(hipY) {
    if (hipY === null || this.standingHipY === null) return 0;
    return hipY - this.standingHipY;  // Positive = lower (dropped)
  }

  /**
   * Check if angles indicate descent (works for most views)
   */
  checkAnglesDescent(hipAngle) {
    return hipAngle < this.thresholds.descendingHipMax;
  }

  /**
   * Check if angles indicate bottom position
   */
  checkAnglesBottom(hipAngle, kneeAngle) {
    return hipAngle < this.thresholds.bottomHipMax || kneeAngle < this.thresholds.bottomKneeMax;
  }

  /**
   * Check if angles indicate standing position
   */
  checkAnglesStanding(hipAngle, kneeAngle) {
    return hipAngle > this.thresholds.standingHipMin && kneeAngle > this.thresholds.standingKneeMin;
  }

  /**
   * Check if angles indicate ascending
   */
  checkAnglesAscending(hipAngle) {
    return hipAngle > this.thresholds.ascendingHipMin;
  }

  /**
   * Update the squat detector with new pose data
   */
  update(angles, timestamp = Date.now(), landmarks2D = null) {
    // Detect orientation
    if (landmarks2D) {
      this.detectOrientation(landmarks2D);
    }

    const hipData = this.getBestHipAngle(angles);
    const kneeData = this.getBestKneeAngle(angles);
    const hipY = landmarks2D ? this.getHipY(landmarks2D) : null;

    // Need at least hip angle to track squats
    if (!hipData) {
      return this.getStatus();
    }

    const hipAngle = hipData.angle;
    const kneeAngle = kneeData?.angle ?? 180;

    const prevState = this.state;
    const t = this.thresholds;

    // Calculate hip drop for frontal supplement
    const hipDrop = this.getHipDrop(hipY);

    // State machine — angles PRIMARY, hip Y as SUPPLEMENT for frontal
    switch (this.state) {
      case SquatState.IDLE:
        // Transition to STANDING when person is upright
        if (this.checkAnglesStanding(hipAngle, kneeAngle)) {
          this.state = SquatState.STANDING;
          if (hipY !== null) {
            this.standingHipY = hipY;
          }
        }
        break;

      case SquatState.STANDING:
        // Update standing reference only when truly standing
        if (hipY !== null && !this.hipYLocked) {
          this.standingHipY = hipY;
        }

        // Primary: detect descent via angles
        let startDescending = this.checkAnglesDescent(hipAngle);

        // Supplement for frontal: also trigger if significant hip drop detected
        // (helps when angles are unreliable due to arm position)
        if (!startDescending && this.orientation === Orientation.FRONTAL) {
          if (hipDrop > t.hipDropThreshold) {
            startDescending = true;
          }
        }

        if (startDescending) {
          this.state = SquatState.DESCENDING;
          this.currentRepStartTime = timestamp;
          this.descentStartTime = timestamp;
          this.currentRepMinHip = hipAngle;
          this.currentRepMinKnee = kneeAngle;
          this.currentRepMaxHipY = hipY ?? 0;
          this.reachedBottom = false;
          this.hipYLocked = true;
        }
        break;

      case SquatState.DESCENDING:
        // Track minimum angles and max hip Y
        this.currentRepMinHip = Math.min(this.currentRepMinHip, hipAngle);
        this.currentRepMinKnee = Math.min(this.currentRepMinKnee, kneeAngle);
        if (hipY !== null) {
          this.currentRepMaxHipY = Math.max(this.currentRepMaxHipY, hipY);
        }

        // Check if at bottom position
        let atBottom = this.checkAnglesBottom(hipAngle, kneeAngle);

        // Supplement for frontal: also count as bottom if hip dropped significantly
        if (!atBottom && this.orientation === Orientation.FRONTAL) {
          if (hipDrop > t.minSquatDepth) {
            atBottom = true;
          }
        }

        if (atBottom) {
          this.state = SquatState.BOTTOM;
          this.reachedBottom = true;
        } else if (this.checkAnglesStanding(hipAngle, kneeAngle)) {
          // Went back to standing without hitting bottom - abort this rep
          this.state = SquatState.STANDING;
          this.hipYLocked = false;
          this.descentStartTime = null;
          if (hipY !== null) {
            this.standingHipY = hipY;
          }
        }
        break;

      case SquatState.BOTTOM:
        // Track minimum angles
        this.currentRepMinHip = Math.min(this.currentRepMinHip, hipAngle);
        this.currentRepMinKnee = Math.min(this.currentRepMinKnee, kneeAngle);
        if (hipY !== null) {
          this.currentRepMaxHipY = Math.max(this.currentRepMaxHipY, hipY);
        }

        // Transition to ASCENDING when starting to rise
        let startedRising = this.checkAnglesAscending(hipAngle);

        // Supplement for frontal: detect rising via hip Y
        if (!startedRising && this.orientation === Orientation.FRONTAL) {
          if (hipY !== null && this.currentRepMaxHipY > 0) {
            const riseFromBottom = this.currentRepMaxHipY - hipY;
            if (riseFromBottom > t.hipDropThreshold * 0.5) {
              startedRising = true;
            }
          }
        }

        if (startedRising) {
          this.state = SquatState.ASCENDING;
        }
        break;

      case SquatState.ASCENDING:
        // Check if fully upright
        let isBackToStanding = this.checkAnglesStanding(hipAngle, kneeAngle);

        // Supplement for frontal: check hip Y returned near standing position
        if (!isBackToStanding && this.orientation === Orientation.FRONTAL) {
          if (hipY !== null && this.standingHipY !== null) {
            const distFromStanding = Math.abs(hipY - this.standingHipY);
            if (distFromStanding < t.hipDropThreshold * 0.5) {
              isBackToStanding = true;
            }
          }
        }

        // Check timing constraints
        const descentDuration = this.descentStartTime ? timestamp - this.descentStartTime : 0;
        const timeSinceLastRep = this.lastRepCompletionTime ? timestamp - this.lastRepCompletionTime : Infinity;

        if (isBackToStanding) {
          // Only count rep if:
          // 1. We actually reached bottom
          // 2. Descent lasted long enough (anti-flicker)
          // 3. Enough time since last rep (cooldown)
          const validRep = this.reachedBottom &&
                          descentDuration >= t.minDescentDuration &&
                          timeSinceLastRep >= t.repCooldown;

          if (validRep) {
            this.completeRep(timestamp);
          }

          this.state = SquatState.STANDING;
          this.hipYLocked = false;
          this.descentStartTime = null;
          this.reachedBottom = false;
          if (hipY !== null) {
            this.standingHipY = hipY;
          }
        } else if (this.checkAnglesBottom(hipAngle, kneeAngle)) {
          // Going back down to bottom
          this.state = SquatState.BOTTOM;
        }
        break;
    }

    // Fire state change callback
    if (this.state !== prevState && this.onStateChange) {
      this.onStateChange(this.state, prevState);
    }

    return this.getStatus();
  }

  /**
   * Complete a rep and record quality metrics
   */
  completeRep(timestamp) {
    this.repCount++;
    this.lastRepCompletionTime = timestamp;
    this.lastRepDuration = this.currentRepStartTime
      ? timestamp - this.currentRepStartTime
      : null;

    const depthScore = this.calculateDepthScore();

    const repData = {
      repNumber: this.repCount,
      duration: this.lastRepDuration,
      minHipAngle: this.currentRepMinHip,
      minKneeAngle: this.currentRepMinKnee,
      maxHipDrop: this.standingHipY !== null && this.currentRepMaxHipY > 0
        ? this.currentRepMaxHipY - this.standingHipY
        : null,
      depthScore,
      orientation: this.orientation,
      timestamp,
    };

    this.repHistory.push(repData);
    if (this.repHistory.length > this.maxHistoryLength) {
      this.repHistory.shift();
    }

    if (this.onRepComplete) {
      this.onRepComplete(repData);
    }

    // Reset for next rep
    this.currentRepMinHip = 180;
    this.currentRepMinKnee = 180;
    this.currentRepMaxHipY = 0;
    this.currentRepStartTime = null;
  }

  /**
   * Calculate depth score (0-100) based on angles
   */
  calculateDepthScore() {
    const hipDepth = Math.max(0, 170 - this.currentRepMinHip);
    const kneeDepth = Math.max(0, 170 - this.currentRepMinKnee);

    const hipScore = Math.min(100, (hipDepth / 80) * 100);
    const kneeScore = Math.min(100, (kneeDepth / 80) * 100);

    return Math.round((hipScore + kneeScore) / 2);
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      state: this.state,
      repCount: this.repCount,
      orientation: this.orientation,
      lastRepDuration: this.lastRepDuration,
      currentRepMinHip: this.currentRepMinHip < 180 ? this.currentRepMinHip : null,
      currentRepMinKnee: this.currentRepMinKnee < 180 ? this.currentRepMinKnee : null,
      standingHipY: this.standingHipY,
      currentHipDrop: this.standingHipY !== null && this.currentRepMaxHipY > 0
        ? this.currentRepMaxHipY - this.standingHipY
        : null,
      repHistory: this.repHistory,
    };
  }

  /**
   * Reset the detector
   */
  reset() {
    this.state = SquatState.IDLE;
    this.repCount = 0;
    this.currentRepStartTime = null;
    this.lastRepDuration = null;
    this.currentRepMinHip = 180;
    this.currentRepMinKnee = 180;
    this.currentRepMaxHipY = 0;
    this.standingHipY = null;
    this.hipYLocked = false;
    this.descentStartTime = null;
    this.lastRepCompletionTime = null;
    this.reachedBottom = false;
    this.orientation = Orientation.UNKNOWN;
    this.orientationHistory = [];
    this.repHistory = [];
  }
}
