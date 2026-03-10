//
//  ToDosView.swift
//  MayaMind
//
//  Placeholder for To Dos feature
//

import SwiftUI

struct ToDosView: View {
    @EnvironmentObject var appState: AppState
    @State private var showSettings = false

    var body: some View {
        ZStack {
            Color(hex: "0a0a10")
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar
                HStack {
                    Text("To Dos")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()

                    // Settings button
                    Button(action: { showSettings = true }) {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 20))
                            .foregroundColor(.orange)
                            .padding(10)
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(8)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)

                // Placeholder content
                VStack(spacing: 20) {
                    Spacer()

                    Image(systemName: "checklist")
                        .font(.system(size: 80))
                        .foregroundColor(.orange.opacity(0.5))

                    Text("To Dos Coming Soon")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(.white)

                    Text("Track your daily tasks, reminders,\nand wellness goals here.")
                        .font(.system(size: 16))
                        .foregroundColor(.gray)
                        .multilineTextAlignment(.center)

                    Spacer()
                }
                .padding()
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(appState)
        }
    }
}

#Preview {
    ToDosView()
        .environmentObject(AppState())
}
