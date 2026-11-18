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
  return roundMoney(number);
}

function roundMoney(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) return 0;
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
    supplier: cleanString(payload.supplier, 150),
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
  const lot = await getOrPromotePurchaseLot(lotDocumentId);

  const itemSnapshot = await db
    .collection(PRODUCT_LOTS)
    .where('parentLotId', '==', lotDocumentId)
    .get();

  return {
    ...lot,
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
      supplier: payload.supplier === undefined
        ? cleanString(existing.supplier, 150)
        : cleanString(payload.supplier, 150),
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
      supplier: cleanString(legacy.supplier, 150),
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

async function deletePurchaseLot(lotId) {
  const lotDocumentId = id(lotId, 'Lot ID');
  const lotRef = db.collection(PURCHASE_LOTS).doc(lotDocumentId);
  const legacyRef = db.collection(PRODUCT_LOTS).doc(lotDocumentId);
  const itemsQuery = db
    .collection(PRODUCT_LOTS)
    .where('parentLotId', '==', lotDocumentId);

  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(lotRef);

    if (!snapshot.exists) {
      const legacySnapshot = await transaction.get(legacyRef);

      if (legacySnapshot.exists) {
        throw error(
          'This Lot contains Product stock and cannot be deleted.',
          409,
          'LOT_NOT_EMPTY'
        );
      }

      throw error('Purchase Lot not found.', 404, 'LOT_NOT_FOUND');
    }

    const itemSnapshot = await transaction.get(itemsQuery);
    const lot = snapshot.data() || {};
    const productIds = Array.isArray(lot.productIds) ? lot.productIds : [];
    const hasInventory = !itemSnapshot.empty ||
      productIds.length > 0 ||
      Number(lot.productCount || 0) > 0 ||
      Number(lot.totalQuantity || 0) > 0;

    if (hasInventory) {
      throw error(
        'Only an empty Lot can be deleted. Product stock and sales history must be preserved.',
        409,
        'LOT_NOT_EMPTY'
      );
    }

    transaction.delete(lotRef);

    return {
      id: lotDocumentId,
      deleted: true
    };
  });
}

async function listLegacyLots(sourceDocs = null) {
  const docs = Array.isArray(sourceDocs)
    ? sourceDocs
    : (await db
        .collection(PRODUCT_LOTS)
        .orderBy('purchaseDate', 'desc')
        .limit(100)
        .get()).docs;

  const ungrouped = docs
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
  const [groupSnapshot, productLotSnapshot] = await Promise.all([
    db.collection(PURCHASE_LOTS).orderBy('createdAt', 'desc').limit(100).get(),
    db.collection(PRODUCT_LOTS).limit(1000).get()
  ]);
  const productLotRecords = productLotSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
  const childrenByParent = new Map();

  productLotRecords.forEach(item => {
    if (!item.parentLotId) return;
    const children = childrenByParent.get(item.parentLotId) || [];
    children.push(item);
    childrenByParent.set(item.parentLotId, children);
  });

  const lots = groupSnapshot.docs.map(doc => {
    const lot = { id: doc.id, ...doc.data() };
    const children = childrenByParent.get(doc.id) || [];

    if (!children.length) return lot;

    const productIds = [...new Set(children
      .map(item => cleanString(item.productId, 128))
      .filter(Boolean))];
    const totalQuantity = children.reduce(
      (total, item) => total + quantity(item.totalQuantity),
      0
    );
    const remainingQuantity = children.reduce(
      (total, item) => total + quantity(item.remainingQuantity),
      0
    );
    const itemPurchaseCost = roundMoney(children.reduce(
      (total, item) => total + Number(item.purchaseCost || 0),
      0
    ));
    const purchaseCost = Math.max(
      Number(lot.purchaseCost || 0),
      itemPurchaseCost
    );

    return {
      ...lot,
      productIds,
      productLotIds: children.map(item => item.id),
      productCount: productIds.length,
      totalQuantity,
      remainingQuantity,
      soldQuantity: Math.max(0, totalQuantity - remainingQuantity),
      itemPurchaseCost,
      purchaseCost,
      totalCost: roundMoney(
        purchaseCost +
        Number(lot.transportCost || 0) +
        Number(lot.otherCost || 0)
      ),
      status: remainingQuantity <= 0
        ? 'depleted'
        : remainingQuantity < totalQuantity
          ? 'partial'
          : 'active'
    };
  });
  const legacyLots = await listLegacyLots(productLotSnapshot.docs);
  const productIds = [...new Set(lots.flatMap(lot => (
    Array.isArray(lot.productIds) ? lot.productIds : []
  )).filter(Boolean))];
  const productRefs = productIds.map(productId => (
    db.collection(PRODUCTS).doc(productId)
  ));
  const productSnapshots = productRefs.length
    ? await db.getAll(...productRefs)
    : [];
  const productNames = new Map(productSnapshots.map(snapshot => [
    snapshot.id,
    snapshot.exists
      ? snapshot.data()?.name || snapshot.data()?.basic?.name || 'Unknown Product'
      : 'Unknown Product'
  ]));
  const enrichedLots = lots.map(lot => {
    const ids = Array.isArray(lot.productIds) ? lot.productIds : [];
    const names = ids.map(productId => (
      productNames.get(productId) || 'Unknown Product'
    ));

    return {
      ...lot,
      productNames: names,
      productName: names.length > 1
        ? `${names[0]} +${names.length - 1} more`
        : names[0] || 'No Products',
      productCount: Number(lot.productCount ?? ids.length)
    };
  });

  return {
    lots: [...enrichedLots, ...legacyLots].sort((a, b) => {
      const left = a.createdAt?.toMillis?.() || a.createdAt?.getTime?.() || 0;
      const right = b.createdAt?.toMillis?.() || b.createdAt?.getTime?.() || 0;
      return right - left;
    }),
    count: enrichedLots.length + legacyLots.length
  };
}

async function getLotAnalytics(lotId) {
  const lot = await getPurchaseLot(lotId);
  const productIds = [...new Set(lot.items
    .map(item => cleanString(item.productId, 128))
    .filter(Boolean))];
  const productRefs = productIds.map(productId => (
    db.collection(PRODUCTS).doc(productId)
  ));
  const [productSnapshots, allocationSnapshots] = await Promise.all([
    productRefs.length ? db.getAll(...productRefs) : [],
    Promise.all(productIds.map(productId => (
      db.collection(ALLOCATIONS)
        .where('productId', '==', productId)
        .get()
    )))
  ]);
  const productData = new Map(productSnapshots.map(snapshot => [
    snapshot.id,
    snapshot.exists ? snapshot.data() || {} : {}
  ]));
  const productReports = new Map();
  const batchReports = new Map();

  function getProductReport(productId) {
    if (!productReports.has(productId)) {
      const product = productData.get(productId) || {};

      productReports.set(productId, {
        productId,
        productName: product.name || product.basic?.name || 'Unknown Product',
        sku: product.sku || product.basic?.sku || '',
        purchaseQuantity: 0,
        remainingQuantity: 0,
        soldQuantity: 0,
        purchaseCost: 0,
        landedCost: 0,
        costOfGoods: 0,
        revenue: 0,
        grossProfit: 0,
        profitLoss: 0,
        averageBuyRate: 0,
        averageSaleRate: 0,
        inventoryValue: 0,
        orderCount: 0,
        batches: [],
        variants: [],
        _allocatedSoldQuantity: 0,
        _orderIds: new Set(),
        _variants: new Map()
      });
    }

    return productReports.get(productId);
  }

  for (const item of lot.items) {
    const productId = cleanString(item.productId, 128);
    if (!productId) continue;

    const report = getProductReport(productId);
    const purchaseQuantity = quantity(item.totalQuantity);
    const remainingQuantity = Math.min(
      purchaseQuantity,
      quantity(item.remainingQuantity, purchaseQuantity)
    );
    const purchaseCost = roundMoney(item.purchaseCost);
    const landedCost = roundMoney(item.landedCost ?? purchaseCost);

    report.purchaseQuantity += purchaseQuantity;
    report.remainingQuantity += remainingQuantity;
    report.purchaseCost = roundMoney(report.purchaseCost + purchaseCost);
    report.landedCost = roundMoney(report.landedCost + landedCost);
    report.batches.push({
      id: item.id,
      lotNumber: item.lotNumber || item.id,
      purchaseQuantity,
      remainingQuantity,
      purchaseCost,
      landedCost
    });
    batchReports.set(item.id, report);

    for (const variant of Array.isArray(item.variants) ? item.variants : []) {
      const variantId = cleanString(
        variant.variantId || variant.id || variant.sku,
        128
      ) || [variant.color, variant.size].filter(Boolean).join('|') || 'default';
      const current = report._variants.get(variantId) || {
        variantId,
        sku: cleanString(variant.sku || variant.variantSku, 100),
        color: cleanString(variant.color, 100),
        size: cleanString(variant.size, 100),
        purchaseQuantity: 0,
        remainingQuantity: 0,
        purchaseCost: 0,
        landedCost: 0
      };
      const variantQuantity = quantity(variant.quantity);
      const variantRemaining = Math.min(
        variantQuantity,
        quantity(variant.remainingQuantity, variantQuantity)
      );
      const variantPurchaseCost = roundMoney(
        variant.purchaseCost ?? Number(variant.unitPurchaseCost || 0) * variantQuantity
      );
      const variantLandedCost = roundMoney(
        variant.landedCost ?? Number(variant.unitLandedCost || 0) * variantQuantity
      );

      current.purchaseQuantity += variantQuantity;
      current.remainingQuantity += variantRemaining;
      current.purchaseCost = roundMoney(current.purchaseCost + variantPurchaseCost);
      current.landedCost = roundMoney(current.landedCost + variantLandedCost);
      report._variants.set(variantId, current);
    }
  }

  const allocationDocs = new Map();
  allocationSnapshots.forEach(snapshot => {
    snapshot.docs.forEach(doc => allocationDocs.set(doc.id, doc));
  });

  for (const doc of allocationDocs.values()) {
    const allocation = doc.data() || {};
    if (allocation.status === 'restored') continue;

    for (const item of Array.isArray(allocation.items) ? allocation.items : []) {
      for (const line of Array.isArray(item.allocations) ? item.allocations : []) {
        const report = batchReports.get(line.lotId);
        if (!report) continue;

        report._allocatedSoldQuantity += quantity(line.quantity);
        report.costOfGoods = roundMoney(
          report.costOfGoods + Number(line.landedCost || 0)
        );
        report.revenue = roundMoney(
          report.revenue + Number(line.revenue || 0)
        );
        report._orderIds.add(allocation.orderId || doc.id);
      }
    }
  }

  const totalQuantity = [...productReports.values()].reduce(
    (total, report) => total + report.purchaseQuantity,
    0
  ) || Number(lot.totalQuantity || 0);
  const totalCost = roundMoney(lot.totalCost || 0);
  const totalItemLandedCost = roundMoney([...productReports.values()].reduce(
    (total, report) => total + report.landedCost,
    0
  ));
  const unallocatedLotCost = roundMoney(
    Math.max(0, totalCost - totalItemLandedCost)
  );

  const products = [...productReports.values()].map(report => {
    const derivedSoldQuantity = Math.max(
      0,
      report.purchaseQuantity - report.remainingQuantity
    );
    report.soldQuantity = Math.max(
      derivedSoldQuantity,
      report._allocatedSoldQuantity
    );
    const costShareBasis = totalItemLandedCost > 0
      ? report.landedCost / totalItemLandedCost
      : totalQuantity > 0
        ? report.purchaseQuantity / totalQuantity
        : 0;
    const productExtraCost = roundMoney(unallocatedLotCost * costShareBasis);
    const soldRatio = report.purchaseQuantity > 0
      ? Math.min(1, report.soldQuantity / report.purchaseQuantity)
      : 0;
    const remainingRatio = report.purchaseQuantity > 0
      ? Math.min(1, report.remainingQuantity / report.purchaseQuantity)
      : 0;
    const realizedExtraCost = roundMoney(productExtraCost * soldRatio);
    const remainingExtraCost = roundMoney(productExtraCost * remainingRatio);

    report.grossProfit = roundMoney(report.revenue - report.costOfGoods);
    report.profitLoss = roundMoney(report.grossProfit - realizedExtraCost);
    report.averageBuyRate = report.purchaseQuantity > 0
      ? roundMoney(report.purchaseCost / report.purchaseQuantity)
      : 0;
    report.averageSaleRate = report.soldQuantity > 0
      ? roundMoney(report.revenue / report.soldQuantity)
      : 0;
    report.inventoryValue = roundMoney(
      (report.purchaseQuantity > 0
        ? report.landedCost * remainingRatio
        : 0) + remainingExtraCost
    );
    report.orderCount = report._orderIds.size;
    report.variants = [...report._variants.values()].map(variant => ({
      ...variant,
      soldQuantity: Math.max(
        0,
        variant.purchaseQuantity - variant.remainingQuantity
      ),
      averageBuyRate: variant.purchaseQuantity > 0
        ? roundMoney(variant.purchaseCost / variant.purchaseQuantity)
        : 0,
      unitLandedCost: variant.purchaseQuantity > 0
        ? roundMoney(variant.landedCost / variant.purchaseQuantity)
        : 0
    }));

    delete report._allocatedSoldQuantity;
    delete report._orderIds;
    delete report._variants;

    return report;
  });

  const soldQuantity = products.reduce(
    (total, product) => total + product.soldQuantity,
    0
  );
  const remainingQuantity = products.length
    ? products.reduce((total, product) => total + product.remainingQuantity, 0)
    : Math.max(0, Number(lot.remainingQuantity || 0));
  const costOfGoods = roundMoney(products.reduce(
    (total, product) => total + product.costOfGoods,
    0
  ));
  const revenue = roundMoney(products.reduce(
    (total, product) => total + product.revenue,
    0
  ));
  const grossProfit = roundMoney(revenue - costOfGoods);
  const profitLoss = roundMoney(products.reduce(
    (total, product) => total + product.profitLoss,
    0
  ));
  const inventoryValue = roundMoney(products.reduce(
    (total, product) => total + product.inventoryValue,
    0
  ));

  return {
    lotId: lot.id,
    lotNumber: lot.lotNumber,
    lotName: lot.lotName,
    supplier: lot.supplier || '',
    note: lot.note || '',
    status: lot.status || 'empty',
    productCount: products.length,
    totalQuantity,
    soldQuantity,
    remainingQuantity,
    purchaseCost: Number(lot.purchaseCost || 0),
    transportCost: Number(lot.transportCost || 0),
    otherCost: Number(lot.otherCost || 0),
    totalCost,
    costOfGoods,
    revenue,
    grossProfit,
    netProfit: profitLoss,
    profitLoss,
    inventoryValue,
    unallocatedLotCost,
    products
  };
}

module.exports = {
  createPurchaseLot,
  updatePurchaseLot,
  addProductStock,
  deletePurchaseLot,
  listPurchaseLots,
  getPurchaseLot,
  getLotAnalytics
};
