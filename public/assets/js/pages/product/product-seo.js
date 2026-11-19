
'use strict';

// ========================================
// PRODUCT SEO
// Slug, Meta Title & Meta Description
// ========================================

import {
  getProductElement,
  showProductMessage
} from './product-utils.js';


// ========================================
// STATE
// ========================================

let initialized = false;

const LIMITS = {
  slug: 150,
  metaTitle: 60,
  metaDescription: 160
};

const SELECTORS = {
  productName: '#product-name',
  slug: '#product-slug',
  metaTitle: '#product-meta-title',
  metaDescription: '#product-meta-description',
  titleCounter: '#product-meta-title-counter',
  descriptionCounter: '#product-meta-description-counter'
};


// ========================================
// GET ELEMENTS
// ========================================

function getElements() {
  return {
    productName: getProductElement(SELECTORS.productName),
    slug: getProductElement(SELECTORS.slug),
    metaTitle: getProductElement(SELECTORS.metaTitle),
    metaDescription: getProductElement(SELECTORS.metaDescription),
    titleCounter: getProductElement(SELECTORS.titleCounter),
    descriptionCounter: getProductElement(SELECTORS.descriptionCounter)
  };
}


// ========================================
// GENERATE SLUG
// ========================================

export function generateProductSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LIMITS.slug)
    .replace(/-+$/g, '');
}


// ========================================
// UPDATE COUNTERS
// ========================================

function updateCounters() {
  const elements = getElements();

  if (elements.titleCounter && elements.metaTitle) {
    elements.titleCounter.textContent =
      `${elements.metaTitle.value.length} / ${LIMITS.metaTitle}`;
  }

  if (
    elements.descriptionCounter &&
    elements.metaDescription
  ) {
    elements.descriptionCounter.textContent =
      `${elements.metaDescription.value.length} / ${LIMITS.metaDescription}`;
  }
}


// ========================================
// AUTO GENERATE SLUG
// ========================================

function handleProductNameInput() {
  const elements = getElements();

  if (!elements.productName || !elements.slug) {
    return;
  }

  const currentSlug = elements.slug.value.trim();

  // Existing slug থাকলে সেটি overwrite হবে না।
  if (currentSlug) return;

  const generatedSlug = generateProductSlug(
    elements.productName.value
  );

  if (generatedSlug) {
    elements.slug.value = generatedSlug;
  }
}


// ========================================
// GET SEO DATA
// ========================================

export function getProductSEOData() {
  const elements = getElements();

  return {
    slug: elements.slug?.value.trim() || '',
    metaTitle: elements.metaTitle?.value.trim() || '',
    metaDescription:
      elements.metaDescription?.value.trim() || ''
  };
}


// ========================================
// SET SEO DATA
// EDIT PRODUCT / AI GENERATED DATA
// ========================================

export function setProductSEOData(data = {}) {
  if (
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data)
  ) {
    data = {};
  }

  const elements = getElements();

  if (elements.slug) {
    elements.slug.value = String(data.slug ?? '');
  }

  if (elements.metaTitle) {
    elements.metaTitle.value = String(data.metaTitle ?? '');
  }

  if (elements.metaDescription) {
    elements.metaDescription.value =
      String(data.metaDescription ?? '');
  }

  updateCounters();
}


// ========================================
// VALIDATE SLUG
// ========================================

function validateSlug(slug, slugElement) {
  if (!slug) {
    showProductMessage(
      'Product name থেকে slug তৈরি করা যায়নি। English slug লিখুন।',
      'warning'
    );

    getProductElement(SELECTORS.productName)?.focus();

    return false;
  }

  if (slug.length > LIMITS.slug) {
    showProductMessage(
      `Slug সর্বোচ্চ ${LIMITS.slug} অক্ষর হতে পারবে।`,
      'warning'
    );

    slugElement?.focus();

    return false;
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    showProductMessage(
      'Slug-এ শুধু English letter, number ও hyphen ব্যবহার করুন।',
      'warning'
    );

    slugElement?.focus();

    return false;
  }

  return true;
}


// ========================================
// CHECK DUPLICATE SLUG
// ========================================

function validateDuplicateSlug(slug, slugElement) {
  if (!slugElement) return true;

  let existingSlugs = [];

  try {
    const parsed = JSON.parse(
      slugElement.dataset.existingSlugs || '[]'
    );

    if (Array.isArray(parsed)) {
      existingSlugs = parsed;
    }

  } catch (error) {
    console.warn(
      '[PRODUCT SEO] Slug list could not be parsed.',
      error
    );

    return true;
  }

  const currentSlug = String(
    slugElement.dataset.currentSlug || ''
  ).trim().toLowerCase();

  const normalizedSlug = slug.toLowerCase();

  const duplicate = existingSlugs.some(item => {
    const value = String(
      typeof item === 'object' ? item?.slug || '' : item || ''
    ).trim().toLowerCase();

    return (
      value === normalizedSlug &&
      value !== currentSlug
    );
  });

  if (duplicate) {
    showProductMessage(
      'এই Product Slug আগে ব্যবহার করা হয়েছে।',
      'warning'
    );

    slugElement.focus();

    return false;
  }

  return true;
}


// ========================================
// VALIDATE SEO
// ========================================

export function validateProductSEO() {
  const elements = getElements();

  const title = elements.metaTitle?.value.trim() || '';

  const description =
    elements.metaDescription?.value.trim() || '';

  const slug = elements.slug?.value.trim() || '';

  if (title.length > LIMITS.metaTitle) {
    showProductMessage(
      `Meta Title সর্বোচ্চ ${LIMITS.metaTitle} অক্ষর হতে পারবে।`,
      'warning'
    );

    elements.metaTitle?.focus();

    return false;
  }

  if (description.length > LIMITS.metaDescription) {
    showProductMessage(
      `Meta Description সর্বোচ্চ ${LIMITS.metaDescription} অক্ষর হতে পারবে।`,
      'warning'
    );

    elements.metaDescription?.focus();

    return false;
  }

  if (!validateSlug(slug, elements.slug)) {
    return false;
  }

  if (!validateDuplicateSlug(slug, elements.slug)) {
    return false;
  }

  return true;
}


// ========================================
// RESET SEO
// ========================================

export function resetProductSEO() {
  const elements = getElements();

  if (elements.slug) {
    elements.slug.value = '';
  }

  if (elements.metaTitle) {
    elements.metaTitle.value = '';
  }

  if (elements.metaDescription) {
    elements.metaDescription.value = '';
  }

  updateCounters();
}


// ========================================
// BIND SINGLE EVENT
// ========================================

function bindInputEvent(element, callback) {
  if (!element) return;

  if (element.dataset.seoEventsBound === 'true') {
    return;
  }

  element.addEventListener('input', callback);

  element.dataset.seoEventsBound = 'true';
}


// ========================================
// BIND EVENTS
// ========================================

function bindEvents() {
  const elements = getElements();

  bindInputEvent(
    elements.productName,
    handleProductNameInput
  );

  bindInputEvent(
    elements.metaTitle,
    updateCounters
  );

  bindInputEvent(
    elements.metaDescription,
    updateCounters
  );
}


// ========================================
// INITIALIZE
// ========================================

export function initProductSEO({ force = false } = {}) {
  if (initialized && !force) return;

  const elements = getElements();

  if (
    !elements.slug ||
    !elements.metaTitle ||
    !elements.metaDescription
  ) {
    console.warn(
      '[PRODUCT SEO] Required elements not found.'
    );

    return;
  }

  bindEvents();

  updateCounters();

  initialized = true;
}


// ========================================
// DEFAULT EXPORT
// ========================================

export default initProductSEO;
