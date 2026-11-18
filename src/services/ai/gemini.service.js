
'use strict';

require('dotenv').config();

// ======================================================
// GEMINI CONFIGURATION
// ======================================================

const API_BASE_URL =
  'https://generativelanguage.googleapis.com/v1beta/models';

const DEFAULT_TIMEOUT = 45000;
const DEFAULT_TEMPERATURE = 0.7;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

const BANGLA_FIRST_PRODUCT_INSTRUCTION = [
  'For every customer-facing product text value, write natural Bangla first and English second.',
  'Use this order inside each value: বাংলা text, then a blank line, then English text.',
  'Never place English before Bangla.',
  'This bilingual rule overrides any earlier instruction to write only in English.',
  'Exception: metaTitle and metaDescription must contain English only, with no Bangla text.',
  'Keep JSON keys, IDs, SKUs, slugs, numeric values and taxonomy option values machine-readable and untranslated.',
  'Any stated field-length limit applies to the combined Bangla and English value.'
].join(' ');

const MODEL_CACHE_TTL = Math.max(
  60000,
  Number(process.env.GEMINI_MODEL_CACHE_TTL || 21600000)
);

// ======================================================
// MODEL CACHE
// ======================================================

let modelCache = {
  models: [],
  expiresAt: 0
};

let modelDiscoveryPromise = null;

// ======================================================
// USAGE STATISTICS
// ======================================================

const usage = {
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  fallbackAttempts: 0,
  totalInputTokens: 0,
  totalOutputTokens: 0,
  lastModel: null,
  lastError: null,
  lastSuccessAt: null
};

function getUsageStats() {
  return { ...usage };
}

function resetUsageStats() {
  for (const key of Object.keys(usage)) {
    usage[key] = typeof usage[key] === 'number' ? 0 : null;
  }

  return getUsageStats();
}

// ======================================================
// API KEY MANAGEMENT
// ======================================================

function getApiKeys() {
  const keys = [];

  for (let i = 1; i <= 5; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];

    if (key && key.trim()) {
      keys.push(key.trim());
    }
  }

  if (process.env.GEMINI_API_KEYS) {
    keys.push(
      ...process.env.GEMINI_API_KEYS
        .split(',')
        .map(key => key.trim())
        .filter(Boolean)
    );
  }

  if (process.env.GEMINI_API_KEY) {
    keys.push(process.env.GEMINI_API_KEY.trim());
  }

  return [...new Set(keys.filter(Boolean))];
}

// ======================================================
// MANUAL MODEL CONFIGURATION
// ======================================================

function getConfiguredModels() {
  return [
    ...new Set(
      (process.env.GEMINI_MODELS || '')
        .split(',')
        .map(model => model.trim())
        .filter(Boolean)
        .map(normalizeModelName)
        .filter(Boolean)
    )
  ];
}

function getModels() {
  if (modelCache.models.length) {
    return [...modelCache.models];
  }

  return getConfiguredModels();
}

// ======================================================
// ERROR CLASS
// ======================================================

class GeminiError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'GeminiError';
    this.status = options.status ?? 0;
    this.model = options.model || null;
    this.retryable = options.retryable ?? false;
    this.finishReason = options.finishReason || null;
    this.promptFeedback = options.promptFeedback || null;
    this.details = options.details || null;
  }
}

function isRetryableStatus(status) {
  return (
    status === 0 ||
    status === 408 ||
    status === 429 ||
    status === 500 ||
    status === 502 ||
    status === 503 ||
    status === 504
  );
}

// ======================================================
// SYSTEM INSTRUCTION
// ======================================================

function getSystemInstruction(options, prompt) {
  const instruction = String(options.systemInstruction || '').trim();
  const context = `${instruction}\n${prompt}`;

  if (!/(?:ecommerce|product|fashion|seo|metadata|taxonomy|attribute)/i.test(context)) {
    return instruction || null;
  }

  return [instruction, BANGLA_FIRST_PRODUCT_INSTRUCTION]
    .filter(Boolean)
    .join('\n\n');
}

// ======================================================
// MODEL NORMALIZATION
// ======================================================

function normalizeModelName(name) {
  if (typeof name !== 'string') {
    return null;
  }

  return name
    .replace(/^models\//, '')
    .trim();
}

// ======================================================
// MODEL DISCOVERY
// ======================================================

async function fetchAvailableModels(apiKey, timeout) {
  let pageToken = '';
  const discovered = new Set();

  for (let page = 0; page < 100; page++) {
    const url = new URL(API_BASE_URL);

    url.searchParams.set('pageSize', '1000');

    if (pageToken) {
      url.searchParams.set('pageToken', pageToken);
    }

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey,
        Accept: 'application/json'
      },
      signal: AbortSignal.timeout(timeout)
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new GeminiError(
        'Gemini Models API returned invalid JSON.',
        {
          status: response.status,
          retryable: isRetryableStatus(response.status)
        }
      );
    }

    if (!response.ok) {
      throw new GeminiError(
        data?.error?.message || 'Unable to fetch Gemini models.',
        {
          status: response.status,
          retryable: isRetryableStatus(response.status),
          details: data?.error || data
        }
      );
    }

    const models = Array.isArray(data.models)
      ? data.models
      : [];

    for (const item of models) {
      const name = normalizeModelName(item.name);

      const methods = Array.isArray(item.supportedGenerationMethods)
        ? item.supportedGenerationMethods
        : [];

      if (name && methods.includes('generateContent')) {
        discovered.add(name);
      }
    }

    pageToken = data.nextPageToken || '';

    if (!pageToken) {
      break;
    }
  }

  return [...discovered];
}

// ======================================================
// DISCOVER MODELS FROM ALL KEYS
// ======================================================

async function discoverModels(options = {}) {
  const apiKeys = getApiKeys();

  if (!apiKeys.length) {
    throw new GeminiError('No Gemini API keys configured.');
  }

  const timeout =
    options.timeout ??
    Number(process.env.GEMINI_TIMEOUT || DEFAULT_TIMEOUT);

  const configuredModels = getConfiguredModels();

  // Cache check
  if (
    modelCache.models.length &&
    Date.now() < modelCache.expiresAt
  ) {
    return [...modelCache.models];
  }

  // Prevent simultaneous discovery calls
  if (modelDiscoveryPromise) {
    return modelDiscoveryPromise;
  }

  modelDiscoveryPromise = (async () => {
    const discovered = new Set();
    const discoveryErrors = [];

    // Discover models using EVERY API key.
    for (let i = 0; i < apiKeys.length; i++) {
      try {
        console.log('[Gemini Models] Discovering:', {
          keyNumber: i + 1
        });

        const keyModels = await fetchAvailableModels(
          apiKeys[i],
          timeout
        );

        for (const model of keyModels) {
          discovered.add(model);
        }

        console.log('[Gemini Models] Key result:', {
          keyNumber: i + 1,
          modelCount: keyModels.length
        });

      } catch (error) {
        discoveryErrors.push({
          keyNumber: i + 1,
          status: error.status || 0,
          message: error.message
        });

        console.error('[Gemini Models] Key discovery failed:', {
          keyNumber: i + 1,
          status: error.status || 0,
          message: error.message
        });
      }
    }

    // Configured models are always prioritized.
    const combined = [
      ...new Set([
        ...configuredModels,
        ...discovered
      ])
    ];

    if (combined.length) {
      modelCache = {
        models: combined,
        expiresAt: Date.now() + MODEL_CACHE_TTL
      };

      console.log('[Gemini Models] Final list:', {
        total: combined.length,
        configured: configuredModels.length,
        discovered: discovered.size,
        discoveryErrors: discoveryErrors.length
      });

      return [...combined];
    }

    throw new GeminiError(
      'Unable to discover Gemini models from any API key.',
      {
        details: {
          discoveryErrors,
          configuredModels
        }
      }
    );
  })();

  try {
    return await modelDiscoveryPromise;
  } finally {
    modelDiscoveryPromise = null;
  }
}

// ======================================================
// RESPONSE PARSER
// ======================================================

function extractResponse(data) {
  const candidates = Array.isArray(data?.candidates)
    ? data.candidates
    : [];

  const candidateTexts = [];
  const finishReasons = [];

  for (const candidate of candidates) {
    if (candidate.finishReason) {
      finishReasons.push(candidate.finishReason);
    }

    const parts = candidate?.content?.parts || [];

    for (const part of parts) {
      if (
        typeof part.text === 'string' &&
        part.text.trim()
      ) {
        candidateTexts.push(part.text);
      }
    }
  }

  return {
    text: candidateTexts.join('\n').trim(),
    finishReason: finishReasons[0] || null,
    promptFeedback: data?.promptFeedback || null,
    candidateCount: candidates.length,
    usage: data?.usageMetadata || null
  };
}

// ======================================================
// GEMINI API CLIENT
// ======================================================

async function callGemini({
  apiKey,
  model,
  contents,
  systemInstruction,
  temperature,
  maxOutputTokens,
  timeout
}) {
  const endpoint =
    `${API_BASE_URL}/${encodeURIComponent(model)}:generateContent`;

  const body = {
    contents,
    generationConfig: {
      temperature,
      maxOutputTokens
    }
  };

  if (systemInstruction) {
    body.systemInstruction = {
      parts: [{ text: systemInstruction }]
    };
  }

  let response;

  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });

  } catch (error) {
    throw new GeminiError(
      `Gemini network/timeout error: ${error.message}`,
      {
        status: 0,
        model,
        retryable: true,
        details: {
          errorName: error.name
        }
      }
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new GeminiError(
      'Gemini returned invalid JSON.',
      {
        status: response.status,
        model,
        retryable: isRetryableStatus(response.status)
      }
    );
  }

  if (!response.ok) {
    throw new GeminiError(
      data?.error?.message ||
      `Gemini HTTP ${response.status}`,
      {
        status: response.status,
        model,
        retryable: isRetryableStatus(response.status),
        details: data?.error || data
      }
    );
  }

  const parsed = extractResponse(data);

  if (!parsed.text) {
    throw new GeminiError(
      'Gemini returned HTTP 200 but no usable text.',
      {
        status: response.status,
        model,
        retryable: true,
        finishReason: parsed.finishReason,
        promptFeedback: parsed.promptFeedback,
        details: {
          candidateCount: parsed.candidateCount
        }
      }
    );
  }

  return {
    success: true,
    text: parsed.text,
    model,
    httpStatus: response.status,
    finishReason: parsed.finishReason,
    promptFeedback: parsed.promptFeedback,
    usage: parsed.usage
  };
}

// ======================================================
// FALLBACK SERVICE
// ======================================================

async function generateText(options = {}) {
  const apiKeys = getApiKeys();

  if (!apiKeys.length) {
    throw new GeminiError('No Gemini API keys configured.');
  }

  const prompt = options.prompt;

  if (
    typeof prompt !== 'string' ||
    !prompt.trim()
  ) {
    throw new GeminiError('A non-empty prompt is required.');
  }

  const timeout =
    options.timeout ??
    Number(process.env.GEMINI_TIMEOUT || DEFAULT_TIMEOUT);

  const models = await discoverModels({ timeout });

  if (!models.length) {
    throw new GeminiError('No Gemini models available.');
  }

  const contents = options.contents || [
    {
      role: 'user',
      parts: [{ text: prompt.trim() }]
    }
  ];

  const temperature =
    options.temperature ??
    Number(process.env.GEMINI_TEMPERATURE || DEFAULT_TEMPERATURE);

  const maxOutputTokens =
    options.maxOutputTokens ??
    Number(
      process.env.GEMINI_MAX_OUTPUT_TOKENS ||
      DEFAULT_MAX_OUTPUT_TOKENS
    );

  const systemInstruction = getSystemInstruction(
    options,
    prompt
  );

  usage.totalRequests++;

  const errors = [];
  const totalAttempts = models.length * apiKeys.length;
  let attemptNumber = 0;

  // Model priority first, then API key fallback.
  for (const model of models) {
    for (let keyIndex = 0; keyIndex < apiKeys.length; keyIndex++) {
      attemptNumber++;

      const apiKey = apiKeys[keyIndex];
      const startedAt = Date.now();

      try {
        console.log('[Gemini Attempt]', {
          attempt: attemptNumber,
          total: totalAttempts,
          model,
          keyNumber: keyIndex + 1
        });

        const result = await callGemini({
          apiKey,
          model,
          contents,
          systemInstruction,
          temperature,
          maxOutputTokens,
          timeout
        });

        usage.successfulRequests++;
        usage.lastModel = model;
        usage.lastSuccessAt = new Date().toISOString();
        usage.lastError = null;

        if (result.usage) {
          usage.totalInputTokens +=
            Number(result.usage.promptTokenCount || 0);

          usage.totalOutputTokens +=
            Number(result.usage.candidatesTokenCount || 0);
        }

        console.log('[Gemini SUCCESS]', {
          model,
          keyNumber: keyIndex + 1,
          durationMs: Date.now() - startedAt,
          httpStatus: result.httpStatus,
          finishReason: result.finishReason
        });

        return result;

      } catch (error) {
        usage.fallbackAttempts++;

        const geminiError =
          error instanceof GeminiError
            ? error
            : new GeminiError(error.message);

        const errorInfo = {
          attempt: attemptNumber,
          total: totalAttempts,
          model,
          keyNumber: keyIndex + 1,
          status: geminiError.status,
          durationMs: Date.now() - startedAt,
          message: geminiError.message,
          finishReason: geminiError.finishReason,
          retryable: geminiError.retryable
        };

        errors.push(errorInfo);
        usage.lastError = geminiError.message;

        console.error('[Gemini Fallback]', errorInfo);

        // Always continue to the next key/model.
      }
    }
  }

  usage.failedRequests++;

  throw new GeminiError(
    'All discovered Gemini models and API keys failed.',
    {
      details: errors
    }
  );
}

// ======================================================
// SIMPLE GENERATE
// ======================================================

async function generate(prompt, options = {}) {
  const result = await generateText({
    ...options,
    prompt
  });

  return result.text;
}

// ======================================================
// HEALTH CHECK
// ======================================================

async function healthCheck() {
  try {
    const result = await generateText({
      prompt: 'Reply with exactly: OK',
      temperature: 0,
      maxOutputTokens: 64
    });

    return {
      success: true,
      model: result.model,
      response: result.text,
      httpStatus: result.httpStatus,
      finishReason: result.finishReason
    };

  } catch (error) {
    return {
      success: false,
      error: error.message,
      details: error.details || null
    };
  }
}

// ======================================================
// EXPORTS
// ======================================================

module.exports = {
  generate,
  generateText,
  healthCheck,
  getApiKeys,
  getModels,
  discoverModels,
  getUsageStats,
  resetUsageStats,
  GeminiError
};
