
'use strict';

import {
  renderFacebookSettings,
  bindFacebookSettingsEvents
} from './settings.js';

// ========================================
// Render Facebook Page
// ========================================

export function renderFacebookPage() {
  return renderFacebookSettings();
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

  bindFacebookSettingsEvents(root);
}
