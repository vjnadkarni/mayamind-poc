//
//  CameraPreviewView.swift
//  MayaMind
//
//  SwiftUI wrapper for AVCaptureVideoPreviewLayer with skeleton overlay.
//

import SwiftUI
import AVFoundation

/// SwiftUI wrapper for camera preview with skeleton overlay
struct CameraPreviewView: UIViewRepresentable {
    let previewLayer: AVCaptureVideoPreviewLayer?
    let landmarks: [Point3D]?
    let isMirrored: Bool

    func makeUIView(context: Context) -> CameraPreviewUIView {
        let view = CameraPreviewUIView()
        view.isMirrored = isMirrored
        return view
    }

    func updateUIView(_ uiView: CameraPreviewUIView, context: Context) {
        uiView.previewLayer = previewLayer
        uiView.landmarks = landmarks
        uiView.isMirrored = isMirrored
        uiView.setNeedsDisplay()
    }
}

/// UIView that hosts the camera preview and skeleton overlay
class CameraPreviewUIView: UIView {
    var previewLayer: AVCaptureVideoPreviewLayer? {
        didSet {
            setupPreviewLayer()
        }
    }

    var landmarks: [Point3D]?
    var isMirrored: Bool = true

    private let skeletonLayer = CAShapeLayer()

    override init(frame: CGRect) {
        super.init(frame: frame)
        setupSkeletonLayer()
    }

    required init?(coder: NSCoder) {
        super.init(coder: coder)
        setupSkeletonLayer()
    }

    private func setupPreviewLayer() {
        // Remove existing preview sublayers
        layer.sublayers?.filter { $0 is AVCaptureVideoPreviewLayer }.forEach { $0.removeFromSuperlayer() }

        if let previewLayer = previewLayer {
            previewLayer.frame = bounds
            previewLayer.videoGravity = .resizeAspectFill
            layer.insertSublayer(previewLayer, at: 0)
        }

        // Keep skeleton layer on top
        skeletonLayer.removeFromSuperlayer()
        layer.addSublayer(skeletonLayer)
    }

    private func setupSkeletonLayer() {
        skeletonLayer.strokeColor = UIColor.systemGreen.cgColor
        skeletonLayer.lineWidth = 3
        skeletonLayer.fillColor = UIColor.clear.cgColor
        skeletonLayer.lineCap = .round
        skeletonLayer.lineJoin = .round
        layer.addSublayer(skeletonLayer)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        previewLayer?.frame = bounds
        skeletonLayer.frame = bounds
        drawSkeleton()
    }

    override func draw(_ rect: CGRect) {
        super.draw(rect)
        drawSkeleton()
    }

    private func drawSkeleton() {
        guard let landmarks = landmarks, landmarks.count >= 33 else {
            skeletonLayer.path = nil
            return
        }

        let path = UIBezierPath()

        // Draw connections
        for (startIdx, endIdx) in skeletonConnections {
            let start = landmarks[startIdx.rawValue]
            let end = landmarks[endIdx.rawValue]

            // Check visibility
            guard start.visibility > 0.5 && end.visibility > 0.5 else { continue }

            // Convert normalized coordinates to view coordinates
            let startPoint = convertToViewCoordinates(start)
            let endPoint = convertToViewCoordinates(end)

            path.move(to: startPoint)
            path.addLine(to: endPoint)
        }

        // Draw joint points
        for landmark in landmarks {
            guard landmark.visibility > 0.5 else { continue }

            let point = convertToViewCoordinates(landmark)
            let radius: CGFloat = 5

            path.move(to: CGPoint(x: point.x + radius, y: point.y))
            path.addArc(
                withCenter: point,
                radius: radius,
                startAngle: 0,
                endAngle: .pi * 2,
                clockwise: true
            )
        }

        skeletonLayer.path = path.cgPath
    }

    private func convertToViewCoordinates(_ landmark: Point3D) -> CGPoint {
        var x = CGFloat(landmark.x) * bounds.width
        let y = CGFloat(landmark.y) * bounds.height

        // Mirror X if needed (front camera is already mirrored by CameraService)
        // Landmarks come normalized (0-1), no additional mirroring needed here

        return CGPoint(x: x, y: y)
    }
}

// MARK: - Skeleton Overlay View (alternative pure SwiftUI approach)

struct SkeletonOverlayView: View {
    let landmarks: [Point3D]?
    let frameSize: CGSize

    var body: some View {
        Canvas { context, size in
            guard let landmarks = landmarks, landmarks.count >= 33 else { return }

            // Draw connections
            for (startIdx, endIdx) in skeletonConnections {
                let start = landmarks[startIdx.rawValue]
                let end = landmarks[endIdx.rawValue]

                guard start.visibility > 0.5 && end.visibility > 0.5 else { continue }

                let startPoint = CGPoint(
                    x: CGFloat(start.x) * size.width,
                    y: CGFloat(start.y) * size.height
                )
                let endPoint = CGPoint(
                    x: CGFloat(end.x) * size.width,
                    y: CGFloat(end.y) * size.height
                )

                var path = Path()
                path.move(to: startPoint)
                path.addLine(to: endPoint)

                context.stroke(
                    path,
                    with: .color(.green),
                    lineWidth: 3
                )
            }

            // Draw joint points
            for landmark in landmarks {
                guard landmark.visibility > 0.5 else { continue }

                let center = CGPoint(
                    x: CGFloat(landmark.x) * size.width,
                    y: CGFloat(landmark.y) * size.height
                )

                let circle = Path(ellipseIn: CGRect(
                    x: center.x - 5,
                    y: center.y - 5,
                    width: 10,
                    height: 10
                ))

                context.fill(circle, with: .color(.green))
            }
        }
    }
}
