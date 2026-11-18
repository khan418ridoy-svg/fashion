
'use strict';

import { createElement, escapeHTML } from '../../helpers.js';
import { productApiRequest } from './product-utils.js';

// ========================================
// STATE
// ========================================

let pageRoot = null;
let currentSignal = null;
let productFormModule = null;
let formOpen = false;
let formOpening = false;

let products = [];
let searchText = '';
let statusFilter = 'all';
let productsLoading = false;
let selectedProductIds = new Set();
let viewProductId = null;
let activationInProgress = false;

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
  return (
    product.name ||
    product.title ||
    product.basic?.name ||
    'Unnamed Product'
  );
}

function getProductStock(product) {
  return Number(
    product.availableStock ??
    product.availableQuantity ??
    product.totalStock ??
    product.stock ??
    product.inventory?.availableStock ??
    product.inventory?.totalStock ??
    0
  );
}

function getProductStatus(product) {
  if (product.active === true) return 'active';
  if (product.deleted === true) return 'archived';
  if (product.active === false) return 'draft';

  return String(product.status || 'draft').toLowerCase();
}

function getProductImage(product) {
  const imageData = product.image ||
    product.thumbnail ||
    product.images?.[0] ||
    '';

  return typeof imageData === 'string'
    ? imageData
    : imageData?.url || imageData?.src || '';
}

function getProductPrice(product) {
  return Number(
    product.sellingPrice ??
    product.price ??
    product.pricing?.sellingPrice ??
    0
  );
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

function getProductList(result) {
  const candidates = [
    result?.data?.products,
    result?.data?.items,
    result?.data?.data,
    result?.data,
    result?.products,
    result?.items,
    result
  ];

  return candidates.find(Array.isArray) || [];
}

function renderStockPickerOptions() {
  if (!pageRoot) return;

  const select = pageRoot.querySelector('#products-stock-product');
  if (!select) return;

  const currentValue = select.value;
  const placeholder = document.createElement('option');

  placeholder.value = '';
  placeholder.textContent = 'Select a Product';

  select.replaceChildren(placeholder);

  products.forEach(product => {
    const option = document.createElement('option');

    option.value = product.id;
    option.textContent = [
      getProductName(product),
      product.productCode ||
        product.basic?.productCode ||
        product.sku ||
        product.basic?.sku ||
        ''
    ].filter(Boolean).join(' — ');

    select.appendChild(option);
  });

  if (products.some(product => product.id === currentValue)) {
    select.value = currentValue;
  }
}

function closeStockPicker() {
  const modal = pageRoot?.querySelector('#products-stock-picker');
  if (!modal) return;

  modal.classList.remove('is-open');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
}

function openStockPicker() {
  const modal = pageRoot?.querySelector('#products-stock-picker');
  const select = pageRoot?.querySelector('#products-stock-product');

  if (!modal || !select) return false;

  renderStockPickerOptions();
  select.value = '';
  modal.hidden = false;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');

  window.setTimeout(() => select.focus(), 0);
  return true;
}

function getDraftProducts(items = products) {
  return items.filter(product => (
    product.id && getProductStatus(product) === 'draft'
  ));
}

function renderBulkActions() {
  if (!pageRoot) return;

  const existingDraftIds = new Set(
    getDraftProducts().map(product => product.id)
  );

  selectedProductIds = new Set(
    [...selectedProductIds].filter(id => existingDraftIds.has(id))
  );

  const bar = pageRoot.querySelector('#products-bulk-actions');
  const count = pageRoot.querySelector('#products-selected-count');
  const activateButton = pageRoot.querySelector(
    '[data-products-action="activate-selected"]'
  );
  const selectAll = pageRoot.querySelector('#products-select-all');
  const visibleDrafts = getDraftProducts(getFilteredProducts());
  const selectedVisibleCount = visibleDrafts.filter(product => (
    selectedProductIds.has(product.id)
  )).length;

  if (bar) bar.hidden = selectedProductIds.size === 0;
  if (count) {
    count.textContent = `${selectedProductIds.size} draft Product(s) selected`;
  }
  if (activateButton) {
    activateButton.disabled = activationInProgress || selectedProductIds.size === 0;
    activateButton.textContent = activationInProgress
      ? 'Activating...'
      : 'Activate Selected';
  }
  if (selectAll) {
    selectAll.disabled = visibleDrafts.length === 0 || activationInProgress;
    selectAll.checked = visibleDrafts.length > 0 &&
      selectedVisibleCount === visibleDrafts.length;
    selectAll.indeterminate = selectedVisibleCount > 0 &&
      selectedVisibleCount < visibleDrafts.length;
  }
}

function closeProductView() {
  const modal = pageRoot?.querySelector('#product-view-modal');

  if (!modal) return;

  modal.classList.remove('is-open');
  modal.hidden = true;
  modal.setAttribute('aria-hidden', 'true');
  viewProductId = null;
}

function renderProductView(product) {
  if (!pageRoot || !product) return;

  const body = pageRoot.querySelector('#product-view-body');
  const title = pageRoot.querySelector('#product-view-title');
  const activateButton = pageRoot.querySelector(
    '[data-products-action="activate-view"]'
  );
  const editButton = pageRoot.querySelector(
    '[data-products-action="edit-view"]'
  );
  const status = getProductStatus(product);
  const image = getProductImage(product);
  const productName = getProductName(product);
  const sku = product.sku || product.basic?.sku || '—';
  const productCode = product.productCode || product.basic?.productCode || '—';
  const brand = product.brand || product.basic?.brand || '—';
  const category = product.categoryName ||
    product.category?.categoryName ||
    product.category?.name ||
    product.categoryId ||
    '—';
  const variants = Array.isArray(product.variants)
    ? product.variants.length
    : 0;
  const descriptionSource = product.shortDescription ||
    product.description?.shortDescription ||
    product.description?.description ||
    product.description;
  const description = typeof descriptionSource === 'string'
    ? descriptionSource
    : 'No description added.';

  if (title) title.textContent = productName;

  if (body) {
    body.innerHTML = `
      <div class="product-view-hero">
        <div class="product-view-image">
          ${image
            ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(productName)}">`
            : '<span aria-hidden="true">📦</span>'}
        </div>

        <div class="product-view-heading">
          <span class="product-status product-status-${escapeHTML(status)}">
            ${escapeHTML(status)}
          </span>
          <h4>${escapeHTML(productName)}</h4>
          <p>${escapeHTML(String(description))}</p>
        </div>
      </div>

      <div class="product-view-stats">
        <div><span>Current Stock</span><strong>${escapeHTML(formatNumber(getProductStock(product)))}</strong></div>
        <div><span>Selling Price</span><strong>${escapeHTML(formatMoney(getProductPrice(product)))}</strong></div>
        <div><span>Variants</span><strong>${variants}</strong></div>
      </div>

      <dl class="product-view-details">
        <div><dt>SKU</dt><dd>${escapeHTML(sku)}</dd></div>
        <div><dt>Product Code</dt><dd>${escapeHTML(productCode)}</dd></div>
        <div><dt>Brand</dt><dd>${escapeHTML(brand)}</dd></div>
        <div><dt>Category</dt><dd>${escapeHTML(String(category))}</dd></div>
      </dl>
    `;
  }

  if (activateButton) {
    activateButton.hidden = status !== 'draft';
    activateButton.disabled = activationInProgress;
    activateButton.dataset.productId = product.id;
    activateButton.textContent = activationInProgress
      ? 'Activating...'
      : 'Activate Product';
  }
  if (editButton) editButton.dataset.productId = product.id;
}

function openProductView(product) {
  const modal = pageRoot?.querySelector('#product-view-modal');

  if (!modal || !product?.id) return false;

  viewProductId = product.id;
  renderProductView(product);
  modal.hidden = false;
  modal.classList.add('is-open');
  modal.setAttribute('aria-hidden', 'false');

  window.setTimeout(() => (
    modal.querySelector('[data-products-action="close-view"]')?.focus()
  ), 0);

  return true;
}

async function activateProductIds(productIds) {
  if (activationInProgress) return false;

  const ids = [...new Set(productIds)].filter(id => (
    products.some(product => (
      product.id === id && getProductStatus(product) === 'draft'
    ))
  ));

  if (!ids.length) {
    showMessage('Select at least one draft Product.', 'warning');
    return false;
  }

  activationInProgress = true;
  renderBulkActions();

  if (viewProductId) {
    const viewedProduct = products.find(product => product.id === viewProductId);
    if (viewedProduct) renderProductView(viewedProduct);
  }

  try {
    const result = await productApiRequest('/api/products/activate', {
      method: 'POST',
      body: JSON.stringify({ productIds: ids })
    });
    const updatedProducts = Array.isArray(result.products)
      ? result.products
      : Array.isArray(result.data?.products)
        ? result.data.products
        : [];
    const updates = new Map(updatedProducts.map(product => [product.id, product]));

    products = products.map(product => (
      ids.includes(product.id)
        ? {
            ...product,
            ...(updates.get(product.id) || {}),
            active: true,
            status: 'active'
          }
        : product
    ));

    ids.forEach(id => selectedProductIds.delete(id));
    renderSummary();
    renderProductTable();

    if (viewProductId) {
      const viewedProduct = products.find(product => product.id === viewProductId);
      if (viewedProduct) renderProductView(viewedProduct);
    }

    showMessage(`${ids.length} Product(s) activated successfully.`, 'success');
    return true;
  } catch (error) {
    console.error('[PRODUCT ACTIVATE]', error);
    showMessage(error.message || 'Product activation failed.', 'error');
    return false;
  } finally {
    activationInProgress = false;
    renderBulkActions();

    if (viewProductId) {
      const viewedProduct = products.find(product => product.id === viewProductId);
      if (viewedProduct) renderProductView(viewedProduct);
    }
  }
}

function handleLotCreated(event) {
  const productId = String(event.detail?.productId || '');
  const updatedProduct = event.detail?.product;

  if (!productId || !updatedProduct) return;

  products = products.map(product => (
    product.id === productId
      ? { ...product, ...updatedProduct, id: productId }
      : product
  ));

  renderSummary();
  renderProductTable();
}

function handleProductSaved(event) {
  const savedProduct = event.detail?.product;
  const productId = String(
    savedProduct?.id || savedProduct?.productId || ''
  );

  if (!savedProduct || !productId) return;

  const normalizedProduct = {
    ...savedProduct,
    id: productId
  };
  const existingProduct = products.find(
    product => product.id === productId
  );
  const nextProducts = existingProduct
    ? products.map(product => (
        product.id === productId
          ? { ...product, ...normalizedProduct }
          : product
      ))
    : [normalizedProduct, ...products];

  setProducts(nextProducts);

  if (event.detail?.redirectToIndex === true) {
    closeProductForm();
    showMessage(
      event.detail?.isUpdate
        ? 'Product updated successfully.'
        : 'Product saved successfully.',
      'success'
    );
    void loadProducts();
  }
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
      product.productCode || product.basic?.productCode,
      product.sku || product.basic?.sku,
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

  const id = String(product.id || product.productId || product._id || '');

  const name = getProductName(product);
  const stock = getProductStock(product);
  const status = getProductStatus(product);

  const image = getProductImage(product);
  const price = getProductPrice(product);

  const imageCell = document.createElement('td');
  const imageWrap = document.createElement('div');
  const selectControl = document.createElement('label');
  const selectInput = document.createElement('input');

  imageCell.className = 'product-select-cell';
  imageWrap.className = 'product-table-image-wrap';
  selectControl.className = 'product-row-select-control';
  selectControl.title = status === 'draft'
    ? 'Select draft Product'
    : 'Only draft Products can be selected';
  selectInput.type = 'checkbox';
  selectInput.dataset.productSelect = id;
  selectInput.checked = selectedProductIds.has(id);
  selectInput.disabled = status !== 'draft' || activationInProgress || !id;
  selectInput.setAttribute('aria-label', `Select ${name}`);
  selectControl.appendChild(selectInput);
  imageWrap.appendChild(selectControl);

  if (image) {
    const img = document.createElement('img');

    img.src = image;
    img.alt = name;
    img.loading = 'lazy';
    img.className = 'product-table-image';

    imageWrap.appendChild(img);
  } else {
    const placeholder = document.createElement('span');

    placeholder.textContent = '📦';
    placeholder.className = 'product-table-image-placeholder';
    imageWrap.appendChild(placeholder);
  }

  imageCell.appendChild(imageWrap);

  const nameCell = document.createElement('td');

  const nameElement = document.createElement('strong');
  nameElement.textContent = name;

  const codeElement = document.createElement('small');

  codeElement.textContent =
    product.productCode ||
    product.basic?.productCode ||
    product.sku ||
    product.basic?.sku ||
    'No code';

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
  const refreshButton = pageRoot.querySelector(
    '[data-products-action="refresh"]'
  );
  const addStockButton = pageRoot.querySelector(
    '[data-products-action="add-stock"]'
  );

  if (!body) return;

  if (refreshButton) refreshButton.disabled = productsLoading;
  if (addStockButton) addStockButton.disabled = productsLoading;

  const filtered = getFilteredProducts();

  body.replaceChildren();

  if (count) {
    count.textContent = productsLoading
      ? 'Loading products...'
      : `${filtered.length} products`;
  }

  if (!filtered.length) {
    if (empty) {
      const title = empty.querySelector('h3');
      const description = empty.querySelector('p');
      const addButton = empty.querySelector(
        '[data-products-action="add-product"]'
      );

      if (title) {
        title.textContent = productsLoading
          ? 'Loading Products...'
          : 'No Products Found';
      }

      if (description) {
        description.textContent = productsLoading
          ? 'Please wait while the product list is loading.'
          : 'Create a Product first, then you can add stock with a Purchase Lot.';
      }

      if (addButton) addButton.hidden = productsLoading;
      empty.hidden = false;
    }

    renderStockPickerOptions();
    renderBulkActions();
    return;
  }

  if (empty) empty.hidden = true;

  filtered.forEach(product => {
    body.appendChild(createProductRow(product));
  });

  renderStockPickerOptions();
  renderBulkActions();
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

  const uniqueProducts = new Map();

  data.forEach(product => {
    const id = String(
      product?.id || product?.productId || product?._id || ''
    );

    if (!id) return;

    uniqueProducts.set(id, {
      ...(uniqueProducts.get(id) || {}),
      ...product,
      id
    });
  });

  products = [...uniqueProducts.values()];
  const draftIds = new Set(getDraftProducts().map(product => product.id));

  selectedProductIds = new Set(
    [...selectedProductIds].filter(id => draftIds.has(id))
  );

  renderSummary();
  renderProductTable();
}

// ========================================
// GET PRODUCT DATA
// ========================================

export function getProducts() {
  return products.map(product => ({ ...product }));
}

async function loadProducts({ announce = false } = {}) {
  if (productsLoading) return false;

  productsLoading = true;
  renderProductTable();

  try {
    const result = await productApiRequest('/api/products', {
      method: 'GET',
      ...(currentSignal ? { signal: currentSignal } : {})
    });

    if (currentSignal?.aborted) return false;

    setProducts(getProductList(result));

    if (announce) {
      showMessage(
        'Product list refresh হয়েছে। / Product list refreshed.',
        'success'
      );
    }

    return true;
  } catch (error) {
    if (error.name === 'AbortError') return false;

    console.error('[PRODUCTS LOAD]', error);
    showMessage(
      error.message || 'Product list load করা যায়নি। / Unable to load products.',
      'error'
    );
    return false;
  } finally {
    productsLoading = false;

    if (!currentSignal?.aborted) {
      renderSummary();
      renderProductTable();
    }
  }
}

// ========================================
// OPEN PRODUCT FORM
// ========================================

async function openProductForm(product = null, {
  openLot = false,
  focusLots = false
} = {}) {
  if (!pageRoot || formOpen || formOpening) return false;

  formOpening = true;

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

    if (openLot) {
      const lotButton = form.querySelector('#product-lot-create');

      if (!lotButton) {
        throw new Error('Purchase Lot form was not found.');
      }

      lotButton.click();
    }

    if (focusLots) {
      window.setTimeout(() => {
        form.querySelector('#product-lots-section')?.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }, 0);
    }

    return true;

  } catch (error) {
    console.error('[PRODUCT FORM]', error);

    showMessage(
      error.message || 'Product Form open করা যায়নি।',
      'error'
    );

    return false;
  } finally {
    formOpening = false;
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
  formOpening = false;

  renderDashboardContent();
}

// ========================================
// DASHBOARD CONTENT
// ========================================

function renderDashboardContent() {
  if (!pageRoot) return;

  viewProductId = null;

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

        <div class="products-bulk-actions" id="products-bulk-actions" hidden>
          <span id="products-selected-count">0 draft Products selected</span>

          <button type="button" class="btn btn-primary"
            data-products-action="activate-selected">
            Activate Selected
          </button>
        </div>

        <div class="products-table-wrapper">

          <table class="products-table">

            <thead>
              <tr>
                <th>
                  <label class="product-select-all-control">
                    <input type="checkbox" id="products-select-all"
                      aria-label="Select all visible draft Products">
                    <span>Image</span>
                  </label>
                </th>
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
            <h3>No Products Found</h3>
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

      <div class="product-modal-overlay" id="products-stock-picker"
        hidden aria-hidden="true">
        <div class="product-modal" role="dialog" aria-modal="true"
          aria-labelledby="products-stock-picker-title">
          <div class="product-modal-header">
            <h3 id="products-stock-picker-title">Add Stock</h3>
            <p>স্টক যোগ করার Product নির্বাচন করুন। / Select a Product.</p>
          </div>

          <div class="products-stock-picker-body">
            <label for="products-stock-product">Product</label>
            <select id="products-stock-product" class="form-control" required></select>

            <div class="product-modal-actions">
              <button type="button" class="btn btn-secondary"
                data-products-action="stock-picker-cancel">
                Cancel
              </button>
              <button type="button" class="btn btn-primary"
                data-products-action="stock-picker-confirm">
                Continue
              </button>
            </div>
          </div>
        </div>
      </div>

      <div class="product-modal-overlay" id="product-view-modal"
        hidden aria-hidden="true">
        <div class="product-modal product-view-modal" role="dialog"
          aria-modal="true" aria-labelledby="product-view-title">

          <div class="product-modal-header product-view-modal-header">
            <div>
              <span class="product-view-eyebrow">Product Details</span>
              <h3 id="product-view-title">Product</h3>
            </div>

            <button type="button" class="product-view-close"
              data-products-action="close-view" aria-label="Close">×</button>
          </div>

          <div class="product-view-body" id="product-view-body"></div>

          <div class="product-modal-actions product-view-actions">
            <button type="button" class="btn btn-secondary"
              data-products-action="close-view">Close</button>

            <button type="button" class="btn btn-secondary"
              data-products-action="edit-view">Edit Product</button>

            <button type="button" class="btn btn-primary"
              data-products-action="activate-view">Activate Product</button>
          </div>
        </div>
      </div>

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
  formOpening = false;
  products = [];
  searchText = '';
  statusFilter = 'all';
  productsLoading = false;
  selectedProductIds = new Set();
  viewProductId = null;
  activationInProgress = false;

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

  if (action === 'refresh') {
    await loadProducts({ announce: true });
    return;
  }

  if (action === 'activate-selected') {
    await activateProductIds([...selectedProductIds]);
    return;
  }

  if (action === 'close-view') {
    closeProductView();
    return;
  }

  if (action === 'activate-view') {
    const productId = button.dataset.productId || viewProductId;
    if (productId) await activateProductIds([productId]);
    return;
  }

  if (action === 'edit-view') {
    const productId = button.dataset.productId || viewProductId;
    const product = products.find(item => item.id === productId);

    if (product) {
      closeProductView();
      await openProductForm(product);
    }
    return;
  }

  if (action === 'add-stock') {
    if (!products.length && !productsLoading) {
      await loadProducts();
    }

    if (!products.length) {
      showMessage(
        'আগে একটি Product তৈরি করুন। / Create a Product before adding stock.',
        'warning'
      );
      return;
    }

    if (products.length === 1) {
      await openProductForm(products[0], { openLot: true });
      return;
    }

    openStockPicker();
    return;
  }

  if (action === 'stock-picker-cancel') {
    closeStockPicker();
    return;
  }

  if (action === 'stock-picker-confirm') {
    const select = pageRoot.querySelector('#products-stock-product');
    const product = products.find(item => item.id === select?.value);

    if (!product) {
      select?.reportValidity();
      return;
    }

    closeStockPicker();
    await openProductForm(product, { openLot: true });
    return;
  }

  if (action === 'add-product') {
    await openProductForm();
    return;
  }

}

// ========================================
// PRODUCT ROW ACTIONS
// ========================================

async function handleProductAction(event) {
  const button = event.target.closest('[data-action]');

  if (!button || !pageRoot?.contains(button)) return;

  const productId = button.dataset.productId;
  const action = button.dataset.action;

  const product = products.find(item => item.id === productId);

  if (!product) return;

  if (action === 'stock') {
    await openProductForm(product, { openLot: true });
    return;
  }

  if (action === 'view') {
    openProductView(product);
    return;
  }

  if (action === 'edit') {
    openProductForm(product);
    return;
  }

  if (action === 'lots') {
    await openProductForm(product, { focusLots: true });
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
    if (event.target.id === 'products-stock-picker') {
      closeStockPicker();
      return;
    }

    if (event.target.id === 'product-view-modal') {
      closeProductView();
      return;
    }

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
    if (event.target.matches('[data-product-select]')) {
      const productId = event.target.dataset.productSelect;

      if (event.target.checked) {
        selectedProductIds.add(productId);
      } else {
        selectedProductIds.delete(productId);
      }

      renderBulkActions();
      return;
    }

    if (event.target.id === 'products-select-all') {
      const visibleDraftIds = getDraftProducts(getFilteredProducts())
        .map(product => product.id);

      visibleDraftIds.forEach(id => {
        if (event.target.checked) {
          selectedProductIds.add(id);
        } else {
          selectedProductIds.delete(id);
        }
      });

      renderProductTable();
      return;
    }

    if (event.target.id !== 'products-status-filter') return;

    statusFilter = event.target.value;

    renderProductTable();
  }, signal ? { signal } : undefined);

  document.removeEventListener('product:lot-created', handleLotCreated);
  document.addEventListener(
    'product:lot-created',
    handleLotCreated,
    signal ? { signal } : undefined
  );
  document.removeEventListener('product:saved', handleProductSaved);
  document.addEventListener(
    'product:saved',
    handleProductSaved,
    signal ? { signal } : undefined
  );

  console.info('[PRODUCTS] Dashboard initialized.');
  void loadProducts();
}

// ========================================
// CLEANUP
// ========================================

export function cleanup() {
  document.removeEventListener('product:lot-created', handleLotCreated);
  document.removeEventListener('product:saved', handleProductSaved);

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
  productsLoading = false;
  formOpen = false;
  formOpening = false;
  selectedProductIds = new Set();
  viewProductId = null;
  activationInProgress = false;

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
