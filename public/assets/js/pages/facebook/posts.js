
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

  if (!Number.isFinite(amount)) return '৳0';

  return `৳${amount.toLocaleString('en-BD')}`;
}

function normalizeColor(value) {
  return String(value ?? '').trim().toLowerCase();
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

function getProductImages(product) {
  const images = Array.isArray(product.images)
    ? product.images
    : [];

  const postImages = Array.isArray(product.postImages)
    ? product.postImages
    : [];

  const source = postImages.length ? postImages : images;
  const seen = new Set();

  return source.filter(image => {
    const url = String(image?.url || '').trim();
    const color = String(image?.color || '').trim();

    if (!url || seen.has(url)) return false;

    if (image.isMain !== true && !color) return false;

    seen.add(url);
    return true;
  });
}

function getMainImage(product) {
  if (product.mainImage?.url) {
    return product.mainImage;
  }

  const images = Array.isArray(product.images)
    ? product.images
    : [];

  return (
    images.find(image => image.isMain === true) ||
    images[0] ||
    null
  );
}

function getVariantImage(variant, product) {
  if (variant.imageUrl) {
    return {
      url: variant.imageUrl,
      alt: `${variant.color || 'Default'} variant`
    };
  }

  if (Array.isArray(variant.images) && variant.images.length) {
    return variant.images[0];
  }

  const images = Array.isArray(product.images)
    ? product.images
    : [];

  const color = normalizeColor(variant.color);

  const matchingImage = images.find(image => (
    color && normalizeColor(image.color) === color
  ));

  return matchingImage || getMainImage(product);
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
// Facebook Pages
// ========================================

function normalizePages(result) {
  const pages = Array.isArray(result?.pages)
    ? result.pages
    : [];

  return pages.filter(page => (
    page &&
    String(page.pageId || '').trim() &&
    page.selected !== false
  ));
}

async function loadSelectedPages(root, state) {
  const select = root.querySelector('[data-fb-post-page]');

  if (!select) return;

  select.disabled = true;
  select.innerHTML = '<option value="">Loading Facebook Pages...</option>';

  try {
    const result = await facebookApi.getSelectedPages();

    state.pages = normalizePages(result);

    if (!state.pages.length) {
      select.innerHTML = `
        <option value="">No selected Facebook Page</option>
      `;

      state.selectedPageId = '';

      setFeedback(
        root,
        'No selected Facebook Page found. Select a Page in Facebook Settings first.',
        'error'
      );

      return;
    }

    const previousPageId = state.selectedPageId;

    const selectedPage = state.pages.find(
      page => page.pageId === previousPageId
    );

    state.selectedPageId = selectedPage
      ? selectedPage.pageId
      : state.pages[0].pageId;

    select.innerHTML = `
      <option value="">Choose a Facebook Page</option>

      ${state.pages.map(page => `
        <option
          value="${escapeHtml(page.pageId)}"
          ${page.pageId === state.selectedPageId ? 'selected' : ''}
        >
          ${escapeHtml(page.pageName || 'Facebook Page')}
        </option>
      `).join('')}
    `;

    setFeedback(
      root,
      `${state.pages.length} selected Facebook Page(s) available.`,
      'success'
    );

  } catch (error) {
    state.pages = [];
    state.selectedPageId = '';

    select.innerHTML = `
      <option value="">Unable to load Facebook Pages</option>
    `;

    setFeedback(
      root,
      error.message || 'Failed to load Facebook Pages.',
      'error'
    );

  } finally {
    select.disabled = false;
    updatePublishButton(root, state);
  }
}

// ========================================
// Publish Button State
// ========================================

function updatePublishButton(root, state) {
  const button = root.querySelector('[data-fb-publish]');

  if (!button) return;

  button.disabled = (
    !state.selectedProductId ||
    !state.selectedPageId ||
    !state.caption.trim() ||
    state.publishing
  );

  button.textContent = state.publishing
    ? 'Publishing to Facebook...'
    : 'Publish to Facebook';
}

// ========================================
// Publish Product
// ========================================

async function publishProduct(root, state) {
  if (state.publishing) return;

  const productId = state.selectedProductId;
  const pageId = state.selectedPageId;
  const caption = state.caption.trim();

  if (!productId) {
    setFeedback(root, 'Please select a product first.', 'error');
    return;
  }

  if (!pageId) {
    setFeedback(root, 'Please select a Facebook Page.', 'error');
    return;
  }

  if (!caption) {
    setFeedback(root, 'Please write a Facebook caption.', 'error');
    return;
  }

  const page = state.pages.find(item => item.pageId === pageId);
  const product = state.products.find(item => item.id === productId);

  const confirmed = window.confirm(
    `Publish "${product?.name || 'this product'}" to "${page?.pageName || 'Facebook Page'}"?\n\n` +
    'The backend will use the selected product images and your approved caption.\n\n' +
    'This action will create a real Facebook post.'
  );

  if (!confirmed) return;

  state.publishing = true;
  updatePublishButton(root, state);

  setFeedback(
    root,
    'Publishing product images and caption to Facebook. Please wait...'
  );

  try {
    const result = await facebookApi.publishProductPost(
      productId,
      pageId,
      caption
    );

    if (!result?.postId) {
      throw new Error(
        'Facebook response did not include a Post ID. Check Facebook before retrying to avoid duplicate posts.'
      );
    }

    const postLink = result.postId.includes('_')
      ? `https://www.facebook.com/${encodeURIComponent(result.postId)}`
      : '';

    setFeedback(
      root,
      `Published successfully! Post ID: ${result.postId}. Images: ${result.imageCount || 0}.`,
      'success'
    );

    const resultContainer = root.querySelector(
      '[data-fb-publish-result]'
    );

    if (resultContainer) {
      resultContainer.innerHTML = `
        <strong>Facebook post published successfully.</strong>
        <p>Post ID: ${escapeHtml(result.postId)}</p>
        <p>Images: ${Number(result.imageCount) || 0}</p>
        ${
          postLink
            ? `
              <a
                href="${escapeHtml(postLink)}"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Facebook Post
              </a>
            `
            : ''
        }
      `;
    }

  } catch (error) {
    setFeedback(
      root,
      error.message || 'Facebook publishing failed.',
      'error'
    );

  } finally {
    state.publishing = false;
    updatePublishButton(root, state);
  }
}

// ========================================
// Product Image Gallery
// ========================================

function renderProductGallery(product) {
  const images = getProductImages(product);
  const mainImage = getMainImage(product);

  const displayImages = [];

  if (mainImage?.url) {
    displayImages.push(mainImage);
  }

  for (const image of images) {
    if (
      image?.url &&
      !displayImages.some(item => item.url === image.url)
    ) {
      displayImages.push(image);
    }
  }

  if (!displayImages.length) return '';

  const galleryHtml = displayImages.map((image, index) => `
    <div class="fb-post-image-item">
      <img
        src="${escapeHtml(image.url)}"
        alt="${escapeHtml(image.alt || product.name)}"
        loading="lazy"
      >

      <span class="fb-post-image-label">
        ${index === 0 ? 'Main Image' : `Post Image ${index + 1}`}
      </span>
    </div>
  `).join('');

  return `
    <div class="fb-post-gallery-section">
      <h4>Facebook Post Images</h4>

      <p class="fb-muted">
        ${displayImages.length} image(s) will be included in the post.
      </p>

      <div class="fb-post-image-gallery">
        ${galleryHtml}
      </div>
    </div>
  `;
}

// ========================================
// Variant Preview
// ========================================

function renderVariantPreview(variant, product) {
  const color = variant.color || 'Default';
  const size = variant.size || 'Standard';

  const image = getVariantImage(variant, product);

  const regularPrice = Number(variant.regularPrice);
  const sellingPrice = Number(variant.sellingPrice);

  const hasRegularPrice =
    Number.isFinite(regularPrice) && regularPrice > 0;

  const hasSellingPrice =
    Number.isFinite(sellingPrice) && sellingPrice > 0;

  const hasDiscount =
    hasRegularPrice &&
    hasSellingPrice &&
    regularPrice > sellingPrice;

  const imageHtml = image?.url
    ? `
      <img
        class="fb-variant-preview-image"
        src="${escapeHtml(image.url)}"
        alt="${escapeHtml(`${color} ${size}`)}"
        loading="lazy"
      >
    `
    : `
      <div class="fb-variant-image-placeholder">
        No image
      </div>
    `;

  const priceHtml = hasSellingPrice
    ? `
      <div class="fb-variant-price">
        ${
          hasDiscount
            ? `
              <span class="fb-variant-regular-price">
                ${escapeHtml(formatMoney(regularPrice))}
              </span>
            `
            : ''
        }

        <strong class="fb-variant-selling-price">
          ${escapeHtml(formatMoney(sellingPrice))}
        </strong>
      </div>
    `
    : '<strong class="fb-muted">Price unavailable</strong>';

  return `
    <div class="fb-product-variant">
      ${imageHtml}

      <div class="fb-product-variant-info">
        <strong>
          ${escapeHtml(color)} / ${escapeHtml(size)}
        </strong>

        ${priceHtml}
      </div>
    </div>
  `;
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

  const mainImage = getMainImage(product);

  const imageHtml = mainImage?.url
    ? `
      <img
        class="fb-product-preview-image"
        src="${escapeHtml(mainImage.url)}"
        alt="${escapeHtml(mainImage.alt || product.name)}"
        loading="lazy"
      >
    `
    : '';

  const variants = Array.isArray(product.variants)
    ? product.variants.filter(variant => (
        variant.isActive === true &&
        Number(variant.stock) > 0
      ))
    : [];

  const variantHtml = variants.map(variant => (
    renderVariantPreview(variant, product)
  )).join('');

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
            Overall price range:
            ${escapeHtml(getProductPrice(product))}
          </strong>
        </p>

        <p>${escapeHtml(product.shortDescription || '')}</p>

        <h4>Variant-wise Price</h4>

        <div class="fb-product-variants">
          ${
            variantHtml ||
            '<p class="fb-muted">No available variants.</p>'
          }
        </div>

        ${renderProductGallery(product)}

      </div>
    </div>
  `;
}

// ========================================
// Caption Editor
// ========================================

function renderCaptionEditor(root, state) {
  const textarea = root.querySelector('[data-fb-caption]');

  const generateButton = root.querySelector(
    '[data-fb-generate-caption]'
  );

  if (textarea) {
    textarea.value = state.caption || '';
    textarea.disabled = !state.selectedProductId;
  }

  if (generateButton) {
    generateButton.disabled =
      !state.selectedProductId ||
      state.generatingCaption;

    generateButton.textContent = state.generatingCaption
      ? 'Generating Caption...'
      : 'Generate Gemini Caption';
  }

  updatePublishButton(root, state);
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

  setFeedback(root, 'Gemini is generating the Facebook caption...');

  try {
    const result = await facebookApi.generateCaption(productId);

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

    // Remove stock information while preserving variant and price.
state.caption = result.caption
  .replace(/\s*\|\s*Stock\s*:\s*\d+/gi, '')
  .replace(/^\s*Stock\s*:\s*\d+\s*$/gim, '')
  .trim();

    renderCaptionEditor(root, state);

    setFeedback(
      root,
      'Caption generated. Review and edit it before publishing.',
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
    const image = getMainImage(product);

    return `
      <article class="fb-product-card">

        ${
          image?.url
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

          <span data-fb-products-count>Not loaded</span>
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

          <div class="fb-publish-section">

            <h3>Publish to Facebook</h3>

            <label for="fb-post-page">
              Facebook Page
            </label>

            <select
              id="fb-post-page"
              data-fb-post-page
              disabled
            >
              <option value="">Loading Facebook Pages...</option>
            </select>

            <div class="fb-form-actions">
              <button
                class="fb-button fb-button-primary"
                type="button"
                data-fb-publish
                disabled
              >
                Publish to Facebook
              </button>
            </div>

            <div
              class="fb-publish-result"
              data-fb-publish-result
              aria-live="polite"
            ></div>

          </div>

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
    pages: [],
    selectedProductId: '',
    selectedPageId: '',
    caption: '',
    captionRequestId: 0,
    generatingCaption: false,
    publishing: false
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

  if (productsContainer && !productsContainer.dataset.bound) {
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
        setFeedback(root, 'Selected product could not be found.', 'error');
        return;
      }

      state.selectedProductId = productId;
      state.caption = '';
      state.captionRequestId += 1;
      state.generatingCaption = false;

      const resultContainer = root.querySelector(
        '[data-fb-publish-result]'
      );

      if (resultContainer) resultContainer.innerHTML = '';

      renderProductList(
        root,
        state.products,
        state.selectedProductId
      );

      renderProductPreview(root, product);
      renderCaptionEditor(root, state);

      setFeedback(root, `${product.name} selected.`, 'success');
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

  const captionTextarea = root.querySelector('[data-fb-caption]');

  if (captionTextarea && !captionTextarea.dataset.bound) {
    captionTextarea.dataset.bound = 'true';

    captionTextarea.addEventListener('input', () => {
      state.caption = captionTextarea.value;
      updatePublishButton(root, state);
    });
  }

  const pageSelect = root.querySelector('[data-fb-post-page]');

  if (pageSelect && !pageSelect.dataset.bound) {
    pageSelect.dataset.bound = 'true';

    pageSelect.addEventListener('change', () => {
      state.selectedPageId = pageSelect.value;
      updatePublishButton(root, state);
    });
  }

  const publishButton = root.querySelector('[data-fb-publish]');

  if (publishButton && !publishButton.dataset.bound) {
    publishButton.dataset.bound = 'true';

    publishButton.dataset.bound = 'true';

    publishButton.addEventListener('click', () => {
      publishProduct(root, state);
    });
  }

  renderCaptionEditor(root, state);

  // Load selected Pages when the Posts section opens.
  loadSelectedPages(root, state);
}
