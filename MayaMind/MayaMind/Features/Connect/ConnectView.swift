//
//  ConnectView.swift
//  MayaMind
//
//  WhatsApp messaging interface via Twilio
//

import SwiftUI
import Combine

struct ConnectView: View {
    @EnvironmentObject var appState: AppState
    @StateObject private var viewModel = ConnectViewModel()

    var body: some View {
        ZStack {
            Color(hex: "0a0a10")
                .ignoresSafeArea()

            VStack(spacing: 0) {
                // Top bar
                HStack {
                    Text("Connect")
                        .font(.system(size: 24, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()

                    // Mute button
                    Button(action: { appState.isMuted.toggle() }) {
                        Image(systemName: appState.isMuted ? "mic.slash.fill" : "mic.fill")
                            .font(.system(size: 20))
                            .foregroundColor(appState.isMuted ? .red : .green)
                            .padding(10)
                            .background(Color.white.opacity(0.1))
                            .cornerRadius(8)
                    }
                }
                .padding(.horizontal)
                .padding(.top, 8)

                // Avatar area
                ZStack {
                    Color(hex: "1a1a2e")
                    VStack {
                        Image(systemName: "person.wave.2.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.orange.opacity(0.5))
                        Text("Maya Avatar")
                            .foregroundColor(.gray)
                            .padding(.top, 8)
                    }
                }
                .frame(height: 200)
                .cornerRadius(16)
                .padding(.horizontal)
                .padding(.top, 16)

                // Unread messages banner
                if viewModel.unreadCount > 0 {
                    HStack {
                        Image(systemName: "envelope.badge.fill")
                            .foregroundColor(.pink)
                        Text("You have \(viewModel.unreadCount) new message\(viewModel.unreadCount > 1 ? "s" : "")")
                            .foregroundColor(.white)
                        Spacer()
                        Button("Play") {
                            viewModel.playUnreadMessages()
                        }
                        .foregroundColor(.orange)
                    }
                    .padding()
                    .background(Color.pink.opacity(0.2))
                    .cornerRadius(12)
                    .padding(.horizontal)
                    .padding(.top, 12)
                }

                // Chat transcript
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        ForEach(viewModel.messages) { message in
                            ConnectChatBubble(message: message)
                        }
                    }
                    .padding()
                }
                .frame(maxHeight: .infinity)
                .background(Color(hex: "0f0f1a"))
                .cornerRadius(16)
                .padding(.horizontal)
                .padding(.vertical, 16)

                // Contacts quick access
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 12) {
                        ForEach(viewModel.contacts) { contact in
                            ContactButton(contact: contact) {
                                viewModel.selectContact(contact)
                            }
                        }

                        // Add contact button
                        Button(action: { viewModel.addContact() }) {
                            VStack(spacing: 4) {
                                Image(systemName: "plus.circle.fill")
                                    .font(.system(size: 32))
                                    .foregroundColor(.gray)
                                Text("Add")
                                    .font(.system(size: 12))
                                    .foregroundColor(.gray)
                            }
                            .frame(width: 60, height: 60)
                        }
                    }
                    .padding(.horizontal)
                }
                .padding(.bottom, 16)

                // Status bar
                HStack {
                    Circle()
                        .fill(viewModel.isListening ? Color.green : Color.gray)
                        .frame(width: 8, height: 8)
                    Text(viewModel.statusText)
                        .font(.system(size: 14))
                        .foregroundColor(.gray)
                    Spacer()
                }
                .padding(.horizontal)
                .padding(.bottom, 8)
            }
        }
    }
}

struct ConnectChatBubble: View {
    let message: ConnectMessage

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if message.direction == .received {
                // Contact avatar
                Circle()
                    .fill(Color.blue)
                    .frame(width: 32, height: 32)
                    .overlay(
                        Text(String(message.contactName.prefix(1)))
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                    )
            }

            VStack(alignment: message.direction == .sent ? .trailing : .leading, spacing: 4) {
                if message.direction == .received {
                    Text(message.contactName)
                        .font(.system(size: 12))
                        .foregroundColor(.gray)
                }

                // Message content
                if let imageURL = message.imageURL {
                    // Image message
                    AsyncImage(url: imageURL) { image in
                        image
                            .resizable()
                            .aspectRatio(contentMode: .fit)
                            .frame(maxWidth: 200, maxHeight: 200)
                            .cornerRadius(12)
                    } placeholder: {
                        Rectangle()
                            .fill(Color.gray.opacity(0.3))
                            .frame(width: 200, height: 150)
                            .cornerRadius(12)
                    }
                }

                if let text = message.text, !text.isEmpty {
                    Text(text)
                        .font(.system(size: 16))
                        .foregroundColor(.white)
                        .padding(12)
                        .background(message.direction == .sent ? Color.orange : Color(hex: "2a2a3e"))
                        .cornerRadius(16)
                }

                if message.isVoice {
                    HStack {
                        Image(systemName: "waveform")
                            .foregroundColor(.white)
                        Text("Voice message")
                            .font(.system(size: 14))
                            .foregroundColor(.white)
                    }
                    .padding(12)
                    .background(message.direction == .sent ? Color.orange : Color(hex: "2a2a3e"))
                    .cornerRadius(16)
                }

                Text(message.timestamp, style: .time)
                    .font(.system(size: 10))
                    .foregroundColor(.gray)
            }

            if message.direction == .sent {
                Spacer()
            }
        }
        .frame(maxWidth: .infinity, alignment: message.direction == .sent ? .trailing : .leading)
    }
}

struct ContactButton: View {
    let contact: Contact
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 4) {
                Circle()
                    .fill(Color.blue)
                    .frame(width: 44, height: 44)
                    .overlay(
                        Text(String(contact.name.prefix(1)))
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(.white)
                    )
                Text(contact.name)
                    .font(.system(size: 12))
                    .foregroundColor(.white)
                    .lineLimit(1)
            }
            .frame(width: 60)
        }
    }
}

struct Contact: Identifiable {
    let id = UUID()
    let name: String
    let phone: String
}

struct ConnectMessage: Identifiable {
    let id = UUID()
    let contactName: String
    let text: String?
    let imageURL: URL?
    let isVoice: Bool
    let direction: MessageDirection
    let timestamp: Date
    let isRead: Bool
}

enum MessageDirection {
    case sent
    case received
}

class ConnectViewModel: ObservableObject {
    @Published var messages: [ConnectMessage] = []
    @Published var contacts: [Contact] = []
    @Published var unreadCount = 0
    @Published var isListening = false
    @Published var statusText = "Say \"Send a message to...\" to start"

    init() {
        // Sample contacts
        contacts = [
            Contact(name: "Carol", phone: "+14085551234"),
            Contact(name: "David", phone: "+14085555678")
        ]

        // Sample messages
        messages = [
            ConnectMessage(
                contactName: "Maya",
                text: "Who would you like to message? You can say something like \"Send a message to Carol\".",
                imageURL: nil,
                isVoice: false,
                direction: .received,
                timestamp: Date(),
                isRead: true
            )
        ]
    }

    func selectContact(_ contact: Contact) {
        statusText = "What would you like to say to \(contact.name)?"
    }

    func addContact() {
        statusText = "Say the contact's name and phone number"
    }

    func playUnreadMessages() {
        unreadCount = 0
    }
}

#Preview {
    ConnectView()
        .environmentObject(AppState())
}
