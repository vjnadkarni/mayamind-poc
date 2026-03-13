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
    @StateObject private var deepLinkHandler = DeepLinkHandler()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(appState)
                .environmentObject(deepLinkHandler)
                .onOpenURL { url in
                    Task {
                        await deepLinkHandler.handleURL(url)
                    }
                }
                .sheet(isPresented: $deepLinkHandler.showPasswordReset) {
                    PasswordResetView()
                        .environmentObject(deepLinkHandler)
                }
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

// MARK: - Deep Link Handler

@MainActor
class DeepLinkHandler: ObservableObject {
    @Published var showPasswordReset = false
    @Published var showEmailVerified = false
    @Published var error: String?

    func handleURL(_ url: URL) async {
        print("[DeepLink] Received URL: \(url)")

        // Parse the URL fragment (after #)
        // URL format: mayamind://auth/callback#access_token=xxx&refresh_token=xxx&type=recovery
        guard let fragment = url.fragment else {
            print("[DeepLink] No fragment in URL")
            return
        }

        // Parse fragment as query parameters
        var params: [String: String] = [:]
        for pair in fragment.components(separatedBy: "&") {
            let parts = pair.components(separatedBy: "=")
            if parts.count == 2 {
                params[parts[0]] = parts[1].removingPercentEncoding ?? parts[1]
            }
        }

        print("[DeepLink] Params: \(params.keys.joined(separator: ", "))")

        guard let accessToken = params["access_token"],
              let refreshToken = params["refresh_token"] else {
            print("[DeepLink] Missing tokens")
            error = "Invalid reset link"
            return
        }

        let type = params["type"]

        // Set the session in Supabase
        do {
            try await AuthService.shared.setSession(accessToken: accessToken, refreshToken: refreshToken)
            print("[DeepLink] Session established")

            if type == "recovery" {
                showPasswordReset = true
            } else if type == "signup" {
                showEmailVerified = true
            }
        } catch {
            print("[DeepLink] Failed to set session: \(error)")
            self.error = "Failed to process reset link"
        }
    }
}
