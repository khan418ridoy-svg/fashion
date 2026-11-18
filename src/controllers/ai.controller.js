
'use strict';

const geminiService = require('../services/ai/gemini.service');

const PRODUCT_TASKS = {
  content: {
    fields: ['shortDescription', 'description'],
    instruction: 'Write concise, natural ecommerce product copy in English. Do not invent measurements, materials or guarantees.'
  },
  seo: {
    fields: ['metaTitle', 'metaDescription', 'tags'],
    instruction: 'Create search-friendly metadata. metaTitle and metaDescription must be English only with no Bangla text. Keep metaTitle within 60 characters and metaDescription within 160 characters. tags must be an array of short strings.'
  },
  attributes: {
    fields: ['fabricType', 'fit', 'sleeveType', 'washCare', 'tags'],
    instruction: 'Suggest only common apparel attribute values that can be safely inferred. Prefer values such as Cotton, Linen, Regular Fit, Slim Fit, Full Sleeve and Short Sleeve.'
  },
  category: {
    fields: ['collection', 'category', 'subcategory'],
    instruction: 'Suggest the closest collection, category and subcategory names from the product facts. Return an empty string when the information is insufficient.'
  }
};

function extractJSONObject(text) {
  const value = String(text || '').trim();

  if (!value) {
    throw new Error('AI returned an empty response.');
  }

  const withoutFence = value
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(withoutFence);
  } catch {
    const start = withoutFence.indexOf('{');
    const end = withoutFence.lastIndexOf('}');

    if (start === -1 || end <= start) {
      throw new Error('AI returned invalid JSON.');
    }

    return JSON.parse(withoutFence.slice(start, end + 1));
  }
}

function sanitizeProductAIResult(task, value) {
  const config = PRODUCT_TASKS[task];
  const result = {};

  for (const field of config.fields) {
    const item = value?.[field];

    if (field === 'tags') {
      const tags = Array.isArray(item)
        ? item
        : String(item || '').split(',');

      result.tags = [...new Set(
        tags
          .map(tag => String(tag).trim())
          .filter(Boolean)
          .slice(0, 12)
      )];
      continue;
    }

    if (
      task === 'seo' &&
      (field === 'metaTitle' || field === 'metaDescription')
    ) {
      const lines = String(item || '')
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);
      const englishLine = lines.find(line => (
        /[a-z]/i.test(line) &&
        !/[\u0980-\u09ff]/u.test(line)
      ));
      const limit = field === 'metaTitle' ? 60 : 160;

      result[field] = String(englishLine || lines.join(' '))
        .replace(/[\u0980-\u09ff]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, limit);
      continue;
    }

    result[field] = String(item || '').trim();
  }

  return result;
}

async function generateProductTask(req, res, next, task) {
  try {
    const config = PRODUCT_TASKS[task];
    const product = req.body?.product;

    if (!product || typeof product !== 'object' || Array.isArray(product)) {
      return res.status(400).json({
        success: false,
        message: 'Product facts are required.'
      });
    }

    const name = String(product.name || '').trim();

    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Product name is required before using AI.'
      });
    }

    const result = await geminiService.generateText({
      systemInstruction: [
        'You are an ecommerce product assistant for a Bangladeshi fashion store.',
        config.instruction,
        'Return only one valid JSON object. Do not use markdown.',
        `The JSON may contain only these keys: ${config.fields.join(', ')}.`
      ].join(' '),
      prompt: `Create the requested product suggestion from these facts:\n${JSON.stringify(product)}`,
      temperature: 0.35,
      maxOutputTokens: 1200
    });

    const data = sanitizeProductAIResult(
      task,
      extractJSONObject(result.text)
    );

    return res.json({
      success: true,
      data,
      model: result.model,
      usage: result.usage || null
    });
  } catch (error) {
    return next(error);
  }
}

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

function productContent(req, res, next) {
  return generateProductTask(req, res, next, 'content');
}

function productSEO(req, res, next) {
  return generateProductTask(req, res, next, 'seo');
}

function productAttributes(req, res, next) {
  return generateProductTask(req, res, next, 'attributes');
}

function productCategory(req, res, next) {
  return generateProductTask(req, res, next, 'category');
}

// ========================================
// Export
// ========================================

module.exports = {
  generate,
  health,
  usage,
  productContent,
  productSEO,
  productAttributes,
  productCategory
};
