'use strict';

// Purchase quantity entry for the Product's existing variants.
// The Purchase Lot form does not create or remove Product variants.

import {
  getProductElement,
  showProductMessage,
  escapeProductHTML
} from '../product-utils.js';
import { getProductVariantsData } from '../product-variants.js';
import { getProductCostData } from '../product-cost.js';
import { getProductInventoryData } from '../product-inventory.js';

const SELECTORS = {
  container: '#lot-variants-container',
  totalQuantity: '#lot-total-quantity',
  modal: '#lot-create-modal'
};

let initialized = false;
let stockLines = [];

function getElements() {
  return {
    container: getProductElement(SELECTORS.container),
    totalQuantity: getProductElement(SELECTORS.totalQuantity),
    modal: getProductElement(SELECTORS.modal)
  };
}

function roundMoney(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) return 0;

  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function toInputMoney(value) {
  return roundMoney(value).toFixed(2);
}

function normalizeQuantity(value) {
  const quantity = Number(value || 0);
  return Number.isFinite(quantity) ? quantity : 0;
}

function normalizeBuyRate(value) {
  const buyRate = Number(value || 0);
  return Number.isFinite(buyRate) ? buyRate : 0;
}

function createStockLine(data = {}, baseBuyPrice = 0) {
  const currentAverageRate =
    data.currentAverageBuyRate ??
    data.averageBuyRate ??
    data.averageBuyPrice ??
    data.avgBuyRate ??
    data.buyPrice;
  const currentAverageBuyRate =
    currentAverageRate === '' || currentAverageRate == null
    ? Number(baseBuyPrice || 0)
    : Number(currentAverageRate);
  const newStockBuyRate =
    data.newStockBuyRate ??
    data.newBuyPrice ??
    currentAverageBuyRate;

  return {
    variantId: String(data.variantId || data.id || ''),
    sku: String(data.sku || data.variantSku || ''),
    color: String(data.color || ''),
    size: String(data.size || ''),
    currentAverageBuyRate: Number.isFinite(currentAverageBuyRate)
      ? currentAverageBuyRate
      : 0,
    buyPrice: Number.isFinite(Number(newStockBuyRate))
      ? Number(newStockBuyRate)
      : 0,
    currentStock: Math.max(
      0,
      normalizeQuantity(data.currentStock ?? data.stock ?? 0)
    ),
    quantity: normalizeQuantity(
      data.addQuantity ?? data.quantity ?? 0
    ),
    isDefault: data.isDefault === true
  };
}

function getProductStockLines() {
  const productBuyPrice = Number(getProductCostData().buyPrice || 0);
  const allProductVariants = getProductVariantsData();
  const activeProductVariants = allProductVariants.filter(
    variant => variant.isActive !== false
  );
  const productVariants = activeProductVariants.length
    ? activeProductVariants
    : allProductVariants;

  if (!productVariants.length) {
    const inventory = getProductInventoryData();

    return [createStockLine({
      isDefault: true,
      stock: inventory.totalStock
    }, productBuyPrice)];
  }

  return productVariants.map(variant => (
    createStockLine(variant, productBuyPrice)
  ));
}

function syncRowsToState() {
  const { container } = getElements();
  if (!container) return;

  const rows = Array.from(
    container.querySelectorAll('.lot-stock-row')
  );

  rows.forEach((row, index) => {
    if (!stockLines[index]) return;

    stockLines[index].buyPrice = normalizeBuyRate(
      row.querySelector('.lot-stock-buy-price')?.value
    );
    stockLines[index].quantity = normalizeQuantity(
      row.querySelector('.lot-stock-quantity')?.value
    );
  });
}

export function getLotTotalQuantity() {
  syncRowsToState();

  return stockLines.reduce((total, line) => (
    total + Math.max(0, normalizeQuantity(line.quantity))
  ), 0);
}

export function getLotPurchaseCost() {
  syncRowsToState();

  return roundMoney(stockLines.reduce((total, line) => (
    total + (
      Math.max(0, normalizeQuantity(line.quantity)) *
      Math.max(0, Number(line.buyPrice) || 0)
    )
  ), 0));
}

function updateSummary() {
  const { totalQuantity } = getElements();
  const quantity = getLotTotalQuantity();
  const purchaseCost = getLotPurchaseCost();

  if (totalQuantity) {
    if ('value' in totalQuantity) {
      totalQuantity.value = String(quantity);
    } else {
      totalQuantity.textContent = String(quantity);
    }
  }

  document.dispatchEvent(
    new CustomEvent('product:lot-quantity-changed', {
      detail: {
        totalQuantity: quantity,
        purchaseCost
      }
    })
  );
}

function getLineName(line) {
  if (line.isDefault) return 'Product';

  return [line.color, line.size]
    .filter(Boolean)
    .join(' / ') || line.sku || 'Product variant';
}

function createStockRow(line) {
  const row = document.createElement('div');
  const lineCost = roundMoney(line.buyPrice * line.quantity);

  row.className = 'lot-variant-row lot-stock-row';
  row.innerHTML = `
    <div class="lot-stock-identity">
      <span>Product / Variant</span>
      <strong>${escapeProductHTML(getLineName(line))}</strong>
      ${line.sku ? `<small>${escapeProductHTML(line.sku)}</small>` : ''}
    </div>

    <div class="lot-current-stock" aria-label="Current Stock">
      <span>Current Stock</span>
      <strong>${line.currentStock}</strong>
    </div>

    <div class="lot-current-stock lot-current-buy-rate"
      aria-label="Current Average Buy Rate">
      <span>Average Rate</span>
      <strong>${toInputMoney(line.currentAverageBuyRate)}</strong>
    </div>

    <div class="form-group">
      <label>New Stock Buy Rate</label>
      <input
        type="number"
        class="lot-stock-buy-price"
        value="${toInputMoney(line.buyPrice)}"
        min="0"
        step="0.01"
      >
    </div>

    <div class="form-group">
      <label>New Stock Qty</label>
      <input
        type="number"
        class="lot-stock-quantity"
        value="${line.quantity > 0 ? line.quantity : ''}"
        min="0"
        step="1"
        placeholder="0"
      >
    </div>

    <div class="form-group">
      <label>Purchase Cost</label>
      <input
        type="number"
        class="lot-stock-line-cost"
        value="${toInputMoney(lineCost)}"
        min="0"
        step="0.01"
        readonly
      >
    </div>
  `;

  return row;
}

export function renderLotVariants() {
  const { container } = getElements();
  if (!container) return;

  container.replaceChildren(
    ...stockLines.map(createStockRow)
  );

  updateSummary();
}

export function getLotVariantsData() {
  syncRowsToState();

  return stockLines
    .filter(line => normalizeQuantity(line.quantity) > 0)
    .map(line => ({
      variantId: line.variantId,
      sku: line.sku,
      color: line.color,
      size: line.size,
      quantity: normalizeQuantity(line.quantity),
      buyPrice: roundMoney(line.buyPrice)
    }));
}

export function setLotVariantsData(data = []) {
  if (!Array.isArray(data)) {
    showProductMessage('Lot stock data সঠিক নয়।', 'error');
    return false;
  }

  const productBuyPrice = Number(getProductCostData().buyPrice || 0);
  stockLines = data.length
    ? data.map(item => createStockLine(item, productBuyPrice))
    : getProductStockLines();

  renderLotVariants();
  return true;
}

export function validateLotVariants() {
  syncRowsToState();

  const selectedLines = stockLines.filter(
    line => normalizeQuantity(line.quantity) > 0
  );

  if (!selectedLines.length) {
    showProductMessage(
      'কমপক্ষে ১টি Purchase Quantity দিন।',
      'warning'
    );
    return false;
  }

  for (const line of selectedLines) {
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity <= 0
    ) {
      showProductMessage(
        'Purchase Quantity অবশ্যই ১ বা তার বেশি পূর্ণসংখ্যা হতে হবে।',
        'warning'
      );
      return false;
    }

    if (!Number.isFinite(line.buyPrice) || line.buyPrice < 0) {
      showProductMessage(
        'New Stock Buy Rate সঠিক নয়।',
        'warning'
      );
      return false;
    }
  }

  return true;
}

export function resetLotVariants() {
  stockLines = getProductStockLines();

  renderLotVariants();
}

function handleStockInput(event) {
  const input = event.target.closest(
    '.lot-stock-buy-price, .lot-stock-quantity'
  );
  if (!input) return;

  const row = input.closest('.lot-stock-row');
  const rows = Array.from(
    getElements().container?.querySelectorAll('.lot-stock-row') || []
  );
  const index = rows.indexOf(row);

  if (index < 0 || !stockLines[index]) return;

  stockLines[index].buyPrice = normalizeBuyRate(
    row.querySelector('.lot-stock-buy-price')?.value
  );
  stockLines[index].quantity = normalizeQuantity(
    row.querySelector('.lot-stock-quantity')?.value
  );

  const lineCost = row.querySelector('.lot-stock-line-cost');
  if (lineCost) {
    lineCost.value = toInputMoney(
      stockLines[index].buyPrice * stockLines[index].quantity
    );
  }

  updateSummary();
}

function handleProductVariantsChanged() {
  const { modal } = getElements();

  if (modal && !modal.hidden) return;
  resetLotVariants();
}

function bindEvents() {
  const { container } = getElements();

  if (container && container.dataset.stockQuantityBound !== 'true') {
    container.addEventListener('input', handleStockInput);
    container.dataset.stockQuantityBound = 'true';
  }

  document.removeEventListener(
    'product:variants-changed',
    handleProductVariantsChanged
  );
  document.addEventListener(
    'product:variants-changed',
    handleProductVariantsChanged
  );
}

export function initLotVariants({ force = false } = {}) {
  if (initialized && !force) return;

  const { container } = getElements();
  if (!container) return;

  bindEvents();
  initialized = true;
  resetLotVariants();
}

export default initLotVariants;
