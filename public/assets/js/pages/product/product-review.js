'use strict';

// ========================================
// PRODUCT REVIEW
// Rating Summary & Review Statistics
// ========================================

import {
  getProductElement,
  showProductMessage,
  getProductNumber
} from './product-utils.js';

let initialized = false;

// ========================================
// REVIEW DATA
// ========================================

let reviewData = {
  ratingAvg: 0,
  ratingCount: 0,
  soldCount: 0,
  ratingBreakdown: {
    5: 0,
    4: 0,
    3: 0,
    2: 0,
    1: 0
  }
};

// ========================================
// SELECTORS
// ========================================

const SELECTORS = {
  average: '#product-review-average',
  count: '#product-review-count',
  sold: '#product-review-sold-count',
  breakdown: '#product-review-breakdown',
  container: '#product-review-container'
};

// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    average: getProductElement(SELECTORS.average),
    count: getProductElement(SELECTORS.count),
    sold: getProductElement(SELECTORS.sold),
    breakdown: getProductElement(SELECTORS.breakdown),
    container: getProductElement(SELECTORS.container)
  };
}

// ========================================
// NORMALIZE REVIEW DATA
// ========================================

function normalizeReviewData(data = {}) {
  const source = data.ratingBreakdown || {};

  return {
    ratingAvg: Math.min(
      5,
      Math.max(
        0,
        getProductNumber(data.ratingAvg)
      )
    ),

    ratingCount: Math.max(
      0,
      Math.floor(
        getProductNumber(data.ratingCount)
      )
    ),

    soldCount: Math.max(
      0,
      Math.floor(
        getProductNumber(data.soldCount)
      )
    ),

    ratingBreakdown: {
      5: Math.max(
        0,
        Math.floor(
          getProductNumber(source[5] ?? source['5'])
        )
      ),

      4: Math.max(
        0,
        Math.floor(
          getProductNumber(source[4] ?? source['4'])
        )
      ),

      3: Math.max(
        0,
        Math.floor(
          getProductNumber(source[3] ?? source['3'])
        )
      ),

      2: Math.max(
        0,
        Math.floor(
          getProductNumber(source[2] ?? source['2'])
        )
      ),

      1: Math.max(
        0,
        Math.floor(
          getProductNumber(source[1] ?? source['1'])
        )
      )
    }
  };
}

// ========================================
// RENDER RATING BREAKDOWN
// ========================================

function renderRatingBreakdown() {
  const elements = getElements();

  if (!elements.breakdown) {
    return;
  }

  const breakdown = reviewData.ratingBreakdown;
  const total = reviewData.ratingCount;

  elements.breakdown.replaceChildren();

  [5, 4, 3, 2, 1].forEach(star => {
    const count = breakdown[star] || 0;

    const percentage = total > 0
      ? Math.min(
          100,
          (count / total) * 100
        )
      : 0;

    // Row
    const row = document.createElement('div');
    row.className = 'product-rating-row';

    // Star Label
    const label = document.createElement('span');
    label.className = 'product-rating-label';
    label.textContent = `${star} Star`;

    // Progress Track
    const track = document.createElement('div');
    track.className = 'product-rating-track';

    // Progress Fill
    const fill = document.createElement('div');
    fill.className = 'product-rating-fill';
    fill.style.width = `${percentage}%`;

    track.appendChild(fill);

    // Count
    const value = document.createElement('span');
    value.className = 'product-rating-count';
    value.textContent = String(count);

    // Append
    row.append(
      label,
      track,
      value
    );

    elements.breakdown.appendChild(row);
  });
}

// ========================================
// RENDER REVIEW SUMMARY
// ========================================

export function renderProductReview() {
  const elements = getElements();

  // Average Rating
  if (elements.average) {
    elements.average.textContent =
      reviewData.ratingAvg.toFixed(1);
  }

  // Review Count
  if (elements.count) {
    elements.count.textContent =
      String(reviewData.ratingCount);
  }

  // Sold Count
  if (elements.sold) {
    elements.sold.textContent =
      String(reviewData.soldCount);
  }

  // Rating Breakdown
  renderRatingBreakdown();
}

// ========================================
// GET REVIEW DATA
// ========================================

export function getProductReviewData() {
  return {
    ratingAvg: reviewData.ratingAvg,
    ratingCount: reviewData.ratingCount,
    soldCount: reviewData.soldCount,

    ratingBreakdown: {
      ...reviewData.ratingBreakdown
    }
  };
}

// ========================================
// SET REVIEW DATA
// ========================================

export function setProductReviewData(data = {}) {
  reviewData = normalizeReviewData(data);

  renderProductReview();
}

// ========================================
// VALIDATE REVIEW DATA
// ========================================

export function validateProductReview() {
  const totalBreakdown = Object.values(
    reviewData.ratingBreakdown
  ).reduce(
    (sum, count) => sum + count,
    0
  );

  if (totalBreakdown > reviewData.ratingCount) {
    showProductMessage(
      'Rating Breakdown-এর মোট সংখ্যা Review Count-এর চেয়ে বেশি।',
      'warning'
    );

    return false;
  }

  return true;
}

// ========================================
// RESET REVIEW DATA
// ========================================

export function resetProductReview() {
  reviewData = normalizeReviewData();

  renderProductReview();
}

// ========================================
// INITIALIZE
// ========================================

export function initProductReview({ force = false } = {}) {
  if (initialized && !force) {
    return;
  }

  const elements = getElements();

  if (!elements.container) {
    console.warn(
      '[PRODUCT REVIEW] Container not found.'
    );

    return;
  }

  renderProductReview();

  initialized = true;

  console.info(
    '[PRODUCT REVIEW] Initialized.'
  );
}

// ========================================
// DEFAULT EXPORT
// ========================================

export default initProductReview;
