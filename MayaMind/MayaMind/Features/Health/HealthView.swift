//
//  HealthView.swift
//  MayaMind
//
//  Health monitoring dashboard with HealthKit + Withings data
//

import SwiftUI
import Combine

struct HealthView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = HealthViewModel()

    var body: some View {
        ZStack {
            Color(hex: "0a0a10")
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar
                HStack {
                    Text("Health")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()

                    // Connection status
                    HStack(spacing: 8) {
                        ConnectionBadge(label: "Watch", isConnected: viewModel.watchConnected)
                        ConnectionBadge(label: "Scale", isConnected: viewModel.scaleConnected)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)

                ScrollView {
                    VStack(spacing: 16) {
                        // Vitals row
                        HStack(spacing: 12) {
                            HealthCard(
                                title: "Heart Rate",
                                value: viewModel.heartRate ?? "--",
                                unit: "BPM",
                                icon: "heart.fill",
                                color: .red,
                                average: viewModel.heartRateAvg
                            )
                            HealthCard(
                                title: "HRV",
                                value: viewModel.hrv ?? "--",
                                unit: "ms",
                                icon: "waveform.path.ecg",
                                color: .purple,
                                average: viewModel.hrvAvg
                            )
                        }

                        HStack(spacing: 12) {
                            HealthCard(
                                title: "Blood Oxygen",
                                value: viewModel.spo2 ?? "--",
                                unit: "%",
                                icon: "lungs.fill",
                                color: .blue,
                                average: viewModel.spo2Avg
                            )
                            HealthCard(
                                title: "Steps",
                                value: viewModel.steps ?? "--",
                                unit: "today",
                                icon: "figure.walk",
                                color: .green,
                                average: nil
                            )
                        }

                        HStack(spacing: 12) {
                            HealthCard(
                                title: "Exercise",
                                value: viewModel.exerciseMinutes ?? "--",
                                unit: "min",
                                icon: "flame.fill",
                                color: .pink,
                                average: nil
                            )
                            HealthCard(
                                title: "Sleep",
                                value: viewModel.sleepHours ?? "--",
                                unit: "hrs",
                                icon: "moon.fill",
                                color: .indigo,
                                average: nil
                            )
                        }

                        // Body composition section
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Body Composition")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 4)

                            HStack(spacing: 12) {
                                BodyCompCard(
                                    title: "Weight",
                                    value: viewModel.weight ?? "--",
                                    unit: "lbs"
                                )
                                BodyCompCard(
                                    title: "Body Fat",
                                    value: viewModel.bodyFat ?? "--",
                                    unit: "%"
                                )
                            }

                            // Withings-only metrics (shown if connected)
                            if viewModel.scaleConnected {
                                HStack(spacing: 12) {
                                    BodyCompCard(
                                        title: "Muscle Mass",
                                        value: viewModel.muscleMass ?? "--",
                                        unit: "lbs"
                                    )
                                    BodyCompCard(
                                        title: "Bone Mass",
                                        value: viewModel.boneMass ?? "--",
                                        unit: "lbs"
                                    )
                                }

                                BodyCompCard(
                                    title: "Visceral Fat",
                                    value: viewModel.visceralFat ?? "--",
                                    unit: "level"
                                )
                                .frame(maxWidth: .infinity)
                            }
                        }
                        .padding(.top, 8)
                    }
                    .padding()
                }
            }
        }
        .onAppear {
            viewModel.startMonitoring()
        }
        .onDisappear {
            viewModel.stopMonitoring()
        }
    }
}

struct ConnectionBadge: View {
    let label: String
    let isConnected: Bool

    var body: some View {
        HStack(spacing: 4) {
            Circle()
                .fill(isConnected ? Color.green : Color.gray)
                .frame(width: 8, height: 8)
            Text(label)
                .font(.system(size: 12))
                .foregroundColor(isConnected ? .green : .gray)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(Color.white.opacity(0.1))
        .cornerRadius(12)
    }
}

struct HealthCard: View {
    let title: String
    let value: String
    let unit: String
    let icon: String
    let color: Color
    let average: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: icon)
                    .foregroundColor(color)
                Text(title)
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
            }

            HStack(alignment: .bottom, spacing: 4) {
                Text(value)
                    .font(.system(size: 32, weight: .bold))
                    .foregroundColor(.white)
                Text(unit)
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
                    .padding(.bottom, 4)
            }

            if let avg = average {
                Text("10-min avg: \(avg)")
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(hex: "1a1a2e"))
        .cornerRadius(16)
    }
}

struct BodyCompCard: View {
    let title: String
    let value: String
    let unit: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 14))
                .foregroundColor(.gray)
            HStack(alignment: .bottom, spacing: 4) {
                Text(value)
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white)
                Text(unit)
                    .font(.system(size: 12))
                    .foregroundColor(.gray)
                    .padding(.bottom, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(hex: "151520"))
        .cornerRadius(12)
    }
}

class HealthViewModel: ObservableObject {
    // Connection status
    @Published var watchConnected = false
    @Published var scaleConnected = false

    // Apple Watch vitals (HealthKit)
    @Published var heartRate: String?
    @Published var heartRateAvg: String?
    @Published var hrv: String?
    @Published var hrvAvg: String?
    @Published var spo2: String?
    @Published var spo2Avg: String?
    @Published var steps: String?
    @Published var exerciseMinutes: String?
    @Published var sleepHours: String?

    // Body composition (HealthKit - any scale)
    @Published var weight: String?
    @Published var bodyFat: String?

    // Withings-only metrics
    @Published var muscleMass: String?
    @Published var boneMass: String?
    @Published var visceralFat: String?

    private var healthKitService: HealthKitService?

    func startMonitoring() {
        // TODO: Initialize HealthKit monitoring
        // For now, show placeholder data
        heartRate = "72"
        heartRateAvg = "68"
        hrv = "45"
        hrvAvg = "42"
        steps = "3,240"
        exerciseMinutes = "18"
        sleepHours = "7.2"
        weight = "168"
        bodyFat = "24.5"
        watchConnected = true
    }

    func stopMonitoring() {
        // Stop HealthKit observers
    }
}

#Preview {
    HealthView()
        .environmentObject(AppState())
}
