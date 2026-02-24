/**
 * MayaMind Exercise POC — Push-up Rep Counter
 *
 * State machine for detecting and counting push-up (knee push-up) repetitions.
 * Uses elbow and shoulder angles from 3D pose estimation.
 *
 * Detection strategy:
 * - Track elbow angle as primary indicator
 * - Body should be in plank-like position (horizontal-ish)
 * - Must reach BOTTOM state for a rep to count
 * - Timing guards prevent over-counting
 *
 * Push-up phases:
 *   IDLE → PLANK → DESCENDING → BOTTOM → ASCENDING → PLANK (rep complete)
 */

/**
 * Push-up detection thresholds (in degrees)
 */
export const PUSHUP_THRESHOLDS = {
  // Plank position (arms extended) - relaxed for varied push-up styles
  plankElbowMin: 130,       // Elbow angle > this = in plank (was 145)

  // Bottom position (arms bent) - more lenient
  bottomElbowMax: 115,      // Elbow angle < this = at bottom (was 100)

  // Transition thresholds
  descendingElbowMax: 125,  // Elbow drops below this = descending (was 135)
  ascendingElbowMin: 118,   // Elbow rises above this = ascending (was 110)

  // Timing thresholds (ms)
  minDescentDuration: 200,  // Must be descending for at least this long (filters floor entry/exit)
  repCooldown: 400,         // Minimum time between rep completions

  // Minimum range of motion
  minROM: 20,               // Must have at least 20° elbow ROM for valid rep (lowered for side views)
};

/**
 * Push-up states
 */
export const PushupState = {
  IDLE: 'idle',
  PLANK: 'plank',
  DESCENDING: 'descending',
  BOTTOM: 'bottom',
  ASCENDING: 'ascending',
};

/**
 * Push-up detector class
 */
export class PushupDetector {
  constructor(options = {}) {
    this.thresholds = { ...PUSHUP_THRESHOLDS, ...options.thresholds };
    this.state = PushupState.IDLE;
    this.repCount = 0;
    this.currentRepStartTime = null;
    this.lastRepDuration = null;

    // Track angles during current rep
    this.currentRepMaxElbow = 0;    // Maximum (most extended)
    this.currentRepMinElbow = 180;  // Minimum (most bent)

    // Timing for anti-flicker
    this.descentStartTime = null;
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
   * Get average elbow angle (both arms should move together in push-up)
   */
  getElbowAngle(angles) {
    if (!angles) return null;
    const left = angles.leftElbow;
    const right = angles.rightElbow;

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
   * Check if person appears to be in a plank-like position
   * (This is a simple check - could be enhanced with hip/shoulder angles)
   */
  isInPlankPosition(angles) {
    // For now, just check if elbows are extended
    // Could add check for hip angle being relatively straight
    const elbowData = this.getElbowAngle(angles);
    return elbowData && elbowData.angle > this.thresholds.plankElbowMin;
  }

  /**
   * Update the detector with new pose data
   */
  update(angles, timestamp = Date.now()) {
    const elbowData = this.getElbowAngle(angles);

    if (!elbowData) {
      return this.getStatus();
    }

    const elbowAngle = elbowData.angle;
    const prevState = this.state;
    const t = this.thresholds;

    // State machine
    switch (this.state) {
      case PushupState.IDLE:
        // Transition to PLANK when arms are extended
        if (elbowAngle > t.plankElbowMin) {
          this.state = PushupState.PLANK;
          this.currentRepMaxElbow = elbowAngle;
        }
        break;

      case PushupState.PLANK:
        // Update max elbow angle
        this.currentRepMaxElbow = Math.max(this.currentRepMaxElbow, elbowAngle);

        // Detect start of descent
        if (elbowAngle < t.descendingElbowMax) {
          this.state = PushupState.DESCENDING;
          this.currentRepStartTime = timestamp;
          this.descentStartTime = timestamp;
          this.currentRepMinElbow = elbowAngle;
          this.reachedBottom = false;
        }
        break;

      case PushupState.DESCENDING:
        // Track minimum elbow angle
        this.currentRepMinElbow = Math.min(this.currentRepMinElbow, elbowAngle);

        // Check if at bottom
        if (elbowAngle < t.bottomElbowMax) {
          this.state = PushupState.BOTTOM;
          this.reachedBottom = true;
        } else if (elbowAngle > t.plankElbowMin) {
          // Went back to plank without reaching bottom - abort
          this.state = PushupState.PLANK;
          this.descentStartTime = null;
          this.currentRepMaxElbow = elbowAngle;
        }
        break;

      case PushupState.BOTTOM:
        // Track minimum angle
        this.currentRepMinElbow = Math.min(this.currentRepMinElbow, elbowAngle);

        // Detect start of ascent
        if (elbowAngle > t.ascendingElbowMin) {
          this.state = PushupState.ASCENDING;
        }
        break;

      case PushupState.ASCENDING:
        // Check if back to plank
        if (elbowAngle > t.plankElbowMin) {
          // Check timing and ROM constraints
          const descentDuration = this.descentStartTime ? timestamp - this.descentStartTime : 0;
          const timeSinceLastRep = this.lastRepCompletionTime
            ? timestamp - this.lastRepCompletionTime
            : Infinity;
          const rom = this.currentRepMaxElbow - this.currentRepMinElbow;

          const validRep = this.reachedBottom &&
                          descentDuration >= t.minDescentDuration &&
                          timeSinceLastRep >= t.repCooldown &&
                          rom >= t.minROM;

          if (validRep) {
            this.completeRep(timestamp);
          }

          this.state = PushupState.PLANK;
          this.descentStartTime = null;
          this.reachedBottom = false;
          this.currentRepMaxElbow = elbowAngle;
          this.currentRepMinElbow = 180;
        } else if (elbowAngle < t.bottomElbowMax) {
          // Going back down
          this.state = PushupState.BOTTOM;
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
    const depthScore = this.calculateDepthScore();

    const repData = {
      repNumber: this.repCount,
      duration: this.lastRepDuration,
      maxElbowAngle: this.currentRepMaxElbow,
      minElbowAngle: this.currentRepMinElbow,
      rangeOfMotion: rom,
      depthScore,
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
   * Calculate depth score (0-100) based on elbow bend
   */
  calculateDepthScore() {
    const elbowDepth = Math.max(0, 170 - this.currentRepMinElbow);
    // Full depth is about 80° (from 170° to 90°)
    return Math.min(100, Math.round((elbowDepth / 80) * 100));
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
    this.state = PushupState.IDLE;
    this.repCount = 0;
    this.currentRepStartTime = null;
    this.lastRepDuration = null;
    this.currentRepMaxElbow = 0;
    this.currentRepMinElbow = 180;
    this.descentStartTime = null;
    this.lastRepCompletionTime = null;
    this.reachedBottom = false;
    this.repHistory = [];
  }
}
