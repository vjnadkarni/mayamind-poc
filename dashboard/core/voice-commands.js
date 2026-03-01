/**
 * MayaMind Voice Commands for Personalization
 *
 * Handles voice-based commands for managing what Maya knows about the user.
 * Commands include listing preferences, forgetting data, and checking privacy level.
 */

import { personalization } from './personalization-store.js';

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

const VOICE_COMMAND_PATTERNS = {
  // Listing commands
  LIST_PREFERENCES: [
    /what do you (remember|know) about me/i,
    /what have you learned about me/i,
    /tell me what you know/i,
    /what do you have on me/i
  ],

  // Forgetting commands
  FORGET_LAST: [
    /forget that/i,
    /delete that/i,
    /remove that/i,
    /nevermind/i,
    /scratch that/i
  ],

  FORGET_ALL: [
    /forget everything( about me)?/i,
    /delete everything/i,
    /erase everything/i,
    /start fresh/i,
    /reset (my )?memory/i,
    /clear (all )?my data/i
  ],

  FORGET_TOPIC: [
    /forget (about )?(my |the )?(.+)/i,
    /stop remembering (about )?(my |the )?(.+)/i
  ],

  // Tier management
  STOP_LEARNING: [
    /stop learning about me/i,
    /stop watching me/i,
    /stop observing me/i,
    /don'?t learn (about|from) me/i
  ],

  START_LEARNING: [
    /start learning about me/i,
    /you can learn about me/i,
    /learn more about me/i
  ],

  // Status commands
  STATUS: [
    /what tier am i on/i,
    /what('?s| is) my privacy (level|setting)/i,
    /what do you track/i,
    /how much do you remember/i,
    /what('?s| is) my personalization (level|setting)/i
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect if text contains a voice command
 * @param {string} transcript - The speech transcript to check
 * @returns {Object|null} Command info or null if no command detected
 */
export function detectVoiceCommand(transcript) {
  if (!transcript || typeof transcript !== 'string') {
    return null;
  }

  const normalized = transcript.toLowerCase().trim();

  // Check each command type
  for (const [commandType, patterns] of Object.entries(VOICE_COMMAND_PATTERNS)) {
    for (const pattern of patterns) {
      const match = normalized.match(pattern);
      if (match) {
        return {
          type: commandType,
          match: match,
          fullText: transcript,
          // For FORGET_TOPIC, extract what to forget
          target: commandType === 'FORGET_TOPIC' ? match[3]?.trim() : null
        };
      }
    }
  }

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMAND HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle a detected voice command
 * @param {Object} command - Command from detectVoiceCommand
 * @returns {Object} Response with text and action
 */
export async function handleVoiceCommand(command) {
  if (!command || !command.type) {
    return null;
  }

  switch (command.type) {
    case 'LIST_PREFERENCES':
      return await handleListPreferences();

    case 'FORGET_LAST':
      return await handleForgetLast();

    case 'FORGET_ALL':
      return await handleForgetAll();

    case 'FORGET_TOPIC':
      return await handleForgetTopic(command.target);

    case 'STOP_LEARNING':
      return await handleStopLearning();

    case 'START_LEARNING':
      return await handleStartLearning();

    case 'STATUS':
      return await handleStatus();

    default:
      return null;
  }
}

/**
 * List all preferences
 */
async function handleListPreferences() {
  const consent = personalization.getConsentSettings();

  if (!consent.tier_2_enabled) {
    return {
      response: "I don't have any saved information about you because you haven't enabled personalization yet. Would you like me to start remembering your preferences?",
      action: 'prompt_tier_2'
    };
  }

  const prefs = personalization.getAllPreferences();

  if (prefs.length === 0) {
    const profiles = consent.tier_3_enabled ? personalization.getAllProfiles() : [];
    const topics = consent.tier_3_enabled ? personalization.getAllTopics() : [];

    if (profiles.length === 0 && topics.length === 0) {
      return {
        response: "I haven't learned anything about you yet. As we chat more, I'll remember things you tell me.",
        action: null
      };
    }
  }

  // Build response
  let response = "Here's what I remember about you: ";
  const items = [];

  // Add preferences
  for (const pref of prefs) {
    items.push(formatPreference(pref));
  }

  // Add profiles if Tier 3
  if (consent.tier_3_enabled) {
    const profiles = personalization.getAllProfiles();
    for (const profile of profiles) {
      items.push(`I've noticed that ${profile.summary_text.toLowerCase()}`);
    }

    const topics = personalization.getAllTopics();
    for (const topic of topics.filter(t => t.engagement_level === 'high')) {
      items.push(`You seem to really enjoy ${topic.display_name.toLowerCase()}`);
    }
  }

  if (items.length === 0) {
    response = "I don't have any specific memories stored yet. As we talk more, I'll learn about you.";
  } else if (items.length === 1) {
    response += items[0] + ".";
  } else {
    response += items.slice(0, -1).join(", ") + ", and " + items[items.length - 1] + ".";
  }

  response += " Would you like me to forget any of these?";

  return {
    response: response,
    action: null
  };
}

/**
 * Forget the most recently added item
 */
async function handleForgetLast() {
  const lastPref = personalization.getLastAddedPreference();

  if (lastPref) {
    personalization.deletePreference(lastPref.id);
    return {
      response: `Done. I've forgotten that ${formatPreference(lastPref)}.`,
      action: 'deleted_preference'
    };
  }

  return {
    response: "I don't have any recent information to forget.",
    action: null
  };
}

/**
 * Forget everything - reset to Tier 1
 */
async function handleForgetAll() {
  await personalization.resetToTier1();

  return {
    response: "Done. I've forgotten everything about you. We can start fresh whenever you're ready.",
    action: 'reset_complete'
  };
}

/**
 * Forget a specific topic or preference
 */
async function handleForgetTopic(target) {
  if (!target) {
    return {
      response: "I'm not sure what you'd like me to forget. Could you be more specific?",
      action: null
    };
  }

  // Try to find matching preference
  const prefs = personalization.getAllPreferences();
  const matchingPref = prefs.find(p =>
    p.key.toLowerCase().includes(target.toLowerCase()) ||
    p.value.toLowerCase().includes(target.toLowerCase())
  );

  if (matchingPref) {
    personalization.deletePreference(matchingPref.id);
    return {
      response: `Done. I've forgotten about ${formatPreference(matchingPref)}.`,
      action: 'deleted_preference'
    };
  }

  // Try to find matching topic
  const topics = personalization.getAllTopics();
  const matchingTopic = topics.find(t =>
    t.topic_tag.includes(target.toLowerCase()) ||
    t.display_name.toLowerCase().includes(target.toLowerCase())
  );

  if (matchingTopic) {
    personalization.deleteTopic(matchingTopic.topic_tag);
    return {
      response: `Done. I've forgotten about your interest in ${matchingTopic.display_name}.`,
      action: 'deleted_topic'
    };
  }

  return {
    response: `I don't have any information about "${target}" stored. Would you like me to tell you what I do remember?`,
    action: null
  };
}

/**
 * Stop learning (revoke Tier 3, keep Tier 2)
 */
async function handleStopLearning() {
  const consent = personalization.getConsentSettings();

  if (!consent.tier_3_enabled) {
    return {
      response: "I'm not currently learning patterns about you. I only remember things you tell me directly.",
      action: null
    };
  }

  await personalization.revokeTier3();

  return {
    response: "I've stopped learning about your personality. I'll still remember the preferences you've told me directly, but I won't observe patterns anymore. You can tell me to start learning again anytime.",
    action: 'tier_3_revoked'
  };
}

/**
 * Start learning (enable Tier 3)
 */
async function handleStartLearning() {
  const consent = personalization.getConsentSettings();

  if (consent.tier_3_enabled) {
    return {
      response: "I'm already learning about you to personalize our conversations. Would you like me to tell you what I've learned so far?",
      action: null
    };
  }

  if (!consent.tier_2_enabled) {
    return {
      response: "Before I can start learning about you, I need your permission to remember your preferences. Would you like me to explain what that means?",
      action: 'prompt_tier_2'
    };
  }

  // This will trigger the Tier 3 consent flow
  return {
    response: null,
    action: 'prompt_tier_3'
  };
}

/**
 * Get current privacy status
 */
async function handleStatus() {
  const consent = personalization.getConsentSettings();
  const stats = personalization.getStats();

  let response = "";

  if (consent.tier_3_enabled) {
    response = "You're on Tier 3, which means I'm learning about your personality and communication style over time. ";
    response += `I currently have ${stats.preferences} preferences, ${stats.profiles} personality observations, `;
    response += `${stats.topics} topics of interest, and ${stats.sessions} session summaries stored. `;
    response += "Everything stays private on your device. Would you like me to explain what that means, or change your settings?";
  } else if (consent.tier_2_enabled) {
    response = "You're on Tier 2, which means I remember preferences you tell me directly, ";
    response += "but I'm not learning patterns about you. ";
    response += `I currently have ${stats.preferences} preferences stored. `;
    response += "Would you like me to start learning more about you?";
  } else {
    response = "You're on Tier 1, which means I don't remember anything between our conversations. ";
    response += "Each time we talk, we start fresh. ";
    response += "Would you like me to remember your preferences?";
  }

  return {
    response: response,
    action: null
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Format a preference for natural language
 */
function formatPreference(pref) {
  const keyFormatters = {
    'preferred_name': (v) => `your name is ${v}`,
    'exercise_time': (v) => `you prefer ${v} exercise`,
    'exercise_frequency': (v) => `you exercise ${v}`,
    'physical_limitation': (v) => `you have ${v}`,
    'mobility_aid': (v) => `you ${v}`,
    'communication_pace': (v) => `you prefer a ${v} pace`,
    'humor_preference': (v) => `you ${v}`
  };

  // Check for family member keys
  if (pref.key.startsWith('family_member_')) {
    const name = pref.key.replace('family_member_', '');
    return `${name} is your ${pref.value}`;
  }

  const formatter = keyFormatters[pref.key];
  if (formatter) {
    return formatter(pref.value);
  }

  // Generic format
  return `${pref.key.replace(/_/g, ' ')}: ${pref.value}`;
}

/**
 * Check if a transcript is likely a voice command
 * (Fast check before full detection)
 */
export function mightBeVoiceCommand(transcript) {
  if (!transcript) return false;

  const quickPatterns = [
    /forget/i,
    /remember/i,
    /what do you know/i,
    /tier/i,
    /privacy/i,
    /learning/i,
    /delete/i,
    /erase/i,
    /mute/i,
    /unmute/i,
    /be quiet/i,
    /stop listening/i,
    /wake up/i,
    /go to sleep/i
  ];

  return quickPatterns.some(p => p.test(transcript));
}

// ═══════════════════════════════════════════════════════════════════════════
// MUTE / UNMUTE COMMANDS
// ═══════════════════════════════════════════════════════════════════════════

const MUTE_PATTERNS = [
  /^mute$/i,
  /^maya,? mute$/i,
  /^maya,? please mute$/i,
  /^be quiet$/i,
  /^stop listening$/i,
  /^go to sleep$/i,
];

const UNMUTE_PATTERNS = [
  /^unmute$/i,
  /^maya,? unmute$/i,
  /^wake up$/i,
  /^i'?m back$/i,
  /^start listening$/i,
  /^maya$/i,
];

/**
 * Check if transcript is a mute command.
 * Uses anchored patterns so "don't mute the TV" won't trigger.
 */
export function isMuteCommand(transcript) {
  if (!transcript) return false;
  const normalized = transcript.toLowerCase().trim();
  return MUTE_PATTERNS.some(p => p.test(normalized));
}

/**
 * Check if transcript is an unmute command.
 * Works even while globally muted (checked before all other processing).
 */
export function isUnmuteCommand(transcript) {
  if (!transcript) return false;
  const normalized = transcript.toLowerCase().trim();
  return UNMUTE_PATTERNS.some(p => p.test(normalized));
}
