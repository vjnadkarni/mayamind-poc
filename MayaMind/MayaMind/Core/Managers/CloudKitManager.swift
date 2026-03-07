//
//  CloudKitManager.swift
//  MayaMind
//
//  iCloud sync for preferences and exercise history
//

import Foundation
import CloudKit
import Combine

class CloudKitManager: ObservableObject {
    private let container: CKContainer
    private let privateDatabase: CKDatabase

    @Published var isSyncEnabled = false
    @Published var lastSyncDate: Date?
    @Published var syncError: Error?

    // Record types
    private let preferencesRecordType = "Preferences"
    private let exerciseHistoryRecordType = "ExerciseHistory"
    private let contactsRecordType = "Contacts"

    init() {
        container = CKContainer(identifier: "iCloud.ai.mayamind.app")
        privateDatabase = container.privateCloudDatabase
    }

    /// Check iCloud account status
    func checkAccountStatus() async -> CKAccountStatus {
        await withCheckedContinuation { continuation in
            container.accountStatus { status, _ in
                continuation.resume(returning: status)
            }
        }
    }

    /// Request iCloud permission if needed
    func requestPermission() async throws -> Bool {
        let status = await checkAccountStatus()

        switch status {
        case .available:
            return true
        case .noAccount:
            throw CloudKitError.noAccount
        case .restricted:
            throw CloudKitError.restricted
        case .couldNotDetermine:
            throw CloudKitError.unknown
        case .temporarilyUnavailable:
            throw CloudKitError.temporarilyUnavailable
        @unknown default:
            throw CloudKitError.unknown
        }
    }

    // MARK: - Preferences Sync

    /// Save preferences to iCloud
    func savePreferences(_ preferences: UserPreferences) async throws {
        let recordID = CKRecord.ID(recordName: "user_preferences")
        let record = CKRecord(recordType: preferencesRecordType, recordID: recordID)

        record["name"] = preferences.name
        record["streetAddress"] = preferences.streetAddress
        record["city"] = preferences.city
        record["state"] = preferences.state
        record["zipCode"] = preferences.zipCode
        record["allowLearning"] = preferences.allowLearning
        record["familySharingEnabled"] = preferences.familySharingEnabled

        try await privateDatabase.save(record)

        await MainActor.run {
            self.lastSyncDate = Date()
        }
    }

    /// Fetch preferences from iCloud
    func fetchPreferences() async throws -> UserPreferences? {
        let recordID = CKRecord.ID(recordName: "user_preferences")

        do {
            let record = try await privateDatabase.record(for: recordID)

            return UserPreferences(
                name: record["name"] as? String ?? "",
                streetAddress: record["streetAddress"] as? String ?? "",
                city: record["city"] as? String ?? "",
                state: record["state"] as? String ?? "",
                zipCode: record["zipCode"] as? String ?? "",
                allowLearning: record["allowLearning"] as? Bool ?? true,
                familySharingEnabled: record["familySharingEnabled"] as? Bool ?? false
            )
        } catch let error as CKError where error.code == .unknownItem {
            // No preferences saved yet
            return nil
        }
    }

    // MARK: - Exercise History

    /// Save exercise session to iCloud
    func saveExerciseSession(_ session: ExerciseSession) async throws {
        let record = CKRecord(recordType: exerciseHistoryRecordType)

        record["exerciseType"] = session.exerciseType
        record["repCount"] = session.repCount
        record["duration"] = session.duration
        record["quality"] = session.quality
        record["date"] = session.date

        try await privateDatabase.save(record)
    }

    /// Fetch exercise history from iCloud
    func fetchExerciseHistory(limit: Int = 50) async throws -> [ExerciseSession] {
        let query = CKQuery(recordType: exerciseHistoryRecordType, predicate: NSPredicate(value: true))
        query.sortDescriptors = [NSSortDescriptor(key: "date", ascending: false)]

        let (results, _) = try await privateDatabase.records(matching: query, resultsLimit: limit)

        return results.compactMap { _, result in
            guard case .success(let record) = result else { return nil }

            return ExerciseSession(
                exerciseType: record["exerciseType"] as? String ?? "",
                repCount: record["repCount"] as? Int ?? 0,
                duration: record["duration"] as? Int ?? 0,
                quality: record["quality"] as? String ?? "",
                date: record["date"] as? Date ?? Date()
            )
        }
    }

    // MARK: - Contacts Sync

    /// Save contact to iCloud
    func saveContact(_ contact: SyncableContact) async throws {
        let recordID = CKRecord.ID(recordName: "contact_\(contact.phone)")
        let record = CKRecord(recordType: contactsRecordType, recordID: recordID)

        record["name"] = contact.name
        record["phone"] = contact.phone

        try await privateDatabase.save(record)
    }

    /// Fetch contacts from iCloud
    func fetchContacts() async throws -> [SyncableContact] {
        let query = CKQuery(recordType: contactsRecordType, predicate: NSPredicate(value: true))

        let (results, _) = try await privateDatabase.records(matching: query)

        return results.compactMap { _, result in
            guard case .success(let record) = result else { return nil }

            return SyncableContact(
                name: record["name"] as? String ?? "",
                phone: record["phone"] as? String ?? ""
            )
        }
    }

    // MARK: - Subscriptions

    /// Set up push notifications for remote changes
    func setupSubscriptions() async throws {
        let subscription = CKDatabaseSubscription(subscriptionID: "all-changes")

        let notificationInfo = CKSubscription.NotificationInfo()
        notificationInfo.shouldSendContentAvailable = true

        subscription.notificationInfo = notificationInfo

        try await privateDatabase.save(subscription)
    }
}

// MARK: - Data Models

struct UserPreferences: Codable {
    var name: String
    var streetAddress: String
    var city: String
    var state: String
    var zipCode: String
    var allowLearning: Bool
    var familySharingEnabled: Bool
}

struct ExerciseSession: Codable, Identifiable {
    let id = UUID()
    let exerciseType: String
    let repCount: Int
    let duration: Int // seconds
    let quality: String
    let date: Date
}

struct SyncableContact: Codable, Identifiable {
    var id: String { phone }
    let name: String
    let phone: String
}

enum CloudKitError: LocalizedError {
    case noAccount
    case restricted
    case temporarilyUnavailable
    case unknown

    var errorDescription: String? {
        switch self {
        case .noAccount:
            return "No iCloud account found. Please sign in to iCloud in Settings."
        case .restricted:
            return "iCloud access is restricted on this device."
        case .temporarilyUnavailable:
            return "iCloud is temporarily unavailable. Please try again later."
        case .unknown:
            return "Unable to access iCloud."
        }
    }
}
