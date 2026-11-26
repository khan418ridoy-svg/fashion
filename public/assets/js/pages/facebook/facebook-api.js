
'use strict';

import { getIdToken } from '../../firebase-client.js';

const BASE = '/api/facebook';

/**
 * Facebook API request handler.
 */
async function request(path, options = {}) {
  const {
    authenticated = true,
    headers = {},
    ...fetchOptions
  } = options;

  const requestHeaders = {
    Accept: 'application/json',
    ...headers
  };

  if (fetchOptions.body && !requestHeaders['Content-Type']) {
    requestHeaders['Content-Type'] = 'application/json';
  }

  if (authenticated) {
    const token = await getIdToken();

    if (!token) {
      throw new Error(
        'Authentication required. Please login again.'
      );
    }

    requestHeaders.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    ...fetchOptions,
    headers: requestHeaders
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    const message =
      data.error?.message ||
      data.message ||
      `Facebook request failed (${response.status})`;

    const error = new Error(message);
    error.status = response.status;
    error.code = data.error?.code || 'FACEBOOK_API_ERROR';

    throw error;
  }

  return data;
}

/**
 * Validate history date.
 */
function validateHistoryDate(value, fieldName) {
  if (!value) return;

  if (
    typeof value !== 'string' ||
    Number.isNaN(new Date(value).getTime())
  ) {
    throw new Error(`Invalid ${fieldName} date.`);
  }
}

/**
 * Facebook API methods.
 */
export const facebookApi = {

  async startOAuth() {
    return request('/oauth/start');
  },

  async getConnection() {
    return request('/connection');
  },

  async getAvailablePages() {
    return request('/pages/available');
  },

  async getSelectedPages() {
    return request('/pages/selected');
  },

  async selectPages(selectedPageIds) {
    if (!Array.isArray(selectedPageIds)) {
      throw new Error('selectedPageIds must be an array.');
    }

    return request('/pages/select', {
      method: 'POST',
      body: JSON.stringify({
        selectedPageIds
      })
    });
  },

  async disconnect() {
    return request('/connection', {
      method: 'DELETE'
    });
  },

  async getSettings() {
    return request('/settings');
  },

  async updateSettings(settings) {
    return request('/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings)
    });
  },

  /**
   * Get products eligible for Facebook posts.
   */
  async getEligibleProducts(options = {}) {
    const limit = options.limit;

    if (
      limit !== undefined &&
      (!Number.isInteger(Number(limit)) ||
        Number(limit) < 1 ||
        Number(limit) > 100)
    ) {
      throw new Error('Product limit must be between 1 and 100.');
    }

    const query = new URLSearchParams();

    if (limit !== undefined) {
      query.set('limit', String(Number(limit)));
    }

    const suffix = query.toString()
      ? `?${query.toString()}`
      : '';

    return request(`/posts/products${suffix}`);
  },

  /**
   * Get Facebook publishing history.
   *
   * Supported filters:
   * status, pageId, startDate, endDate, limit
   */
  async getPostHistory(filters = {}) {
    const {
      status,
      pageId,
      startDate,
      endDate,
      limit
    } = filters;

    const allowedStatuses = [
      'publishing',
      'published',
      'failed'
    ];

    if (
      status &&
      !allowedStatuses.includes(status)
    ) {
      throw new Error('Invalid history status.');
    }

    if (
      pageId !== undefined &&
      typeof pageId !== 'string'
    ) {
      throw new Error('Invalid Facebook Page ID.');
    }

    validateHistoryDate(startDate, 'Start');
    validateHistoryDate(endDate, 'End');

    if (
      startDate &&
      endDate &&
      new Date(startDate) > new Date(endDate)
    ) {
      throw new Error(
        'Start date must be before end date.'
      );
    }

    if (
      limit !== undefined &&
      (!Number.isInteger(Number(limit)) ||
        Number(limit) < 1 ||
        Number(limit) > 100)
    ) {
      throw new Error(
        'History limit must be between 1 and 100.'
      );
    }

    const query = new URLSearchParams();

    if (status) {
      query.set('status', status);
    }

    if (pageId?.trim()) {
      query.set('pageId', pageId.trim());
    }

    if (startDate) {
      query.set('startDate', startDate);
    }

    if (endDate) {
      query.set('endDate', endDate);
    }

    if (limit !== undefined) {
      query.set('limit', String(Number(limit)));
    }

    const suffix = query.toString()
      ? `?${query.toString()}`
      : '';

    return request(`/posts/history${suffix}`);
  },

  /**
   * Get Facebook customer comments and replies.
   *
   * Supported filters:
   * pageId, postId, status, includeReplies, limit
   */
  async getComments(filters = {}) {
    const {
      pageId,
      postId,
      status,
      includeReplies,
      limit
    } = filters;

    if (
      pageId !== undefined &&
      typeof pageId !== 'string'
    ) {
      throw new Error('Invalid Facebook Page ID.');
    }

    if (
      postId !== undefined &&
      typeof postId !== 'string'
    ) {
      throw new Error('Invalid Facebook Post ID.');
    }

    if (
      status !== undefined &&
      typeof status !== 'string'
    ) {
      throw new Error('Invalid comment status.');
    }

    if (
      includeReplies !== undefined &&
      typeof includeReplies !== 'boolean'
    ) {
      throw new Error('includeReplies must be a boolean.');
    }

    if (
      limit !== undefined &&
      (!Number.isInteger(Number(limit)) ||
        Number(limit) < 1 ||
        Number(limit) > 500)
    ) {
      throw new Error(
        'Comment limit must be between 1 and 500.'
      );
    }

    const query = new URLSearchParams();

    if (pageId?.trim()) {
      query.set('pageId', pageId.trim());
    }

    if (postId?.trim()) {
      query.set('postId', postId.trim());
    }

    if (status?.trim()) {
      query.set('status', status.trim());
    }

    if (includeReplies !== undefined) {
      query.set('includeReplies', String(includeReplies));
    }

    if (limit !== undefined) {
      query.set('limit', String(Number(limit)));
    }

    const suffix = query.toString()
      ? `?${query.toString()}`
      : '';

    return request(`/comments${suffix}`);
  },

  /**
   * Publish an Admin Dashboard reply to a Facebook comment.
   *
   * The backend records the reply source as "admin".
   */
  async replyToComment(commentId, data = {}) {
    if (
      typeof commentId !== 'string' ||
      !commentId.trim()
    ) {
      throw new Error('A valid Facebook comment ID is required.');
    }

    const {
      pageId,
      postId,
      message
    } = data;

    if (
      typeof pageId !== 'string' ||
      !pageId.trim()
    ) {
      throw new Error('A valid Facebook Page ID is required.');
    }

    if (
      typeof postId !== 'string' ||
      !postId.trim()
    ) {
      throw new Error('A valid Facebook Post ID is required.');
    }

    if (
      typeof message !== 'string' ||
      !message.trim()
    ) {
      throw new Error('Reply message cannot be empty.');
    }

    return request(
      `/comments/${encodeURIComponent(commentId.trim())}/reply`,
      {
        method: 'POST',
        body: JSON.stringify({
          pageId: pageId.trim(),
          postId: postId.trim(),
          message: message.trim()
        })
      }
    );
  },


  /**
   * Get Facebook Page Insights.
   *
   * Supported filters:
   * pageId, since, until
   */
  async getPageInsights(filters = {}) {
    const {
      pageId,
      since,
      until
    } = filters;

    if (
      typeof pageId !== 'string' ||
      !pageId.trim()
    ) {
      throw new Error(
        'Please select a Facebook Page.'
      );
    }

    const query = new URLSearchParams();

    query.set('pageId', pageId.trim());

    if (since) {
      query.set('since', since);
    }

    if (until) {
      query.set('until', until);
    }

    return request(
      `/insights/page?${query.toString()}`
    );
  },

  /**
   * Get Facebook Post Insights.
   *
   * Supported filters:
   * pageId, postId
   */
  async getPostInsights(filters = {}) {
    const {
      pageId,
      postId
    } = filters;

    if (
      typeof pageId !== 'string' ||
      !pageId.trim()
    ) {
      throw new Error(
        'Please select a Facebook Page.'
      );
    }

    if (
      typeof postId !== 'string' ||
      !postId.trim()
    ) {
      throw new Error(
        'A valid Facebook Post ID is required.'
      );
    }

    const query = new URLSearchParams();

    query.set('pageId', pageId.trim());
    query.set('postId', postId.trim());

    return request(
      `/insights/post?${query.toString()}`
    );
  },







  /**
   * Delete a Facebook post and its Firestore history.
   */
  async deletePostHistory(historyId) {
    if (
      typeof historyId !== 'string' ||
      !historyId.trim()
    ) {
      throw new Error(
        'A valid post history ID is required.'
      );
    }

    return request(
      `/posts/history/${encodeURIComponent(historyId.trim())}`,
      {
        method: 'DELETE'
      }
    );
  },

  /**
   * Generate Facebook caption for a product.
   */
  async generateCaption(productId) {
    if (
      typeof productId !== 'string' ||
      !productId.trim()
    ) {
      throw new Error('A valid product ID is required.');
    }

    return request('/posts/caption', {
      method: 'POST',
      body: JSON.stringify({
        productId: productId.trim()
      })
    });
  },

  /**
   * Publish a product post with backend-selected images.
   */
  async publishProductPost(productId, pageId, caption) {
    if (
      typeof productId !== 'string' ||
      !productId.trim()
    ) {
      throw new Error('A valid product ID is required.');
    }

    if (
      typeof pageId !== 'string' ||
      !pageId.trim()
    ) {
      throw new Error('Please select a Facebook Page.');
    }

    if (
      typeof caption !== 'string' ||
      !caption.trim()
    ) {
      throw new Error('Facebook caption cannot be empty.');
    }

    return request('/posts/publish', {
      method: 'POST',
      body: JSON.stringify({
        productId: productId.trim(),
        pageId: pageId.trim(),
        caption: caption.trim()
      })
    });
  },

  /**
   * Legacy text post method.
   */
  async publishTextPost(message, link) {
    return request('/posts/text', {
      method: 'POST',
      body: JSON.stringify({
        message,
        link: link || undefined
      })
    });
  },

  /**
   * Legacy photo post method.
   */
  async publishPhotoPost(imageUrl, caption) {
    return request('/posts/photo', {
      method: 'POST',
      body: JSON.stringify({
        imageUrl,
        caption
      })
    });
  }

};
