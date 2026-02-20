# MayaMind — Your Ally at Home

**Product Requirements Document (PRD)**

**Version 1.04 | February 2026 | CONFIDENTIAL**

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Feature Requirements: Companion Engine](#2-feature-requirements-companion-engine)
3. [Feature Requirements: Exercise Coach](#3-feature-requirements-exercise-coach)
4. [Feature Requirements: Family and Friends Bridge](#4-feature-requirements-family-and-friends-bridge)
5. [Feature Requirements: Institutional Reporting Module](#5-feature-requirements-institutional-reporting-module)
6. [Role-Based Access Control (RBAC)](#6-role-based-access-control-rbac)
7. [Data Storage and Supabase Integration](#7-data-storage-and-supabase-integration)
8. [Reports for Authorized Professionals](#8-reports-for-authorized-professionals)
9. [Hardware and Infrastructure](#9-hardware-and-infrastructure)
10. [Privacy and Security Requirements](#10-privacy-and-security-requirements)
11. [Onboarding and User Experience](#11-onboarding-and-user-experience)
12. [Technical Requirements](#12-technical-requirements)
13. [Pilot Program Requirements](#13-pilot-program-requirements)
14. [Product Roadmap](#14-product-roadmap)
15. [Cloud Service Pricing Analysis (Planned)](#15-cloud-service-pricing-analysis-planned)
16. [Document Control](#16-document-control)

---

## 1. Product Overview

### 1.1 Product Vision

MayaMind is an AI-powered "Ally at Home" that provides emotionally intelligent companionship and guided exercise coaching for seniors. It combines a lifelike 3D AI avatar with real-time emotion detection and 3D pose estimation to create a product that addresses both the emotional and physical wellness needs of older adults living alone.

MayaMind's hardware architecture is a single device: the iPad (10th generation, $349). The iPad serves simultaneously as the display, camera, microphone, speaker, and on-device compute platform for avatar rendering, speech recognition, and pose estimation. This consolidation reduces hardware costs by approximately 65%, eliminates multi-device cabling and configuration, and transforms installation from a 30-minute technical process into a 10-minute setup.

The 3D avatar is rendered on-device using TalkingHead, an open-source ThreeJS/WebGL library that provides real-time lip-sync, facial expressions, and gesture animation without requiring any cloud rendering service. Speech recognition uses Apple's built-in Speech framework, running entirely on-device via the A14 Neural Engine. Emotion detection is performed through text-based analysis of the user's transcribed speech by the LLM (Claude), which tags each response with an appropriate mood — no separate emotion detection service is required.

Cloud dependencies are limited to two API services: the conversational LLM (Claude API) and text-to-speech (ElevenLabs). This architecture keeps per-user cloud costs low while maintaining high-quality conversational and voice experiences.

### 1.2 Product Principles

- **Companionship first, technology second.** The senior should feel like they're talking to a caring friend, not interacting with a device. Technology must be invisible.
- **Privacy is non-negotiable.** Pose estimation and avatar rendering run on-device via the iPad's Neural Engine and GPU. No exercise video is transmitted or stored (unless the user explicitly opts in to local recording). Cloud storage of structured data is opt-in only.
- **Supplement, never replace.** MayaMind enhances human connection; it never positions itself as a substitute for family, friends, or professional care.
- **Personalization drives retention.** Every interaction should reflect knowledge of the user's personality, interests, history, and preferences.
- **Accessibility is paramount.** The user should never need to press a button, navigate a menu, or troubleshoot. Voice-first, always available.
- **One device, zero complexity.** A single iPad is the entire system. No cables, no peripherals, no technical configuration for the senior.

### 1.3 System Architecture Overview

MayaMind is a native iPadOS application running on an iPad (10th generation) with Apple A14 Bionic processor (6-core CPU, 4-core GPU, 16-core Neural Engine). The system comprises five integrated subsystems:

- **Companion Engine (Hybrid — on-device + cloud):** 3D avatar rendered on-device via TalkingHead (ThreeJS/WebGL), speech recognition via Apple Speech framework (on-device), text-based emotion detection via Claude (cloud), large language model conversation via Claude API (cloud), and text-to-speech via ElevenLabs (cloud). Avatar lip-sync and facial expressions run entirely on-device.
- **Exercise Coach (On-Device):** 3D pose estimation (MediaPipe) running locally on the A14 Neural Engine via the iPad's 12MP landscape-oriented front camera at 30+ FPS. Rep counting, form analysis, exercise library, and progress tracking all processed on-device. No exercise video leaves the iPad.
- **Family and Friends Bridge (Hybrid):** Daily summary generation (cloud LLM), notification delivery (cloud), family and friends web portal (web app), activity and wellness reporting.
- **Institutional Reporting Module (Cloud):** Outcome measurement and reporting for state RHT programs and healthcare payers. Aggregated analytics, compliance dashboards, and CMS-compatible reporting formats.
- **Data Storage (Hybrid — on-device + opt-in cloud):** Local SQLite database on iPad for all user data by default. Opt-in Supabase cloud storage for authorized data sharing with professionals and family members.

### 1.4 Architecture Decision Record: iPad-Only (v1.02)

This section documents the rationale for the hardware architecture change from v1.01 to v1.02.

| Dimension | v1.01 (Mac Mini) | v1.02+ (iPad-Only) |
|-----------|------------------|-------------------|
| Hardware | Mac Mini M4 + USB camera + display | iPad 10th gen (single device) |
| Per-unit cost | ~$990–1,090 | ~$349 |
| Install time | ~30 minutes | ~10 minutes |
| Devices to connect | 3 (Mini + camera + display) | 1 (iPad) |
| Pose estimation | MediaPipe on M4 (≥15 FPS) | MediaPipe on A14 Neural Engine (30+ FPS) |
| Camera | External USB webcam | Built-in 12MP ultra-wide, landscape orientation, 122° FOV |
| Avatar rendering | Cloud (HeyGen LiveAvatar) | On-device (TalkingHead, ThreeJS/WebGL) |
| Emotion detection | Cloud (Hume AI, voice + facial) | Text-based via Claude (piggybacked on LLM call) |
| Speech recognition | Cloud (Deepgram) | On-device (Apple Speech framework) |
| Local LLM fallback | Ollama with 7B model (16GB RAM) | Not supported (4GB RAM). Not needed — exercise coaching runs on-device regardless. |
| Savings at 200-unit RHT contract | Baseline | $128K–$148K saved per contract |

**Key insight (v1.02):** The local LLM fallback in v1.01 was designed for connectivity outages. However, without cloud connectivity, the LLM cannot generate responses and TTS cannot synthesize speech — which means the companion experience is unavailable regardless of whether a local LLM is running. Therefore, reliable broadband is a hard prerequisite for the companion experience, and the local LLM is unnecessary. Exercise coaching runs entirely on-device and can continue during connectivity interruptions.

**Key insight (v1.04 — technology cost optimization):** The v1.02 architecture used HeyGen LiveAvatar for avatar rendering (cloud, per-minute pricing) and Hume AI for emotion detection (cloud, per-minute pricing). These two services represented the majority of projected per-user cloud costs. By switching to TalkingHead (on-device, open-source, zero API cost) for avatar rendering and text-based emotion detection via Claude (piggybacked on the existing LLM call, zero additional cost), per-user cloud costs are reduced to only LLM inference and TTS. This was validated in a working proof-of-concept that achieved sub-3-second end-to-end response latency.

**Emergent advantage — the mirror view:** With the Mac Mini + external camera architecture (v1.01), the camera was an input-only device pointed at the senior while the display showed the avatar separately. The senior could not see themselves exercising. With the iPad, the front camera and display are on the same device facing the user — creating a "smart mirror" effect. Seniors can see themselves performing exercises in real-time, with an intelligent overlay showing correct form. This enables two powerful features (EC-07, EC-08) that were architecturally impossible in v1.01 and that no competitor offers: real-time form overlay guidance and optional record-and-review with side-by-side comparison.

## 2. Feature Requirements: Companion Engine

Priority levels: P0 = Must-have for pilot launch, P1 = Required for commercial launch, P2 = Post-launch enhancement. Companion Engine requires cloud connectivity for LLM (Claude) and TTS (ElevenLabs). Avatar rendering and speech recognition run on-device.

### 2.1 AI Avatar and Conversation

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| CE-01 | Lifelike 3D AI avatar | A human-like 3D avatar displayed on the iPad's 10.9" Liquid Retina display that speaks, gestures, and maintains eye contact. Avatar selectable from a library of personas (age, gender, ethnicity). Rendered on-device via TalkingHead (ThreeJS/WebGL) — no cloud rendering required. | P0 | Pilot |
| CE-02 | Real-time conversation | Natural, low-latency voice conversation. Target response latency under 3 seconds end-to-end (validated in POC). Conversation should feel like talking to a friend, not a chatbot. | P0 | Pilot |
| CE-03 | Text-based emotion detection | Analyze user's emotional state from their transcribed speech in real-time. The LLM (Claude) detects emotion from the transcript and tags each response with an appropriate mood (e.g., [MOOD:happy], [MOOD:love]). The avatar adapts facial expression, and TTS voice settings adjust accordingly. No separate emotion detection service required. | P0 | Pilot |
| CE-04 | Long-term memory | Remember personal details across conversations: family names, life stories, preferences, health concerns, routines. Reference naturally. Memory stored in encrypted local SQLite database on iPad. | P0 | Pilot |
| CE-05 | Personality adaptation | Learn user's communication style over time and adapt accordingly (humor vs. deep conversation vs. light chat). | P1 | V1 Launch |
| CE-06 | Wake word activation | Respond to configurable wake word (default: "Hey Maya") for hands-free initiation from anywhere in the room. Uses iPad's built-in microphone with always-on local listening via Apple Speech framework. | P0 | Pilot |
| CE-07 | Proactive engagement | Initiate conversation at configurable times (morning greeting, afternoon check-in, evening wind-down) rather than only responding when spoken to. | P1 | V1 Launch |
| CE-08 | Multi-language support | English initially, Spanish as first additional language. Architecture supports easy language addition. | P2 | Post-launch |

### 2.2 Personalized Content and Engagement

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| PC-01 | Interest profiling | During onboarding and ongoing conversation, build a detailed profile of user's interests. Use to drive content recommendations. Profile stored locally on iPad. | P0 | Pilot |
| PC-02 | Recipe of the Day | Daily recipe tailored to dietary preferences and skill level. Present with enthusiasm and offer to walk through steps. | P1 | V1 Launch |
| PC-03 | Travel stories | Destination stories, cultural facts, and virtual tours. Reference places user has visited or expressed interest in. | P1 | V1 Launch |
| PC-04 | News and current events | Personalized news summaries based on user interests. Present conversationally. Avoid distressing content unless requested. | P1 | V1 Launch |
| PC-05 | Trivia and brain games | Interactive trivia, word games, and memory exercises personalized to knowledge areas and difficulty preference. Track and celebrate engagement. | P1 | V1 Launch |
| PC-06 | Music integration | Play music on request. Discuss music history, share artist stories, suggest new music based on preferences. | P2 | Post-launch |
| PC-07 | Life story capture | Encourage user to share life stories and memories. Store as personal narrative optionally shareable with family and friends. | P2 | Post-launch |
| PC-08 | Seasonal awareness | Recognize holidays, birthdays, anniversaries, and seasons. Proactively reference in conversation. | P1 | V1 Launch |

### 2.3 Daily Assistance

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| DA-01 | Medication reminders | Configurable medication reminders with gentle verbal prompts. Confirm acknowledgment. Log compliance for family dashboard. | P1 | V1 Launch |
| DA-02 | Appointment reminders | Remind user of upcoming medical appointments, social events, or family calls. Integrate with simple calendar. | P1 | V1 Launch |
| DA-03 | Weather and day planning | Proactively share weather information and suggest activities appropriate for conditions. | P1 | V1 Launch |
| DA-04 | General knowledge Q&A | Answer factual questions — health information, how-to, historical facts — with appropriate caveats for medical questions. | P0 | Pilot |

## 3. Feature Requirements: Exercise Coach

The Exercise Coach runs entirely on-device using the iPad's A14 Bionic Neural Engine and built-in 12MP front camera. No exercise video is transmitted to any cloud service. Because the iPad's camera and display face the user simultaneously, the senior exercises in front of a "smart mirror" — seeing themselves in real-time with intelligent form guidance overlaid. This mirror view capability was architecturally impossible with the previous Mac Mini + external camera configuration.

### 3.1 Pose Estimation and Movement Analysis

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| EC-01 | 3D pose estimation | Real-time 3D body pose estimation using MediaPipe on iPad's A14 Neural Engine. Track 33 body landmarks at 30+ FPS. All processing on-device. The iPad's 12MP ultra-wide front camera (122° FOV, landscape orientation) provides excellent capture for full-body exercise movements. | P0 | Pilot |
| EC-02 | Exercise recognition | Automatically identify which exercise the user is performing from a library of supported exercises. | P0 | Pilot |
| EC-03 | Rep counting | Accurately count repetitions using joint angle analysis and movement phase detection. | P0 | Pilot |
| EC-04 | Form assessment | Analyze body angles and positions against correct form models. Provide real-time verbal feedback on technique via iPad speaker. | P0 | Pilot |
| EC-05 | Camera positioning guide | Help user position the iPad correctly before starting exercises using on-screen guidance and verbal instructions. Recommend propping iPad on a stable surface at waist-to-chest height, 6–8 feet away. | P0 | Pilot |
| EC-06 | Occlusion handling | Gracefully handle situations where body parts are occluded. Notify user if tracking quality degrades below threshold. | P1 | V1 Launch |
| EC-07 | Mirror view with form overlay | Display the senior's live camera feed on the iPad screen during exercise (mirror view), with a semi-transparent skeleton overlay showing ideal joint positions and movement path for the current exercise. Alternatively, use split-screen or picture-in-picture to show the avatar demonstrating correct form alongside the senior's live view. The senior exercises in front of a "smart mirror" that shows them both what they're doing and what they should be doing. This feature is only possible because the iPad's camera and display face the user simultaneously. | P0 | Pilot |
| EC-08 | Record and review | Allow the senior to optionally record an exercise session, stored locally on the iPad only (never transmitted). After the session, display the recording side-by-side with the correct form demonstration so the senior can compare their technique. Recordings can be reviewed across sessions to visualize improvement over weeks. With explicit consent, recordings can be shared with a physical therapist or trainer for remote assessment. Recordings auto-delete after a configurable period (default: 30 days) to manage storage. | P1 | V1 Launch |

### 3.2 Exercise Library and Programs

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| EL-01 | Senior-appropriate exercise library | Curated library of exercises suitable for seniors: chair exercises, standing balance, gentle squats, wall push-ups, arm raises, seated stretches, yoga poses, and walking-in-place routines. | P0 | Pilot |
| EL-02 | Guided exercise sessions | The avatar guides user through complete exercise sessions, demonstrating movements, counting reps, and providing encouragement. During exercise, the iPad switches to mirror view (EC-07) showing the senior's live camera feed with form overlay. | P0 | Pilot |
| EL-03 | Adaptive difficulty | Adjust exercise difficulty based on performance history, energy level, and self-reported fitness level. | P1 | V1 Launch |
| EL-04 | Progress tracking | Track exercise frequency, duration, rep counts, and form improvement over time. Present progress in a motivating way. Data stored locally on iPad; synced to Supabase if cloud storage is opted in. | P0 | Pilot |
| EL-05 | Warm-up and cool-down | Include appropriate warm-up and cool-down routines before and after exercise sessions. | P1 | V1 Launch |
| EL-06 | Custom exercise programs | Allow authorized professionals (physical therapists, trainers) to prescribe specific exercise routines that the system guides the user through. Combined with record-and-review (EC-08), professionals can assess patient form remotely via shared recordings (with consent). | P2 | Post-launch |

### 3.3 Safety Considerations for Exercise

- **Medical disclaimer:** Clear verbal and written disclaimer that MayaMind is not a medical device. Users should consult their physician before starting any exercise program.
- **Exertion monitoring:** If the user appears to be struggling (detected via conversation or facial expression), the avatar should suggest slowing down or stopping.
- **No fall detection claims:** The system explicitly does not monitor for falls or medical emergencies. This must be clear in all marketing and user communications.
- **Emergency guidance:** If a user reports feeling unwell during exercise, the avatar should advise stopping immediately and offer to help contact a family member or suggest calling 911.
- **iPad stability:** Setup guidance must emphasize secure placement of the iPad during exercise sessions to prevent the device from falling. Optional iPad stand accessory recommended.
- **Recording privacy:** Exercise recordings (EC-08) are stored locally on the iPad only and never transmitted to any cloud service. Sharing with a professional or family member requires explicit user consent for each instance. The user is verbally informed when recording begins and can stop recording at any time. Recordings auto-delete after 30 days by default.

### 3.4 Supported Exercises (Pilot)

| Category | Exercises | Key Form Points |
|----------|----------|----------------|
| Lower body | Chair squats, standing squats, calf raises, side leg raises | Knee tracking, back posture, depth, balance |
| Upper body | Wall push-ups, arm raises, bicep curls, shoulder shrugs | Elbow alignment, range of motion, speed control |
| Balance | Single-leg stand, tandem stand, heel-to-toe walk | Posture, duration, stability |
| Flexibility | Seated stretches, standing hamstring, arm across chest, neck rotations | Range of motion, breathing, hold duration |
| Chair exercises | Seated marching, leg extensions, arm circles, seated twists | Posture, range, consistency |

## 4. Feature Requirements: Family and Friends Bridge

### 4.1 Daily Activity Summaries

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| FB-01 | Automated daily summary | Generate and send a daily summary to designated family members and friends. Includes: conversation highlights, mood indicators, exercise activity, and notable events. Tone warm and informative, not clinical. | P0 | Pilot |
| FB-02 | Configurable summary content | Allow senior (or family) to configure what is included. Sensitive topics excluded by default with opt-in. | P1 | V1 Launch |
| FB-03 | Multiple recipient support | Support sending summaries to multiple family members and friends with potentially different content levels. | P1 | V1 Launch |
| FB-04 | Summary delivery options | Support email, SMS, and push notification delivery. | P1 | V1 Launch |

### 4.2 Family and Friends Engagement Features

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| FE-01 | Connection prompts | Avatar gently suggests user call or message a family member or friend. Frequency configurable. | P1 | V1 Launch |
| FE-02 | Message relay | User can ask avatar to send a short message to a family member or friend via text or notification. | P1 | V1 Launch |
| FE-03 | Family and friends web portal | Web application where family members and friends view activity history, exercise progress, mood trends, and conversation summaries. Requires opt-in cloud storage. | P1 | V1 Launch |
| FE-04 | Video call facilitation | Help user initiate FaceTime calls to family members directly from the iPad, reducing the technical barrier. | P2 | Post-launch |

## 5. Feature Requirements: Institutional Reporting Module

Supports state RHT program deployments, healthcare payer contracts, and retirement community fleet management.

### 5.1 Outcome Measurement and Reporting

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| IR-01 | Aggregated analytics dashboard | Web-based dashboard showing aggregated (de-identified) engagement, exercise, and wellness data across deployed iPads. Filterable by region, time period, and cohort. | P1 | V1 Launch |
| IR-02 | Wellness outcome tracking | Integrate validated instruments (UCLA Loneliness Scale, PHQ-9, GAD-7) into periodic automated conversations. Score and trend over time. | P1 | V1 Launch |
| IR-03 | CMS-compatible reporting | Generate reports compatible with CMS RHT Program reporting requirements. Include outcome metrics, utilization data, and population health indicators. | P1 | RHT Launch |
| IR-04 | Physical fitness metrics | Track and report exercise frequency, duration, progression, and functional assessment results (e.g., 30-second chair stand test). Trend analysis at individual and cohort level. | P1 | V1 Launch |
| IR-05 | Configurable reporting periods | Support daily, weekly, monthly, and quarterly reporting cycles. | P1 | V1 Launch |
| IR-06 | Data export | Export aggregated data in CSV, PDF, and API formats for integration with state health information systems. | P1 | RHT Launch |

### 5.2 Fleet Management

| ID | Feature | Description | Pri | Phase |
|----|---------|-------------|-----|-------|
| FM-01 | Centralized device management | Dashboard for managing all deployed iPads: device health, connectivity status, software version, engagement levels. Alert when device goes offline or shows issues. Leverages Apple's MDM (Mobile Device Management) for iPadOS. | P1 | V1 Launch |
| FM-02 | Batch provisioning | Support rapid setup of multiple iPads for deployment via Apple Business Manager and MDM. Pre-configure settings, exercise programs, and reporting parameters for a cohort before physical distribution. | P1 | RHT Launch |
| FM-03 | Remote configuration | Remotely adjust settings, update exercise programs, or modify reporting parameters without a site visit. Critical for dispersed rural deployments. | P1 | V1 Launch |
| FM-04 | Role-based access | Support multiple access levels: MayaMind administrator, state program manager, facility coordinator, authorized professional, family member. Each role sees only appropriate data. See Section 6 for detailed RBAC specification. | P1 | RHT Launch |

## 6. Role-Based Access Control (RBAC)

MayaMind implements role-based access control to ensure each stakeholder sees only the data appropriate to their role. Authentication and authorization infrastructure supports all roles.

### 6.1 Role Definitions

| Role | Interface | Description |
|------|-----------|-------------|
| **Senior (User)** | iPad app only | The primary user. Full access to companion, exercise coaching, and personal data on their own iPad. No web portal access. |
| **Administrator** | Web portal only | MayaMind staff or facility coordinators. CRUD operations on user accounts, system configuration, device management. No access to workout data, conversation content, or personal health information. |
| **Authorized Professional** | Web portal only | Coaches, rehabilitation trainers, physical therapists, physicians. Read-only access to workout history, rep counts, form scores, and improvement trends for their assigned users. No access to personal details (date of birth, payment information, home address). |
| **Family and Friends** | Web portal + notifications | Family members and friends designated by the senior. Receive daily summaries via email/SMS. Web portal access (V1 Launch) for viewing activity history, mood trends, and exercise progress. No access to personal details or raw conversation transcripts. |

### 6.2 Access Control Matrix

| Data Category | Senior (User) | Administrator | Authorized Professional | Family and Friends |
|--------------|---------------|---------------|------------------------|-------------------|
| Personal profile (name, address, DOB) | Full access | Read/write | No access | No access |
| Payment information | Full access | Read/write | No access | No access |
| Conversation content | Full access | No access | No access | No access |
| Mood and engagement trends | Full access | Aggregate only | Read-only | Read-only (summary) |
| Workout history and scores | Full access | Aggregate only | Read-only (detailed) | Read-only (summary) |
| Exercise recordings (EC-08) | Full access | No access | Read-only (with consent) | No access |
| System configuration | No access | Full access | No access | No access |
| Device health and status | No access | Full access | No access | No access |

### 6.3 Authentication and Authorization

| ID | Requirement | Description | Pri | Phase |
|----|------------|-------------|-----|-------|
| RBAC-01 | Senior authentication | iPad app uses device-level authentication (Face ID, passcode) combined with MayaMind profile selection. No username/password for the senior. | P0 | Pilot |
| RBAC-02 | Web portal authentication | Administrators, authorized professionals, and family members authenticate via email + password with multi-factor authentication (MFA). | P0 | Pilot |
| RBAC-03 | Authorization enforcement | All API endpoints enforce role-based access. Backend validates role and scope on every request. | P0 | Pilot |
| RBAC-04 | Invitation-based onboarding | Authorized professionals and family members are invited by the administrator or senior. No self-registration. | P0 | Pilot |
| RBAC-05 | Audit logging | All data access by administrators and authorized professionals is logged with timestamp, user ID, and action. Logs retained for HIPAA compliance. | P1 | V1 Launch |

## 7. Data Storage and Supabase Integration

### 7.1 Default: On-Device Storage

By default, all user data is stored locally on the iPad in an encrypted SQLite database. This includes:

- User profile and preferences
- Conversation memory and history
- Exercise history, rep counts, and form scores
- Mood and engagement data
- Interest profiles and personalization data

In this default configuration, data is visible only to the senior on their own iPad. No data is transmitted to any cloud service. No authorized professionals, family members, or administrators can view individual user data.

### 7.2 Opt-In: Cloud Storage via Supabase

When the senior opts in to cloud storage, structured data is synced to Supabase (PostgreSQL-based cloud database) to enable data sharing with authorized stakeholders:

| ID | Requirement | Description | Pri | Phase |
|----|------------|-------------|-----|-------|
| DS-01 | Opt-in consent | Cloud storage requires explicit opt-in by the senior during onboarding or at any time via voice command. The avatar explains what data will be shared and with whom. Opt-in can be revoked at any time. | P0 | Pilot |
| DS-02 | Selective sync | Only structured data is synced to Supabase: workout scores, exercise history, engagement metrics, mood trends. Raw conversation transcripts are never synced. Exercise video is never synced. | P0 | Pilot |
| DS-03 | Encryption in transit and at rest | All data synced to Supabase is encrypted via TLS 1.3 in transit and AES-256 at rest. Supabase row-level security (RLS) enforces access controls. | P0 | Pilot |
| DS-04 | Data deletion | When a user revokes opt-in or cancels service, all cloud data is deleted from Supabase within 30 days. User can request immediate deletion. | P0 | Pilot |
| DS-05 | Offline resilience | If WiFi is unavailable, data accumulates locally and syncs to Supabase when connectivity is restored. No data loss. | P1 | V1 Launch |

### 7.3 Supabase Schema (Core Tables)

| Table | Description | Synced to Cloud |
|-------|-------------|----------------|
| `users` | User profile: name, contact info, preferences | Only if opted in |
| `workout_sessions` | Exercise sessions: date, duration, exercises performed | Only if opted in |
| `workout_scores` | Per-exercise scores: rep count, form score, quality rating | Only if opted in |
| `engagement_metrics` | Daily engagement: conversation minutes, session count | Only if opted in |
| `mood_history` | Mood detections over time: mood tag, timestamp | Only if opted in |
| `authorized_access` | RBAC assignments: which professionals/family have access to which users | Always (required for RBAC) |
| `audit_log` | Access log: who viewed what data, when | Always (required for compliance) |

## 8. Reports for Authorized Professionals

Authorized professionals (coaches, trainers, physicians) access reports through the web portal. Reports are available only for users who have opted in to cloud storage.

### 8.1 Report Definitions

| Report | Description | Content | Frequency |
|--------|-------------|---------|-----------|
| **Workout History** | Chronological log of all exercise sessions | Date, duration, exercises performed, total reps, overall session score | Updated per session |
| **Exercise Scores and Trends** | Per-exercise performance over time | Rep counts, form scores, quality ratings, trend graphs showing improvement or decline | Updated per session |
| **Engagement Summary** | Overview of user's interaction with MayaMind | Daily conversation minutes, session frequency, feature usage (companion vs. exercise vs. content) | Daily |
| **Mood and Wellness Trends** | Emotional state patterns over time | Mood distribution (happy, neutral, sad, etc.), trend over days/weeks, notable shifts | Daily |
| **Exercise Progress Report** | Periodic assessment of physical improvement | Comparison of form scores and rep counts over 7-day, 30-day, and 90-day windows; improvement percentage; areas needing attention | Weekly |
| **Functional Assessment** | Standardized fitness test results | 30-second chair stand test results, timed balance tests, tracked over time with norms comparison | Per assessment |

### 8.2 Report Access Controls

- Authorized professionals see reports only for users explicitly assigned to them.
- Reports contain no personal identifying information beyond the user's first name (or chosen display name).
- Date of birth, home address, payment information, and conversation transcripts are never included in reports.
- All report access is audit-logged.

### 8.3 Report Formats

- **Web portal:** Interactive dashboards with charts and tables.
- **Export:** PDF and CSV for offline review or integration with clinical systems.
- **API:** REST API for programmatic access (V1 Launch), enabling integration with electronic health record (EHR) systems.

## 9. Hardware and Infrastructure

### 9.1 Hardware: iPad (10th Generation)

The entire MayaMind system runs on a single iPad (10th generation). No additional hardware is required.

| Component | Specification | Purpose |
|-----------|--------------|---------|
| Processor | Apple A14 Bionic: 6-core CPU, 4-core GPU, 16-core Neural Engine (11 TOPS) | On-device pose estimation, avatar rendering, speech recognition |
| Display | 10.9" Liquid Retina, 2360x1640, True Tone | Avatar display, exercise mirror view |
| Front camera | 12MP ultra-wide, 122° FOV, landscape orientation, Center Stage | Pose estimation for exercise |
| Microphone | Built-in dual microphones | Voice input, wake word detection |
| Speaker | Landscape stereo speakers | Avatar voice output, exercise coaching audio |
| Connectivity | WiFi 6 (802.11ax), Bluetooth 5.2, USB-C | Cloud API access, optional external speaker |
| Storage | 64GB (base) or 256GB | App, user profiles, conversation memory, exercise data |
| Battery | ~10 hours active use | All-day operation; charging overnight or via USB-C |
| Cost | $349 (64GB WiFi) | 65% reduction from v1.01 hardware stack |

Optional accessory: iPad stand ($15–30) for stable positioning during exercise sessions and hands-free conversation. Recommended but not required.

### 9.2 On-Device Processing

The following runs locally on the iPad with no cloud dependency:

- **Avatar rendering:** TalkingHead (ThreeJS/WebGL) renders the 3D avatar with real-time lip-sync, facial expressions, and gesture animation via the A14 GPU. No cloud rendering service required.
- **Speech recognition:** Apple Speech framework runs on the A14 Neural Engine for real-time speech-to-text. Audio never leaves the device.
- **Pose estimation:** MediaPipe 3D pose estimation at 30+ FPS via the A14 Neural Engine. 33 body landmarks tracked in real-time through the front camera.
- **Exercise logic:** Rep counting, form analysis, exercise recognition, and progress tracking all processed locally.
- **Data storage:** User profiles, conversation memory (SQLite), exercise history, and preference data stored in encrypted local storage on the iPad.
- **Wake word detection:** Always-on local microphone listening for the wake word, processed on-device via Apple Speech.

### 9.3 Cloud Services (Required for Companion Experience)

The following cloud services are required for MayaMind's companion experience. Reliable WiFi is a hard prerequisite for conversation.

- **LLM inference:** Claude API (Anthropic) for conversation generation. This is the primary cloud dependency for the companion experience.
- **Text-to-speech:** ElevenLabs API for natural voice synthesis with word-level timestamps for lip-sync.
- **Content services:** News, recipes, weather, and other content APIs.
- **Family and friends notifications:** Email, SMS, and push notification delivery.
- **Data sync (opt-in):** Supabase for cloud storage when user opts in.
- **Institutional reporting:** Data sync to aggregated analytics dashboard and CMS reporting systems.

If WiFi connectivity is lost, the iPad app should display a friendly message ("I'm having trouble connecting right now. Let me try again in a moment.") and retry automatically. Exercise sessions already in progress can continue since pose estimation runs locally. A pricing analysis of cloud service costs with usage assumptions is planned as a separate workstream.

### 9.4 Device Management

- **MDM enrollment:** All deployed iPads enrolled in Apple Business Manager and managed via MDM (e.g., Jamf, Mosyle, or Apple Business Essentials) for remote management.
- **Automatic app updates:** MayaMind app updates pushed via MDM or TestFlight (pilot phase), scheduled during low-usage hours.
- **Remote diagnostics:** Support team can remotely view device health, connectivity status, and app logs without a service visit.
- **Guided Access / Kiosk mode:** iPad locked to the MayaMind app via iPadOS Guided Access or MDM kiosk profile. The senior cannot accidentally navigate away from the app, install other apps, or change settings.
- **Connectivity monitoring:** Track bandwidth quality and uptime per device. Automatically flag units with persistent connectivity issues.

## 10. Privacy and Security Requirements

Privacy is the existential risk for MayaMind. The following requirements are non-negotiable.

| ID | Requirement | Description | Priority | Phase |
|----|------------|-------------|----------|-------|
| PR-01 | No video transmission | Camera video for pose estimation processed entirely on the iPad. Never transmitted to any cloud service. Core brand promise. | P0 | Pilot |
| PR-02 | No video storage (default) | Live camera video for pose estimation processed in real-time and immediately discarded. Exercise recordings (EC-08) stored locally on iPad only when user explicitly opts in; never transmitted to cloud. Recordings auto-delete after 30 days. Sharing with a professional requires per-instance consent. | P0 | Pilot |
| PR-03 | Conversation privacy | Transcripts stored locally on iPad for personalization. Raw transcripts are never synced to cloud, even with opt-in cloud storage. Only AI-generated summaries shared with family and friends, and only with user consent. | P0 | Pilot |
| PR-04 | Camera controls | On-screen indicator when camera is active. User can disable camera verbally. Camera auto-disables at designated times. | P0 | Pilot |
| PR-05 | Data encryption | All data stored on iPad encrypted at rest via iPadOS hardware encryption. All cloud communications use TLS 1.3. Supabase data encrypted at rest via AES-256. | P0 | Pilot |
| PR-06 | Data deletion | Upon cancellation, iPad remotely wiped via MDM. Cloud data in Supabase deleted within 30 days. User can request immediate deletion at any time. | P0 | Pilot |
| PR-07 | HIPAA compliance | Full HIPAA compliance for institutional deployments. BAA capability with state programs and healthcare payers. Audit logging, access controls, breach notification procedures. | P0 | V1 Launch |
| PR-08 | Privacy policy | Clear, plain-language privacy policy explaining data collection, processing, access, and deletion. Emphasis on opt-in model for cloud storage. | P0 | Pilot |
| PR-09 | De-identification | Institutional reporting uses only de-identified, aggregated data by default. Individual-level data shared only with explicit user consent. | P0 | RHT Launch |
| PR-10 | Opt-in cloud storage transparency | The avatar clearly explains what data will be synced to the cloud, who can see it, and how to revoke consent. Consent is granular (e.g., opt in for workout data but not mood data). | P0 | Pilot |

## 11. Onboarding and User Experience

### 11.1 Installation

The iPad-only architecture dramatically simplifies installation. The senior performs zero setup steps.

- Technician (or family member) removes iPad from box and powers on. MayaMind app is pre-installed and pre-configured via MDM.
- Technician connects to home WiFi network and verifies connectivity (speed test built into app).
- Technician places iPad on stand (or props on stable surface) at a comfortable viewing position.
- Technician taps "Start" to launch the MayaMind experience and facilitates a brief introductory conversation.
- Technician provides a simple one-page visual guide (large print) with basics: the wake word and how to ask for help.
- Target installation time: 10 minutes per unit (individual), 7 minutes per unit (batch deployment at a facility).

Note: For consumer/D2C sales, the adult child buyer may perform the setup themselves during a visit, guided by in-app instructions. No technician required for basic installation.

### 11.2 Rural and RHT Deployment Considerations

- **Broadband pre-qualification:** Verify minimum bandwidth (10 Mbps down / 5 Mbps up) before scheduling installation. This is a hard prerequisite — deployments to locations without reliable broadband are not supported.
- **Community hub model:** For rural areas where individual home broadband is unreliable, deploy at community hubs (libraries, churches, senior centers) where seniors can visit for sessions. iPads can be shared across multiple seniors with individual profile switching.
- **Regional installation:** For RHT deployments, contract with regional partners (HelloTech, Geek Squad, local IT) rather than deploying a centralized team. iPad setup is simple enough for non-specialist technicians.
- **Remote onboarding support:** A MayaMind team member joins the first 15 minutes of each installation remotely via FaceTime to ensure consistent quality.

### 11.3 First-Use Experience (Onboarding Conversation)

The avatar's first conversation with the user should:

- Feel like meeting a new friend, not filling out a form.
- Introduce itself with warmth and explain what it can do in simple terms.
- Ask about the user's name and preferred way to be addressed.
- Explore 3–5 interest areas through natural conversation.
- Ask about family members and friends the user would like to stay connected with.
- Explain cloud storage opt-in in simple terms: "Would you like your exercise progress to be shared with your family and your trainer? You can always change your mind later."
- Offer to try a brief, gentle exercise together to introduce the coaching feature.
- End with a warm goodbye and a preview of tomorrow's interaction.

Target onboarding conversation duration: 15–20 minutes. The system continues learning over the following weeks.

## 12. Technical Requirements

### 12.1 Performance Requirements

| Metric | Requirement | Notes |
|--------|------------|-------|
| Conversation latency | < 3 seconds end-to-end | From end of user speech to avatar response (validated in POC) |
| Pose estimation frame rate | ≥ 30 FPS (target); ≥ 15 FPS (minimum) | A14 Neural Engine expected to exceed 30 FPS |
| Avatar rendering quality | Lip-sync accuracy > 90% | Critical for natural appearance on 10.9" display |
| Wake word detection accuracy | > 95% true positive, < 2% false positive | In typical home environment with TV/radio |
| App availability | > 99.5% uptime | Excluding planned maintenance and WiFi outages |
| Speech recognition accuracy | > 95% word accuracy | Apple Speech framework on A14 Neural Engine |
| WiFi recovery | Auto-reconnect within 60 seconds | Display friendly message during outage |

### 12.2 Network Requirements

- **Minimum bandwidth:** 10 Mbps download, 5 Mbps upload (LLM API + TTS).
- **Recommended bandwidth:** 25+ Mbps download for optimal experience.
- **Latency:** < 100ms round-trip to cloud services for responsive conversation.
- **Connectivity required:** WiFi is a hard prerequisite for companion features (LLM + TTS). Exercise coaching runs on-device and can continue during brief connectivity interruptions.

Note: Bandwidth requirements are significantly lower than v1.02 because avatar rendering is on-device (TalkingHead) rather than cloud-streamed. Only LLM text responses and TTS audio are transmitted over the network.

### 12.3 Technology Stack

| Component | Technology | Notes |
|-----------|-----------|-------|
| Hardware platform | iPad (10th generation), A14 Bionic, iPadOS | Single device, $349 |
| App development | Swift / SwiftUI (native iPadOS app) | WKWebView for TalkingHead avatar rendering |
| AI avatar | TalkingHead (ThreeJS/WebGL, open-source) | On-device rendering, zero API cost |
| Speech recognition | Apple Speech framework | On-device, zero API cost |
| Emotion detection | Text-based analysis via Claude | Piggybacked on LLM call, zero additional cost |
| Pose estimation | MediaPipe Pose | On-device, A14 Neural Engine |
| LLM | Claude API (Anthropic) | Cloud, per-token pricing |
| Text-to-speech | ElevenLabs | Cloud, per-character pricing |
| Local database | SQLite | User data, exercise history, conversation memory |
| Cloud database | Supabase (PostgreSQL) | Opt-in cloud storage for data sharing |
| Web portals | React web app with REST API backend | Admin, authorized professional, and family portals |
| Institutional reporting | React dashboard + REST API + CMS-compatible export | Aggregated analytics |
| Device management | Apple Business Manager + MDM (Jamf / Mosyle / ABE) | Fleet management |
| Authentication | Supabase Auth | Email + password + MFA for web portal users |

Note: The shift from Python (v1.01) to Swift/SwiftUI (v1.02) reflects the move from a Mac Mini desktop application to a native iPadOS app. Swift is required for optimal Neural Engine access, camera integration, and App Store distribution. The TalkingHead avatar runs within a WKWebView embedded in the native app, leveraging the iPad's GPU for WebGL rendering.

## 13. Pilot Program Requirements

### 13.1 Pilot Scope

- **Duration:** 90 days (2-week onboarding, 6-week active engagement, 4-week measurement and retention testing).
- **Participants:** 15–20 active participants plus 10–15 control group at a single upscale Bay Area retirement community.
- **Participant criteria:** Living alone, physically capable of light exercise, willing and interested, reliable WiFi in unit.
- **Hardware per participant:** 1 iPad (10th gen, 64GB) + optional stand. Estimated hardware cost: ~$360–375 per unit.
- **Budget:** Approximately $12,000–15,000 (hardware $6K–7K reusable, API costs $3K–4K, support $3K–4K). Reduced from v1.03 estimate due to elimination of HeyGen and Hume AI cloud costs.
- **RHT readiness:** Pilot data structured to serve as evidence for RHT state program proposals in Year 2. Use validated instruments and CMS-compatible outcome measures from Day 1.

### 13.2 Pilot Measurements

| Category | Metrics | Method | Timing |
|----------|---------|--------|--------|
| Engagement | Daily interaction minutes, conversation frequency, exercise sessions | System analytics (automated) | Continuous |
| Wellness outcomes | UCLA Loneliness Scale, PHQ-9, GAD-7 | Validated surveys via avatar | Baseline, Day 45, Day 90 |
| Physical fitness | 30-second chair stand, exercise frequency | Functional assessment + system data | Baseline, Day 90 |
| Family engagement | Summary open rate, response rate | Notification analytics | Continuous |
| Willingness to pay | Price sensitivity, feature value, NPS | Structured interviews | Day 75–90 |
| Cloud service costs | Per-user API costs (Claude, ElevenLabs) by usage pattern | Billing analytics | Continuous |

## 14. Product Roadmap

| Phase | Timeline | Key Deliverables |
|-------|----------|-----------------|
| **MVP / Pilot** | Months 1–4 | Native iPadOS app with core companion (CE-01–CE-04, CE-06), exercise coach with mirror view and form overlay (EC-01–EC-05, EC-07, EL-01, EL-02, EL-04), daily summaries (FB-01), RBAC foundation (RBAC-01–RBAC-04), opt-in Supabase cloud storage (DS-01–DS-04), privacy foundation (PR-01–PR-06, PR-08, PR-10). Cloud service cost tracking. Pilot data structured for RHT evidence. |
| **V1 Commercial Launch** | Months 5–8 | All P1 features: proactive engagement, personalized content, medication reminders, family and friends web portal, adaptive exercise, record-and-review with side-by-side comparison (EC-08), occlusion handling (EC-06), MDM fleet management (FM-01, FM-03), analytics dashboard (IR-01–IR-02, IR-04–IR-05), audit logging (RBAC-05). HIPAA compliance. App Store distribution. |
| **RHT Channel Launch** | Months 9–12 | CMS-compatible reporting (IR-03), data export (IR-06), batch provisioning via Apple Business Manager (FM-02), full role-based access (FM-04), de-identification (PR-09). First state RHT proposals submitted. |
| **V2 Enhancement** | Months 13–18 | P2 features: multi-language, life story capture, music integration, custom exercise programs, FaceTime video call facilitation. First RHT contracts executed. |
| **V3 Platform Expansion** | Months 19–24 | Physical therapy integration, cognitive health monitoring, multi-state RHT deployment at scale, healthcare payer channel activation. |

## 15. Cloud Service Pricing Analysis (Planned)

The on-device architecture for avatar rendering (TalkingHead) and speech recognition (Apple Speech) significantly reduces cloud costs compared to v1.02's dependency on HeyGen and Hume AI. A dedicated pricing analysis workstream is planned, covering:

- **Claude API:** Token-based pricing for conversation generation. Usage assumptions: 15–30 conversational exchanges per session, 2–3 sessions per day.
- **ElevenLabs:** Per-character pricing for text-to-speech. Usage concurrent with conversation (each LLM response is synthesized to speech).
- **Supabase:** Database hosting, storage, and auth. Free tier may suffice for pilot; Pro plan ($25/mo) for production.
- **Content APIs:** News, weather, recipe APIs — typically low-cost or free tier sufficient.
- **Notification delivery:** Email/SMS costs for daily family summaries — minimal per unit.

The pilot program will generate actual per-user cost data across these services, which will be used to set sustainable subscription pricing. The target is a per-user cloud cost of $15–30/month (significantly lower than the $30–50/month projected in v1.02, due to elimination of HeyGen and Hume AI), supporting a subscription price of $79–99/month with healthy margins.

## 16. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| v1.00 | Feb 14, 2026 | Vijay / Claude | Initial draft. Mac Mini M4 + USB camera + display architecture. |
| v1.01 | Feb 15, 2026 | Vijay / Claude | Added RHT Program: Institutional Reporting Module, fleet management, offline/rural mode (Ollama), HIPAA elevated to P0. |
| v1.02 | Feb 17, 2026 | Vijay / Claude | Major architecture change: iPad-only (single device). Removed Mac Mini, external camera, and local LLM. 65% hardware cost reduction. App platform changed from Python to Swift/SwiftUI. Added cloud pricing analysis section. Pilot budget reduced. |
| v1.03 | Feb 17, 2026 | Vijay / Claude | Added mirror view features enabled by iPad-only architecture: EC-07 (real-time form overlay on live camera feed, P0) and EC-08 (record-and-review with side-by-side comparison, P1). Updated privacy requirements for local recording. Added recording privacy to safety considerations. Documented mirror view as emergent advantage in ADR. |
| v1.04 | Feb 19, 2026 | Vijay / Claude | Major technology stack update: Replaced HeyGen LiveAvatar with TalkingHead (on-device, open-source). Replaced Hume AI emotion detection with text-based detection via Claude. Replaced Deepgram STT with Apple Speech (on-device). Added ElevenLabs as TTS. Added RBAC (Section 6) with User, Administrator, Authorized Professional, and Family and Friends roles. Added Supabase opt-in cloud storage (Section 7). Added report definitions for Authorized Professionals (Section 8). Renamed Family Bridge to Family and Friends Bridge. Updated privacy requirements for opt-in cloud model. Reduced pilot budget estimate. Updated cloud cost projections. POC validated sub-3-second conversation latency. |

---

*This is a living document. It will be updated as product requirements evolve through pilot learnings and market feedback.*
