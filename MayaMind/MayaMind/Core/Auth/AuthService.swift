//
//  AuthService.swift
//  MayaMind
//
//  Handles authentication via Supabase Auth
//

import Foundation
import Combine
import UIKit
import Supabase
import LocalAuthentication

// MARK: - Auth Configuration

struct AuthConfig {
    static let supabaseURL = "https://plroxdjxliuecdfjjmyz.supabase.co"
    static let supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBscm94ZGp4bGl1ZWNkZmpqbXl6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE3MTIyNDEsImV4cCI6MjA4NzI4ODI0MX0.Il6D6yjKHugnZWyT71VSGoVh3RCpmFcaTtoA7WFgL9o"
    static let deviceRememberDays = 30
}

// MARK: - User Profile Model

struct UserProfile: Codable {
    let id: UUID
    var name: String
    var email: String
    var phone: String?
    var streetAddress: String?
    var city: String?
    var state: String?
    var zipCode: String?
    var dateOfBirth: Date?
    var twoFactorEnabled: Bool
    var twoFactorMethod: String?  // "email" or "sms"
    var faceIdEnabled: Bool
    var createdAt: Date?
    var updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, name, email, phone
        case streetAddress = "street_address"
        case city, state
        case zipCode = "zip_code"
        case dateOfBirth = "date_of_birth"
        case twoFactorEnabled = "two_factor_enabled"
        case twoFactorMethod = "two_factor_method"
        case faceIdEnabled = "face_id_enabled"
        case createdAt = "created_at"
        case updatedAt = "updated_at"
    }
}

// MARK: - Device Token Model

struct DeviceToken: Codable {
    let id: UUID?
    let userId: UUID
    let deviceId: String
    var deviceName: String?
    var createdAt: Date?
    var expiresAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case deviceId = "device_id"
        case deviceName = "device_name"
        case createdAt = "created_at"
        case expiresAt = "expires_at"
    }
}

// MARK: - Auth Errors

enum AuthError: LocalizedError {
    case invalidCredentials
    case emailNotVerified
    case accountLocked(until: Date)
    case twoFactorRequired
    case invalidTwoFactorCode
    case networkError(Error)
    case faceIdFailed
    case faceIdNotAvailable
    case unknown(String)

    var errorDescription: String? {
        switch self {
        case .invalidCredentials:
            return "Invalid email or password"
        case .emailNotVerified:
            return "Please verify your email address"
        case .accountLocked(let until):
            let formatter = DateFormatter()
            formatter.dateStyle = .short
            formatter.timeStyle = .short
            return "Account locked until \(formatter.string(from: until))"
        case .twoFactorRequired:
            return "Two-factor authentication required"
        case .invalidTwoFactorCode:
            return "Invalid verification code"
        case .networkError(let error):
            return "Network error: \(error.localizedDescription)"
        case .faceIdFailed:
            return "Face ID authentication failed"
        case .faceIdNotAvailable:
            return "Face ID is not available on this device"
        case .unknown(let message):
            return message
        }
    }
}

// MARK: - Auth Service

@MainActor
class AuthService: ObservableObject {
    static let shared = AuthService()

    @Published var isAuthenticated = false
    @Published var currentUser: User?
    @Published var userProfile: UserProfile?
    @Published var isLoading = false
    @Published var error: AuthError?

    private let supabase: SupabaseClient
    private let deviceId: String

    private init() {
        supabase = SupabaseClient(
            supabaseURL: URL(string: AuthConfig.supabaseURL)!,
            supabaseKey: AuthConfig.supabaseAnonKey,
            options: .init(
                auth: .init(flowType: .implicit)
            )
        )

        // Generate or retrieve device ID
        if let stored = UserDefaults.standard.string(forKey: "device_id") {
            deviceId = stored
        } else {
            let newId = UUID().uuidString
            UserDefaults.standard.set(newId, forKey: "device_id")
            deviceId = newId
        }

        // Check for existing session
        Task {
            await checkSession()
        }
    }

    // MARK: - Session Management

    func checkSession() async {
        do {
            let session = try await supabase.auth.session
            currentUser = session.user
            isAuthenticated = true
            await loadUserProfile()
            print("[Auth] Existing session found for \(session.user.email ?? "unknown")")
        } catch {
            isAuthenticated = false
            currentUser = nil
            print("[Auth] No existing session")
        }
    }

    // MARK: - Registration

    func register(
        name: String,
        email: String,
        password: String,
        phone: String?,
        streetAddress: String?,
        city: String?,
        state: String?,
        zipCode: String?,
        dateOfBirth: Date?
    ) async throws {
        isLoading = true
        defer { isLoading = false }

        do {
            // Create auth user
            let response = try await supabase.auth.signUp(
                email: email,
                password: password
            )

            let user = response.user

            // Create user profile
            let profile = UserProfile(
                id: user.id,
                name: name,
                email: email,
                phone: phone,
                streetAddress: streetAddress,
                city: city,
                state: state,
                zipCode: zipCode,
                dateOfBirth: dateOfBirth,
                twoFactorEnabled: false,
                twoFactorMethod: nil,
                faceIdEnabled: false
            )

            try await supabase
                .from("user_profiles")
                .insert(profile)
                .execute()

            print("[Auth] User registered: \(email)")

            // Note: User needs to verify email before they can sign in
            throw AuthError.emailNotVerified

        } catch let authError as AuthError {
            self.error = authError
            throw authError
        } catch {
            let authError = AuthError.networkError(error)
            self.error = authError
            throw authError
        }
    }

    // MARK: - Login

    func login(email: String, password: String) async throws {
        isLoading = true
        defer { isLoading = false }

        do {
            // Check for account lockout first
            if let lockout = try await checkLockout(email: email) {
                throw AuthError.accountLocked(until: lockout)
            }

            // Attempt login
            let session = try await supabase.auth.signIn(
                email: email,
                password: password
            )

            currentUser = session.user
            await loadUserProfile()

            // Clear any failed attempts
            await clearLockout(email: email)

            // Check if 2FA is required
            if let profile = userProfile, profile.twoFactorEnabled {
                // Check if device is remembered
                if await isDeviceRemembered() {
                    isAuthenticated = true
                    print("[Auth] Device remembered, skipping 2FA")
                } else {
                    throw AuthError.twoFactorRequired
                }
            } else {
                isAuthenticated = true
            }

            print("[Auth] Login successful: \(email)")

        } catch let authError as AuthError {
            if case .invalidCredentials = authError {
                await recordFailedAttempt(email: email)
            }
            self.error = authError
            throw authError
        } catch {
            await recordFailedAttempt(email: email)
            let authError = AuthError.invalidCredentials
            self.error = authError
            throw authError
        }
    }

    // MARK: - Logout

    func logout() async {
        do {
            try await supabase.auth.signOut()
        } catch {
            print("[Auth] Logout error: \(error)")
        }

        isAuthenticated = false
        currentUser = nil
        userProfile = nil
        print("[Auth] Logged out")
    }

    // MARK: - Profile Management

    func loadUserProfile() async {
        guard let userId = currentUser?.id else { return }

        do {
            let response: UserProfile = try await supabase
                .from("user_profiles")
                .select()
                .eq("id", value: userId.uuidString)
                .single()
                .execute()
                .value

            userProfile = response
            print("[Auth] Profile loaded: \(response.name)")
        } catch {
            print("[Auth] Failed to load profile: \(error)")
        }
    }

    func updateProfile(_ profile: UserProfile) async throws {
        try await supabase
            .from("user_profiles")
            .update(profile)
            .eq("id", value: profile.id.uuidString)
            .execute()

        userProfile = profile
        print("[Auth] Profile updated")
    }

    // MARK: - Two-Factor Authentication

    func sendTwoFactorCode() async throws {
        guard let profile = userProfile else {
            throw AuthError.unknown("No user profile")
        }

        let method = profile.twoFactorMethod ?? "email"
        let destination = method == "sms" ? profile.phone : profile.email

        guard let dest = destination else {
            throw AuthError.unknown("No \(method) address available")
        }

        // Generate 6-digit code
        let code = String(format: "%06d", Int.random(in: 0...999999))

        // Store code in database
        let codeEntry = TwoFactorCodeInsert(
            userId: profile.id,
            code: code,
            method: method
        )

        try await supabase
            .from("two_factor_codes")
            .insert(codeEntry)
            .execute()

        // Send via server endpoint (Resend for email, Twilio for SMS)
        let serverURL = URL(string: "https://companion.mayamind.ai/api/auth/send-2fa")!
        var request = URLRequest(url: serverURL)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = [
            "method": method,
            "destination": dest,
            "code": code,
            "userName": profile.name
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (_, response) = try await URLSession.shared.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw AuthError.unknown("Failed to send verification code")
        }

        print("[Auth] 2FA code sent via \(method) to \(dest)")
    }

    func verifyTwoFactorCode(_ code: String) async throws {
        guard let userId = currentUser?.id else {
            throw AuthError.unknown("No user session")
        }

        // Check code in database
        let response: [TwoFactorCode] = try await supabase
            .from("two_factor_codes")
            .select()
            .eq("user_id", value: userId.uuidString)
            .eq("code", value: code)
            .eq("used", value: false)
            .gt("expires_at", value: ISO8601DateFormatter().string(from: Date()))
            .execute()
            .value

        guard !response.isEmpty else {
            throw AuthError.invalidTwoFactorCode
        }

        // Mark code as used
        try await supabase
            .from("two_factor_codes")
            .update(TwoFactorCodeUpdate(used: true))
            .eq("user_id", value: userId.uuidString)
            .eq("code", value: code)
            .execute()

        // Remember device
        await rememberDevice()

        isAuthenticated = true
        print("[Auth] 2FA verified successfully")
    }

    func enableTwoFactor(method: String) async throws {
        guard var profile = userProfile else { return }

        profile.twoFactorEnabled = true
        profile.twoFactorMethod = method

        try await updateProfile(profile)
        print("[Auth] 2FA enabled via \(method)")
    }

    func disableTwoFactor() async throws {
        guard var profile = userProfile else { return }

        profile.twoFactorEnabled = false
        profile.twoFactorMethod = nil

        try await updateProfile(profile)
        print("[Auth] 2FA disabled")
    }

    // MARK: - Device Remember (30-day bypass)

    func isDeviceRemembered() async -> Bool {
        guard let userId = currentUser?.id else { return false }

        do {
            let response: [DeviceToken] = try await supabase
                .from("device_tokens")
                .select()
                .eq("user_id", value: userId.uuidString)
                .eq("device_id", value: deviceId)
                .gt("expires_at", value: ISO8601DateFormatter().string(from: Date()))
                .execute()
                .value

            return !response.isEmpty
        } catch {
            print("[Auth] Error checking device token: \(error)")
            return false
        }
    }

    func rememberDevice() async {
        guard let userId = currentUser?.id else { return }

        let deviceName = UIDevice.current.name
        let token = DeviceToken(
            id: nil,
            userId: userId,
            deviceId: deviceId,
            deviceName: deviceName
        )

        do {
            try await supabase
                .from("device_tokens")
                .upsert(token, onConflict: "user_id,device_id")
                .execute()

            print("[Auth] Device remembered for 30 days")
        } catch {
            print("[Auth] Error remembering device: \(error)")
        }
    }

    func forgetDevice() async {
        guard let userId = currentUser?.id else { return }

        do {
            try await supabase
                .from("device_tokens")
                .delete()
                .eq("user_id", value: userId.uuidString)
                .eq("device_id", value: deviceId)
                .execute()

            print("[Auth] Device forgotten")
        } catch {
            print("[Auth] Error forgetting device: \(error)")
        }
    }

    // MARK: - Face ID

    func isFaceIdAvailable() -> Bool {
        let context = LAContext()
        var error: NSError?
        return context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error)
    }

    func authenticateWithFaceId() async throws {
        let context = LAContext()
        var error: NSError?

        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            throw AuthError.faceIdNotAvailable
        }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthenticationWithBiometrics,
                localizedReason: "Unlock MayaMind"
            )

            if !success {
                throw AuthError.faceIdFailed
            }

            print("[Auth] Face ID authentication successful")
        } catch {
            throw AuthError.faceIdFailed
        }
    }

    func enableFaceId() async throws {
        // First verify Face ID works
        try await authenticateWithFaceId()

        // Then update profile
        guard var profile = userProfile else { return }
        profile.faceIdEnabled = true
        try await updateProfile(profile)

        print("[Auth] Face ID enabled")
    }

    func disableFaceId() async throws {
        guard var profile = userProfile else { return }
        profile.faceIdEnabled = false
        try await updateProfile(profile)

        print("[Auth] Face ID disabled")
    }

    // MARK: - Account Lockout

    private func checkLockout(email: String) async throws -> Date? {
        do {
            let response: [AccountLockout] = try await supabase
                .from("account_lockouts")
                .select()
                .eq("email", value: email)
                .execute()
                .value

            if let lockout = response.first,
               let lockedUntil = lockout.lockedUntil,
               lockedUntil > Date() {
                return lockedUntil
            }
            return nil
        } catch {
            return nil
        }
    }

    private func recordFailedAttempt(email: String) async {
        do {
            // Get current lockout record
            let response: [AccountLockout] = try await supabase
                .from("account_lockouts")
                .select()
                .eq("email", value: email)
                .execute()
                .value

            var attempts = (response.first?.failedAttempts ?? 0) + 1
            var lockedUntil: Date? = nil

            // Lock after 3 failed attempts for 24 hours
            if attempts >= 3 {
                lockedUntil = Calendar.current.date(byAdding: .hour, value: 24, to: Date())
                attempts = 0  // Reset for next lockout period
            }

            let lockout = AccountLockoutUpsert(
                email: email,
                failedAttempts: attempts,
                lockedUntil: lockedUntil,
                lastAttemptAt: Date()
            )

            try await supabase
                .from("account_lockouts")
                .upsert(lockout, onConflict: "email")
                .execute()

            print("[Auth] Failed attempt recorded for \(email): \(attempts)/3")
        } catch {
            print("[Auth] Error recording failed attempt: \(error)")
        }
    }

    private func clearLockout(email: String) async {
        do {
            try await supabase
                .from("account_lockouts")
                .delete()
                .eq("email", value: email)
                .execute()
        } catch {
            print("[Auth] Error clearing lockout: \(error)")
        }
    }

    // MARK: - Password Reset

    func sendPasswordReset(email: String) async throws {
        try await supabase.auth.resetPasswordForEmail(email)
        print("[Auth] Password reset email sent to \(email)")
    }

    /// Set session from deep link tokens (for password reset flow)
    func setSession(accessToken: String, refreshToken: String) async throws {
        try await supabase.auth.setSession(accessToken: accessToken, refreshToken: refreshToken)
        print("[Auth] Session set from deep link tokens")
    }

    /// Update password (requires active session from recovery flow)
    func updatePassword(newPassword: String) async throws {
        try await supabase.auth.update(user: UserAttributes(password: newPassword))
        print("[Auth] Password updated successfully")

        // Sign out after password change to require fresh login
        try await supabase.auth.signOut()
        isAuthenticated = false
        currentUser = nil
        userProfile = nil
    }
}

// MARK: - Helper Models

private struct TwoFactorCode: Codable {
    let id: UUID
    let userId: UUID
    let code: String
    let method: String
    let createdAt: Date
    let expiresAt: Date
    let used: Bool

    enum CodingKeys: String, CodingKey {
        case id
        case userId = "user_id"
        case code, method
        case createdAt = "created_at"
        case expiresAt = "expires_at"
        case used
    }
}

private struct AccountLockout: Codable {
    let id: UUID
    let email: String
    let failedAttempts: Int
    let lockedUntil: Date?
    let lastAttemptAt: Date

    enum CodingKeys: String, CodingKey {
        case id, email
        case failedAttempts = "failed_attempts"
        case lockedUntil = "locked_until"
        case lastAttemptAt = "last_attempt_at"
    }
}

// Insert/Update structs for Supabase operations
private struct TwoFactorCodeInsert: Encodable {
    let userId: UUID
    let code: String
    let method: String

    enum CodingKeys: String, CodingKey {
        case userId = "user_id"
        case code, method
    }
}

private struct TwoFactorCodeUpdate: Encodable {
    let used: Bool
}

private struct AccountLockoutUpsert: Encodable {
    let email: String
    let failedAttempts: Int
    let lockedUntil: Date?
    let lastAttemptAt: Date

    enum CodingKeys: String, CodingKey {
        case email
        case failedAttempts = "failed_attempts"
        case lockedUntil = "locked_until"
        case lastAttemptAt = "last_attempt_at"
    }
}
