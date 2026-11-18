
'use strict';

require('dotenv').config();

const {
  admin,
  db,
  FieldValue
} = require('../src/config/firebase');

const {
  resetCatalogGeneration
} = require('../src/services/product/product-cache.service');

// ========================================
// Bangladesh Date
// ========================================

function getBangladeshDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());

  const date = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      date[part.type] = part.value;
    }
  }

  return `${date.year}-${date.month}-${date.day}`;
}

// ========================================
// Reset Product Cache
// ========================================

async function resetProductCache() {
  const generation = `manual-${Date.now()}`;

  const result = await resetCatalogGeneration({
    db,
    generation
  });

  return {
    success: true,
    generation,
    result
  };
}

// ========================================
// Reset Taxonomy Version
// ========================================

async function resetTaxonomy() {
  const taxonomyRef = db
    .collection('meta')
    .doc('taxonomy');

  const result = await db.runTransaction(
    async transaction => {
      const snapshot = await transaction.get(taxonomyRef);

      const currentVersion = snapshot.exists
        ? Number(snapshot.data().version || 0)
        : 0;

      if (
        !Number.isSafeInteger(currentVersion) ||
        currentVersion < 0
      ) {
        throw new Error(
          'Invalid taxonomy version in meta/taxonomy.'
        );
      }

      const nextVersion =  1;

      transaction.set(
        taxonomyRef,
        {
          version: nextVersion,
          updatedAt: FieldValue.serverTimestamp()
        },
        {
          merge: true
        }
      );

      return {
        previousVersion: currentVersion,
        currentVersion: nextVersion
      };
    }
  );

  return {
    success: true,
    ...result
  };
}

// ========================================
// Run Both Resets
// ========================================

async function runProductCacheReset() {
  const date = getBangladeshDate();

  console.log('[Reset] Starting Product Cache Reset...');

  const productCache = await resetProductCache();

  console.log('[Reset] Product Cache completed.');

  console.log('[Reset] Starting Taxonomy Reset...');

  const taxonomy = await resetTaxonomy();

  console.log('[Reset] Taxonomy completed.');

  return {
    success: true,
    date,
    productCache,
    taxonomy
  };
}

// ========================================
// Main
// ========================================

async function main() {
  try {
    const result = await runProductCacheReset();

    console.log(
      '[Cache and Taxonomy Reset]',
      JSON.stringify(result, null, 2)
    );

    return result;
  } catch (error) {
    console.error(
      '[Cache and Taxonomy Reset Error]',
      error.message
    );

    process.exitCode = 1;

    throw error;
  }
}

// ========================================
// Execute Directly
// ========================================

if (require.main === module) {
  main()
    .catch(() => {})
    .finally(async () => {
      try {
        await admin.app().delete();
      } catch (error) {
        console.error(
          '[Firebase Shutdown Error]',
          error.message
        );
      }
    });
}

// ========================================
// Exports
// ========================================

module.exports = {
  runProductCacheReset,
  resetProductCache,
  resetTaxonomy,
  getBangladeshDate
};
