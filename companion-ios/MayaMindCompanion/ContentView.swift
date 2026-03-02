import SwiftUI

struct ContentView: View {
    @EnvironmentObject var healthManager: HealthKitManager
    @EnvironmentObject var serverConnection: ServerConnection

    @State private var serverURL: String = UserDefaults.standard.string(forKey: "serverURL") ?? ""
    @State private var isEditing = false

    var body: some View {
        VStack(spacing: 32) {
            Spacer()

            // Logo
            Image(systemName: "heart.fill")
                .font(.system(size: 60))
                .foregroundColor(.pink)

            Text("MayaMind")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text("Companion")
                .font(.title2)
                .foregroundColor(.secondary)

            Spacer()

            // Connection status
            VStack(spacing: 16) {
                HStack {
                    Circle()
                        .fill(statusColor)
                        .frame(width: 12, height: 12)
                    Text(statusText)
                        .font(.headline)
                }

                if let lastPush = serverConnection.lastPushTime {
                    Text("Last update: \(lastPush, style: .relative) ago")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                if healthManager.isAuthorized {
                    Text("Tracking: HR, HRV, SpO2, Steps, Move, Exercise, Sleep")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                }
            }
            .padding()
            .background(Color(.systemGray6))
            .cornerRadius(16)

            // Server URL
            VStack(alignment: .leading, spacing: 8) {
                Text("Server URL")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack {
                    TextField("http://192.168.1.x:3000", text: $serverURL)
                        .textFieldStyle(.roundedBorder)
                        .autocapitalization(.none)
                        .disableAutocorrection(true)
                        .keyboardType(.URL)
                        .onChange(of: serverURL) { newValue in
                            UserDefaults.standard.set(newValue, forKey: "serverURL")
                            serverConnection.serverURL = newValue
                        }
                }
            }
            .padding(.horizontal)

            // Connect button
            if !healthManager.isAuthorized {
                Button(action: {
                    Task {
                        try? await healthManager.requestAuthorization()
                        healthManager.startObserving()
                    }
                }) {
                    Text("Connect Health Data")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.pink)
                        .cornerRadius(14)
                }
                .padding(.horizontal)
            } else if !serverConnection.isConnected && !serverURL.isEmpty {
                Button(action: {
                    serverConnection.serverURL = serverURL
                    healthManager.startObserving()
                }) {
                    Text("Start Sending Data")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(maxWidth: .infinity)
                        .padding()
                        .background(Color.green)
                        .cornerRadius(14)
                }
                .padding(.horizontal)
            }

            Spacer()
        }
        .padding()
        .onAppear {
            serverConnection.serverURL = serverURL
        }
    }

    var statusColor: Color {
        if serverConnection.isConnected { return .green }
        if healthManager.isAuthorized { return .orange }
        return .gray
    }

    var statusText: String {
        if serverConnection.isConnected { return "Connected to MayaMind" }
        if healthManager.isAuthorized { return "Health data authorized" }
        return "Not connected"
    }
}
