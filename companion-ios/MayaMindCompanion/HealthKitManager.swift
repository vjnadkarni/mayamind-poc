import Foundation
import HealthKit
import Combine

/// Reads health data from Apple Watch via HealthKit and pushes to MayaMind server.
class HealthKitManager: ObservableObject {
    let healthStore = HKHealthStore()

    @Published var isAuthorized = false
    var serverConnection: ServerConnection?

    private var observerQueries: [HKObserverQuery] = []
    private var pushTimer: Timer?

    // HealthKit types to read
    private let quantityTypes: [HKQuantityTypeIdentifier] = [
        .heartRate,
        .heartRateVariabilitySDNN,
        .oxygenSaturation,
        .stepCount,
        .appleMoveTime,
        .appleExerciseTime,
    ]

    private let categoryTypes: [HKCategoryTypeIdentifier] = [
        .sleepAnalysis,
    ]

    private var allReadTypes: Set<HKObjectType> {
        var types = Set<HKObjectType>()
        for id in quantityTypes {
            if let t = HKObjectType.quantityType(forIdentifier: id) { types.insert(t) }
        }
        for id in categoryTypes {
            if let t = HKObjectType.categoryType(forIdentifier: id) { types.insert(t) }
        }
        return types
    }

    // MARK: - Authorization

    func requestAuthorization() async throws {
        guard HKHealthStore.isHealthDataAvailable() else {
            print("[HealthKit] Health data not available on this device")
            return
        }

        try await healthStore.requestAuthorization(toShare: [], read: allReadTypes)

        await MainActor.run {
            self.isAuthorized = true
            print("[HealthKit] Authorization granted")
        }
    }

    // MARK: - Observing

    func startObserving() {
        guard isAuthorized else { return }

        // Stop any existing observers
        stopObserving()

        // Set up observer queries for real-time updates
        for id in quantityTypes {
            guard let sampleType = HKObjectType.quantityType(forIdentifier: id) else { continue }
            let query = HKObserverQuery(sampleType: sampleType, predicate: nil) { [weak self] _, completionHandler, error in
                if let error = error {
                    print("[HealthKit] Observer error for \(id.rawValue): \(error.localizedDescription)")
                    completionHandler()
                    return
                }
                // New data available — trigger a push
                Task { [weak self] in
                    await self?.pushVitals()
                }
                completionHandler()
            }
            healthStore.execute(query)
            observerQueries.append(query)
        }

        // Timer fallback: push every 60 seconds regardless of observer triggers
        pushTimer = Timer.scheduledTimer(withTimeInterval: 60, repeats: true) { [weak self] _ in
            Task { [weak self] in
                await self?.pushVitals()
            }
        }

        // Initial push
        Task {
            await pushVitals()
        }

        print("[HealthKit] Started observing \(quantityTypes.count) metric types")
    }

    func stopObserving() {
        for query in observerQueries {
            healthStore.stop(query)
        }
        observerQueries.removeAll()
        pushTimer?.invalidate()
        pushTimer = nil
    }

    // MARK: - Fetch & Push

    func pushVitals() async {
        guard let server = serverConnection else { return }

        let vitals = await fetchLatestVitals()
        let sleep = await fetchLastNightSleep()

        let payload = VitalsPayload(
            timestamp: ISO8601DateFormatter().string(from: Date()),
            deviceName: UIDevice.current.name,
            vitals: vitals,
            sleep: sleep
        )

        await server.push(payload)
    }

    func fetchLatestVitals() async -> [String: VitalReading] {
        var readings: [String: VitalReading] = [:]

        // Heart Rate — latest sample + 24h range
        let hrUnit = HKUnit.count().unitDivided(by: .minute())
        if let hr = await fetchLatestQuantity(.heartRate, unit: hrUnit) {
            let range = await fetchMinMaxQuantity(.heartRate, unit: hrUnit)
            readings["heartRate"] = VitalReading(value: hr.value, unit: "BPM", timestamp: hr.timestamp, range24h: range)
        }

        // HRV — latest sample + 24h range
        let hrvUnit = HKUnit.secondUnit(with: .milli)
        if let hrv = await fetchLatestQuantity(.heartRateVariabilitySDNN, unit: hrvUnit) {
            let range = await fetchMinMaxQuantity(.heartRateVariabilitySDNN, unit: hrvUnit)
            readings["hrv"] = VitalReading(value: hrv.value, unit: "ms", timestamp: hrv.timestamp, range24h: range)
        }

        // SpO2 — latest sample + 24h range
        if let spo2 = await fetchLatestQuantity(.oxygenSaturation, unit: HKUnit.percent()) {
            let range = await fetchMinMaxQuantity(.oxygenSaturation, unit: HKUnit.percent())
            // SpO2 values are 0–1 from HealthKit, convert to percentage
            var spo2Range: Range24h? = nil
            if let r = range {
                spo2Range = Range24h(min: r.min * 100, max: r.max * 100)
            }
            readings["spo2"] = VitalReading(value: spo2.value * 100, unit: "%", timestamp: spo2.timestamp, range24h: spo2Range)
        }

        // Steps — cumulative since midnight
        let midnight = Calendar.current.startOfDay(for: Date())
        let midnightStr = ISO8601DateFormatter().string(from: midnight)

        if let steps = await fetchCumulativeQuantity(.stepCount, unit: HKUnit.count(), since: midnight) {
            readings["steps"] = VitalReading(value: steps, unit: "count", timestamp: nil, sinceDate: midnightStr)
        }

        // Move time — cumulative since midnight
        if let move = await fetchCumulativeQuantity(.appleMoveTime, unit: HKUnit.minute(), since: midnight) {
            readings["moveMinutes"] = VitalReading(value: move, unit: "min", timestamp: nil, sinceDate: midnightStr)
        }

        // Exercise time — cumulative since midnight
        if let exercise = await fetchCumulativeQuantity(.appleExerciseTime, unit: HKUnit.minute(), since: midnight) {
            readings["exerciseMinutes"] = VitalReading(value: exercise, unit: "min", timestamp: nil, sinceDate: midnightStr)
        }

        return readings
    }

    // MARK: - Query Helpers

    private func fetchLatestQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit) async -> (value: Double, timestamp: String)? {
        guard let sampleType = HKQuantityType.quantityType(forIdentifier: identifier) else { return nil }

        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)
        let predicate = HKQuery.predicateForSamples(withStart: Calendar.current.date(byAdding: .hour, value: -1, to: Date()), end: Date())

        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(sampleType: sampleType, predicate: predicate, limit: 1, sortDescriptors: [sortDescriptor]) { _, samples, error in
                guard let sample = samples?.first as? HKQuantitySample, error == nil else {
                    continuation.resume(returning: nil)
                    return
                }
                let value = sample.quantity.doubleValue(for: unit)
                let timestamp = ISO8601DateFormatter().string(from: sample.endDate)
                continuation.resume(returning: (value, timestamp))
            }
            healthStore.execute(query)
        }
    }

    private func fetchCumulativeQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit, since startDate: Date) async -> Double? {
        guard let sampleType = HKQuantityType.quantityType(forIdentifier: identifier) else { return nil }

        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: Date())

        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: sampleType, quantitySamplePredicate: predicate, options: .cumulativeSum) { _, result, error in
                guard let sum = result?.sumQuantity(), error == nil else {
                    continuation.resume(returning: nil)
                    return
                }
                continuation.resume(returning: sum.doubleValue(for: unit))
            }
            healthStore.execute(query)
        }
    }

    private func fetchMinMaxQuantity(_ identifier: HKQuantityTypeIdentifier, unit: HKUnit) async -> Range24h? {
        guard let sampleType = HKQuantityType.quantityType(forIdentifier: identifier) else { return nil }

        let startDate = Calendar.current.date(byAdding: .hour, value: -24, to: Date())!
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: Date())

        return await withCheckedContinuation { continuation in
            let query = HKStatisticsQuery(quantityType: sampleType, quantitySamplePredicate: predicate, options: [.discreteMin, .discreteMax]) { _, result, error in
                guard let result = result, error == nil,
                      let minQty = result.minimumQuantity(),
                      let maxQty = result.maximumQuantity() else {
                    continuation.resume(returning: nil)
                    return
                }
                let minVal = minQty.doubleValue(for: unit)
                let maxVal = maxQty.doubleValue(for: unit)
                continuation.resume(returning: Range24h(min: minVal, max: maxVal))
            }
            healthStore.execute(query)
        }
    }

    // MARK: - Sleep

    func fetchLastNightSleep() async -> SleepData? {
        guard let sleepType = HKObjectType.categoryType(forIdentifier: .sleepAnalysis) else { return nil }

        // Look at the last 24 hours for sleep data
        let endDate = Date()
        let startDate = Calendar.current.date(byAdding: .hour, value: -24, to: endDate)!
        let predicate = HKQuery.predicateForSamples(withStart: startDate, end: endDate)
        let sortDescriptor = NSSortDescriptor(key: HKSampleSortIdentifierEndDate, ascending: false)

        return await withCheckedContinuation { continuation in
            let query = HKSampleQuery(sampleType: sleepType, predicate: predicate, limit: HKObjectQueryNoLimit, sortDescriptors: [sortDescriptor]) { _, samples, error in
                guard let samples = samples as? [HKCategorySample], !samples.isEmpty, error == nil else {
                    continuation.resume(returning: nil)
                    return
                }

                var deep = 0.0, core = 0.0, rem = 0.0, awake = 0.0
                var earliestStart: Date?
                var latestEnd: Date?

                for sample in samples {
                    let hours = sample.endDate.timeIntervalSince(sample.startDate) / 3600.0

                    if earliestStart == nil || sample.startDate < earliestStart! { earliestStart = sample.startDate }
                    if latestEnd == nil || sample.endDate > latestEnd! { latestEnd = sample.endDate }

                    switch sample.value {
                    case HKCategoryValueSleepAnalysis.asleepDeep.rawValue:
                        deep += hours
                    case HKCategoryValueSleepAnalysis.asleepCore.rawValue:
                        core += hours
                    case HKCategoryValueSleepAnalysis.asleepREM.rawValue:
                        rem += hours
                    case HKCategoryValueSleepAnalysis.awake.rawValue:
                        awake += hours
                    default:
                        core += hours  // Fallback for older "asleep" category
                    }
                }

                let total = deep + core + rem + awake
                guard total > 0.5 else {  // At least 30 min to count as sleep
                    continuation.resume(returning: nil)
                    return
                }

                let formatter = ISO8601DateFormatter()
                continuation.resume(returning: SleepData(
                    totalHours: total,
                    stages: SleepStages(deep: deep, core: core, rem: rem, awake: awake),
                    startTime: earliestStart.map { formatter.string(from: $0) },
                    endTime: latestEnd.map { formatter.string(from: $0) }
                ))
            }
            healthStore.execute(query)
        }
    }

    deinit {
        stopObserving()
    }
}

// MARK: - Data Models

struct VitalsPayload: Codable {
    let timestamp: String
    let deviceName: String
    let vitals: [String: VitalReading]
    let sleep: SleepData?
}

struct VitalReading: Codable {
    let value: Double
    let unit: String
    let timestamp: String?
    var sinceDate: String?
    var range24h: Range24h?
}

struct Range24h: Codable {
    let min: Double
    let max: Double
}

struct SleepData: Codable {
    let totalHours: Double
    let stages: SleepStages
    let startTime: String?
    let endTime: String?
}

struct SleepStages: Codable {
    let deep: Double
    let core: Double
    let rem: Double
    let awake: Double
}
