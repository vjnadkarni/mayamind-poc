//
//  ConnectView.swift
//  MayaMind
//
//  WhatsApp messaging interface via Twilio with voice-driven conversation
//

import SwiftUI
import Combine
import AVFoundation

struct ConnectView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ConnectViewModel()
    @State private var showSettings = false
    @State private var showAddContact = false
    @State private var newContactName = ""
    @State private var newContactPhone = ""

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Top bar
                    HStack {
                        Text("Connect")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)

                        // Connection status
                        Circle()
                            .fill(viewModel.isServerConnected ? Color.green : Color.gray)
                            .frame(width: 8, height: 8)

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

                        // Settings button
                        Button(action: { showSettings = true }) {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.orange)
                                .padding(10)
                                .background(Color.white.opacity(0.1))
                                .cornerRadius(8)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.top, 8)

                    // Avatar area - TalkingHead in WKWebView with beach background
                    ZStack {
                        // Beach background image
                        if let bgImage = loadBackgroundImage(named: "background-beach") {
                            Image(uiImage: bgImage)
                                .resizable()
                                .aspectRatio(contentMode: .fill)
                        } else {
                            // Fallback gradient (beach colors)
                            LinearGradient(
                                colors: [Color(hex: "87CEEB").opacity(0.6), Color(hex: "F0E68C").opacity(0.4)],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        }

                        if viewModel.avatarReady {
                            AvatarWebView(
                                mood: $viewModel.currentMood,
                                isSpeaking: $viewModel.avatarSpeaking,
                                onReady: {
                                    print("[ConnectView] Avatar ready")
                                },
                                onSpeakingEnd: {
                                    viewModel.onAvatarSpeakingEnd()
                                },
                                audioToSpeak: viewModel.pendingAvatarAudio
                            )
                        } else {
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
                    .frame(height: geometry.size.height * 0.25)
                    .cornerRadius(16)
                    .padding(.horizontal)
                    .padding(.top, 12)

                    // Unread messages banner
                    if viewModel.unreadCount > 0 {
                        HStack {
                            Image(systemName: "envelope.badge.fill")
                                .foregroundColor(.pink)
                            Text("You have \(viewModel.unreadCount) new message\(viewModel.unreadCount > 1 ? "s" : "")")
                                .foregroundColor(.white)
                            Spacer()
                            Button("Play") {
                                viewModel.playUnreadMessages()
                            }
                            .foregroundColor(.orange)
                            .fontWeight(.semibold)
                        }
                        .padding(12)
                        .background(Color.pink.opacity(0.2))
                        .cornerRadius(12)
                        .padding(.horizontal)
                        .padding(.top, 8)
                    }

                    // Chat transcript
                    ScrollViewReader { scrollProxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 12) {
                                ForEach(viewModel.messages) { message in
                                    ConnectChatBubble(message: message)
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

                    // Contacts quick access
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(viewModel.contacts) { contact in
                                ContactButton(contact: contact, isSelected: viewModel.selectedContact?.id == contact.id) {
                                    viewModel.selectContact(contact)
                                }
                            }

                            // Add contact button
                            Button(action: { showAddContact = true }) {
                                VStack(spacing: 4) {
                                    Image(systemName: "plus.circle.fill")
                                        .font(.system(size: 32))
                                        .foregroundColor(.gray)
                                    Text("Add")
                                        .font(.system(size: 12))
                                        .foregroundColor(.gray)
                                }
                                .frame(width: 60, height: 60)
                            }
                        }
                        .padding(.horizontal)
                    }
                    .padding(.vertical, 8)

                    // Microphone button
                    HStack {
                        Spacer()

                        Button(action: { viewModel.toggleListening() }) {
                            ZStack {
                                if viewModel.isListening {
                                    Circle()
                                        .fill(Color.green.opacity(0.3))
                                        .frame(width: 64, height: 64)
                                }
                                Circle()
                                    .fill(viewModel.isListening ? Color.green : Color.orange)
                                    .frame(width: 56, height: 56)
                                Image(systemName: viewModel.isListening ? "waveform" : "mic.fill")
                                    .font(.system(size: 24))
                                    .foregroundColor(.white)
                            }
                        }
                        .disabled(viewModel.isLoading || appState.isMuted)

                        Spacer()
                    }
                    .padding(.vertical, 8)

                    // Status bar
                    HStack {
                        Circle()
                            .fill(statusColor)
                            .frame(width: 8, height: 8)
                        Text(viewModel.statusText)
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                            .lineLimit(1)
                        Spacer()
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }
            }
            .onAppear {
                viewModel.onAppear()
            }
            .onDisappear {
                viewModel.cleanup()
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
                    .environmentObject(appState)
            }
            .alert("Add Contact", isPresented: $showAddContact) {
                TextField("Name", text: $newContactName)
                TextField("Phone (+1...)", text: $newContactPhone)
                    .keyboardType(.phonePad)
                Button("Cancel", role: .cancel) {
                    newContactName = ""
                    newContactPhone = ""
                }
                Button("Add") {
                    if !newContactName.isEmpty && !newContactPhone.isEmpty {
                        viewModel.addContact(name: newContactName, phone: newContactPhone)
                        newContactName = ""
                        newContactPhone = ""
                    }
                }
            } message: {
                Text("Enter contact details")
            }
        }
    }

    private var statusColor: Color {
        if viewModel.isSpeaking {
            return .blue
        } else if viewModel.isLoading {
            return .orange
        } else if viewModel.isListening {
            return .green
        } else {
            return .gray
        }
    }

    private func loadBackgroundImage(named name: String) -> UIImage? {
        // Try multiple loading approaches
        if let path = Bundle.main.path(forResource: name, ofType: "jpg") {
            return UIImage(contentsOfFile: path)
        }
        if let url = Bundle.main.url(forResource: name, withExtension: "jpg") {
            return UIImage(contentsOfFile: url.path)
        }
        if let image = UIImage(named: "\(name).jpg") {
            return image
        }
        print("[ConnectView] Could not load background image: \(name)")
        return nil
    }
}

// MARK: - Chat Bubble

struct ConnectChatBubble: View {
    let message: ConnectMessage

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.direction == .received && message.contactName != "Maya" {
                // Contact avatar
                Circle()
                    .fill(Color.blue)
                    .frame(width: 32, height: 32)
                    .overlay(
                        Text(String(message.contactName.prefix(1)))
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                    )
            }

            VStack(alignment: message.direction == .sent ? .trailing : .leading, spacing: 4) {
                if message.direction == .received && message.contactName != "Maya" {
                    Text(message.contactName)
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                }

                // Image message
                if let imageURL = message.imageURL {
                    AsyncImage(url: imageURL) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 200, maxHeight: 200)
                            .cornerRadius(12)
                    } placeholder: {
                        Rectangle()
                            .fill(Color.gray.opacity(0.3))
                            .frame(width: 200, height: 150)
                            .cornerRadius(12)
                            .overlay(ProgressView())
                    }
                }

                // Text message
                if let text = message.text, !text.isEmpty {
                    Text(text)
                        .font(.system(size: 16))
                        .foregroundColor(.white)
                        .padding(12)
                        .background(bubbleColor)
                        .cornerRadius(16)
                }

                // Voice message indicator
                if message.isVoice {
                    HStack {
                        Image(systemName: "waveform")
                            .foregroundColor(.white)
                        Text("Voice message")
                            .font(.system(size: 14))
                            .foregroundColor(.white)
                    }
                    .padding(12)
                    .background(bubbleColor)
                    .cornerRadius(16)
                }

                Text(message.timestamp, style: .time)
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
            }

            if message.direction == .sent {
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, alignment: message.direction == .sent ? .trailing : .leading)
    }

    private var bubbleColor: Color {
        if message.direction == .sent {
            return .orange
        } else if message.contactName == "Maya" {
            return Color(hex: "2a2a3e")
        } else {
            return .blue.opacity(0.7)
        }
    }
}

// MARK: - Contact Button

struct ContactButton: View {
    let contact: Contact
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Circle()
                    .fill(isSelected ? Color.orange : Color.blue)
                    .frame(width: 44, height: 44)
                    .overlay(
                        Text(String(contact.name.prefix(1)))
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(.white)
                    )
                    .overlay(
                        Circle()
                            .stroke(isSelected ? Color.orange : Color.clear, lineWidth: 2)
                            .frame(width: 50, height: 50)
                    )
                Text(contact.name)
                    .font(.system(size: 12))
                    .foregroundColor(isSelected ? .orange : .white)
                    .lineLimit(1)
            }
            .frame(width: 60)
        }
    }
}

// MARK: - Models

struct Contact: Identifiable, Codable {
    var id: UUID
    let name: String
    let phone: String

    init(id: UUID = UUID(), name: String, phone: String) {
        self.id = id
        self.name = name
        self.phone = phone
    }
}

struct ConnectMessage: Identifiable {
    let id: UUID
    let contactName: String
    let text: String?
    let imageURL: URL?
    let isVoice: Bool
    let direction: MessageDirection
    let timestamp: Date
    var isRead: Bool

    init(id: UUID = UUID(), contactName: String, text: String?, imageURL: URL? = nil, isVoice: Bool = false, direction: MessageDirection, timestamp: Date = Date(), isRead: Bool = true) {
        self.id = id
        self.contactName = contactName
        self.text = text
        self.imageURL = imageURL
        self.isVoice = isVoice
        self.direction = direction
        self.timestamp = timestamp
        self.isRead = isRead
    }
}

enum MessageDirection {
    case sent
    case received
}

// MARK: - Valid moods for TalkingHead
private let VALID_MOODS = ["neutral", "happy", "angry", "sad", "fear", "disgust", "love", "sleep"]

// MARK: - ViewModel

class ConnectViewModel: ObservableObject {
    // UI State
    @Published var messages: [ConnectMessage] = []
    @Published var contacts: [Contact] = []
    @Published var selectedContact: Contact?
    @Published var unreadCount = 0
    @Published var isListening = false
    @Published var isLoading = false
    @Published var isSpeaking = false
    @Published var statusText = "Say \"Send a message to...\" to start"
    @Published var isServerConnected = false

    // Avatar state
    @Published var avatarReady = true
    @Published var currentMood = "happy"
    @Published var avatarSpeaking = false
    @Published var pendingAvatarAudio: AvatarAudioData?

    // Services
    private let claudeService = ClaudeAPIService()
    private let speechService = SpeechRecognitionService.shared
    private let ttsService = TTSService()
    private let twilioService = TwilioService()

    // State
    private var conversationHistory: [[String: String]] = []
    private var isSpeechAuthorized = false
    private var pendingTranscriptSent = false
    private var interimTranscript = ""

    // Persistence keys
    private let contactsKey = "mayamind_contacts"
    private let messagesKey = "mayamind_connect_messages"

    init() {
        print("[ConnectViewModel] init")
        loadContacts()
        loadMessages()
        setupSpeechCallbacks()
        setupTTSCallback()
    }

    private func setupSpeechCallbacks() {
        speechService.onTranscript = { [weak self] transcript in
            guard let self = self, !transcript.isEmpty else { return }
            Task { @MainActor in
                guard !self.pendingTranscriptSent else { return }
                self.pendingTranscriptSent = true
                self.isListening = false
                self.statusText = "Maya is thinking..."
                self.interimTranscript = ""
                self.processUserInput(transcript)
            }
        }

        speechService.onInterimResult = { [weak self] transcript in
            Task { @MainActor in
                self?.interimTranscript = transcript
                self?.statusText = transcript.isEmpty ? "Listening..." : transcript
            }
        }
    }

    private func setupTTSCallback() {
        ttsService.onSpeechComplete = { [weak self] in
            guard let self = self else { return }
            Task { @MainActor in
                self.isSpeaking = false
                self.restartListening()
            }
        }
    }

    // MARK: - Lifecycle

    func onAppear() {
        requestSpeechAuthorization()
        startSSEListener()

        // Add welcome message if empty
        if messages.isEmpty || messages.first?.contactName != "Maya" {
            let welcomeMessage = ConnectMessage(
                contactName: "Maya",
                text: "Who would you like to message? You can say something like \"Send a message to Carol\" or tap a contact below.",
                direction: .received
            )
            messages.insert(welcomeMessage, at: 0)
        }
    }

    func cleanup() {
        ttsService.stop()
        twilioService.stopListening()
        isSpeaking = false
        isListening = false

        // Only clear callbacks and deactivate audio session if speech service is not being used by another view
        if !speechService.isListening {
            // Clear callbacks since no one is using speech
            speechService.onTranscript = nil
            speechService.onInterimResult = nil
            speechService.onError = nil

            do {
                try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
                print("[ConnectViewModel] Audio session deactivated on cleanup")
            } catch {
                print("[ConnectViewModel] Warning: Could not deactivate audio session: \(error)")
            }
        } else {
            print("[ConnectViewModel] Skipping cleanup - speech still active (another view using it)")
        }
    }

    // MARK: - Speech

    func requestSpeechAuthorization() {
        Task { @MainActor in
            isSpeechAuthorized = await speechService.requestAuthorization()
            if isSpeechAuthorized {
                startListening()
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
                processUserInput(currentTranscript)
            } else {
                statusText = "Tap mic to speak"
            }
        } else {
            guard isSpeechAuthorized else {
                statusText = "Speech not authorized"
                return
            }
            startListening()
        }
    }

    private func restartListening() {
        guard isSpeechAuthorized else {
            statusText = "Tap mic to speak"
            return
        }
        startListening()
    }

    // MARK: - SSE Listener for incoming messages

    private func startSSEListener() {
        twilioService.startListening { [weak self] incomingMessage in
            self?.handleIncomingMessage(incomingMessage)
        }
        isServerConnected = true
    }

    private func handleIncomingMessage(_ incoming: IncomingMessage) {
        // Find contact by phone number
        let phone = incoming.from.replacingOccurrences(of: "whatsapp:", with: "")
        let contactName = contacts.first(where: { $0.phone == phone })?.name ?? phone

        // Determine message type
        var imageURL: URL? = nil
        let isVoice = incoming.mediaContentType?.contains("audio") ?? false

        if let mediaUrl = incoming.mediaUrl,
           let contentType = incoming.mediaContentType,
           contentType.contains("image") {
            imageURL = URL(string: "https://companion.mayamind.ai\(mediaUrl)")
        }

        let message = ConnectMessage(
            contactName: contactName,
            text: incoming.body,
            imageURL: imageURL,
            isVoice: isVoice,
            direction: .received,
            isRead: false
        )

        Task { @MainActor in
            self.messages.append(message)
            self.unreadCount += 1
            self.saveMessages()

            // Announce if not currently speaking
            if !self.isSpeaking && !self.isLoading {
                let announcement = "You have a new message from \(contactName)"
                self.speakText(announcement, mood: "happy")
            }
        }
    }

    // MARK: - Process User Input

    private func processUserInput(_ text: String) {
        // Add user message to chat
        let userMessage = ConnectMessage(
            contactName: "You",
            text: text,
            direction: .sent
        )
        messages.append(userMessage)

        isLoading = true
        statusText = "Maya is thinking..."

        // Build contacts list for Claude
        let contactsForServer = contacts.map { ["name": $0.name, "phone": $0.phone] }

        claudeService.chat(
            message: text,
            conversationHistory: conversationHistory,
            section: "connect",
            contacts: contactsForServer,
            onText: { [weak self] responseText in
                guard let self = self else { return }
                self.handleClaudeResponse(responseText, userText: text)
            },
            onComplete: { [weak self] in
                self?.isLoading = false
            },
            onError: { [weak self] error in
                self?.isLoading = false
                self?.statusText = "Error: \(error.localizedDescription)"
                self?.addMayaMessage("I'm sorry, I couldn't process that. Please try again.")
            }
        )
    }

    private func handleClaudeResponse(_ responseText: String, userText: String) {
        // Extract mood
        let mood = extractMood(from: responseText)

        // Parse ACTION tags
        let actions = parseActions(from: responseText)

        // Get clean text (no mood or action tags)
        var cleanedText = stripMoodTags(responseText)
        cleanedText = stripActionTags(cleanedText)

        // Update conversation history
        conversationHistory.append(["role": "user", "content": userText])
        conversationHistory.append(["role": "assistant", "content": cleanedText])
        if conversationHistory.count > 40 {
            conversationHistory.removeFirst(2)
        }

        // Add Maya's response to chat
        if !cleanedText.isEmpty {
            addMayaMessage(cleanedText)
        }

        // Execute actions
        for action in actions {
            executeAction(action)
        }

        // Speak response
        currentMood = mood
        if !cleanedText.isEmpty {
            speakText(cleanedText, mood: mood)
        }
    }

    // MARK: - ACTION Tag Parsing

    private func parseActions(from text: String) -> [(String, [String: String])] {
        var actions: [(String, [String: String])] = []

        // Pattern: [ACTION:TYPE param="value" param2="value2"]
        let pattern = #"\[ACTION:(\w+)([^\]]*)\]"#
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return actions }

        let matches = regex.matches(in: text, range: NSRange(text.startIndex..., in: text))

        for match in matches {
            if let typeRange = Range(match.range(at: 1), in: text),
               let paramsRange = Range(match.range(at: 2), in: text) {
                let actionType = String(text[typeRange])
                let paramsStr = String(text[paramsRange])

                // Parse parameters: name="value"
                var params: [String: String] = [:]
                let paramPattern = #"(\w+)="([^"]*)""#
                if let paramRegex = try? NSRegularExpression(pattern: paramPattern) {
                    let paramMatches = paramRegex.matches(in: paramsStr, range: NSRange(paramsStr.startIndex..., in: paramsStr))
                    for paramMatch in paramMatches {
                        if let keyRange = Range(paramMatch.range(at: 1), in: paramsStr),
                           let valueRange = Range(paramMatch.range(at: 2), in: paramsStr) {
                            params[String(paramsStr[keyRange])] = String(paramsStr[valueRange])
                        }
                    }
                }

                actions.append((actionType, params))
            }
        }

        return actions
    }

    private func executeAction(_ action: (String, [String: String])) {
        let (type, params) = action
        print("[ConnectViewModel] Executing action: \(type) with params: \(params)")

        switch type {
        case "ADD_CONTACT":
            if let name = params["name"], let phone = params["phone"] {
                addContact(name: name, phone: phone)
            }

        case "SEND_TEXT":
            if let to = params["to"], let message = params["message"] {
                sendTextMessage(to: to, message: message)
            }

        case "SEND_VOICE":
            if let to = params["to"] {
                // Voice recording would be triggered here
                statusText = "Voice message to \(to) - tap to record"
            }

        case "PLAY_MESSAGE":
            playUnreadMessages()

        case "CANCEL":
            statusText = "Cancelled"

        default:
            print("[ConnectViewModel] Unknown action: \(type)")
        }
    }

    // MARK: - Messaging

    func sendTextMessage(to contactName: String, message: String) {
        print("[ConnectViewModel] Looking up contact: '\(contactName)'")
        print("[ConnectViewModel] Available contacts: \(contacts.map { "\($0.name): \($0.phone)" })")

        guard let contact = contacts.first(where: { $0.name.lowercased() == contactName.lowercased() }) else {
            addMayaMessage("I don't have a contact named \(contactName). Would you like to add them?")
            return
        }

        print("[ConnectViewModel] Found contact: \(contact.name) with phone: \(contact.phone)")

        // Add to UI immediately
        let outgoingMessage = ConnectMessage(
            contactName: contact.name,
            text: message,
            direction: .sent
        )
        messages.append(outgoingMessage)
        saveMessages()

        // Send via Twilio
        Task {
            do {
                let response = try await twilioService.sendTextMessage(to: contact.phone, message: message)
                if response.success {
                    print("[ConnectViewModel] Message sent successfully: \(response.messageSid ?? "")")
                } else {
                    await MainActor.run {
                        self.addMayaMessage("I couldn't send that message. \(response.error ?? "Unknown error")")
                    }
                }
            } catch {
                await MainActor.run {
                    self.addMayaMessage("Sorry, there was an error sending the message: \(error.localizedDescription)")
                }
            }
        }
    }

    func playUnreadMessages() {
        let unreadMessages = messages.filter { !$0.isRead && $0.direction == .received && $0.contactName != "Maya" }

        guard !unreadMessages.isEmpty else {
            speakText("You have no new messages.", mood: "neutral")
            return
        }

        // Mark as read
        for i in 0..<messages.count {
            if !messages[i].isRead && messages[i].direction == .received {
                messages[i].isRead = true
            }
        }
        unreadCount = 0
        saveMessages()

        // Build announcement
        var announcement = ""
        for msg in unreadMessages {
            if let text = msg.text, !text.isEmpty {
                announcement += "\(msg.contactName) says: \(text). "
            } else if msg.isVoice {
                announcement += "\(msg.contactName) sent a voice message. "
            } else if msg.imageURL != nil {
                announcement += "\(msg.contactName) sent a photo. "
            }
        }

        speakText(announcement, mood: "happy")
    }

    // MARK: - Contacts

    func selectContact(_ contact: Contact) {
        selectedContact = contact
        statusText = "What would you like to say to \(contact.name)?"
    }

    func addContact(name: String, phone: String) {
        // Normalize phone number
        var normalizedPhone = phone.trimmingCharacters(in: .whitespaces)
        if !normalizedPhone.hasPrefix("+") {
            normalizedPhone = "+1" + normalizedPhone.replacingOccurrences(of: "-", with: "").replacingOccurrences(of: " ", with: "")
        }

        let newContact = Contact(name: name, phone: normalizedPhone)
        contacts.append(newContact)
        saveContacts()

        addMayaMessage("I've added \(name) to your contacts.")
    }

    // MARK: - TTS

    private func speakText(_ text: String, mood: String) {
        guard !text.isEmpty else { return }

        isSpeaking = true
        statusText = "Maya is speaking..."

        // Stop listening during speech
        if isListening {
            speechService.stopListening()
            isListening = false
        }

        // Deactivate AVAudioSession for WKWebView
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("[ConnectViewModel] Warning: Could not deactivate audio session: \(error)")
        }

        Task {
            do {
                let response = try await ttsService.fetchTTSResponse(for: text)
                await MainActor.run {
                    self.pendingAvatarAudio = AvatarAudioData(
                        audioData: response.audioData,
                        words: response.words,
                        wordTimes: response.wordTimes,
                        wordDurations: response.wordDurations
                    )
                }
            } catch {
                print("[ConnectViewModel] TTS error: \(error)")
                await MainActor.run {
                    self.isSpeaking = false
                    self.reactivateAudioSession()
                    self.restartListening()
                }
            }
        }
    }

    func onAvatarSpeakingEnd() {
        print("[ConnectViewModel] Avatar finished speaking")
        isSpeaking = false
        pendingAvatarAudio = nil
        reactivateAudioSession()
        restartListening()
    }

    private func reactivateAudioSession() {
        do {
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)
        } catch {
            print("[ConnectViewModel] Error reactivating audio session: \(error)")
        }
    }

    // MARK: - Helpers

    private func addMayaMessage(_ text: String) {
        let message = ConnectMessage(
            contactName: "Maya",
            text: text,
            direction: .received
        )
        messages.append(message)
        saveMessages()
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
        text.replacingOccurrences(of: "\\[MOOD:\\w+\\]\\s*", with: "", options: .regularExpression)
    }

    private func stripActionTags(_ text: String) -> String {
        text.replacingOccurrences(of: "\\[ACTION:[^\\]]+\\]\\s*", with: "", options: .regularExpression)
    }

    // MARK: - Persistence

    private func loadContacts() {
        if let data = UserDefaults.standard.data(forKey: contactsKey),
           let savedContacts = try? JSONDecoder().decode([Contact].self, from: data) {
            contacts = savedContacts
        } else {
            // Default contacts
            contacts = [
                Contact(name: "Carol", phone: "+14085551234"),
                Contact(name: "David", phone: "+14085555678")
            ]
        }
    }

    private func saveContacts() {
        if let data = try? JSONEncoder().encode(contacts) {
            UserDefaults.standard.set(data, forKey: contactsKey)
        }
    }

    private func loadMessages() {
        // Messages are not persisted for now to keep things simple
        // In production, would use SQLite or Core Data
    }

    private func saveMessages() {
        // Placeholder for persistence
    }
}

#Preview {
    ConnectView()
        .environmentObject(AppState())
}
