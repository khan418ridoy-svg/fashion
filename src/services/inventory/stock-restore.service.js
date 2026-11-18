
'use strict';

const { db } = require('../../config/firebase');

const {
  ProductError,
  cleanString
} = require('../product/product-utils');

const {
  prepareProductChange
} = require('../product/product-cache.service');

// ========================================
// Collections
// ========================================

const PRODUCTS_COLLECTION = 'products';
const LOTS_COLLECTION = 'productLots';
const ALLOCATIONS_COLLECTION = 'orderStockAllocations';

// ========================================
// Error Helper
// ========================================

function createError(
  message,
  statusCode = 400,
  code = 'STOCK_RESTORE_ERROR'
) {
  return new ProductError(message, statusCode, code);
}

// ========================================
// ID Validation
// ========================================

function validateId(value, fieldName) {
  const id = cleanString(value, 128);

  if (!id || !/^[\p{L}\p{N}_-]+$/u.test(id)) {
    throw createError(
      `Invalid ${fieldName}.`,
      400,
      'INVALID_ID'
    );
  }

  return id;
}

// ========================================
// Variant Helpers
// ========================================

function getVariantIdentifier(variant) {
  return (
    cleanString(variant.id, 128) ||
    cleanString(variant.variantId, 128) ||
    cleanString(variant.sku, 100) ||
    cleanString(variant.variantSku, 100) ||
    ''
  );
}

function findProductVariantIndex(variants, variantId) {
  const matches = [];

  variants.forEach((variant, index) => {
    if (getVariantIdentifier(variant) === variantId) {
      matches.push(index);
    }
  });

  if (matches.length === 0) {
    throw createError(
      `Product variant ${variantId} not found.`,
      409,
      'VARIANT_NOT_FOUND'
    );
  }

  if (matches.length > 1) {
    throw createError(
      `Product variant ${variantId} is ambiguous.`,
      409,
      'AMBIGUOUS_VARIANT'
    );
  }

  return matches[0];
}

function findLotVariantIndex(variants, variantId, sku) {
  const matches = [];

  variants.forEach((variant, index) => {
    const matchesId =
      cleanString(variant.variantId, 128) === variantId ||
      cleanString(variant.id, 128) === variantId;

    const lotSku = (
      cleanString(variant.sku, 100) ||
      cleanString(variant.variantSku, 100)
    ).toUpperCase();

    const matchesSku = sku && lotSku === sku;

    if (matchesId || matchesSku) {
      matches.push(index);
    }
  });

  if (matches.length === 0) {
    throw createError(
      `Variant ${variantId} not found in its original Lot.`,
      409,
      'LOT_VARIANT_NOT_FOUND'
    );
  }

  if (matches.length > 1) {
    throw createError(
      `Variant ${variantId} matches multiple Lot variants.`,
      409,
      'AMBIGUOUS_LOT_VARIANT'
    );
  }

  return matches[0];
}

// ========================================
// Quantity Validation
// ========================================

function positiveInteger(value, fieldName) {
  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < 1
  ) {
    throw createError(
      `Invalid ${fieldName}.`,
      409,
      'INVALID_QUANTITY'
    );
  }

  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);

  if (
    !Number.isSafeInteger(number) ||
    number < 0
  ) {
    throw createError(
      `Invalid ${fieldName}.`,
      409,
      'INVALID_QUANTITY'
    );
  }

  return number;
}

// ========================================
// Restore Stock
// ========================================

// restoreStock({
//   orderId: 'order123',
//   productId: 'product123',
//   reason: 'order_cancelled'
// })
//
// This restores the complete allocation.
// Partial returns require a separate service.

async function restoreStock(payload = {}) {
  const orderId = validateId(
    payload.orderId,
    'Order ID'
  );

  const productId = validateId(
    payload.productId,
    'Product ID'
  );

  const reason = cleanString(
    payload.reason || 'order_cancelled',
    100
  );

  const allocationId = `${orderId}_${productId}`;

  const productRef = db
    .collection(PRODUCTS_COLLECTION)
    .doc(productId);

  const allocationRef = db
    .collection(ALLOCATIONS_COLLECTION)
    .doc(allocationId);

  return db.runTransaction(async transaction => {
    // ====================================
    // READ PHASE
    // ====================================

    const allocationSnapshot = await transaction.get(
      allocationRef
    );

    if (!allocationSnapshot.exists) {
      throw createError(
        'Stock allocation not found for this Order.',
        404,
        'ALLOCATION_NOT_FOUND'
      );
    }

    const allocation = allocationSnapshot.data() || {};

    if (
      allocation.orderId !== orderId ||
      allocation.productId !== productId
    ) {
      throw createError(
        'Allocation reference does not match the requested Order.',
        409,
        'ALLOCATION_MISMATCH'
      );
    }

    // Idempotency: never restore the same allocation twice.
    if (allocation.restoredAt || allocation.status === 'restored') {
      return {
        alreadyRestored: true,
        allocationId,
        orderId,
        productId
      };
    }

    if (
      !Array.isArray(allocation.items) ||
      allocation.items.length === 0
    ) {
      throw createError(
        'Allocation history is empty or invalid.',
        409,
        'INVALID_ALLOCATION_HISTORY'
      );
    }

    const productSnapshot = await transaction.get(
      productRef
    );

    if (!productSnapshot.exists) {
      throw createError(
        'Product not found.',
        404,
        'PRODUCT_NOT_FOUND'
      );
    }

    const product = productSnapshot.data() || {};

    if (!Array.isArray(product.variants)) {
      throw createError(
        'Product variants are invalid.',
        409,
        'INVALID_PRODUCT_VARIANTS'
      );
    }

    // Collect all unique Lot IDs from allocation history.
    const lotIds = new Set();

    for (const item of allocation.items) {
      if (!Array.isArray(item.allocations)) {
        throw createError(
          'Invalid allocation item history.',
          409,
          'INVALID_ALLOCATION_HISTORY'
        );
      }

      for (const lotAllocation of item.allocations) {
        const lotId = validateId(
          lotAllocation.lotId,
          'Lot ID'
        );

        lotIds.add(lotId);
      }
    }

    const lotRefs = Array.from(lotIds).map(lotId => ({
      id: lotId,
      ref: db.collection(LOTS_COLLECTION).doc(lotId)
    }));

    const lotSnapshots = await Promise.all(
      lotRefs.map(({ ref }) => transaction.get(ref))
    );

    // All required reads are completed before writes.
    const cachePlan = await prepareProductChange({
      db,
      transaction,
      productId,
      action: 'stock_restored'
    });

    // ====================================
    // PREPARE LOT STATES
    // ====================================

    const lotStates = new Map();

    lotSnapshots.forEach((snapshot, index) => {
      if (!snapshot.exists) {
        throw createError(
          `Original Lot ${lotRefs[index].id} not found.`,
          409,
          'ORIGINAL_LOT_NOT_FOUND'
        );
      }

      const lot = snapshot.data() || {};

      if (
        lot.productId !== productId ||
        !Array.isArray(lot.variants)
      ) {
        throw createError(
          `Original Lot ${snapshot.id} is invalid.`,
          409,
          'INVALID_LOT_DATA'
        );
      }

      lotStates.set(snapshot.id, {
        ref: snapshot.ref,
        data: {
          ...lot,
          variants: lot.variants.map(variant => ({
            ...variant
          }))
        },
        changed: false
      });
    });

    // ====================================
    // RESTORE PRODUCT AND LOT STOCK
    // ====================================

    const productVariants = product.variants.map(
      variant => ({ ...variant })
    );

    let totalRestoredQuantity = 0;

    const restoredItems = [];

    for (const item of allocation.items) {
      const variantId = cleanString(
        item.variantId,
        128
      );

      if (!variantId) {
        throw createError(
          'Allocation history has no variant ID.',
          409,
          'INVALID_ALLOCATION_HISTORY'
        );
      }

      const itemQuantity = positiveInteger(
        item.quantity,
        'Allocated quantity'
      );

      const productVariantIndex = findProductVariantIndex(
        productVariants,
        variantId
      );

      const productVariant = productVariants[
        productVariantIndex
      ];

      let restoredItemQuantity = 0;

      const restoredLotEntries = [];

      for (const lotAllocation of item.allocations) {
        const lotId = validateId(
          lotAllocation.lotId,
          'Lot ID'
        );

        const quantity = positiveInteger(
          lotAllocation.quantity,
          'Lot allocated quantity'
        );

        const lotState = lotStates.get(lotId);

        if (!lotState) {
          throw createError(
            `Lot ${lotId} was not loaded.`,
            409,
            'LOT_NOT_LOADED'
          );
        }

        const lotVariantIndex = findLotVariantIndex(
          lotState.data.variants,
          variantId,
          item.sku
        );

        const lotVariant = lotState.data.variants[
          lotVariantIndex
        ];

        const currentRemaining = nonNegativeInteger(
          lotVariant.remainingQuantity,
          'Lot remaining quantity'
        );

        const originalQuantity = positiveInteger(
          lotVariant.quantity,
          'Original Lot quantity'
        );

        const nextRemaining = currentRemaining + quantity;

        if (
          !Number.isSafeInteger(nextRemaining) ||
          nextRemaining > originalQuantity
        ) {
          throw createError(
            `Restoring this quantity would exceed the original stock of Lot ${lotState.data.lotNumber || lotId}.`,
            409,
            'LOT_STOCK_LIMIT_EXCEEDED'
          );
        }

        // Restore to the exact original Lot variant.
        lotVariant.remainingQuantity = nextRemaining;

        lotState.changed = true;

        restoredItemQuantity += quantity;

        restoredLotEntries.push({
          lotId,
          lotNumber: lotState.data.lotNumber || null,
          variantId,
          quantity
        });
      }

      if (restoredItemQuantity !== itemQuantity) {
        throw createError(
          `Allocation quantity mismatch for variant ${variantId}.`,
          409,
          'ALLOCATION_QUANTITY_MISMATCH'
        );
      }

      const currentProductStock = nonNegativeInteger(
        productVariant.stock || 0,
        'Product variant stock'
      );

      const nextProductStock =
        currentProductStock + itemQuantity;

      if (!Number.isSafeInteger(nextProductStock)) {
        throw createError(
          'Product stock exceeds the safe integer limit.',
          409,
          'INVALID_PRODUCT_STOCK'
        );
      }

      productVariant.stock = nextProductStock;

      totalRestoredQuantity += itemQuantity;

      if (!Number.isSafeInteger(totalRestoredQuantity)) {
        throw createError(
          'Total restored quantity is too large.',
          409,
          'INVALID_QUANTITY'
        );
      }

      restoredItems.push({
        variantId,
        quantity: itemQuantity,
        lots: restoredLotEntries
      });
    }

    // ====================================
    // UPDATE LOT TOTALS AND STATUS
    // ====================================

    const now = new Date();

    const updatedLots = [];

    for (const lotState of lotStates.values()) {
      if (!lotState.changed) {
        continue;
      }

      const lot = lotState.data;

      const remainingQuantity = lot.variants.reduce(
        (total, variant) => {
          const quantity = nonNegativeInteger(
            variant.remainingQuantity,
            'Lot variant remaining quantity'
          );

          return total + quantity;
        },
        0
      );

      if (!Number.isSafeInteger(remainingQuantity)) {
        throw createError(
          'Lot remaining quantity is too large.',
          409,
          'INVALID_LOT_QUANTITY'
        );
      }

      const originalTotalQuantity = Number(
        lot.totalQuantity
      );

      let status = 'available';

      if (remainingQuantity === 0) {
        status = 'depleted';
      } else if (
        Number.isSafeInteger(originalTotalQuantity) &&
        remainingQuantity < originalTotalQuantity
      ) {
        status = 'partial';
      }

      updatedLots.push({
        ref: lotState.ref,
        data: {
          variants: lot.variants,
          remainingQuantity,
          status,
          updatedAt: now
        }
      });
    }

    // ====================================
    // UPDATE PRODUCT
    // ====================================

    const currentTotalStock = nonNegativeInteger(
      product.totalStock || 0,
      'Product total stock'
    );

    const nextTotalStock =
      currentTotalStock + totalRestoredQuantity;

    if (!Number.isSafeInteger(nextTotalStock)) {
      throw createError(
        'Product total stock is too large.',
        409,
        'INVALID_PRODUCT_STOCK'
      );
    }

    const currentVersion = Number(product.version || 0);

    if (
      !Number.isSafeInteger(currentVersion) ||
      currentVersion < 0
    ) {
      throw createError(
        'Product version is invalid.',
        409,
        'INVALID_PRODUCT_VERSION'
      );
    }

    // ====================================
    // WRITE PHASE
    // No transaction reads below.
    // ====================================

    for (const lot of updatedLots) {
      transaction.update(lot.ref, lot.data);
    }

    transaction.update(productRef, {
      variants: productVariants,
      totalStock: nextTotalStock,
      version: currentVersion + 1,
      updatedAt: now
    });

    transaction.update(allocationRef, {
      status: 'restored',
      restoredAt: now,
      restoreReason: reason,
      restoredQuantity: totalRestoredQuantity,
      restoredItems
    });

    cachePlan.write(transaction);

    return {
      alreadyRestored: false,
      allocationId,
      orderId,
      productId,
      reason,
      totalRestoredQuantity,
      productTotalStock: nextTotalStock,
      restoredItems
    };
  });
}

// ========================================
// Get Restore Status
// ========================================

async function getStockRestoreStatus(orderId, productId) {
  const normalizedOrderId = validateId(
    orderId,
    'Order ID'
  );

  const normalizedProductId = validateId(
    productId,
    'Product ID'
  );

  const allocationId =
    `${normalizedOrderId}_${normalizedProductId}`;

  const snapshot = await db
    .collection(ALLOCATIONS_COLLECTION)
    .doc(allocationId)
    .get();

  if (!snapshot.exists) {
    throw createError(
      'Stock allocation not found.',
      404,
      'ALLOCATION_NOT_FOUND'
    );
  }

  const allocation = snapshot.data() || {};

  return {
    allocationId,
    orderId: normalizedOrderId,
    productId: normalizedProductId,
    allocated: true,
    restored: Boolean(
      allocation.restoredAt ||
      allocation.status === 'restored'
    ),
    restoredAt: allocation.restoredAt || null,
    restoreReason: allocation.restoreReason || null,
    restoredQuantity: allocation.restoredQuantity || 0
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  restoreStock,
  getStockRestoreStatus
};
