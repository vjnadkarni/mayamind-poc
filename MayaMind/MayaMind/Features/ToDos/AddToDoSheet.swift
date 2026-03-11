//
//  AddToDoSheet.swift
//  MayaMind
//
//  Sheet for adding/editing to-do items with date/time pickers and recurrence
//

import SwiftUI

struct AddToDoSheet: View {
    @Environment(\.dismiss) private var dismiss
    @ObservedObject var store: ToDoStore

    let category: ToDoCategory
    var editingItem: ToDoItem?

    @State private var title: String = ""
    @State private var scheduledDate: Date = Date()
    @State private var startTime: Date = Date()
    @State private var endTime: Date = Date().addingTimeInterval(3600) // +1 hour
    @State private var recurrencePattern: RecurrencePattern = .none
    @State private var recurrenceEndDate: Date = Calendar.current.date(byAdding: .month, value: 1, to: Date()) ?? Date()
    @State private var hasRecurrenceEndDate: Bool = false
    @State private var notes: String = ""

    private var isEditing: Bool { editingItem != nil }

    var body: some View {
        NavigationView {
            Form {
                // Debug - this helps confirm the sheet opened
                let _ = print("[AddToDoSheet] Rendering for category: \(category.displayName)")
                // Title
                Section {
                    TextField(titlePlaceholder, text: $title)
                        .font(.system(size: 18))
                } header: {
                    Text(category == .medication ? "Medication Name" :
                         category == .appointment ? "Appointment Title" : "Task Description")
                }

                // Date & Time
                Section {
                    DatePicker(
                        "Date",
                        selection: $scheduledDate,
                        displayedComponents: .date
                    )
                    .font(.system(size: 18))

                    DatePicker(
                        category == .appointment ? "Start Time" : "Time",
                        selection: $startTime,
                        displayedComponents: .hourAndMinute
                    )
                    .font(.system(size: 18))

                    // End time only for appointments
                    if category == .appointment {
                        DatePicker(
                            "End Time",
                            selection: $endTime,
                            displayedComponents: .hourAndMinute
                        )
                        .font(.system(size: 18))
                    }
                } header: {
                    Text("Schedule")
                }

                // Recurrence (for medications and appointments)
                if category != .task {
                    Section {
                        Picker("Repeat", selection: $recurrencePattern) {
                            ForEach(RecurrencePattern.allCases, id: \.self) { pattern in
                                Text(pattern.displayName).tag(pattern)
                            }
                        }
                        .font(.system(size: 18))

                        if recurrencePattern != .none {
                            Toggle("Set End Date", isOn: $hasRecurrenceEndDate)
                                .font(.system(size: 18))

                            if hasRecurrenceEndDate {
                                DatePicker(
                                    "Repeat Until",
                                    selection: $recurrenceEndDate,
                                    in: Date()...,
                                    displayedComponents: .date
                                )
                                .font(.system(size: 18))
                            }
                        }
                    } header: {
                        Text("Recurrence")
                    }
                }

                // Notes (optional)
                Section {
                    TextField("Add notes (optional)", text: $notes, axis: .vertical)
                        .font(.system(size: 16))
                        .lineLimit(3...6)
                } header: {
                    Text("Notes")
                }

                // Reminder info
                Section {
                    HStack {
                        Image(systemName: "bell.fill")
                            .foregroundColor(.orange)
                        Text(reminderInfo)
                            .font(.system(size: 14))
                            .foregroundColor(.secondary)
                    }
                } header: {
                    Text("Reminder")
                }
            }
            .navigationTitle(isEditing ? "Edit \(category.displayName.dropLast())" : "Add \(category.displayName.dropLast())")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(isEditing ? "Save" : "Add") {
                        saveItem()
                    }
                    .disabled(title.trimmingCharacters(in: .whitespaces).isEmpty)
                    .fontWeight(.semibold)
                }
            }
            .onAppear {
                loadEditingItem()
            }
        }
    }

    private var titlePlaceholder: String {
        switch category {
        case .medication: return "e.g., Blood pressure pill"
        case .appointment: return "e.g., Dr. Smith checkup"
        case .task: return "e.g., Pick up groceries"
        }
    }

    private var reminderInfo: String {
        switch category {
        case .medication:
            return "Maya will remind you 5 minutes before"
        case .appointment:
            return "Maya will remind you 1 hour before"
        case .task:
            return "Maya will check in at 8 PM about incomplete tasks"
        }
    }

    private func loadEditingItem() {
        guard let item = editingItem else { return }
        title = item.title
        scheduledDate = item.scheduledDate
        startTime = item.startTime
        endTime = item.endTime ?? item.startTime.addingTimeInterval(3600)
        recurrencePattern = item.recurrence.pattern
        if let endDate = item.recurrence.endDate {
            hasRecurrenceEndDate = true
            recurrenceEndDate = endDate
        }
        notes = item.notes ?? ""
    }

    private func saveItem() {
        let trimmedTitle = title.trimmingCharacters(in: .whitespaces)
        guard !trimmedTitle.isEmpty else { return }

        let recurrence = Recurrence(
            pattern: recurrencePattern,
            endDate: hasRecurrenceEndDate ? recurrenceEndDate : nil
        )

        if var existing = editingItem {
            // Update existing
            existing.title = trimmedTitle
            existing.scheduledDate = scheduledDate
            existing.startTime = startTime
            existing.endTime = category == .appointment ? endTime : nil
            existing.recurrence = recurrence
            existing.notes = notes.isEmpty ? nil : notes

            // Update notifications
            let notificationIds = ToDoNotificationService.shared.scheduleNotifications(for: existing)
            existing.notificationIds = notificationIds

            store.updateItem(existing)
        } else {
            // Create new
            var newItem = ToDoItem(
                title: trimmedTitle,
                category: category,
                scheduledDate: scheduledDate,
                startTime: startTime,
                endTime: category == .appointment ? endTime : nil,
                recurrence: recurrence,
                notes: notes.isEmpty ? nil : notes
            )

            // Schedule notifications
            let notificationIds = ToDoNotificationService.shared.scheduleNotifications(for: newItem)
            newItem.notificationIds = notificationIds

            store.addItem(newItem)
        }

        dismiss()
    }
}

#Preview {
    AddToDoSheet(store: ToDoStore.shared, category: .medication)
}
