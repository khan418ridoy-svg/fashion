
'use strict';
const { db } = require('../config/firebase');
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
  getSelectedPageToken,
  getSelectedPages
} = require('./facebook.connection.service');

const {
   publishFacebookProductPost,
  deleteFacebookPublishedPost
} = require('./facebook.publish.service');

const {
   createPostHistory,
  markPostPublished,
  markPostFailed,
  listPostHistory,
  deletePostHistory
} = require('./facebook.post.history.service');

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
// DELETE Facebook Post + Firestore History
// DELETE /api/facebook/posts/history/:historyId
// ========================================

router.delete(
  '/history/:historyId',
  asyncHandler(async (req, res) => {
    const adminUid = req.admin?.uid;

    if (!adminUid) {
      throw new FacebookError(
        'Admin authentication required.',
        401,
        'ADMIN_AUTH_REQUIRED'
      );
    }

    const historyId = cleanString(
      req.params.historyId,
      128
    );

    if (!historyId) {
      throw new FacebookError(
        'Post history ID is required.',
        400,
        'HISTORY_ID_REQUIRED'
      );
    }

    const historyRef = db
      .collection('facebookPostHistory')
      .doc(historyId);

    const snapshot = await historyRef.get();

    if (!snapshot.exists) {
      throw new FacebookError(
        'Post history record was not found.',
        404,
        'HISTORY_NOT_FOUND'
      );
    }

    const history = snapshot.data() || {};

    if (history.adminUid !== adminUid) {
      throw new FacebookError(
        'You are not allowed to delete this post.',
        403,
        'HISTORY_ACCESS_DENIED'
      );
    }

    if (history.status === 'publishing') {
      throw new FacebookError(
        'A publishing post cannot be deleted.',
        409,
        'POST_PUBLISHING'
      );
    }

    // Failed post: only Firestore history exists.
    if (history.status === 'failed') {
      await deletePostHistory(
        historyId,
        adminUid
      );

      return res.json({
        success: true,
        message: 'Failed post history deleted.',
        historyId,
        facebookDeleted: false,
        firestoreDeleted: true
      });
    }

    if (history.status !== 'published') {
      throw new FacebookError(
        'Unsupported post history status.',
        409,
        'INVALID_HISTORY_STATUS'
      );
    }

    const postId = cleanString(
      history.postId,
      200
    );

    const pageId = cleanString(
      history.pageId,
      50
    );

    if (!postId || !pageId) {
      throw new FacebookError(
        'Facebook post ID or Page ID is missing.',
        409,
        'FACEBOOK_POST_DATA_MISSING'
      );
    }

    // Verify that the Page belongs to this admin
    // and is currently selected.
    const selectedPages = await getSelectedPages(
      adminUid
    );

    const selectedPage = selectedPages.find(
      page => page.pageId === pageId
    );

    if (!selectedPage) {
      throw new FacebookError(
        'The Facebook Page is not selected. Select it before deleting its post.',
        403,
        'PAGE_ACCESS_DENIED'
      );
    }

    // Get the Page token on the backend only.
    const pageAccessToken = await getSelectedPageToken(
      adminUid,
      pageId
    );

    // Delete Facebook post first.
    await deleteFacebookPublishedPost({
      postId,
      pageAccessToken
    });

    // Delete Firestore history only after Facebook confirms deletion.
    await historyRef.delete();

    return res.json({
      success: true,
      message: 'Facebook post and history deleted successfully.',
      historyId,
      postId,
      pageId,
      facebookDeleted: true,
      firestoreDeleted: true
    });
  })
);
// ========================================
// GET Post History
// GET /api/facebook/posts/history
// ========================================

router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const adminUid = req.admin?.uid;

    if (!adminUid) {
      throw new FacebookError(
        'Admin authentication required.',
        401,
        'ADMIN_AUTH_REQUIRED'
      );
    }

    const result = await listPostHistory(
      adminUid,
      {
        status: req.query.status,
        pageId: req.query.pageId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        limit: req.query.limit
      }
    );

    return res.json({
      success: true,
      count: result.count,
      hasMore: result.hasMore,
      posts: result.posts
    });
  })
);

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

    const productId = cleanString(
      req.body?.productId,
      128
    );

    if (!productId) {
      throw new FacebookError(
        'Product ID is required.',
        400,
        'PRODUCT_ID_REQUIRED'
      );
    }

    const product = await getEligibleProductById(
      productId
    );

    const captionSkuData = product.captionSkuData || {
      productSku: cleanString(product.sku, 100),

      variantSkus: (product.variants || [])
        .filter(variant => (
          variant &&
          cleanString(
            variant.sku || variant.variantSku,
            100
          )
        ))
        .map(variant => ({
          color: cleanString(variant.color, 100),
          size: cleanString(variant.size, 100),
          sku: cleanString(
            variant.sku || variant.variantSku,
            100
          )
        }))
    };

    const result = await generateFacebookCaption(
      productId,
      captionSkuData
    );

    return res.json({
      ...result,

      productSku: captionSkuData.productSku || '',

      variantSkus: captionSkuData.variantSkus || []
    });
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

    // 1. Validate Request

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

    // 2. Verify Product

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

    // 3. Verify Selected Facebook Page

    const selectedPages = await getSelectedPages(
      adminUid
    );

    const selectedPage = selectedPages.find(
      page => page.pageId === pageId
    );

    if (!selectedPage) {
      throw new FacebookError(
        'This Facebook Page is not selected or does not belong to this admin.',
        403,
        'PAGE_ACCESS_DENIED'
      );
    }

    // 4. Get Page Access Token

    const pageAccessToken = await getSelectedPageToken(
      adminUid,
      pageId
    );

    // 5. Create Publishing History

    const history = await createPostHistory({
      adminUid,

      product: {
        id: product.id,
        name: product.name,
        sku: product.sku
      },

      pageId,

      pageName: selectedPage.pageName,

      caption,

      images: product.postImages
    });

    // 6. Publish to Facebook

    let publishResult;

    try {
      publishResult = await publishFacebookProductPost({
        pageId,
        pageAccessToken,
        caption,
        images: product.postImages
      });

    } catch (error) {
      try {
        await markPostFailed(
          history.id,
          adminUid,
          error
        );

      } catch (historyError) {
        console.error(
          '[FACEBOOK HISTORY] Failed to save publishing error:',
          historyError.message
        );
      }

      throw error;
    }

    // 7. Save Successful Publishing Result

    const historyResult = await markPostPublished(
      history.id,
      adminUid,
      publishResult
    );

    // 8. Return Success
    // Root-level fields maintain frontend compatibility.

    return res.status(200).json({
      success: true,

      message: 'Facebook product post published successfully.',

      postId: publishResult.postId,

      pageId: publishResult.pageId || pageId,

      imageCount: publishResult.imageCount,

      postUrl: historyResult.postUrl,

      post: {
        postId: publishResult.postId,

        postUrl: historyResult.postUrl,

        pageId: publishResult.pageId || pageId,

        pageName: selectedPage.pageName,

        productId: product.id,

        productName: product.name,

        imageCount: publishResult.imageCount
      },

      history: {
        id: history.id,

        status: 'published',

        publishedAt: historyResult.publishedAt
      }
    });
  })
);

// ========================================
// Export
// ========================================

module.exports = router;
