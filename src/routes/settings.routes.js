'use strict';

const router = require('express').Router();
const adminAuth = require('../middleware/adminAuth');
const settingsService = require('../services/settings.service');

const asyncHandler = handler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

router.use(adminAuth);

router.get('/', asyncHandler(async (req, res) => {
  res.json({ success: true, settings: await settingsService.getSettings() });
}));

router.put('/', asyncHandler(async (req, res) => {
  const settings = await settingsService.updateSettings(req.body || {}, req.admin);
  res.json({ success: true, message: 'Settings saved.', settings });
}));

router.post('/password', asyncHandler(async (req, res) => {
  await settingsService.changePassword(req.admin.uid, req.body || {});
  res.json({ success: true, message: 'Password changed successfully.' });
}));

module.exports = router;
