/**
 * MayaMind Exercise POC — Biceps Curl Rep Counter
 *
 * State machine for detecting and counting biceps curl repetitions.
 * Uses elbow angles from 3D pose estimation.
 *
 * Detection strategy:
 * - Track elbow angle (primary indicator for biceps curl)
 * - Can track either arm or both arms together
 * - Must reach FLEXED state for a rep to count
 * - Timing guards prevent over-counting
 *
 * Biceps curl phases:
 *   IDLE → EXTENDED → FLEXING → FLEXED → EXTENDING → EXTENDED (rep complete)
 */

/**
 * Biceps curl detection thresholds (in degrees)
 */
export const BICEPS_CURL_THRESHOLDS = {
  // Extended position (arm straight down)
  extendedMin: 130,        // Elbow angle > this = extended (loosened from 145)

  // Flexed position (arm curled up)
  flexedMax: 80,           // Elbow angle < this = flexed (tightened from 90 to prevent squat overlap)

  // Transition thresholds (hysteresis)
  flexingMax: 120,         // Elbow drops below this = flexing (loosened from 135)
  extendingMin: 100,       // Elbow rises above this = extending (loosened from 80)

  // Timing thresholds (ms)
  minFlexDuration: 150,    // Must be flexing for at least this long
  repCooldown: 500,        // Minimum time between rep completions

  // Minimum range of motion for valid rep
  minROM: 35,              // Must have at least 35° ROM for valid rep (loosened from 60)

  // Cross-joint validation: reject curls if legs are moving (indicates squat/lunge)
  maxKneeChange: 25,       // Max knee angle change during a curl (degrees)
  maxHipChange: 25,        // Max hip angle change during a curl (degrees)
};

/**
 * Biceps curl states
 */
export const BicepsCurlState = {
  IDLE: 'idle',
  EXTENDED: 'extended',
  FLEXING: 'flexing',
  FLEXED: 'flexed',
  EXTENDING: 'extending',
};

/**
 * Biceps curl detector class
 */
export class BicepsCurlDetector {
  constructor(options = {}) {
    this.thresholds = { ...BICEPS_CURL_THRESHOLDS, ...options.thresholds };
    this.state = BicepsCurlState.IDLE;
    this.repCount = 0;
    this.currentRepStartTime = null;
    this.lastRepDuration = null;

    // Track angles during current rep
    this.currentRepMaxElbow = 0;    // Maximum (most extended)
    this.currentRepMinElbow = 180;  // Minimum (most flexed)

    // Cross-joint validation: track knee/hip to reject squats misclassified as curls
    this.repStartKnee = null;       // Knee angle at rep start
    this.repStartHip = null;        // Hip angle at rep start
    this.repMinKnee = 180;          // Minimum knee angle during rep
    this.repMinHip = 180;           // Minimum hip angle during rep

    // Timing for anti-flicker
    this.flexStartTime = null;
    this.lastRepCompletionTime = null;
    this.reachedFlexed = false;

    // Rep quality history
    this.repHistory = [];
    this.maxHistoryLength = 20;

    // Callbacks
    this.onRepComplete = options.onRepComplete || null;
    this.onStateChange = options.onStateChange || null;
  }

  /**
   * Get the best available elbow angle (more flexed arm, or average if close)
   */
  getBestElbowAngle(angles) {
    if (!angles) return null;
    const left = angles.leftElbow;
    const right = angles.rightElbow;

    if (left?.visible && right?.visible) {
      // Use the arm that's more flexed (doing the curl), or average if close
      const diff = Math.abs(left.angle - right.angle);
      if (diff < 20) {
        return { angle: (left.angle + right.angle) / 2, side: 'both' };
      }
      // Return the more flexed arm (lower angle = more curled)
      return left.angle < right.angle
        ? { angle: left.angle, side: 'left' }
        : { angle: right.angle, side: 'right' };
    } else if (left?.visible) {
      return { angle: left.angle, side: 'left' };
    } else if (right?.visible) {
      return { angle: right.angle, side: 'right' };
    }
    return null;
  }

  /**
   * Get the best available knee angle (for cross-joint validation)
   */
  getBestKneeAngle(angles) {
    if (!angles) return null;
    const left = angles.leftKnee;
    const right = angles.rightKnee;

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
   * Get the best available hip angle (for cross-joint validation)
   */
  getBestHipAngle(angles) {
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
    const elbowData = this.getBestElbowAngle(angles);

    if (!elbowData) {
      return this.getStatus();
    }

    const elbowAngle = elbowData.angle;
    const kneeAngle = this.getBestKneeAngle(angles);
    const hipAngle = this.getBestHipAngle(angles);
    const prevState = this.state;
    const t = this.thresholds;

    // State machine
    switch (this.state) {
      case BicepsCurlState.IDLE:
        // Transition to EXTENDED when arm is straight
        if (elbowAngle > t.extendedMin) {
          this.state = BicepsCurlState.EXTENDED;
          this.currentRepMaxElbow = elbowAngle;
        }
        break;

      case BicepsCurlState.EXTENDED:
        // Update max elbow angle
        this.currentRepMaxElbow = Math.max(this.currentRepMaxElbow, elbowAngle);

        // Detect start of curl (flexing)
        if (elbowAngle < t.flexingMax) {
          this.state = BicepsCurlState.FLEXING;
          this.currentRepStartTime = timestamp;
          this.flexStartTime = timestamp;
          this.currentRepMinElbow = elbowAngle;
          this.reachedFlexed = false;

          // Track knee/hip at start for cross-joint validation
          this.repStartKnee = kneeAngle;
          this.repStartHip = hipAngle;
          this.repMinKnee = kneeAngle ?? 180;
          this.repMinHip = hipAngle ?? 180;
        }
        break;

      case BicepsCurlState.FLEXING:
        // Track minimum elbow angle
        this.currentRepMinElbow = Math.min(this.currentRepMinElbow, elbowAngle);

        // Track knee/hip for cross-joint validation
        if (kneeAngle !== null) this.repMinKnee = Math.min(this.repMinKnee, kneeAngle);
        if (hipAngle !== null) this.repMinHip = Math.min(this.repMinHip, hipAngle);

        // Check if fully flexed
        if (elbowAngle < t.flexedMax) {
          this.state = BicepsCurlState.FLEXED;
          this.reachedFlexed = true;
        } else if (elbowAngle > t.extendedMin) {
          // Went back to extended without flexing enough - abort
          this.state = BicepsCurlState.EXTENDED;
          this.flexStartTime = null;
          this.currentRepMaxElbow = elbowAngle;
        }
        break;

      case BicepsCurlState.FLEXED:
        // Track minimum angle
        this.currentRepMinElbow = Math.min(this.currentRepMinElbow, elbowAngle);

        // Track knee/hip for cross-joint validation
        if (kneeAngle !== null) this.repMinKnee = Math.min(this.repMinKnee, kneeAngle);
        if (hipAngle !== null) this.repMinHip = Math.min(this.repMinHip, hipAngle);

        // Detect start of extension
        if (elbowAngle > t.extendingMin) {
          this.state = BicepsCurlState.EXTENDING;
        }
        break;

      case BicepsCurlState.EXTENDING:
        // Track knee/hip for cross-joint validation
        if (kneeAngle !== null) this.repMinKnee = Math.min(this.repMinKnee, kneeAngle);
        if (hipAngle !== null) this.repMinHip = Math.min(this.repMinHip, hipAngle);

        // Check if back to extended position
        if (elbowAngle > t.extendedMin) {
          // Check timing and ROM constraints
          const flexDuration = this.flexStartTime ? timestamp - this.flexStartTime : 0;
          const timeSinceLastRep = this.lastRepCompletionTime
            ? timestamp - this.lastRepCompletionTime
            : Infinity;
          const rom = this.currentRepMaxElbow - this.currentRepMinElbow;

          // Cross-joint validation: reject if knee/hip changed too much (indicates squat/lunge)
          const kneeChange = this.repStartKnee !== null && this.repMinKnee < 180
            ? this.repStartKnee - this.repMinKnee
            : 0;
          const hipChange = this.repStartHip !== null && this.repMinHip < 180
            ? this.repStartHip - this.repMinHip
            : 0;

          const legsStable = kneeChange <= t.maxKneeChange && hipChange <= t.maxHipChange;

          const validRep = this.reachedFlexed &&
                          flexDuration >= t.minFlexDuration &&
                          timeSinceLastRep >= t.repCooldown &&
                          rom >= t.minROM &&
                          legsStable;

          if (validRep) {
            this.completeRep(timestamp);
          }

          this.state = BicepsCurlState.EXTENDED;
          this.flexStartTime = null;
          this.reachedFlexed = false;
          this.currentRepMaxElbow = elbowAngle;
          this.currentRepMinElbow = 180;
          this.repStartKnee = null;
          this.repStartHip = null;
          this.repMinKnee = 180;
          this.repMinHip = 180;
        } else if (elbowAngle < t.flexedMax) {
          // Going back down
          this.state = BicepsCurlState.FLEXED;
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

    const rom = this.currentRepMaxElbow - this.currentRepMinElbow;
    const romScore = this.calculateROMScore();

    const repData = {
      repNumber: this.repCount,
      duration: this.lastRepDuration,
      maxElbowAngle: this.currentRepMaxElbow,
      minElbowAngle: this.currentRepMinElbow,
      rangeOfMotion: rom,
      romScore,
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
   * Calculate ROM score (0-100) based on range of motion
   */
  calculateROMScore() {
    const rom = this.currentRepMaxElbow - this.currentRepMinElbow;
    // Full ROM is about 110° (from 160° to 50°)
    return Math.min(100, Math.round((rom / 110) * 100));
  }

  /**
   * Get current status
   */
  getStatus() {
    return {
      state: this.state,
      repCount: this.repCount,
      lastRepDuration: this.lastRepDuration,
      currentRepMaxElbow: this.currentRepMaxElbow > 0 ? this.currentRepMaxElbow : null,
      currentRepMinElbow: this.currentRepMinElbow < 180 ? this.currentRepMinElbow : null,
      repHistory: this.repHistory,
    };
  }

  /**
   * Reset the detector
   */
  reset() {
    this.state = BicepsCurlState.IDLE;
    this.repCount = 0;
    this.currentRepStartTime = null;
    this.lastRepDuration = null;
    this.currentRepMaxElbow = 0;
    this.currentRepMinElbow = 180;
    this.repStartKnee = null;
    this.repStartHip = null;
    this.repMinKnee = 180;
    this.repMinHip = 180;
    this.flexStartTime = null;
    this.lastRepCompletionTime = null;
    this.reachedFlexed = false;
    this.repHistory = [];
  }
}
