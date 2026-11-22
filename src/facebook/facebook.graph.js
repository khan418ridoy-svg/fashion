
'use strict';

const {
  cleanString,
  FacebookError,
  requireEnv
} = require('./facebook.utils');

const DEFAULT_GRAPH_VERSION = 'v26.0';
const GRAPH_TIMEOUT = 15000;

/**
 * Get and validate the configured Graph API version.
 */
function getGraphVersion() {
  const version = cleanString(
    process.env.FACEBOOK_GRAPH_VERSION || DEFAULT_GRAPH_VERSION,
    20
  );

  if (!/^v\d+\.\d+$/.test(version)) {
    throw new FacebookError(
      'Invalid FACEBOOK_GRAPH_VERSION configuration.',
      503,
      'INVALID_GRAPH_VERSION'
    );
  }

  return version;
}

/**
 * Build the Graph API base URL.
 */
function getGraphBaseUrl() {
  return `https://graph.facebook.com/${getGraphVersion()}`;
}

/**
 * Validate and normalize a Graph API endpoint path.
 */
function normalizePath(path) {
  const value = cleanString(path, 500).replace(/^\/+/, '');

  if (
    !value ||
    value.includes('..') ||
    value.includes('://') ||
    value.includes('?') ||
    value.includes('#')
  ) {
    throw new FacebookError(
      'Invalid Facebook Graph API endpoint.',
      400,
      'INVALID_GRAPH_PATH'
    );
  }

  return value;
}

/**
 * Append query parameters to a URL.
 */
function appendQueryParams(url, params = {}) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw new FacebookError(
      'Graph API parameters must be an object.',
      400,
      'INVALID_GRAPH_PARAMS'
    );
  }

  for (const [key, value] of Object.entries(params)) {
    if (
      value === undefined ||
      value === null ||
      key === 'access_token'
    ) {
      continue;
    }

    url.searchParams.set(
      key,
      typeof value === 'string' ? value : JSON.stringify(value)
    );
  }
}

/**
 * Make a request to Meta Graph API.
 *
 * Options:
 * - method: GET, POST, DELETE
 * - params: URL query parameters
 * - body: request body
 * - token: Facebook User/Page access token
 * - headers: additional headers
 */
async function graphRequest(path, options = {}) {
  const endpoint = normalizePath(path);

  const method = String(options.method || 'GET').toUpperCase();

  if (!['GET', 'POST', 'DELETE'].includes(method)) {
    throw new FacebookError(
      'Unsupported Graph API HTTP method.',
      400,
      'INVALID_HTTP_METHOD'
    );
  }

  const url = new URL(`${getGraphBaseUrl()}/${endpoint}`);

  appendQueryParams(url, options.params);

  const headers = {
    Accept: 'application/json',
    ...(options.headers || {})
  };

  const token = options.token
    ? cleanString(options.token, 10000)
    : '';

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let body;

  if (method !== 'GET' && options.body !== undefined) {
    const requestBody = options.body;

    if (
      typeof FormData !== 'undefined' &&
      requestBody instanceof FormData
    ) {
      body = requestBody;
    } else if (
      typeof URLSearchParams !== 'undefined' &&
      requestBody instanceof URLSearchParams
    ) {
      body = requestBody;
      headers['Content-Type'] =
        headers['Content-Type'] || 'application/x-www-form-urlencoded';
    } else if (
      Buffer.isBuffer(requestBody) ||
      typeof requestBody === 'string'
    ) {
      body = requestBody;
    } else if (
      typeof requestBody === 'object' &&
      !Array.isArray(requestBody)
    ) {
      body = JSON.stringify(requestBody);
      headers['Content-Type'] =
        headers['Content-Type'] || 'application/json';
    } else {
      throw new FacebookError(
        'Invalid Graph API request body.',
        400,
        'INVALID_GRAPH_BODY'
      );
    }
  }

  const timeout = Math.min(
    Math.max(
      Number(process.env.FACEBOOK_GRAPH_TIMEOUT) || GRAPH_TIMEOUT,
      1000
    ),
    60000
  );

  let response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new FacebookError(
        'Facebook Graph API request timed out.',
        504,
        'GRAPH_API_TIMEOUT'
      );
    }

    throw new FacebookError(
      'Could not connect to Facebook Graph API.',
      502,
      'GRAPH_API_CONNECTION_FAILED'
    );
  }

  const responseText = await response.text();

  let data = {};

  if (responseText) {
    try {
      data = JSON.parse(responseText);
    } catch {
      throw new FacebookError(
        'Facebook Graph API returned an invalid response.',
        502,
        'GRAPH_API_INVALID_RESPONSE'
      );
    }
  }

  if (!response.ok || data.error) {
    const graphError = data.error || {};

    const message = cleanString(
      graphError.message || `Facebook Graph API returned HTTP ${response.status}.`,
      500
    );

    const status = response.status >= 400 && response.status <= 599
      ? response.status
      : 502;

    const error = new FacebookError(
      message,
      status,
      'GRAPH_API_ERROR'
    );

    error.graphCode = graphError.code || null;
    error.graphSubcode = graphError.error_subcode || null;
    error.graphType = graphError.type || null;
    error.isTransient = graphError.is_transient === true;

    throw error;
  }

  return data;
}

/**
 * Make a request that requires a Facebook access token.
 */
async function authenticatedGraphRequest(path, token, options = {}) {
  const accessToken = cleanString(token, 10000);

  if (!accessToken) {
    throw new FacebookError(
      'Facebook access token is required.',
      401,
      'FACEBOOK_TOKEN_REQUIRED'
    );
  }

  return graphRequest(path, {
    ...options,
    token: accessToken
  });
}

/**
 * Read the authenticated Facebook user.
 */
async function getCurrentUser(userAccessToken) {
  return authenticatedGraphRequest(
    'me',
    userAccessToken,
    {
      params: {
        fields: 'id,name'
      }
    }
  );
}

/**
 * Read Facebook Pages available to the authenticated user.
 */
async function getUserPages(userAccessToken, options = {}) {
  const limit = Math.min(
    Math.max(Number(options.limit) || 100, 1),
    100
  );

  return authenticatedGraphRequest(
    'me/accounts',
    userAccessToken,
    {
      params: {
        fields: 'id,name,category,access_token,tasks',
        limit
      }
    }
  );
}

/**
 * Read a specific Facebook Page.
 */
async function getPageDetails(pageId, pageAccessToken) {
  const id = cleanString(pageId, 50);

  if (!/^\d{5,30}$/.test(id)) {
    throw new FacebookError(
      'Invalid Facebook Page ID.',
      400,
      'INVALID_PAGE_ID'
    );
  }

  return authenticatedGraphRequest(
    id,
    pageAccessToken,
    {
      params: {
        fields: 'id,name,category,picture'
      }
    }
  );
}

module.exports = {
  GRAPH_TIMEOUT,
  getGraphVersion,
  getGraphBaseUrl,
  graphRequest,
  authenticatedGraphRequest,
  getCurrentUser,
  getUserPages,
  getPageDetails
};
