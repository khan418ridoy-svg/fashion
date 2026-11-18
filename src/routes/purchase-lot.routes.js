'use strict';

const router = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const service = require('../services/inventory/purchase-lot.service');

const asyncHandler = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.use(adminAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, ...(await service.listPurchaseLots()) });
}));

router.post('/', asyncHandler(async (req, res) => {
  const lot = await service.createPurchaseLot(req.body || {}, req.admin);
  res.status(201).json({ success: true, message: 'Purchase Lot created.', lot });
}));

router.get('/:lotId/analytics', asyncHandler(async (req, res) => {
  res.json({ success: true, analytics: await service.getLotAnalytics(req.params.lotId) });
}));

router.post('/:lotId/items', asyncHandler(async (req, res) => {
  const data = await service.addProductStock(req.params.lotId, req.body || {});
  res.status(201).json({ success: true, message: 'Product stock added to the Lot.', data });
}));

router.patch('/:lotId', asyncHandler(async (req, res) => {
  const lot = await service.updatePurchaseLot(req.params.lotId, req.body || {});
  res.json({ success: true, message: 'Purchase Lot updated.', lot });
}));

router.delete('/:lotId', asyncHandler(async (req, res) => {
  const result = await service.deletePurchaseLot(req.params.lotId);
  res.json({ success: true, message: 'Purchase Lot deleted.', ...result });
}));

router.get('/:lotId', asyncHandler(async (req, res) => {
  res.json({ success: true, lot: await service.getPurchaseLot(req.params.lotId) });
}));

module.exports = router;
