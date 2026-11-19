
'use strict';

// Inventory is calculated from variants when variants exist.
// Without variants, Total Stock and Low Stock Variants remain manually editable.

import {
  getProductElement,
  showProductMessage
} from './product-utils.js';

const SELECTORS = {
  container: '#product-inventory-container',
  totalStock: '#product-total-stock',
  lowStockCount: '#product-low-stock-count',
  stockStatus: '#product-stock-status'
};

function createEmptyInventory() {
  return {
    manualTotalStock: 0,
    manualLowStockCount: 0,
    totalStock: 0,
    lowStockCount: 0,
    stockStatus: false,
    variants: []
  };
}

let inventoryData = createEmptyInventory();
let initialized = false;
let boundElements = null;

function getElements() {
  return {
    container: getProductElement(SELECTORS.container),
    totalStock: getProductElement(SELECTORS.totalStock),
    lowStockCount: getProductElement(SELECTORS.lowStockCount),
    stockStatus: getProductElement(SELECTORS.stockStatus)
  };
}

function toNonNegativeInteger(value) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(0, Math.floor(number));
}

function normalizeVariants(variants = []) {
  if (!Array.isArray(variants)) {
    return [];
  }

  return variants.map(variant => ({
    color: String(variant?.color || ''),
    size: String(variant?.size || ''),
    stock: toNonNegativeInteger(variant?.stock),
    lowStockAlert: toNonNegativeInteger(variant?.lowStockAlert)
  }));
}

export function getProductStockStatus(totalStock) {
  return toNonNegativeInteger(totalStock) > 0;
}

function calculateInventory() {
  const hasVariants = inventoryData.variants.length > 0;

  if (hasVariants) {
    inventoryData.totalStock = inventoryData.variants.reduce(
      (sum, variant) => sum + variant.stock,
      0
    );

    inventoryData.lowStockCount = inventoryData.variants.filter(
      variant =>
        variant.lowStockAlert > 0 &&
        variant.stock <= variant.lowStockAlert
    ).length;
  } else {
    inventoryData.totalStock = inventoryData.manualTotalStock;
    inventoryData.lowStockCount = inventoryData.manualLowStockCount;
  }

  inventoryData.stockStatus = getProductStockStatus(
    inventoryData.totalStock
  );
}

function renderInventorySummary() {
  calculateInventory();

  const elements = getElements();
  const hasVariants = inventoryData.variants.length > 0;

  if (elements.totalStock) {
    elements.totalStock.value = String(inventoryData.totalStock);
    elements.totalStock.readOnly = hasVariants;
    elements.totalStock.title = hasVariants
      ? 'Variant stock থেকে স্বয়ংক্রিয়ভাবে হিসাব করা হয়েছে।'
      : 'Variant না থাকায় stock manually দেওয়া যাবে।';
  }

  if (elements.lowStockCount) {
    elements.lowStockCount.value = String(inventoryData.lowStockCount);
    elements.lowStockCount.readOnly = hasVariants;
    elements.lowStockCount.title = hasVariants
      ? 'Variant low-stock alert থেকে স্বয়ংক্রিয়ভাবে হিসাব করা হয়েছে।'
      : 'Variant না থাকায় manually দেওয়া যাবে।';
  }

  if (elements.stockStatus) {
    elements.stockStatus.value = inventoryData.stockStatus
      ? 'true'
      : 'false';

    elements.stockStatus.readOnly = true;
  }
}

// ========================================
// DATA
// ========================================

export function setProductInventoryData(data = {}) {
  inventoryData.manualTotalStock = toNonNegativeInteger(
    data.manualTotalStock ?? data.totalStock
  );

  inventoryData.manualLowStockCount = toNonNegativeInteger(
    data.manualLowStockCount ?? data.lowStockCount
  );

  inventoryData.variants = normalizeVariants(data.variants);

  renderInventorySummary();
}

export function setProductInventoryVariants(variants = []) {
  inventoryData.variants = normalizeVariants(variants);

  renderInventorySummary();
}

export function getProductInventoryData() {
  calculateInventory();

  return {
    totalStock: inventoryData.totalStock,
    lowStockCount: inventoryData.lowStockCount,
    stockStatus: inventoryData.stockStatus,
    hasStock: inventoryData.stockStatus,
    hasVariants: inventoryData.variants.length > 0,
    variants: inventoryData.variants.map(item => ({ ...item }))
  };
}

// ========================================
// VALIDATION
// ========================================

export function validateProductInventory() {
  calculateInventory();

  if (
    !Number.isSafeInteger(inventoryData.totalStock) ||
    inventoryData.totalStock < 0
  ) {
    showProductMessage(
      'Total Stock একটি নিরাপদ non-negative পূর্ণসংখ্যা হতে হবে।',
      'warning'
    );

    return false;
  }

  if (
    !Number.isSafeInteger(inventoryData.lowStockCount) ||
    inventoryData.lowStockCount < 0
  ) {
    showProductMessage(
      'Low Stock Variants একটি non-negative পূর্ণসংখ্যা হতে হবে।',
      'warning'
    );

    return false;
  }

  for (const variant of inventoryData.variants) {
    if (
      !Number.isSafeInteger(variant.stock) ||
      variant.stock < 0 ||
      !Number.isSafeInteger(variant.lowStockAlert) ||
      variant.lowStockAlert < 0
    ) {
      showProductMessage(
        'প্রতিটি variant-এর stock এবং low-stock alert সঠিক পূর্ণসংখ্যা হতে হবে।',
        'warning'
      );

      return false;
    }
  }

  return true;
}

// ========================================
// RESET
// ========================================

export function resetProductInventory() {
  inventoryData = createEmptyInventory();

  renderInventorySummary();
}

// ========================================
// EVENTS
// ========================================

function handleTotalStockInput() {
  if (!boundElements?.totalStock) return;
  if (inventoryData.variants.length > 0) return;

  inventoryData.manualTotalStock = toNonNegativeInteger(
    boundElements.totalStock.value
  );

  renderInventorySummary();
}

function handleLowStockCountInput() {
  if (!boundElements?.lowStockCount) return;
  if (inventoryData.variants.length > 0) return;

  inventoryData.manualLowStockCount = toNonNegativeInteger(
    boundElements.lowStockCount.value
  );

  renderInventorySummary();
}

function handleVariantsChanged(event) {
  setProductInventoryVariants(
    event.detail?.variants || []
  );
}

function removeInputEvents() {
  if (!boundElements) return;

  boundElements.totalStock?.removeEventListener(
    'input',
    handleTotalStockInput
  );

  boundElements.lowStockCount?.removeEventListener(
    'input',
    handleLowStockCountInput
  );

  boundElements = null;
}

function bindEvents() {
  removeInputEvents();

  boundElements = getElements();

  boundElements.totalStock?.addEventListener(
    'input',
    handleTotalStockInput
  );

  boundElements.lowStockCount?.addEventListener(
    'input',
    handleLowStockCountInput
  );

  document.removeEventListener(
    'product:variants-changed',
    handleVariantsChanged
  );

  document.addEventListener(
    'product:variants-changed',
    handleVariantsChanged
  );
}

// ========================================
// INIT
// ========================================

export function initProductInventory({ force = false } = {}) {
  if (initialized && !force) {
    return;
  }

  const { container } = getElements();

  if (!container) {
    console.warn(
      '[PRODUCT INVENTORY] Inventory container not found.'
    );

    return;
  }

  bindEvents();

  initialized = true;

  renderInventorySummary();
}

// ========================================
// CLEANUP
// ========================================

export function cleanupProductInventory() {
  removeInputEvents();

  document.removeEventListener(
    'product:variants-changed',
    handleVariantsChanged
  );

  initialized = false;
}

export default initProductInventory;
