//
//  ToDoModels.swift
//  MayaMind
//
//  Data models for To Dos: Medications, Appointments, Tasks
//

import Foundation

// MARK: - Category

enum ToDoCategory: String, Codable, CaseIterable {
    case medication = "medication"
    case appointment = "appointment"
    case task = "task"

    var displayName: String {
        switch self {
        case .medication: return "Medications"
        case .appointment: return "Appointments"
        case .task: return "Tasks"
        }
    }

    var icon: String {
        switch self {
        case .medication: return "pill.fill"
        case .appointment: return "calendar"
        case .task: return "checklist"
        }
    }

    var color: String {
        switch self {
        case .medication: return "4A90D9"  // Blue
        case .appointment: return "9B59B6" // Purple
        case .task: return "27AE60"        // Green
        }
    }
}

// MARK: - Recurrence

enum RecurrencePattern: String, Codable, CaseIterable {
    case none = "none"
    case daily = "daily"
    case weekly = "weekly"
    case biweekly = "biweekly"
    case monthly = "monthly"

    var displayName: String {
        switch self {
        case .none: return "Does not repeat"
        case .daily: return "Daily"
        case .weekly: return "Weekly"
        case .biweekly: return "Every 2 weeks"
        case .monthly: return "Monthly"
        }
    }
}

struct Recurrence: Codable, Equatable {
    var pattern: RecurrencePattern
    var endDate: Date?

    static let none = Recurrence(pattern: .none, endDate: nil)
}

// MARK: - To Do Item

struct ToDoItem: Identifiable, Codable, Equatable {
    let id: UUID
    var title: String
    var category: ToDoCategory

    // Scheduling
    var scheduledDate: Date
    var startTime: Date
    var endTime: Date?  // Optional for medications/tasks, used for appointments
    var recurrence: Recurrence

    // Completion
    var isCompleted: Bool
    var completedAt: Date?

    // Metadata
    let createdAt: Date
    var notes: String?

    // For notifications
    var notificationIds: [String]

    init(
        id: UUID = UUID(),
        title: String,
        category: ToDoCategory,
        scheduledDate: Date = Date(),
        startTime: Date,
        endTime: Date? = nil,
        recurrence: Recurrence = .none,
        isCompleted: Bool = false,
        completedAt: Date? = nil,
        notes: String? = nil,
        notificationIds: [String] = []
    ) {
        self.id = id
        self.title = title
        self.category = category
        self.scheduledDate = scheduledDate
        self.startTime = startTime
        self.endTime = endTime
        self.recurrence = recurrence
        self.isCompleted = isCompleted
        self.completedAt = completedAt
        self.createdAt = Date()
        self.notes = notes
        self.notificationIds = notificationIds
    }

    // Computed: next occurrence date/time
    var nextOccurrence: Date {
        let calendar = Calendar.current
        let now = Date()

        // Combine scheduledDate with startTime
        let timeComponents = calendar.dateComponents([.hour, .minute], from: startTime)
        var dateComponents = calendar.dateComponents([.year, .month, .day], from: scheduledDate)
        dateComponents.hour = timeComponents.hour
        dateComponents.minute = timeComponents.minute

        guard let baseDate = calendar.date(from: dateComponents) else {
            return scheduledDate
        }

        // If no recurrence or base date is in future, return it
        if recurrence.pattern == .none || baseDate > now {
            return baseDate
        }

        // Check if recurrence has ended
        if let endDate = recurrence.endDate, now > endDate {
            return baseDate
        }

        // Calculate next occurrence based on pattern
        var nextDate = baseDate
        while nextDate <= now {
            switch recurrence.pattern {
            case .none:
                return baseDate
            case .daily:
                nextDate = calendar.date(byAdding: .day, value: 1, to: nextDate) ?? nextDate
            case .weekly:
                nextDate = calendar.date(byAdding: .weekOfYear, value: 1, to: nextDate) ?? nextDate
            case .biweekly:
                nextDate = calendar.date(byAdding: .weekOfYear, value: 2, to: nextDate) ?? nextDate
            case .monthly:
                nextDate = calendar.date(byAdding: .month, value: 1, to: nextDate) ?? nextDate
            }

            // Check if we've passed the end date
            if let endDate = recurrence.endDate, nextDate > endDate {
                return baseDate
            }
        }

        return nextDate
    }

    // Check if this item is due today
    var isDueToday: Bool {
        Calendar.current.isDateInToday(nextOccurrence)
    }

    // Formatted time string
    var timeString: String {
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return formatter.string(from: startTime)
    }

    // Formatted date string
    var dateString: String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        return formatter.string(from: scheduledDate)
    }

    // For appointments: duration string
    var durationString: String? {
        guard let end = endTime else { return nil }
        let formatter = DateFormatter()
        formatter.timeStyle = .short
        return "\(formatter.string(from: startTime)) - \(formatter.string(from: end))"
    }
}

// MARK: - Reminder Timing

extension ToDoCategory {
    /// How many minutes before the scheduled time to send reminder
    var reminderMinutesBefore: Int {
        switch self {
        case .medication: return 5      // 5 minutes before
        case .appointment: return 60    // 1 hour before
        case .task: return 0            // No advance reminder (asked at 8pm)
        }
    }
}
