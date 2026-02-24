/**
 * MayaMind Exercise POC — Vector Math Utilities
 *
 * Functions for 3D vector operations used in joint angle calculations.
 */

/**
 * Subtract two 3D points: a - b
 * @param {{x: number, y: number, z: number}} a
 * @param {{x: number, y: number, z: number}} b
 * @returns {{x: number, y: number, z: number}}
 */
export function subtract(a, b) {
  return {
    x: a.x - b.x,
    y: a.y - b.y,
    z: a.z - b.z,
  };
}

/**
 * Dot product of two 3D vectors
 * @param {{x: number, y: number, z: number}} a
 * @param {{x: number, y: number, z: number}} b
 * @returns {number}
 */
export function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/**
 * Magnitude (length) of a 3D vector
 * @param {{x: number, y: number, z: number}} v
 * @returns {number}
 */
export function magnitude(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

/**
 * Calculate angle at vertex B formed by points A-B-C (in degrees)
 *
 * This computes the angle ∠ABC where B is the vertex (joint).
 * Uses the dot product formula: cos(θ) = (BA · BC) / (|BA| × |BC|)
 *
 * @param {{x: number, y: number, z: number}} a - First point (e.g., hip)
 * @param {{x: number, y: number, z: number}} b - Vertex/joint (e.g., knee)
 * @param {{x: number, y: number, z: number}} c - Third point (e.g., ankle)
 * @returns {number} Angle in degrees (0-180)
 */
export function angleBetweenPoints(a, b, c) {
  const ba = subtract(a, b);
  const bc = subtract(c, b);

  const dotProduct = dot(ba, bc);
  const magBA = magnitude(ba);
  const magBC = magnitude(bc);

  // Avoid division by zero
  if (magBA === 0 || magBC === 0) return 0;

  // Clamp to [-1, 1] to handle floating point errors
  const cosAngle = Math.max(-1, Math.min(1, dotProduct / (magBA * magBC)));

  // Convert to degrees
  const angleRad = Math.acos(cosAngle);
  return angleRad * (180 / Math.PI);
}

/**
 * Simple exponential moving average smoother
 *
 * @param {number} newValue - New incoming value
 * @param {number} prevSmoothed - Previous smoothed value
 * @param {number} alpha - Smoothing factor (0-1). Lower = more smoothing.
 * @returns {number}
 */
export function exponentialSmooth(newValue, prevSmoothed, alpha = 0.3) {
  if (prevSmoothed === null || prevSmoothed === undefined || isNaN(prevSmoothed)) {
    return newValue;
  }
  return alpha * newValue + (1 - alpha) * prevSmoothed;
}

/**
 * Check if a landmark has sufficient visibility/confidence
 *
 * @param {{visibility?: number}} landmark
 * @param {number} threshold - Minimum visibility (0-1)
 * @returns {boolean}
 */
export function isLandmarkVisible(landmark, threshold = 0.5) {
  if (!landmark) return false;
  // MediaPipe provides visibility score 0-1
  return (landmark.visibility ?? 1) >= threshold;
}

/**
 * Format angle for display
 * @param {number|null} angle
 * @returns {string}
 */
export function formatAngle(angle) {
  if (angle === null || angle === undefined || isNaN(angle)) {
    return '--°';
  }
  return `${Math.round(angle)}°`;
}
