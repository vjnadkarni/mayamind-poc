//
//  iPhoneTabView.swift
//  MayaMind
//
//  iPhone-specific tab-based navigation (portrait mode)
//

import SwiftUI

struct iPhoneTabView: View {
    @EnvironmentObject var appState: AppState
    @State private var selectedTab: AppSection = .maya
    @State private var showLanding = true

    var body: some View {
        ZStack {
            if showLanding {
                iPhoneLandingView(onEnter: {
                    withAnimation(.easeOut(duration: 0.5)) {
                        showLanding = false
                    }
                })
            } else {
                TabView(selection: $selectedTab) {
                    MayaView()
                        .tabItem {
                            Label(AppSection.maya.rawValue, systemImage: AppSection.maya.icon)
                        }
                        .tag(AppSection.maya)

                    ExerciseView()
                        .tabItem {
                            Label(AppSection.exercise.rawValue, systemImage: AppSection.exercise.icon)
                        }
                        .tag(AppSection.exercise)

                    HealthView()
                        .tabItem {
                            Label(AppSection.health.rawValue, systemImage: AppSection.health.icon)
                        }
                        .tag(AppSection.health)

                    ConnectView()
                        .tabItem {
                            Label(AppSection.connect.rawValue, systemImage: AppSection.connect.icon)
                        }
                        .tag(AppSection.connect)

                    SettingsView()
                        .tabItem {
                            Label(AppSection.settings.rawValue, systemImage: AppSection.settings.icon)
                        }
                        .tag(AppSection.settings)
                }
                .tint(Color.orange)
            }
        }
    }
}

/// iPhone landing/splash view
struct iPhoneLandingView: View {
    let onEnter: () -> Void

    var body: some View {
        ZStack {
            // Background gradient
            LinearGradient(
                colors: [Color(hex: "1a1a2e"), Color(hex: "0a0a10")],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()

            VStack(spacing: 40) {
                Spacer()

                // App title
                Text("MayaMind")
                    .font(.system(size: 48, weight: .bold))
                    .foregroundColor(.orange)

                // Tagline
                Text("Your companion and\ncoach at home...")
                    .font(.system(size: 24, weight: .medium))
                    .foregroundColor(.white)
                    .multilineTextAlignment(.center)

                Spacer()

                // Enter button
                Button(action: onEnter) {
                    Text("Get Started")
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 48)
                        .padding(.vertical, 16)
                        .background(Color.orange)
                        .cornerRadius(30)
                }
                .padding(.bottom, 60)
            }
        }
        .onTapGesture {
            onEnter()
        }
    }
}

// MARK: - Color Extension

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let a, r, g, b: UInt64
        switch hex.count {
        case 6: // RGB
            (a, r, g, b) = (255, int >> 16, int >> 8 & 0xFF, int & 0xFF)
        case 8: // ARGB
            (a, r, g, b) = (int >> 24, int >> 16 & 0xFF, int >> 8 & 0xFF, int & 0xFF)
        default:
            (a, r, g, b) = (255, 0, 0, 0)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

#Preview {
    iPhoneTabView()
        .environmentObject(AppState())
}
