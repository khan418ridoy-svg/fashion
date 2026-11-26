
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

  let date;

  if (typeof value?.toDate === 'function') {
    date = value.toDate();
  } else {
    date = new Date(value);
  }

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

function getReplySource(reply) {
  const source = String(
    reply?.replySource || ''
  ).toLowerCase();

  if (source === 'ai') return 'AI';
  if (source === 'admin') return 'Admin';

  if (
    source === 'page' ||
    reply?.authorType === 'page'
  ) {
    return 'Page';
  }

  return 'Unknown';
}

function getReplySourceClass(reply) {
  const source = getReplySource(reply).toLowerCase();

  return [
    'ai',
    'admin',
    'page'
  ].includes(source)
    ? `fb-comment-source-${source}`
    : 'fb-comment-source-unknown';
}

// ========================================
// Feedback
// ========================================

function setFeedback(root, message, type = '') {
  const element = root.querySelector(
    '[data-fb-comments-feedback]'
  );

  if (!element) return;

  element.textContent = message;
  element.dataset.type = type;
}

// ========================================
// Filters
// ========================================


function getCommentFilters(root) {
  return {
    pageId: root.querySelector(
      '[data-fb-comments-page]'
    )?.value || '',

    status: root.querySelector(
      '[data-fb-comments-status]'
    )?.value || 'active',

    limit: 500
  };
}

// ========================================
// Load Selected Pages
// ========================================

async function loadCommentPages(root, state) {
  const select = root.querySelector(
    '[data-fb-comments-page]'
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
      <option value="">Unable to load Pages</option>
    `;

    console.error(
      '[FACEBOOK COMMENTS] Page loading failed:',
      error
    );

    setFeedback(
      root,
      error.message || 'Failed to load Facebook Pages.',
      'error'
    );

  } finally {
    select.disabled = false;
  }
}

// ========================================
// Group Replies
// ========================================

function groupComments(comments) {
  const parents = comments.filter(
    comment => comment.isReply !== true
  );

  const replies = comments.filter(
    comment => comment.isReply === true
  );

  const replyMap = new Map();

  replies.forEach(reply => {
    const parentId = String(reply.parentId || '');

    if (!parentId) return;

    if (!replyMap.has(parentId)) {
      replyMap.set(parentId, []);
    }

    replyMap.get(parentId).push(reply);
  });

  return parents.map(parent => {
    const ownReplies = replyMap.get(
      String(parent.commentId || '')
    ) || [];

    ownReplies.sort((a, b) => {
      return new Date(a.commentCreatedAt || 0).getTime() -
        new Date(b.commentCreatedAt || 0).getTime();
    });

    return {
      ...parent,
      replies: ownReplies
    };
  });
}

// ========================================
// Render Reply
// ========================================

function renderReply(reply) {
  const source = getReplySource(reply);

  return `
    <article class="fb-comment-reply">

      <div class="fb-comment-reply-header">

        <strong>
          ${escapeHtml(reply.authorName || source)}
        </strong>

        <span class="fb-comment-source ${getReplySourceClass(reply)}">
          ${escapeHtml(source)}
        </span>

        <time>
          ${escapeHtml(formatDate(
            reply.commentCreatedAt || reply.createdAt
          ))}
        </time>

      </div>

      <p class="fb-comment-message">
        ${escapeHtml(reply.message || 'No reply text available.')}
      </p>

    </article>
  `;
}

// ========================================
// Render Reply History
// ========================================

function renderReplyHistory(comment) {
  const replies = Array.isArray(comment.replies)
    ? comment.replies
    : [];

  const latestReplyId = String(
    comment.latestReplyId || ''
  );

  const hasLatestReply = Boolean(
    comment.latestReplyMessage
  );

  // The latest reply may already be present
  // in the individual reply records.
  const hasLatestInList = replies.some(
    reply => String(reply.commentId) === latestReplyId
  );

  let html = '';

  if (replies.length) {
    html += `
      <div class="fb-comment-replies">

        <h4>
          Reply History (${replies.length})
        </h4>

        ${replies.map(renderReply).join('')}

      </div>
    `;
  }

  if (hasLatestReply && !hasLatestInList) {
    const latest = {
      authorName: comment.latestReplySource === 'ai'
        ? 'AI Assistant'
        : comment.latestReplySource === 'admin'
          ? 'Admin Dashboard'
          : 'Facebook Page',

      replySource: comment.latestReplySource,
      authorType: comment.latestReplySource === 'page'
        ? 'page'
        : '',

      message: comment.latestReplyMessage,
      commentCreatedAt: comment.latestReplyAt
    };

    html += `
      <div class="fb-comment-replies">

        <h4>Latest Reply</h4>

        ${renderReply(latest)}

      </div>
    `;
  }

  if (!html) {
    return `
      <p class="fb-comment-no-reply">
        No recorded replies yet.
      </p>
    `;
  }

  return html;
}

// ========================================
// Render Comment Card
// ========================================

function renderCommentCard(comment) {
  const commentId = String(
    comment.commentId || ''
  );

  const isDeleted = comment.status === 'deleted';

  const postUrl = comment.postUrl ||
    (comment.postId
      ? `https://www.facebook.com/${encodeURIComponent(comment.postId)}`
      : '');

  return `
    <article
      class="fb-comment-card"
      data-fb-comment-card="${escapeHtml(commentId)}"
    >

      <header class="fb-comment-card-header">

        <div class="fb-comment-author">

          <strong>
            ${escapeHtml(comment.authorName || 'Facebook User')}
          </strong>

          <span class="fb-muted">
            ${escapeHtml(formatDate(
              comment.commentCreatedAt
            ))}
          </span>

        </div>

        <span class="fb-comment-status ${isDeleted
          ? 'is-deleted'
          : 'is-active'}">
          ${isDeleted ? 'Deleted' : 'Active'}
        </span>

      </header>

      <div class="fb-comment-meta">

        <div>
          <span>Facebook Page</span>
          <strong>
            ${escapeHtml(comment.pageName || 'Unknown Page')}
          </strong>
        </div>

        <div>
          <span>Product</span>
          <strong>
            ${escapeHtml(comment.productName || 'Unlinked Post')}
          </strong>
        </div>

        <div>
          <span>Product SKU</span>
          <strong>
            ${escapeHtml(comment.productSku || 'N/A')}
          </strong>
        </div>

        <div>
          <span>Post ID</span>
          <code>${escapeHtml(comment.postId || 'N/A')}</code>
        </div>

      </div>

      <section class="fb-comment-original">

        <h4>Customer Comment</h4>

        <p class="fb-comment-message">
          ${escapeHtml(comment.message || 'No comment text available.')}
        </p>

      </section>

      ${renderReplyHistory(comment)}

      ${postUrl ? `
        <div class="fb-comment-post-link">
          <a
            href="${escapeHtml(postUrl)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Related Facebook Post
          </a>
        </div>
      ` : ''}

      ${!isDeleted ? `
        <form
          class="fb-comment-reply-form"
          data-fb-comment-reply-form="${escapeHtml(commentId)}"
        >

          <label>
            Reply from Admin Dashboard
          </label>

          <textarea
            rows="3"
            maxlength="10000"
            required
            placeholder="Write your Facebook reply..."
            data-fb-comment-reply-message
          ></textarea>

          <div class="fb-comment-reply-actions">

            <button
              type="submit"
              class="fb-button fb-button-primary"
              data-fb-comment-reply-submit
            >
              Send Reply
            </button>

          </div>

        </form>
      ` : ''}

    </article>
  `;
}

// ========================================
// Render Comment List
// ========================================

function renderCommentList(root, comments) {
  const container = root.querySelector(
    '[data-fb-comments-list]'
  );

  if (!container) return;

  const grouped = groupComments(comments);

  if (!grouped.length) {
    container.innerHTML = `
      <div class="fb-empty-state">
        <h3>No Facebook Comments Found</h3>

        <p>
          No comments match the selected filters.
        </p>
      </div>
    `;

    return;
  }

  container.innerHTML = grouped.map(
    renderCommentCard
  ).join('');
}

// ========================================
// Update Summary
// ========================================

function updateCommentSummary(root, result, comments) {
  const count = root.querySelector(
    '[data-fb-comments-count]'
  );

  if (count) {
    const parentCount = comments.filter(
      item => item.isReply !== true
    ).length;

    count.textContent = `${parentCount} customer comment(s)`;
  }

  const more = root.querySelector(
    '[data-fb-comments-more]'
  );

  if (more) {
    more.hidden = !result?.hasMore;
  }
}

// ========================================
// Load Comments
// ========================================

async function loadComments(root, state) {
  if (state.loading) return;

  state.loading = true;

  const refreshButton = root.querySelector(
    '[data-fb-comments-refresh]'
  );

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Loading Comments...';
  }

  setFeedback(
    root,
    'Loading Facebook comments and replies...'
  );

  try {
    const result = await facebookApi.getComments(
      getCommentFilters(root)
    );

    state.comments = Array.isArray(result?.comments)
      ? result.comments
      : [];

    renderCommentList(root, state.comments);

    updateCommentSummary(
      root,
      result,
      state.comments
    );

    setFeedback(
      root,
      'Facebook comments loaded successfully.',
      'success'
    );

  } catch (error) {
    console.error(
      '[FACEBOOK COMMENTS] Load failed:',
      error
    );

    setFeedback(
      root,
      error.message || 'Failed to load Facebook comments.',
      'error'
    );

  } finally {
    state.loading = false;

    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh Comments';
    }
  }
}

// ========================================
// Send Admin Reply
// ========================================

async function sendAdminReply(
  root,
  state,
  commentId,
  form
) {
  if (state.loading || state.replying) return;

  const comment = state.comments.find(item => (
    String(item.commentId) === String(commentId) &&
    item.isReply !== true
  ));

  if (!comment) {
    setFeedback(
      root,
      'Customer comment was not found. Refresh the list.',
      'error'
    );
    return;
  }

  if (comment.status === 'deleted') {
    setFeedback(
      root,
      'Cannot reply to a deleted comment.',
      'error'
    );
    return;
  }

  const textarea = form.querySelector(
    '[data-fb-comment-reply-message]'
  );

  const button = form.querySelector(
    '[data-fb-comment-reply-submit]'
  );

  const message = textarea?.value.trim() || '';

  if (!message) {
    setFeedback(
      root,
      'Please write a reply message.',
      'error'
    );
    textarea?.focus();
    return;
  }

  if (!comment.pageId || !comment.postId) {
    setFeedback(
      root,
      'Page ID or Post ID is missing for this comment.',
      'error'
    );
    return;
  }

  state.replying = true;

  if (button) {
    button.disabled = true;
    button.textContent = 'Sending Reply...';
  }

  if (textarea) {
    textarea.disabled = true;
  }

  setFeedback(
    root,
    'Publishing reply to Facebook...'
  );

  try {
    const result = await facebookApi.replyToComment(
      comment.commentId,
      {
        pageId: comment.pageId,
        postId: comment.postId,
        message
      }
    );

    if (!result?.success) {
      throw new Error(
        result?.message || 'Facebook did not confirm the reply.'
      );
    }

    setFeedback(
      root,
      'Your reply was published successfully.',
      'success'
    );

    await loadComments(root, state);

  } catch (error) {
    console.error(
      '[FACEBOOK COMMENTS] Reply failed:',
      error
    );

    setFeedback(
      root,
      error.message || 'Failed to publish Facebook reply.',
      'error'
    );

    if (textarea) {
      textarea.disabled = false;
    }

    if (button) {
      button.disabled = false;
      button.textContent = 'Send Reply';
    }

  } finally {
    state.replying = false;
  }
}

// ========================================
// Render Facebook Comments Section
// ========================================

export function renderFacebookComments() {
  return `
    <section class="fb-comments-layout">

      <article class="fb-card">

        <header class="fb-card-heading">

          <div>
            <span class="fb-eyebrow">
              FACEBOOK ENGAGEMENT
            </span>

            <h2>Customer Comments & Replies</h2>

            <p class="fb-muted">
              View customer comments, related products,
              reply history and reply sources.
            </p>
          </div>

          <span
            class="fb-comment-count"
            data-fb-comments-count
          >
            0 customer comment(s)
          </span>

        </header>

        <div class="fb-comment-filters">

          <div class="fb-comment-filter-field">

            <label for="fb-comments-page">
              Facebook Page
            </label>

            <select
              id="fb-comments-page"
              data-fb-comments-page
            >
              <option value="">
                Loading Pages...
              </option>
            </select>

          </div>

          <div class="fb-comment-filter-field">

            <label for="fb-comments-status">
              Comment Status
            </label>

            <select
              id="fb-comments-status"
              data-fb-comments-status
            >
              <option value="active">
                Active Comments
              </option>

              <option value="deleted">
                Deleted Comments
              </option>

              <option value="">
                All Comments
              </option>
            </select>

          </div>

        </div>

        <div class="fb-form-actions">

          <button
            type="button"
            class="fb-button fb-button-primary"
            data-fb-comments-apply
          >
            Apply Filters
          </button>

          <button
            type="button"
            class="fb-button"
            data-fb-comments-refresh
          >
            Refresh Comments
          </button>

        </div>

        <p
          class="fb-feedback"
          data-fb-comments-feedback
          aria-live="polite"
        ></p>

      </article>

      <div
        class="fb-comments-list"
        data-fb-comments-list
      >

        <div class="fb-empty-state">
          Loading Facebook comments...
        </div>

      </div>

      <p
        class="fb-comments-more"
        data-fb-comments-more
        hidden
      >
        Additional comments are available.
        This view currently displays a maximum of 500 records.
      </p>

    </section>
  `;
}

// ========================================
// Bind Facebook Comment Events
// ========================================

export function bindFacebookCommentsEvents(root = document) {
  const state = {
    comments: [],
    pages: [],
    loading: false,
    replying: false
  };

  // Refresh comments.

  const refreshButton = root.querySelector(
    '[data-fb-comments-refresh]'
  );

  if (
    refreshButton &&
    !refreshButton.dataset.bound
  ) {
    refreshButton.dataset.bound = 'true';

    refreshButton.addEventListener('click', () => {
      loadComments(root, state);
    });
  }

  // Apply filters.

  const applyButton = root.querySelector(
    '[data-fb-comments-apply]'
  );

  if (
    applyButton &&
    !applyButton.dataset.bound
  ) {
    applyButton.dataset.bound = 'true';

    applyButton.addEventListener('click', () => {
      loadComments(root, state);
    });
  }

  // Submit reply forms using event delegation.

  const list = root.querySelector(
    '[data-fb-comments-list]'
  );

  if (list && !list.dataset.replyBound) {
    list.dataset.replyBound = 'true';

    list.addEventListener('submit', event => {
      const form = event.target;

      if (
        !(form instanceof HTMLFormElement) ||
        !form.matches('[data-fb-comment-reply-form]')
      ) {
        return;
      }

      event.preventDefault();

      const commentId = form.dataset.fbCommentReplyForm;

      if (!commentId) return;

      sendAdminReply(
        root,
        state,
        commentId,
        form
      );
    });
  }

  // Load selected Pages and initial comments.

  loadCommentPages(root, state).then(() => {
    loadComments(root, state);
  });
}
