//
//  LungeDetector.swift
//  MayaMind
//
//  State machine for detecting and counting lunge repetitions.
//  Ported from exercise-poc/exercises/lunge.js
//

import Foundation

/// Lunge detection thresholds
struct LungeThresholds {
    // Standing position
    var standingKneeMin: Float = 155

    // Bottom position (front leg bent)
    var bottomKneeMax: Float = 115

    // Transition thresholds
    var lungingKneeMax: Float = 145
    var risingKneeMin: Float = 125

    // Hip angle (helps distinguish from squat)
    var hipForwardMax: Float = 140

    // Timing thresholds
    var minLungeDuration: TimeInterval = 0.3
    var repCooldown: TimeInterval = 0.5

    // Minimum range of motion
    var minROM: Float = 35
}

/// Lunge states
enum LungeState: String {
    case idle
    case standing
    case lunging
    case bottom
    case rising
}

/// Lunge detector
class LungeDetector: ExerciseDetectorProtocol {
    var state: String { lungeState.rawValue }
    private(set) var repCount: Int = 0
    var orientation: UserOrientation { .unknown }

    var onRepComplete: ((RepData) -> Void)?
    var onStateChange: ((String, String) -> Void)?

    private var lungeState: LungeState = .idle
    private let thresholds: LungeThresholds

    // Rep tracking
    private var currentRepStartTime: Date?
    private var lastRepDuration: TimeInterval?
    private var currentRepMaxKnee: Float = 0
    private var currentRepMinKnee: Float = 180
    private var activeLeg: String?

    // Timing
    private var lungeStartTime: Date?
    private var lastRepCompletionTime: Date?
    private var reachedBottom = false

    // Rep history
    private var repHistory: [RepData] = []
    private let maxHistoryLength = 20

    init(thresholds: LungeThresholds = LungeThresholds()) {
        self.thresholds = thresholds
    }

    /// Get the knee angle that's bending more (the leg doing the lunge)
    private func getBendingKneeAngle(angles: JointAngleResult) -> (angle: Float, side: String, otherAngle: Float?)? {
        let left = angles.leftKnee
        let right = angles.rightKnee

        if left.visible && right.visible, let leftAngle = left.angle, let rightAngle = right.angle {
            if leftAngle < rightAngle {
                return (leftAngle, "left", rightAngle)
            } else {
                return (rightAngle, "right", leftAngle)
            }
        } else if left.visible, let leftAngle = left.angle {
            return (leftAngle, "left", nil)
        } else if right.visible, let rightAngle = right.angle {
            return (rightAngle, "right", nil)
        }
        return nil
    }

    func update(angles: JointAngleResult, landmarks2D: [Point3D]?, timestamp: Date) -> ExerciseStatus {
        guard let kneeData = getBendingKneeAngle(angles: angles) else {
            return getStatus()
        }

        let kneeAngle = kneeData.angle
        let prevState = lungeState
        let t = thresholds

        switch lungeState {
        case .idle:
            if kneeAngle > t.standingKneeMin {
                lungeState = .standing
                currentRepMaxKnee = kneeAngle
            }

        case .standing:
            currentRepMaxKnee = max(currentRepMaxKnee, kneeAngle)

            if kneeAngle < t.lungingKneeMax {
                lungeState = .lunging
                currentRepStartTime = timestamp
                lungeStartTime = timestamp
                currentRepMinKnee = kneeAngle
                activeLeg = kneeData.side
                reachedBottom = false
            }

        case .lunging:
            currentRepMinKnee = min(currentRepMinKnee, kneeAngle)

            if kneeAngle < t.bottomKneeMax {
                lungeState = .bottom
                reachedBottom = true
            } else if kneeAngle > t.standingKneeMin {
                lungeState = .standing
                lungeStartTime = nil
                currentRepMaxKnee = kneeAngle
                activeLeg = nil
            }

        case .bottom:
            currentRepMinKnee = min(currentRepMinKnee, kneeAngle)

            if kneeAngle > t.risingKneeMin {
                lungeState = .rising
            }

        case .rising:
            if kneeAngle > t.standingKneeMin {
                let lungeDuration = lungeStartTime.map { timestamp.timeIntervalSince($0) } ?? 0
                let timeSinceLastRep = lastRepCompletionTime.map { timestamp.timeIntervalSince($0) } ?? .infinity
                let rom = currentRepMaxKnee - currentRepMinKnee

                let validRep = reachedBottom &&
                               lungeDuration >= t.minLungeDuration &&
                               timeSinceLastRep >= t.repCooldown &&
                               rom >= t.minROM

                if validRep {
                    completeRep(timestamp: timestamp)
                }

                lungeState = .standing
                lungeStartTime = nil
                reachedBottom = false
                currentRepMaxKnee = kneeAngle
                currentRepMinKnee = 180
                activeLeg = nil
            } else if kneeAngle < t.bottomKneeMax {
                lungeState = .bottom
            }
        }

        if lungeState != prevState {
            onStateChange?(lungeState.rawValue, prevState.rawValue)
        }

        return getStatus()
    }

    private func completeRep(timestamp: Date) {
        repCount += 1
        lastRepCompletionTime = timestamp
        lastRepDuration = currentRepStartTime.map { timestamp.timeIntervalSince($0) }

        let depthScore = calculateDepthScore()

        let repData = RepData(
            repNumber: repCount,
            duration: lastRepDuration,
            minHipAngle: nil,
            minKneeAngle: currentRepMinKnee < 180 ? currentRepMinKnee : nil,
            minElbowAngle: nil,
            depthScore: depthScore,
            orientation: orientation,
            timestamp: timestamp
        )

        repHistory.append(repData)
        if repHistory.count > maxHistoryLength {
            repHistory.removeFirst()
        }

        onRepComplete?(repData)
    }

    private func calculateDepthScore() -> Int {
        let kneeDepth = max(0, 170 - currentRepMinKnee)
        return min(100, Int((kneeDepth / 80) * 100))
    }

    func getStatus() -> ExerciseStatus {
        return ExerciseStatus(
            state: state,
            repCount: repCount,
            orientation: orientation,
            lastRepDuration: lastRepDuration,
            currentRepMinHip: nil,
            currentRepMinKnee: currentRepMinKnee < 180 ? currentRepMinKnee : nil,
            currentRepMinElbow: nil,
            repHistory: repHistory
        )
    }

    func reset() {
        lungeState = .idle
        repCount = 0
        currentRepStartTime = nil
        lastRepDuration = nil
        currentRepMaxKnee = 0
        currentRepMinKnee = 180
        activeLeg = nil
        lungeStartTime = nil
        lastRepCompletionTime = nil
        reachedBottom = false
        repHistory = []
    }
}
