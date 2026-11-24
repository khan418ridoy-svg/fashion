
'use strict';

const express = require('express');

const adminAuth = require('../middleware/adminAuth');

const {
  FacebookError
} = require('./facebook.utils');

const {
  listEligibleProducts
} = require('./facebook.post.service');

const router = express.Router();

// ========================================
// Async Handler
// ========================================

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(
      handler(req, res, next)
    ).catch(next);
  };
}

// ========================================
// Authentication
// ========================================

router.use(adminAuth);

// ========================================
// GET Eligible Products
// GET /api/facebook/posts/products
// ========================================

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const adminUid = req.admin?.uid;

    if (!adminUid) {
      throw new FacebookError(
        'Admin authentication required.',
        401,
        'ADMIN_AUTH_REQUIRED'
      );
    }

    const result = await listEligibleProducts({
      limit: req.query.limit
    });

    return res.json({
      success: true,
      count: result.count,
      products: result.products
    });
  })
);

// ========================================
// Export
// ========================================

module.exports = router;
