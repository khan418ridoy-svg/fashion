'use strict';

// Multiple collection/category/subcategory mappings for one product.

import { api } from '../../api.js';
import {
  getProductElement,
  showProductMessage
} from './product-utils.js';

const SELECTORS = {
  list: '#product-taxonomy-list',
  addButton: '#add-product-taxonomy'
};

let taxonomyCollections = [];
let initialized = false;
let rowCounter = 0;

function getElements() {
  return {
    list: getProductElement(SELECTORS.list),
    addButton: getProductElement(SELECTORS.addButton)
  };
}

function getItemId(item) {
  return String(item?.id ?? '').trim();
}

function getItemName(item) {
  return String(item?.name ?? item?.title ?? item?.id ?? '').trim();
}

function getActiveItems(items) {
  return Array.isArray(items)
    ? items.filter(item => item && item.isActive !== false)
    : [];
}

function getCollection(collectionId) {
  return taxonomyCollections.find(
    item => getItemId(item) === String(collectionId || '')
  ) || null;
}

function getCategories(collectionId) {
  return getActiveItems(getCollection(collectionId)?.categories);
}

function getCategory(collectionId, categoryId) {
  return getCategories(collectionId).find(
    item => getItemId(item) === String(categoryId || '')
  ) || null;
}

function getSubcategories(collectionId, categoryId) {
  const category = getCategory(collectionId, categoryId);

  return getActiveItems(
    category?.subCategories ?? category?.subcategories
  );
}

function renderOptions(select, items, placeholder, selectedId = '') {
  if (!select) return;

  select.replaceChildren();

  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  getActiveItems(items).forEach(item => {
    const id = getItemId(item);
    const name = getItemName(item);

    if (!id || !name) return;

    const option = document.createElement('option');
    option.value = id;
    option.textContent = name;
    option.selected = id === String(selectedId || '');
    select.appendChild(option);
  });

  select.disabled = select.options.length <= 1;
}

function populateCategories(row, selectedId = '') {
  const collection = row.querySelector('.product-taxonomy-collection');
  const category = row.querySelector('.product-taxonomy-category');

  renderOptions(
    category,
    getCategories(collection?.value),
    'Select Category',
    selectedId
  );
}

function populateSubcategories(row, selectedId = '') {
  const collection = row.querySelector('.product-taxonomy-collection');
  const category = row.querySelector('.product-taxonomy-category');
  const subcategory = row.querySelector('.product-taxonomy-subcategory');

  renderOptions(
    subcategory,
    getSubcategories(collection?.value, category?.value),
    'Select Subcategory (optional)',
    selectedId
  );
}

function updateRemoveButtons() {
  const { list } = getElements();
  if (!list) return;

  const rows = list.querySelectorAll('.product-taxonomy-row');

  rows.forEach(row => {
    const button = row.querySelector('.remove-product-taxonomy');
    if (button) button.disabled = rows.length === 1;
  });
}

function createSelect(className, labelText) {
  const group = document.createElement('div');
  group.className = 'form-group';

  const label = document.createElement('label');
  label.textContent = labelText;

  const select = document.createElement('select');
  select.className = `form-control ${className}`;

  group.append(label, select);
  return { group, select };
}

function createTaxonomyRow(data = {}) {
  rowCounter += 1;

  const row = document.createElement('div');
  row.className = 'product-taxonomy-row';
  row.dataset.taxonomyRowId = String(rowCounter);

  const collectionField = createSelect(
    'product-taxonomy-collection',
    'Collection'
  );
  const categoryField = createSelect(
    'product-taxonomy-category',
    'Category'
  );
  const subcategoryField = createSelect(
    'product-taxonomy-subcategory',
    'Subcategory'
  );

  const removeButton = document.createElement('button');
  removeButton.type = 'button';
  removeButton.className = 'remove-product-taxonomy';
  removeButton.dataset.action = 'remove-taxonomy';
  removeButton.textContent = 'Remove';

  row.append(
    collectionField.group,
    categoryField.group,
    subcategoryField.group,
    removeButton
  );

  renderOptions(
    collectionField.select,
    taxonomyCollections,
    'Select Collection',
    data.collectionId
  );

  populateCategories(row, data.categoryId);
  categoryField.select.value = data.categoryId || '';

  populateSubcategories(row, data.subCategoryId ?? data.subcategoryId);
  subcategoryField.select.value =
    data.subCategoryId ?? data.subcategoryId ?? '';

  return row;
}

export function addProductTaxonomy(data = {}) {
  const { list } = getElements();
  if (!list) return null;

  const row = createTaxonomyRow(data);
  list.appendChild(row);
  updateRemoveButtons();
  return row;
}

function readTaxonomyRow(row) {
  return {
    collectionId:
      row.querySelector('.product-taxonomy-collection')?.value || '',
    categoryId:
      row.querySelector('.product-taxonomy-category')?.value || '',
    subCategoryId:
      row.querySelector('.product-taxonomy-subcategory')?.value || ''
  };
}

function normalizeAssignments(data = {}) {
  const direct =
    data.assignments ?? data.taxonomyAssignments ?? data.taxonomies;

  if (Array.isArray(direct)) {
    return direct.map(item => ({
      collectionId: String(item?.collectionId || ''),
      categoryId: String(item?.categoryId || ''),
      subCategoryId: String(
        item?.subCategoryId ?? item?.subcategoryId ?? ''
      )
    }));
  }

  if (Array.isArray(data.collectionIds)) {
    return data.collectionIds.map((collectionId, index) => ({
      collectionId: String(collectionId || ''),
      categoryId: String(data.categoryIds?.[index] || ''),
      subCategoryId: String(data.subCategoryIds?.[index] || '')
    }));
  }

  if (data.collectionId || data.categoryId || data.subCategoryId) {
    return [{
      collectionId: String(data.collectionId || ''),
      categoryId: String(data.categoryId || ''),
      subCategoryId: String(
        data.subCategoryId ?? data.subcategoryId ?? ''
      )
    }];
  }

  return [];
}

export function getProductCategoryData() {
  const { list } = getElements();

  const assignments = list
    ? Array.from(
        list.querySelectorAll('.product-taxonomy-row'),
        readTaxonomyRow
      ).filter(item => item.collectionId || item.categoryId)
    : [];

  const first = assignments[0] || {};

  return {
    assignments,
    collectionIds: assignments.map(item => item.collectionId),
    categoryIds: assignments.map(item => item.categoryId),
    subCategoryIds: assignments.map(item => item.subCategoryId),
    collectionId: first.collectionId || '',
    categoryId: first.categoryId || '',
    subCategoryId: first.subCategoryId || ''
  };
}

export function setProductCategoryData(data = {}) {
  const { list } = getElements();
  if (!list) return;

  list.replaceChildren();
  const assignments = normalizeAssignments(data);

  (assignments.length ? assignments : [{}]).forEach(addProductTaxonomy);
  updateRemoveButtons();
}

function findTaxonomyItem(items, value) {
  const target = String(value || '').trim().toLowerCase();
  if (!target) return null;

  return getActiveItems(items).find(item => {
    return getItemId(item).toLowerCase() === target ||
      getItemName(item).toLowerCase() === target;
  }) || null;
}

export function applyProductTaxonomySuggestion(data = {}) {
  const collection = findTaxonomyItem(
    taxonomyCollections,
    data.collectionId ?? data.collection
  );

  if (!collection) return false;

  const category = findTaxonomyItem(
    collection.categories,
    data.categoryId ?? data.category
  );

  if (!category) return false;

  const subcategory = findTaxonomyItem(
    category.subCategories ?? category.subcategories,
    data.subCategoryId ?? data.subcategory
  );

  const suggestion = {
    collectionId: getItemId(collection),
    categoryId: getItemId(category),
    subCategoryId: getItemId(subcategory)
  };

  const current = getProductCategoryData().assignments;
  setProductCategoryData({
    assignments: [...current, suggestion]
  });

  return true;
}

export function validateProductCategory() {
  const { list } = getElements();
  const rows = list?.querySelectorAll('.product-taxonomy-row') || [];

  if (!rows.length) {
    showProductMessage('কমপক্ষে একটি taxonomy যোগ করুন।', 'warning');
    return false;
  }

  const seen = new Set();

  for (const row of rows) {
    const data = readTaxonomyRow(row);

    if (!data.collectionId) {
      showProductMessage('Collection নির্বাচন করুন।', 'warning');
      row.querySelector('.product-taxonomy-collection')?.focus();
      return false;
    }

    if (!data.categoryId) {
      showProductMessage('Category নির্বাচন করুন।', 'warning');
      row.querySelector('.product-taxonomy-category')?.focus();
      return false;
    }

    const key = [
      data.collectionId,
      data.categoryId,
      data.subCategoryId
    ].join('::');

    if (seen.has(key)) {
      showProductMessage('একই taxonomy একাধিকবার দেওয়া যাবে না।', 'warning');
      return false;
    }

    seen.add(key);
  }

  return true;
}

function bindEvents() {
  const { list, addButton } = getElements();
  if (!list || !addButton) return;

  if (list.dataset.taxonomyEventsBound === 'true') return;

  addButton.addEventListener('click', () => addProductTaxonomy());

  list.addEventListener('change', event => {
    const row = event.target.closest('.product-taxonomy-row');
    if (!row) return;

    if (event.target.matches('.product-taxonomy-collection')) {
      populateCategories(row);
      populateSubcategories(row);
    }

    if (event.target.matches('.product-taxonomy-category')) {
      populateSubcategories(row);
    }
  });

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-action="remove-taxonomy"]');
    if (!button || button.disabled) return;

    button.closest('.product-taxonomy-row')?.remove();
    updateRemoveButtons();
  });

  list.dataset.taxonomyEventsBound = 'true';
}

async function loadTaxonomy({ forceRefresh = false } = {}) {
  const response = await api.taxonomy.load({ forceRefresh });

  if (!Array.isArray(response?.collections)) {
    throw new Error('Invalid taxonomy data received from the server.');
  }

  taxonomyCollections = response.collections;
  return taxonomyCollections;
}

export async function initProductCategory({ force = false } = {}) {
  if (initialized && !force) return true;

  const { list, addButton } = getElements();

  if (!list || !addButton) {
    console.warn('[PRODUCT TAXONOMY] Required elements not found.');
    return false;
  }

  try {
    await loadTaxonomy();
    bindEvents();

    if (!list.children.length) addProductTaxonomy();

    initialized = true;
    return true;
  } catch (error) {
    console.error('[PRODUCT TAXONOMY]', error);
    showProductMessage(
      error.message || 'Collection, category ও subcategory load করা যায়নি।',
      'error',
      6000
    );
    return false;
  }
}

export async function refreshProductTaxonomy() {
  try {
    const current = getProductCategoryData();
    await loadTaxonomy({ forceRefresh: true });
    setProductCategoryData(current);
    return true;
  } catch (error) {
    console.error('[PRODUCT TAXONOMY] Refresh failed:', error);
    showProductMessage('Taxonomy refresh করা যায়নি।', 'error');
    return false;
  }
}

export function resetProductCategory() {
  setProductCategoryData({});
}

export function cleanupProductCategory() {
  initialized = false;
  rowCounter = 0;
}

export default initProductCategory;
