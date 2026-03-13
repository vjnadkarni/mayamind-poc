//
//  PasswordResetView.swift
//  MayaMind
//
//  Password reset form shown after user clicks reset link in email
//

import SwiftUI

struct PasswordResetView: View {
    @EnvironmentObject var deepLinkHandler: DeepLinkHandler
    @Environment(\.dismiss) private var dismiss

    @State private var password = ""
    @State private var confirmPassword = ""
    @State private var showPassword = false
    @State private var showConfirmPassword = false
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showSuccess = false

    var body: some View {
        NavigationView {
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                if showSuccess {
                    successView
                } else {
                    formView
                }
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

    private var formView: some View {
        ScrollView {
            VStack(spacing: 24) {
                // Icon
                Image(systemName: "lock.rotation")
                    .font(.system(size: 60))
                    .foregroundColor(.orange)
                    .padding(.top, 40)

                // Title
                Text("Reset Password")
                    .font(.system(size: 24, weight: .bold))
                    .foregroundColor(.white)

                Text("Enter your new password below")
                    .font(.system(size: 14))
                    .foregroundColor(.gray)

                VStack(spacing: 16) {
                    // New Password
                    AuthSecureField(
                        label: "New Password",
                        text: $password,
                        showPassword: $showPassword,
                        placeholder: "At least 8 characters"
                    )

                    // Password requirements
                    VStack(alignment: .leading, spacing: 4) {
                        PasswordRequirement(met: password.count >= 8, text: "At least 8 characters")
                        PasswordRequirement(met: password.rangeOfCharacter(from: .uppercaseLetters) != nil, text: "One uppercase letter")
                        PasswordRequirement(met: password.rangeOfCharacter(from: .decimalDigits) != nil, text: "One number")
                    }
                    .padding(.horizontal, 24)

                    // Confirm Password
                    AuthSecureField(
                        label: "Confirm Password",
                        text: $confirmPassword,
                        showPassword: $showConfirmPassword,
                        placeholder: "Re-enter password"
                    )

                    if !confirmPassword.isEmpty && password != confirmPassword {
                        Text("Passwords do not match")
                            .font(.system(size: 12))
                            .foregroundColor(.red)
                            .padding(.horizontal, 24)
                    }
                }

                // Error message
                if let error = errorMessage {
                    Text(error)
                        .font(.system(size: 14))
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal)
                }

                // Submit button
                Button(action: resetPassword) {
                    HStack {
                        if isLoading {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                        } else {
                            Text("Update Password")
                                .font(.system(size: 16, weight: .semibold))
                        }
                    }
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(canSubmit ? Color.orange : Color.gray)
                    .foregroundColor(.white)
                    .cornerRadius(12)
                }
                .disabled(!canSubmit || isLoading)
                .padding(.horizontal, 24)
                .padding(.top, 8)

                Spacer(minLength: 40)
            }
        }
    }

    private var successView: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 80))
                .foregroundColor(.green)

            Text("Password Updated!")
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.white)

            Text("Your password has been successfully changed.")
                .font(.system(size: 16))
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Text("You can now sign in with your new password.")
                .font(.system(size: 14))
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button(action: {
                deepLinkHandler.showPasswordReset = false
                dismiss()
            }) {
                Text("Back to Login")
                    .font(.system(size: 16, weight: .semibold))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
                    .background(Color.orange)
                    .foregroundColor(.white)
                    .cornerRadius(12)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)

            Spacer()
        }
    }

    // MARK: - Computed Properties

    private var canSubmit: Bool {
        password.count >= 8 &&
        password.rangeOfCharacter(from: .uppercaseLetters) != nil &&
        password.rangeOfCharacter(from: .decimalDigits) != nil &&
        password == confirmPassword
    }

    // MARK: - Actions

    private func resetPassword() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await AuthService.shared.updatePassword(newPassword: password)
                showSuccess = true
            } catch {
                errorMessage = "Failed to update password. Please try again."
                print("[PasswordReset] Error: \(error)")
            }
            isLoading = false
        }
    }
}

#Preview {
    PasswordResetView()
        .environmentObject(DeepLinkHandler())
}
