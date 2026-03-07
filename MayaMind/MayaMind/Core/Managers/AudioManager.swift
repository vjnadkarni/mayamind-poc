//
//  AudioManager.swift
//  MayaMind
//
//  Centralized audio session and playback management
//

import Foundation
import AVFoundation
import Combine

class AudioManager: ObservableObject {
    static let shared = AudioManager()

    @Published var isPlaying = false
    @Published var isRecording = false

    private var audioPlayer: AVAudioPlayer?
    private var audioRecorder: AVAudioRecorder?
    private var recordingURL: URL?

    private init() {
        setupAudioSession()
    }

    /// Configure audio session for voice interaction
    private func setupAudioSession() {
        let session = AVAudioSession.sharedInstance()

        do {
            try session.setCategory(.playAndRecord, mode: .default, options: [
                .defaultToSpeaker,
                .allowBluetooth,
                .allowBluetoothA2DP
            ])
            try session.setActive(true)
        } catch {
            print("Failed to configure audio session: \(error)")
        }
    }

    // MARK: - Playback

    /// Play audio from Data
    func play(data: Data, completion: (() -> Void)? = nil) {
        do {
            audioPlayer = try AVAudioPlayer(data: data)
            audioPlayer?.delegate = AudioPlayerDelegate(completion: completion)
            audioPlayer?.play()
            isPlaying = true
        } catch {
            print("Failed to play audio: \(error)")
            completion?()
        }
    }

    /// Play audio from URL
    func play(url: URL, completion: (() -> Void)? = nil) {
        do {
            audioPlayer = try AVAudioPlayer(contentsOf: url)
            audioPlayer?.delegate = AudioPlayerDelegate(completion: completion)
            audioPlayer?.play()
            isPlaying = true
        } catch {
            print("Failed to play audio: \(error)")
            completion?()
        }
    }

    /// Stop current playback
    func stopPlaying() {
        audioPlayer?.stop()
        audioPlayer = nil
        isPlaying = false
    }

    // MARK: - Recording

    /// Start recording voice message
    func startRecording() throws -> URL {
        let documentsPath = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let audioFilename = documentsPath.appendingPathComponent("voice_message_\(Date().timeIntervalSince1970).m4a")

        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.high.rawValue
        ]

        audioRecorder = try AVAudioRecorder(url: audioFilename, settings: settings)
        audioRecorder?.record()

        recordingURL = audioFilename
        isRecording = true

        return audioFilename
    }

    /// Stop recording and return the audio data
    func stopRecording() -> Data? {
        audioRecorder?.stop()
        isRecording = false

        guard let url = recordingURL else { return nil }

        defer {
            // Clean up file after reading
            try? FileManager.default.removeItem(at: url)
            recordingURL = nil
        }

        return try? Data(contentsOf: url)
    }

    /// Cancel recording without saving
    func cancelRecording() {
        audioRecorder?.stop()
        isRecording = false

        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
    }
}

// MARK: - Audio Player Delegate

private class AudioPlayerDelegate: NSObject, AVAudioPlayerDelegate {
    let completion: (() -> Void)?

    init(completion: (() -> Void)?) {
        self.completion = completion
    }

    func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        DispatchQueue.main.async {
            AudioManager.shared.isPlaying = false
            self.completion?()
        }
    }
}
