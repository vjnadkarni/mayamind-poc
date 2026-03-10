//
//  MayaMindApp.swift
//  MayaMind
//
//  AI-powered wellness companion for seniors
//

import SwiftUI
import Combine

@main
struct MayaMindApp: App {
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
        }
    }
}

/// Global application state shared across all views
class AppState: ObservableObject {
    @Published var isAuthenticated = false
    @Published var userName: String?
    @Published var isMuted = false
    @Published var activeSection: AppSection = .maya

    // Services (initialized lazily)
    lazy var healthKitService = HealthKitService()
    lazy var speechService = SpeechRecognitionService()
    lazy var claudeService = ClaudeAPIService()
    lazy var cloudKitManager = CloudKitManager()
}

enum AppSection: String, CaseIterable {
    case maya = "Maya"
    case exercise = "Exercise"
    case health = "Health"
    case connect = "Connect"
    case todos = "To Dos"

    var icon: String {
        switch self {
        case .maya: return "person.wave.2"
        case .exercise: return "figure.run"
        case .health: return "heart.fill"
        case .connect: return "message.fill"
        case .todos: return "checklist"
        }
    }
}
