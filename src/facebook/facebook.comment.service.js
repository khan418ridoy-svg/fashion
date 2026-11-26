
'use strict';

const crypto = require('crypto');

const { db } = require('../config/firebase');

const {
  FacebookError,
  cleanString
} = require('./facebook.utils');

const {
  authenticatedGraphRequest
} = require('./facebook.graph');

const {
  getSelectedPageToken
} = require('./facebook.connection.service');


const {
  recordOutgoingReply,
  recordOutgoingComment
} = require('./facebook.engagement.service');


const COMMENTS_COLLECTION = 'facebookComments';

const MAX_REPLY_LENGTH = 10000;

// ========================================
// Helpers
// ========================================

function makeDocumentId(value) {
  return crypto
    .createHash('sha256')
    .update(value, 'utf8')
    .digest('hex');
}

function normalizeReply(options = {}) {
  const adminUid = cleanString(options.adminUid, 128);
  const pageId = cleanString(options.pageId, 50);
  const postId = cleanString(options.postId, 200);
  const parentCommentId = cleanString(
    options.parentCommentId,
    200
  );

  const message = typeof options.message === 'string'
    ? options.message.trim()
    : '';

  const source = cleanString(
    options.source,
    20
  ).toLowerCase();

  if (!adminUid) {
    throw new FacebookError(
      'Admin UID is required.',
      401,
      'ADMIN_AUTH_REQUIRED'
    );
  }

  if (!/^\d{5,30}$/.test(pageId)) {
    throw new FacebookError(
      'Invalid Facebook Page ID.',
      400,
      'INVALID_PAGE_ID'
    );
  }

  if (!postId || !parentCommentId) {
    throw new FacebookError(
      'Post ID and customer comment ID are required.',
      400,
      'COMMENT_DATA_REQUIRED'
    );
  }

  if (!message) {
    throw new FacebookError(
      'Reply message is required.',
      400,
      'REPLY_MESSAGE_REQUIRED'
    );
  }

  if (message.length > MAX_REPLY_LENGTH) {
    throw new FacebookError(
      'Reply message is too long.',
      400,
      'REPLY_MESSAGE_TOO_LONG'
    );
  }

  if (!['admin', 'ai'].includes(source)) {
    throw new FacebookError(
      'Reply source must be admin or ai.',
      400,
      'INVALID_REPLY_SOURCE'
    );
  }

  return {
    adminUid,
    pageId,
    postId,
    parentCommentId,
    message,
    source
  };
}

// ========================================
// Verify Parent Customer Comment
// ========================================

async function verifyParentComment({
  adminUid,
  pageId,
  postId,
  parentCommentId
}) {
  const documentId = makeDocumentId(
    `${pageId}:${parentCommentId}`
  );

  const snapshot = await db
    .collection(COMMENTS_COLLECTION)
    .doc(documentId)
    .get();

  if (!snapshot.exists) {
    throw new FacebookError(
      'Customer comment was not found in Facebook Comment History.',
      404,
      'PARENT_COMMENT_NOT_FOUND'
    );
  }

  const comment = snapshot.data() || {};

  if (
    comment.adminUid !== adminUid ||
    comment.pageId !== pageId ||
    comment.postId !== postId
  ) {
    throw new FacebookError(
      'You are not allowed to reply to this comment.',
      403,
      'COMMENT_ACCESS_DENIED'
    );
  }

  if (
    comment.isReply === true ||
    comment.status !== 'active'
  ) {
    throw new FacebookError(
      'Only active customer comments can receive a reply.',
      409,
      'INVALID_PARENT_COMMENT'
    );
  }

  return comment;
}

// ========================================
// Send Admin Top-level Post Comment
// ========================================

async function sendFacebookPostComment(options = {}) {
  const adminUid = cleanString(options.adminUid, 128);
  const pageId = cleanString(options.pageId, 50);
  const postId = cleanString(options.postId, 200);

  const message = typeof options.message === 'string'
    ? options.message.trim()
    : '';

  if (!adminUid) {
    throw new FacebookError(
      'Admin authentication required.',
      401,
      'ADMIN_AUTH_REQUIRED'
    );
  }

  if (!/^\d{5,30}$/.test(pageId)) {
    throw new FacebookError(
      'Invalid Facebook Page ID.',
      400,
      'INVALID_PAGE_ID'
    );
  }

  if (!postId || !postId.startsWith(`${pageId}_`)) {
    throw new FacebookError(
      'Invalid Facebook Post ID.',
      400,
      'INVALID_POST_ID'
    );
  }

  if (!message || message.length > MAX_REPLY_LENGTH) {
    throw new FacebookError(
      'Comment must contain 1 to 10000 characters.',
      400,
      'INVALID_COMMENT_MESSAGE'
    );
  }

  const pageAccessToken = await getSelectedPageToken(
    adminUid,
    pageId
  );

  const graphResult = await authenticatedGraphRequest(
    `${postId}/comments`,
    pageAccessToken,
    {
      method: 'POST',
      params: {
        message
      }
    }
  );

  const commentId = cleanString(graphResult?.id, 200);

  if (!commentId) {
    throw new FacebookError(
      'Facebook did not return a Comment ID.',
      502,
      'FACEBOOK_COMMENT_ID_MISSING'
    );
  }

  try {
    await recordOutgoingComment({
      adminUid,
      pageId,
      postId,
      commentId,
      message,
      source: 'admin'
    });
  } catch (error) {
    console.error('[FACEBOOK COMMENT LOG ERROR]', {
      pageId,
      postId,
      commentId,
      message: error.message
    });

    const logError = new FacebookError(
      'Facebook published the comment, but saving its history failed.',
      502,
      'FACEBOOK_COMMENT_LOG_FAILED'
    );

    logError.commentPublished = true;
    logError.commentId = commentId;

    throw logError;
  }

  return {
    success: true,
    commentId,
    pageId,
    postId,
    source: 'admin',
    message,
    publishedAt: new Date()
  };
}

// ========================================
// Send Facebook Comment Reply
// ========================================

/**
 * Send a reply to a Facebook Page comment.
 *
 * source:
 * - admin: Admin Dashboard
 * - ai: AI automation
 *
 * Important:
 * This function does not expose Page access tokens.
 */
async function sendFacebookCommentReply(options = {}) {
  const input = normalizeReply(options);

  // 1. Verify that the customer comment belongs
  //    to this admin, Page and post.
  await verifyParentComment(input);

  // 2. Get selected Page token.
  //    The token stays on the backend.
  const pageAccessToken = await getSelectedPageToken(
    input.adminUid,
    input.pageId
  );

  // 3. Send reply to Facebook.
  const graphResult = await authenticatedGraphRequest(
    `${input.parentCommentId}/comments`,
    pageAccessToken,
    {
      method: 'POST',
      params: {
        message: input.message
      }
    }
  );

  const replyId = cleanString(
    graphResult?.id,
    200
  );

  if (!replyId) {
    throw new FacebookError(
      'Facebook did not return a reply ID.',
      502,
      'FACEBOOK_REPLY_ID_MISSING'
    );
  }

  // 4. Save the successful reply and its source.
  try {
    await recordOutgoingReply({
      adminUid: input.adminUid,
      pageId: input.pageId,
      postId: input.postId,
      parentCommentId: input.parentCommentId,
      replyId,
      message: input.message,
      source: input.source,
      createdAt: new Date()
    });

  } catch (error) {
    // Facebook has already published the reply.
    // Do not silently pretend the operation failed.
    console.error('[FACEBOOK REPLY LOG ERROR]', {
      pageId: input.pageId,
      postId: input.postId,
      parentCommentId: input.parentCommentId,
      replyId,
      source: input.source,
      message: error.message
    });

    const logError = new FacebookError(
      'Facebook published the reply, but saving its history failed.',
      502,
      'FACEBOOK_REPLY_LOG_FAILED'
    );

    logError.replyPublished = true;
    logError.replyId = replyId;

    throw logError;
  }

  return {
    success: true,
    replyId,
    parentCommentId: input.parentCommentId,
    pageId: input.pageId,
    postId: input.postId,
    source: input.source,
    message: input.message,
    publishedAt: new Date()
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  sendFacebookCommentReply,
  sendFacebookPostComment
};