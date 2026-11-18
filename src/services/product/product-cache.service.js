
'use strict';

// --------------------------------------------------
// Product Cache Service
// --------------------------------------------------

const META_COLLECTION = 'meta';
const CATALOG_META_DOCUMENT = 'productCatalog';

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

function dedupeChangesByProductId(changes = []) {
  const latestChanges = new Map();

  [...changes]
    .sort((left, right) => left.version - right.version)
    .forEach(change => {
      const key = `${change.generation}:${change.productId}`;
      const previous = latestChanges.get(key);
      const action = previous?.action === 'created' &&
        change.action === 'updated'
        ? 'created'
        : change.action;

      latestChanges.set(key, {
        ...change,
        action
      });
    });

  return [...latestChanges.values()]
    .sort((left, right) => left.version - right.version)
    .slice(-MAX_CHANGE_LIMIT);
}

function normalizeChanges(value, fallbackGeneration = DEFAULT_GENERATION) {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedChanges = value
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        return null;
      }

      const version = Number(item.version);
      const productId = cleanString(item.productId, 200);
      const action = cleanString(item.action, 30);

      if (
        !Number.isSafeInteger(version) ||
        version < 1 ||
        !productId ||
        !ALLOWED_ACTIONS.has(action)
      ) {
        return null;
      }

      return {
        generation:
          cleanString(item.generation, 100) ||
          fallbackGeneration,
        version,
        productId,
        action,
        updatedAt: item.updatedAt || null
      };
    })
    .filter(Boolean);

  return dedupeChangesByProductId(normalizedChanges);
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
      changes: [],
      exists: false
    };
  }

  const data = snapshot.data() || {};
  const generation =
    cleanString(data.generation, 100) ||
    DEFAULT_GENERATION;

  return {
    generation,

    version: validateVersion(data.version),

    updatedAt: data.updatedAt || null,

    changes: normalizeChanges(data.changes, generation),

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
    changes: serverState.changes,

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

  const existingChanges = normalizeChanges(
    data.changes,
    generation
  );
  const changeId = `${generation}:${nextVersion}`;

  let written = false;

  return {
    generation,
    version: nextVersion,
    productId: safeProductId,
    action: safeAction,
    changeId,

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
      const changes = normalizeChanges([
        ...existingChanges,
        {
          generation,
          version: nextVersion,
          productId: safeProductId,
          action: safeAction,
          updatedAt: now
        }
      ], generation);

      // Catalog version and recent changes live in one document/read.
      writeTransaction.set(
        metaRef,
        {
          generation,
          version: nextVersion,
          changes,
          updatedAt: now
        },
        { merge: true }
      );

      written = true;

      return {
        generation,
        version: nextVersion,
        changeId
      };
    }
  };
}

async function prepareProductChanges(options = {}) {
  const {
    db,
    transaction,
    changes
  } = options;

  validateDb(db);

  if (!transaction || typeof transaction.get !== 'function') {
    throw new Error('Firestore transaction is required.');
  }

  if (!Array.isArray(changes) || changes.length === 0) {
    throw new Error('At least one Product change is required.');
  }

  if (changes.length > MAX_CHANGE_LIMIT) {
    throw new Error(
      `Product changes cannot exceed ${MAX_CHANGE_LIMIT}.`
    );
  }

  const uniqueChanges = new Map();

  changes.forEach(change => {
    const normalizedChange = {
      productId: validateProductId(change?.productId),
      action: validateAction(change?.action)
    };
    const previous = uniqueChanges.get(normalizedChange.productId);

    uniqueChanges.set(normalizedChange.productId, {
      ...normalizedChange,
      action: previous?.action === 'created' &&
        normalizedChange.action === 'updated'
        ? 'created'
        : normalizedChange.action
    });
  });

  const normalizedChanges = [...uniqueChanges.values()];
  const metaRef = getMetaRef(db);
  const snapshot = await transaction.get(metaRef);
  const data = snapshot.exists
    ? snapshot.data() || {}
    : {};
  const generation =
    cleanString(data.generation, 100) ||
    DEFAULT_GENERATION;
  const currentVersion = validateVersion(data.version, 0);
  const nextVersion = currentVersion + normalizedChanges.length;

  if (!Number.isSafeInteger(nextVersion)) {
    throw new Error('Catalog version limit exceeded.');
  }

  const existingChanges = normalizeChanges(
    data.changes,
    generation
  );
  const plannedChanges = normalizedChanges.map((change, index) => ({
    generation,
    version: currentVersion + index + 1,
    productId: change.productId,
    action: change.action,
    changeId: `${generation}:${currentVersion + index + 1}`
  }));

  let written = false;

  return {
    generation,
    version: nextVersion,
    changes: plannedChanges.map(change => ({ ...change })),

    write(writeTransaction) {
      if (written) {
        throw new Error(
          'Product changes plan has already been written.'
        );
      }

      if (
        !writeTransaction ||
        typeof writeTransaction.set !== 'function'
      ) {
        throw new Error('Firestore transaction is required.');
      }

      const now = new Date();
      const nextChanges = normalizeChanges([
        ...existingChanges,
        ...plannedChanges.map(change => ({
          generation: change.generation,
          version: change.version,
          productId: change.productId,
          action: change.action,
          updatedAt: now
        }))
      ], generation);

      writeTransaction.set(
        metaRef,
        {
          generation,
          version: nextVersion,
          changes: nextChanges,
          updatedAt: now
        },
        { merge: true }
      );

      written = true;

      return {
        generation,
        version: nextVersion,
        changes: plannedChanges.map(change => ({ ...change }))
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

  const meta = await getCatalogMeta(db);
  const matchingChanges = meta.generation === generation
    ? meta.changes
        .filter(change => change.version > afterVersion)
        .sort((left, right) => left.version - right.version)
    : [];
  const hasMore = matchingChanges.length > limit;
  const changes = matchingChanges.slice(0, limit).map(change => ({
    ...change,
    changeId: `${change.generation}:${change.version}`
  }));

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
        changes: [],
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
    changes: meta.changes,
    fullSyncRequired: true
  };
}

// --------------------------------------------------
// Exports
// --------------------------------------------------

module.exports = {
  META_COLLECTION,
  CATALOG_META_DOCUMENT,

  getCatalogMeta,
  checkCatalogVersion,

  prepareProductChange,
  prepareProductChanges,

  getProductChanges,

  resetCatalogGeneration,

  getFullCatalogSyncState
};
