//
//  SpeechRecognitionService.swift
//  MayaMind
//
//  Native Apple Speech framework for speech-to-text
//

import Foundation
import Speech
import AVFoundation
import Combine

class SpeechRecognitionService: ObservableObject {
    @Published var isListening = false
    @Published var transcript = ""
    @Published var error: Error?

    private var speechRecognizer: SFSpeechRecognizer?
    private var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    private var recognitionTask: SFSpeechRecognitionTask?
    private var audioEngine: AVAudioEngine?

    // Keep track of the last non-empty transcript (workaround for empty final results)
    private var lastGoodTranscript = ""

    // Silence detection timer
    private var silenceTimer: Timer?
    private let silenceTimeout: TimeInterval = 2.0  // Auto-finalize after 2 seconds of silence

    // Callback for final transcript
    var onTranscript: ((String) -> Void)?

    // Callback for interim results (for echo detection)
    var onInterimResult: ((String) -> Void)?

    init() {
        speechRecognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US"))
    }

    private func resetSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = nil

        // Only start timer if we have a transcript to send
        guard !lastGoodTranscript.isEmpty else { return }

        silenceTimer = Timer.scheduledTimer(withTimeInterval: silenceTimeout, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            print("[SpeechService] Silence timeout - auto-finalizing")
            DispatchQueue.main.async {
                let transcript = self.lastGoodTranscript
                guard !transcript.isEmpty else { return }

                self.transcript = ""
                self.lastGoodTranscript = ""
                self.stopListening()

                self.onTranscript?(transcript)
            }
        }
    }

    private func cancelSilenceTimer() {
        silenceTimer?.invalidate()
        silenceTimer = nil
    }

    func requestAuthorization() async -> Bool {
        // Request speech recognition permission
        let speechAuthorized = await withCheckedContinuation { continuation in
            SFSpeechRecognizer.requestAuthorization { status in
                print("[SpeechService] Speech authorization status: \(status.rawValue)")
                continuation.resume(returning: status == .authorized)
            }
        }

        guard speechAuthorized else {
            print("[SpeechService] Speech recognition not authorized")
            return false
        }

        // Request microphone permission
        let micAuthorized = await withCheckedContinuation { continuation in
            AVAudioSession.sharedInstance().requestRecordPermission { granted in
                print("[SpeechService] Microphone authorization: \(granted)")
                continuation.resume(returning: granted)
            }
        }

        return micAuthorized
    }

    func startListening() throws {
        print("[SpeechService] startListening called")

        guard let speechRecognizer = speechRecognizer, speechRecognizer.isAvailable else {
            print("[SpeechService] Speech recognizer not available")
            throw SpeechError.notAvailable
        }

        // Cancel any existing task
        stopListening()

        // Configure audio session
        let audioSession = AVAudioSession.sharedInstance()
        try audioSession.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .allowBluetooth])
        try audioSession.setActive(true, options: .notifyOthersOnDeactivation)
        print("[SpeechService] Audio session configured")

        // Create recognition request
        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else {
            print("[SpeechService] Failed to create recognition request")
            throw SpeechError.requestFailed
        }

        recognitionRequest.shouldReportPartialResults = true

        // Don't force on-device recognition - it requires Siri to be enabled
        // Let the system choose (will use server if on-device unavailable)
        if #available(iOS 13, *) {
            recognitionRequest.requiresOnDeviceRecognition = false
            print("[SpeechService] On-device recognition available: \(speechRecognizer.supportsOnDeviceRecognition)")
        }

        // Create audio engine
        audioEngine = AVAudioEngine()
        guard let audioEngine = audioEngine else {
            print("[SpeechService] Failed to create audio engine")
            throw SpeechError.audioEngineFailed
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)
        print("[SpeechService] Audio format: \(recordingFormat)")

        inputNode.installTap(onBus: 0, bufferSize: 1024, format: recordingFormat) { [weak self] buffer, _ in
            self?.recognitionRequest?.append(buffer)
        }
        print("[SpeechService] Audio tap installed")

        // Reset last good transcript
        lastGoodTranscript = ""

        // Start recognition task
        recognitionTask = speechRecognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }

            DispatchQueue.main.async {
                if let result = result {
                    let transcript = result.bestTranscription.formattedString
                    print("[SpeechService] Transcript: \(transcript) (isFinal: \(result.isFinal))")

                    // Store non-empty transcripts (workaround for empty final results)
                    if !transcript.isEmpty {
                        self.lastGoodTranscript = transcript
                        // Reset silence timer - will auto-finalize after 2s of no new speech
                        self.resetSilenceTimer()
                    }

                    self.transcript = transcript
                    self.onInterimResult?(transcript)

                    if result.isFinal {
                        print("[SpeechService] Final result received")
                        // Use lastGoodTranscript if final is empty
                        let finalText = transcript.isEmpty ? self.lastGoodTranscript : transcript
                        print("[SpeechService] Sending final transcript: \(finalText)")
                        self.transcript = ""
                        self.lastGoodTranscript = ""

                        // Stop listening first, then send transcript
                        self.stopListening()

                        if !finalText.isEmpty {
                            self.onTranscript?(finalText)
                        }
                        return // Don't process error after final
                    }
                }

                if let error = error {
                    print("[SpeechService] Recognition error: \(error.localizedDescription)")
                    // If we have a good transcript, send it before stopping
                    let savedTranscript = self.lastGoodTranscript
                    self.lastGoodTranscript = ""
                    self.error = error
                    self.stopListening()

                    if !savedTranscript.isEmpty {
                        print("[SpeechService] Sending last good transcript on error: \(savedTranscript)")
                        self.onTranscript?(savedTranscript)
                    }
                }
            }
        }
        print("[SpeechService] Recognition task started")

        // Start audio engine
        audioEngine.prepare()
        try audioEngine.start()
        print("[SpeechService] Audio engine started")

        isListening = true
    }

    func stopListening() {
        cancelSilenceTimer()

        audioEngine?.stop()
        audioEngine?.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()
        recognitionTask?.cancel()

        audioEngine = nil
        recognitionRequest = nil
        recognitionTask = nil

        isListening = false
    }
}

enum SpeechError: LocalizedError {
    case notAvailable
    case requestFailed
    case audioEngineFailed

    var errorDescription: String? {
        switch self {
        case .notAvailable:
            return "Speech recognition is not available on this device"
        case .requestFailed:
            return "Failed to create speech recognition request"
        case .audioEngineFailed:
            return "Failed to initialize audio engine"
        }
    }
}
