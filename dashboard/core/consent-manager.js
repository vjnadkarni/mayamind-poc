/**
 * MayaMind Consent Manager
 *
 * Manages the three-tier consent model for personalization.
 * Handles opt-in flows, consent reminders, and tier transitions.
 */

import { personalization } from './personalization-store.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSENT SCRIPTS
// ═══════════════════════════════════════════════════════════════════════════

const CONSENT_SCRIPTS = {
  tier_2_initial: `
I'd love to remember that for next time. Would you like me to remember your preferences so I can personalize our conversations?

Here's what that means:
I'll remember things you tell me directly, like your preferred name or exercise schedule.
Everything stays private, stored only on your device.
You can ask me what I remember anytime, and tell me to forget anything.
No one else can see this information, not even your family or doctors.

Would you like me to remember your preferences?
`.trim(),

  tier_2_confirm: "Great! I'll remember what you share with me. You can always ask 'Maya, what do you remember about me?' to see what I know, or tell me to forget anything.",

  tier_2_decline: "No problem. I'll keep our conversations private and won't remember anything between sessions. You can change your mind anytime.",

  tier_3_initial: `
I've noticed we've been having some great conversations. Would you like me to learn more about you over time?

Here's what that means:
I'll start to understand your communication style and what topics interest you.
I'll notice patterns that help me be a better companion.
I never store our actual conversations, just my understanding of you.
Everything stays completely private on your device.
You can tell me to stop learning anytime.

This helps me be more helpful and have more natural conversations with you. Would you like me to start learning about you?
`.trim(),

  tier_3_confirm: "Wonderful! I'll pay attention to what makes our conversations work well for you. Remember, you can always ask me to stop learning by saying 'Maya, stop learning about me.'",

  tier_3_decline: "That's perfectly fine. I'll continue remembering just the preferences you tell me directly."
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSENT FLOW STATE
// ═══════════════════════════════════════════════════════════════════════════

class ConsentManager {
  static instance = null;

  pendingConsent = null;  // Current consent flow in progress
  lastPromptTime = null;  // When we last prompted for consent

  static getInstance() {
    if (!ConsentManager.instance) {
      ConsentManager.instance = new ConsentManager();
    }
    return ConsentManager.instance;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSENT CHECKS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if we should prompt for Tier 2 consent
   */
  shouldPromptTier2() {
    const consent = personalization.getConsentSettings();

    // Already enabled
    if (consent.tier_2_enabled) return false;

    // Don't prompt too frequently
    if (this.lastPromptTime && Date.now() - this.lastPromptTime < 60000) {
      return false;
    }

    return true;
  }

  /**
   * Check if we should prompt for Tier 3 consent
   */
  shouldPromptTier3() {
    const consent = personalization.getConsentSettings();

    // Need Tier 2 first
    if (!consent.tier_2_enabled) return false;

    // Already enabled
    if (consent.tier_3_enabled) return false;

    // Check if user has been using Tier 2 for a while
    if (consent.tier_2_opted_in_at) {
      const tier2Date = new Date(consent.tier_2_opted_in_at);
      const daysSinceTier2 = (Date.now() - tier2Date) / (1000 * 60 * 60 * 24);

      // Wait at least 3 days before prompting for Tier 3
      if (daysSinceTier2 < 3) return false;
    }

    // Don't prompt too frequently
    if (this.lastPromptTime && Date.now() - this.lastPromptTime < 60000) {
      return false;
    }

    // Check if user has enough preferences to warrant Tier 3
    const stats = personalization.getStats();
    if (stats.preferences < 3) return false;

    return true;
  }

  /**
   * Check if we should show a consent reminder
   */
  shouldShowConsentReminder() {
    const consent = personalization.getConsentSettings();

    // Only show reminders for active personalization
    if (!consent.tier_2_enabled && !consent.tier_3_enabled) {
      return false;
    }

    // Check last reminder time (30 days)
    if (consent.last_consent_reminder) {
      const lastReminder = new Date(consent.last_consent_reminder);
      const daysSince = (Date.now() - lastReminder) / (1000 * 60 * 60 * 24);

      if (daysSince < 30) return false;
    } else {
      // Never reminded - check if it's been 30 days since opt-in
      const optInDate = consent.tier_3_enabled
        ? consent.tier_3_opted_in_at
        : consent.tier_2_opted_in_at;

      if (optInDate) {
        const daysSinceOptIn = (Date.now() - new Date(optInDate)) / (1000 * 60 * 60 * 24);
        if (daysSinceOptIn < 30) return false;
      }
    }

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSENT FLOWS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Start Tier 2 consent flow
   */
  startTier2Consent() {
    this.pendingConsent = 'tier_2';
    this.lastPromptTime = Date.now();

    return {
      script: CONSENT_SCRIPTS.tier_2_initial,
      expectingResponse: true,
      consentType: 'tier_2'
    };
  }

  /**
   * Start Tier 3 consent flow
   */
  startTier3Consent() {
    this.pendingConsent = 'tier_3';
    this.lastPromptTime = Date.now();

    return {
      script: CONSENT_SCRIPTS.tier_3_initial,
      expectingResponse: true,
      consentType: 'tier_3'
    };
  }

  /**
   * Process user response to consent prompt
   */
  processConsentResponse(response) {
    if (!this.pendingConsent) return null;

    const isAffirmative = this.isAffirmativeResponse(response);
    const consentType = this.pendingConsent;
    this.pendingConsent = null;

    if (consentType === 'tier_2') {
      if (isAffirmative) {
        personalization.enableTier2();
        return {
          accepted: true,
          script: CONSENT_SCRIPTS.tier_2_confirm,
          consentType: 'tier_2'
        };
      } else {
        return {
          accepted: false,
          script: CONSENT_SCRIPTS.tier_2_decline,
          consentType: 'tier_2'
        };
      }
    }

    if (consentType === 'tier_3') {
      if (isAffirmative) {
        personalization.enableTier3();
        return {
          accepted: true,
          script: CONSENT_SCRIPTS.tier_3_confirm,
          consentType: 'tier_3'
        };
      } else {
        return {
          accepted: false,
          script: CONSENT_SCRIPTS.tier_3_decline,
          consentType: 'tier_3'
        };
      }
    }

    return null;
  }

  /**
   * Cancel pending consent flow (also clears cooldown so retry can happen)
   */
  cancelPendingConsent() {
    this.pendingConsent = null;
    this.lastPromptTime = null;  // Clear cooldown for retry
  }

  /**
   * Check if we're waiting for a consent response
   */
  hasPendingConsent() {
    return this.pendingConsent !== null;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CONSENT REMINDERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Generate a consent reminder message
   */
  generateConsentReminder() {
    const consent = personalization.getConsentSettings();
    const prefs = personalization.getAllPreferences();

    // Build examples from what we know
    let examples = "";
    if (prefs.length > 0) {
      const examplePrefs = prefs.slice(0, 2);
      if (examplePrefs.length === 1) {
        examples = examplePrefs[0].value;
      } else {
        examples = `${examplePrefs[0].value} and ${examplePrefs[1].value}`;
      }
    }

    let reminder = "";

    if (consent.tier_3_enabled) {
      reminder = `By the way, I just want to check in. I've been learning about you over time`;
      if (examples) {
        reminder += `, like how you ${examples}`;
      }
      reminder += `. Is it still okay for me to keep learning? You can always tell me to forget anything.`;
    } else if (consent.tier_2_enabled) {
      reminder = `Just checking in. I remember that you `;
      if (examples) {
        reminder += examples;
      } else {
        reminder += "have some preferences";
      }
      reminder += `. Would you like me to keep remembering these things, or would you prefer I forget?`;
    }

    return reminder;
  }

  /**
   * Process response to consent reminder
   */
  processReminderResponse(response) {
    const isNegative = this.isNegativeResponse(response);
    const wantsToForget = /forget/i.test(response);

    if (isNegative || wantsToForget) {
      return {
        action: 'reset',
        script: "I understand. Would you like me to forget everything, or just stop learning new things?"
      };
    }

    // User confirmed, update reminder timestamp
    personalization.updateLastConsentReminder();

    return {
      action: 'confirmed',
      script: "Great, I'll keep things as they are. Just remember, you can always ask me what I know or tell me to forget anything."
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // RESPONSE ANALYSIS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Check if response is affirmative
   */
  isAffirmativeResponse(response) {
    if (!response) return false;

    const normalized = response.toLowerCase().trim();

    const affirmativePatterns = [
      /^yes/i,
      /^yeah/i,
      /^yep/i,
      /^sure/i,
      /^ok(ay)?/i,
      /^alright/i,
      /^go ahead/i,
      /^please/i,
      /^that('?s| would be) (great|fine|good|nice)/i,
      /^i('?d| would) like that/i,
      /^sounds good/i,
      /^definitely/i,
      /^absolutely/i,
      /^of course/i
    ];

    return affirmativePatterns.some(p => p.test(normalized));
  }

  /**
   * Check if response is negative
   */
  isNegativeResponse(response) {
    if (!response) return false;

    const normalized = response.toLowerCase().trim();

    const negativePatterns = [
      /^no/i,
      /^nope/i,
      /^nah/i,
      /^not really/i,
      /^i don'?t (think so|want)/i,
      /^maybe later/i,
      /^not (now|today|right now)/i,
      /^i'?m (not sure|unsure)/i,
      /^pass/i,
      /^skip/i
    ];

    return negativePatterns.some(p => p.test(normalized));
  }

  /**
   * Check if response is uncertain
   */
  isUncertainResponse(response) {
    if (!response) return false;

    const normalized = response.toLowerCase().trim();

    const uncertainPatterns = [
      /^(i'?m )?not sure/i,
      /^maybe/i,
      /^i don'?t know/i,
      /^what does that mean/i,
      /^can you explain/i,
      /^tell me more/i
    ];

    return uncertainPatterns.some(p => p.test(normalized));
  }
}

// Export singleton instance
export const consentManager = ConsentManager.getInstance();
export { ConsentManager };
