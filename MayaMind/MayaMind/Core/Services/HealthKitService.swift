//
//  HealthKitService.swift
//  MayaMind
//
//  HealthKit integration for Apple Watch + Smart Scale data
//

import Foundation
import HealthKit
import Combine

class HealthKitService: ObservableObject {
    private let healthStore = HKHealthStore()

    // Published health data
    @Published var heartRate: Double?
    @Published var hrv: Double?
    @Published var spo2: Double?
    @Published var steps: Int?
    @Published var exerciseMinutes: Int?
    @Published var sleepHours: Double?
    @Published var weight: Double?
    @Published var bodyFatPercentage: Double?

    // Connection status
    @Published var isAuthorized = false

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

        return types
    }

    /// Check if HealthKit is available on this device
    var isAvailable: Bool {
        HKHealthStore.isHealthDataAvailable()
    }

    /// Request authorization to read health data
    func requestAuthorization() async throws {
        guard isAvailable else {
            throw HealthKitError.notAvailable
        }

        try await healthStore.requestAuthorization(toShare: [], read: readTypes)
        isAuthorized = true
    }

    /// Fetch latest vitals
    func fetchLatestVitals() async {
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.fetchHeartRate() }
            group.addTask { await self.fetchHRV() }
            group.addTask { await self.fetchSpO2() }
            group.addTask { await self.fetchSteps() }
            group.addTask { await self.fetchExerciseMinutes() }
            group.addTask { await self.fetchWeight() }
            group.addTask { await self.fetchBodyFat() }
        }
    }

    /// Start real-time monitoring with observer queries
    func startMonitoring() {
        // Heart rate observer
        if let heartRateType = HKObjectType.quantityType(forIdentifier: .heartRate) {
            let query = HKObserverQuery(sampleType: heartRateType, predicate: nil) { [weak self] _, _, error in
                guard error == nil else { return }
                Task { await self?.fetchHeartRate() }
            }
            healthStore.execute(query)
        }

        // Steps observer
        if let stepsType = HKObjectType.quantityType(forIdentifier: .stepCount) {
            let query = HKObserverQuery(sampleType: stepsType, predicate: nil) { [weak self] _, _, error in
                guard error == nil else { return }
                Task { await self?.fetchSteps() }
            }
            healthStore.execute(query)
        }
    }

    // MARK: - Private Fetch Methods

    private func fetchHeartRate() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRate) else { return }

        let sample = await fetchLatestSample(type: type)
        if let sample = sample {
            let value = sample.quantity.doubleValue(for: HKUnit(from: "count/min"))
            heartRate = value
        }
    }

    private func fetchHRV() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN) else { return }

        let sample = await fetchLatestSample(type: type)
        if let sample = sample {
            let value = sample.quantity.doubleValue(for: .secondUnit(with: .milli))
            hrv = value
        }
    }

    private func fetchSpO2() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .oxygenSaturation) else { return }

        let sample = await fetchLatestSample(type: type)
        if let sample = sample {
            let value = sample.quantity.doubleValue(for: .percent()) * 100
            spo2 = value
        }
    }

    private func fetchSteps() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .stepCount) else { return }

        // Sum steps since midnight
        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: Date(), options: .strictStartDate)

        let sum = await fetchSum(type: type, predicate: predicate, unit: .count())
        steps = Int(sum)
    }

    private func fetchExerciseMinutes() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .appleExerciseTime) else { return }

        let calendar = Calendar.current
        let startOfDay = calendar.startOfDay(for: Date())
        let predicate = HKQuery.predicateForSamples(withStart: startOfDay, end: Date(), options: .strictStartDate)

        let sum = await fetchSum(type: type, predicate: predicate, unit: .minute())
        exerciseMinutes = Int(sum)
    }

    private func fetchWeight() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .bodyMass) else { return }

        let sample = await fetchLatestSample(type: type)
        if let sample = sample {
            let value = sample.quantity.doubleValue(for: .pound())
            weight = value
        }
    }

    private func fetchBodyFat() async {
        guard let type = HKQuantityType.quantityType(forIdentifier: .bodyFatPercentage) else { return }

        let sample = await fetchLatestSample(type: type)
        if let sample = sample {
            let value = sample.quantity.doubleValue(for: .percent()) * 100
            bodyFatPercentage = value
        }
    }

    // MARK: - Helper Methods

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
