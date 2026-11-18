'use strict';

// Inventory is calculated from variants when variants exist. Without
// variants, Total Stock and Low Stock Variants remain manually editable.

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

let inventoryData = {
  manualTotalStock: 0,
  manualLowStockCount: 0,
  totalStock: 0,
  lowStockCount: 0,
  stockStatus: false,
  variants: []
};

let initialized = false;

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
  return Number.isFinite(number)
    ? Math.max(0, Math.floor(number))
    : 0;
}

function normalizeVariants(variants = []) {
  return Array.isArray(variants)
    ? variants.map(variant => ({
        color: String(variant?.color || ''),
        size: String(variant?.size || ''),
        stock: toNonNegativeInteger(variant?.stock),
        lowStockAlert: toNonNegativeInteger(variant?.lowStockAlert)
      }))
    : [];
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

export function validateProductInventory() {
  calculateInventory();

  if (!Number.isSafeInteger(inventoryData.totalStock)) {
    showProductMessage('Total Stock পূর্ণসংখ্যা হতে হবে।', 'warning');
    return false;
  }

  if (!Number.isSafeInteger(inventoryData.lowStockCount)) {
    showProductMessage('Low Stock Variants পূর্ণসংখ্যা হতে হবে।', 'warning');
    return false;
  }

  return true;
}

export function resetProductInventory() {
  inventoryData = {
    manualTotalStock: 0,
    manualLowStockCount: 0,
    totalStock: 0,
    lowStockCount: 0,
    stockStatus: false,
    variants: []
  };

  renderInventorySummary();
}

function handleVariantsChanged(event) {
  setProductInventoryVariants(event.detail?.variants || []);
}

function bindEvents() {
  const elements = getElements();

  if (elements.container?.dataset.inventoryEventsBound !== 'true') {
    elements.totalStock?.addEventListener('input', () => {
      if (inventoryData.variants.length) return;
      inventoryData.manualTotalStock = toNonNegativeInteger(
        elements.totalStock.value
      );
      renderInventorySummary();
    });

    elements.lowStockCount?.addEventListener('input', () => {
      if (inventoryData.variants.length) return;
      inventoryData.manualLowStockCount = toNonNegativeInteger(
        elements.lowStockCount.value
      );
      renderInventorySummary();
    });

    if (elements.container) {
      elements.container.dataset.inventoryEventsBound = 'true';
    }
  }

  document.removeEventListener(
    'product:variants-changed',
    handleVariantsChanged
  );
  document.addEventListener(
    'product:variants-changed',
    handleVariantsChanged
  );
}

export function initProductInventory({ force = false } = {}) {
  if (initialized && !force) return;

  const { container } = getElements();

  if (!container) {
    console.warn('[PRODUCT INVENTORY] Inventory container not found.');
    return;
  }

  bindEvents();
  initialized = true;
  renderInventorySummary();
}

export function cleanupProductInventory() {
  document.removeEventListener(
    'product:variants-changed',
    handleVariantsChanged
  );
  initialized = false;
}

export default initProductInventory;
