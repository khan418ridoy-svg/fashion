
'use strict';

import {
  createElement,
  showToast
} from '../helpers.js';

import { api } from '../api.js';

// ========================================
// Categories Page State
// ========================================

let pageElement = null;
let collectionsData = [];
let categoriesData = [];
let isSaving = false;

// ========================================
// Helpers
// ========================================

function notify(message, type = 'info') {
  if (typeof showToast === 'function') {
    showToast(message, type);
    return;
  }

  window.dispatchEvent(
    new CustomEvent('admin:toast', {
      detail: { message, type }
    })
  );
}

function slugify(value = '') {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getSubcategories(category) {
  const items = category?.subCategories ?? category?.subcategories;

  return Array.isArray(items) ? items : [];
}

function getSelectedCollection() {
  const select = pageElement?.querySelector(
    '#category-collection'
  );

  const collectionId = select?.value;

  return collectionsData.find(
    collection => collection.id === collectionId
  ) || null;
}

function createMessage(className, titleText, descriptionText) {
  const wrapper = createElement('div', { className });

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
// Modal
// ========================================

function closeCategoryModal() {
  pageElement?.querySelector('.modal-overlay')?.remove();
  isSaving = false;
}

function openCategoryModal(category = null) {
  const collection = getSelectedCollection();

  if (!collection) {
    notify('Please select a collection first.', 'warning');
    return;
  }

  closeCategoryModal();

  const isEdit = Boolean(category);

  const overlay = createElement('div', {
    className: 'modal-overlay'
  });

  const modal = createElement('div', {
    className: 'modal-content'
  });

  const header = createElement('div', {
    className: 'modal-header'
  });

  const title = createElement('h3', {
    text: isEdit ? 'Edit Category' : 'Add Category'
  });

  const closeButton = createElement('button', {
    className: 'modal-close',
    text: '×',
    attributes: {
      type: 'button',
      'aria-label': 'Close'
    }
  });

  header.append(title, closeButton);

  const form = createElement('form', {
    className: 'modal-form',
    attributes: {
      id: 'category-form'
    }
  });

  const nameGroup = createElement('div', {
    className: 'form-group'
  });

  const nameLabel = createElement('label', {
    text: 'Category Name'
  });

  const nameInput = createElement('input', {
    className: 'form-control',
    attributes: {
      type: 'text',
      name: 'name',
      placeholder: 'Enter category name',
      required: 'required',
      maxlength: '80'
    }
  });

  nameInput.value = category?.name || '';

  nameGroup.append(nameLabel, nameInput);

  const idGroup = createElement('div', {
    className: 'form-group'
  });

  const idLabel = createElement('label', {
    text: 'Category ID'
  });

  const idInput = createElement('input', {
    className: 'form-control',
    attributes: {
      type: 'text',
      name: 'id',
      placeholder: 'category-id',
      required: 'required',
      maxlength: '80',
      readonly: isEdit ? 'readonly' : null
    }
  });

  idInput.value = category?.id || '';

  idGroup.append(idLabel, idInput);

  const iconGroup = createElement('div', {
    className: 'form-group'
  });

  const iconLabel = createElement('label', {
    text: 'Icon / Emoji'
  });

  const iconInput = createElement('input', {
    className: 'form-control',
    attributes: {
      type: 'text',
      name: 'icon',
      placeholder: 'Example: 👕',
      maxlength: '20'
    }
  });

  iconInput.value = category?.icon || '';

  iconGroup.append(iconLabel, iconInput);

  const activeGroup = createElement('div', {
    className: 'form-group'
  });

  const activeLabel = createElement('label', {
    className: 'checkbox-label'
  });

  const activeInput = createElement('input', {
    attributes: {
      type: 'checkbox',
      name: 'active'
    }
  });

  activeInput.checked = category
    ? category.active !== false
    : true;

  const activeText = createElement('span', {
    text: 'Active'
  });

  activeLabel.append(activeInput, activeText);
  activeGroup.append(activeLabel);

  const actions = createElement('div', {
    className: 'modal-actions'
  });

  const cancelButton = createElement('button', {
    className: 'btn btn-secondary',
    text: 'Cancel',
    attributes: {
      type: 'button'
    }
  });

  const saveButton = createElement('button', {
    className: 'btn btn-primary',
    text: isEdit ? 'Update Category' : 'Save Category',
    attributes: {
      type: 'submit'
    }
  });

  actions.append(cancelButton, saveButton);

  form.append(
    nameGroup,
    idGroup,
    iconGroup,
    activeGroup,
    actions
  );

  modal.append(header, form);
  overlay.append(modal);

  pageElement.append(overlay);

  // Auto-generate ID from name
  if (!isEdit) {
    nameInput.addEventListener('input', () => {
      idInput.value = slugify(nameInput.value);
    });
  }

  closeButton.addEventListener('click', closeCategoryModal);
  cancelButton.addEventListener('click', closeCategoryModal);

  overlay.addEventListener('click', event => {
    if (event.target === overlay) {
      closeCategoryModal();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();

    if (isSaving) return;

    const name = nameInput.value.trim();
    const id = idInput.value.trim();
    const icon = iconInput.value.trim();
    const active = activeInput.checked;

    if (!name || !id) {
      notify('Category name and ID are required.', 'warning');
      return;
    }

    const payload = {
      name,
      id,
      icon,
      active
    };

    isSaving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    try {
      if (isEdit) {
        await api.taxonomy.updateCategory(
          collection.id,
          category.id,
          {
            name,
            icon,
            active
          }
        );
      } else {
        await api.taxonomy.createCategory(
          collection.id,
          payload
        );
      }

      closeCategoryModal();

      await refreshCategories(collection.id);

      notify(
        isEdit
          ? 'Category updated successfully.'
          : 'Category created successfully.',
        'success'
      );

    } catch (error) {
      console.error('[CATEGORIES] Save failed:', error);

      notify(
        error.message || 'Unable to save category.',
        'error'
      );

      isSaving = false;
      saveButton.disabled = false;
      saveButton.textContent = isEdit
        ? 'Update Category'
        : 'Save Category';
    }
  });

  nameInput.focus();
}

// ========================================
// Refresh Categories
// ========================================

async function refreshCategories(selectedCollectionId) {
  const response = await api.taxonomy.load({
    forceRefresh: true
  });

  if (!Array.isArray(response.collections)) {
    throw new Error('Unable to refresh collections.');
  }

  collectionsData = response.collections;

  setCollections(collectionsData);

  const select = pageElement?.querySelector(
    '#category-collection'
  );

  if (select) {
    select.value = selectedCollectionId;
  }

  updateSelectedCollection();
}

// ========================================
// Render Category Item
// ========================================

function renderCategoryItem(category) {
  const item = createElement('article', {
    className: 'category-card',
    attributes: {
      'data-category-name': category.name || category.id || ''
    }
  });

  const header = createElement('div', {
    className: 'category-card-header'
  });

  const name = createElement('h3', {
    className: 'category-name',
    text: `${category.icon || ''} ${category.name || category.id || 'Unnamed Category'}`
  });

  const status = createElement('span', {
    className: category.active !== false
      ? 'status-badge status-active'
      : 'status-badge status-inactive',
    text: category.active !== false ? 'Active' : 'Inactive'
  });

  header.append(name, status);

  const id = createElement('p', {
    className: 'category-id',
    text: `ID: ${category.id || 'N/A'}`
  });

  const count = createElement('p', {
    className: 'category-subcategory-count',
    text: `Subcategories: ${getSubcategories(category).length}`
  });

  const actions = createElement('div', {
    className: 'category-actions'
  });

  const editButton = createElement('button', {
    className: 'btn btn-secondary',
    text: 'Edit',
    attributes: {
      type: 'button',
      'data-action': 'edit',
      'data-id': category.id
    }
  });

  const deleteButton = createElement('button', {
    className: 'btn btn-danger',
    text: 'Delete',
    attributes: {
      type: 'button',
      'data-action': 'delete',
      'data-id': category.id
    }
  });

  actions.append(editButton, deleteButton);

  item.append(header, id, count, actions);

  return item;
}

// ========================================
// Render Category List
// ========================================

function renderCategoryList(categories) {
  if (!pageElement) return;

  const list = pageElement.querySelector('#categories-list');

  if (!list) return;

  list.replaceChildren();

  if (!categories.length) {
    list.appendChild(
      createMessage(
        'empty-state',
        'No Categories Found',
        'This collection does not have any categories yet.'
      )
    );

    return;
  }

  const fragment = document.createDocumentFragment();

  categories.forEach(category => {
    fragment.appendChild(renderCategoryItem(category));
  });

  list.appendChild(fragment);
}

// ========================================
// Filter Categories
// ========================================

function filterCategories(searchText = '') {
  const query = searchText.trim().toLowerCase();

  const filtered = categoriesData.filter(category => {
    const name = String(category.name || '').toLowerCase();
    const id = String(category.id || '').toLowerCase();

    return name.includes(query) || id.includes(query);
  });

  renderCategoryList(filtered);
}

// ========================================
// Update Selected Collection
// ========================================

function updateSelectedCollection() {
  if (!pageElement) return;

  const collection = getSelectedCollection();

  const list = pageElement.querySelector('#categories-list');

  if (!list) return;

  categoriesData = Array.isArray(collection?.categories)
    ? collection.categories
    : [];

  const searchInput = pageElement.querySelector('#category-search');

  if (searchInput) {
    searchInput.value = '';
  }

  renderCategoryList(categoriesData);

  window.dispatchEvent(
    new CustomEvent('categories:collection-change', {
      detail: {
        collectionId: collection?.id || null,
        categories: categoriesData
      }
    })
  );
}

// ========================================
// Load Collections
// ========================================

async function loadCollections() {
  if (!pageElement) return;

  const select = pageElement.querySelector('#category-collection');
  const list = pageElement.querySelector('#categories-list');

  if (!select || !list) return;

  select.disabled = true;

  list.replaceChildren(
    createMessage(
      'loading-state',
      'Loading Collections...',
      'Please wait.'
    )
  );

  try {
    const response = await api.taxonomy.load();

    if (!pageElement) return;

    if (!Array.isArray(response.collections)) {
      throw new Error('Invalid collections data received from server.');
    }

    collectionsData = response.collections;

    setCollections(collectionsData);

    list.replaceChildren(
      createMessage(
        'empty-state',
        'Select a Collection',
        'Choose a collection to view its categories.'
      )
    );

  } catch (error) {
    console.error('[CATEGORIES] Load failed:', error);

    if (!pageElement) return;

    list.replaceChildren(
      createMessage(
        'error-state',
        'Unable to Load Collections',
        error.message || 'Please try again.'
      )
    );

    list.appendChild(
      createElement('button', {
        className: 'btn btn-primary',
        text: 'Try Again',
        attributes: {
          type: 'button',
          id: 'retry-categories-btn'
        }
      })
    );

  } finally {
    if (pageElement && select.isConnected) {
      select.disabled = false;
    }
  }
}

// ========================================
// Set Collections
// ========================================

export function setCollections(collections = []) {
  if (!pageElement) return;

  const select = pageElement.querySelector('#category-collection');

  if (!select) return;

  select.replaceChildren();

  select.appendChild(
    createElement('option', {
      text: 'Select Collection',
      attributes: {
        value: ''
      }
    })
  );

  collections.forEach(collection => {
    select.appendChild(
      createElement('option', {
        text: collection.name || collection.id,
        attributes: {
          value: collection.id
        }
      })
    );
  });

  select.disabled = false;
}

// ========================================
// Render Page
// ========================================

export async function render() {
  const container = createElement('section', {
    className: 'page categories-page',
    attributes: {
      id: 'categories-page'
    }
  });

  const header = createElement('div', {
    className: 'page-header'
  });

  const heading = createElement('div', {
    className: 'page-heading'
  });

  const title = createElement('h2', {
    className: 'page-title',
    text: 'Categories'
  });

  const description = createElement('p', {
    className: 'page-description',
    text: 'Manage categories inside your collections.'
  });

  heading.append(title, description);

  const addButton = createElement('button', {
    className: 'btn btn-primary',
    text: '+ Add Category',
    attributes: {
      type: 'button',
      id: 'add-category-btn'
    }
  });

  header.append(heading, addButton);

  const filters = createElement('div', {
    className: 'categories-filters'
  });

  const collectionSelect = createElement('select', {
    className: 'form-control',
    attributes: {
      id: 'category-collection',
      required: 'required',
      disabled: 'disabled'
    }
  });

  collectionSelect.appendChild(
    createElement('option', {
      text: 'Loading Collections...',
      attributes: {
        value: ''
      }
    })
  );

  const searchInput = createElement('input', {
    className: 'form-control',
    attributes: {
      type: 'search',
      id: 'category-search',
      placeholder: 'Search categories...',
      autocomplete: 'off'
    }
  });

  filters.append(collectionSelect, searchInput);

  const list = createElement('div', {
    className: 'categories-list',
    attributes: {
      id: 'categories-list'
    }
  });

  container.append(header, filters, list);

  pageElement = container;
  collectionsData = [];
  categoriesData = [];

  await loadCollections();

  return container;
}

// ========================================
// Bind Events
// ========================================

export function bindEvents() {
  if (!pageElement) return;

  const addButton = pageElement.querySelector('#add-category-btn');
  const collectionSelect = pageElement.querySelector('#category-collection');
  const searchInput = pageElement.querySelector('#category-search');
  const list = pageElement.querySelector('#categories-list');

  // Add Category
  addButton?.addEventListener('click', () => {
    if (!getSelectedCollection()) {
      notify('Please select a collection first.', 'warning');
      return;
    }

    openCategoryModal();
  });

  // Collection Change
  collectionSelect?.addEventListener('change', () => {
    updateSelectedCollection();
  });

  // Search
  searchInput?.addEventListener('input', () => {
    filterCategories(searchInput.value);
  });

  // Edit / Delete / Retry
  list?.addEventListener('click', async event => {
    const button = event.target.closest('button');

    if (!button) return;

    if (button.id === 'retry-categories-btn') {
      await loadCollections();
      return;
    }

    const action = button.dataset.action;
    const categoryId = button.dataset.id;

    if (!action || !categoryId) return;

    const category = categoriesData.find(
      item => item.id === categoryId
    );

    if (!category) return;

    if (action === 'edit') {
      openCategoryModal(category);
      return;
    }

    if (action === 'delete') {
      const collection = getSelectedCollection();

      if (!collection) return;

      const confirmed = window.confirm(
        `Delete "${category.name}" category? This action cannot be undone.`
      );

      if (!confirmed) return;

      button.disabled = true;

      try {
        await api.taxonomy.deleteCategory(
          collection.id,
          category.id
        );

        await refreshCategories(collection.id);

        notify('Category deleted successfully.', 'success');

      } catch (error) {
        console.error('[CATEGORIES] Delete failed:', error);

        notify(
          error.message || 'Unable to delete category.',
          'error'
        );

        button.disabled = false;
      }
    }
  });
}

// ========================================
// Getters
// ========================================

export function getCategories() {
  return [...categoriesData];
}

export function getLoadedCollections() {
  return [...collectionsData];
}

// ========================================
// Cleanup
// ========================================

export function cleanup() {
  pageElement = null;
  collectionsData = [];
  categoriesData = [];
  isSaving = false;
}
