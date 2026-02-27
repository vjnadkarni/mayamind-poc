/**
 * MayaMind Exercise POC — LLM Service Module
 *
 * Handles communication with Claude API for conversational exercise coaching.
 * Uses SSE streaming via /api/chat/exercise endpoint.
 */

// ── Exercise Coaching System Prompt ─────────────────────────────────────────

const EXERCISE_COACH_PROMPT = `You are Maya, a warm and encouraging AI exercise coach for seniors. You help users stay active through gentle, supportive guidance.

PERSONALITY:
- Warm, patient, and genuinely caring
- Uses simple, clear language (no jargon)
- Celebrates small wins enthusiastically
- Never judgmental about fitness level or pace

RESPONSE FORMAT:
- Start every response with a mood tag: [MOOD:happy], [MOOD:neutral], [MOOD:love], [MOOD:sad]
- Include an intent tag when user input requires action: [INTENT:xxx]
- Keep responses SHORT (1-2 sentences max) — users are exercising, not reading

AVAILABLE INTENTS:
- [INTENT:start_exercise:squat] — User wants to do squats
- [INTENT:start_exercise:reverse_lunge] — User wants to do lunges
- [INTENT:start_exercise:biceps_curl] — User wants to do bicep curls
- [INTENT:start_exercise:knee_pushup] — User wants to do push-ups
- [INTENT:show_menu] — User wants to see exercise options
- [INTENT:end_session] — User wants to stop exercising
- [INTENT:continue] — User wants to keep going (not done yet)
- [INTENT:next_exercise] — User wants to do another exercise
- [INTENT:confirm_yes] — User said yes to a question
- [INTENT:confirm_no] — User said no to a question

EXERCISE MAPPING (use these when user mentions body parts):
- "upper body" or "arms" → suggest biceps_curl
- "lower body" or "legs" → suggest squat
- "core" or "strength" or "chest" → suggest knee_pushup
- "balance" → suggest reverse_lunge

SPECIAL INPUTS (respond appropriately):
- __greeting__ = Generate a varied, warm greeting asking if they want to exercise
- __menu__ = List available exercises naturally
- __encourage__ = Give brief encouragement for someone who paused mid-exercise
- __completion_check__ = Ask if they're done (they've paused)
- __report__ = Summarize the session warmly and ask if they want to do another exercise
- __farewell__ = Say goodbye warmly

EXAMPLE RESPONSES:
- Greeting: "[MOOD:happy] Good morning! Ready to get your body moving today?"
- Menu: "[MOOD:neutral] [INTENT:show_menu] We can do squats for your legs, lunges for balance, bicep curls for your arms, or push-ups for strength. What sounds good?"
- Exercise selection: "[MOOD:happy] [INTENT:start_exercise:squat] Great choice! Squats are wonderful for leg strength. Go ahead whenever you're ready!"
- Upper body request: "[MOOD:happy] [INTENT:start_exercise:biceps_curl] Let's work those arms! Bicep curls are perfect."
- Encouragement: "[MOOD:love] You're doing great! Take your time."
- Completion check: "[MOOD:neutral] I notice you've paused. All done with this exercise?"
- Yes response: "[MOOD:neutral] [INTENT:confirm_yes] Perfect!"
- No response: "[MOOD:happy] [INTENT:confirm_no] Okay, keep going! I'm here counting."
- Session report: "[MOOD:happy] Wonderful job! You crushed 8 squats and 5 curls. Would you like to do another exercise?"
- Farewell: "[MOOD:love] [INTENT:end_session] Great job today! Rest well, and I'll see you next time.`;

// ── Response Parsing ────────────────────────────────────────────────────────

/**
 * Parse mood and intent tags from LLM response
 * @param {string} text - Raw LLM response
 * @returns {{ cleanText: string, mood: string|null, intent: string|null, exerciseKey: string|null }}
 */
export function parseResponse(text) {
  let cleanText = text;
  let mood = null;
  let intent = null;
  let exerciseKey = null;

  // Extract [MOOD:xxx]
  const moodMatch = text.match(/\[MOOD:(\w+)\]/);
  if (moodMatch) {
    mood = moodMatch[1].toLowerCase();
    cleanText = cleanText.replace(moodMatch[0], '').trim();
  }

  // Extract [INTENT:xxx] or [INTENT:start_exercise:xxx]
  const intentMatch = text.match(/\[INTENT:([^\]]+)\]/);
  if (intentMatch) {
    const intentStr = intentMatch[1];
    cleanText = cleanText.replace(intentMatch[0], '').trim();

    if (intentStr.startsWith('start_exercise:')) {
      intent = 'start_exercise';
      exerciseKey = intentStr.split(':')[1];
    } else {
      intent = intentStr;
    }
  }

  return { cleanText, mood, intent, exerciseKey };
}

// ── Context Building ────────────────────────────────────────────────────────

/**
 * Build context string for LLM from session state
 * @param {object} session - Current session state
 * @returns {string} - Context description for system prompt
 */
export function buildContextString(session) {
  const parts = [];

  if (session.exercisesCompleted?.length > 0) {
    const summary = session.exercisesCompleted
      .map(e => `${e.reps} ${e.exercise.replace('_', ' ')}s`)
      .join(', ');
    parts.push(`Exercises completed this session: ${summary}`);
  }

  if (session.currentExercise) {
    parts.push(`Currently doing: ${session.currentExercise.replace('_', ' ')}`);
    if (session.currentReps > 0) {
      parts.push(`Reps so far: ${session.currentReps}`);
    }
  }

  if (session.lastRepTime) {
    const secondsAgo = Math.round((Date.now() - session.lastRepTime) / 1000);
    if (secondsAgo > 5) {
      parts.push(`Last rep was ${secondsAgo} seconds ago`);
    }
  }

  return parts.length > 0 ? '\n\nCURRENT SESSION:\n' + parts.join('\n') : '';
}

// ── LLM Communication ───────────────────────────────────────────────────────

/**
 * Generate a response from Claude for exercise coaching
 * @param {object} context - Session context
 * @param {string} userInput - User's speech or special command
 * @returns {Promise<{ text: string, mood: string|null, intent: string|null, exerciseKey: string|null }>}
 */
export async function generateResponse(context, userInput) {
  const contextString = buildContextString(context);
  const systemPrompt = EXERCISE_COACH_PROMPT + contextString;

  // Build message based on input type
  let userMessage;
  if (userInput.startsWith('__')) {
    // Special command - convert to natural prompt
    const commands = {
      '__greeting__': 'Generate a warm, varied greeting asking if I want to exercise today.',
      '__menu__': 'List the available exercises I can do.',
      '__encourage__': 'Give me brief encouragement - I paused while exercising.',
      '__completion_check__': 'Ask if I am done with this exercise - I have paused.',
      '__report__': 'Summarize my exercise session warmly and ask if I want to do another exercise.',
      '__farewell__': 'Say goodbye warmly - I am done exercising.',
    };
    userMessage = commands[userInput] || userInput;
  } else {
    userMessage = userInput;
  }

  try {
    const response = await fetch('/api/chat/exercise', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    // Read SSE stream
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6);
          if (data === '[DONE]') continue;

          try {
            const parsed = JSON.parse(data);
            if (parsed.text) {
              fullText += parsed.text;
            }
          } catch (e) {
            // Ignore parse errors for partial chunks
          }
        }
      }
    }

    return parseResponse(fullText);
  } catch (err) {
    console.error('[LLM] Error:', err.message);
    // Return fallback response
    return {
      cleanText: "I'm having trouble connecting. Let's try again.",
      mood: 'neutral',
      intent: null,
      exerciseKey: null,
    };
  }
}

// ── Exercise Display Names ──────────────────────────────────────────────────

export const EXERCISE_DISPLAY_NAMES = {
  squat: 'squats',
  reverse_lunge: 'lunges',
  biceps_curl: 'bicep curls',
  knee_pushup: 'push-ups',
};
