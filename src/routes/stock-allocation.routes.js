
'use strict';

const express = require('express');

const router = express.Router();

const adminAuth = require('../middleware/adminAuth');

const stockAllocationService = require(
  '../services/inventory/stock-allocation.service'
);

// ========================================
// Async Handler
// ========================================

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

// ========================================
// Admin Authentication
// ========================================

router.use(adminAuth);

// ========================================
// POST /api/stock-allocations
// Allocate Product stock using FIFO
// ========================================

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const {
      productId,
      orderId,
      items
    } = req.body || {};

    const result = await stockAllocationService.allocateStock({
      productId,
      orderId,
      items
    });

    return res.status(200).json({
      success: true,
      message: result.alreadyAllocated
        ? 'Stock was already allocated for this Order.'
        : 'Stock allocated successfully using FIFO.',
      data: result
    });
  })
);

// ========================================
// GET /api/stock-allocations/:orderId/:productId
// Get allocation history
// ========================================

router.get(
  '/:orderId/:productId',
  asyncHandler(async (req, res) => {
    const {
      orderId,
      productId
    } = req.params;

    const result =
      await stockAllocationService.getStockAllocation(
        orderId,
        productId
      );

    return res.status(200).json({
      success: true,
      data: result
    });
  })
);

// ========================================
// Export
// ========================================

module.exports = router;
