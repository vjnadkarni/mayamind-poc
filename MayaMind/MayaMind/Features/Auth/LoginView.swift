//
//  LoginView.swift
//  MayaMind
//
//  Login screen for existing users
//

import SwiftUI

struct LoginView: View {
    @StateObject private var authService = AuthService.shared
    @State private var email = ""
    @State private var password = ""
    @State private var showPassword = false
    @State private var showRegister = false
    @State private var showForgotPassword = false
    @State private var showTwoFactor = false
    @State private var errorMessage: String?
    @State private var isLoading = false

    var body: some View {
        ZStack {
            // Background
            Color(hex: "0a0a10")
                .ignoresSafeArea()

            ScrollView {
                VStack(spacing: 32) {
                    // Logo and title
                    VStack(spacing: 16) {
                        Image(systemName: "person.wave.2.fill")
                            .font(.system(size: 60))
                            .foregroundColor(.orange)

                        Text("MayaMind")
                            .font(.system(size: 36, weight: .bold))
                            .foregroundColor(.white)

                        Text("Welcome back")
                            .font(.system(size: 18))
                            .foregroundColor(.gray)
                    }
                    .padding(.top, 60)

                    // Login form
                    VStack(spacing: 20) {
                        // Email field
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Email")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.gray)

                            TextField("", text: $email)
                                .textFieldStyle(.plain)
                                .keyboardType(.emailAddress)
                                .textContentType(.emailAddress)
                                .autocapitalization(.none)
                                .autocorrectionDisabled()
                                .foregroundColor(.white)
                                .padding()
                                .background(Color(hex: "1a1a2e"))
                                .cornerRadius(12)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                                )
                        }

                        // Password field
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Password")
                                .font(.system(size: 14, weight: .medium))
                                .foregroundColor(.gray)

                            HStack {
                                if showPassword {
                                    TextField("", text: $password)
                                        .textFieldStyle(.plain)
                                        .textContentType(.password)
                                        .autocapitalization(.none)
                                        .autocorrectionDisabled()
                                } else {
                                    SecureField("", text: $password)
                                        .textFieldStyle(.plain)
                                        .textContentType(.password)
                                }

                                Button(action: { showPassword.toggle() }) {
                                    Image(systemName: showPassword ? "eye.slash" : "eye")
                                        .foregroundColor(.gray)
                                }
                            }
                            .foregroundColor(.white)
                            .padding()
                            .background(Color(hex: "1a1a2e"))
                            .cornerRadius(12)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                            )
                        }

                        // Forgot password
                        HStack {
                            Spacer()
                            Button(action: { showForgotPassword = true }) {
                                Text("Forgot password?")
                                    .font(.system(size: 14))
                                    .foregroundColor(.orange)
                            }
                        }
                    }
                    .padding(.horizontal, 24)

                    // Error message
                    if let error = errorMessage {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(.red)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }

                    // Login button
                    Button(action: login) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Text("Sign In")
                                    .font(.system(size: 18, weight: .semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 16)
                        .background(canLogin ? Color.orange : Color.gray)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(!canLogin || isLoading)
                    .padding(.horizontal, 24)

                    // Face ID button (if available and user has used app before)
                    if authService.isFaceIdAvailable() && hasSavedCredentials {
                        Button(action: loginWithFaceId) {
                            HStack(spacing: 8) {
                                Image(systemName: "faceid")
                                    .font(.system(size: 20))
                                Text("Sign in with Face ID")
                                    .font(.system(size: 16, weight: .medium))
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .background(Color(hex: "1a1a2e"))
                            .foregroundColor(.white)
                            .cornerRadius(12)
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(Color.orange.opacity(0.5), lineWidth: 1)
                            )
                        }
                        .padding(.horizontal, 24)
                    }

                    // Register link
                    HStack(spacing: 4) {
                        Text("Don't have an account?")
                            .foregroundColor(.gray)
                        Button(action: { showRegister = true }) {
                            Text("Sign up")
                                .foregroundColor(.orange)
                                .fontWeight(.semibold)
                        }
                    }
                    .font(.system(size: 14))
                    .padding(.top, 16)

                    Spacer(minLength: 40)
                }
            }
        }
        .sheet(isPresented: $showRegister) {
            RegisterView()
        }
        .sheet(isPresented: $showForgotPassword) {
            ForgotPasswordView()
        }
        .sheet(isPresented: $showTwoFactor) {
            TwoFactorView(onSuccess: {
                showTwoFactor = false
            })
        }
    }

    // MARK: - Computed Properties

    private var canLogin: Bool {
        !email.isEmpty && !password.isEmpty && email.contains("@")
    }

    private var hasSavedCredentials: Bool {
        // Check if user has logged in before (we could store last email)
        UserDefaults.standard.string(forKey: "last_login_email") != nil
    }

    // MARK: - Actions

    private func login() {
        errorMessage = nil
        isLoading = true

        Task {
            do {
                try await authService.login(email: email, password: password)
                // Save email for Face ID login
                UserDefaults.standard.set(email, forKey: "last_login_email")
            } catch AuthError.twoFactorRequired {
                isLoading = false
                showTwoFactor = true
                // Send 2FA code
                try? await authService.sendTwoFactorCode()
            } catch let error as AuthError {
                isLoading = false
                errorMessage = error.errorDescription
            } catch {
                isLoading = false
                errorMessage = "An unexpected error occurred"
            }
        }
    }

    private func loginWithFaceId() {
        Task {
            do {
                try await authService.authenticateWithFaceId()

                // Get saved credentials and auto-login
                if let savedEmail = UserDefaults.standard.string(forKey: "last_login_email") {
                    email = savedEmail
                    // For Face ID login, we need stored session - check if still valid
                    await authService.checkSession()
                }
            } catch {
                errorMessage = "Face ID authentication failed"
            }
        }
    }
}

// MARK: - Forgot Password View

struct ForgotPasswordView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var authService = AuthService.shared
    @State private var email = ""
    @State private var isLoading = false
    @State private var emailSent = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationView {
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                VStack(spacing: 24) {
                    if emailSent {
                        // Success state
                        VStack(spacing: 16) {
                            Image(systemName: "envelope.badge.fill")
                                .font(.system(size: 60))
                                .foregroundColor(.green)

                            Text("Check your email")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundColor(.white)

                            Text("We've sent password reset instructions to \(email)")
                                .font(.system(size: 16))
                                .foregroundColor(.gray)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)

                            Button(action: { dismiss() }) {
                                Text("Back to Login")
                                    .font(.system(size: 16, weight: .semibold))
                                    .foregroundColor(.orange)
                            }
                            .padding(.top, 16)
                        }
                    } else {
                        // Input state
                        VStack(spacing: 24) {
                            Text("Reset Password")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundColor(.white)

                            Text("Enter your email address and we'll send you instructions to reset your password.")
                                .font(.system(size: 16))
                                .foregroundColor(.gray)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal)

                            TextField("Email", text: $email)
                                .textFieldStyle(.plain)
                                .keyboardType(.emailAddress)
                                .autocapitalization(.none)
                                .foregroundColor(.white)
                                .padding()
                                .background(Color(hex: "1a1a2e"))
                                .cornerRadius(12)
                                .padding(.horizontal, 24)

                            if let error = errorMessage {
                                Text(error)
                                    .font(.system(size: 14))
                                    .foregroundColor(.red)
                            }

                            Button(action: sendReset) {
                                HStack {
                                    if isLoading {
                                        ProgressView()
                                            .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                    } else {
                                        Text("Send Reset Link")
                                            .font(.system(size: 16, weight: .semibold))
                                    }
                                }
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 14)
                                .background(email.contains("@") ? Color.orange : Color.gray)
                                .foregroundColor(.white)
                                .cornerRadius(12)
                            }
                            .disabled(!email.contains("@") || isLoading)
                            .padding(.horizontal, 24)
                        }
                    }

                    Spacer()
                }
                .padding(.top, 40)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarLeading) {
                    Button(action: { dismiss() }) {
                        Image(systemName: "xmark")
                            .foregroundColor(.white)
                    }
                }
            }
        }
    }

    private func sendReset() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await authService.sendPasswordReset(email: email)
                isLoading = false
                emailSent = true
            } catch {
                isLoading = false
                errorMessage = "Failed to send reset email"
            }
        }
    }
}

#Preview {
    LoginView()
}
