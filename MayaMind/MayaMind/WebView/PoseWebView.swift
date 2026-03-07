//
//  PoseWebView.swift
//  MayaMind
//
//  WKWebView wrapper for MediaPipe pose detection
//  Runs bundled WASM-based pose estimation
//

import SwiftUI
import WebKit
import AVFoundation

struct PoseWebView: UIViewRepresentable {
    // Current exercise detector to use
    @Binding var activeExercise: String?

    // Callbacks
    var onRepCount: ((Int) -> Void)?
    var onPoseUpdate: ((PoseData) -> Void)?
    var onReady: (() -> Void)?

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()

        // Enable JavaScript
        configuration.preferences.javaScriptEnabled = true

        // Allow camera access
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        // Set up message handler
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "mayamind")
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false

        // Load bundled pose detection HTML
        if let url = Bundle.main.url(forResource: "pose", withExtension: "html", subdirectory: "WebAssets") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Update active exercise detector
        if let exercise = activeExercise, exercise != context.coordinator.currentExercise {
            context.coordinator.currentExercise = exercise
            webView.evaluateJavaScript("setExercise('\(exercise)')") { _, _ in }
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: PoseWebView
        weak var webView: WKWebView?
        var currentExercise: String?

        init(_ parent: PoseWebView) {
            self.parent = parent
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let event = body["event"] as? String else { return }

            DispatchQueue.main.async {
                switch event {
                case "ready":
                    self.parent.onReady?()

                case "repCount":
                    if let count = body["count"] as? Int {
                        self.parent.onRepCount?(count)
                    }

                case "pose":
                    if let landmarks = body["landmarks"] as? [[Double]],
                       let angles = body["angles"] as? [String: Double] {
                        let poseData = PoseData(landmarks: landmarks, angles: angles)
                        self.parent.onPoseUpdate?(poseData)
                    }

                default:
                    break
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Request camera permission after page loads
            requestCameraPermission()
        }

        private func requestCameraPermission() {
            AVCaptureDevice.requestAccess(for: .video) { granted in
                if granted {
                    DispatchQueue.main.async {
                        self.webView?.evaluateJavaScript("startCamera()") { _, _ in }
                    }
                }
            }
        }
    }
}

/// Pose landmark data from MediaPipe
struct PoseData {
    let landmarks: [[Double]] // 33 landmarks, each [x, y, z, visibility]
    let angles: [String: Double] // Computed joint angles

    var leftKneeAngle: Double? { angles["leftKnee"] }
    var rightKneeAngle: Double? { angles["rightKnee"] }
    var leftHipAngle: Double? { angles["leftHip"] }
    var rightHipAngle: Double? { angles["rightHip"] }
    var leftElbowAngle: Double? { angles["leftElbow"] }
    var rightElbowAngle: Double? { angles["rightElbow"] }
}

#Preview {
    PoseWebView(activeExercise: .constant("squats"))
        .frame(height: 400)
}
