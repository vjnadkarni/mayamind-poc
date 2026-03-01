/**
 * MayaMind Dashboard — Main Application
 *
 * Orchestrates navigation between sections with session persistence.
 * Coordinates section lifecycle (mount/unmount/pause/resume).
 */

import { SessionManager } from './core/session-manager.js';
import { AudioManager } from './core/audio-manager.js';
import { TTSService } from './core/tts-service.js';
import { connectStore } from './core/connect-store.js';

// Section modules (lazy loaded)
let MayaSection = null;
let ExerciseSection = null;
let HealthSection = null;
let ConnectSection = null;

// ── Application State ────────────────────────────────────────────────────────

const state = {
  currentSection: 'dashboard',
  sections: {},
  sessionManager: null,
  ttsService: null,
  initialized: false,
  unreadWhatsAppCount: 0,
  globalSSE: null,
  isMuted: false,
};

// ── DOM Elements ─────────────────────────────────────────────────────────────

const elements = {
  dashboard: null,
  sectionContainer: null,
  dashboardBtn: null,
  muteBtn: null,
  loadingOverlay: null,
  loadingText: null,
  blocks: {},
  sections: {},
};

// ── Initialization ───────────────────────────────────────────────────────────

async function init() {
  console.log('[Dashboard] Initializing...');

  // Cache DOM elements
  elements.dashboard = document.getElementById('dashboard');
  elements.sectionContainer = document.getElementById('section-container');
  elements.dashboardBtn = document.getElementById('dashboard-btn');
  elements.muteBtn = document.getElementById('mute-btn');
  elements.loadingOverlay = document.getElementById('loading-overlay');
  elements.loadingText = document.getElementById('loading-text');

  // Cache section elements
  elements.sections = {
    maya: document.getElementById('maya-section'),
    exercise: document.getElementById('exercise-section'),
    health: document.getElementById('health-section'),
    connect: document.getElementById('connect-section'),
  };

  // Initialize session manager
  state.sessionManager = new SessionManager({
    timeoutMs: 15 * 60 * 1000, // 15 minutes
    onSessionExpired: handleSessionExpired,
    onSessionStateChange: handleSessionStateChange,
  });

  // Initialize TTS service
  state.ttsService = new TTSService();

  // Initialize ConnectStore (needed to save messages received while not in Connect section)
  await connectStore.initialize();

  // Set up event listeners
  setupEventListeners();

  // Start global SSE listener for WhatsApp notifications
  setupGlobalSSE();

  // Update UI
  updateDashboardUI();

  state.initialized = true;
  console.log('[Dashboard] Ready');
}

// ── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
  // Dashboard block clicks
  document.querySelectorAll('.dashboard-block').forEach(block => {
    block.addEventListener('click', () => {
      const sectionId = block.dataset.section;
      if (!block.classList.contains('placeholder')) {
        navigateToSection(sectionId);
      }
    });

    // Cache block element
    elements.blocks[block.dataset.section] = block;
  });

  // Dashboard button (return from section)
  elements.dashboardBtn.addEventListener('click', () => {
    navigateToDashboard();
  });

  // Mute button toggle
  elements.muteBtn.addEventListener('click', () => {
    toggleMute();
  });

  // Resume AudioContext on first user interaction
  document.addEventListener('click', async () => {
    if (!AudioManager.isReady()) {
      await AudioManager.resume();
    }
  }, { once: true });
}

// ── Global SSE for WhatsApp Notifications ────────────────────────────────────

function setupGlobalSSE() {
  const SSE_URL = '/api/whatsapp/events';

  function connect() {
    if (state.globalSSE) return;

    state.globalSSE = new EventSource(SSE_URL);

    state.globalSSE.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'message' && state.currentSection !== 'connect') {
          // Save message to ConnectStore so it's available when Connect section opens
          saveIncomingMessage(msg);
          state.unreadWhatsAppCount++;
          updateConnectBadge();
          console.log(`[Dashboard] WhatsApp notification: ${state.unreadWhatsAppCount} unread`);
        }
      } catch (err) {
        // Ignore parse errors (heartbeats, etc.)
      }
    };

    state.globalSSE.onerror = () => {
      state.globalSSE?.close();
      state.globalSSE = null;
      setTimeout(connect, 5000);
    };
  }

  connect();
}

function saveIncomingMessage(msg) {
  try {
    // Find or create contact
    let contact = connectStore.findContactByPhone(msg.from);
    if (!contact) {
      contact = connectStore.addContact(msg.from, msg.from);
    }

    // Determine message type
    const type = (msg.mediaType && msg.mediaType.startsWith('audio')) ? 'voice'
      : (msg.mediaType && msg.mediaType.startsWith('image')) ? 'image'
      : 'text';

    // Save to store (marked as unread)
    connectStore.addMessage(
      contact.id,
      'received',
      type,
      msg.body || null,
      msg.mediaUrl || null
    );
    console.log(`[Dashboard] Saved message from ${contact.name} to ConnectStore`);
  } catch (err) {
    console.error('[Dashboard] Failed to save incoming message:', err);
  }
}

function updateConnectBadge() {
  const block = elements.blocks['connect'];
  if (!block) return;

  const statusEl = block.querySelector('#connect-status');
  if (!statusEl) return;

  if (state.unreadWhatsAppCount > 0) {
    statusEl.textContent = `${state.unreadWhatsAppCount} new`;
    statusEl.className = 'block-status notification';
  } else {
    // Restore normal status
    const isActive = state.sessionManager.isActive('connect');
    const isPaused = state.sessionManager.isPaused('connect');
    if (isPaused) {
      statusEl.textContent = 'Paused';
      statusEl.className = 'block-status paused';
    } else if (isActive) {
      statusEl.textContent = 'Active';
      statusEl.className = 'block-status active';
    } else {
      statusEl.className = 'block-status';
    }
  }
}

function clearConnectBadge() {
  state.unreadWhatsAppCount = 0;
  updateConnectBadge();
}

// ── Mute / Unmute ───────────────────────────────────────────────────────────

function setMuted(muted) {
  state.isMuted = muted;
  updateMuteUI();
  console.log(`[Dashboard] Mute: ${muted ? 'ON' : 'OFF'}`);
}

function toggleMute() {
  setMuted(!state.isMuted);
}

function updateMuteUI() {
  if (!elements.muteBtn) return;

  if (state.isMuted) {
    elements.muteBtn.classList.add('muted');
    elements.muteBtn.querySelector('.mute-label').textContent = 'Unmute';
    elements.muteBtn.title = 'Unmute microphone';
  } else {
    elements.muteBtn.classList.remove('muted');
    elements.muteBtn.querySelector('.mute-label').textContent = 'Mute';
    elements.muteBtn.title = 'Mute microphone';
  }
}

// ── Navigation ───────────────────────────────────────────────────────────────

async function navigateToSection(sectionId) {
  if (state.currentSection === sectionId) return;
  if (!['maya', 'exercise', 'health', 'connect'].includes(sectionId)) return;

  console.log(`[Dashboard] Navigating to: ${sectionId}`);

  // Clear notification badge when entering Connect section
  if (sectionId === 'connect') {
    clearConnectBadge();
  }

  // Pause current section if active
  if (state.currentSection !== 'dashboard') {
    await pauseCurrentSection();
  }

  // Show loading
  showLoading(`Loading ${sectionId}...`);

  // Show section container
  elements.dashboard.classList.add('hidden');
  elements.sectionContainer.classList.remove('hidden');

  // Hide all sections, show target
  Object.values(elements.sections).forEach(el => el.classList.add('hidden'));
  elements.sections[sectionId].classList.remove('hidden');

  // Mount or resume section
  const hasActiveSession = state.sessionManager.isActive(sectionId);

  if (hasActiveSession) {
    // Resume existing session
    await resumeSection(sectionId);
    state.sessionManager.resumeSession(sectionId);
  } else {
    // Mount new section
    await mountSection(sectionId);
    state.sessionManager.startSession(sectionId);
  }

  state.currentSection = sectionId;
  hideLoading();
  updateDashboardUI();
}

function navigateToDashboard() {
  if (state.currentSection === 'dashboard') return;

  console.log('[Dashboard] Returning to dashboard');

  // Pause current section
  pauseCurrentSection();

  // Hide section container, show dashboard
  elements.sectionContainer.classList.add('hidden');
  elements.dashboard.classList.remove('hidden');

  state.currentSection = 'dashboard';
  updateDashboardUI();
}

// ── Section Lifecycle ────────────────────────────────────────────────────────

async function mountSection(sectionId) {
  console.log(`[Dashboard] Mounting section: ${sectionId}`);

  const container = elements.sections[sectionId].querySelector('.section-content');
  const savedState = state.sessionManager.getState(sectionId);

  switch (sectionId) {
    case 'maya':
      await mountMayaSection(container, savedState);
      break;
    case 'exercise':
      await mountExerciseSection(container, savedState);
      break;
    case 'health':
      await mountHealthSection(container, savedState);
      break;
    case 'connect':
      await mountConnectSection(container, savedState);
      break;
  }
}

async function pauseCurrentSection() {
  const sectionId = state.currentSection;
  if (sectionId === 'dashboard') return;

  console.log(`[Dashboard] Pausing section: ${sectionId}`);

  const section = state.sections[sectionId];
  if (section && typeof section.pause === 'function') {
    const savedState = section.pause();
    state.sessionManager.saveState(sectionId, savedState);
  }

  state.sessionManager.pauseSession(sectionId);
}

async function resumeSection(sectionId) {
  console.log(`[Dashboard] Resuming section: ${sectionId}`);

  const section = state.sections[sectionId];
  const savedState = state.sessionManager.getState(sectionId);

  if (section && typeof section.resume === 'function') {
    await section.resume(savedState);
  } else {
    // Section not yet instantiated, mount it
    const container = elements.sections[sectionId].querySelector('.section-content');
    await mountSection(sectionId);
  }
}

async function unmountSection(sectionId) {
  console.log(`[Dashboard] Unmounting section: ${sectionId}`);

  const section = state.sections[sectionId];
  if (section && typeof section.unmount === 'function') {
    section.unmount();
  }

  state.sections[sectionId] = null;
}

// ── Maya Section ─────────────────────────────────────────────────────────────

async function mountMayaSection(container, savedState) {
  // Lazy load Maya section module
  if (!MayaSection) {
    const module = await import('./sections/maya/maya-section.js');
    MayaSection = module.MayaSection;
  }

  const section = new MayaSection({
    ttsService: state.ttsService,
    isMuted: () => state.isMuted,
    setMuted: (val) => setMuted(val),
    onStateChange: (sectionState) => {
      state.sessionManager.saveState('maya', sectionState);
      state.sessionManager.recordActivity('maya');
    },
  });

  await section.mount(container, savedState);
  state.sections.maya = section;
}

// ── Exercise Section ─────────────────────────────────────────────────────────

async function mountExerciseSection(container, savedState) {
  // Lazy load Exercise section module
  if (!ExerciseSection) {
    const module = await import('./sections/exercise/exercise-section.js');
    ExerciseSection = module.ExerciseSection;
  }

  const section = new ExerciseSection({
    ttsService: state.ttsService,
    onStateChange: (sectionState) => {
      state.sessionManager.saveState('exercise', sectionState);
      state.sessionManager.recordActivity('exercise');
    },
    onRepUpdate: () => {
      state.sessionManager.recordActivity('exercise');
    },
  });

  await section.mount(container, savedState);
  state.sections.exercise = section;
}

// ── Health Section (Placeholder) ─────────────────────────────────────────────

async function mountHealthSection(container, savedState) {
  // Lazy load Health section module
  if (!HealthSection) {
    const module = await import('./sections/health/health-section.js');
    HealthSection = module.HealthSection;
  }

  const section = new HealthSection();
  await section.mount(container, savedState);
  state.sections.health = section;
}

// ── Connect Section ──────────────────────────────────────────────────────────

async function mountConnectSection(container, savedState) {
  // Lazy load Connect section module
  if (!ConnectSection) {
    const module = await import('./sections/connect/connect-section.js');
    ConnectSection = module.ConnectSection;
  }

  const section = new ConnectSection({
    ttsService: state.ttsService,
    isMuted: () => state.isMuted,
    setMuted: (val) => setMuted(val),
    onStateChange: (sectionState) => {
      state.sessionManager.saveState('connect', sectionState);
      state.sessionManager.recordActivity('connect');
    },
  });

  await section.mount(container, savedState);
  state.sections.connect = section;
}

// ── Session Callbacks ────────────────────────────────────────────────────────

function handleSessionExpired(sectionId) {
  console.log(`[Dashboard] Session expired: ${sectionId}`);

  // Unmount section
  unmountSection(sectionId);

  // If user is viewing this section, return to dashboard
  if (state.currentSection === sectionId) {
    navigateToDashboard();
    showToast(`Your ${sectionId} session has expired`);
  }

  updateDashboardUI();
}

function handleSessionStateChange(sectionId, info) {
  updateDashboardUI();
}

// ── UI Updates ───────────────────────────────────────────────────────────────

function updateDashboardUI() {
  // Update block states
  for (const [sectionId, block] of Object.entries(elements.blocks)) {
    if (!block) continue;

    const isActive = state.sessionManager.isActive(sectionId);
    const isPaused = state.sessionManager.isPaused(sectionId);

    block.classList.toggle('active', isActive && !isPaused);
    block.classList.toggle('paused', isPaused);

    // Update status badge (skip if Connect has unread notifications)
    const statusEl = block.querySelector('.block-status');
    if (statusEl) {
      if (sectionId === 'connect' && state.unreadWhatsAppCount > 0) {
        // Preserve notification badge — don't overwrite with session status
      } else if (isPaused) {
        statusEl.textContent = 'Paused';
        statusEl.className = 'block-status paused';
      } else if (isActive) {
        statusEl.textContent = 'Active';
        statusEl.className = 'block-status active';
      } else {
        statusEl.className = 'block-status';
      }
    }
  }
}

function showLoading(text = 'Loading...') {
  elements.loadingText.textContent = text;
  elements.loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
  elements.loadingOverlay.classList.add('hidden');
}

function showToast(message) {
  // Simple toast notification
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.8);
    color: white;
    padding: 16px 24px;
    border-radius: 12px;
    font-size: 16px;
    z-index: 1000;
    animation: fadeIn 0.3s ease;
  `;
  document.body.appendChild(toast);

  setTimeout(() => {
    toast.style.animation = 'fadeOut 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ── Start Application ────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', init);
