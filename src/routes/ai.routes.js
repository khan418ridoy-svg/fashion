
'use strict';

const express = require('express');

const router = express.Router();

const adminAuth = require('../middleware/adminAuth');
const aiController = require('../controllers/ai.controller');

// ========================================
// Authentication
// ========================================

// All AI routes require admin authentication.
router.use(adminAuth);

// ========================================
// POST: Generate AI Response
// ========================================

// POST /api/ai/generate

router.post('/generate', aiController.generate);

router.post('/product-content', aiController.productContent);
router.post('/product-seo', aiController.productSEO);
router.post('/product-attributes', aiController.productAttributes);
router.post('/product-category', aiController.productCategory);

// ========================================
// GET: Gemini Health Check
// ========================================

// GET /api/ai/health

router.get('/health', aiController.health);

// ========================================
// GET: Gemini Usage Statistics
// ========================================

// GET /api/ai/usage

router.get('/usage', aiController.usage);

// ========================================
// Export
// ========================================

module.exports = router;
