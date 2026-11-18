
'use strict';

const { db } = require('../../config/firebase');

const {
  ProductError,
  isPlainObject,
  cleanString,
  validateProductInput,
  createSlug,
  validateSlug,
  validateSku,
  toNumber
} = require('./product-utils');

const {
  prepareGeneratedSku,
  prepareCustomSku,
  prepareSkuRelease,
  findProductIdBySku
} = require('./product-sku.service');

const {
  prepareUniqueSlug,
  prepareSlugRelease
} = require('./product-slug.service');

const {
  prepareProductChange,
  prepareProductChanges,
  getCatalogMeta
} = require('./product-cache.service');

// --------------------------------------------------
// Configuration
// --------------------------------------------------

const PRODUCTS_COLLECTION = 'products';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// --------------------------------------------------
// Firestore References
// --------------------------------------------------

function getProductsRef() {
  return db.collection(PRODUCTS_COLLECTION);
}

function getProductRef(productId) {
  return getProductsRef().doc(productId);
}

// --------------------------------------------------
// Validation
// --------------------------------------------------

function validateProductId(productId) {
  const id = cleanString(productId, 128);

  if (
    !id ||
    !/^[\p{L}\p{N}_-]+$/u.test(id)
  ) {
    throw new ProductError(
      'Invalid product ID.',
      400,
      'INVALID_PRODUCT_ID'
    );
  }

  return id;
}

function validatePayload(payload) {
  if (!isPlainObject(payload)) {
    throw new ProductError(
      'Product data must be an object.',
      400,
      'INVALID_PRODUCT_DATA'
    );
  }

  return payload;
}

function normalizePageSize(value) {
  const limit = Number(value || DEFAULT_PAGE_SIZE);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE
  ) {
    throw new ProductError(
      `Page size must be between 1 and ${MAX_PAGE_SIZE}.`,
      400,
      'INVALID_PAGE_SIZE'
    );
  }

  return limit;
}

function createNotFoundError() {
  return new ProductError(
    'Product not found.',
    404,
    'PRODUCT_NOT_FOUND'
  );
}

// --------------------------------------------------
// Product Normalization
// --------------------------------------------------

function normalizeNewProduct(payload) {
  const product = validateProductInput(payload, {
    requireSku: false,
    requireSlug: false,
    requireImages: false
  });

  product.slug = validateSlug(
    product.slug || createSlug(product.name)
  );

  product.tags = Array.isArray(product.tags)
    ? product.tags
    : [];

  product.images = Array.isArray(product.images)
    ? product.images
    : [];

  product.variants = Array.isArray(product.variants)
    ? product.variants
    : [];

  product.totalStock = toNumber(
    product.totalStock,
    {
      min: 0,
      integer: true
    }
  );

  product.active = product.active === true;
  product.status = product.active ? 'active' : 'draft';

  return product;
}

function variantToken(value, fallback) {
  const token = cleanString(value, 80)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return token || fallback;
}

function normalizeInventoryVariants(variants, productSku, existingVariants = []) {
  const usedSkus = new Set();

  return (Array.isArray(variants) ? variants : []).map((variant, index) => {
    const incomingId = cleanString(variant.id || variant.variantId, 128);
    const incomingSku = cleanString(variant.sku || variant.variantSku, 100).toUpperCase();
    const color = cleanString(variant.color, 100);
    const size = cleanString(variant.size, 100);

    const existing = existingVariants.find(item => {
      const existingId = cleanString(item.id || item.variantId, 128);
      const existingSku = cleanString(item.sku || item.variantSku, 100).toUpperCase();
      return (
        (incomingId && existingId === incomingId) ||
        (incomingSku && existingSku === incomingSku) ||
        (
          cleanString(item.color, 100).toLowerCase() === color.toLowerCase() &&
          cleanString(item.size, 100).toLowerCase() === size.toLowerCase()
        )
      );
    });

    const variantId = cleanString(
      existing?.id || existing?.variantId || incomingId,
      128
    ) || `variant-${index + 1}`;

    const baseSku = cleanString(
      existing?.sku || existing?.variantSku || incomingSku,
      100
    ) || [
      productSku,
      variantToken(color, `COLOR${index + 1}`),
      variantToken(size, `SIZE${index + 1}`)
    ].filter(Boolean).join('-').slice(0, 100);

    let variantSku = baseSku;
    let suffix = 2;
    while (usedSkus.has(variantSku)) {
      variantSku = `${baseSku.slice(0, 94)}-${suffix++}`;
    }
    usedSkus.add(variantSku);

    const stock = Number(existing?.stock || 0);

    return {
      ...variant,
      id: variantId,
      variantId,
      sku: variantSku,
      variantSku,
      color,
      size,
      stock: Number.isSafeInteger(stock) && stock >= 0 ? stock : 0
    };
  });
}

// --------------------------------------------------
// Product Creation
// --------------------------------------------------

/**
 * Creates Product and SKU index atomically.
 *
 * Firestore READ PHASE:
 * 1. Check Product ID.
 * 2. Read SKU counter/index or custom SKU index.
 * 3. Read Product Cache metadata.
 *
 * Firestore WRITE PHASE:
 * 1. Create Product.
 * 2. Write SKU index/counter.
 * 3. Update Product Cache metadata.
 * 4. Write Product Change Log.
 */

async function createProduct(payload = {}) {
  validatePayload(payload);

  const product = normalizeNewProduct(payload);

  const productRef = getProductsRef().doc();

  return db.runTransaction(async (transaction) => {

    // ======================================
    // READ PHASE
    // ======================================

    const existingProduct = await transaction.get(productRef);

    if (existingProduct.exists) {
      throw new ProductError(
        'Product already exists.',
        409,
        'PRODUCT_ALREADY_EXISTS'
      );
    }

    let skuPlan;

    if (product.sku) {
      skuPlan = await prepareCustomSku({
        db,
        transaction,
        productId: productRef.id,
        sku: product.sku
      });
    } else {
      skuPlan = await prepareGeneratedSku({
        db,
        transaction,
        productId: productRef.id
      });
    }

    const slugPlan = await prepareUniqueSlug({
      db,
      transaction,
      productId: productRef.id,
      requestedSlug: product.slug
    });

    const cachePlan = product.active
      ? await prepareProductChange({
          db,
          transaction,
          productId: productRef.id,
          action: 'created'
        })
      : null;

    // ======================================
    // WRITE PHASE
    // ======================================

    const now = new Date();

    const document = {
      ...product,

      id: productRef.id,
      sku: skuPlan.sku,
      slug: slugPlan.slug,

      seo: {
        ...(isPlainObject(product.seo) ? product.seo : {}),
        slug: slugPlan.slug
      },

      variants: normalizeInventoryVariants(
        product.variants,
        skuPlan.sku
      ),

      totalStock: 0,

      version: 1,

      deleted: false,

      createdAt: now,
      updatedAt: now
    };

    transaction.create(productRef, document);

    skuPlan.write(transaction);
    slugPlan.write(transaction);

    cachePlan?.write(transaction);

    return {
      id: productRef.id,
      ...document
    };
  });
}

// --------------------------------------------------
// Get Product By ID
// --------------------------------------------------

async function getProduct(productId) {
  const id = validateProductId(productId);

  const snapshot = await getProductRef(id).get();

  if (!snapshot.exists) {
    throw createNotFoundError();
  }

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

// --------------------------------------------------
// Get Product By SKU
// --------------------------------------------------

/**
 * SKU lookup:
 *
 * Read 1: productSkuIndex/{sku}
 * Read 2: products/{productId}
 *
 * This avoids querying the entire products collection.
 */

async function getProductBySku(sku) {
  const normalizedSku = validateSku(sku);

  const productId = await findProductIdBySku(
    db,
    normalizedSku
  );

  if (!productId) {
    return null;
  }

  const snapshot = await getProductRef(productId).get();

  if (!snapshot.exists) {
    return null;
  }

  const product = snapshot.data() || {};

  if (product.deleted === true) {
    return null;
  }

  return {
    id: snapshot.id,
    ...product
  };
}

// --------------------------------------------------
// List Products
// --------------------------------------------------

/**
 * Admin Product List.
 *
 * Supports:
 * - active filter
 * - categoryId filter
 * - collectionId filter
 * - pagination by updatedAt
 */

async function listProducts(options = {}) {
  const limit = normalizePageSize(options.limit);

  let query = getProductsRef();

  if (typeof options.active === 'boolean') {
    query = query.where(
      'active',
      '==',
      options.active
    );
  }

  if (options.categoryId) {
    query = query.where(
      'categoryId',
      '==',
      cleanString(options.categoryId, 128)
    );
  }

  if (options.collectionId) {
    query = query.where(
      'collectionId',
      '==',
      cleanString(options.collectionId, 128)
    );
  }

  if (options.includeDeleted !== true) {
    query = query.where(
      'deleted',
      '==',
      false
    );
  }

  query = query
    .orderBy('updatedAt', 'desc')
    .limit(limit + 1);

  // Optional cursor:
  // Pass the last Product's updatedAt timestamp.
  if (options.startAfter) {
    const cursorDate = new Date(options.startAfter);

    if (Number.isNaN(cursorDate.getTime())) {
      throw new ProductError(
        'Invalid pagination cursor.',
        400,
        'INVALID_CURSOR'
      );
    }

    query = query.startAfter(cursorDate);
  }

  const snapshot = await query.get();

  const hasMore = snapshot.docs.length > limit;

  const docs = snapshot.docs.slice(0, limit);

  const products = docs.map((doc) => ({
    id: doc.id,
    ...doc.data()
  }));

  const lastProduct = products.length
    ? products[products.length - 1]
    : null;

  return {
    products,
    hasMore,

    nextCursor: lastProduct
      ? lastProduct.updatedAt
      : null
  };
}

// --------------------------------------------------
// Update Product
// --------------------------------------------------

/**
 * Updates Product and SKU index atomically.
 *
 * Existing Product SKU is retained if payload.sku
 * is omitted or empty.
 */

async function updateProduct(productId, payload = {}) {
  const id = validateProductId(productId);

  validatePayload(payload);

  const productRef = getProductRef(id);

  return db.runTransaction(async (transaction) => {

    // ======================================
    // READ PHASE
    // ======================================

    const productSnapshot = await transaction.get(productRef);

    if (!productSnapshot.exists) {
      throw createNotFoundError();
    }

    const existing = productSnapshot.data() || {};

    if (existing.deleted === true) {
      throw new ProductError(
        'Archived products cannot be updated.',
        409,
        'PRODUCT_ARCHIVED'
      );
    }

    const oldSku = validateSku(existing.sku);

    const requestedSku = payload.sku === undefined ||
      payload.sku === null ||
      payload.sku === ''
      ? oldSku
      : validateSku(payload.sku);

    // Preserve server-controlled fields.
    const safePayload = { ...payload };

    delete safePayload.id;
    delete safePayload.createdAt;
    delete safePayload.updatedAt;
    delete safePayload.version;
    delete safePayload.deleted;
    delete safePayload.deletedAt;
    delete safePayload.totalStock;

    const merged = {
      ...existing,
      ...safePayload,

      // Stock is controlled by inventory/lot services.
      totalStock: existing.totalStock || 0
    };

    const updatedProduct = normalizeNewProduct(merged);

    updatedProduct.sku = requestedSku;
    updatedProduct.variants = normalizeInventoryVariants(
      updatedProduct.variants,
      requestedSku,
      Array.isArray(existing.variants) ? existing.variants : []
    );
    updatedProduct.totalStock = Number(existing.totalStock || 0);

    let releasePlan = null;
    let claimPlan = null;

    const skuChanged = oldSku !== requestedSku;

    if (skuChanged) {
      releasePlan = await prepareSkuRelease({
        db,
        transaction,
        productId: id,
        sku: oldSku
      });

      claimPlan = await prepareCustomSku({
        db,
        transaction,
        productId: id,
        sku: requestedSku
      });
    }

    const slugPlan = await prepareUniqueSlug({
      db,
      transaction,
      productId: id,
      requestedSlug: updatedProduct.slug,
      currentSlug: existing.slug || ''
    });

    const wasActive = existing.active === true;
    const isActive = updatedProduct.active === true;
    const cacheAction = !wasActive && isActive
      ? 'created'
      : wasActive && !isActive
        ? 'deleted'
        : isActive
          ? 'updated'
          : null;
    const cachePlan = cacheAction
      ? await prepareProductChange({
          db,
          transaction,
          productId: id,
          action: cacheAction
        })
      : null;

    // ======================================
    // WRITE PHASE
    // ======================================

    const now = new Date();

    const document = {
      ...updatedProduct,

      id,
      slug: slugPlan.slug,

      seo: {
        ...(isPlainObject(updatedProduct.seo)
          ? updatedProduct.seo
          : {}),
        slug: slugPlan.slug
      },

      version: Number(existing.version || 0) + 1,

      createdAt: existing.createdAt || now,
      updatedAt: now
    };

    transaction.set(productRef, document);

    if (skuChanged) {
      releasePlan.write(transaction);
      claimPlan.write(transaction);
    }

    slugPlan.write(transaction);

    cachePlan?.write(transaction);

    return document;
  });
}

// --------------------------------------------------
// Archive Product
// --------------------------------------------------

/**
 * Soft delete:
 *
 * Product document is retained for historical records.
 * Product SKU index is released.
 * Product Cache receives action: deleted.
 *
 * Product Lots are NOT deleted.
 */

async function deleteProduct(productId) {
  const id = validateProductId(productId);

  const productRef = getProductRef(id);

  return db.runTransaction(async (transaction) => {

    // ======================================
    // READ PHASE
    // ======================================

    const productSnapshot = await transaction.get(productRef);

    if (!productSnapshot.exists) {
      throw createNotFoundError();
    }

    const existing = productSnapshot.data() || {};

    if (existing.deleted === true) {
      return {
        success: true,
        id,
        alreadyDeleted: true
      };
    }

    const sku = validateSku(existing.sku);

    const releasePlan = await prepareSkuRelease({
      db,
      transaction,
      productId: id,
      sku
    });

    const slugReleasePlan = existing.slug
      ? await prepareSlugRelease({
          db,
          transaction,
          productId: id,
          slug: existing.slug
        })
      : null;

    const cachePlan = existing.active === true
      ? await prepareProductChange({
          db,
          transaction,
          productId: id,
          action: 'deleted'
        })
      : null;

    // ======================================
    // WRITE PHASE
    // ======================================

    const now = new Date();

    transaction.set(
      productRef,
      {
        active: false,
        status: 'archived',
        deleted: true,

        deletedAt: now,
        updatedAt: now,

        version: Number(existing.version || 0) + 1
      },
      { merge: true }
    );

    releasePlan.write(transaction);
    slugReleasePlan?.write(transaction);

    cachePlan?.write(transaction);

    return {
      success: true,
      id,
      deleted: true
    };
  });
}

async function activateProducts(productIds = []) {
  if (!Array.isArray(productIds) || productIds.length === 0) {
    throw new ProductError(
      'At least one Product must be selected.',
      400,
      'PRODUCT_SELECTION_REQUIRED'
    );
  }

  const ids = [...new Set(productIds.map(validateProductId))];

  if (ids.length > 100) {
    throw new ProductError(
      'A maximum of 100 Products can be activated at once.',
      400,
      'PRODUCT_SELECTION_LIMIT'
    );
  }

  return db.runTransaction(async transaction => {
    const records = [];

    for (const id of ids) {
      const ref = getProductRef(id);
      const snapshot = await transaction.get(ref);

      if (!snapshot.exists) {
        throw createNotFoundError();
      }

      const product = snapshot.data() || {};

      if (product.deleted === true) {
        throw new ProductError(
          'Archived products cannot be activated.',
          409,
          'PRODUCT_ARCHIVED'
        );
      }

      records.push({
        id,
        ref,
        product
      });
    }

    const drafts = records.filter(record => (
      record.product.active !== true
    ));
    const cachePlan = drafts.length
      ? await prepareProductChanges({
          db,
          transaction,
          changes: drafts.map(record => ({
            productId: record.id,
            action: 'created'
          }))
        })
      : null;
    const now = new Date();
    const activatedProducts = [];

    for (const record of records) {
      const wasActive = record.product.active === true;
      const version = wasActive
        ? Number(record.product.version || 0)
        : Number(record.product.version || 0) + 1;

      if (!wasActive) {
        transaction.set(record.ref, {
          active: true,
          status: 'active',
          version,
          updatedAt: now
        }, { merge: true });
      }

      activatedProducts.push({
        id: record.id,
        active: true,
        status: 'active',
        version,
        alreadyActive: wasActive
      });
    }

    cachePlan?.write(transaction);

    return {
      products: activatedProducts,
      activatedCount: drafts.length,
      alreadyActiveCount: records.length - drafts.length
    };
  });
}

// --------------------------------------------------
// Catalog Version
// --------------------------------------------------

async function getProductCatalogVersion() {
  return getCatalogMeta(db);
}

async function getProductCosts(productId) {
  const product = await getProduct(productId);
  const source = product.cost && typeof product.cost === 'object'
    ? product.cost
    : product;

  return {
    buyPrice: Number(source.buyPrice || 0),
    supplier: cleanString(source.supplier, 150),
    purchaseNote: cleanString(source.purchaseNote, 1000)
  };
}

async function updateProductCosts(productId, payload = {}) {
  const id = validateProductId(productId);
  const buyPrice = toNumber(payload.buyPrice, { min: 0 });
  const cost = {
    buyPrice,
    supplier: cleanString(payload.supplier, 150),
    purchaseNote: cleanString(payload.purchaseNote, 1000)
  };

  const productRef = getProductRef(id);
  const snapshot = await productRef.get();
  if (!snapshot.exists || snapshot.data()?.deleted === true) {
    throw createNotFoundError();
  }

  await productRef.set({
    cost,
    buyPrice,
    supplier: cost.supplier,
    purchaseNote: cost.purchaseNote,
    updatedAt: new Date()
  }, { merge: true });

  return cost;
}

// --------------------------------------------------
// Exports
// --------------------------------------------------

module.exports = {
  createProduct,

  getProduct,
  getProductBySku,

  listProducts,

  updateProduct,
  activateProducts,
  deleteProduct,

  getProductCatalogVersion,
  getProductCosts,
  updateProductCosts
};
