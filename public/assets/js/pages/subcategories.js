
'use strict';

import { createElement, showToast, confirmAction } from '../helpers.js';
import { api } from '../api.js';

// ========================================
// State
// ========================================

let pageElement = null;

let collectionsData = [];
let categoriesData = [];
let subcategoriesData = [];

let isSaving = false;

// ========================================
// Helpers
// ========================================

function getElement(selector) {
  return pageElement?.querySelector(selector);
}

function createMessage(message, type = 'info') {
  return createElement('div', {
    className: `message message-${type}`,
    text: message
  });
}

function notify(message, type = 'success') {
  if (typeof showToast === 'function') {
    showToast(message, type);
  } else {
    alert(message);
  }
}

function getSelectedCollection() {
  const select = getElement('#subcategory-collection');

  return collectionsData.find(
    item => item.id === select?.value
  ) || null;
}

function getSelectedCategory() {
  const select = getElement('#subcategory-category');

  return categoriesData.find(
    item => item.id === select?.value
  ) || null;
}

function getSubcategoryItems(category) {
  const items =
    category?.subCategories ??
    category?.subcategories;

  return Array.isArray(items) ? items : [];
}

function createSubcategoryId(name, categoryId) {
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');

  return `${categoryId}-${slug}`;
}

// ========================================
// Load Taxonomy
// ========================================

async function loadCollections() {
  const select = getElement('#subcategory-collection');
  const list = getElement('#subcategory-list');

  if (!select || !list) return;

  select.disabled = true;
  list.replaceChildren(
    createMessage('Loading collections...')
  );

  try {
    const response = await api.taxonomy.load();

    if (!Array.isArray(response?.collections)) {
      throw new Error('Invalid collections response.');
    }

    collectionsData = response.collections;

    select.replaceChildren();

    select.append(
      createElement('option', {
        text: 'Select Collection',
        attributes: { value: '' }
      })
    );

    collectionsData.forEach(collection => {
      select.append(
        createElement('option', {
          text: `${collection.icon || ''} ${collection.name}`,
          attributes: { value: collection.id }
        })
      );
    });

    select.disabled = collectionsData.length === 0;

    list.replaceChildren(
      createMessage(
        collectionsData.length
          ? 'প্রথমে Collection নির্বাচন করুন।'
          : 'কোনো Collection পাওয়া যায়নি।'
      )
    );

  } catch (error) {
    console.error('[Subcategories Load]', error);

    list.replaceChildren(
      createMessage(
        error.message || 'Collection load failed.',
        'error'
      )
    );

    const retry = createElement('button', {
      className: 'btn btn-primary',
      text: 'Retry',
      attributes: { type: 'button' }
    });

    retry.addEventListener('click', loadCollections);

    list.append(retry);

  } finally {
    if (select.isConnected) {
      select.disabled = collectionsData.length === 0;
    }
  }
}

// ========================================
// Collection Change
// ========================================

function updateSelectedCollection() {
  const collection = getSelectedCollection();

  categoriesData = Array.isArray(collection?.categories)
    ? collection.categories
    : [];

  subcategoriesData = [];

  const categorySelect = getElement('#subcategory-category');

  if (categorySelect) {
    categorySelect.replaceChildren();

    categorySelect.append(
      createElement('option', {
        text: 'Select Category',
        attributes: { value: '' }
      })
    );

    categoriesData.forEach(category => {
      categorySelect.append(
        createElement('option', {
          text: `${category.icon || ''} ${category.name}`,
          attributes: { value: category.id }
        })
      );
    });

    categorySelect.disabled = categoriesData.length === 0;
  }

  renderSubcategoryList([]);

  updateAddButton();
}

// ========================================
// Category Change
// ========================================

function updateSelectedCategory() {
  const category = getSelectedCategory();

  subcategoriesData = getSubcategoryItems(category);

  const search = getElement('#subcategory-search');

  if (search) search.value = '';

  renderSubcategoryList(subcategoriesData);

  updateAddButton();
}

// ========================================
// Add Button State
// ========================================

function updateAddButton() {
  const button = getElement('#add-subcategory-btn');

  if (!button) return;

  button.disabled = !(
    getSelectedCollection() &&
    getSelectedCategory()
  );
}

// ========================================
// Render Subcategory Item
// ========================================

function renderSubcategoryItem(item) {
  const card = createElement('article', {
    className: 'subcategory-item'
  });

  const info = createElement('div', {
    className: 'subcategory-info'
  });

  const title = createElement('div', {
    className: 'subcategory-title'
  });

  title.append(
    createElement('span', {
      className: 'subcategory-icon',
      text: item.icon || '📁'
    }),
    createElement('h3', {
      className: 'subcategory-name',
      text: item.name || 'Unnamed'
    })
  );

  info.append(
    title,
    createElement('p', {
      className: 'subcategory-id',
      text: `ID: ${item.id}`
    })
  );

  const status = createElement('span', {
    className: `status-badge ${
      item.active ? 'status-active' : 'status-inactive'
    }`,
    text: item.active ? 'Active' : 'Inactive'
  });

  const actions = createElement('div', {
    className: 'subcategory-actions'
  });

  const editButton = createElement('button', {
    className: 'btn btn-secondary btn-sm',
    text: 'Edit',
    attributes: {
      type: 'button',
      'data-action': 'edit',
      'data-id': item.id
    }
  });

  const deleteButton = createElement('button', {
    className: 'btn btn-danger btn-sm',
    text: 'Delete',
    attributes: {
      type: 'button',
      'data-action': 'delete',
      'data-id': item.id
    }
  });

  actions.append(editButton, deleteButton);

  card.append(info, status, actions);

  return card;
}

// ========================================
// Render Subcategory List
// ========================================

function renderSubcategoryList(items = []) {
  const list = getElement('#subcategory-list');

  if (!list) return;

  list.replaceChildren();

  if (!items.length) {
    list.append(
      createMessage(
        getSelectedCategory()
          ? 'এই Category-তে কোনো Subcategory নেই।'
          : 'প্রথমে Collection এবং Category নির্বাচন করুন।'
      )
    );

    return;
  }

  items.forEach(item => {
    list.append(renderSubcategoryItem(item));
  });
}

// ========================================
// Search
// ========================================

function filterSubcategories() {
  const search = getElement('#subcategory-search');

  const keyword = (search?.value || '')
    .trim()
    .toLowerCase();

  const filtered = subcategoriesData.filter(item => {
    return (
      String(item.name || '').toLowerCase().includes(keyword) ||
      String(item.id || '').toLowerCase().includes(keyword)
    );
  });

  renderSubcategoryList(filtered);
}

// ========================================
// Modal
// ========================================

function closeModal() {
  getElement('#subcategory-modal')?.remove();
}

function createField(labelText, input) {
  const field = createElement('div', {
    className: 'form-group'
  });

  field.append(
    createElement('label', {
      text: labelText
    }),
    input
  );

  return field;
}

function openSubcategoryModal(item = null) {
  const isEdit = Boolean(item);

  closeModal();

  const modal = createElement('div', {
    className: 'modal-overlay',
    attributes: {
      id: 'subcategory-modal'
    }
  });

  const content = createElement('div', {
    className: 'modal-content'
  });

  const header = createElement('div', {
    className: 'modal-header'
  });

  header.append(
    createElement('h2', {
      text: isEdit ? 'Edit Subcategory' : 'Add Subcategory'
    })
  );

  const closeButton = createElement('button', {
    className: 'modal-close',
    text: '×',
    attributes: {
      type: 'button',
      'aria-label': 'Close'
    }
  });

  closeButton.addEventListener('click', closeModal);

  header.append(closeButton);

  const form = createElement('form', {
    className: 'modal-form',
    attributes: {
      id: 'subcategory-form'
    }
  });

  const nameInput = createElement('input', {
    attributes: {
      type: 'text',
      name: 'name',
      placeholder: 'Enter subcategory name',
      maxlength: '100',
      required: true,
      value: item?.name || ''
    }
  });

  const idInput = createElement('input', {
    attributes: {
      type: 'text',
      name: 'id',
      placeholder: 'Auto generated ID',
      value: item?.id || '',
      required: true,
      disabled: isEdit
    }
  });

  const iconInput = createElement('input', {
    attributes: {
      type: 'text',
      name: 'icon',
      placeholder: 'Example: 👕',
      maxlength: '50',
      value: item?.icon || ''
    }
  });

  const activeInput = createElement('input', {
    attributes: {
      type: 'checkbox',
      name: 'active'
    }
  });

  activeInput.checked = item
    ? item.active !== false
    : true;

  const activeLabel = createElement('label', {
    className: 'checkbox-label'
  });

  activeLabel.append(
    activeInput,
    document.createTextNode(' Active')
  );

  const activeField = createElement('div', {
    className: 'form-group'
  });

  activeField.append(activeLabel);

  nameInput.addEventListener('input', () => {
    if (!isEdit) {
      idInput.value = createSubcategoryId(
        nameInput.value,
        getSelectedCategory()?.id || 'subcategory'
      );
    }
  });

  const actions = createElement('div', {
    className: 'modal-actions'
  });

  const cancelButton = createElement('button', {
    className: 'btn btn-secondary',
    text: 'Cancel',
    attributes: { type: 'button' }
  });

  cancelButton.addEventListener('click', closeModal);

  const saveButton = createElement('button', {
    className: 'btn btn-primary',
    text: isEdit ? 'Update Subcategory' : 'Save Subcategory',
    attributes: { type: 'submit' }
  });

  actions.append(cancelButton, saveButton);

  form.append(
    createField('Subcategory Name', nameInput),
    createField('Subcategory ID', idInput),
    createField('Icon / Emoji', iconInput),
    activeField,
    actions
  );

  content.append(header, form);
  modal.append(content);

  modal.addEventListener('click', event => {
    if (event.target === modal) {
      closeModal();
    }
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();

    if (isSaving) return;

    const collection = getSelectedCollection();
    const category = getSelectedCategory();

    if (!collection || !category) {
      notify('Collection এবং Category নির্বাচন করুন।', 'error');
      return;
    }

    const name = nameInput.value.trim();
    const id = idInput.value.trim();
    const icon = iconInput.value.trim();

    if (!name || !id) {
      notify('Name এবং ID আবশ্যক।', 'error');
      return;
    }

    isSaving = true;
    saveButton.disabled = true;
    saveButton.textContent = 'Saving...';

    try {
      const payload = {
        name,
        id,
        icon,
        active: activeInput.checked
      };

      if (isEdit) {
        await api.taxonomy.updateSubcategory(
          collection.id,
          category.id,
          item.id,
          {
            name: payload.name,
            icon: payload.icon,
            active: payload.active
          }
        );
      } else {
        await api.taxonomy.createSubcategory(
          collection.id,
          category.id,
          payload
        );
      }

      closeModal();

      await refreshSubcategories(
        collection.id,
        category.id
      );

      notify(
        isEdit
          ? 'Subcategory updated successfully.'
          : 'Subcategory created successfully.',
        'success'
      );

    } catch (error) {
      console.error('[Subcategory Save]', error);

      notify(
        error.message || 'Subcategory save failed.',
        'error'
      );

    } finally {
      isSaving = false;

      if (saveButton.isConnected) {
        saveButton.disabled = false;
        saveButton.textContent = isEdit
          ? 'Update Subcategory'
          : 'Save Subcategory';
      }
    }
  });

  pageElement.append(modal);

  nameInput.focus();
}

// ========================================
// Refresh After Mutation
// ========================================

async function refreshSubcategories(collectionId, categoryId) {
  const response = await api.taxonomy.load({
    forceRefresh: true
  });

  if (!Array.isArray(response?.collections)) {
    throw new Error('Unable to refresh taxonomy data.');
  }

  collectionsData = response.collections;

  const collection = collectionsData.find(
    item => item.id === collectionId
  );

  categoriesData = Array.isArray(collection?.categories)
    ? collection.categories
    : [];

  const category = categoriesData.find(
    item => item.id === categoryId
  );

  subcategoriesData = getSubcategoryItems(category);

  const collectionSelect = getElement('#subcategory-collection');
  const categorySelect = getElement('#subcategory-category');

  if (collectionSelect) {
    collectionSelect.value = collectionId;
  }

  if (categorySelect) {
    categorySelect.value = categoryId;
  }

  renderSubcategoryList(subcategoriesData);
  updateAddButton();
}

// ========================================
// Edit Subcategory
// ========================================

function editSubcategory(id) {
  const item = subcategoriesData.find(
    subcategory => subcategory.id === id
  );

  if (!item) {
    notify('Subcategory not found.', 'error');
    return;
  }

  openSubcategoryModal(item);
}

// ========================================
// Delete Subcategory
// ========================================

async function deleteSubcategory(id) {
  const collection = getSelectedCollection();
  const category = getSelectedCategory();

  if (!collection || !category) return;

  const item = subcategoriesData.find(
    subcategory => subcategory.id === id
  );

  if (!item) return;

  const confirmed = await confirmAction(
    `Are you sure you want to delete "${item.name}"?`
  );

  if (!confirmed) return;

  try {
    await api.taxonomy.deleteSubcategory(
      collection.id,
      category.id,
      id
    );

    await refreshSubcategories(
      collection.id,
      category.id
    );

    notify('Subcategory deleted successfully.', 'success');

  } catch (error) {
    console.error('[Subcategory Delete]', error);

    notify(
      error.message || 'Subcategory delete failed.',
      'error'
    );
  }
}

// ========================================
// Render Page
// ========================================

export async function render() {
  pageElement = null;

  collectionsData = [];
  categoriesData = [];
  subcategoriesData = [];

  const container = createElement('section', {
    className: 'page-content subcategories-page'
  });

  const header = createElement('div', {
    className: 'page-header'
  });

  const heading = createElement('div', {
    className: 'page-heading'
  });

  heading.append(
    createElement('h1', {
      text: 'Subcategories'
    }),
    createElement('p', {
      text: 'Manage category subcategories.'
    })
  );

  const addButton = createElement('button', {
    className: 'btn btn-primary',
    text: 'Add Subcategory',
    attributes: {
      type: 'button',
      id: 'add-subcategory-btn',
      disabled: true
    }
  });

  header.append(heading, addButton);

  const filters = createElement('div', {
    className: 'filter-card'
  });

  const collectionSelect = createElement('select', {
    attributes: {
      id: 'subcategory-collection'
    }
  });

  const collectionField = createField(
    'Collection',
    collectionSelect
  );

  const categorySelect = createElement('select', {
    attributes: {
      id: 'subcategory-category',
      disabled: true
    }
  });

  const categoryField = createField(
    'Category',
    categorySelect
  );

  const searchInput = createElement('input', {
    attributes: {
      id: 'subcategory-search',
      type: 'search',
      placeholder: 'Search by name or ID'
    }
  });

  const searchField = createField(
    'Search Subcategory',
    searchInput
  );

  filters.append(
    collectionField,
    categoryField,
    searchField
  );

  const list = createElement('div', {
    className: 'subcategory-list',
    attributes: {
      id: 'subcategory-list'
    }
  });

  container.append(header, filters, list);

  pageElement = container;

  await loadCollections();

  return container;
}

// ========================================
// Bind Events
// ========================================

export function bindEvents() {
  if (!pageElement) return;

  const collectionSelect = getElement('#subcategory-collection');
  const categorySelect = getElement('#subcategory-category');
  const searchInput = getElement('#subcategory-search');
  const addButton = getElement('#add-subcategory-btn');
  const list = getElement('#subcategory-list');

  collectionSelect?.addEventListener('change', () => {
    updateSelectedCollection();
  });

  categorySelect?.addEventListener('change', () => {
    updateSelectedCategory();
  });

  searchInput?.addEventListener('input', () => {
    filterSubcategories();
  });

  addButton?.addEventListener('click', () => {
    if (!getSelectedCollection() || !getSelectedCategory()) {
      notify('প্রথমে Collection ও Category নির্বাচন করুন.', 'error');
      return;
    }

    openSubcategoryModal();
  });

  list?.addEventListener('click', event => {
    const button = event.target.closest('[data-action]');

    if (!button) return;

    const id = button.dataset.id;
    const action = button.dataset.action;

    if (action === 'edit') {
      editSubcategory(id);
    }

    if (action === 'delete') {
      deleteSubcategory(id);
    }
  });
}

// ========================================
// Public Getters
// ========================================

export function getCollections() {
  return [...collectionsData];
}

export function getCategories() {
  return [...categoriesData];
}

export function getSubcategories() {
  return [...subcategoriesData];
}

// ========================================
// Cleanup
// ========================================

export function cleanup() {
  closeModal();

  pageElement = null;

  collectionsData = [];
  categoriesData = [];
  subcategoriesData = [];

  isSaving = false;
}
