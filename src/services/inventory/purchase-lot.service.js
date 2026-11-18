'use strict';

const { db } = require('../../config/firebase');
const { ProductError, cleanString } = require('../product/product-utils');
const productLotService = require('./product-lot.service');

const PURCHASE_LOTS = 'purchaseLots';
const PRODUCT_LOTS = 'productLots';
const PRODUCTS = 'products';
const ALLOCATIONS = 'orderStockAllocations';

function error(message, statusCode = 400, code = 'PURCHASE_LOT_ERROR') {
  return new ProductError(message, statusCode, code);
}

function id(value, label = 'ID') {
  const result = cleanString(value, 128);
  if (!result || !/^[\p{L}\p{N}_-]+$/u.test(result)) {
    throw error(`Invalid ${label}.`, 400, 'INVALID_ID');
  }
  return result;
}

function money(value, label, fallback = 0) {
  const source = value === '' || value == null ? fallback : value;
  const number = Number(source);
  if (!Number.isFinite(number) || number < 0) {
    throw error(`${label} must be a non-negative number.`);
  }
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function lotNumberFromId(documentId) {
  return `LOT-${documentId.slice(0, 8).toUpperCase()}`;
}

function quantity(value, fallback = 0) {
  const source = value === '' || value == null ? fallback : value;
  const number = Number(source);

  if (!Number.isSafeInteger(number) || number < 0) {
    return fallback;
  }

  return number;
}

function normalizeLot(payload = {}) {
  const lotName = cleanString(payload.lotName || payload.name, 100);
  if (!lotName) throw error('Lot Name is required.');

  const purchaseCost = money(payload.purchaseCost, 'Purchase Cost');
  const transportCost = money(payload.transportCost, 'Transport Cost');
  const otherCost = money(payload.otherCost, 'Other Cost');

  return {
    lotName,
    purchaseCost,
    transportCost,
    otherCost,
    totalCost: money(
      purchaseCost + transportCost + otherCost,
      'Total Cost'
    ),
    note: cleanString(payload.note, 1000)
  };
}

async function createPurchaseLot(payload = {}, admin = {}) {
  const input = normalizeLot(payload);
  const ref = db.collection(PURCHASE_LOTS).doc();
  const now = new Date();

  const document = {
    id: ref.id,
    lotNumber: lotNumberFromId(ref.id),
    ...input,
    itemPurchaseCost: 0,
    productIds: [],
    productLotIds: [],
    productCount: 0,
    totalQuantity: 0,
    remainingQuantity: 0,
    soldQuantity: 0,
    status: 'empty',
    createdBy: admin.uid || null,
    createdAt: now,
    updatedAt: now
  };

  await ref.create(document);
  return document;
}

async function getPurchaseLot(lotId) {
  const lotDocumentId = id(lotId, 'Lot ID');
  const snapshot = await db.collection(PURCHASE_LOTS).doc(lotDocumentId).get();

  if (!snapshot.exists) {
    throw error('Purchase Lot not found.', 404, 'LOT_NOT_FOUND');
  }

  const itemSnapshot = await db
    .collection(PRODUCT_LOTS)
    .where('parentLotId', '==', lotDocumentId)
    .get();

  return {
    id: snapshot.id,
    ...snapshot.data(),
    items: itemSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  };
}

async function updatePurchaseLot(lotId, payload = {}) {
  const lotDocumentId = id(lotId, 'Lot ID');
  await getOrPromotePurchaseLot(lotDocumentId);

  const ref = db.collection(PURCHASE_LOTS).doc(lotDocumentId);
  const itemsQuery = db
    .collection(PRODUCT_LOTS)
    .where('parentLotId', '==', lotDocumentId);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw error('Purchase Lot not found.', 404, 'LOT_NOT_FOUND');

    const itemSnapshot = await transaction.get(itemsQuery);

    const existing = snapshot.data() || {};
    const lotName = payload.lotName === undefined
      ? existing.lotName
      : cleanString(payload.lotName, 100);

    if (!lotName) throw error('Lot Name is required.');

    const purchaseCost = payload.purchaseCost === undefined
      ? money(existing.purchaseCost, 'Purchase Cost')
      : money(payload.purchaseCost, 'Purchase Cost');
    const transportCost = payload.transportCost === undefined
      ? money(existing.transportCost, 'Transport Cost')
      : money(payload.transportCost, 'Transport Cost');
    const otherCost = payload.otherCost === undefined
      ? money(existing.otherCost, 'Other Cost')
      : money(payload.otherCost, 'Other Cost');
    const effectivePurchaseCost = Math.max(
      purchaseCost,
      money(existing.itemPurchaseCost, 'Item Purchase Cost')
    );

    const update = {
      lotName,
      purchaseCost,
      transportCost,
      otherCost,
      totalCost: money(
        effectivePurchaseCost + transportCost + otherCost,
        'Total Cost'
      ),
      note: payload.note === undefined
        ? existing.note || ''
        : cleanString(payload.note, 1000),
      updatedAt: new Date()
    };

    transaction.update(ref, update);

    for (const item of itemSnapshot.docs) {
      transaction.set(item.ref, {
        lotName,
        parentLotNumber: existing.lotNumber || null,
        updatedAt: update.updatedAt
      }, { merge: true });
    }

    return { id: ref.id, ...existing, ...update };
  });
}

async function promoteLegacyLot(lotDocumentId) {
  const lotRef = db.collection(PURCHASE_LOTS).doc(lotDocumentId);
  const legacyRef = db.collection(PRODUCT_LOTS).doc(lotDocumentId);

  return db.runTransaction(async transaction => {
    const existingSnapshot = await transaction.get(lotRef);

    if (existingSnapshot.exists) {
      return { id: existingSnapshot.id, ...existingSnapshot.data() };
    }

    const legacySnapshot = await transaction.get(legacyRef);

    if (!legacySnapshot.exists) {
      throw error('Purchase Lot not found.', 404, 'LOT_NOT_FOUND');
    }

    const legacy = legacySnapshot.data() || {};

    if (legacy.parentLotId) {
      throw error('Purchase Lot not found.', 404, 'LOT_NOT_FOUND');
    }

    const now = new Date();
    const lotNumber = cleanString(legacy.lotNumber, 100) ||
      lotNumberFromId(lotDocumentId);
    const lotName = cleanString(legacy.lotName, 100) || lotNumber;
    const purchaseCost = money(legacy.purchaseCost, 'Purchase Cost');
    const transportCost = money(legacy.transportCost, 'Transport Cost');
    const otherCost = money(legacy.otherCost, 'Other Cost');
    const calculatedTotalCost = money(
      purchaseCost + transportCost + otherCost,
      'Total Cost'
    );
    const totalCost = money(
      legacy.landedCost ?? legacy.totalCost,
      'Total Cost',
      calculatedTotalCost
    );
    const totalQuantity = quantity(legacy.totalQuantity);
    const remainingQuantity = Math.min(
      totalQuantity,
      quantity(legacy.remainingQuantity, totalQuantity)
    );
    const productId = cleanString(legacy.productId, 128);
    const legacyStatus = cleanString(legacy.status, 30).toLowerCase();
    const status = legacyStatus === 'closed' || legacyStatus === 'cancelled'
      ? legacyStatus
      : remainingQuantity > 0
        ? 'active'
        : 'empty';

    const document = {
      id: lotDocumentId,
      lotNumber,
      lotName,
      purchaseCost,
      transportCost,
      otherCost,
      totalCost,
      itemPurchaseCost: purchaseCost,
      productIds: productId ? [productId] : [],
      productLotIds: [legacySnapshot.id],
      productCount: productId ? 1 : 0,
      totalQuantity,
      remainingQuantity,
      soldQuantity: Math.max(0, totalQuantity - remainingQuantity),
      status,
      note: cleanString(legacy.note, 1000),
      createdBy: legacy.createdBy || null,
      createdAt: legacy.createdAt || legacy.purchaseDate || now,
      updatedAt: now
    };

    transaction.create(lotRef, document);
    transaction.set(legacyRef, {
      parentLotId: lotDocumentId,
      parentLotNumber: lotNumber,
      updatedAt: now
    }, { merge: true });

    return document;
  });
}

async function getOrPromotePurchaseLot(lotDocumentId) {
  const snapshot = await db
    .collection(PURCHASE_LOTS)
    .doc(lotDocumentId)
    .get();

  if (snapshot.exists) {
    return { id: snapshot.id, ...snapshot.data() };
  }

  return promoteLegacyLot(lotDocumentId);
}

async function addProductStock(lotId, payload = {}) {
  const lotDocumentId = id(lotId, 'Lot ID');
  const productId = id(payload.productId, 'Product ID');
  const lotRef = db.collection(PURCHASE_LOTS).doc(lotDocumentId);
  const lot = await getOrPromotePurchaseLot(lotDocumentId);
  if (lot.status === 'closed' || lot.status === 'cancelled') {
    throw error('Stock cannot be added to a closed Lot.', 409, 'LOT_CLOSED');
  }

  const requestedPurchaseCost = money(payload.purchaseCost, 'Purchase Cost');
  const result = await productLotService.createProductLot(productId, {
    lotName: lot.lotName,
    parentLotId: lotDocumentId,
    parentLotNumber: lot.lotNumber,
    variants: payload.variants,
    purchaseCost: requestedPurchaseCost,
    landedCost: requestedPurchaseCost,
    note: payload.note
  });

  const batch = result.lot;
  const batchPurchaseCost = money(
    batch.purchaseCost,
    'Purchase Cost'
  );

  await db.runTransaction(async transaction => {
    const freshSnapshot = await transaction.get(lotRef);
    if (!freshSnapshot.exists) throw error('Purchase Lot not found.', 404, 'LOT_NOT_FOUND');

    const current = freshSnapshot.data() || {};
    const productIds = Array.isArray(current.productIds) ? [...current.productIds] : [];
    const productLotIds = Array.isArray(current.productLotIds)
      ? [...current.productLotIds]
      : [];

    if (!productIds.includes(productId)) productIds.push(productId);
    if (!productLotIds.includes(batch.id)) productLotIds.push(batch.id);

    const itemPurchaseCost = money(
      Number(current.itemPurchaseCost || 0) + batchPurchaseCost,
      'Item Purchase Cost'
    );
    const totalQuantity = Number(current.totalQuantity || 0) + batch.totalQuantity;
    const remainingQuantity = Number(current.remainingQuantity || 0) + batch.remainingQuantity;
    const purchaseCost = Math.max(Number(current.purchaseCost || 0), itemPurchaseCost);

    transaction.update(lotRef, {
      productIds,
      productLotIds,
      productCount: productIds.length,
      itemPurchaseCost,
      purchaseCost,
      totalCost: money(
        purchaseCost + Number(current.transportCost || 0) + Number(current.otherCost || 0),
        'Total Cost'
      ),
      totalQuantity,
      remainingQuantity,
      status: remainingQuantity > 0 ? 'active' : 'empty',
      updatedAt: new Date()
    });
  });

  return {
    lot: await getPurchaseLot(lotDocumentId),
    stockBatch: batch,
    product: result.product
  };
}

async function listLegacyLots() {
  const snapshot = await db
    .collection(PRODUCT_LOTS)
    .orderBy('purchaseDate', 'desc')
    .limit(100)
    .get();

  const ungrouped = snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(item => !item.parentLotId);

  const productIds = [...new Set(ungrouped.map(item => item.productId).filter(Boolean))];
  const refs = productIds.map(productId => db.collection(PRODUCTS).doc(productId));
  const productSnapshots = refs.length ? await db.getAll(...refs) : [];
  const names = new Map(productSnapshots.map(item => [
    item.id,
    item.exists ? item.data()?.name || item.data()?.basic?.name || 'Unknown Product' : 'Unknown Product'
  ]));

  return ungrouped.map(item => ({
    ...item,
    legacy: true,
    lotName: item.lotName || item.lotNumber,
    productName: names.get(item.productId) || 'Unknown Product',
    productCount: 1,
    totalCost: Number(item.landedCost || item.purchaseCost || 0)
  }));
}

async function listPurchaseLots() {
  const [groupSnapshot, legacyLots] = await Promise.all([
    db.collection(PURCHASE_LOTS).orderBy('createdAt', 'desc').limit(100).get(),
    listLegacyLots()
  ]);

  const lots = groupSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  return {
    lots: [...lots, ...legacyLots].sort((a, b) => {
      const left = a.createdAt?.toMillis?.() || a.createdAt?.getTime?.() || 0;
      const right = b.createdAt?.toMillis?.() || b.createdAt?.getTime?.() || 0;
      return right - left;
    }),
    count: lots.length + legacyLots.length
  };
}

async function getLotAnalytics(lotId) {
  const lot = await getPurchaseLot(lotId);
  const batchIds = new Set(lot.items.map(item => item.id));
  const allocationSnapshot = await db.collection(ALLOCATIONS).limit(1000).get();

  let soldQuantity = 0;
  let costOfGoods = 0;
  let revenue = 0;

  for (const doc of allocationSnapshot.docs) {
    const allocation = doc.data() || {};
    if (allocation.status === 'restored') continue;

    for (const item of allocation.items || []) {
      for (const line of item.allocations || []) {
        if (!batchIds.has(line.lotId)) continue;
        soldQuantity += Number(line.quantity || 0);
        costOfGoods += Number(line.landedCost || 0);
        revenue += Number(line.revenue || 0);
      }
    }
  }

  const totalCost = Number(lot.totalCost || 0);
  const remainingQuantity = Math.max(0, Number(lot.totalQuantity || 0) - soldQuantity);

  return {
    lotId: lot.id,
    lotNumber: lot.lotNumber,
    lotName: lot.lotName,
    productCount: lot.productIds?.length || 0,
    totalQuantity: Number(lot.totalQuantity || 0),
    soldQuantity,
    remainingQuantity,
    purchaseCost: Number(lot.purchaseCost || 0),
    transportCost: Number(lot.transportCost || 0),
    otherCost: Number(lot.otherCost || 0),
    totalCost,
    costOfGoods: money(costOfGoods, 'Cost of Goods'),
    revenue: money(revenue, 'Revenue'),
    grossProfit: money(Math.max(0, revenue - costOfGoods), 'Gross Profit'),
    netProfit: Math.round((revenue - totalCost + Number.EPSILON) * 100) / 100
  };
}

module.exports = {
  createPurchaseLot,
  updatePurchaseLot,
  addProductStock,
  listPurchaseLots,
  getPurchaseLot,
  getLotAnalytics
};
