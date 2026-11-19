'use strict';

require('dotenv').config();

const {
  admin,
  db
} = require('../src/config/firebase');

const {
  CANONICAL_SCHEMA_VERSION,
  buildCanonicalProductDocument
} = require('../src/services/product/product-schema.service');

const {
  buildPrivateData,
  mergePrivateProductData,
  prepareProductPrivateContext
} = require('../src/services/product/product-private.service');

const MIGRATION_ID = `product-schema-v${CANONICAL_SCHEMA_VERSION}`;
const PRODUCTS_COLLECTION = 'products';
const PRIVATE_COLLECTION = 'private';
const BACKUP_COLLECTION = 'migrationBackups';
const META_COLLECTION = 'meta';
const META_DOCUMENT = 'productSchemaMigration';
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 200;

function parsePositiveInteger(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, max)
    : fallback;
}

function parseArguments(argv = process.argv.slice(2)) {
  const options = {
    apply: false,
    batchSize: DEFAULT_BATCH_SIZE,
    limit: Number.MAX_SAFE_INTEGER,
    restore: ''
  };

  argv.forEach(argument => {
    if (argument === '--apply') {
      options.apply = true;
      return;
    }

    if (argument.startsWith('--batch-size=')) {
      options.batchSize = parsePositiveInteger(
        argument.split('=')[1],
        DEFAULT_BATCH_SIZE,
        MAX_BATCH_SIZE
      );
      return;
    }

    if (argument.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(
        argument.split('=')[1],
        Number.MAX_SAFE_INTEGER
      );
      return;
    }

    if (argument.startsWith('--restore=')) {
      options.restore = String(argument.split('=')[1] || '').trim();
    }
  });

  return options;
}

function stableValue(value) {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }

  if (value instanceof Date) {
    return { __date: value.toISOString() };
  }

  if (value && typeof value.toMillis === 'function') {
    return { __timestamp: value.toMillis() };
  }

  if (
    value === null ||
    typeof value !== 'object'
  ) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, stableValue(value[key])])
  );
}

function structuresEqual(left, right) {
  return JSON.stringify(stableValue(left)) ===
    JSON.stringify(stableValue(right));
}

function exactKeys(value, expectedKeys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();

  return structuresEqual(actual, expected);
}

function getBackupRef(productId) {
  return db
    .collection(BACKUP_COLLECTION)
    .doc(MIGRATION_ID)
    .collection('products')
    .doc(productId);
}

async function readPrivateState(productId, product = {}) {
  const privateId = String(product.privateId || '').trim();

  if (!privateId) {
    return {
      privateId: '',
      batch: {},
      record: {}
    };
  }

  const snapshot = await db
    .collection(PRIVATE_COLLECTION)
    .doc(privateId)
    .get();
  const batch = snapshot.exists ? snapshot.data() || {} : {};
  const products = batch.products && typeof batch.products === 'object'
    ? batch.products
    : {};

  return {
    privateId,
    batch,
    record: products[productId] || {}
  };
}

function analyzeProduct(productId, publicProduct, privateState) {
  const hydrated = mergePrivateProductData(
    {
      id: productId,
      ...publicProduct
    },
    privateState.record
  );
  const canonicalPublic = buildCanonicalProductDocument(hydrated);
  const canonicalPrivateData = buildPrivateData(
    hydrated,
    privateState.record?.data
  );
  const issues = [];

  if (!structuresEqual(publicProduct, canonicalPublic)) {
    issues.push('public-product');
  }

  if (!privateState.privateId) {
    issues.push('private-id');
  }

  if (!exactKeys(privateState.record, [
    'productId',
    'data',
    'updatedAt'
  ])) {
    issues.push('private-record-shape');
  }

  if (!structuresEqual(
    privateState.record?.data || {},
    canonicalPrivateData
  )) {
    issues.push('private-data');
  }

  if (
    privateState.privateId &&
    !exactKeys(privateState.batch, [
      'id',
      'batchNumber',
      'capacity',
      'count',
      'productIds',
      'products',
      'createdAt',
      'updatedAt'
    ])
  ) {
    issues.push('private-batch-shape');
  }

  return {
    hydrated,
    canonicalPublic,
    canonicalPrivateData,
    issues
  };
}

async function migrateProduct(productId) {
  const productRef = db
    .collection(PRODUCTS_COLLECTION)
    .doc(productId);
  const backupRef = getBackupRef(productId);

  return db.runTransaction(async transaction => {
    const productSnapshot = await transaction.get(productRef);

    if (!productSnapshot.exists) {
      return { migrated: false, missing: true };
    }

    const backupSnapshot = await transaction.get(backupRef);
    const publicProduct = productSnapshot.data() || {};
    const privateContext = await prepareProductPrivateContext({
      db,
      transaction,
      productId,
      privateId: publicProduct.privateId || ''
    });
    const existingRecord = privateContext.getExistingRecord();
    const existingBatch = privateContext.getExistingBatch();
    const hydrated = privateContext.hydrate({
      id: productId,
      ...publicProduct
    });
    const privatePlan = privateContext.prepare(hydrated);
    const canonicalPublic = buildCanonicalProductDocument(
      privatePlan.publicProduct
    );
    const currentAnalysis = analyzeProduct(
      productId,
      publicProduct,
      {
        privateId: privateContext.privateId,
        batch: existingBatch,
        record: existingRecord
      }
    );

    if (currentAnalysis.issues.length === 0) {
      return { migrated: false, issues: [] };
    }

    if (!backupSnapshot.exists) {
      transaction.create(backupRef, {
        migrationId: MIGRATION_ID,
        productId,
        privateId: String(publicProduct.privateId || '').trim(),
        allocatedPrivateId: privateContext.privateId,
        publicProduct,
        privateRecord: existingRecord,
        backedUpAt: new Date()
      });
    }

    transaction.set(productRef, canonicalPublic);
    privatePlan.write(transaction);

    return {
      migrated: true,
      issues: currentAnalysis.issues
    };
  });
}

async function restoreProduct(productId) {
  const backupRef = getBackupRef(productId);
  const backupSnapshot = await backupRef.get();

  if (!backupSnapshot.exists) {
    throw new Error(`Backup not found for Product ${productId}.`);
  }

  const backup = backupSnapshot.data() || {};
  const productRef = db
    .collection(PRODUCTS_COLLECTION)
    .doc(productId);
  const privateId = String(backup.privateId || '').trim();
  const allocatedPrivateId = String(
    backup.allocatedPrivateId || privateId
  ).trim();

  return db.runTransaction(async transaction => {
    let privateRef = null;
    let privateBatch = {};
    const restorePrivateRecord = Boolean(
      privateId &&
      backup.privateRecord &&
      Object.keys(backup.privateRecord).length
    );
    const cleanupAllocatedRecord = Boolean(
      !privateId && allocatedPrivateId
    );

    if (restorePrivateRecord || cleanupAllocatedRecord) {
      privateRef = db.collection(PRIVATE_COLLECTION).doc(
        restorePrivateRecord ? privateId : allocatedPrivateId
      );
      const privateSnapshot = await transaction.get(privateRef);
      privateBatch = privateSnapshot.exists
        ? privateSnapshot.data() || {}
        : {};
    }

    transaction.set(productRef, backup.publicProduct || {});

    if (privateRef && restorePrivateRecord) {
      const products = {
        ...(privateBatch.products || {}),
        [productId]: backup.privateRecord
      };
      const productIds = [...new Set([
        ...(Array.isArray(privateBatch.productIds)
          ? privateBatch.productIds
          : []),
        productId
      ])];

      transaction.set(privateRef, {
        ...privateBatch,
        id: privateId,
        productIds,
        count: productIds.length,
        products,
        updatedAt: new Date()
      });
    } else if (privateRef && cleanupAllocatedRecord) {
      const products = {
        ...(privateBatch.products || {})
      };
      const productIds = (
        Array.isArray(privateBatch.productIds)
          ? privateBatch.productIds
          : []
      ).filter(id => id !== productId);

      delete products[productId];

      transaction.set(privateRef, {
        ...privateBatch,
        productIds,
        count: productIds.length,
        products,
        updatedAt: new Date()
      });
    }

    return { restored: true, productId };
  });
}

async function listDocumentSnapshots(collectionRef, options, handler) {
  let lastDocument = null;
  let processed = 0;

  while (processed < options.limit) {
    const pageSize = Math.min(
      options.batchSize,
      options.limit - processed
    );
    let query = collectionRef
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize);

    if (lastDocument) {
      query = query.startAfter(lastDocument);
    }

    const snapshot = await query.get();

    if (snapshot.empty) {
      break;
    }

    for (const document of snapshot.docs) {
      await handler(document);
      processed++;

      if (processed >= options.limit) {
        break;
      }
    }

    lastDocument = snapshot.docs[snapshot.docs.length - 1];

    if (snapshot.docs.length < pageSize) {
      break;
    }
  }

  return processed;
}

async function runRestore(options) {
  if (!options.apply) {
    throw new Error('Restore requires --apply.');
  }

  const restored = [];
  const failures = [];

  if (options.restore !== 'all') {
    await restoreProduct(options.restore);
    return {
      mode: 'restore',
      restored: [options.restore],
      failures
    };
  }

  const backupsRef = db
    .collection(BACKUP_COLLECTION)
    .doc(MIGRATION_ID)
    .collection('products');

  await listDocumentSnapshots(backupsRef, options, async document => {
    try {
      await restoreProduct(document.id);
      restored.push(document.id);
    } catch (error) {
      failures.push({
        productId: document.id,
        message: error.message
      });
    }
  });

  return {
    mode: 'restore',
    restored,
    failures
  };
}

async function runMigration(options = parseArguments()) {
  if (options.restore) {
    return runRestore(options);
  }

  const result = {
    migrationId: MIGRATION_ID,
    mode: options.apply ? 'apply' : 'dry-run',
    scanned: 0,
    clean: 0,
    pending: 0,
    migrated: 0,
    failures: []
  };
  const productsRef = db.collection(PRODUCTS_COLLECTION);

  await listDocumentSnapshots(productsRef, options, async document => {
    result.scanned++;

    try {
      const publicProduct = document.data() || {};
      const privateState = await readPrivateState(
        document.id,
        publicProduct
      );
      const analysis = analyzeProduct(
        document.id,
        publicProduct,
        privateState
      );

      if (analysis.issues.length === 0) {
        result.clean++;
        return;
      }

      result.pending++;

      if (options.apply) {
        const migration = await migrateProduct(document.id);

        if (migration.migrated) {
          result.migrated++;
        }
      }
    } catch (error) {
      result.failures.push({
        productId: document.id,
        message: error.message
      });
    }
  });

  if (options.apply) {
    await db.collection(META_COLLECTION).doc(META_DOCUMENT).set({
      migrationId: MIGRATION_ID,
      schemaVersion: CANONICAL_SCHEMA_VERSION,
      completedAt: new Date(),
      scanned: result.scanned,
      migrated: result.migrated,
      failureCount: result.failures.length
    }, { merge: true });
  }

  return result;
}

async function main() {
  const options = parseArguments();

  try {
    const result = await runMigration(options);

    console.log(JSON.stringify(result, null, 2));

    if (result.failures?.length) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('[Product Schema Migration]', error.message);
    process.exitCode = 1;
  } finally {
    try {
      await admin.app().delete();
    } catch (error) {
      console.error('[Firebase Shutdown]', error.message);
    }
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  MIGRATION_ID,
  parseArguments,
  analyzeProduct,
  runMigration,
  restoreProduct
};
