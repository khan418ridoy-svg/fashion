
'use strict';

const crypto = require('crypto');

/**
 * Convert a value to a trimmed string.
 */
function cleanString(value, maxLength = 500) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value)
    .trim()
    .slice(0, maxLength);
}

/**
 * Check whether a value is a plain object.
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * Compare two strings without ordinary early-exit comparison.
 */
function timingSafeEqualText(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');

  if (bufferA.length !== bufferB.length) {
    return false;
  }

  return crypto.timingSafeEqual(bufferA, bufferB);
}

/**
 * Validate required environment variables.
 */
function requireEnv(name) {
  const value = cleanString(process.env[name]);

  if (!value) {
    const error = new Error(`${name} is not configured.`);
    error.status = 503;
    throw error;
  }

  return value;
}

/**
 * Create a consistent Facebook module error.
 */
class FacebookError extends Error {
  constructor(message, status = 500, code = 'FACEBOOK_ERROR') {
    super(message);

    this.name = 'FacebookError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Validate a Facebook Page ID.
 */
function isValidPageId(value) {
  const pageId = cleanString(value, 50);

  return /^\d{5,30}$/.test(pageId);
}

module.exports = {
  cleanString,
  isPlainObject,
  timingSafeEqualText,
  requireEnv,
  FacebookError,
  isValidPageId
};
