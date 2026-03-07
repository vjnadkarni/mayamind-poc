//
//  AvatarWebView.swift
//  MayaMind
//
//  WKWebView wrapper for TalkingHead 3D avatar
//  Runs bundled HTML/JS/WebGL assets
//

import SwiftUI
import WebKit

struct AvatarWebView: UIViewRepresentable {
    @Binding var mood: String
    @Binding var isSpeaking: Bool

    // Callbacks from JavaScript
    var onReady: (() -> Void)?
    var onSpeakingEnd: (() -> Void)?

    // Audio data to speak
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
        webView.backgroundColor = .clear

        // Load bundled avatar HTML
        if let url = Bundle.main.url(forResource: "avatar", withExtension: "html", subdirectory: "WebAssets") {
            webView.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }

        context.coordinator.webView = webView
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {
        // Update mood
        if context.coordinator.currentMood != mood {
            context.coordinator.currentMood = mood
            webView.evaluateJavaScript("setMood('\(mood)')") { _, error in
                if let error = error {
                    print("Error setting mood: \(error)")
                }
            }
        }

        // Speak audio if provided
        if let audio = audioToSpeak, audio.id != context.coordinator.lastAudioId {
            context.coordinator.lastAudioId = audio.id
            speakAudio(webView: webView, audio: audio)
        }
    }

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    private func speakAudio(webView: WKWebView, audio: AvatarAudioData) {
        // Convert audio data to base64 for JavaScript
        let base64Audio = audio.audioData.base64EncodedString()

        let js = """
        speakAudio({
            audio: Uint8Array.from(atob('\(base64Audio)'), c => c.charCodeAt(0)).buffer,
            words: \(audio.words),
            wtimes: \(audio.wordTimes),
            wdurations: \(audio.wordDurations)
        });
        """

        webView.evaluateJavaScript(js) { _, error in
            if let error = error {
                print("Error calling speakAudio: \(error)")
            }
        }
    }

    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: AvatarWebView
        weak var webView: WKWebView?
        var currentMood: String = "neutral"
        var lastAudioId: String?

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
                    self.parent.onReady?()
                case "speakingStart":
                    self.parent.isSpeaking = true
                case "speakingEnd":
                    self.parent.isSpeaking = false
                    self.parent.onSpeakingEnd?()
                default:
                    break
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            // Page loaded
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            print("WebView navigation failed: \(error)")
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
