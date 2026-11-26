
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

function formatNumber(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return '—';
  }

  return number.toLocaleString('en-BD', {
    maximumFractionDigits: 2
  });
}

function getLocalDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

function getDefaultDateRange() {
  const until = new Date();
  until.setDate(until.getDate() - 1);

  const since = new Date(until);
  since.setDate(since.getDate() - 27);

  return {
    since: getLocalDateString(since),
    until: getLocalDateString(until)
  };
}

function setFeedback(root, message, type = '') {
  const element = root.querySelector(
    '[data-fb-insights-feedback]'
  );

  if (!element) return;

  element.textContent = message;
  element.dataset.type = type;
}

function setLoading(root, loading) {
  root.querySelectorAll(
    '[data-fb-insights-load]'
  ).forEach(button => {
    button.disabled = loading;
    button.textContent = loading
      ? 'Loading...'
      : button.dataset.defaultText;
  });
}

// ========================================
// Render Page Insights
// ========================================

function renderPageMetrics() {
  const cards = [
    {
      key: 'impressions',
      label: 'Impressions'
    },
    {
      key: 'engagements',
      label: 'Engagements'
    },
    {
      key: 'mediaViews',
      label: 'Media Views'
    },
    {
      key: 'follows',
      label: 'Follows'
    }
  ];

  return cards.map(card => `
    <article class="fb-card">
      <span class="fb-eyebrow">
        ${card.label}
      </span>

      <h3
        data-fb-insights-summary="${card.key}"
      >
        —
      </h3>
    </article>
  `).join('');
}

// ========================================
// Render Insights
// ========================================

export function renderFacebookInsights() {
  const dates = getDefaultDateRange();

  return `
    <section class="fb-insights-layout">

      <header class="fb-section-header">
        <div>
          <span class="fb-eyebrow">
            FACEBOOK ANALYTICS
          </span>

          <h2>Facebook Insights</h2>

          <p>
            Review Page performance and individual
            Facebook post metrics.
          </p>
        </div>
      </header>

      <!-- Page Insights -->

      <article class="fb-card">

        <div class="fb-card-heading">
          <div>
            <h3>Page Insights</h3>
            <p class="fb-muted">
              Select a Page and date range.
            </p>
          </div>
        </div>

        <div class="fb-insights-filters">

          <label>
            <span>Facebook Page</span>

            <select
              data-fb-insights-page
              required
            >
              <option value="">
                Loading selected Pages...
              </option>
            </select>
          </label>

          <label>
            <span>Start Date</span>

            <input
              type="date"
              data-fb-insights-since
              value="${dates.since}"
              required
            >
          </label>

          <label>
            <span>End Date</span>

            <input
              type="date"
              data-fb-insights-until
              value="${dates.until}"
              required
            >
          </label>

        </div>

        <div class="fb-form-actions">
          <button
            type="button"
            class="fb-button fb-button-primary"
            data-fb-insights-load
            data-default-text="Load Page Insights"
          >
            Load Page Insights
          </button>
        </div>

      </article>

      <!-- Page Summary -->

      <div
        class="fb-insights-summary-grid"
        data-fb-insights-summary-grid
      >
        ${renderPageMetrics()}
      </div>

      <p
        class="fb-muted"
        data-fb-insights-reach-note
      ></p>

      <!-- Post Insights -->

      <article class="fb-card">

        <h3>Post Insights</h3>

        <p class="fb-muted">
          Enter a Facebook Post ID to retrieve its
          available lifetime metrics.
        </p>

        <div class="fb-insights-filters">

          <label>
            <span>Facebook Post ID</span>

            <input
              type="text"
              data-fb-insights-post-id
              placeholder="PageID_PostID"
              maxlength="100"
            >
          </label>

        </div>

        <div class="fb-form-actions">
          <button
            type="button"
            class="fb-button fb-button-primary"
            data-fb-insights-load
            data-default-text="Load Post Insights"
          >
            Load Post Insights
          </button>
        </div>

        <div
          class="fb-insights-post-results"
          data-fb-insights-post-results
        >
          <p class="fb-muted">
            Post metrics will appear here.
          </p>
        </div>

      </article>

      <p
        class="fb-feedback"
        data-fb-insights-feedback
        aria-live="polite"
      ></p>

    </section>
  `;
}

// ========================================
// Load Selected Pages
// ========================================

async function loadSelectedPages(root) {
  const select = root.querySelector(
    '[data-fb-insights-page]'
  );

  if (!select) return;

  const result = await facebookApi.getSelectedPages();

  const pages = Array.isArray(result.pages)
    ? result.pages
    : [];

  if (!pages.length) {
    select.innerHTML = `
      <option value="">
        No selected Facebook Pages
      </option>
    `;

    return;
  }

  select.innerHTML = `
    <option value="">
      Select a Facebook Page
    </option>
    ${pages.map(page => `
      <option value="${escapeHtml(page.pageId)}">
        ${escapeHtml(page.pageName || page.pageId)}
      </option>
    `).join('')}
  `;
}

// ========================================
// Page Insights
// ========================================

async function loadPageInsights(root) {
  const pageSelect = root.querySelector(
    '[data-fb-insights-page]'
  );

  const sinceInput = root.querySelector(
    '[data-fb-insights-since]'
  );

  const untilInput = root.querySelector(
    '[data-fb-insights-until]'
  );

  const pageId = pageSelect?.value;
  const since = sinceInput?.value;
  const until = untilInput?.value;

  if (!pageId) {
    throw new Error('Please select a Facebook Page.');
  }

  if (!since || !until) {
    throw new Error('Please select both dates.');
  }

  if (since > until) {
    throw new Error(
      'Start date must be before end date.'
    );
  }

  if (until > getLocalDateString()) {
    throw new Error(
      'End date cannot be in the future.'
    );
  }

  const result = await facebookApi.getPageInsights({
    pageId,
    since,
    until
  });

  const summary = result.summary || {};

  root.querySelectorAll(
    '[data-fb-insights-summary]'
  ).forEach(element => {
    const key = element.dataset.fbInsightsSummary;

    element.textContent = formatNumber(
      summary[key]
    );
  });

  const reachNote = root.querySelector(
    '[data-fb-insights-reach-note]'
  );

  if (reachNote) {
    reachNote.textContent = summary.reachNote || '';
  }

  setFeedback(
    root,
    'Page Insights loaded successfully.',
    'success'
  );
}

// ========================================
// Post Insights
// ========================================

async function loadPostInsights(root) {
  const pageSelect = root.querySelector(
    '[data-fb-insights-page]'
  );

  const postInput = root.querySelector(
    '[data-fb-insights-post-id]'
  );

  const pageId = pageSelect?.value;
  const postId = postInput?.value.trim();

  if (!pageId) {
    throw new Error('Please select a Facebook Page.');
  }

  if (!postId) {
    throw new Error('Please enter a Facebook Post ID.');
  }

  const result = await facebookApi.getPostInsights({
    pageId,
    postId
  });

  const container = root.querySelector(
    '[data-fb-insights-post-results]'
  );

  const metrics = Array.isArray(result.metrics)
    ? result.metrics
    : [];

  if (!container) return;

  if (!metrics.length) {
    container.innerHTML = `
      <p class="fb-muted">
        Facebook did not return metrics for this Post.
      </p>
    `;

    return;
  }

  container.innerHTML = `
    <div class="fb-insights-post-grid">
      ${metrics.map(metric => `
        <article class="fb-insights-post-metric">
          <strong>
            ${escapeHtml(
              metric.title || metric.name || 'Metric'
            )}
          </strong>

          <span>
            ${metric.values?.length
              ? escapeHtml(
                  formatNumber(
                    metric.values[0].value
                  )
                )
              : '—'}
          </span>

          <small>
            ${escapeHtml(metric.description || '')}
          </small>
        </article>
      `).join('')}
    </div>
  `;

  setFeedback(
    root,
    'Post Insights loaded successfully.',
    'success'
  );
}

// ========================================
// Bind Events
// ========================================

export function bindFacebookInsightsEvents(root = document) {
  const buttons = root.querySelectorAll(
    '[data-fb-insights-load]'
  );

  buttons.forEach(button => {
    if (button.dataset.bound) return;

    button.dataset.bound = 'true';

    button.addEventListener('click', async () => {
      const isPostButton =
        button.dataset.defaultText ===
        'Load Post Insights';

      setLoading(root, true);
      setFeedback(root, '');

      try {
        if (isPostButton) {
          await loadPostInsights(root);
        } else {
          await loadPageInsights(root);
        }
      } catch (error) {
        setFeedback(
          root,
          error.message || 'Failed to load Insights.',
          'error'
        );
      } finally {
        setLoading(root, false);
      }
    });
  });

  loadSelectedPages(root).catch(error => {
    setFeedback(
      root,
      error.message || 'Failed to load selected Pages.',
      'error'
    );
  });
}
