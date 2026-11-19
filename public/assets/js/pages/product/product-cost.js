
'use strict';

// ========================================
// PRODUCT COST
// Private Purchase Cost Management
// ========================================

import {
  getProductElement,
  showProductMessage,
  productApiRequest
} from './product-utils.js';

const LIMITS = {
  supplier: 150,
  purchaseNote: 1000
};

const SELECTORS = {
  buyPrice: '#product-buy-price',
  supplier: '#product-supplier',
  purchaseNote: '#product-purchase-note',
  container: '#product-cost-container'
};


// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    buyPrice: getProductElement(SELECTORS.buyPrice),
    supplier: getProductElement(SELECTORS.supplier),
    purchaseNote: getProductElement(SELECTORS.purchaseNote),
    container: getProductElement(SELECTORS.container)
  };
}


// ========================================
// NORMALIZE DATA
// ========================================

function normalizeCostData(data = {}) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    data = {};
  }

  return {
    buyPrice: data.buyPrice ?? 0,
    supplier: String(data.supplier ?? '').trim(),
    purchaseNote: String(data.purchaseNote ?? '').trim()
  };
}


// ========================================
// GET COST DATA
// ========================================

export function getProductCostData() {
  const elements = getElements();

  const rawBuyPrice = String(
    elements.buyPrice?.value ?? ''
  ).trim();

  return {
    buyPrice: rawBuyPrice === ''
      ? 0
      : Number(rawBuyPrice),

    supplier: String(
      elements.supplier?.value ?? ''
    ).trim(),

    purchaseNote: String(
      elements.purchaseNote?.value ?? ''
    ).trim()
  };
}


// ========================================
// SET COST DATA
// ========================================

export function setProductCostData(data = {}) {
  const elements = getElements();
  const cost = normalizeCostData(data);

  if (elements.buyPrice) {
    elements.buyPrice.value = cost.buyPrice;
  }

  if (elements.supplier) {
    elements.supplier.value = cost.supplier;
  }

  if (elements.purchaseNote) {
    elements.purchaseNote.value = cost.purchaseNote;
  }
}


// ========================================
// VALIDATE COST
// ========================================

export function validateProductCost() {
  const elements = getElements();
  const cost = getProductCostData();

  if (
    !Number.isFinite(cost.buyPrice) ||
    cost.buyPrice < 0
  ) {
    showProductMessage(
      'Purchase Cost সঠিকভাবে লিখুন।',
      'warning'
    );

    elements.buyPrice?.focus();

    return false;
  }

  if (cost.supplier.length > LIMITS.supplier) {
    showProductMessage(
      `Supplier সর্বোচ্চ ${LIMITS.supplier} অক্ষরের হতে পারবে।`,
      'warning'
    );

    elements.supplier?.focus();

    return false;
  }

  if (
    cost.purchaseNote.length >
    LIMITS.purchaseNote
  ) {
    showProductMessage(
      `Purchase Note সর্বোচ্চ ${LIMITS.purchaseNote} অক্ষরের হতে পারবে।`,
      'warning'
    );

    elements.purchaseNote?.focus();

    return false;
  }

  return true;
}


// ========================================
// BUILD API URL
// ========================================

function getCostApiUrl(productId) {
  const id = String(productId ?? '').trim();

  if (!id) {
    throw new Error('Product ID পাওয়া যায়নি।');
  }

  return `/api/products/${encodeURIComponent(id)}/costs`;
}


// ========================================
// LOAD PRIVATE COST
// ========================================

export async function loadProductCost(productId) {
  if (!productId) {
    resetProductCost();
    return false;
  }

  // Prevent previous product data from remaining visible.
  resetProductCost();

  try {
    const result = await productApiRequest(
      getCostApiUrl(productId)
    );

    setProductCostData(result.data || {});

    return true;

  } catch (error) {
    console.error('[PRODUCT COST] Load failed:', error);

    showProductMessage(
      error.message ||
      'Private Product Cost load করা যায়নি।',
      'error'
    );

    return false;
  }
}


// ========================================
// SAVE PRIVATE COST
// ========================================

export async function saveProductCost(productId) {
  if (!productId) {
    showProductMessage(
      'Product ID পাওয়া যায়নি।',
      'error'
    );

    return false;
  }

  if (!validateProductCost()) {
    return false;
  }

  try {
    const cost = getProductCostData();

    await productApiRequest(
      getCostApiUrl(productId),
      {
        method: 'PUT',
        body: JSON.stringify(cost)
      }
    );

    showProductMessage(
      'Private Cost সফলভাবে Save হয়েছে।',
      'success'
    );

    return true;

  } catch (error) {
    console.error('[PRODUCT COST] Save failed:', error);

    showProductMessage(
      error.message ||
      'Private Cost Save করা যায়নি।',
      'error'
    );

    return false;
  }
}


// ========================================
// RESET COST
// ========================================

export function resetProductCost() {
  const elements = getElements();

  if (elements.buyPrice) {
    elements.buyPrice.value = '';
  }

  if (elements.supplier) {
    elements.supplier.value = '';
  }

  if (elements.purchaseNote) {
    elements.purchaseNote.value = '';
  }
}


// ========================================
// INITIALIZE
// ========================================

export function initProductCost() {
  const elements = getElements();

  if (!elements.container) {
    console.warn(
      '[PRODUCT COST] Container not found.'
    );

    return false;
  }

  return true;
}


export default initProductCost;
