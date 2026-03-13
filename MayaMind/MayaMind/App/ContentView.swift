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
            } else if !authService.isAuthenticated {
                // Not authenticated - show login
                LoginView()
            } else {
                // Authenticated - show main app
                ZStack {
                    // Main app content
                    Group {
                        if UIDevice.current.userInterfaceIdiom == .pad {
                            // iPad: Landscape, exercise-focused layout
                            iPadMainView()
                        } else {
                            // iPhone: Portrait, tab-based navigation
                            iPhoneTabView()
                        }
                    }

                    // Landing page overlay (only after login)
                    if showLanding {
                        LandingView(onEnter: {
                            withAnimation(.easeOut(duration: 0.5)) {
                                showLanding = false
                            }
                        })
                        .transition(.opacity)
                        .zIndex(1)
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
