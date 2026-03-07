//
//  TTSService.swift
//  MayaMind
//
//  Text-to-Speech service using ElevenLabs via server API
//

import Foundation
import AVFoundation
import Combine

/// TTS response with audio and lip-sync alignment data
struct TTSResponse {
    let audioData: Data
    let words: [String]
    let wordTimes: [Double]
    let wordDurations: [Double]
}

class TTSService: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var isSpeaking = false

    private let baseURL: String
    private var audioPlayer: AVAudioPlayer?

    // Callback when speech finishes (for non-avatar playback)
    var onSpeechComplete: (() -> Void)?

    init(baseURL: String = "https://companion.mayamind.ai") {
        self.baseURL = baseURL
        super.init()
    }

    // MARK: - Simple Audio Playback (no avatar)

    /// Speak text using ElevenLabs TTS (audio-only, no avatar)
    func speak(_ text: String) {
        guard !text.isEmpty else {
            onSpeechComplete?()
            return
        }

        print("[TTSService] Speaking: \(text.prefix(50))...")

        Task {
            do {
                let response = try await fetchTTSResponse(for: text)
                print("[TTSService] Received \(response.audioData.count) bytes of audio")
                await MainActor.run {
                    self.playAudio(response.audioData)
                }
            } catch {
                print("[TTSService] Error: \(error.localizedDescription)")
                await MainActor.run {
                    self.isSpeaking = false
                    self.onSpeechComplete?()
                }
            }
        }
    }

    // MARK: - Avatar-aware TTS (returns full response with alignment)

    /// Fetch TTS with alignment data for lip-sync
    func fetchTTSResponse(for text: String) async throws -> TTSResponse {
        guard let url = URL(string: "\(baseURL)/api/tts") else {
            throw TTSError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "text": text,
            "voice_id": "21m00Tcm4TlvDq8ikWAM"  // Rachel voice
        ]

        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw TTSError.serverError
        }

        print("[TTSService] Response status: \(httpResponse.statusCode)")

        guard httpResponse.statusCode == 200 else {
            throw TTSError.serverError
        }

        // Server returns JSON: { audio_base64: "...", alignment: { characters: [...], ... } }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let audioBase64 = json["audio_base64"] as? String,
              let audioData = Data(base64Encoded: audioBase64) else {
            print("[TTSService] Failed to parse audio_base64 from response")
            throw TTSError.invalidAudioData
        }

        // Extract alignment for lip-sync
        let alignment = json["normalized_alignment"] as? [String: Any]
            ?? json["alignment"] as? [String: Any]

        let (words, wordTimes, wordDurations) = parseAlignment(alignment)

        return TTSResponse(
            audioData: audioData,
            words: words,
            wordTimes: wordTimes,
            wordDurations: wordDurations
        )
    }

    /// Parse ElevenLabs alignment data into word arrays for TalkingHead
    private func parseAlignment(_ alignment: [String: Any]?) -> ([String], [Double], [Double]) {
        guard let alignment = alignment,
              let characters = alignment["characters"] as? [String],
              let charStartTimes = alignment["character_start_times_seconds"] as? [Double],
              let charEndTimes = alignment["character_end_times_seconds"] as? [Double] else {
            return ([], [], [])
        }

        // Convert character-level alignment to word-level
        var words: [String] = []
        var wordTimes: [Double] = []
        var wordDurations: [Double] = []

        var currentWord = ""
        var wordStartTime: Double = 0

        for (i, char) in characters.enumerated() {
            if char == " " {
                // End of word
                if !currentWord.isEmpty {
                    words.append(currentWord)
                    wordTimes.append(wordStartTime)
                    let endTime = charEndTimes[i - 1]
                    wordDurations.append(endTime - wordStartTime)
                    currentWord = ""
                }
            } else {
                if currentWord.isEmpty {
                    wordStartTime = charStartTimes[i]
                }
                currentWord += char
            }
        }

        // Don't forget the last word
        if !currentWord.isEmpty {
            words.append(currentWord)
            wordTimes.append(wordStartTime)
            if let lastEndTime = charEndTimes.last {
                wordDurations.append(lastEndTime - wordStartTime)
            }
        }

        return (words, wordTimes, wordDurations)
    }

    // MARK: - Audio Playback

    /// Public method to play audio data (for external callers like MayaViewModel)
    func playAudioData(_ data: Data) {
        playAudio(data)
    }

    /// Play audio data by saving to temp file first (AVAudioPlayer handles files better)
    private func playAudio(_ data: Data) {
        do {
            // Configure audio session for playback
            let audioSession = AVAudioSession.sharedInstance()
            try audioSession.setCategory(.playAndRecord, mode: .default, options: [.defaultToSpeaker, .allowBluetooth])
            try audioSession.setActive(true)

            // Save to temp file - AVAudioPlayer handles MP3 files better than raw data
            let tempURL = FileManager.default.temporaryDirectory.appendingPathComponent("tts_audio.mp3")
            try data.write(to: tempURL)
            print("[TTSService] Saved audio to: \(tempURL.path)")

            audioPlayer = try AVAudioPlayer(contentsOf: tempURL)
            audioPlayer?.delegate = self

            isSpeaking = true
            audioPlayer?.play()
            print("[TTSService] Audio playing")
        } catch {
            print("[TTSService] Playback error: \(error.localizedDescription)")
            isSpeaking = false
            onSpeechComplete?()
        }
    }

    /// Stop any current speech
    func stop() {
        audioPlayer?.stop()
        audioPlayer = nil
        isSpeaking = false
    }

    // MARK: - AVAudioPlayerDelegate

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        print("[TTSService] Audio finished")
        DispatchQueue.main.async {
            self.isSpeaking = false
            self.onSpeechComplete?()
        }
    }
}

// MARK: - Errors

enum TTSError: LocalizedError {
    case invalidURL
    case serverError
    case invalidAudioData

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid TTS server URL"
        case .serverError:
            return "TTS server error"
        case .invalidAudioData:
            return "Invalid audio data in TTS response"
        }
    }
}
