/**
 * MayaMind Exercise POC — Audio Feedback
 *
 * Simple beep sounds using Web Audio API for countdown and recording feedback.
 */

let audioContext = null;

/**
 * Initialize audio context (must be called after user interaction)
 */
export function initAudio() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  // Resume if suspended (browsers require user gesture)
  if (audioContext.state === 'suspended') {
    audioContext.resume();
  }
  return audioContext;
}

/**
 * Play a beep sound
 * @param {number} frequency - Frequency in Hz (default 800)
 * @param {number} duration - Duration in ms (default 100)
 * @param {number} volume - Volume 0-1 (default 0.3)
 */
export function beep(frequency = 800, duration = 100, volume = 0.3) {
  const ctx = initAudio();
  if (!ctx) return;

  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.frequency.value = frequency;
  oscillator.type = 'sine';

  // Fade in/out to avoid clicks
  const now = ctx.currentTime;
  gainNode.gain.setValueAtTime(0, now);
  gainNode.gain.linearRampToValueAtTime(volume, now + 0.01);
  gainNode.gain.linearRampToValueAtTime(0, now + duration / 1000);

  oscillator.start(now);
  oscillator.stop(now + duration / 1000 + 0.01);
}

/**
 * Short countdown beep (5, 4, 3, 2, 1)
 */
export function countdownBeep() {
  beep(800, 80, 0.3);
}

/**
 * Long beep for recording start (0 seconds)
 */
export function startBeep() {
  beep(1000, 300, 0.4);
}

/**
 * Double beep for recording complete
 */
export function completeBeep() {
  beep(1200, 200, 0.4);
  setTimeout(() => {
    beep(1200, 200, 0.4);
  }, 250);
}

/**
 * Error/cancel beep
 */
export function errorBeep() {
  beep(400, 200, 0.3);
}
