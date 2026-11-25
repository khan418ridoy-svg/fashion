
'use strict';

import { facebookApi } from './facebook-api.js';

// ========================================
// Helpers
// ========================================

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function setText(root, selector, value) {
  const element = root.querySelector(selector);

  if (element) {
    element.textContent = value;
  }
}

function setStatus(element, text, type = '') {
  if (!element) return;

  element.textContent = text;
  element.classList.remove(
    'is-connected',
    'is-disconnected',
    'is-warning'
  );

  if (type) {
    element.classList.add(type);
  }
}

function formatDate(value) {
  if (!value) return 'Not available';

  const date = value.toDate
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleString('en-BD', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });
}

// ========================================
// Render Dashboard
// ========================================

export function renderFacebookDashboard() {
  return `
    <section class="fb-dashboard">

      <!-- Dashboard Header -->
      <header class="fb-dashboard-header">
        <div>
          <span class="fb-eyebrow">
            FACEBOOK BUSINESS CENTER
          </span>

          <h2>Facebook Dashboard</h2>

          <p>
            Manage your Facebook connection, Pages and
            product publishing from one place.
          </p>
        </div>

        <button
          class="fb-button"
          type="button"
          data-fb-dashboard-refresh
        >
          Refresh Overview
        </button>
      </header>

      <!-- Connection Overview -->
      <section class="fb-dashboard-grid">

        <article class="fb-dashboard-card fb-dashboard-connection">

          <div class="fb-dashboard-card-top">
            <div class="fb-dashboard-icon fb-dashboard-icon-blue">
              <span aria-hidden="true">f</span>
            </div>

            <span
              class="fb-status-pill is-disconnected"
              data-fb-dashboard-connection-status
            >
              Checking...
            </span>
          </div>

          <h3>Facebook Account</h3>

          <p
            class="fb-dashboard-value"
            data-fb-dashboard-account
          >
            Loading account...
          </p>

          <p
            class="fb-dashboard-description"
            data-fb-dashboard-token
          >
            Checking connection status.
          </p>

          <button
            class="fb-button fb-button-primary"
            type="button"
            data-fb-dashboard-scroll="settings"
          >
            Manage Connection
          </button>
        </article>

        <!-- Selected Pages -->
        <article class="fb-dashboard-card">

          <div class="fb-dashboard-card-top">
            <div class="fb-dashboard-icon fb-dashboard-icon-purple">
              <span aria-hidden="true">▣</span>
            </div>

            <span
              class="fb-dashboard-mini-status"
              data-fb-dashboard-page-count
            >
              0 Pages
            </span>
          </div>

          <h3>Selected Facebook Pages</h3>

          <p class="fb-dashboard-description">
            Pages selected for product publishing and
            future Facebook automation.
          </p>

          <div
            class="fb-dashboard-page-list"
            data-fb-dashboard-pages
          >
            <p class="fb-dashboard-muted">
              Loading selected Pages...
            </p>
          </div>

          <button
            class="fb-button"
            type="button"
            data-fb-dashboard-scroll="settings"
          >
            Manage Pages
          </button>
        </article>

      </section>

      <!-- Quick Actions -->
      <section class="fb-dashboard-section">

        <div class="fb-dashboard-section-heading">
          <div>
            <span class="fb-eyebrow">QUICK ACCESS</span>
            <h3>Quick Actions</h3>
          </div>
        </div>

        <div class="fb-dashboard-actions">

          <button
            class="fb-dashboard-action"
            type="button"
            data-fb-dashboard-scroll="posts"
          >
            <span class="fb-dashboard-action-icon">
              <span aria-hidden="true">＋</span>
            </span>

            <span>
              <strong>Create Product Post</strong>
              <small>
                Select a product, generate caption and publish.
              </small>
            </span>

            <span class="fb-dashboard-action-arrow"
              aria-hidden="true">→</span>
          </button>

          <button
            class="fb-dashboard-action"
            type="button"
            data-fb-dashboard-scroll="settings"
          >
            <span class="fb-dashboard-action-icon">
              <span aria-hidden="true">⚙</span>
            </span>

            <span>
              <strong>Facebook Settings</strong>
              <small>
                Connect account and select Facebook Pages.
              </small>
            </span>

            <span class="fb-dashboard-action-arrow"
              aria-hidden="true">→</span>
          </button>

        </div>
      </section>

      <!-- Feature Overview -->
      <section class="fb-dashboard-section">

        <div class="fb-dashboard-section-heading">
          <div>
            <span class="fb-eyebrow">MANAGEMENT TOOLS</span>
            <h3>Facebook Management</h3>
          </div>
        </div>

        <div class="fb-dashboard-feature-grid">

          <article class="fb-dashboard-feature is-available">
            <span class="fb-dashboard-feature-icon">▧</span>

            <div>
              <h4>Product Posts</h4>
              <p>
                Create product captions with Gemini and
                publish to selected Pages.
              </p>
            </div>

            <span class="fb-dashboard-feature-status">
              Available
            </span>
          </article>

          <article class="fb-dashboard-feature">
            <span class="fb-dashboard-feature-icon">☷</span>

            <div>
              <h4>Comment Management</h4>
              <p>
                View comments, reply manually and configure
                Gemini-assisted replies.
              </p>
            </div>

            <span class="fb-dashboard-feature-status is-pending">
              Coming soon
            </span>
          </article>

          <article class="fb-dashboard-feature">
            <span class="fb-dashboard-feature-icon">◷</span>

            <div>
              <h4>Post Scheduler</h4>
              <p>
                Schedule Facebook posts by date and time.
              </p>
            </div>

            <span class="fb-dashboard-feature-status is-pending">
              Coming soon
            </span>
          </article>

          <article class="fb-dashboard-feature">
            <span class="fb-dashboard-feature-icon">⇄</span>

            <div>
              <h4>Post Queue</h4>
              <p>
                Monitor pending, published and failed
                publishing jobs.
              </p>
            </div>

            <span class="fb-dashboard-feature-status is-pending">
              Coming soon
            </span>
          </article>

          <article class="fb-dashboard-feature">
            <span class="fb-dashboard-feature-icon">▥</span>

            <div>
              <h4>Facebook Analytics</h4>
              <p>
                Review available post performance and
                engagement metrics.
              </p>
            </div>

            <span class="fb-dashboard-feature-status is-pending">
              Coming soon
            </span>
          </article>

          <article class="fb-dashboard-feature">
            <span class="fb-dashboard-feature-icon">⚡</span>

            <div>
              <h4>Automation</h4>
              <p>
                Manage comment automation, spam filters
                and reply approval.
              </p>
            </div>

            <span class="fb-dashboard-feature-status is-pending">
              Coming soon
            </span>
          </article>

        </div>
      </section>

      <!-- Dashboard Feedback -->
      <p
        class="fb-dashboard-feedback"
        data-fb-dashboard-feedback
        aria-live="polite"
      ></p>

    </section>
  `;
}

// ========================================
// Load Connection Overview
// ========================================

async function loadDashboardConnection(root) {
  const status = root.querySelector(
    '[data-fb-dashboard-connection-status]'
  );

  const account = root.querySelector(
    '[data-fb-dashboard-account]'
  );

  const token = root.querySelector(
    '[data-fb-dashboard-token]'
  );

  setStatus(status, 'Checking...', '');

  const result = await facebookApi.getConnection();

  if (!result.connected) {
    setStatus(
      status,
      result.connection?.tokenExpired
        ? 'Token expired'
        : 'Not connected',
      result.connection?.tokenExpired
        ? 'is-warning'
        : 'is-disconnected'
    );

    if (account) {
      account.textContent = 'No active connection';
    }

    if (token) {
      token.textContent = result.connection?.tokenExpired
        ? 'Reconnect Facebook to continue.'
        : 'Connect your Facebook account to get started.';
    }

    return;
  }

  setStatus(status, 'Connected', 'is-connected');

  if (account) {
    account.textContent =
      result.connection?.facebookUserName ||
      'Facebook Account';
  }

  if (token) {
    token.textContent = result.connection?.tokenExpiresAt
      ? `Token expiry: ${formatDate(
          result.connection.tokenExpiresAt
        )}`
      : 'Connection is active.';
  }
}

// ========================================
// Load Selected Pages
// ========================================

async function loadDashboardPages(root) {
  const container = root.querySelector(
    '[data-fb-dashboard-pages]'
  );

  const countElement = root.querySelector(
    '[data-fb-dashboard-page-count]'
  );

  const result = await facebookApi.getSelectedPages();

  const pages = Array.isArray(result.pages)
    ? result.pages
    : [];

  if (countElement) {
    countElement.textContent =
      `${pages.length} ${pages.length === 1 ? 'Page' : 'Pages'}`;
  }

  if (!container) return;

  if (!pages.length) {
    container.innerHTML = `
      <div class="fb-dashboard-empty">
        <strong>No Page selected</strong>
        <span>Select a Facebook Page in Settings.</span>
      </div>
    `;

    return;
  }

  container.innerHTML = pages.map(page => {
    const name = escapeHtml(
      page.pageName || 'Facebook Page'
    );

    const pageId = escapeHtml(
      page.pageId || ''
    );

    return `
      <div class="fb-dashboard-page-item">
        <span class="fb-dashboard-page-avatar">
          f
        </span>

        <span class="fb-dashboard-page-info">
          <strong>${name}</strong>
          <small>Page ID: ${pageId}</small>
        </span>

        <span
          class="fb-dashboard-page-selected"
          title="Selected Page"
          aria-label="Selected Page"
        >
          ✓
        </span>
      </div>
    `;
  }).join('');
}

// ========================================
// Load Dashboard
// ========================================

async function loadDashboard(root) {
  const refreshButton = root.querySelector(
    '[data-fb-dashboard-refresh]'
  );

  const feedback = root.querySelector(
    '[data-fb-dashboard-feedback]'
  );

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Refreshing...';
  }

  if (feedback) {
    feedback.textContent = '';
    feedback.dataset.type = '';
  }

  const results = await Promise.allSettled([
    loadDashboardConnection(root),
    loadDashboardPages(root)
  ]);

  const errors = results.filter(
    result => result.status === 'rejected'
  );

  if (errors.length && feedback) {
    feedback.textContent = errors
      .map(result => result.reason?.message)
      .filter(Boolean)
      .join(' ');

    feedback.dataset.type = 'error';
  } else if (feedback) {
    feedback.textContent = 'Dashboard overview updated.';
    feedback.dataset.type = 'success';
  }

  if (refreshButton) {
    refreshButton.disabled = false;
    refreshButton.textContent = 'Refresh Overview';
  }
}

// ========================================
// Bind Dashboard Events
// ========================================

export function bindFacebookDashboardEvents(root = document) {
  const refreshButton = root.querySelector(
    '[data-fb-dashboard-refresh]'
  );

  if (refreshButton && !refreshButton.dataset.bound) {
    refreshButton.dataset.bound = 'true';

    refreshButton.addEventListener('click', () => {
      loadDashboard(root).catch(error => {
        console.error('[FACEBOOK DASHBOARD]', error);
      });
    });
  }

  const actionButtons = root.querySelectorAll(
    '[data-fb-dashboard-scroll]'
  );

  actionButtons.forEach(button => {
    if (button.dataset.bound) return;

    button.dataset.bound = 'true';

    button.addEventListener('click', () => {
      const targetName = button.dataset.fbDashboardScroll;

      const selector = targetName === 'posts'
        ? '.fb-posts-section'
        : '.fb-settings-layout';

      const target = root.querySelector(selector);

      if (!target) return;

      target.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    });
  });

  loadDashboard(root).catch(error => {
    const feedback = root.querySelector(
      '[data-fb-dashboard-feedback]'
    );

    if (feedback) {
      feedback.textContent = error.message;
      feedback.dataset.type = 'error';
    }

    console.error('[FACEBOOK DASHBOARD]', error);
  });
}
