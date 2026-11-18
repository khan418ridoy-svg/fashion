'use strict';

const {
  ProductError,
  cleanString,
  isPlainObject,
  removeUndefined
} = require('./product-utils');

const PRIVATE_COLLECTION = 'private';
const META_COLLECTION = 'meta';
const PRIVATE_BATCH_META_DOCUMENT = 'productPrivateBatches';

const PRIVATE_BATCH_SIZE = 20;
const PRIVATE_BATCH_PREFIX = 'private-';
const PRIVATE_BATCH_NUMBER_LENGTH = 6;
const MAX_BATCH_SEARCH_ATTEMPTS = 100;

const ROOT_PRIVATE_FIELDS = [
  'buyPrice',
  'costPrice',
  'purchasePrice',
  'purchaseCost',
  'averageBuyRate',
  'currentAverageBuyRate',
  'landedCost',
  'unitPurchaseCost',
  'unitLandedCost',
  'stockValue',
  'inventoryValue',
  'supplier',
  'purchaseNote',
  'cost',
  'confidential'
];

const PRICING_PRIVATE_FIELDS = [
  'buyPrice',
  'costPrice',
  'purchasePrice',
  'purchaseCost',
  'landedCost',
  'profit',
  'profitMargin',
  'margin'
];

const INVENTORY_PRIVATE_FIELDS = [
  'averageBuyRate',
  'currentAverageBuyRate',
  'stockValue',
  'inventoryValue',
  'landedCost',
  'unitPurchaseCost',
  'unitLandedCost'
];

const VARIANT_PRIVATE_FIELDS = [
  'buyPrice',
  'costPrice',
  'purchasePrice',
  'purchaseCost',
  'averageBuyRate',
  'currentAverageBuyRate',
  'averageBuyPrice',
  'avgBuyRate',
  'landedCost',
  'unitPurchaseCost',
  'unitLandedCost',
  'stockValue',
  'cost',
  'confidential'
];

const VARIANT_IDENTITY_FIELDS = [
  'id',
  'variantId',
  'sku',
  'variantSku'
];

function validateDb(db) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('Firestore database is required.');
  }
}

function validateTransaction(transaction) {
  if (
    !transaction ||
    typeof transaction.get !== 'function' ||
    typeof transaction.set !== 'function'
  ) {
    throw new Error('Firestore transaction is required.');
  }
}

function validateProductId(productId) {
  const id = cleanString(productId, 128);

  if (!id || !/^[\p{L}\p{N}_-]+$/u.test(id)) {
    throw new ProductError(
      'Invalid product ID.',
      400,
      'INVALID_PRODUCT_ID'
    );
  }

  return id;
}

function validatePrivateId(privateId) {
  const id = cleanString(privateId, 128);

  if (!id || !/^[A-Za-z0-9_-]+$/.test(id)) {
    throw new ProductError(
      'Invalid private data ID.',
      500,
      'INVALID_PRIVATE_ID'
    );
  }

  return id;
}

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map(cloneValue);
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        cloneValue(item)
      ])
    );
  }

  return value;
}

function hasOwn(source, field) {
  return Object.prototype.hasOwnProperty.call(source, field);
}

function pickFields(source, fields) {
  if (!isPlainObject(source)) {
    return {};
  }

  const result = {};

  fields.forEach(field => {
    if (hasOwn(source, field) && source[field] !== undefined) {
      result[field] = cloneValue(source[field]);
    }
  });

  return result;
}

function omitFields(source, fields) {
  if (!isPlainObject(source)) {
    return source;
  }

  const result = cloneValue(source);

  fields.forEach(field => {
    delete result[field];
  });

  return result;
}

function hasKeys(value) {
  return isPlainObject(value) && Object.keys(value).length > 0;
}

function getVariantIdentity(variant = {}, index = 0) {
  const id = cleanString(
    variant.id || variant.variantId,
    128
  );
  const sku = cleanString(
    variant.sku || variant.variantSku,
    100
  ).toUpperCase();

  return {
    id,
    sku,
    index
  };
}

function variantsMatch(left = {}, right = {}, index = 0) {
  const leftIdentity = getVariantIdentity(left, index);
  const rightIdentity = getVariantIdentity(right, index);

  if (leftIdentity.id && rightIdentity.id) {
    return leftIdentity.id === rightIdentity.id;
  }

  if (leftIdentity.sku && rightIdentity.sku) {
    return leftIdentity.sku === rightIdentity.sku;
  }

  return Number(left.privateIndex) === index;
}

function findPrivateVariant(privateVariants, variant, index) {
  return (Array.isArray(privateVariants) ? privateVariants : [])
    .find(item => variantsMatch(item, variant, index));
}

function createPrivateVariant(
  variant,
  index,
  existingPrivateVariants = []
) {
  const existing = findPrivateVariant(
    existingPrivateVariants,
    variant,
    index
  ) || {};
  const privateFields = pickFields(
    variant,
    VARIANT_PRIVATE_FIELDS
  );
  const identity = pickFields(
    variant,
    VARIANT_IDENTITY_FIELDS
  );
  const merged = {
    ...cloneValue(existing),
    ...identity,
    ...privateFields,
    privateIndex: index
  };

  const hasPrivateValue = VARIANT_PRIVATE_FIELDS.some(field => (
    hasOwn(merged, field)
  ));

  return hasPrivateValue ? merged : null;
}

function buildPrivateVariants(
  product,
  existingPrivateVariants = []
) {
  const sourceVariants = Array.isArray(product?.variants)
    ? product.variants
    : Array.isArray(product?.inventory?.variants)
      ? product.inventory.variants
      : null;

  if (!sourceVariants) {
    return cloneValue(existingPrivateVariants);
  }

  return sourceVariants
    .map((variant, index) => createPrivateVariant(
      variant,
      index,
      existingPrivateVariants
    ))
    .filter(Boolean);
}

function mergePrivateObject(existing, incoming) {
  if (!hasKeys(incoming)) {
    return cloneValue(existing || {});
  }

  return {
    ...(isPlainObject(existing) ? cloneValue(existing) : {}),
    ...cloneValue(incoming)
  };
}

function buildPrivateData(product = {}, existingData = {}) {
  const rootData = {
    ...(isPlainObject(existingData) ? cloneValue(existingData) : {}),
    ...pickFields(product, ROOT_PRIVATE_FIELDS)
  };

  const pricing = pickFields(
    product.pricing,
    PRICING_PRIVATE_FIELDS
  );
  const inventory = pickFields(
    product.inventory,
    INVENTORY_PRIVATE_FIELDS
  );

  if (hasKeys(pricing) || hasKeys(rootData.pricing)) {
    rootData.pricing = mergePrivateObject(
      rootData.pricing,
      pricing
    );
  }

  if (hasKeys(inventory) || hasKeys(rootData.inventory)) {
    rootData.inventory = mergePrivateObject(
      rootData.inventory,
      inventory
    );
  }

  rootData.variants = buildPrivateVariants(
    product,
    rootData.variants
  );

  if (!rootData.variants.length) {
    delete rootData.variants;
  }

  return removeUndefined(rootData);
}

function stripVariantPrivateData(variant) {
  return omitFields(variant, VARIANT_PRIVATE_FIELDS);
}

function stripPrivateProductData(product = {}) {
  if (!isPlainObject(product)) {
    return {};
  }

  const result = omitFields(product, ROOT_PRIVATE_FIELDS);

  if (isPlainObject(result.pricing)) {
    result.pricing = omitFields(
      result.pricing,
      PRICING_PRIVATE_FIELDS
    );
  }

  if (Array.isArray(result.variants)) {
    result.variants = result.variants.map(
      stripVariantPrivateData
    );
  }

  if (isPlainObject(result.inventory)) {
    result.inventory = omitFields(
      result.inventory,
      INVENTORY_PRIVATE_FIELDS
    );

    if (Array.isArray(result.inventory.variants)) {
      result.inventory.variants = result.inventory.variants.map(
        stripVariantPrivateData
      );
    }
  }

  return removeUndefined(result);
}

function mergePrivateVariants(
  publicVariants,
  privateVariants
) {
  if (!Array.isArray(publicVariants)) {
    return publicVariants;
  }

  return publicVariants.map((variant, index) => {
    const privateVariant = findPrivateVariant(
      privateVariants,
      variant,
      index
    );

    if (!privateVariant) {
      return cloneValue(variant);
    }

    return {
      ...cloneValue(variant),
      ...pickFields(privateVariant, VARIANT_PRIVATE_FIELDS)
    };
  });
}

function mergePrivateProductData(product = {}, privateRecord = {}) {
  if (!isPlainObject(product)) {
    return {};
  }

  const privateData = isPlainObject(privateRecord?.data)
    ? privateRecord.data
    : {};
  const result = {
    ...cloneValue(product),
    ...pickFields(privateData, ROOT_PRIVATE_FIELDS)
  };

  if (hasKeys(privateData.pricing)) {
    result.pricing = {
      ...(isPlainObject(result.pricing)
        ? cloneValue(result.pricing)
        : {}),
      ...cloneValue(privateData.pricing)
    };
  }

  if (hasKeys(privateData.inventory)) {
    result.inventory = {
      ...(isPlainObject(result.inventory)
        ? cloneValue(result.inventory)
        : {}),
      ...cloneValue(privateData.inventory)
    };
  }

  if (Array.isArray(result.variants)) {
    result.variants = mergePrivateVariants(
      result.variants,
      privateData.variants
    );
  }

  if (Array.isArray(result.inventory?.variants)) {
    result.inventory.variants = mergePrivateVariants(
      result.inventory.variants,
      privateData.variants
    );
  }

  return result;
}

function formatPrivateBatchId(batchNumber) {
  if (!Number.isSafeInteger(batchNumber) || batchNumber < 1) {
    throw new ProductError(
      'Invalid private batch number.',
      500,
      'INVALID_PRIVATE_BATCH_NUMBER'
    );
  }

  return `${PRIVATE_BATCH_PREFIX}${String(batchNumber).padStart(
    PRIVATE_BATCH_NUMBER_LENGTH,
    '0'
  )}`;
}

function parsePrivateBatchNumber(privateId) {
  const match = String(privateId || '').match(
    /^private-(\d+)$/
  );

  return match ? Number(match[1]) : null;
}

function getPrivateBatchRef(db, privateId) {
  return db
    .collection(PRIVATE_COLLECTION)
    .doc(validatePrivateId(privateId));
}

function getPrivateBatchMetaRef(db) {
  return db
    .collection(META_COLLECTION)
    .doc(PRIVATE_BATCH_META_DOCUMENT);
}

function getBatchProducts(batchData) {
  return isPlainObject(batchData?.products)
    ? batchData.products
    : {};
}

function getBatchProductIds(batchData) {
  const ids = [
    ...(Array.isArray(batchData?.productIds)
      ? batchData.productIds
      : []),
    ...Object.keys(getBatchProducts(batchData))
  ];

  return [...new Set(
    ids.map(id => cleanString(id, 128)).filter(Boolean)
  )];
}

async function findAvailableBatch({
  db,
  transaction,
  productId
}) {
  const metaRef = getPrivateBatchMetaRef(db);
  const metaSnapshot = await transaction.get(metaRef);
  const metaData = metaSnapshot.exists
    ? metaSnapshot.data() || {}
    : {};
  let batchNumber = Number(metaData.currentBatchNumber || 1);

  if (!Number.isSafeInteger(batchNumber) || batchNumber < 1) {
    batchNumber = 1;
  }

  for (
    let attempt = 0;
    attempt < MAX_BATCH_SEARCH_ATTEMPTS;
    attempt++
  ) {
    const privateId = formatPrivateBatchId(batchNumber);
    const batchRef = getPrivateBatchRef(db, privateId);
    const batchSnapshot = await transaction.get(batchRef);
    const batchData = batchSnapshot.exists
      ? batchSnapshot.data() || {}
      : {};
    const productIds = getBatchProductIds(batchData);

    if (
      productIds.includes(productId) ||
      productIds.length < PRIVATE_BATCH_SIZE
    ) {
      return {
        privateId,
        batchNumber,
        batchRef,
        batchData,
        metaRef,
        updateMeta: true
      };
    }

    batchNumber++;
  }

  throw new ProductError(
    'Unable to allocate private product storage.',
    500,
    'PRIVATE_BATCH_ALLOCATION_FAILED'
  );
}

async function prepareProductPrivateContext(options = {}) {
  const {
    db,
    transaction,
    productId,
    privateId = ''
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);
  let batchContext;

  if (privateId) {
    const safePrivateId = validatePrivateId(privateId);
    const batchRef = getPrivateBatchRef(db, safePrivateId);
    const batchSnapshot = await transaction.get(batchRef);
    const batchData = batchSnapshot.exists
      ? batchSnapshot.data() || {}
      : {};
    const productIds = getBatchProductIds(batchData);

    if (
      productIds.includes(safeProductId) ||
      productIds.length < PRIVATE_BATCH_SIZE
    ) {
      batchContext = {
        privateId: safePrivateId,
        batchNumber:
          Number(batchData.batchNumber) ||
          parsePrivateBatchNumber(safePrivateId),
        batchRef,
        batchData,
        metaRef: null,
        updateMeta: false
      };
    }
  }

  if (!batchContext) {
    batchContext = await findAvailableBatch({
      db,
      transaction,
      productId: safeProductId
    });
  }

  const existingProducts = getBatchProducts(
    batchContext.batchData
  );
  const existingRecord = isPlainObject(
    existingProducts[safeProductId]
  )
    ? existingProducts[safeProductId]
    : {};

  return {
    productId: safeProductId,
    privateId: batchContext.privateId,

    hydrate(product) {
      return mergePrivateProductData(
        product,
        existingRecord
      );
    },

    prepare(product) {
      const now = new Date();
      const privateRecord = {
        productId: safeProductId,
        data: buildPrivateData(
          product,
          existingRecord.data
        ),
        createdAt: existingRecord.createdAt || now,
        updatedAt: now
      };
      const products = {
        ...cloneValue(existingProducts),
        [safeProductId]: privateRecord
      };
      const productIds = [...new Set([
        ...getBatchProductIds(batchContext.batchData),
        safeProductId
      ])];

      if (productIds.length > PRIVATE_BATCH_SIZE) {
        throw new ProductError(
          'Private product batch capacity exceeded.',
          500,
          'PRIVATE_BATCH_CAPACITY_EXCEEDED'
        );
      }

      const batchDocument = {
        ...cloneValue(batchContext.batchData),
        id: batchContext.privateId,
        batchNumber: batchContext.batchNumber,
        capacity: PRIVATE_BATCH_SIZE,
        count: productIds.length,
        productIds,
        products,
        createdAt: batchContext.batchData.createdAt || now,
        updatedAt: now
      };
      const publicProduct = {
        ...stripPrivateProductData(product),
        privateId: batchContext.privateId
      };
      let written = false;

      return {
        privateId: batchContext.privateId,
        privateRecord,
        publicProduct,
        hydratedProduct: mergePrivateProductData(
          publicProduct,
          privateRecord
        ),

        write(writeTransaction) {
          if (written) {
            throw new Error(
              'Private product plan has already been written.'
            );
          }

          validateTransaction(writeTransaction);

          writeTransaction.set(
            batchContext.batchRef,
            batchDocument
          );

          if (
            batchContext.updateMeta &&
            batchContext.metaRef
          ) {
            writeTransaction.set(
              batchContext.metaRef,
              {
                currentBatchNumber: batchContext.batchNumber,
                currentPrivateId: batchContext.privateId,
                batchSize: PRIVATE_BATCH_SIZE,
                updatedAt: now
              },
              { merge: true }
            );
          }

          written = true;

          return privateRecord;
        }
      };
    }
  };
}

async function hydrateProductWithPrivateData(db, product = {}) {
  validateDb(db);

  const productId = cleanString(
    product.id || product.productId,
    128
  );
  const privateId = cleanString(product.privateId, 128);

  if (!productId || !privateId) {
    return cloneValue(product);
  }

  const snapshot = await getPrivateBatchRef(
    db,
    privateId
  ).get();
  const record = snapshot.exists
    ? getBatchProducts(snapshot.data())[productId]
    : null;

  return record
    ? mergePrivateProductData(product, record)
    : cloneValue(product);
}

async function hydrateProductsWithPrivateData(db, products = []) {
  validateDb(db);

  if (!Array.isArray(products) || products.length === 0) {
    return [];
  }

  const privateIds = [...new Set(
    products
      .map(product => cleanString(product?.privateId, 128))
      .filter(Boolean)
  )];

  if (!privateIds.length) {
    return products.map(cloneValue);
  }

  const refs = privateIds.map(privateId => (
    getPrivateBatchRef(db, privateId)
  ));
  const snapshots = typeof db.getAll === 'function'
    ? await db.getAll(...refs)
    : await Promise.all(refs.map(ref => ref.get()));
  const batches = new Map();

  snapshots.forEach((snapshot, index) => {
    if (snapshot.exists) {
      batches.set(
        snapshot.id || privateIds[index],
        snapshot.data() || {}
      );
    }
  });

  return products.map(product => {
    const productId = cleanString(
      product?.id || product?.productId,
      128
    );
    const privateId = cleanString(product?.privateId, 128);
    const record = getBatchProducts(
      batches.get(privateId)
    )[productId];

    return record
      ? mergePrivateProductData(product, record)
      : cloneValue(product);
  });
}

module.exports = {
  PRIVATE_COLLECTION,
  PRIVATE_BATCH_SIZE,

  stripPrivateProductData,
  mergePrivateProductData,

  prepareProductPrivateContext,
  hydrateProductWithPrivateData,
  hydrateProductsWithPrivateData
};
