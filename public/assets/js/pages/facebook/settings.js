
'use strict';

import { facebookApi } from './facebook-api.js';

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
  if (!value) return 'Not available';

  const date = value.toDate
    ? value.toDate()
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return 'Not available';
  }

  return date.toLocaleString();
}

function setFeedback(root, message, type = '') {
  const feedback = root.querySelector('[data-fb-feedback]');

  if (!feedback) return;

  feedback.textContent = message;
  feedback.dataset.type = type;
}

function setStatus(root, connected, name = '') {
  const status = root.querySelector('[data-fb-status]');
  const connectButton = root.querySelector('[data-fb-connect]');
  const disconnectButton = root.querySelector('[data-fb-disconnect]');
  const pageSection = root.querySelector('[data-fb-pages-section]');

  if (status) {
    status.textContent = connected
      ? `Connected${name ? ` — ${name}` : ''}`
      : 'Not connected';

    status.classList.toggle('is-connected', connected);
    status.classList.toggle('is-disconnected', !connected);
  }

  if (connectButton) {
    connectButton.hidden = connected;
  }

  if (disconnectButton) {
    disconnectButton.hidden = !connected;
  }

  if (pageSection) {
    pageSection.hidden = !connected;
  }
}

function renderPageList(root, pages = []) {
  const container = root.querySelector('[data-fb-pages-list]');
  const count = root.querySelector('[data-fb-page-count]');
  const saveButton = root.querySelector('[data-fb-save-pages]');

  if (!container) return;

  if (count) {
    count.textContent = `${pages.length} accessible Page(s)`;
  }

  if (!pages.length) {
    container.innerHTML = `
      <div class="fb-empty-state">
        No Facebook Pages were found for this account.
      </div>
    `;

    if (saveButton) saveButton.disabled = true;
    return;
  }

  container.innerHTML = pages.map(page => {
    const pageId = escapeHtml(page.pageId);
    const pageName = escapeHtml(page.pageName);
    const category = escapeHtml(page.category || 'Facebook Page');

    return `
      <label class="fb-page-option">
        <input
          type="checkbox"
          data-fb-page-id="${pageId}"
          ${page.selected ? 'checked' : ''}
        >

        <span class="fb-page-option-info">
          <strong>${pageName}</strong>
          <small>${category}</small>
          <small>Page ID: ${pageId}</small>
        </span>
      </label>
    `;
  }).join('');

  if (saveButton) saveButton.disabled = false;
}

async function loadConnection(root) {
  const result = await facebookApi.getConnection();

  if (!result.connected) {
    setStatus(root, false);
    return false;
  }

  setStatus(
    root,
    true,
    result.connection?.facebookUserName || ''
  );

  const expiry = result.connection?.tokenExpiresAt;

  const expiryElement = root.querySelector('[data-fb-token-expiry]');

  if (expiryElement) {
    expiryElement.textContent = result.connection?.tokenExpired
      ? 'Token expired — reconnect Facebook.'
      : `Token expiry: ${formatDate(expiry)}`;
  }

  return true;
}

async function loadPages(root) {
  const refreshButton = root.querySelector('[data-fb-refresh-pages]');

  if (refreshButton) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Loading...';
  }

  try {
    const result = await facebookApi.getAvailablePages();

    renderPageList(root, result.pages || []);

    setFeedback(
      root,
      `${result.count || 0} accessible Facebook Page(s) loaded.`,
      'success'
    );
  } finally {
    if (refreshButton) {
      refreshButton.disabled = false;
      refreshButton.textContent = 'Refresh Pages';
    }
  }
}

export function renderFacebookSettings() {
  return `
    <section class="fb-settings-layout">

      <article class="fb-card">
        <div class="fb-card-heading">
          <div>
            <span class="fb-eyebrow">FACEBOOK CONNECTION</span>
            <h2>Connect Facebook Account</h2>
          </div>

          <span
            class="fb-status-pill is-disconnected"
            data-fb-status
          >
            Checking...
          </span>
        </div>

        <p class="fb-muted">
          Connect your Facebook account to access and manage
          the Pages assigned to your account.
        </p>

        <div class="fb-form-actions">
          <button
            class="fb-button fb-button-primary"
            type="button"
            data-fb-connect
          >
            Connect Facebook
          </button>

          <button
            class="fb-button"
            type="button"
            data-fb-disconnect
            hidden
          >
            Disconnect
          </button>
        </div>

        <p
          class="fb-muted"
          data-fb-token-expiry
          aria-live="polite"
        ></p>

        <p
          class="fb-feedback"
          data-fb-feedback
          aria-live="polite"
        ></p>
      </article>

      <article
        class="fb-card"
        data-fb-pages-section
        hidden
      >
        <div class="fb-card-heading">
          <div>
            <span class="fb-eyebrow">PAGE MANAGEMENT</span>
            <h2>Select Facebook Pages</h2>
          </div>

          <span data-fb-page-count>0 accessible Page(s)</span>
        </div>

        <p class="fb-muted">
          Select one or multiple Pages. Only selected Pages
          will be available for backend automation.
        </p>

        <div class="fb-form-actions">
          <button
            class="fb-button"
            type="button"
            data-fb-refresh-pages
          >
            Refresh Pages
          </button>
        </div>

        <div
          class="fb-pages-list"
          data-fb-pages-list
        >
          <p class="fb-muted">Loading Pages...</p>
        </div>

        <div class="fb-form-actions">
          <button
            class="fb-button fb-button-primary"
            type="button"
            data-fb-save-pages
            disabled
          >
            Save Selected Pages
          </button>
        </div>
      </article>

    </section>
  `;
}

export function bindFacebookSettingsEvents(root = document) {
  const connectButton = root.querySelector('[data-fb-connect]');

  if (connectButton && !connectButton.dataset.bound) {
    connectButton.dataset.bound = 'true';

    connectButton.addEventListener('click', async () => {
      connectButton.disabled = true;
      connectButton.textContent = 'Redirecting...';

      try {
        const result = await facebookApi.startOAuth();

        if (!result.url) {
          throw new Error('Facebook Login URL was not returned.');
        }

        window.location.assign(result.url);
      } catch (error) {
        setFeedback(root, error.message, 'error');
        connectButton.disabled = false;
        connectButton.textContent = 'Connect Facebook';
      }
    });
  }

  const refreshButton = root.querySelector('[data-fb-refresh-pages]');

  if (refreshButton && !refreshButton.dataset.bound) {
    refreshButton.dataset.bound = 'true';

    refreshButton.addEventListener('click', async () => {
      try {
        await loadPages(root);
      } catch (error) {
        setFeedback(root, error.message, 'error');
      }
    });
  }

  const saveButton = root.querySelector('[data-fb-save-pages]');

  if (saveButton && !saveButton.dataset.bound) {
    saveButton.dataset.bound = 'true';

    saveButton.addEventListener('click', async () => {
      const selectedPageIds = Array.from(
        root.querySelectorAll('[data-fb-page-id]:checked')
      ).map(input => input.dataset.fbPageId);

      saveButton.disabled = true;
      saveButton.textContent = 'Saving...';

      try {
        const result = await facebookApi.selectPages(selectedPageIds);

        setFeedback(
          root,
          `${result.selectedCount} Facebook Page(s) saved successfully.`,
          'success'
        );

        await loadPages(root);
      } catch (error) {
        setFeedback(root, error.message, 'error');
      } finally {
        saveButton.disabled = false;
        saveButton.textContent = 'Save Selected Pages';
      }
    });
  }

  const disconnectButton = root.querySelector('[data-fb-disconnect]');

  if (disconnectButton && !disconnectButton.dataset.bound) {
    disconnectButton.dataset.bound = 'true';

    disconnectButton.addEventListener('click', async () => {
      const confirmed = window.confirm(
        'Disconnect Facebook and remove the saved Page connections?'
      );

      if (!confirmed) return;

      disconnectButton.disabled = true;
      disconnectButton.textContent = 'Disconnecting...';

      try {
        await facebookApi.disconnect();

        setStatus(root, false);
        renderPageList(root, []);

        setFeedback(
          root,
          'Facebook disconnected successfully.',
          'success'
        );

        const expiryElement = root.querySelector('[data-fb-token-expiry]');

        if (expiryElement) expiryElement.textContent = '';
      } catch (error) {
        setFeedback(root, error.message, 'error');
      } finally {
        disconnectButton.disabled = false;
        disconnectButton.textContent = 'Disconnect';
      }
    });
  }

  // Handle OAuth callback result after returning from Facebook.
  const params = new URLSearchParams(window.location.search);
  const facebookResult = params.get('facebook');

  if (facebookResult === 'connected') {
    setFeedback(root, 'Facebook connected successfully.', 'success');
  } else if (facebookResult === 'login_failed') {
    setFeedback(
      root,
      'Facebook Login failed. Please try connecting again.',
      'error'
    );
  }

  if (facebookResult) {
    params.delete('facebook');

    const query = params.toString();

    window.history.replaceState(
      {},
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`
    );
  }

  // Load existing connection and selected Pages.
  (async () => {
    try {
      const connected = await loadConnection(root);

      if (connected) {
        await loadPages(root);
      }
    } catch (error) {
      setFeedback(root, error.message, 'error');
      setStatus(root, false);
    }
  })();
}
