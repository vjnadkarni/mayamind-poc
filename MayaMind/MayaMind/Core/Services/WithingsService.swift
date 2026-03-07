//
//  WithingsService.swift
//  MayaMind
//
//  Withings API client for enhanced body composition metrics
//  (Visceral fat, bone mass, muscle mass - not available in HealthKit)
//

import Foundation
import AuthenticationServices
import Combine

class WithingsService: NSObject, ObservableObject {
    @Published var isConnected = false
    @Published var weight: Double?
    @Published var bodyFatPercentage: Double?
    @Published var muscleMass: Double?
    @Published var boneMass: Double?
    @Published var visceralFat: Int?

    private let serverBaseURL: String
    private var webAuthSession: ASWebAuthenticationSession?

    init(serverBaseURL: String = "https://companion.mayamind.ai") {
        self.serverBaseURL = serverBaseURL
        super.init()
    }

    /// Check if Withings is configured on the server
    func checkStatus() async throws -> Bool {
        guard let url = URL(string: "\(serverBaseURL)/api/health/withings/status") else {
            throw WithingsError.invalidURL
        }

        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(WithingsStatusResponse.self, from: data)

        await MainActor.run {
            self.isConnected = response.connected
        }

        return response.connected
    }

    /// Start OAuth2 flow for Withings authorization
    @MainActor
    func startOAuthFlow(presentationContext: ASWebAuthenticationPresentationContextProviding) async throws {
        guard let authURL = URL(string: "\(serverBaseURL)/api/health/withings/auth") else {
            throw WithingsError.invalidURL
        }

        // The server will redirect to Withings OAuth, then back to our callback
        let callbackScheme = "mayamind"

        return try await withCheckedThrowingContinuation { continuation in
            let session = ASWebAuthenticationSession(
                url: authURL,
                callbackURLScheme: callbackScheme
            ) { callbackURL, error in
                if let error = error {
                    if (error as NSError).code == ASWebAuthenticationSessionError.canceledLogin.rawValue {
                        continuation.resume(throwing: WithingsError.userCancelled)
                    } else {
                        continuation.resume(throwing: error)
                    }
                    return
                }

                // Successfully authorized
                self.isConnected = true
                continuation.resume()
            }

            session.presentationContextProvider = presentationContext
            session.prefersEphemeralWebBrowserSession = false

            self.webAuthSession = session
            session.start()
        }
    }

    /// Fetch latest body composition data from Withings
    func fetchBodyComposition() async throws {
        guard let url = URL(string: "\(serverBaseURL)/api/health/withings/data") else {
            throw WithingsError.invalidURL
        }

        let (data, _) = try await URLSession.shared.data(from: url)
        let response = try JSONDecoder().decode(WithingsDataResponse.self, from: data)

        await MainActor.run {
            self.weight = response.weight
            self.bodyFatPercentage = response.bodyFatPercentage
            self.muscleMass = response.muscleMass
            self.boneMass = response.boneMass
            self.visceralFat = response.visceralFat
        }
    }

    /// Disconnect Withings (clear tokens on server)
    func disconnect() async throws {
        // TODO: Implement server endpoint to clear Withings tokens
        await MainActor.run {
            self.isConnected = false
            self.weight = nil
            self.bodyFatPercentage = nil
            self.muscleMass = nil
            self.boneMass = nil
            self.visceralFat = nil
        }
    }
}

// MARK: - Response Types

struct WithingsStatusResponse: Codable {
    let configured: Bool
    let connected: Bool
}

struct WithingsDataResponse: Codable {
    let weight: Double?
    let bodyFatPercentage: Double?
    let muscleMass: Double?
    let boneMass: Double?
    let visceralFat: Int?
    let lastUpdated: String?

    enum CodingKeys: String, CodingKey {
        case weight
        case bodyFatPercentage = "body_fat_percentage"
        case muscleMass = "muscle_mass"
        case boneMass = "bone_mass"
        case visceralFat = "visceral_fat"
        case lastUpdated = "last_updated"
    }
}

enum WithingsError: LocalizedError {
    case invalidURL
    case userCancelled
    case notConnected

    var errorDescription: String? {
        switch self {
        case .invalidURL:
            return "Invalid Withings API URL"
        case .userCancelled:
            return "Withings authorization was cancelled"
        case .notConnected:
            return "Withings is not connected"
        }
    }
}
