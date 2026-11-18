
'use strict';

import { createElement, escapeHTML } from '../../helpers.js';

// ========================================
// STATE
// ========================================

let pageRoot = null;
let currentSignal = null;
let productFormModule = null;
let formOpen = false;

let products = [];
let searchText = '';
let statusFilter = 'all';

// ========================================
// HELPERS
// ========================================

function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-BD');
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-BD', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 2
  });
}

function getProductName(product) {
  return product.name || product.title || 'Unnamed Product';
}

function getProductStock(product) {
  return Number(
    product.availableStock ??
    product.availableQuantity ??
    product.totalStock ??
    product.stock ??
    0
  );
}

function getProductStatus(product) {
  return String(product.status || 'draft').toLowerCase();
}

function showMessage(message, type = 'info') {
  if (!pageRoot) return;

  let element = pageRoot.querySelector('#products-page-message');

  if (!element) {
    element = document.createElement('div');
    element.id = 'products-page-message';
    element.className = 'products-page-message';
    pageRoot.prepend(element);
  }

  element.className = `products-page-message ${type}`;
  element.textContent = message;
  element.hidden = false;
}

// ========================================
// DASHBOARD SUMMARY
// ========================================

function getSummary() {
  const totalProducts = products.length;

  const activeProducts = products.filter(
    item => getProductStatus(item) === 'active'
  ).length;

  const totalStock = products.reduce(
    (sum, item) => sum + getProductStock(item),
    0
  );

  const lowStock = products.filter(item => {
    const stock = getProductStock(item);
    const threshold = Number(item.lowStockThreshold ?? 5);

    return stock > 0 && stock <= threshold;
  }).length;

  return {
    totalProducts,
    activeProducts,
    totalStock,
    lowStock
  };
}

function renderSummary() {
  if (!pageRoot) return;

  const summary = getSummary();

  const cards = [
    {
      label: 'Total Products',
      value: summary.totalProducts,
      icon: '📦',
      description: `${summary.activeProducts} active products`
    },
    {
      label: 'Total Available Stock',
      value: formatNumber(summary.totalStock),
      icon: '🗃️',
      description: 'All product variants'
    },
    {
      label: 'Low Stock Products',
      value: summary.lowStock,
      icon: '⚠️',
      description: 'Restock attention needed'
    },
    {
      label: 'Active Products',
      value: summary.activeProducts,
      icon: '✓',
      description: 'Currently active'
    }
  ];

  const container = pageRoot.querySelector('#products-summary');

  if (!container) return;

  container.replaceChildren();

  cards.forEach(card => {
    const element = document.createElement('article');

    element.className = 'product-summary-card';

    const icon = document.createElement('span');
    icon.className = 'product-summary-icon';
    icon.textContent = card.icon;

    const label = document.createElement('span');
    label.className = 'product-summary-label';
    label.textContent = card.label;

    const value = document.createElement('strong');
    value.className = 'product-summary-value';
    value.textContent = String(card.value);

    const description = document.createElement('small');
    description.textContent = card.description;

    element.append(icon, label, value, description);

    container.appendChild(element);
  });
}

// ========================================
// FILTER PRODUCTS
// ========================================

function getFilteredProducts() {
  return products.filter(product => {
    const search = searchText.toLowerCase();

    const searchable = [
      getProductName(product),
      product.productCode,
      product.sku,
      product.brand,
      product.barcode
    ].join(' ').toLowerCase();

    const matchesSearch = !search || searchable.includes(search);

    const status = getProductStatus(product);

    const matchesStatus =
      statusFilter === 'all' ||
      status === statusFilter;

    return matchesSearch && matchesStatus;
  });
}

// ========================================
// PRODUCT TABLE
// ========================================

function createProductRow(product) {
  const row = document.createElement('tr');

  const id = String(product.id || product.productId || '');

  const name = getProductName(product);
  const stock = getProductStock(product);
  const status = getProductStatus(product);

  const image = product.image ||
    product.thumbnail ||
    product.images?.[0] ||
    '';

  const price = product.sellingPrice ??
    product.price ??
    0;

  const imageCell = document.createElement('td');

  if (image) {
    const img = document.createElement('img');

    img.src = image;
    img.alt = name;
    img.loading = 'lazy';
    img.className = 'product-table-image';

    imageCell.appendChild(img);
  } else {
    imageCell.textContent = '📦';
    imageCell.className = 'product-table-image-placeholder';
  }

  const nameCell = document.createElement('td');

  const nameElement = document.createElement('strong');
  nameElement.textContent = name;

  const codeElement = document.createElement('small');

  codeElement.textContent =
    product.productCode || product.sku || 'No code';

  nameCell.append(nameElement, codeElement);

  const stockCell = document.createElement('td');

  stockCell.textContent = formatNumber(stock);

  const priceCell = document.createElement('td');

  priceCell.textContent = formatMoney(price);

  const statusCell = document.createElement('td');

  const badge = document.createElement('span');

  badge.className = `product-status product-status-${status}`;
  badge.textContent = status;

  statusCell.appendChild(badge);

  const actionCell = document.createElement('td');

  const actions = [
    ['view', 'View'],
    ['edit', 'Edit'],
    ['stock', 'Add Stock'],
    ['lots', 'Lots']
  ];

  actions.forEach(([action, label]) => {
    const button = document.createElement('button');

    button.type = 'button';
    button.className = `btn btn-sm product-action-${action}`;
    button.textContent = label;
    button.dataset.action = action;
    button.dataset.productId = id;

    button.disabled = !id;

    actionCell.appendChild(button);
  });

  row.dataset.productId = id;

  row.append(
    imageCell,
    nameCell,
    stockCell,
    priceCell,
    statusCell,
    actionCell
  );

  return row;
}

// ========================================
// RENDER PRODUCT TABLE
// ========================================

function renderProductTable() {
  if (!pageRoot) return;

  const body = pageRoot.querySelector('#products-table-body');
  const empty = pageRoot.querySelector('#products-empty');
  const count = pageRoot.querySelector('#products-result-count');

  if (!body) return;

  const filtered = getFilteredProducts();

  body.replaceChildren();

  if (count) {
    count.textContent = `${filtered.length} products`;
  }

  if (!filtered.length) {
    if (empty) empty.hidden = false;
    return;
  }

  if (empty) empty.hidden = true;

  filtered.forEach(product => {
    body.appendChild(createProductRow(product));
  });
}

// ========================================
// SET PRODUCT DATA
// Backend integration can call this function.
// ========================================

export function setProducts(data = []) {
  if (!Array.isArray(data)) {
    console.error('[PRODUCTS] Invalid product data.');
    return;
  }

  products = data.map(product => ({
    ...product,
    id: String(product.id || product.productId || '')
  }));

  renderSummary();
  renderProductTable();
}

// ========================================
// GET PRODUCT DATA
// ========================================

export function getProducts() {
  return products.map(product => ({ ...product }));
}

// ========================================
// OPEN PRODUCT FORM
// ========================================

async function openProductForm(product = null) {
  if (!pageRoot || formOpen) return;

  try {
    const module = await import('./product-form.js');

    if (currentSignal?.aborted || !pageRoot) return;

    if (typeof module.renderProductForm !== 'function') {
      throw new Error('renderProductForm() export পাওয়া যায়নি।');
    }

    productFormModule = module;

    const form = module.renderProductForm({
      product: product || {},
      mode: product ? 'edit' : 'create'
    });

    if (!(form instanceof HTMLElement)) {
      throw new Error('Product form render করা যায়নি।');
    }

    const header = form.querySelector('.product-form-header');

    if (header) {
      const backButton = document.createElement('button');

      backButton.type = 'button';
      backButton.className = 'btn btn-secondary';
      backButton.id = 'product-form-back';
      backButton.textContent = '← Back to Products';

      header.prepend(backButton);
    }

    const dashboard = pageRoot.querySelector('#products-dashboard-content');

    dashboard?.replaceChildren(form);

    if (typeof module.initProductForm === 'function') {
      await module.initProductForm({
        container: pageRoot,
        productId: product?.id || product?.productId || null,
        product: product || {},
        existingSlugs: products
          .map(item => item.slug || item.seo?.slug || '')
          .filter(Boolean)
      });
    }

    formOpen = true;

  } catch (error) {
    console.error('[PRODUCT FORM]', error);

    showMessage(
      error.message || 'Product Form open করা যায়নি।',
      'error'
    );
  }
}

// ========================================
// CLOSE PRODUCT FORM
// ========================================

function closeProductForm() {
  if (!pageRoot || !formOpen) return;

  try {
    productFormModule?.cleanupProductForm?.();
  } catch (error) {
    console.error('[PRODUCT FORM CLEANUP]', error);
  }

  productFormModule = null;
  formOpen = false;

  renderDashboardContent();
}

// ========================================
// DASHBOARD CONTENT
// ========================================

function renderDashboardContent() {
  if (!pageRoot) return;

  const dashboard = pageRoot.querySelector('#products-dashboard-content');

  if (!dashboard) return;

  dashboard.innerHTML = `
    <div class="products-dashboard">

      <div class="products-page-header">
        <div>
          <h2>Product Management</h2>
          <p>Manage products, inventory and purchase lots.</p>
        </div>

        <div class="products-header-actions">
          <button
            type="button"
            class="btn btn-secondary"
            data-products-action="refresh">
            ↻ Refresh
          </button>

          <button
            type="button"
            class="btn btn-secondary"
            data-products-action="add-stock">
            + Add Stock
          </button>

          <button
            type="button"
            class="btn btn-primary"
            data-products-action="add-product">
            + Add Product
          </button>
        </div>
      </div>

      <div id="products-page-message" hidden></div>

      <div class="products-summary-grid" id="products-summary"></div>

      <section class="products-list-section">

        <div class="products-list-header">
          <div>
            <h3>All Products</h3>
            <span id="products-result-count">0 products</span>
          </div>

          <div class="products-filters">

            <input
              type="search"
              id="products-search"
              placeholder="Search name, SKU, code..."
              autocomplete="off">

            <select id="products-status-filter">
              <option value="all">All Status</option>
              <option value="active">Active</option>
              <option value="draft">Draft</option>
              <option value="inactive">Inactive</option>
            </select>

          </div>
        </div>

        <div class="products-table-wrapper">

          <table class="products-table">

            <thead>
              <tr>
                <th>Image</th>
                <th>Product</th>
                <th>Available Stock</th>
                <th>Selling Price</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>

            <tbody id="products-table-body"></tbody>

          </table>

          <div id="products-empty" class="products-empty-state">
            <div class="products-empty-icon">📦</div>
            <h3>No Products Loaded</h3>
            <p>
              Product list API এখনো যুক্ত করা হয়নি।
              Backend integration হলে Firebase-এর existing products এখানে দেখা যাবে।
            </p>

            <button
              type="button"
              class="btn btn-primary"
              data-products-action="add-product">
              + Add First Product
            </button>
          </div>

        </div>

      </section>

    </div>
  `;

  renderSummary();
  renderProductTable();
}

// ========================================
// MAIN PAGE MARKUP
// ========================================

function renderPageMarkup() {
  const page = document.createElement('section');

  page.className = 'products-page';
  page.id = 'products-page';

  const content = document.createElement('div');

  content.id = 'products-dashboard-content';

  page.appendChild(content);

  return page;
}

// ========================================
// RENDER
// ========================================

export function render() {
  pageRoot = renderPageMarkup();

  formOpen = false;
  products = [];
  searchText = '';
  statusFilter = 'all';

  renderDashboardContent();

  return pageRoot;
}

// ========================================
// ACTION HANDLER
// ========================================

async function handleAction(event) {
  const button = event.target.closest('[data-products-action]');

  if (!button || !pageRoot?.contains(button)) return;

  const action = button.dataset.productsAction;

  if (action === 'add-product') {
    await openProductForm();
    return;
  }

  if (action === 'refresh') {
    showMessage(
      'Product API যুক্ত না হওয়া পর্যন্ত Refresh থেকে Firebase data load করা যাবে না।',
      'warning'
    );
    return;
  }

  if (action === 'add-stock') {
    showMessage(
      'আগে Product list API যুক্ত করতে হবে। এরপর Product নির্বাচন করে নতুন Purchase Lot তৈরি করা যাবে।',
      'warning'
    );
  }
}

// ========================================
// PRODUCT ROW ACTIONS
// ========================================

function handleProductAction(event) {
  const button = event.target.closest('[data-action]');

  if (!button || !pageRoot?.contains(button)) return;

  const productId = button.dataset.productId;
  const action = button.dataset.action;

  const product = products.find(item => item.id === productId);

  if (!product) return;

  if (action === 'view') {
    showMessage(
      'Product details API integration এখনো বাকি।',
      'warning'
    );
    return;
  }

  if (action === 'edit') {
    openProductForm(product);
    return;
  }

  if (action === 'stock') {
    showMessage(
      'এই Product-এর জন্য Purchase Lot API integration প্রয়োজন।',
      'warning'
    );
    return;
  }

  if (action === 'lots') {
    showMessage(
      'Product Lot details খুলতে backend integration প্রয়োজন।',
      'warning'
    );
  }
}

// ========================================
// BIND EVENTS
// ========================================

export function bindEvents({ container, signal } = {}) {
  if (!container) {
    throw new Error('Products page container পাওয়া যায়নি।');
  }

  pageRoot = container.querySelector('#products-page');

  if (!pageRoot) {
    throw new Error('#products-page root পাওয়া যায়নি।');
  }

  currentSignal = signal || null;

  pageRoot.addEventListener('click', event => {
    if (event.target.closest('#product-form-back')) {
      closeProductForm();
      return;
    }

    handleAction(event);
    handleProductAction(event);
  }, signal ? { signal } : undefined);

  pageRoot.addEventListener('input', event => {
    if (event.target.id !== 'products-search') return;

    searchText = event.target.value.trim();

    renderProductTable();
  }, signal ? { signal } : undefined);

  pageRoot.addEventListener('change', event => {
    if (event.target.id !== 'products-status-filter') return;

    statusFilter = event.target.value;

    renderProductTable();
  }, signal ? { signal } : undefined);

  console.info('[PRODUCTS] Dashboard initialized.');
}

// ========================================
// CLEANUP
// ========================================

export function cleanup() {
  try {
    productFormModule?.cleanupProductForm?.();
  } catch (error) {
    console.error('[PRODUCTS] Cleanup error:', error);
  }

  productFormModule = null;
  pageRoot = null;
  currentSignal = null;

  products = [];
  searchText = '';
  statusFilter = 'all';
  formOpen = false;

  console.info('[PRODUCTS] Dashboard cleaned up.');
}

// ========================================
// DEFAULT EXPORT
// ========================================

export default {
  render,
  bindEvents,
  cleanup
};
