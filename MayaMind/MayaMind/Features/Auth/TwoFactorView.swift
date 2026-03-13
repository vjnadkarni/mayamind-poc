//
//  TwoFactorView.swift
//  MayaMind
//
//  Two-factor authentication verification screen
//

import SwiftUI

struct TwoFactorView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var authService = AuthService.shared

    var onSuccess: () -> Void

    @State private var code = ""
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var resendCooldown = 0
    @State private var timer: Timer?

    var body: some View {
        NavigationView {
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                VStack(spacing: 32) {
                    // Icon
                    ZStack {
                        Circle()
                            .fill(Color.orange.opacity(0.2))
                            .frame(width: 100, height: 100)

                        Image(systemName: "lock.shield.fill")
                            .font(.system(size: 40))
                            .foregroundColor(.orange)
                    }
                    .padding(.top, 40)

                    // Title and description
                    VStack(spacing: 12) {
                        Text("Two-Factor Authentication")
                            .font(.system(size: 24, weight: .bold))
                            .foregroundColor(.white)

                        Text(descriptionText)
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 32)
                    }

                    // Code input
                    VStack(spacing: 16) {
                        HStack(spacing: 12) {
                            ForEach(0..<6, id: \.self) { index in
                                CodeDigitBox(
                                    digit: digit(at: index),
                                    isFocused: code.count == index
                                )
                            }
                        }

                        // Hidden text field for input
                        TextField("", text: $code)
                            .keyboardType(.numberPad)
                            .textContentType(.oneTimeCode)
                            .opacity(0)
                            .frame(height: 1)
                            .onChange(of: code) { newValue in
                                // Limit to 6 digits
                                if newValue.count > 6 {
                                    code = String(newValue.prefix(6))
                                }
                                // Auto-verify when 6 digits entered
                                if code.count == 6 {
                                    verifyCode()
                                }
                            }
                    }
                    .padding(.horizontal, 24)

                    // Error message
                    if let error = errorMessage {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(.red)
                    }

                    // Verify button
                    Button(action: verifyCode) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Text("Verify")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(code.count == 6 ? Color.orange : Color.gray)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(code.count != 6 || isLoading)
                    .padding(.horizontal, 24)

                    // Resend code
                    Button(action: resendCode) {
                        if resendCooldown > 0 {
                            Text("Resend code in \(resendCooldown)s")
                                .font(.system(size: 14))
                                .foregroundColor(.gray)
                        } else {
                            Text("Didn't receive a code? Resend")
                                .font(.system(size: 14))
                                .foregroundColor(.orange)
                        }
                    }
                    .disabled(resendCooldown > 0)

                    Spacer()
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
            .onAppear {
                startResendCooldown()
            }
            .onDisappear {
                timer?.invalidate()
            }
        }
    }

    // MARK: - Computed Properties

    private var descriptionText: String {
        if let method = authService.userProfile?.twoFactorMethod {
            if method == "sms", let phone = authService.userProfile?.phone {
                let masked = String(repeating: "*", count: max(0, phone.count - 4)) + phone.suffix(4)
                return "Enter the 6-digit code sent to \(masked)"
            } else if let email = authService.userProfile?.email {
                return "Enter the 6-digit code sent to \(email)"
            }
        }
        return "Enter the 6-digit verification code"
    }

    private func digit(at index: Int) -> String {
        guard index < code.count else { return "" }
        let codeArray = Array(code)
        return String(codeArray[index])
    }

    // MARK: - Actions

    private func verifyCode() {
        guard code.count == 6 else { return }

        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await authService.verifyTwoFactorCode(code)
                isLoading = false
                onSuccess()
            } catch let error as AuthError {
                isLoading = false
                errorMessage = error.errorDescription
                code = ""  // Clear for retry
            } catch {
                isLoading = false
                errorMessage = "Verification failed"
                code = ""
            }
        }
    }

    private func resendCode() {
        Task {
            do {
                try await authService.sendTwoFactorCode()
                startResendCooldown()
            } catch {
                errorMessage = "Failed to resend code"
            }
        }
    }

    private func startResendCooldown() {
        resendCooldown = 60

        timer?.invalidate()
        timer = Timer.scheduledTimer(withTimeInterval: 1.0, repeats: true) { _ in
            if resendCooldown > 0 {
                resendCooldown -= 1
            } else {
                timer?.invalidate()
            }
        }
    }
}

// MARK: - Code Digit Box

struct CodeDigitBox: View {
    let digit: String
    let isFocused: Bool

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(hex: "1a1a2e"))
                .frame(width: 48, height: 56)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(isFocused ? Color.orange : Color.gray.opacity(0.3), lineWidth: isFocused ? 2 : 1)
                )

            Text(digit)
                .font(.system(size: 24, weight: .bold))
                .foregroundColor(.white)
        }
    }
}

// MARK: - 2FA Setup View

struct TwoFactorSetupView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var authService = AuthService.shared

    @State private var selectedMethod: String = "email"
    @State private var isLoading = false
    @State private var showVerification = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationView {
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                VStack(spacing: 24) {
                    // Header
                    VStack(spacing: 12) {
                        Image(systemName: "lock.shield.fill")
                            .font(.system(size: 50))
                            .foregroundColor(.orange)

                        Text("Enable Two-Factor Authentication")
                            .font(.system(size: 22, weight: .bold))
                            .foregroundColor(.white)

                        Text("Add an extra layer of security to your account")
                            .font(.system(size: 14))
                            .foregroundColor(.gray)
                            .multilineTextAlignment(.center)
                    }
                    .padding(.top, 32)

                    // Method selection
                    VStack(spacing: 12) {
                        Text("Choose verification method")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(.gray)
                            .frame(maxWidth: .infinity, alignment: .leading)

                        // Email option
                        TwoFactorMethodOption(
                            icon: "envelope.fill",
                            title: "Email",
                            subtitle: authService.userProfile?.email ?? "",
                            isSelected: selectedMethod == "email",
                            action: { selectedMethod = "email" }
                        )

                        // SMS option (if phone available)
                        if let phone = authService.userProfile?.phone, !phone.isEmpty {
                            TwoFactorMethodOption(
                                icon: "message.fill",
                                title: "SMS",
                                subtitle: phone,
                                isSelected: selectedMethod == "sms",
                                action: { selectedMethod = "sms" }
                            )
                        }
                    }
                    .padding(.horizontal, 24)

                    if let error = errorMessage {
                        Text(error)
                            .font(.system(size: 14))
                            .foregroundColor(.red)
                    }

                    Spacer()

                    // Enable button
                    Button(action: enable2FA) {
                        HStack {
                            if isLoading {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .white))
                            } else {
                                Text("Enable 2FA")
                                    .font(.system(size: 16, weight: .semibold))
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 14)
                        .background(Color.orange)
                        .foregroundColor(.white)
                        .cornerRadius(12)
                    }
                    .disabled(isLoading)
                    .padding(.horizontal, 24)
                    .padding(.bottom, 32)
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
            .sheet(isPresented: $showVerification) {
                TwoFactorView(onSuccess: {
                    showVerification = false
                    dismiss()
                })
            }
        }
    }

    private func enable2FA() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await authService.enableTwoFactor(method: selectedMethod)
                try await authService.sendTwoFactorCode()
                isLoading = false
                showVerification = true
            } catch {
                isLoading = false
                errorMessage = "Failed to enable 2FA"
            }
        }
    }
}

struct TwoFactorMethodOption: View {
    let icon: String
    let title: String
    let subtitle: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: icon)
                    .font(.system(size: 24))
                    .foregroundColor(isSelected ? .orange : .gray)
                    .frame(width: 40)

                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundColor(.white)

                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundColor(.gray)
                }

                Spacer()

                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .foregroundColor(isSelected ? .orange : .gray)
                    .font(.system(size: 22))
            }
            .padding()
            .background(Color(hex: "1a1a2e"))
            .cornerRadius(12)
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(isSelected ? Color.orange : Color.gray.opacity(0.3), lineWidth: isSelected ? 2 : 1)
            )
        }
    }
}

#Preview {
    TwoFactorView(onSuccess: {})
}
