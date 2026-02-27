/**
 * MayaMind Dashboard — TTS Service
 *
 * Unified ElevenLabs TTS service shared between sections.
 * Supports mood-based voice settings and cancellation for barge-in.
 */

import { AudioManager } from './audio-manager.js';

// Mood-based voice settings for ElevenLabs
const MOOD_VOICE_SETTINGS = {
  neutral: { stability: 0.5, similarity_boost: 0.75 },
  happy: { stability: 0.4, similarity_boost: 0.8 },
  love: { stability: 0.6, similarity_boost: 0.8 },
  sad: { stability: 0.7, similarity_boost: 0.6 },
  angry: { stability: 0.3, similarity_boost: 0.7 },
  fear: { stability: 0.6, similarity_boost: 0.6 },
  disgust: { stability: 0.5, similarity_boost: 0.6 },
  sleep: { stability: 0.8, similarity_boost: 0.5 },
};

export class TTSService {
  constructor() {
    this.currentSource = null;
    this.abortController = null;
    this.isSpeaking = false;

    // Callbacks
    this.onSpeakStart = null;
    this.onSpeakEnd = null;
  }

  /**
   * Get voice settings for a mood
   */
  getVoiceSettings(mood = 'neutral') {
    return MOOD_VOICE_SETTINGS[mood] || MOOD_VOICE_SETTINGS.neutral;
  }

  /**
   * Speak text using ElevenLabs
   */
  async speak(text, options = {}) {
    const { mood = 'neutral', onStart = null, onEnd = null } = options;

    // Cancel any ongoing speech
    this.cancel();

    // Ensure AudioContext is ready
    await AudioManager.resume();

    this.isSpeaking = true;
    this.abortController = new AbortController();

    if (onStart) onStart();
    if (this.onSpeakStart) this.onSpeakStart();

    try {
      const voiceSettings = this.getVoiceSettings(mood);

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice_settings: voiceSettings,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS API error: ${response.status}`);
      }

      const data = await response.json();

      // Check if cancelled during fetch
      if (this.abortController?.signal.aborted) {
        throw new Error('TTS cancelled');
      }

      // Decode audio
      const audioBytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
      const audioBuffer = await AudioManager.decodeAudio(audioBytes.buffer);

      // Check if cancelled during decode
      if (this.abortController?.signal.aborted) {
        throw new Error('TTS cancelled');
      }

      // Play audio
      return new Promise((resolve) => {
        this.currentSource = AudioManager.createBufferSource(audioBuffer);
        this.currentSource.onended = () => {
          this.currentSource = null;
          this.abortController = null;
          this.isSpeaking = false;
          if (onEnd) onEnd();
          if (this.onSpeakEnd) this.onSpeakEnd();
          resolve();
        };
        this.currentSource.start(0);
      });

    } catch (err) {
      // Don't log abort errors - they're intentional
      if (err.name !== 'AbortError' && !err.message.includes('cancelled')) {
        console.error('[TTS] Error:', err.message);
      }

      this.currentSource = null;
      this.abortController = null;
      this.isSpeaking = false;
      if (onEnd) onEnd();
      if (this.onSpeakEnd) this.onSpeakEnd();
    }
  }

  /**
   * Speak with word-level timing (for lip-sync)
   * Returns timing data from ElevenLabs alignment
   */
  async speakWithTiming(text, options = {}) {
    const { mood = 'neutral', onWordTiming = null } = options;

    // Cancel any ongoing speech
    this.cancel();

    // Ensure AudioContext is ready
    await AudioManager.resume();

    this.isSpeaking = true;
    this.abortController = new AbortController();

    if (this.onSpeakStart) this.onSpeakStart();

    try {
      const voiceSettings = this.getVoiceSettings(mood);

      const response = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          voice_settings: voiceSettings,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new Error(`TTS API error: ${response.status}`);
      }

      const data = await response.json();

      // Check if cancelled during fetch
      if (this.abortController?.signal.aborted) {
        throw new Error('TTS cancelled');
      }

      // Decode audio
      const audioBytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
      const audioBuffer = await AudioManager.decodeAudio(audioBytes.buffer);

      // Extract word timing from ElevenLabs alignment
      const timing = this.extractWordTiming(data);

      // Notify callback with timing data
      if (onWordTiming && timing) {
        onWordTiming(timing);
      }

      // Check if cancelled during decode
      if (this.abortController?.signal.aborted) {
        throw new Error('TTS cancelled');
      }

      // Play audio
      return new Promise((resolve) => {
        this.currentSource = AudioManager.createBufferSource(audioBuffer);
        this.currentSource.onended = () => {
          this.currentSource = null;
          this.abortController = null;
          this.isSpeaking = false;
          if (this.onSpeakEnd) this.onSpeakEnd();
          resolve({ timing });
        };
        this.currentSource.start(0);
      });

    } catch (err) {
      if (err.name !== 'AbortError' && !err.message.includes('cancelled')) {
        console.error('[TTS] Error:', err.message);
      }

      this.currentSource = null;
      this.abortController = null;
      this.isSpeaking = false;
      if (this.onSpeakEnd) this.onSpeakEnd();
      return null;
    }
  }

  /**
   * Extract word-level timing from ElevenLabs alignment data
   * Converts character-level timing to word-level
   */
  extractWordTiming(data) {
    if (!data.alignment?.characters || !data.alignment?.character_start_times_seconds) {
      return null;
    }

    const chars = data.alignment.characters;
    const starts = data.alignment.character_start_times_seconds;
    const durations = data.alignment.character_end_times_seconds?.map((end, i) => end - starts[i]) || [];

    // Group characters into words
    const words = [];
    const wtimes = [];
    const wdurations = [];

    let currentWord = '';
    let wordStart = 0;
    let wordEnd = 0;

    for (let i = 0; i < chars.length; i++) {
      const char = chars[i];
      const start = starts[i];
      const duration = durations[i] || 0;

      if (char === ' ' || i === chars.length - 1) {
        // End of word
        if (i === chars.length - 1 && char !== ' ') {
          currentWord += char;
          wordEnd = start + duration;
        }

        if (currentWord.trim()) {
          words.push(currentWord.trim());
          wtimes.push(wordStart * 1000); // Convert to ms
          wdurations.push((wordEnd - wordStart) * 1000);
        }

        currentWord = '';
        wordStart = 0;
      } else {
        if (currentWord === '') {
          wordStart = start;
        }
        currentWord += char;
        wordEnd = start + duration;
      }
    }

    return { words, wtimes, wdurations };
  }

  /**
   * Cancel current speech
   */
  cancel() {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch (e) { /* ignore */ }
      this.currentSource = null;
    }

    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }

    if (this.isSpeaking) {
      this.isSpeaking = false;
      if (this.onSpeakEnd) this.onSpeakEnd();
    }
  }

  /**
   * Check if currently speaking
   */
  getIsSpeaking() {
    return this.isSpeaking;
  }
}
