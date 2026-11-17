
'use strict';

import {
  createElement
} from '../helpers.js';

import { api } from '../api.js';

// ========================================
// Collections Page State
// ========================================

let pageElement = null;
let collectionsData = [];

// ========================================
// Create Element Helper
// ========================================

function createMessage(className, titleText, descriptionText) {
  const wrapper = createElement('div', {
    className
  });

  const title = createElement('h3', {
    text: titleText
  });

  const description = createElement('p', {
    text: descriptionText
  });

  wrapper.append(title, description);

  return wrapper;
}

// ========================================
// Render Collection Item
// ========================================

function renderCollectionItem(collection) {
  const item = createElement('article', {
    className: 'collection-card',
    attributes: {
      'data-collection-name': collection.name || collection.id || ''
    }
  });

  const header = createElement('div', {
    className: 'collection-card-header'
  });

  const name = createElement('h3', {
    className: 'collection-name',
    text: collection.name || collection.id || 'Unnamed Collection'
  });

  const status = createElement('span', {
    className: collection.active
      ? 'status-badge status-active'
      : 'status-badge status-inactive',
    text: collection.active ? 'Active' : 'Inactive'
  });

  header.append(name, status);

  const id = createElement('p', {
    className: 'collection-id',
    text: `ID: ${collection.id || 'N/A'}`
  });

  const categoriesCount = Array.isArray(collection.categories)
    ? collection.categories.length
    : 0;

  const count = createElement('p', {
    className: 'collection-category-count',
    text: `Categories: ${categoriesCount}`
  });

  item.append(header, id, count);

  return item;
}

// ========================================
// Render Collection List
// ========================================

function renderCollectionList(collections) {
  if (!pageElement) return;

  const list = pageElement.querySelector(
    '#collections-list'
  );

  if (!list) return;

  list.replaceChildren();

  if (!collections.length) {
    list.appendChild(
      createMessage(
        'empty-state',
        'No Collections Found',
        'There are no collections to display.'
      )
    );

    return;
  }

  const fragment = document.createDocumentFragment();

  collections.forEach(collection => {
    fragment.appendChild(
      renderCollectionItem(collection)
    );
  });

  list.appendChild(fragment);
}

// ========================================
// Search Collections
// ========================================

function filterCollections(searchText = '') {
  const query = searchText.trim().toLowerCase();

  const filtered = collectionsData.filter(collection => {
    const name = String(collection.name || '').toLowerCase();
    const id = String(collection.id || '').toLowerCase();

    return (
      name.includes(query) ||
      id.includes(query)
    );
  });

  renderCollectionList(filtered);
}

// ========================================
// Load Collections From Backend
// ========================================

async function loadCollections() {
  if (!pageElement) return;

  const list = pageElement.querySelector(
    '#collections-list'
  );

  if (!list) return;

  list.replaceChildren(
    createMessage(
      'loading-state',
      'Loading Collections...',
      'Please wait while collections are loading.'
    )
  );

  try {
    const response = await api.taxonomy.load();

    if (!pageElement) return;

    if (!Array.isArray(response.collections)) {
      throw new Error(
        'Invalid collections data received from server.'
      );
    }

    collectionsData = response.collections;

    renderCollectionList(collectionsData);

    // Notify other pages or modules.
    window.dispatchEvent(
      new CustomEvent('taxonomy:loaded', {
        detail: {
          collections: collectionsData,
          version: response.version
        }
      })
    );

  } catch (error) {
    console.error(
      '[COLLECTIONS] Failed to load:',
      error
    );

    if (!pageElement) return;

    list.replaceChildren(
      createMessage(
        'error-state',
        'Unable to Load Collections',
        error.message || 'Please try again.'
      )
    );

    const retryButton = createElement('button', {
      className: 'btn btn-primary',
      text: 'Try Again',
      attributes: {
        type: 'button',
        id: 'retry-collections-btn'
      }
    });

    list.appendChild(retryButton);
  }
}

// ========================================
// Render Page
// ========================================

export async function render() {
  const container = createElement('section', {
    className: 'page collections-page',
    attributes: {
      id: 'collections-page'
    }
  });

  // Page Header
  const header = createElement('div', {
    className: 'page-header'
  });

  const heading = createElement('div', {
    className: 'page-heading'
  });

  const title = createElement('h2', {
    className: 'page-title',
    text: 'Collections'
  });

  const description = createElement('p', {
    className: 'page-description',
    text: 'Manage your product collections.'
  });

  heading.append(title, description);

  const addButton = createElement('button', {
    className: 'btn btn-primary',
    text: '+ Add Collection',
    attributes: {
      type: 'button',
      id: 'add-collection-btn'
    }
  });

  header.append(heading, addButton);

  // Search
  const toolbar = createElement('div', {
    className: 'collections-toolbar'
  });

  const searchInput = createElement('input', {
    className: 'form-control',
    attributes: {
      type: 'search',
      id: 'collection-search',
      placeholder: 'Search collections...',
      autocomplete: 'off'
    }
  });

  toolbar.appendChild(searchInput);

  // List
  const listContainer = createElement('div', {
    className: 'collections-list',
    attributes: {
      id: 'collections-list'
    }
  });

  container.append(
    header,
    toolbar,
    listContainer
  );

  pageElement = container;
  collectionsData = [];

  // Load from backend.
  await loadCollections();

  return container;
}

// ========================================
// Bind Events
// ========================================

export function bindEvents() {
  if (!pageElement) return;

  const addButton = pageElement.querySelector(
    '#add-collection-btn'
  );

  const searchInput = pageElement.querySelector(
    '#collection-search'
  );

  const list = pageElement.querySelector(
    '#collections-list'
  );

  // Add Collection
  addButton?.addEventListener('click', () => {
    window.dispatchEvent(
      new CustomEvent('collections:add')
    );
  });

  // Search
  searchInput?.addEventListener('input', () => {
    filterCollections(searchInput.value);
  });

  // Retry
  list?.addEventListener('click', event => {
    if (
      event.target.closest('#retry-collections-btn')
    ) {
      loadCollections();
    }
  });
}

// ========================================
// Get Loaded Collections
// ========================================

export function getCollections() {
  return [...collectionsData];
}

// ========================================
// Cleanup
// ========================================

export function cleanup() {
  pageElement = null;
  collectionsData = [];
}
