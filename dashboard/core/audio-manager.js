/**
 * MayaMind Dashboard — Audio Manager
 *
 * Singleton AudioContext shared between all sections.
 * Handles Chrome/Safari user gesture requirement for audio playback.
 */

class AudioManagerClass {
  constructor() {
    this.audioContext = null;
    this.initialized = false;
  }

  /**
   * Get or create the shared AudioContext
   */
  getContext() {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('[AudioManager] Created AudioContext');
    }
    return this.audioContext;
  }

  /**
   * Resume AudioContext (required after user gesture in Chrome/Safari)
   */
  async resume() {
    const ctx = this.getContext();
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
        console.log('[AudioManager] AudioContext resumed');
      } catch (err) {
        console.error('[AudioManager] Failed to resume AudioContext:', err.message);
      }
    }
    return ctx;
  }

  /**
   * Check if AudioContext is ready for playback
   */
  isReady() {
    return this.audioContext && this.audioContext.state === 'running';
  }

  /**
   * Get current state
   */
  getState() {
    return this.audioContext?.state || 'uninitialized';
  }

  /**
   * Decode audio data (shared utility)
   */
  async decodeAudio(arrayBuffer) {
    const ctx = this.getContext();
    return await ctx.decodeAudioData(arrayBuffer);
  }

  /**
   * Create a buffer source for playback
   */
  createBufferSource(audioBuffer) {
    const ctx = this.getContext();
    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    return source;
  }

  /**
   * Play audio buffer with optional callback when done
   */
  playBuffer(audioBuffer, onEnded = null) {
    const source = this.createBufferSource(audioBuffer);
    if (onEnded) {
      source.onended = onEnded;
    }
    source.start(0);
    return source;
  }

  /**
   * Close the AudioContext (cleanup)
   */
  async close() {
    if (this.audioContext) {
      try {
        await this.audioContext.close();
        console.log('[AudioManager] AudioContext closed');
      } catch (err) {
        console.error('[AudioManager] Error closing AudioContext:', err.message);
      }
      this.audioContext = null;
    }
  }
}

// Export singleton instance
export const AudioManager = new AudioManagerClass();
