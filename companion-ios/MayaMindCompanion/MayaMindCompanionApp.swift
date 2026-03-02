import SwiftUI
import HealthKit

@main
struct MayaMindCompanionApp: App {
    @StateObject private var healthManager = HealthKitManager()
    @StateObject private var serverConnection = ServerConnection()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(healthManager)
                .environmentObject(serverConnection)
                .onAppear {
                    healthManager.serverConnection = serverConnection
                }
        }
    }
}
