# MayaMind Companion — iPhone App

Lightweight companion app that reads Apple Watch health data via HealthKit and pushes it to the MayaMind server for display on the iPad dashboard.

## Prerequisites

- iPhone with Apple Watch paired (Series 9 or later)
- Xcode 15+ on Mac
- Apple Developer account (free or paid)
- MayaMind server running (default: `http://localhost:3000`)

## Setup

### 1. Create Xcode Project

1. Open Xcode → File → New → Project
2. Choose **iOS → App**
3. Settings:
   - Product Name: `MayaMindCompanion`
   - Organization Identifier: `com.mayamind` (or your own)
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **None**
4. Save to any location

### 2. Add Source Files

Replace the generated `ContentView.swift` and `MayaMindCompanionApp.swift` with the files from this directory:

- `MayaMindCompanionApp.swift`
- `ContentView.swift`
- `HealthKitManager.swift`
- `ServerConnection.swift`

Drag all 4 files into the Xcode project navigator, replacing existing files when prompted.

### 3. Add HealthKit Capability

1. Select the project in the navigator → select the target
2. Go to **Signing & Capabilities** tab
3. Click **+ Capability** → search for **HealthKit**
4. Check the **Background Delivery** checkbox under HealthKit

### 4. Add Entitlements

Copy `MayaMindCompanion.entitlements` into the project. In Build Settings, set **Code Signing Entitlements** to point to this file.

### 5. Update Info.plist

Add these keys to Info.plist (via Xcode's Info tab or raw plist):

```xml
<key>NSHealthShareUsageDescription</key>
<string>MayaMind reads your health data to display vitals on your iPad dashboard.</string>
<key>UIBackgroundModes</key>
<array>
    <string>processing</string>
    <string>fetch</string>
</array>
```

### 6. Set Team & Signing

Select your Apple Developer team in **Signing & Capabilities**. A free account works for personal devices.

### 7. Build & Run

1. Connect your iPhone via USB (or use wireless debugging)
2. Select your iPhone as the run destination
3. Build and run (Cmd+R)

**Note:** HealthKit does not work in the iOS Simulator. You must test on a physical iPhone with a paired Apple Watch.

## Usage

1. Launch the app on your iPhone
2. Enter the MayaMind server URL (e.g., `http://192.168.1.100:3000`)
3. Tap **Connect Health Data** → authorize all health categories
4. The app will push vitals to the server every 60 seconds
5. Open the Health section on the iPad dashboard to see real-time data

## Health Metrics Collected

| Metric | HealthKit Type | Update Frequency |
|--------|---------------|------------------|
| Heart Rate | HKQuantityTypeIdentifierHeartRate | ~5-10 min at rest |
| HRV | HKQuantityTypeIdentifierHeartRateVariabilitySDNN | Periodic |
| SpO2 | HKQuantityTypeIdentifierOxygenSaturation | Periodic |
| Steps | HKQuantityTypeIdentifierStepCount | Batched |
| Move Minutes | HKQuantityTypeIdentifierAppleMoveTime | Real-time |
| Exercise Minutes | HKQuantityTypeIdentifierAppleExerciseTime | Real-time |
| Sleep | HKCategoryTypeIdentifierSleepAnalysis | After sleep ends |

## Notes

- SpO2 may be unavailable on US Apple Watch Series 9+ (Masimo patent)
- Heart rate updates depend on Watch wear — more frequent during activity
- Sleep data reflects the most recent sleep session in the last 24 hours
- The app pushes data even when backgrounded (via HealthKit background delivery)
