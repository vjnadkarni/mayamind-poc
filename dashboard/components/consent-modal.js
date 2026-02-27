/**
 * MayaMind Consent Modal Component
 *
 * UI modal for displaying consent prompts and privacy options.
 * Used for Tier 2/3 opt-in flows and "What Maya Knows" transparency.
 */

export class ConsentModal {
  constructor(options = {}) {
    this.onAccept = options.onAccept || (() => {});
    this.onDecline = options.onDecline || (() => {});
    this.onClose = options.onClose || (() => {});

    this.modal = null;
    this.overlay = null;
  }

  /**
   * Show the consent modal
   */
  show(config) {
    // Remove any existing modal
    this.hide();

    // Create overlay
    this.overlay = document.createElement('div');
    this.overlay.className = 'consent-overlay';
    this.overlay.addEventListener('click', () => this.hide());

    // Create modal
    this.modal = document.createElement('div');
    this.modal.className = 'consent-modal';
    this.modal.innerHTML = this.buildModalContent(config);

    // Add to body
    document.body.appendChild(this.overlay);
    document.body.appendChild(this.modal);

    // Add styles
    this.injectStyles();

    // Setup event handlers
    this.setupEvents(config);

    // Animate in
    requestAnimationFrame(() => {
      this.overlay.classList.add('visible');
      this.modal.classList.add('visible');
    });
  }

  /**
   * Build modal content based on type
   */
  buildModalContent(config) {
    const { type, title, message, acceptLabel, declineLabel, data } = config;

    if (type === 'what_maya_knows') {
      return this.buildWhatMayaKnowsContent(data);
    }

    // Default consent prompt
    return `
      <div class="consent-header">
        <h2>${title || 'Privacy Settings'}</h2>
        <button class="consent-close">&times;</button>
      </div>
      <div class="consent-body">
        <p>${message || ''}</p>
      </div>
      <div class="consent-footer">
        ${declineLabel ? `<button class="consent-btn decline">${declineLabel}</button>` : ''}
        ${acceptLabel ? `<button class="consent-btn accept">${acceptLabel}</button>` : ''}
      </div>
    `;
  }

  /**
   * Build "What Maya Knows" transparency content
   */
  buildWhatMayaKnowsContent(data) {
    const { preferences = [], profiles = [], topics = [], sessions = [], consent = {} } = data || {};

    let tierLabel = 'Tier 1 (No Memory)';
    if (consent.tier_3_enabled) {
      tierLabel = 'Tier 3 (Full Personalization)';
    } else if (consent.tier_2_enabled) {
      tierLabel = 'Tier 2 (Preferences Only)';
    }

    return `
      <div class="consent-header">
        <h2>What Maya Knows About You</h2>
        <button class="consent-close">&times;</button>
      </div>
      <div class="consent-body wmk-body">
        <div class="wmk-tier">
          <span class="tier-badge">${tierLabel}</span>
        </div>

        ${preferences.length > 0 ? `
          <div class="wmk-section">
            <h3>Your Preferences</h3>
            <ul>
              ${preferences.map(p => `<li><strong>${this.formatKey(p.key)}:</strong> ${p.value}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${profiles.length > 0 ? `
          <div class="wmk-section">
            <h3>What I've Learned</h3>
            <ul>
              ${profiles.map(p => `<li><strong>${this.formatKey(p.profile_type)}:</strong> ${p.summary_text}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${topics.length > 0 ? `
          <div class="wmk-section">
            <h3>Your Interests</h3>
            <ul>
              ${topics.map(t => `<li><strong>${t.display_name}</strong> (${t.engagement_level}): ${t.summary || ''}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${sessions.length > 0 ? `
          <div class="wmk-section">
            <h3>Recent Conversations</h3>
            <ul>
              ${sessions.slice(0, 5).map(s => `<li>${new Date(s.created_at).toLocaleDateString()}: ${s.summary_text}</li>`).join('')}
            </ul>
          </div>
        ` : ''}

        ${preferences.length === 0 && profiles.length === 0 && topics.length === 0 ? `
          <p class="wmk-empty">Maya doesn't have any saved information about you yet.</p>
        ` : ''}
      </div>
      <div class="consent-footer wmk-footer">
        <button class="consent-btn decline forget-all">Forget Everything</button>
        <button class="consent-btn accept">Close</button>
      </div>
    `;
  }

  /**
   * Format a key for display
   */
  formatKey(key) {
    return key
      .replace(/_/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase());
  }

  /**
   * Setup event handlers
   */
  setupEvents(config) {
    const closeBtn = this.modal.querySelector('.consent-close');
    const acceptBtn = this.modal.querySelector('.consent-btn.accept');
    const declineBtn = this.modal.querySelector('.consent-btn.decline');
    const forgetBtn = this.modal.querySelector('.forget-all');

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        this.hide();
        this.onClose();
      });
    }

    if (acceptBtn) {
      acceptBtn.addEventListener('click', () => {
        this.hide();
        this.onAccept(config);
      });
    }

    if (declineBtn && !forgetBtn) {
      declineBtn.addEventListener('click', () => {
        this.hide();
        this.onDecline(config);
      });
    }

    if (forgetBtn) {
      forgetBtn.addEventListener('click', () => {
        if (confirm('Are you sure you want Maya to forget everything about you? This cannot be undone.')) {
          this.hide();
          this.onDecline({ ...config, action: 'forget_all' });
        }
      });
    }
  }

  /**
   * Hide the modal
   */
  hide() {
    if (this.overlay) {
      this.overlay.classList.remove('visible');
      setTimeout(() => this.overlay?.remove(), 300);
      this.overlay = null;
    }
    if (this.modal) {
      this.modal.classList.remove('visible');
      setTimeout(() => this.modal?.remove(), 300);
      this.modal = null;
    }
  }

  /**
   * Inject styles if not already present
   */
  injectStyles() {
    if (document.getElementById('consent-modal-styles')) return;

    const style = document.createElement('style');
    style.id = 'consent-modal-styles';
    style.textContent = `
      .consent-overlay {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.7);
        backdrop-filter: blur(4px);
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.3s ease;
      }
      .consent-overlay.visible {
        opacity: 1;
      }

      .consent-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.95);
        background: #1a1a2e;
        border-radius: 16px;
        border: 1px solid #333;
        width: 90%;
        max-width: 480px;
        max-height: 80vh;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        z-index: 1001;
        opacity: 0;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }
      .consent-modal.visible {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1);
      }

      .consent-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 20px 24px;
        border-bottom: 1px solid #333;
      }
      .consent-header h2 {
        margin: 0;
        font-size: 18px;
        font-weight: 600;
        color: #fff;
      }
      .consent-close {
        background: none;
        border: none;
        color: #666;
        font-size: 24px;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
      }
      .consent-close:hover {
        color: #fff;
      }

      .consent-body {
        padding: 24px;
        overflow-y: auto;
        flex: 1;
        color: #ccc;
        line-height: 1.6;
      }
      .consent-body p {
        margin: 0;
      }

      .consent-footer {
        display: flex;
        gap: 12px;
        padding: 20px 24px;
        border-top: 1px solid #333;
        justify-content: flex-end;
      }

      .consent-btn {
        padding: 12px 24px;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
      }
      .consent-btn.accept {
        background: #2563eb;
        color: #fff;
      }
      .consent-btn.accept:hover {
        background: #1d4ed8;
      }
      .consent-btn.decline {
        background: #333;
        color: #999;
      }
      .consent-btn.decline:hover {
        background: #444;
        color: #ccc;
      }
      .consent-btn.forget-all {
        background: #7f1d1d;
        color: #fca5a5;
      }
      .consent-btn.forget-all:hover {
        background: #991b1b;
      }

      /* What Maya Knows specific styles */
      .wmk-body {
        padding: 16px 24px;
      }
      .wmk-tier {
        margin-bottom: 20px;
      }
      .tier-badge {
        display: inline-block;
        padding: 6px 12px;
        background: #1e3a5f;
        color: #7dd3fc;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
      }
      .wmk-section {
        margin-bottom: 20px;
      }
      .wmk-section h3 {
        font-size: 14px;
        font-weight: 600;
        color: #888;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin: 0 0 12px 0;
      }
      .wmk-section ul {
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .wmk-section li {
        padding: 8px 12px;
        background: rgba(255, 255, 255, 0.05);
        border-radius: 6px;
        margin-bottom: 6px;
        font-size: 14px;
      }
      .wmk-section li strong {
        color: #fff;
      }
      .wmk-empty {
        text-align: center;
        color: #666;
        padding: 40px 0;
      }
      .wmk-footer {
        justify-content: space-between;
      }
    `;
    document.head.appendChild(style);
  }
}

// Singleton instance
let modalInstance = null;

/**
 * Get or create the modal instance
 */
export function getConsentModal(options = {}) {
  if (!modalInstance) {
    modalInstance = new ConsentModal(options);
  } else {
    // Update callbacks
    modalInstance.onAccept = options.onAccept || modalInstance.onAccept;
    modalInstance.onDecline = options.onDecline || modalInstance.onDecline;
    modalInstance.onClose = options.onClose || modalInstance.onClose;
  }
  return modalInstance;
}

/**
 * Show "What Maya Knows" modal
 */
export async function showWhatMayaKnows(personalizationStore, onForget) {
  const consent = personalizationStore.getConsentSettings();
  const preferences = personalizationStore.getAllPreferences();
  const profiles = consent.tier_3_enabled ? personalizationStore.getAllProfiles() : [];
  const topics = consent.tier_2_enabled ? personalizationStore.getAllTopics() : [];
  const sessions = consent.tier_3_enabled ? personalizationStore.getRecentSessions(5) : [];

  const modal = getConsentModal({
    onAccept: () => {},
    onDecline: async (config) => {
      if (config.action === 'forget_all' && onForget) {
        await onForget();
      }
    },
  });

  modal.show({
    type: 'what_maya_knows',
    data: { preferences, profiles, topics, sessions, consent }
  });
}
