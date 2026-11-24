
'use strict';

const express = require('express');

const adminAuth = require('../middleware/adminAuth');

const {
  FacebookError,
  cleanString
} = require('./facebook.utils');

const {
  listEligibleProducts,
  getEligibleProductById
} = require('./facebook.post.service');

const {
  generateFacebookCaption
} = require('./facebook.caption.service');

const {
  getSelectedPageToken
} = require('./facebook.connection.service');

const {
  publishFacebookProductPost
} = require('./facebook.publish.service');

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
// POST Publish Facebook Product
// POST /api/facebook/posts/publish
// ========================================

router.post(
  '/publish',
  asyncHandler(async (req, res) => {
    const adminUid = req.admin?.uid;

    if (!adminUid) {
      throw new FacebookError(
        'Admin authentication required.',
        401,
        'ADMIN_AUTH_REQUIRED'
      );
    }

    const productId = cleanString(
      req.body?.productId,
      128
    );

    const pageId = cleanString(
      req.body?.pageId,
      50
    );

    const caption = String(
      req.body?.caption ?? ''
    ).trim();

    if (!productId) {
      throw new FacebookError(
        'Product ID is required.',
        400,
        'PRODUCT_ID_REQUIRED'
      );
    }

    if (!pageId) {
      throw new FacebookError(
        'Facebook Page ID is required.',
        400,
        'PAGE_ID_REQUIRED'
      );
    }

    if (!caption) {
      throw new FacebookError(
        'Approved Facebook caption is required.',
        400,
        'POST_CAPTION_REQUIRED'
      );
    }

    // 1. Read and validate the product from Firestore.
    // Never trust image URLs supplied by the frontend.
    const product = await getEligibleProductById(
      productId
    );

    if (
      !Array.isArray(product.postImages) ||
      product.postImages.length === 0
    ) {
      throw new FacebookError(
        'This product has no valid Facebook post images.',
        400,
        'PRODUCT_IMAGES_REQUIRED'
      );
    }

    // 2. Get the selected Page token for this admin.
    // The token is decrypted only on the backend.
    const pageAccessToken = await getSelectedPageToken(
      adminUid,
      pageId
    );

    // 3. Publish the approved caption and backend-selected images.
    const result = await publishFacebookProductPost({
      pageId,
      pageAccessToken,
      caption,
      images: product.postImages
    });

    return res.status(200).json({
      success: true,
      message: 'Facebook product post published successfully.',
      post: {
        postId: result.postId,
        pageId: result.pageId,
        productId: product.id,
        productName: product.name,
        imageCount: result.imageCount
      }
    });
  })
);

// ========================================
// Export
// ========================================

module.exports = router;
