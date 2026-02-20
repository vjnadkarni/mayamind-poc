# MayaMind — Your Ally at Home

**Executive Summary | Version 1.01 | February 2026 | CONFIDENTIAL**

---

## THE PROBLEM

One in three U.S. seniors report feeling lonely, and only 28% of adults 75+ meet physical activity guidelines. Social isolation increases mortality risk by 29% and dementia risk by 45% — health impacts equivalent to smoking 15 cigarettes per day. The professional caregiver shortage is projected to grow 22% through 2032, and home health aides cost $25–30/hour, making regular in-person companionship financially prohibitive for most families. For rural seniors, these challenges are dramatically amplified by geographic isolation.

## THE SOLUTION

MayaMind is an AI-powered companion and wellness platform for seniors, delivered entirely through a single iPad. It combines a lifelike, emotionally responsive 3D AI avatar with camera-based exercise coaching — two capabilities no competitor offers together. The iPad's front camera doubles as a "smart mirror," showing seniors their own form with real-time coaching overlay. Pose estimation runs on-device; video never leaves the home.

**AI Companion**
Emotionally responsive 3D avatar rendered on-device using TalkingHead (open-source ThreeJS/WebGL) that adapts to mood, remembers life stories, and provides daily engagement through personalized content. Emotion detection is performed through real-time analysis of the user's transcribed speech by the LLM — no separate emotion detection service required.

**Exercise Coach**
iPad's front camera creates a "smart mirror" — seniors see themselves exercising with real-time form overlay powered by MediaPipe pose estimation running entirely on-device. Optional record-and-review shows progress over time.

**Family and Friends Bridge**
Automated daily summaries keep family members and friends connected to their loved one's activities, mood, and exercise progress. Authorized professionals (coaches, trainers, physicians) can access workout data and trends through a dedicated web portal.

## TECHNOLOGY

MayaMind's architecture maximizes on-device processing, keeping cloud costs low and privacy strong:

| Component | Technology | Where It Runs |
|-----------|-----------|---------------|
| AI Avatar | TalkingHead (ThreeJS/WebGL) | On-device |
| Speech Recognition | Apple Speech Framework | On-device |
| Pose Estimation | MediaPipe | On-device (Neural Engine) |
| LLM | Claude API (Anthropic) | Cloud |
| Text-to-Speech | ElevenLabs | Cloud |
| Emotion Detection | Text-based analysis via Claude | Cloud (piggybacked on LLM call) |
| Data Storage | Local SQLite + Supabase (opt-in) | On-device + Cloud |

Three of six components run entirely on-device with zero API cost. Emotion detection is piggybacked on the LLM call at no additional cost. Only two cloud APIs (Claude and ElevenLabs) incur per-use charges. The core conversation loop — speech recognition, LLM response, text-to-speech, and avatar lip-sync — has been validated in a working proof-of-concept with sub-3-second end-to-end response latency.

## ONE DEVICE. ZERO COMPLEXITY.

The entire MayaMind system is a single iPad (10th gen, $349) — display, camera, microphone, speaker, and Neural Engine for pose estimation in one device. No Mac Mini, no external camera, no cabling. Setup takes 10 minutes. This represents a 65% hardware cost reduction from the original Mac Mini architecture, saving $128K–$148K per 200-unit institutional contract.

## ROLES AND ACCESS

MayaMind serves three distinct user roles, each with a dedicated interface:

| Role | Interface | Access |
|------|-----------|--------|
| **Senior (User)** | iPad app only | Full companion experience, exercise coaching, personal data |
| **Administrator** | Web portal only | User account management, system configuration, no workout data |
| **Authorized Professional** | Web portal only | Workout history, scores, trends, progress reports; no personal details (DOB, payment) |

Family members and friends receive automated daily summaries via email or SMS through the Family and Friends Bridge. A family web portal for viewing historical summaries and trends is planned for V1 commercial launch.

## DATA PRIVACY: OPT-IN CLOUD STORAGE

By default, all user data is stored locally on the iPad — visible only to the senior and no one else. Cloud storage via Supabase is opt-in: if the senior chooses to enable it, structured data (workout scores, exercise history, engagement trends) becomes accessible to authorized professionals and family members through the web portal. Exercise video is never transmitted to the cloud regardless of storage preference.

## MARKET OPPORTUNITY

| TAM | SAM | Year 3 SOM | RHT Program |
|-----|-----|------------|-------------|
| $14.9B / year | $4.27B / year | $2.9M–$6.7M | $50B over 5 years |
| 15.5M seniors living alone + assisted living | 4.45M addressable via consumer, B2B, and RHT channels | 3,000–7,000 units across all channels | Federal funding for rural health; aligns on 4 strategic goals |

## WHY MAYAMIND WINS

- **Only solution combining emotionally responsive avatar + camera-based exercise coaching.** ElliQ can't coach exercises; Meela has no visual presence.
- **Single-device simplicity:** One iPad replaces a three-device stack. 10-minute setup. No technical skill required from the senior.
- **Smart mirror exercise coaching:** Seniors see themselves on the iPad with real-time form overlay and can review recordings side-by-side with correct technique. No competitor offers this.
- **Privacy-first with opt-in sharing:** Exercise video processed on-device. Never transmitted. Structured data shared to the cloud only when the senior opts in.
- **Low cloud costs:** On-device avatar rendering (TalkingHead) and speech recognition (Apple Speech) eliminate the two most expensive cloud dependencies. Only LLM and TTS incur per-use charges.
- **Multi-stakeholder value:** Companionship for the senior, peace of mind for family and friends, wellness outcomes for the facility or state program, actionable data for authorized professionals.
- **Proven technology:** Core conversation loop (speech recognition → LLM → TTS → avatar lip-sync) validated in a working proof-of-concept with sub-3-second response latency.

## GO-TO-MARKET

| Phase 1: Pilot | Phase 2: Regional | Phase 3: Scale + RHT | Phase 4: RHT Activation |
|----------------|-------------------|---------------------|------------------------|
| Months 1–4 | Months 5–12 | Year 2 | Year 3 |
| 15–20 iPads in one Bay Area community. ~$15–18K budget. Validate PMF + cloud cost model. | Expand to 3–5 CA facilities. Launch D2C channel. Begin RHT relationship-building. | 20–40 facilities nationwide. Submit RHT proposals to 3–5 target states. | Execute first state RHT contracts (200–500 units/state). Pursue VC funding. |

## THE BOTTOM LINE

MayaMind addresses a $15B market with a differentiated product delivered through a single $349 iPad. On-device avatar rendering and speech recognition keep per-user cloud costs to a minimum — only LLM inference and text-to-speech incur cloud charges. The $50B Rural Health Transformation Program creates a federally-funded growth channel. Pilot budget is ~$15–18K. The goal: prove that AI companionship measurably reduces loneliness and improves fitness outcomes for seniors — then scale through commercial and government channels simultaneously.

---

**Contact:** Vijay Nadkarni, Co-Founder & CEO | MayaMind Inc. | vijay.nadkarni@mayamind.ai, M: +1 408-887-5600 | CONFIDENTIAL
