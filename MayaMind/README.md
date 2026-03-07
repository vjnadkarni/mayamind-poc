# MayaMind iOS App

Universal iOS app for iPhone and iPad. AI-powered wellness companion for seniors.

## Architecture

- **iPhone (Portrait):** Tab-based navigation with Maya, Exercise, Health, Connect, Settings
- **iPad (Landscape):** Exercise-focused layout with camera + avatar coaching

## Requirements

- Xcode 26.2+
- iOS 17.0+
- Apple Developer account (for device testing)

## Project Setup

Since Xcode project files are complex to generate, follow these steps to create the project:

### Step 1: Create New Xcode Project

1. Open Xcode
2. File → New → Project
3. Select **App** (under iOS)
4. Configure:
   - Product Name: `MayaMind`
   - Team: `Vijay Jayant Nadkarni (L8U82DMVG9)`
   - Organization Identifier: `ai.mayamind`
   - Bundle Identifier: `ai.mayamind.app`
   - Interface: **SwiftUI**
   - Language: **Swift**
   - Storage: **None** (we'll add CloudKit manually)
   - ☐ Include Tests (optional)
5. Save to `mayamind-poc/MayaMind/`

### Step 2: Replace Generated Files

After Xcode creates the project:

1. **Delete** the auto-generated `MayaMindApp.swift` and `ContentView.swift`
2. **Add existing files** to the project:
   - Right-click on the `MayaMind` folder in Xcode
   - Select "Add Files to MayaMind..."
   - Navigate to `MayaMind/MayaMind/`
   - Select all folders: `App/`, `Core/`, `Features/`, `iPhone/`, `iPad/`, `WebView/`
   - ☑️ Copy items if needed: **NO** (uncheck)
   - ☑️ Create groups: **YES**
   - Add to targets: MayaMind

### Step 3: Configure Capabilities

1. Select the MayaMind project in the navigator
2. Select the MayaMind target
3. Go to **Signing & Capabilities**
4. Add capabilities:
   - **HealthKit** (check Background Delivery)
   - **iCloud** (check CloudKit, add container: `iCloud.ai.mayamind.app`)
   - **Push Notifications**
   - **Background Modes** (check Audio, Remote notifications)

### Step 4: Configure Info.plist

1. Copy content from `Resources/Info.plist` to the project's Info.plist
2. Or replace the file entirely

### Step 5: Add Entitlements

1. Copy `MayaMind.entitlements` to the project
2. In Build Settings, search for "Code Signing Entitlements"
3. Set value to `MayaMind/MayaMind.entitlements`

### Step 6: Add Web Assets

Create bundled web assets for TalkingHead and MediaPipe:

1. Create folder `Resources/WebAssets/` in Xcode
2. Copy from the web POC:
   - `dashboard/index.html` → `avatar.html` (modify for avatar-only)
   - All TalkingHead JS modules
   - MediaPipe WASM files
   - Avatar GLB file

### Step 7: Configure Build Settings

1. **Deployment Target:** iOS 17.0
2. **Supported Destinations:** iPhone, iPad
3. **Device Orientation:**
   - iPhone: Portrait only
   - iPad: Landscape Left, Landscape Right

## Project Structure

```
MayaMind/
├── App/
│   ├── MayaMindApp.swift          # App entry point
│   └── ContentView.swift          # Device-adaptive root view
├── Core/
│   ├── Services/
│   │   ├── SpeechRecognitionService.swift
│   │   ├── ClaudeAPIService.swift
│   │   ├── HealthKitService.swift
│   │   ├── WithingsService.swift
│   │   └── TwilioService.swift
│   ├── Managers/
│   │   ├── CloudKitManager.swift
│   │   └── AudioManager.swift
│   └── Models/
├── Features/
│   ├── Maya/
│   │   └── MayaView.swift
│   ├── Exercise/
│   │   └── ExerciseView.swift
│   ├── Health/
│   │   └── HealthView.swift
│   ├── Connect/
│   │   └── ConnectView.swift
│   └── Settings/
│       └── SettingsView.swift
├── iPhone/
│   └── iPhoneTabView.swift
├── iPad/
│   └── iPadMainView.swift
├── WebView/
│   ├── AvatarWebView.swift        # TalkingHead WKWebView
│   └── PoseWebView.swift          # MediaPipe WKWebView
└── Resources/
    ├── Info.plist
    ├── Assets.xcassets/
    └── WebAssets/                  # Bundled HTML/JS/WASM
```

## Development

### Running on Simulator

1. Select iPhone 15 or iPad Pro simulator
2. Build and run (⌘R)

Note: HealthKit doesn't work in Simulator. Use mock data for testing.

### Running on Device

1. Connect iPhone 12 or iPad
2. Select device in Xcode
3. Build and run (⌘R)

First run will prompt for permissions:
- Camera (Exercise)
- Microphone (Voice)
- Speech Recognition
- HealthKit

## Server Connection

The app connects to `https://companion.mayamind.ai` for:
- Claude API (conversation)
- ElevenLabs TTS (voice)
- Twilio WhatsApp (messaging)
- Withings OAuth (body composition)

All web assets (TalkingHead, MediaPipe) run locally in WKWebView.

## Testing

### Health Section
Without Apple Watch, use mock data in Settings or via server endpoint:
```
GET https://companion.mayamind.ai/api/health/test
```

### Exercise Section
Camera permission required. Point camera at yourself for pose detection.

### Connect Section
Requires WhatsApp messages to/from the production number (+1 341 201 4043).
