
'use strict';

const express = require('express');

const router = express.Router();

const adminAuth = require('../middleware/adminAuth');

const productLotService = require('../services/inventory/product-lot.service');

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

router.use(adminAuth);

// ========================================
// POST: Create Product Lot
// ========================================

// POST /api/products/:productId/lots

router.post(
  '/:productId/lots',
  asyncHandler(async (req, res) => {
    const result = await productLotService.createProductLot(
      req.params.productId,
      req.body || {}
    );

    res.status(201).json({
      success: true,
      message: 'Product Lot created successfully.',
      ...result
    });
  })
);

// ========================================
// GET: List Product Lots
// ========================================

// GET /api/products/:productId/lots
// GET /api/products/:productId/lots?limit=50

router.get(
  '/:productId/lots',
  asyncHandler(async (req, res) => {
    const result = await productLotService.listProductLots(
      req.params.productId,
      {
        limit: req.query.limit
      }
    );

    res.json({
      success: true,
      ...result
    });
  })
);

// ========================================
// GET: Product Lot By Lot Number
// ========================================

// GET /api/products/:productId/lots/number/:lotNumber

router.get(
  '/:productId/lots/number/:lotNumber',
  asyncHandler(async (req, res) => {
    const lot = await productLotService.getProductLotByNumber(
      req.params.productId,
      req.params.lotNumber
    );

    res.json({
      success: true,
      lot
    });
  })
);

router.get(
  '/:productId/lots/:lotId/history',
  asyncHandler(async (req, res) => {
    const history = await productLotService.getProductLotHistory(
      req.params.productId,
      req.params.lotId
    );

    res.json({ success: true, history });
  })
);

// ========================================
// GET: Single Product Lot
// ========================================

// GET /api/products/:productId/lots/:lotId

router.get(
  '/:productId/lots/:lotId',
  asyncHandler(async (req, res) => {
    const lot = await productLotService.getProductLot(
      req.params.productId,
      req.params.lotId
    );

    res.json({
      success: true,
      lot
    });
  })
);

// ========================================
// Export
// ========================================

module.exports = router;
