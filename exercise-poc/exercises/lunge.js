/**
 * MayaMind Exercise POC — Lunge Rep Counter
 *
 * State machine for detecting and counting lunge (reverse lunge) repetitions.
 * Uses knee and hip angles from 3D pose estimation.
 *
 * Detection strategy:
 * - Track knee angle of the front (bending) leg
 * - Similar to squat but typically one leg bends more than the other
 * - Must reach BOTTOM state for a rep to count
 * - Timing guards prevent over-counting
 *
 * Lunge phases:
 *   IDLE → STANDING → LUNGING → BOTTOM → RISING → STANDING (rep complete)
 */

import { LANDMARKS } from '../joints.js';

/**
 * Lunge detection thresholds (in degrees)
 */
export const LUNGE_THRESHOLDS = {
  // Standing position thresholds
  standingKneeMin: 155,     // Knee angle > this = standing

  // Bottom position thresholds (front leg bent)
  bottomKneeMax: 115,       // Knee angle < this = at bottom

  // Transition thresholds
  lungingKneeMax: 145,      // Knee drops below this = lunging
  risingKneeMin: 125,       // Knee rises above this = rising

  // Hip angle thresholds (helps distinguish from squat)
  hipForwardMax: 140,       // Hip angle drops during lunge

  // Timing thresholds (ms)
  minLungeDuration: 300,    // Must be in lunge at least this long
  repCooldown: 500,         // Minimum time between rep completions

  // Minimum range of motion
  minROM: 35,               // Must have at least 35° knee ROM for valid rep
};

/**
 * Lunge states
 */
export const LungeState = {
  IDLE: 'idle',
  STANDING: 'standing',
  LUNGING: 'lunging',
  BOTTOM: 'bottom',
  RISING: 'rising',
};

/**
 * Lunge detector class
 */
export class LungeDetector {
  constructor(options = {}) {
    this.thresholds = { ...LUNGE_THRESHOLDS, ...options.thresholds };
    this.state = LungeState.IDLE;
    this.repCount = 0;
    this.currentRepStartTime = null;
    this.lastRepDuration = null;

    // Track angles during current rep
    this.currentRepMaxKnee = 0;     // Maximum (most extended)
    this.currentRepMinKnee = 180;   // Minimum (most bent)
    this.activeLeg = null;          // Which leg is doing the lunge

    // Timing for anti-flicker
    this.lungeStartTime = null;
    this.lastRepCompletionTime = null;
    this.reachedBottom = false;

    // Rep quality history
    this.repHistory = [];
    this.maxHistoryLength = 20;

    // Callbacks
    this.onRepComplete = options.onRepComplete || null;
    this.onStateChange = options.onStateChange || null;
  }

  /**
   * Get the knee angle that's bending more (the leg doing the lunge)
   */
  getBendingKneeAngle(angles) {
    if (!angles) return null;
    const left = angles.leftKnee;
    const right = angles.rightKnee;

    if (left?.visible && right?.visible) {
      // The leg doing the lunge will have a smaller knee angle
      if (left.angle < right.angle) {
        return { angle: left.angle, side: 'left', otherAngle: right.angle };
      } else {
        return { angle: right.angle, side: 'right', otherAngle: left.angle };
      }
    } else if (left?.visible) {
      return { angle: left.angle, side: 'left', otherAngle: null };
    } else if (right?.visible) {
      return { angle: right.angle, side: 'right', otherAngle: null };
    }
    return null;
  }

  /**
   * Get average hip angle (best available)
   */
  getHipAngle(angles) {
    if (!angles) return null;
    const left = angles.leftHip;
    const right = angles.rightHip;

    if (left?.visible && right?.visible) {
      return (left.angle + right.angle) / 2;
    } else if (left?.visible) {
      return left.angle;
    } else if (right?.visible) {
      return right.angle;
    }
    return null;
  }

  /**
   * Update the detector with new pose data
   */
  update(angles, timestamp = Date.now()) {
    const kneeData = this.getBendingKneeAngle(angles);
    const hipAngle = this.getHipAngle(angles);

    if (!kneeData) {
      return this.getStatus();
    }

    const kneeAngle = kneeData.angle;
    const prevState = this.state;
    const t = this.thresholds;

    // State machine
    switch (this.state) {
      case LungeState.IDLE:
        // Transition to STANDING when legs are straight
        if (kneeAngle > t.standingKneeMin) {
          this.state = LungeState.STANDING;
          this.currentRepMaxKnee = kneeAngle;
        }
        break;

      case LungeState.STANDING:
        // Update max knee angle
        this.currentRepMaxKnee = Math.max(this.currentRepMaxKnee, kneeAngle);

        // Detect start of lunge
        if (kneeAngle < t.lungingKneeMax) {
          this.state = LungeState.LUNGING;
          this.currentRepStartTime = timestamp;
          this.lungeStartTime = timestamp;
          this.currentRepMinKnee = kneeAngle;
          this.activeLeg = kneeData.side;
          this.reachedBottom = false;
        }
        break;

      case LungeState.LUNGING:
        // Track minimum knee angle
        this.currentRepMinKnee = Math.min(this.currentRepMinKnee, kneeAngle);

        // Check if at bottom position
        if (kneeAngle < t.bottomKneeMax) {
          this.state = LungeState.BOTTOM;
          this.reachedBottom = true;
        } else if (kneeAngle > t.standingKneeMin) {
          // Went back to standing without reaching bottom - abort
          this.state = LungeState.STANDING;
          this.lungeStartTime = null;
          this.currentRepMaxKnee = kneeAngle;
          this.activeLeg = null;
        }
        break;

      case LungeState.BOTTOM:
        // Track minimum angle
        this.currentRepMinKnee = Math.min(this.currentRepMinKnee, kneeAngle);

        // Detect start of rise
        if (kneeAngle > t.risingKneeMin) {
          this.state = LungeState.RISING;
        }
        break;

      case LungeState.RISING:
        // Check if back to standing
        if (kneeAngle > t.standingKneeMin) {
          // Check timing and ROM constraints
          const lungeDuration = this.lungeStartTime ? timestamp - this.lungeStartTime : 0;
          const timeSinceLastRep = this.lastRepCompletionTime
            ? timestamp - this.lastRepCompletionTime
            : Infinity;
          const rom = this.currentRepMaxKnee - this.currentRepMinKnee;

          const validRep = this.reachedBottom &&
                          lungeDuration >= t.minLungeDuration &&
                          timeSinceLastRep >= t.repCooldown &&
                          rom >= t.minROM;

          if (validRep) {
            this.completeRep(timestamp);
          }

          this.state = LungeState.STANDING;
          this.lungeStartTime = null;
          this.reachedBottom = false;
          this.currentRepMaxKnee = kneeAngle;
          this.currentRepMinKnee = 180;
          this.activeLeg = null;
        } else if (kneeAngle < t.bottomKneeMax) {
          // Going back down
          this.state = LungeState.BOTTOM;
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

    const rom = this.currentRepMaxKnee - this.currentRepMinKnee;
    const depthScore = this.calculateDepthScore();

    const repData = {
      repNumber: this.repCount,
      duration: this.lastRepDuration,
      maxKneeAngle: this.currentRepMaxKnee,
      minKneeAngle: this.currentRepMinKnee,
      rangeOfMotion: rom,
      depthScore,
      activeLeg: this.activeLeg,
      timestamp,
    };

    this.repHistory.push(repData);
    if (this.repHistory.length > this.maxHistoryLength) {
      this.repHistory.shift();
    }

    if (this.onRepComplete) {
      this.onRepComplete(repData);
    }
  }

  /**
   * Calculate depth score (0-100) based on knee bend
   */
  calculateDepthScore() {
    const kneeDepth = Math.max(0, 170 - this.currentRepMinKnee);
    // Full depth is about 80° (from 170° to 90°)
    return Math.min(100, Math.round((kneeDepth / 80) * 100));
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      state: this.state,
      repCount: this.repCount,
      lastRepDuration: this.lastRepDuration,
      currentRepMaxKnee: this.currentRepMaxKnee > 0 ? this.currentRepMaxKnee : null,
      currentRepMinKnee: this.currentRepMinKnee < 180 ? this.currentRepMinKnee : null,
      activeLeg: this.activeLeg,
      repHistory: this.repHistory,
    };
  }

  /**
   * Reset the detector
   */
  reset() {
    this.state = LungeState.IDLE;
    this.repCount = 0;
    this.currentRepStartTime = null;
    this.lastRepDuration = null;
    this.currentRepMaxKnee = 0;
    this.currentRepMinKnee = 180;
    this.activeLeg = null;
    this.lungeStartTime = null;
    this.lastRepCompletionTime = null;
    this.reachedBottom = false;
    this.repHistory = [];
  }
}
