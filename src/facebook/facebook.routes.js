
'use strict';

const express = require('express');

const adminAuth = require('../middleware/adminAuth');
const { db } = require('../config/firebase');

const {
  FacebookError,
  cleanString
} = require('./facebook.utils');

const {
  encryptToken
} = require('./facebook.crypto');

const {
  createAuthorizationUrl,
  consumeOAuthState,
  exchangeAuthorizationCode,
  exchangeForLongLivedToken
} = require('./facebook.oauth');

const {
  getCurrentUser
} = require('./facebook.graph');

const {
  getAvailablePages,
  saveSelectedPages,
  getSelectedPages,
  removeAdminPages
} = require('./facebook.connection.service');

const router = express.Router();

// ========================================
// Firestore Configuration
// ========================================

const CONNECTION_COLLECTION = 'facebookConnections';
const CONNECTION_DOC = 'primary';

// ========================================
// Helpers
// ========================================

function getAdminUid(req) {
  return cleanString(req.admin?.uid, 128);
}

function connectionRef() {
  return db
    .collection(CONNECTION_COLLECTION)
    .doc(CONNECTION_DOC);
}

function getDate(value) {
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

function sendError(res, error) {
  const status = Number(error.status) || 500;

  if (status >= 500) {
    console.error('[FACEBOOK API ERROR]', {
      code: error.code || error.name,
      message: error.message
    });
  }

  return res.status(status).json({
    success: false,
    error: {
      code: error.code || 'FACEBOOK_ERROR',
      message: error.message || 'Facebook request failed.'
    }
  });
}

function requireAdminUid(req) {
  const adminUid = getAdminUid(req);

  if (!adminUid) {
    throw new FacebookError(
      'Authenticated admin user was not found.',
      401,
      'ADMIN_AUTH_REQUIRED'
    );
  }

  return adminUid;
}

// ========================================
// OAuth Callback
// Public route - protected by one-time state
// ========================================

router.get('/oauth/callback', async (req, res) => {
  try {
    const state = cleanString(req.query.state, 200);

    if (!state) {
      throw new FacebookError(
        'Facebook OAuth state is missing.',
        400,
        'OAUTH_STATE_MISSING'
      );
    }

    // Validate and consume state before processing
    // either a successful or denied authorization.
    const { adminUid } = await consumeOAuthState(state);

    const facebookError = cleanString(
      req.query.error,
      200
    );

    if (facebookError) {
      console.warn('[FACEBOOK OAUTH] Authorization denied:', {
        error: facebookError
      });

      return res.redirect('/?facebook=login_failed');
    }

    const code = cleanString(req.query.code, 5000);

    if (!code) {
      throw new FacebookError(
        'Facebook authorization code is missing.',
        400,
        'OAUTH_CODE_MISSING'
      );
    }

    // ------------------------------------
    // Exchange authorization code
    // ------------------------------------

    const shortToken = await exchangeAuthorizationCode(code);

    if (!shortToken?.accessToken) {
      throw new FacebookError(
        'Facebook short-lived token was not returned.',
        502,
        'SHORT_TOKEN_MISSING'
      );
    }

    // ------------------------------------
    // Exchange for long-lived token
    // ------------------------------------

    const longToken = await exchangeForLongLivedToken(
      shortToken.accessToken
    );

    if (!longToken?.accessToken) {
      throw new FacebookError(
        'Facebook long-lived token was not returned.',
        502,
        'LONG_TOKEN_MISSING'
      );
    }

    // ------------------------------------
    // Verify Facebook account
    // ------------------------------------

    const facebookUser = await getCurrentUser(
      longToken.accessToken
    );

    const facebookUserId = cleanString(
      facebookUser?.id,
      50
    );

    const facebookUserName = cleanString(
      facebookUser?.name,
      200
    );

    if (!facebookUserId) {
      throw new FacebookError(
        'Could not verify the Facebook account.',
        502,
        'FACEBOOK_USER_INVALID'
      );
    }

    // ------------------------------------
    // Save encrypted connection
    // ------------------------------------

    const ref = connectionRef();
    const now = new Date();

    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);

      const existing = snapshot.exists
        ? snapshot.data() || {}
        : {};

      // Do not allow another admin to replace
      // an existing active connection.
      if (
        existing.connected === true &&
        existing.adminUid !== adminUid
      ) {
        throw new FacebookError(
          'Another admin account already owns this Facebook connection.',
          409,
          'FACEBOOK_CONNECTION_ALREADY_OWNED'
        );
      }

      transaction.set(ref, {
        adminUid,
        facebookUserId,
        facebookUserName,

        userAccessTokenEncrypted: encryptToken(
          longToken.accessToken
        ),

        tokenExpiresAt: longToken.expiresAt || null,
        tokenType: longToken.tokenType || 'bearer',

        connected: true,

        connectedAt: existing.connectedAt || now,
        updatedAt: now
      }, { merge: true });
    });

    return res.redirect('/?facebook=connected');

  } catch (error) {
    console.error('[FACEBOOK OAUTH CALLBACK]', {
      code: error.code || error.name,
      message: error.message
    });

    return res.redirect('/?facebook=login_failed');
  }
});

// ========================================
// Admin Authentication
// All routes below require adminAuth
// ========================================

router.use(adminAuth);

// ========================================
// Start Facebook OAuth
// GET /api/facebook/oauth/start
// ========================================

router.get('/oauth/start', async (req, res) => {
  try {
    const adminUid = requireAdminUid(req);

    const result = await createAuthorizationUrl(adminUid);

    return res.json({
      success: true,
      url: result.url,
      expiresAt: result.expiresAt
    });

  } catch (error) {
    return sendError(res, error);
  }
});

// ========================================
// Get Connection Status
// GET /api/facebook/connection
// ========================================

router.get('/connection', async (req, res) => {
  try {
    const adminUid = requireAdminUid(req);

    const snapshot = await connectionRef().get();

    if (!snapshot.exists) {
      return res.json({
        success: true,
        connected: false,
        connection: null
      });
    }

    const data = snapshot.data() || {};

    if (
      data.adminUid !== adminUid ||
      data.connected !== true
    ) {
      return res.json({
        success: true,
        connected: false,
        connection: null
      });
    }

    const expiry = getDate(data.tokenExpiresAt);

    const tokenExpired = expiry
      ? expiry.getTime() <= Date.now()
      : false;

    return res.json({
      success: true,

      // Expired connections must reconnect.
      connected: !tokenExpired,

      connection: {
        facebookUserId: data.facebookUserId || null,
        facebookUserName: data.facebookUserName || null,

        connectedAt: getDate(data.connectedAt),
        updatedAt: getDate(data.updatedAt),
        tokenExpiresAt: expiry,

        tokenExpired
      }
    });

  } catch (error) {
    return sendError(res, error);
  }
});

// ========================================
// Get Available Facebook Pages
// GET /api/facebook/pages/available
// ========================================

router.get('/pages/available', async (req, res) => {
  try {
    const adminUid = requireAdminUid(req);

    const pages = await getAvailablePages(adminUid);

    return res.json({
      success: true,
      count: pages.length,
      pages
    });

  } catch (error) {
    return sendError(res, error);
  }
});

// ========================================
// Get Selected Facebook Pages
// GET /api/facebook/pages/selected
// ========================================

router.get('/pages/selected', async (req, res) => {
  try {
    const adminUid = requireAdminUid(req);

    const pages = await getSelectedPages(adminUid);

    return res.json({
      success: true,
      count: pages.length,
      pages
    });

  } catch (error) {
    return sendError(res, error);
  }
});

// ========================================
// Save Selected Facebook Pages
// POST /api/facebook/pages/select
// ========================================

router.post('/pages/select', async (req, res) => {
  try {
    const adminUid = requireAdminUid(req);

    const selectedPageIds = req.body?.selectedPageIds;

    if (!Array.isArray(selectedPageIds)) {
      throw new FacebookError(
        'selectedPageIds must be an array.',
        400,
        'INVALID_SELECTED_PAGES'
      );
    }

    const result = await saveSelectedPages(
      adminUid,
      selectedPageIds
    );

    return res.json({
      success: true,
      message: 'Facebook Page selection saved.',
      ...result
    });

  } catch (error) {
    return sendError(res, error);
  }
});

// ========================================
// Disconnect Facebook
// DELETE /api/facebook/connection
// ========================================

router.delete('/connection', async (req, res) => {
  try {
    const adminUid = requireAdminUid(req);

    const ref = connectionRef();

    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);

      if (!snapshot.exists) {
        return;
      }

      const data = snapshot.data() || {};

      if (data.adminUid !== adminUid) {
        throw new FacebookError(
          'You cannot disconnect another admin account.',
          403,
          'CONNECTION_ACCESS_DENIED'
        );
      }

      transaction.delete(ref);
    });

    // Remove saved encrypted Page tokens.
    const removed = await removeAdminPages(adminUid);

    return res.json({
      success: true,
      connected: false,
      removedPages: removed.deletedCount
    });

  } catch (error) {
    return sendError(res, error);
  }
});

// ========================================
// Exports
// ========================================

module.exports = router;
