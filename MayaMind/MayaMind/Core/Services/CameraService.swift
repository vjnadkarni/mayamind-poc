//
//  CameraService.swift
//  MayaMind
//
//  AVFoundation camera service for capturing video frames.
//

import Foundation
import AVFoundation
import UIKit

/// Delegate for receiving camera frames
protocol CameraServiceDelegate: AnyObject {
    func cameraService(_ service: CameraService, didOutput sampleBuffer: CMSampleBuffer, timestamp: Int)
    func cameraService(_ service: CameraService, didFailWithError error: Error)
}

/// Camera service for capturing video frames
class CameraService: NSObject {
    weak var delegate: CameraServiceDelegate?

    private let captureSession = AVCaptureSession()
    private var videoOutput: AVCaptureVideoDataOutput?
    private let sessionQueue = DispatchQueue(label: "com.mayamind.camera.session")
    private let outputQueue = DispatchQueue(label: "com.mayamind.camera.output")

    private var startTime: CMTime?

    /// Whether the camera is currently running
    private(set) var isRunning = false

    /// Camera position (front or back)
    var cameraPosition: AVCaptureDevice.Position = .front

    /// The preview layer for displaying the camera feed
    var previewLayer: AVCaptureVideoPreviewLayer?

    override init() {
        super.init()
    }

    /// Request camera permission
    func requestPermission(completion: @escaping (Bool) -> Void) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            completion(true)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { granted in
                DispatchQueue.main.async {
                    completion(granted)
                }
            }
        default:
            completion(false)
        }
    }

    /// Setup the camera session
    func setup() throws {
        captureSession.beginConfiguration()
        captureSession.sessionPreset = .high

        // Add video input
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: cameraPosition) else {
            throw CameraError.cameraUnavailable
        }

        let input = try AVCaptureDeviceInput(device: camera)
        if captureSession.canAddInput(input) {
            captureSession.addInput(input)
        } else {
            throw CameraError.cannotAddInput
        }

        // Add video output
        let output = AVCaptureVideoDataOutput()
        output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
        output.alwaysDiscardsLateVideoFrames = true
        output.setSampleBufferDelegate(self, queue: outputQueue)

        if captureSession.canAddOutput(output) {
            captureSession.addOutput(output)
            videoOutput = output

            // Set video orientation
            if let connection = output.connection(with: .video) {
                if connection.isVideoOrientationSupported {
                    connection.videoOrientation = .portrait
                }
                // Mirror front camera
                if cameraPosition == .front && connection.isVideoMirroringSupported {
                    connection.isVideoMirrored = true
                }
            }
        } else {
            throw CameraError.cannotAddOutput
        }

        captureSession.commitConfiguration()

        // Create preview layer
        let layer = AVCaptureVideoPreviewLayer(session: captureSession)
        layer.videoGravity = .resizeAspectFill
        previewLayer = layer
    }

    /// Start capturing
    func start() {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            self.startTime = nil
            self.captureSession.startRunning()
            DispatchQueue.main.async {
                self.isRunning = true
            }
        }
    }

    /// Stop capturing
    func stop() {
        sessionQueue.async { [weak self] in
            guard let self = self else { return }
            self.captureSession.stopRunning()
            DispatchQueue.main.async {
                self.isRunning = false
            }
        }
    }

    /// Switch between front and back camera
    func switchCamera() throws {
        captureSession.beginConfiguration()

        // Remove existing input
        if let currentInput = captureSession.inputs.first as? AVCaptureDeviceInput {
            captureSession.removeInput(currentInput)
        }

        // Switch position
        cameraPosition = (cameraPosition == .front) ? .back : .front

        // Add new input
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: cameraPosition) else {
            throw CameraError.cameraUnavailable
        }

        let input = try AVCaptureDeviceInput(device: camera)
        if captureSession.canAddInput(input) {
            captureSession.addInput(input)
        }

        // Update mirroring
        if let connection = videoOutput?.connection(with: .video) {
            if cameraPosition == .front && connection.isVideoMirroringSupported {
                connection.isVideoMirrored = true
            } else {
                connection.isVideoMirrored = false
            }
        }

        captureSession.commitConfiguration()
    }
}

// MARK: - AVCaptureVideoDataOutputSampleBufferDelegate

extension CameraService: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        let presentationTime = CMSampleBufferGetPresentationTimeStamp(sampleBuffer)

        if startTime == nil {
            startTime = presentationTime
        }

        let elapsedTime = CMTimeSubtract(presentationTime, startTime!)
        let timestampMs = Int(CMTimeGetSeconds(elapsedTime) * 1000)

        delegate?.cameraService(self, didOutput: sampleBuffer, timestamp: timestampMs)
    }
}

// MARK: - Errors

enum CameraError: Error, LocalizedError {
    case cameraUnavailable
    case cannotAddInput
    case cannotAddOutput
    case permissionDenied

    var errorDescription: String? {
        switch self {
        case .cameraUnavailable:
            return "Camera is not available"
        case .cannotAddInput:
            return "Cannot add camera input"
        case .cannotAddOutput:
            return "Cannot add video output"
        case .permissionDenied:
            return "Camera permission denied"
        }
    }
}
