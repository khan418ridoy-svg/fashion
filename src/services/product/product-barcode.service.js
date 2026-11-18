'use strict';

const {
  ProductError,
  cleanString
} = require('./product-utils');

const BARCODE_INDEX_COLLECTION = 'productBarcodeIndex';
const META_COLLECTION = 'meta';
const BARCODE_COUNTER_DOCUMENT = 'productBarcodeCounter';

// EAN-13 prefixes 20-29 are intended for restricted/internal use.
const DEFAULT_BARCODE_PREFIX = '20';
const EAN_BODY_LENGTH = 12;
const MAX_GENERATION_ATTEMPTS = 100;

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
  const id = cleanString(productId, 128);

  if (!id) {
    throw new ProductError(
      'Product ID is required.',
      400,
      'PRODUCT_ID_REQUIRED'
    );
  }

  return id;
}

function validateBarcode(value) {
  const barcode = cleanString(value, 100);

  if (!barcode) {
    throw new ProductError(
      'Barcode is required.',
      400,
      'BARCODE_REQUIRED'
    );
  }

  if (/[\u0000-\u001f\u007f]/.test(barcode)) {
    throw new ProductError(
      'Barcode contains unsupported characters.',
      400,
      'INVALID_BARCODE'
    );
  }

  return barcode;
}

function getBarcodeIndexRef(db, barcode) {
  const indexId = Buffer
    .from(validateBarcode(barcode), 'utf8')
    .toString('base64url');

  return db
    .collection(BARCODE_INDEX_COLLECTION)
    .doc(indexId);
}

function getBarcodeCounterRef(db) {
  return db
    .collection(META_COLLECTION)
    .doc(BARCODE_COUNTER_DOCUMENT);
}

function calculateEan13CheckDigit(body) {
  const total = body
    .split('')
    .reduce((sum, digit, index) => (
      sum + Number(digit) * (index % 2 === 0 ? 1 : 3)
    ), 0);

  return String((10 - (total % 10)) % 10);
}

function formatBarcode(number, options = {}) {
  const prefix = cleanString(
    options.prefix || DEFAULT_BARCODE_PREFIX,
    EAN_BODY_LENGTH - 1
  );

  if (!/^\d+$/.test(prefix)) {
    throw new ProductError(
      'Barcode prefix must contain only numbers.',
      400,
      'INVALID_BARCODE_PREFIX'
    );
  }

  const sequenceLength = EAN_BODY_LENGTH - prefix.length;
  const maximumNumber = (10 ** sequenceLength) - 1;

  if (
    !Number.isSafeInteger(number) ||
    number < 1 ||
    number > maximumNumber
  ) {
    throw new ProductError(
      'Invalid barcode sequence.',
      500,
      'INVALID_BARCODE_NUMBER'
    );
  }

  const body = `${prefix}${String(number).padStart(sequenceLength, '0')}`;

  return `${body}${calculateEan13CheckDigit(body)}`;
}

async function prepareGeneratedBarcode(options = {}) {
  const {
    db,
    transaction,
    productId,
    prefix = DEFAULT_BARCODE_PREFIX
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);
  const counterRef = getBarcodeCounterRef(db);
  const counterSnapshot = await transaction.get(counterRef);
  const counterData = counterSnapshot.exists
    ? counterSnapshot.data() || {}
    : {};

  let nextNumber = Number(counterData.lastNumber || 0) + 1;
  let selectedBarcode = null;
  let selectedIndexRef = null;

  for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
    const candidate = formatBarcode(nextNumber, { prefix });
    const candidateRef = getBarcodeIndexRef(db, candidate);
    const candidateSnapshot = await transaction.get(candidateRef);

    if (!candidateSnapshot.exists) {
      selectedBarcode = candidate;
      selectedIndexRef = candidateRef;
      break;
    }

    nextNumber++;
  }

  if (!selectedBarcode || !selectedIndexRef) {
    throw new ProductError(
      'Unable to generate a unique barcode.',
      500,
      'BARCODE_GENERATION_FAILED'
    );
  }

  let written = false;

  return {
    barcode: selectedBarcode,
    productId: safeProductId,

    write(writeTransaction) {
      if (written) {
        throw new Error('Barcode plan has already been written.');
      }

      validateTransaction(writeTransaction);

      const now = new Date();

      writeTransaction.set(selectedIndexRef, {
        barcode: selectedBarcode,
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

      return selectedBarcode;
    }
  };
}

async function prepareCustomBarcode(options = {}) {
  const {
    db,
    transaction,
    productId,
    barcode
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);
  const safeBarcode = validateBarcode(barcode);
  const indexRef = getBarcodeIndexRef(db, safeBarcode);
  const snapshot = await transaction.get(indexRef);

  if (snapshot.exists) {
    const existingProductId = snapshot.data()?.productId;

    if (existingProductId !== safeProductId) {
      throw new ProductError(
        `Barcode "${safeBarcode}" is already assigned.`,
        409,
        'DUPLICATE_BARCODE'
      );
    }

    return {
      barcode: safeBarcode,
      productId: safeProductId,
      write() {
        return safeBarcode;
      }
    };
  }

  let written = false;

  return {
    barcode: safeBarcode,
    productId: safeProductId,

    write(writeTransaction) {
      if (written) {
        throw new Error('Barcode plan has already been written.');
      }

      validateTransaction(writeTransaction);

      const now = new Date();

      writeTransaction.set(indexRef, {
        barcode: safeBarcode,
        productId: safeProductId,
        createdAt: now,
        updatedAt: now
      });

      written = true;

      return safeBarcode;
    }
  };
}

async function prepareBarcodeRelease(options = {}) {
  const {
    db,
    transaction,
    productId,
    barcode
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);
  const safeBarcode = validateBarcode(barcode);
  const indexRef = getBarcodeIndexRef(db, safeBarcode);
  const snapshot = await transaction.get(indexRef);

  if (!snapshot.exists) {
    return {
      write() {
        return false;
      }
    };
  }

  if (snapshot.data()?.productId !== safeProductId) {
    throw new ProductError(
      'Barcode belongs to another product.',
      409,
      'BARCODE_OWNERSHIP_MISMATCH'
    );
  }

  let written = false;

  return {
    write(writeTransaction) {
      if (written) {
        throw new Error('Barcode release plan has already been written.');
      }

      validateTransaction(writeTransaction);
      writeTransaction.delete(indexRef);
      written = true;

      return true;
    }
  };
}

module.exports = {
  DEFAULT_BARCODE_PREFIX,
  formatBarcode,
  validateBarcode,
  prepareGeneratedBarcode,
  prepareCustomBarcode,
  prepareBarcodeRelease
};
