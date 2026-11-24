
'use strict';

import {
  renderFacebookSettings,
  bindFacebookSettingsEvents
} from './settings.js';

import {
  renderFacebookPosts,
  bindFacebookPostsEvents
} from './posts.js';

// ========================================
// Render Facebook Page
// ========================================

export function renderFacebookPage() {
  return `
    <div class="fb-page-layout">

      ${renderFacebookSettings()}

      <section class="fb-posts-section">
        ${renderFacebookPosts()}
      </section>

    </div>
  `;
}

// ========================================
// Bind Facebook Events
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

  // Facebook account and Page settings
  bindFacebookSettingsEvents(root);

  // Product selection and preview
  bindFacebookPostsEvents(root);
}
