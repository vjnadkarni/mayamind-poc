//
//  RegisterView.swift
//  MayaMind
//
//  Registration screen for new users
//

import SwiftUI

struct RegisterView: View {
    @Environment(\.dismiss) private var dismiss
    @StateObject private var authService = AuthService.shared

    // Required fields
    @State private var name = ""
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""

    // Optional fields
    @State private var phone = ""
    @State private var streetAddress = ""
    @State private var city = ""
    @State private var state: USState = .CA
    @State private var zipCode = ""
    @State private var dateOfBirth: Date = Calendar.current.date(byAdding: .year, value: -65, to: Date()) ?? Date()
    @State private var includeDOB = false

    // UI state
    @State private var showPassword = false
    @State private var showConfirmPassword = false
    @State private var currentStep = 1
    @State private var isLoading = false
    @State private var errorMessage: String?
    @State private var showEmailSent = false

    var body: some View {
        NavigationView {
            ZStack {
                Color(hex: "0a0a10")
                    .ignoresSafeArea()

                if showEmailSent {
                    emailSentView
                } else {
                    ScrollView {
                        VStack(spacing: 24) {
                            // Progress indicator
                            HStack(spacing: 8) {
                                ForEach(1...2, id: \.self) { step in
                                    Circle()
                                        .fill(step <= currentStep ? Color.orange : Color.gray.opacity(0.3))
                                        .frame(width: 10, height: 10)
                                }
                            }
                            .padding(.top, 20)

                            // Title
                            Text(currentStep == 1 ? "Create Account" : "Additional Info")
                                .font(.system(size: 24, weight: .bold))
                                .foregroundColor(.white)

                            Text(currentStep == 1 ? "Enter your details to get started" : "Optional information (you can skip)")
                                .font(.system(size: 14))
                                .foregroundColor(.gray)

                            if currentStep == 1 {
                                step1View
                            } else {
                                step2View
                            }

                            // Error message
                            if let error = errorMessage {
                                Text(error)
                                    .font(.system(size: 14))
                                    .foregroundColor(.red)
                                    .multilineTextAlignment(.center)
                                    .padding(.horizontal)
                            }

                            // Action buttons
                            VStack(spacing: 12) {
                                Button(action: nextStep) {
                                    HStack {
                                        if isLoading {
                                            ProgressView()
                                                .progressViewStyle(CircularProgressViewStyle(tint: .white))
                                        } else {
                                            Text(currentStep == 1 ? "Next" : "Create Account")
                                                .font(.system(size: 16, weight: .semibold))
                                        }
                                    }
                                    .frame(maxWidth: .infinity)
                                    .padding(.vertical, 14)
                                    .background(canProceed ? Color.orange : Color.gray)
                                    .foregroundColor(.white)
                                    .cornerRadius(12)
                                }
                                .disabled(!canProceed || isLoading)

                                if currentStep == 2 {
                                    Button(action: { currentStep = 1 }) {
                                        Text("Back")
                                            .font(.system(size: 16))
                                            .foregroundColor(.gray)
                                    }
                                }
                            }
                            .padding(.horizontal, 24)
                            .padding(.top, 8)

                            Spacer(minLength: 40)
                        }
                    }
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

    // MARK: - Step 1: Required Fields

    private var step1View: some View {
        VStack(spacing: 16) {
            // Name
            AuthTextField(
                label: "Full Name",
                text: $name,
                placeholder: "John Smith",
                keyboardType: .default,
                textContentType: .name
            )

            // Email
            AuthTextField(
                label: "Email",
                text: $email,
                placeholder: "john@example.com",
                keyboardType: .emailAddress,
                textContentType: .emailAddress,
                autocapitalization: false
            )

            // Password
            AuthSecureField(
                label: "Password",
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
    }

    // MARK: - Step 2: Optional Fields

    private var step2View: some View {
        VStack(spacing: 16) {
            // Phone (optional)
            AuthTextField(
                label: "Phone Number (optional)",
                text: $phone,
                placeholder: "(555) 123-4567",
                keyboardType: .phonePad,
                textContentType: .telephoneNumber
            )

            Text("Adding a phone number enables SMS for 2FA")
                .font(.system(size: 12))
                .foregroundColor(.gray)
                .padding(.horizontal, 24)

            // Address (optional)
            AuthTextField(
                label: "Street Address (optional)",
                text: $streetAddress,
                placeholder: "123 Main Street",
                keyboardType: .default,
                textContentType: .streetAddressLine1
            )

            // City on its own row
            AuthTextField(
                label: "City",
                text: $city,
                placeholder: "City",
                keyboardType: .default,
                textContentType: .addressCity
            )

            // State and ZIP on second row
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("State")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.gray)

                    Picker("State", selection: $state) {
                        ForEach(USState.allCases, id: \.self) { st in
                            Text(st.rawValue).tag(st)
                        }
                    }
                    .pickerStyle(.menu)
                    .tint(.white)
                    .frame(maxWidth: .infinity)
                    .padding()
                    .background(Color(hex: "1a1a2e"))
                    .cornerRadius(12)
                }

                VStack(alignment: .leading, spacing: 8) {
                    Text("ZIP Code")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.gray)

                    TextField("12345", text: $zipCode)
                        .textFieldStyle(.plain)
                        .keyboardType(.numberPad)
                        .textContentType(.postalCode)
                        .foregroundColor(.white)
                        .padding()
                        .background(Color(hex: "1a1a2e"))
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                        )
                }
            }
            .padding(.horizontal, 24)

            // Date of Birth (optional)
            VStack(alignment: .leading, spacing: 8) {
                Toggle(isOn: $includeDOB) {
                    Text("Include Date of Birth (optional)")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundColor(.gray)
                }
                .tint(.orange)

                if includeDOB {
                    DatePicker(
                        "Date of Birth",
                        selection: $dateOfBirth,
                        displayedComponents: .date
                    )
                    .datePickerStyle(.compact)
                    .tint(.orange)
                    .padding()
                    .background(Color(hex: "1a1a2e"))
                    .cornerRadius(12)
                }
            }
            .padding(.horizontal, 24)
        }
    }

    // MARK: - Email Sent View

    private var emailSentView: some View {
        VStack(spacing: 24) {
            Spacer()

            Image(systemName: "envelope.badge.fill")
                .font(.system(size: 80))
                .foregroundColor(.green)

            Text("Verify Your Email")
                .font(.system(size: 28, weight: .bold))
                .foregroundColor(.white)

            Text("We've sent a verification link to")
                .font(.system(size: 16))
                .foregroundColor(.gray)

            Text(email)
                .font(.system(size: 18, weight: .semibold))
                .foregroundColor(.orange)

            Text("Click the link in the email to verify your account, then return here to sign in.")
                .font(.system(size: 14))
                .foregroundColor(.gray)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)

            Button(action: { dismiss() }) {
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

    private var canProceed: Bool {
        if currentStep == 1 {
            return !name.isEmpty &&
                   email.contains("@") &&
                   isValidPassword &&
                   password == confirmPassword
        }
        return true  // Step 2 is all optional
    }

    private var isValidPassword: Bool {
        password.count >= 8 &&
        password.rangeOfCharacter(from: .uppercaseLetters) != nil &&
        password.rangeOfCharacter(from: .decimalDigits) != nil
    }

    // MARK: - Actions

    private func nextStep() {
        errorMessage = nil

        if currentStep == 1 {
            currentStep = 2
        } else {
            register()
        }
    }

    private func register() {
        isLoading = true
        errorMessage = nil

        Task {
            do {
                try await authService.register(
                    name: name,
                    email: email,
                    password: password,
                    phone: phone.isEmpty ? nil : phone,
                    streetAddress: streetAddress.isEmpty ? nil : streetAddress,
                    city: city.isEmpty ? nil : city,
                    state: state.rawValue,
                    zipCode: zipCode.isEmpty ? nil : zipCode,
                    dateOfBirth: includeDOB ? dateOfBirth : nil
                )
            } catch AuthError.emailNotVerified {
                // Expected - show email sent view
                isLoading = false
                showEmailSent = true
            } catch let error as AuthError {
                isLoading = false
                errorMessage = error.errorDescription
            } catch {
                isLoading = false
                errorMessage = "Registration failed. Please try again."
            }
        }
    }
}

// MARK: - Helper Views

struct AuthTextField: View {
    let label: String
    @Binding var text: String
    var placeholder: String = ""
    var keyboardType: UIKeyboardType = .default
    var textContentType: UITextContentType? = nil
    var autocapitalization: Bool = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.gray)

            TextField(placeholder, text: $text)
                .textFieldStyle(.plain)
                .keyboardType(keyboardType)
                .textContentType(textContentType)
                .autocapitalization(autocapitalization ? .words : .none)
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
        .padding(.horizontal, 24)
    }
}

struct AuthSecureField: View {
    let label: String
    @Binding var text: String
    @Binding var showPassword: Bool
    var placeholder: String = ""

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.gray)

            HStack {
                if showPassword {
                    TextField(placeholder, text: $text)
                        .textFieldStyle(.plain)
                        .autocapitalization(.none)
                        .autocorrectionDisabled()
                } else {
                    SecureField(placeholder, text: $text)
                        .textFieldStyle(.plain)
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
        .padding(.horizontal, 24)
    }
}

struct PasswordRequirement: View {
    let met: Bool
    let text: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: met ? "checkmark.circle.fill" : "circle")
                .foregroundColor(met ? .green : .gray)
                .font(.system(size: 14))

            Text(text)
                .font(.system(size: 12))
                .foregroundColor(met ? .green : .gray)
        }
    }
}

#Preview {
    RegisterView()
}
