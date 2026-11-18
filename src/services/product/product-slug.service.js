'use strict';

const {
  ProductError,
  cleanString,
  validateSlug
} = require('./product-utils');

const PRODUCTS_COLLECTION = 'products';
const SLUG_INDEX_COLLECTION = 'productSlugIndex';
const MAX_SLUG_LENGTH = 200;
const MAX_GENERATION_ATTEMPTS = 1000;
const EXISTING_SLUG_LIMIT = 500;

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

function getSlugIndexRef(db, slug) {
  return db
    .collection(SLUG_INDEX_COLLECTION)
    .doc(slug);
}

function createSlugCandidate(baseSlug, number) {
  if (number === 1) return baseSlug;

  const suffix = `-${number}`;
  const availableLength = MAX_SLUG_LENGTH - suffix.length;

  return `${baseSlug.slice(0, availableLength)}${suffix}`;
}

async function getExistingSlugs({
  db,
  transaction,
  baseSlug,
  productId
}) {
  const query = db
    .collection(PRODUCTS_COLLECTION)
    .where('slug', '>=', baseSlug)
    .where('slug', '<=', `${baseSlug}\uf8ff`)
    .limit(EXISTING_SLUG_LIMIT);

  const snapshot = await transaction.get(query);
  const slugs = new Set();

  for (const document of snapshot.docs || []) {
    const product = document.data() || {};

    if (
      document.id === productId ||
      product.deleted === true
    ) {
      continue;
    }

    const slug = cleanString(product.slug, MAX_SLUG_LENGTH);
    if (slug) slugs.add(slug);
  }

  return slugs;
}

async function prepareUniqueSlug(options = {}) {
  const {
    db,
    transaction,
    productId,
    requestedSlug,
    currentSlug = ''
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);
  const baseSlug = validateSlug(requestedSlug);
  const oldSlug = currentSlug
    ? validateSlug(currentSlug)
    : '';

  const existingSlugs = await getExistingSlugs({
    db,
    transaction,
    baseSlug,
    productId: safeProductId
  });

  const snapshotCache = new Map();

  async function getIndexSnapshot(slug) {
    if (snapshotCache.has(slug)) {
      return snapshotCache.get(slug);
    }

    const ref = getSlugIndexRef(db, slug);
    const snapshot = await transaction.get(ref);
    const result = { ref, snapshot };

    snapshotCache.set(slug, result);
    return result;
  }

  if (oldSlug) {
    await getIndexSnapshot(oldSlug);
  }

  let selectedSlug = '';
  let selectedIndex = null;

  for (
    let attempt = 1;
    attempt <= MAX_GENERATION_ATTEMPTS;
    attempt++
  ) {
    const candidate = createSlugCandidate(baseSlug, attempt);

    if (existingSlugs.has(candidate)) {
      continue;
    }

    const index = await getIndexSnapshot(candidate);
    const ownerId = index.snapshot.exists
      ? index.snapshot.data()?.productId
      : null;

    if (!index.snapshot.exists || ownerId === safeProductId) {
      selectedSlug = candidate;
      selectedIndex = index;
      break;
    }
  }

  if (!selectedSlug || !selectedIndex) {
    throw new ProductError(
      'Unable to generate a unique Product slug.',
      500,
      'SLUG_GENERATION_FAILED'
    );
  }

  const oldIndex = oldSlug
    ? snapshotCache.get(oldSlug)
    : null;

  let written = false;

  return {
    slug: selectedSlug,

    write(writeTransaction) {
      if (written) {
        throw new Error('Slug plan has already been written.');
      }

      validateTransaction(writeTransaction);

      const now = new Date();
      const selectedData = selectedIndex.snapshot.exists
        ? selectedIndex.snapshot.data() || {}
        : {};

      if (
        oldSlug &&
        oldSlug !== selectedSlug &&
        oldIndex?.snapshot.exists &&
        oldIndex.snapshot.data()?.productId === safeProductId
      ) {
        writeTransaction.delete(oldIndex.ref);
      }

      writeTransaction.set(selectedIndex.ref, {
        slug: selectedSlug,
        productId: safeProductId,
        createdAt: selectedData.createdAt || now,
        updatedAt: now
      });

      written = true;
      return selectedSlug;
    }
  };
}

async function prepareSlugRelease(options = {}) {
  const {
    db,
    transaction,
    productId,
    slug
  } = options;

  validateDb(db);
  validateTransaction(transaction);

  const safeProductId = validateProductId(productId);
  const safeSlug = validateSlug(slug);
  const ref = getSlugIndexRef(db, safeSlug);
  const snapshot = await transaction.get(ref);
  const owned = (
    snapshot.exists &&
    snapshot.data()?.productId === safeProductId
  );

  let written = false;

  return {
    slug: safeSlug,
    owned,

    write(writeTransaction) {
      if (written) {
        throw new Error('Slug release plan has already been written.');
      }

      validateTransaction(writeTransaction);

      if (owned) {
        writeTransaction.delete(ref);
      }

      written = true;
      return owned;
    }
  };
}

module.exports = {
  prepareUniqueSlug,
  prepareSlugRelease
};
