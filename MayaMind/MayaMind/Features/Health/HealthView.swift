//
//  HealthView.swift
//  MayaMind
//
//  Health monitoring dashboard with HealthKit + Smart Scale data
//

import SwiftUI
import Combine

struct HealthView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = HealthViewModel()
    @State private var showSettings = false
    @State private var selectedMetric: MetricDetailType?

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

                ScrollView {
                    VStack(spacing: 16) {
                        // Vitals row 1: Heart Rate & HRV
                        HStack(spacing: 12) {
                            VitalCard(
                                title: "Heart Rate",
                                stats: viewModel.heartRateStats,
                                unit: "BPM",
                                icon: "heart.fill",
                                color: .red,
                                formatValue: { String(format: "%.0f", $0) }
                            ) {
                                selectedMetric = .heartRate
                            }

                            VitalCard(
                                title: "HRV",
                                stats: viewModel.hrvStats,
                                unit: "ms",
                                icon: "waveform.path.ecg",
                                color: .purple,
                                formatValue: { String(format: "%.0f", $0) }
                            ) {
                                selectedMetric = .hrv
                            }
                        }

                        // Vitals row 2: SpO2 & Steps
                        HStack(spacing: 12) {
                            VitalCard(
                                title: "Blood Oxygen",
                                stats: viewModel.spo2Stats,
                                unit: "%",
                                icon: "lungs.fill",
                                color: .blue,
                                formatValue: { String(format: "%.0f", $0) }
                            ) {
                                selectedMetric = .spo2
                            }

                            SimpleHealthCard(
                                title: "Steps",
                                value: viewModel.steps.map { formatNumber($0) },
                                unit: "today",
                                icon: "figure.walk",
                                color: .green
                            )
                        }

                        // Vitals row 3: Exercise & Sleep
                        HStack(spacing: 12) {
                            SimpleHealthCard(
                                title: "Exercise",
                                value: viewModel.exerciseMinutes.map { "\($0)" },
                                unit: "min",
                                icon: "flame.fill",
                                color: .pink
                            )

                            SleepCard(
                                sleepStages: viewModel.sleepStages,
                                onTap: { selectedMetric = .sleep }
                            )
                        }

                        // Body composition section
                        VStack(alignment: .leading, spacing: 12) {
                            Text("Body Composition")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundColor(.white)
                                .padding(.horizontal, 4)

                            // Row 1: Weight & Body Fat
                            HStack(spacing: 12) {
                                BodyCompCard(
                                    title: "Weight",
                                    value: viewModel.weight.map { String(format: "%.1f", $0) },
                                    unit: "lbs"
                                )
                                BodyCompCard(
                                    title: "Body Fat",
                                    value: viewModel.bodyFatPercentage.map { String(format: "%.1f", $0) },
                                    unit: "%"
                                )
                            }

                            // Row 2: Lean Body Mass & BMI
                            HStack(spacing: 12) {
                                BodyCompCard(
                                    title: "Lean Mass",
                                    value: viewModel.leanBodyMass.map { String(format: "%.1f", $0) },
                                    unit: "lbs"
                                )
                                BodyCompCard(
                                    title: "BMI",
                                    value: viewModel.bmi.map { String(format: "%.1f", $0) },
                                    unit: ""
                                )
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
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(appState)
        }
        .sheet(item: $selectedMetric) { metric in
            MetricDetailView(
                metric: metric,
                heartRateStats: viewModel.heartRateStats,
                hrvStats: viewModel.hrvStats,
                spo2Stats: viewModel.spo2Stats,
                sleepStages: viewModel.sleepStages
            )
        }
    }

    private func formatNumber(_ value: Int) -> String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        return formatter.string(from: NSNumber(value: value)) ?? "\(value)"
    }
}

// MARK: - Metric Detail Type

enum MetricDetailType: Identifiable {
    case heartRate
    case hrv
    case spo2
    case sleep

    var id: String {
        switch self {
        case .heartRate: return "heartRate"
        case .hrv: return "hrv"
        case .spo2: return "spo2"
        case .sleep: return "sleep"
        }
    }

    var title: String {
        switch self {
        case .heartRate: return "Heart Rate"
        case .hrv: return "Heart Rate Variability"
        case .spo2: return "Blood Oxygen"
        case .sleep: return "Sleep Analysis"
        }
    }
}

// MARK: - Connection Badge

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

// MARK: - Vital Card with Sparkline

struct VitalCard: View {
    let title: String
    let stats: MetricStats
    let unit: String
    let icon: String
    let color: Color
    let formatValue: (Double) -> String
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                // Header
                HStack {
                    Image(systemName: icon)
                        .foregroundColor(color)
                    Text(title)
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundColor(.gray.opacity(0.5))
                }

                // Current value
                HStack(alignment: .bottom, spacing: 4) {
                    if let current = stats.current {
                        Text(formatValue(current))
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.white)
                    } else {
                        Text("--")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.gray)
                    }
                    Text(unit)
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                        .padding(.bottom, 4)
                }

                // 24-hour range
                if let min = stats.min, let max = stats.max {
                    Text("24h: \(formatValue(min))-\(formatValue(max)) \(unit)")
                        .font(.system(size: 11))
                        .foregroundColor(.gray)
                } else {
                    Text("24h: Not available")
                        .font(.system(size: 11))
                        .foregroundColor(.gray.opacity(0.6))
                }

                // Sparkline
                SparklineView(dataPoints: stats.history, color: color)
                    .frame(height: 30)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color(hex: "1a1a2e"))
            .cornerRadius(16)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Simple Health Card (no sparkline)

struct SimpleHealthCard: View {
    let title: String
    let value: String?
    let unit: String
    let icon: String
    let color: Color

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
                Text(value ?? "--")
                    .font(.system(size: 28, weight: .bold))
                    .foregroundColor(value != nil ? .white : .gray)
                Text(unit)
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
                    .padding(.bottom, 4)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 110)
        .padding(12)
        .background(Color(hex: "1a1a2e"))
        .cornerRadius(16)
    }
}

// MARK: - Sleep Card

struct SleepCard: View {
    let sleepStages: SleepStageData?
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Image(systemName: "moon.fill")
                        .foregroundColor(.indigo)
                    Text("Sleep")
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                    Spacer()
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12))
                        .foregroundColor(.gray.opacity(0.5))
                }

                HStack(alignment: .bottom, spacing: 4) {
                    if let stages = sleepStages {
                        Text(String(format: "%.1f", stages.totalHours))
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.white)
                    } else {
                        Text("--")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.gray)
                    }
                    Text("hrs")
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                        .padding(.bottom, 4)
                }

                // Sleep stages mini bar
                if let stages = sleepStages {
                    SleepStagesBar(stages: stages)
                        .frame(height: 8)
                } else {
                    Text("Not available")
                        .font(.system(size: 11))
                        .foregroundColor(.gray.opacity(0.6))
                }

                Spacer()
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .frame(height: 110)
            .padding(12)
            .background(Color(hex: "1a1a2e"))
            .cornerRadius(16)
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Sleep Stages Bar

struct SleepStagesBar: View {
    let stages: SleepStageData

    var body: some View {
        GeometryReader { geometry in
            HStack(spacing: 1) {
                if stages.total > 0 {
                    Rectangle()
                        .fill(Color.purple.opacity(0.8))
                        .frame(width: geometry.size.width * CGFloat(stages.deep / stages.total))
                    Rectangle()
                        .fill(Color.blue.opacity(0.8))
                        .frame(width: geometry.size.width * CGFloat(stages.core / stages.total))
                    Rectangle()
                        .fill(Color.cyan.opacity(0.8))
                        .frame(width: geometry.size.width * CGFloat(stages.rem / stages.total))
                    Rectangle()
                        .fill(Color.orange.opacity(0.6))
                        .frame(width: geometry.size.width * CGFloat(stages.awake / stages.total))
                }
            }
            .cornerRadius(4)
        }
    }
}

// MARK: - Sparkline View

struct SparklineView: View {
    let dataPoints: [HealthDataPoint]
    let color: Color

    var body: some View {
        GeometryReader { geometry in
            if dataPoints.count > 1 {
                let values = dataPoints.map { $0.value }
                let minVal = values.min() ?? 0
                let maxVal = values.max() ?? 1
                let range = max(maxVal - minVal, 1)

                Path { path in
                    for (index, point) in dataPoints.enumerated() {
                        let x = geometry.size.width * CGFloat(index) / CGFloat(dataPoints.count - 1)
                        let y = geometry.size.height * (1 - CGFloat((point.value - minVal) / range))

                        if index == 0 {
                            path.move(to: CGPoint(x: x, y: y))
                        } else {
                            path.addLine(to: CGPoint(x: x, y: y))
                        }
                    }
                }
                .stroke(color.opacity(0.7), lineWidth: 1.5)

                // Gradient fill below the line
                Path { path in
                    path.move(to: CGPoint(x: 0, y: geometry.size.height))
                    for (index, point) in dataPoints.enumerated() {
                        let x = geometry.size.width * CGFloat(index) / CGFloat(dataPoints.count - 1)
                        let y = geometry.size.height * (1 - CGFloat((point.value - minVal) / range))
                        path.addLine(to: CGPoint(x: x, y: y))
                    }
                    path.addLine(to: CGPoint(x: geometry.size.width, y: geometry.size.height))
                    path.closeSubpath()
                }
                .fill(
                    LinearGradient(
                        gradient: Gradient(colors: [color.opacity(0.3), color.opacity(0.05)]),
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
            } else {
                // No data - show placeholder line
                Rectangle()
                    .fill(Color.gray.opacity(0.2))
                    .frame(height: 1)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
        }
    }
}

// MARK: - Body Composition Card

struct BodyCompCard: View {
    let title: String
    let value: String?
    let unit: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.system(size: 14))
                .foregroundColor(.gray)
            HStack(alignment: .bottom, spacing: 4) {
                Text(value ?? "--")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(value != nil ? .white : .gray)
                if !unit.isEmpty {
                    Text(unit)
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                        .padding(.bottom, 2)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding()
        .background(Color(hex: "151520"))
        .cornerRadius(12)
    }
}

// MARK: - Metric Detail View (Tap-to-Expand)

struct MetricDetailView: View {
    let metric: MetricDetailType
    let heartRateStats: MetricStats
    let hrvStats: MetricStats
    let spo2Stats: MetricStats
    let sleepStages: SleepStageData?

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationView {
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                ScrollView {
                    VStack(spacing: 24) {
                        switch metric {
                        case .heartRate:
                            DetailChartSection(
                                title: "Heart Rate",
                                stats: heartRateStats,
                                unit: "BPM",
                                color: .red,
                                formatValue: { String(format: "%.0f", $0) }
                            )

                        case .hrv:
                            DetailChartSection(
                                title: "Heart Rate Variability",
                                stats: hrvStats,
                                unit: "ms",
                                color: .purple,
                                formatValue: { String(format: "%.0f", $0) }
                            )

                        case .spo2:
                            DetailChartSection(
                                title: "Blood Oxygen",
                                stats: spo2Stats,
                                unit: "%",
                                color: .blue,
                                formatValue: { String(format: "%.0f", $0) }
                            )

                        case .sleep:
                            SleepDetailSection(stages: sleepStages)
                        }
                    }
                    .padding()
                }
            }
            .navigationTitle(metric.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(.orange)
                }
            }
        }
        .preferredColorScheme(.dark)
    }
}

// MARK: - Detail Chart Section

struct DetailChartSection: View {
    let title: String
    let stats: MetricStats
    let unit: String
    let color: Color
    let formatValue: (Double) -> String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Current value
            VStack(alignment: .leading, spacing: 4) {
                Text("Current")
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
                HStack(alignment: .bottom, spacing: 4) {
                    if let current = stats.current {
                        Text(formatValue(current))
                            .font(.system(size: 48, weight: .bold))
                            .foregroundColor(.white)
                    } else {
                        Text("--")
                            .font(.system(size: 48, weight: .bold))
                            .foregroundColor(.gray)
                    }
                    Text(unit)
                        .font(.system(size: 18))
                        .foregroundColor(.gray)
                        .padding(.bottom, 8)
                }
            }

            // 24-hour range
            HStack(spacing: 24) {
                VStack(alignment: .leading) {
                    Text("24h Min")
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                    Text(stats.min.map { formatValue($0) } ?? "--")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(.white)
                }
                VStack(alignment: .leading) {
                    Text("24h Max")
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                    Text(stats.max.map { formatValue($0) } ?? "--")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(.white)
                }
            }

            // Large chart
            VStack(alignment: .leading, spacing: 8) {
                Text("24-Hour Trend")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)

                DetailSparklineView(dataPoints: stats.history, color: color, unit: unit)
                    .frame(height: 200)
                    .background(Color(hex: "1a1a2e"))
                    .cornerRadius(12)
            }

            // Hourly breakdown
            if !stats.history.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Hourly Readings")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)

                    HourlyReadingsList(dataPoints: stats.history, unit: unit, formatValue: formatValue)
                }
            }
        }
    }
}

// MARK: - Detail Sparkline View (larger with axes)

struct DetailSparklineView: View {
    let dataPoints: [HealthDataPoint]
    let color: Color
    let unit: String

    var body: some View {
        GeometryReader { geometry in
            if dataPoints.count > 1 {
                let values = dataPoints.map { $0.value }
                let minVal = values.min() ?? 0
                let maxVal = values.max() ?? 1
                let range = max(maxVal - minVal, 1)

                ZStack {
                    // Y-axis labels
                    VStack {
                        Text(String(format: "%.0f", maxVal))
                            .font(.system(size: 10))
                            .foregroundColor(.gray)
                        Spacer()
                        Text(String(format: "%.0f", minVal))
                            .font(.system(size: 10))
                            .foregroundColor(.gray)
                    }
                    .frame(width: 30)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 8)

                    // Chart area
                    VStack {
                        // Gradient fill
                        Path { path in
                            let chartWidth = geometry.size.width - 50
                            let chartHeight = geometry.size.height - 30
                            let offsetX: CGFloat = 40

                            path.move(to: CGPoint(x: offsetX, y: chartHeight))
                            for (index, point) in dataPoints.enumerated() {
                                let x = offsetX + chartWidth * CGFloat(index) / CGFloat(dataPoints.count - 1)
                                let y = chartHeight * (1 - CGFloat((point.value - minVal) / range))
                                path.addLine(to: CGPoint(x: x, y: y))
                            }
                            path.addLine(to: CGPoint(x: offsetX + chartWidth, y: chartHeight))
                            path.closeSubpath()
                        }
                        .fill(
                            LinearGradient(
                                gradient: Gradient(colors: [color.opacity(0.4), color.opacity(0.05)]),
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )

                        // Line
                        Path { path in
                            let chartWidth = geometry.size.width - 50
                            let chartHeight = geometry.size.height - 30
                            let offsetX: CGFloat = 40

                            for (index, point) in dataPoints.enumerated() {
                                let x = offsetX + chartWidth * CGFloat(index) / CGFloat(dataPoints.count - 1)
                                let y = chartHeight * (1 - CGFloat((point.value - minVal) / range))

                                if index == 0 {
                                    path.move(to: CGPoint(x: x, y: y))
                                } else {
                                    path.addLine(to: CGPoint(x: x, y: y))
                                }
                            }
                        }
                        .stroke(color, lineWidth: 2)
                    }

                    // X-axis labels (time)
                    HStack {
                        if let first = dataPoints.first, let last = dataPoints.last {
                            Text(formatTime(first.timestamp))
                                .font(.system(size: 10))
                                .foregroundColor(.gray)
                            Spacer()
                            Text(formatTime(last.timestamp))
                                .font(.system(size: 10))
                                .foregroundColor(.gray)
                        }
                    }
                    .padding(.horizontal, 40)
                    .frame(maxHeight: .infinity, alignment: .bottom)
                    .padding(.bottom, 4)
                }
            } else {
                VStack {
                    Spacer()
                    Text("No data available")
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(8)
    }

    private func formatTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "h:mm a"
        return formatter.string(from: date)
    }
}

// MARK: - Hourly Readings List

struct HourlyReadingsList: View {
    let dataPoints: [HealthDataPoint]
    let unit: String
    let formatValue: (Double) -> String

    var body: some View {
        // Group by hour and show hourly averages
        let hourlyData = groupByHour(dataPoints)

        ForEach(hourlyData.prefix(12), id: \.hour) { hourData in
            HStack {
                Text(hourData.hour)
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
                    .frame(width: 80, alignment: .leading)
                Text("\(formatValue(hourData.average)) \(unit)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(.white)
                Spacer()
                Text("(\(hourData.count) readings)")
                    .font(.system(size: 12))
                    .foregroundColor(.gray.opacity(0.6))
            }
            .padding(.vertical, 8)
            .padding(.horizontal, 12)
            .background(Color(hex: "1a1a2e"))
            .cornerRadius(8)
        }
    }

    private func groupByHour(_ points: [HealthDataPoint]) -> [(hour: String, average: Double, count: Int)] {
        let formatter = DateFormatter()
        formatter.dateFormat = "h a"

        var hourGroups: [String: [Double]] = [:]

        for point in points {
            let hourKey = formatter.string(from: point.timestamp)
            hourGroups[hourKey, default: []].append(point.value)
        }

        return hourGroups.map { (hour: $0.key, average: $0.value.reduce(0, +) / Double($0.value.count), count: $0.value.count) }
            .sorted { $0.hour > $1.hour }
    }
}

// MARK: - Sleep Detail Section

struct SleepDetailSection: View {
    let stages: SleepStageData?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            // Total sleep
            VStack(alignment: .leading, spacing: 4) {
                Text("Total Sleep")
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
                HStack(alignment: .bottom, spacing: 4) {
                    if let stages = stages {
                        Text(String(format: "%.1f", stages.totalHours))
                            .font(.system(size: 48, weight: .bold))
                            .foregroundColor(.white)
                    } else {
                        Text("--")
                            .font(.system(size: 48, weight: .bold))
                            .foregroundColor(.gray)
                    }
                    Text("hours")
                        .font(.system(size: 18))
                        .foregroundColor(.gray)
                        .padding(.bottom, 8)
                }
            }

            if let stages = stages {
                // Sleep stages breakdown
                VStack(alignment: .leading, spacing: 16) {
                    Text("Sleep Stages")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundColor(.white)

                    // Visual bar
                    SleepStagesBar(stages: stages)
                        .frame(height: 24)
                        .cornerRadius(6)

                    // Legend
                    VStack(spacing: 12) {
                        SleepStageRow(
                            color: .purple,
                            name: "Deep Sleep",
                            duration: stages.deep,
                            total: stages.total
                        )
                        SleepStageRow(
                            color: .blue,
                            name: "Core Sleep",
                            duration: stages.core,
                            total: stages.total
                        )
                        SleepStageRow(
                            color: .cyan,
                            name: "REM Sleep",
                            duration: stages.rem,
                            total: stages.total
                        )
                        SleepStageRow(
                            color: .orange,
                            name: "Awake",
                            duration: stages.awake,
                            total: stages.total
                        )
                    }
                    .padding()
                    .background(Color(hex: "1a1a2e"))
                    .cornerRadius(12)
                }
            } else {
                VStack {
                    Text("No sleep data available")
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                    Text("Wear your Apple Watch to bed to track sleep")
                        .font(.system(size: 12))
                        .foregroundColor(.gray.opacity(0.6))
                }
                .frame(maxWidth: .infinity)
                .padding()
                .background(Color(hex: "1a1a2e"))
                .cornerRadius(12)
            }
        }
    }
}

// MARK: - Sleep Stage Row

struct SleepStageRow: View {
    let color: Color
    let name: String
    let duration: TimeInterval
    let total: TimeInterval

    var body: some View {
        HStack {
            Circle()
                .fill(color)
                .frame(width: 12, height: 12)
            Text(name)
                .font(.system(size: 14))
                .foregroundColor(.white)
            Spacer()
            Text(formatDuration(duration))
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.white)
            Text(String(format: "%.0f%%", (duration / total) * 100))
                .font(.system(size: 12))
                .foregroundColor(.gray)
                .frame(width: 40, alignment: .trailing)
        }
    }

    private func formatDuration(_ seconds: TimeInterval) -> String {
        let hours = Int(seconds) / 3600
        let minutes = (Int(seconds) % 3600) / 60
        if hours > 0 {
            return "\(hours)h \(minutes)m"
        }
        return "\(minutes)m"
    }
}

// MARK: - View Model

class HealthViewModel: ObservableObject {
    private let healthKitService = HealthKitService()
    private var cancellables = Set<AnyCancellable>()

    // Forwarded properties from HealthKitService
    @Published var heartRateStats = MetricStats.empty
    @Published var hrvStats = MetricStats.empty
    @Published var spo2Stats = MetricStats.empty
    @Published var steps: Int?
    @Published var exerciseMinutes: Int?
    @Published var sleepStages: SleepStageData?
    @Published var weight: Double?
    @Published var bodyFatPercentage: Double?
    @Published var leanBodyMass: Double?
    @Published var bmi: Double?
    @Published var watchConnected = false
    @Published var scaleConnected = false

    init() {
        setupBindings()
    }

    private func setupBindings() {
        healthKitService.$heartRateStats.assign(to: &$heartRateStats)
        healthKitService.$hrvStats.assign(to: &$hrvStats)
        healthKitService.$spo2Stats.assign(to: &$spo2Stats)
        healthKitService.$steps.assign(to: &$steps)
        healthKitService.$exerciseMinutes.assign(to: &$exerciseMinutes)
        healthKitService.$sleepStages.assign(to: &$sleepStages)
        healthKitService.$weight.assign(to: &$weight)
        healthKitService.$bodyFatPercentage.assign(to: &$bodyFatPercentage)
        healthKitService.$leanBodyMass.assign(to: &$leanBodyMass)
        healthKitService.$bmi.assign(to: &$bmi)
        healthKitService.$watchConnected.assign(to: &$watchConnected)
        healthKitService.$scaleConnected.assign(to: &$scaleConnected)
    }

    func startMonitoring() {
        print("[HealthViewModel] startMonitoring called")
        Task {
            do {
                print("[HealthViewModel] Requesting HealthKit authorization...")
                try await healthKitService.requestAuthorization()
                print("[HealthViewModel] Authorization succeeded, fetching data...")
                await healthKitService.fetchAllData()
                print("[HealthViewModel] Data fetch complete, starting monitoring...")
                healthKitService.startMonitoring()
                print("[HealthViewModel] Monitoring started")
            } catch {
                print("[HealthViewModel] HealthKit error: \(error.localizedDescription)")
            }
        }
    }

    func stopMonitoring() {
        healthKitService.stopMonitoring()
    }
}

#Preview {
    HealthView()
        .environmentObject(AppState())
}
