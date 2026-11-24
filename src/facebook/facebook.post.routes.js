
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



const {
  generateFacebookCaption
} = require('./facebook.caption.service');

// ========================================
// POST Generate Facebook Caption
// POST /api/facebook/posts/caption
// ========================================

router.post(
  '/caption',
  asyncHandler(async (req, res) => {
    const adminUid = req.admin?.uid;

    if (!adminUid) {
      throw new FacebookError(
        'Admin authentication required.',
        401,
        'ADMIN_AUTH_REQUIRED'
      );
    }

    const productId = req.body?.productId;

    const result = await generateFacebookCaption(productId);

    return res.json(result);
  })
);











// ========================================
// Export
// ========================================

module.exports = router;
