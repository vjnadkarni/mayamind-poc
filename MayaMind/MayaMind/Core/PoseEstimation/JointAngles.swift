//
//  JointAngles.swift
//  MayaMind
//
//  MediaPipe Pose Landmarker indices and joint angle calculations.
//  Ported from exercise-poc/joints.js
//

import Foundation

/// MediaPipe Pose Landmarker indices (33 landmarks)
/// Reference: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker
enum PoseLandmark: Int, CaseIterable {
    // Face
    case nose = 0
    case leftEyeInner = 1
    case leftEye = 2
    case leftEyeOuter = 3
    case rightEyeInner = 4
    case rightEye = 5
    case rightEyeOuter = 6
    case leftEar = 7
    case rightEar = 8
    case mouthLeft = 9
    case mouthRight = 10

    // Upper body
    case leftShoulder = 11
    case rightShoulder = 12
    case leftElbow = 13
    case rightElbow = 14
    case leftWrist = 15
    case rightWrist = 16
    case leftPinky = 17
    case rightPinky = 18
    case leftIndex = 19
    case rightIndex = 20
    case leftThumb = 21
    case rightThumb = 22

    // Lower body
    case leftHip = 23
    case rightHip = 24
    case leftKnee = 25
    case rightKnee = 26
    case leftAnkle = 27
    case rightAnkle = 28
    case leftHeel = 29
    case rightHeel = 30
    case leftFootIndex = 31
    case rightFootIndex = 32
}

/// Joint angle definition: three landmarks forming an angle at the middle point
struct JointAngleDefinition {
    let name: String
    let landmarks: (PoseLandmark, PoseLandmark, PoseLandmark)  // A, B (vertex), C
}

/// Joint angle definitions for exercise detection
enum JointAngles {
    static let leftKnee = JointAngleDefinition(
        name: "Left Knee",
        landmarks: (.leftHip, .leftKnee, .leftAnkle)
    )

    static let rightKnee = JointAngleDefinition(
        name: "Right Knee",
        landmarks: (.rightHip, .rightKnee, .rightAnkle)
    )

    static let leftHip = JointAngleDefinition(
        name: "Left Hip",
        landmarks: (.leftShoulder, .leftHip, .leftKnee)
    )

    static let rightHip = JointAngleDefinition(
        name: "Right Hip",
        landmarks: (.rightShoulder, .rightHip, .rightKnee)
    )

    static let leftElbow = JointAngleDefinition(
        name: "Left Elbow",
        landmarks: (.leftShoulder, .leftElbow, .leftWrist)
    )

    static let rightElbow = JointAngleDefinition(
        name: "Right Elbow",
        landmarks: (.rightShoulder, .rightElbow, .rightWrist)
    )

    static let leftShoulder = JointAngleDefinition(
        name: "Left Shoulder",
        landmarks: (.leftElbow, .leftShoulder, .leftHip)
    )

    static let rightShoulder = JointAngleDefinition(
        name: "Right Shoulder",
        landmarks: (.rightElbow, .rightShoulder, .rightHip)
    )

    static let all: [String: JointAngleDefinition] = [
        "leftKnee": leftKnee,
        "rightKnee": rightKnee,
        "leftHip": leftHip,
        "rightHip": rightHip,
        "leftElbow": leftElbow,
        "rightElbow": rightElbow,
        "leftShoulder": leftShoulder,
        "rightShoulder": rightShoulder
    ]
}

/// Skeleton connections for drawing overlay
/// Each pair is (startLandmarkIndex, endLandmarkIndex)
let skeletonConnections: [(PoseLandmark, PoseLandmark)] = [
    // Torso
    (.leftShoulder, .rightShoulder),
    (.leftShoulder, .leftHip),
    (.rightShoulder, .rightHip),
    (.leftHip, .rightHip),

    // Left arm
    (.leftShoulder, .leftElbow),
    (.leftElbow, .leftWrist),

    // Right arm
    (.rightShoulder, .rightElbow),
    (.rightElbow, .rightWrist),

    // Left leg
    (.leftHip, .leftKnee),
    (.leftKnee, .leftAnkle),

    // Right leg
    (.rightHip, .rightKnee),
    (.rightKnee, .rightAnkle),

    // Face (simplified)
    (.leftEar, .leftEye),
    (.rightEar, .rightEye),
    (.leftEye, .nose),
    (.rightEye, .nose)
]

/// Computed joint angle with visibility info
struct ComputedAngle {
    let angle: Float?
    let visible: Bool
    let visibility: Float
}

/// Result of calculating all joint angles
struct JointAngleResult {
    var leftKnee: ComputedAngle
    var rightKnee: ComputedAngle
    var leftHip: ComputedAngle
    var rightHip: ComputedAngle
    var leftElbow: ComputedAngle
    var rightElbow: ComputedAngle
    var leftShoulder: ComputedAngle
    var rightShoulder: ComputedAngle

    static let empty = JointAngleResult(
        leftKnee: ComputedAngle(angle: nil, visible: false, visibility: 0),
        rightKnee: ComputedAngle(angle: nil, visible: false, visibility: 0),
        leftHip: ComputedAngle(angle: nil, visible: false, visibility: 0),
        rightHip: ComputedAngle(angle: nil, visible: false, visibility: 0),
        leftElbow: ComputedAngle(angle: nil, visible: false, visibility: 0),
        rightElbow: ComputedAngle(angle: nil, visible: false, visibility: 0),
        leftShoulder: ComputedAngle(angle: nil, visible: false, visibility: 0),
        rightShoulder: ComputedAngle(angle: nil, visible: false, visibility: 0)
    )
}

/// Joint angle calculator
class JointAngleCalculator {
    private let visibilityThreshold: Float

    init(visibilityThreshold: Float = 0.5) {
        self.visibilityThreshold = visibilityThreshold
    }

    /// Calculate all joint angles from 3D world landmarks
    ///
    /// - Parameter worldLandmarks: MediaPipe worldLandmarks array (33 landmarks in 3D metric coordinates)
    /// - Returns: Joint angles in degrees
    func calculateJointAngles(worldLandmarks: [Point3D]) -> JointAngleResult? {
        guard worldLandmarks.count >= 33 else { return nil }

        return JointAngleResult(
            leftKnee: calculateAngle(JointAngles.leftKnee, landmarks: worldLandmarks),
            rightKnee: calculateAngle(JointAngles.rightKnee, landmarks: worldLandmarks),
            leftHip: calculateAngle(JointAngles.leftHip, landmarks: worldLandmarks),
            rightHip: calculateAngle(JointAngles.rightHip, landmarks: worldLandmarks),
            leftElbow: calculateAngle(JointAngles.leftElbow, landmarks: worldLandmarks),
            rightElbow: calculateAngle(JointAngles.rightElbow, landmarks: worldLandmarks),
            leftShoulder: calculateAngle(JointAngles.leftShoulder, landmarks: worldLandmarks),
            rightShoulder: calculateAngle(JointAngles.rightShoulder, landmarks: worldLandmarks)
        )
    }

    private func calculateAngle(_ definition: JointAngleDefinition, landmarks: [Point3D]) -> ComputedAngle {
        let (aIdx, bIdx, cIdx) = definition.landmarks
        let a = landmarks[aIdx.rawValue]
        let b = landmarks[bIdx.rawValue]
        let c = landmarks[cIdx.rawValue]

        // Get minimum visibility of all three landmarks
        let minVisibility = min(a.visibility, b.visibility, c.visibility)

        // Check visibility of all three landmarks
        let allVisible = VectorMath.isLandmarkVisible(a.visibility, threshold: visibilityThreshold)
            && VectorMath.isLandmarkVisible(b.visibility, threshold: visibilityThreshold)
            && VectorMath.isLandmarkVisible(c.visibility, threshold: visibilityThreshold)

        if allVisible {
            let angle = VectorMath.angleBetweenPoints(a, b, c)
            return ComputedAngle(angle: angle, visible: true, visibility: minVisibility)
        } else {
            return ComputedAngle(angle: nil, visible: false, visibility: minVisibility)
        }
    }
}

/// Smoother class for maintaining smoothed joint angle history
class AngleSmoother {
    private let alpha: Float
    private var smoothedAngles: JointAngleResult?

    init(alpha: Float = 0.3) {
        self.alpha = alpha
    }

    /// Update smoothed values with new raw angles
    func update(_ rawAngles: JointAngleResult) -> JointAngleResult {
        guard let prev = smoothedAngles else {
            smoothedAngles = rawAngles
            return rawAngles
        }

        let result = JointAngleResult(
            leftKnee: smoothAngle(rawAngles.leftKnee, prev.leftKnee),
            rightKnee: smoothAngle(rawAngles.rightKnee, prev.rightKnee),
            leftHip: smoothAngle(rawAngles.leftHip, prev.leftHip),
            rightHip: smoothAngle(rawAngles.rightHip, prev.rightHip),
            leftElbow: smoothAngle(rawAngles.leftElbow, prev.leftElbow),
            rightElbow: smoothAngle(rawAngles.rightElbow, prev.rightElbow),
            leftShoulder: smoothAngle(rawAngles.leftShoulder, prev.leftShoulder),
            rightShoulder: smoothAngle(rawAngles.rightShoulder, prev.rightShoulder)
        )

        smoothedAngles = result
        return result
    }

    private func smoothAngle(_ raw: ComputedAngle, _ prev: ComputedAngle) -> ComputedAngle {
        if raw.visible, let rawAngle = raw.angle {
            let smoothed = VectorMath.exponentialSmooth(rawAngle, prev.angle, alpha: alpha)
            return ComputedAngle(angle: smoothed, visible: true, visibility: raw.visibility)
        } else {
            // Keep previous value but mark as not currently visible
            return ComputedAngle(angle: prev.angle, visible: false, visibility: raw.visibility)
        }
    }

    func reset() {
        smoothedAngles = nil
    }
}
