
'use strict';

// ========================================
// PRODUCT FLAGS
// Featured, New Arrival & Best Seller
// ========================================

import {
  getProductElement,
  showProductMessage
} from './product-utils.js';

const SELECTORS = {
  isNewArrival: '#product-is-new-arrival',
  isFeatured: '#product-is-featured',
  isBestSeller: '#product-is-best-seller'
};

// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    isNewArrival: getProductElement(SELECTORS.isNewArrival),
    isFeatured: getProductElement(SELECTORS.isFeatured),
    isBestSeller: getProductElement(SELECTORS.isBestSeller)
  };
}

// ========================================
// CHECK ELEMENTS
// ========================================

function isValidCheckbox(element) {
  return (
    element &&
    element.type === 'checkbox' &&
    typeof element.checked === 'boolean'
  );
}

// ========================================
// GET FLAGS DATA
// ========================================

export function getProductFlagsData() {
  const elements = getElements();

  return {
    isNewArrival: elements.isNewArrival?.checked === true,
    isFeatured: elements.isFeatured?.checked === true,
    isBestSeller: elements.isBestSeller?.checked === true
  };
}

// ========================================
// SET FLAGS DATA
// ========================================

export function setProductFlagsData(data = {}) {
  const elements = getElements();

  const flags =
    data && typeof data === 'object' && !Array.isArray(data)
      ? data
      : {};

  if (isValidCheckbox(elements.isNewArrival)) {
    elements.isNewArrival.checked =
      flags.isNewArrival === true;
  }

  if (isValidCheckbox(elements.isFeatured)) {
    elements.isFeatured.checked =
      flags.isFeatured === true;
  }

  if (isValidCheckbox(elements.isBestSeller)) {
    elements.isBestSeller.checked =
      flags.isBestSeller === true;
  }
}

// ========================================
// VALIDATE FLAGS
// ========================================

export function validateProductFlags() {
  const elements = getElements();

  const missing = Object.entries(elements)
    .filter(([, element]) => !isValidCheckbox(element))
    .map(([key]) => key);

  if (missing.length > 0) {
    console.error('[PRODUCT FLAGS] Missing or invalid checkbox elements:', missing);

    showProductMessage(
      'Product Flags form elements পাওয়া যায়নি।',
      'error'
    );

    return false;
  }

  return true;
}

// ========================================
// RESET FLAGS
// ========================================

export function resetProductFlags() {
  const elements = getElements();

  Object.values(elements).forEach(element => {
    if (isValidCheckbox(element)) {
      element.checked = false;
    }
  });
}

// ========================================
// INITIALIZE
// ========================================

export function initProductFlags() {
  return validateProductFlags();
}

export default initProductFlags;
