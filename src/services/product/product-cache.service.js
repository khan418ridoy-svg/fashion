
'use strict';

// --------------------------------------------------
// Product Cache Service
// --------------------------------------------------

const META_COLLECTION = 'meta';
const CATALOG_META_DOCUMENT = 'productCatalog';
const CHANGES_COLLECTION = 'productChanges';

const DEFAULT_GENERATION = 'initial';
const DEFAULT_CHANGE_LIMIT = 100;
const MAX_CHANGE_LIMIT = 500;

const ALLOWED_ACTIONS = new Set([
  'created',
  'updated',
  'deleted'
]);

// --------------------------------------------------
// Internal Helpers
// --------------------------------------------------

function validateDb(db) {
  if (!db || typeof db.collection !== 'function') {
    throw new Error('Firestore database is required.');
  }
}

function cleanString(value, maxLength = 200) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function validateGeneration(generation) {
  const value = cleanString(generation, 100);

  if (!value) {
    throw new Error('Catalog generation is required.');
  }

  return value;
}

function validateVersion(version, defaultValue = 0) {
  if (version === undefined || version === null) {
    return defaultValue;
  }

  const value = Number(version);

  if (
    !Number.isSafeInteger(value) ||
    value < 0
  ) {
    throw new Error('Invalid catalog version.');
  }

  return value;
}

function validateProductId(productId) {
  const id = cleanString(productId, 200);

  if (!id) {
    throw new Error('Product ID is required.');
  }

  return id;
}

function validateAction(action) {
  const value = cleanString(action, 30);

  if (!ALLOWED_ACTIONS.has(value)) {
    throw new Error(
      'Action must be created, updated or deleted.'
    );
  }

  return value;
}

function validateLimit(limit) {
  const value = Number(limit || DEFAULT_CHANGE_LIMIT);

  if (
    !Number.isInteger(value) ||
    value < 1 ||
    value > MAX_CHANGE_LIMIT
  ) {
    throw new Error(
      `Change limit must be between 1 and ${MAX_CHANGE_LIMIT}.`
    );
  }

  return value;
}

function getMetaRef(db) {
  return db
    .collection(META_COLLECTION)
    .doc(CATALOG_META_DOCUMENT);
}

function getChangesCollection(db) {
  return db.collection(CHANGES_COLLECTION);
}

// --------------------------------------------------
// Read Catalog Metadata
// --------------------------------------------------

async function getCatalogMeta(db) {
  validateDb(db);

  const snapshot = await getMetaRef(db).get();

  if (!snapshot.exists) {
    return {
      generation: DEFAULT_GENERATION,
      version: 0,
      exists: false
    };
  }

  const data = snapshot.data() || {};

  return {
    generation:
      cleanString(data.generation, 100) ||
      DEFAULT_GENERATION,

    version: validateVersion(data.version),

    updatedAt: data.updatedAt || null,

    exists: true
  };
}

// --------------------------------------------------
// Check Client Cache Version
// --------------------------------------------------

async function checkCatalogVersion(db, clientState = {}) {
  validateDb(db);

  const serverState = await getCatalogMeta(db);

  const clientGeneration = cleanString(
    clientState.generation,
    100
  );

  const clientVersion = validateVersion(
    clientState.version,
    0
  );

  const generationMatches =
    clientGeneration === serverState.generation;

  const versionMatches =
    clientVersion === serverState.version;

  return {
    generation: serverState.generation,
    version: serverState.version,

    unchanged:
      generationMatches && versionMatches,

    fullSyncRequired: !generationMatches,

    incrementalSyncRequired:
      generationMatches && !versionMatches
  };
}

// --------------------------------------------------
// Prepare Product Change
// --------------------------------------------------

/**
 * READ PHASE ONLY.
 *
 * Call inside an existing Firestore transaction.
 *
 * This function reads catalog metadata and prepares
 * a change-log entry.
 *
 * Call plan.write(transaction) only after every
 * transaction read has completed.
 */

async function prepareProductChange(options = {}) {
  const {
    db,
    transaction,
    productId,
    action
  } = options;

  validateDb(db);

  if (!transaction || typeof transaction.get !== 'function') {
    throw new Error('Firestore transaction is required.');
  }

  const safeProductId = validateProductId(productId);
  const safeAction = validateAction(action);

  const metaRef = getMetaRef(db);

  const snapshot = await transaction.get(metaRef);

  const data = snapshot.exists
    ? snapshot.data() || {}
    : {};

  const generation =
    cleanString(data.generation, 100) ||
    DEFAULT_GENERATION;

  const currentVersion = validateVersion(
    data.version,
    0
  );

  const nextVersion = currentVersion + 1;

  if (!Number.isSafeInteger(nextVersion)) {
    throw new Error('Catalog version limit exceeded.');
  }

  const changeRef = getChangesCollection(db).doc();

  let written = false;

  return {
    generation,
    version: nextVersion,
    productId: safeProductId,
    action: safeAction,
    changeId: changeRef.id,

    /**
     * WRITE PHASE ONLY.
     */
    write(writeTransaction) {
      if (written) {
        throw new Error(
          'Product change plan has already been written.'
        );
      }

      if (
        !writeTransaction ||
        typeof writeTransaction.set !== 'function'
      ) {
        throw new Error('Firestore transaction is required.');
      }

      const now = new Date();

      // Update catalog metadata.
      writeTransaction.set(
        metaRef,
        {
          generation,
          version: nextVersion,
          updatedAt: now
        },
        { merge: true }
      );

      // Save change log.
      writeTransaction.set(changeRef, {
        generation,
        version: nextVersion,
        productId: safeProductId,
        action: safeAction,
        updatedAt: now
      });

      written = true;

      return {
        generation,
        version: nextVersion,
        changeId: changeRef.id
      };
    }
  };
}

// --------------------------------------------------
// Get Product Changes
// --------------------------------------------------

async function getProductChanges(db, options = {}) {
  validateDb(db);

  const generation = validateGeneration(
    options.generation
  );

  const afterVersion = validateVersion(
    options.afterVersion,
    0
  );

  const limit = validateLimit(options.limit);

  const query = getChangesCollection(db)
    .where('generation', '==', generation)
    .where('version', '>', afterVersion)
    .orderBy('version', 'asc')
    .limit(limit + 1);

  const snapshot = await query.get();

  const hasMore = snapshot.docs.length > limit;

  const docs = snapshot.docs.slice(0, limit);

  const changes = docs.map((doc) => {
    const data = doc.data() || {};

    return {
      changeId: doc.id,
      generation: data.generation,
      version: validateVersion(data.version),
      productId: data.productId || null,
      action: data.action || null,
      updatedAt: data.updatedAt || null
    };
  });

  return {
    generation,
    afterVersion,
    changes,
    hasMore,

    nextVersion: changes.length
      ? changes[changes.length - 1].version
      : afterVersion
  };
}

// --------------------------------------------------
// Reset Catalog Generation
// --------------------------------------------------

/**
 * Intended for monthly reset.
 *
 * Example:
 * generation = "2026-12-01"
 *
 * Only updates meta/productCatalog.
 *
 * Does not delete:
 * - products
 * - productLots
 * - productSkuIndex
 * - productChanges
 * - meta/taxonomy
 */

async function resetCatalogGeneration(options = {}) {
  const {
    db,
    generation
  } = options;

  validateDb(db);

  const nextGeneration = validateGeneration(generation);

  return db.runTransaction(async (transaction) => {
    const metaRef = getMetaRef(db);

    // READ FIRST.
    const snapshot = await transaction.get(metaRef);

    const data = snapshot.exists
      ? snapshot.data() || {}
      : {};

    const currentGeneration =
      cleanString(data.generation, 100) ||
      DEFAULT_GENERATION;

    const currentVersion = validateVersion(
      data.version,
      0
    );

    if (currentGeneration === nextGeneration) {
      return {
        changed: false,
        generation: currentGeneration,
        version: currentVersion
      };
    }

    // WRITE AFTER READ.
    transaction.set(
      metaRef,
      {
        generation: nextGeneration,
        version: 1,
        updatedAt: new Date()
      },
      { merge: true }
    );

    return {
      changed: true,
      generation: nextGeneration,
      version: 1
    };
  });
}

// --------------------------------------------------
// Full Sync State
// --------------------------------------------------

async function getFullCatalogSyncState(db) {
  const meta = await getCatalogMeta(db);

  return {
    generation: meta.generation,
    version: meta.version,
    fullSyncRequired: true
  };
}

// --------------------------------------------------
// Exports
// --------------------------------------------------

module.exports = {
  META_COLLECTION,
  CATALOG_META_DOCUMENT,
  CHANGES_COLLECTION,

  getCatalogMeta,
  checkCatalogVersion,

  prepareProductChange,

  getProductChanges,

  resetCatalogGeneration,

  getFullCatalogSyncState
};
