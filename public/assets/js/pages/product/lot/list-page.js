'use strict';

import { navigateTo } from '../../index.js';
import { productApiRequest } from '../product-utils.js';

const API_URL = '/api/lots';

let pageRoot = null;
let allLots = [];
let allProducts = [];
let currentSignal = null;
let selectedLotId = '';
let isLoadingLots = false;
let isCreatingLot = false;
let isDeletingLot = false;
let isLoadingDetails = false;

function escapeHTML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function getValue(...values) {
  return values.find(value => (
    value !== undefined &&
    value !== null &&
    value !== ''
  ));
}

function toNumber(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value) {
  return toNumber(value).toLocaleString('en-BD');
}

function formatMoney(value) {
  return `৳${toNumber(value).toLocaleString('en-BD', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })}`;
}

function formatDate(value) {
  if (!value) return '—';

  const seconds = value?.seconds ?? value?._seconds;
  const date = seconds !== undefined
    ? new Date(Number(seconds) * 1000)
    : new Date(value);

  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en-BD', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  }).format(date);
}

function normalizeStatus(status) {
  return String(status || 'unknown')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function getStatusLabel(status) {
  const value = normalizeStatus(status);
  const labels = {
    active: 'Active',
    available: 'Active',
    partial: 'Partially Sold',
    completed: 'Completed',
    depleted: 'Depleted',
    empty: 'Empty',
    inactive: 'Inactive',
    closed: 'Closed',
    cancelled: 'Cancelled',
    unknown: 'Unknown'
  };

  return labels[value] || status || 'Unknown';
}

function getStatusClass(status) {
  const value = normalizeStatus(status);

  if (['active', 'available'].includes(value)) return 'active';
  if (value === 'partial') return 'partial';
  if (['completed', 'depleted'].includes(value)) return 'depleted';
  if (['closed', 'cancelled'].includes(value)) return 'cancelled';
  if (value === 'empty') return 'empty';
  return 'unknown';
}

function showMessage(message, type = '') {
  const element = pageRoot?.querySelector('#lots-message');
  if (!element) return;

  element.textContent = String(message || '');
  element.className = `lots-message ${type}`.trim();
}

function setButtonLoading(button, loading, loadingText = 'Please wait...') {
  if (!button) return;

  if (loading) {
    if (!button.dataset.originalText) {
      button.dataset.originalText = button.textContent.trim();
    }
    button.disabled = true;
    button.textContent = loadingText;
    button.setAttribute('aria-busy', 'true');
    return;
  }

  button.disabled = false;
  button.textContent = button.dataset.originalText || button.textContent;
  delete button.dataset.originalText;
  button.removeAttribute('aria-busy');
}

function openModal(selector) {
  const modal = pageRoot?.querySelector(selector);
  if (!modal) return false;

  modal.hidden = false;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');
  return true;
}

function closeModal(selector) {
  const modal = pageRoot?.querySelector(selector);
  if (!modal) return;

  modal.classList.remove('is-open');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}

async function fetchLots(signal = currentSignal) {
  const result = await productApiRequest(API_URL, {
    method: 'GET',
    signal
  });

  const lots = Array.isArray(result?.lots)
    ? result.lots
    : Array.isArray(result?.data?.lots)
      ? result.data.lots
      : Array.isArray(result?.data)
        ? result.data
        : Array.isArray(result)
          ? result
          : null;

  if (!lots) throw new Error('Invalid lots API response.');
  return lots;
}

async function fetchProducts() {
  if (allProducts.length) return allProducts;

  const result = await productApiRequest('/api/products?limit=100', {
    method: 'GET',
    signal: currentSignal
  });
  const source = Array.isArray(result?.products)
    ? result.products
    : Array.isArray(result?.data?.products)
      ? result.data.products
      : [];

  allProducts = source
    .map(product => ({
      id: String(product.id || product.productId || ''),
      name: String(product.name || product.basic?.name || 'Unnamed Product'),
      sku: String(product.sku || product.basic?.sku || ''),
      totalStock: toNumber(
        product.summary?.totalStock ??
        product.totalStock ??
        product.inventory?.totalStock
      )
    }))
    .filter(product => product.id);

  return allProducts;
}

async function fetchLotDetails(lotId) {
  const result = await productApiRequest(
    `${API_URL}/${encodeURIComponent(lotId)}/analytics`,
    { method: 'GET', signal: currentSignal }
  );

  return result.analytics || result.data?.analytics || result.data || result;
}

function normalizeLot(lot = {}) {
  const productNames = Array.isArray(lot.productNames)
    ? lot.productNames.filter(Boolean).map(String)
    : [];
  const productCount = Math.max(0, toNumber(lot.productCount ?? productNames.length));
  const totalQuantity = Math.max(0, toNumber(
    lot.totalQuantity ?? lot.totalQty ?? lot.quantity
  ));
  const remainingQuantity = Math.max(0, toNumber(
    lot.remainingQuantity ?? lot.remainingQty ?? lot.availableQuantity
  ));

  return {
    id: String(getValue(lot.id, lot.lotId, lot.lotNumber, '')),
    lotNumber: String(getValue(lot.lotNumber, lot.lotNo, lot.id, '—')),
    lotName: String(getValue(lot.lotName, lot.name, lot.lotNumber, 'Purchase Lot')),
    productNames,
    productCount,
    productName: String(getValue(
      lot.productName,
      productNames.length > 1
        ? `${productNames[0]} +${productNames.length - 1} more`
        : productNames[0],
      productCount ? `${productCount} Products` : 'No Products'
    )),
    purchaseDate: getValue(lot.purchaseDate, lot.createdAt, lot.date),
    supplier: String(getValue(lot.supplier, lot.supplierName, '—')),
    totalQuantity,
    remainingQuantity,
    soldQuantity: Math.max(
      0,
      toNumber(lot.soldQuantity ?? totalQuantity - remainingQuantity)
    ),
    purchaseCost: Math.max(0, toNumber(lot.purchaseCost)),
    totalCost: Math.max(0, toNumber(
      lot.totalCost ?? lot.landedCost ?? lot.purchaseCost
    )),
    status: String(getValue(lot.status, 'unknown')),
    legacy: lot.legacy === true,
    canDelete: lot.legacy !== true && productCount === 0 && totalQuantity === 0
  };
}

function createPage() {
  const page = document.createElement('section');
  page.className = 'purchase-lots-page';
  page.innerHTML = `
    <div class="page-header">
      <div>
        <h1>Purchase Lots</h1>
        <p>Create Lots, add Products and review purchase, sales and profit/loss.</p>
      </div>
      <div class="purchase-lots-header-actions">
        <button type="button" class="btn btn-secondary" id="lots-refresh">Refresh</button>
        <button type="button" class="btn btn-primary" id="lots-create">+ New Lot</button>
      </div>
    </div>

    <div class="lots-filters">
      <input class="form-control" type="search" id="lots-search"
        placeholder="Search Lot, Product or Supplier..." autocomplete="off">
      <select class="form-control" id="lots-status-filter">
        <option value="all">All Statuses</option>
        <option value="active">Active</option>
        <option value="partial">Partially Sold</option>
        <option value="depleted">Depleted</option>
        <option value="empty">Empty</option>
        <option value="cancelled">Cancelled</option>
      </select>
    </div>

    <div class="lots-summary" id="lots-summary"></div>
    <div class="lots-message" id="lots-message" aria-live="polite"></div>

    <div class="table-responsive lots-table-wrapper">
      <table class="table lots-table purchase-lots-management-table">
        <thead>
          <tr>
            <th>Lot</th>
            <th>Products</th>
            <th>Purchase Date</th>
            <th>Total Cost</th>
            <th>Total Qty</th>
            <th>Sold</th>
            <th>Remaining</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="lots-table-body"></tbody>
      </table>
    </div>

    <div class="product-modal-overlay" id="purchase-lot-create-modal"
      hidden aria-hidden="true">
      <div class="product-modal purchase-lot-management-modal" role="dialog"
        aria-modal="true" aria-labelledby="purchase-lot-create-title">
        <div class="product-modal-header">
          <div>
            <h3 id="purchase-lot-create-title">Create New Purchase Lot</h3>
            <p>Create the Lot first, then add one or more Products.</p>
          </div>
          <button type="button" class="purchase-lot-modal-close"
            data-lots-action="close-create" aria-label="Close">×</button>
        </div>
        <form id="purchase-lot-create-form" class="purchase-lot-form">
          <div class="form-group purchase-lot-form-wide">
            <label for="purchase-lot-name">Lot Name</label>
            <input class="form-control" id="purchase-lot-name" maxlength="100"
              placeholder="Example: Eid Collection - 01" required>
          </div>
          <div class="form-group purchase-lot-form-wide">
            <label for="purchase-lot-supplier">Supplier</label>
            <input class="form-control" id="purchase-lot-supplier" maxlength="150"
              placeholder="Supplier name (optional)">
          </div>
          <div class="form-group">
            <label for="purchase-lot-purchase-cost">Base Purchase Cost</label>
            <input class="form-control" id="purchase-lot-purchase-cost"
              type="number" min="0" step="0.01" value="0">
          </div>
          <div class="form-group">
            <label for="purchase-lot-transport-cost">Transport Cost</label>
            <input class="form-control" id="purchase-lot-transport-cost"
              type="number" min="0" step="0.01" value="0">
          </div>
          <div class="form-group">
            <label for="purchase-lot-other-cost">Other Cost</label>
            <input class="form-control" id="purchase-lot-other-cost"
              type="number" min="0" step="0.01" value="0">
          </div>
          <div class="form-group purchase-lot-form-wide">
            <label for="purchase-lot-note">Note</label>
            <textarea class="form-control" id="purchase-lot-note" rows="3"
              maxlength="1000" placeholder="Optional note"></textarea>
          </div>
          <div class="product-modal-actions purchase-lot-form-wide">
            <button type="button" class="btn btn-secondary"
              data-lots-action="close-create">Cancel</button>
            <button type="submit" class="btn btn-primary" id="purchase-lot-create-submit">
              Create Lot
            </button>
          </div>
        </form>
      </div>
    </div>

    <div class="product-modal-overlay" id="purchase-lot-product-modal"
      hidden aria-hidden="true">
      <div class="product-modal purchase-lot-selector-modal" role="dialog"
        aria-modal="true" aria-labelledby="purchase-lot-product-title">
        <div class="product-modal-header">
          <div>
            <h3 id="purchase-lot-product-title">Add Product to Lot</h3>
            <p>Select a Product, then enter its stock quantity and buy rate.</p>
          </div>
          <button type="button" class="purchase-lot-modal-close"
            data-lots-action="close-product" aria-label="Close">×</button>
        </div>
        <div class="purchase-lot-selector-body">
          <div class="form-group">
            <label for="purchase-lot-product-select">Product</label>
            <select class="form-control" id="purchase-lot-product-select" required>
              <option value="">Select a Product</option>
            </select>
          </div>
          <div class="product-modal-actions">
            <button type="button" class="btn btn-secondary"
              data-lots-action="close-product">Cancel</button>
            <button type="button" class="btn btn-primary"
              id="purchase-lot-product-continue">Continue</button>
          </div>
        </div>
      </div>
    </div>

    <div class="product-modal-overlay" id="purchase-lot-details-modal"
      hidden aria-hidden="true">
      <div class="product-modal purchase-lot-details-modal" role="dialog"
        aria-modal="true" aria-labelledby="purchase-lot-details-title">
        <div class="product-modal-header">
          <div>
            <span class="product-view-eyebrow">Purchase Lot Report</span>
            <h3 id="purchase-lot-details-title">Lot Details</h3>
            <p id="purchase-lot-details-subtitle"></p>
          </div>
          <button type="button" class="purchase-lot-modal-close"
            data-lots-action="close-details" aria-label="Close">×</button>
        </div>
        <div id="purchase-lot-details-content" class="purchase-lot-details-content"></div>
        <div class="product-modal-actions purchase-lot-details-actions">
          <button type="button" class="btn btn-secondary"
            data-lots-action="close-details">Close</button>
          <button type="button" class="btn btn-primary"
            data-lots-action="details-add-product">+ Add Product</button>
        </div>
      </div>
    </div>
  `;

  return page;
}

function renderSummary() {
  const container = pageRoot?.querySelector('#lots-summary');
  if (!container) return;

  const totalQuantity = allLots.reduce((total, lot) => total + lot.totalQuantity, 0);
  const remainingQuantity = allLots.reduce((total, lot) => total + lot.remainingQuantity, 0);
  const totalInvestment = allLots.reduce((total, lot) => total + lot.totalCost, 0);
  const totalProducts = allLots.reduce((total, lot) => total + lot.productCount, 0);
  const cards = [
    ['Total Lots', formatNumber(allLots.length)],
    ['Products in Lots', formatNumber(totalProducts)],
    ['Total Quantity', formatNumber(totalQuantity)],
    ['Remaining Quantity', formatNumber(remainingQuantity)],
    ['Total Investment', formatMoney(totalInvestment)]
  ];

  container.innerHTML = cards.map(([label, value]) => `
    <div class="lots-summary-card">
      <span class="summary-label">${escapeHTML(label)}</span>
      <strong class="summary-value">${escapeHTML(value)}</strong>
    </div>
  `).join('');
}

function getFilteredLots() {
  const search = pageRoot?.querySelector('#lots-search')?.value
    .trim()
    .toLowerCase() || '';
  const status = pageRoot?.querySelector('#lots-status-filter')?.value || 'all';

  return allLots.filter(lot => {
    const matchesSearch = !search || [
      lot.id,
      lot.lotNumber,
      lot.lotName,
      lot.productName,
      ...lot.productNames,
      lot.supplier
    ].some(value => String(value || '').toLowerCase().includes(search));
    const matchesStatus = status === 'all' || getStatusClass(lot.status) === status;
    return matchesSearch && matchesStatus;
  });
}

function renderTable() {
  const tbody = pageRoot?.querySelector('#lots-table-body');
  if (!tbody) return;

  const lots = getFilteredLots();
  if (!lots.length) {
    tbody.innerHTML = '<tr><td class="empty-state" colspan="9">No purchase lots found.</td></tr>';
    return;
  }

  tbody.innerHTML = lots.map(lot => `
    <tr class="lot-row" data-lot-id="${escapeHTML(lot.id)}" tabindex="0">
      <td>
        <strong>${escapeHTML(lot.lotNumber)}</strong>
        <small>${escapeHTML(lot.lotName)}</small>
      </td>
      <td>
        <strong class="lot-product-name">${escapeHTML(lot.productName)}</strong>
        <small>${escapeHTML(`${lot.productCount} product(s)`)}</small>
      </td>
      <td>${escapeHTML(formatDate(lot.purchaseDate))}</td>
      <td>${escapeHTML(formatMoney(lot.totalCost))}</td>
      <td>${escapeHTML(formatNumber(lot.totalQuantity))}</td>
      <td>${escapeHTML(formatNumber(lot.soldQuantity))}</td>
      <td><strong>${escapeHTML(formatNumber(lot.remainingQuantity))}</strong></td>
      <td>
        <span class="lot-status-badge ${escapeHTML(getStatusClass(lot.status))}">
          ${escapeHTML(getStatusLabel(lot.status))}
        </span>
      </td>
      <td>
        <div class="purchase-lot-row-actions">
          <button type="button" class="btn btn-sm btn-primary"
            data-lots-action="details" data-lot-id="${escapeHTML(lot.id)}">Details</button>
          <button type="button" class="btn btn-sm btn-secondary"
            data-lots-action="add-product" data-lot-id="${escapeHTML(lot.id)}">Add Product</button>
          <button type="button" class="btn btn-sm purchase-lot-delete-button"
            data-lots-action="delete" data-lot-id="${escapeHTML(lot.id)}"
            ${lot.canDelete ? '' : 'disabled'}
            title="${lot.canDelete ? 'Delete this empty Lot' : 'Only empty Lots can be deleted'}">Delete</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function applyFilters() {
  renderTable();
}

async function loadLots({ announce = false } = {}) {
  if (isLoadingLots) return false;

  const refreshButton = pageRoot?.querySelector('#lots-refresh');
  isLoadingLots = true;
  setButtonLoading(refreshButton, true, 'Loading...');
  showMessage('Loading purchase lots...', 'loading');

  try {
    const source = await fetchLots();
    if (currentSignal?.aborted) return false;

    allLots = source.map(normalizeLot).filter(lot => lot.id);
    renderSummary();
    renderTable();
    showMessage(
      announce ? 'Purchase Lots refreshed.' : `${allLots.length} purchase lot(s) loaded.`,
      'success'
    );
    return true;
  } catch (error) {
    if (error.name === 'AbortError' || currentSignal?.aborted) return false;

    console.error('[PURCHASE LOTS]', error);
    allLots = [];
    renderSummary();
    renderTable();
    showMessage(error.message || 'Unable to load Purchase Lots.', 'error');
    return false;
  } finally {
    isLoadingLots = false;
    if (!currentSignal?.aborted) setButtonLoading(refreshButton, false);
  }
}

function openCreateLot() {
  const form = pageRoot?.querySelector('#purchase-lot-create-form');
  form?.reset();
  ['purchase-lot-purchase-cost', 'purchase-lot-transport-cost', 'purchase-lot-other-cost']
    .forEach(id => {
      const input = pageRoot?.querySelector(`#${id}`);
      if (input) input.value = '0';
    });
  openModal('#purchase-lot-create-modal');
  window.setTimeout(() => pageRoot?.querySelector('#purchase-lot-name')?.focus(), 0);
}

async function createLot(event) {
  event.preventDefault();
  if (isCreatingLot) return false;

  const name = pageRoot?.querySelector('#purchase-lot-name')?.value.trim() || '';
  const supplier = pageRoot?.querySelector('#purchase-lot-supplier')?.value.trim() || '';
  const purchaseCost = toNumber(pageRoot?.querySelector('#purchase-lot-purchase-cost')?.value);
  const transportCost = toNumber(pageRoot?.querySelector('#purchase-lot-transport-cost')?.value);
  const otherCost = toNumber(pageRoot?.querySelector('#purchase-lot-other-cost')?.value);
  const note = pageRoot?.querySelector('#purchase-lot-note')?.value.trim() || '';
  const submitButton = pageRoot?.querySelector('#purchase-lot-create-submit');

  if (!name || name.length > 100) {
    pageRoot?.querySelector('#purchase-lot-name')?.focus();
    showMessage('Enter a Lot Name within 100 characters.', 'error');
    return false;
  }

  isCreatingLot = true;
  setButtonLoading(submitButton, true, 'Creating...');

  try {
    const result = await productApiRequest(API_URL, {
      method: 'POST',
      body: JSON.stringify({
        lotName: name,
        supplier,
        purchaseCost,
        transportCost,
        otherCost,
        note
      })
    });
    const lot = normalizeLot(result.lot || result.data?.lot || result.data || {});

    closeModal('#purchase-lot-create-modal');
    await loadLots();
    showMessage('Purchase Lot created. You can now add Products.', 'success');
    if (lot.id) await openAddProduct(lot.id);
    return true;
  } catch (error) {
    console.error('[PURCHASE LOT CREATE]', error);
    showMessage(error.message || 'Unable to create the Purchase Lot.', 'error');
    return false;
  } finally {
    isCreatingLot = false;
    setButtonLoading(submitButton, false);
  }
}

async function openAddProduct(lotId) {
  const lot = allLots.find(item => item.id === lotId);
  if (!lotId) return false;

  selectedLotId = lotId;
  const select = pageRoot?.querySelector('#purchase-lot-product-select');
  const title = pageRoot?.querySelector('#purchase-lot-product-title');
  if (!select) return false;

  if (title) title.textContent = `Add Product to ${lot?.lotNumber || 'Lot'}`;
  select.disabled = true;
  select.innerHTML = '<option value="">Loading Products...</option>';
  openModal('#purchase-lot-product-modal');

  try {
    const products = await fetchProducts();
    select.innerHTML = '<option value="">Select a Product</option>';

    products.forEach(product => {
      const option = document.createElement('option');
      option.value = product.id;
      option.textContent = [
        product.name,
        product.sku,
        `Stock: ${formatNumber(product.totalStock)}`
      ].filter(Boolean).join(' · ');
      select.append(option);
    });

    select.disabled = false;
    window.setTimeout(() => select.focus(), 0);
    return true;
  } catch (error) {
    console.error('[PURCHASE LOT PRODUCTS]', error);
    closeModal('#purchase-lot-product-modal');
    showMessage(error.message || 'Unable to load Products.', 'error');
    return false;
  }
}

function continueAddProduct() {
  const select = pageRoot?.querySelector('#purchase-lot-product-select');
  const productId = select?.value || '';

  if (!productId || !selectedLotId) {
    select?.reportValidity();
    return;
  }

  const lotId = selectedLotId;
  closeModal('#purchase-lot-product-modal');
  navigateTo('products', {
    productId,
    lotId,
    openLot: true,
    source: 'purchase-lots'
  });
}

function profitClass(value) {
  const number = toNumber(value);
  if (number > 0) return 'profit-positive';
  if (number < 0) return 'profit-negative';
  return 'profit-neutral';
}

function renderVariantRows(variants = []) {
  if (!variants.length) return '';

  return `
    <details class="purchase-lot-variant-details">
      <summary>View ${variants.length} variant(s)</summary>
      <div class="purchase-lot-variant-table-wrap">
        <table class="purchase-lot-variant-table">
          <thead><tr>
            <th>Variant</th><th>Bought</th><th>Buy Rate</th>
            <th>Sold</th><th>Remaining</th><th>Unit Landed Cost</th>
          </tr></thead>
          <tbody>
            ${variants.map(variant => `
              <tr>
                <td>
                  <strong>${escapeHTML(
                    [variant.color, variant.size].filter(Boolean).join(' / ') ||
                    variant.sku || variant.variantId || 'Default'
                  )}</strong>
                  ${variant.sku ? `<small>${escapeHTML(variant.sku)}</small>` : ''}
                </td>
                <td>${escapeHTML(formatNumber(variant.purchaseQuantity))}</td>
                <td>${escapeHTML(formatMoney(variant.averageBuyRate))}</td>
                <td>${escapeHTML(formatNumber(variant.soldQuantity))}</td>
                <td>${escapeHTML(formatNumber(variant.remainingQuantity))}</td>
                <td>${escapeHTML(formatMoney(variant.unitLandedCost))}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </details>
  `;
}

function renderLotDetails(report = {}) {
  const content = pageRoot?.querySelector('#purchase-lot-details-content');
  const title = pageRoot?.querySelector('#purchase-lot-details-title');
  const subtitle = pageRoot?.querySelector('#purchase-lot-details-subtitle');
  if (!content) return;

  if (title) title.textContent = report.lotName || report.lotNumber || 'Lot Details';
  if (subtitle) {
    subtitle.textContent = [report.lotNumber, report.supplier, getStatusLabel(report.status)]
      .filter(Boolean)
      .join(' · ');
  }

  const cards = [
    ['Total Investment', formatMoney(report.totalCost)],
    ['Purchase Quantity', formatNumber(report.totalQuantity)],
    ['Sold Quantity', formatNumber(report.soldQuantity)],
    ['Remaining Quantity', formatNumber(report.remainingQuantity)],
    ['Sales Revenue', formatMoney(report.revenue)],
    ['Cost of Sold Stock', formatMoney(report.costOfGoods)],
    ['Gross Profit', formatMoney(report.grossProfit)],
    ['Net Profit / Loss', formatMoney(report.profitLoss)],
    ['Remaining Stock Value', formatMoney(report.inventoryValue)]
  ];
  const products = Array.isArray(report.products) ? report.products : [];

  content.innerHTML = `
    <div class="purchase-lot-report-summary">
      ${cards.map(([label, value], index) => `
        <div class="purchase-lot-report-card ${index === 7 ? profitClass(report.profitLoss) : ''}">
          <span>${escapeHTML(label)}</span>
          <strong>${escapeHTML(value)}</strong>
        </div>
      `).join('')}
    </div>

    <div class="purchase-lot-report-meta">
      <div><span>Products</span><strong>${escapeHTML(formatNumber(report.productCount))}</strong></div>
      <div><span>Purchase Cost</span><strong>${escapeHTML(formatMoney(report.purchaseCost))}</strong></div>
      <div><span>Transport Cost</span><strong>${escapeHTML(formatMoney(report.transportCost))}</strong></div>
      <div><span>Other Cost</span><strong>${escapeHTML(formatMoney(report.otherCost))}</strong></div>
    </div>

    <section class="purchase-lot-products-section">
      <div class="purchase-lot-section-heading">
        <h4>Products in this Lot</h4>
        <p>Product-wise purchase, sales, remaining stock and profit/loss.</p>
      </div>
      <div class="table-responsive purchase-lot-products-table-wrap">
        <table class="purchase-lot-products-table">
          <thead><tr>
            <th>Product</th><th>Bought Qty</th><th>Avg Buy Rate</th>
            <th>Purchase Cost</th><th>Sold Qty</th><th>Sales</th>
            <th>Avg Sale Rate</th><th>Remaining</th><th>Profit / Loss</th>
          </tr></thead>
          <tbody>
            ${products.length ? products.map(product => `
              <tr>
                <td>
                  <strong>${escapeHTML(product.productName)}</strong>
                  ${product.sku ? `<small>${escapeHTML(product.sku)}</small>` : ''}
                  ${renderVariantRows(product.variants)}
                </td>
                <td>${escapeHTML(formatNumber(product.purchaseQuantity))}</td>
                <td>${escapeHTML(formatMoney(product.averageBuyRate))}</td>
                <td>${escapeHTML(formatMoney(product.purchaseCost))}</td>
                <td>${escapeHTML(formatNumber(product.soldQuantity))}</td>
                <td>${escapeHTML(formatMoney(product.revenue))}</td>
                <td>${escapeHTML(formatMoney(product.averageSaleRate))}</td>
                <td>
                  <strong>${escapeHTML(formatNumber(product.remainingQuantity))}</strong>
                  <small>${escapeHTML(formatMoney(product.inventoryValue))}</small>
                </td>
                <td class="${escapeHTML(profitClass(product.profitLoss))}">
                  <strong>${escapeHTML(formatMoney(product.profitLoss))}</strong>
                </td>
              </tr>
            `).join('') : '<tr><td class="empty-state" colspan="9">No Products have been added to this Lot.</td></tr>'}
          </tbody>
        </table>
      </div>
    </section>

    ${report.note ? `
      <div class="purchase-lot-report-note">
        <strong>Note</strong>
        <p>${escapeHTML(report.note)}</p>
      </div>
    ` : ''}
  `;
}

async function openLotDetails(lotId) {
  if (!lotId || isLoadingDetails) return false;

  selectedLotId = lotId;
  const content = pageRoot?.querySelector('#purchase-lot-details-content');
  if (content) content.innerHTML = '<div class="purchase-lot-details-loading">Loading Lot report...</div>';
  openModal('#purchase-lot-details-modal');
  isLoadingDetails = true;

  try {
    const report = await fetchLotDetails(lotId);
    if (selectedLotId !== lotId || currentSignal?.aborted) return false;
    renderLotDetails(report);
    return true;
  } catch (error) {
    console.error('[PURCHASE LOT DETAILS]', error);
    if (content) {
      content.innerHTML = `<div class="purchase-lot-details-error">${escapeHTML(
        error.message || 'Unable to load Lot details.'
      )}</div>`;
    }
    return false;
  } finally {
    isLoadingDetails = false;
  }
}

async function deleteLot(lotId) {
  if (!lotId || isDeletingLot) return false;

  const lot = allLots.find(item => item.id === lotId);
  if (!lot?.canDelete) {
    showMessage(
      'Only an empty Lot can be deleted. Product stock and sales history are protected.',
      'error'
    );
    return false;
  }

  const confirmed = window.confirm(
    `Delete ${lot.lotNumber}? This empty Lot cannot be recovered.`
  );
  if (!confirmed) return false;

  isDeletingLot = true;
  try {
    await productApiRequest(`${API_URL}/${encodeURIComponent(lotId)}`, {
      method: 'DELETE'
    });
    await loadLots();
    showMessage('Purchase Lot deleted.', 'success');
    return true;
  } catch (error) {
    console.error('[PURCHASE LOT DELETE]', error);
    showMessage(error.message || 'Unable to delete the Purchase Lot.', 'error');
    return false;
  } finally {
    isDeletingLot = false;
  }
}

async function handlePageClick(event) {
  const actionButton = event.target.closest('[data-lots-action]');

  if (actionButton) {
    const action = actionButton.dataset.lotsAction;
    const lotId = actionButton.dataset.lotId || selectedLotId;

    if (action === 'close-create') closeModal('#purchase-lot-create-modal');
    if (action === 'close-product') closeModal('#purchase-lot-product-modal');
    if (action === 'close-details') closeModal('#purchase-lot-details-modal');
    if (action === 'details') await openLotDetails(lotId);
    if (action === 'add-product') await openAddProduct(lotId);
    if (action === 'details-add-product') {
      closeModal('#purchase-lot-details-modal');
      await openAddProduct(lotId);
    }
    if (action === 'delete') await deleteLot(lotId);
    return;
  }

  if (event.target.id === 'purchase-lot-create-modal') {
    closeModal('#purchase-lot-create-modal');
    return;
  }
  if (event.target.id === 'purchase-lot-product-modal') {
    closeModal('#purchase-lot-product-modal');
    return;
  }
  if (event.target.id === 'purchase-lot-details-modal') {
    closeModal('#purchase-lot-details-modal');
    return;
  }

  const row = event.target.closest('.lot-row[data-lot-id]');
  if (row && !event.target.closest('button, a, input, select, details')) {
    await openLotDetails(row.dataset.lotId);
  }
}

export function bindEvents({ container, signal }) {
  pageRoot = container.querySelector('.purchase-lots-page');
  currentSignal = signal;
  if (!pageRoot) return;

  pageRoot.querySelector('#lots-search')?.addEventListener('input', applyFilters, { signal });
  pageRoot.querySelector('#lots-status-filter')?.addEventListener('change', applyFilters, { signal });
  pageRoot.querySelector('#lots-refresh')?.addEventListener(
    'click',
    () => loadLots({ announce: true }),
    { signal }
  );
  pageRoot.querySelector('#lots-create')?.addEventListener('click', openCreateLot, { signal });
  pageRoot.querySelector('#purchase-lot-create-form')?.addEventListener('submit', createLot, { signal });
  pageRoot.querySelector('#purchase-lot-product-continue')?.addEventListener(
    'click',
    continueAddProduct,
    { signal }
  );
  pageRoot.addEventListener('click', handlePageClick, { signal });
  pageRoot.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeModal('#purchase-lot-create-modal');
      closeModal('#purchase-lot-product-modal');
      closeModal('#purchase-lot-details-modal');
      return;
    }

    if (
      (event.key === 'Enter' || event.key === ' ') &&
      event.target.matches('.lot-row[data-lot-id]')
    ) {
      event.preventDefault();
      void openLotDetails(event.target.dataset.lotId);
    }
  }, { signal });
}

export async function render({ signal }) {
  const page = createPage();

  pageRoot = page;
  currentSignal = signal;
  allLots = [];
  allProducts = [];
  selectedLotId = '';

  try {
    const source = await fetchLots(signal);
    if (signal?.aborted) return page;

    allLots = source.map(normalizeLot).filter(lot => lot.id);
    renderSummary();
    renderTable();
    showMessage(`${allLots.length} purchase lot(s) loaded.`, 'success');
  } catch (error) {
    if (error.name === 'AbortError' || signal?.aborted) return page;

    console.error('[PURCHASE LOTS]', error);
    renderSummary();
    renderTable();
    showMessage(error.message || 'Unable to load Purchase Lots.', 'error');
  }

  return page;
}

export function cleanup() {
  pageRoot = null;
  allLots = [];
  allProducts = [];
  currentSignal = null;
  selectedLotId = '';
  isLoadingLots = false;
  isCreatingLot = false;
  isDeletingLot = false;
  isLoadingDetails = false;
}

export default {
  render,
  bindEvents,
  cleanup
};
