
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
  getSelectedPageToken,
  getSelectedPages
} = require('./facebook.connection.service');

const {
  publishFacebookProductPost
} = require('./facebook.publish.service');

const {
  createPostHistory,
  markPostPublished,
  markPostFailed
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

    // 1. Validate Product ID.

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

    // 2. Load eligible product from Firestore.

    const product = await getEligibleProductById(
      productId
    );

    // 3. Get verified SKU data.

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

    // 4. Generate Gemini caption.

    const result = await generateFacebookCaption(
      productId,
      captionSkuData
    );

    // 5. Return generated caption.

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

    // ====================================
    // 1. Validate Request
    // ====================================

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

    // ====================================
    // 2. Verify Product
    // ====================================

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

    // ====================================
    // 3. Verify Selected Facebook Page
    // ====================================

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

    // ====================================
    // 4. Get Page Access Token
    // ====================================

    const pageAccessToken = await getSelectedPageToken(
      adminUid,
      pageId
    );

    // ====================================
    // 5. Create Publishing History
    // ====================================

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

    // ====================================
    // 6. Publish to Facebook
    // ====================================

    let publishResult;

    try {
      publishResult = await publishFacebookProductPost({
        pageId,

        pageAccessToken,

        caption,

        images: product.postImages
      });

    } catch (error) {
      // Save publishing failure.

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

    // ====================================
    // 7. Save Successful Publishing Result
    // ====================================

    const historyResult = await markPostPublished(
      history.id,
      adminUid,
      publishResult
    );

    // ====================================
    // 8. Return Success
    // ====================================

    return res.status(200).json({
      success: true,

      message: 'Facebook product post published successfully.',

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
