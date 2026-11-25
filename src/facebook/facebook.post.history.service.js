
'use strict';

const { db } = require('../config/firebase');

const {
  FacebookError,
  cleanString
} = require('./facebook.utils');

const COLLECTION = 'facebookPostHistory';

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 100;
const QUERY_LIMIT = 250;

const ALLOWED_STATUSES = new Set([
  '',
  'publishing',
  'published',
  'failed'
]);

// ========================================
// Admin UID
// ========================================

function normalizeAdminUid(adminUid) {
  const uid = cleanString(adminUid, 128);

  if (!uid) {
    throw new FacebookError(
      'Admin authentication required.',
      401,
      'ADMIN_AUTH_REQUIRED'
    );
  }

  return uid;
}

// ========================================
// Date Helpers
// ========================================

function normalizeDate(value, fieldName) {
  if (!value) return null;

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new FacebookError(
      `Invalid ${fieldName} date.`,
      400,
      'INVALID_HISTORY_DATE'
    );
  }

  return date;
}

function toDate(value) {
  if (!value) return null;

  if (value instanceof Date) {
    return value;
  }

  if (typeof value.toDate === 'function') {
    return value.toDate();
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? null
    : date;
}

// ========================================
// Validation
// ========================================

function normalizeLimit(value) {
  const limit = Number(value || DEFAULT_LIMIT);

  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_LIMIT
  ) {
    throw new FacebookError(
      `History limit must be between 1 and ${MAX_LIMIT}.`,
      400,
      'INVALID_HISTORY_LIMIT'
    );
  }

  return limit;
}

function normalizeStatus(value) {
  const status = cleanString(value, 30).toLowerCase();

  if (!ALLOWED_STATUSES.has(status)) {
    throw new FacebookError(
      'Invalid history status filter.',
      400,
      'INVALID_HISTORY_STATUS'
    );
  }

  return status;
}

// ========================================
// Facebook Post URL
// ========================================

function buildPostUrl(postId) {
  const id = cleanString(postId, 200);

  if (!id) return null;

  return `https://www.facebook.com/${encodeURIComponent(id)}`;
}

// ========================================
// Error Sanitization
// ========================================

function sanitizeError(error) {
  const message = cleanString(
    error?.message || 'Facebook publishing failed.',
    1000
  );

  return message
    .replace(/access_token=[^&\s]+/gi, 'access_token=[redacted]')
    .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]');
}

// ========================================
// Image Normalization
// ========================================

function normalizeImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .map(image => {
      if (typeof image === 'string') {
        return image;
      }

      return image?.url || '';
    })
    .filter(url => (
      typeof url === 'string' &&
      url.startsWith('https://res.cloudinary.com/')
    ))
    .slice(0, 10);
}

// ========================================
// Serialize History
// ========================================

function serializeHistory(doc) {
  const data = doc.data() || {};

  return {
    id: doc.id,

    status: data.status || 'unknown',

    productId: data.productId || '',
    productName: data.productName || '',
    productSku: data.productSku || '',

    pageId: data.pageId || '',
    pageName: data.pageName || '',

    caption: data.caption || '',

    images: Array.isArray(data.images)
      ? data.images
      : [],

    imageCount: Number(data.imageCount) || 0,

    postId: data.postId || null,

    postUrl: data.postUrl ||
      buildPostUrl(data.postId),

    error: data.error || null,
    errorCode: data.errorCode || null,

    attemptCount: Number(data.attemptCount) || 1,

    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
    publishedAt: toDate(data.publishedAt),
    lastAttemptAt: toDate(data.lastAttemptAt)
  };
}

// ========================================
// Create Publishing History
// ========================================

async function createPostHistory({
  adminUid,
  product,
  pageId,
  pageName,
  caption,
  images
} = {}) {
  const uid = normalizeAdminUid(adminUid);

  const normalizedPageId = cleanString(
    pageId,
    50
  );

  if (!normalizedPageId) {
    throw new FacebookError(
      'Facebook Page ID is required.',
      400,
      'PAGE_ID_REQUIRED'
    );
  }

  const normalizedCaption = String(
    caption || ''
  ).trim();

  if (!normalizedCaption) {
    throw new FacebookError(
      'Facebook caption is required.',
      400,
      'POST_CAPTION_REQUIRED'
    );
  }

  const now = new Date();

  const normalizedImages = normalizeImages(images);

  const ref = db
    .collection(COLLECTION)
    .doc();

  const record = {
    adminUid: uid,

    status: 'publishing',

    productId: cleanString(
      product?.id,
      128
    ),

    productName: cleanString(
      product?.name,
      300
    ),

    productSku: cleanString(
      product?.sku,
      100
    ),

    pageId: normalizedPageId,

    pageName: cleanString(
      pageName,
      200
    ),

    caption: normalizedCaption.slice(0, 5000),

    images: normalizedImages,

    imageCount: normalizedImages.length,

    postId: null,
    postUrl: null,

    error: null,
    errorCode: null,

    attemptCount: 1,

    createdAt: now,
    updatedAt: now,
    lastAttemptAt: now,
    publishedAt: null
  };

  await ref.create(record);

  return {
    id: ref.id,
    ...record
  };
}

// ========================================
// Mark Post as Published
// ========================================

async function markPostPublished(
  historyId,
  adminUid,
  result
) {
  const uid = normalizeAdminUid(adminUid);

  const id = cleanString(
    historyId,
    128
  );

  if (!id) {
    throw new FacebookError(
      'Post history ID is required.',
      400,
      'HISTORY_ID_REQUIRED'
    );
  }

  const postId = cleanString(
    result?.postId,
    200
  );

  if (!postId) {
    throw new FacebookError(
      'Facebook post ID is missing.',
      502,
      'FACEBOOK_POST_ID_MISSING'
    );
  }

  const ref = db
    .collection(COLLECTION)
    .doc(id);

  const snapshot = await ref.get();

  if (
    !snapshot.exists ||
    snapshot.data()?.adminUid !== uid
  ) {
    throw new FacebookError(
      'Post history record was not found.',
      404,
      'HISTORY_NOT_FOUND'
    );
  }

  const now = new Date();

  const postUrl = buildPostUrl(postId);

  await ref.update({
    status: 'published',

    postId,
    postUrl,

    imageCount:
      Number(result?.imageCount) ||
      snapshot.data()?.imageCount ||
      0,

    error: null,
    errorCode: null,

    publishedAt: now,
    updatedAt: now
  });

  return {
    id,
    postId,
    postUrl,
    publishedAt: now
  };
}

// ========================================
// Mark Post as Failed
// ========================================

async function markPostFailed(
  historyId,
  adminUid,
  error
) {
  const uid = normalizeAdminUid(adminUid);

  const id = cleanString(
    historyId,
    128
  );

  if (!id) return;

  const ref = db
    .collection(COLLECTION)
    .doc(id);

  const snapshot = await ref.get();

  if (
    !snapshot.exists ||
    snapshot.data()?.adminUid !== uid
  ) {
    return;
  }

  await ref.update({
    status: 'failed',

    error: sanitizeError(error),

    errorCode:
      cleanString(error?.code, 100) ||
      'FACEBOOK_PUBLISH_FAILED',

    updatedAt: new Date()
  });
}

// ========================================
// List Post History
// ========================================

async function listPostHistory(
  adminUid,
  filters = {}
) {
  const uid = normalizeAdminUid(adminUid);

  const limit = normalizeLimit(
    filters.limit
  );

  const status = normalizeStatus(
    filters.status
  );

  const pageId = cleanString(
    filters.pageId,
    50
  );

  const startDate = normalizeDate(
    filters.startDate,
    'start'
  );

  const endDate = normalizeDate(
    filters.endDate,
    'end'
  );

  if (
    startDate &&
    endDate &&
    startDate > endDate
  ) {
    throw new FacebookError(
      'Start date must be before end date.',
      400,
      'INVALID_HISTORY_DATE_RANGE'
    );
  }

  const snapshot = await db
    .collection(COLLECTION)
    .where('adminUid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(QUERY_LIMIT)
    .get();

  const filtered = snapshot.docs
    .map(serializeHistory)
    .filter(item => {
      if (
        status &&
        item.status !== status
      ) {
        return false;
      }

      if (
        pageId &&
        item.pageId !== pageId
      ) {
        return false;
      }

      const createdAt = item.createdAt;

      if (
        startDate &&
        (!createdAt || createdAt < startDate)
      ) {
        return false;
      }

      if (
        endDate &&
        (!createdAt || createdAt > endDate)
      ) {
        return false;
      }

      return true;
    });

  return {
    count: Math.min(filtered.length, limit),

    hasMore:
      filtered.length > limit ||
      snapshot.size === QUERY_LIMIT,

    posts: filtered.slice(0, limit)
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  createPostHistory,
  markPostPublished,
  markPostFailed,
  listPostHistory
};
