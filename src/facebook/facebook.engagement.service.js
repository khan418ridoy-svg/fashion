
'use strict';

const crypto = require('crypto');

const { db } = require('../config/firebase');

const PAGES_COLLECTION = 'facebookPages';
const HISTORY_COLLECTION = 'facebookPostHistory';
const COMMENTS_COLLECTION = 'facebookComments';
const EVENTS_COLLECTION = 'facebookWebhookEvents';

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

/**
 * Find the selected Page and its owner.
 */
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

/**
 * Find the published product post associated with a comment.
 */
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

/**
 * Process a Facebook Page feed comment event.
 *
 * Supported examples:
 * - item: comment, verb: add
 * - item: comment, verb: edit
 * - item: comment, verb: remove
 *
 * Page replies are comments authored by the Page itself.
 * AI/Admin source labels can be preserved when those systems
 * later write their own reply records.
 */
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

    // Preserve an internally recorded AI/Admin source.
    // Otherwise, a reply authored by the Page is labeled Page.
    let replySource = previous.replySource || null;

    if (isReply && isPageAuthor && !['ai', 'admin'].includes(replySource)) {
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

      authorId,
      authorName,
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
    replySource: isReply ? (isPageAuthor ? 'page' : null) : null
  };
}

module.exports = {
  processFeedChange
};
