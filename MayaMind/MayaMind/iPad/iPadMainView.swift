//
//  iPadMainView.swift
//  MayaMind
//
//  iPad-specific landscape layout optimized for exercise coaching
//

import SwiftUI

struct iPadMainView: View {
    @EnvironmentObject var appState: AppState
    @State private var showLanding = true
    @State private var selectedSection: iPadSection = .exercise

    var body: some View {
        ZStack {
            if showLanding {
                iPadLandingView(onEnter: {
                    withAnimation(.easeOut(duration: 0.5)) {
                        showLanding = false
                    }
                })
            } else {
                GeometryReader { geometry in
                    HStack(spacing: 0) {
                        // Left: Navigation rail
                        iPadNavigationRail(
                            selectedSection: $selectedSection,
                            isMuted: $appState.isMuted
                        )
                        .frame(width: 80)

                        // Main content area
                        mainContent
                            .frame(maxWidth: .infinity)
                    }
                }
                .background(Color(hex: "0a0a10"))
            }
        }
    }

    @ViewBuilder
    private var mainContent: some View {
        switch selectedSection {
        case .exercise:
            iPadExerciseView()
        case .maya:
            MayaView()
        case .health:
            HealthView()
        case .connect:
            ConnectView()
        case .settings:
            SettingsView()
        }
    }
}

enum iPadSection: String, CaseIterable {
    case exercise = "Exercise"
    case maya = "Maya"
    case health = "Health"
    case connect = "Connect"
    case settings = "Settings"

    var icon: String {
        switch self {
        case .exercise: return "figure.run"
        case .maya: return "person.wave.2"
        case .health: return "heart.fill"
        case .connect: return "message.fill"
        case .settings: return "gearshape.fill"
        }
    }
}

/// Vertical navigation rail for iPad
struct iPadNavigationRail: View {
    @Binding var selectedSection: iPadSection
    @Binding var isMuted: Bool

    var body: some View {
        VStack(spacing: 0) {
            // App logo
            Text("M")
                .font(.system(size: 32, weight: .bold))
                .foregroundColor(.orange)
                .padding(.top, 20)
                .padding(.bottom, 30)

            // Navigation items
            ForEach(iPadSection.allCases, id: \.self) { section in
                iPadNavItem(
                    section: section,
                    isSelected: selectedSection == section,
                    action: { selectedSection = section }
                )
            }

            Spacer()

            // Mute button
            Button(action: { isMuted.toggle() }) {
                Image(systemName: isMuted ? "mic.slash.fill" : "mic.fill")
                    .font(.system(size: 24))
                    .foregroundColor(isMuted ? .red : .green)
                    .frame(width: 50, height: 50)
                    .background(Color.white.opacity(0.1))
                    .cornerRadius(12)
            }
            .padding(.bottom, 20)
        }
        .frame(maxHeight: .infinity)
        .background(Color(hex: "1a1a2e"))
    }
}

struct iPadNavItem: View {
    let section: iPadSection
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Image(systemName: section.icon)
                    .font(.system(size: 24))
                Text(section.rawValue)
                    .font(.system(size: 10))
            }
            .foregroundColor(isSelected ? .orange : .gray)
            .frame(width: 60, height: 60)
            .background(isSelected ? Color.orange.opacity(0.2) : Color.clear)
            .cornerRadius(12)
        }
        .padding(.vertical, 4)
    }
}

/// iPad landing view with image slideshow
struct iPadLandingView: View {
    let onEnter: () -> Void
    @State private var currentImageIndex = 0

    // Images will be loaded from bundled assets
    private let imageNames = [
        "landing_1", "landing_2", "landing_3", "landing_4", "landing_5",
        "landing_6", "landing_7", "landing_8", "landing_9", "landing_10"
    ]

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background image with Ken Burns effect
                // TODO: Implement Ken Burns animation with bundled images
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                // Content overlay
                VStack {
                    // Top: App title
                    HStack {
                        Text("MayaMind")
                            .font(.system(size: 48, weight: .bold))
                            .foregroundColor(.orange)
                        Spacer()

                        // Settings button
                        Button(action: {}) {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 28))
                                .foregroundColor(.white.opacity(0.7))
                        }
                    }
                    .padding(.horizontal, 40)
                    .padding(.top, 40)

                    Spacer()

                    // Center-right: Tagline
                    HStack {
                        Spacer()
                        Text("Your companion and\ncoach at home...")
                            .font(.system(size: 42, weight: .semibold))
                            .foregroundColor(.orange)
                            .multilineTextAlignment(.trailing)
                            .shadow(color: .black, radius: 4, x: 2, y: 2)
                            .padding(.trailing, geometry.size.width * 0.1)
                    }
                    .padding(.bottom, geometry.size.height * 0.15)

                    Spacer()
                }
            }
        }
        .onTapGesture {
            onEnter()
        }
    }
}

/// iPad-specific exercise view with camera + avatar layout
struct iPadExerciseView: View {
    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 0) {
                // Left 75%: Camera feed with skeleton overlay
                ZStack {
                    // Camera preview will be added here
                    Color.black
                    Text("Camera + Skeleton Overlay")
                        .foregroundColor(.gray)
                }
                .frame(width: geometry.size.width * 0.75)

                // Right 25%: Exercise info + Avatar
                VStack(spacing: 0) {
                    // Top: Exercise info
                    VStack(spacing: 8) {
                        Text("EXERCISE")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.gray)
                        Text("Chair Squats")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)

                        Spacer().frame(height: 20)

                        Text("REP COUNT")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.gray)
                        Text("0")
                            .font(.system(size: 64, weight: .bold))
                            .foregroundColor(.orange)

                        Text("Quality: --")
                            .font(.system(size: 16))
                            .foregroundColor(.gray)
                    }
                    .padding()
                    .frame(height: geometry.size.height * 0.30)

                    Divider().background(Color.gray.opacity(0.3))

                    // Middle: Avatar
                    ZStack {
                        Color(hex: "1a1a2e")
                        // AvatarWebView will be embedded here
                        Text("Maya Avatar")
                            .foregroundColor(.gray)
                    }
                    .frame(height: geometry.size.height * 0.30)

                    Divider().background(Color.gray.opacity(0.3))

                    // Bottom: Chat transcript
                    VStack {
                        Text("Chat")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.gray)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal)
                            .padding(.top, 8)

                        ScrollView {
                            VStack(alignment: .leading, spacing: 8) {
                                // Chat messages will appear here
                                Text("Maya: Would you like to exercise today?")
                                    .foregroundColor(.white)
                                    .font(.system(size: 14))
                            }
                            .padding(.horizontal)
                        }
                    }
                    .frame(height: geometry.size.height * 0.40)
                    .background(Color(hex: "0f0f1a"))
                }
                .frame(width: geometry.size.width * 0.25)
                .background(Color(hex: "151520"))
            }
        }
    }
}

#Preview {
    iPadMainView()
        .environmentObject(AppState())
        .previewInterfaceOrientation(.landscapeLeft)
}
