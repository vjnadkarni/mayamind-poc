/**
 * MayaMind Exercise POC — Joint Mapping and Angle Calculation
 *
 * Maps MediaPipe Pose Landmarker indices to named joints,
 * and calculates joint angles from 3D world landmarks.
 */

import { angleBetweenPoints, isLandmarkVisible, exponentialSmooth } from './utils.js';

/**
 * MediaPipe Pose Landmarker indices (33 landmarks)
 * Reference: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
 */
export const LANDMARKS = {
  // Face
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,

  // Upper body
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,

  // Lower body
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
};

/**
 * Joint angle definitions
 *
 * Each joint angle is defined by three landmarks: [A, B, C]
 * where B is the joint (vertex) and the angle is ∠ABC.
 */
export const JOINT_ANGLES = {
  leftKnee: {
    name: 'Left Knee',
    landmarks: [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE],
  },
  rightKnee: {
    name: 'Right Knee',
    landmarks: [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE],
  },
  leftHip: {
    name: 'Left Hip',
    landmarks: [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE],
  },
  rightHip: {
    name: 'Right Hip',
    landmarks: [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE],
  },
  leftElbow: {
    name: 'Left Elbow',
    landmarks: [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST],
  },
  rightElbow: {
    name: 'Right Elbow',
    landmarks: [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST],
  },
  leftShoulder: {
    name: 'Left Shoulder',
    landmarks: [LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
  },
  rightShoulder: {
    name: 'Right Shoulder',
    landmarks: [LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
  },
};

/**
 * Skeleton connections for drawing overlay
 * Each pair is [startLandmarkIndex, endLandmarkIndex]
 */
export const SKELETON_CONNECTIONS = [
  // Torso
  [LANDMARKS.LEFT_SHOULDER, LANDMARKS.RIGHT_SHOULDER],
  [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_HIP],
  [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_HIP],
  [LANDMARKS.LEFT_HIP, LANDMARKS.RIGHT_HIP],

  // Left arm
  [LANDMARKS.LEFT_SHOULDER, LANDMARKS.LEFT_ELBOW],
  [LANDMARKS.LEFT_ELBOW, LANDMARKS.LEFT_WRIST],

  // Right arm
  [LANDMARKS.RIGHT_SHOULDER, LANDMARKS.RIGHT_ELBOW],
  [LANDMARKS.RIGHT_ELBOW, LANDMARKS.RIGHT_WRIST],

  // Left leg
  [LANDMARKS.LEFT_HIP, LANDMARKS.LEFT_KNEE],
  [LANDMARKS.LEFT_KNEE, LANDMARKS.LEFT_ANKLE],

  // Right leg
  [LANDMARKS.RIGHT_HIP, LANDMARKS.RIGHT_KNEE],
  [LANDMARKS.RIGHT_KNEE, LANDMARKS.RIGHT_ANKLE],

  // Face (simplified)
  [LANDMARKS.LEFT_EAR, LANDMARKS.LEFT_EYE],
  [LANDMARKS.RIGHT_EAR, LANDMARKS.RIGHT_EYE],
  [LANDMARKS.LEFT_EYE, LANDMARKS.NOSE],
  [LANDMARKS.RIGHT_EYE, LANDMARKS.NOSE],
];

/**
 * Calculate all joint angles from 3D world landmarks
 *
 * @param {Array<{x: number, y: number, z: number, visibility?: number}>} worldLandmarks
 *        MediaPipe worldLandmarks array (33 landmarks in 3D metric coordinates)
 * @param {number} visibilityThreshold - Minimum visibility to consider landmark valid
 * @returns {Object} Joint angles in degrees, keyed by joint name
 */
export function calculateJointAngles(worldLandmarks, visibilityThreshold = 0.5) {
  if (!worldLandmarks || worldLandmarks.length < 33) {
    return null;
  }

  const angles = {};

  for (const [jointKey, jointDef] of Object.entries(JOINT_ANGLES)) {
    const [aIdx, bIdx, cIdx] = jointDef.landmarks;
    const a = worldLandmarks[aIdx];
    const b = worldLandmarks[bIdx];
    const c = worldLandmarks[cIdx];

    // Get visibility scores for all three landmarks
    const visA = a.visibility ?? 0;
    const visB = b.visibility ?? 0;
    const visC = c.visibility ?? 0;
    const minVisibility = Math.min(visA, visB, visC);

    // Check visibility of all three landmarks
    const allVisible =
      isLandmarkVisible(a, visibilityThreshold) &&
      isLandmarkVisible(b, visibilityThreshold) &&
      isLandmarkVisible(c, visibilityThreshold);

    if (allVisible) {
      angles[jointKey] = {
        angle: angleBetweenPoints(a, b, c),
        visible: true,
        visibility: minVisibility,
      };
    } else {
      angles[jointKey] = {
        angle: null,
        visible: false,
        visibility: minVisibility,
      };
    }
  }

  return angles;
}

/**
 * Smoother class for maintaining smoothed joint angle history
 */
export class AngleSmoother {
  constructor(alpha = 0.3) {
    this.alpha = alpha;
    this.smoothed = {};
  }

  /**
   * Update smoothed values with new raw angles
   * @param {Object} rawAngles - Output from calculateJointAngles()
   * @returns {Object} Smoothed angles
   */
  update(rawAngles) {
    if (!rawAngles) return this.smoothed;

    for (const [jointKey, data] of Object.entries(rawAngles)) {
      if (data.visible && data.angle !== null) {
        this.smoothed[jointKey] = {
          angle: exponentialSmooth(data.angle, this.smoothed[jointKey]?.angle, this.alpha),
          visible: true,
          visibility: data.visibility,
        };
      } else {
        // Keep previous value but mark as not currently visible
        if (this.smoothed[jointKey]) {
          this.smoothed[jointKey].visible = false;
          this.smoothed[jointKey].visibility = data.visibility;
        } else {
          this.smoothed[jointKey] = {
            angle: null,
            visible: false,
            visibility: data.visibility,
          };
        }
      }
    }

    return this.smoothed;
  }

  /**
   * Reset all smoothed values
   */
  reset() {
    this.smoothed = {};
  }
}

/**
 * Get a flat array of angle values for a given frame
 * Useful for building feature vectors for exercise recognition
 *
 * @param {Object} angles - Joint angles object
 * @returns {number[]} Array of angle values in consistent order
 */
export function anglesToVector(angles) {
  const keys = Object.keys(JOINT_ANGLES).sort();
  return keys.map(key => {
    const data = angles[key];
    return (data && data.visible && data.angle !== null) ? data.angle : 0;
  });
}

/**
 * Get ordered joint keys (for interpreting angle vectors)
 * @returns {string[]}
 */
export function getJointKeys() {
  return Object.keys(JOINT_ANGLES).sort();
}
