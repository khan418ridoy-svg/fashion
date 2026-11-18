
'use strict';

const geminiService = require('../services/ai/gemini.service');

// ========================================
// POST: Generate AI Response
// ========================================
// POST /api/ai/generate

async function generate(req, res, next) {
  try {
    const {
      prompt,
      systemInstruction,
      temperature,
      maxOutputTokens
    } = req.body || {};

    if (
      typeof prompt !== 'string' ||
      !prompt.trim()
    ) {
      return res.status(400).json({
        success: false,
        message: 'A non-empty prompt is required.'
      });
    }

    if (prompt.length > 30000) {
      return res.status(400).json({
        success: false,
        message: 'Prompt is too long. Maximum 30000 characters.'
      });
    }

    if (
      systemInstruction !== undefined &&
      typeof systemInstruction !== 'string'
    ) {
      return res.status(400).json({
        success: false,
        message: 'System instruction must be a string.'
      });
    }

    if (
      temperature !== undefined &&
      (
        typeof temperature !== 'number' ||
        !Number.isFinite(temperature) ||
        temperature < 0 ||
        temperature > 2
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'Temperature must be a number between 0 and 2.'
      });
    }

    if (
      maxOutputTokens !== undefined &&
      (
        !Number.isInteger(maxOutputTokens) ||
        maxOutputTokens < 1 ||
        maxOutputTokens > 8192
      )
    ) {
      return res.status(400).json({
        success: false,
        message: 'maxOutputTokens must be an integer between 1 and 8192.'
      });
    }

    const result = await geminiService.generateText({
      prompt: prompt.trim(),
      systemInstruction,
      temperature,
      maxOutputTokens
    });

    return res.json({
      success: true,
      text: result.text,
      model: result.model,
      usage: result.usage,
      finishReason: result.finishReason
    });

  } catch (error) {
    return next(error);
  }
}

// ========================================
// GET: Gemini Health
// ========================================
// GET /api/ai/health

async function health(req, res, next) {
  try {
    const result = await geminiService.healthCheck();

    return res.status(result.success ? 200 : 503).json(result);

  } catch (error) {
    return next(error);
  }
}

// ========================================
// GET: Gemini Usage Statistics
// ========================================
// GET /api/ai/usage

function usage(req, res) {
  return res.json({
    success: true,
    usage: geminiService.getUsageStats(),
    configuredModels: geminiService.getModels().length,
    configuredKeys: geminiService.getApiKeys().length
  });
}

// ========================================
// Export
// ========================================

module.exports = {
  generate,
  health,
  usage
};
