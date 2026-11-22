
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
 * Facebook API methods.
 */
export const facebookApi = {

  /**
   * Start Facebook OAuth login.
   */
  async startOAuth() {
    return request('/oauth/start');
  },

  /**
   * Get Facebook connection status.
   */
  async getConnection() {
    return request('/connection');
  },

  /**
   * Get all accessible Facebook Pages.
   */
  async getAvailablePages() {
    return request('/pages/available');
  },

  /**
   * Get selected Facebook Pages.
   */
  async getSelectedPages() {
    return request('/pages/selected');
  },

  /**
   * Save selected Facebook Page IDs.
   */
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

  /**
   * Disconnect Facebook.
   */
  async disconnect() {
    return request('/connection', {
      method: 'DELETE'
    });
  },

  /**
   * Get Facebook settings.
   */
  async getSettings() {
    return request('/settings');
  },

  /**
   * Update Facebook settings.
   */
  async updateSettings(settings) {
    return request('/settings', {
      method: 'PATCH',
      body: JSON.stringify(settings)
    });
  },

  /**
   * Publish text post.
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
   * Publish photo post.
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
