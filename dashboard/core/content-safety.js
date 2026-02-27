/**
 * MayaMind Content Safety Filter
 *
 * Detects banned categories and sensitive topics to protect seniors.
 * Maya should never store content from banned categories and should
 * politely redirect conversations away from harmful topics.
 */

import { personalization } from './personalization-store.js';

// ═══════════════════════════════════════════════════════════════════════════
// BANNED CATEGORY PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patterns for content that should never be stored or engaged with.
 * Note: These are simplified patterns. Production should use more comprehensive lists.
 */
const BANNED_CATEGORY_PATTERNS = {
  profanity: /\b(fuck|shit|ass|damn|hell|bitch|bastard|crap)\b/gi,

  sexual: /\b(porn|xxx|nude|naked|erotic|sexual|sex\s*act|masturbat|orgasm)\b/gi,

  violence: /\b(murder|torture|gore|mutilat|dismember|decapitat|slaughter)\b/gi,

  hate_speech: /\b(nigger|kike|spic|chink|wetback|faggot|dyke|tranny|retard)\b/gi,

  illegal_activity: /\b(drug\s*deal|trafficking|how\s*to\s*make\s*bomb|counterfeit|fraud\s*scheme)\b/gi
};

// ═══════════════════════════════════════════════════════════════════════════
// SENSITIVE TOPICS (Require Special Handling)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Topics that need careful, compassionate responses rather than redirection.
 */
const SENSITIVE_TOPICS = {
  self_harm: {
    detect: /\b(want\s*to\s*die|kill\s*myself|end\s*my\s*life|suicide|suicidal|hurt\s*myself|self[- ]?harm|no\s*reason\s*to\s*live|better\s*off\s*dead)\b/gi,
    response: "I'm concerned about what you're sharing. You matter to me, and I want you to be safe. Would you consider calling the 988 Suicide & Crisis Lifeline? They're available 24/7 and can help. You can call or text 988.",
    action: 'escalate',
    priority: 1
  },

  elder_abuse: {
    detect: /\b(hits?\s*me|beats?\s*me|takes?\s*my\s*money|won'?t\s*let\s*me\s*leave|hurts?\s*me|locks?\s*me|threatens?\s*me|yells?\s*at\s*me\s*all|controls?\s*everything|steal|stole\s*from\s*me)\b/gi,
    response: "I'm sorry you're going through this. What you're describing sounds serious and you deserve to be safe. Would you like me to share information about Adult Protective Services? They can help. You can reach them at 1-800-677-1116.",
    action: 'escalate',
    priority: 1
  },

  scam: {
    detect: /\b(send\s*money|wire\s*transfer|gift\s*cards?|won\s*lottery|nigerian|prince|inheritance|claim\s*your\s*prize|verify\s*your\s*account|irs\s*calling|social\s*security\s*suspend|grandson\s*in\s*jail|granddaughter\s*in\s*trouble)\b/gi,
    response: "I want to make sure you're protected. What you're describing sounds like it could be a scam. Scammers often target seniors with these kinds of stories. Please don't send any money or gift cards. Would you like to talk about how to recognize and avoid scams?",
    action: 'warn',
    priority: 2
  },

  loneliness_depression: {
    detect: /\b(so\s*lonely|no\s*one\s*cares|nobody\s*visits|all\s*alone|feel\s*worthless|hate\s*my\s*life|nothing\s*to\s*live\s*for|everyone\s*forgot|abandoned)\b/gi,
    response: "I hear that you're going through a difficult time, and I want you to know that your feelings are valid. I'm here for you. Would you like to talk about what's been on your mind?",
    action: 'support',
    priority: 2
  },

  medication_misuse: {
    detect: /\b(extra\s*pill|double\s*dose|skip\s*my\s*medication|stop\s*taking|mix\s*with\s*alcohol|someone\s*else'?s\s*pills|ran\s*out\s*of\s*pills|can'?t\s*afford\s*medication)\b/gi,
    response: "It's important to take medications exactly as your doctor prescribed. Changing how you take them can be dangerous. Have you talked to your doctor about this? I'd encourage you to give them a call.",
    action: 'warn',
    priority: 2
  },

  confusion_cognitive: {
    detect: /\b(where\s*am\s*i|who\s*are\s*you|what\s*day\s*is\s*it|forgot\s*how\s*to|can'?t\s*remember\s*anything|don'?t\s*recognize|lost\s*again|keep\s*forgetting)\b/gi,
    response: null, // No specific response - just be patient and helpful
    action: 'adapt',
    priority: 3
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// REDIRECTION TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

const REDIRECTION_RESPONSES = {
  gentle_deflection: [
    "It sounds like something's on your mind. What's been going on today?",
    "I'm here to listen. Is there something else you'd like to talk about?",
    "Let's focus on something more positive. How has your week been going?"
  ],

  topic_change: [
    "Let's talk about something else. How's your family doing?",
    "I'd rather chat about something different. Have you done anything fun lately?",
    "Let's change the subject. Tell me about your day so far."
  ],

  compassionate_boundary: [
    "I'm not really one for that kind of conversation, but I'd love to hear about something else.",
    "That's not something I can help with, but I'm happy to chat about other things.",
    "I'd prefer we talk about something else. What have you been up to?"
  ],

  political_neutral: [
    "I try to stay out of politics. What else is on your mind today?",
    "That's a topic where people have strong feelings. I'd rather hear about you.",
    "I don't have opinions on political matters. Tell me about something you enjoy."
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SAFETY CHECK FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check content for safety issues
 * @param {string} text - The text to check
 * @returns {Object} Safety check results
 */
export function checkContentSafety(text) {
  const result = {
    safe: true,
    bannedCategories: [],
    sensitiveTopics: [],
    suggestedResponse: null,
    action: null,
    priority: null
  };

  if (!text || typeof text !== 'string') {
    return result;
  }

  // Check banned categories
  for (const [category, pattern] of Object.entries(BANNED_CATEGORY_PATTERNS)) {
    // Reset regex state (important for global regexes)
    pattern.lastIndex = 0;
    if (pattern.test(text)) {
      result.safe = false;
      result.bannedCategories.push(category);
    }
  }

  // Check sensitive topics (these still allow engagement but need special handling)
  for (const [topic, config] of Object.entries(SENSITIVE_TOPICS)) {
    config.detect.lastIndex = 0;
    if (config.detect.test(text)) {
      result.sensitiveTopics.push(topic);

      // Use highest priority response
      if (result.priority === null || config.priority < result.priority) {
        result.suggestedResponse = config.response;
        result.action = config.action;
        result.priority = config.priority;
      }
    }
  }

  return result;
}

/**
 * Get a redirection response
 * @param {string} type - Type of redirection
 * @param {Object} context - Optional context for personalization
 * @returns {string} A redirection response
 */
export function getRedirectionResponse(type, context = {}) {
  const responses = REDIRECTION_RESPONSES[type];
  if (!responses || responses.length === 0) {
    return "Let's talk about something else. How are you doing today?";
  }

  // Pick a random response
  const response = responses[Math.floor(Math.random() * responses.length)];

  // If we have context about user's interests, try to personalize
  if (context.favoriteTopics && context.favoriteTopics.length > 0) {
    const topic = context.favoriteTopics[0];
    return `Let's talk about something else. How's your ${topic.display_name.toLowerCase()} going?`;
  }

  return response;
}

/**
 * Process content through safety filter before extraction
 * Returns null if content should not be processed
 */
export async function filterForExtraction(sessionTranscript) {
  const safety = checkContentSafety(sessionTranscript);

  if (!safety.safe) {
    console.log('[ContentSafety] Banned content detected:', safety.bannedCategories);

    // Log the safety event (no content, just category)
    try {
      for (const category of safety.bannedCategories) {
        personalization.logSafetyEvent('banned_content', category, 'blocked_extraction');
      }
    } catch (e) {
      console.warn('[ContentSafety] Could not log safety event:', e);
    }

    return {
      shouldProcess: false,
      safetyFlags: safety
    };
  }

  // For sensitive topics, we still process but flag them
  if (safety.sensitiveTopics.length > 0) {
    console.log('[ContentSafety] Sensitive topics detected:', safety.sensitiveTopics);

    try {
      for (const topic of safety.sensitiveTopics) {
        personalization.logSafetyEvent('sensitive_topic', topic, safety.action || 'flagged');
      }
    } catch (e) {
      console.warn('[ContentSafety] Could not log safety event:', e);
    }
  }

  return {
    shouldProcess: true,
    safetyFlags: safety
  };
}

/**
 * Handle a detected sensitive topic in real-time conversation
 */
export function handleSensitiveTopic(topic, context = {}) {
  const config = SENSITIVE_TOPICS[topic];
  if (!config) return null;

  return {
    response: config.response,
    action: config.action,
    priority: config.priority
  };
}

/**
 * Check if text contains any banned content
 */
export function containsBannedContent(text) {
  const result = checkContentSafety(text);
  return !result.safe;
}

/**
 * Check if text contains sensitive topics
 */
export function containsSensitiveTopics(text) {
  const result = checkContentSafety(text);
  return result.sensitiveTopics.length > 0;
}

/**
 * Get crisis resources for a specific topic
 */
export function getCrisisResources(topic) {
  const resources = {
    self_harm: {
      name: '988 Suicide & Crisis Lifeline',
      phone: '988',
      description: 'Call or text 988, available 24/7'
    },
    elder_abuse: {
      name: 'Eldercare Locator',
      phone: '1-800-677-1116',
      description: 'National resource for elder abuse prevention and support'
    },
    scam: {
      name: 'FTC Scam Reporting',
      phone: '1-877-382-4357',
      website: 'reportfraud.ftc.gov',
      description: 'Report scams to the Federal Trade Commission'
    },
    loneliness_depression: {
      name: 'SAMHSA National Helpline',
      phone: '1-800-662-4357',
      description: 'Free, confidential mental health support, 24/7'
    }
  };

  return resources[topic] || null;
}

// Export for testing
export const _internals = {
  BANNED_CATEGORY_PATTERNS,
  SENSITIVE_TOPICS,
  REDIRECTION_RESPONSES
};
