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
    name: firstValue(variant.name, variant.title, variant.label, '—'),
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
    product.costPrice,
    product.purchasePrice,
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
    const purchased = Number(firstValue(
      lot.quantity, lot.purchasedQty, lot.purchaseQty, lot.qty, lot.initialQty, 0
    ));
    const remaining = Number(firstValue(
      lot.remainingQty, lot.remaining, lot.availableQty, lot.stock, 0
    ));
    const sold = Number(firstValue(
      lot.soldQty, lot.sold, Math.max(purchased - remaining, 0)
    ));
    const buyPrice = Number(firstValue(lot.buyPrice, lot.costPrice, lot.unitCost, 0));

    return {
      lotNo: firstValue(lot.lotNo, lot.lotNumber, lot.name, lot.id, `Lot ${index + 1}`),
      variant: firstValue(
        lot.variantSku, lot.sku,
        [lot.color, lot.size].filter(Boolean).join(' / '),
        lot.variantId, '—'
      ),
      supplier: firstValue(lot.supplier, lot.supplierName, '—'),
      date: formatDate(firstValue(lot.purchasedAt, lot.purchaseDate, lot.createdAt, lot.date)),
      purchased,
      sold,
      remaining,
      buyPrice,
      stockValue: remaining * buyPrice,
      status: remaining <= 0 ? 'finished' : 'active'
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
      '—'
    ),
    subCategory: firstValue(
      product.subCategoryName,
      product.subCategory?.name,
      product.subCategory,
      '—'
    ),
    slug: firstValue(product.slug, product.seo?.slug, '—'),
    material: firstValue(product.material, product.attributes?.material, '—'),
    weight: firstValue(product.weight, product.shipping?.weight, '—'),
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
    seoDescription: firstValue(product.seo?.description, product.seo?.metaDescription, '—')
  };
}
