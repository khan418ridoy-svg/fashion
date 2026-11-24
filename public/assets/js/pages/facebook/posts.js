
'use strict';

import { facebookApi } from './facebook-api.js';

// ========================================
// Helpers
// ========================================

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function formatMoney(value) {
  const amount = Number(value);

  if (!Number.isFinite(amount)) {
    return '৳0';
  }

  return `৳${amount.toLocaleString('en-BD')}`;
}

function getProductPrice(product) {
  const min = Number(product.summary?.minPrice) || 0;
  const max = Number(product.summary?.maxPrice) || 0;

  if (!min && !max) return 'Price unavailable';

  if (min === max || !max) {
    return formatMoney(min || max);
  }

  return `${formatMoney(min)} – ${formatMoney(max)}`;
}

// ========================================
// Feedback
// ========================================

function setFeedback(root, message, type = '') {
  const element = root.querySelector('[data-fb-posts-feedback]');

  if (!element) return;

  element.textContent = message;
  element.dataset.type = type;
}

// ========================================
// Product Preview
// ========================================

function renderProductPreview(root, product) {
  const preview = root.querySelector('[data-fb-product-preview]');
  if (!preview) return;

  if (!product) {
    preview.innerHTML = `
      <div class="fb-empty-state">
        Select a product to see its details.
      </div>
    `;
    return;
  }

  const image = product.images?.[0];

  const imageHtml = image
    ? `
      <img
        class="fb-product-preview-image"
        src="${escapeHtml(image.url)}"
        alt="${escapeHtml(image.alt || product.name)}"
        loading="lazy"
      >
    `
    : '';

  const variants = Array.isArray(product.variants)
    ? product.variants.filter(variant =>
        variant.isActive === true &&
        Number(variant.stock) > 0
      )
    : [];

  const variantHtml = variants.map(variant => {
    const color = variant.color || 'Default';
    const size = variant.size || 'Standard';

    const hasPrice =
      variant.sellingPrice !== undefined &&
      variant.sellingPrice !== null &&
      Number.isFinite(Number(variant.sellingPrice));

    const price = hasPrice
      ? formatMoney(variant.sellingPrice)
      : 'Price unavailable';

    return `
      <div class="fb-product-variant">
        <div>
          <strong>
            ${escapeHtml(color)} / ${escapeHtml(size)}
          </strong>
          <p class="fb-muted">
            Stock: ${Number(variant.stock) || 0}
          </p>
        </div>

        <strong>
          ${escapeHtml(price)}
        </strong>
      </div>
    `;
  }).join('');

  preview.innerHTML = `
    <div class="fb-product-preview">
      ${imageHtml}

      <div class="fb-product-preview-info">
        <span class="fb-eyebrow">SELECTED PRODUCT</span>

        <h3>${escapeHtml(product.name || 'Unnamed product')}</h3>

        <p class="fb-muted">
          SKU: ${escapeHtml(product.sku || 'Not available')}
        </p>

        <p>
          <strong>
            Overall price range: ${escapeHtml(getProductPrice(product))}
          </strong>
        </p>

        <p class="fb-muted">
          Total stock: ${Number(product.summary?.totalStock) || 0}
        </p>

        <p>${escapeHtml(product.shortDescription || '')}</p>

        <h4>Variant-wise Price & Stock</h4>

        <div class="fb-product-variants">
          ${
            variantHtml ||
            '<p class="fb-muted">No available variants.</p>'
          }
        </div>
      </div>
    </div>
  `;
}

// ========================================
// Caption Editor
// ========================================

function renderCaptionEditor(root, state) {
  const textarea = root.querySelector('[data-fb-caption]');
  const generateButton = root.querySelector('[data-fb-generate-caption]');

  if (textarea) {
    textarea.value = state.caption || '';
    textarea.disabled = !state.selectedProductId;
  }

  if (generateButton) {
    generateButton.disabled =
      !state.selectedProductId || state.generatingCaption;

    generateButton.textContent = state.generatingCaption
      ? 'Generating Caption...'
      : 'Generate Gemini Caption';
  }
}

// ========================================
// Generate Caption
// ========================================

async function generateCaption(root, state) {
  const productId = state.selectedProductId;

  if (!productId) {
    setFeedback(root, 'Please select a product first.', 'error');
    return;
  }

  state.generatingCaption = true;
  state.captionRequestId += 1;

  const requestId = state.captionRequestId;

  renderCaptionEditor(root, state);

  setFeedback(
    root,
    'Gemini is generating the Facebook caption...'
  );

  try {
    const result = await facebookApi.generateCaption(productId);

    // Ignore stale responses after product selection changes.
    if (
      state.selectedProductId !== productId ||
      state.captionRequestId !== requestId
    ) {
      return;
    }

    if (
      !result ||
      typeof result.caption !== 'string' ||
      !result.caption.trim()
    ) {
      throw new Error('Gemini returned an empty caption.');
    }

    state.caption = result.caption.trim();

    renderCaptionEditor(root, state);

    setFeedback(
      root,
      'Caption generated. You can edit it before publishing.',
      'success'
    );

  } catch (error) {
    if (
      state.selectedProductId === productId &&
      state.captionRequestId === requestId
    ) {
      setFeedback(
        root,
        error.message || 'Caption generation failed.',
        'error'
      );
    }

  } finally {
    if (state.captionRequestId === requestId) {
      state.generatingCaption = false;
      renderCaptionEditor(root, state);
    }
  }
}

// ========================================
// Product List
// ========================================

function renderProductList(root, products, selectedId = '') {
  const container = root.querySelector('[data-fb-products-list]');
  const count = root.querySelector('[data-fb-products-count]');

  if (!container) return;

  if (count) {
    count.textContent = `${products.length} eligible product(s)`;
  }

  if (!products.length) {
    container.innerHTML = `
      <div class="fb-empty-state">
        No eligible products found.
      </div>
    `;
    return;
  }

  container.innerHTML = products.map(product => {
    const id = escapeHtml(product.id);
    const name = escapeHtml(product.name || 'Unnamed product');
    const image = product.images?.[0];

    return `
      <article class="fb-product-card">

        ${
          image
            ? `
              <img
                class="fb-product-card-image"
                src="${escapeHtml(image.url)}"
                alt="${escapeHtml(image.alt || name)}"
                loading="lazy"
              >
            `
            : ''
        }

        <div class="fb-product-card-info">
          <h3>${name}</h3>

          <p class="fb-muted">
            SKU: ${escapeHtml(product.sku || 'N/A')}
          </p>

          <p>
            <strong>${escapeHtml(getProductPrice(product))}</strong>
          </p>

          <p class="fb-muted">
            Stock: ${Number(product.summary?.totalStock) || 0}
          </p>

          <button
            class="fb-button ${product.id === selectedId ? 'fb-button-primary' : ''}"
            type="button"
            data-fb-select-product="${id}"
            ${product.id === selectedId ? 'disabled' : ''}
          >
            ${product.id === selectedId ? 'Selected' : 'Select Product'}
          </button>
        </div>

      </article>
    `;
  }).join('');
}

// ========================================
// Load Products
// ========================================

async function loadProducts(root, state) {
  const loadButton = root.querySelector('[data-fb-load-products]');

  if (loadButton) {
    loadButton.disabled = true;
    loadButton.textContent = 'Loading Products...';
  }

  setFeedback(root, 'Loading eligible products...');

  try {
    const result = await facebookApi.getEligibleProducts({
      limit: 100
    });

    state.products = Array.isArray(result.products)
      ? result.products
      : [];

    // Clear selection if product is no longer eligible.
    if (
      state.selectedProductId &&
      !state.products.some(
        product => product.id === state.selectedProductId
      )
    ) {
      state.selectedProductId = '';
      state.caption = '';
      state.captionRequestId += 1;
      state.generatingCaption = false;
    }

    renderProductList(
      root,
      state.products,
      state.selectedProductId
    );

    const selectedProduct = state.products.find(
      product => product.id === state.selectedProductId
    );

    renderProductPreview(root, selectedProduct || null);
    renderCaptionEditor(root, state);

    setFeedback(
      root,
      `${state.products.length} eligible product(s) loaded.`,
      'success'
    );

  } catch (error) {
    setFeedback(root, error.message, 'error');

  } finally {
    if (loadButton) {
      loadButton.disabled = false;
      loadButton.textContent = 'Refresh Products';
    }
  }
}

// ========================================
// Render Facebook Posts Section
// ========================================

export function renderFacebookPosts() {
  return `
    <section class="fb-posts-layout">

      <article class="fb-card">

        <div class="fb-card-heading">
          <div>
            <span class="fb-eyebrow">PRODUCT CATALOG</span>
            <h2>Select Product for Facebook Post</h2>
          </div>

          <span data-fb-products-count>
            Not loaded
          </span>
        </div>

        <p class="fb-muted">
          Only active products with available stock and
          Cloudinary images are shown here.
        </p>

        <div class="fb-form-actions">
          <button
            class="fb-button fb-button-primary"
            type="button"
            data-fb-load-products
          >
            Load Products
          </button>
        </div>

        <p
          class="fb-feedback"
          data-fb-posts-feedback
          aria-live="polite"
        ></p>

        <div
          class="fb-products-list"
          data-fb-products-list
        >
          <div class="fb-empty-state">
            Click Load Products to get eligible products.
          </div>
        </div>

      </article>

      <article class="fb-card">

        <div class="fb-card-heading">
          <div>
            <span class="fb-eyebrow">PRODUCT DETAILS</span>
            <h2>Product Preview</h2>
          </div>
        </div>

        <div data-fb-product-preview>
          <div class="fb-empty-state">
            Select a product to see its details.
          </div>
        </div>

        <div class="fb-caption-section">

          <h3>Facebook Caption</h3>

          <p class="fb-muted">
            Generate a draft with Gemini, then review and edit it before publishing.
          </p>

          <div class="fb-form-actions">
            <button
              class="fb-button fb-button-primary"
              type="button"
              data-fb-generate-caption
              disabled
            >
              Generate Gemini Caption
            </button>
          </div>

          <label for="fb-post-caption">Caption text</label>

          <textarea
            id="fb-post-caption"
            data-fb-caption
            rows="12"
            placeholder="Select a product, then generate a caption..."
            disabled
          ></textarea>

        </div>

      </article>

    </section>
  `;
}

// ========================================
// Bind Facebook Posts Events
// ========================================

export function bindFacebookPostsEvents(root = document) {
  const state = {
    products: [],
    selectedProductId: '',
    caption: '',
    captionRequestId: 0,
    generatingCaption: false
  };

  const loadButton = root.querySelector('[data-fb-load-products]');

  if (loadButton && !loadButton.dataset.bound) {
    loadButton.dataset.bound = 'true';

    loadButton.addEventListener('click', () => {
      loadProducts(root, state);
    });
  }

  const productsContainer = root.querySelector(
    '[data-fb-products-list]'
  );

  if (
    productsContainer &&
    !productsContainer.dataset.bound
  ) {
    productsContainer.dataset.bound = 'true';

    productsContainer.addEventListener('click', event => {
      const button = event.target.closest(
        '[data-fb-select-product]'
      );

      if (!button) return;

      const productId = button.dataset.fbSelectProduct;

      const product = state.products.find(
        item => item.id === productId
      );

      if (!product) {
        setFeedback(
          root,
          'Selected product could not be found.',
          'error'
        );
        return;
      }

      state.selectedProductId = productId;
      state.caption = '';
      state.captionRequestId += 1;
      state.generatingCaption = false;

      renderProductList(
        root,
        state.products,
        state.selectedProductId
      );

      renderProductPreview(root, product);
      renderCaptionEditor(root, state);

      setFeedback(
        root,
        `${product.name} selected.`,
        'success'
      );
    });
  }

  const captionButton = root.querySelector(
    '[data-fb-generate-caption]'
  );

  if (captionButton && !captionButton.dataset.bound) {
    captionButton.dataset.bound = 'true';

    captionButton.addEventListener('click', () => {
      generateCaption(root, state);
    });
  }

  const captionTextarea = root.querySelector(
    '[data-fb-caption]'
  );

  if (captionTextarea && !captionTextarea.dataset.bound) {
    captionTextarea.dataset.bound = 'true';

    captionTextarea.addEventListener('input', () => {
      state.caption = captionTextarea.value;
    });
  }

  renderCaptionEditor(root, state);
}
