/**
 * MayaMind Landing Page
 *
 * Displays a rotating slideshow of images with Ken Burns effect.
 * Shows on every visit, dismissed by button click or tap-anywhere.
 */

const IMAGES = [
  '/images/diana-light-uUMP9dXIm-o-unsplash.jpg',
  '/images/pexels-mikhail-nilov-6975769.jpg',
  '/images/kateryna-hliznitsova-PFzuNhy2dh8-unsplash.jpg',
  '/images/getty-images-r_ftvGYIAlw-unsplash.jpg',
  '/images/getty-images-fVnW1EkTJS0-unsplash.jpg',
  '/images/getty-images-WTKMk6A-R5A-unsplash.jpg',
  '/images/getty-images-hl1hcMT9A2s-unsplash.jpg',
  '/images/getty-images--JDI6Z8GhUk-unsplash.jpg',
  '/images/getty-images-LRorTPQTKt8-unsplash.jpg',
  '/images/getty-images-l1FT4E7pfgw-unsplash.jpg',
];

const SLIDE_DURATION = 8000; // 8 seconds per image
const FADE_DURATION = 1000;  // 1 second crossfade

// Ken Burns animation variants (cycled through)
const ANIMATIONS = [
  'ken-burns-zoom-in',
  'ken-burns-zoom-out',
  'ken-burns-pan-left',
  'ken-burns-pan-right',
];

class LandingPage {
  constructor(options = {}) {
    this.onEnter = options.onEnter || (() => {});
    this.onSettings = options.onSettings || (() => {});

    this.currentIndex = 0;
    this.slideInterval = null;
    this.isVisible = true;
    this.prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // DOM elements (set after init)
    this.container = null;
    this.slides = [];
    this.activeSlideIndex = 0;
  }

  /**
   * Initialize the landing page
   */
  init() {
    this.container = document.getElementById('landing-page');
    if (!this.container) {
      console.warn('[Landing] Landing page container not found');
      return;
    }

    // Cache slide elements
    this.slides = [
      this.container.querySelector('.landing-slide-a'),
      this.container.querySelector('.landing-slide-b'),
    ];

    // Preload all images
    this.preloadImages();

    // Set up first slide
    this.showSlide(0);

    // Start slideshow
    this.startSlideshow();

    // Set up event listeners
    this.setupEventListeners();

    console.log('[Landing] Initialized');
  }

  /**
   * Preload images to prevent flashing
   */
  preloadImages() {
    IMAGES.forEach(src => {
      const img = new Image();
      img.src = src;
    });
  }

  /**
   * Show a specific slide
   */
  showSlide(index) {
    const slide = this.slides[this.activeSlideIndex];
    const nextSlide = this.slides[1 - this.activeSlideIndex];

    // Set background image on next slide
    nextSlide.style.backgroundImage = `url('${IMAGES[index]}')`;

    // Apply Ken Burns animation (unless user prefers reduced motion)
    if (!this.prefersReducedMotion) {
      const animationClass = ANIMATIONS[index % ANIMATIONS.length];
      nextSlide.classList.remove(...ANIMATIONS);
      nextSlide.classList.add(animationClass);
    }

    // Crossfade: bring next slide to front
    nextSlide.classList.add('active');
    slide.classList.remove('active');

    // Swap active slide index for next transition
    this.activeSlideIndex = 1 - this.activeSlideIndex;
    this.currentIndex = index;
  }

  /**
   * Advance to next slide
   */
  nextSlide() {
    const nextIndex = (this.currentIndex + 1) % IMAGES.length;
    this.showSlide(nextIndex);
  }

  /**
   * Start the slideshow timer
   */
  startSlideshow() {
    if (this.slideInterval) return;

    this.slideInterval = setInterval(() => {
      this.nextSlide();
    }, SLIDE_DURATION);
  }

  /**
   * Stop the slideshow timer
   */
  stopSlideshow() {
    if (this.slideInterval) {
      clearInterval(this.slideInterval);
      this.slideInterval = null;
    }
  }

  /**
   * Set up event listeners
   */
  setupEventListeners() {
    // Settings button
    const settingsBtn = this.container.querySelector('.landing-settings-btn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onSettings();
      });
    }

    // Tap anywhere to enter (except on settings button)
    this.container.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      this.enter();
    });
  }

  /**
   * Enter the dashboard (hide landing page)
   */
  enter() {
    if (!this.isVisible) return;

    this.isVisible = false;
    this.stopSlideshow();

    // Fade out animation
    this.container.classList.add('fade-out');

    // Hide after animation completes
    setTimeout(() => {
      this.container.classList.add('hidden');
      this.onEnter();
    }, 500);

    console.log('[Landing] Entering dashboard');
  }

  /**
   * Show the landing page (for re-display if needed)
   */
  show() {
    if (this.isVisible) return;

    this.isVisible = true;
    this.container.classList.remove('hidden', 'fade-out');
    this.startSlideshow();
  }

  /**
   * Clean up resources
   */
  destroy() {
    this.stopSlideshow();
  }
}

export { LandingPage };
