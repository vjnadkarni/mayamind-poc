//
//  ContentView.swift
//  MayaMind
//
//  Root view that adapts UI based on device type (iPhone vs iPad)
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var authService = AuthService.shared
    @Environment(\.horizontalSizeClass) var horizontalSizeClass
    @State private var showLanding = true
    @State private var isCheckingAuth = true

    var body: some View {
        ZStack {
            if isCheckingAuth {
                // Loading state while checking auth
                ZStack {
                    Color(hex: "0a0a10")
                        .ignoresSafeArea()

                    VStack(spacing: 16) {
                        Image(systemName: "person.wave.2.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.orange)

                        ProgressView()
                            .progressViewStyle(CircularProgressViewStyle(tint: .orange))
                    }
                }
            } else if showLanding {
                // Always show landing screen first for all users
                LandingView(onEnter: {
                    withAnimation(.easeOut(duration: 0.5)) {
                        showLanding = false
                    }
                })
                .transition(.opacity)
            } else if !authService.isAuthenticated {
                // Not authenticated - show login
                LoginView()
                    .transition(.opacity)
            } else {
                // Authenticated - go to main app
                Group {
                    if UIDevice.current.userInterfaceIdiom == .pad {
                        // iPad: Landscape, exercise-focused layout
                        iPadMainView()
                    } else {
                        // iPhone: Portrait, tab-based navigation
                        iPhoneTabView()
                    }
                }
            }
        }
        .preferredColorScheme(.dark)
        .task {
            // Check for existing session
            await authService.checkSession()
            isCheckingAuth = false
        }
    }
}

#Preview("iPhone") {
    ContentView()
        .environmentObject(AppState())
        .previewDevice("iPhone 15")
}

#Preview("iPad") {
    ContentView()
        .environmentObject(AppState())
        .previewDevice("iPad Pro (12.9-inch) (6th generation)")
}
