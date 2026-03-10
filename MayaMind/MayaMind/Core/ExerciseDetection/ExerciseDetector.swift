//
//  ExerciseDetector.swift
//  MayaMind
//
//  Protocol and base types for exercise detection.
//

import Foundation

/// User orientation relative to camera
enum UserOrientation: String {
    case unknown
    case frontal
    case sagittal
    case oblique
}

/// Rep quality data
struct RepData {
    let repNumber: Int
    let duration: TimeInterval?
    let minHipAngle: Float?
    let minKneeAngle: Float?
    let minElbowAngle: Float?
    let depthScore: Int
    let orientation: UserOrientation
    let timestamp: Date
}

/// Exercise detection status
struct ExerciseStatus {
    let state: String
    let repCount: Int
    let orientation: UserOrientation
    let lastRepDuration: TimeInterval?
    let currentRepMinHip: Float?
    let currentRepMinKnee: Float?
    let currentRepMinElbow: Float?
    let repHistory: [RepData]
}

/// Protocol for exercise detectors
protocol ExerciseDetectorProtocol: AnyObject {
    /// Current state of the detector
    var state: String { get }

    /// Number of completed reps
    var repCount: Int { get }

    /// Detected user orientation
    var orientation: UserOrientation { get }

    /// Callback when a rep is completed
    var onRepComplete: ((RepData) -> Void)? { get set }

    /// Callback when state changes
    var onStateChange: ((String, String) -> Void)? { get set }

    /// Update with new pose data
    /// - Parameters:
    ///   - angles: Joint angles from pose estimation
    ///   - landmarks2D: 2D landmarks for orientation detection and hip Y tracking
    ///   - timestamp: Current timestamp
    /// - Returns: Current status
    func update(angles: JointAngleResult, landmarks2D: [Point3D]?, timestamp: Date) -> ExerciseStatus

    /// Reset the detector
    func reset()

    /// Get current status
    func getStatus() -> ExerciseStatus
}

/// Base class for orientation detection (shared across all detectors)
class OrientationDetector {
    private var orientationHistory: [Float] = []
    private let orientationWindowSize = 30
    private let visibilityDiffThreshold: Float = 0.25

    var orientation: UserOrientation = .unknown

    /// Detect user orientation based on landmark visibility
    func detectOrientation(landmarks: [Point3D]) -> UserOrientation {
        guard landmarks.count >= 33 else { return orientation }

        let leftIndices = [
            PoseLandmark.leftShoulder.rawValue,
            PoseLandmark.leftHip.rawValue,
            PoseLandmark.leftKnee.rawValue,
            PoseLandmark.leftAnkle.rawValue
        ]
        let rightIndices = [
            PoseLandmark.rightShoulder.rawValue,
            PoseLandmark.rightHip.rawValue,
            PoseLandmark.rightKnee.rawValue,
            PoseLandmark.rightAnkle.rawValue
        ]

        var leftVis: Float = 0
        var rightVis: Float = 0

        for idx in leftIndices {
            leftVis += landmarks[idx].visibility
        }
        for idx in rightIndices {
            rightVis += landmarks[idx].visibility
        }

        leftVis /= Float(leftIndices.count)
        rightVis /= Float(rightIndices.count)

        let diff = abs(leftVis - rightVis)

        // Add to rolling window
        orientationHistory.append(diff)
        if orientationHistory.count > orientationWindowSize {
            orientationHistory.removeFirst()
        }

        // Need enough samples for stable detection
        guard orientationHistory.count >= 10 else { return orientation }

        // Average over window
        let avgDiff = orientationHistory.reduce(0, +) / Float(orientationHistory.count)

        let newOrientation: UserOrientation
        if avgDiff > visibilityDiffThreshold {
            newOrientation = .sagittal
        } else if avgDiff < visibilityDiffThreshold * 0.4 {
            newOrientation = .frontal
        } else {
            newOrientation = .oblique
        }

        orientation = newOrientation
        return newOrientation
    }

    func reset() {
        orientationHistory = []
        orientation = .unknown
    }
}
