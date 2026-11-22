
'use strict';

import {
  renderFacebookPage,
  bindFacebookPageEvents
} from './facebook/index.js';

// ========================================
// Render Facebook Page
// ========================================

export function render() {
  const template = document.createElement('template');

  template.innerHTML = renderFacebookPage().trim();

  const page = template.content.firstElementChild;

  if (!page) {
    throw new Error(
      'Facebook page HTML could not be rendered.'
    );
  }

  return page;
}

// ========================================
// Bind Facebook Events
// ========================================

export function bindEvents(context) {
  bindFacebookPageEvents(context);
}
