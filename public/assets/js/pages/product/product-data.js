
'use strict';

// ========================================
// PRODUCT DATA HELPERS
// Safe product data extraction and formatting
// ========================================

// ========================================
// OBJECT HELPERS
// ========================================

function isObject(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function safeObject(value) {
  return isObject(value) ? value : {};
}

function safeString(value, fallback = '') {
  if (value === null || value === undefined) {
    return fallback;
  }

  if (
    typeof value === 'object' ||
    typeof value === 'function'
  ) {
    return fallback;
  }

  const result = String(value).trim();

  return result || fallback;
}

function toFiniteNumber(value, fallback = 0) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return fallback;
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function getNested(object, path) {
  return path.split('.').reduce((value, key) => {
    if (!isObject(value)) return undefined;
    return value[key];
  }, object);
}

// ========================================
// FIRST VALUE
// ========================================

export function firstValue(...values) {
  return values.find(value => {
    return value !== undefined &&
      value !== null &&
      value !== '';
  });
}

// ========================================
// NUMBER FORMATTING
// ========================================

export function formatNumber(value) {
  return toFiniteNumber(value).toLocaleString('en-BD');
}

// ========================================
// MONEY FORMATTING
// ========================================

export function formatMoney(value) {
  return toFiniteNumber(value).toLocaleString('en-BD', {
    style: 'currency',
    currency: 'BDT',
    maximumFractionDigits: 2
  });
}

// ========================================
// DATE FORMATTING
// ========================================

export function formatDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return '—';
  }

  let date;

  try {
    if (value instanceof Date) {
      date = value;
    } else if (typeof value?.toDate === 'function') {
      date = value.toDate();
    } else if (isObject(value)) {
      const seconds =
        value.seconds ??
        value._seconds;

      if (seconds !== undefined) {
        date = new Date(Number(seconds) * 1000);
      } else {
        const milliseconds =
          value.milliseconds ??
          value._milliseconds;

        if (milliseconds !== undefined) {
          date = new Date(Number(milliseconds));
        } else {
          return '—';
        }
      }
    } else {
      date = new Date(value);
    }
  } catch {
    return '—';
  }

  if (
    !(date instanceof Date) ||
    Number.isNaN(date.getTime())
  ) {
    return '—';
  }

  return date.toLocaleString('en-BD', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ========================================
// PRODUCT NAME
// ========================================

export function getProductName(product = {}) {
  product = safeObject(product);

  const basic = safeObject(product.basic);

  return safeString(
    firstValue(
      product.name,
      product.title,
      basic.name
    ),
    'Unnamed Product'
  );
}

// ========================================
// PRODUCT STOCK
// ========================================

export function getProductStock(product = {}) {
  product = safeObject(product);

  const inventory = safeObject(product.inventory);

  return toFiniteNumber(
    firstValue(
      product.summary?.totalStock,
      product.availableStock,
      product.availableQuantity,
      product.totalStock,
      product.stock,
      inventory.availableStock,
      inventory.totalStock,
      0
    )
  );
}

// ========================================
// PRODUCT STATUS
// ========================================

export function getProductStatus(product = {}) {
  product = safeObject(product);

  if (product.deleted === true) {
    return 'archived';
  }

  if (product.active === true) {
    return 'active';
  }

  if (product.active === false) {
    return 'draft';
  }

  return safeString(product.status, 'draft').toLowerCase();
}

// ========================================
// PRODUCT PRICE
// ========================================

export function getProductPrice(product = {}) {
  product = safeObject(product);

  const pricing = safeObject(product.pricing);

  return toFiniteNumber(
    firstValue(
      product.summary?.minPrice,
      product.sellingPrice,
      product.price,
      pricing.sellingPrice,
      0
    )
  );
}

// ========================================
// IMAGE URL
// ========================================

function toUrl(item) {
  if (!item) return '';

  if (typeof item === 'string') {
    return item.trim();
  }

  if (!isObject(item)) {
    return '';
  }

  return safeString(
    firstValue(
      item.url,
      item.secure_url,
      item.src
    )
  );
}

// ========================================
// PRODUCT IMAGES
// ========================================

export function getProductImages(product = {}) {
  product = safeObject(product);

  const media = safeObject(product.media);

  const images = [
    product.image,
    product.thumbnail,

    ...(Array.isArray(product.images)
      ? product.images
      : []),

    ...(Array.isArray(media.images)
      ? media.images
      : [])
  ];

  const urls = images
    .map(toUrl)
    .filter(Boolean);

  return [...new Set(urls)];
}

// ========================================
// PRODUCT TAGS
// ========================================

export function getProductTags(product = {}) {
  product = safeObject(product);

  const basic = safeObject(product.basic);

  const tags = firstValue(
    product.tags,
    basic.tags,
    []
  );

  if (Array.isArray(tags)) {
    return [
      ...new Set(
        tags
          .map(tag => safeString(tag))
          .filter(Boolean)
      )
    ];
  }

  if (typeof tags === 'string') {
    return [
      ...new Set(
        tags
          .split(',')
          .map(tag => tag.trim())
          .filter(Boolean)
      )
    ];
  }

  return [];
}

// ========================================
// PRODUCT VARIANTS
// ========================================

export function getProductVariants(product = {}) {
  product = safeObject(product);

  if (!Array.isArray(product.variants)) {
    return [];
  }

  return product.variants
    .filter(isObject)
    .map(variant => {
      const attributes = safeObject(variant.attributes);

      return {
        name: safeString(
          firstValue(
            variant.name,
            variant.title,
            variant.label,
            [
              variant.color,
              variant.size
            ].filter(Boolean).join(' / ')
          ),
          '—'
        ),

        sku: safeString(
          firstValue(
            variant.sku,
            variant.code
          ),
          '—'
        ),

        size: safeString(
          firstValue(
            variant.size,
            attributes.size
          ),
          '—'
        ),

        color: safeString(
          firstValue(
            variant.color,
            variant.colour,
            attributes.color
          ),
          '—'
        ),

        price: toFiniteNumber(
          firstValue(
            variant.sellingPrice,
            variant.price,
            0
          )
        ),

        stock: toFiniteNumber(
          firstValue(
            variant.availableStock,
            variant.availableQuantity,
            variant.stock,
            variant.quantity,
            0
          )
        )
      };
    });
}

// ========================================
// STOCK INFORMATION
// ========================================

export function getStockInfo(product = {}) {
  product = safeObject(product);

  const inventory = safeObject(product.inventory);

  const available = getProductStock(product);

  const threshold = toFiniteNumber(
    firstValue(
      product.lowStockThreshold,
      inventory.lowStockThreshold,
      5
    ),
    5
  );

  const reserved = toFiniteNumber(
    firstValue(
      product.reservedStock,
      inventory.reservedStock,
      0
    )
  );

  const total = toFiniteNumber(
    firstValue(
      product.summary?.totalStock,
      product.totalStock,
      inventory.totalStock,
      available + reserved
    )
  );

  let label = 'In Stock';
  let level = 'ok';

  if (available <= 0) {
    label = 'Out of Stock';
    level = 'out';
  } else if (available <= threshold) {
    label = 'Low Stock';
    level = 'low';
  }

  return {
    available,
    reserved,
    total,
    threshold,
    label,
    level
  };
}

// ========================================
// PRICING INFORMATION
// ========================================

export function getPricingInfo(product = {}) {
  product = safeObject(product);

  const pricing = safeObject(product.pricing);
  const cost = safeObject(product.cost);
  const firstVariant = safeObject(
    Array.isArray(product.variants) ? product.variants[0] : null
  );

  const selling = getProductPrice(product);

  const buyPrice = toFiniteNumber(
    firstValue(
      product.buyPrice,
      product.costPrice,
      product.purchasePrice,
      cost.buyPrice,
      pricing.costPrice,
      pricing.purchasePrice,
      0
    )
  );

  const compare = toFiniteNumber(
    firstValue(
      product.comparePrice,
      product.mrp,
      product.regularPrice,
      firstVariant.regularPrice,
      pricing.comparePrice,
      pricing.mrp,
      0
    )
  );

  const profit =
    buyPrice > 0 && selling > 0
      ? selling - buyPrice
      : null;

  const margin =
    profit !== null
      ? (profit / selling) * 100
      : null;

  const discount =
    compare > selling && selling > 0
      ? ((compare - selling) / compare) * 100
      : null;

  return {
    selling,
    cost: buyPrice,
    compare,
    profit,
    margin,
    discount
  };
}

// ========================================
// PRODUCT LOTS
// ========================================

export function getProductLots(product = {}) {
  product = safeObject(product);

  if (!Array.isArray(product.lots)) {
    return [];
  }

  return product.lots
    .filter(isObject)
    .map((lot, index) => {
      const rawVariants = Array.isArray(lot.variants)
        ? lot.variants.filter(isObject)
        : [];

      // ------------------------------
      // LOT VARIANTS
      // ------------------------------

      const variants = rawVariants.map(
        (variant, variantIndex) => {
          const purchased = toFiniteNumber(
            firstValue(
              variant.quantity,
              variant.purchaseQuantity,
              variant.purchasedQty,
              variant.initialQuantity,
              0
            )
          );

          const remaining = toFiniteNumber(
            firstValue(
              variant.remainingQuantity,
              variant.remainingQty,
              variant.availableQuantity,
              variant.stock,
              0
            )
          );

          const sold = toFiniteNumber(
            firstValue(
              variant.soldQuantity,
              variant.soldQty,
              Math.max(purchased - remaining, 0)
            )
          );

          const purchaseCost = toFiniteNumber(
            variant.purchaseCost
          );

          const buyPrice = toFiniteNumber(
            firstValue(
              variant.unitPurchaseCost,
              variant.buyPrice,
              variant.averageBuyRate,
              purchased > 0
                ? purchaseCost / purchased
                : undefined,
              0
            )
          );

          const totalLandedCost = toFiniteNumber(
            variant.landedCost
          );

          const landedCost = toFiniteNumber(
            firstValue(
              variant.unitLandedCost,
              purchased > 0 && totalLandedCost > 0
                ? totalLandedCost / purchased
                : undefined,
              buyPrice
            )
          );

          return {
            id: safeString(
              firstValue(
                variant.variantId,
                variant.id,
                `variant-${variantIndex + 1}`
              )
            ),

            sku: safeString(
              firstValue(
                variant.sku,
                variant.variantSku
              ),
              '—'
            ),

            color: safeString(
              firstValue(
                variant.color,
                variant.colour
              ),
              '—'
            ),

            size: safeString(variant.size, '—'),

            purchased,
            sold,
            remaining,
            buyPrice,
            landedCost,

            stockValue: remaining * landedCost
          };
        }
      );

      // ------------------------------
      // LOT QUANTITIES
      // ------------------------------

      const variantPurchased = variants.reduce(
        (sum, item) => sum + item.purchased,
        0
      );

      const variantRemaining = variants.reduce(
        (sum, item) => sum + item.remaining,
        0
      );

      const purchased = toFiniteNumber(
        firstValue(
          lot.totalQuantity,
          lot.quantity,
          lot.purchasedQty,
          lot.purchaseQty,
          lot.qty,
          lot.initialQty,
          variantPurchased,
          0
        )
      );

      const remaining = toFiniteNumber(
        firstValue(
          lot.remainingQuantity,
          lot.remainingQty,
          lot.remaining,
          lot.availableQuantity,
          lot.availableQty,
          lot.stock,
          variantRemaining,
          0
        )
      );

      const sold = toFiniteNumber(
        firstValue(
          lot.soldQuantity,
          lot.soldQty,
          lot.sold,
          Math.max(purchased - remaining, 0)
        )
      );

      // ------------------------------
      // LOT COSTS
      // ------------------------------

      const variantPurchaseCost = variants.reduce(
        (sum, item) => {
          return sum + item.purchased * item.buyPrice;
        },
        0
      );

      const purchaseCost = toFiniteNumber(
        firstValue(
          lot.purchaseCost,
          variantPurchaseCost,
          0
        )
      );

      const costs = safeObject(lot.costs);

      const transportCost = toFiniteNumber(
        firstValue(
          lot.transportCost,
          costs.transportCost,
          0
        )
      );

      const otherCost = toFiniteNumber(
        firstValue(
          lot.otherCost,
          costs.otherCost,
          0
        )
      );

      const landedCost = toFiniteNumber(
        firstValue(
          lot.landedCost,
          lot.totalCost,
          purchaseCost + transportCost + otherCost,
          0
        )
      );

      const buyPrice = toFiniteNumber(
        firstValue(
          lot.unitPurchaseCost,
          lot.buyPrice,
          lot.costPrice,
          lot.unitCost,
          purchased > 0
            ? purchaseCost / purchased
            : undefined,
          0
        )
      );

      const unitLandedCost = toFiniteNumber(
        firstValue(
          lot.unitLandedCost,
          purchased > 0
            ? landedCost / purchased
            : undefined,
          buyPrice,
          0
        )
      );

      // ------------------------------
      // LOT STATUS
      // ------------------------------

      const normalizedStatus = safeString(
        lot.status
      ).toLowerCase();

      const status = [
        'cancelled',
        'closed',
        'draft'
      ].includes(normalizedStatus)
        ? normalizedStatus
        : remaining <= 0
          ? 'depleted'
          : 'available';

      // ------------------------------
      // RETURN NORMALIZED LOT
      // ------------------------------

      return {
        lotNo: safeString(
          firstValue(
            lot.lotNo,
            lot.lotNumber,
            lot.name,
            lot.id,
            `Lot ${index + 1}`
          )
        ),

        lotName: safeString(
          firstValue(
            lot.lotName,
            lot.name,
            lot.lotNumber,
            `Lot ${index + 1}`
          )
        ),

        supplier: safeString(
          firstValue(
            lot.supplier,
            lot.supplierName
          ),
          '—'
        ),

        date: formatDate(
          firstValue(
            lot.purchasedAt,
            lot.purchaseDate,
            lot.createdAt,
            lot.date
          )
        ),

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
          ? variants.reduce(
              (sum, item) => sum + item.stockValue,
              0
            )
          : remaining * unitLandedCost,

        status,

        note: safeString(
          firstValue(
            lot.note,
            lot.purchaseNote
          )
        ),

        variants
      };
    });
}

// ========================================
// PRODUCT DETAILS
// ========================================

export function getProductDetails(product = {}) {
  product = safeObject(product);

  const basic = safeObject(product.basic);
  const category = safeObject(product.category);
  const subCategory = safeObject(product.subCategory);
  const seo = safeObject(product.seo);
  const description = safeObject(product.description);
  const flags = safeObject(product.flags);
  const stats = safeObject(product.stats);
  const review = safeObject(product.review);
  const attributes = safeObject(product.attributes);
  const shipping = safeObject(product.shipping);
  const cost = safeObject(product.cost);
  const collection = safeObject(product.collection);
  const assignments = Array.isArray(product.assignments)
    ? product.assignments
    : [];
  const firstAssignment = safeObject(assignments[0]);

  const lots = Array.isArray(product.lots)
    ? product.lots
    : [];

  return {
    sku: safeString(
      firstValue(
        product.sku,
        basic.sku
      ),
      '—'
    ),

    productCode: safeString(
      firstValue(
        product.productCode,
        basic.productCode
      ),
      '—'
    ),

    barcode: safeString(
      firstValue(
        product.barcode,
        basic.barcode
      ),
      '—'
    ),

    brand: safeString(
      firstValue(
        product.brand,
        basic.brand
      ),
      '—'
    ),

    category: safeString(
      firstValue(
        product.categoryName,
        category.categoryName,
        category.name,
        firstAssignment.categoryId,
        product.categoryId,
        category.categoryId
      ),
      '—'
    ),

    subCategory: safeString(
      firstValue(
        product.subCategoryName,
        subCategory.name,
        typeof product.subCategory === 'string'
          ? product.subCategory
          : undefined,
        firstAssignment.subCategoryId,
        product.subcategoryId,
        product.subCategoryId,
        category.subCategoryId
      ),
      '—'
    ),

    collection: safeString(
      firstValue(
        product.collectionName,
        collection.name,
        firstAssignment.collectionId,
        product.collectionId,
        category.collectionId
      ),
      '—'
    ),

    slug: safeString(
      firstValue(
        product.slug,
        seo.slug
      ),
      '—'
    ),

    material: safeString(
      firstValue(
        product.material,
        product.fabricType,
        attributes.material,
        attributes.fabricType
      ),
      '—'
    ),

    fit: safeString(
      firstValue(
        product.fit,
        attributes.fit
      ),
      '—'
    ),

    sleeveType: safeString(
      firstValue(
        product.sleeveType,
        attributes.sleeveType
      ),
      '—'
    ),

    washCare: safeString(
      firstValue(
        product.washCare,
        attributes.washCare
      ),
      '—'
    ),

    weight: firstValue(
      product.weight,
      shipping.weight,
      '—'
    ),

    supplier: safeString(
      firstValue(
        product.supplier,
        cost.supplier
      ),
      '—'
    ),

    purchaseNote: safeString(
      firstValue(
        product.purchaseNote,
        cost.purchaseNote
      )
    ),

    createdAt: formatDate(
      firstValue(
        product.createdAt,
        product.created_at
      )
    ),

    updatedAt: formatDate(
      firstValue(
        product.updatedAt,
        product.updated_at
      )
    ),

    lotCount: Array.isArray(product.lots)
      ? lots.length
      : toFiniteNumber(
          firstValue(
            product.lotCount,
            product.lotsCount,
            0
          )
        ),

    description: safeString(
      firstValue(
        description.description,
        typeof product.description === 'string'
          ? product.description
          : undefined,
        product.shortDescription,
        description.shortDescription
      )
    ),

    shortDescription: safeString(
      firstValue(
        product.shortDescription,
        description.shortDescription
      )
    ),

    seoTitle: safeString(
      firstValue(
        seo.title,
        seo.metaTitle
      ),
      '—'
    ),

    seoDescription: safeString(
      firstValue(
        seo.description,
        seo.metaDescription
      ),
      '—'
    ),

    flags: {
      newArrival:
        product.isNewArrival === true ||
        flags.isNewArrival === true,

      featured:
        product.isFeatured === true ||
        flags.isFeatured === true,

      bestSeller:
        product.isBestSeller === true ||
        flags.isBestSeller === true
    },

    ratingAvg: toFiniteNumber(
      firstValue(
        stats.ratingAvg,
        product.ratingAvg,
        review.ratingAvg,
        0
      )
    ),

    ratingCount: toFiniteNumber(
      firstValue(
        stats.ratingCount,
        product.ratingCount,
        review.ratingCount,
        0
      )
    ),

    soldCount: toFiniteNumber(
      firstValue(
        stats.soldCount,
        product.soldCount,
        review.soldCount,
        0
      )
    )
  };
}
