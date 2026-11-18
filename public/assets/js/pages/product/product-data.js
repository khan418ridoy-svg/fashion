'use strict';

// ========================================
// PRODUCT DATA HELPERS
// Product object theke value ber korar function gulo
// ========================================

export function firstValue(...values) {
  return values.find(v => v !== undefined && v !== null && v !== '');
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString('en-BD');
}

export function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-BD', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 2
  });
}

export function formatDate(value) {
  if (!value) return '—';

  let date;

  if (typeof value === 'object') {
    const seconds = value.seconds ?? value._seconds;
    date = seconds !== undefined
      ? new Date(Number(seconds) * 1000)
      : new Date(value);
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return '—';

  return date.toLocaleString('en-BD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

export function getProductName(product) {
  return product.name || product.title || product.basic?.name || 'Unnamed Product';
}

export function getProductStock(product) {
  return Number(
    product.availableStock ??
    product.availableQuantity ??
    product.totalStock ??
    product.stock ??
    product.inventory?.availableStock ??
    product.inventory?.totalStock ??
    0
  );
}

export function getProductStatus(product) {
  if (product.active === true) return 'active';
  if (product.deleted === true) return 'archived';
  if (product.active === false) return 'draft';

  return String(product.status || 'draft').toLowerCase();
}

export function getProductPrice(product) {
  return Number(
    product.sellingPrice ??
    product.price ??
    product.pricing?.sellingPrice ??
    0
  );
}

function toUrl(item) {
  if (!item) return '';
  return typeof item === 'string' ? item : item.url || item.src || '';
}

export function getProductImages(product) {
  const list = [
    product.image,
    product.thumbnail,
    ...(Array.isArray(product.images) ? product.images : []),
    ...(Array.isArray(product.media?.images) ? product.media.images : [])
  ].map(toUrl).filter(Boolean);

  return [...new Set(list)];
}

export function getProductTags(product) {
  const tags = firstValue(product.tags, product.basic?.tags, []);

  if (Array.isArray(tags)) return tags.map(String).filter(Boolean);
  if (typeof tags === 'string') {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

export function getProductVariants(product) {
  if (!Array.isArray(product.variants)) return [];

  return product.variants.map(variant => ({
    name: firstValue(
      variant.name,
      variant.title,
      variant.label,
      [variant.color, variant.size].filter(Boolean).join(' / '),
      '—'
    ),
    sku: firstValue(variant.sku, variant.code, '—'),
    size: firstValue(variant.size, variant.attributes?.size, '—'),
    color: firstValue(variant.color, variant.colour, variant.attributes?.color, '—'),
    price: Number(firstValue(variant.sellingPrice, variant.price, 0)),
    stock: Number(firstValue(
      variant.availableStock,
      variant.availableQuantity,
      variant.stock,
      variant.quantity,
      0
    ))
  }));
}

export function getStockInfo(product) {
  const available = getProductStock(product);
  const threshold = Number(product.lowStockThreshold ?? product.inventory?.lowStockThreshold ?? 5);
  const reserved = Number(firstValue(product.reservedStock, product.inventory?.reservedStock, 0));
  const total = Number(firstValue(
    product.totalStock,
    product.inventory?.totalStock,
    available + reserved
  ));

  let label = 'In Stock';
  let level = 'ok';

  if (available <= 0) {
    label = 'Out of Stock';
    level = 'out';
  } else if (available <= threshold) {
    label = 'Low Stock';
    level = 'low';
  }

  return { available, reserved, total, threshold, label, level };
}

export function getPricingInfo(product) {
  const selling = getProductPrice(product);
  const cost = Number(firstValue(
    product.buyPrice,
    product.costPrice,
    product.purchasePrice,
    product.cost?.buyPrice,
    product.pricing?.costPrice,
    product.pricing?.purchasePrice,
    0
  ));
  const compare = Number(firstValue(
    product.comparePrice,
    product.mrp,
    product.regularPrice,
    product.pricing?.comparePrice,
    product.pricing?.mrp,
    0
  ));

  const profit = cost > 0 && selling > 0 ? selling - cost : null;
  const margin = profit !== null ? (profit / selling) * 100 : null;
  const discount = compare > selling && selling > 0
    ? ((compare - selling) / compare) * 100
    : null;

  return { selling, cost, compare, profit, margin, discount };
}




export function getProductLots(product) {
  if (!Array.isArray(product.lots)) return [];

  return product.lots.map((lot, index) => {
    const rawVariants = Array.isArray(lot.variants) ? lot.variants : [];
    const variants = rawVariants.map((variant, variantIndex) => {
      const purchased = Number(firstValue(
        variant.quantity,
        variant.purchaseQuantity,
        variant.purchasedQty,
        variant.initialQuantity,
        0
      ));
      const remaining = Number(firstValue(
        variant.remainingQuantity,
        variant.remainingQty,
        variant.availableQuantity,
        variant.stock,
        0
      ));
      const sold = Number(firstValue(
        variant.soldQuantity,
        variant.soldQty,
        Math.max(purchased - remaining, 0)
      ));
      const buyPrice = Number(firstValue(
        variant.unitPurchaseCost,
        variant.buyPrice,
        variant.averageBuyRate,
        purchased > 0 ? Number(variant.purchaseCost || 0) / purchased : undefined,
        0
      ));
      const landedCost = Number(firstValue(
        variant.unitLandedCost,
        purchased > 0 ? Number(variant.landedCost || 0) / purchased : undefined,
        buyPrice
      ));

      return {
        id: firstValue(variant.variantId, variant.id, `variant-${variantIndex + 1}`),
        sku: firstValue(variant.sku, variant.variantSku, '—'),
        color: firstValue(variant.color, variant.colour, '—'),
        size: firstValue(variant.size, '—'),
        purchased,
        sold,
        remaining,
        buyPrice,
        landedCost,
        stockValue: remaining * landedCost
      };
    });

    const variantPurchased = variants.reduce((sum, item) => sum + item.purchased, 0);
    const variantRemaining = variants.reduce((sum, item) => sum + item.remaining, 0);
    const purchased = Number(firstValue(
      lot.totalQuantity,
      lot.quantity,
      lot.purchasedQty,
      lot.purchaseQty,
      lot.qty,
      lot.initialQty,
      variantPurchased,
      0
    ));
    const remaining = Number(firstValue(
      lot.remainingQuantity,
      lot.remainingQty,
      lot.remaining,
      lot.availableQuantity,
      lot.availableQty,
      lot.stock,
      variantRemaining,
      0
    ));
    const sold = Number(firstValue(
      lot.soldQuantity,
      lot.soldQty,
      lot.sold,
      Math.max(purchased - remaining, 0)
    ));
    const purchaseCost = Number(firstValue(
      lot.purchaseCost,
      variants.reduce((sum, item) => sum + (item.purchased * item.buyPrice), 0),
      0
    ));
    const transportCost = Number(firstValue(lot.transportCost, lot.costs?.transportCost, 0));
    const otherCost = Number(firstValue(lot.otherCost, lot.costs?.otherCost, 0));
    const landedCost = Number(firstValue(
      lot.landedCost,
      lot.totalCost,
      purchaseCost + transportCost + otherCost,
      0
    ));
    const buyPrice = Number(firstValue(
      lot.unitPurchaseCost,
      lot.buyPrice,
      lot.costPrice,
      lot.unitCost,
      purchased > 0 ? purchaseCost / purchased : undefined,
      0
    ));
    const unitLandedCost = Number(firstValue(
      lot.unitLandedCost,
      purchased > 0 ? landedCost / purchased : undefined,
      buyPrice,
      0
    ));
    const normalizedStatus = String(firstValue(lot.status, '')).toLowerCase();
    const status = ['cancelled', 'closed', 'draft'].includes(normalizedStatus)
      ? normalizedStatus
      : remaining <= 0 ? 'depleted' : 'available';

    return {
      lotNo: firstValue(lot.lotNo, lot.lotNumber, lot.name, lot.id, `Lot ${index + 1}`),
      lotName: firstValue(lot.lotName, lot.name, lot.lotNumber, `Lot ${index + 1}`),
      supplier: firstValue(lot.supplier, lot.supplierName, '—'),
      date: formatDate(firstValue(lot.purchasedAt, lot.purchaseDate, lot.createdAt, lot.date)),
      purchased,
      sold,
      remaining,
      buyPrice,
      unitLandedCost,
      purchaseCost,
      transportCost,
      otherCost,
      landedCost,
      stockValue: variants.length
        ? variants.reduce((sum, item) => sum + item.stockValue, 0)
        : remaining * unitLandedCost,
      status,
      note: firstValue(lot.note, lot.purchaseNote, ''),
      variants
    };
  });
}







export function getProductDetails(product) {
  return {
    sku: firstValue(product.sku, product.basic?.sku, '—'),
    productCode: firstValue(product.productCode, product.basic?.productCode, '—'),
    barcode: firstValue(product.barcode, product.basic?.barcode, '—'),
    brand: firstValue(product.brand, product.basic?.brand, '—'),
    category: firstValue(
      product.categoryName,
      product.category?.categoryName,
      product.category?.name,
      product.categoryId,
      product.category?.categoryId,
      '—'
    ),
    subCategory: firstValue(
      product.subCategoryName,
      product.subCategory?.name,
      product.subCategory,
      product.subcategoryId,
      product.subCategoryId,
      product.category?.subCategoryId,
      '—'
    ),
    collection: firstValue(
      product.collectionName,
      product.collection?.name,
      product.collectionId,
      product.category?.collectionId,
      '—'
    ),
    slug: firstValue(product.slug, product.seo?.slug, '—'),
    material: firstValue(
      product.material,
      product.fabricType,
      product.attributes?.material,
      product.attributes?.fabricType,
      '—'
    ),
    fit: firstValue(product.fit, product.attributes?.fit, '—'),
    sleeveType: firstValue(product.sleeveType, product.attributes?.sleeveType, '—'),
    washCare: firstValue(product.washCare, product.attributes?.washCare, '—'),
    weight: firstValue(product.weight, product.shipping?.weight, '—'),
    supplier: firstValue(product.supplier, product.cost?.supplier, '—'),
    purchaseNote: firstValue(product.purchaseNote, product.cost?.purchaseNote, ''),
    createdAt: formatDate(firstValue(product.createdAt, product.created_at)),
    updatedAt: formatDate(firstValue(product.updatedAt, product.updated_at)),
    lotCount: Array.isArray(product.lots)
      ? product.lots.length
      : Number(firstValue(product.lotCount, product.lotsCount, 0)),
    description: firstValue(
      product.description?.description,
      typeof product.description === 'string' ? product.description : '',
      product.shortDescription,
      product.description?.shortDescription,
      ''
    ),
    shortDescription: firstValue(
      product.shortDescription,
      product.description?.shortDescription,
      ''
    ),
    seoTitle: firstValue(product.seo?.title, product.seo?.metaTitle, '—'),
    seoDescription: firstValue(product.seo?.description, product.seo?.metaDescription, '—'),
    flags: {
      newArrival: product.isNewArrival === true || product.flags?.isNewArrival === true,
      featured: product.isFeatured === true || product.flags?.isFeatured === true,
      bestSeller: product.isBestSeller === true || product.flags?.isBestSeller === true
    },
    ratingAvg: Number(firstValue(product.ratingAvg, product.review?.ratingAvg, 0)),
    ratingCount: Number(firstValue(product.ratingCount, product.review?.ratingCount, 0)),
    soldCount: Number(firstValue(product.soldCount, product.review?.soldCount, 0))
  };
}
