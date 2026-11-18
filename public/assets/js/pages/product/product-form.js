'use strict';

import {
  renderProductBasic,
  bindProductBasicEvents
} from './product-basic.js';
import {
  initProductCategory,
  validateProductCategory,
  getProductCategoryData,
  setProductCategoryData,
  cleanupProductCategory
} from './product-category.js';

import {
  initProductPricing,
  getProductPricingData,
  setProductPricingData,
  validateProductPricing
} from './product-pricing.js';

import {
  initProductVariants,
  getProductVariantsData,
  setProductVariantsData,
  validateProductVariants
} from './product-variants.js';

import {
  initProductInventory,
  getProductInventoryData,
  setProductInventoryData,
  validateProductInventory,
  cleanupProductInventory
} from './product-inventory.js';

import {
  initProductImages,
  getProductImagesData,
  setProductImagesData,
  validateProductImages
} from './product-images.js';

import {
  initProductDescription,
  getProductDescriptionData,
  setProductDescriptionData,
  validateProductDescription
} from './product-description.js';

import {
  initProductSEO,
  getProductSEOData,
  setProductSEOData,
  validateProductSEO
} from './product-seo.js';

import {
  initProductCost,
  getProductCostData,
  setProductCostData,
  validateProductCost,
  loadProductCost
} from './product-cost.js';

import {
  initProductFlags,
  getProductFlagsData,
  setProductFlagsData,
  validateProductFlags
} from './product-flags.js';

import {
  initProductReview,
  renderProductReview,
  getProductReviewData,
  setProductReviewData,
  validateProductReview
} from './product-review.js';

import { initProductAI } from './product-ai.js';

import {
  initProductLots,
  loadProductLots,
  resetProductLots
} from './lot/product-lots.js';

import {
  initLotCreate,
  setLotCreateProductId,
  setLotCreatePreferredLotId,
  resetLotCreate
} from './lot/lot-create.js';

import {
  initLotVariants,
  resetLotVariants
} from './lot/lot-variants.js';

import {
  initLotCost,
  resetLotCost
} from './lot/lot-history.js';

import {
  initLotHistory,
  resetLotHistory
} from './lot/lot-cost.js';

import {
  getProductElement,
  showProductMessage,
  productApiRequest,
  setProductButtonLoading
} from './product-utils.js';

// ========================================
// STATE
// ========================================

let initialized = false;
let currentProductId = null;
let activeContainer = null;
let basicEventsCleanup = null;
let isSaving = false;

// ========================================
// HTML HELPERS
// ========================================

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function field({
  id,
  label,
  type = 'text',
  placeholder = '',
  value = '',
  min,
  max,
  step,
  required = false,
  readonly = false,
  help = ''
}) {
  const attributes = [
    `id="${id}"`,
    `name="${id}"`,
    `type="${type}"`,
    `placeholder="${escapeHTML(placeholder)}"`,
    required ? 'required' : '',
    readonly ? 'readonly' : '',
    min !== undefined ? `min="${min}"` : '',
    max !== undefined ? `max="${max}"` : '',
    step !== undefined ? `step="${step}"` : ''
  ].filter(Boolean).join(' ');

  return `
    <div class="form-group">
      <label for="${id}">${label}</label>
      <input class="form-control" ${attributes}
        value="${escapeHTML(value)}">
      ${help ? `<small class="form-help">${help}</small>` : ''}
    </div>
  `;
}

function textarea({
  id,
  label,
  placeholder = '',
  rows = 4,
  value = '',
  maxlength = ''
}) {
  return `
    <div class="form-group">
      <label for="${id}">${label}</label>
      <textarea
        class="form-control"
        id="${id}"
        name="${id}"
        rows="${rows}"
        placeholder="${escapeHTML(placeholder)}"
        ${maxlength ? `maxlength="${maxlength}"` : ''}
      >${escapeHTML(value)}</textarea>
    </div>
  `;
}

function selectField(id, label, placeholder) {
  return `
    <div class="form-group">
      <label for="${id}">${label}</label>
      <select class="form-control" id="${id}" name="${id}">
        <option value="">${placeholder}</option>
      </select>
    </div>
  `;
}

function choiceField(id, label, options, placeholder = 'Select an option') {
  return `
    <div class="form-group">
      <label for="${id}">${label}</label>
      <select class="form-control" id="${id}" name="${id}">
        <option value="">${escapeHTML(placeholder)}</option>
        ${options.map(option => `
          <option value="${escapeHTML(option)}">${escapeHTML(option)}</option>
        `).join('')}
      </select>
    </div>
  `;
}

function checkboxField(id, label) {
  return `
    <label class="form-checkbox" for="${id}">
      <input type="checkbox" id="${id}" name="${id}">
      <span>${label}</span>
    </label>
  `;
}

function section(title, description, content, id = '') {
  return `
    <section class="product-form-section" ${id ? `id="${id}"` : ''}>
      <div class="product-section-header">
        <h3>${title}</h3>
        ${description ? `<p>${description}</p>` : ''}
      </div>
      <div class="product-section-content">
        ${content}
      </div>
    </section>
  `;
}

// ========================================
// PRODUCT FORM HTML
// ========================================

function renderProductFormMarkup() {
  return `
    <div class="product-form-page" id="product-form-page">

      <div class="product-form-header">
        <div>
          <h2 id="product-form-title">Create Product</h2>
          <p>Manage product details, variants, pricing and inventory.</p>
        </div>
      </div>

      <form id="product-form" novalidate>

        <input type="hidden" id="product-id" name="productId" value="">

        <div id="product-form-message" aria-live="polite"></div>

        <!-- BASIC INFORMATION -->
        <div id="product-basic-mount"></div>

        <!-- CATEGORY -->
        ${section(
          'Product Taxonomy',
          'A product can be assigned to multiple collection, category and subcategory paths.',
          `
            <div id="product-taxonomy-list"></div>

            <button type="button" class="btn btn-secondary"
              id="add-product-taxonomy">
              + Add category
            </button>
          `,
          'product-category-section'
        )}

        <!-- PRICING -->
        ${section(
          'Pricing',
          'Set regular price and selling price.',
          `
            <div class="product-form-grid">
              ${field({
                id: 'product-regular-price',
                label: 'Regular Price',
                type: 'number',
                placeholder: '0.00',
                min: '0',
                step: '0.01',
                required: true
              })}

              ${field({
                id: 'product-selling-price',
                label: 'Selling Price',
                type: 'number',
                placeholder: '0.00',
                min: '0',
                step: '0.01',
                required: true
              })}

              ${field({
                id: 'product-discount-percent',
                label: 'Discount (%)',
                type: 'number',
                placeholder: '0',
                readonly: true
              })}
            </div>
          `,
          'product-pricing-section'
        )}

        <!-- VARIANTS -->
        ${section(
          'Product Variants',
          'The same color can have different sizes, stock, prices and buy costs.',
          `
            <div id="product-variants-container"></div>

            <button
              type="button"
              class="btn btn-secondary"
              id="add-product-variant">
              + Add Variant
            </button>
          `,
          'product-variants-section'
        )}

        <!-- INVENTORY -->
        ${section(
          'Inventory Summary',
          'Stock values are managed by the inventory system.',
          `
            <div id="product-inventory-container">
              <div class="product-form-grid">
                ${field({
                  id: 'product-total-stock',
                  label: 'Total Stock',
                  type: 'number',
                  min: '0',
                  step: '1',
                  help: 'Editable only when no product variants exist.'
                })}

                ${field({
                  id: 'product-low-stock-count',
                  label: 'Low Stock Variants',
                  type: 'number',
                  min: '0',
                  step: '1',
                  help: 'Calculated automatically when variants exist.'
                })}

                ${field({
                  id: 'product-stock-status',
                  label: 'Stock Status (true / false)',
                  readonly: true
                })}
              </div>
            </div>
          `,
          'product-inventory-section'
        )}

        <!-- IMAGES -->
        ${section(
          'Product Images',
          'Upload product photos using the configured image service.',
          `
            <input
              type="file"
              id="product-image-input"
              accept="image/jpeg,image/png,image/webp"
              multiple
              hidden>

            <div id="product-image-container"></div>

            <div class="product-image-actions">
              <button
                type="button"
                class="btn btn-secondary"
                id="product-image-upload">
                Upload Images
              </button>

              <button
                type="button"
                class="btn btn-primary"
                id="product-image-cloudinary">
                Choose from Cloudinary
              </button>
            </div>

            <small class="form-help">
              JPG, PNG or WebP. Maximum 5 MB per image.
            </small>
          `,
          'product-images-section'
        )}

        <div class="product-modal-overlay"
          id="cloudinary-image-modal" hidden>
          <div class="product-modal cloudinary-library-modal"
            role="dialog" aria-modal="true"
            aria-labelledby="cloudinary-image-title">

            <div class="product-modal-header cloudinary-library-header">
              <div>
                <h3 id="cloudinary-image-title">Cloudinary Images</h3>
                <p>Select existing images from your Cloudinary library.</p>
              </div>

              <button type="button" class="cloudinary-library-close"
                id="cloudinary-image-close"
                aria-label="Close Cloudinary images">×</button>
            </div>

            <div class="cloudinary-library-body">
              <p class="cloudinary-library-status"
                id="cloudinary-image-status">Loading images...</p>

              <div class="cloudinary-library-grid"
                id="cloudinary-image-grid"></div>
            </div>

            <div class="cloudinary-library-actions">
              <button type="button" class="btn btn-secondary"
                id="cloudinary-image-cancel">Cancel</button>

              <button type="button" class="btn btn-primary"
                id="cloudinary-image-add" disabled>Add Selected</button>
            </div>
          </div>
        </div>

        <!-- DESCRIPTION -->
        ${section(
          'Description & Attributes',
          'Add descriptions and product information.',
          `
            ${textarea({
              id: 'product-short-description',
              label: 'Short Description',
              placeholder: 'Short product introduction',
              rows: 3,
              maxlength: 300
            })}

            <small id="product-short-description-counter">0 / 300</small>

            ${textarea({
              id: 'product-description',
              label: 'Full Description',
              placeholder: 'Write full product details',
              rows: 8
            })}

            <small id="product-description-counter">0 / 10000</small>

            <div class="product-form-grid">
              ${choiceField('product-fabric-type', 'Fabric Type', [
                'Cotton', 'Linen', 'Denim', 'Silk', 'Polyester',
                'Viscose/Rayon', 'Wool', 'Knit', 'Georgette',
                'Chiffon', 'Mixed Fabric'
              ])}

              ${choiceField('product-fit', 'Fit', [
                'Regular Fit', 'Slim Fit', 'Relaxed Fit',
                'Oversized Fit', 'Tailored Fit'
              ])}

              ${choiceField('product-sleeve-type', 'Sleeve Type', [
                'Sleeveless', 'Short Sleeve', 'Half Sleeve',
                'Three Quarter Sleeve', 'Full Sleeve'
              ])}

              ${choiceField('product-wash-care', 'Wash Care', [
                'Machine Wash', 'Hand Wash', 'Gentle Cycle',
                'Cold Wash', 'Dry Clean Only'
              ])}
            </div>

            ${field({
              id: 'product-tags',
              label: 'Tags',
              placeholder: 'shirt, casual, cotton'
            })}
          `,
          'product-description-section'
        )}

        <!-- AI -->
        ${section(
          'AI Product Assistant',
          'Fill only product content, attributes, SEO and category suggestions.',
          `
            <div class="product-ai-actions">
              <button type="button" class="btn btn-secondary"
                id="product-ai-generate-all">
                Generate Product Info with AI
              </button>
            </div>

            <div id="product-ai-preview" hidden>
              <div id="product-ai-preview-content"></div>

              <button type="button" class="btn btn-primary"
                id="product-ai-accept">Apply Suggestion</button>
              <button type="button" class="btn btn-secondary"
                id="product-ai-reject">Reject</button>
            </div>
          `,
          'product-ai-section'
        )}

        <!-- SEO -->
        ${section(
          'SEO',
          'Search engine title, description and URL slug.',
          `
            ${field({
              id: 'product-slug',
              label: 'Product Slug',
              placeholder: 'auto-generated-from-product-name',
              readonly: true,
              help: 'SEO-friendly and generated automatically from Product Name.'
            })}

            ${field({
              id: 'product-meta-title',
              label: 'Meta Title',
              placeholder: 'SEO title',
              max: '60'
            })}

            <small id="product-meta-title-counter">0 / 60</small>

            ${textarea({
              id: 'product-meta-description',
              label: 'Meta Description',
              placeholder: 'SEO description',
              rows: 3,
              maxlength: 160
            })}

            <small id="product-meta-description-counter">0 / 160</small>
          `,
          'product-seo-section'
        )}

        <!-- PRODUCT COST -->
        ${section(
          'Product Cost',
          'Private purchase cost information.',
          `
            <div id="product-cost-container">
              <div class="product-form-grid">
                ${field({
                  id: 'product-buy-price',
                  label: 'Purchase Cost',
                  type: 'number',
                  placeholder: '0.00',
                  min: '0',
                  step: '0.01',
                  help: 'Product buy price. A variant may override this cost.'
                })}

                ${field({
                  id: 'product-supplier',
                  label: 'Supplier',
                  placeholder: 'Supplier name'
                })}
              </div>

              ${textarea({
                id: 'product-purchase-note',
                label: 'Purchase Note',
                placeholder: 'Private notes',
                rows: 3
              })}
            </div>
          `,
          'product-cost-section'
        )}

        <!-- FLAGS -->
        ${section(
          'Product Status & Promotion',
          'Choose product promotion flags.',
          `
            <div class="product-flags">
              ${checkboxField(
                'product-is-new-arrival',
                'New Arrival'
              )}

              ${checkboxField(
                'product-is-featured',
                'Featured Product'
              )}

              ${checkboxField(
                'product-is-best-seller',
                'Best Seller'
              )}
            </div>
          `,
          'product-flags-section'
        )}

        <!-- REVIEW -->
        ${section(
          'Product Reviews',
          'Review summary and sales information.',
          `
            <div id="product-review-container">
              <div class="product-review-summary">
                <div>
                  <span>Average Rating</span>
                  <strong id="product-review-average">0.0</strong>
                </div>

                <div>
                  <span>Review Count</span>
                  <strong id="product-review-count">0</strong>
                </div>

                <div>
                  <span>Sold Count</span>
                  <strong id="product-review-sold-count">0</strong>
                </div>
              </div>

              <div id="product-review-breakdown"></div>
            </div>
          `,
          'product-review-section'
        )}

        <!-- PURCHASE LOTS -->
        ${section(
          'Purchase Lots',
          'Purchase batches and lot history for this product.',
          `
            <div class="product-lots-toolbar">
              <button
                type="button"
                class="btn btn-primary"
                id="product-lot-create">
                + Create / Add Lot
              </button>
            </div>

            <div id="product-lots-container"></div>
          `,
          'product-lots-section'
        )}

        <!-- LOT CREATE MODAL -->
        <div class="product-modal-overlay" id="lot-create-modal" hidden>
          <div class="product-modal" role="dialog"
            aria-modal="true" aria-labelledby="lot-create-title">

            <div class="product-modal-header">
              <h3 id="lot-create-title">Create or Add to Purchase Lot</h3>
            </div>

            <div id="lot-create-form">
              <div class="form-group">
                <label for="lot-existing-lot">
                  Existing Purchase Lot (Optional)
                </label>

                <select class="form-control" id="lot-existing-lot">
                  <option value="">Create a new Lot</option>
                </select>

                <small class="form-help">
                  পুরোনো Lot নির্বাচন করলে এই Product-এর stock সেই Lot-এ যোগ হবে।
                </small>
              </div>

              ${field({
                id: 'lot-name',
                label: 'Lot Name',
                placeholder: 'Example: Eid Collection - 01',
                required: true
              })}

              <div class="lot-variants-section">
                <h4>Add Stock Quantity</h4>
                <p class="lot-stock-help">
                  Current stock and average buy rate are read-only. Enter the new stock buy rate and quantity.
                </p>

                <div id="lot-variants-container"></div>

                ${field({
                  id: 'lot-total-quantity',
                  label: 'Total Lot Quantity',
                  type: 'number',
                  readonly: true
                })}
              </div>

              <div class="lot-cost-section">
                <h4>Lot Costs</h4>

                ${field({
                  id: 'lot-purchase-cost',
                  label: 'Purchase Cost',
                  type: 'number',
                  min: '0',
                  step: '0.01',
                  readonly: true,
                  help: 'Product/Variant buy price × purchase quantity.'
                })}

                ${field({
                  id: 'lot-transport-cost',
                  label: 'Transport Cost',
                  type: 'number',
                  min: '0',
                  step: '0.01'
                })}

                ${field({
                  id: 'lot-other-cost',
                  label: 'Other Cost',
                  type: 'number',
                  min: '0',
                  step: '0.01'
                })}

                ${field({
                  id: 'lot-total-cost',
                  label: 'Total Lot Cost',
                  type: 'number',
                  readonly: true
                })}

              </div>

              <div class="product-modal-actions">
                <button type="button" class="btn btn-secondary"
                  id="lot-create-cancel">
                  Cancel
                </button>

                <button type="button" class="btn btn-primary"
                  id="lot-create-submit">
                  Create Lot
                </button>
              </div>
            </div>
          </div>
        </div>

        <!-- LOT EDIT MODAL -->
        <div class="product-modal-overlay" id="lot-edit-modal" hidden
          aria-hidden="true">
          <div class="product-modal product-lot-edit-modal" role="dialog"
            aria-modal="true" aria-labelledby="lot-edit-title">

            <div class="product-modal-header">
              <h3 id="lot-edit-title">Edit Purchase Lot</h3>
              <p>Lot name and additional costs can be updated here.</p>
            </div>

            <div id="lot-edit-form">
              ${field({
                id: 'lot-edit-name',
                label: 'Lot Name',
                placeholder: 'Lot name',
                required: true
              })}

              ${field({
                id: 'lot-edit-purchase-cost',
                label: 'Purchase Cost',
                type: 'number',
                min: '0',
                step: '0.01',
                readonly: true,
                help: 'Calculated from Product/Variant buy price.'
              })}

              ${field({
                id: 'lot-edit-transport-cost',
                label: 'Transport Cost',
                type: 'number',
                min: '0',
                step: '0.01'
              })}

              ${field({
                id: 'lot-edit-other-cost',
                label: 'Other Cost',
                type: 'number',
                min: '0',
                step: '0.01'
              })}

              ${textarea({
                id: 'lot-edit-note',
                label: 'Note',
                placeholder: 'Optional lot note',
                rows: 3,
                maxlength: 1000
              })}

              <div class="product-modal-actions">
                <button type="button" class="btn btn-secondary"
                  id="lot-edit-cancel">Cancel</button>

                <button type="button" class="btn btn-primary"
                  id="lot-edit-submit">Save Lot Changes</button>
              </div>
            </div>
          </div>
        </div>

        <!-- LOT HISTORY MODAL -->
        <div class="product-modal-overlay" id="lot-history-modal" hidden>
          <div class="product-modal" role="dialog"
            aria-modal="true">

            <div class="product-modal-header">
              <h3 id="lot-history-title">Lot History</h3>
              <p id="lot-history-subtitle"></p>
            </div>

            <div class="lot-history-toolbar">
              <input type="search"
                id="lot-history-search"
                placeholder="Search history">

              <select id="lot-history-type-filter">
                <option value="">All Events</option>
              </select>

              <button type="button" id="lot-history-refresh">
                Refresh
              </button>

              <button type="button" id="lot-history-close">
                Close
              </button>
            </div>

            <div id="lot-history-content"></div>
          </div>
        </div>

        <!-- FORM ACTIONS -->
        <div class="product-form-actions">
          <button type="button" class="btn btn-secondary"
            id="product-form-reset">
            Reset
          </button>

          <button type="submit" class="btn btn-primary"
            id="product-form-submit">
            Create Product
          </button>
        </div>

      </form>
    </div>
  `;
}

// ========================================
// RENDER PRODUCT FORM
// ========================================

export function renderProductForm(options = {}) {
  const wrapper = document.createElement('div');

  wrapper.innerHTML = renderProductFormMarkup();

  const mount = wrapper.querySelector('#product-basic-mount');

  if (mount) {
    mount.appendChild(
      renderProductBasic(
        {
          ...(options.product || {}),
          ...(options.product?.basic || {})
        }
      )
    );
  }

  return wrapper.firstElementChild;
}

// ========================================
// INIT PRODUCT FORM
// ========================================

function hydrateProductModules(product = {}) {
  const variants = Array.isArray(product.variants)
    ? product.variants
    : [];
  const descriptionData =
    product.description && typeof product.description === 'object'
      ? product.description
      : product;

  setProductCategoryData(
    product.category || product.taxonomy || product
  );
  setProductPricingData(product.pricing || product);
  setProductVariantsData(variants);
  setProductInventoryData({
    ...(product.inventory || product),
    variants
  });
  setProductImagesData(product.images || []);
  setProductDescriptionData(descriptionData);
  setProductSEOData(product.seo || product);
  setProductCostData(product.cost || product);
  setProductFlagsData(product.flags || product);
  setProductReviewData(product.review || product);
  renderProductReview();
}

export async function initProductForm({
  container,
  productId = null,
  lotId = null,
  product = {},
  existingSlugs = []
} = {}) {
  if (!container) {
    console.warn('[PRODUCT FORM] Container missing.');
    return false;
  }

  if (initialized && activeContainer === container) {
    return true;
  }

  activeContainer = container;
  currentProductId = productId || null;

  const form = container.querySelector('#product-form');
  const idInput = container.querySelector('#product-id');
  const resetButton = container.querySelector('#product-form-reset');
  const submitButton = container.querySelector('#product-form-submit');

  if (idInput) {
    idInput.value = currentProductId || '';
  }

  const title = container.querySelector('#product-form-title');

  if (title) {
    title.textContent = currentProductId
      ? 'Edit Product'
      : 'Create Product';
  }

  if (form) {
    form.addEventListener('submit', handleFormSubmit);
  }

  if (resetButton) {
    resetButton.addEventListener('click', handleReset);
  }

  if (submitButton) {
    submitButton.type = 'submit';
    submitButton.textContent = currentProductId
      ? 'Save Changes'
      : 'Create Product';
  }

  initProductPricing({ force: true });
  initProductVariants({ force: true });
  initProductInventory({ force: true });
  initProductImages({ force: true });
  initProductDescription({ force: true });
  initProductSEO({ force: true });
  initProductCost({ force: true });
  initProductFlags({ force: true });
  initProductReview({ force: true });
  initProductAI({ force: true });

  initProductLots({ force: true });
  initLotVariants({ force: true });
  initLotCost({ force: true });
  initLotHistory({ force: true });
  initLotCreate({
    force: true,
    ensureProductSaved: () => saveProductForm({
      showSuccess: false
    })
  });
  setLotCreateProductId(currentProductId);
  setLotCreatePreferredLotId(lotId);

  await initProductCategory({ force: true });

  hydrateProductModules(product || {});

  if (currentProductId) {
    await loadProductCost(currentProductId);
  }

  basicEventsCleanup?.();
  basicEventsCleanup = bindProductBasicEvents(container, {
    existingSlugs,
    currentSlug:
      product?.seo?.slug || product?.basic?.slug || product?.slug || ''
  });

  if (currentProductId) {
    loadProductLots(currentProductId).catch(error => {
      console.warn('[PRODUCT FORM] Lots could not be loaded.', error);
    });
  } else {
    resetProductLots();
  }

  if (lotId) {
    container.dataset.lotId = String(lotId);
  }

  initialized = true;

  return true;
}

// ========================================
// VALIDATE FORM
// ========================================

export function validateProductForm() {
  const validators = [
    validateProductCategory,
    validateProductPricing,
    validateProductVariants,
    validateProductInventory,
    validateProductImages,
    validateProductDescription,
    validateProductSEO,
    validateProductCost,
    validateProductFlags,
    validateProductReview
  ];

  for (const validator of validators) {
    if (typeof validator !== 'function') continue;

    try {
      const result = validator();

      if (result === false) {
        return false;
      }
    } catch (error) {
      console.error('[PRODUCT FORM VALIDATION]', error);
      return false;
    }
  }

  return true;
}

// ========================================
// SUBMIT
// ========================================

async function handleFormSubmit(event) {
  event.preventDefault();

  await saveProductForm();
}

export async function saveProductForm({
  showSuccess = true,
  redirectToIndex = showSuccess
} = {}) {

  if (isSaving) return false;

  if (!validateProductForm()) {
    showProductMessage(
      'Product form-এর কিছু তথ্য সঠিক নয়। যাচাই করে আবার চেষ্টা করুন।',
      'warning'
    );
    return false;
  }

  const submitButton = activeContainer?.querySelector(
    '#product-form-submit'
  );
  const isUpdate = Boolean(currentProductId);
  const payload = getProductSavePayload();

  isSaving = true;
  setProductButtonLoading(
    submitButton,
    true,
    isUpdate ? 'Saving Changes...' : 'Creating Product...'
  );

  try {
    const result = await productApiRequest(
      isUpdate
        ? `/api/products/${encodeURIComponent(currentProductId)}`
        : '/api/products',
      {
        method: isUpdate ? 'PATCH' : 'POST',
        body: JSON.stringify(payload)
      }
    );

    const savedProduct =
      result.product ||
      result.data?.product ||
      result.data;
    const savedProductId = String(
      savedProduct?.id ||
      savedProduct?.productId ||
      currentProductId ||
      ''
    );

    if (!savedProductId) {
      throw new Error('Saved Product ID পাওয়া যায়নি।');
    }

    currentProductId = savedProductId;
    setLotCreateProductId(savedProductId);

    const idInput = activeContainer?.querySelector('#product-id');
    const title = activeContainer?.querySelector('#product-form-title');
    const skuInput = activeContainer?.querySelector('#product-sku');
    const codeInput = activeContainer?.querySelector('#product-code');
    const slugInput = activeContainer?.querySelector('#product-slug');
    const savedSlug = savedProduct?.slug || savedProduct?.seo?.slug;

    if (idInput) idInput.value = savedProductId;
    if (activeContainer) activeContainer.dataset.productId = savedProductId;
    if (title) title.textContent = 'Edit Product';
    if (skuInput && savedProduct?.sku) skuInput.value = savedProduct.sku;
    if (codeInput && savedProduct?.productCode) {
      codeInput.value = savedProduct.productCode;
    }
    if (slugInput && savedSlug) {
      slugInput.value = savedSlug;
      slugInput.dataset.currentSlug = savedSlug;
    }

    if (showSuccess) {
      showProductMessage(
        isUpdate
          ? 'Product সফলভাবে update হয়েছে।'
          : 'Product সফলভাবে save হয়েছে। এখন Purchase Lot তৈরি করা যাবে।',
        'success',
        5000
      );
    }

    document.dispatchEvent(new CustomEvent('product:saved', {
      detail: {
        isUpdate,
        redirectToIndex,
        product: {
          ...payload,
          ...(savedProduct || {}),
          id: savedProductId
        }
      }
    }));

    return savedProduct;

  } catch (error) {
    console.error('[PRODUCT SAVE]', error);
    showProductMessage(
      error.message || 'Product save করা যায়নি।',
      'error',
      7000
    );
    return false;

  } finally {
    isSaving = false;
    setProductButtonLoading(submitButton, false);

    if (submitButton) {
      submitButton.textContent = currentProductId
        ? 'Save Changes'
        : 'Create Product';
    }
  }
}

// ========================================
// RESET FORM
// ========================================

export function resetProductForm() {
  if (!activeContainer) return;

  const form = activeContainer.querySelector('#product-form');

  form?.reset();

  currentProductId = null;
  isSaving = false;
  setLotCreateProductId(null);
  resetProductLots();

  const idInput = activeContainer.querySelector('#product-id');

  if (idInput) {
    idInput.value = '';
  }

  const title = activeContainer.querySelector('#product-form-title');

  if (title) {
    title.textContent = 'Create Product';
  }

  const submitButton = activeContainer.querySelector(
    '#product-form-submit'
  );

  if (submitButton) {
    submitButton.textContent = 'Create Product';
  }

  // Reset module state
  setProductCategoryData({});
  setProductPricingData({});
  setProductVariantsData([]);
  setProductInventoryData({});
  setProductImagesData([]);
  setProductDescriptionData({});
  setProductSEOData({});
  setProductCostData({});
  setProductFlagsData({});
  setProductReviewData({});

  showProductMessage('Product form reset হয়েছে।', 'info');
}

// ========================================
// RESET EVENT
// ========================================

function handleReset() {
  resetProductForm();
}

// ========================================
// LOAD PRODUCT DATA
// ========================================

export async function loadProductData(productId = null) {
  if (!productId) {
    resetProductForm();
    return false;
  }

  console.warn(
    '[PRODUCT FORM] Product load API response contract is not yet verified.',
    productId
  );

  return false;
}

// ========================================
// GET FORM DATA
// ========================================

export function getProductFormData() {
  const cost = getProductCostData();
  const variants = getProductVariantsData().map(variant => ({
    ...variant,
    effectiveBuyPrice:
      variant.buyPrice == null ? cost.buyPrice : variant.buyPrice
  }));

  return {
    productId: currentProductId || '',
    basic: {
      name: getProductElement('#product-name')?.value?.trim() || '',
      brand: getProductElement('#product-brand')?.value?.trim() || '',
      productCode: getProductElement('#product-code')?.value?.trim() || '',
      barcode: getProductElement('#product-barcode')?.value?.trim() || '',
      sku: getProductElement('#product-sku')?.value?.trim() || '',
      slug: getProductElement('#product-slug')?.value?.trim() || ''
    },
    category: getProductCategoryData(),
    pricing: getProductPricingData(),
    variants,
    inventory: getProductInventoryData(),
    images: getProductImagesData(),
    description: getProductDescriptionData(),
    seo: getProductSEOData(),
    cost,
    flags: getProductFlagsData(),
    review: getProductReviewData()
  };
}

export function getProductSavePayload() {
  const data = getProductFormData();
  const category = data.category || {};
  const pricing = data.pricing || {};
  const inventory = data.inventory || {};
  const description = data.description || {};
  const seo = data.seo || {};
  const cost = data.cost || {};
  const flags = data.flags || {};
  const review = data.review || {};

  const variants = data.variants.map(variant => {
    const { effectiveBuyPrice, ...productVariant } = variant;
    return productVariant;
  });

  return {
    name: data.basic.name,
    brand: data.basic.brand,
    productCode: data.basic.productCode,
    barcode: data.basic.barcode,
    sku: data.basic.sku,
    slug: seo.slug || data.basic.slug,

    ...category,
    subcategoryId: category.subCategoryId || '',

    ...pricing,
    variants,

    totalStock: inventory.totalStock,
    lowStockCount: inventory.lowStockCount,
    stockStatus: inventory.stockStatus,
    hasStock: inventory.hasStock,
    hasVariants: variants.length > 0,

    images: data.images,

    ...description,
    ...seo,
    ...cost,
    ...flags,
    ...review,

    category,
    pricing,
    inventory: {
      ...inventory,
      variants
    },
    seo,
    cost,
    flags,
    review
  };
}

// ========================================
// CLEANUP
// ========================================

export function cleanupProductForm() {
  if (!activeContainer) return;

  const form = activeContainer.querySelector('#product-form');

  form?.removeEventListener('submit', handleFormSubmit);

  basicEventsCleanup?.();
  basicEventsCleanup = null;

  cleanupProductCategory();
  cleanupProductInventory();
  resetProductLots();
  resetLotCreate();
  resetLotVariants();
  resetLotCost();
  resetLotHistory();
  setLotCreateProductId(null);
  setLotCreatePreferredLotId(null);

  activeContainer = null;
  currentProductId = null;
  isSaving = false;
  initialized = false;
}

export default renderProductForm;
