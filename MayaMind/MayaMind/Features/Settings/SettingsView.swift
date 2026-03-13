//
//  SettingsView.swift
//  MayaMind
//
//  App settings and preferences
//

import SwiftUI
import Combine

struct SettingsView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = SettingsViewModel()

    var body: some View {
        ZStack {
            Color(hex: "0a0a10")
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar
                HStack {
                    Text("Settings")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.top, 8)

                ScrollView {
                    VStack(spacing: 24) {
                        // Profile section
                        SettingsSection(title: "Profile") {
                            SettingsTextField(
                                label: "Name",
                                text: $viewModel.userName,
                                placeholder: "Your name"
                            )

                            SettingsTextField(
                                label: "Street Address",
                                text: $viewModel.streetAddress,
                                placeholder: "123 Main Street"
                            )

                            HStack(spacing: 12) {
                                SettingsTextField(
                                    label: "City",
                                    text: $viewModel.city,
                                    placeholder: "City"
                                )

                                VStack(alignment: .leading, spacing: 4) {
                                    Text("State")
                                        .font(.system(size: 14))
                                        .foregroundColor(.gray)
                                    Picker("State", selection: $viewModel.state) {
                                        ForEach(USState.allCases, id: \.self) { state in
                                            Text(state.rawValue).tag(state)
                                        }
                                    }
                                    .pickerStyle(.menu)
                                    .tint(.white)
                                }
                                .frame(width: 100)

                                SettingsTextField(
                                    label: "Zip",
                                    text: $viewModel.zipCode,
                                    placeholder: "00000"
                                )
                                .frame(width: 80)
                            }
                        }

                        // Health connections
                        SettingsSection(title: "Health Connections") {
                            SettingsRow(
                                icon: "applewatch",
                                title: "Apple Watch",
                                subtitle: viewModel.watchConnected ? "Connected" : "Not connected",
                                isConnected: viewModel.watchConnected
                            )

                            SettingsRow(
                                icon: "scalemass.fill",
                                title: "Smart Scale (HealthKit)",
                                subtitle: viewModel.scaleConnected ? "Connected" : "Not connected",
                                isConnected: viewModel.scaleConnected
                            )

                            Button(action: { viewModel.connectWithings() }) {
                                SettingsRow(
                                    icon: "plus.circle",
                                    title: "Connect Withings Scale",
                                    subtitle: "For additional body metrics",
                                    isConnected: false,
                                    showChevron: true
                                )
                            }
                        }

                        // Privacy
                        SettingsSection(title: "Privacy & Learning") {
                            SettingsToggle(
                                icon: "brain",
                                title: "Allow Maya to Learn",
                                subtitle: "Remember your preferences and interests",
                                isOn: $viewModel.allowLearning
                            )

                            Button(action: { viewModel.showWhatMayaKnows() }) {
                                SettingsRow(
                                    icon: "eye",
                                    title: "What Maya Knows",
                                    subtitle: "View stored preferences",
                                    isConnected: false,
                                    showChevron: true
                                )
                            }

                            Button(action: { viewModel.forgetEverything() }) {
                                SettingsRow(
                                    icon: "trash",
                                    title: "Forget Everything",
                                    subtitle: "Clear all stored data",
                                    isConnected: false,
                                    showChevron: false,
                                    isDestructive: true
                                )
                            }
                        }

                        // To Dos Notifications
                        SettingsSection(title: "To Dos Notifications") {
                            SettingsToggle(
                                icon: "bell.badge",
                                title: "Audible Jingle",
                                subtitle: "Plays a chime and displays notification banner",
                                isOn: $viewModel.notificationJingleEnabled
                            )

                            SettingsToggle(
                                icon: "bell",
                                title: "Silent Banner",
                                subtitle: "Display notification without sound",
                                isOn: $viewModel.notificationBannerEnabled
                            )
                            .disabled(viewModel.notificationJingleEnabled)
                            .opacity(viewModel.notificationJingleEnabled ? 0.5 : 1.0)
                        }

                        // Cloud sync
                        SettingsSection(title: "Cloud Sync") {
                            SettingsToggle(
                                icon: "icloud",
                                title: "iCloud Sync",
                                subtitle: "Sync preferences across devices",
                                isOn: $viewModel.iCloudSyncEnabled
                            )

                            SettingsToggle(
                                icon: "person.2",
                                title: "Share with Family",
                                subtitle: "Allow family to see activity summaries",
                                isOn: $viewModel.familySharingEnabled
                            )
                        }

                        // About
                        SettingsSection(title: "About") {
                            SettingsRow(
                                icon: "info.circle",
                                title: "Version",
                                subtitle: "1.0.0",
                                isConnected: false
                            )
                        }

                        // Account
                        SettingsSection(title: "Account") {
                            Button(action: { viewModel.logout() }) {
                                SettingsRow(
                                    icon: "rectangle.portrait.and.arrow.right",
                                    title: "Sign Out",
                                    subtitle: viewModel.userEmail,
                                    isConnected: false,
                                    showChevron: false,
                                    isDestructive: true
                                )
                            }
                        }
                    }
                    .padding()
                }
            }
        }
    }
}

struct SettingsSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.gray)
                .padding(.leading, 4)

            VStack(spacing: 1) {
                content
            }
            .background(Color(hex: "1a1a2e"))
            .cornerRadius(12)
        }
    }
}

struct SettingsRow: View {
    let icon: String
    let title: String
    let subtitle: String
    let isConnected: Bool
    var showChevron: Bool = false
    var isDestructive: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(isDestructive ? .red : .orange)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16))
                    .foregroundColor(isDestructive ? .red : .white)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }

            Spacer()

            if isConnected {
                Circle()
                    .fill(Color.green)
                    .frame(width: 8, height: 8)
            }

            if showChevron {
                Image(systemName: "chevron.right")
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
            }
        }
        .padding()
        .background(Color(hex: "1a1a2e"))
    }
}

struct SettingsToggle: View {
    let icon: String
    let title: String
    let subtitle: String
    @Binding var isOn: Bool

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 20))
                .foregroundColor(.orange)
                .frame(width: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 16))
                    .foregroundColor(.white)
                Text(subtitle)
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }

            Spacer()

            Toggle("", isOn: $isOn)
                .tint(.orange)
        }
        .padding()
        .background(Color(hex: "1a1a2e"))
    }
}

struct SettingsTextField: View {
    let label: String
    @Binding var text: String
    let placeholder: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .font(.system(size: 14))
                .foregroundColor(.gray)
            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .foregroundColor(.white)
                .padding(12)
                .background(Color(hex: "0f0f1a"))
                .cornerRadius(8)
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(Color(hex: "1a1a2e"))
    }
}

enum USState: String, CaseIterable {
    case AL, AK, AZ, AR, CA, CO, CT, DE, DC, FL
    case GA, HI, ID, IL, IN, IA, KS, KY, LA, ME
    case MD, MA, MI, MN, MS, MO, MT, NE, NV, NH
    case NJ, NM, NY, NC, ND, OH, OK, OR, PA, RI
    case SC, SD, TN, TX, UT, VT, VA, WA, WV, WI, WY
}

class SettingsViewModel: ObservableObject {
    // Profile
    @Published var userName = ""
    @Published var streetAddress = ""
    @Published var city = ""
    @Published var state: USState = .CA
    @Published var zipCode = ""

    // Connections
    @Published var watchConnected = true
    @Published var scaleConnected = false

    // Privacy
    @Published var allowLearning = true

    // Sync
    @Published var iCloudSyncEnabled = true
    @Published var familySharingEnabled = false

    // To Dos Notifications
    @Published var notificationJingleEnabled: Bool {
        didSet {
            NotificationSettings.shared.jingleEnabled = notificationJingleEnabled
            // If jingle is enabled, it includes banner, so disable separate banner toggle
            if notificationJingleEnabled {
                notificationBannerEnabled = false
            }
        }
    }
    @Published var notificationBannerEnabled: Bool {
        didSet {
            NotificationSettings.shared.bannerEnabled = notificationBannerEnabled
        }
    }

    // User email for display
    var userEmail: String {
        AuthService.shared.userProfile?.email ?? "Not signed in"
    }

    init() {
        // Load notification settings from UserDefaults
        self.notificationJingleEnabled = NotificationSettings.shared.jingleEnabled
        self.notificationBannerEnabled = NotificationSettings.shared.bannerEnabled
    }

    func logout() {
        Task {
            await AuthService.shared.logout()
        }
    }

    func connectWithings() {
        // TODO: Implement Withings OAuth flow
    }

    func showWhatMayaKnows() {
        // TODO: Show transparency modal
    }

    func forgetEverything() {
        // TODO: Clear all stored data
    }
}

// MARK: - Notification Settings

class NotificationSettings {
    static let shared = NotificationSettings()

    private let jingleKey = "todo_notification_jingle"
    private let bannerKey = "todo_notification_banner"

    var jingleEnabled: Bool {
        get { UserDefaults.standard.object(forKey: jingleKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: jingleKey) }
    }

    var bannerEnabled: Bool {
        get { UserDefaults.standard.object(forKey: bannerKey) as? Bool ?? true }
        set { UserDefaults.standard.set(newValue, forKey: bannerKey) }
    }

    /// Returns true if any notification type is enabled
    var notificationsEnabled: Bool {
        jingleEnabled || bannerEnabled
    }

    /// Returns true if sound should be included
    var soundEnabled: Bool {
        jingleEnabled
    }

    private init() {}
}

#Preview {
    SettingsView()
        .environmentObject(AppState())
}
