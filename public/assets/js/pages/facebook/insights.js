
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

  if (!Number.isFinite(number)) return '—';

  return number.toLocaleString('en-BD');
}

function formatDate(value) {
  if (!value) return 'Date unavailable';

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Date unavailable';
  }

  return date.toLocaleString('en-BD', {
    dateStyle: 'medium',
    timeStyle: 'short'
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

function setButtonLoading(button, loading, text) {
  if (!button) return;

  button.disabled = loading;
  button.textContent = loading ? 'Loading...' : text;
}

function getSelectedPageId(root) {
  return root.querySelector(
    '[data-fb-insights-page]'
  )?.value || '';
}

// ========================================
// Page Insights
// ========================================

function renderPageMetrics() {
  const cards = [
    { key: 'engagements', label: 'Engagements' },
    { key: 'mediaViews', label: 'Media Views' },
    { key: 'follows', label: 'Follows' }
  ];

  return cards.map(card => `
    <article class="fb-card">
      <span class="fb-eyebrow">${card.label}</span>
      <h3 data-fb-insights-summary="${card.key}">—</h3>
    </article>
  `).join('');
}

// ========================================
// Render Posts
// ========================================

function renderPostCard(post, selectedPostId) {
  const isSelected = post.id === selectedPostId;

  return `
    <article class="fb-post-feed-card ${isSelected ? 'is-selected' : ''}">
      ${post.fullPicture ? `
        <a
          class="fb-post-feed-image"
          href="${escapeHtml(post.fullPicture)}"
          target="_blank"
          rel="noopener noreferrer"
        >
          <img
            src="${escapeHtml(post.fullPicture)}"
            alt="Facebook post image"
            loading="lazy"
          >
        </a>
      ` : ''}

      <div class="fb-post-feed-content">
        <div class="fb-post-feed-date">
          ${escapeHtml(formatDate(post.createdTime))}
        </div>

        <p class="fb-post-feed-message">
          ${escapeHtml(post.message || 'No text in this post.')}
        </p>

        <div class="fb-post-feed-stats">
          <span>Reactions: ${formatNumber(post.reactions)}</span>
          <span>Comments: ${formatNumber(post.comments)}</span>
          <span>Shares: ${formatNumber(post.shares)}</span>
        </div>

        <div class="fb-post-feed-actions">
          <button
            type="button"
            class="fb-button fb-button-primary"
            data-fb-post-open="${escapeHtml(post.id)}"
          >
            ${isSelected ? 'Refresh Comments' : 'View Comments'}
          </button>

          ${post.permalinkUrl ? `
            <a
              class="fb-button"
              href="${escapeHtml(post.permalinkUrl)}"
              target="_blank"
              rel="noopener noreferrer"
            >
              View on Facebook
            </a>
          ` : ''}
        </div>
      </div>
    </article>
  `;
}

// ========================================
// Comment Source
// ========================================

function getCommentSource(comment) {
  const source = comment.replySource;

  if (source === 'ai') {
    return '<span class="fb-comment-source fb-comment-source-ai">AI</span>';
  }

  if (source === 'admin') {
    return '<span class="fb-comment-source fb-comment-source-admin">Admin Dashboard</span>';
  }

  if (source === 'page') {
    return '<span class="fb-comment-source fb-comment-source-page">Page</span>';
  }

  return '';
}

// ========================================
// Render Comments
// ========================================

function renderComment(comment, postId) {
  const canReply =
    comment.isReply !== true &&
    comment.authorType !== 'page' &&
    comment.status === 'active';

  return `
    <article class="fb-post-feed-comment ${comment.isReply ? 'is-reply' : ''}">
      <div class="fb-post-feed-comment-header">
        <strong>${escapeHtml(comment.authorName || 'Facebook user')}</strong>
        ${getCommentSource(comment)}
        <time>${escapeHtml(formatDate(comment.commentCreatedAt))}</time>
      </div>

      <p>${escapeHtml(comment.message || '')}</p>

      ${canReply ? `
        <form
          class="fb-post-feed-reply-form"
          data-fb-post-reply-form
          data-comment-id="${escapeHtml(comment.commentId)}"
          data-post-id="${escapeHtml(postId)}"
        >
          <textarea
            name="message"
            rows="2"
            maxlength="10000"
            placeholder="Reply to this customer comment..."
            required
          ></textarea>

          <button
            type="submit"
            class="fb-button fb-button-primary"
          >
            Reply
          </button>
        </form>
      ` : ''}
    </article>
  `;
}

function renderPostComments(comments, postId) {
  const list = Array.isArray(comments) ? comments : [];

  if (!list.length) {
    return '<p class="fb-muted">No comments found for this post.</p>';
  }

  const topLevel = list.filter(item => item.isReply !== true);
  const replies = list.filter(item => item.isReply === true);

  return topLevel.map(parent => {
    const childReplies = replies.filter(
      reply => reply.parentId === parent.commentId
    );

    return `
      <div class="fb-post-feed-comment-thread">
        ${renderComment(parent, postId)}

        ${childReplies.length ? `
          <div class="fb-post-feed-replies">
            ${childReplies.map(reply =>
              renderComment(reply, postId)
            ).join('')}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');
}

// ========================================
// Main Render
// ========================================

export function renderFacebookInsights() {
  const dates = getDefaultDateRange();

  return `
    <section class="fb-insights-layout">

      <header class="fb-section-header">
        <div>
          <span class="fb-eyebrow">FACEBOOK ANALYTICS</span>
          <h2>Facebook Insights</h2>
          <p>Review Page performance and published Page posts.</p>
        </div>
      </header>

      <article class="fb-card">
        <div class="fb-card-heading">
          <div>
            <h3>Page Insights</h3>
            <p class="fb-muted">Select a Page and date range.</p>
          </div>
        </div>

        <div class="fb-insights-filters">
          <label>
            <span>Facebook Page</span>
            <select data-fb-insights-page required>
              <option value="">Loading selected Pages...</option>
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
          >
            Load Page Insights
          </button>
        </div>
      </article>

      <div class="fb-insights-summary-grid">
        ${renderPageMetrics()}
      </div>

      <p class="fb-muted" data-fb-insights-reach-note></p>

      <!-- Page Posts Feed -->

      <article class="fb-card fb-post-feed-section">
        <div class="fb-card-heading">
          <div>
            <h3>Page Posts</h3>
            <p class="fb-muted">
              Published posts from the selected Facebook Page.
            </p>
          </div>

          <button
            type="button"
            class="fb-button fb-button-primary"
            data-fb-posts-load
          >
            Load Posts
          </button>
        </div>

        <div
          class="fb-post-feed-list"
          data-fb-post-feed
        >
          <p class="fb-muted">
            Select a Page and click Load Posts.
          </p>
        </div>

        <div class="fb-post-feed-pagination">
          <button
            type="button"
            class="fb-button"
            data-fb-posts-more
            hidden
          >
            Load More Posts
          </button>
        </div>
      </article>

      <!-- Selected Post Comments -->

      <article
        class="fb-card fb-post-feed-comments-panel"
        data-fb-post-comments-panel
        hidden
      >
        <div class="fb-card-heading">
          <div>
            <h3>Comments & Replies</h3>
            <p class="fb-muted" data-fb-selected-post-label></p>
          </div>
        </div>

        <form data-fb-post-comment-form>
          <label for="fb-post-new-comment">
            Comment as Facebook Page
          </label>

          <textarea
            id="fb-post-new-comment"
            name="message"
            rows="3"
            maxlength="10000"
            placeholder="Write a new comment..."
            required
          ></textarea>

          <div class="fb-form-actions">
            <button
              type="submit"
              class="fb-button fb-button-primary"
            >
              Publish Comment
            </button>
          </div>
        </form>

        <div
          class="fb-post-feed-comments"
          data-fb-post-comments
        >
          <p class="fb-muted">Select a post to load comments.</p>
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
    select.innerHTML = '<option value="">No selected Facebook Pages</option>';
    return;
  }

  select.innerHTML = `
    <option value="">Select a Facebook Page</option>
    ${pages.map(page => `
      <option value="${escapeHtml(page.pageId)}">
        ${escapeHtml(page.pageName || page.pageId)}
      </option>
    `).join('')}
  `;
}

// ========================================
// Load Page Insights
// ========================================

async function loadPageInsights(root) {
  const pageId = getSelectedPageId(root);
  const since = root.querySelector('[data-fb-insights-since]')?.value;
  const until = root.querySelector('[data-fb-insights-until]')?.value;

  if (!pageId) throw new Error('Please select a Facebook Page.');
  if (!since || !until) throw new Error('Please select both dates.');
  if (since > until) throw new Error('Start date must be before end date.');
  if (until > getLocalDateString()) {
    throw new Error('End date cannot be in the future.');
  }

  const result = await facebookApi.getPageInsights({
    pageId,
    since,
    until
  });

  const summary = result.summary || {};

  root.querySelectorAll('[data-fb-insights-summary]').forEach(element => {
    element.textContent = formatNumber(
      summary[element.dataset.fbInsightsSummary]
    );
  });

  const note = root.querySelector('[data-fb-insights-reach-note]');

  if (note) note.textContent = summary.reachNote || '';

  setFeedback(root, 'Page Insights loaded successfully.', 'success');
}

// ========================================
// Feed State
// ========================================

const feedState = new WeakMap();

function getFeedState(root) {
  if (!feedState.has(root)) {
    feedState.set(root, {
      posts: [],
      after: '',
      selectedPostId: '',
      loading: false
    });
  }

  return feedState.get(root);
}

// ========================================
// Load Page Posts
// ========================================

async function loadPagePosts(root, loadMore = false) {
  const pageId = getSelectedPageId(root);

  if (!pageId) {
    throw new Error('Please select a Facebook Page.');
  }

  const state = getFeedState(root);
  const button = root.querySelector('[data-fb-posts-load]');
  const moreButton = root.querySelector('[data-fb-posts-more]');
  const container = root.querySelector('[data-fb-post-feed]');

  if (state.loading) return;

  state.loading = true;

  setButtonLoading(
    loadMore ? moreButton : button,
    true,
    loadMore ? 'Load More Posts' : 'Load Posts'
  );

  try {
    const result = await facebookApi.getPagePosts({
      pageId,
      limit: 20,
      after: loadMore ? state.after : ''
    });

    const posts = Array.isArray(result.posts)
      ? result.posts
      : [];

    state.posts = loadMore
      ? [...state.posts, ...posts]
      : posts;

    state.after = result.paging?.after || '';

    container.innerHTML = state.posts.length
      ? state.posts.map(post =>
          renderPostCard(post, state.selectedPostId)
        ).join('')
      : '<p class="fb-muted">No published posts found.</p>';

    moreButton.hidden = !result.paging?.next || !state.after;

    setFeedback(
      root,
      `${posts.length} post(s) loaded.`,
      'success'
    );
  } finally {
    state.loading = false;

    setButtonLoading(button, false, 'Load Posts');
    setButtonLoading(moreButton, false, 'Load More Posts');
  }
}

// ========================================
// Load Selected Post Comments
// ========================================

async function loadPostComments(root, postId) {
  const pageId = getSelectedPageId(root);

  if (!pageId) throw new Error('Please select a Facebook Page.');

  const state = getFeedState(root);
  const panel = root.querySelector('[data-fb-post-comments-panel]');
  const container = root.querySelector('[data-fb-post-comments]');
  const label = root.querySelector('[data-fb-selected-post-label]');

  const post = state.posts.find(item => item.id === postId);

  state.selectedPostId = postId;

  panel.hidden = false;
  label.textContent = post
    ? `Post published ${formatDate(post.createdTime)}`
    : postId;

  container.innerHTML = '<p class="fb-muted">Loading comments...</p>';

  const result = await facebookApi.getPostComments(pageId, postId);

  container.innerHTML = renderPostComments(
    result.comments,
    postId
  );

  root.querySelector('[data-fb-post-feed]').innerHTML =
    state.posts.map(item =>
      renderPostCard(item, state.selectedPostId)
    ).join('');

  setFeedback(root, 'Comments loaded successfully.', 'success');
}

// ========================================
// Publish Top-level Comment
// ========================================

async function submitPostComment(root, form) {
  const pageId = getSelectedPageId(root);
  const state = getFeedState(root);
  const postId = state.selectedPostId;
  const message = form.elements.message.value.trim();

  if (!pageId || !postId) {
    throw new Error('Please select a post first.');
  }

  if (!message) throw new Error('Comment cannot be empty.');

  const button = form.querySelector('button[type="submit"]');
  setButtonLoading(button, true, 'Publish Comment');

  try {
    await facebookApi.commentOnPost(pageId, postId, message);
    form.reset();
    await loadPostComments(root, postId);
    setFeedback(root, 'Comment published successfully.', 'success');
  } finally {
    setButtonLoading(button, false, 'Publish Comment');
  }
}

// ========================================
// Reply to Customer Comment
// ========================================

async function submitCommentReply(root, form) {
  const pageId = getSelectedPageId(root);
  const commentId = form.dataset.commentId;
  const postId = form.dataset.postId;
  const message = form.elements.message.value.trim();

  if (!pageId || !commentId || !postId || !message) {
    throw new Error('Reply details are incomplete.');
  }

  const button = form.querySelector('button[type="submit"]');
  setButtonLoading(button, true, 'Reply');

  try {
    await facebookApi.replyToComment(commentId, {
      pageId,
      postId,
      message
    });

    await loadPostComments(root, postId);
    setFeedback(root, 'Reply published successfully.', 'success');
  } finally {
    setButtonLoading(button, false, 'Reply');
  }
}

// ========================================
// Bind Events
// ========================================

export function bindFacebookInsightsEvents(root = document) {
  if (root.dataset.fbInsightsBound === 'true') return;
  root.dataset.fbInsightsBound = 'true';

  loadSelectedPages(root).catch(error => {
    setFeedback(
      root,
      error.message || 'Failed to load selected Pages.',
      'error'
    );
  });

  root.addEventListener('click', async event => {
    const target = event.target;

    const insightsButton = target.closest('[data-fb-insights-load]');
    const loadPostsButton = target.closest('[data-fb-posts-load]');
    const morePostsButton = target.closest('[data-fb-posts-more]');
    const postButton = target.closest('[data-fb-post-open]');

    try {
      setFeedback(root, '');

      if (insightsButton) {
        setButtonLoading(insightsButton, true, 'Load Page Insights');

        try {
          await loadPageInsights(root);
        } finally {
          setButtonLoading(insightsButton, false, 'Load Page Insights');
        }
      }

      if (loadPostsButton) {
        await loadPagePosts(root, false);
      }

      if (morePostsButton) {
        await loadPagePosts(root, true);
      }

      if (postButton) {
        await loadPostComments(
          root,
          postButton.dataset.fbPostOpen
        );
      }
    } catch (error) {
      setFeedback(
        root,
        error.message || 'Facebook request failed.',
        'error'
      );
    }
  });

  root.addEventListener('submit', async event => {
    const commentForm = event.target.closest(
      '[data-fb-post-comment-form]'
    );

    const replyForm = event.target.closest(
      '[data-fb-post-reply-form]'
    );

    if (!commentForm && !replyForm) return;

    event.preventDefault();

    try {
      setFeedback(root, '');

      if (commentForm) {
        await submitPostComment(root, commentForm);
      }

      if (replyForm) {
        await submitCommentReply(root, replyForm);
      }
    } catch (error) {
      setFeedback(
        root,
        error.message || 'Could not publish the comment.',
        'error'
      );
    }
  });

  root.querySelector('[data-fb-insights-page]')
    ?.addEventListener('change', () => {
      const state = getFeedState(root);

      state.posts = [];
      state.after = '';
      state.selectedPostId = '';

      root.querySelector('[data-fb-post-feed]').innerHTML =
        '<p class="fb-muted">Click Load Posts to view this Page.</p>';

      root.querySelector('[data-fb-post-comments-panel]').hidden = true;
      root.querySelector('[data-fb-posts-more]').hidden = true;
    });
}
