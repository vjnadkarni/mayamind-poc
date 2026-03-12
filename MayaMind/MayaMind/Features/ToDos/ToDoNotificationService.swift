//
//  ToDoNotificationService.swift
//  MayaMind
//
//  iOS Local Notifications for To Do reminders
//

import Foundation
import UserNotifications

class ToDoNotificationService {
    static let shared = ToDoNotificationService()

    private let notificationCenter = UNUserNotificationCenter.current()

    private init() {}

    // MARK: - Authorization

    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        notificationCenter.requestAuthorization(options: [.alert, .sound, .badge]) { granted, error in
            if let error = error {
                print("[Notifications] Authorization error: \(error)")
            }
            DispatchQueue.main.async {
                completion(granted)
            }
        }
    }

    func checkAuthorizationStatus(completion: @escaping (UNAuthorizationStatus) -> Void) {
        notificationCenter.getNotificationSettings { settings in
            DispatchQueue.main.async {
                completion(settings.authorizationStatus)
            }
        }
    }

    // MARK: - Schedule Notifications

    /// Schedule all notifications for a to-do item
    func scheduleNotifications(for item: ToDoItem) -> [String] {
        var notificationIds: [String] = []

        // Cancel any existing notifications for this item
        cancelNotifications(for: item)

        // Check if notifications are enabled in settings
        guard NotificationSettings.shared.notificationsEnabled else { return [] }

        // Don't schedule for completed items
        guard !item.isCompleted else { return [] }

        let reminderMinutes = item.category.reminderMinutesBefore

        // For tasks, we don't schedule individual reminders (handled by end-of-day check)
        guard item.category != .task else { return [] }

        // Calculate reminder time
        let reminderDate = Calendar.current.date(
            byAdding: .minute,
            value: -reminderMinutes,
            to: item.nextOccurrence
        ) ?? item.nextOccurrence

        // Only schedule if reminder time is in the future
        guard reminderDate > Date() else { return [] }

        // Create notification content
        let content = UNMutableNotificationContent()

        // Set sound based on settings
        if NotificationSettings.shared.soundEnabled {
            content.sound = .default
        }

        switch item.category {
        case .medication:
            content.title = "Medication Reminder"
            content.body = "Time to take your \(item.title)"
        case .appointment:
            content.title = "Upcoming Appointment"
            content.body = "\(item.title) in 1 hour"
        case .task:
            return [] // Tasks handled separately
        }

        // Create trigger
        let triggerDate = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute],
            from: reminderDate
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: triggerDate, repeats: false)

        // Create request
        let notificationId = "todo_\(item.id.uuidString)_\(Int(reminderDate.timeIntervalSince1970))"
        let request = UNNotificationRequest(
            identifier: notificationId,
            content: content,
            trigger: trigger
        )

        notificationCenter.add(request) { error in
            if let error = error {
                print("[Notifications] Failed to schedule: \(error)")
            } else {
                print("[Notifications] Scheduled reminder for \(item.title) at \(reminderDate)")
            }
        }

        notificationIds.append(notificationId)

        // If recurring, schedule next few occurrences (up to 7 days ahead)
        if item.recurrence.pattern != .none {
            let additionalIds = scheduleRecurringNotifications(for: item, afterDate: item.nextOccurrence)
            notificationIds.append(contentsOf: additionalIds)
        }

        return notificationIds
    }

    /// Schedule recurring notifications for the next 7 days
    private func scheduleRecurringNotifications(for item: ToDoItem, afterDate: Date) -> [String] {
        var notificationIds: [String] = []
        let calendar = Calendar.current
        let maxDate = calendar.date(byAdding: .day, value: 7, to: Date()) ?? Date()

        var currentDate = afterDate

        // Schedule up to 7 more occurrences
        for _ in 0..<7 {
            // Calculate next occurrence
            switch item.recurrence.pattern {
            case .none:
                return notificationIds
            case .daily:
                currentDate = calendar.date(byAdding: .day, value: 1, to: currentDate) ?? currentDate
            case .weekly:
                currentDate = calendar.date(byAdding: .weekOfYear, value: 1, to: currentDate) ?? currentDate
            case .biweekly:
                currentDate = calendar.date(byAdding: .weekOfYear, value: 2, to: currentDate) ?? currentDate
            case .monthly:
                currentDate = calendar.date(byAdding: .month, value: 1, to: currentDate) ?? currentDate
            }

            // Check if we've exceeded max date or recurrence end date
            if currentDate > maxDate {
                break
            }
            if let endDate = item.recurrence.endDate, currentDate > endDate {
                break
            }

            // Calculate reminder time
            let reminderMinutes = item.category.reminderMinutesBefore
            let reminderDate = calendar.date(byAdding: .minute, value: -reminderMinutes, to: currentDate) ?? currentDate

            guard reminderDate > Date() else { continue }

            // Create notification
            let content = UNMutableNotificationContent()

            // Set sound based on settings
            if NotificationSettings.shared.soundEnabled {
                content.sound = .default
            }

            switch item.category {
            case .medication:
                content.title = "Medication Reminder"
                content.body = "Time to take your \(item.title)"
            case .appointment:
                content.title = "Upcoming Appointment"
                content.body = "\(item.title) in 1 hour"
            case .task:
                continue
            }

            let triggerDate = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: reminderDate)
            let trigger = UNCalendarNotificationTrigger(dateMatching: triggerDate, repeats: false)

            let notificationId = "todo_\(item.id.uuidString)_\(Int(reminderDate.timeIntervalSince1970))"
            let request = UNNotificationRequest(identifier: notificationId, content: content, trigger: trigger)

            notificationCenter.add(request) { error in
                if let error = error {
                    print("[Notifications] Failed to schedule recurring: \(error)")
                }
            }

            notificationIds.append(notificationId)
        }

        return notificationIds
    }

    /// Schedule end-of-day check notification (8 PM)
    func scheduleEndOfDayCheck() {
        let notificationId = "todo_end_of_day"

        // Cancel existing
        notificationCenter.removePendingNotificationRequests(withIdentifiers: [notificationId])

        // Check if notifications are enabled in settings
        guard NotificationSettings.shared.notificationsEnabled else { return }

        // Schedule for 8 PM today (or tomorrow if past 8 PM)
        var dateComponents = DateComponents()
        dateComponents.hour = 20
        dateComponents.minute = 0

        let content = UNMutableNotificationContent()
        content.title = "Daily Check-in"
        content.body = "Let's review your day together"

        // Set sound based on settings
        if NotificationSettings.shared.soundEnabled {
            content.sound = .default
        }

        let trigger = UNCalendarNotificationTrigger(dateMatching: dateComponents, repeats: true)

        let request = UNNotificationRequest(identifier: notificationId, content: content, trigger: trigger)

        notificationCenter.add(request) { error in
            if let error = error {
                print("[Notifications] Failed to schedule end-of-day: \(error)")
            } else {
                print("[Notifications] Scheduled daily 8 PM check-in")
            }
        }
    }

    // MARK: - Cancel Notifications

    func cancelNotifications(for item: ToDoItem) {
        // Cancel by stored notification IDs
        if !item.notificationIds.isEmpty {
            notificationCenter.removePendingNotificationRequests(withIdentifiers: item.notificationIds)
        }

        // Also cancel by item ID prefix (in case IDs weren't stored)
        notificationCenter.getPendingNotificationRequests { requests in
            let idsToRemove = requests
                .filter { $0.identifier.starts(with: "todo_\(item.id.uuidString)") }
                .map { $0.identifier }

            if !idsToRemove.isEmpty {
                self.notificationCenter.removePendingNotificationRequests(withIdentifiers: idsToRemove)
                print("[Notifications] Cancelled \(idsToRemove.count) notifications for \(item.title)")
            }
        }
    }

    func cancelAllNotifications() {
        notificationCenter.removeAllPendingNotificationRequests()
        print("[Notifications] Cancelled all pending notifications")
    }

    // MARK: - Refresh All

    /// Refresh all notifications (call after items change)
    func refreshAllNotifications(items: [ToDoItem]) {
        // Cancel all todo notifications
        notificationCenter.getPendingNotificationRequests { requests in
            let todoIds = requests
                .filter { $0.identifier.starts(with: "todo_") }
                .map { $0.identifier }

            self.notificationCenter.removePendingNotificationRequests(withIdentifiers: todoIds)

            // Re-schedule all active items
            DispatchQueue.main.async {
                for item in items where !item.isCompleted {
                    _ = self.scheduleNotifications(for: item)
                }

                // Ensure end-of-day check is scheduled
                self.scheduleEndOfDayCheck()
            }
        }
    }
}
