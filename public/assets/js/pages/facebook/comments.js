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

function getCommentFilters(root, state = {}) {
  return {
    pageId: state.selectedPageId ||
      root.querySelector('[data-fb-comments-page]')?.value || '',

    postId: state.selectedPostId || '',

    status: root.querySelector(
      '[data-fb-comments-status]'
    )?.value || '',

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
// Page Posts Feed
// ========================================

function extractProductSku(post) {
  const direct = String(
    post?.productSku ||
    post?.sku ||
    ''
  ).trim();

  if (direct && direct.toUpperCase() !== 'N/A') {
    return direct;
  }

  const caption = String(
    post?.message ||
    post?.caption ||
    post?.description ||
    ''
  );

  const match = caption.match(
    /(?:Product\s*SKU|Product\s*Code|SKU)\s*:\s*([A-Z0-9][A-Z0-9._-]*)/i
  );

  return match?.[1] || 'N/A';
}

function renderPagePost(post, page) {
  const postId = String(post.id || '');
  const sku = extractProductSku(post);

  return `
    <article
      class="fb-comment-card fb-post-feed-card"
      data-fb-post-card="${escapeHtml(postId)}"
    >
      <header class="fb-comment-card-header">
        <strong>${escapeHtml(page.pageName || 'Facebook Page')}</strong>
        <span class="fb-muted">${escapeHtml(formatDate(post.createdTime))}</span>
      </header>

      ${post.fullPicture ? `
        <img
          src="${escapeHtml(post.fullPicture)}"
          alt="Facebook post"
          loading="lazy"
          style="width:100%;max-height:260px;object-fit:contain;border-radius:10px;"
        >
      ` : ''}

      <p class="fb-comment-message">
        ${escapeHtml(post.message || 'No text in this post.')}
      </p>

      <div class="fb-comment-meta">
        <div>
          <span>Product SKU</span>
          <strong>${escapeHtml(sku)}</strong>
        </div>
        <div>
          <span>Comments</span>
          <strong>${Number(post.comments) || 0}</strong>
        </div>
        <div>
          <span>Reactions</span>
          <strong>${Number(post.reactions) || 0}</strong>
        </div>
        <div>
          <span>Shares</span>
          <strong>${Number(post.shares) || 0}</strong>
        </div>
      </div>

      <div class="fb-form-actions">
        <button
          type="button"
          class="fb-button fb-button-primary"
          data-fb-comment-post-open="${escapeHtml(postId)}"
          data-fb-comment-post-page="${escapeHtml(page.pageId)}"
          aria-expanded="false"
        >
          View Comments & Reply
        </button>

        ${post.permalinkUrl ? `
          <a
            class="fb-button"
            href="${escapeHtml(post.permalinkUrl)}"
            target="_blank"
            rel="noopener noreferrer"
          >
            Open Facebook Post
          </a>
        ` : ''}
      </div>

      <section
        class="fb-post-comments-inline"
        data-fb-post-comments="${escapeHtml(postId)}"
        hidden
      >
        <div class="fb-post-comments-heading">
          <h4>Comments & Replies</h4>
          <span class="fb-muted">Facebook thread</span>
        </div>
        <div class="fb-post-comments-content">
          <p class="fb-muted">Open comments to load this post's discussion.</p>
        </div>
      </section>
    </article>
  `;
}

async function loadPagePosts(root, state) {
  if (state.postsLoading) return;

  const selectedPageId = root.querySelector(
    '[data-fb-comments-page]'
  )?.value || '';

  const pages = selectedPageId
    ? state.pages.filter(page => page.pageId === selectedPageId)
    : state.pages;

  if (!pages.length) {
    setFeedback(root, 'No selected Facebook Pages found.', 'error');
    return;
  }

  const button = root.querySelector('[data-fb-posts-refresh]');

  state.postsLoading = true;

  if (button) {
    button.disabled = true;
    button.textContent = 'Loading Posts...';
  }

  const container = root.querySelector('[data-fb-page-posts]');

  container.innerHTML = '<p class="fb-muted">Loading Facebook posts...</p>';

  try {
    const allPosts = [];

    for (const page of pages) {
      const result = await facebookApi.getPagePosts({
        pageId: page.pageId,
        limit: 20
      });

      const posts = Array.isArray(result?.posts)
        ? result.posts
        : [];

      allPosts.push(
        ...posts.map(post => ({
          ...post,
          pageId: page.pageId,
          pageName: page.pageName || 'Facebook Page'
        }))
      );
    }

    state.posts = allPosts;

    if (!allPosts.length) {
      container.innerHTML = `
        <div class="fb-empty-state">
          <h3>No Facebook Posts Found</h3>
          <p>This Page has no available posts.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = allPosts.map(post => {
      const page = {
        pageId: post.pageId,
        pageName: post.pageName
      };

      return renderPagePost(post, page);
    }).join('');

    setFeedback(
      root,
      `${allPosts.length} recent post(s) loaded. Select a post to view its comments.`,
      'success'
    );

  } finally {
    state.postsLoading = false;

    if (button) {
      button.disabled = false;
      button.textContent = 'Refresh Page Posts';
    }
  }
}

// ========================================
// Sync Recent Facebook Post Comments
// ========================================

async function syncRecentPageComments(root, state) {
  if (state.syncing) return;

  const selectedPageId = root.querySelector(
    '[data-fb-comments-page]'
  )?.value || '';

  const pages = selectedPageId
    ? state.pages.filter(page => page.pageId === selectedPageId)
    : state.pages;

  if (!pages.length) {
    setFeedback(
      root,
      'No selected Facebook Pages found.',
      'error'
    );
    return;
  }

  // Refresh button syncs all recent posts for the selected page scope.
  state.selectedPageId = selectedPageId;
  state.selectedPostId = '';

  state.syncing = true;

  const button = root.querySelector(
    '[data-fb-comments-refresh]'
  );

  if (button) {
    button.disabled = true;
    button.textContent = 'Syncing Facebook...';
  }

  let syncedPosts = 0;
  let failedPosts = 0;

  try {
    for (const page of pages) {
      setFeedback(
        root,
        `Loading recent posts from ${page.pageName || 'Facebook Page'}...`
      );

      const feed = await facebookApi.getPagePosts({
        pageId: page.pageId,
        limit: 20
      });

      const posts = Array.isArray(feed?.posts)
        ? feed.posts
        : [];

      for (const post of posts) {
        if (!post.id) continue;

        try {
          await facebookApi.getPostComments(
            page.pageId,
            post.id
          );

          syncedPosts += 1;

        } catch (error) {
          failedPosts += 1;

          console.error(
            '[FACEBOOK COMMENT SYNC] Post failed:',
            post.id,
            error
          );
        }
      }
    }

    await loadComments(root, state);

    if (failedPosts > 0) {
      setFeedback(
        root,
        `Synced ${syncedPosts} post(s). ${failedPosts} post(s) could not be synced. Check console for details.`,
        'error'
      );
    } else {
      setFeedback(
        root,
        `Successfully synced comments and replies from ${syncedPosts} recent post(s).`,
        'success'
      );
    }

  } catch (error) {
    console.error(
      '[FACEBOOK COMMENT SYNC]',
      error
    );

    setFeedback(
      root,
      error.message || 'Failed to sync Facebook comments.',
      'error'
    );

  } finally {
    state.syncing = false;

    if (button) {
      button.disabled = false;
      button.textContent = 'Refresh Comments';
    }
  }
}

// ========================================
// Open Selected Post Comments
// ========================================

async function openPostComments(root, state, pageId, postId) {
  const post = state.posts.find(item => (
    String(item.id) === String(postId) &&
    String(item.pageId) === String(pageId)
  ));

  if (!post) {
    throw new Error('Selected Facebook post was not found.');
  }

  state.selectedPageId = pageId;
  state.selectedPostId = postId;

  const pageSelect = root.querySelector(
    '[data-fb-comments-page]'
  );

  if (pageSelect) pageSelect.value = pageId;

  const postCard = root.querySelector(
    `[data-fb-post-card="${CSS.escape(String(postId))}"]`
  );

  const inlineSection = postCard?.querySelector(
    `[data-fb-post-comments="${CSS.escape(String(postId))}"]`
  );

  const inlineContent = inlineSection?.querySelector(
    '.fb-post-comments-content'
  );

  if (inlineSection) inlineSection.hidden = false;

  if (inlineContent) {
    inlineContent.innerHTML =
      '<p class="fb-muted">Loading Facebook comments and replies...</p>';
  }

  setFeedback(
    root,
    'Loading this post comments and replies from Facebook...'
  );

  await facebookApi.getPostComments(pageId, postId);
  await loadComments(root, state);

  if (inlineContent && !state.comments.some(comment =>
    String(comment.postId) === String(postId) &&
    comment.isReply !== true
  )) {
    inlineContent.innerHTML = `
      <div class="fb-empty-state">
        <p>No comments found for this post.</p>
      </div>
    `;
  }

  setFeedback(
    root,
    'Post comments and replies synced successfully.',
    'success'
  );
}

// ========================================
// Group Replies
// ========================================

function groupComments(comments) {
  const records = Array.isArray(comments) ? comments : [];
  const byId = new Map();
  const children = new Map();

  records.forEach(comment => {
    const id = String(comment.commentId || comment.id || '');
    if (id) byId.set(id, { ...comment, replies: [] });
  });

  records.forEach(comment => {
    const id = String(comment.commentId || comment.id || '');
    const parentId = String(comment.parentId || '');

    if (!id || !parentId || !byId.has(parentId)) return;

    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(id);
  });

  const sortByDate = (a, b) => {
    const aTime = new Date(a.commentCreatedAt || a.createdAt || 0).getTime();
    const bTime = new Date(b.commentCreatedAt || b.createdAt || 0).getTime();
    return aTime - bTime;
  };

  function attachReplies(comment, visited = new Set()) {
    const id = String(comment.commentId || comment.id || '');
    if (visited.has(id)) return comment;
    visited.add(id);

    const childIds = children.get(id) || [];

    comment.replies = childIds
      .map(childId => byId.get(childId))
      .filter(Boolean)
      .sort(sortByDate)
      .map(child => attachReplies(child, new Set(visited)));

    return comment;
  }

  const roots = records
    .filter(comment => {
      const parentId = String(comment.parentId || '');
      return comment.isReply !== true || !parentId || !byId.has(parentId);
    })
    .map(comment => byId.get(String(comment.commentId || comment.id || '')))
    .filter(Boolean)
    .sort(sortByDate);

  return roots.map(root => attachReplies(root));
}

// ========================================
// Render Reply
// ========================================

function renderReply(reply) {
  const source = getReplySource(reply);
  const nestedReplies = Array.isArray(reply.replies) ? reply.replies : [];

  return `
    <article
      class="fb-comment-reply ${nestedReplies.length ? 'has-nested-replies' : ''}"
      style="margin:8px 0 0 20px;padding-left:12px;border-left:2px solid var(--fb-border-color, #dfe3e8);"
    >
      <div class="fb-comment-reply-header">
        <strong>${escapeHtml(reply.authorName || source)}</strong>
        <span class="fb-comment-source ${getReplySourceClass(reply)}">
          ${escapeHtml(source)}
        </span>
        <time>${escapeHtml(formatDate(
          reply.commentCreatedAt || reply.createdAt
        ))}</time>
      </div>

      <p class="fb-comment-message">
        ${escapeHtml(reply.message || 'No reply text available.')}
      </p>

      ${nestedReplies.length ? `
        <div class="fb-comment-replies fb-comment-replies-nested">
          ${nestedReplies.map(renderReply).join('')}
        </div>
      ` : ''}
    </article>
  `;
}

// ========================================
// Render Reply History
// ========================================

function renderReplyHistory(comment) {
  const replies = Array.isArray(comment.replies) ? comment.replies : [];
  const latestReplyId = String(comment.latestReplyId || '');
  const hasLatestReply = Boolean(comment.latestReplyMessage);

  const hasLatestInList = replies.some(
    reply => String(reply.commentId || reply.id) === latestReplyId
  );

  let html = '';

  if (replies.length) {
    html += `
      <div class="fb-comment-replies">
        <h4>Replies (${replies.length})</h4>
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
      authorType: comment.latestReplySource === 'page' ? 'page' : '',
      message: comment.latestReplyMessage,
      commentCreatedAt: comment.latestReplyAt,
      replies: []
    };

    html += `
      <div class="fb-comment-replies">
        <h4>Latest Reply</h4>
        ${renderReply(latest)}
      </div>
    `;
  }

  return html || `
    <p class="fb-comment-no-reply">No replies yet.</p>
  `;
}

// ========================================
// Render Comment Card
// ========================================

function renderCommentCard(comment) {
  const commentId = String(comment.commentId || comment.id || '');
  const isDeleted = comment.status === 'deleted';

  return `
    <article
      class="fb-comment-card fb-thread-comment"
      data-fb-comment-card="${escapeHtml(commentId)}"
    >
      <header class="fb-comment-card-header">
        <div class="fb-comment-author">
          <strong>${escapeHtml(comment.authorName || 'Facebook User')}</strong>
          <span class="fb-muted">
            ${escapeHtml(formatDate(comment.commentCreatedAt || comment.createdAt))}
          </span>
        </div>
        <span class="fb-comment-status ${isDeleted ? 'is-deleted' : 'is-active'}">
          ${isDeleted ? 'Deleted' : 'Active'}
        </span>
      </header>

      <p class="fb-comment-message">
        ${escapeHtml(comment.message || 'No comment text available.')}
      </p>

      ${renderReplyHistory(comment)}

      ${!isDeleted ? `
        <form
          class="fb-comment-reply-form"
          data-fb-comment-reply-form="${escapeHtml(commentId)}"
        >
          <label>Reply to ${escapeHtml(comment.authorName || 'customer')}</label>
          <textarea
            rows="2"
            maxlength="10000"
            required
            placeholder="Write your reply..."
            data-fb-comment-reply-message
          ></textarea>
          <div class="fb-comment-reply-actions">
            <button
              type="submit"
              class="fb-button fb-button-primary"
              data-fb-comment-reply-submit
            >
              Reply
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
  const globalContainer = root.querySelector(
    '[data-fb-comments-list]'
  );

  const postsContainer = root.querySelector(
    '[data-fb-page-posts]'
  );

  const postTargets = postsContainer
    ? [...postsContainer.querySelectorAll('[data-fb-post-comments]')]
    : [];

  postTargets.forEach(target => {
    const content = target.querySelector('.fb-post-comments-content');

    if (content) {
      content.innerHTML = '<p class="fb-muted">No comments loaded.</p>';
    }
  });

  const grouped = groupComments(comments);
  const commentsByPost = new Map();

  grouped.forEach(comment => {
    const postId = String(comment.postId || '');

    if (!postId) return;

    if (!commentsByPost.has(postId)) {
      commentsByPost.set(postId, []);
    }

    commentsByPost.get(postId).push(comment);
  });

  let renderedInline = false;

  postTargets.forEach(target => {
    const postId = String(target.dataset.fbPostComments || '');
    const content = target.querySelector('.fb-post-comments-content');
    const postComments = commentsByPost.get(postId) || [];

    if (!content) return;

    if (postComments.length) {
      content.innerHTML = postComments.map(renderCommentCard).join('');
      renderedInline = true;

    } else if (
      String(target.closest('[data-fb-post-card]')?.dataset.fbPostCard) ===
      String(root.__fbSelectedPostId || '')
    ) {
      content.innerHTML = `
        <div class="fb-empty-state">
          <p>No customer comments found for this post.</p>
        </div>
      `;
    }
  });

  if (globalContainer) {
    if (renderedInline) {
      globalContainer.hidden = true;
      globalContainer.innerHTML = '';

    } else {
      globalContainer.hidden = false;

      if (!grouped.length) {
        globalContainer.innerHTML = `
          <div class="fb-empty-state">
            <h3>No Facebook Comments Found</h3>
            <p>No comments match the selected filters.</p>
          </div>
        `;

      } else {
        globalContainer.innerHTML = grouped.map(renderCommentCard).join('');
      }
    }
  }
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
      getCommentFilters(root, state)
    );

    state.comments = Array.isArray(result?.comments)
      ? result.comments.map(comment => ({
          ...comment,
          pageId: comment.pageId || state.selectedPageId || '',
          postId: comment.postId || state.selectedPostId || ''
        }))
      : [];

    root.__fbSelectedPostId = state.selectedPostId || '';

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

      <!-- Facebook Page Posts -->

      <article class="fb-card fb-post-feed-section">

        <header class="fb-card-heading">
          <div>
            <h3>Facebook Page Posts</h3>
            <p class="fb-muted">
              Select a post to load its customer comments and replies.
            </p>
          </div>
        </header>

        <div class="fb-form-actions">
          <button
            type="button"
            class="fb-button fb-button-primary"
            data-fb-posts-refresh
          >
            Load Recent Posts
          </button>
        </div>

        <div
          class="fb-post-feed-list"
          data-fb-page-posts
        >
          <p class="fb-muted">
            Click Load Recent Posts to see your Facebook Page posts.
          </p>
        </div>

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
    posts: [],
    selectedPageId: '',
    selectedPostId: '',
    loading: false,
    replying: false,
    postsLoading: false,
    syncing: false
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
      syncRecentPageComments(root, state);
    });
  }

  // Load Facebook Page Posts.

  const postsRefreshButton = root.querySelector(
    '[data-fb-posts-refresh]'
  );

  if (
    postsRefreshButton &&
    !postsRefreshButton.dataset.bound
  ) {
    postsRefreshButton.dataset.bound = 'true';

    postsRefreshButton.addEventListener('click', () => {
      loadPagePosts(root, state).catch(error => {
        console.error('[FACEBOOK POSTS]', error);

        setFeedback(
          root,
          error.message || 'Failed to load Facebook posts.',
          'error'
        );
      });
    });
  }

  // Select a post and open its comments inline (no page jump).

  const postsContainer = root.querySelector(
    '[data-fb-page-posts]'
  );

  if (
    postsContainer &&
    !postsContainer.dataset.postCommentsBound
  ) {
    postsContainer.dataset.postCommentsBound = 'true';

    postsContainer.addEventListener('click', async event => {
      const button = event.target.closest(
        '[data-fb-comment-post-open]'
      );

      if (!button) return;

      const pageId = button.dataset.fbCommentPostPage;
      const postId = button.dataset.fbCommentPostOpen;
      const postCard = button.closest('[data-fb-post-card]');

      const inlineSection = postCard?.querySelector(
        `[data-fb-post-comments="${CSS.escape(String(postId))}"]`
      );

      if (inlineSection && !inlineSection.hidden) {
        inlineSection.hidden = true;
        button.setAttribute('aria-expanded', 'false');
        button.textContent = 'View Comments & Reply';
        return;
      }

      button.disabled = true;
      button.textContent = 'Loading Comments...';

      try {
        await openPostComments(
          root,
          state,
          pageId,
          postId
        );

        if (inlineSection) inlineSection.hidden = false;

        button.setAttribute('aria-expanded', 'true');
        button.textContent = 'Hide Comments';

      } catch (error) {
        console.error('[FACEBOOK POST COMMENTS]', error);

        setFeedback(
          root,
          error.message || 'Failed to load post comments.',
          'error'
        );

      } finally {
        button.disabled = false;
      }
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

  // Reply forms live inside each post card, so delegate from posts container.

  const replyFormHost = root.querySelector(
    '[data-fb-page-posts]'
  ) || root;

  if (
    replyFormHost &&
    !replyFormHost.dataset.replyBound
  ) {
    replyFormHost.dataset.replyBound = 'true';

    replyFormHost.addEventListener('submit', event => {
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

  const pageFilter = root.querySelector(
    '[data-fb-comments-page]'
  );

  if (
    pageFilter &&
    !pageFilter.dataset.postFilterBound
  ) {
    pageFilter.dataset.postFilterBound = 'true';

    pageFilter.addEventListener('change', () => {
      state.selectedPageId = '';
      state.selectedPostId = '';

      loadComments(root, state);
    });
  }

  // Load selected Pages and initial comments.

  loadCommentPages(root, state).then(() => {
    loadComments(root, state);
  });
}
