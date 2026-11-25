
'use strict';

import {
  renderFacebookSettings,
  bindFacebookSettingsEvents
} from './settings.js';

import {
  renderFacebookPosts,
  bindFacebookPostsEvents
} from './posts.js';

import {
  renderFacebookDashboard,
  bindFacebookDashboardEvents
} from './dashboard.js';

import {
  renderFacebookHistory,
  bindFacebookHistoryEvents
} from './history.js';

import {
  renderFacebookComments,
  bindFacebookCommentsEvents
} from './comments.js';

// ========================================
// Facebook Navigation
// ========================================

const FACEBOOK_SECTIONS = [
  {
    id: 'dashboard',
    label: 'Dashboard'
  },
  {
    id: 'settings',
    label: 'Page Settings'
  },
  {
    id: 'posts',
    label: 'Product Posts'
  },
  {
    id: 'history',
    label: 'Post History'
  },
  {
    id: 'comments',
    label: 'Comments & Replies'
  }
];

// ========================================
// Render Navigation
// ========================================

function renderFacebookNavigation() {
  return `
    <nav
      class="fb-page-navigation"
      aria-label="Facebook Management Navigation"
    >
      ${FACEBOOK_SECTIONS.map(section => `
        <button
          type="button"
          class="fb-page-nav-button"
          data-fb-section-nav="${section.id}"
          aria-controls="fb-section-${section.id}"
          aria-current="${section.id === 'dashboard' ? 'page' : 'false'}"
        >
          ${section.label}
        </button>
      `).join('')}
    </nav>
  `;
}

// ========================================
// Render Facebook Page
// ========================================

export function renderFacebookPage() {
  return `
    <div class="fb-page-layout">

      ${renderFacebookNavigation()}

      <!-- Dashboard -->

      <section
        id="fb-section-dashboard"
        class="fb-page-section"
        data-fb-section="dashboard"
      >
        ${renderFacebookDashboard()}
      </section>

      <!-- Facebook Page Settings -->

      <section
        id="fb-section-settings"
        class="fb-page-section"
        data-fb-section="settings"
        hidden
      >
        ${renderFacebookSettings()}
      </section>

      <!-- Product Posts -->

      <section
        id="fb-section-posts"
        class="fb-page-section fb-posts-section"
        data-fb-section="posts"
        hidden
      >

        <header class="fb-section-header">

          <div>
            <span class="fb-eyebrow">
              FACEBOOK MANAGEMENT
            </span>

            <h2>Product Posts</h2>

            <p>
              Select a product, generate a caption with Gemini
              and publish it to your selected Facebook Page.
            </p>
          </div>

          <button
            type="button"
            class="fb-button"
            data-fb-back-dashboard
          >
            Back to Dashboard
          </button>

        </header>

        ${renderFacebookPosts()}

      </section>

      <!-- Published Posts History -->

      <section
        id="fb-section-history"
        class="fb-page-section fb-history-section"
        data-fb-section="history"
        hidden
      >

        <header class="fb-section-header">

          <div>
            <span class="fb-eyebrow">
              FACEBOOK MANAGEMENT
            </span>

            <h2>Post History</h2>

            <p>
              View published posts, failed publishing attempts
              and Facebook post details.
            </p>
          </div>

          <button
            type="button"
            class="fb-button"
            data-fb-back-dashboard
          >
            Back to Dashboard
          </button>

        </header>

        ${renderFacebookHistory()}

      </section>

      <!-- Facebook Comments & Replies -->

      <section
        id="fb-section-comments"
        class="fb-page-section fb-comments-section"
        data-fb-section="comments"
        hidden
      >

        <header class="fb-section-header">

          <div>
            <span class="fb-eyebrow">
              FACEBOOK ENGAGEMENT
            </span>

            <h2>Comments & Replies</h2>

            <p>
              View customer comments, related products,
              reply history and reply sources.
            </p>
          </div>

          <button
            type="button"
            class="fb-button"
            data-fb-back-dashboard
          >
            Back to Dashboard
          </button>

        </header>

        ${renderFacebookComments()}

      </section>

    </div>
  `;
}

// ========================================
// Show / Hide Sections
// ========================================

function setActiveFacebookSection(root, sectionName) {
  const sectionExists = FACEBOOK_SECTIONS.some(
    section => section.id === sectionName
  );

  if (!sectionExists) {
    sectionName = 'dashboard';
  }

  // Show selected section and hide the others.

  root.querySelectorAll('[data-fb-section]').forEach(section => {
    const isActive =
      section.dataset.fbSection === sectionName;

    section.hidden = !isActive;

    // Prevent CSS display rules from overriding hidden.
    section.style.display = isActive ? '' : 'none';
  });

  // Update navigation button states.

  root.querySelectorAll('[data-fb-section-nav]').forEach(button => {
    const isActive =
      button.dataset.fbSectionNav === sectionName;

    button.classList.toggle('is-active', isActive);

    button.setAttribute(
      'aria-current',
      isActive ? 'page' : 'false'
    );
  });

  // Store current section on the page.

  root.dataset.fbActiveSection = sectionName;

  // Move viewport to the selected section.

  const activeSection = root.querySelector(
    `[data-fb-section="${sectionName}"]`
  );

  if (activeSection) {
    activeSection.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }
}

// ========================================
// Bind Facebook Navigation
// ========================================

function bindFacebookNavigation(root) {
  // Navigation buttons.

  root.querySelectorAll('[data-fb-section-nav]').forEach(button => {
    if (button.dataset.bound) return;

    button.dataset.bound = 'true';

    button.addEventListener('click', () => {
      setActiveFacebookSection(
        root,
        button.dataset.fbSectionNav
      );
    });
  });

  // Back to Dashboard buttons.

  root.querySelectorAll('[data-fb-back-dashboard]').forEach(button => {
    if (button.dataset.bound) return;

    button.dataset.bound = 'true';

    button.addEventListener('click', () => {
      setActiveFacebookSection(root, 'dashboard');
    });
  });

  // Dashboard quick actions:
  // Product Posts / Facebook Settings / Post History / Comments.

  if (!root.dataset.fbDashboardNavigationBound) {
    root.dataset.fbDashboardNavigationBound = 'true';

    root.addEventListener('click', event => {
      const button = event.target.closest(
        '[data-fb-dashboard-scroll]'
      );

      if (!button || !root.contains(button)) return;

      const target = button.dataset.fbDashboardScroll;

      if (
        FACEBOOK_SECTIONS.some(
          section => section.id === target
        )
      ) {
        setActiveFacebookSection(root, target);
      }
    }, true);
  }

  // Management Tools > Product Posts card.

  const productPostsCard = Array.from(
    root.querySelectorAll('.fb-dashboard-feature')
  ).find(card => {
    const heading = card.querySelector('h4');

    return heading &&
      heading.textContent.trim() === 'Product Posts';
  });

  if (productPostsCard) {
    productPostsCard.classList.add(
      'fb-dashboard-feature-clickable'
    );

    productPostsCard.setAttribute('role', 'button');
    productPostsCard.setAttribute('tabindex', '0');

    productPostsCard.setAttribute(
      'aria-label',
      'Open Product Posts'
    );

    if (!productPostsCard.dataset.bound) {
      productPostsCard.dataset.bound = 'true';

      productPostsCard.addEventListener('click', () => {
        setActiveFacebookSection(root, 'posts');
      });

      // Keyboard accessibility.

      productPostsCard.addEventListener('keydown', event => {
        if (
          event.key !== 'Enter' &&
          event.key !== ' '
        ) {
          return;
        }

        event.preventDefault();

        setActiveFacebookSection(root, 'posts');
      });
    }
  }

  // Management Tools > Comment Management card.

  const commentsCard = Array.from(
    root.querySelectorAll('.fb-dashboard-feature')
  ).find(card => {
    const heading = card.querySelector('h4');

    return heading &&
      heading.textContent.trim() === 'Comment Management';
  });

  if (commentsCard) {
    commentsCard.classList.add(
      'fb-dashboard-feature-clickable'
    );

    commentsCard.setAttribute('role', 'button');
    commentsCard.setAttribute('tabindex', '0');

    commentsCard.setAttribute(
      'aria-label',
      'Open Facebook Comments'
    );

    if (!commentsCard.dataset.bound) {
      commentsCard.dataset.bound = 'true';

      commentsCard.addEventListener('click', () => {
        setActiveFacebookSection(root, 'comments');
      });

      commentsCard.addEventListener('keydown', event => {
        if (
          event.key !== 'Enter' &&
          event.key !== ' '
        ) {
          return;
        }

        event.preventDefault();

        setActiveFacebookSection(root, 'comments');
      });
    }
  }
}

// ========================================
// Bind Facebook Page Events
// ========================================

export function bindFacebookPageEvents(context) {
  const root = context?.container;

  if (!(root instanceof HTMLElement)) {
    console.error(
      '[FACEBOOK] Invalid page container:',
      context
    );

    return;
  }

  // Navigation must bind before dashboard events.

  bindFacebookNavigation(root);

  // Dashboard overview and quick actions.

  bindFacebookDashboardEvents(root);

  // Facebook connection and Page settings.

  bindFacebookSettingsEvents(root);

  // Product selection, Gemini caption and publishing.

  bindFacebookPostsEvents(root);

  // Published Posts History.

  bindFacebookHistoryEvents(root);

  // Facebook Customer Comments and Replies.

  bindFacebookCommentsEvents(root);

  // Initial section.

  setActiveFacebookSection(root, 'dashboard');
}
