//
//  ContentView.swift
//  MayaMind
//
//  Root view that adapts UI based on device type (iPhone vs iPad)
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject var appState: AppState
    @Environment(\.horizontalSizeClass) var horizontalSizeClass
    @State private var showLanding = true

    var body: some View {
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

            // Landing page overlay
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
        .preferredColorScheme(.dark)
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
