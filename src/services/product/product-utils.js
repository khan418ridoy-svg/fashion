'use strict';

/**
 * Product Utilities
 *
 * Responsibilities:
 * - Product field normalization
 * - Product data validation
 * - SKU normalization
 * - Slug generation
 * - Safe array/object handling
 * - Numeric validation
 * - Product error handling
 *
 * This file does not perform Firestore operations.
 */

// --------------------------------------------------
// Custom Product Error
// --------------------------------------------------

class ProductError extends Error {
  constructor(message, statusCode = 400, code = 'PRODUCT_ERROR') {
    super(message);

    this.name = 'ProductError';
    this.statusCode = statusCode;
    this.code = code;

    Error.captureStackTrace?.(this, ProductError);
  }
}

// --------------------------------------------------
// Basic Helpers
// --------------------------------------------------

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function isPlainObject(value) {
  if (!isObject(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return (
    prototype === Object.prototype ||
    prototype === null
  );
}

function cleanString(value, maxLength = 5000) {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value !== 'string' && typeof value !== 'number') {
    return '';
  }

  return String(value)
    .trim()
    .slice(0, maxLength);
}

function requiredString(
  value,
  fieldName,
  maxLength = 200
) {
  const result = cleanString(value, maxLength);

  if (!result) {
    throw new ProductError(
      `${fieldName} is required.`,
      400,
      'REQUIRED_FIELD'
    );
  }

  return result;
}

function cleanArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueStrings(value, maxItems = 100) {
  const items = cleanArray(value);

  const result = [];
  const seen = new Set();

  for (const item of items.slice(0, maxItems)) {
    const cleaned = cleanString(item, 200);

    if (!cleaned) {
      continue;
    }

    const normalized = cleaned.toLowerCase();

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(cleaned);
  }

  return result;
}

// --------------------------------------------------
// Numeric Helpers
// --------------------------------------------------

function toNumber(value, options = {}) {
  const {
    defaultValue = 0,
    min = 0,
    max = Number.MAX_SAFE_INTEGER,
    integer = false
  } = options;

  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return defaultValue;
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    throw new ProductError(
      'Invalid numeric value.',
      400,
      'INVALID_NUMBER'
    );
  }

  if (number < min || number > max) {
    throw new ProductError(
      `Number must be between ${min} and ${max}.`,
      400,
      'NUMBER_OUT_OF_RANGE'
    );
  }

  if (integer && !Number.isInteger(number)) {
    throw new ProductError(
      'A whole number is required.',
      400,
      'INVALID_INTEGER'
    );
  }

  return number;
}

function toBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 1 || value === '1' || value === 'true') {
    return true;
  }

  if (value === 0 || value === '0' || value === 'false') {
    return false;
  }

  return defaultValue;
}

// --------------------------------------------------
// SKU Helpers
// --------------------------------------------------

function normalizeSku(value) {
  return cleanString(value, 100)
    .replace(/\s+/g, '')
    .toUpperCase();
}

function validateSku(value) {
  const sku = normalizeSku(value);

  if (!sku) {
    throw new ProductError(
      'SKU is required.',
      400,
      'SKU_REQUIRED'
    );
  }

  if (!/^[A-Z0-9_-]+$/.test(sku)) {
    throw new ProductError(
      'SKU may contain only letters, numbers, hyphens and underscores.',
      400,
      'INVALID_SKU'
    );
  }

  return sku;
}

// --------------------------------------------------
// Slug Helpers
// --------------------------------------------------

function createSlug(value) {
  return cleanString(value, 300)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 200);
}

function validateSlug(value) {
  const slug = createSlug(value);

  if (!slug) {
    throw new ProductError(
      'A valid product slug is required.',
      400,
      'INVALID_SLUG'
    );
  }

  return slug;
}

// --------------------------------------------------
// Image Helpers
// --------------------------------------------------

function cleanImages(value) {
  return cleanArray(value)
    .filter(isObject)
    .map((image) => {
      const url = cleanString(
        image.url || image.secure_url,
        2000
      );

      if (!url) {
        return null;
      }

      return {
        ...image,
        url
      };
    })
    .filter(Boolean);
}

function validateImages(value, options = {}) {
  const {
    min = 0,
    max = 20
  } = options;

  const images = cleanImages(value);

  if (images.length < min) {
    throw new ProductError(
      `At least ${min} product image(s) are required.`,
      400,
      'INSUFFICIENT_IMAGES'
    );
  }

  if (images.length > max) {
    throw new ProductError(
      `A maximum of ${max} product images is allowed.`,
      400,
      'TOO_MANY_IMAGES'
    );
  }

  return images;
}

// --------------------------------------------------
// Variant Helpers
// --------------------------------------------------

function cleanVariants(value) {
  return cleanArray(value)
    .filter(isObject)
    .map((variant) => {
      const cleaned = { ...variant };

      // Normalize common optional string fields.
      if ('name' in cleaned) {
        cleaned.name = cleanString(cleaned.name, 150);
      }

      if ('color' in cleaned) {
        cleaned.color = cleanString(cleaned.color, 100);
      }

      if ('size' in cleaned) {
        cleaned.size = cleanString(cleaned.size, 100);
      }

      if ('sku' in cleaned) {
        cleaned.sku = normalizeSku(cleaned.sku);
      }

      // Stock must be a non-negative whole number.
      if ('stock' in cleaned) {
        cleaned.stock = toNumber(cleaned.stock, {
          min: 0,
          integer: true
        });
      }

      return cleaned;
    });
}

// --------------------------------------------------
// Product Data Helpers
// --------------------------------------------------

function cleanProductInput(input) {
  if (!isPlainObject(input)) {
    throw new ProductError(
      'Product data must be an object.',
      400,
      'INVALID_PRODUCT_DATA'
    );
  }

  const product = { ...input };

  // Common text fields.
  const stringFields = [
    'name',
    'slug',
    'sku',
    'shortDescription',
    'description',
    'collectionId',
    'categoryId',
    'subcategoryId',
    'fabricType',
    'fit'
  ];

  for (const field of stringFields) {
    if (field in product) {
      product[field] = cleanString(
        product[field],
        field === 'description' ? 20000 : 1000
      );
    }
  }

  // Normalize SKU only when supplied.
  if (product.sku) {
    product.sku = normalizeSku(product.sku);
  }

  // Normalize slug only when supplied.
  if (product.slug) {
    product.slug = createSlug(product.slug);
  }

  // Array fields.
  if ('tags' in product) {
    product.tags = uniqueStrings(product.tags);
  }

  if ('images' in product) {
    product.images = cleanImages(product.images);
  }

  if ('variants' in product) {
    product.variants = cleanVariants(product.variants);
  }

  // Stock field.
  if ('totalStock' in product) {
    product.totalStock = toNumber(product.totalStock, {
      min: 0,
      integer: true
    });
  }

  // Active flag.
  if ('active' in product) {
    product.active = toBoolean(product.active);
  }

  return product;
}

// --------------------------------------------------
// Required Product Validation
// --------------------------------------------------

function validateProductInput(input, options = {}) {
  const {
    requireSku = false,
    requireSlug = false,
    requireImages = false,
    minImages = 3
  } = options;

  const product = cleanProductInput(input);

  product.name = requiredString(
    product.name,
    'Product name',
    200
  );

  if (requireSku) {
    product.sku = validateSku(product.sku);
  } else if (product.sku) {
    product.sku = validateSku(product.sku);
  }

  if (requireSlug) {
    product.slug = validateSlug(
      product.slug || product.name
    );
  } else if (product.slug) {
    product.slug = validateSlug(product.slug);
  }

  if (requireImages) {
    product.images = validateImages(product.images, {
      min: minImages
    });
  }

  if (!Array.isArray(product.tags)) {
    product.tags = [];
  }

  if (!Array.isArray(product.images)) {
    product.images = [];
  }

  if (!Array.isArray(product.variants)) {
    product.variants = [];
  }

  return product;
}

// --------------------------------------------------
// Firestore-safe Object Helpers
// --------------------------------------------------

function removeUndefined(value) {
  if (Array.isArray(value)) {
    return value.map(removeUndefined);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result = {};

  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) {
      continue;
    }

    result[key] = removeUndefined(item);
  }

  return result;
}

function pickFields(source, allowedFields = []) {
  if (!isPlainObject(source)) {
    return {};
  }

  const result = {};

  for (const field of allowedFields) {
    if (
      Object.prototype.hasOwnProperty.call(source, field)
    ) {
      result[field] = source[field];
    }
  }

  return result;
}

// --------------------------------------------------
// Exports
// --------------------------------------------------

module.exports = {
  ProductError,

  isObject,
  isPlainObject,

  cleanString,
  requiredString,
  cleanArray,
  uniqueStrings,

  toNumber,
  toBoolean,

  normalizeSku,
  validateSku,

  createSlug,
  validateSlug,

  cleanImages,
  validateImages,

  cleanVariants,

  cleanProductInput,
  validateProductInput,

  removeUndefined,
  pickFields
};