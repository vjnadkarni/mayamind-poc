//
//  MayaMindApp.swift
//  MayaMind
//
//  AI-powered wellness companion for seniors
//

import SwiftUI
import Combine
import UserNotifications

@main
struct MayaMindApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate
    @StateObject private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
        }
    }
}

// MARK: - App Delegate for Notification Handling

class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Set notification delegate to handle foreground notifications
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    // MARK: - UNUserNotificationCenterDelegate

    /// Handle notifications when app is in the foreground
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        // Show banner and play sound even when app is in foreground
        completionHandler([.banner, .sound])
    }

    /// Handle notification tap
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        // Could navigate to To Dos section here if needed
        print("[Notifications] User tapped notification: \(response.notification.request.identifier)")
        completionHandler()
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
    var speechService: SpeechRecognitionService { SpeechRecognitionService.shared }
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
