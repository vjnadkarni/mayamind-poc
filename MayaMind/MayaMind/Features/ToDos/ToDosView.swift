//
//  ToDosView.swift
//  MayaMind
//
//  To Dos screen: Appointments, Tasks, Medications with voice input
//

import SwiftUI

struct ToDosView: View {
    @EnvironmentObject var appState: AppState
    @ObservedObject private var store = ToDoStore.shared
    @StateObject private var viewModel = ToDosViewModel()

    @State private var showSettings = false
    @State private var addingCategory: ToDoCategory?
    @State private var editingItem: ToDoItem?
    @State private var showCompletedSection = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background
                backgroundView

                // Main content
                VStack(spacing: 0) {
                    // Top bar with title, listening indicator, mic, and settings
                    HStack {
                        Text("To Dos")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.white)

                        // Compact listening indicator
                        if viewModel.isListening {
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(Color.red)
                                    .frame(width: 10, height: 10)
                                    .scaleEffect(viewModel.isListening ? 1.2 : 1.0)
                                    .animation(.easeInOut(duration: 0.5).repeatForever(autoreverses: true), value: viewModel.isListening)

                                Text(formatTime(viewModel.timeRemaining))
                                    .font(.system(size: 14, weight: .medium))
                                    .foregroundColor(.orange)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 5)
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(12)
                            .onTapGesture {
                                viewModel.cancelListening()
                            }
                        }

                        Spacer()

                        // Mic button
                        Button(action: { viewModel.startListening() }) {
                            Image(systemName: viewModel.isListening ? "mic.fill" : "mic")
                                .font(.system(size: 20))
                                .foregroundColor(viewModel.isListening ? .red : .orange)
                                .padding(10)
                                .background(Color.white.opacity(0.15))
                                .cornerRadius(8)
                        }
                        .disabled(viewModel.isListening || viewModel.isSpeaking)

                        Button(action: { showSettings = true }) {
                            Image(systemName: "gearshape.fill")
                                .font(.system(size: 20))
                                .foregroundColor(.orange)
                                .padding(10)
                                .background(Color.white.opacity(0.15))
                                .cornerRadius(8)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 12)

                    // Date header
                    HStack {
                        Text("TODAY")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundColor(.orange)

                        Text("—")
                            .foregroundColor(.gray)

                        Text(formattedDate)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.white.opacity(0.8))

                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 8)

                    // Transcript display when listening
                    if viewModel.isListening && !viewModel.transcript.isEmpty {
                        Text(viewModel.transcript)
                            .font(.system(size: 15))
                            .foregroundColor(.white.opacity(0.9))
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(8)
                            .padding(.horizontal, 16)
                            .padding(.bottom, 6)
                    }

                    // Scrollable content
                    ScrollView {
                        VStack(spacing: 14) {
                            // Appointments section (max 3 visible)
                            makeCategorySection(category: .appointment, maxDisplay: 3)

                            // Tasks section (max 3 visible)
                            makeCategorySection(category: .task, maxDisplay: 3)

                            // Medications section (max 1 visible)
                            makeCategorySection(category: .medication, maxDisplay: 1)

                            // Completed section
                            makeCompletedSection()

                            // Bottom padding
                            Spacer().frame(height: 20)
                        }
                        .padding(.horizontal, 16)
                    }
                }

            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
                .environmentObject(appState)
        }
        .sheet(item: $addingCategory) { category in
            AddToDoSheet(store: store, category: category)
        }
        .sheet(item: $editingItem) { item in
            AddToDoSheet(store: store, category: item.category, editingItem: item)
        }
        .onAppear {
            print("[ToDos] View appeared")
            print("[ToDos] Store has \(store.items.count) items")
            viewModel.requestNotificationPermission()
        }
    }

    // MARK: - Background

    private var backgroundView: some View {
        // Simple dark gradient background (no full-screen image)
        LinearGradient(
            colors: [Color(red: 0.08, green: 0.08, blue: 0.12),
                     Color(red: 0.05, green: 0.07, blue: 0.12)],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: Date())
    }

    // MARK: - Category Section

    private let itemRowHeight: CGFloat = 48 // Approximate height per item row

    @ViewBuilder
    private func makeCategorySection(category: ToDoCategory, maxDisplay: Int) -> some View {
        let color = colorFor(category)
        let items = store.items(for: category)
        let needsScroll = items.count > maxDisplay
        let maxHeight = CGFloat(maxDisplay) * itemRowHeight + 4 // +4 for padding

        VStack(alignment: .leading, spacing: 6) {
            // Header row with icon, title, count badge, and + button
            HStack {
                Image(systemName: iconFor(category))
                    .foregroundColor(color)
                    .font(.system(size: 16, weight: .semibold))

                Text(category.displayName.uppercased())
                    .font(.system(size: 13, weight: .bold))
                    .foregroundColor(color)

                // Show count badge if more items than displayed
                if needsScroll {
                    Text("(\(items.count))")
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                }

                Spacer()

                // Add button
                Button(action: {
                    print("[ToDos] Add button tapped for \(category.displayName)")
                    addingCategory = category
                }) {
                    HStack(spacing: 4) {
                        Image(systemName: "plus")
                            .font(.system(size: 12, weight: .bold))
                        Text("Add")
                            .font(.system(size: 13, weight: .semibold))
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(color)
                    .cornerRadius(14)
                }
            }

            // Items or empty state
            if items.isEmpty {
                HStack {
                    Spacer()
                    Text("No \(category.displayName.lowercased()) scheduled")
                        .font(.system(size: 14))
                        .foregroundColor(.white.opacity(0.5))
                    Spacer()
                }
                .padding(.vertical, 16)
                .background(Color.white.opacity(0.08))
                .cornerRadius(10)
            } else {
                // Scrollable container if needed
                Group {
                    if needsScroll {
                        ScrollView {
                            itemsList(items: items, color: color)
                        }
                        .frame(maxHeight: maxHeight)
                    } else {
                        itemsList(items: items, color: color)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.08))
                .cornerRadius(10)
            }
        }
    }

    @ViewBuilder
    private func itemsList(items: [ToDoItem], color: Color) -> some View {
        VStack(spacing: 0) {
            ForEach(items) { item in
                ToDoItemRow(
                    item: item,
                    color: color,
                    onToggle: { toggleItem(item) },
                    onTap: { editingItem = item }
                )

                if item.id != items.last?.id {
                    Divider()
                        .background(Color.white.opacity(0.1))
                }
            }
        }
    }

    private func colorFor(_ category: ToDoCategory) -> Color {
        switch category {
        case .medication: return Color(red: 0.29, green: 0.56, blue: 0.85) // Blue
        case .appointment: return Color(red: 0.61, green: 0.35, blue: 0.71) // Purple
        case .task: return Color(red: 0.15, green: 0.68, blue: 0.38) // Green
        }
    }

    private func iconFor(_ category: ToDoCategory) -> String {
        switch category {
        case .medication: return "pill.fill"
        case .appointment: return "calendar"
        case .task: return "checklist"
        }
    }

    // MARK: - Completed Section

    @ViewBuilder
    private func makeCompletedSection() -> some View {
        let completed = store.completedItems()

        VStack(alignment: .leading, spacing: 6) {
            Button(action: { withAnimation { showCompletedSection.toggle() } }) {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.system(size: 16))

                    Text("COMPLETED")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundColor(.green)

                    Text("(\(completed.count))")
                        .font(.system(size: 12))
                        .foregroundColor(.gray)

                    Spacer()

                    Image(systemName: showCompletedSection ? "chevron.up" : "chevron.down")
                        .foregroundColor(.gray)
                        .font(.system(size: 12))
                }
            }
            .buttonStyle(PlainButtonStyle())

            if showCompletedSection && !completed.isEmpty {
                VStack(spacing: 0) {
                    ForEach(completed) { item in
                        CompletedItemRow(item: item, color: colorFor(item.category)) {
                            store.markIncomplete(item)
                        }

                        if item.id != completed.last?.id {
                            Divider()
                                .background(Color.white.opacity(0.1))
                        }
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.white.opacity(0.05))
                .cornerRadius(10)
            }
        }
    }

    // MARK: - Helpers

    private func formatTime(_ seconds: Int) -> String {
        let mins = seconds / 60
        let secs = seconds % 60
        return String(format: "%d:%02d", mins, secs)
    }

    // MARK: - Actions

    private func toggleItem(_ item: ToDoItem) {
        if item.isCompleted {
            store.markIncomplete(item)
        } else {
            store.markCompleted(item)
            ToDoNotificationService.shared.cancelNotifications(for: item)
        }
    }
}

// MARK: - To Do Item Row

struct ToDoItemRow: View {
    let item: ToDoItem
    let color: Color
    let onToggle: () -> Void
    let onTap: () -> Void

    var body: some View {
        HStack(spacing: 10) {
            // Checkbox circle
            Button(action: onToggle) {
                Circle()
                    .stroke(color, lineWidth: 2)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(PlainButtonStyle())

            // Content
            Button(action: onTap) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)

                    HStack(spacing: 6) {
                        // Time and date
                        Text("\(item.durationString ?? item.timeString), \(item.dateString)")
                            .font(.system(size: 13))
                            .foregroundColor(.white.opacity(0.6))

                        if item.recurrence.pattern != .none {
                            HStack(spacing: 2) {
                                Image(systemName: "repeat")
                                    .font(.system(size: 10))
                                Text(item.recurrence.pattern.displayName)
                                    .font(.system(size: 11))
                            }
                            .foregroundColor(color.opacity(0.8))
                        }
                    }
                }
                Spacer()
            }
            .buttonStyle(PlainButtonStyle())
        }
        .padding(.vertical, 6)
    }
}

// MARK: - Completed Item Row

struct CompletedItemRow: View {
    let item: ToDoItem
    let color: Color
    let onUndo: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            // Green checkmark
            ZStack {
                Circle()
                    .fill(Color.green)
                    .frame(width: 24, height: 24)

                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.white)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.system(size: 15))
                    .foregroundColor(.gray)
                    .strikethrough()

                if let completedAt = item.completedAt {
                    Text(formatDate(completedAt))
                        .font(.system(size: 12))
                        .foregroundColor(.gray.opacity(0.7))
                }
            }

            Spacer()

            Image(systemName: iconFor(item.category))
                .font(.system(size: 12))
                .foregroundColor(color.opacity(0.5))

            Button(action: onUndo) {
                Image(systemName: "arrow.uturn.backward")
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
            }
        }
        .padding(.vertical, 8)
    }

    private func formatDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d, h:mm a"
        return formatter.string(from: date)
    }

    private func iconFor(_ category: ToDoCategory) -> String {
        switch category {
        case .medication: return "pill.fill"
        case .appointment: return "calendar"
        case .task: return "checklist"
        }
    }
}

// MARK: - Identifiable conformance

extension ToDoCategory: Identifiable {
    var id: String { rawValue }
}

#Preview {
    ToDosView()
        .environmentObject(AppState())
}
