/**
 * MayaMind Extraction Pipeline
 *
 * Extracts personality signals from conversation transcripts using Claude.
 * Implements the "summarization-and-forget" pattern: extract signals, discard raw text.
 *
 * This module:
 * 1. Sends conversation transcript to Claude for analysis
 * 2. Extracts structured personality observations
 * 3. Updates the personalization database
 * 4. Discards the raw transcript (never stored)
 */

import { personalization } from './personalization-store.js';
import { filterForExtraction } from './content-safety.js';

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const EXTRACTION_SYSTEM_PROMPT = `You are analyzing a conversation between Maya (an AI wellness companion) and a senior user. Your task is to extract personality signals using the 6+1 category framework.

CRITICAL RULES:
1. Do NOT include any raw conversation text or direct quotes in your output
2. Only provide summarized observations, never verbatim user statements
3. Be respectful and never include anything that could embarrass the user
4. Focus on positive, constructive observations
5. If unsure about something, set confidence to "low"

## UNIVERSAL CATEGORIES (extract if signals present)

1. IDENTITY: Personal identity observations
   - Name preferences, how they want to be addressed
   - Personal background, career history
   - Self-description, values they express about themselves

2. COMMUNICATION: How they prefer to interact
   - Pace (quick/measured/slow)
   - Verbosity (brief/moderate/detailed)
   - Formality (casual/friendly/formal)
   - Humor receptivity (enjoys jokes, prefers serious tone)
   - Question style (direct/conversational)

3. HEALTH: Physical and wellness observations
   - Physical capabilities and limitations mentioned
   - Medications or treatments mentioned
   - Energy levels, mobility
   - Health concerns expressed

4. RELATIONSHIPS: People and pets in their life
   - Family members mentioned (name, relationship, details)
   - Friends, caregivers, neighbors
   - Pets (current or remembered)
   - How they talk about these relationships

5. ROUTINE: Daily patterns and timing
   - Wake/sleep patterns
   - Exercise timing preferences
   - Meal preferences
   - Regular activities (calls, clubs, appointments)

6. EMOTIONAL: Mood and emotional patterns
   - General emotional baseline
   - Topics that energize or excite them
   - Topics that concern or worry them
   - Values they express (independence, family connection, etc.)

## EMERGENT CATEGORY (extract when clear interest shown)

7. TOPICS: Specific interests the user shows enthusiasm about
   - Any subject where they "light up" or engage deeply
   - Hobbies, sports teams, genres of books/movies
   - Provide a suggested tag (e.g., "rose_gardening", "giants_baseball")
   - Rate engagement: "high" (enthusiastic), "medium" (interested), "low" (mentioned only)

## ALSO EXTRACT

8. EXPLICIT_PREFERENCES: Direct statements of preference (Tier 2 level)
   - Only include facts the user clearly declared
   - Example: "prefers morning exercise" (if user said "I like to exercise in the morning")

## OUTPUT FORMAT

Return a JSON object with this structure:
{
  "explicitPreferences": [
    {
      "key": "exercise_time",
      "value": "morning",
      "confidence": "high"
    }
  ],
  "personalityObservations": [
    {
      "category": "COMMUNICATION",
      "observation": "Prefers slower conversational pace, appreciates when given time to respond",
      "confidence": "medium",
      "is_new": true
    }
  ],
  "topics": [
    {
      "tag": "rose_gardening",
      "displayName": "Rose Gardening",
      "summary": "Maintains a rose garden, prefers hybrid tea varieties",
      "engagement": "high",
      "confidence": "high"
    }
  ],
  "sessionSummary": {
    "text": "Discussed upcoming family visit and completed chair exercises. Mentioned hip feeling better.",
    "keyObservations": [
      "excited about daughter's visit",
      "hip mobility improving",
      "engaged well with balance exercises"
    ]
  }
}

If nothing notable was discussed, return:
{
  "explicitPreferences": [],
  "personalityObservations": [],
  "topics": [],
  "sessionSummary": null
}`;

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTION FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Process a session transcript and extract personality signals
 * @param {string} sessionTranscript - The conversation transcript
 * @param {string} sessionType - Type of session ('maya_conversation' or 'exercise_session')
 * @returns {Object} Extraction results
 */
export async function processSessionEnd(sessionTranscript, sessionType = 'maya_conversation') {
  if (!sessionTranscript || sessionTranscript.trim().length === 0) {
    console.log('[ExtractionPipeline] Empty transcript, skipping extraction');
    return { skipped: true, reason: 'empty_transcript' };
  }

  const consent = personalization.getConsentSettings();

  // If only Tier 1, nothing to extract
  if (!consent.tier_2_enabled && !consent.tier_3_enabled) {
    console.log('[ExtractionPipeline] Tier 1 only, skipping extraction');
    return { skipped: true, reason: 'tier_1_only' };
  }

  // Content safety check
  const safetyResult = await filterForExtraction(sessionTranscript);
  if (!safetyResult.shouldProcess) {
    console.log('[ExtractionPipeline] Content blocked by safety filter');
    return {
      skipped: true,
      reason: 'safety_blocked',
      safetyFlags: safetyResult.safetyFlags
    };
  }

  try {
    // Extract signals using Claude
    const extraction = await extractPersonalitySignals(sessionTranscript);

    if (!extraction) {
      return { skipped: true, reason: 'extraction_failed' };
    }

    // Process the extracted signals
    await processExtractedSignals(extraction, consent, sessionType);

    // Persist changes
    personalization.persist();

    console.log('[ExtractionPipeline] Extraction complete');
    return {
      success: true,
      extraction: extraction,
      safetyFlags: safetyResult.safetyFlags
    };

  } catch (error) {
    console.error('[ExtractionPipeline] Extraction error:', error);
    return { skipped: true, reason: 'error', error: error.message };
  }
}

/**
 * Send transcript to Claude for extraction
 */
async function extractPersonalitySignals(transcript) {
  try {
    console.log('[ExtractionPipeline] Sending transcript to Claude for extraction...');
    console.log('[ExtractionPipeline] Transcript:', transcript);

    const response = await fetch('/api/extract-personality', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcript,
        systemPrompt: EXTRACTION_SYSTEM_PROMPT
      })
    });

    if (!response.ok) {
      throw new Error(`Extraction API error: ${response.status}`);
    }

    const result = await response.json();
    console.log('[ExtractionPipeline] Raw API response:', result);

    // Parse the JSON response from Claude
    let extraction;
    if (typeof result.extraction === 'string') {
      console.log('[ExtractionPipeline] Parsing string response...');
      // Claude sometimes wraps JSON in markdown code fences — strip them
      let jsonStr = result.extraction.trim();
      // Try full code fence (opening + closing)
      const fullFenceMatch = jsonStr.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/);
      if (fullFenceMatch) {
        jsonStr = fullFenceMatch[1].trim();
        console.log('[ExtractionPipeline] Stripped markdown code fences from response');
      } else if (jsonStr.startsWith('```')) {
        // Opening fence only (response may have been truncated by max_tokens)
        jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').trim();
        // Also strip trailing ``` if present but not matched by full regex
        jsonStr = jsonStr.replace(/\n?\s*```$/, '').trim();
        console.log('[ExtractionPipeline] Stripped opening code fence from response');
      }
      extraction = JSON.parse(jsonStr);
    } else {
      extraction = result.extraction;
    }

    console.log('[ExtractionPipeline] Parsed extraction:', JSON.stringify(extraction, null, 2));
    return extraction;

  } catch (error) {
    console.error('[ExtractionPipeline] Claude extraction failed:', error);
    console.log('[ExtractionPipeline] Falling back to local extraction...');

    // Fallback: try to extract basic preferences locally
    const fallback = extractBasicPreferencesLocally(transcript);
    console.log('[ExtractionPipeline] Local fallback result:', fallback);
    return fallback;
  }
}

/**
 * Fallback local extraction for basic preferences
 * Used when Claude API is unavailable
 */
function extractBasicPreferencesLocally(transcript) {
  const extraction = {
    explicitPreferences: [],
    personalityObservations: [],
    topics: [],
    sessionSummary: null
  };

  const normalized = transcript.toLowerCase();

  // Extract name preference
  const nameMatch = normalized.match(/call me (\w+)/i) ||
                   normalized.match(/my name is (\w+)/i) ||
                   normalized.match(/i'?m (\w+)/i);
  if (nameMatch) {
    extraction.explicitPreferences.push({
      key: 'preferred_name',
      value: nameMatch[1].charAt(0).toUpperCase() + nameMatch[1].slice(1),
      confidence: 'high'
    });
  }

  // Extract exercise time preference
  if (/morning/i.test(normalized) && /exercise|workout|stretch/i.test(normalized)) {
    extraction.explicitPreferences.push({
      key: 'exercise_time',
      value: 'morning',
      confidence: 'medium'
    });
  } else if (/evening|afternoon/i.test(normalized) && /exercise|workout|stretch/i.test(normalized)) {
    extraction.explicitPreferences.push({
      key: 'exercise_time',
      value: 'evening',
      confidence: 'medium'
    });
  }

  // Extract physical limitations
  const limitationPatterns = [
    /(?:my |have )?(hip|knee|back|shoulder|ankle|wrist) (?:hurts|pain|problem|issue|bothers)/i,
    /arthritis in (?:my )?(hip|knee|back|shoulder|ankle|wrist|hands)/i
  ];

  for (const pattern of limitationPatterns) {
    const match = normalized.match(pattern);
    if (match) {
      extraction.explicitPreferences.push({
        key: 'physical_limitation',
        value: `${match[1]} issue`,
        confidence: 'medium'
      });
      break;
    }
  }

  return extraction;
}

/**
 * Process extracted signals and update database
 */
async function processExtractedSignals(extraction, consent, sessionType) {
  // Process explicit preferences (Tier 2+)
  if (consent.tier_2_enabled && extraction.explicitPreferences) {
    for (const pref of extraction.explicitPreferences) {
      if (pref.confidence !== 'low') {
        personalization.addPreference(pref.key, pref.value, 'maya_confirmed');
      }
    }
  }

  // Process topics (Tier 2+ — topics are interests the user shared, which feel like preferences)
  if (consent.tier_2_enabled && extraction.topics) {
    for (const topic of extraction.topics) {
      const keywords = extractKeywordsFromText(topic.summary + ' ' + topic.displayName);
      personalization.upsertTopic(
        topic.tag,
        topic.displayName,
        topic.summary,
        keywords,
        topic.engagement,
        mapConfidenceToNumber(topic.confidence)
      );
    }
  }

  // Process personality observations and session summaries (Tier 3 only)
  if (consent.tier_3_enabled) {
    // Update personality profiles
    if (extraction.personalityObservations) {
      for (const obs of extraction.personalityObservations) {
        const profileType = mapCategoryToProfileType(obs.category);
        if (profileType) {
          await updateProfile(profileType, obs);
        }
      }
    }

    // Create session summary
    if (extraction.sessionSummary && extraction.sessionSummary.text) {
      const keywords = extractKeywordsFromText(extraction.sessionSummary.text);
      personalization.createSessionSummary(
        extraction.sessionSummary.text,
        extraction.sessionSummary.keyObservations || [],
        keywords
      );
    }
  }
}

/**
 * Update a personality profile with a new observation
 */
async function updateProfile(profileType, observation) {
  const existing = personalization.getProfile(profileType);
  const confidenceNum = mapConfidenceToNumber(observation.confidence);

  if (existing) {
    // Merge observation into existing profile
    let newSummary = existing.summary_text;

    // Only add if this seems new
    if (observation.is_new && !newSummary.toLowerCase().includes(observation.observation.toLowerCase().substring(0, 20))) {
      newSummary = `${existing.summary_text} ${observation.observation}`;
      // Keep summary under 500 chars
      if (newSummary.length > 500) {
        newSummary = newSummary.substring(0, 497) + '...';
      }
    }

    // Calculate new confidence
    const newConfidence = calculateNewConfidence(existing.confidence, existing.observation_count, confidenceNum);

    const existingKeywords = JSON.parse(existing.keywords || '[]');
    const newKeywords = extractKeywordsFromText(observation.observation);
    const mergedKeywords = [...new Set([...existingKeywords, ...newKeywords])].slice(0, 20);

    personalization.upsertProfile(profileType, newSummary, mergedKeywords, newConfidence);
  } else {
    // Create new profile
    const keywords = extractKeywordsFromText(observation.observation);
    personalization.upsertProfile(profileType, observation.observation, keywords, confidenceNum);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Map category name to profile type
 */
function mapCategoryToProfileType(category) {
  const mapping = {
    'IDENTITY': 'identity',
    'COMMUNICATION': 'communication',
    'HEALTH': 'health',
    'RELATIONSHIPS': 'relationships',
    'ROUTINE': 'routine',
    'EMOTIONAL': 'emotional'
  };

  return mapping[category.toUpperCase()] || null;
}

/**
 * Map confidence string to number
 */
function mapConfidenceToNumber(confidence) {
  const mapping = {
    'high': 0.8,
    'medium': 0.5,
    'low': 0.3
  };

  return mapping[confidence?.toLowerCase()] || 0.5;
}

/**
 * Calculate updated confidence score
 */
function calculateNewConfidence(current, count, newObsConfidence) {
  // Weighted average that gradually increases with more observations
  const weight = newObsConfidence * 0.3;
  const newConfidence = current + (weight * (1 - current));
  return Math.min(newConfidence, 0.95); // Cap at 0.95
}

/**
 * Extract keywords from text
 */
function extractKeywordsFromText(text) {
  if (!text) return [];

  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'i', 'you', 'we', 'they', 'it',
    'to', 'for', 'of', 'and', 'or', 'but', 'in', 'on', 'at', 'with', 'about',
    'how', 'what', 'when', 'where', 'why', 'do', 'does', 'did', 'have', 'has',
    'had', 'be', 'been', 'being', 'my', 'your', 'our', 'their', 'this', 'that',
    'these', 'those', 'can', 'could', 'would', 'should', 'will', 'shall', 'may',
    'might', 'must', 'am', 'its', 'just', 'like', 'so', 'very', 'too',
    'also', 'well', 'really', 'get', 'got', 'going', 'go', 'know', 'think',
    'want', 'need', 'see', 'look', 'make', 'take', 'come', 'say', 'said',
    'prefers', 'enjoys', 'likes', 'has', 'mentioned', 'discussed'
  ]);

  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length > 2 && !stopWords.has(word))
    .slice(0, 15); // Limit to 15 keywords
}

// ═══════════════════════════════════════════════════════════════════════════
// INLINE EXTRACTION (for real-time use)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract signals from a single conversation turn (lighter weight)
 * Used for real-time preference detection during conversation
 */
export function extractInlinePreferences(userMessage) {
  const prefs = [];
  const normalized = userMessage.toLowerCase();

  // Name preference — only match clear name introductions
  // Exclude common words that follow "I'm" (e.g., "I'm feeling", "I'm really", "I'm going")
  const commonWords = new Set([
    'feeling', 'doing', 'going', 'looking', 'thinking', 'trying', 'having',
    'getting', 'making', 'coming', 'taking', 'working', 'playing', 'watching',
    'really', 'very', 'so', 'not', 'just', 'also', 'here', 'there', 'good',
    'great', 'fine', 'okay', 'ok', 'well', 'glad', 'happy', 'sad', 'sorry',
    'sure', 'afraid', 'excited', 'interested', 'wondering', 'hoping',
    'a', 'an', 'the', 'more', 'pretty', 'quite', 'still', 'already',
    'about', 'from', 'in', 'at', 'on', 'back', 'new', 'old', 'big', 'water'
  ]);

  const namePatterns = [
    /(?:call me|my name is) (\w+)/i,
    /(?:everyone calls me|people call me|go by) (\w+)/i,
    /(?:i'?m|i am) (\w+)/i  // Broadest pattern — checked last with exclusion list
  ];

  for (const pattern of namePatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const candidate = match[1].toLowerCase();
      // Skip common words that aren't names
      if (commonWords.has(candidate)) continue;
      // Skip very short words (likely not names)
      if (candidate.length < 2) continue;
      prefs.push({
        key: 'preferred_name',
        value: match[1].charAt(0).toUpperCase() + match[1].slice(1),
        source: 'inline'
      });
      break;
    }
  }

  // Family member mentions
  const familyPatterns = [
    /my (daughter|son|wife|husband|grandson|granddaughter|sister|brother) (\w+)/i,
    /(\w+) is my (daughter|son|wife|husband|grandson|granddaughter|sister|brother)/i
  ];

  for (const pattern of familyPatterns) {
    const match = userMessage.match(pattern);
    if (match) {
      const name = pattern === familyPatterns[0] ? match[2] : match[1];
      const relation = pattern === familyPatterns[0] ? match[1] : match[2];
      prefs.push({
        key: `family_member_${name.toLowerCase()}`,
        value: relation.toLowerCase(),
        source: 'inline'
      });
    }
  }

  // Exercise preferences
  if (/prefer|like|love|enjoy/i.test(normalized)) {
    if (/morning/i.test(normalized) && /exercise|workout|stretch/i.test(normalized)) {
      prefs.push({ key: 'exercise_time', value: 'morning', source: 'inline' });
    }
    if (/evening|afternoon/i.test(normalized) && /exercise|workout|stretch/i.test(normalized)) {
      prefs.push({ key: 'exercise_time', value: 'afternoon/evening', source: 'inline' });
    }
  }

  return prefs;
}
