/**
 * MayaMind Exercise POC — Feature Extraction
 *
 * Converts pose landmarks to compact, invariant feature vectors
 * for similarity search.
 *
 * Features are designed to be:
 * - Scale invariant (normalized by torso length)
 * - Translation invariant (centered on hip midpoint)
 * - Partially rotation invariant (uses relative positions + angles)
 */

import { LANDMARKS, calculateJointAngles } from '../joints.js';

/**
 * Key landmarks for feature extraction
 * Uses BOTH sides - algorithm picks best visible or averages
 * Excludes face landmarks (too noisy, not relevant for exercise)
 */
const BODY_LANDMARKS = [
  LANDMARKS.LEFT_SHOULDER,
  LANDMARKS.RIGHT_SHOULDER,
  LANDMARKS.LEFT_ELBOW,
  LANDMARKS.RIGHT_ELBOW,
  LANDMARKS.LEFT_WRIST,
  LANDMARKS.RIGHT_WRIST,
  LANDMARKS.LEFT_HIP,
  LANDMARKS.RIGHT_HIP,
  LANDMARKS.LEFT_KNEE,
  LANDMARKS.RIGHT_KNEE,
  LANDMARKS.LEFT_ANKLE,
  LANDMARKS.RIGHT_ANKLE,
];

/**
 * Key angles to include in feature vector
 * Uses BOTH sides for robust detection regardless of orientation
 */
const KEY_ANGLES = [
  'leftKnee', 'rightKnee',
  'leftHip', 'rightHip',
  'leftElbow', 'rightElbow',
  'leftShoulder', 'rightShoulder',
];

/**
 * Extract feature vector from pose landmarks
 *
 * @param {Array} worldLandmarks - 3D world landmarks from MediaPipe
 * @param {Array} landmarks2D - 2D normalized landmarks (for visibility)
 * @param {number} visibilityThreshold - Minimum visibility to include landmark
 * @returns {Object} Feature vector with normalized positions and angles
 */
export function extractFeatures(worldLandmarks, landmarks2D = null, visibilityThreshold = 0.5) {
  if (!worldLandmarks || worldLandmarks.length < 33) {
    return null;
  }

  // Get hip center as origin
  const leftHip = worldLandmarks[LANDMARKS.LEFT_HIP];
  const rightHip = worldLandmarks[LANDMARKS.RIGHT_HIP];
  const hipCenter = {
    x: (leftHip.x + rightHip.x) / 2,
    y: (leftHip.y + rightHip.y) / 2,
    z: (leftHip.z + rightHip.z) / 2,
  };

  // Calculate torso length for scale normalization
  const leftShoulder = worldLandmarks[LANDMARKS.LEFT_SHOULDER];
  const rightShoulder = worldLandmarks[LANDMARKS.RIGHT_SHOULDER];
  const shoulderCenter = {
    x: (leftShoulder.x + rightShoulder.x) / 2,
    y: (leftShoulder.y + rightShoulder.y) / 2,
    z: (leftShoulder.z + rightShoulder.z) / 2,
  };

  const torsoLength = Math.sqrt(
    (shoulderCenter.x - hipCenter.x) ** 2 +
    (shoulderCenter.y - hipCenter.y) ** 2 +
    (shoulderCenter.z - hipCenter.z) ** 2
  );

  // Avoid division by zero
  const scale = torsoLength > 0.01 ? torsoLength : 1;

  // Extract normalized positions for key landmarks
  const positions = [];
  const visibility = [];

  for (const idx of BODY_LANDMARKS) {
    const lm = worldLandmarks[idx];
    const vis = landmarks2D?.[idx]?.visibility ?? 1;

    // Normalize: translate to hip center, scale by torso length
    positions.push(
      (lm.x - hipCenter.x) / scale,
      (lm.y - hipCenter.y) / scale,
      (lm.z - hipCenter.z) / scale
    );
    visibility.push(vis >= visibilityThreshold ? 1 : 0);
  }

  // Extract joint angles
  const angles = calculateJointAngles(worldLandmarks, visibilityThreshold);
  const angleValues = [];
  const angleVisibility = [];

  for (const key of KEY_ANGLES) {
    const joint = angles[key];
    if (joint) {
      // Normalize angle to 0-1 range (0° = 0, 180° = 1)
      angleValues.push(joint.angle / 180);
      angleVisibility.push(joint.visible ? 1 : 0);
    } else {
      angleValues.push(0.5); // Default to neutral
      angleVisibility.push(0);
    }
  }

  return {
    positions,           // 12 landmarks × 3 coords = 36 values
    positionVisibility: visibility,  // 12 values
    angles: angleValues, // 8 values
    angleVisibility,     // 8 values
    timestamp: Date.now(),
    hipCenter,           // For debugging/visualization
    scale,               // Torso length used for normalization
  };
}

/**
 * Convert feature object to flat array for DTW comparison
 *
 * @param {Object} features - Feature object from extractFeatures()
 * @param {Object} options - Which features to include
 * @returns {Array} Flat array of feature values
 */
export function featuresToVector(features, options = {}) {
  if (!features) return null;

  const {
    includePositions = true,
    includeAngles = true,
    weightPositions = 0.3,   // Reduced: positions similar across standing exercises
    weightAngles = 3.0,      // Increased: angles distinguish exercise types (was 1.5)
  } = options;

  const vector = [];

  if (includePositions) {
    for (let i = 0; i < features.positions.length; i++) {
      // Weight by visibility (invisible landmarks contribute less)
      const visIdx = Math.floor(i / 3);
      const vis = features.positionVisibility[visIdx];
      vector.push(features.positions[i] * weightPositions * vis);
    }
  }

  if (includeAngles) {
    for (let i = 0; i < features.angles.length; i++) {
      const vis = features.angleVisibility[i];
      vector.push(features.angles[i] * weightAngles * vis);
    }
  }

  return vector;
}

/**
 * Calculate Euclidean distance between two feature vectors
 *
 * @param {Array} v1 - First feature vector
 * @param {Array} v2 - Second feature vector
 * @returns {number} Euclidean distance
 */
export function vectorDistance(v1, v2) {
  if (!v1 || !v2 || v1.length !== v2.length) {
    return Infinity;
  }

  let sum = 0;
  for (let i = 0; i < v1.length; i++) {
    const diff = v1[i] - v2[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Get feature vector dimension
 */
export function getFeatureDimension(options = {}) {
  const { includePositions = true, includeAngles = true } = options;
  let dim = 0;
  if (includePositions) dim += BODY_LANDMARKS.length * 3; // 12 landmarks × 3 = 36
  if (includeAngles) dim += KEY_ANGLES.length; // 8 angles
  return dim; // Total: 44
}

/**
 * Feature sequence class for recording and playback
 */
export class FeatureSequence {
  constructor() {
    this.frames = [];
    this.startTime = null;
    this.metadata = {};
  }

  /**
   * Add a frame to the sequence
   */
  addFrame(worldLandmarks, landmarks2D = null) {
    const features = extractFeatures(worldLandmarks, landmarks2D);
    if (!features) return false;

    if (this.startTime === null) {
      this.startTime = features.timestamp;
    }

    const vector = featuresToVector(features);
    if (!vector) return false;

    this.frames.push({
      vector,
      timestamp: features.timestamp,
      elapsed: features.timestamp - this.startTime,
      angles: features.angles,
      scale: features.scale,
    });

    return true;
  }

  /**
   * Get all vectors as 2D array (for DTW)
   */
  getVectors() {
    return this.frames.map(f => f.vector);
  }

  /**
   * Get sequence duration in ms
   */
  getDuration() {
    if (this.frames.length < 2) return 0;
    return this.frames[this.frames.length - 1].elapsed;
  }

  /**
   * Get frame count
   */
  getFrameCount() {
    return this.frames.length;
  }

  /**
   * Subsample sequence to target frame count
   * Useful for reducing DTW computation
   */
  subsample(targetFrames) {
    if (this.frames.length <= targetFrames) {
      return this.frames.map(f => f.vector);
    }

    const step = this.frames.length / targetFrames;
    const result = [];
    for (let i = 0; i < targetFrames; i++) {
      const idx = Math.floor(i * step);
      result.push(this.frames[idx].vector);
    }
    return result;
  }

  /**
   * Export to JSON-serializable object
   */
  toJSON() {
    return {
      frames: this.frames,
      startTime: this.startTime,
      metadata: this.metadata,
      duration: this.getDuration(),
      frameCount: this.getFrameCount(),
    };
  }

  /**
   * Import from JSON object
   */
  static fromJSON(json) {
    const seq = new FeatureSequence();
    seq.frames = json?.frames || [];
    seq.startTime = json?.startTime || null;
    seq.metadata = json?.metadata || {};

    // Debug logging
    if (seq.frames.length === 0) {
      console.warn('[FeatureSequence.fromJSON] No frames in sequence! json:', json);
    }

    return seq;
  }

  /**
   * Clear the sequence
   */
  clear() {
    this.frames = [];
    this.startTime = null;
  }
}
