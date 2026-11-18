
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
const META_COLLECTION = 'meta';
const ALLOCATIONS_COLLECTION = 'orderStockAllocations';

const LOT_COUNTER_DOCUMENT = 'productLotCounter';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// ========================================
// Error Helper
// ========================================

function createError(message, statusCode = 400, code = 'INVALID_LOT_DATA') {
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

function parseNumber(value, fieldName, options = {}) {
  const {
    min = 0,
    integer = false
  } = options;

  if (
    value === '' ||
    value === null ||
    value === undefined ||
    typeof value === 'boolean'
  ) {
    throw createError(
      `${fieldName} is required.`,
      400,
      'INVALID_NUMBER'
    );
  }

  const number = Number(value);

  if (
    !Number.isFinite(number) ||
    number < min ||
    (integer && !Number.isInteger(number))
  ) {
    throw createError(
      `${fieldName} is invalid.`,
      400,
      'INVALID_NUMBER'
    );
  }

  return number;
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function firstMoneyValue(...values) {
  for (const value of values) {
    if (value === '' || value === null || value === undefined) {
      continue;
    }

    const number = Number(value);

    if (Number.isFinite(number) && number >= 0) {
      return roundMoney(number);
    }
  }

  return null;
}

function getProductBuyPrice(product = {}) {
  return firstMoneyValue(
    product.cost?.buyPrice,
    product.buyPrice,
    product.purchaseCost
  );
}

function getVariantBuyPrice(variant = {}, product = {}, lotInput = {}) {
  return firstMoneyValue(
    lotInput.buyPrice,
    variant.buyPrice,
    variant.cost?.buyPrice,
    variant.purchaseCost,
    getProductBuyPrice(product)
  ) ?? 0;
}

function getVariantAverageBuyRate(variant = {}, product = {}) {
  return firstMoneyValue(
    variant.currentAverageBuyRate,
    variant.averageBuyRate,
    variant.averageBuyPrice,
    variant.avgBuyRate,
    variant.buyPrice,
    variant.cost?.buyPrice,
    getProductBuyPrice(product)
  ) ?? 0;
}

function createDefaultProductVariant(productId, product = {}) {
  const productSku = cleanString(
    product.sku || product.basic?.sku,
    100
  );

  return {
    id: `default-${productId.slice(0, 110)}`,
    variantId: `default-${productId.slice(0, 110)}`,
    sku: productSku || `DEFAULT-${productId.slice(0, 80)}`,
    variantSku: productSku || `DEFAULT-${productId.slice(0, 80)}`,
    color: '',
    size: '',
    buyPrice: getProductBuyPrice(product) ?? 0,
    stock: Number(
      product.totalStock ??
      product.stock ??
      product.inventory?.totalStock ??
      0
    ),
    isActive: true
  };
}

function normalizePageSize(value) {
  const limit = Number(value || DEFAULT_PAGE_SIZE);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_PAGE_SIZE
  ) {
    throw createError(
      `Page size must be between 1 and ${MAX_PAGE_SIZE}.`,
      400,
      'INVALID_PAGE_SIZE'
    );
  }

  return limit;
}

function normalizePurchaseDate(value) {
  if (!value) {
    return new Date();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw createError(
      'Invalid purchase date.',
      400,
      'INVALID_PURCHASE_DATE'
    );
  }

  return date;
}

// ========================================
// Lot Number
// ========================================

function formatLotNumber(number) {
  return `LOT-${String(number).padStart(6, '0')}`;
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

function findProductVariant(productVariants, lotVariant) {
  const requestedId = cleanString(
    lotVariant.variantId || lotVariant.id,
    128
  );

  const requestedSku = cleanString(
    lotVariant.sku || lotVariant.variantSku,
    100
  ).toUpperCase();

  const requestedColor = cleanString(lotVariant.color, 100);
  const requestedSize = cleanString(lotVariant.size, 100);

  let matches = productVariants.filter(variant => {
    if (requestedId) {
      return (
        cleanString(variant.id, 128) === requestedId ||
        cleanString(variant.variantId, 128) === requestedId
      );
    }

    if (requestedSku) {
      return (
        cleanString(variant.sku, 100).toUpperCase() === requestedSku ||
        cleanString(variant.variantSku, 100).toUpperCase() === requestedSku
      );
    }

    if (requestedColor || requestedSize) {
      return (
        cleanString(variant.color, 100) === requestedColor &&
        cleanString(variant.size, 100) === requestedSize
      );
    }

    return false;
  });

  // A product with only one variant can use that variant directly.
  if (
    matches.length === 0 &&
    productVariants.length === 1 &&
    !requestedId &&
    !requestedSku &&
    !requestedColor &&
    !requestedSize
  ) {
    matches = [productVariants[0]];
  }

  if (matches.length === 0) {
    throw createError(
      'Lot variant does not match any Product variant.',
      400,
      'VARIANT_NOT_FOUND'
    );
  }

  if (matches.length > 1) {
    throw createError(
      'Lot variant matches multiple Product variants. Provide a variant ID or SKU.',
      400,
      'AMBIGUOUS_VARIANT'
    );
  }

  return matches[0];
}

// ========================================
// Normalize Lot Input
// ========================================

function normalizeLotInput(payload = {}) {
  if (
    !payload ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    throw createError(
      'Lot data must be an object.',
      400,
      'INVALID_LOT_DATA'
    );
  }

  const supplier = cleanString(payload.supplier, 150);
  const lotName = cleanString(
    payload.lotName || payload.name,
    100
  );

  const purchaseDate = normalizePurchaseDate(
    payload.purchaseDate
  );

  if (
    !Array.isArray(payload.variants) ||
    payload.variants.length === 0
  ) {
    throw createError(
      'At least one variant is required.',
      400,
      'LOT_VARIANTS_REQUIRED'
    );
  }

  const variants = payload.variants.map((item, index) => {
    if (
      !item ||
      typeof item !== 'object' ||
      Array.isArray(item)
    ) {
      throw createError(
        `Invalid variant at index ${index}.`,
        400,
        'INVALID_LOT_VARIANT'
      );
    }

    return {
      variantId: cleanString(
        item.variantId || item.id,
        128
      ),

      sku: cleanString(
        item.sku || item.variantSku,
        100
      ),

      color: cleanString(item.color, 100),

      size: cleanString(item.size, 100),

      buyPrice:
        item.buyPrice === '' ||
        item.buyPrice === null ||
        item.buyPrice === undefined
          ? null
          : roundMoney(parseNumber(
            item.buyPrice,
            `Variant ${index + 1} buy price`
          )),

      quantity: parseNumber(
        item.quantity,
        `Variant ${index + 1} quantity`,
        { min: 1, integer: true }
      )
    };
  });

  const totalQuantity = variants.reduce(
    (total, item) => total + item.quantity,
    0
  );

  if (!Number.isSafeInteger(totalQuantity)) {
    throw createError(
      'Total quantity is too large.',
      400,
      'INVALID_TOTAL_QUANTITY'
    );
  }

  const nestedCosts = (
    payload.costs &&
    typeof payload.costs === 'object' &&
    !Array.isArray(payload.costs)
  ) ? payload.costs : {};

  const purchaseCost = roundMoney(parseNumber(
    payload.purchaseCost ?? nestedCosts.purchaseCost,
    'Purchase cost'
  ));

  const transportCost = roundMoney(parseNumber(
    payload.transportCost ?? nestedCosts.transportCost ?? 0,
    'Transport cost'
  ));

  const otherCost = roundMoney(parseNumber(
    payload.otherCost ?? nestedCosts.otherCost ?? 0,
    'Other cost'
  ));

  const calculatedLandedCost = roundMoney(
    purchaseCost + transportCost + otherCost
  );

  const landedCost = roundMoney(
    payload.landedCost === undefined ||
    payload.landedCost === null ||
    payload.landedCost === ''
      ? calculatedLandedCost
      : parseNumber(payload.landedCost, 'Landed cost')
  );

  return {
    lotName,
    supplier,
    purchaseDate,
    variants,
    totalQuantity,
    purchaseCost,
    transportCost,
    otherCost,
    landedCost,
    note: cleanString(payload.note || payload.purchaseNote, 1000),
    parentLotId: cleanString(payload.parentLotId, 128),
    parentLotNumber: cleanString(payload.parentLotNumber, 100)
  };
}

// ========================================
// Allocate Lot Cost To Variants
// ========================================

function allocateCost(totalCost, variants, totalQuantity) {
  let allocated = 0;

  return variants.map((variant, index) => {
    let lineCost;

    if (index === variants.length - 1) {
      lineCost = roundMoney(totalCost - allocated);
    } else {
      lineCost = roundMoney(
        (totalCost * variant.quantity) / totalQuantity
      );

      allocated = roundMoney(allocated + lineCost);
    }

    return {
      totalCost: lineCost,
      unitCost: roundMoney(lineCost / variant.quantity)
    };
  });
}

// ========================================
// Create Product Lot
// ========================================

// createProductLot(productId, payload)

async function createProductLot(productId, payload = {}) {
  const id = validateId(productId, 'Product ID');
  const input = normalizeLotInput(payload);

  const productRef = db
    .collection(PRODUCTS_COLLECTION)
    .doc(id);

  const lotRef = db
    .collection(LOTS_COLLECTION)
    .doc();

  const counterRef = db
    .collection(META_COLLECTION)
    .doc(LOT_COUNTER_DOCUMENT);

  return db.runTransaction(async transaction => {
    // ------------------------------------
    // READ PHASE
    // All transaction reads happen first.
    // ------------------------------------

    const productSnapshot = await transaction.get(productRef);

    if (!productSnapshot.exists) {
      throw createError(
        'Product not found.',
        404,
        'PRODUCT_NOT_FOUND'
      );
    }

    const counterSnapshot = await transaction.get(counterRef);

    const product = productSnapshot.data() || {};

    if (product.deleted === true) {
      throw createError(
        'Cannot add stock to a deleted Product.',
        409,
        'PRODUCT_DELETED'
      );
    }

    const productVariants = (
      Array.isArray(product.variants) && product.variants.length > 0
        ? product.variants
        : [createDefaultProductVariant(id, product)]
    ).map(item => ({ ...item }));

    const matchedVariants = input.variants.map(item => {
      const matched = findProductVariant(
        productVariants,
        item
      );

      return {
        input: item,
        identifier: getVariantIdentifier(matched),
        matched
      };
    });

    // Prevent adding the same Product variant twice in one Lot.
    const usedIdentifiers = new Set();

    for (const item of matchedVariants) {
      const identifier = item.identifier;

      if (!identifier) {
        throw createError(
          'Product variant must have an ID or SKU.',
          400,
          'VARIANT_IDENTIFIER_REQUIRED'
        );
      }

      if (usedIdentifiers.has(identifier)) {
        throw createError(
          'Duplicate variant in this Lot.',
          400,
          'DUPLICATE_LOT_VARIANT'
        );
      }

      usedIdentifiers.add(identifier);
    }

    const currentCounter = counterSnapshot.exists
      ? Number(counterSnapshot.data().lastNumber || 0)
      : 0;

    if (
      !Number.isSafeInteger(currentCounter) ||
      currentCounter < 0 ||
      currentCounter >= Number.MAX_SAFE_INTEGER
    ) {
      throw createError(
        'Invalid Lot counter.',
        500,
        'INVALID_LOT_COUNTER'
      );
    }

    const nextNumber = currentCounter + 1;
    const lotNumber = formatLotNumber(nextNumber);

    // Prepare catalog version update.
    // This performs its Firestore read before any writes.
    const cachePlan = product.active === true
      ? await prepareProductChange({
          db,
          transaction,
          productId: id,
          action: 'updated'
        })
      : null;

    // ------------------------------------
    // COST ALLOCATION
    // ------------------------------------

    const purchaseAllocations = matchedVariants.map(item => {
      const unitCost = getVariantBuyPrice(
        item.matched,
        product,
        item.input
      );

      return {
        unitCost,
        totalCost: roundMoney(unitCost * item.input.quantity)
      };
    });

    const calculatedPurchaseCost = roundMoney(
      purchaseAllocations.reduce(
        (total, item) => total + item.totalCost,
        0
      )
    );

    const additionalCost = roundMoney(
      input.transportCost + input.otherCost
    );

    const additionalAllocations = allocateCost(
      additionalCost,
      input.variants,
      input.totalQuantity
    );

    const calculatedLandedCost = roundMoney(
      calculatedPurchaseCost + additionalCost
    );

    // ------------------------------------
    // PREPARE UPDATED PRODUCT VARIANTS
    // ------------------------------------

    let addedQuantity = 0;

    const lotVariants = matchedVariants.map((item, index) => {
      const variant = item.matched;
      const lotInput = item.input;

      const quantity = lotInput.quantity;

      const currentStock = Number(variant.stock || 0);

      if (
        !Number.isSafeInteger(currentStock) ||
        currentStock < 0
      ) {
        throw createError(
          'Existing Product variant stock is invalid.',
          409,
          'INVALID_PRODUCT_STOCK'
        );
      }

      const nextStock = currentStock + quantity;
      const previousAverageBuyRate = getVariantAverageBuyRate(
        variant,
        product
      );
      const newStockBuyRate = purchaseAllocations[index].unitCost;
      const currentAverageBuyRate = roundMoney(
        nextStock > 0
          ? (
              (previousAverageBuyRate * currentStock) +
              (newStockBuyRate * quantity)
            ) / nextStock
          : newStockBuyRate
      );

      variant.stock = nextStock;
      variant.currentAverageBuyRate = currentAverageBuyRate;
      variant.averageBuyRate = currentAverageBuyRate;

      addedQuantity += quantity;

      return {
        variantId: item.identifier,

        sku:
          cleanString(variant.sku, 100) ||
          cleanString(variant.variantSku, 100) ||
          lotInput.sku,

        color:
          cleanString(variant.color, 100) ||
          lotInput.color,

        size:
          cleanString(variant.size, 100) ||
          lotInput.size,

        quantity,

        remainingQuantity: quantity,

        purchaseCost: purchaseAllocations[index].totalCost,

        landedCost: roundMoney(
          purchaseAllocations[index].totalCost +
          additionalAllocations[index].totalCost
        ),

        unitPurchaseCost: purchaseAllocations[index].unitCost,

        unitLandedCost: roundMoney(
          purchaseAllocations[index].unitCost +
          additionalAllocations[index].unitCost
        )
      };
    });

    const currentTotalStock = Number(
      product.totalStock ??
      product.stock ??
      product.inventory?.totalStock ??
      0
    );

    if (
      !Number.isSafeInteger(currentTotalStock) ||
      currentTotalStock < 0
    ) {
      throw createError(
        'Existing Product total stock is invalid.',
        409,
        'INVALID_PRODUCT_STOCK'
      );
    }

    const now = new Date();

    const newTotalStock = currentTotalStock + addedQuantity;

    const updatedProduct = {
      totalStock: newTotalStock,
      variants: productVariants,
      version: Number(product.version || 0) + 1,
      updatedAt: now
    };

    // ------------------------------------
    // LOT DOCUMENT
    // ------------------------------------

    const lotDocument = {
      id: lotRef.id,

      productId: id,

      lotNumber,

      lotName: input.lotName || lotNumber,

      parentLotId: input.parentLotId || null,

      parentLotNumber: input.parentLotNumber || null,

      supplier: input.supplier,

      purchaseDate: input.purchaseDate,

      variants: lotVariants,

      totalQuantity: input.totalQuantity,

      remainingQuantity: input.totalQuantity,

      purchaseCost: calculatedPurchaseCost,

      transportCost: input.transportCost,

      otherCost: input.otherCost,

      landedCost: calculatedLandedCost,

      unitPurchaseCost: roundMoney(
        calculatedPurchaseCost / input.totalQuantity
      ),

      unitLandedCost: roundMoney(
        calculatedLandedCost / input.totalQuantity
      ),

      note: input.note,

      status: 'available',

      createdAt: now,

      updatedAt: now
    };

    // ------------------------------------
    // WRITE PHASE
    // No more transaction reads below.
    // ------------------------------------

    transaction.create(lotRef, lotDocument);

    transaction.set(
      productRef,
      updatedProduct,
      { merge: true }
    );

    transaction.set(
      counterRef,
      {
        lastNumber: nextNumber,
        updatedAt: now
      },
      { merge: true }
    );

    cachePlan?.write(transaction);

    return {
      lot: lotDocument,
      product: {
        id,
        totalStock: newTotalStock,
        variants: productVariants,
        version: updatedProduct.version
      }
    };
  });
}

// ========================================
// Get Single Product Lot
// ========================================

async function getProductLot(productId, lotId) {
  const id = validateId(productId, 'Product ID');
  const lotDocumentId = validateId(lotId, 'Lot ID');

  const snapshot = await db
    .collection(LOTS_COLLECTION)
    .doc(lotDocumentId)
    .get();

  if (
    !snapshot.exists ||
    snapshot.data().productId !== id
  ) {
    throw createError(
      'Product Lot not found.',
      404,
      'LOT_NOT_FOUND'
    );
  }

  return {
    id: snapshot.id,
    ...snapshot.data()
  };
}

// ========================================
// List Product Lots
// ========================================

// listProductLots(productId, { limit })

async function listProductLots(productId, options = {}) {
  const id = validateId(productId, 'Product ID');

  const limit = normalizePageSize(options.limit);

  const snapshot = await db
    .collection(LOTS_COLLECTION)
    .where('productId', '==', id)
    .limit(limit)
    .get();

  const lots = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .sort((left, right) => {
      const a = left.purchaseDate?.toMillis?.() || left.purchaseDate?.getTime?.() || 0;
      const b = right.purchaseDate?.toMillis?.() || right.purchaseDate?.getTime?.() || 0;
      return b - a;
    });

  return {
    lots,
    count: lots.length,
    limit
  };
}

// ========================================
// Get Lot By Lot Number
// ========================================

async function getProductLotByNumber(productId, lotNumber) {
  const id = validateId(productId, 'Product ID');

  const number = cleanString(lotNumber, 50);

  if (!number) {
    throw createError(
      'Lot number is required.',
      400,
      'INVALID_LOT_NUMBER'
    );
  }

  const snapshot = await db
    .collection(LOTS_COLLECTION)
    .where('productId', '==', id)
    .get();

  const doc = snapshot.docs.find(item => item.data()?.lotNumber === number);

  if (!doc) {
    throw createError(
      'Product Lot not found.',
      404,
      'LOT_NOT_FOUND'
    );
  }

  return {
    id: doc.id,
    ...doc.data()
  };
}

async function getProductLotHistory(productId, lotId) {
  const lot = await getProductLot(productId, lotId);
  const snapshot = await db
    .collection(ALLOCATIONS_COLLECTION)
    .where('productId', '==', lot.productId)
    .limit(500)
    .get();

  const history = [{
    id: `${lot.id}-created`,
    type: 'created',
    description: `Stock added to ${lot.lotName || lot.lotNumber}.`,
    quantity: lot.totalQuantity,
    newQuantity: lot.totalQuantity,
    cost: lot.landedCost,
    performedBy: 'Admin',
    createdAt: lot.createdAt || lot.purchaseDate
  }];

  for (const document of snapshot.docs) {
    const allocation = document.data() || {};

    for (const item of allocation.items || []) {
      for (const line of item.allocations || []) {
        if (line.lotId !== lot.id) continue;

        history.push({
          id: `${document.id}-${line.variantId}-${history.length}`,
          type: allocation.status === 'restored' ? 'restored' : 'sold',
          description: allocation.status === 'restored'
            ? `Stock restored from Order ${allocation.orderId}.`
            : `Stock allocated to Order ${allocation.orderId}.`,
          quantity: Number(line.quantity || 0),
          color: line.color || '',
          size: line.size || '',
          cost: Number(line.landedCost || 0),
          performedBy: 'System',
          createdAt: allocation.restoredAt || allocation.createdAt
        });
      }
    }
  }

  return history.sort((left, right) => {
    const a = left.createdAt?.toMillis?.() || left.createdAt?.getTime?.() || 0;
    const b = right.createdAt?.toMillis?.() || right.createdAt?.getTime?.() || 0;
    return b - a;
  });
}

// ========================================
// Exports
// ========================================

module.exports = {
  createProductLot,
  getProductLot,
  listProductLots,
  getProductLotByNumber,
  getProductLotHistory
};
