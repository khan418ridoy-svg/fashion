
'use strict';

// Multiple collection/category/subcategory mappings for one product.

import { api } from '../../api.js';

import {
  getProductElement,
  showProductMessage
} from './product-utils.js';

// ========================================
// CONFIGURATION
// ========================================

const SELECTORS = {
  list: '#product-taxonomy-list',
  addButton: '#add-product-taxonomy'
};

// ========================================
// STATE
// ========================================

let taxonomyCollections = [];
let initialized = false;
let rowCounter = 0;
let pendingAssignments = [];

// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    list: getProductElement(SELECTORS.list),
    addButton: getProductElement(SELECTORS.addButton)
  };
}

// ========================================
// SAFE HELPERS
// ========================================

function safeString(value) {
  if (value === null || value === undefined) {
    return '';
  }

  if (
    typeof value === 'object' ||
    typeof value === 'function'
  ) {
    return '';
  }

  return String(value).trim();
}

function getItemId(item) {
  return safeString(item?.id);
}

function getItemName(item) {
  return safeString(
    item?.name ?? item?.title ?? item?.id
  );
}

function getActiveItems(items) {
  return Array.isArray(items)
    ? items.filter(item => {
        return item &&
          typeof item === 'object' &&
          item.isActive !== false;
      })
    : [];
}

// ========================================
// TAXONOMY LOOKUPS
// ========================================

function getCollection(collectionId) {
  return taxonomyCollections.find(
    item => getItemId(item) === safeString(collectionId)
  ) || null;
}

function getCategories(collectionId) {
  return getActiveItems(
    getCollection(collectionId)?.categories
  );
}

function getCategory(collectionId, categoryId) {
  return getCategories(collectionId).find(
    item => getItemId(item) === safeString(categoryId)
  ) || null;
}

function getSubcategories(collectionId, categoryId) {
  const category = getCategory(
    collectionId,
    categoryId
  );

  return getActiveItems(
    category?.subCategories ??
    category?.subcategories
  );
}

// ========================================
// RENDER SELECT OPTIONS
// ========================================

function renderOptions(
  select,
  items,
  placeholder,
  selectedId = ''
) {
  if (!select) return;

  select.replaceChildren();

  const placeholderOption = document.createElement('option');

  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;

  select.appendChild(placeholderOption);

  const selected = safeString(selectedId);

  getActiveItems(items).forEach(item => {
    const id = getItemId(item);
    const name = getItemName(item);

    if (!id || !name) return;

    const option = document.createElement('option');

    option.value = id;
    option.textContent = name;
    option.selected = id === selected;

    select.appendChild(option);
  });

  select.disabled = select.options.length <= 1;
}

// ========================================
// POPULATE CATEGORIES
// ========================================

function populateCategories(row, selectedId = '') {
  const collection = row.querySelector(
    '.product-taxonomy-collection'
  );

  const category = row.querySelector(
    '.product-taxonomy-category'
  );

  renderOptions(
    category,
    getCategories(collection?.value),
    'Select Category',
    selectedId
  );
}

// ========================================
// POPULATE SUBCATEGORIES
// ========================================

function populateSubcategories(row, selectedId = '') {
  const collection = row.querySelector(
    '.product-taxonomy-collection'
  );

  const category = row.querySelector(
    '.product-taxonomy-category'
  );

  const subcategory = row.querySelector(
    '.product-taxonomy-subcategory'
  );

  renderOptions(
    subcategory,
    getSubcategories(
      collection?.value,
      category?.value
    ),
    'Select Subcategory (optional)',
    selectedId
  );
}

// ========================================
// REMOVE BUTTON STATE
// ========================================

function updateRemoveButtons() {
  const { list } = getElements();

  if (!list) return;

  const rows = list.querySelectorAll(
    '.product-taxonomy-row'
  );

  rows.forEach(row => {
    const button = row.querySelector(
      '.remove-product-taxonomy'
    );

    if (button) {
      button.disabled = rows.length === 1;
    }
  });
}

// ========================================
// CREATE SELECT FIELD
// ========================================

function createSelect(className, labelText) {
  const group = document.createElement('div');

  group.className = 'form-group';

  const label = document.createElement('label');

  label.textContent = labelText;

  const select = document.createElement('select');

  select.className = `form-control ${className}`;

  label.htmlFor = `product-taxonomy-${className}-${rowCounter + 1}`;

  select.id = label.htmlFor;

  group.append(
    label,
    select
  );

  return {
    group,
    select
  };
}

// ========================================
// CREATE TAXONOMY ROW
// ========================================

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

  const collectionId = safeString(data.collectionId);
  const categoryId = safeString(data.categoryId);

  const subCategoryId = safeString(
    data.subCategoryId ?? data.subcategoryId
  );

  renderOptions(
    collectionField.select,
    taxonomyCollections,
    'Select Collection',
    collectionId
  );

  collectionField.select.value = collectionId;

  populateCategories(row, categoryId);

  categoryField.select.value = categoryId;

  populateSubcategories(row, subCategoryId);

  subcategoryField.select.value = subCategoryId;

  return row;
}

// ========================================
// RENDER ASSIGNMENTS
// ========================================

function renderAssignments(assignments = []) {
  const { list } = getElements();

  if (!list) return;

  list.replaceChildren();

  const rows = Array.isArray(assignments) && assignments.length
    ? assignments
    : [{}];

  rows.forEach(item => {
    const row = createTaxonomyRow(item);

    list.appendChild(row);
  });

  updateRemoveButtons();
}

// ========================================
// ADD TAXONOMY
// ========================================

export function addProductTaxonomy(data = {}) {
  const { list } = getElements();

  if (!list) return null;

  const row = createTaxonomyRow(data);

  list.appendChild(row);

  updateRemoveButtons();

  return row;
}

// ========================================
// READ TAXONOMY ROW
// ========================================

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

// ========================================
// NORMALIZE ASSIGNMENTS
// ========================================

function normalizeAssignments(data = {}) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    return [];
  }

  const direct =
    data.assignments ??
    data.taxonomyAssignments ??
    data.taxonomies;

  if (Array.isArray(direct)) {
    return direct
      .filter(item => item && typeof item === 'object')
      .map(item => ({
        collectionId: safeString(item.collectionId),
        categoryId: safeString(item.categoryId),
        subCategoryId: safeString(
          item.subCategoryId ?? item.subcategoryId
        )
      }));
  }

  if (Array.isArray(data.collectionIds)) {
    return data.collectionIds.map((collectionId, index) => ({
      collectionId: safeString(collectionId),
      categoryId: safeString(data.categoryIds?.[index]),
      subCategoryId: safeString(
        data.subCategoryIds?.[index]
      )
    }));
  }

  if (
    data.collectionId ||
    data.categoryId ||
    data.subCategoryId ||
    data.subcategoryId
  ) {
    return [{
      collectionId: safeString(data.collectionId),
      categoryId: safeString(data.categoryId),
      subCategoryId: safeString(
        data.subCategoryId ?? data.subcategoryId
      )
    }];
  }

  return [];
}

// ========================================
// GET PRODUCT CATEGORY DATA
// ========================================

export function getProductCategoryData() {
  const { list } = getElements();

  const assignments = list
    ? Array.from(
        list.querySelectorAll('.product-taxonomy-row'),
        readTaxonomyRow
      ).filter(item => {
        return item.collectionId || item.categoryId;
      })
    : [];

  const first = assignments[0] || {};

  return {
    assignments,

    collectionIds: assignments.map(
      item => item.collectionId
    ),

    categoryIds: assignments.map(
      item => item.categoryId
    ),

    subCategoryIds: assignments.map(
      item => item.subCategoryId
    ),

    collectionId: first.collectionId || '',
    categoryId: first.categoryId || '',
    subCategoryId: first.subCategoryId || ''
  };
}

// ========================================
// SET PRODUCT CATEGORY DATA
// ========================================

export function setProductCategoryData(data = {}) {
  const assignments = normalizeAssignments(data);

  pendingAssignments = assignments;

  const { list } = getElements();

  if (!list) return;

  renderAssignments(assignments);
}

// ========================================
// FIND TAXONOMY ITEM
// ========================================

function findTaxonomyItem(items, value) {
  const target = safeString(value).toLowerCase();

  if (!target) return null;

  return getActiveItems(items).find(item => {
    return (
      getItemId(item).toLowerCase() === target ||
      getItemName(item).toLowerCase() === target
    );
  }) || null;
}

// ========================================
// APPLY AI TAXONOMY SUGGESTION
// ========================================

export function applyProductTaxonomySuggestion(data = {}) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    return false;
  }

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
    assignments: [
      ...current,
      suggestion
    ]
  });

  return true;
}

// ========================================
// VALIDATE PRODUCT CATEGORY
// ========================================

export function validateProductCategory() {
  const { list } = getElements();

  const rows = list?.querySelectorAll(
    '.product-taxonomy-row'
  ) || [];

  if (!rows.length) {
    showProductMessage(
      'কমপক্ষে একটি taxonomy যোগ করুন।',
      'warning'
    );

    return false;
  }

  const seen = new Set();

  for (const row of rows) {
    const data = readTaxonomyRow(row);

    if (!data.collectionId) {
      showProductMessage(
        'Collection নির্বাচন করুন।',
        'warning'
      );

      row.querySelector(
        '.product-taxonomy-collection'
      )?.focus();

      return false;
    }

    if (!data.categoryId) {
      showProductMessage(
        'Category নির্বাচন করুন।',
        'warning'
      );

      row.querySelector(
        '.product-taxonomy-category'
      )?.focus();

      return false;
    }

    const collection = getCollection(data.collectionId);

    if (!collection) {
      showProductMessage(
        'নির্বাচিত Collection আর সক্রিয় নেই।',
        'warning'
      );

      return false;
    }

    const category = getCategory(
      data.collectionId,
      data.categoryId
    );

    if (!category) {
      showProductMessage(
        'নির্বাচিত Category আর সক্রিয় নেই।',
        'warning'
      );

      return false;
    }

    if (
      data.subCategoryId &&
      !getSubcategories(
        data.collectionId,
        data.categoryId
      ).some(item => {
        return getItemId(item) === data.subCategoryId;
      })
    ) {
      showProductMessage(
        'নির্বাচিত Subcategory আর সক্রিয় নেই।',
        'warning'
      );

      return false;
    }

    const key = [
      data.collectionId,
      data.categoryId,
      data.subCategoryId
    ].join('::');

    if (seen.has(key)) {
      showProductMessage(
        'একই taxonomy একাধিকবার দেওয়া যাবে না।',
        'warning'
      );

      return false;
    }

    seen.add(key);
  }

  return true;
}

// ========================================
// BIND EVENTS
// ========================================

function bindEvents() {
  const { list, addButton } = getElements();

  if (!list || !addButton) return;

  if (list.dataset.taxonomyEventsBound === 'true') {
    return;
  }

  addButton.addEventListener('click', () => {
    addProductTaxonomy();
  });

  list.addEventListener('change', event => {
    const row = event.target.closest(
      '.product-taxonomy-row'
    );

    if (!row) return;

    if (
      event.target.matches(
        '.product-taxonomy-collection'
      )
    ) {
      populateCategories(row);
      populateSubcategories(row);
    }

    if (
      event.target.matches(
        '.product-taxonomy-category'
      )
    ) {
      populateSubcategories(row);
    }
  });

  list.addEventListener('click', event => {
    const button = event.target.closest(
      '[data-action="remove-taxonomy"]'
    );

    if (!button || button.disabled) return;

    button.closest(
      '.product-taxonomy-row'
    )?.remove();

    updateRemoveButtons();
  });

  list.dataset.taxonomyEventsBound = 'true';
}

// ========================================
// LOAD TAXONOMY
// ========================================

async function loadTaxonomy({
  forceRefresh = false
} = {}) {
  const response = await api.taxonomy.load({
    forceRefresh
  });

  if (!Array.isArray(response?.collections)) {
    throw new Error(
      'Invalid taxonomy data received from the server.'
    );
  }

  taxonomyCollections = response.collections;

  return taxonomyCollections;
}

// ========================================
// INITIALIZE
// ========================================

export async function initProductCategory({
  force = false
} = {}) {
  if (initialized && !force) {
    return true;
  }

  const { list, addButton } = getElements();

  if (!list || !addButton) {
    console.warn(
      '[PRODUCT TAXONOMY] Required elements not found.'
    );

    return false;
  }

  try {
    await loadTaxonomy();

    bindEvents();

    // Re-render after taxonomy has loaded.
    // This restores saved assignments during edit mode.
    renderAssignments(pendingAssignments);

    initialized = true;

    return true;

  } catch (error) {
    console.error(
      '[PRODUCT TAXONOMY]',
      error
    );

    showProductMessage(
      error.message ||
        'Collection, category ও subcategory load করা যায়নি।',
      'error',
      6000
    );

    return false;
  }
}

// ========================================
// REFRESH TAXONOMY
// ========================================

export async function refreshProductTaxonomy() {
  try {
    const current = getProductCategoryData();

    await loadTaxonomy({
      forceRefresh: true
    });

    pendingAssignments = current.assignments;

    renderAssignments(pendingAssignments);

    return true;

  } catch (error) {
    console.error(
      '[PRODUCT TAXONOMY] Refresh failed:',
      error
    );

    showProductMessage(
      'Taxonomy refresh করা যায়নি।',
      'error'
    );

    return false;
  }
}

// ========================================
// RESET
// ========================================

export function resetProductCategory() {
  pendingAssignments = [];

  setProductCategoryData({});
}

// ========================================
// CLEANUP
// ========================================

export function cleanupProductCategory() {
  initialized = false;
  rowCounter = 0;
  pendingAssignments = [];
}

// ========================================
// DEFAULT EXPORT
// ========================================

export default initProductCategory;
