//
//  SquatDetector.swift
//  MayaMind
//
//  State machine for detecting and counting squat repetitions.
//  Ported from exercise-poc/exercises/squat.js
//

import Foundation

/// Squat detection thresholds
struct SquatThresholds {
    // Standing position thresholds (sagittal/oblique view)
    var standingHipMin: Float = 155
    var standingKneeMin: Float = 155

    // Frontal view thresholds - angles read ~10-15 degrees lower
    var frontalStandingHipMin: Float = 145
    var frontalStandingKneeMin: Float = 135

    // Bottom position thresholds
    var bottomHipMax: Float = 120
    var bottomKneeMax: Float = 120

    // Transition thresholds
    var descendingHipMax: Float = 150
    var ascendingHipMin: Float = 125

    // Hip Y thresholds (normalized Y, 0-1)
    var hipDropThreshold: Float = 0.10
    var minSquatDepth: Float = 0.15

    // Timing thresholds
    var minDescentDuration: TimeInterval = 0.6
    var repCooldown: TimeInterval = 0.6
}

/// Squat states
enum SquatState: String {
    case idle
    case standing
    case descending
    case bottom
    case ascending
}

/// Squat detector
class SquatDetector: ExerciseDetectorProtocol {
    // Protocol properties
    var state: String { squatState.rawValue }
    private(set) var repCount: Int = 0
    var orientation: UserOrientation { orientationDetector.orientation }

    // Callbacks
    var onRepComplete: ((RepData) -> Void)?
    var onStateChange: ((String, String) -> Void)?
    var onOrientationChange: ((UserOrientation, UserOrientation) -> Void)?

    // Internal state
    private var squatState: SquatState = .idle
    private let thresholds: SquatThresholds
    private let orientationDetector = OrientationDetector()

    // Rep tracking
    private var currentRepStartTime: Date?
    private var lastRepDuration: TimeInterval?
    private var currentRepMinHip: Float = 180
    private var currentRepMinKnee: Float = 180

    // Hip Y tracking
    private var standingHipY: Float?
    private var currentRepMaxHipY: Float = 0
    private var hipYLocked = false

    // Timing
    private var descentStartTime: Date?
    private var lastRepCompletionTime: Date?
    private var reachedBottom = false

    // Rep history
    private var repHistory: [RepData] = []
    private let maxHistoryLength = 20

    init(thresholds: SquatThresholds = SquatThresholds()) {
        self.thresholds = thresholds
    }

    // MARK: - Helper methods

    private func getHipY(landmarks: [Point3D]?) -> Float? {
        guard let landmarks = landmarks else { return nil }

        let leftHip = landmarks[PoseLandmark.leftHip.rawValue]
        let rightHip = landmarks[PoseLandmark.rightHip.rawValue]

        let leftVis = leftHip.visibility
        let rightVis = rightHip.visibility

        if leftVis > 0.5 && rightVis > 0.5 {
            return (leftHip.y + rightHip.y) / 2
        } else if leftVis > 0.5 {
            return leftHip.y
        } else if rightVis > 0.5 {
            return rightHip.y
        }
        return nil
    }

    private func getBestHipAngle(angles: JointAngleResult) -> Float? {
        let left = angles.leftHip
        let right = angles.rightHip

        if left.visible && right.visible, let leftAngle = left.angle, let rightAngle = right.angle {
            return (leftAngle + rightAngle) / 2
        } else if left.visible, let leftAngle = left.angle {
            return leftAngle
        } else if right.visible, let rightAngle = right.angle {
            return rightAngle
        }
        return nil
    }

    private func getBestKneeAngle(angles: JointAngleResult) -> Float? {
        let left = angles.leftKnee
        let right = angles.rightKnee

        if left.visible && right.visible, let leftAngle = left.angle, let rightAngle = right.angle {
            return (leftAngle + rightAngle) / 2
        } else if left.visible, let leftAngle = left.angle {
            return leftAngle
        } else if right.visible, let rightAngle = right.angle {
            return rightAngle
        }
        return nil
    }

    private func getHipDrop(hipY: Float?) -> Float {
        guard let hipY = hipY, let standing = standingHipY else { return 0 }
        return hipY - standing  // Positive = lower (dropped)
    }

    private func checkAnglesDescent(hipAngle: Float) -> Bool {
        return hipAngle < thresholds.descendingHipMax
    }

    private func checkAnglesBottom(hipAngle: Float, kneeAngle: Float) -> Bool {
        return hipAngle < thresholds.bottomHipMax || kneeAngle < thresholds.bottomKneeMax
    }

    private func checkAnglesStanding(hipAngle: Float, kneeAngle: Float) -> Bool {
        if orientation == .frontal || orientation == .unknown {
            return hipAngle > thresholds.frontalStandingHipMin &&
                   kneeAngle > thresholds.frontalStandingKneeMin
        }
        return hipAngle > thresholds.standingHipMin &&
               kneeAngle > thresholds.standingKneeMin
    }

    private func checkAnglesAscending(hipAngle: Float) -> Bool {
        return hipAngle > thresholds.ascendingHipMin
    }

    // MARK: - Protocol methods

    func update(angles: JointAngleResult, landmarks2D: [Point3D]?, timestamp: Date) -> ExerciseStatus {
        // Detect orientation
        if let landmarks = landmarks2D {
            let prevOrientation = orientation
            let newOrientation = orientationDetector.detectOrientation(landmarks: landmarks)
            if newOrientation != prevOrientation {
                onOrientationChange?(newOrientation, prevOrientation)
            }
        }

        guard let hipAngle = getBestHipAngle(angles: angles) else {
            return getStatus()
        }

        let kneeAngle = getBestKneeAngle(angles: angles) ?? 180
        let hipY = getHipY(landmarks: landmarks2D)
        let hipDrop = getHipDrop(hipY: hipY)

        let prevState = squatState

        // State machine
        switch squatState {
        case .idle:
            if checkAnglesStanding(hipAngle: hipAngle, kneeAngle: kneeAngle) {
                squatState = .standing
                if let y = hipY {
                    standingHipY = y
                }
            }

        case .standing:
            if let y = hipY, !hipYLocked {
                standingHipY = y
            }

            var startDescending = checkAnglesDescent(hipAngle: hipAngle)

            // Supplement for frontal view
            if !startDescending && orientation == .frontal {
                if hipDrop > thresholds.hipDropThreshold {
                    startDescending = true
                }
            }

            if startDescending {
                squatState = .descending
                currentRepStartTime = timestamp
                descentStartTime = timestamp
                currentRepMinHip = hipAngle
                currentRepMinKnee = kneeAngle
                currentRepMaxHipY = hipY ?? 0
                reachedBottom = false
                hipYLocked = true
            }

        case .descending:
            currentRepMinHip = min(currentRepMinHip, hipAngle)
            currentRepMinKnee = min(currentRepMinKnee, kneeAngle)
            if let y = hipY {
                currentRepMaxHipY = max(currentRepMaxHipY, y)
            }

            var atBottom = checkAnglesBottom(hipAngle: hipAngle, kneeAngle: kneeAngle)

            if !atBottom && orientation == .frontal {
                if hipDrop > thresholds.minSquatDepth {
                    atBottom = true
                }
            }

            if atBottom {
                squatState = .bottom
                reachedBottom = true
            } else if checkAnglesStanding(hipAngle: hipAngle, kneeAngle: kneeAngle) {
                // Went back to standing without hitting bottom
                squatState = .standing
                hipYLocked = false
                descentStartTime = nil
                if let y = hipY {
                    standingHipY = y
                }
            }

        case .bottom:
            currentRepMinHip = min(currentRepMinHip, hipAngle)
            currentRepMinKnee = min(currentRepMinKnee, kneeAngle)
            if let y = hipY {
                currentRepMaxHipY = max(currentRepMaxHipY, y)
            }

            var startedRising = checkAnglesAscending(hipAngle: hipAngle)

            if !startedRising && orientation == .frontal {
                if let y = hipY, currentRepMaxHipY > 0 {
                    let riseFromBottom = currentRepMaxHipY - y
                    if riseFromBottom > thresholds.hipDropThreshold * 0.5 {
                        startedRising = true
                    }
                }
            }

            if startedRising {
                squatState = .ascending
            }

        case .ascending:
            var isBackToStanding = checkAnglesStanding(hipAngle: hipAngle, kneeAngle: kneeAngle)

            if !isBackToStanding && orientation == .frontal {
                if let y = hipY, let standing = standingHipY {
                    let distFromStanding = abs(y - standing)
                    if distFromStanding < thresholds.hipDropThreshold * 0.5 {
                        isBackToStanding = true
                    }
                }
            }

            let descentDuration = descentStartTime.map { timestamp.timeIntervalSince($0) } ?? 0
            let timeSinceLastRep = lastRepCompletionTime.map { timestamp.timeIntervalSince($0) } ?? .infinity

            if isBackToStanding {
                let validRep = reachedBottom &&
                               descentDuration >= thresholds.minDescentDuration &&
                               timeSinceLastRep >= thresholds.repCooldown

                if validRep {
                    completeRep(timestamp: timestamp)
                }

                squatState = .standing
                hipYLocked = false
                descentStartTime = nil
                reachedBottom = false
                if let y = hipY {
                    standingHipY = y
                }
            } else if checkAnglesBottom(hipAngle: hipAngle, kneeAngle: kneeAngle) {
                squatState = .bottom
            }
        }

        // Fire state change callback
        if squatState != prevState {
            onStateChange?(squatState.rawValue, prevState.rawValue)
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
            minHipAngle: currentRepMinHip < 180 ? currentRepMinHip : nil,
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

        // Reset for next rep
        currentRepMinHip = 180
        currentRepMinKnee = 180
        currentRepMaxHipY = 0
        currentRepStartTime = nil
    }

    private func calculateDepthScore() -> Int {
        let hipDepth = max(0, 170 - currentRepMinHip)
        let kneeDepth = max(0, 170 - currentRepMinKnee)

        let hipScore = min(100, (hipDepth / 80) * 100)
        let kneeScore = min(100, (kneeDepth / 80) * 100)

        return Int((hipScore + kneeScore) / 2)
    }

    func getStatus() -> ExerciseStatus {
        return ExerciseStatus(
            state: state,
            repCount: repCount,
            orientation: orientation,
            lastRepDuration: lastRepDuration,
            currentRepMinHip: currentRepMinHip < 180 ? currentRepMinHip : nil,
            currentRepMinKnee: currentRepMinKnee < 180 ? currentRepMinKnee : nil,
            currentRepMinElbow: nil,
            repHistory: repHistory
        )
    }

    func reset() {
        squatState = .idle
        repCount = 0
        currentRepStartTime = nil
        lastRepDuration = nil
        currentRepMinHip = 180
        currentRepMinKnee = 180
        currentRepMaxHipY = 0
        standingHipY = nil
        hipYLocked = false
        descentStartTime = nil
        lastRepCompletionTime = nil
        reachedBottom = false
        orientationDetector.reset()
        repHistory = []
    }
}
