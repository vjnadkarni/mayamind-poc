/**
 * MayaMind — Emoji Utilities for Voice Interface
 *
 * Converts emojis to natural spoken phrases and extracts mood for avatar expression.
 * Used by ConnectSection to make WhatsApp messages speakable via TTS.
 */

// Each entry: emoji → { speech: spoken phrase, mood: TalkingHead mood or null }
// Valid moods: neutral, happy, angry, sad, fear, disgust, love, sleep
const EMOJI_MAP = new Map([
  // Love / affection
  ['❤️',  { speech: 'with love',        mood: 'love'  }],
  ['❤',   { speech: 'with love',        mood: 'love'  }],
  ['💕',  { speech: 'with love',        mood: 'love'  }],
  ['💖',  { speech: 'with love',        mood: 'love'  }],
  ['💗',  { speech: 'with love',        mood: 'love'  }],
  ['💘',  { speech: 'with love',        mood: 'love'  }],
  ['💝',  { speech: 'with love',        mood: 'love'  }],
  ['💞',  { speech: 'with love',        mood: 'love'  }],
  ['🥰',  { speech: 'with love',        mood: 'love'  }],
  ['🫶',  { speech: 'with a heart',     mood: 'love'  }],

  // Happy / joy
  ['😊',  { speech: 'with a smile',     mood: 'happy' }],
  ['😄',  { speech: 'with a big smile', mood: 'happy' }],
  ['😁',  { speech: 'grinning',         mood: 'happy' }],
  ['🙂',  { speech: 'with a smile',     mood: 'happy' }],
  ['😃',  { speech: 'happily',          mood: 'happy' }],
  ['😀',  { speech: 'happily',          mood: 'happy' }],

  // Laughing
  ['😂',  { speech: 'laughing',         mood: 'happy' }],
  ['🤣',  { speech: 'laughing hard',    mood: 'happy' }],
  ['😆',  { speech: 'laughing',         mood: 'happy' }],

  // Affectionate gestures
  ['🤗',  { speech: 'sending a hug',    mood: 'love'  }],
  ['😘',  { speech: 'sending a kiss',   mood: 'love'  }],
  ['😗',  { speech: 'sending a kiss',   mood: 'love'  }],
  ['😚',  { speech: 'sending a kiss',   mood: 'love'  }],
  ['😙',  { speech: 'sending a kiss',   mood: 'love'  }],

  // Winking
  ['😉',  { speech: 'with a wink',      mood: 'happy' }],

  // Thumbs / approval (with skin tone variants)
  ['👍',  { speech: 'thumbs up',        mood: 'happy' }],
  ['👍🏻', { speech: 'thumbs up',        mood: 'happy' }],
  ['👍🏼', { speech: 'thumbs up',        mood: 'happy' }],
  ['👍🏽', { speech: 'thumbs up',        mood: 'happy' }],
  ['👍🏾', { speech: 'thumbs up',        mood: 'happy' }],
  ['👍🏿', { speech: 'thumbs up',        mood: 'happy' }],
  ['👎',  { speech: 'thumbs down',      mood: 'sad'   }],
  ['👏',  { speech: 'clapping',         mood: 'happy' }],

  // Sad / crying
  ['😢',  { speech: 'with a tear',      mood: 'sad'   }],
  ['😭',  { speech: 'crying',           mood: 'sad'   }],
  ['🥺',  { speech: 'with a sad face',  mood: 'sad'   }],
  ['😞',  { speech: 'sadly',            mood: 'sad'   }],
  ['😔',  { speech: 'sadly',            mood: 'sad'   }],

  // Thinking
  ['🤔',  { speech: 'thinking',         mood: 'neutral' }],

  // Praying / gratitude (with skin tone variants)
  ['🙏',  { speech: 'with gratitude',   mood: 'love'  }],
  ['🙏🏻', { speech: 'with gratitude',   mood: 'love'  }],
  ['🙏🏼', { speech: 'with gratitude',   mood: 'love'  }],
  ['🙏🏽', { speech: 'with gratitude',   mood: 'love'  }],
  ['🙏🏾', { speech: 'with gratitude',   mood: 'love'  }],
  ['🙏🏿', { speech: 'with gratitude',   mood: 'love'  }],

  // Waving
  ['👋',  { speech: 'waving hello',     mood: 'happy' }],

  // Celebrations
  ['🎉',  { speech: 'celebrating',      mood: 'happy' }],
  ['🥳',  { speech: 'celebrating',      mood: 'happy' }],
  ['🎂',  { speech: 'with a birthday cake', mood: 'happy' }],
  ['🎁',  { speech: 'with a gift',      mood: 'happy' }],

  // Flowers / nature
  ['🌹',  { speech: 'with a rose',      mood: 'love'  }],
  ['💐',  { speech: 'with flowers',     mood: 'love'  }],
  ['🌸',  { speech: 'with cherry blossoms', mood: 'happy' }],
  ['☀️',  { speech: 'with sunshine',    mood: 'happy' }],

  // Misc common
  ['✨',  { speech: 'with sparkles',    mood: 'happy' }],
  ['🔥',  { speech: 'fire',             mood: 'happy' }],
  ['💪',  { speech: 'strong',           mood: 'happy' }],
  ['💯',  { speech: 'one hundred percent', mood: 'happy' }],
  ['✅',  { speech: 'check mark',       mood: 'happy' }],
  ['❌',  { speech: 'cross mark',       mood: 'sad'   }],

  // Emotional
  ['😴',  { speech: 'sleepy',           mood: 'sleep' }],
  ['😡',  { speech: 'angry',            mood: 'angry' }],
  ['😠',  { speech: 'annoyed',          mood: 'angry' }],
  ['🤢',  { speech: 'feeling sick',     mood: 'disgust' }],
  ['😱',  { speech: 'shocked',          mood: 'fear'  }],
  ['😨',  { speech: 'frightened',       mood: 'fear'  }],

  // Punctuation-style
  ['❓',  { speech: 'question mark',    mood: null    }],
  ['❗',  { speech: 'exclamation',      mood: null    }],
]);

// Build regex from map keys, longest-first (so skin-tone variants match before base)
const sortedKeys = [...EMOJI_MAP.keys()].sort((a, b) => b.length - a.length);
const escapedKeys = sortedKeys.map(k => k.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'));
const EMOJI_REGEX = new RegExp(`(${escapedKeys.join('|')})`, 'g');

// Catch-all regex for emoji Unicode ranges not in our map
const UNKNOWN_EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{1FA70}-\u{1FAFF}\u{1F900}-\u{1F9FF}\u{1F000}-\u{1F02F}\u{1FA00}-\u{1FA6F}]/gu;

/**
 * Replace emojis in text with natural spoken equivalents.
 * @param {string} text - Text potentially containing emojis
 * @returns {{ spokenText: string, emojis: Array<{emoji: string, speech: string, mood: string|null}> }}
 */
export function convertEmojisToSpeech(text) {
  const matchedEmojis = [];

  // Replace known emojis with spoken phrases
  let spokenText = text.replace(EMOJI_REGEX, (match) => {
    const entry = EMOJI_MAP.get(match);
    if (entry) {
      matchedEmojis.push({ emoji: match, ...entry });
      return ` ${entry.speech} `;
    }
    return match;
  });

  // Strip any remaining unknown emojis
  spokenText = spokenText.replace(UNKNOWN_EMOJI_REGEX, '');

  // Clean up whitespace
  spokenText = spokenText.replace(/\s{2,}/g, ' ').trim();

  return { spokenText, emojis: matchedEmojis };
}

/**
 * Determine the dominant mood from matched emojis.
 * Uses reading order — first emoji with a mood wins (primary sentiment).
 * @param {Array<{mood: string|null}>} emojis
 * @returns {string|null}
 */
export function extractDominantEmojiMood(emojis) {
  for (const e of emojis) {
    if (e.mood) return e.mood;
  }
  return null;
}

/**
 * Check if a message body is emoji-only (no actual text content).
 * @param {string} text
 * @returns {boolean}
 */
export function isEmojiOnly(text) {
  const stripped = text
    .replace(EMOJI_REGEX, '')
    .replace(UNKNOWN_EMOJI_REGEX, '')
    .trim();
  return stripped.length === 0;
}
