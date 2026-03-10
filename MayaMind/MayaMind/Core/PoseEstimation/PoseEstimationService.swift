//
//  PoseEstimationService.swift
//  MayaMind
//
//  MediaPipe Pose Landmarker wrapper for iOS.
//  Provides real-time 3D pose estimation from camera frames.
//

import Foundation
import AVFoundation
import UIKit
import MediaPipeTasksVision

/// Pose estimation result containing landmarks and computed angles
struct PoseEstimationResult {
    let landmarks: [Point3D]       // 2D normalized landmarks (0-1)
    let worldLandmarks: [Point3D]  // 3D world landmarks (meters)
    let angles: JointAngleResult?
    let timestamp: TimeInterval
}

/// Delegate for receiving pose estimation updates
protocol PoseEstimationDelegate: AnyObject {
    func poseEstimationService(_ service: PoseEstimationService, didUpdatePose result: PoseEstimationResult)
    func poseEstimationService(_ service: PoseEstimationService, didFailWithError error: Error)
}

/// MediaPipe Pose Landmarker service
class PoseEstimationService: NSObject {
    weak var delegate: PoseEstimationDelegate?

    private var poseLandmarker: PoseLandmarker?
    private let angleCalculator = JointAngleCalculator()
    private let angleSmoother = AngleSmoother(alpha: 0.3)

    /// Whether the service is currently running
    private(set) var isRunning = false

    override init() {
        super.init()
        setupPoseLandmarker()
    }

    private func setupPoseLandmarker() {
        // Configure pose landmarker options
        let options = PoseLandmarkerOptions()
        options.baseOptions.modelAssetPath = Bundle.main.path(
            forResource: "pose_landmarker_heavy",
            ofType: "task"
        ) ?? ""

        options.runningMode = .liveStream
        options.numPoses = 1
        options.minPoseDetectionConfidence = 0.5
        options.minPosePresenceConfidence = 0.5
        options.minTrackingConfidence = 0.5
        options.poseLandmarkerLiveStreamDelegate = self

        do {
            poseLandmarker = try PoseLandmarker(options: options)
            print("[PoseEstimation] Pose landmarker initialized")
        } catch {
            print("[PoseEstimation] Failed to create pose landmarker: \(error)")
            delegate?.poseEstimationService(self, didFailWithError: error)
        }
    }

    /// Start pose estimation
    func start() {
        isRunning = true
        angleSmoother.reset()
    }

    /// Stop pose estimation
    func stop() {
        isRunning = false
    }

    /// Process a camera frame for pose detection
    /// - Parameters:
    ///   - sampleBuffer: CMSampleBuffer from camera
    ///   - timestamp: Timestamp in milliseconds
    func processFrame(_ sampleBuffer: CMSampleBuffer, timestamp: Int) {
        guard isRunning, let poseLandmarker = poseLandmarker else { return }

        do {
            let image = try MPImage(sampleBuffer: sampleBuffer)
            try poseLandmarker.detectAsync(image: image, timestampInMilliseconds: timestamp)
        } catch {
            print("[PoseEstimation] Detection failed: \(error)")
        }
    }

    /// Process a UIImage for pose detection (for testing)
    func processImage(_ image: UIImage) -> PoseEstimationResult? {
        guard let poseLandmarker = poseLandmarker else { return nil }

        do {
            let mpImage = try MPImage(uiImage: image)
            let result = try poseLandmarker.detect(image: mpImage)
            return processResult(result, timestamp: Date().timeIntervalSince1970)
        } catch {
            print("[PoseEstimation] Failed: \(error)")
            return nil
        }
    }

    private func processResult(_ result: PoseLandmarkerResult, timestamp: TimeInterval) -> PoseEstimationResult? {
        guard let firstPose = result.landmarks.first,
              let firstWorldLandmarks = result.worldLandmarks.first else {
            return nil
        }

        // Convert to Point3D arrays
        let landmarks: [Point3D] = firstPose.map { landmark in
            Point3D(
                x: Float(landmark.x),
                y: Float(landmark.y),
                z: Float(landmark.z),
                visibility: landmark.visibility?.floatValue ?? 1.0
            )
        }

        let worldLandmarks: [Point3D] = firstWorldLandmarks.map { landmark in
            Point3D(
                x: Float(landmark.x),
                y: Float(landmark.y),
                z: Float(landmark.z),
                visibility: landmark.visibility?.floatValue ?? 1.0
            )
        }

        // Calculate joint angles
        var angles: JointAngleResult? = nil
        if let rawAngles = angleCalculator.calculateJointAngles(worldLandmarks: worldLandmarks) {
            angles = angleSmoother.update(rawAngles)
        }

        return PoseEstimationResult(
            landmarks: landmarks,
            worldLandmarks: worldLandmarks,
            angles: angles,
            timestamp: timestamp
        )
    }
}

// MARK: - PoseLandmarkerLiveStreamDelegate

extension PoseEstimationService: PoseLandmarkerLiveStreamDelegate {
    func poseLandmarker(
        _ poseLandmarker: PoseLandmarker,
        didFinishDetection result: PoseLandmarkerResult?,
        timestampInMilliseconds: Int,
        error: Error?
    ) {
        if let error = error {
            DispatchQueue.main.async {
                self.delegate?.poseEstimationService(self, didFailWithError: error)
            }
            return
        }

        guard let result = result else { return }

        let timestamp = TimeInterval(timestampInMilliseconds) / 1000.0

        if let poseResult = processResult(result, timestamp: timestamp) {
            DispatchQueue.main.async {
                self.delegate?.poseEstimationService(self, didUpdatePose: poseResult)
            }
        }
    }
}
