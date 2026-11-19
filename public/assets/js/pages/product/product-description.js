
'use strict';

// ========================================
// PRODUCT DESCRIPTION
// Description & Product Attributes
// ========================================

import {
  getProductElement,
  showProductMessage
} from './product-utils.js';


// ========================================
// STATE
// ========================================

let initialized = false;


// ========================================
// SELECTORS
// ========================================

const SELECTORS = {
  shortDescription: '#product-short-description',
  description: '#product-description',
  fabricType: '#product-fabric-type',
  fit: '#product-fit',
  sleeveType: '#product-sleeve-type',
  washCare: '#product-wash-care',
  tags: '#product-tags',
  shortCounter: '#product-short-description-counter',
  descriptionCounter: '#product-description-counter'
};

const LIMITS = {
  shortDescription: 300,
  description: 10000
};


// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    shortDescription: getProductElement(SELECTORS.shortDescription),
    description: getProductElement(SELECTORS.description),
    fabricType: getProductElement(SELECTORS.fabricType),
    fit: getProductElement(SELECTORS.fit),
    sleeveType: getProductElement(SELECTORS.sleeveType),
    washCare: getProductElement(SELECTORS.washCare),
    tags: getProductElement(SELECTORS.tags)
  };
}


// ========================================
// GET FIELD VALUE
// ========================================

function getValue(element) {
  return String(element?.value ?? '').trim();
}


// ========================================
// SET FIELD VALUE
// ========================================

function setValue(element, value) {
  if (!element) return;

  element.value = value == null
    ? ''
    : String(value);
}


// ========================================
// NORMALIZE TAGS
// ========================================

function normalizeTags(value) {
  let tags = [];

  if (Array.isArray(value)) {
    tags = value;
  } else if (typeof value === 'string') {
    tags = value.split(',');
  }

  const normalized = tags
    .map(tag => String(tag ?? '').trim())
    .filter(Boolean);

  return [...new Set(
    normalized.map(tag => tag.toLowerCase())
  )].map(normalizedTag => {
    return normalized.find(
      tag => tag.toLowerCase() === normalizedTag
    ) || normalizedTag;
  });
}


// ========================================
// GET DESCRIPTION DATA
// ========================================

export function getProductDescriptionData() {
  const elements = getElements();

  return {
    shortDescription: getValue(elements.shortDescription),
    description: getValue(elements.description),
    fabricType: getValue(elements.fabricType),
    fit: getValue(elements.fit),
    sleeveType: getValue(elements.sleeveType),
    washCare: getValue(elements.washCare),
    tags: normalizeTags(
      getValue(elements.tags)
    )
  };
}


// ========================================
// SET DESCRIPTION DATA
// EDIT PRODUCT / AI GENERATED DATA
// ========================================

export function setProductDescriptionData(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    data = {};
  }

  const elements = getElements();

  setValue(
    elements.shortDescription,
    data.shortDescription
  );

  setValue(
    elements.description,
    data.description
  );

  setValue(
    elements.fabricType,
    data.fabricType
  );

  setValue(
    elements.fit,
    data.fit
  );

  setValue(
    elements.sleeveType,
    data.sleeveType
  );

  setValue(
    elements.washCare,
    data.washCare
  );

  setValue(
    elements.tags,
    normalizeTags(data.tags).join(', ')
  );

  updateCharacterCounter(
    elements.shortDescription,
    getProductElement(SELECTORS.shortCounter),
    LIMITS.shortDescription
  );

  updateCharacterCounter(
    elements.description,
    getProductElement(SELECTORS.descriptionCounter),
    LIMITS.description
  );
}


// ========================================
// VALIDATE DESCRIPTION
// ========================================

export function validateProductDescription() {
  const elements = getElements();

  if (
    !elements.shortDescription ||
    !elements.description
  ) {
    showProductMessage(
      'Description form elements পাওয়া যায়নি।',
      'error'
    );

    return false;
  }

  const shortDescription = getValue(
    elements.shortDescription
  );

  const description = getValue(
    elements.description
  );

  if (shortDescription.length > LIMITS.shortDescription) {
    showProductMessage(
      `Short Description সর্বোচ্চ ${LIMITS.shortDescription} অক্ষর হতে পারবে।`,
      'warning'
    );

    elements.shortDescription.focus();

    return false;
  }

  if (description.length > LIMITS.description) {
    showProductMessage(
      `Description সর্বোচ্চ ${LIMITS.description} অক্ষর হতে পারবে।`,
      'warning'
    );

    elements.description.focus();

    return false;
  }

  return true;
}


// ========================================
// RESET DESCRIPTION
// ========================================

export function resetProductDescription() {
  const elements = getElements();

  Object.values(elements).forEach(element => {
    if (element) {
      element.value = '';
    }
  });

  updateCharacterCounter(
    elements.shortDescription,
    getProductElement(SELECTORS.shortCounter),
    LIMITS.shortDescription
  );

  updateCharacterCounter(
    elements.description,
    getProductElement(SELECTORS.descriptionCounter),
    LIMITS.description
  );
}


// ========================================
// CHARACTER COUNTER
// ========================================

function updateCharacterCounter(element, counter, maxLength) {
  if (!element || !counter) return;

  counter.textContent =
    `${element.value.length} / ${maxLength}`;
}


// ========================================
// BIND SINGLE INPUT EVENT
// ========================================

function bindCounterEvent(element, counter, maxLength) {
  if (!element) return;

  if (element.dataset.descriptionCounterBound === 'true') {
    return;
  }

  element.addEventListener('input', () => {
    updateCharacterCounter(
      element,
      counter,
      maxLength
    );
  });

  element.dataset.descriptionCounterBound = 'true';
}


// ========================================
// BIND EVENTS
// ========================================

function bindDescriptionEvents() {
  const elements = getElements();

  const shortCounter = getProductElement(
    SELECTORS.shortCounter
  );

  const descriptionCounter = getProductElement(
    SELECTORS.descriptionCounter
  );

  bindCounterEvent(
    elements.shortDescription,
    shortCounter,
    LIMITS.shortDescription
  );

  bindCounterEvent(
    elements.description,
    descriptionCounter,
    LIMITS.description
  );
}


// ========================================
// INITIALIZE
// ========================================

export function initProductDescription({ force = false } = {}) {
  if (initialized && !force) return;

  const elements = getElements();

  if (!elements.shortDescription || !elements.description) {
    console.warn(
      '[PRODUCT DESCRIPTION] Required elements not found.'
    );

    return;
  }

  bindDescriptionEvents();

  updateCharacterCounter(
    elements.shortDescription,
    getProductElement(SELECTORS.shortCounter),
    LIMITS.shortDescription
  );

  updateCharacterCounter(
    elements.description,
    getProductElement(SELECTORS.descriptionCounter),
    LIMITS.description
  );

  initialized = true;
}


// ========================================
// DEFAULT EXPORT
// ========================================

export default initProductDescription;
