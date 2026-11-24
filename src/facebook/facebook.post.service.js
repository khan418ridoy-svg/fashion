
'use strict';

const { db } = require('../config/firebase');

const {
  FacebookError,
  cleanString
} = require('./facebook.utils');

const PRODUCTS_COLLECTION = 'products';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;

// ========================================
// Helpers
// ========================================

function normalizeLimit(value) {
  const limit = Number(value || DEFAULT_LIMIT);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    throw new FacebookError(
      `Limit must be between 1 and ${MAX_LIMIT}.`,
      400,
      'INVALID_PRODUCT_LIMIT'
    );
  }

  return limit;
}

function isCloudinaryUrl(value) {
  try {
    const url = new URL(value);

    return (
      url.protocol === 'https:' &&
      url.hostname === 'res.cloudinary.com'
    );
  } catch {
    return false;
  }
}

function normalizeImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .filter(image => (
      image &&
      typeof image === 'object' &&
      isCloudinaryUrl(image.url)
    ))
    .map(image => ({
      url: image.url,
      alt: cleanString(image.alt, 300),
      color: cleanString(image.color, 100),
      isMain: image.isMain === true,
      order: Number(image.order) || 0
    }))
    .sort((a, b) => {
      if (a.isMain !== b.isMain) {
        return a.isMain ? -1 : 1;
      }

      return a.order - b.order;
    });
}

function normalizeVariants(variants) {
  if (!Array.isArray(variants)) {
    return [];
  }

  return variants
    .filter(variant => {
      const stock = Number(variant?.stock);

      return (
        variant &&
        variant.isActive === true &&
        Number.isSafeInteger(stock) &&
        stock > 0
      );
    })
    .map(variant => ({
      color: cleanString(variant.color, 100),
      size: cleanString(variant.size, 100),
      sku: cleanString(
        variant.sku || variant.variantSku,
        100
      ),
      barcode: cleanString(variant.barcode, 100),
      stock: Number(variant.stock),
      regularPrice: Number(variant.regularPrice) || 0,
      sellingPrice: Number(variant.sellingPrice) || 0
    }));
}

// ========================================
// Image Matching
// ========================================

function normalizeColor(value) {
  return cleanString(value, 100).toLowerCase();
}

function getMainImage(images) {
  if (!images.length) {
    return null;
  }

  return images.find(image => image.isMain) || images[0];
}

function getVariantImages(images, color) {
  const normalizedColor = normalizeColor(color);

  if (!normalizedColor) {
    return [];
  }

  return images.filter(image => (
    normalizeColor(image.color) === normalizedColor
  ));
}

function attachVariantImages(variants, images, mainImage) {
  return variants.map(variant => {
    const matchingImages = getVariantImages(
      images,
      variant.color
    );

    return {
      ...variant,

      // Preview image for this variant.
      // Use main image when no color image exists.
      imageUrl: matchingImages[0]?.url || mainImage?.url || null,

      // All images matching this variant's color.
      images: matchingImages
    };
  });
}

function buildPostImages(images, variants, mainImage) {
  if (!mainImage) {
    return [];
  }

  const selectedImages = [mainImage];

  for (const variant of variants) {
    const matchingImages = getVariantImages(
      images,
      variant.color
    );

    selectedImages.push(...matchingImages);
  }

  // Remove duplicate URLs while preserving order.
  const seen = new Set();

  return selectedImages.filter(image => {
    if (!image?.url || seen.has(image.url)) {
      return false;
    }

    seen.add(image.url);
    return true;
  });
}

// ========================================
// Product Eligibility
// ========================================

function isEligibleProduct(product) {
  return (
    product.active === true &&
    product.status === 'active' &&
    product.deleted === false &&
    product.summary?.hasStock === true
  );
}

// ========================================
// List Eligible Facebook Products
// ========================================

async function listEligibleProducts(options = {}) {
  const limit = normalizeLimit(options.limit);

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .where('active', '==', true)
    .where('summary.hasStock', '==', true)
    .orderBy('updatedAt', 'desc')
    .limit(limit)
    .get();

  const products = [];

  for (const doc of snapshot.docs) {
    const product = doc.data() || {};

    if (!isEligibleProduct(product)) {
      continue;
    }

    const images = normalizeImages(product.images);
    const rawVariants = normalizeVariants(product.variants);

    if (!images.length || !rawVariants.length) {
      continue;
    }

    const mainImage = getMainImage(images);

    if (!mainImage) {
      continue;
    }

    const variants = attachVariantImages(
      rawVariants,
      images,
      mainImage
    );

    const postImages = buildPostImages(
      images,
      rawVariants,
      mainImage
    );

    products.push({
      id: doc.id,

      name: cleanString(product.name, 300),
      slug: cleanString(product.slug, 300),
      sku: cleanString(product.sku, 100),
      barcode: cleanString(product.barcode, 100),

      shortDescription: cleanString(
        product.shortDescription,
        1000
      ),

      description: cleanString(
        product.description,
        5000
      ),

      images,
      mainImage,
      postImages,
      variants,

      summary: {
        hasStock: true,
        totalStock: Number(product.summary?.totalStock) || 0,
        minPrice: Number(product.summary?.minPrice) || 0,
        maxPrice: Number(product.summary?.maxPrice) || 0
      }
    });
  }

  return {
    count: products.length,
    products
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  listEligibleProducts
};
