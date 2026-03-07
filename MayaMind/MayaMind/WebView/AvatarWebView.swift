//
//  AvatarWebView.swift
//  MayaMind
//
//  WKWebView wrapper for TalkingHead 3D avatar
//  Loads avatar page from server to avoid cross-origin module issues
//

import SwiftUI
import WebKit

struct AvatarWebView: UIViewRepresentable {
    @Binding var mood: String
    @Binding var isSpeaking: Bool

    // Server URL for avatar page
    private let avatarURL = "https://companion.mayamind.ai/dashboard/avatar-ios.html"

    // Callbacks from JavaScript
    var onReady: (() -> Void)?
    var onSpeakingEnd: (() -> Void)?

    // Audio data for lip-sync (WKWebView plays audio + animates lips)
    var audioToSpeak: AvatarAudioData?

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()

        // Enable JavaScript
        configuration.preferences.javaScriptEnabled = true

        // Allow inline media playback (required for audio)
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        // Set up message handler for JS -> Swift communication
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "mayamind")
        configuration.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.1, green: 0.1, blue: 0.18, alpha: 1.0)

        // Load avatar page from server
        if let url = URL(string: avatarURL) {
            print("[AvatarWebView] Loading: \(avatarURL)")
            webView.load(URLRequest(url: url))
        }

        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Only call JS functions after avatar is ready
        guard context.coordinator.isAvatarReady else { return }

        // Update mood
        if context.coordinator.currentMood != mood {
            context.coordinator.currentMood = mood
            webView.evaluateJavaScript("setMood('\(mood)')") { _, error in
                if let error = error {
                    print("[AvatarWebView] Error setting mood: \(error)")
                }
            }
        }

        // Start lip-sync with audio playback if audio data provided
        // WKWebView handles both audio + lip animation (AVAudioSession deactivated by Swift)
        if let audio = audioToSpeak, audio.id != context.coordinator.lastAudioId {
            context.coordinator.lastAudioId = audio.id
            startLipsync(webView: webView, audio: audio, context: context)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    /// Start lip-sync with audio playback in WKWebView
    /// WKWebView handles both audio and lip animation (Swift deactivates AVAudioSession first)
    private func startLipsync(webView: WKWebView, audio: AvatarAudioData, context: Context) {
        // Convert audio data to base64 for JavaScript
        let audioBase64 = audio.audioData.base64EncodedString()

        // Convert arrays to JSON strings
        let wordsJSON = (try? JSONSerialization.data(withJSONObject: audio.words))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        let timesJSON = (try? JSONSerialization.data(withJSONObject: audio.wordTimes))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
        let durationsJSON = (try? JSONSerialization.data(withJSONObject: audio.wordDurations))
            .flatMap { String(data: $0, encoding: .utf8) } ?? "[]"

        // Call startLipsync() with audio + word timing for full lip-sync
        let js = """
        startLipsync('\(audioBase64)', \(wordsJSON), \(timesJSON), \(durationsJSON));
        """

        print("[AvatarWebView] Calling startLipsync with \(audio.words.count) words")
        webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                print("[AvatarWebView] Error calling startLipsync: \(error)")
                // Notify that speaking ended (with error)
                DispatchQueue.main.async {
                    context.coordinator.parent.onSpeakingEnd?()
                }
            }
        }
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: AvatarWebView
        weak var webView: WKWebView?
        var currentMood: String = "neutral"
        var lastAudioId: String?
        var isAvatarReady = false  // Track when JS avatar is ready

        init(_ parent: AvatarWebView) {
            self.parent = parent
        }

        // Handle messages from JavaScript
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard let body = message.body as? [String: Any],
                  let event = body["event"] as? String else { return }

            DispatchQueue.main.async {
                switch event {
                case "ready":
                    self.isAvatarReady = true
                    print("[AvatarWebView] Avatar ready - JS functions available")
                    self.parent.onReady?()
                case "speakingStart":
                    print("[AvatarWebView] JS: speakingStart")
                    self.parent.isSpeaking = true
                case "speakingEnd":
                    print("[AvatarWebView] JS: speakingEnd")
                    self.parent.isSpeaking = false
                    self.parent.onSpeakingEnd?()
                case "debug":
                    if let msg = body["message"] as? String {
                        print("[AvatarWebView] JS: \(msg)")
                    }
                case "error":
                    if let msg = body["message"] as? String {
                        print("[AvatarWebView] JS ERROR: \(msg)")
                    }
                default:
                    print("[AvatarWebView] JS event: \(event)")
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            print("[AvatarWebView] Page loaded successfully")
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("[AvatarWebView] Navigation failed: \(error)")
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            print("[AvatarWebView] Provisional navigation failed: \(error)")
        }
    }
}

/// Audio data structure for TalkingHead
struct AvatarAudioData: Identifiable {
    let id: String
    let audioData: Data
    let words: [String]
    let wordTimes: [Double]
    let wordDurations: [Double]

    init(audioData: Data, words: [String], wordTimes: [Double], wordDurations: [Double]) {
        self.id = UUID().uuidString
        self.audioData = audioData
        self.words = words
        self.wordTimes = wordTimes
        self.wordDurations = wordDurations
    }
}

#Preview {
    AvatarWebView(
        mood: .constant("neutral"),
        isSpeaking: .constant(false)
    )
    .frame(height: 300)
    .background(Color.black)
}
