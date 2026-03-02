import Foundation

/// Pushes health vitals to the MayaMind Express server via HTTP POST.
class ServerConnection: ObservableObject {
    @Published var serverURL: String = "" {
        didSet {
            UserDefaults.standard.set(serverURL, forKey: "serverURL")
        }
    }
    @Published var lastPushTime: Date? = nil
    @Published var isConnected: Bool = false

    private var consecutiveFailures = 0

    func push(_ payload: VitalsPayload) async {
        guard !serverURL.isEmpty else { return }

        let urlString = serverURL.hasSuffix("/")
            ? "\(serverURL)api/health/vitals"
            : "\(serverURL)/api/health/vitals"

        guard let url = URL(string: urlString) else {
            print("[ServerConnection] Invalid URL: \(urlString)")
            return
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 10

        do {
            let encoder = JSONEncoder()
            request.httpBody = try encoder.encode(payload)

            let (_, response) = try await URLSession.shared.data(for: request)

            if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
                await MainActor.run {
                    self.lastPushTime = Date()
                    self.isConnected = true
                    self.consecutiveFailures = 0
                }
                print("[ServerConnection] Push successful")
            } else {
                await handleFailure()
                print("[ServerConnection] Push failed: HTTP \((response as? HTTPURLResponse)?.statusCode ?? 0)")
            }
        } catch {
            await handleFailure()
            print("[ServerConnection] Push error: \(error.localizedDescription)")
        }
    }

    private func handleFailure() async {
        await MainActor.run {
            consecutiveFailures += 1
            if consecutiveFailures >= 3 {
                isConnected = false
            }
        }
    }
}
