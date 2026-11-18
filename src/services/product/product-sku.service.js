
'use strict';

const {
  ProductError,
  normalizeSku,
  validateSku
} = require('./product-utils');

// --------------------------------------------------
// Firestore Configuration
// --------------------------------------------------

const SKU_INDEX_COLLECTION = 'productSkuIndex';
const META_COLLECTION = 'meta';
const SKU_COUNTER_DOCUMENT = 'productSkuCounter';

const DEFAULT_SKU_PREFIX = 'SKU';
const DEFAULT_SKU_LENGTH = 6;
const MAX_GENERATION_ATTEMPTS = 100;

// --------------------------------------------------
// Internal Helpers
// --------------------------------------------------

function validateDb(db) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('Firestore database is required.');
  }
}

function validateTransaction(transaction) {
  if (!transaction || typeof transaction.get !== 'function') {
    throw new Error('Firestore transaction is required.');
  }
}

function validateProductId(productId) {
  const id = String(productId || '').trim();

  if (!id) {
    throw new ProductError(
      'Product ID is required.',
      400,
      'PRODUCT_ID_REQUIRED'
    );
  }

  return id;
}

function getSkuIndexRef(db, sku) {
  return db
    .collection(SKU_INDEX_COLLECTION)
    .doc(normalizeSku(sku));
}

function getSkuCounterRef(db) {
  return db
    .collection(META_COLLECTION)
    .doc(SKU_COUNTER_DOCUMENT);
}

// --------------------------------------------------
// SKU Formatting
// --------------------------------------------------

function formatSku(number, options = {}) {
  const prefix = normalizeSku(
    options.prefix || DEFAULT_SKU_PREFIX
  );

  const length = Number.isInteger(options.length)
    ? options.length
    : DEFAULT_SKU_LENGTH;

  if (!prefix || !/^[A-Z0-9_-]+$/.test(prefix)) {
    throw new ProductError(
      'Invalid SKU prefix.',
      400,
      'INVALID_SKU_PREFIX'
    );
  }

  if (length < 1 || length > 12) {
    throw new ProductError(
      'SKU length must be between 1 and 12.',
      400,
      'INVALID_SKU_LENGTH'
    );
  }

  if (!Number.isSafeInteger(number) || number < 1) {
    throw new ProductError(
      'Invalid SKU sequence.',
      400,
      'INVALID_SKU_NUMBER'
    );
  }

  return `${prefix}-${String(number).padStart(length, '0')}`;
}

// --------------------------------------------------
// Prepare Auto SKU
// --------------------------------------------------

/**
 * READ PHASE ONLY.
 *
 * Reads the counter and checks candidate SKU indexes.
 * Does not write anything.
 *
 * Call write(transaction) only after every transaction
 * read in the Product service has completed.
 */

async function prepareGeneratedSku(options = {}) {
  const {
    db,
    transaction,
    productId,
    prefix = DEFAULT_SKU_PREFIX,
    length = DEFAULT_SKU_LENGTH
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);

  const counterRef = getSkuCounterRef(db);

  const counterSnapshot = await transaction.get(counterRef);

  const counterData = counterSnapshot.exists
    ? counterSnapshot.data() || {}
    : {};

  let nextNumber = Number(counterData.lastNumber || 0) + 1;

  if (
    !Number.isSafeInteger(nextNumber) ||
    nextNumber < 1
  ) {
    throw new ProductError(
      'Invalid SKU counter.',
      500,
      'INVALID_SKU_COUNTER'
    );
  }

  let selectedSku = null;
  let selectedIndexRef = null;

  for (
    let attempt = 0;
    attempt < MAX_GENERATION_ATTEMPTS;
    attempt++
  ) {
    const candidate = formatSku(nextNumber, {
      prefix,
      length
    });

    const candidateRef = getSkuIndexRef(db, candidate);

    const candidateSnapshot = await transaction.get(
      candidateRef
    );

    if (!candidateSnapshot.exists) {
      selectedSku = candidate;
      selectedIndexRef = candidateRef;
      break;
    }

    nextNumber++;
  }

  if (!selectedSku || !selectedIndexRef) {
    throw new ProductError(
      'Unable to generate a unique SKU.',
      500,
      'SKU_GENERATION_FAILED'
    );
  }

  let written = false;

  return {
    sku: selectedSku,
    productId: safeProductId,

    /**
     * WRITE PHASE ONLY.
     */
    write(writeTransaction) {
      if (written) {
        throw new Error('SKU plan has already been written.');
      }

      validateTransaction(writeTransaction);

      const now = new Date();

      writeTransaction.set(selectedIndexRef, {
        sku: selectedSku,
        productId: safeProductId,
        createdAt: now,
        updatedAt: now
      });

      writeTransaction.set(
        counterRef,
        {
          lastNumber: nextNumber,
          updatedAt: now
        },
        { merge: true }
      );

      written = true;

      return selectedSku;
    }
  };
}

// --------------------------------------------------
// Prepare Custom SKU
// --------------------------------------------------

/**
 * READ PHASE ONLY.
 *
 * Checks whether the custom SKU is available.
 */

async function prepareCustomSku(options = {}) {
  const {
    db,
    transaction,
    productId,
    sku
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);
  const normalizedSku = validateSku(sku);

  const indexRef = getSkuIndexRef(db, normalizedSku);

  const snapshot = await transaction.get(indexRef);

  if (snapshot.exists) {
    const existingProductId = snapshot.data()?.productId;

    if (existingProductId !== safeProductId) {
      throw new ProductError(
        `SKU "${normalizedSku}" is already assigned.`,
        409,
        'DUPLICATE_SKU'
      );
    }

    return {
      sku: normalizedSku,
      productId: safeProductId,
      alreadyOwned: true,
      write() {
        return normalizedSku;
      }
    };
  }

  let written = false;

  return {
    sku: normalizedSku,
    productId: safeProductId,
    alreadyOwned: false,

    /**
     * WRITE PHASE ONLY.
     */
    write(writeTransaction) {
      if (written) {
        throw new Error('SKU plan has already been written.');
      }

      validateTransaction(writeTransaction);

      const now = new Date();

      writeTransaction.set(indexRef, {
        sku: normalizedSku,
        productId: safeProductId,
        createdAt: now,
        updatedAt: now
      });

      written = true;

      return normalizedSku;
    }
  };
}

// --------------------------------------------------
// Prepare Old SKU Release
// --------------------------------------------------

/**
 * READ PHASE ONLY.
 *
 * Checks ownership of the old SKU before releasing it.
 */

async function prepareSkuRelease(options = {}) {
  const {
    db,
    transaction,
    productId,
    sku
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);
  const normalizedSku = validateSku(sku);

  const indexRef = getSkuIndexRef(db, normalizedSku);

  const snapshot = await transaction.get(indexRef);

  if (!snapshot.exists) {
    return {
      sku: normalizedSku,
      productId: safeProductId,
      exists: false,
      write() {
        return false;
      }
    };
  }

  const existingProductId = snapshot.data()?.productId;

  if (existingProductId !== safeProductId) {
    throw new ProductError(
      'SKU belongs to another product.',
      409,
      'SKU_OWNERSHIP_MISMATCH'
    );
  }

  let written = false;

  return {
    sku: normalizedSku,
    productId: safeProductId,
    exists: true,

    /**
     * WRITE PHASE ONLY.
     */
    write(writeTransaction) {
      if (written) {
        throw new Error('SKU release plan already used.');
      }

      validateTransaction(writeTransaction);

      writeTransaction.delete(indexRef);

      written = true;

      return true;
    }
  };
}

// --------------------------------------------------
// Standalone Auto SKU Reservation
// --------------------------------------------------

async function reserveSkuForProduct(options = {}) {
  const {
    db,
    productId,
    prefix = DEFAULT_SKU_PREFIX,
    length = DEFAULT_SKU_LENGTH
  } = options;

  validateDb(db);

  return db.runTransaction(async (transaction) => {
    const plan = await prepareGeneratedSku({
      db,
      transaction,
      productId,
      prefix,
      length
    });

    plan.write(transaction);

    return plan.sku;
  });
}

// --------------------------------------------------
// Standalone Custom SKU Reservation
// --------------------------------------------------

async function reserveCustomSkuForProduct(options = {}) {
  const {
    db,
    productId,
    sku
  } = options;

  validateDb(db);

  return db.runTransaction(async (transaction) => {
    const plan = await prepareCustomSku({
      db,
      transaction,
      productId,
      sku
    });

    plan.write(transaction);

    return plan.sku;
  });
}

// --------------------------------------------------
// Check SKU Availability
// --------------------------------------------------

async function assertSkuAvailable(db, sku, productId = null) {
  validateDb(db);

  const normalizedSku = validateSku(sku);
  const snapshot = await getSkuIndexRef(db, normalizedSku).get();

  if (!snapshot.exists) {
    return {
      available: true,
      sku: normalizedSku
    };
  }

  const existingProductId = snapshot.data()?.productId;

  if (
    productId &&
    existingProductId === String(productId).trim()
  ) {
    return {
      available: true,
      sku: normalizedSku
    };
  }

  throw new ProductError(
    `SKU "${normalizedSku}" is already assigned.`,
    409,
    'DUPLICATE_SKU'
  );
}

// --------------------------------------------------
// Find Product ID By SKU
// --------------------------------------------------

async function findProductIdBySku(db, sku) {
  validateDb(db);

  const normalizedSku = validateSku(sku);

  const snapshot = await getSkuIndexRef(
    db,
    normalizedSku
  ).get();

  if (!snapshot.exists) {
    return null;
  }

  return snapshot.data()?.productId || null;
}

// --------------------------------------------------
// Exports
// --------------------------------------------------

module.exports = {
  DEFAULT_SKU_PREFIX,
  DEFAULT_SKU_LENGTH,

  formatSku,

  prepareGeneratedSku,
  prepareCustomSku,
  prepareSkuRelease,

  reserveSkuForProduct,
  reserveCustomSkuForProduct,

  assertSkuAvailable,
  findProductIdBySku
};
