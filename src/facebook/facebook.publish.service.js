'use strict';

const {
  FacebookError,
  cleanString
} = require('./facebook.utils');

const {
  authenticatedGraphRequest
} = require('./facebook.graph');

const MAX_POST_IMAGES = 10;
const MAX_CAPTION_LENGTH = 5000;

// ========================================
// Helpers
// ========================================

function normalizePageId(value) {
  const pageId = cleanString(value, 50);

  if (!/^\d{5,30}$/.test(pageId)) {
    throw new FacebookError(
      'Invalid Facebook Page ID.',
      400,
      'INVALID_PAGE_ID'
    );
  }

  return pageId;
}

function normalizeCaption(value) {
  const caption = String(value ?? '').trim();

  if (!caption) {
    throw new FacebookError(
      'Facebook post caption is required.',
      400,
      'POST_CAPTION_REQUIRED'
    );
  }

  if (caption.length > MAX_CAPTION_LENGTH) {
    throw new FacebookError(
      'Facebook post caption is too long.',
      400,
      'POST_CAPTION_TOO_LONG'
    );
  }

  return caption;
}

function normalizeImageUrl(value) {
  const url = cleanString(value, 2000);

  if (!url) {
    throw new FacebookError(
      'Post image URL is required.',
      400,
      'POST_IMAGE_URL_REQUIRED'
    );
  }

  let parsed;

  try {
    parsed = new URL(url);
  } catch {
    throw new FacebookError(
      'Invalid post image URL.',
      400,
      'INVALID_POST_IMAGE_URL'
    );
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname !== 'res.cloudinary.com' ||
    parsed.username ||
    parsed.password
  ) {
    throw new FacebookError(
      'Only HTTPS Cloudinary image URLs are allowed.',
      400,
      'INVALID_POST_IMAGE_HOST'
    );
  }

  return parsed.toString();
}

/**
 * Accepts:
 * - string URL
 * - { url }
 * - { imageUrl }
 *
 * The first image must always be the main image.
 */
function normalizePostImages(images) {
  if (!Array.isArray(images) || images.length === 0) {
    throw new FacebookError(
      'At least one post image is required.',
      400,
      'POST_IMAGES_REQUIRED'
    );
  }

  const seen = new Set();
  const normalized = [];

  for (const item of images) {
    const rawUrl = typeof item === 'string'
      ? item
      : item?.url || item?.imageUrl;

    const url = normalizeImageUrl(rawUrl);

    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    normalized.push(url);

    if (normalized.length > MAX_POST_IMAGES) {
      throw new FacebookError(
        `A Facebook post can contain at most ${MAX_POST_IMAGES} images.`,
        400,
        'TOO_MANY_POST_IMAGES'
      );
    }
  }

  if (!normalized.length) {
    throw new FacebookError(
      'No valid post images were provided.',
      400,
      'POST_IMAGES_REQUIRED'
    );
  }

  return normalized;
}

function normalizeAccessToken(value) {
  const token = cleanString(value, 10000);

  if (!token) {
    throw new FacebookError(
      'Facebook Page access token is required.',
      401,
      'FACEBOOK_PAGE_TOKEN_REQUIRED'
    );
  }

  return token;
}

// ========================================
// Delete Facebook Published Post
// ========================================

/**
 * Delete a published Facebook Page post.
 *
 * Important:
 * - Only the backend calls this method.
 * - The Page access token must never reach the frontend.
 * - The caller must verify post ownership before calling.
 */
async function deleteFacebookPublishedPost({
  postId,
  pageAccessToken
} = {}) {
  const normalizedPostId = cleanString(
    postId,
    200
  );

  if (
    !normalizedPostId ||
    !/^\d{5,30}_\d{5,40}$/.test(normalizedPostId)
  ) {
    throw new FacebookError(
      'Invalid Facebook post ID.',
      400,
      'INVALID_FACEBOOK_POST_ID'
    );
  }

  const normalizedToken = normalizeAccessToken(
    pageAccessToken
  );

  const result = await authenticatedGraphRequest(
    normalizedPostId,
    normalizedToken,
    {
      method: 'DELETE'
    }
  );

  if (result?.success !== true) {
    throw new FacebookError(
      'Facebook did not confirm post deletion.',
      502,
      'FACEBOOK_POST_DELETE_FAILED'
    );
  }

  return {
    success: true,
    postId: normalizedPostId
  };
}

// ========================================
// Upload unpublished photo
// ========================================

async function uploadUnpublishedPhoto({
  pageId,
  pageAccessToken,
  imageUrl
}) {
  const result = await authenticatedGraphRequest(
    `${pageId}/photos`,
    pageAccessToken,
    {
      method: 'POST',
      params: {
        url: imageUrl,
        published: false
      }
    }
  );

  const photoId = cleanString(result?.id, 100);

  if (!photoId) {
    throw new FacebookError(
      'Facebook did not return an uploaded photo ID.',
      502,
      'FACEBOOK_PHOTO_UPLOAD_FAILED'
    );
  }

  return photoId;
}

// ========================================
// Publish multi-image feed post
// ========================================

async function publishFeedPost({
  pageId,
  pageAccessToken,
  caption,
  photoIds
}) {
  if (!Array.isArray(photoIds) || photoIds.length === 0) {
    throw new FacebookError(
      'No uploaded Facebook photos are available.',
      400,
      'FACEBOOK_PHOTOS_REQUIRED'
    );
  }

  const attachedMedia = photoIds.map(photoId => ({
    media_fbid: photoId
  }));

  return authenticatedGraphRequest(
    `${pageId}/feed`,
    pageAccessToken,
    {
      method: 'POST',
      params: {
        message: caption,
        attached_media: attachedMedia
      }
    }
  );
}

// ========================================
// Main publishing service
// ========================================

/**
 * Publish one Facebook Page post with multiple images.
 *
 * Required arguments:
 * - pageId
 * - pageAccessToken
 * - caption
 * - images
 *
 * Images must be ordered:
 * 1. Main image
 * 2. Variant images
 *
 * No UI labels are added to the caption.
 */
async function publishFacebookProductPost({
  pageId,
  pageAccessToken,
  caption,
  images
} = {}) {
  const normalizedPageId = normalizePageId(pageId);
  const normalizedToken = normalizeAccessToken(pageAccessToken);
  const normalizedCaption = normalizeCaption(caption);
  const normalizedImages = normalizePostImages(images);

  // Step 1: Upload every image as unpublished.
  const photoIds = [];

  for (const imageUrl of normalizedImages) {
    const photoId = await uploadUnpublishedPhoto({
      pageId: normalizedPageId,
      pageAccessToken: normalizedToken,
      imageUrl
    });

    photoIds.push(photoId);
  }

  // Step 2: Publish one feed post containing all uploaded photos.
  const result = await publishFeedPost({
    pageId: normalizedPageId,
    pageAccessToken: normalizedToken,
    caption: normalizedCaption,
    photoIds
  });

  const postId = cleanString(result?.id, 200);

  if (!postId) {
    throw new FacebookError(
      'Facebook did not return a published post ID.',
      502,
      'FACEBOOK_POST_PUBLISH_FAILED'
    );
  }

  return {
    success: true,
    postId,
    pageId: normalizedPageId,
    imageCount: photoIds.length,
    photoIds
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  publishFacebookProductPost,
  deleteFacebookPublishedPost
};