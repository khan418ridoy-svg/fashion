'use strict';

const { db, auth } = require('../config/firebase');
const { ProductError, cleanString } = require('./product/product-utils');

const SETTINGS_REF = db.collection('appSettings').doc('store');

function error(message, statusCode = 400, code = 'SETTINGS_ERROR') {
  return new ProductError(message, statusCode, code);
}

function amount(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) {
    throw error(`${label} must be a non-negative number.`);
  }
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function normalizeDelivery(value = {}) {
  const districtCharges = Array.isArray(value.districtCharges)
    ? value.districtCharges.slice(0, 64).map(item => {
        const district = cleanString(item?.district, 80);
        if (!district) throw error('District name is required.');
        return { district, charge: amount(item.charge, `${district} delivery charge`) };
      })
    : [];

  const seen = new Set();
  for (const item of districtCharges) {
    const key = item.district.toLowerCase();
    if (seen.has(key)) throw error(`Duplicate district: ${item.district}`);
    seen.add(key);
  }

  return {
    defaultCharge: amount(value.defaultCharge, 'Default delivery charge'),
    districtCharges
  };
}

function normalizeDiscounts(value) {
  if (!Array.isArray(value)) return [];

  return value.slice(0, 50).map((item, index) => {
    const minimumPurchase = amount(item?.minimumPurchase, `Rule ${index + 1} minimum purchase`);
    const discountPercent = Number(item?.discountPercent);
    const maxDiscount = amount(item?.maxDiscount, `Rule ${index + 1} maximum discount`);

    if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
      throw error(`Rule ${index + 1} discount must be between 0 and 100.`);
    }

    return {
      id: cleanString(item.id, 80) || `discount-${Date.now()}-${index}`,
      minimumPurchase,
      discountPercent: Math.round(discountPercent * 100) / 100,
      maxDiscount,
      active: item.active !== false
    };
  });
}

async function getSettings() {
  const snapshot = await SETTINGS_REF.get();
  const value = snapshot.exists ? snapshot.data() || {} : {};

  return {
    delivery: {
      defaultCharge: Number(value.delivery?.defaultCharge || 0),
      districtCharges: Array.isArray(value.delivery?.districtCharges)
        ? value.delivery.districtCharges
        : []
    },
    purchaseDiscounts: Array.isArray(value.purchaseDiscounts)
      ? value.purchaseDiscounts
      : [],
    updatedAt: value.updatedAt || null
  };
}

async function updateSettings(payload = {}, admin = {}) {
  const document = {
    delivery: normalizeDelivery(payload.delivery || {}),
    purchaseDiscounts: normalizeDiscounts(payload.purchaseDiscounts),
    updatedBy: admin.uid || null,
    updatedAt: new Date()
  };

  await SETTINGS_REF.set(document, { merge: true });
  return document;
}

async function changePassword(uid, payload = {}) {
  const password = String(payload.password || '');
  const confirmPassword = String(payload.confirmPassword || '');

  if (password.length < 8 || password.length > 128) {
    throw error('Password must contain 8 to 128 characters.');
  }

  if (password !== confirmPassword) {
    throw error('Password confirmation does not match.');
  }

  await auth.updateUser(uid, { password });
  return { changed: true };
}

module.exports = { getSettings, updateSettings, changePassword };
