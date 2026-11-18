
'use strict';

// ========================================
// PRODUCT FORM
// ========================================

import {
  renderProductForm,
  initProductForm,
  loadProductData,
  resetProductForm
} from '../product-form.js';

// ========================================
// PRODUCT BASIC
// ========================================

import {
  bindProductBasicEvents
} from '../product-basic.js';

// ========================================
// PRODUCT CATEGORY
// ========================================

import {
  initProductCategory
} from '../product-category.js';

// ========================================
// PRODUCT PRICING
// ========================================

import {
  initProductPricing
} from '../product-pricing.js';

// ========================================
// PRODUCT VARIANTS
// ========================================

import {
  initProductVariants
} from '../product-variants.js';

// ========================================
// PRODUCT INVENTORY
// ========================================

import {
  initProductInventory
} from '../product-inventory.js';

// ========================================
// PRODUCT IMAGES
// ========================================

import {
  initProductImages
} from '../product-images.js';

// ========================================
// PRODUCT DESCRIPTION
// ========================================

import {
  initProductDescription
} from '../product-description.js';

// ========================================
// PRODUCT SEO
// ========================================

import {
  initProductSEO
} from '../product-seo.js';

// ========================================
// PRODUCT COST
// ========================================

import {
  initProductCost
} from '../product-cost.js';

// ========================================
// PRODUCT FLAGS
// ========================================

import {
  initProductFlags
} from '../product-flags.js';

// ========================================
// PRODUCT REVIEW
// ========================================

import {
  initProductReview
} from '../product-review.js';

// ========================================
// PRODUCT AI
// ========================================

import {
  initProductAI
} from '../product-ai.js';

// ========================================
// PRODUCT LOT LIST
// ========================================

import {
  initProductLots,
  loadProductLots,
  refreshProductLots,
  resetProductLots
} from './product-lots.js';

// ========================================
// LOT CREATE
// ========================================

import {
  initLotCreate,
  setLotCreateProductId,
  resetLotCreate
} from './lot-create.js';

// ========================================
// LOT STOCK QUANTITY
// ========================================

import {
  initLotVariants,
  resetLotVariants
} from './lot-variants.js';

// ========================================
// LOT COST
// ========================================

// NOTE:
// GitHub-এর বর্তমান lot-history.js ফাইলে
// Cost Module-এর exports রয়েছে।

import {
  initLotCost,
  resetLotCost
} from './lot-history.js';

// ========================================
// LOT HISTORY
// ========================================

// NOTE:
// GitHub-এর বর্তমান lot-cost.js ফাইলে
// History Module-এর exports রয়েছে।

import {
  initLotHistory,
  resetLotHistory
} from './lot-cost.js';


// ========================================
// PAGE STATE
// ========================================

let pageRoot = null;
let currentProductId = '';
let currentLotId = '';

let pageInitialized = false;
let pageAbortController = null;


// ========================================
// GET PRODUCT ROOT
// ========================================

function getRoot(container = document) {
  return container.querySelector('.product-page');
}


// ========================================
// GET PRODUCT ID
// ========================================

function getProductId(options = {}) {
  const value =
    options.productId ||
    options.id ||
    '';

  return String(value).trim();
}


// ========================================
// INITIALIZE PRODUCT MODULES
// ========================================

function initializeProductModules() {
  if (pageInitialized) {
    return;
  }

  if (!pageRoot) {
    throw new Error(
      'Product page root was not found.'
    );
  }

  // Basic Information
  bindProductBasicEvents(pageRoot);

  // Product Sections
  initProductCategory();
  initProductPricing();
  initProductVariants();
  initProductInventory();
  initProductImages();
  initProductDescription();
  initProductSEO();
  initProductCost();
  initProductFlags();
  initProductReview();

  // AI
  initProductAI();

  pageInitialized = true;

  console.info(
    '[PRODUCT PAGE] Product modules initialized.'
  );
}


// ========================================
// INITIALIZE LOT MODULES
// ========================================

function initializeLotModules(productId) {
  if (!productId) {
    return;
  }

  // Lot List
  initProductLots();

  // Lot Stock Quantity
  initLotVariants();

  // Lot Cost
  initLotCost();

  // Lot History
  initLotHistory();

  // Lot Create
  initLotCreate();

  // Set current Product ID
  setLotCreateProductId(productId);

  console.info(
    '[PRODUCT LOT] Modules initialized.',
    productId
  );
}


// ========================================
// LOAD PRODUCT
// ========================================

async function loadProduct(productId) {
  if (!productId) {
    return true;
  }

  try {
    await loadProductData(productId);

    if (pageAbortController?.signal.aborted) {
      return false;
    }

    // Load Product Lots
    await loadProductLots(productId);

    if (pageAbortController?.signal.aborted) {
      return false;
    }

    console.info(
      '[PRODUCT PAGE] Product loaded.',
      productId
    );

    return true;

  } catch (error) {
    if (error.name === 'AbortError') {
      return false;
    }

    console.error(
      '[PRODUCT PAGE] Product loading failed:',
      error
    );

    throw error;
  }
}


// ========================================
// RENDER PRODUCT PAGE
// ========================================

export function render({
  options = {},
  signal
} = {}) {

  currentProductId = getProductId(options);

  currentLotId = String(
    options.lotId || ''
  ).trim();

  pageAbortController = {
    signal
  };

  const page = renderProductForm({
    productId: currentProductId,
    lotId: currentLotId
  });

  if (
    !page ||
    typeof page.nodeType !== 'number'
  ) {
    throw new Error(
      'renderProductForm() must return a DOM element.'
    );
  }

  page.classList.add('product-page');

  pageRoot = page;

  return page;
}


// ========================================
// BIND PRODUCT PAGE EVENTS
// ========================================

export async function bindEvents({
  container,
  options = {},
  signal
} = {}) {

  pageRoot = getRoot(container);

  if (!pageRoot) {
    throw new Error(
      'Product page container .product-page was not found.'
    );
  }

  currentProductId = getProductId(options);

  currentLotId = String(
    options.lotId || ''
  ).trim();

  pageAbortController = {
    signal
  };

  // Initialize Product Form
  await initProductForm({
    container: pageRoot,
    productId: currentProductId,
    lotId: currentLotId,
    signal
  });

  // Existing Product
  if (currentProductId) {

    // Open selected Lot History only if needed.
    if (currentLotId) {
      pageRoot.dispatchEvent(
        new CustomEvent('product:open-lot', {
          bubbles: true,
          detail: {
            productId: currentProductId,
            lotId: currentLotId
          }
        })
      );
    }

  } else {
    // New Product
    resetProductForm();
  }

  console.info(
    '[PRODUCT PAGE] Page ready.',
    {
      productId: currentProductId,
      lotId: currentLotId
    }
  );
}


// ========================================
// REFRESH PRODUCT LOTS
// ========================================

export async function refreshProductPageLots() {
  if (!currentProductId) {
    return false;
  }

  return await refreshProductLots();
}


// ========================================
// GET CURRENT PRODUCT ID
// ========================================

export function getCurrentProductPageId() {
  return currentProductId;
}


// ========================================
// GET CURRENT LOT ID
// ========================================

export function getCurrentProductLotId() {
  return currentLotId;
}


// ========================================
// CLEANUP
// ========================================

export function cleanup() {

  // Reset Product Form
  resetProductForm();

  // Reset Lot Modules
  resetProductLots();
  resetLotCreate();
  resetLotVariants();
  resetLotCost();
  resetLotHistory();

  // Clear State
  pageRoot = null;

  currentProductId = '';
  currentLotId = '';

  pageInitialized = false;
  pageAbortController = null;

  console.info(
    '[PRODUCT PAGE] Page cleaned up.'
  );
}


// ========================================
// DEFAULT EXPORT
// ========================================

export default {
  render,
  bindEvents,
  cleanup,
  refreshProductPageLots,
  getCurrentProductPageId,
  getCurrentProductLotId
};
