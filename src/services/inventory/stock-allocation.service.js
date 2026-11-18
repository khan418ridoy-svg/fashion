
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
// Configuration
// ========================================

const PRODUCTS_COLLECTION = 'products';
const LOTS_COLLECTION = 'productLots';
const ALLOCATIONS_COLLECTION = 'orderStockAllocations';

const MONEY_PRECISION = 100;

// ========================================
// Error Helper
// ========================================

function createError(
  message,
  statusCode = 400,
  code = 'INVALID_STOCK_ALLOCATION'
) {
  return new ProductError(message, statusCode, code);
}

// ========================================
// Basic Helpers
// ========================================

function validateId(value, fieldName = 'ID') {
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

function parseQuantity(value, fieldName = 'Quantity') {
  if (
    value === null ||
    value === undefined ||
    value === '' ||
    typeof value === 'boolean'
  ) {
    throw createError(
      `${fieldName} is required.`,
      400,
      'INVALID_QUANTITY'
    );
  }

  const quantity = Number(value);

  if (
    !Number.isSafeInteger(quantity) ||
    quantity < 1
  ) {
    throw createError(
      `${fieldName} must be a positive integer.`,
      400,
      'INVALID_QUANTITY'
    );
  }

  return quantity;
}

function roundMoney(value) {
  return Math.round(
    (value + Number.EPSILON) * MONEY_PRECISION
  ) / MONEY_PRECISION;
}

function getVariantIdentifier(variant) {
  return (
    cleanString(variant.id, 128) ||
    cleanString(variant.variantId, 128) ||
    cleanString(variant.sku, 100) ||
    cleanString(variant.variantSku, 100) ||
    ''
  );
}

// ========================================
// Normalize Order Items
// ========================================

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw createError(
      'At least one order item is required.',
      400,
      'ORDER_ITEMS_REQUIRED'
    );
  }

  const normalized = new Map();

  for (const item of items) {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item)
    ) {
      throw createError(
        'Invalid order item.',
        400,
        'INVALID_ORDER_ITEM'
      );
    }

    const variantId = cleanString(
      item.variantId || item.id,
      128
    );

    const sku = cleanString(
      item.sku || item.variantSku,
      100
    ).toUpperCase();

    if (!variantId && !sku) {
      throw createError(
        'Each order item requires a variant ID or SKU.',
        400,
        'VARIANT_IDENTIFIER_REQUIRED'
      );
    }

    const identifier = variantId || sku;

    const quantity = parseQuantity(
      item.quantity,
      'Order item quantity'
    );

    const existing = normalized.get(identifier);

    if (existing) {
      existing.quantity += quantity;

      if (!Number.isSafeInteger(existing.quantity)) {
        throw createError(
          'Order quantity is too large.',
          400,
          'INVALID_QUANTITY'
        );
      }
    } else {
      normalized.set(identifier, {
        variantId,
        sku,
        quantity
      });
    }
  }

  return Array.from(normalized.values());
}

// ========================================
// Find Product Variant
// ========================================

function findProductVariant(productVariants, item) {
  const matches = productVariants.filter(variant => {
    if (item.variantId) {
      return (
        cleanString(variant.id, 128) === item.variantId ||
        cleanString(variant.variantId, 128) === item.variantId
      );
    }

    return (
      cleanString(variant.sku, 100).toUpperCase() === item.sku ||
      cleanString(variant.variantSku, 100).toUpperCase() === item.sku
    );
  });

  if (matches.length === 0) {
    throw createError(
      'Product variant not found.',
      404,
      'VARIANT_NOT_FOUND'
    );
  }

  if (matches.length > 1) {
    throw createError(
      'Multiple Product variants match the supplied identifier.',
      409,
      'AMBIGUOUS_VARIANT'
    );
  }

  return matches[0];
}

// ========================================
// Find Lot Variant
// ========================================

function findLotVariantIndex(lotVariants, productVariant) {
  const identifier = getVariantIdentifier(productVariant);

  return lotVariants.findIndex(variant => {
    return (
      cleanString(variant.variantId, 128) === identifier ||
      cleanString(variant.id, 128) === identifier ||
      cleanString(variant.sku, 100).toUpperCase() ===
        cleanString(productVariant.sku, 100).toUpperCase() ||
      cleanString(variant.sku, 100).toUpperCase() ===
        cleanString(productVariant.variantSku, 100).toUpperCase()
    );
  });
}

// ========================================
// Get Unit Landed Cost
// ========================================

function getUnitLandedCost(lot, lotVariant) {
  const storedUnitCost = Number(
    lotVariant.unitLandedCost
  );

  if (
    Number.isFinite(storedUnitCost) &&
    storedUnitCost >= 0
  ) {
    return roundMoney(storedUnitCost);
  }

  const quantity = Number(
    lotVariant.quantity || 0
  );

  const landedCost = Number(
    lotVariant.landedCost
  );

  if (
    Number.isSafeInteger(quantity) &&
    quantity > 0 &&
    Number.isFinite(landedCost) &&
    landedCost >= 0
  ) {
    return roundMoney(landedCost / quantity);
  }

  const lotQuantity = Number(lot.totalQuantity || 0);
  const lotCost = Number(lot.landedCost);

  if (
    Number.isSafeInteger(lotQuantity) &&
    lotQuantity > 0 &&
    Number.isFinite(lotCost) &&
    lotCost >= 0
  ) {
    return roundMoney(lotCost / lotQuantity);
  }

  throw createError(
    'Lot landed cost is invalid.',
    409,
    'INVALID_LOT_COST'
  );
}

// ========================================
// Allocate Stock
// ========================================

// allocateStock({
//   productId,
//   orderId,
//   items: [
//     { variantId, quantity }
//   ]
// })

async function allocateStock(payload = {}) {
  const productId = validateId(
    payload.productId,
    'Product ID'
  );

  const orderId = validateId(
    payload.orderId,
    'Order ID'
  );

  const items = normalizeItems(payload.items);

  const productRef = db
    .collection(PRODUCTS_COLLECTION)
    .doc(productId);

  // One allocation document per Order + Product.
  const allocationId = `${orderId}_${productId}`;

  const allocationRef = db
    .collection(ALLOCATIONS_COLLECTION)
    .doc(allocationId);

  return db.runTransaction(async transaction => {
    // ------------------------------------
    // READ PHASE
    // ------------------------------------

    const allocationSnapshot = await transaction.get(
      allocationRef
    );

    // Idempotency protection.
    // Prevents the same Order from deducting stock twice.
    if (allocationSnapshot.exists) {
      const existingAllocation = allocationSnapshot.data();

      if (existingAllocation.productId !== productId) {
        throw createError(
          'Allocation document belongs to another Product.',
          409,
          'ALLOCATION_CONFLICT'
        );
      }

      return {
        alreadyAllocated: true,
        allocation: {
          id: allocationSnapshot.id,
          ...existingAllocation
        }
      };
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

    if (product.deleted === true) {
      throw createError(
        'Cannot sell a deleted Product.',
        409,
        'PRODUCT_DELETED'
      );
    }

    if (
      !Array.isArray(product.variants) ||
      product.variants.length === 0
    ) {
      throw createError(
        'Product variants not found.',
        409,
        'PRODUCT_VARIANTS_REQUIRED'
      );
    }

    // Fetch all Product lots in FIFO order.
    const lotsQuery = db
      .collection(LOTS_COLLECTION)
      .where('productId', '==', productId)
      .orderBy('purchaseDate', 'asc');

    const lotsSnapshot = await transaction.get(
      lotsQuery
    );

    // Prepare catalog version update.
    // This read must also happen before any writes.
    const cachePlan = await prepareProductChange({
      db,
      transaction,
      productId,
      action: 'stock_updated'
    });

    // ------------------------------------
    // PREPARE PRODUCT VARIANTS
    // ------------------------------------

    const productVariants = product.variants.map(
      variant => ({ ...variant })
    );

    const lotStates = new Map();

    for (const doc of lotsSnapshot.docs) {
      const lot = doc.data() || {};

      if (!Array.isArray(lot.variants)) {
        throw createError(
          `Lot ${lot.lotNumber || doc.id} has invalid variants.`,
          409,
          'INVALID_LOT_DATA'
        );
      }

      lotStates.set(doc.id, {
        ref: doc.ref,
        id: doc.id,
        data: {
          ...lot,
          variants: lot.variants.map(variant => ({
            ...variant
          }))
        },
        changed: false
      });
    }

    // ------------------------------------
    // VALIDATE PRODUCT STOCK
    // ------------------------------------

    let totalRequestedQuantity = 0;

    const resolvedItems = items.map(item => {
      const productVariant = findProductVariant(
        productVariants,
        item
      );

      const variantStock = Number(
        productVariant.stock || 0
      );

      if (
        !Number.isSafeInteger(variantStock) ||
        variantStock < 0
      ) {
        throw createError(
          'Product variant stock is invalid.',
          409,
          'INVALID_PRODUCT_STOCK'
        );
      }

      if (variantStock < item.quantity) {
        throw createError(
          `Insufficient stock for variant ${getVariantIdentifier(productVariant)}.`,
          409,
          'INSUFFICIENT_STOCK'
        );
      }

      totalRequestedQuantity += item.quantity;

      return {
        item,
        productVariant,
        quantity: item.quantity
      };
    });

    if (!Number.isSafeInteger(totalRequestedQuantity)) {
      throw createError(
        'Total order quantity is too large.',
        400,
        'INVALID_QUANTITY'
      );
    }

    const productTotalStock = Number(
      product.totalStock || 0
    );

    if (
      !Number.isSafeInteger(productTotalStock) ||
      productTotalStock < totalRequestedQuantity
    ) {
      throw createError(
        'Insufficient Product total stock.',
        409,
        'INSUFFICIENT_STOCK'
      );
    }

    // ------------------------------------
    // FIFO ALLOCATION
    // ------------------------------------

    const allocationItems = [];

    for (const resolved of resolvedItems) {
      const productVariant = resolved.productVariant;

      const variantIdentifier = getVariantIdentifier(
        productVariant
      );

      const requiredQuantity = resolved.quantity;

      let remainingToAllocate = requiredQuantity;

      const variantAllocations = [];

      // Lots are already ordered oldest first.
      for (const lotState of lotStates.values()) {
        if (remainingToAllocate === 0) {
          break;
        }

        const lot = lotState.data;

        const variantIndex = findLotVariantIndex(
          lot.variants,
          productVariant
        );

        if (variantIndex === -1) {
          continue;
        }

        const lotVariant = lot.variants[variantIndex];

        const remainingQuantity = Number(
          lotVariant.remainingQuantity
        );

        if (
          !Number.isSafeInteger(remainingQuantity) ||
          remainingQuantity < 0
        ) {
          throw createError(
            `Invalid remaining quantity in Lot ${lot.lotNumber || lotState.id}.`,
            409,
            'INVALID_LOT_QUANTITY'
          );
        }

        if (remainingQuantity === 0) {
          continue;
        }

        const allocatedQuantity = Math.min(
          remainingToAllocate,
          remainingQuantity
        );

        const unitLandedCost = getUnitLandedCost(
          lot,
          lotVariant
        );

        const allocatedLandedCost = roundMoney(
          unitLandedCost * allocatedQuantity
        );

        // Deduct from Lot variant.
        lotVariant.remainingQuantity =
          remainingQuantity - allocatedQuantity;

        lotState.changed = true;

        const allocationLine = {
          lotId: lotState.id,
          lotNumber: lot.lotNumber || null,
          variantId: variantIdentifier,
          quantity: allocatedQuantity,
          unitLandedCost,
          landedCost: allocatedLandedCost
        };

        variantAllocations.push(allocationLine);

        remainingToAllocate -= allocatedQuantity;
      }

      // All requested stock must come from Lots.
      if (remainingToAllocate > 0) {
        throw createError(
          `Insufficient Lot stock for variant ${variantIdentifier}.`,
          409,
          'INSUFFICIENT_LOT_STOCK'
        );
      }

      // Deduct from Product variant.
      productVariant.stock -= requiredQuantity;

      const itemLandedCost = roundMoney(
        variantAllocations.reduce(
          (total, allocation) =>
            total + allocation.landedCost,
          0
        )
      );

      allocationItems.push({
        variantId: variantIdentifier,

        sku:
          cleanString(productVariant.sku, 100) ||
          cleanString(productVariant.variantSku, 100) ||
          null,

        quantity: requiredQuantity,

        landedCost: itemLandedCost,

        allocations: variantAllocations
      });
    }

    // ------------------------------------
    // PREPARE UPDATED LOT DOCUMENTS
    // ------------------------------------

    const now = new Date();

    const updatedLots = [];

    for (const lotState of lotStates.values()) {
      if (!lotState.changed) {
        continue;
      }

      const lot = lotState.data;

      const totalRemaining = lot.variants.reduce(
        (total, variant) => {
          const quantity = Number(
            variant.remainingQuantity || 0
          );

          if (
            !Number.isSafeInteger(quantity) ||
            quantity < 0
          ) {
            throw createError(
              'Invalid Lot remaining quantity.',
              409,
              'INVALID_LOT_QUANTITY'
            );
          }

          return total + quantity;
        },
        0
      );

      const originalQuantity = Number(
        lot.totalQuantity || 0
      );

      let status = 'available';

      if (totalRemaining === 0) {
        status = 'depleted';
      } else if (totalRemaining < originalQuantity) {
        status = 'partial';
      }

      updatedLots.push({
        ref: lotState.ref,
        data: {
          variants: lot.variants,
          remainingQuantity: totalRemaining,
          status,
          updatedAt: now
        }
      });
    }

    // ------------------------------------
    // PRODUCT UPDATE
    // ------------------------------------

    const updatedTotalStock =
      productTotalStock - totalRequestedQuantity;

    const updatedProduct = {
      variants: productVariants,
      totalStock: updatedTotalStock,
      version: Number(product.version || 0) + 1,
      updatedAt: now
    };

    // ------------------------------------
    // ALLOCATION HISTORY
    // ------------------------------------

    const totalLandedCost = roundMoney(
      allocationItems.reduce(
        (total, item) => total + item.landedCost,
        0
      )
    );

    const allocationDocument = {
      orderId,
      productId,

      items: allocationItems,

      totalQuantity: totalRequestedQuantity,

      totalLandedCost,

      allocationMethod: 'FIFO',

      createdAt: now
    };

    // ------------------------------------
    // WRITE PHASE
    // No transaction reads below.
    // ------------------------------------

    for (const lot of updatedLots) {
      transaction.update(lot.ref, lot.data);
    }

    transaction.update(
      productRef,
      updatedProduct
    );

    transaction.create(
      allocationRef,
      allocationDocument
    );

    cachePlan.write(transaction);

    return {
      alreadyAllocated: false,

      allocation: {
        id: allocationRef.id,
        ...allocationDocument
      },

      product: {
        id: productId,
        totalStock: updatedTotalStock,
        version: updatedProduct.version
      }
    };
  });
}

// ========================================
// Get Stock Allocation
// ========================================

// getStockAllocation(orderId, productId)

async function getStockAllocation(orderId, productId) {
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

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  allocateStock,
  getStockAllocation
};
