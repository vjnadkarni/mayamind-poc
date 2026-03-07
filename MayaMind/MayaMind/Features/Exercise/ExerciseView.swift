//
//  ExerciseView.swift
//  MayaMind
//
//  Exercise view for iPhone (portrait mode)
//  Uses MediaPipe via WKWebView for pose detection
//

import SwiftUI
import Combine

struct ExerciseView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ExerciseViewModel()

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                VStack(spacing: 0) {
                    // Top bar
                    HStack {
                        Text("Exercise")
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

                    // Camera preview with skeleton overlay
                    ZStack {
                        // Camera + MediaPipe WebView will be embedded here
                        Color.black

                        VStack {
                            Image(systemName: "camera.fill")
                                .font(.system(size: 60))
                                .foregroundColor(.gray.opacity(0.5))
                            Text("Camera + Pose Detection")
                                .foregroundColor(.gray)
                                .padding(.top, 8)
                        }

                        // Rep counter overlay
                        VStack {
                            HStack {
                                Spacer()
                                VStack(spacing: 4) {
                                    Text(viewModel.currentExercise)
                                        .font(.system(size: 14, weight: .medium))
                                        .foregroundColor(.white)
                                    Text("\(viewModel.repCount)")
                                        .font(.system(size: 48, weight: .bold))
                                        .foregroundColor(.orange)
                                    Text("reps")
                                        .font(.system(size: 12))
                                        .foregroundColor(.gray)
                                }
                                .padding(16)
                                .background(Color.black.opacity(0.7))
                                .cornerRadius(12)
                                .padding(16)
                            }
                            Spacer()
                        }
                    }
                    .frame(height: geometry.size.height * 0.50)
                    .cornerRadius(16)
                    .padding(.horizontal)
                    .padding(.top, 16)

                    // Avatar + Instructions
                    HStack(spacing: 12) {
                        // Small avatar
                        ZStack {
                            Color(hex: "1a1a2e")
                            Image(systemName: "person.wave.2.fill")
                                .font(.system(size: 30))
                                .foregroundColor(.orange.opacity(0.5))
                        }
                        .frame(width: 80, height: 80)
                        .cornerRadius(12)

                        // Instructions
                        VStack(alignment: .leading, spacing: 4) {
                            Text(viewModel.instructionText)
                                .font(.system(size: 16))
                                .foregroundColor(.white)
                                .lineLimit(3)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding()
                    .background(Color(hex: "151520"))
                    .cornerRadius(12)
                    .padding(.horizontal)
                    .padding(.top, 12)

                    // Exercise selection buttons
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 12) {
                            ForEach(ExerciseType.allCases, id: \.self) { exercise in
                                ExerciseButton(
                                    exercise: exercise,
                                    isSelected: viewModel.selectedExercise == exercise,
                                    action: { viewModel.selectExercise(exercise) }
                                )
                            }
                        }
                        .padding(.horizontal)
                    }
                    .padding(.vertical, 16)

                    Spacer()

                    // Control buttons
                    HStack(spacing: 20) {
                        Button(action: { viewModel.startExercise() }) {
                            Text(viewModel.isActive ? "Stop" : "Start")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 16)
                                .background(viewModel.isActive ? Color.red : Color.orange)
                                .cornerRadius(12)
                        }
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 16)
                }
            }
        }
    }
}

struct ExerciseButton: View {
    let exercise: ExerciseType
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: exercise.icon)
                    .font(.system(size: 24))
                Text(exercise.rawValue)
                    .font(.system(size: 12))
            }
            .foregroundColor(isSelected ? .orange : .gray)
            .padding(12)
            .background(isSelected ? Color.orange.opacity(0.2) : Color(hex: "1a1a2e"))
            .cornerRadius(12)
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

class ExerciseViewModel: ObservableObject {
    @Published var selectedExercise: ExerciseType?
    @Published var currentExercise = "Select Exercise"
    @Published var repCount = 0
    @Published var isActive = false
    @Published var instructionText = "Tap an exercise below to get started, or tell Maya which exercise you'd like to do."

    func selectExercise(_ exercise: ExerciseType) {
        selectedExercise = exercise
        currentExercise = exercise.rawValue
        instructionText = "Ready to start \(exercise.rawValue). Tap Start when you're ready!"
    }

    func startExercise() {
        if isActive {
            isActive = false
            instructionText = "Great workout! You completed \(repCount) reps."
        } else {
            isActive = true
            repCount = 0
            instructionText = "Go ahead, I'll count your reps!"
        }
    }
}

#Preview {
    ExerciseView()
        .environmentObject(AppState())
}
