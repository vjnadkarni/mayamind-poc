//
//  BicepsCurlDetector.swift
//  MayaMind
//
//  State machine for detecting and counting biceps curl repetitions.
//  Ported from exercise-poc/exercises/bicepsCurl.js
//

import Foundation

/// Biceps curl detection thresholds
struct BicepsCurlThresholds {
    // Extended position (arm straight)
    var extendedMin: Float = 130

    // Flexed position (arm curled)
    var flexedMax: Float = 80

    // Transition thresholds
    var flexingMax: Float = 120
    var extendingMin: Float = 100

    // Timing thresholds
    var minFlexDuration: TimeInterval = 0.15
    var repCooldown: TimeInterval = 0.5

    // Minimum range of motion
    var minROM: Float = 35

    // Cross-joint validation (reject if legs moving = squat/lunge)
    var maxKneeChange: Float = 25
    var maxHipChange: Float = 25
}

/// Biceps curl states
enum BicepsCurlState: String {
    case idle
    case extended
    case flexing
    case flexed
    case extending
}

/// Biceps curl detector
class BicepsCurlDetector: ExerciseDetectorProtocol {
    var state: String { curlState.rawValue }
    private(set) var repCount: Int = 0
    var orientation: UserOrientation { .unknown }

    var onRepComplete: ((RepData) -> Void)?
    var onStateChange: ((String, String) -> Void)?

    private var curlState: BicepsCurlState = .idle
    private let thresholds: BicepsCurlThresholds

    // Rep tracking
    private var currentRepStartTime: Date?
    private var lastRepDuration: TimeInterval?
    private var currentRepMaxElbow: Float = 0
    private var currentRepMinElbow: Float = 180

    // Cross-joint validation
    private var repStartKnee: Float?
    private var repStartHip: Float?
    private var repMinKnee: Float = 180
    private var repMinHip: Float = 180

    // Timing
    private var flexStartTime: Date?
    private var lastRepCompletionTime: Date?
    private var reachedFlexed = false

    // Rep history
    private var repHistory: [RepData] = []
    private let maxHistoryLength = 20

    init(thresholds: BicepsCurlThresholds = BicepsCurlThresholds()) {
        self.thresholds = thresholds
    }

    /// Get the best available elbow angle
    private func getBestElbowAngle(angles: JointAngleResult) -> (angle: Float, side: String)? {
        let left = angles.leftElbow
        let right = angles.rightElbow

        if left.visible && right.visible, let leftAngle = left.angle, let rightAngle = right.angle {
            let diff = abs(leftAngle - rightAngle)
            if diff < 20 {
                return ((leftAngle + rightAngle) / 2, "both")
            }
            return leftAngle < rightAngle
                ? (leftAngle, "left")
                : (rightAngle, "right")
        } else if left.visible, let leftAngle = left.angle {
            return (leftAngle, "left")
        } else if right.visible, let rightAngle = right.angle {
            return (rightAngle, "right")
        }
        return nil
    }

    private func getBestKneeAngle(angles: JointAngleResult) -> Float? {
        let left = angles.leftKnee
        let right = angles.rightKnee

        if left.visible && right.visible, let l = left.angle, let r = right.angle {
            return (l + r) / 2
        } else if left.visible, let l = left.angle {
            return l
        } else if right.visible, let r = right.angle {
            return r
        }
        return nil
    }

    private func getBestHipAngle(angles: JointAngleResult) -> Float? {
        let left = angles.leftHip
        let right = angles.rightHip

        if left.visible && right.visible, let l = left.angle, let r = right.angle {
            return (l + r) / 2
        } else if left.visible, let l = left.angle {
            return l
        } else if right.visible, let r = right.angle {
            return r
        }
        return nil
    }

    func update(angles: JointAngleResult, landmarks2D: [Point3D]?, timestamp: Date) -> ExerciseStatus {
        guard let elbowData = getBestElbowAngle(angles: angles) else {
            return getStatus()
        }

        let elbowAngle = elbowData.angle
        let kneeAngle = getBestKneeAngle(angles: angles)
        let hipAngle = getBestHipAngle(angles: angles)
        let prevState = curlState
        let t = thresholds

        switch curlState {
        case .idle:
            if elbowAngle > t.extendedMin {
                curlState = .extended
                currentRepMaxElbow = elbowAngle
            }

        case .extended:
            currentRepMaxElbow = max(currentRepMaxElbow, elbowAngle)

            if elbowAngle < t.flexingMax {
                curlState = .flexing
                currentRepStartTime = timestamp
                flexStartTime = timestamp
                currentRepMinElbow = elbowAngle
                reachedFlexed = false

                repStartKnee = kneeAngle
                repStartHip = hipAngle
                repMinKnee = kneeAngle ?? 180
                repMinHip = hipAngle ?? 180
            }

        case .flexing:
            currentRepMinElbow = min(currentRepMinElbow, elbowAngle)

            if let knee = kneeAngle { repMinKnee = min(repMinKnee, knee) }
            if let hip = hipAngle { repMinHip = min(repMinHip, hip) }

            if elbowAngle < t.flexedMax {
                curlState = .flexed
                reachedFlexed = true
            } else if elbowAngle > t.extendedMin {
                curlState = .extended
                flexStartTime = nil
                currentRepMaxElbow = elbowAngle
            }

        case .flexed:
            currentRepMinElbow = min(currentRepMinElbow, elbowAngle)

            if let knee = kneeAngle { repMinKnee = min(repMinKnee, knee) }
            if let hip = hipAngle { repMinHip = min(repMinHip, hip) }

            if elbowAngle > t.extendingMin {
                curlState = .extending
            }

        case .extending:
            if let knee = kneeAngle { repMinKnee = min(repMinKnee, knee) }
            if let hip = hipAngle { repMinHip = min(repMinHip, hip) }

            if elbowAngle > t.extendedMin {
                let flexDuration = flexStartTime.map { timestamp.timeIntervalSince($0) } ?? 0
                let timeSinceLastRep = lastRepCompletionTime.map { timestamp.timeIntervalSince($0) } ?? .infinity
                let rom = currentRepMaxElbow - currentRepMinElbow

                // Cross-joint validation
                let kneeChange: Float
                if let startKnee = repStartKnee, repMinKnee < 180 {
                    kneeChange = startKnee - repMinKnee
                } else {
                    kneeChange = 0
                }

                let hipChange: Float
                if let startHip = repStartHip, repMinHip < 180 {
                    hipChange = startHip - repMinHip
                } else {
                    hipChange = 0
                }

                let legsStable = kneeChange <= t.maxKneeChange && hipChange <= t.maxHipChange

                let validRep = reachedFlexed &&
                               flexDuration >= t.minFlexDuration &&
                               timeSinceLastRep >= t.repCooldown &&
                               rom >= t.minROM &&
                               legsStable

                if validRep {
                    completeRep(timestamp: timestamp)
                }

                curlState = .extended
                flexStartTime = nil
                reachedFlexed = false
                currentRepMaxElbow = elbowAngle
                currentRepMinElbow = 180
                repStartKnee = nil
                repStartHip = nil
                repMinKnee = 180
                repMinHip = 180
            } else if elbowAngle < t.flexedMax {
                curlState = .flexed
            }
        }

        if curlState != prevState {
            onStateChange?(curlState.rawValue, prevState.rawValue)
        }

        return getStatus()
    }

    private func completeRep(timestamp: Date) {
        repCount += 1
        lastRepCompletionTime = timestamp
        lastRepDuration = currentRepStartTime.map { timestamp.timeIntervalSince($0) }

        let rom = currentRepMaxElbow - currentRepMinElbow
        let romScore = min(100, Int((rom / 110) * 100))

        let repData = RepData(
            repNumber: repCount,
            duration: lastRepDuration,
            minHipAngle: nil,
            minKneeAngle: nil,
            minElbowAngle: currentRepMinElbow < 180 ? currentRepMinElbow : nil,
            depthScore: romScore,
            orientation: orientation,
            timestamp: timestamp
        )

        repHistory.append(repData)
        if repHistory.count > maxHistoryLength {
            repHistory.removeFirst()
        }

        onRepComplete?(repData)
    }

    func getStatus() -> ExerciseStatus {
        return ExerciseStatus(
            state: state,
            repCount: repCount,
            orientation: orientation,
            lastRepDuration: lastRepDuration,
            currentRepMinHip: nil,
            currentRepMinKnee: nil,
            currentRepMinElbow: currentRepMinElbow < 180 ? currentRepMinElbow : nil,
            repHistory: repHistory
        )
    }

    func reset() {
        curlState = .idle
        repCount = 0
        currentRepStartTime = nil
        lastRepDuration = nil
        currentRepMaxElbow = 0
        currentRepMinElbow = 180
        repStartKnee = nil
        repStartHip = nil
        repMinKnee = 180
        repMinHip = 180
        flexStartTime = nil
        lastRepCompletionTime = nil
        reachedFlexed = false
        repHistory = []
    }
}
