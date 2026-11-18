'use strict';

const router = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const couponService = require('../services/coupon.service');

const asyncHandler = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

// Public website/local-customer endpoints.
router.post('/verify', asyncHandler(async (req, res) => {
  res.json({ success: true, result: await couponService.verifyCoupon(req.body || {}) });
}));

router.post('/collect', asyncHandler(async (req, res) => {
  res.json({ success: true, result: await couponService.collectCoupon(req.body || {}) });
}));

router.use(adminAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, coupons: await couponService.listCoupons() });
}));

router.post('/', asyncHandler(async (req, res) => {
  const coupon = await couponService.createCoupon(req.body || {}, req.admin);
  res.status(201).json({ success: true, message: 'Coupon created.', coupon });
}));

router.patch('/:couponId', asyncHandler(async (req, res) => {
  const coupon = await couponService.updateCoupon(req.params.couponId, req.body || {});
  res.json({ success: true, message: 'Coupon updated.', coupon });
}));

module.exports = router;
