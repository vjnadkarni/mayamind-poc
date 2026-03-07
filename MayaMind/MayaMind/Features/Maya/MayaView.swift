//
//  MayaView.swift
//  MayaMind
//
//  Maya conversation interface with TalkingHead avatar
//

import SwiftUI
import Combine
import AVFoundation

struct MayaView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = MayaViewModel()
    @State private var inputText = ""
    @FocusState private var isInputFocused: Bool

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Top bar
                    HStack {
                        Text("Maya")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)
                        Spacer()

                        // Mute button
                        Button(action: { appState.isMuted.toggle() }) {
                            Image(systemName: appState.isMuted ? "mic.slash.fill" : "mic.fill")
                                .font(.system(size: 20))
                                .foregroundColor(appState.isMuted ? .red : .green)
                                .padding(10)
                                .background(Color.white.opacity(0.1))
                                .cornerRadius(8)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)

                    // Avatar area - TalkingHead in WKWebView
                    ZStack {
                        Color(hex: "1a1a2e")

                        if viewModel.avatarReady {
                            AvatarWebView(
                                mood: $viewModel.currentMood,
                                isSpeaking: $viewModel.avatarSpeaking,
                                onReady: {
                                    print("[MayaView] Avatar ready")
                                },
                                onSpeakingEnd: {
                                    viewModel.onAvatarSpeakingEnd()
                                },
                                audioToSpeak: viewModel.pendingAvatarAudio
                            )
                        } else {
                            // Loading placeholder
                            VStack {
                                ProgressView()
                                    .scaleEffect(1.5)
                                    .tint(.orange)
                                Text("Loading Maya...")
                                    .foregroundColor(.gray)
                                    .padding(.top, 12)
                            }
                        }
                    }
                    .frame(height: geometry.size.height * 0.35)
                    .cornerRadius(16)
                    .padding(.horizontal)
                    .padding(.top, 16)

                    // Transcript area
                    ScrollViewReader { scrollProxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                ForEach(viewModel.messages) { message in
                                    ChatBubble(message: message)
                                        .id(message.id)
                                }
                            }
                            .padding()
                        }
                        .onChange(of: viewModel.messages.count) { _, _ in
                            if let lastMessage = viewModel.messages.last {
                                withAnimation {
                                    scrollProxy.scrollTo(lastMessage.id, anchor: .bottom)
                                }
                            }
                        }
                    }
                    .frame(maxHeight: .infinity)
                    .background(Color(hex: "0f0f1a"))
                    .cornerRadius(16)
                    .padding(.horizontal)
                    .padding(.top, 8)

                    // Input area
                    HStack(spacing: 12) {
                        TextField("Type a message...", text: $inputText)
                            .textFieldStyle(.plain)
                            .padding(12)
                            .background(Color(hex: "1a1a2e"))
                            .cornerRadius(20)
                            .foregroundColor(.white)
                            .focused($isInputFocused)
                            .onSubmit {
                                sendMessage()
                            }

                        // Microphone button for voice input
                        Button(action: { viewModel.toggleListening() }) {
                            ZStack {
                                if viewModel.isListening {
                                    Circle()
                                        .fill(Color.green.opacity(0.3))
                                        .frame(width: 44, height: 44)
                                }
                                Image(systemName: viewModel.isListening ? "waveform.circle.fill" : "mic.circle.fill")
                                    .font(.system(size: 32))
                                    .foregroundColor(viewModel.isListening ? .green : .orange)
                            }
                        }
                        .disabled(viewModel.isLoading || appState.isMuted)

                        Button(action: sendMessage) {
                            Image(systemName: viewModel.isLoading ? "hourglass" : "arrow.up.circle.fill")
                                .font(.system(size: 32))
                                .foregroundColor(inputText.isEmpty || viewModel.isLoading ? .gray : .orange)
                        }
                        .disabled(inputText.isEmpty || viewModel.isLoading)
                    }
                    .padding(.horizontal)
                    .padding(.vertical, 12)

                    // Status bar
                    HStack {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 8, height: 8)
                        Text(viewModel.statusText)
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                        Spacer()
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }
            }
            .onTapGesture {
                isInputFocused = false
            }
            .onAppear {
                viewModel.requestSpeechAuthorization()
            }
        }
    }

    private var statusColor: Color {
        if viewModel.isSpeaking {
            return .blue  // Maya is speaking
        } else if viewModel.isLoading {
            return .orange  // Waiting for Claude
        } else if viewModel.isListening {
            return .green  // Listening for user
        } else {
            return .gray  // Idle
        }
    }

    private func sendMessage() {
        guard !inputText.isEmpty else { return }
        let message = inputText
        inputText = ""
        isInputFocused = false
        viewModel.sendMessage(message)
    }
}

struct ChatBubble: View {
    let message: ChatMessage

    var body: some View {
        HStack {
            if message.isUser {
                Spacer()
            }

            Text(message.text)
                .font(.system(size: 16))
                .foregroundColor(.white)
                .padding(12)
                .background(message.isUser ? Color.orange : Color(hex: "2a2a3e"))
                .cornerRadius(16)

            if !message.isUser {
                Spacer()
            }
        }
    }
}

struct ChatMessage: Identifiable {
    let id = UUID()
    let text: String
    let isUser: Bool
    let timestamp: Date
}

// MARK: - Valid moods for TalkingHead
private let VALID_MOODS = ["neutral", "happy", "angry", "sad", "fear", "disgust", "love", "sleep"]

class MayaViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var isListening = false
    @Published var isLoading = false
    @Published var isSpeaking = false
    @Published var statusText = "Type a message..."
    @Published var interimTranscript = ""

    // Avatar state
    @Published var avatarReady = true  // Set to true to show WebView immediately
    @Published var currentMood = "happy"
    @Published var avatarSpeaking = false
    @Published var pendingAvatarAudio: AvatarAudioData?

    private let claudeService = ClaudeAPIService()
    private let speechService = SpeechRecognitionService()
    private let ttsService = TTSService()
    private var conversationHistory: [[String: String]] = []
    private var isSpeechAuthorized = false
    private var pendingTranscriptSent = false

    init() {
        print("[MayaViewModel] init started")

        // Set up TTS callback - restart listening after Maya finishes speaking
        ttsService.onSpeechComplete = { [weak self] in
            guard let self = self else { return }
            print("[MayaViewModel] TTS complete, restarting listening")
            Task { @MainActor in
                self.isSpeaking = false
                self.restartListening()
            }
        }

        // Add welcome message
        let welcomeText = "Hello! I'm Maya, your wellness companion. How can I help you today?"
        messages.append(ChatMessage(
            text: welcomeText,
            isUser: false,
            timestamp: Date()
        ))

        // Set up speech callbacks
        speechService.onTranscript = { [weak self] transcript in
            print("[MayaViewModel] Final transcript received: \(transcript)")
            guard let self = self, !transcript.isEmpty else { return }
            Task { @MainActor in
                guard !self.pendingTranscriptSent else { return }
                self.pendingTranscriptSent = true
                self.isListening = false
                self.statusText = "Maya is thinking..."
                self.interimTranscript = ""
                self.sendMessage(transcript)
            }
        }

        speechService.onInterimResult = { [weak self] transcript in
            Task { @MainActor in
                self?.interimTranscript = transcript
                self?.statusText = transcript.isEmpty ? "Listening..." : transcript
            }
        }

        print("[MayaViewModel] init completed")
    }

    func requestSpeechAuthorization() {
        Task { @MainActor in
            isSpeechAuthorized = await speechService.requestAuthorization()
            if isSpeechAuthorized {
                startListening()
            } else {
                statusText = "Tap mic to speak"
            }
        }
    }

    private func startListening() {
        pendingTranscriptSent = false
        do {
            try speechService.startListening()
            isListening = true
            statusText = "Listening..."
        } catch {
            statusText = "Error: \(error.localizedDescription)"
        }
    }

    func toggleListening() {
        if isListening {
            let currentTranscript = interimTranscript
            speechService.stopListening()
            isListening = false

            if !currentTranscript.isEmpty && !pendingTranscriptSent {
                pendingTranscriptSent = true
                statusText = "Maya is thinking..."
                interimTranscript = ""
                sendMessage(currentTranscript)
            } else {
                statusText = "Type a message..."
                interimTranscript = ""
            }
        } else {
            pendingTranscriptSent = false
            guard isSpeechAuthorized else {
                statusText = "Speech not authorized"
                return
            }
            do {
                try speechService.startListening()
                isListening = true
                statusText = "Listening..."
            } catch {
                statusText = "Error: \(error.localizedDescription)"
            }
        }
    }

    func sendMessage(_ text: String) {
        // Add user message to UI
        let userMessage = ChatMessage(text: text, isUser: true, timestamp: Date())
        messages.append(userMessage)

        isLoading = true
        statusText = "Maya is thinking..."

        claudeService.chat(
            message: text,
            conversationHistory: conversationHistory,
            section: "maya",
            onText: { [weak self] responseText in
                guard let self = self else { return }

                // Extract mood from [MOOD:xxx] tag
                let mood = self.extractMood(from: responseText)
                let cleanedText = self.stripMoodTags(responseText)

                // Add Maya's response to UI
                let mayaMessage = ChatMessage(text: cleanedText, isUser: false, timestamp: Date())
                self.messages.append(mayaMessage)

                // Update conversation history
                self.conversationHistory.append(["role": "user", "content": text])
                self.conversationHistory.append(["role": "assistant", "content": cleanedText])
                if self.conversationHistory.count > 40 {
                    self.conversationHistory.removeFirst(2)
                }

                // Set mood and speak
                self.currentMood = mood
                self.isSpeaking = true
                self.statusText = "Maya is speaking..."
                self.speakWithAvatar(cleanedText)
            },
            onComplete: { [weak self] in
                self?.isLoading = false
            },
            onError: { [weak self] error in
                self?.isLoading = false
                self?.statusText = "Error: \(error.localizedDescription)"
                let errorMessage = ChatMessage(
                    text: "I'm sorry, I couldn't connect right now. Please try again.",
                    isUser: false,
                    timestamp: Date()
                )
                self?.messages.append(errorMessage)
            }
        )
    }

    /// Speak text with lip-sync: WKWebView handles both audio playback and lip animation
    /// Swift deactivates AVAudioSession to avoid conflicts with WKWebView's AudioContext
    private func speakWithAvatar(_ text: String) {
        guard !text.isEmpty else {
            isSpeaking = false
            restartListening()
            return
        }

        // Stop speech recognition and deactivate audio session to avoid conflicts
        if isListening {
            speechService.stopListening()
            isListening = false
        }

        // Deactivate AVAudioSession so WKWebView can use AudioContext
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            print("[MayaViewModel] Deactivated AVAudioSession for WKWebView audio")
        } catch {
            print("[MayaViewModel] Warning: Could not deactivate audio session: \(error)")
        }

        Task {
            do {
                // Fetch TTS with alignment data for lip-sync
                let response = try await ttsService.fetchTTSResponse(for: text)

                await MainActor.run {
                    // Create avatar audio data - WKWebView will play audio and animate lips
                    self.pendingAvatarAudio = AvatarAudioData(
                        audioData: response.audioData,
                        words: response.words,
                        wordTimes: response.wordTimes,
                        wordDurations: response.wordDurations
                    )
                    // Note: WKWebView sends 'speakingEnd' event when done,
                    // which calls onAvatarSpeakingEnd() to restart listening
                }
            } catch {
                print("[MayaViewModel] TTS error: \(error.localizedDescription)")
                await MainActor.run {
                    self.isSpeaking = false
                    self.reactivateAudioSession()
                    self.restartListening()
                }
            }
        }
    }

    /// Reactivate AVAudioSession after WKWebView finishes playing audio
    private func reactivateAudioSession() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
            print("[MayaViewModel] Reactivated AVAudioSession")
        } catch {
            print("[MayaViewModel] Error reactivating audio session: \(error)")
        }
    }

    /// Called when avatar finishes speaking (via WKWebView 'speakingEnd' event)
    func onAvatarSpeakingEnd() {
        print("[MayaViewModel] Avatar finished speaking")
        isSpeaking = false
        pendingAvatarAudio = nil

        // Reactivate AVAudioSession for speech recognition
        reactivateAudioSession()
        restartListening()
    }

    private func extractMood(from text: String) -> String {
        let pattern = "\\[MOOD:(\\w+)\\]"
        if let regex = try? NSRegularExpression(pattern: pattern),
           let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
           let moodRange = Range(match.range(at: 1), in: text) {
            let mood = String(text[moodRange]).lowercased()
            return VALID_MOODS.contains(mood) ? mood : "neutral"
        }
        return "neutral"
    }

    private func stripMoodTags(_ text: String) -> String {
        let pattern = "\\[MOOD:\\w+\\]\\s*"
        return text.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
    }

    private func restartListening() {
        guard isSpeechAuthorized else {
            statusText = "Type a message..."
            return
        }
        startListening()
    }

    func stopSpeaking() {
        ttsService.stop()
        isSpeaking = false
    }
}

#Preview {
    MayaView()
        .environmentObject(AppState())
}
