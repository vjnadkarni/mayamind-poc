//
//  TwilioService.swift
//  MayaMind
//
//  WhatsApp messaging via server-side Twilio integration
//

import Foundation
import Combine

class TwilioService: ObservableObject {
    @Published var isConnected = false
    @Published var unreadCount = 0

    private let serverBaseURL: String
    private var eventSource: URLSessionDataTask?

    init(serverBaseURL: String = "https://companion.mayamind.ai") {
        self.serverBaseURL = serverBaseURL
    }

    /// Send a text message via WhatsApp
    func sendTextMessage(to phone: String, message: String) async throws -> SendMessageResponse {
        guard let url = URL(string: "\(serverBaseURL)/api/whatsapp/send") else {
            throw TwilioError.invalidURL
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "to": phone,
            "message": message,
            "type": "text"
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(SendMessageResponse.self, from: data)
    }

    /// Send a voice message via WhatsApp
    func sendVoiceMessage(to phone: String, audioData: Data) async throws -> SendMessageResponse {
        guard let url = URL(string: "\(serverBaseURL)/api/whatsapp/send") else {
            throw TwilioError.invalidURL
        }

        // Create multipart form data
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()

        // Add phone field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"to\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(phone)\r\n".data(using: .utf8)!)

        // Add type field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"type\"\r\n\r\n".data(using: .utf8)!)
        body.append("voice\r\n".data(using: .utf8)!)

        // Add audio file
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"audio\"; filename=\"voice.m4a\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: audio/mp4\r\n\r\n".data(using: .utf8)!)
        body.append(audioData)
        body.append("\r\n".data(using: .utf8)!)

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)

        request.httpBody = body

        let (data, _) = try await URLSession.shared.data(for: request)
        return try JSONDecoder().decode(SendMessageResponse.self, from: data)
    }

    /// Start listening for incoming messages via SSE
    func startListening(onMessage: @escaping (IncomingMessage) -> Void) {
        guard let url = URL(string: "\(serverBaseURL)/api/whatsapp/events") else { return }

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.timeoutInterval = TimeInterval(INT_MAX) // Keep alive

        let session = URLSession(configuration: .default)
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            guard let data = data, error == nil else { return }

            // Parse SSE data
            let text = String(data: data, encoding: .utf8) ?? ""
            self?.parseSSEMessage(text, onMessage: onMessage)
        }

        eventSource = task
        task.resume()
        isConnected = true
    }

    func stopListening() {
        eventSource?.cancel()
        eventSource = nil
        isConnected = false
    }

    private func parseSSEMessage(_ text: String, onMessage: @escaping (IncomingMessage) -> Void) {
        let lines = text.components(separatedBy: "\n")

        for line in lines {
            if line.hasPrefix("data: ") {
                let jsonString = String(line.dropFirst(6))
                if let data = jsonString.data(using: .utf8),
                   let message = try? JSONDecoder().decode(IncomingMessage.self, from: data) {
                    DispatchQueue.main.async {
                        onMessage(message)
                    }
                }
            }
        }
    }

    /// Fetch media (voice messages, images) from server
    func fetchMedia(filename: String) async throws -> Data {
        guard let url = URL(string: "\(serverBaseURL)/api/whatsapp/media/\(filename)") else {
            throw TwilioError.invalidURL
        }

        let (data, _) = try await URLSession.shared.data(from: url)
        return data
    }
}

// MARK: - Response Types

struct SendMessageResponse: Codable {
    let success: Bool
    let messageSid: String?
    let error: String?
}

struct IncomingMessage: Codable, Identifiable {
    var id: String { messageSid ?? UUID().uuidString }
    let from: String
    let body: String?
    let mediaUrl: String?
    let mediaContentType: String?
    let messageSid: String?
    let timestamp: String?
}

enum TwilioError: LocalizedError {
    case invalidURL
    case sendFailed(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .sendFailed(let reason):
            return "Failed to send message: \(reason)"
        }
    }
}
