/**
 * MayaMind Dashboard — Exercise Section
 *
 * Wraps the Exercise POC functionality with camera pause/resume
 * and voice workflow pause/resume for session persistence.
 */

import { AudioManager } from '../../core/audio-manager.js';

// Import exercise modules (paths relative to dashboard)
// Note: These will be loaded dynamically to avoid module path issues

export class ExerciseSection {
  constructor(options = {}) {
    this.ttsService = options.ttsService;
    this.onStateChange = options.onStateChange || null;
    this.onRepUpdate = options.onRepUpdate || null;

    // State
    this.container = null;
    this.iframe = null;
    this.isActive = false;

    // Camera state
    this.mediaStream = null;
    this.cameraPaused = false;

    // Saved state for resume
    this.savedState = null;
  }

  /**
   * Mount the section using an iframe to the existing exercise POC
   * This provides full isolation while allowing communication
   */
  async mount(container, savedState) {
    console.log('[Exercise] Mounting section');
    this.container = container;
    this.savedState = savedState;

    // Create iframe to exercise POC
    this.createUI();

    this.isActive = true;
  }

  /**
   * Create the UI with iframe
   */
  createUI() {
    this.container.innerHTML = `
      <div class="exercise-container">
        <iframe
          id="exercise-iframe"
          src="/exercise-poc/index.html"
          frameborder="0"
          allow="camera; microphone"
          class="exercise-iframe"
        ></iframe>
      </div>
      <style>
        .exercise-container {
          width: 100%;
          height: 100%;
          position: relative;
        }
        .exercise-iframe {
          width: 100%;
          height: 100%;
          border: none;
        }
      </style>
    `;

    this.iframe = this.container.querySelector('#exercise-iframe');

    // Set up message listener for communication with iframe
    this.messageHandler = this.handleMessage.bind(this);
    window.addEventListener('message', this.messageHandler);

    // Wait for iframe to load then restore state if needed
    this.iframe.addEventListener('load', () => {
      console.log('[Exercise] Iframe loaded');
      if (this.savedState) {
        this.restoreState(this.savedState);
      }
    });
  }

  /**
   * Handle messages from iframe
   */
  handleMessage(event) {
    // Verify origin
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (!data || data.type !== 'exercise') return;

    switch (data.action) {
      case 'repUpdate':
        if (this.onRepUpdate) {
          this.onRepUpdate(data.exercise, data.repCount);
        }
        if (this.onStateChange) {
          this.onStateChange(this.getState());
        }
        break;

      case 'stateChange':
        if (this.onStateChange) {
          this.onStateChange(this.getState());
        }
        break;

      case 'stateReport':
        // Iframe reporting its state
        this.savedState = data.state;
        break;
    }
  }

  /**
   * Send message to iframe
   */
  sendMessage(action, data = {}) {
    if (this.iframe && this.iframe.contentWindow) {
      this.iframe.contentWindow.postMessage({
        type: 'dashboard',
        action,
        ...data,
      }, window.location.origin);
    }
  }

  /**
   * Restore state in iframe
   */
  restoreState(state) {
    this.sendMessage('restoreState', { state });
  }

  /**
   * Get current state
   */
  getState() {
    return this.savedState || {
      activeExercise: null,
      repCount: 0,
      exercisesCompleted: [],
    };
  }

  /**
   * Pause the section (when navigating away)
   * Camera turns off, state is preserved
   */
  pause() {
    console.log('[Exercise] Pausing section');

    // Request state from iframe before pausing
    this.sendMessage('getState');

    // Pause camera via iframe
    this.sendMessage('pauseCamera');

    // Pause voice workflow
    this.sendMessage('pauseWorkflow');

    this.isActive = false;

    return this.getState();
  }

  /**
   * Resume the section (when returning)
   * Camera turns back on, state is restored
   */
  async resume(savedState) {
    console.log('[Exercise] Resuming section');

    if (savedState) {
      this.savedState = savedState;
      this.restoreState(savedState);
    }

    // Resume camera via iframe
    this.sendMessage('resumeCamera');

    // Resume voice workflow
    this.sendMessage('resumeWorkflow');

    this.isActive = true;
  }

  /**
   * Unmount the section
   */
  unmount() {
    console.log('[Exercise] Unmounting section');

    // Request final state
    this.sendMessage('getState');

    // Clean up message listener
    if (this.messageHandler) {
      window.removeEventListener('message', this.messageHandler);
    }

    // Clear container
    if (this.container) {
      this.container.innerHTML = '';
    }

    this.iframe = null;
    this.isActive = false;
  }
}
