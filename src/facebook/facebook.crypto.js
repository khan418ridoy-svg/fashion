
'use strict';

const crypto = require('crypto');

const {
  requireEnv,
  FacebookError,
  isPlainObject
} = require('./facebook.utils');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const ENCRYPTION_VERSION = 1;

/**
 * Read and validate the 32-byte encryption key.
 *
 * Environment variable:
 * FACEBOOK_TOKEN_ENCRYPTION_KEY
 *
 * Expected format: 64 hexadecimal characters.
 */
function getEncryptionKey() {
  const value = requireEnv('FACEBOOK_TOKEN_ENCRYPTION_KEY');

  if (!/^[a-f0-9]{64}$/i.test(value)) {
    throw new FacebookError(
      'FACEBOOK_TOKEN_ENCRYPTION_KEY must contain exactly 64 hexadecimal characters.',
      503,
      'INVALID_ENCRYPTION_KEY'
    );
  }

  return Buffer.from(value, 'hex');
}

/**
 * Encrypt a Facebook access token.
 *
 * Returns a Firestore-safe object.
 */
function encryptToken(token) {
  if (typeof token !== 'string' || !token.trim()) {
    throw new FacebookError(
      'A valid token is required for encryption.',
      400,
      'INVALID_TOKEN'
    );
  }

  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(token.trim(), 'utf8'),
    cipher.final()
  ]);

  const authTag = cipher.getAuthTag();

  return {
    version: ENCRYPTION_VERSION,
    algorithm: ALGORITHM,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64')
  };
}

/**
 * Decrypt a previously encrypted Facebook access token.
 */
function decryptToken(encryptedData) {
  if (!isPlainObject(encryptedData)) {
    throw new FacebookError(
      'Invalid encrypted token data.',
      400,
      'INVALID_ENCRYPTED_TOKEN'
    );
  }

  if (
    encryptedData.version !== ENCRYPTION_VERSION ||
    encryptedData.algorithm !== ALGORITHM
  ) {
    throw new FacebookError(
      'Unsupported encrypted token format.',
      400,
      'UNSUPPORTED_ENCRYPTION_VERSION'
    );
  }

  const { iv, authTag, ciphertext } = encryptedData;

  if (
    typeof iv !== 'string' ||
    typeof authTag !== 'string' ||
    typeof ciphertext !== 'string'
  ) {
    throw new FacebookError(
      'Encrypted token data is incomplete.',
      400,
      'INVALID_ENCRYPTED_TOKEN'
    );
  }

  let ivBuffer;
  let authTagBuffer;
  let encryptedBuffer;

  try {
    ivBuffer = Buffer.from(iv, 'base64');
    authTagBuffer = Buffer.from(authTag, 'base64');
    encryptedBuffer = Buffer.from(ciphertext, 'base64');
  } catch {
    throw new FacebookError(
      'Encrypted token data is malformed.',
      400,
      'INVALID_ENCRYPTED_TOKEN'
    );
  }

  if (
    ivBuffer.length !== IV_LENGTH ||
    authTagBuffer.length !== AUTH_TAG_LENGTH ||
    !ciphertext
  ) {
    throw new FacebookError(
      'Encrypted token data has invalid lengths.',
      400,
      'INVALID_ENCRYPTED_TOKEN'
    );
  }

  try {
    const key = getEncryptionKey();

    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      ivBuffer
    );

    decipher.setAuthTag(authTagBuffer);

    const decrypted = Buffer.concat([
      decipher.update(encryptedBuffer),
      decipher.final()
    ]);

    const token = decrypted.toString('utf8');

    if (!token.trim()) {
      throw new Error('Decrypted token is empty.');
    }

    return token;
  } catch (error) {
    if (error instanceof FacebookError) {
      throw error;
    }

    throw new FacebookError(
      'Token decryption failed. Check the encryption key and stored data.',
      500,
      'TOKEN_DECRYPTION_FAILED'
    );
  }
}

/**
 * Check whether a value has our encrypted token structure.
 */
function isEncryptedToken(value) {
  return (
    isPlainObject(value) &&
    value.version === ENCRYPTION_VERSION &&
    value.algorithm === ALGORITHM &&
    typeof value.iv === 'string' &&
    typeof value.authTag === 'string' &&
    typeof value.ciphertext === 'string'
  );
}

module.exports = {
  encryptToken,
  decryptToken,
  isEncryptedToken
};
