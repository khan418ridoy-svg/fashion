'use strict';

const crypto = require('crypto');
const { db } = require('../config/firebase');
const { ProductError, cleanString } = require('./product/product-utils');

const COUPONS = 'coupons';
const CODE_INDEX = 'couponCodes';
const CLAIMS = 'couponClaims';

function error(message, statusCode = 400, code = 'COUPON_ERROR') {
  return new ProductError(message, statusCode, code);
}

function code(value) {
  const result = cleanString(value, 40)
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, '');

  if (!result || result.length < 4) throw error('A valid Coupon Code is required.');
  return result;
}

function createCode() {
  return `NF-${crypto.randomInt(10000, 99999)}`;
}

function phone(value, required = false) {
  let result = cleanString(value, 30).replace(/[^\d+]/g, '');
  if (result.startsWith('+880')) result = `0${result.slice(4)}`;
  if (result.startsWith('880')) result = `0${result.slice(3)}`;

  if (!result && !required) return '';
  if (!/^01\d{9}$/.test(result)) throw error('A valid Bangladesh mobile number is required.');
  return result;
}

function amount(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw error(`${label} is invalid.`);
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function integer(value, label, fallback = 0) {
  const number = value === '' || value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw error(`${label} must be a non-negative integer.`);
  return number;
}

function date(value, label, fallback = null) {
  if (!value) return fallback;
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) throw error(`${label} is invalid.`);
  return result;
}

function normalizeCoupon(payload = {}, existing = null) {
  const type = String(payload.type || existing?.type || 'website').toLowerCase();
  if (!['offline', 'website'].includes(type)) throw error('Coupon type must be offline or website.');

  const discountPercent = Number(payload.discountPercent ?? existing?.discountPercent);
  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
    throw error('Discount must be between 0 and 100 percent.');
  }

  const startAt = date(payload.startAt, 'Start date', existing?.startAt || new Date());
  const validityDays = integer(payload.validityDays, 'Validity days', 0);
  const expiresAt = date(
    payload.expiresAt,
    'Expiry date',
    existing?.expiresAt || (validityDays > 0
      ? new Date(startAt.getTime() + validityDays * 86400000)
      : null)
  );

  if (expiresAt && expiresAt <= startAt) throw error('Expiry must be after the start date.');

  const quantity = integer(payload.quantity, 'Coupon quantity', existing?.quantity || 0);
  const collectedCount = integer(
    payload.collectedCount,
    'Collected count',
    existing?.collectedCount || 0
  );

  if (quantity > 0 && collectedCount > quantity) {
    throw error('Collected count cannot exceed Coupon quantity.');
  }

  return {
    type,
    code: code(payload.code || existing?.code || createCode()),
    phone: phone(payload.phone ?? existing?.phone, type === 'offline'),
    discountPercent: Math.round(discountPercent * 100) / 100,
    minimumPurchase: amount(payload.minimumPurchase ?? existing?.minimumPurchase, 'Minimum purchase'),
    maxDiscount: amount(payload.maxDiscount ?? existing?.maxDiscount, 'Maximum discount'),
    quantity,
    collectedCount,
    startAt,
    expiresAt,
    active: payload.active === undefined ? existing?.active !== false : payload.active === true,
    title: cleanString(payload.title ?? existing?.title, 120),
    note: cleanString(payload.note ?? existing?.note, 500)
  };
}

function indexId(couponCode) {
  return couponCode.toLowerCase();
}

function validateAvailability(coupon, purchaseAmount = 0) {
  const now = Date.now();
  const starts = coupon.startAt?.toMillis?.() || coupon.startAt?.getTime?.() || new Date(coupon.startAt).getTime();
  const expires = coupon.expiresAt
    ? coupon.expiresAt?.toMillis?.() || coupon.expiresAt?.getTime?.() || new Date(coupon.expiresAt).getTime()
    : null;

  if (coupon.active === false) throw error('Coupon is inactive.', 409, 'COUPON_INACTIVE');
  if (starts && starts > now) throw error('Coupon has not started yet.', 409, 'COUPON_NOT_STARTED');
  if (expires && expires <= now) throw error('Coupon has expired.', 409, 'COUPON_EXPIRED');
  if (coupon.quantity > 0 && coupon.collectedCount >= coupon.quantity) {
    throw error('Coupon quantity is exhausted.', 409, 'COUPON_EXHAUSTED');
  }
  if (purchaseAmount && purchaseAmount < Number(coupon.minimumPurchase || 0)) {
    throw error(`Minimum purchase is ${coupon.minimumPurchase}.`, 409, 'MINIMUM_PURCHASE_NOT_MET');
  }
}

function discountFor(coupon, purchaseAmount) {
  const raw = amount(purchaseAmount, 'Purchase amount') * Number(coupon.discountPercent || 0) / 100;
  const cap = Number(coupon.maxDiscount || 0);
  return Math.round((cap > 0 ? Math.min(raw, cap) : raw) * 100) / 100;
}

async function createCoupon(payload = {}, admin = {}) {
  const input = normalizeCoupon(payload);
  const ref = db.collection(COUPONS).doc();
  const indexRef = db.collection(CODE_INDEX).doc(indexId(input.code));

  return db.runTransaction(async transaction => {
    const indexSnapshot = await transaction.get(indexRef);
    if (indexSnapshot.exists) throw error('Coupon Code already exists.', 409, 'DUPLICATE_COUPON');

    const now = new Date();
    const document = {
      id: ref.id,
      ...input,
      createdBy: admin.uid || null,
      createdAt: now,
      updatedAt: now
    };

    transaction.create(ref, document);
    transaction.create(indexRef, { couponId: ref.id, code: input.code, createdAt: now });
    return document;
  });
}

async function listCoupons() {
  const snapshot = await db.collection(COUPONS).orderBy('createdAt', 'desc').limit(200).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateCoupon(couponId, payload = {}) {
  const ref = db.collection(COUPONS).doc(cleanString(couponId, 128));
  return db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    if (!snapshot.exists) throw error('Coupon not found.', 404, 'COUPON_NOT_FOUND');

    const existing = snapshot.data() || {};
    if (payload.code && code(payload.code) !== existing.code) {
      throw error('Coupon Code cannot be changed after creation.');
    }

    const update = { ...normalizeCoupon(payload, existing), updatedAt: new Date() };
    transaction.update(ref, update);
    return { id: ref.id, ...existing, ...update };
  });
}

async function getCouponByCode(rawCode) {
  const couponCode = code(rawCode);
  const indexSnapshot = await db.collection(CODE_INDEX).doc(indexId(couponCode)).get();
  if (!indexSnapshot.exists) throw error('Coupon not found.', 404, 'COUPON_NOT_FOUND');

  const couponSnapshot = await db.collection(COUPONS).doc(indexSnapshot.data().couponId).get();
  if (!couponSnapshot.exists) throw error('Coupon not found.', 404, 'COUPON_NOT_FOUND');
  return { id: couponSnapshot.id, ...couponSnapshot.data() };
}

async function verifyCoupon(payload = {}) {
  const coupon = await getCouponByCode(payload.code);
  const purchaseAmount = amount(payload.purchaseAmount, 'Purchase amount');

  if (coupon.type === 'offline' && phone(payload.phone, true) !== coupon.phone) {
    throw error('Coupon Code and mobile number do not match.', 403, 'COUPON_PHONE_MISMATCH');
  }

  validateAvailability(coupon, purchaseAmount);
  return {
    valid: true,
    couponId: coupon.id,
    code: coupon.code,
    type: coupon.type,
    discountPercent: coupon.discountPercent,
    minimumPurchase: coupon.minimumPurchase,
    maxDiscount: coupon.maxDiscount,
    discountAmount: discountFor(coupon, purchaseAmount),
    collectedCount: coupon.collectedCount,
    quantity: coupon.quantity,
    expiresAt: coupon.expiresAt || null
  };
}

async function collectCoupon(payload = {}) {
  const couponCode = code(payload.code);
  const claimant = cleanString(payload.collector || payload.userId || payload.phone, 128)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');

  if (!claimant) throw error('A collector phone, user ID or email is required.');

  const indexRef = db.collection(CODE_INDEX).doc(indexId(couponCode));

  return db.runTransaction(async transaction => {
    const indexSnapshot = await transaction.get(indexRef);
    if (!indexSnapshot.exists) throw error('Coupon not found.', 404, 'COUPON_NOT_FOUND');

    const couponRef = db.collection(COUPONS).doc(indexSnapshot.data().couponId);
    const claimRef = db.collection(CLAIMS).doc(`${couponRef.id}_${claimant}`);
    const [couponSnapshot, claimSnapshot] = await Promise.all([
      transaction.get(couponRef),
      transaction.get(claimRef)
    ]);

    if (!couponSnapshot.exists) throw error('Coupon not found.', 404, 'COUPON_NOT_FOUND');
    if (claimSnapshot.exists) {
      return { alreadyCollected: true, claim: claimSnapshot.data(), coupon: couponSnapshot.data() };
    }

    const coupon = couponSnapshot.data() || {};
    validateAvailability(coupon);

    if (coupon.type === 'offline') {
      const suppliedPhone = phone(payload.phone || payload.collector, true);
      if (suppliedPhone !== coupon.phone) {
        throw error('Coupon Code and mobile number do not match.', 403, 'COUPON_PHONE_MISMATCH');
      }
    }

    const now = new Date();
    const collectedCount = Number(coupon.collectedCount || 0) + 1;
    const claim = { couponId: couponRef.id, code: coupon.code, claimant, collectedAt: now };

    transaction.create(claimRef, claim);
    transaction.update(couponRef, { collectedCount, updatedAt: now });

    return {
      alreadyCollected: false,
      claim,
      coupon: { ...coupon, collectedCount }
    };
  });
}

module.exports = {
  createCoupon,
  listCoupons,
  updateCoupon,
  verifyCoupon,
  collectCoupon
};
