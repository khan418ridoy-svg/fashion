
'use strict';

const express = require('express');
const crypto = require('crypto');

const {
  processFeedChange
} = require('./facebook.engagement.service');

const router = express.Router();

// ========================================
// Configuration
// ========================================

const WEBHOOK_VERIFY_TOKEN =
  process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || '';

const FACEBOOK_APP_SECRET =
  process.env.FACEBOOK_APP_SECRET || '';

// ========================================
// Helpers
// ========================================

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const first = Buffer.from(a, 'utf8');
  const second = Buffer.from(b, 'utf8');

  if (first.length !== second.length) {
    return false;
  }

  return crypto.timingSafeEqual(first, second);
}

function verifySignature(req) {
  if (!FACEBOOK_APP_SECRET) {
    throw new Error(
      'FACEBOOK_APP_SECRET is not configured.'
    );
  }

  const signature = req.get('x-hub-signature-256');

  if (!signature || !signature.startsWith('sha256=')) {
    return false;
  }

  const rawBody = req.rawBody;

  if (!Buffer.isBuffer(rawBody)) {
    throw new Error(
      'Raw request body is missing. Check express.json verify configuration in server.js.'
    );
  }

  const expectedSignature =
    'sha256=' +
    crypto
      .createHmac('sha256', FACEBOOK_APP_SECRET)
      .update(rawBody)
      .digest('hex');

  return safeCompare(signature, expectedSignature);
}

// ========================================
// GET: Meta Webhook Verification
// ========================================

router.get('/', (req, res) => {
  if (!WEBHOOK_VERIFY_TOKEN) {
    return res.status(500).send(
      'FACEBOOK_WEBHOOK_VERIFY_TOKEN is not configured.'
    );
  }

  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (
    mode === 'subscribe' &&
    typeof token === 'string' &&
    safeCompare(token, WEBHOOK_VERIFY_TOKEN) &&
    typeof challenge === 'string'
  ) {
    console.info(
      '[FACEBOOK WEBHOOK] Verification successful.'
    );

    return res
      .status(200)
      .type('text/plain')
      .send(challenge);
  }

  console.warn(
    '[FACEBOOK WEBHOOK] Verification failed.'
  );

  return res.sendStatus(403);
});

// ========================================
// POST: Receive Facebook Events
// ========================================

router.post('/', async (req, res) => {
  // ------------------------------------
  // Verify Meta Signature
  // ------------------------------------

  let signatureValid = false;

  try {
    signatureValid = verifySignature(req);
  } catch (error) {
    console.error(
      '[FACEBOOK WEBHOOK] Signature verification error:',
      error.message
    );

    return res.status(500).json({
      success: false,
      message: 'Webhook signature verification is not configured correctly.'
    });
  }

  if (!signatureValid) {
    console.warn(
      '[FACEBOOK WEBHOOK] Invalid request signature.'
    );

    return res.status(401).json({
      success: false,
      message: 'Invalid webhook signature.'
    });
  }

  // ------------------------------------
  // Validate Payload
  // ------------------------------------

  const body = req.body;

  if (
    !body ||
    body.object !== 'page' ||
    !Array.isArray(body.entry)
  ) {
    return res.status(404).json({
      success: false,
      message: 'Unsupported webhook event.'
    });
  }

  let messagingEventCount = 0;
  let feedEventCount = 0;
  let processedCommentCount = 0;
  let duplicateCommentCount = 0;
  let ignoredFeedCount = 0;

  try {
    // ------------------------------------
    // Process Each Page Entry
    // ------------------------------------

    for (const entry of body.entry) {
      const pageId =
        typeof entry.id === 'string'
          ? entry.id.trim()
          : '';

      // ------------------------------------
      // Messenger Events
      // ------------------------------------

      const messagingEvents = Array.isArray(entry.messaging)
        ? entry.messaging
        : [];

      for (const event of messagingEvents) {
        messagingEventCount += 1;

        if (event.message) {
          console.info(
            '[FACEBOOK WEBHOOK] Message event received.'
          );
        } else if (event.postback) {
          console.info(
            '[FACEBOOK WEBHOOK] Postback event received.'
          );
        } else if (event.delivery) {
          console.info(
            '[FACEBOOK WEBHOOK] Delivery event received.'
          );
        } else if (event.read) {
          console.info(
            '[FACEBOOK WEBHOOK] Read event received.'
          );
        } else if (event.referral) {
          console.info(
            '[FACEBOOK WEBHOOK] Referral event received.'
          );
        } else {
          console.info(
            '[FACEBOOK WEBHOOK] Other messaging event received.'
          );
        }
      }

      // ------------------------------------
      // Page Feed / Comment Events
      // ------------------------------------

      const changes = Array.isArray(entry.changes)
        ? entry.changes
        : [];

      for (const change of changes) {
        if (change?.field !== 'feed') {
          continue;
        }

        feedEventCount += 1;

        if (!pageId) {
          console.warn(
            '[FACEBOOK WEBHOOK] Feed event missing Page ID.'
          );

          ignoredFeedCount += 1;
          continue;
        }

        const result = await processFeedChange(
          pageId,
          change
        );

        if (result.processed !== true) {
          ignoredFeedCount += 1;

          console.info(
            '[FACEBOOK WEBHOOK] Feed event ignored:',
            result.reason || 'UNKNOWN_REASON'
          );

          continue;
        }

        if (result.duplicate === true) {
          duplicateCommentCount += 1;
          continue;
        }

        processedCommentCount += 1;

        console.info(
          '[FACEBOOK WEBHOOK] Comment event processed:',
          {
            pageId: result.pageId,
            postId: result.postId,
            commentId: result.commentId,
            isReply: result.isReply,
            replySource: result.replySource
          }
        );
      }
    }

    // ------------------------------------
    // Summary
    // ------------------------------------

    console.info(
      '[FACEBOOK WEBHOOK] Processing completed:',
      {
        messagingEventCount,
        feedEventCount,
        processedCommentCount,
        duplicateCommentCount,
        ignoredFeedCount
      }
    );

    // Acknowledge successfully processed events.
    return res.status(200).json({
      success: true,
      received: true,
      counts: {
        messaging: messagingEventCount,
        feed: feedEventCount,
        commentsProcessed: processedCommentCount,
        duplicates: duplicateCommentCount,
        ignored: ignoredFeedCount
      }
    });

  } catch (error) {
    // Return 500 so Meta can retry failed events.
    console.error(
      '[FACEBOOK WEBHOOK] Event processing failed:',
      {
        message: error.message,
        code: error.code || error.name
      }
    );

    return res.status(500).json({
      success: false,
      message: 'Facebook webhook event processing failed.'
    });
  }
});

module.exports = router;
