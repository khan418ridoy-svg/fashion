
'use strict';

const crypto = require('crypto');

const { db } = require('../config/firebase');

const PAGES_COLLECTION = 'facebookPages';
const HISTORY_COLLECTION = 'facebookPostHistory';
const COMMENTS_COLLECTION = 'facebookComments';
const EVENTS_COLLECTION = 'facebookWebhookEvents';

const MAX_HISTORY_LIMIT = 5000;
const DEFAULT_LIST_LIMIT = 100;

// ========================================
// Helpers
// ========================================

function cleanString(value, maxLength = 2000) {
  if (typeof value !== 'string') {
    return '';
  }

  return value.trim().slice(0, maxLength);
}

function toDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }

  if (value && typeof value.toDate === 'function') {
    return toDate(value.toDate());
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value < 1000000000000
      ? value * 1000
      : value;

    const date = new Date(milliseconds);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);

    if (Number.isFinite(numeric)) {
      return toDate(numeric);
    }

    const date = new Date(value);

    return Number.isNaN(date.getTime()) ? null : date;
  }

  return null;
}

function makeDocumentId(value) {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function getTimestamp(value) {
  const date = toDate(value);

  return date ? date.getTime() : 0;
}

function normalizeLimit(value) {
  const limit = Number(value);

  if (!Number.isInteger(limit) || limit < 1) {
    return DEFAULT_LIST_LIMIT;
  }

  return Math.min(limit, 500);
}

// ========================================
// Facebook Page Context
// ========================================

async function getPageContext(pageId) {
  const id = cleanString(pageId, 50);

  if (!/^\d{5,30}$/.test(id)) {
    return null;
  }

  const snapshot = await db
    .collection(PAGES_COLLECTION)
    .doc(id)
    .get();

  if (!snapshot.exists) {
    return null;
  }

  const page = snapshot.data() || {};

  if (
    page.selected !== true ||
    !page.adminUid
  ) {
    return null;
  }

  return {
    adminUid: cleanString(page.adminUid, 128),
    pageId: id,
    pageName: cleanString(page.pageName, 200)
  };
}

// ========================================
// Published Post History Lookup
// ========================================

async function findPostHistory(adminUid, pageId, postId) {
  if (!postId) {
    return null;
  }

  const snapshot = await db
    .collection(HISTORY_COLLECTION)
    .where('postId', '==', postId)
    .limit(10)
    .get();

  const match = snapshot.docs.find(doc => {
    const data = doc.data() || {};

    return (
      data.adminUid === adminUid &&
      data.pageId === pageId &&
      data.status === 'published'
    );
  });

  if (!match) {
    return null;
  }

  const data = match.data() || {};

  return {
    historyId: match.id,
    productId: cleanString(data.productId, 128),
    productName: cleanString(data.productName, 300),
    productSku: cleanString(data.productSku, 100),
    postUrl: cleanString(data.postUrl, 1000)
  };
}

// ========================================
// Process Facebook Feed Comment Event
// ========================================

async function processFeedChange(pageId, change) {
  const id = cleanString(pageId, 50);
  const value = change?.value || {};

  const item = cleanString(value.item, 50).toLowerCase();
  const verb = cleanString(value.verb, 50).toLowerCase();

  if (item !== 'comment') {
    return {
      processed: false,
      reason: 'UNSUPPORTED_FEED_ITEM'
    };
  }

  if (!['add', 'edit', 'remove'].includes(verb)) {
    return {
      processed: false,
      reason: 'UNSUPPORTED_COMMENT_ACTION'
    };
  }

  const commentId = cleanString(
    value.comment_id || value.id,
    200
  );

  const postId = cleanString(value.post_id, 200);

  if (!commentId || !postId) {
    return {
      processed: false,
      reason: 'COMMENT_OR_POST_ID_MISSING'
    };
  }

  const page = await getPageContext(id);

  if (!page) {
    return {
      processed: false,
      reason: 'PAGE_NOT_SELECTED_OR_NOT_CONNECTED'
    };
  }

  const author = value.from && typeof value.from === 'object'
    ? value.from
    : {};

  const authorId = cleanString(author.id, 100);
  const authorName = cleanString(author.name, 200);

  const parentId = cleanString(value.parent_id, 200);

  const isReply = Boolean(
    parentId && parentId !== postId
  );

  const isPageAuthor = Boolean(
    authorId && authorId === page.pageId
  );

  const commentRefId = makeDocumentId(
    `${page.pageId}:${commentId}`
  );

  const eventPayload = JSON.stringify({
    pageId: page.pageId,
    commentId,
    postId,
    parentId,
    verb,
    message: cleanString(value.message, 10000),
    authorId,
    createdTime: value.created_time || null
  });

  const eventId = makeDocumentId(eventPayload);

  const commentRef = db
    .collection(COMMENTS_COLLECTION)
    .doc(commentRefId);

  const eventRef = db
    .collection(EVENTS_COLLECTION)
    .doc(eventId);

  const history = await findPostHistory(
    page.adminUid,
    page.pageId,
    postId
  );

  const now = new Date();
  const commentCreatedAt = toDate(value.created_time) || now;

  const result = await db.runTransaction(async transaction => {
    const eventSnapshot = await transaction.get(eventRef);

    if (eventSnapshot.exists) {
      return {
        duplicate: true
      };
    }

    const commentSnapshot = await transaction.get(commentRef);

    const previous = commentSnapshot.exists
      ? commentSnapshot.data() || {}
      : {};

    // Preserve an existing AI/Admin reply source.
    let replySource = previous.replySource || null;

    if (
      isReply &&
      isPageAuthor &&
      !['ai', 'admin'].includes(replySource)
    ) {
      replySource = 'page';
    }

    const commentData = {
      adminUid: page.adminUid,

      pageId: page.pageId,
      pageName: page.pageName,

      postId,

      historyId: history?.historyId || previous.historyId || '',
      productId: history?.productId || previous.productId || '',
      productName: history?.productName || previous.productName || '',
      productSku: history?.productSku || previous.productSku || '',
      postUrl: history?.postUrl || previous.postUrl || '',

      commentId,
      parentId: parentId || previous.parentId || '',
      isReply,

      message: verb === 'remove'
        ? previous.message || cleanString(value.message, 10000)
        : cleanString(value.message, 10000),

      authorId: authorId || previous.authorId || '',
      authorName: authorName || previous.authorName || '',
      authorType: isPageAuthor ? 'page' : 'customer',

      replySource,

      status: verb === 'remove' ? 'deleted' : 'active',

      commentCreatedAt:
        previous.commentCreatedAt || commentCreatedAt,

      lastEventAt: now,
      updatedAt: now,

      ...(commentSnapshot.exists
        ? {}
        : { createdAt: now })
    };

    transaction.set(commentRef, commentData, { merge: true });

    transaction.create(eventRef, {
      adminUid: page.adminUid,
      pageId: page.pageId,
      commentId,
      postId,
      verb,
      receivedAt: now
    });

    return {
      duplicate: false
    };
  });

  if (result.duplicate) {
    return {
      processed: true,
      duplicate: true,
      commentId
    };
  }

  return {
    processed: true,
    duplicate: false,
    commentId,
    postId,
    pageId: page.pageId,
    isReply,
    replySource: isReply && isPageAuthor
      ? 'page'
      : null
  };
}

// ========================================
// Record Outgoing AI / Admin Reply
// ========================================

/**
 * Call this function ONLY after Facebook successfully
 * creates the reply and returns its comment ID.
 *
 * source:
 * - ai
 * - admin
 */
async function recordOutgoingReply(options = {}) {
  const adminUid = cleanString(options.adminUid, 128);
  const pageId = cleanString(options.pageId, 50);
  const postId = cleanString(options.postId, 200);
  const parentCommentId = cleanString(
    options.parentCommentId || options.commentId,
    200
  );

  const replyId = cleanString(options.replyId, 200);
  const message = cleanString(options.message, 10000);
  const source = cleanString(options.source, 20).toLowerCase();

  if (!adminUid || !pageId || !postId || !parentCommentId) {
    throw new Error('Reply owner, Page, post and parent comment are required.');
  }

  if (!replyId || !message) {
    throw new Error('Facebook reply ID and message are required.');
  }

  if (!['ai', 'admin'].includes(source)) {
    throw new Error('Reply source must be ai or admin.');
  }

  const page = await getPageContext(pageId);

  if (!page || page.adminUid !== adminUid) {
    throw new Error('Facebook Page access denied.');
  }

  const parentRef = db
    .collection(COMMENTS_COLLECTION)
    .doc(makeDocumentId(`${pageId}:${parentCommentId}`));

  const replyRef = db
    .collection(COMMENTS_COLLECTION)
    .doc(makeDocumentId(`${pageId}:${replyId}`));

  const now = new Date();
  const replyCreatedAt = toDate(options.createdAt) || now;

  const result = await db.runTransaction(async transaction => {
    const parentSnapshot = await transaction.get(parentRef);
    const replySnapshot = await transaction.get(replyRef);

    if (!parentSnapshot.exists) {
      throw new Error('Parent customer comment was not found.');
    }

    const parent = parentSnapshot.data() || {};

    if (
      parent.adminUid !== adminUid ||
      parent.pageId !== pageId ||
      parent.postId !== postId ||
      parent.isReply === true
    ) {
      throw new Error('Parent comment does not belong to this Page or post.');
    }

    if (replySnapshot.exists) {
      const existing = replySnapshot.data() || {};

      if (
        existing.adminUid !== adminUid ||
        existing.parentId !== parentCommentId
      ) {
        throw new Error('Reply ID is already associated with another record.');
      }

      return {
        duplicate: true
      };
    }

    // Store the actual Facebook reply as its own comment record.
    transaction.create(replyRef, {
      adminUid,
      pageId,
      pageName: page.pageName,

      postId,

      historyId: parent.historyId || '',
      productId: parent.productId || '',
      productName: parent.productName || '',
      productSku: parent.productSku || '',
      postUrl: parent.postUrl || '',

      commentId: replyId,
      parentId: parentCommentId,
      isReply: true,

      message,

      authorId: pageId,
      authorName: page.pageName,
      authorType: 'page',

      replySource: source,

      status: 'active',

      commentCreatedAt: replyCreatedAt,
      lastEventAt: now,
      createdAt: now,
      updatedAt: now
    });

    // Keep latest reply information on the parent comment.
    transaction.set(parentRef, {
      replied: true,
      latestReplyId: replyId,
      latestReplyMessage: message,
      latestReplySource: source,
      latestReplyAt: replyCreatedAt,
      updatedAt: now
    }, { merge: true });

    return {
      duplicate: false
    };
  });

  return {
    success: true,
    duplicate: result.duplicate,
    replyId,
    parentCommentId,
    replySource: source
  };
}

// ========================================
// List Comment History
// ========================================

/**
 * Filters:
 * - pageId
 * - postId
 * - status: active | deleted
 * - includeReplies: true | false
 * - limit
 *
 * Results are always restricted to adminUid.
 */
async function listComments(adminUid, filters = {}) {
  const ownerUid = cleanString(adminUid, 128);

  if (!ownerUid) {
    throw new Error('Admin UID is required.');
  }

  const pageId = cleanString(filters.pageId, 50);
  const postId = cleanString(filters.postId, 200);
  const status = cleanString(filters.status, 20).toLowerCase();

  if (pageId && !/^\d{5,30}$/.test(pageId)) {
    throw new Error('Invalid Facebook Page ID.');
  }

  if (status && !['active', 'deleted'].includes(status)) {
    throw new Error('Invalid comment status.');
  }

  const limit = normalizeLimit(filters.limit);

  // Query by owner first. Apply optional filters in memory
  // to avoid requiring a separate composite index per filter.
  const snapshot = await db
    .collection(COMMENTS_COLLECTION)
    .where('adminUid', '==', ownerUid)
    .limit(MAX_HISTORY_LIMIT)
    .get();

  let comments = snapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));

  if (pageId) {
    comments = comments.filter(
      item => item.pageId === pageId
    );
  }

  if (postId) {
    comments = comments.filter(
      item => item.postId === postId
    );
  }

  if (status) {
    comments = comments.filter(
      item => item.status === status
    );
  }

  if (typeof filters.includeReplies === 'boolean') {
    comments = comments.filter(
      item => item.isReply === filters.includeReplies
    );
  }

  comments.sort((a, b) => {
    return getTimestamp(b.lastEventAt || b.commentCreatedAt) -
      getTimestamp(a.lastEventAt || a.commentCreatedAt);
  });

  const total = comments.length;

  return {
    comments: comments.slice(0, limit),
    total,
    limit,
    hasMore: total > limit
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  processFeedChange,
  recordOutgoingReply,
  listComments
};
