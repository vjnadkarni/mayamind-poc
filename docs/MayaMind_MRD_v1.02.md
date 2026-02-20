# MayaMind — Your Ally at Home

**Market Requirements Document (MRD)**

**Version 1.02 | February 2026 | CONFIDENTIAL**

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Market Overview](#2-market-overview)
3. [Market Sizing](#3-market-sizing)
4. [Target Customer Segments](#4-target-customer-segments)
5. [Competitive Landscape](#5-competitive-landscape)
6. [Market Needs and Requirements](#6-market-needs-and-requirements)
7. [Pricing Strategy](#7-pricing-strategy)
8. [Go-to-Market Strategy](#8-go-to-market-strategy)
9. [Key Risks and Mitigation](#9-key-risks-and-mitigation)
10. [Success Metrics](#10-success-metrics)
11. [Document Control](#11-document-control)

---

## 1. Executive Summary

MayaMind is an AI-powered companion and wellness platform designed specifically for seniors living alone or in assisted living communities. The product combines a lifelike, emotionally responsive 3D AI avatar with camera-based exercise coaching to address two of the most critical challenges facing the aging population: social isolation and physical inactivity.

The system runs entirely on a single iPad (10th generation, $349), which serves simultaneously as the display, camera, microphone, speaker, and on-device compute platform. The iPad presents a human-like 3D avatar — rendered on-device using TalkingHead (open-source ThreeJS/WebGL) — capable of natural, real-time conversation. The avatar adapts to the user's emotions and mood using text-based emotion detection built into the LLM response, creating a companionship experience that is qualitatively different from existing voice-only or text-based solutions.

Users also access guided exercise coaching powered by MediaPipe 3D pose estimation running on the iPad's A14 Neural Engine, receiving real-time rep counting, form feedback, and technique assessment — all processed locally on the device for maximum privacy.

MayaMind uses role-based access control (RBAC) with three roles: Senior Users interact via the iPad app, Administrators manage accounts via a web portal, and Authorized Professionals (coaches, trainers, physicians) view workout data and progress reports via a web portal. Cloud data storage via Supabase is opt-in — by default, all data stays on the iPad.

A significant market opportunity has emerged with the $50 billion Rural Health Transformation (RHT) Program, announced by CMS in December 2025. This five-year federal initiative to strengthen rural healthcare aligns directly with MayaMind's capabilities in addressing social isolation, preventive health through exercise, and technology modernization — making it a compelling strategic channel for Year 2–3 growth.

This document defines the market opportunity, target customer segments, competitive landscape, and market requirements that MayaMind must address to achieve product-market fit and sustainable growth.

## 2. Market Overview

### 2.1 The Loneliness Crisis Among Seniors

Social isolation among older adults has been recognized as a public health crisis by the U.S. Surgeon General. Approximately one in three seniors report feeling lonely, and 24% are considered socially isolated. Chronic loneliness is associated with a 29% increase in mortality risk, a 45% increased risk of developing dementia, and health impacts comparable to smoking 15 cigarettes per day.

The problem is driven by multiple converging factors: the loss of a spouse (affecting approximately 800,000 Americans per year over age 65), reduced mobility limiting social outings, geographic distance from family members, and retirement eliminating workplace social connections.

Seniors who attend group activities such as yoga, cooking classes, or community events often do so as much for the social interaction as for the activity itself. However, these activities typically occupy only 1–2 hours of a day, leaving the remaining hours without meaningful social engagement. MayaMind is designed to fill this gap — the hours between structured activities when seniors are home alone.

### 2.2 Physical Inactivity in the Aging Population

Only 28% of adults aged 75 and older meet recommended physical activity guidelines. Regular exercise is one of the most evidence-backed interventions for senior health, reducing the risk of falls (the leading cause of injury death among adults 65+), improving cardiovascular health, maintaining cognitive function, and supporting independence.

The barrier is not lack of awareness but lack of motivation, guidance, and accountability. Home-based exercise programs suffer from low adherence rates (estimated at 30–50%) because seniors exercise alone without feedback or encouragement. An AI companion that also serves as an exercise coach addresses both the motivation gap and the guidance gap.

### 2.3 The Caregiver Shortage

The United States faces a significant and growing shortage of professional caregivers. The demand for home health aides is projected to grow 22% through 2032, far outpacing supply. The average cost of a home health aide is $25–30 per hour, making regular in-person companionship financially prohibitive for many families.

Adult children of aging parents face enormous stress balancing their own lives with concern for their parents' well-being. They represent a highly motivated economic buyer for a product that provides both companionship and wellness support, with daily activity updates that provide peace of mind.

### 2.4 Market Growth Indicators

The global market for AI-powered solutions in elderly care is expected to reach $2.249 billion by 2030. The broader AgeTech market is projected to grow to $2 trillion. The U.S. population aged 65+ currently stands at approximately 55 million and is growing rapidly as Baby Boomers age. These macro trends indicate a large, expanding, and increasingly technology-receptive market.

### 2.5 The Rural Health Opportunity

More than 60 million Americans live in rural areas, where the challenges of senior isolation and healthcare access are dramatically amplified. Rural seniors face greater geographic distances from family, fewer community programs and senior centers, longer drives to social activities, and more limited access to in-person care. A 76-year-old widow living on a farm 40 miles from the nearest town faces a qualitatively different loneliness challenge than her urban counterpart.

In December 2025, CMS announced the Rural Health Transformation (RHT) Program, a landmark $50 billion federal initiative to strengthen healthcare in rural communities across all 50 states. The program allocates $10 billion per year from 2026 through 2030, with first-year state awards averaging $200 million (ranging from $147 million to $281 million). CMS has established a new Office of Rural Health Transformation to oversee the program.

The RHT Program's strategic goals align directly with MayaMind's capabilities across four dimensions:

- **Social isolation and mental health:** The program explicitly targets improved well-being for rural populations. MayaMind's companionship offering addresses the amplified loneliness crisis in rural communities where social programming is scarce.
- **Preventive care and fitness:** States are implementing evidence-based strategies including physical fitness programs and chronic disease prevention models. MayaMind's exercise coaching delivers guided physical activity directly into rural homes.
- **Technology modernization:** CMS encouraged states to invest in technology platforms that enhance care delivery. MayaMind represents exactly this type of innovative technology deployment.
- **Professional caregiver workforce supplementation:** Rural areas face the most acute professional caregiver shortages. MayaMind supplements overstretched rural health workforces with AI-powered daily companionship and wellness support.

Individual states — not companies — are the direct recipients of RHT funds. However, states are expected to distribute funding to local providers, technology vendors, and community health organizations. MayaMind's pathway is to position as a technology partner within state RHT implementation plans, targeting states with large rural senior populations and technology-forward proposals.

## 3. Market Sizing

### 3.1 Total Addressable Market (TAM)

The TAM encompasses the full revenue opportunity if MayaMind could serve every potential customer in its broadest market definition.

| Segment | Population | Annual Revenue Potential |
|---------|-----------|------------------------|
| U.S. adults 65+ living alone | ~14.7 million | $14.1B at $80/mo |
| Assisted living residents (U.S.) | ~850,000 | $816M at $80/mo |
| Rural seniors 65+ living alone | ~3.0 million | Included in above (overlapping segment) |
| **Total TAM** | **~15.5 million** | **~$14.9 billion** |

Note: Rural seniors are a subset of the total 65+ population but are highlighted separately because they represent a distinct sales channel through the RHT Program with dedicated federal funding. The global TAM (Europe, Japan, South Korea) would be substantially larger but is excluded from this initial analysis.

### 3.2 Serviceable Addressable Market (SAM)

The SAM narrows the TAM to segments MayaMind can realistically serve given its product characteristics, distribution capabilities, and pricing.

| Segment | Population | Annual Revenue Potential |
|---------|-----------|------------------------|
| Upscale assisted/independent living | ~250,000 | $240M at $80/mo |
| Seniors living alone (top income quartile with willing adult children) | ~3.7 million | $3.55B at $80/mo |
| Rural seniors accessible via RHT-funded state programs (broadband-connected) | ~500,000 | $480M at $80/mo |
| **Total SAM** | **~4.45 million** | **~$4.27 billion** |

Key assumptions: The rural RHT segment is constrained by broadband availability (approximately 75% of rural households have broadband) and the requirement that state programs choose to fund technology solutions like MayaMind. The estimate of 500,000 accessible rural seniors is conservative, reflecting broadband constraints and the reality that not all state programs will prioritize this type of technology.

### 3.3 Serviceable Obtainable Market (SOM)

The SOM represents realistic revenue MayaMind can capture within the first 3 years.

| Timeframe | Target Units | Monthly Revenue | Annual Revenue |
|-----------|-------------|----------------|----------------|
| Year 1 (Pilot + Launch) | 50–100 | $4K–$8K | $48K–$96K |
| Year 2 (Regional + RHT engagement) | 500–1,500 | $40K–$120K | $480K–$1.44M |
| Year 3 (Scaled + RHT contracts) | 3,000–7,000 | $240K–$560K | $2.88M–$6.72M |

Year 2–3 SOM reflects the potential contribution of RHT-funded state contracts, which could add 500–2,000 units in Year 3 alone if 2–3 state contracts are secured. A single state contract deploying MayaMind across rural communities could represent 200–500 units.

## 4. Target Customer Segments

### 4.1 Primary: Adult Children of Aging Parents

The primary economic buyer is the adult child (typically aged 45–65) concerned about a parent living alone. This segment is motivated by love, genuine concern for their parent's safety and emotional well-being, and a desire to stay connected despite geographic distance.

Key characteristics: Tech-comfortable, financially capable of $80–100/month, highly responsive to daily activity summaries, and likely to recommend the product to others in similar situations.

Purchasing trigger: Death of one parent leaving the other alone, a parent's health scare, observation of declining mood or mobility, or a doctor's recommendation.

### 4.2 Secondary: Assisted Living and Retirement Communities

Senior living facilities represent a concentrated B2B sales channel. A single facility may deploy 20–50 units. Facility administrators are motivated by resident satisfaction scores, competitive differentiation, and the potential to supplement overstretched staff.

Key characteristics: Longer sales cycles (3–6 months), procurement processes requiring ROI demonstration, strong potential for bulk pricing and multi-year contracts.

Purchasing trigger: Resident satisfaction surveys showing loneliness, competitive pressure, regulatory focus on wellness metrics, or staff shortages limiting social programming.

### 4.3 Tertiary: Healthcare Payers and Government Programs

Medicare Advantage plans, Area Agencies on Aging, and state health departments represent a longer-term channel motivated by reducing emergency room visits, hospital readmissions, and downstream health costs of social isolation. Programs like SilverSneakers provide a precedent for fitness program coverage under Medicare Advantage.

Timeline: This segment requires clinical evidence. Data from the pilot and subsequent deployments will be essential to unlock this channel, likely in Year 2–3.

### 4.4 Strategic: State Rural Health Programs (RHT Channel)

The $50 billion Rural Health Transformation Program creates a new, federally-funded channel for MayaMind deployment. Under this program, all 50 states have received awards to improve rural healthcare, with $10 billion distributed annually through 2030. States distribute these funds to local providers, technology vendors, community health centers, and rural health organizations.

The buyer: State rural health offices, state Medicaid agencies, and rural health organizations operating under state RHT implementation plans. These are institutional buyers with allocated federal budgets — MayaMind is not asking them to find money, but helping them deploy money they have already received.

Key characteristics: Government procurement processes (6–12 months), requirement for outcome measurement and reporting, potential for large-scale contracts (200–500+ units per state), multi-year funding commitments (through 2030), and need for HIPAA compliance.

Purchasing trigger: State RHT plans that prioritize technology modernization, social isolation interventions, or preventive fitness programs for rural seniors. Availability of pilot data demonstrating efficacy from MayaMind's initial deployments.

Target states (initial): States with large rural senior populations and technology-forward RHT plans, including Texas (4.3 million rural residents, largest total award), California (among the largest awards), Alaska, Montana, and states with disproportionately high per-capita rural funding such as Rhode Island and New Jersey.

Strategic value: Beyond direct revenue, RHT contracts provide government validation of MayaMind's efficacy, large-scale deployment data, and a reference base that accelerates sales into other channels. A successful RHT deployment in one state creates a replicable model for the remaining 49.

## 5. Competitive Landscape

### 5.1 Competitor Comparison

| Competitor | Form Factor | Companionship | Exercise | Emotion Detect. | Pricing |
|-----------|------------|--------------|---------|-----------------|---------|
| ElliQ | Robot + tablet | Yes (limited depth) | Videos only | No | $249 + $59/mo |
| Meela | Phone call only | Yes (voice, no visual) | No | No | B2B pricing |
| Hyodol | AI companion doll | Yes (voice + touch) | No | Limited | FDA-reg. (B2B) |
| Amazon Alexa | Smart speaker | Minimal (Q&A) | No | No | $30–250 HW |
| **MayaMind** | **iPad (single device)** | **Lifelike 3D avatar, deep conv.** | **Pose estimation + feedback** | **Yes (text-based, real-time)** | **~$80–100/mo** |

### 5.2 MayaMind's Competitive Differentiation

- **Visually present, emotionally responsive 3D avatar.** Unlike ElliQ (lamp-shaped robot), Meela (phone call), or Alexa (speaker), MayaMind presents a human-like 3D face rendered on-device that adapts in real-time to the user's emotional state based on analysis of their spoken words.
- **Integrated exercise coaching with pose estimation.** No competitor in the senior companion space offers camera-based exercise guidance with rep counting and form feedback.
- **On-device processing for privacy.** Avatar rendering (TalkingHead), speech recognition (Apple Speech), and pose estimation (MediaPipe) all run locally on the iPad. Exercise video never leaves the home. Cloud storage of structured data is opt-in only.
- **Single-device simplicity.** The entire system is one iPad ($349). No external camera, no separate display, no cabling. 10-minute setup.
- **Low cloud costs.** On-device avatar rendering and speech recognition eliminate the two most expensive cloud dependencies that competitors face. Only LLM inference and text-to-speech require cloud APIs.
- **Multi-channel market access including RHT.** MayaMind's combination of companionship, exercise coaching, and technology innovation positions it to access the $50B RHT Program — a funding channel that software-only companions (Meela) and single-purpose devices (ElliQ) are less well-suited to address.

## 6. Market Needs and Requirements

### 6.1 Core Market Needs

| ID | Need | Description | Priority |
|----|------|-------------|----------|
| MN-01 | Daily companionship | Consistent, engaging social interaction during hours spent alone, particularly between structured activities. | Critical |
| MN-02 | Emotional responsiveness | Companion must adapt to user's emotional state, providing uplifting engagement when down and matching energy when happy. | Critical |
| MN-03 | Guided physical activity | Accessible, safe exercise guidance at home with real-time feedback on form and technique. | High |
| MN-04 | Family and friends connectivity | Family members and friends need visibility into their loved one's daily well-being with automated updates providing peace of mind. | High |
| MN-05 | Privacy and trust | Assurance that cameras and AI do not compromise personal privacy or transmit sensitive data without explicit consent. | Critical |
| MN-06 | Zero-friction setup | Installable by technician with no action from senior. Ongoing use requires no technical knowledge. | High |
| MN-07 | Sustained engagement | Content and interactions must evolve and personalize to prevent novelty fatigue over months. | Critical |
| MN-08 | Rural connectivity resilience | System must function with reliable broadband (hard prerequisite). Exercise coaching runs on-device and can continue during brief connectivity interruptions. Companion features require cloud connectivity for LLM and TTS. | High (RHT channel) |
| MN-09 | Role-based access | Different stakeholders (seniors, administrators, professionals, family) need different views of the same data with appropriate access controls. | High |
| MN-10 | Authorized professional access | Coaches, trainers, and physicians need access to workout data, scores, and trends to support the senior's wellness program — without seeing personal details like date of birth or payment information. | High |

### 6.2 User Personas

**Persona 1: Margaret (The Senior User)**

Margaret is 76. She lost her husband two years ago and lives alone in an independent living community. She attends yoga twice a week and a cooking class on Thursdays, largely for the social interaction. The rest of her time is spent at home reading, watching television, and occasionally talking to her daughter. She feels lonely most afternoons and evenings. She uses an iPad to video-call her grandchildren but is not particularly tech-savvy.

What she needs: A companion that feels present and engaging, remembers her interests and life stories, encourages her to stay active, and requires no technical skill to use. She values her privacy and wants control over who can see her data.

**Persona 2: Sarah (The Adult Child / Buyer)**

Sarah is 49, lives 200 miles from Margaret, and works full-time. She worries about her mother constantly. She calls three times a week but feels guilty that it's not enough. She has researched assisted living but her mother is not ready for that level of care.

What she needs: Peace of mind. A daily summary of her mother's activities and mood. Confidence that her mother is staying active and engaged. Easy access via email summaries and a simple web portal.

**Persona 3: David (The Facility Administrator)**

David directs resident services at an upscale independent living community with 120 residents. Resident satisfaction surveys consistently flag loneliness. He needs technology solutions that enhance well-being without adding to staff workload.

What he needs: A turnkey solution that improves satisfaction scores, differentiates his facility, and provides measurable wellness outcomes for his board. An admin web portal to manage user accounts and view aggregate engagement data.

**Persona 4: Linda (The State Rural Health Director)**

Linda oversees her state's Rural Health Transformation Program implementation, managing a $200 million annual federal allocation. Her state has 1.2 million rural residents, a significant portion of whom are seniors living alone in communities where the nearest hospital may be 50+ miles away and the nearest senior center even farther. Her RHT plan includes technology modernization and preventive health initiatives, but she needs vendors who can deploy proven solutions at scale with measurable outcomes.

What she needs: A technology partner with demonstrated efficacy data who can deploy across multiple rural communities with minimal local infrastructure requirements. She needs solutions that address multiple RHT strategic goals simultaneously (loneliness, fitness, technology modernization) to maximize the impact of her funding allocation. She requires HIPAA compliance, outcome measurement capabilities, and the ability to report results to CMS.

**Persona 5: Dr. Chen (The Authorized Professional)**

Dr. Chen is a geriatric physical therapist who works with seniors at a retirement community. She prescribes exercise programs for her patients and needs to monitor their adherence and form quality between in-person visits.

What she needs: A web portal where she can view her patients' workout history, rep counts, form scores, and improvement trends — without seeing unrelated personal information like payment details or date of birth. She wants to be able to identify patients who are struggling and adjust their exercise programs remotely.

## 7. Pricing Strategy

### 7.1 Pricing Framework

| Component | Cost to MayaMind | Customer Price | Notes |
|-----------|-----------------|---------------|-------|
| iPad (10th gen, 64GB) | ~$349 | Included (leased) | Returned on cancellation |
| iPad stand (optional) | ~$15–30 | Included | Recommended for exercise |
| Monthly subscription | $20–40 (API + infra) | $79–$99/mo (TBD) | Companion + exercise |
| White-glove setup | $100–200 | Included or one-time | Critical for adoption |

Note: Per-user cloud costs are significantly lower than originally projected because avatar rendering (TalkingHead) and speech recognition (Apple Speech) run on-device at zero API cost. Only LLM inference (Claude) and text-to-speech (ElevenLabs) incur per-use cloud charges. This improves unit economics and supports a lower-cost subscription while maintaining healthy margins.

### 7.2 RHT Channel Pricing

State RHT contracts would use a different pricing structure than consumer or facility sales. Anticipated structure: per-unit monthly fee (potentially lower than consumer pricing at $60–80/month given volume) with state covering hardware costs from RHT funds, setup and installation costs bundled into the contract, and outcome reporting and compliance included in the service fee. Volume contracts (200+ units) would justify dedicated support personnel and lower per-unit economics. The five-year RHT funding window (2026–2030) supports multi-year contract structures that improve revenue predictability.

### 7.3 Pricing Validation

Final consumer pricing will be determined through a structured pilot testing three price points ($59, $79, $99/month) measuring both willingness to pay and 90-day retention. The value comparison strongly favors MayaMind: home health aides cost $25–30/hour, assisted living costs $4,000–8,000/month, and ElliQ charges $59/month for a significantly less capable product.

## 8. Go-to-Market Strategy

### 8.1 Phase 1: Pilot (Months 1–4)

Deploy 15–20 units in a single upscale Bay Area retirement community. Validate product-market fit, generate engagement and wellness outcome data, establish pricing, and produce testimonials and video content.

### 8.2 Phase 2: Regional Expansion (Months 5–12)

Using pilot data and reference accounts, expand to 3–5 additional facilities in California. Begin D2C channel through targeted digital marketing to adult children. Begin RHT relationship-building: attend rural health conferences, connect with state rural health offices, and build visibility in the rural health technology ecosystem.

### 8.3 Phase 3: Scaled Growth + RHT Engagement (Year 2)

Expand to 20–40 facilities nationwide. Launch D2C sales with partner installation services. Formally engage 3–5 target state RHT programs with pilot data and efficacy evidence. Submit proposals to be included as technology vendors within state RHT implementation plans. Begin HIPAA certification process if not already completed.

### 8.4 Phase 4: RHT Channel Activation (Year 3)

Execute first state RHT contracts, deploying 200–500 units per state across rural communities. Use successful deployments as case studies for expansion to additional states. Pursue VC/PE funding to accelerate both commercial and RHT channel growth. The combination of growing commercial revenue and government-validated efficacy data creates a compelling fundraising narrative.

### 8.5 Marketing Narrative

Core consumer narrative: "Your mother goes to yoga to see other people as much as to exercise. But the class ends, and she comes home to an empty house. MayaMind is the friend who's always there — someone who knows her, adapts to her mood, and can even guide her through her exercises between classes."

RHT channel narrative: "Your state received $200 million in RHT funding to improve rural health. A significant portion of your rural population is seniors living alone, experiencing isolation that drives depression, cognitive decline, and preventable health crises. MayaMind delivers AI-powered companionship and guided exercise coaching directly into their homes — addressing loneliness, physical inactivity, and the professional caregiver shortage simultaneously. And we have the data to prove it works."

## 9. Key Risks and Mitigation

| Risk | Impact | Likelihood | Mitigation | Owner |
|------|--------|-----------|------------|-------|
| Engagement decay | High | Medium | Personalized content, evolving conversation, exercise gamification | Product |
| Privacy breach or perception | Critical | Low | On-device processing by default, opt-in cloud storage, transparent policy, no video transmission | Eng / Legal |
| Tech adoption resistance | High | Medium | White-glove setup, zero-touch daily operation, family onboarding | Operations |
| API cost escalation | Medium | Low | Only 2 cloud APIs (Claude, ElevenLabs); on-device avatar and STT eliminate the costliest dependencies; volume pricing negotiations | Eng / Finance |
| Well-funded competitor | Medium | High | Single-device simplicity moat, first-mover in avatar + exercise, reference accounts | Strategy |
| AI replacing human connection concerns | Medium | High | Position as supplement, family and friends connectivity features, encourage real social interaction | Product / Mktg |
| Rural broadband limitations | High | High | Broadband pre-qualification before deployment, exercise coaching continues on-device during brief outages, community hub model for areas without home broadband | Engineering |
| Slow government procurement (RHT) | Medium | High | Begin relationship-building early (Year 1), maintain commercial revenue growth independent of RHT timeline, target multiple states in parallel | BD / Strategy |

## 10. Success Metrics

| Metric | Pilot Target | Year 1 Target | Measurement |
|--------|-------------|---------------|-------------|
| Daily engagement (min) | >20 min/day | >15 min/day | System analytics |
| Loneliness reduction (UCLA) | >30% improvement | >25% improvement | Validated survey |
| 90-day retention | >80% | >75% | Subscription data |
| Exercise sessions/week | >3/week | >2/week | System analytics |
| Family summary open rate | >70% | >60% | Email analytics |
| Net Promoter Score | >50 | >40 | Survey |
| RHT state engagements initiated | N/A | 3–5 states | BD pipeline tracking |

## 11. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| v1.00 | February 14, 2026 | Vijay / Claude | Initial draft |
| v1.01 | February 15, 2026 | Vijay / Claude | Added RHT Program as strategic market segment (Sec 2.5, 4.4, 7.2, 8.3–8.4). Revised SOM upward. Added rural persona, broadband risk, RHT pricing model, and RHT-specific go-to-market phases. |
| v1.02 | February 19, 2026 | Vijay / Claude | Replaced Mac Mini with iPad ($349) throughout. Updated technology stack: TalkingHead (on-device avatar), Apple Speech (on-device STT), ElevenLabs (TTS), text-based emotion detection via Claude (replaces Hume AI). Added RBAC roles (User, Administrator, Authorized Professional). Added Supabase opt-in cloud storage. Renamed Family Bridge to Family and Friends Bridge. Added Dr. Chen persona. Updated pricing to reflect lower cloud costs. Removed Ollama/local LLM references. |

---

*This is a living document. It will be updated as market conditions, competitive dynamics, and product strategy evolve.*
