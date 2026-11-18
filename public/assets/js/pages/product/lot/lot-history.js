'use strict';

// Purchase Lot cost summary.
// Purchase Cost is calculated from Product/Variant buy price × quantity.

import {
  getProductElement,
  showProductMessage
} from '../product-utils.js';

const SELECTORS = {
  purchaseCost: '#lot-purchase-cost',
  transportCost: '#lot-transport-cost',
  otherCost: '#lot-other-cost',
  totalCost: '#lot-total-cost'
};

let initialized = false;

let costData = {
  purchaseCost: 0,
  transportCost: 0,
  otherCost: 0
};

function getElements() {
  return {
    purchaseCost: getProductElement(SELECTORS.purchaseCost),
    transportCost: getProductElement(SELECTORS.transportCost),
    otherCost: getProductElement(SELECTORS.otherCost),
    totalCost: getProductElement(SELECTORS.totalCost)
  };
}

function roundMoney(value) {
  const number = Number(value || 0);

  if (!Number.isFinite(number)) return 0;

  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function parseNumberInput(value, fallback = 0) {
  const normalized = String(value ?? '')
    .replace(/,/g, '')
    .trim();
  const number = Number(normalized || 0);

  return Number.isFinite(number) ? number : fallback;
}

function toInputMoney(value) {
  return roundMoney(value).toFixed(2);
}

function readInput(input) {
  return input ? parseNumberInput(input.value, 0) : 0;
}

function collectCostData() {
  const elements = getElements();

  costData = {
    purchaseCost: readInput(elements.purchaseCost),
    transportCost: readInput(elements.transportCost),
    otherCost: readInput(elements.otherCost)
  };

  return { ...costData };
}

export function getLotTotalCost() {
  const data = collectCostData();

  return roundMoney(
    data.purchaseCost +
    data.transportCost +
    data.otherCost
  );
}

export function updateLotCostSummary() {
  const elements = getElements();
  const data = collectCostData();
  const totalCost = roundMoney(
    data.purchaseCost +
    data.transportCost +
    data.otherCost
  );

  if (elements.totalCost) {
    // Number inputs require an unformatted numeric string (no commas).
    elements.totalCost.value = toInputMoney(totalCost);
  }

  return {
    ...data,
    totalCost
  };
}

export function getLotCostData() {
  return updateLotCostSummary();
}

export function setLotCostData(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    showProductMessage('Lot Cost Data সঠিক নয়।', 'error');
    return false;
  }

  const elements = getElements();

  if (elements.purchaseCost) {
    elements.purchaseCost.value = toInputMoney(
      parseNumberInput(data.purchaseCost, 0)
    );
  }

  if (elements.transportCost) {
    elements.transportCost.value = data.transportCost == null
      ? ''
      : String(parseNumberInput(data.transportCost, 0));
  }

  if (elements.otherCost) {
    elements.otherCost.value = data.otherCost == null
      ? ''
      : String(parseNumberInput(data.otherCost, 0));
  }

  updateLotCostSummary();
  return true;
}

export function validateLotCost() {
  const data = collectCostData();

  for (const [label, value] of [
    ['Purchase Cost', data.purchaseCost],
    ['Transport Cost', data.transportCost],
    ['Other Cost', data.otherCost]
  ]) {
    if (!Number.isFinite(value) || value < 0) {
      showProductMessage(`${label} সঠিকভাবে লিখুন।`, 'warning');
      return false;
    }
  }

  if (data.purchaseCost <= 0) {
    showProductMessage(
      'Product বা Variant Purchase Cost আগে সঠিকভাবে দিন।',
      'warning'
    );
    return false;
  }

  return true;
}

export function resetLotCost() {
  const elements = getElements();

  if (elements.purchaseCost) elements.purchaseCost.value = '0.00';
  if (elements.transportCost) elements.transportCost.value = '';
  if (elements.otherCost) elements.otherCost.value = '';
  if (elements.totalCost) elements.totalCost.value = '0.00';

  costData = {
    purchaseCost: 0,
    transportCost: 0,
    otherCost: 0
  };
}

function handleLotQuantityChanged(event) {
  const { purchaseCost } = getElements();

  if (purchaseCost) {
    purchaseCost.value = toInputMoney(
      parseNumberInput(event.detail?.purchaseCost, 0)
    );
  }

  updateLotCostSummary();
}

function bindEvents() {
  const elements = getElements();

  [elements.transportCost, elements.otherCost].forEach(input => {
    if (!input || input.dataset.lotCostBound === 'true') return;

    input.addEventListener('input', updateLotCostSummary);
    input.dataset.lotCostBound = 'true';
  });

  document.removeEventListener(
    'product:lot-quantity-changed',
    handleLotQuantityChanged
  );
  document.addEventListener(
    'product:lot-quantity-changed',
    handleLotQuantityChanged
  );
}

export function initLotCost({ force = false } = {}) {
  if (initialized && !force) return;

  const elements = getElements();
  if (!elements.purchaseCost) return;

  bindEvents();
  initialized = true;
  updateLotCostSummary();
}

export default initLotCost;
