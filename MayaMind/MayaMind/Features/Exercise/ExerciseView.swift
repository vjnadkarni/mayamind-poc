//
//  ExerciseView.swift
//  MayaMind
//
//  Exercise view with camera-based pose detection and rep counting.
//  Uses MediaPipe Pose Landmarker for real-time pose estimation.
//  Includes Maya avatar with lip-sync for voice coaching.
//

import SwiftUI
import AVFoundation
import Combine

struct ExerciseView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ExerciseViewModel()
    @State private var showSettings = false

    // Avatar state
    @State private var avatarMood: String = "neutral"
    @State private var avatarIsSpeaking: Bool = false
    @State private var avatarReady: Bool = false
    @State private var audioToSpeak: AvatarAudioData?

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Top bar with exercise info and rep counter
                    HStack(spacing: 12) {
                        // Exercise name (larger when selected)
                        Text(viewModel.selectedExercise != nil ? viewModel.currentExercise : "Exercise")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)

                        Spacer()

                        // Rep counter
                        HStack(spacing: 6) {
                            Text("\(viewModel.repCount)")
                                .font(.system(size: 28, weight: .bold))
                                .foregroundColor(.orange)
                            Text("reps")
                                .font(.system(size: 14))
                                .foregroundColor(.gray)
                        }
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .background(Color(hex: "1a1a2e"))
                        .cornerRadius(8)

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

                    // Camera preview with skeleton overlay (clean, no overlays)
                    ZStack {
                        if viewModel.cameraPermissionGranted {
                            // Camera preview
                            CameraPreviewView(
                                previewLayer: viewModel.previewLayer,
                                landmarks: viewModel.currentLandmarks,
                                isMirrored: viewModel.isFrontCamera
                            )
                            .background(Color.black)

                            // Skeleton overlay (SwiftUI version as backup)
                            if viewModel.currentLandmarks != nil {
                                SkeletonOverlayView(
                                    landmarks: viewModel.currentLandmarks,
                                    frameSize: CGSize(
                                        width: geometry.size.width - 32,
                                        height: geometry.size.height * 0.48
                                    )
                                )
                            }

                            // State indicator at bottom (small, unobtrusive)
                            if viewModel.isActive {
                                VStack {
                                    Spacer()
                                    Text(viewModel.detectorState.capitalized)
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundColor(.white)
                                        .padding(.horizontal, 12)
                                        .padding(.vertical, 6)
                                        .background(stateColor(viewModel.detectorState))
                                        .cornerRadius(16)
                                        .padding(.bottom, 8)
                                }
                            }
                        } else {
                            // Permission required
                            VStack {
                                Image(systemName: "camera.fill")
                                    .font(.system(size: 60))
                                    .foregroundColor(.gray.opacity(0.5))
                                Text("Camera access required")
                                    .foregroundColor(.gray)
                                    .padding(.top, 8)
                                Button("Grant Permission") {
                                    viewModel.requestCameraPermission()
                                }
                                .foregroundColor(.orange)
                                .padding(.top, 8)
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .background(Color.black)
                        }
                    }
                    .frame(height: geometry.size.height * 0.48)
                    .cornerRadius(16)
                    .padding(.horizontal)
                    .padding(.top, 10)

                    // Avatar + Scrollable chat window (expanded height)
                    HStack(alignment: .top, spacing: 10) {
                        // Maya avatar thumbnail (larger)
                        ZStack {
                            // Home background
                            Image(systemName: "house.fill")
                                .font(.system(size: 32))
                                .foregroundColor(.gray.opacity(0.3))

                            AvatarWebView(
                                mood: $avatarMood,
                                isSpeaking: $avatarIsSpeaking,
                                onReady: {
                                    avatarReady = true
                                    print("[ExerciseView] Avatar ready")
                                },
                                onSpeakingEnd: {
                                    viewModel.onSpeakingEnd()
                                },
                                audioToSpeak: audioToSpeak
                            )
                        }
                        .frame(width: 100, height: 100)
                        .background(Color(hex: "1a1a2e"))
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.orange.opacity(0.3), lineWidth: 1)
                        )

                        // Scrollable instructions/chat window
                        ScrollView(.vertical, showsIndicators: true) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(viewModel.instructionText)
                                    .font(.system(size: 15))
                                    .foregroundColor(.white)

                                // Show user's speech when listening
                                if !viewModel.userTranscript.isEmpty {
                                    HStack(spacing: 6) {
                                        Image(systemName: "mic.fill")
                                            .foregroundColor(.green)
                                            .font(.system(size: 11))
                                        Text(viewModel.userTranscript)
                                            .font(.system(size: 13))
                                            .foregroundColor(.green)
                                    }
                                    .padding(.top, 4)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .frame(maxHeight: 100)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 10)
                    .background(Color(hex: "151520"))
                    .cornerRadius(10)
                    .padding(.horizontal)
                    .padding(.top, 8)

                    Spacer()

                    // Bottom control area with consistent 8pt gaps
                    VStack(spacing: 8) {
                        // Row 1: Start/Stop + Camera + Mic (full width)
                        HStack(spacing: 8) {
                            // Start/Stop button (fills remaining width)
                            Button(action: { viewModel.toggleExercise() }) {
                                Text(viewModel.isActive ? "Stop" : "Start")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.white)
                                    .frame(maxWidth: .infinity)
                                    .frame(height: 44)
                                    .background(viewModel.isActive ? Color.red : Color.orange)
                                    .cornerRadius(10)
                            }
                            .disabled(viewModel.selectedExercise == nil)
                            .opacity(viewModel.selectedExercise == nil ? 0.5 : 1)

                            // Camera switch button
                            Button(action: { viewModel.switchCamera() }) {
                                Image(systemName: "camera.rotate")
                                    .font(.system(size: 20))
                                    .foregroundColor(.white)
                                    .frame(width: 48, height: 44)
                                    .background(Color.white.opacity(0.15))
                                    .cornerRadius(10)
                            }

                            // Mute button
                            Button(action: { appState.isMuted.toggle() }) {
                                Image(systemName: appState.isMuted ? "mic.slash.fill" : "mic.fill")
                                    .font(.system(size: 20))
                                    .foregroundColor(appState.isMuted ? .red : .green)
                                    .frame(width: 48, height: 44)
                                    .background(Color.white.opacity(0.15))
                                    .cornerRadius(10)
                            }
                        }

                        // Row 2: Change Exercise dropdown (full width, same height as Start)
                        Menu {
                            ForEach(ExerciseType.allCases, id: \.self) { exercise in
                                Button(action: { viewModel.selectExercise(exercise) }) {
                                    Label(exercise.rawValue, systemImage: exercise.icon)
                                }
                            }
                        } label: {
                            HStack {
                                Image(systemName: "list.bullet")
                                    .font(.system(size: 14))
                                Spacer()
                                Text(viewModel.selectedExercise == nil ? "Choose Exercise" : "Change Exercise")
                                    .font(.system(size: 14, weight: .medium))
                                Spacer()
                                Image(systemName: "chevron.down")
                                    .font(.system(size: 12))
                            }
                            .foregroundColor(.white)
                            .frame(maxWidth: .infinity)
                            .frame(height: 44)
                            .background(Color(hex: "1a1a2e"))
                            .cornerRadius(10)
                        }

                        // Row 3: Quick selector (recent exercises)
                        if !viewModel.recentExercises.isEmpty {
                            ScrollView(.horizontal, showsIndicators: false) {
                                HStack(spacing: 10) {
                                    ForEach(viewModel.recentExercises, id: \.self) { exercise in
                                        ExerciseButton(
                                            exercise: exercise,
                                            isSelected: viewModel.selectedExercise == exercise,
                                            action: { viewModel.selectExercise(exercise) }
                                        )
                                    }
                                }
                            }
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 8)

                    // Spacer to ensure buttons are above tab bar
                    Spacer()
                        .frame(height: 56)
                }
            }
        }
        .onAppear {
            viewModel.onAppear()
        }
        .onDisappear {
            viewModel.onDisappear()
        }
        .onReceive(viewModel.$pendingAudio) { audio in
            if let audio = audio {
                audioToSpeak = audio
            }
        }
        .onReceive(viewModel.$currentMood) { mood in
            avatarMood = mood
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(appState)
        }
    }

    private func stateColor(_ state: String) -> Color {
        switch state {
        case "standing": return Color.green.opacity(0.8)
        case "descending": return Color.yellow.opacity(0.8)
        case "bottom": return Color.orange.opacity(0.8)
        case "ascending": return Color.blue.opacity(0.8)
        default: return Color.gray.opacity(0.8)
        }
    }
}

struct ExerciseButton: View {
    let exercise: ExerciseType
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 3) {
                Image(systemName: exercise.icon)
                    .font(.system(size: 20))
                Text(exercise.rawValue)
                    .font(.system(size: 11))
            }
            .foregroundColor(isSelected ? .orange : .gray)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(isSelected ? Color.orange.opacity(0.2) : Color(hex: "1a1a2e"))
            .cornerRadius(10)
        }
    }
}

enum ExerciseType: String, CaseIterable {
    case squats = "Squats"
    case lunges = "Lunges"
    case bicepCurls = "Bicep Curls"
    case pushups = "Push-ups"

    var icon: String {
        switch self {
        case .squats: return "figure.stand"
        case .lunges: return "figure.walk"
        case .bicepCurls: return "figure.strengthtraining.traditional"
        case .pushups: return "figure.core.training"
        }
    }
}

// MARK: - ViewModel

class ExerciseViewModel: ObservableObject {
    @Published var selectedExercise: ExerciseType?
    @Published var currentExercise = "Select Exercise"
    @Published var repCount = 0
    @Published var isActive = false
    @Published var instructionText = "Tap an exercise below to get started."
    @Published var cameraPermissionGranted = false
    @Published var currentLandmarks: [Point3D]?
    @Published var detectorState = "idle"
    @Published var lastRepScore: Int?

    // Recent exercises (persisted in UserDefaults, max 5)
    @Published var recentExercises: [ExerciseType] = []
    private let recentExercisesKey = "mayamind_recent_exercises"

    // Voice coaching
    @Published var pendingAudio: AvatarAudioData?
    @Published var currentMood: String = "neutral"
    @Published var isSpeaking = false
    @Published var userTranscript = ""  // Shows what user is saying

    private let cameraService = CameraService()
    private let poseService = PoseEstimationService()
    private let ttsService = TTSService()
    private let speechService = SpeechRecognitionService()
    private var currentDetector: ExerciseDetectorProtocol?
    private var speechQueue: [String] = []
    private var lastAnnouncedRep = 0
    private var isListeningForResponse = false

    // Idle timeout
    private var idleTimer: Timer?
    private var lastRepTime: Date?
    private var hasAskedIfDone = false
    private let idleTimeoutSeconds: TimeInterval = 10.0

    var previewLayer: AVCaptureVideoPreviewLayer? {
        cameraService.previewLayer
    }

    var isFrontCamera: Bool {
        cameraService.cameraPosition == .front
    }

    init() {
        loadRecentExercises()
        setupServices()
    }

    private func loadRecentExercises() {
        if let savedExercises = UserDefaults.standard.stringArray(forKey: recentExercisesKey) {
            recentExercises = savedExercises.compactMap { ExerciseType(rawValue: $0) }
        }
    }

    private func addToRecentExercises(_ exercise: ExerciseType) {
        // Remove if already exists (to move to front)
        recentExercises.removeAll { $0 == exercise }
        // Add to front
        recentExercises.insert(exercise, at: 0)
        // Keep only 5 most recent
        if recentExercises.count > 5 {
            recentExercises = Array(recentExercises.prefix(5))
        }
        // Persist
        let exerciseNames = recentExercises.map { $0.rawValue }
        UserDefaults.standard.set(exerciseNames, forKey: recentExercisesKey)
    }

    private func setupServices() {
        cameraService.delegate = self
        poseService.delegate = self
        setupSpeechRecognition()
    }

    private func setupSpeechRecognition() {
        // Handle interim results (show what user is saying)
        speechService.onInterimResult = { [weak self] transcript in
            self?.userTranscript = transcript
        }

        // Handle final transcript
        speechService.onTranscript = { [weak self] transcript in
            guard let self = self else { return }
            print("[Exercise] User said: \(transcript)")
            self.userTranscript = ""
            self.handleVoiceCommand(transcript)
        }

        // Handle errors - auto-retry if we're waiting for a response
        speechService.onError = { [weak self] error in
            guard let self = self else { return }
            print("[Exercise] Speech error: \(error.localizedDescription)")

            // Auto-retry if we're still waiting for user response
            if self.isListeningForResponse && !self.isSpeaking {
                print("[Exercise] Auto-retrying speech recognition...")
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
                    guard let self = self, self.isListeningForResponse else { return }
                    self.startListeningForResponse()
                }
            }
        }
    }

    private func handleVoiceCommand(_ transcript: String) {
        let text = transcript.lowercased().trimmingCharacters(in: .whitespacesAndNewlines)

        // Check for "done" responses
        let doneKeywords = ["done", "yes", "finished", "stop", "i'm done", "im done", "that's it", "thats it"]
        let continueKeywords = ["no", "not yet", "continue", "keep going", "just resting", "resting"]

        if doneKeywords.contains(where: { text.contains($0) }) {
            print("[Exercise] User indicated done")
            isListeningForResponse = false
            stopExercise()
        } else if continueKeywords.contains(where: { text.contains($0) }) {
            print("[Exercise] User wants to continue")
            isListeningForResponse = false
            hasAskedIfDone = false
            startIdleTimer()

            let response = "Okay, take your time. I'll keep counting when you're ready."
            instructionText = response
            speak(response)
        } else {
            // Didn't understand - ask again or just continue listening
            print("[Exercise] Didn't understand: \(text)")
            if isListeningForResponse {
                startListeningForResponse()
            }
        }
    }

    private func startListeningForResponse() {
        guard !isSpeaking else {
            // Wait until Maya finishes speaking
            return
        }

        isListeningForResponse = true

        // Start immediately - audio session is already configured by reactivateAudioSession
        do {
            try speechService.startListening(skipAudioSessionConfig: true)
            print("[Exercise] Started listening for user response")
        } catch {
            print("[Exercise] Failed to start listening: \(error)")
            // Retry after a short delay if it fails
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
                guard let self = self, self.isListeningForResponse else { return }
                do {
                    try self.speechService.startListening()
                    print("[Exercise] Retry: Started listening for user response")
                } catch {
                    print("[Exercise] Retry failed: \(error)")
                }
            }
        }
    }

    private func stopListeningForResponse() {
        isListeningForResponse = false
        speechService.stopListening()
    }

    func onAppear() {
        requestCameraPermission()
    }

    func onDisappear() {
        stopExercise()
        stopIdleTimer()
        stopListeningForResponse()
        cameraService.stop()
    }

    func requestCameraPermission() {
        cameraService.requestPermission { [weak self] granted in
            self?.cameraPermissionGranted = granted
            if granted {
                self?.setupCamera()
            }
        }
    }

    private func setupCamera() {
        do {
            try cameraService.setup()
            cameraService.start()
        } catch {
            print("[Exercise] Camera setup failed: \(error)")
        }
    }

    func switchCamera() {
        do {
            try cameraService.switchCamera()
        } catch {
            print("[Exercise] Camera switch failed: \(error)")
        }
    }

    func selectExercise(_ exercise: ExerciseType) {
        selectedExercise = exercise
        currentExercise = exercise.rawValue

        // Add to recent exercises list (persisted)
        addToRecentExercises(exercise)

        let readyMessage = "Ready to start \(exercise.rawValue). Tap Start when you're ready!"
        instructionText = readyMessage

        // Create appropriate detector
        switch exercise {
        case .squats:
            currentDetector = SquatDetector()
        case .lunges:
            currentDetector = LungeDetector()
        case .bicepCurls:
            currentDetector = BicepsCurlDetector()
        case .pushups:
            currentDetector = PushupDetector()
        }

        setupDetectorCallbacks()

        // Announce selection
        currentMood = "neutral"
        speak(readyMessage)
    }

    private func setupDetectorCallbacks() {
        guard let detector = currentDetector else {
            print("[Exercise] ERROR: No detector to set up callbacks for")
            return
        }

        print("[Exercise] Setting up callbacks for \(currentExercise)")

        detector.onRepComplete = { [weak self] repData in
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.repCount = repData.repNumber
                self.lastRepScore = repData.depthScore
                print("[Exercise] \(self.currentExercise) - Rep \(repData.repNumber) completed, score: \(repData.depthScore)")

                // Announce rep count with voice
                self.announceRep(repData)
            }
        }

        detector.onStateChange = { [weak self] newState, _ in
            DispatchQueue.main.async {
                self?.detectorState = newState
            }
        }
    }

    /// Announce rep completion with voice
    private func announceRep(_ repData: RepData) {
        // Avoid announcing the same rep multiple times
        guard repData.repNumber > lastAnnouncedRep else { return }
        lastAnnouncedRep = repData.repNumber

        // Reset idle timer (but not if we're waiting for user response to "Are you done?")
        lastRepTime = Date()
        if !isListeningForResponse && !hasAskedIfDone {
            startIdleTimer()
        }

        // Build announcement based on rep count and score
        var announcement: String
        let isMilestone = repData.repNumber % 5 == 0

        if isMilestone {
            // Milestone reps get encouragement with form feedback
            if repData.depthScore >= 80 {
                announcement = "\(repData.repNumber)! Great form, keep it up!"
                currentMood = "happy"
            } else if repData.depthScore < 50 {
                announcement = "\(repData.repNumber). Try to go a bit deeper on the next set."
                currentMood = "neutral"
            } else {
                announcement = "\(repData.repNumber)! Nice work!"
                currentMood = "happy"
            }
        } else {
            // Standard count only (no form feedback between milestones)
            announcement = "\(repData.repNumber)"
            currentMood = "neutral"
        }

        speak(announcement)
    }

    // MARK: - Idle Timeout

    private func startIdleTimer() {
        idleTimer?.invalidate()
        idleTimer = Timer.scheduledTimer(withTimeInterval: idleTimeoutSeconds, repeats: false) { [weak self] _ in
            self?.handleIdleTimeout()
        }
    }

    private func handleIdleTimeout() {
        // Don't interrupt if Maya is currently speaking
        guard isActive, !hasAskedIfDone, repCount > 0, !isSpeaking else { return }
        hasAskedIfDone = true
        isListeningForResponse = true  // Will start listening after speaking ends

        let question = "Are you done, or just taking a rest?"
        instructionText = question
        currentMood = "neutral"
        speak(question)
    }

    private func stopIdleTimer() {
        idleTimer?.invalidate()
        idleTimer = nil
    }

    func toggleExercise() {
        if isActive {
            stopExercise()
        } else {
            startExercise()
        }
    }

    func startExercise() {
        guard let exercise = selectedExercise else { return }

        isActive = true
        repCount = 0
        lastRepScore = nil
        lastAnnouncedRep = 0
        detectorState = "idle"
        hasAskedIfDone = false
        lastRepTime = nil
        currentDetector?.reset()
        poseService.start()

        // Voice greeting
        let greeting = "Go ahead, I'll count your \(exercise.rawValue.lowercased())!"
        instructionText = greeting
        currentMood = "happy"
        speak(greeting)
    }

    func stopExercise() {
        isActive = false
        poseService.stop()
        currentLandmarks = nil
        stopIdleTimer()
        stopListeningForResponse()

        if repCount > 0 {
            let summary = "Great workout! You completed \(repCount) reps."
            instructionText = summary
            currentMood = "happy"
            speak(summary)
        } else {
            instructionText = "Tap Start when you're ready to exercise."
        }
    }

    // MARK: - Voice Coaching

    /// Speak text using TTS with avatar lip-sync
    private func speak(_ text: String) {
        guard !isSpeaking else {
            // Queue the speech if already speaking
            speechQueue.append(text)
            return
        }

        isSpeaking = true
        print("[Exercise] Speaking: \(text)")

        // Stop listening while speaking (audio session conflict)
        speechService.stopListening()

        Task {
            do {
                let response = try await ttsService.fetchTTSResponse(for: text)
                await MainActor.run {
                    // Deactivate AVAudioSession so WKWebView can play audio
                    self.deactivateAudioSession()

                    // Create audio data for avatar lip-sync
                    pendingAudio = AvatarAudioData(
                        audioData: response.audioData,
                        words: response.words,
                        wordTimes: response.wordTimes,
                        wordDurations: response.wordDurations
                    )
                }
            } catch {
                print("[Exercise] TTS error: \(error)")
                await MainActor.run {
                    isSpeaking = false
                    processNextSpeech()
                }
            }
        }
    }

    /// Deactivate AVAudioSession so WKWebView can use AudioContext
    private func deactivateAudioSession() {
        do {
            try AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
            print("[Exercise] Deactivated AVAudioSession for WKWebView audio")
        } catch {
            print("[Exercise] Failed to deactivate audio session: \(error)")
        }
    }

    /// Reactivate AVAudioSession for speech recognition
    private func reactivateAudioSession() {
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.playAndRecord, mode: .measurement, options: [.duckOthers, .allowBluetooth])
            try session.setActive(true, options: .notifyOthersOnDeactivation)
            print("[Exercise] Reactivated AVAudioSession")
        } catch {
            print("[Exercise] Failed to reactivate audio session: \(error)")
        }
    }

    /// Called when avatar finishes speaking
    func onSpeakingEnd() {
        isSpeaking = false

        // Reactivate AVAudioSession so speech recognition can work
        reactivateAudioSession()

        processNextSpeech()

        // If we asked a question and speech queue is empty, start listening
        if isListeningForResponse && speechQueue.isEmpty && !isSpeaking {
            startListeningForResponse()
        }
    }

    /// Process next item in speech queue
    private func processNextSpeech() {
        guard !speechQueue.isEmpty else { return }
        let next = speechQueue.removeFirst()
        speak(next)
    }
}

// MARK: - CameraServiceDelegate

extension ExerciseViewModel: CameraServiceDelegate {
    func cameraService(_ service: CameraService, didOutput sampleBuffer: CMSampleBuffer, timestamp: Int) {
        guard isActive else { return }
        poseService.processFrame(sampleBuffer, timestamp: timestamp)
    }

    func cameraService(_ service: CameraService, didFailWithError error: Error) {
        print("[Exercise] Camera error: \(error)")
    }
}

// MARK: - PoseEstimationDelegate

extension ExerciseViewModel: PoseEstimationDelegate {
    func poseEstimationService(_ service: PoseEstimationService, didUpdatePose result: PoseEstimationResult) {
        // Update landmarks for skeleton drawing
        currentLandmarks = result.landmarks

        // Update exercise detector
        if let detector = currentDetector, let angles = result.angles {
            _ = detector.update(
                angles: angles,
                landmarks2D: result.landmarks,
                timestamp: Date()
            )
        }
    }

    func poseEstimationService(_ service: PoseEstimationService, didFailWithError error: Error) {
        print("[Exercise] Pose estimation error: \(error)")
    }
}

#Preview {
    ExerciseView()
        .environmentObject(AppState())
}
