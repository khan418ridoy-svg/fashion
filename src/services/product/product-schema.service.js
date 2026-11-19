'use strict';

const {
  cleanString,
  isPlainObject,
  removeUndefined
} = require('./product-utils');

const CANONICAL_SCHEMA_VERSION = 1;

function hasOwn(source, field) {
  return isPlainObject(source) &&
    Object.prototype.hasOwnProperty.call(source, field);
}

function firstDefined(...values) {
  return values.find(value => (
    value !== undefined && value !== null && value !== ''
  ));
}

function toNonNegativeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number) && number >= 0
    ? number
    : fallback;
}

function toNonNegativeInteger(value, fallback = 0) {
  const number = Number(value);

  return Number.isSafeInteger(number) && number >= 0
    ? number
    : fallback;
}

function roundNumber(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function normalizeAssignments(source = {}) {
  const category = isPlainObject(source.category)
    ? source.category
    : {};
  const direct = Array.isArray(source.assignments)
    ? source.assignments
    : Array.isArray(category.assignments)
      ? category.assignments
      : null;
  let assignments = direct;

  if (!assignments) {
    const collectionIds = Array.isArray(source.collectionIds)
      ? source.collectionIds
      : Array.isArray(category.collectionIds)
        ? category.collectionIds
        : [];
    const categoryIds = Array.isArray(source.categoryIds)
      ? source.categoryIds
      : Array.isArray(category.categoryIds)
        ? category.categoryIds
        : [];
    const subCategoryIds = Array.isArray(source.subCategoryIds)
      ? source.subCategoryIds
      : Array.isArray(category.subCategoryIds)
        ? category.subCategoryIds
        : [];
    const length = Math.max(
      collectionIds.length,
      categoryIds.length,
      subCategoryIds.length
    );

    if (length > 0) {
      assignments = Array.from({ length }, (_, index) => ({
        collectionId: collectionIds[index],
        categoryId: categoryIds[index],
        subCategoryId: subCategoryIds[index]
      }));
    }
  }

  if (!assignments) {
    const collectionId = firstDefined(
      source.collectionId,
      category.collectionId
    );
    const categoryId = firstDefined(
      source.categoryId,
      category.categoryId
    );
    const subCategoryId = firstDefined(
      source.subCategoryId,
      source.subcategoryId,
      category.subCategoryId,
      category.subcategoryId
    );

    assignments = collectionId || categoryId || subCategoryId
      ? [{ collectionId, categoryId, subCategoryId }]
      : [];
  }

  const seen = new Set();

  return assignments
    .filter(isPlainObject)
    .map(item => ({
      collectionId: cleanString(item.collectionId, 128),
      categoryId: cleanString(item.categoryId, 128),
      subCategoryId: cleanString(
        item.subCategoryId ?? item.subcategoryId,
        128
      )
    }))
    .filter(item => (
      item.collectionId || item.categoryId || item.subCategoryId
    ))
    .filter(item => {
      const key = [
        item.collectionId,
        item.categoryId,
        item.subCategoryId
      ].join('\u0000');

      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
}

function normalizeAttributes(source = {}) {
  const attributes = isPlainObject(source.attributes)
    ? source.attributes
    : {};
  const description = isPlainObject(source.description)
    ? source.description
    : {};

  function resolveAttribute(field, maxLength) {
    if (hasOwn(attributes, field)) {
      return cleanString(attributes[field], maxLength);
    }

    if (hasOwn(source, field)) {
      return cleanString(source[field], maxLength);
    }

    return cleanString(description[field], maxLength);
  }

  return {
    fabricType: resolveAttribute('fabricType', 200),
    fit: resolveAttribute('fit', 200),
    sleeveType: resolveAttribute('sleeveType', 200),
    washCare: resolveAttribute('washCare', 500)
  };
}

function normalizeImages(value) {
  const source = Array.isArray(value) ? value : [];
  let mainAssigned = false;
  let hoverAssigned = false;

  const images = source
    .map((item, index) => {
      if (typeof item === 'string') {
        return {
          url: cleanString(item, 2000),
          publicId: '',
          alt: '',
          color: '',
          isMain: false,
          isHover: false,
          order: index + 1,
          sourceOrder: index + 1
        };
      }

      if (!isPlainObject(item)) {
        return null;
      }

      const isMain = !mainAssigned && item.isMain === true;
      const isHover = !hoverAssigned && item.isHover === true;

      if (isMain) mainAssigned = true;
      if (isHover) hoverAssigned = true;

      return {
        url: cleanString(item.url || item.secure_url, 2000),
        publicId: cleanString(item.publicId || item.public_id, 500),
        alt: cleanString(item.alt, 500),
        color: cleanString(item.color, 100),
        isMain,
        isHover,
        order: index + 1,
        sourceOrder: toNonNegativeInteger(item.order, index + 1)
      };
    })
    .filter(item => item?.url)
    .sort((left, right) => left.sourceOrder - right.sourceOrder)
    .map((item, index) => {
      const { sourceOrder, ...image } = item;

      return {
        ...image,
        order: index + 1
      };
    });

  if (images.length > 0 && !images.some(image => image.isMain)) {
    images[0].isMain = true;
  }

  return images;
}

function variantToken(value, fallback) {
  const token = cleanString(value, 80)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return token || fallback;
}

function getVariantSource(source = {}) {
  if (Array.isArray(source.variants)) {
    return source.variants;
  }

  return Array.isArray(source.inventory?.variants)
    ? source.inventory.variants
    : [];
}

function createDefaultVariantSource(source = {}) {
  const pricing = isPlainObject(source.pricing)
    ? source.pricing
    : {};
  const inventory = isPlainObject(source.inventory)
    ? source.inventory
    : {};
  const hasLegacyVariantData = [
    'regularPrice',
    'sellingPrice',
    'price',
    'totalStock',
    'stock'
  ].some(field => hasOwn(source, field)) || [
    'regularPrice',
    'sellingPrice'
  ].some(field => hasOwn(pricing, field)) || [
    'totalStock',
    'stock'
  ].some(field => hasOwn(inventory, field));

  if (!hasLegacyVariantData) {
    return [];
  }

  const productId = cleanString(source.id || source.productId, 100);

  return [{
    id: productId ? `default-${productId}` : 'variant-1',
    sku: cleanString(source.sku || source.basic?.sku, 100),
    color: 'Default',
    size: 'Default',
    regularPrice: firstDefined(
      source.regularPrice,
      pricing.regularPrice,
      source.price
    ),
    sellingPrice: firstDefined(
      source.sellingPrice,
      pricing.sellingPrice,
      source.price
    ),
    stock: firstDefined(
      source.totalStock,
      source.stock,
      inventory.totalStock,
      inventory.stock
    ),
    lowStockAlert: firstDefined(
      source.lowStockAlert,
      source.lowStockThreshold,
      inventory.lowStockAlert,
      inventory.lowStockThreshold
    ),
    barcode: source.barcode,
    isActive: source.active !== false
  }];
}

function normalizeVariants(source = {}) {
  const productSku = cleanString(
    source.sku || source.basic?.sku,
    100
  ).toUpperCase();
  const rawVariants = getVariantSource(source);
  const variants = rawVariants.length
    ? rawVariants
    : createDefaultVariantSource(source);
  const usedIds = new Set();
  const usedSkus = new Set();

  return variants
    .filter(isPlainObject)
    .map((variant, index) => {
      const color = cleanString(variant.color, 100);
      const size = cleanString(variant.size, 100);
      const baseId = cleanString(
        variant.id || variant.variantId,
        128
      ) || `variant-${index + 1}`;
      let id = baseId;
      let idSuffix = 2;

      while (usedIds.has(id)) {
        id = `${baseId.slice(0, 120)}-${idSuffix++}`;
      }

      usedIds.add(id);

      const generatedSku = [
        productSku,
        variantToken(color, `COLOR${index + 1}`),
        variantToken(size, `SIZE${index + 1}`)
      ].filter(Boolean).join('-').slice(0, 100);
      const baseSku = cleanString(
        variant.sku || variant.variantSku,
        100
      ).toUpperCase() || generatedSku || `VARIANT-${index + 1}`;
      let sku = baseSku;
      let skuSuffix = 2;

      while (usedSkus.has(sku)) {
        sku = `${baseSku.slice(0, 94)}-${skuSuffix++}`;
      }

      usedSkus.add(sku);

      return {
        id,
        sku,
        color,
        size,
        regularPrice: toNonNegativeNumber(firstDefined(
          variant.regularPrice,
          variant.mrp,
          variant.price
        )),
        sellingPrice: toNonNegativeNumber(firstDefined(
          variant.sellingPrice,
          variant.salePrice,
          variant.price
        )),
        stock: toNonNegativeInteger(firstDefined(
          variant.stock,
          variant.quantity,
          variant.availableStock
        )),
        lowStockAlert: toNonNegativeInteger(firstDefined(
          variant.lowStockAlert,
          variant.lowStockThreshold
        )),
        barcode: cleanString(variant.barcode, 100),
        isActive: variant.isActive !== false
      };
    });
}

function buildProductSummary(variants = []) {
  const source = Array.isArray(variants) ? variants : [];
  const sellable = source.filter(variant => variant?.isActive !== false);
  const priceSource = sellable.length ? sellable : source;
  const prices = priceSource
    .map(variant => toNonNegativeNumber(variant?.sellingPrice))
    .filter(price => price > 0);
  const discounts = priceSource.map(variant => {
    const regularPrice = toNonNegativeNumber(variant?.regularPrice);
    const sellingPrice = toNonNegativeNumber(variant?.sellingPrice);

    if (regularPrice <= 0 || sellingPrice >= regularPrice) {
      return 0;
    }

    return ((regularPrice - sellingPrice) / regularPrice) * 100;
  });
  const totalStock = source.reduce(
    (total, variant) => total + toNonNegativeInteger(variant?.stock),
    0
  );

  return {
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    maxDiscountPercent: roundNumber(
      discounts.length ? Math.max(...discounts) : 0
    ),
    totalStock,
    hasStock: totalStock > 0,
    lowStockCount: source.filter(variant => {
      const alert = toNonNegativeInteger(variant?.lowStockAlert);
      const stock = toNonNegativeInteger(variant?.stock);

      return alert > 0 && stock <= alert;
    }).length
  };
}

function normalizeFlags(source = {}) {
  const flags = isPlainObject(source.flags) ? source.flags : {};

  function resolveFlag(field) {
    if (hasOwn(flags, field)) {
      return flags[field] === true;
    }

    return source[field] === true;
  }

  return {
    isBestSeller: resolveFlag('isBestSeller'),
    isFeatured: resolveFlag('isFeatured'),
    isNewArrival: resolveFlag('isNewArrival')
  };
}

function normalizeRatingBreakdown(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, count]) => [
      cleanString(key, 20),
      toNonNegativeInteger(count)
    ]).filter(([key]) => key)
  );
}

function normalizeStats(source = {}) {
  const stats = isPlainObject(source.stats) ? source.stats : {};
  const review = isPlainObject(source.review) ? source.review : {};

  return {
    ratingAvg: toNonNegativeNumber(firstDefined(
      stats.ratingAvg,
      review.ratingAvg,
      source.ratingAvg
    )),
    ratingCount: toNonNegativeInteger(firstDefined(
      stats.ratingCount,
      review.ratingCount,
      source.ratingCount
    )),
    ratingBreakdown: normalizeRatingBreakdown(firstDefined(
      stats.ratingBreakdown,
      review.ratingBreakdown,
      source.ratingBreakdown
    )),
    soldCount: toNonNegativeInteger(firstDefined(
      stats.soldCount,
      review.soldCount,
      source.soldCount
    ))
  };
}

function normalizeSeo(source = {}) {
  const seo = isPlainObject(source.seo) ? source.seo : {};

  function resolveSeoField(field, legacyField, maxLength) {
    if (hasOwn(seo, field)) {
      return cleanString(seo[field], maxLength);
    }

    if (hasOwn(seo, legacyField)) {
      return cleanString(seo[legacyField], maxLength);
    }

    return cleanString(source[field], maxLength);
  }

  return {
    metaTitle: resolveSeoField('metaTitle', 'title', 300),
    metaDescription: resolveSeoField(
      'metaDescription',
      'description',
      1000
    )
  };
}

function normalizeDescription(source = {}) {
  const description = isPlainObject(source.description)
    ? source.description
    : {};

  return {
    description: cleanString(
      typeof source.description === 'string'
        ? source.description
        : hasOwn(description, 'full')
          ? description.full
          : description.description,
      20000
    ),
    shortDescription: cleanString(
      hasOwn(source, 'shortDescription')
        ? source.shortDescription
        : hasOwn(description, 'shortDescription')
          ? description.shortDescription
          : description.short,
      5000
    )
  };
}

function getProductTotalStock(product = {}) {
  const variants = getVariantSource(product);

  if (variants.length > 0) {
    return variants.reduce(
      (total, variant) => total + toNonNegativeInteger(variant?.stock),
      0
    );
  }

  return toNonNegativeInteger(firstDefined(
    product.summary?.totalStock,
    product.totalStock,
    product.inventory?.totalStock,
    product.stock
  ));
}

function buildCanonicalProductDocument(source = {}, overrides = {}) {
  const product = {
    ...(isPlainObject(source) ? source : {}),
    ...(isPlainObject(overrides) ? overrides : {})
  };
  const descriptions = normalizeDescription(product);
  const variants = normalizeVariants(product);
  const deleted = product.deleted === true;
  const active = !deleted && product.active === true;
  const version = toNonNegativeInteger(product.version, 1) || 1;
  const descriptionObject = isPlainObject(product.description)
    ? product.description
    : {};
  const basic = isPlainObject(product.basic) ? product.basic : {};
  const tags = Array.isArray(product.tags)
    ? product.tags
    : Array.isArray(descriptionObject.tags)
      ? descriptionObject.tags
      : [];
  const seenTags = new Set();

  function resolveTopLevel(field, fallback, maxLength) {
    return cleanString(
      hasOwn(product, field) ? product[field] : fallback,
      maxLength
    );
  }

  return removeUndefined({
    id: resolveTopLevel('id', product.productId, 128),
    sku: resolveTopLevel('sku', basic.sku, 100).toUpperCase(),
    slug: resolveTopLevel('slug', product.seo?.slug, 200),
    name: resolveTopLevel('name', basic.name, 200),
    brand: resolveTopLevel('brand', basic.brand, 200),
    barcode: resolveTopLevel('barcode', basic.barcode, 100),
    productCode: resolveTopLevel(
      'productCode',
      basic.productCode,
      100
    ),
    privateId: cleanString(product.privateId, 128),
    description: descriptions.description,
    shortDescription: descriptions.shortDescription,
    status: deleted ? 'archived' : active ? 'active' : 'draft',
    active,
    deleted,
    assignments: normalizeAssignments(product),
    attributes: normalizeAttributes(product),
    tags: tags
      .map(tag => cleanString(tag, 200))
      .filter(Boolean)
      .filter(tag => {
        const key = tag.toLowerCase();

        if (seenTags.has(key)) return false;
        seenTags.add(key);
        return true;
      }),
    images: normalizeImages(product.images),
    variants,
    flags: normalizeFlags(product),
    seo: normalizeSeo(product),
    summary: buildProductSummary(variants),
    stats: normalizeStats(product),
    createdAt: product.createdAt ?? null,
    updatedAt: product.updatedAt ?? null,
    version
  });
}

module.exports = {
  CANONICAL_SCHEMA_VERSION,
  normalizeAssignments,
  normalizeImages,
  normalizeVariants,
  buildProductSummary,
  getProductTotalStock,
  buildCanonicalProductDocument
};
