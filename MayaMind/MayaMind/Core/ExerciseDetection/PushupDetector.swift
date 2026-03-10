//
//  PushupDetector.swift
//  MayaMind
//
//  State machine for detecting and counting push-up repetitions.
//  Ported from exercise-poc/exercises/pushup.js
//

import Foundation

/// Push-up detection thresholds
struct PushupThresholds {
    // Plank position (arms extended)
    var plankElbowMin: Float = 130

    // Bottom position (arms bent)
    var bottomElbowMax: Float = 115

    // Transition thresholds
    var descendingElbowMax: Float = 125
    var ascendingElbowMin: Float = 118

    // Timing thresholds
    var minDescentDuration: TimeInterval = 0.3
    var minBottomDuration: TimeInterval = 0.15
    var repCooldown: TimeInterval = 0.4

    // Minimum range of motion
    var minROM: Float = 20
}

/// Push-up states
enum PushupState: String {
    case idle
    case plank
    case descending
    case bottom
    case ascending
}

/// Push-up detector
class PushupDetector: ExerciseDetectorProtocol {
    var state: String { pushupState.rawValue }
    private(set) var repCount: Int = 0
    var orientation: UserOrientation { .unknown }

    var onRepComplete: ((RepData) -> Void)?
    var onStateChange: ((String, String) -> Void)?

    private var pushupState: PushupState = .idle
    private let thresholds: PushupThresholds

    // Rep tracking
    private var currentRepStartTime: Date?
    private var lastRepDuration: TimeInterval?
    private var currentRepMaxElbow: Float = 0
    private var currentRepMinElbow: Float = 180

    // Timing
    private var descentStartTime: Date?
    private var bottomStartTime: Date?
    private var lastRepCompletionTime: Date?
    private var reachedBottom = false

    // Rep history
    private var repHistory: [RepData] = []
    private let maxHistoryLength = 20

    init(thresholds: PushupThresholds = PushupThresholds()) {
        self.thresholds = thresholds
    }

    /// Get average elbow angle
    private func getElbowAngle(angles: JointAngleResult) -> (angle: Float, side: String)? {
        let left = angles.leftElbow
        let right = angles.rightElbow

        if left.visible && right.visible, let l = left.angle, let r = right.angle {
            return ((l + r) / 2, "both")
        } else if left.visible, let l = left.angle {
            return (l, "left")
        } else if right.visible, let r = right.angle {
            return (r, "right")
        }
        return nil
    }

    func update(angles: JointAngleResult, landmarks2D: [Point3D]?, timestamp: Date) -> ExerciseStatus {
        guard let elbowData = getElbowAngle(angles: angles) else {
            return getStatus()
        }

        let elbowAngle = elbowData.angle
        let prevState = pushupState
        let t = thresholds

        switch pushupState {
        case .idle:
            if elbowAngle > t.plankElbowMin {
                pushupState = .plank
                currentRepMaxElbow = elbowAngle
            }

        case .plank:
            currentRepMaxElbow = max(currentRepMaxElbow, elbowAngle)

            if elbowAngle < t.descendingElbowMax {
                pushupState = .descending
                currentRepStartTime = timestamp
                descentStartTime = timestamp
                currentRepMinElbow = elbowAngle
                reachedBottom = false
            }

        case .descending:
            currentRepMinElbow = min(currentRepMinElbow, elbowAngle)

            if elbowAngle < t.bottomElbowMax {
                pushupState = .bottom
                bottomStartTime = timestamp
                reachedBottom = true
            } else if elbowAngle > t.plankElbowMin {
                pushupState = .plank
                descentStartTime = nil
                bottomStartTime = nil
                currentRepMaxElbow = elbowAngle
            }

        case .bottom:
            currentRepMinElbow = min(currentRepMinElbow, elbowAngle)

            if elbowAngle > t.ascendingElbowMin {
                pushupState = .ascending
            }

        case .ascending:
            if elbowAngle > t.plankElbowMin {
                let descentDuration = descentStartTime.map { timestamp.timeIntervalSince($0) } ?? 0
                let bottomDuration = bottomStartTime.map { timestamp.timeIntervalSince($0) } ?? 0
                let timeSinceLastRep = lastRepCompletionTime.map { timestamp.timeIntervalSince($0) } ?? .infinity
                let rom = currentRepMaxElbow - currentRepMinElbow

                let validRep = reachedBottom &&
                               descentDuration >= t.minDescentDuration &&
                               bottomDuration >= t.minBottomDuration &&
                               timeSinceLastRep >= t.repCooldown &&
                               rom >= t.minROM

                if validRep {
                    completeRep(timestamp: timestamp)
                }

                pushupState = .plank
                descentStartTime = nil
                bottomStartTime = nil
                reachedBottom = false
                currentRepMaxElbow = elbowAngle
                currentRepMinElbow = 180
            } else if elbowAngle < t.bottomElbowMax {
                pushupState = .bottom
                if bottomStartTime == nil {
                    bottomStartTime = timestamp
                }
            }
        }

        if pushupState != prevState {
            onStateChange?(pushupState.rawValue, prevState.rawValue)
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
            minKneeAngle: nil,
            minElbowAngle: currentRepMinElbow < 180 ? currentRepMinElbow : nil,
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
        let elbowDepth = max(0, 170 - currentRepMinElbow)
        return min(100, Int((elbowDepth / 80) * 100))
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
        pushupState = .idle
        repCount = 0
        currentRepStartTime = nil
        lastRepDuration = nil
        currentRepMaxElbow = 0
        currentRepMinElbow = 180
        descentStartTime = nil
        bottomStartTime = nil
        lastRepCompletionTime = nil
        reachedBottom = false
        repHistory = []
    }
}
