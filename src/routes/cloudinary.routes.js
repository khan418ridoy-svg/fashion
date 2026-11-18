'use strict';

const express = require('express');
const adminAuth = require('../middleware/adminAuth');

const router = express.Router();

const CLOUDINARY_API_BASE = 'https://api.cloudinary.com/v1_1';
const MAX_RESULTS = 100;
const REQUEST_TIMEOUT = 15000;

function asyncHandler(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function createError(message, statusCode = 500, code = 'CLOUDINARY_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function cleanCloudName(value) {
  const cloudName = String(value || '').trim();

  return /^[a-zA-Z0-9_-]+$/.test(cloudName)
    ? cloudName
    : '';
}

function getCloudinaryUrlConfig() {
  const value = String(process.env.CLOUDINARY_URL || '').trim();

  if (!value) return {};

  try {
    const url = new URL(value);

    if (url.protocol !== 'cloudinary:') return {};

    return {
      cloudName: cleanCloudName(url.hostname),
      apiKey: decodeURIComponent(url.username || ''),
      apiSecret: decodeURIComponent(url.password || '')
    };
  } catch {
    return {};
  }
}

function getCloudinaryConfig(requestedCloudName) {
  const urlConfig = getCloudinaryUrlConfig();

  const cloudName = cleanCloudName(
    process.env.CLOUDINARY_CLOUD_NAME ||
    urlConfig.cloudName ||
    requestedCloudName
  );

  const apiKey = String(
    process.env.CLOUDINARY_API_KEY ||
    urlConfig.apiKey ||
    ''
  ).trim();

  const apiSecret = String(
    process.env.CLOUDINARY_API_SECRET ||
    urlConfig.apiSecret ||
    ''
  ).trim();

  if (!cloudName || !apiKey || !apiSecret) {
    throw createError(
      'Cloudinary library is not configured.',
      503,
      'CLOUDINARY_NOT_CONFIGURED'
    );
  }

  return { cloudName, apiKey, apiSecret };
}

function normalizeResource(resource = {}) {
  return {
    publicId: String(resource.public_id || ''),
    url: String(resource.secure_url || resource.url || ''),
    width: Number(resource.width || 0),
    height: Number(resource.height || 0),
    format: String(resource.format || ''),
    bytes: Number(resource.bytes || 0),
    createdAt: resource.created_at || null
  };
}

router.use(adminAuth);

router.get('/images', asyncHandler(async (req, res) => {
  const config = getCloudinaryConfig(req.query.cloudName);
  const endpoint = new URL(
    `${CLOUDINARY_API_BASE}/${encodeURIComponent(config.cloudName)}/resources/image/upload`
  );

  endpoint.searchParams.set('max_results', String(MAX_RESULTS));
  endpoint.searchParams.set('direction', 'desc');

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(
        `${config.apiKey}:${config.apiSecret}`
      ).toString('base64')}`
    },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT)
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw createError(
      'Cloudinary returned an invalid response.',
      502,
      'CLOUDINARY_INVALID_RESPONSE'
    );
  }

  if (!response.ok) {
    throw createError(
      result?.error?.message || 'Unable to load Cloudinary images.',
      502,
      'CLOUDINARY_REQUEST_FAILED'
    );
  }

  const images = (Array.isArray(result.resources) ? result.resources : [])
    .map(normalizeResource)
    .filter(image => image.publicId && image.url);

  res.json({
    success: true,
    images
  });
}));

module.exports = router;
