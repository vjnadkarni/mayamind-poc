//
//  ToDosView.swift
//  MayaMind
//
//  To Dos screen: Medications, Appointments, Tasks with Maya voice assistant
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

    // Avatar state
    @State private var avatarMood: String = "neutral"
    @State private var avatarIsSpeaking: Bool = false
    @State private var isAvatarReady: Bool = false

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Background
                backgroundView

                // Main content
                VStack(spacing: 0) {
                    // Top bar with title and settings
                    HStack {
                        Text("To Dos")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(.white)
                        Spacer()

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
                    .padding(.vertical, 12)

                    // Scrollable content
                    ScrollView {
                        VStack(spacing: 20) {
                            // Medications section
                            makeCategorySection(category: .medication)

                            // Appointments section
                            makeCategorySection(category: .appointment)

                            // Tasks section
                            makeCategorySection(category: .task)

                            // Completed section
                            makeCompletedSection()

                            // Bottom padding for Maya thumbnail
                            Spacer().frame(height: 100)
                        }
                        .padding(.horizontal, 16)
                    }
                }

                // Maya thumbnail + mic button (bottom left)
                VStack {
                    Spacer()
                    HStack(alignment: .bottom, spacing: 12) {
                        // Maya avatar with background
                        ZStack {
                            // Background image (clipped to rounded rect)
                            if let bgImage = loadBackgroundImage(named: "background-home") {
                                Image(uiImage: bgImage)
                                    .resizable()
                                    .aspectRatio(contentMode: .fill)
                                    .frame(width: 120, height: 140)
                                    .clipped()
                                    .cornerRadius(16)
                                    .overlay(Color.black.opacity(0.3))
                            }

                            // Avatar WebView
                            AvatarWebView(
                                mood: $avatarMood,
                                isSpeaking: $avatarIsSpeaking,
                                onReady: {
                                    isAvatarReady = true
                                    print("[ToDos] Avatar ready")
                                },
                                onSpeakingEnd: {
                                    avatarIsSpeaking = false
                                    viewModel.isSpeaking = false
                                },
                                audioToSpeak: viewModel.avatarAudioData
                            )
                            .frame(width: 120, height: 140)
                            .cornerRadius(16)
                        }
                        .frame(width: 120, height: 140)
                        .shadow(color: .black.opacity(0.5), radius: 8, x: 0, y: 4)

                        // Mic button
                        Button(action: { viewModel.startListening() }) {
                            ZStack {
                                Circle()
                                    .fill(viewModel.isListening ? Color.red : Color.orange)
                                    .frame(width: 56, height: 56)
                                    .shadow(color: .black.opacity(0.3), radius: 4, x: 0, y: 2)

                                Image(systemName: viewModel.isListening ? "mic.fill" : "mic")
                                    .font(.system(size: 24))
                                    .foregroundColor(.white)
                            }
                        }
                        .disabled(viewModel.isListening || viewModel.isSpeaking)

                        Spacer()
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 16)
                }

                // Voice input overlay
                if viewModel.isListening {
                    voiceInputOverlay
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

    private func loadBackgroundImage(named name: String) -> UIImage? {
        if let path = Bundle.main.path(forResource: name, ofType: "jpg") {
            return UIImage(contentsOfFile: path)
        }
        return UIImage(named: name) ?? UIImage(named: "\(name).jpg")
    }

    private var formattedDate: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEEE, MMMM d"
        return formatter.string(from: Date())
    }

    // MARK: - Category Section

    @ViewBuilder
    private func makeCategorySection(category: ToDoCategory) -> some View {
        let color = colorFor(category)
        let items = store.items(for: category)
        let displayItems = Array(items.prefix(3))

        VStack(alignment: .leading, spacing: 10) {
            // Header row with icon, title, and + button
            HStack {
                Image(systemName: iconFor(category))
                    .foregroundColor(color)
                    .font(.system(size: 20, weight: .semibold))

                Text(category.displayName.uppercased())
                    .font(.system(size: 15, weight: .bold))
                    .foregroundColor(color)

                Spacer()

                // Add button - larger and more visible
                Button(action: {
                    print("[ToDos] Add button tapped for \(category.displayName)")
                    addingCategory = category
                }) {
                    HStack(spacing: 6) {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .bold))
                        Text("Add")
                            .font(.system(size: 14, weight: .semibold))
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    .background(color)
                    .cornerRadius(20)
                }
            }

            // Items or empty state
            if items.isEmpty {
                HStack {
                    Spacer()
                    Text("No \(category.displayName.lowercased()) scheduled")
                        .font(.system(size: 15))
                        .foregroundColor(.white.opacity(0.5))
                    Spacer()
                }
                .padding(.vertical, 24)
                .background(Color.white.opacity(0.08))
                .cornerRadius(12)
            } else {
                VStack(spacing: 0) {
                    ForEach(displayItems) { item in
                        ToDoItemRow(
                            item: item,
                            color: color,
                            onToggle: { toggleItem(item) },
                            onTap: { editingItem = item }
                        )

                        if item.id != displayItems.last?.id {
                            Divider()
                                .background(Color.white.opacity(0.1))
                        }
                    }

                    if items.count > 3 {
                        Divider()
                            .background(Color.white.opacity(0.1))

                        Text("+ \(items.count - 3) more")
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                            .padding(.vertical, 12)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.08))
                .cornerRadius(12)
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

        VStack(alignment: .leading, spacing: 10) {
            Button(action: { withAnimation { showCompletedSection.toggle() } }) {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundColor(.green)
                        .font(.system(size: 18))

                    Text("COMPLETED")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.green)

                    Text("(\(completed.count))")
                        .font(.system(size: 14))
                        .foregroundColor(.gray)

                    Spacer()

                    Image(systemName: showCompletedSection ? "chevron.up" : "chevron.down")
                        .foregroundColor(.gray)
                        .font(.system(size: 14))
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
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.05))
                .cornerRadius(12)
            }
        }
    }

    // MARK: - Voice Input Overlay

    private var voiceInputOverlay: some View {
        ZStack {
            Color.black.opacity(0.8)
                .ignoresSafeArea()
                .onTapGesture {
                    viewModel.cancelListening()
                }

            VStack(spacing: 24) {
                ZStack {
                    Circle()
                        .fill(Color.red)
                        .frame(width: 100, height: 100)
                        .scaleEffect(viewModel.isListening ? 1.1 : 1.0)
                        .animation(.easeInOut(duration: 0.6).repeatForever(autoreverses: true), value: viewModel.isListening)

                    Image(systemName: "mic.fill")
                        .font(.system(size: 40))
                        .foregroundColor(.white)
                }

                Text("Listening...")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundColor(.white)

                if !viewModel.transcript.isEmpty {
                    Text(viewModel.transcript)
                        .font(.system(size: 18))
                        .foregroundColor(.white.opacity(0.8))
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 32)
                }

                Text("\(viewModel.timeRemaining)s")
                    .font(.system(size: 32, weight: .bold))
                    .foregroundColor(.orange)

                Text("Tap anywhere to cancel")
                    .font(.system(size: 14))
                    .foregroundColor(.gray)
            }
        }
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
        HStack(spacing: 14) {
            // Checkbox circle
            Button(action: onToggle) {
                Circle()
                    .stroke(color, lineWidth: 2.5)
                    .frame(width: 28, height: 28)
            }
            .buttonStyle(PlainButtonStyle())

            // Content
            Button(action: onTap) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundColor(.white)

                    HStack(spacing: 8) {
                        Text(item.durationString ?? item.timeString)
                            .font(.system(size: 14))
                            .foregroundColor(.white.opacity(0.6))

                        if item.recurrence.pattern != .none {
                            HStack(spacing: 3) {
                                Image(systemName: "repeat")
                                    .font(.system(size: 11))
                                Text(item.recurrence.pattern.displayName)
                                    .font(.system(size: 12))
                            }
                            .foregroundColor(color.opacity(0.8))
                        }
                    }
                }
                Spacer()
            }
            .buttonStyle(PlainButtonStyle())
        }
        .padding(.vertical, 10)
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
