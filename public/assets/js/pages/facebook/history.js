
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

function formatDate(value) {
  if (!value) return 'N/A';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'N/A';
  }

  return date.toLocaleString('en-BD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatStatus(status) {
  const labels = {
    published: 'Published',
    failed: 'Failed',
    publishing: 'Publishing'
  };

  return labels[status] || 'Unknown';
}

function getStatusClass(status) {
  const allowed = [
    'published',
    'failed',
    'publishing'
  ];

  return allowed.includes(status)
    ? `fb-history-status-${status}`
    : 'fb-history-status-unknown';
}

function getPostUrl(post) {
  if (post.postUrl) {
    return post.postUrl;
  }

  if (post.postId) {
    return `https://www.facebook.com/${encodeURIComponent(post.postId)}`;
  }

  return '';
}

// ========================================
// Feedback
// ========================================

function setFeedback(root, message, type = '') {
  const element = root.querySelector(
    '[data-fb-history-feedback]'
  );

  if (!element) return;

  element.textContent = message;
  element.dataset.type = type;
}

// ========================================
// Filter Values
// ========================================

function getHistoryFilters(root) {
  return {
    status: root.querySelector(
      '[data-fb-history-status]'
    )?.value || '',

    pageId: root.querySelector(
      '[data-fb-history-page]'
    )?.value || '',

    startDate: root.querySelector(
      '[data-fb-history-start]'
    )?.value || '',

    endDate: root.querySelector(
      '[data-fb-history-end]'
    )?.value || '',

    limit: 100
  };
}

// ========================================
// Page Filter
// ========================================

async function loadHistoryPages(root, state) {
  const select = root.querySelector(
    '[data-fb-history-page]'
  );

  if (!select) return;

  select.disabled = true;

  try {
    const result = await facebookApi.getSelectedPages();

    const pages = Array.isArray(result?.pages)
      ? result.pages
      : [];

    state.pages = pages.filter(page => (
      page &&
      String(page.pageId || '').trim() &&
      page.selected !== false
    ));

    select.innerHTML = `
      <option value="">All Selected Pages</option>

      ${state.pages.map(page => `
        <option value="${escapeHtml(page.pageId)}">
          ${escapeHtml(page.pageName || 'Facebook Page')}
        </option>
      `).join('')}
    `;

  } catch (error) {
    state.pages = [];

    select.innerHTML = `
      <option value="">All Pages</option>
    `;

    console.error(
      '[FACEBOOK HISTORY] Failed to load Pages:',
      error
    );

  } finally {
    select.disabled = false;
  }
}

// ========================================
// Render Images
// ========================================

function renderHistoryImages(images) {
  if (!Array.isArray(images) || !images.length) {
    return `
      <span class="fb-muted">
        No image information available.
      </span>
    `;
  }

  return `
    <div class="fb-history-images">
      ${images.map((url, index) => {
        const safeUrl = String(url || '');

        if (
          !safeUrl.startsWith(
            'https://res.cloudinary.com/'
          )
        ) {
          return '';
        }

        return `
          <a
            href="${escapeHtml(safeUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            class="fb-history-image-link"
            aria-label="Open post image ${index + 1}"
          >
            <img
              src="${escapeHtml(safeUrl)}"
              alt="Facebook post image ${index + 1}"
              loading="lazy"
            >
          </a>
        `;
      }).join('')}
    </div>
  `;
}

// ========================================
// Render Post Card
// ========================================

function renderHistoryCard(post) {
  const status = String(post.status || 'unknown');

  const postUrl = getPostUrl(post);

  const postLinkHtml = postUrl
    ? `
      <a
        href="${escapeHtml(postUrl)}"
        target="_blank"
        rel="noopener noreferrer"
        class="fb-button fb-button-primary fb-history-open-link"
      >
        Open Facebook Post
      </a>
    `
    : '';
  const canDelete = (
    status === 'published' ||
    status === 'failed'
  );

  const deleteButtonHtml = canDelete
    ? `
      <button
        type="button"
        class="fb-button fb-history-delete-button"
        data-fb-history-delete="${escapeHtml(post.id)}"
      >
        Delete Post
      </button>
    `
    : '';
  const errorHtml = status === 'failed'
    ? `
      <div class="fb-history-error">
        <strong>Publishing Error</strong>

        <p>${escapeHtml(
          post.error || 'Unknown publishing error.'
        )}</p>

        ${
          post.errorCode
            ? `<small>Code: ${escapeHtml(post.errorCode)}</small>`
            : ''
        }
      </div>
    `
    : '';

  const postIdHtml = post.postId
    ? `
      <div class="fb-history-meta-item">
        <span>Post ID</span>
        <code>${escapeHtml(post.postId)}</code>
      </div>
    `
    : '';

  return `
    <article
      class="fb-history-card"
      data-history-id="${escapeHtml(post.id)}"
    >

      <div class="fb-history-card-header">

        <div>
          <h3>
            ${escapeHtml(post.productName || 'Unknown Product')}
          </h3>

          <p class="fb-muted">
            SKU: ${escapeHtml(post.productSku || 'N/A')}
          </p>
        </div>

        <span class="fb-history-status ${getStatusClass(status)}">
          ${escapeHtml(formatStatus(status))}
        </span>

      </div>

      <div class="fb-history-meta">

        <div class="fb-history-meta-item">
          <span>Facebook Page</span>
          <strong>
            ${escapeHtml(post.pageName || 'Unknown Page')}
          </strong>
        </div>

        <div class="fb-history-meta-item">
          <span>Published Date</span>
          <strong>
            ${escapeHtml(formatDate(post.publishedAt || post.createdAt))}
          </strong>
        </div>

        <div class="fb-history-meta-item">
          <span>Image Count</span>
          <strong>
            ${Number(post.imageCount) || 0}
          </strong>
        </div>

        <div class="fb-history-meta-item">
          <span>Attempt Count</span>
          <strong>
            ${Number(post.attemptCount) || 1}
          </strong>
        </div>

        ${postIdHtml}

      </div>

      <details class="fb-history-details">

        <summary>
          View Caption and Images
        </summary>

        <div class="fb-history-details-content">

          <h4>Published Caption</h4>

          <div class="fb-history-caption">
            ${escapeHtml(post.caption || 'No caption available.')}
          </div>

          <h4>Published Images</h4>

          ${renderHistoryImages(post.images)}

        </div>

      </details>

      ${errorHtml}

            <div class="fb-history-card-actions">
        ${postLinkHtml}
        ${deleteButtonHtml}
      </div>

    </article>
  `;
}

// ========================================
// Render History List
// ========================================

function renderHistoryList(root, posts) {
  const container = root.querySelector(
    '[data-fb-history-list]'
  );

  if (!container) return;

  if (!Array.isArray(posts) || !posts.length) {
    container.innerHTML = `
      <div class="fb-empty-state fb-history-empty">
        <h3>No Facebook Post History Found</h3>

        <p>
          No records match the selected filters.
        </p>
      </div>
    `;

    return;
  }

  container.innerHTML = posts.map(
    renderHistoryCard
  ).join('');
}

// ========================================
// Update Summary
// ========================================

function updateHistorySummary(root, result) {
  const countElement = root.querySelector(
    '[data-fb-history-count]'
  );

  if (countElement) {
    countElement.textContent =
      `${Number(result?.count) || 0} post(s) found`;
  }

  const moreElement = root.querySelector(
    '[data-fb-history-more]'
  );

  if (moreElement) {
    moreElement.hidden = !result?.hasMore;
  }
}

// ========================================
// Load History
// ========================================

async function loadPostHistory(root, state) {
  if (state.loading) return;

  state.loading = true;

  const refreshButton = root.querySelector(
    '[data-fb-history-refresh]'
  );

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Loading History...';
  }

  setFeedback(
    root,
    'Loading Facebook publishing history...'
  );

  try {
    const filters = getHistoryFilters(root);

    const result = await facebookApi.getPostHistory(
      filters
    );

    state.posts = Array.isArray(result?.posts)
      ? result.posts
      : [];

    renderHistoryList(root, state.posts);

    updateHistorySummary(root, result);

    setFeedback(
      root,
      'Facebook post history loaded successfully.',
      'success'
    );

  } catch (error) {
    console.error(
      '[FACEBOOK HISTORY] Load failed:',
      error
    );

    setFeedback(
      root,
      error.message || 'Failed to load Facebook history.',
      'error'
    );

  } finally {
    state.loading = false;

    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh History';
    }
  }
}
// ========================================
// Delete History Post
// ========================================

async function deleteHistoryPost(root, state, historyId, button) {
  if (state.loading || state.deleting) return;

  const post = state.posts.find(
    item => String(item.id) === String(historyId)
  );

  if (!post) {
    setFeedback(
      root,
      'Post history record was not found. Refresh the history.',
      'error'
    );
    return;
  }

  const isPublished = post.status === 'published';

  const confirmationMessage = isPublished
    ? 'This will permanently delete the published post from Facebook and remove its Firestore history. Continue?'
    : 'This will permanently delete this failed post history from Firestore. Continue?';

  if (!window.confirm(confirmationMessage)) {
    return;
  }

  state.deleting = true;

  const originalText = button.textContent;

  button.disabled = true;
  button.textContent = 'Deleting...';

  setFeedback(
    root,
    isPublished
      ? 'Deleting Facebook post and history...'
      : 'Deleting failed post history...'
  );

  try {
    const result = await facebookApi.deletePostHistory(
      historyId
    );

    if (!result?.success) {
      throw new Error(
        result?.message || 'Post deletion was not confirmed.'
      );
    }

    setFeedback(
      root,
      result.message || 'Post deleted successfully.',
      'success'
    );

    await loadPostHistory(root, state);

  } catch (error) {
    console.error(
      '[FACEBOOK HISTORY] Delete failed:',
      error
    );

    setFeedback(
      root,
      error.message || 'Failed to delete Facebook post.',
      'error'
    );

    button.disabled = false;
    button.textContent = originalText;

  } finally {
    state.deleting = false;
  }
}
// ========================================
// Reset Filters
// ========================================

function resetHistoryFilters(root) {
  const fields = [
    '[data-fb-history-status]',
    '[data-fb-history-page]',
    '[data-fb-history-start]',
    '[data-fb-history-end]'
  ];

  fields.forEach(selector => {
    const element = root.querySelector(selector);

    if (element) {
      element.value = '';
    }
  });
}

// ========================================
// Render Facebook History Section
// ========================================

export function renderFacebookHistory() {
  return `
    <section class="fb-history-layout">

      <article class="fb-card">

        <header class="fb-card-heading">

          <div>
            <span class="fb-eyebrow">
              FACEBOOK MANAGEMENT
            </span>

            <h2>Published Posts Management</h2>

            <p class="fb-muted">
              View and manage your Facebook product publishing history.
            </p>
          </div>

          <span
            class="fb-history-count"
            data-fb-history-count
          >
            0 post(s) found
          </span>

        </header>

        <!-- Filters -->

        <div class="fb-history-filters">

          <div class="fb-history-filter-field">

            <label for="fb-history-status">
              Publishing Status
            </label>

            <select
              id="fb-history-status"
              data-fb-history-status
            >
              <option value="">All Statuses</option>
              <option value="published">Published</option>
              <option value="failed">Failed</option>
              <option value="publishing">Publishing</option>
            </select>

          </div>

          <div class="fb-history-filter-field">

            <label for="fb-history-page">
              Facebook Page
            </label>

            <select
              id="fb-history-page"
              data-fb-history-page
            >
              <option value="">Loading Pages...</option>
            </select>

          </div>

          <div class="fb-history-filter-field">

            <label for="fb-history-start">
              Start Date
            </label>

            <input
              type="date"
              id="fb-history-start"
              data-fb-history-start
            >

          </div>

          <div class="fb-history-filter-field">

            <label for="fb-history-end">
              End Date
            </label>

            <input
              type="date"
              id="fb-history-end"
              data-fb-history-end
            >

          </div>

        </div>

        <!-- Actions -->

        <div class="fb-form-actions fb-history-actions">

          <button
            type="button"
            class="fb-button fb-button-primary"
            data-fb-history-apply
          >
            Apply Filters
          </button>

          <button
            type="button"
            class="fb-button"
            data-fb-history-reset
          >
            Reset Filters
          </button>

          <button
            type="button"
            class="fb-button"
            data-fb-history-refresh
          >
            Refresh History
          </button>

        </div>

        <p
          class="fb-feedback"
          data-fb-history-feedback
          aria-live="polite"
        ></p>

      </article>

      <!-- History List -->

      <div
        class="fb-history-list"
        data-fb-history-list
      >

        <div class="fb-empty-state">
          Click Refresh History to load Facebook posts.
        </div>

      </div>

      <p
        class="fb-history-more"
        data-fb-history-more
        hidden
      >
        The history service found additional records, but this view
        currently displays a maximum of 100 posts.
      </p>

    </section>
  `;
}

// ========================================
// Bind History Events
// ========================================


export function bindFacebookHistoryEvents(root = document) {
  const state = {
    posts: [],
    pages: [],
    loading: false,
    deleting: false
  };

  // Refresh button.

  const refreshButton = root.querySelector(
    '[data-fb-history-refresh]'
  );

  if (refreshButton && !refreshButton.dataset.bound) {
    refreshButton.dataset.bound = 'true';

    refreshButton.addEventListener('click', () => {
      loadPostHistory(root, state);
    });
  }

  // Apply filters.

  const applyButton = root.querySelector(
    '[data-fb-history-apply]'
  );

  if (applyButton && !applyButton.dataset.bound) {
    applyButton.dataset.bound = 'true';

    applyButton.addEventListener('click', () => {
      loadPostHistory(root, state);
    });
  }

  // Reset filters.

  const resetButton = root.querySelector(
    '[data-fb-history-reset]'
  );

  if (resetButton && !resetButton.dataset.bound) {
    resetButton.dataset.bound = 'true';

    resetButton.addEventListener('click', () => {
      resetHistoryFilters(root);
      loadPostHistory(root, state);
    });
  }

  // Delete post history using event delegation.

  const historyList = root.querySelector(
    '[data-fb-history-list]'
  );

  if (
    historyList &&
    !historyList.dataset.deleteBound
  ) {
    historyList.dataset.deleteBound = 'true';

    historyList.addEventListener('click', event => {
      const target = event.target;

      if (!(target instanceof Element)) {
        return;
      }

      const button = target.closest(
        '[data-fb-history-delete]'
      );

      if (!button || !historyList.contains(button)) {
        return;
      }

      const historyId = button.dataset.fbHistoryDelete;

      if (!historyId) {
        return;
      }

      deleteHistoryPost(
        root,
        state,
        historyId,
        button
      );
    });
  }

  // Load Facebook Pages for filtering.

  loadHistoryPages(root, state);

  // Initial history load.

  loadPostHistory(root, state);
}
