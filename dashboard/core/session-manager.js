/**
 * MayaMind Dashboard — Session Manager
 *
 * Manages session persistence across navigation with 15-minute timeout.
 * Tracks session state for each section and handles automatic cleanup.
 */

export class SessionManager {
  constructor(options = {}) {
    this.timeoutMs = options.timeoutMs || 15 * 60 * 1000; // 15 minutes
    this.checkIntervalMs = options.checkIntervalMs || 60 * 1000; // Check every minute

    // Session state for each section
    this.sessions = {
      maya: { active: false, paused: false, state: null, lastActivity: null },
      exercise: { active: false, paused: false, state: null, lastActivity: null },
      health: { active: false, paused: false, state: null, lastActivity: null },
      connect: { active: false, paused: false, state: null, lastActivity: null },
    };

    // Callbacks
    this.onSessionExpired = options.onSessionExpired || null;
    this.onSessionStateChange = options.onSessionStateChange || null;

    // Start timeout checker
    this.checkerId = null;
    this.startTimeoutChecker();
  }

  /**
   * Start a new session for a section
   */
  startSession(sectionId) {
    if (!this.sessions[sectionId]) {
      console.warn(`[SessionManager] Unknown section: ${sectionId}`);
      return;
    }

    console.log(`[SessionManager] Starting session: ${sectionId}`);
    this.sessions[sectionId] = {
      active: true,
      paused: false,
      state: null,
      lastActivity: Date.now(),
    };

    this.notifyStateChange(sectionId);
  }

  /**
   * Pause a session (when navigating away)
   */
  pauseSession(sectionId) {
    const session = this.sessions[sectionId];
    if (!session || !session.active) return;

    console.log(`[SessionManager] Pausing session: ${sectionId}`);
    session.paused = true;
    session.lastActivity = Date.now();

    this.notifyStateChange(sectionId);
  }

  /**
   * Resume a paused session
   */
  resumeSession(sectionId) {
    const session = this.sessions[sectionId];
    if (!session || !session.active) return;

    console.log(`[SessionManager] Resuming session: ${sectionId}`);
    session.paused = false;
    session.lastActivity = Date.now();

    this.notifyStateChange(sectionId);
  }

  /**
   * End a session (explicit end or timeout)
   */
  endSession(sectionId, reason = 'manual') {
    const session = this.sessions[sectionId];
    if (!session || !session.active) return;

    console.log(`[SessionManager] Ending session: ${sectionId} (reason: ${reason})`);
    session.active = false;
    session.paused = false;
    session.state = null;
    session.lastActivity = null;

    this.notifyStateChange(sectionId);

    if (reason === 'timeout' && this.onSessionExpired) {
      this.onSessionExpired(sectionId);
    }
  }

  /**
   * Save state for a section
   */
  saveState(sectionId, state) {
    const session = this.sessions[sectionId];
    if (!session) return;

    session.state = state;
    session.lastActivity = Date.now();
  }

  /**
   * Get saved state for a section
   */
  getState(sectionId) {
    const session = this.sessions[sectionId];
    return session?.state || null;
  }

  /**
   * Record activity (resets timeout)
   */
  recordActivity(sectionId) {
    const session = this.sessions[sectionId];
    if (session && session.active) {
      session.lastActivity = Date.now();
    }
  }

  /**
   * Check if a section has an active session
   */
  isActive(sectionId) {
    return this.sessions[sectionId]?.active || false;
  }

  /**
   * Check if a section's session is paused
   */
  isPaused(sectionId) {
    const session = this.sessions[sectionId];
    return session?.active && session?.paused || false;
  }

  /**
   * Get session info for UI display
   */
  getSessionInfo(sectionId) {
    const session = this.sessions[sectionId];
    if (!session || !session.active) {
      return { status: 'inactive' };
    }

    const elapsed = Date.now() - session.lastActivity;
    const remaining = Math.max(0, this.timeoutMs - elapsed);

    return {
      status: session.paused ? 'paused' : 'active',
      remainingMs: remaining,
      remainingMinutes: Math.ceil(remaining / 60000),
    };
  }

  /**
   * Check all sessions for timeout
   */
  checkTimeouts() {
    const now = Date.now();

    for (const [sectionId, session] of Object.entries(this.sessions)) {
      if (session.active && session.paused && session.lastActivity) {
        const elapsed = now - session.lastActivity;
        if (elapsed >= this.timeoutMs) {
          this.endSession(sectionId, 'timeout');
        }
      }
    }
  }

  /**
   * Start the timeout checker interval
   */
  startTimeoutChecker() {
    if (this.checkerId) return;

    this.checkerId = setInterval(() => {
      this.checkTimeouts();
    }, this.checkIntervalMs);
  }

  /**
   * Stop the timeout checker
   */
  stopTimeoutChecker() {
    if (this.checkerId) {
      clearInterval(this.checkerId);
      this.checkerId = null;
    }
  }

  /**
   * Notify listeners of state change
   */
  notifyStateChange(sectionId) {
    if (this.onSessionStateChange) {
      this.onSessionStateChange(sectionId, this.getSessionInfo(sectionId));
    }
  }

  /**
   * Cleanup
   */
  destroy() {
    this.stopTimeoutChecker();
    for (const sectionId of Object.keys(this.sessions)) {
      if (this.sessions[sectionId].active) {
        this.endSession(sectionId, 'shutdown');
      }
    }
  }
}
