
'use strict';

const crypto = require('crypto');

const { db } = require('../config/firebase');

const {
  cleanString,
  FacebookError,
  requireEnv
} = require('./facebook.utils');

const {
  getGraphVersion,
  graphRequest
} = require('./facebook.graph');

const STATE_COLLECTION = 'facebookOAuthStates';
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Get Facebook OAuth configuration.
 */
function getOAuthConfig() {
  return {
    appId: requireEnv('FACEBOOK_APP_ID'),
    appSecret: requireEnv('FACEBOOK_APP_SECRET'),
    redirectUri: requireEnv('FACEBOOK_REDIRECT_URI')
  };
}

/**
 * Get requested Facebook permissions.
 *
 * Keep permissions configurable because Meta may require
 * App Review or business verification for certain permissions.
 */
function getOAuthScopes() {
  const configured = cleanString(
    process.env.FACEBOOK_OAUTH_SCOPES ||
      [
        'public_profile',
        'pages_show_list',
        'pages_read_engagement',
        'pages_manage_posts',
        'pages_messaging',
        'pages_manage_metadata',
        'pages_read_user_content'
      ].join(','),
    2000
  );

  const scopes = configured
    .split(',')
    .map(scope => scope.trim())
    .filter(Boolean);

  return [...new Set(scopes)];
}

/**
 * Hash OAuth state before storing it.
 *
 * Raw state is only returned to the browser through the
 * Facebook authorization URL.
 */
function hashState(state) {
  return crypto
    .createHash('sha256')
    .update(state, 'utf8')
    .digest('hex');
}

/**
 * Create a Facebook OAuth authorization URL.
 *
 * adminUid must come from authenticated admin middleware.
 */
async function createAuthorizationUrl(adminUid) {
  const uid = cleanString(adminUid, 128);

  if (!uid) {
    throw new FacebookError(
      'Authenticated admin user is required.',
      401,
      'ADMIN_AUTH_REQUIRED'
    );
  }

  const config = getOAuthConfig();

  const state = crypto.randomBytes(32).toString('hex');
  const stateHash = hashState(state);

  const now = Date.now();
  const expiresAt = new Date(now + STATE_TTL_MS);

  const stateRef = db
    .collection(STATE_COLLECTION)
    .doc(stateHash);

  await stateRef.create({
    adminUid: uid,
    createdAt: new Date(now),
    expiresAt
  });

  const authorizationUrl = new URL(
    `https://www.facebook.com/${getGraphVersion()}/dialog/oauth`
  );

  authorizationUrl.searchParams.set('client_id', config.appId);
  authorizationUrl.searchParams.set('redirect_uri', config.redirectUri);
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('state', state);
  authorizationUrl.searchParams.set(
    'scope',
    getOAuthScopes().join(',')
  );

  return {
    url: authorizationUrl.toString(),
    expiresAt: expiresAt.toISOString()
  };
}

/**
 * Validate and consume OAuth state.
 *
 * A state can only be used once.
 * Returns the admin UID associated with the login attempt.
 */
async function consumeOAuthState(rawState) {
  const state = cleanString(rawState, 200);

  if (!/^[a-f0-9]{64}$/i.test(state)) {
    throw new FacebookError(
      'Invalid or missing Facebook OAuth state.',
      400,
      'INVALID_OAUTH_STATE'
    );
  }

  const stateHash = hashState(state);

  const stateRef = db
    .collection(STATE_COLLECTION)
    .doc(stateHash);

  const result = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(stateRef);

    if (!snapshot.exists) {
      return null;
    }

    const data = snapshot.data() || {};

    // Delete state in the same transaction so it cannot be reused.
    transaction.delete(stateRef);

    const expiresAt = data.expiresAt instanceof Date
      ? data.expiresAt.getTime()
      : data.expiresAt?.toDate?.()?.getTime?.();

    if (
      !data.adminUid ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= Date.now()
    ) {
      return null;
    }

    return {
      adminUid: cleanString(data.adminUid, 128)
    };
  });

  if (!result?.adminUid) {
    throw new FacebookError(
      'Facebook OAuth session expired or was already used. Please connect again.',
      400,
      'OAUTH_STATE_EXPIRED'
    );
  }

  return result;
}

/**
 * Validate token response received from Meta.
 */
function normalizeTokenResponse(data) {
  const accessToken = cleanString(data?.access_token, 10000);

  if (!accessToken) {
    throw new FacebookError(
      'Facebook did not return an access token.',
      502,
      'OAUTH_TOKEN_MISSING'
    );
  }

  const expiresIn = Number(data?.expires_in);

  return {
    accessToken,
    tokenType: cleanString(data?.token_type || 'bearer', 30),
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0
      ? expiresIn
      : null,
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0
      ? new Date(Date.now() + expiresIn * 1000)
      : null
  };
}

/**
 * Exchange Facebook authorization code for short-lived token.
 */
async function exchangeAuthorizationCode(code) {
  const authorizationCode = cleanString(code, 5000);

  if (!authorizationCode) {
    throw new FacebookError(
      'Facebook authorization code is missing.',
      400,
      'OAUTH_CODE_MISSING'
    );
  }

  const config = getOAuthConfig();

  const data = await graphRequest('oauth/access_token', {
    method: 'GET',
    params: {
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
      code: authorizationCode
    }
  });

  return normalizeTokenResponse(data);
}

/**
 * Exchange short-lived User Access Token for long-lived token.
 *
 * This operation must only run on the backend.
 */
async function exchangeForLongLivedToken(shortLivedToken) {
  const token = cleanString(shortLivedToken, 10000);

  if (!token) {
    throw new FacebookError(
      'Short-lived Facebook User Access Token is required.',
      400,
      'SHORT_TOKEN_MISSING'
    );
  }

  const config = getOAuthConfig();

  const data = await graphRequest('oauth/access_token', {
    method: 'GET',
    params: {
      grant_type: 'fb_exchange_token',
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: token
    }
  });

  return normalizeTokenResponse(data);
}

module.exports = {
  getOAuthConfig,
  getOAuthScopes,
  createAuthorizationUrl,
  consumeOAuthState,
  exchangeAuthorizationCode,
  exchangeForLongLivedToken
};
