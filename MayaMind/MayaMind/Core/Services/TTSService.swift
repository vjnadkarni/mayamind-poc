//
//  TTSService.swift
//  MayaMind
//
//  Text-to-Speech service using ElevenLabs via server API
//

import Foundation
import AVFoundation
import Combine

class TTSService: NSObject, ObservableObject, AVAudioPlayerDelegate {
    @Published var isSpeaking = false

    private let baseURL: String
    private var audioPlayer: AVAudioPlayer?

    // Callback when speech finishes
    var onSpeechComplete: (() -> Void)?

    init(baseURL: String = "https://companion.mayamind.ai") {
        self.baseURL = baseURL
        super.init()
    }

    /// Speak text using ElevenLabs TTS
    func speak(_ text: String) {
        guard !text.isEmpty else {
            onSpeechComplete?()
            return
        }

        print("[TTSService] Speaking: \(text.prefix(50))...")

        Task {
            do {
                let audioData = try await fetchAudio(for: text)
                print("[TTSService] Received \(audioData.count) bytes of audio")
                await MainActor.run {
                    self.playAudio(audioData)
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

    /// Fetch audio from server's TTS endpoint
    private func fetchAudio(for text: String) async throws -> Data {
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

        print("[TTSService] Response status: \(httpResponse.statusCode), content-type: \(httpResponse.value(forHTTPHeaderField: "Content-Type") ?? "unknown")")

        guard httpResponse.statusCode == 200 else {
            throw TTSError.serverError
        }

        // Server returns JSON: { audio_base64: "...", alignment: {...} }
        // We need to decode the audio_base64 field
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let audioBase64 = json["audio_base64"] as? String,
              let audioData = Data(base64Encoded: audioBase64) else {
            print("[TTSService] Failed to parse audio_base64 from response")
            throw TTSError.invalidAudioData
        }

        return audioData
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
