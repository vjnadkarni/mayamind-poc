//
//  ToDosViewModel.swift
//  MayaMind
//
//  ViewModel for To Dos: voice input, speech recognition, Claude parsing, TTS
//

import Foundation
import Combine
import Speech
import AVFoundation

@MainActor
class ToDosViewModel: ObservableObject {
    @Published var isListening = false
    @Published var transcript = ""
    @Published var timeRemaining = 10
    @Published var isSpeaking = false

    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var audioEngine: AVAudioEngine?

    private var timeoutTimer: Timer?
    private var silenceTimer: Timer?

    private let store = ToDoStore.shared
    private let ttsService = TTSService()

    init() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    // MARK: - TTS (Direct Audio Playback)

    private func speak(_ text: String) {
        guard !text.isEmpty else {
            // No speech, restart listening immediately
            startListening()
            return
        }

        isSpeaking = true
        print("[ToDos] Speaking: \(text.prefix(50))...")

        // Set up completion handler - auto-restart listening after Maya speaks
        ttsService.onSpeechComplete = { [weak self] in
            Task { @MainActor in
                self?.isSpeaking = false
                // Automatically restart listening for continuous conversation
                self?.startListening()
            }
        }

        // Play audio directly through TTSService
        ttsService.speak(text)
    }

    // MARK: - Notification Permission

    func requestNotificationPermission() {
        ToDoNotificationService.shared.requestAuthorization { granted in
            print("[ToDos] Notification permission: \(granted)")
            if granted {
                // Schedule end-of-day check
                ToDoNotificationService.shared.scheduleEndOfDayCheck()
            }
        }
    }

    // MARK: - Voice Input

    func startListening() {
        guard !isListening else { return }

        // Request speech authorization
        SFSpeechRecognizer.requestAuthorization { [weak self] status in
            Task { @MainActor in
                guard status == .authorized else {
                    print("[ToDos] Speech recognition not authorized: \(status)")
                    return
                }
                self?.beginRecording()
            }
        }
    }

    func cancelListening() {
        stopRecording()
        transcript = ""
    }

    private func beginRecording() {
        // Reset state
        transcript = ""
        timeRemaining = 300 // 5 minutes for interactive conversation
        isListening = true

        // Setup audio
        audioEngine = AVAudioEngine()

        guard let audioEngine = audioEngine,
              let speechRecognizer = speechRecognizer,
              speechRecognizer.isAvailable else {
            print("[ToDos] Speech recognizer not available")
            stopRecording()
            return
        }

        // Create recognition request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()

        guard let recognitionRequest = recognitionRequest else {
            stopRecording()
            return
        }

        recognitionRequest.shouldReportPartialResults = true

        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        do {
            try audioSession.setCategory(.record, mode: .measurement, options: .duckOthers)
            try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        } catch {
            print("[ToDos] Audio session error: \(error)")
            stopRecording()
            return
        }

        // Start recognition
        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }

        do {
            audioEngine.prepare()
            try audioEngine.start()
        } catch {
            print("[ToDos] Audio engine error: \(error)")
            stopRecording()
            return
        }

        // Start recognition task
        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            Task { @MainActor in
                if let result = result {
                    self?.transcript = result.bestTranscription.formattedString
                    self?.resetSilenceTimer()
                }

                if error != nil || result?.isFinal == true {
                    self?.processTranscript()
                }
            }
        }

        // Start countdown timer
        startTimeoutTimer()
    }

    private func stopRecording() {
        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        timeoutTimer?.invalidate()
        silenceTimer?.invalidate()

        recognitionRequest = nil
        recognitionTask = nil
        audioEngine = nil

        isListening = false

        // Deactivate audio session
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        } catch {
            print("[ToDos] Audio session deactivation error: \(error)")
        }
    }

    private func startTimeoutTimer() {
        timeoutTimer?.invalidate()
        timeRemaining = 300 // 5 minutes for interactive conversation

        timeoutTimer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self = self else { return }
                self.timeRemaining -= 1

                if self.timeRemaining <= 0 {
                    self.processTranscript()
                }
            }
        }
    }

    private func resetSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = Timer.scheduledTimer(withTimeInterval: 2.0, repeats: false) { [weak self] _ in
            Task { @MainActor in
                // If we have a transcript and 2 seconds of silence, process it
                if let self = self, !self.transcript.isEmpty {
                    self.processTranscript()
                }
            }
        }
    }

    // MARK: - Process Voice Input

    private func processTranscript() {
        let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
        stopRecording()

        guard !text.isEmpty else {
            print("[ToDos] Empty transcript, ignoring")
            return
        }

        print("[ToDos] Processing: \(text)")

        // Send to Claude for parsing
        Task {
            await parseWithClaude(text: text)
        }
    }

    private func parseWithClaude(text: String) async {
        // Build context about existing items
        let medications = store.items(for: .medication).prefix(5).map { $0.title }.joined(separator: ", ")
        let appointments = store.items(for: .appointment).prefix(5).map { $0.title }.joined(separator: ", ")
        let tasks = store.items(for: .task).prefix(5).map { $0.title }.joined(separator: ", ")

        let systemPrompt = """
        You are Maya, a friendly AI assistant helping a senior manage their to-do list. Parse the user's voice input and respond with a JSON action.

        Current items:
        - Medications: \(medications.isEmpty ? "none" : medications)
        - Appointments: \(appointments.isEmpty ? "none" : appointments)
        - Tasks: \(tasks.isEmpty ? "none" : tasks)

        Today's date: \(formattedToday())
        Current time: \(formattedTime())

        Based on the user's input, respond with ONLY a JSON object (no other text):

        For adding items:
        {"action": "add", "category": "medication|appointment|task", "title": "item title", "date": "YYYY-MM-DD", "time": "HH:MM", "end_time": "HH:MM" (optional), "recurrence": "none|daily|weekly|biweekly|monthly"}

        For marking complete:
        {"action": "complete", "title": "partial or full title match"}

        For listing/reading items (when user asks what's on their list, schedule, etc.):
        {"action": "list", "category": "all|medication|appointment|task"}

        For unclear requests:
        {"action": "clarify", "message": "Your clarifying question"}

        Examples:
        - "Remind me to take blood pressure pill at 8am every day" → {"action": "add", "category": "medication", "title": "Blood pressure pill", "date": "2026-03-12", "time": "08:00", "recurrence": "daily"}
        - "I have a doctor appointment tomorrow at 2:30" → {"action": "add", "category": "appointment", "title": "Doctor appointment", "date": "2026-03-13", "time": "14:30", "end_time": "15:30", "recurrence": "none"}
        - "Add pick up groceries to my tasks" → {"action": "add", "category": "task", "title": "Pick up groceries", "date": "2026-03-12", "time": "12:00", "recurrence": "none"}
        - "I took my vitamin" → {"action": "complete", "title": "vitamin"}
        - "What are my tasks for today?" → {"action": "list", "category": "task"}
        - "What's on my schedule?" → {"action": "list", "category": "all"}
        - "Read my appointments" → {"action": "list", "category": "appointment"}
        - "What medications do I need to take?" → {"action": "list", "category": "medication"}
        """

        do {
            let response = try await callClaude(systemPrompt: systemPrompt, userMessage: text)
            await handleClaudeResponse(response)
        } catch {
            print("[ToDos] Claude error: \(error)")
        }
    }

    private func callClaude(systemPrompt: String, userMessage: String) async throws -> String {
        // Use the todos-specific endpoint that accepts custom system prompts
        guard let url = URL(string: "https://companion.mayamind.ai/api/chat/todos") else {
            throw URLError(.badURL)
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "message": userMessage,
            "system": systemPrompt
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)

        // Parse SSE response - collect all text chunks
        var fullText = ""
        let responseString = String(data: data, encoding: .utf8) ?? ""

        for line in responseString.components(separatedBy: "\n") {
            if line.hasPrefix("data: ") {
                let jsonString = String(line.dropFirst(6))
                if let jsonData = jsonString.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                   let text = json["text"] as? String {
                    fullText += text
                }
            }
        }

        return fullText
    }

    private func handleClaudeResponse(_ response: String) async {
        // Extract JSON from response
        guard let jsonData = extractJSON(from: response),
              let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
              let action = json["action"] as? String else {
            print("[ToDos] Could not parse Claude response: \(response)")
            return
        }

        switch action {
        case "add":
            await handleAddAction(json)
        case "complete":
            handleCompleteAction(json)
        case "list":
            handleListAction(json)
        case "clarify":
            if let message = json["message"] as? String {
                print("[ToDos] Clarification needed: \(message)")
                speak(message)
            }
        default:
            print("[ToDos] Unknown action: \(action)")
        }
    }

    private func handleAddAction(_ json: [String: Any]) async {
        guard let categoryStr = json["category"] as? String,
              let category = ToDoCategory(rawValue: categoryStr),
              let title = json["title"] as? String else {
            return
        }

        // Parse date
        let dateStr = json["date"] as? String ?? formattedToday()
        let timeStr = json["time"] as? String ?? "09:00"
        let endTimeStr = json["end_time"] as? String

        let dateFormatter = DateFormatter()
        dateFormatter.dateFormat = "yyyy-MM-dd"
        let scheduledDate = dateFormatter.date(from: dateStr) ?? Date()

        let timeFormatter = DateFormatter()
        timeFormatter.dateFormat = "HH:mm"
        let startTime = timeFormatter.date(from: timeStr) ?? Date()
        let endTime = endTimeStr.flatMap { timeFormatter.date(from: $0) }

        // Parse recurrence
        let recurrenceStr = json["recurrence"] as? String ?? "none"
        let pattern = RecurrencePattern(rawValue: recurrenceStr) ?? .none
        let recurrence = Recurrence(pattern: pattern, endDate: nil)

        // Create item
        var newItem = ToDoItem(
            title: title,
            category: category,
            scheduledDate: scheduledDate,
            startTime: startTime,
            endTime: endTime,
            recurrence: recurrence
        )

        // Schedule notifications
        let notificationIds = ToDoNotificationService.shared.scheduleNotifications(for: newItem)
        newItem.notificationIds = notificationIds

        // Add to store
        store.addItem(newItem)

        print("[ToDos] Added: \(title) (\(category.displayName))")

        // Speak confirmation
        let timeDisplay = formatTimeForSpeech(startTime)
        let dateDisplay = formatDateForSpeech(scheduledDate)

        var confirmation: String
        switch category {
        case .medication:
            confirmation = "Got it! I'll remind you to take \(title) at \(timeDisplay) on \(dateDisplay)."
        case .appointment:
            confirmation = "All set! I've added your \(title) appointment for \(dateDisplay) at \(timeDisplay)."
        case .task:
            confirmation = "Done! I've added \(title) to your tasks for \(dateDisplay)."
        }

        if pattern != .none {
            confirmation += " It's set to repeat \(pattern.displayName.lowercased())."
        }

        speak(confirmation)
    }

    private func formatTimeForSpeech(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }

    private func formatDateForSpeech(_ date: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(date) {
            return "today"
        } else if calendar.isDateInTomorrow(date) {
            return "tomorrow"
        } else {
            let formatter = DateFormatter()
            formatter.dateFormat = "EEEE, MMMM d"
            return formatter.string(from: date)
        }
    }

    private func handleCompleteAction(_ json: [String: Any]) {
        guard let titleQuery = json["title"] as? String else { return }

        let query = titleQuery.lowercased()

        // Find matching item
        if let item = store.items.first(where: {
            !$0.isCompleted && $0.title.lowercased().contains(query)
        }) {
            store.markCompleted(item)
            ToDoNotificationService.shared.cancelNotifications(for: item)
            print("[ToDos] Completed: \(item.title)")

            // Speak confirmation
            speak("Great job! I've marked \(item.title) as complete.")
        } else {
            speak("I couldn't find that item. Could you try again?")
        }
    }

    private func handleListAction(_ json: [String: Any]) {
        let categoryStr = json["category"] as? String ?? "all"

        var response = ""

        if categoryStr == "all" || categoryStr == "appointment" {
            let appointments = store.items(for: .appointment).prefix(3)
            if appointments.isEmpty {
                response += "You have no upcoming appointments. "
            } else {
                response += "Your upcoming appointments: "
                for (index, item) in appointments.enumerated() {
                    let timeDisplay = formatTimeForSpeech(item.startTime)
                    let dateDisplay = formatDateForSpeech(item.scheduledDate)
                    response += "\(item.title) at \(timeDisplay) on \(dateDisplay)"
                    if index < appointments.count - 1 {
                        response += ". "
                    }
                }
                response += ". "
            }
        }

        if categoryStr == "all" || categoryStr == "task" {
            let tasks = store.items(for: .task).prefix(3)
            if tasks.isEmpty {
                response += "You have no tasks scheduled. "
            } else {
                response += "Your upcoming tasks: "
                for (index, item) in tasks.enumerated() {
                    let dateDisplay = formatDateForSpeech(item.scheduledDate)
                    response += "\(item.title) on \(dateDisplay)"
                    if index < tasks.count - 1 {
                        response += ". "
                    }
                }
                response += ". "
            }
        }

        if categoryStr == "all" || categoryStr == "medication" {
            let medications = store.items(for: .medication).prefix(3)
            if medications.isEmpty {
                response += "You have no medications scheduled. "
            } else {
                response += "Your medications: "
                for (index, item) in medications.enumerated() {
                    let timeDisplay = formatTimeForSpeech(item.startTime)
                    response += "\(item.title) at \(timeDisplay)"
                    if item.recurrence.pattern != .none {
                        response += ", \(item.recurrence.pattern.displayName.lowercased())"
                    }
                    if index < medications.count - 1 {
                        response += ". "
                    }
                }
                response += ". "
            }
        }

        if response.isEmpty {
            response = "I couldn't find any items to read."
        }

        print("[ToDos] Reading items: \(response)")
        speak(response)
    }

    // MARK: - Helpers

    private func formattedToday() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: Date())
    }

    private func formattedTime() -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        return formatter.string(from: Date())
    }

    private func extractJSON(from text: String) -> Data? {
        // Find JSON object in text
        if let start = text.firstIndex(of: "{"),
           let end = text.lastIndex(of: "}") {
            let jsonString = String(text[start...end])
            return jsonString.data(using: .utf8)
        }
        return nil
    }
}
