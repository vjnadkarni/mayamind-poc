//
//  ToDoStore.swift
//  MayaMind
//
//  Persistence layer for To Do items using UserDefaults
//

import Foundation
import Combine

class ToDoStore: ObservableObject {
    static let shared = ToDoStore()

    @Published private(set) var items: [ToDoItem] = []

    private let storageKey = "mayamind_todos"
    private let completedRetentionDays = 2

    private init() {
        loadItems()
        cleanupOldCompletedItems()
    }

    // MARK: - CRUD Operations

    func addItem(_ item: ToDoItem) {
        items.append(item)
        saveItems()
    }

    func updateItem(_ item: ToDoItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            items[index] = item
            saveItems()
        }
    }

    func deleteItem(_ item: ToDoItem) {
        items.removeAll { $0.id == item.id }
        saveItems()
    }

    func deleteItem(id: UUID) {
        items.removeAll { $0.id == id }
        saveItems()
    }

    func markCompleted(_ item: ToDoItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            var updated = items[index]
            updated.isCompleted = true
            updated.completedAt = Date()
            items[index] = updated
            saveItems()
        }
    }

    func markIncomplete(_ item: ToDoItem) {
        if let index = items.firstIndex(where: { $0.id == item.id }) {
            var updated = items[index]
            updated.isCompleted = false
            updated.completedAt = nil
            items[index] = updated
            saveItems()
        }
    }

    // MARK: - Queries

    /// Get items for a specific category that are not completed
    func items(for category: ToDoCategory) -> [ToDoItem] {
        items.filter { $0.category == category && !$0.isCompleted }
            .sorted { $0.nextOccurrence < $1.nextOccurrence }
    }

    /// Get items due today for a category
    func itemsDueToday(for category: ToDoCategory) -> [ToDoItem] {
        items(for: category).filter { $0.isDueToday }
    }

    /// Get all items due today (any category)
    func allItemsDueToday() -> [ToDoItem] {
        items.filter { !$0.isCompleted && $0.isDueToday }
            .sorted { $0.nextOccurrence < $1.nextOccurrence }
    }

    /// Get completed items (within retention period)
    func completedItems() -> [ToDoItem] {
        items.filter { $0.isCompleted }
            .sorted { ($0.completedAt ?? Date.distantPast) > ($1.completedAt ?? Date.distantPast) }
    }

    /// Get medications due today
    func medicationsDueToday() -> [ToDoItem] {
        itemsDueToday(for: .medication)
    }

    /// Get appointments for today
    func appointmentsToday() -> [ToDoItem] {
        itemsDueToday(for: .appointment)
    }

    /// Get tasks (no specific due date filtering for tasks)
    func tasks() -> [ToDoItem] {
        items(for: .task)
    }

    /// Get items that need reminders
    func itemsNeedingReminders() -> [ToDoItem] {
        items.filter { !$0.isCompleted }
    }

    /// Get missed medications (scheduled time passed, not completed)
    func missedMedications() -> [ToDoItem] {
        let now = Date()
        return items.filter {
            $0.category == .medication &&
            !$0.isCompleted &&
            $0.nextOccurrence < now &&
            Calendar.current.isDateInToday($0.nextOccurrence)
        }
    }

    /// Get missed appointments (start time passed, not completed/acknowledged)
    func missedAppointments() -> [ToDoItem] {
        let now = Date()
        return items.filter {
            $0.category == .appointment &&
            !$0.isCompleted &&
            $0.nextOccurrence < now &&
            Calendar.current.isDateInToday($0.nextOccurrence)
        }
    }

    /// Get incomplete tasks for end-of-day check
    func incompleteTasks() -> [ToDoItem] {
        items.filter { $0.category == .task && !$0.isCompleted }
    }

    // MARK: - Persistence

    private func loadItems() {
        guard let data = UserDefaults.standard.data(forKey: storageKey) else {
            items = []
            return
        }

        do {
            items = try JSONDecoder().decode([ToDoItem].self, from: data)
            print("[ToDoStore] Loaded \(items.count) items")
        } catch {
            print("[ToDoStore] Failed to decode items: \(error)")
            items = []
        }
    }

    private func saveItems() {
        do {
            let data = try JSONEncoder().encode(items)
            UserDefaults.standard.set(data, forKey: storageKey)
            print("[ToDoStore] Saved \(items.count) items")
        } catch {
            print("[ToDoStore] Failed to encode items: \(error)")
        }
    }

    /// Remove completed items older than retention period
    private func cleanupOldCompletedItems() {
        let cutoff = Calendar.current.date(byAdding: .day, value: -completedRetentionDays, to: Date()) ?? Date()

        let before = items.count
        items.removeAll { item in
            if let completedAt = item.completedAt, completedAt < cutoff {
                return true
            }
            return false
        }

        if items.count < before {
            print("[ToDoStore] Cleaned up \(before - items.count) old completed items")
            saveItems()
        }
    }

    // MARK: - Summary for Maya

    /// Generate a summary for Maya to speak at end of day
    func endOfDaySummary() -> (completed: [ToDoItem], missed: [ToDoItem], incompleteTasks: [ToDoItem]) {
        let todayCompleted = items.filter {
            $0.isCompleted &&
            $0.completedAt != nil &&
            Calendar.current.isDateInToday($0.completedAt!)
        }

        return (
            completed: todayCompleted,
            missed: missedMedications() + missedAppointments(),
            incompleteTasks: incompleteTasks()
        )
    }
}
