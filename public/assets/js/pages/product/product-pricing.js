
'use strict';

// ========================================
// PRODUCT PRICING
// Regular Price, Selling Price & Discount
// ========================================

import {
  getProductElement,
  showProductMessage
} from './product-utils.js';

const SELECTORS = {
  regularPrice: '#product-regular-price',
  sellingPrice: '#product-selling-price',
  discountPercent: '#product-discount-percent'
};

const PRICE_STEP = '0.01';

// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    regularPrice: getProductElement(SELECTORS.regularPrice),
    sellingPrice: getProductElement(SELECTORS.sellingPrice),
    discountPercent: getProductElement(SELECTORS.discountPercent)
  };
}

// ========================================
// PRICE HELPERS
// ========================================

function parsePrice(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const price = Number(value);

  return Number.isFinite(price) ? price : NaN;
}

function getNumericValue(element) {
  if (!element) return 0;

  return parsePrice(element.value);
}

// ========================================
// FORMAT PRICE
// ========================================

export function formatProductPrice(value) {
  const price = Number(value);

  if (!Number.isFinite(price)) {
    return '0';
  }

  return price.toLocaleString('en-BD', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

// ========================================
// CALCULATE DISCOUNT
// ========================================

export function calculateProductDiscount(
  regularPrice,
  sellingPrice
) {
  const regular = Number(regularPrice);
  const selling = Number(sellingPrice);

  if (
    !Number.isFinite(regular) ||
    !Number.isFinite(selling) ||
    regular <= 0 ||
    selling < 0 ||
    selling > regular
  ) {
    return 0;
  }

  return Number(
    (((regular - selling) / regular) * 100).toFixed(2)
  );
}

// ========================================
// UPDATE DISCOUNT
// ========================================

function updateDiscount() {
  const {
    regularPrice,
    sellingPrice,
    discountPercent
  } = getElements();

  if (!regularPrice || !sellingPrice || !discountPercent) {
    return;
  }

  const discount = calculateProductDiscount(
    getNumericValue(regularPrice),
    getNumericValue(sellingPrice)
  );

  discountPercent.value = String(discount);
}

// ========================================
// CHECK VARIANTS
// ========================================

function hasProductVariants() {
  return Boolean(
    getProductElement('.product-variant-item')
  );
}

// ========================================
// VALIDATE PRICING
// ========================================

export function validateProductPricing() {
  const {
    regularPrice,
    sellingPrice
  } = getElements();

  if (!regularPrice || !sellingPrice) {
    showProductMessage(
      'Pricing form elements পাওয়া যায়নি।',
      'error'
    );

    return false;
  }

  const regular = getNumericValue(regularPrice);
  const selling = getNumericValue(sellingPrice);

  const variantsExist = hasProductVariants();

  // Variant-wise pricing can replace product-level defaults.
  if (
    variantsExist &&
    regularPrice.value === '' &&
    sellingPrice.value === ''
  ) {
    return true;
  }

  if (
    !Number.isFinite(regular) ||
    !Number.isFinite(selling)
  ) {
    showProductMessage(
      'Regular ও Selling Price অবশ্যই সঠিক সংখ্যা হতে হবে।',
      'warning'
    );

    return false;
  }

  if (regular <= 0) {
    showProductMessage(
      'Regular Price সঠিকভাবে লিখুন।',
      'warning'
    );

    regularPrice.focus();
    return false;
  }

  if (selling <= 0) {
    showProductMessage(
      'Selling Price সঠিকভাবে লিখুন।',
      'warning'
    );

    sellingPrice.focus();
    return false;
  }

  if (selling > regular) {
    showProductMessage(
      'Selling Price কখনো Regular Price-এর বেশি হতে পারবে না।',
      'warning'
    );

    sellingPrice.focus();
    return false;
  }

  if (
    !regularPrice.checkValidity() ||
    !sellingPrice.checkValidity()
  ) {
    showProductMessage(
      'Price সর্বোচ্চ দুই দশমিক ঘর পর্যন্ত লিখুন।',
      'warning'
    );

    return false;
  }

  return true;
}

// ========================================
// GET PRICING DATA
// ========================================

export function getProductPricingData() {
  const {
    regularPrice,
    sellingPrice
  } = getElements();

  const regular = getNumericValue(regularPrice);
  const selling = getNumericValue(sellingPrice);

  return {
    regularPrice: Number.isFinite(regular) ? regular : 0,

    sellingPrice: Number.isFinite(selling) ? selling : 0,

    discountPercent: calculateProductDiscount(
      regular,
      selling
    )
  };
}

// ========================================
// SET PRICING DATA
// ========================================

export function setProductPricingData(data = {}) {
  const {
    regularPrice,
    sellingPrice
  } = getElements();

  if (!regularPrice || !sellingPrice) {
    return;
  }

  const input =
    data &&
    typeof data === 'object' &&
    !Array.isArray(data)
      ? data
      : {};

  const regular = parsePrice(input.regularPrice);
  const selling = parsePrice(input.sellingPrice);

  regularPrice.value =
    Number.isFinite(regular) && regular >= 0
      ? String(regular)
      : '';

  sellingPrice.value =
    Number.isFinite(selling) && selling >= 0
      ? String(selling)
      : '';

  updateDiscount();
}

// ========================================
// RESET PRICING
// ========================================

export function resetProductPricing() {
  const {
    regularPrice,
    sellingPrice,
    discountPercent
  } = getElements();

  if (regularPrice) {
    regularPrice.value = '';
  }

  if (sellingPrice) {
    sellingPrice.value = '';
  }

  if (discountPercent) {
    discountPercent.value = '';
  }
}

// ========================================
// EVENT HANDLER
// ========================================

function handlePricingInput() {
  updateDiscount();
}

// ========================================
// EVENT BINDING
// ========================================

function bindPricingEvents() {
  const {
    regularPrice,
    sellingPrice
  } = getElements();

  [regularPrice, sellingPrice].forEach(element => {
    if (!element) return;

    if (element.dataset.pricingEventBound === 'true') {
      return;
    }

    element.addEventListener(
      'input',
      handlePricingInput
    );

    element.dataset.pricingEventBound = 'true';
  });
}

// ========================================
// INITIALIZE
// ========================================

export function initProductPricing({ force = false } = {}) {
  const {
    regularPrice,
    sellingPrice,
    discountPercent
  } = getElements();

  if (!regularPrice || !sellingPrice || !discountPercent) {
    console.warn(
      '[PRODUCT PRICING] Required pricing elements not found.'
    );

    return;
  }

  regularPrice.type = 'number';
  sellingPrice.type = 'number';

  regularPrice.min = '0';
  sellingPrice.min = '0';

  regularPrice.step = PRICE_STEP;
  sellingPrice.step = PRICE_STEP;

  discountPercent.readOnly = true;

  bindPricingEvents();

  updateDiscount();
}

// ========================================
// DEFAULT EXPORT
// ========================================

export default initProductPricing;
