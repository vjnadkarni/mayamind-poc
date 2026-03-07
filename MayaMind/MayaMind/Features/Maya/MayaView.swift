//
//  MayaView.swift
//  MayaMind
//
//  Maya conversation interface with TalkingHead avatar
//

import SwiftUI
import Combine

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

                    // Avatar area (WKWebView will be embedded here)
                    ZStack {
                        // AvatarWebView placeholder
                        Color(hex: "1a1a2e")

                        VStack {
                            Image(systemName: "person.wave.2.fill")
                                .font(.system(size: 80))
                                .foregroundColor(.orange.opacity(0.5))
                            Text("Maya Avatar")
                                .foregroundColor(.gray)
                                .padding(.top, 8)
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

class MayaViewModel: ObservableObject {
    @Published var messages: [ChatMessage] = []
    @Published var isListening = false
    @Published var isLoading = false
    @Published var isSpeaking = false
    @Published var statusText = "Type a message..."
    @Published var interimTranscript = ""

    private let claudeService = ClaudeAPIService()
    private let speechService = SpeechRecognitionService()
    private let ttsService = TTSService()
    private var conversationHistory: [[String: String]] = []
    private var isSpeechAuthorized = false
    private var pendingTranscriptSent = false  // Prevent double-sending

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
            guard let self = self, !transcript.isEmpty else {
                print("[MayaViewModel] Transcript empty or self is nil, skipping")
                return
            }
            // Use Task with MainActor to ensure SwiftUI observes the changes
            Task { @MainActor in
                guard !self.pendingTranscriptSent else {
                    print("[MayaViewModel] Transcript already sent, skipping")
                    return
                }
                print("[MayaViewModel] Updating UI on MainActor...")
                self.pendingTranscriptSent = true
                self.isListening = false
                self.statusText = "Maya is thinking..."
                self.interimTranscript = ""
                self.sendMessage(transcript)
                print("[MayaViewModel] sendMessage called")
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
        print("[MayaViewModel] requestSpeechAuthorization called")
        Task { @MainActor in
            print("[MayaViewModel] Requesting speech authorization...")
            isSpeechAuthorized = await speechService.requestAuthorization()
            print("[MayaViewModel] Speech authorized: \(isSpeechAuthorized)")
            if isSpeechAuthorized {
                // Auto-start listening after authorization
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
            print("[MayaViewModel] Auto-started listening")
        } catch {
            statusText = "Error: \(error.localizedDescription)"
            print("[MayaViewModel] Failed to start listening: \(error)")
        }
    }

    func toggleListening() {
        if isListening {
            print("[MayaViewModel] User tapped to stop listening")
            // Save current transcript before stopping (stopListening triggers error callback)
            let currentTranscript = interimTranscript
            speechService.stopListening()
            isListening = false

            // If we have a transcript and it hasn't been sent yet, send it now
            if !currentTranscript.isEmpty && !pendingTranscriptSent {
                print("[MayaViewModel] Sending transcript from manual stop: \(currentTranscript)")
                pendingTranscriptSent = true
                statusText = "Maya is thinking..."
                interimTranscript = ""
                sendMessage(currentTranscript)
            } else {
                statusText = "Type a message..."
                interimTranscript = ""
            }
        } else {
            // Reset flag when starting new listening session
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

        // Show loading state
        isLoading = true
        statusText = "Maya is thinking..."

        // Call Claude API (service will append user message to history internally)
        claudeService.chat(
            message: text,
            conversationHistory: conversationHistory,
            section: "maya",
            onText: { [weak self] responseText in
                guard let self = self else { return }

                // Strip mood tags if present
                let cleanedText = self.stripMoodTags(responseText)

                // Add Maya's response to UI
                let mayaMessage = ChatMessage(text: cleanedText, isUser: false, timestamp: Date())
                self.messages.append(mayaMessage)

                // Add both user and assistant messages to history for next turn
                self.conversationHistory.append(["role": "user", "content": text])
                self.conversationHistory.append(["role": "assistant", "content": cleanedText])

                // Keep history manageable (last 20 exchanges)
                if self.conversationHistory.count > 40 {
                    self.conversationHistory.removeFirst(2)
                }

                // Speak Maya's response
                self.isSpeaking = true
                self.statusText = "Maya is speaking..."
                self.ttsService.speak(cleanedText)
            },
            onComplete: { [weak self] in
                guard let self = self else { return }
                self.isLoading = false
                // Note: Listening restarts after TTS completes (via onSpeechComplete callback)
            },
            onError: { [weak self] error in
                self?.isLoading = false
                self?.statusText = "Error: \(error.localizedDescription)"

                // Add error message
                let errorMessage = ChatMessage(
                    text: "I'm sorry, I couldn't connect right now. Please try again.",
                    isUser: false,
                    timestamp: Date()
                )
                self?.messages.append(errorMessage)
            }
        )
    }

    private func stripMoodTags(_ text: String) -> String {
        // Remove [MOOD:xxx] tags from the response
        let pattern = "\\[MOOD:\\w+\\]\\s*"
        return text.replacingOccurrences(of: pattern, with: "", options: .regularExpression)
    }

    private func restartListening() {
        guard isSpeechAuthorized else {
            statusText = "Type a message..."
            return
        }
        startListening()
        print("[MayaViewModel] Restarted listening after TTS")
    }

    /// Stop Maya from speaking (for barge-in)
    func stopSpeaking() {
        ttsService.stop()
        isSpeaking = false
    }
}

#Preview {
    MayaView()
        .environmentObject(AppState())
}
