//
//  ClaudeAPIService.swift
//  MayaMind
//
//  Claude API client for LLM conversations
//

import Foundation
import Combine

class ClaudeAPIService: ObservableObject {
    private let baseURL: String
    private var currentTask: URLSessionDataTask?

    // Server endpoint (relative to base URL)
    private let chatEndpoint = "/api/chat"
    private let extractEndpoint = "/api/extract-personality"

    init(baseURL: String = "") {
        // Load from configuration or use default
        self.baseURL = baseURL.isEmpty ? Self.loadServerURL() : baseURL
    }

    private static func loadServerURL() -> String {
        // In production, this would come from app configuration
        // For development, use the deployed server
        return "https://companion.mayamind.ai"
    }

    /// Send a chat message and receive streaming response
    func chat(
        message: String,
        conversationHistory: [[String: String]],
        section: String = "maya",
        contacts: [[String: String]]? = nil,
        onText: @escaping (String) -> Void,
        onComplete: @escaping () -> Void,
        onError: @escaping (Error) -> Void
    ) {
        let endpoint = section == "connect" ? "/api/chat/connect" : chatEndpoint
        guard let url = URL(string: baseURL + endpoint) else {
            onError(APIError.invalidURL)
            return
        }

        // Build request
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("text/event-stream", forHTTPHeaderField: "Accept")

        // Get user's timezone
        let timezone = TimeZone.current.identifier

        // Build messages array: history + current message
        // Server expects format: [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }, ...]
        var messages: [[String: String]] = conversationHistory
        messages.append(["role": "user", "content": message])

        var body: [String: Any] = [
            "messages": messages,
            "timezone": timezone
        ]

        // Add contacts for Connect section
        if let contacts = contacts {
            body["contacts"] = contacts
        }

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            onError(error)
            return
        }

        // Create streaming session
        let session = URLSession(configuration: .default)
        let task = session.dataTask(with: request) { data, response, error in
            if let error = error {
                DispatchQueue.main.async { onError(error) }
                return
            }

            guard let data = data else {
                DispatchQueue.main.async { onError(APIError.noData) }
                return
            }

            // Parse SSE response
            let responseString = String(data: data, encoding: .utf8) ?? ""
            self.parseSSEResponse(responseString, onText: onText)

            DispatchQueue.main.async { onComplete() }
        }

        currentTask = task
        task.resume()
    }

    private func parseSSEResponse(_ response: String, onText: @escaping (String) -> Void) {
        let lines = response.components(separatedBy: "\n")
        var fullText = ""

        for line in lines {
            if line.hasPrefix("data: ") {
                let data = String(line.dropFirst(6))
                if data == "[DONE]" {
                    break
                }

                // Parse JSON chunk
                if let jsonData = data.data(using: .utf8),
                   let json = try? JSONSerialization.jsonObject(with: jsonData) as? [String: Any],
                   let text = json["text"] as? String {
                    fullText += text
                }
            }
        }

        if !fullText.isEmpty {
            DispatchQueue.main.async { onText(fullText) }
        }
    }

    /// Extract personality signals from conversation
    func extractPersonality(
        transcript: String,
        completion: @escaping (Result<PersonalityProfile, Error>) -> Void
    ) {
        guard let url = URL(string: baseURL + extractEndpoint) else {
            completion(.failure(APIError.invalidURL))
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "transcript": transcript
        ]

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
        } catch {
            completion(.failure(error))
            return
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
            if let error = error {
                DispatchQueue.main.async { completion(.failure(error)) }
                return
            }

            guard let data = data else {
                DispatchQueue.main.async { completion(.failure(APIError.noData)) }
                return
            }

            do {
                let profile = try JSONDecoder().decode(PersonalityProfile.self, from: data)
                DispatchQueue.main.async { completion(.success(profile)) }
            } catch {
                DispatchQueue.main.async { completion(.failure(error)) }
            }
        }.resume()
    }

    func cancelCurrentRequest() {
        currentTask?.cancel()
        currentTask = nil
    }
}

enum APIError: LocalizedError {
    case invalidURL
    case noData
    case decodingError

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid server URL"
        case .noData:
            return "No data received from server"
        case .decodingError:
            return "Failed to decode server response"
        }
    }
}

struct PersonalityProfile: Codable {
    var identity: IdentityProfile?
    var communication: CommunicationProfile?
    var health: HealthProfile?
    var relationships: RelationshipsProfile?
    var routine: RoutineProfile?
    var emotional: EmotionalProfile?
    var topics: [String]?
}

struct IdentityProfile: Codable {
    var name: String?
    var age: Int?
    var location: String?
}

struct CommunicationProfile: Codable {
    var style: String?
    var preferredTopics: [String]?
}

struct HealthProfile: Codable {
    var conditions: [String]?
    var goals: [String]?
}

struct RelationshipsProfile: Codable {
    var familyMembers: [String]?
    var friends: [String]?
}

struct RoutineProfile: Codable {
    var exerciseTime: String?
    var sleepSchedule: String?
}

struct EmotionalProfile: Codable {
    var patterns: [String]?
    var triggers: [String]?
}
