
'use strict';

const express = require('express');

const router = express.Router();

const adminAuth = require('../middleware/adminAuth');
const productService = require('../services/product/product.service');

// ========================================
// Async Handler
// ========================================

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// ========================================
// Authentication
// ========================================

// All Product routes require admin authentication.
router.use(adminAuth);

// ========================================
// GET: Product Catalog Version
// ========================================

// GET /api/products/meta/version

router.get(
  '/meta/version',
  asyncHandler(async (req, res) => {
    const meta = await productService.getProductCatalogVersion();

    res.json({
      success: true,
      generation: meta.generation,
      version: meta.version,
      updatedAt: meta.updatedAt || null,
      changes: Array.isArray(meta.changes) ? meta.changes : []
    });
  })
);

// ========================================
// GET: Product By SKU
// ========================================

// GET /api/products/sku/:sku

router.get(
  '/sku/:sku',
  asyncHandler(async (req, res) => {
    const product = await productService.getProductBySku(
      req.params.sku
    );

    if (!product) {
      return res.status(404).json({
        success: false,
        message: 'Product not found.'
      });
    }

    res.json({
      success: true,
      product
    });
  })
);

// ========================================
// GET: Product List
// ========================================

// GET /api/products
// GET /api/products?limit=50
// GET /api/products?active=true
// GET /api/products?categoryId=categoryId

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const options = {};

    if (req.query.limit !== undefined) {
      options.limit = req.query.limit;
    }

    if (req.query.active !== undefined) {
      if (
        req.query.active !== 'true' &&
        req.query.active !== 'false'
      ) {
        return res.status(400).json({
          success: false,
          message: 'Active must be true or false.'
        });
      }

      options.active = req.query.active === 'true';
    }

    if (req.query.categoryId !== undefined) {
      options.categoryId = req.query.categoryId;
    }

    if (req.query.collectionId !== undefined) {
      options.collectionId = req.query.collectionId;
    }

    if (req.query.startAfter !== undefined) {
      options.startAfter = req.query.startAfter;
    }

    if (req.query.includeDeleted === 'true') {
      options.includeDeleted = true;
    }

    const result = await productService.listProducts(options);

    res.json({
      success: true,
      ...result
    });
  })
);

// ========================================
// POST: Create Product
// ========================================

// POST /api/products

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const product = await productService.createProduct(
      req.body || {}
    );

    res.status(201).json({
      success: true,
      message: 'Product created successfully.',
      product
    });
  })
);

router.post(
  '/activate',
  asyncHandler(async (req, res) => {
    const result = await productService.activateProducts(
      req.body?.productIds
    );

    res.json({
      success: true,
      message: `${result.activatedCount} Product(s) activated.`,
      ...result
    });
  })
);

router.get(
  '/:productId/costs',
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      data: await productService.getProductCosts(req.params.productId)
    });
  })
);

router.put(
  '/:productId/costs',
  asyncHandler(async (req, res) => {
    res.json({
      success: true,
      message: 'Product purchase cost saved.',
      data: await productService.updateProductCosts(
        req.params.productId,
        req.body || {}
      )
    });
  })
);

// ========================================
// GET: Single Product
// ========================================

// GET /api/products/:productId

router.get(
  '/:productId',
  asyncHandler(async (req, res) => {
    const product = await productService.getProduct(
      req.params.productId
    );

    res.json({
      success: true,
      product
    });
  })
);

// ========================================
// PATCH: Update Product
// ========================================

// PATCH /api/products/:productId

router.patch(
  '/:productId',
  asyncHandler(async (req, res) => {
    const product = await productService.updateProduct(
      req.params.productId,
      req.body || {}
    );

    res.json({
      success: true,
      message: 'Product updated successfully.',
      product
    });
  })
);

// ========================================
// DELETE: Archive Product
// ========================================

// DELETE /api/products/:productId

router.delete(
  '/:productId',
  asyncHandler(async (req, res) => {
    const result = await productService.deleteProduct(
      req.params.productId
    );

    res.json({
      success: true,
      message: 'Product archived successfully.',
      ...result
    });
  })
);

// ========================================
// Export
// ========================================

module.exports = router;
