//
//  HealthKitService.swift
//  MayaMind
//
//  HealthKit integration for Apple Watch + Smart Scale data
//

import Foundation
import HealthKit
import Combine

/// Data point for time-series health data (used for sparklines)
struct HealthDataPoint: Identifiable {
    let id = UUID()
    let timestamp: Date
    let value: Double
}

/// Sleep stage data
struct SleepStageData {
    var awake: TimeInterval = 0
    var rem: TimeInterval = 0
    var core: TimeInterval = 0
    var deep: TimeInterval = 0

    var total: TimeInterval {
        awake + rem + core + deep
    }

    var totalHours: Double {
        total / 3600.0
    }
}

/// 24-hour stats for a metric
struct MetricStats {
    let current: Double?
    let min: Double?
    let max: Double?
    let history: [HealthDataPoint]

    static let empty = MetricStats(current: nil, min: nil, max: nil, history: [])
}

class HealthKitService: ObservableObject {
    private let healthStore = HKHealthStore()
    private var observerQueries: [HKObserverQuery] = []

    // Published health data with 24-hour stats
    @Published var heartRateStats = MetricStats.empty
    @Published var hrvStats = MetricStats.empty
    @Published var spo2Stats = MetricStats.empty

    // Simple metrics (no 24-hour history needed)
    @Published var steps: Int?
    @Published var exerciseMinutes: Int?
    @Published var sleepStages: SleepStageData?

    // Body composition
    @Published var weight: Double?
    @Published var bodyFatPercentage: Double?
    @Published var leanBodyMass: Double?
    @Published var bmi: Double?

    // Connection status
    @Published var isAuthorized = false
    @Published var watchConnected = false
    @Published var scaleConnected = false

    // HealthKit types we want to read
    private var readTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()

        // Vitals from Apple Watch
        if let heartRate = HKObjectType.quantityType(forIdentifier: .heartRate) {
            types.insert(heartRate)
        }
        if let hrv = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
            types.insert(hrv)
        }
        if let spo2 = HKObjectType.quantityType(forIdentifier: .oxygenSaturation) {
            types.insert(spo2)
        }
        if let steps = HKObjectType.quantityType(forIdentifier: .stepCount) {
            types.insert(steps)
        }
        if let exercise = HKObjectType.quantityType(forIdentifier: .appleExerciseTime) {
            types.insert(exercise)
        }

        // Sleep
        if let sleep = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) {
            types.insert(sleep)
        }

        // Body composition (from any smart scale)
        if let weight = HKObjectType.quantityType(forIdentifier: .bodyMass) {
            types.insert(weight)
        }
        if let bodyFat = HKObjectType.quantityType(forIdentifier: .bodyFatPercentage) {
            types.insert(bodyFat)
        }
        if let leanMass = HKObjectType.quantityType(forIdentifier: .leanBodyMass) {
            types.insert(leanMass)
        }
        if let bmi = HKObjectType.quantityType(forIdentifier: .bodyMassIndex) {
            types.insert(bmi)
        }

        return types
    }

    /// Check if HealthKit is available on this device
    var isAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    /// Request authorization to read health data
    func requestAuthorization() async throws {
        print("[HealthKit] Checking availability...")
        guard isAvailable else {
            print("[HealthKit] ERROR: HealthKit not available on this device")
            throw HealthKitError.notAvailable
        }
        print("[HealthKit] HealthKit is available")

        print("[HealthKit] Requesting authorization for \(readTypes.count) types...")
        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
        print("[HealthKit] Authorization request completed")
        await MainActor.run {
            self.isAuthorized = true
            print("[HealthKit] isAuthorized = true")
        }
    }

    /// Fetch all health data
    func fetchAllData() async {
        print("[HealthKit] Fetching all health data...")
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchHeartRateStats() }
            group.addTask { await self.fetchHRVStats() }
            group.addTask { await self.fetchSpO2Stats() }
            group.addTask { await self.fetchSteps() }
            group.addTask { await self.fetchExerciseMinutes() }
            group.addTask { await self.fetchSleepData() }
            group.addTask { await self.fetchBodyComposition() }
        }

        // Update connection status based on data availability
        await MainActor.run {
            self.watchConnected = self.heartRateStats.current != nil || self.steps != nil
            self.scaleConnected = self.weight != nil
        }
    }

    /// Start real-time monitoring with observer queries
    func startMonitoring() {
        // Stop any existing observers
        stopMonitoring()

        // Heart rate observer
        if let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) {
            let query = HKObserverQuery(sampleType: heartRateType, predicate: nil) { [weak self] _, _, error in
                guard error == nil else { return }
                Task { await self?.fetchHeartRateStats() }
            }
            healthStore.execute(query)
            observerQueries.append(query)
        }

        // HRV observer
        if let hrvType = HKObjectType.quantityType(forIdentifier: .heartRateVariabilitySDNN) {
            let query = HKObserverQuery(sampleType: hrvType, predicate: nil) { [weak self] _, _, error in
                guard error == nil else { return }
                Task { await self?.fetchHRVStats() }
            }
            healthStore.execute(query)
            observerQueries.append(query)
        }

        // SpO2 observer
        if let spo2Type = HKObjectType.quantityType(forIdentifier: .oxygenSaturation) {
            let query = HKObserverQuery(sampleType: spo2Type, predicate: nil) { [weak self] _, _, error in
                guard error == nil else { return }
                Task { await self?.fetchSpO2Stats() }
            }
            healthStore.execute(query)
            observerQueries.append(query)
        }

        // Steps observer
        if let stepsType = HKObjectType.quantityType(forIdentifier: .stepCount) {
            let query = HKObserverQuery(sampleType: stepsType, predicate: nil) { [weak self] _, _, error in
                guard error == nil else { return }
                Task { await self?.fetchSteps() }
            }
            healthStore.execute(query)
            observerQueries.append(query)
        }

        // Exercise minutes observer
        if let exerciseType = HKObjectType.quantityType(forIdentifier: .appleExerciseTime) {
            let query = HKObserverQuery(sampleType: exerciseType, predicate: nil) { [weak self] _, _, error in
                guard error == nil else { return }
                Task { await self?.fetchExerciseMinutes() }
            }
            healthStore.execute(query)
            observerQueries.append(query)
        }

        // Body mass observer
        if let weightType = HKObjectType.quantityType(forIdentifier: .bodyMass) {
            let query = HKObserverQuery(sampleType: weightType, predicate: nil) { [weak self] _, _, error in
                guard error == nil else { return }
                Task { await self?.fetchBodyComposition() }
            }
            healthStore.execute(query)
            observerQueries.append(query)
        }
    }

    /// Stop all observer queries
    func stopMonitoring() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries.removeAll()
    }

    // MARK: - Fetch Methods with 24-Hour History

    private func fetchHeartRateStats() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else {
            print("[HealthKit] Heart rate type not available")
            return
        }
        let unit = HKUnit(from: "count/min")

        let stats = await fetch24HourStats(type: type, unit: unit)
        print("[HealthKit] Heart rate: current=\(stats.current ?? -1), history count=\(stats.history.count)")
        await MainActor.run {
            self.heartRateStats = stats
            if stats.current != nil {
                self.watchConnected = true
                print("[HealthKit] watchConnected = true (heart rate data found)")
            }
        }
    }

    private func fetchHRVStats() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN) else { return }
        let unit = HKUnit.secondUnit(with: .milli)

        let stats = await fetch24HourStats(type: type, unit: unit)
        await MainActor.run {
            self.hrvStats = stats
        }
    }

    private func fetchSpO2Stats() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation) else { return }

        // SpO2 is stored as 0-1 fraction, we need to multiply by 100
        let stats = await fetch24HourStats(type: type, unit: .percent(), multiplier: 100)
        await MainActor.run {
            self.spo2Stats = stats
        }
    }

    private func fetchSteps() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return }

        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: Date(), options: .strictStartDate)

        let sum = await fetchSum(type: type, predicate: predicate, unit: .count())
        print("[HealthKit] Steps today: \(Int(sum))")
        await MainActor.run {
            self.steps = Int(sum)
        }
    }

    private func fetchExerciseMinutes() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) else { return }

        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: Date(), options: .strictStartDate)

        let sum = await fetchSum(type: type, predicate: predicate, unit: .minute())
        await MainActor.run {
            self.exerciseMinutes = Int(sum)
        }
    }

    private func fetchSleepData() async {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return }

        // Get sleep from the past night (6 PM yesterday to now)
        let calendar = Calendar.current
        let now = Date()
        var yesterday6PM = calendar.date(byAdding: .day, value: -1, to: now)!
        yesterday6PM = calendar.date(bySettingHour: 18, minute: 0, second: 0, of: yesterday6PM)!

        let predicate = HKQuery.predicateForSamples(withStart: yesterday6PM, end: now, options: .strictStartDate)

        let stages = await fetchSleepStages(type: sleepType, predicate: predicate)
        await MainActor.run {
            self.sleepStages = stages
        }
    }

    private func fetchBodyComposition() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchWeight() }
            group.addTask { await self.fetchBodyFat() }
            group.addTask { await self.fetchLeanBodyMass() }
            group.addTask { await self.fetchBMI() }
        }
    }

    private func fetchWeight() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .bodyMass) else { return }

        let sample = await fetchLatestSample(type: type)
        await MainActor.run {
            if let sample = sample {
                self.weight = sample.quantity.doubleValue(for: .pound())
                self.scaleConnected = true
            }
        }
    }

    private func fetchBodyFat() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage) else { return }

        let sample = await fetchLatestSample(type: type)
        await MainActor.run {
            if let sample = sample {
                self.bodyFatPercentage = sample.quantity.doubleValue(for: .percent()) * 100
            }
        }
    }

    private func fetchLeanBodyMass() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .leanBodyMass) else { return }

        let sample = await fetchLatestSample(type: type)
        await MainActor.run {
            if let sample = sample {
                self.leanBodyMass = sample.quantity.doubleValue(for: .pound())
            }
        }
    }

    private func fetchBMI() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .bodyMassIndex) else { return }

        let sample = await fetchLatestSample(type: type)
        await MainActor.run {
            if let sample = sample {
                self.bmi = sample.quantity.doubleValue(for: .count())
            }
        }
    }

    // MARK: - Helper Methods

    private func fetch24HourStats(type: HKQuantityType, unit: HKUnit, multiplier: Double = 1.0) async -> MetricStats {
        let now = Date()
        let twentyFourHoursAgo = Calendar.current.date(byAdding: .hour, value: -24, to: now)!
        let predicate = HKQuery.predicateForSamples(withStart: twentyFourHoursAgo, end: now, options: .strictStartDate)

        // Fetch all samples in the 24-hour window
        let samples = await fetchSamples(type: type, predicate: predicate)

        guard !samples.isEmpty else {
            return MetricStats.empty
        }

        // Convert to data points
        let dataPoints = samples.map { sample in
            HealthDataPoint(
                timestamp: sample.endDate,
                value: sample.quantity.doubleValue(for: unit) * multiplier
            )
        }.sorted { $0.timestamp < $1.timestamp }

        // Calculate stats
        let values = dataPoints.map { $0.value }
        let current = values.last
        let min = values.min()
        let max = values.max()

        return MetricStats(current: current, min: min, max: max, history: dataPoints)
    }

    private func fetchSamples(type: HKQuantityType, predicate: NSPredicate) async -> [HKQuantitySample] {
        await withCheckedContinuation { continuation in
            let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: true)
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: [sortDescriptor]
            ) { _, samples, _ in
                continuation.resume(returning: (samples as? [HKQuantitySample]) ?? [])
            }
            healthStore.execute(query)
        }
    }

    private func fetchLatestSample(type: HKQuantityType) async -> HKQuantitySample? {
        await withCheckedContinuation { continuation in
            let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
            let query = HKSampleQuery(
                sampleType: type,
                predicate: nil,
                limit: 1,
                sortDescriptors: [sortDescriptor]
            ) { _, samples, _ in
                continuation.resume(returning: samples?.first as? HKQuantitySample)
            }
            healthStore.execute(query)
        }
    }

    private func fetchSum(type: HKQuantityType, predicate: NSPredicate, unit: HKUnit) async -> Double {
        await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(
                quantityType: type,
                quantitySamplePredicate: predicate,
                options: .cumulativeSum
            ) { _, result, _ in
                let sum = result?.sumQuantity()?.doubleValue(for: unit) ?? 0
                continuation.resume(returning: sum)
            }
            healthStore.execute(query)
        }
    }

    private func fetchSleepStages(type: HKCategoryType, predicate: NSPredicate) async -> SleepStageData? {
        await withCheckedContinuation { continuation in
            let query = HKSampleQuery(
                sampleType: type,
                predicate: predicate,
                limit: HKObjectQueryNoLimit,
                sortDescriptors: nil
            ) { _, samples, _ in
                guard let categorySamples = samples as? [HKCategorySample], !categorySamples.isEmpty else {
                    continuation.resume(returning: nil)
                    return
                }

                var stages = SleepStageData()

                for sample in categorySamples {
                    let duration = sample.endDate.timeIntervalSince(sample.startDate)

                    switch sample.value {
                    case HKCategoryValueSleepAnalysis.awake.rawValue:
                        stages.awake += duration
                    case HKCategoryValueSleepAnalysis.asleepREM.rawValue:
                        stages.rem += duration
                    case HKCategoryValueSleepAnalysis.asleepCore.rawValue:
                        stages.core += duration
                    case HKCategoryValueSleepAnalysis.asleepDeep.rawValue:
                        stages.deep += duration
                    case HKCategoryValueSleepAnalysis.asleepUnspecified.rawValue:
                        // Count unspecified as core sleep
                        stages.core += duration
                    default:
                        break
                    }
                }

                continuation.resume(returning: stages.total > 0 ? stages : nil)
            }
            healthStore.execute(query)
        }
    }
}

enum HealthKitError: LocalizedError {
    case notAvailable
    case notAuthorized

    var errorDescription: String? {
        switch self {
        case .notAvailable:
            return "HealthKit is not available on this device"
        case .notAuthorized:
            return "HealthKit access not authorized"
        }
    }
}
