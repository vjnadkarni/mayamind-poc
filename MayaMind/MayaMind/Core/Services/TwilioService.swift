//
//  TwilioService.swift
//  MayaMind
//
//  WhatsApp messaging via server-side Twilio integration
//

import Foundation
import Combine

class TwilioService: NSObject, ObservableObject, URLSessionDataDelegate {
    @Published var isConnected = false
    @Published var unreadCount = 0

    private let serverBaseURL: String
    private var sseTask: URLSessionDataTask?
    private var sseSession: URLSession?
    private var messageHandler: ((IncomingMessage) -> Void)?
    private var buffer = ""

    override init() {
        self.serverBaseURL = "https://companion.mayamind.ai"
        super.init()
    }

    init(serverBaseURL: String) {
        self.serverBaseURL = serverBaseURL
        super.init()
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
            "body": message,
            "type": "text"
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)

        // Check HTTP status
        if let httpResponse = response as? HTTPURLResponse {
            print("[TwilioService] Send response status: \(httpResponse.statusCode)")
        }

        // Try to decode response
        do {
            return try JSONDecoder().decode(SendMessageResponse.self, from: data)
        } catch {
            // If decoding fails, check if we got an error message
            if let jsonObj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let errorMsg = jsonObj["error"] as? String {
                return SendMessageResponse(success: false, messageSid: nil, error: errorMsg)
            }
            throw error
        }
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
        guard let url = URL(string: "\(serverBaseURL)/api/whatsapp/events") else {
            print("[TwilioService] Invalid SSE URL")
            return
        }

        print("[TwilioService] Starting SSE listener")
        messageHandler = onMessage
        buffer = ""

        var request = URLRequest(url: url)
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")
        request.timeoutInterval = Double.infinity

        // Create session with delegate for streaming
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = Double.infinity
        config.timeoutIntervalForResource = Double.infinity

        sseSession = URLSession(configuration: config, delegate: self, delegateQueue: .main)
        sseTask = sseSession?.dataTask(with: request)
        sseTask?.resume()

        DispatchQueue.main.async {
            self.isConnected = true
        }
    }

    func stopListening() {
        print("[TwilioService] Stopping SSE listener")
        sseTask?.cancel()
        sseTask = nil
        sseSession?.invalidateAndCancel()
        sseSession = nil
        messageHandler = nil
        buffer = ""

        DispatchQueue.main.async {
            self.isConnected = false
        }
    }

    // MARK: - URLSessionDataDelegate

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let text = String(data: data, encoding: .utf8) else { return }
        print("[TwilioService] Received SSE data: \(text.prefix(100))...")

        buffer += text
        processBuffer()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            print("[TwilioService] SSE connection error: \(error.localizedDescription)")
        } else {
            print("[TwilioService] SSE connection closed")
        }

        DispatchQueue.main.async {
            self.isConnected = false
        }

        // Reconnect after delay
        DispatchQueue.main.asyncAfter(deadline: .now() + 5) { [weak self] in
            guard let self = self, let handler = self.messageHandler else { return }
            print("[TwilioService] Reconnecting SSE...")
            self.startListening(onMessage: handler)
        }
    }

    private func processBuffer() {
        // SSE format: "data: {...}\n\n"
        let events = buffer.components(separatedBy: "\n\n")

        // Keep incomplete event in buffer
        if !buffer.hasSuffix("\n\n") && events.count > 1 {
            buffer = events.last ?? ""
        } else if buffer.hasSuffix("\n\n") {
            buffer = ""
        }

        // Process complete events
        let completeEvents = buffer.hasSuffix("\n\n") ? events : Array(events.dropLast())

        for event in completeEvents {
            let lines = event.components(separatedBy: "\n")
            for line in lines {
                if line.hasPrefix("data: ") {
                    let jsonString = String(line.dropFirst(6))
                    if jsonString == "connected" {
                        print("[TwilioService] SSE connected confirmation")
                        continue
                    }

                    if let jsonData = jsonString.data(using: .utf8) {
                        do {
                            let message = try JSONDecoder().decode(IncomingMessage.self, from: jsonData)
                            print("[TwilioService] Received message from: \(message.from)")
                            messageHandler?(message)
                        } catch {
                            print("[TwilioService] Failed to parse message: \(error)")
                        }
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

    enum CodingKeys: String, CodingKey {
        case from = "from"
        case body = "body"
        case mediaUrl = "mediaUrl"
        case mediaContentType = "mediaContentType"
        case messageSid = "messageSid"
        case timestamp = "timestamp"
    }
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
