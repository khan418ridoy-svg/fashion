
'use strict';

require('dotenv').config();

/*
|--------------------------------------------------------------------------
| Gemini AI Service
|--------------------------------------------------------------------------
| Includes:
| - API Key Management
| - Model Management
| - Gemini API Client
| - Automatic Key Fallback
| - Automatic Model Fallback
| - Timeout and Retry
| - Usage and Error Tracking
|
| Node.js 18+ required (native fetch).
|--------------------------------------------------------------------------
*/

const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;
const DEFAULT_TEMPERATURE = 0.7;

// --------------------------------------------------
// 1. API KEY MANAGEMENT
// --------------------------------------------------

function getApiKeys() {
  const keys = [];

  for (let i = 1; i <= 5; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];

    if (key && key.trim()) {
      keys.push(key.trim());
    }
  }

  // Optional comma-separated keys
  if (process.env.GEMINI_API_KEYS) {
    keys.push(
      ...process.env.GEMINI_API_KEYS
        .split(',')
        .map(key => key.trim())
        .filter(Boolean)
    );
  }

  return [...new Set(keys)];
}

// --------------------------------------------------
// 2. MODEL MANAGEMENT
// --------------------------------------------------

function getModels() {
  const models = (process.env.GEMINI_MODELS || '')
    .split(',')
    .map(model => model.trim())
    .filter(Boolean);

  if (!models.length) {
    throw new Error(
      'GEMINI_MODELS is missing. Configure model names in .env.'
    );
  }

  return [...new Set(models)];
}

// --------------------------------------------------
// 3. USAGE TRACKING
// --------------------------------------------------

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
  Object.keys(usage).forEach(key => {
    if (typeof usage[key] === 'number') {
      usage[key] = 0;
    } else {
      usage[key] = null;
    }
  });

  return getUsageStats();
}

// --------------------------------------------------
// 4. ERROR HANDLING
// --------------------------------------------------

class GeminiError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'GeminiError';
    this.status = options.status || 0;
    this.model = options.model || null;
    this.retryable = Boolean(options.retryable);
    this.details = options.details || null;
  }
}

function isRetryableStatus(status) {
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    status === 408 ||
    status === 429 ||
    status >= 500
  );
}

// --------------------------------------------------
// 5. GEMINI API CLIENT
// --------------------------------------------------

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
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${encodeURIComponent(model)}:generateContent`;

  const url = new URL(endpoint);
  url.searchParams.set('key', apiKey);

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
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeout)
    });
  } catch (error) {
    throw new GeminiError(
      `Gemini network error: ${error.message}`,
      {
        model,
        retryable: true
      }
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new GeminiError(
      'Gemini returned an invalid JSON response.',
      {
        status: response.status,
        model,
        retryable: isRetryableStatus(response.status)
      }
    );
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      `Gemini API error: HTTP ${response.status}`;

    throw new GeminiError(message, {
      status: response.status,
      model,
      retryable: isRetryableStatus(response.status),
      details: data?.error || null
    });
  }

  const parts = data?.candidates?.[0]?.content?.parts || [];

  const text = parts
    .filter(part => typeof part.text === 'string')
    .map(part => part.text)
    .join('');

  if (!text) {
    throw new GeminiError(
      'Gemini returned no text. Check candidate finish reason.',
      {
        model,
        details: data?.candidates?.[0]?.finishReason || null
      }
    );
  }

  return {
    text,
    model,
    usage: data.usageMetadata || null,
    finishReason: data.candidates?.[0]?.finishReason || null
  };
}

// --------------------------------------------------
// 6. FALLBACK SERVICE
// --------------------------------------------------

async function generateText(options = {}) {
  const apiKeys = getApiKeys();
  const models = getModels();

  if (!apiKeys.length) {
    throw new GeminiError(
      'No Gemini API keys found. Configure GEMINI_API_KEY_1 to GEMINI_API_KEY_5.'
    );
  }

  const prompt = options.prompt;

  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    throw new GeminiError('A non-empty prompt is required.');
  }

  const contents = options.contents || [
    {
      role: 'user',
      parts: [{ text: prompt.trim() }]
    }
  ];

  const settings = {
    systemInstruction:
      options.systemInstruction ||
      process.env.GEMINI_SYSTEM_INSTRUCTION ||
      null,

    temperature:
      options.temperature ??
      Number(process.env.GEMINI_TEMPERATURE || DEFAULT_TEMPERATURE),

    maxOutputTokens:
      options.maxOutputTokens ??
      Number(
        process.env.GEMINI_MAX_OUTPUT_TOKENS ||
        DEFAULT_MAX_OUTPUT_TOKENS
      ),

    timeout:
      options.timeout ??
      Number(process.env.GEMINI_TIMEOUT || DEFAULT_TIMEOUT)
  };

  usage.totalRequests++;

  const errors = [];

  /*
   * Fallback order:
   *
   * Model 1 + Key 1
   * Model 1 + Key 2
   * Model 1 + Key 3
   * ...
   * Model 2 + Key 1
   * Model 2 + Key 2
   * ...
   */

  for (const model of models) {
    for (const apiKey of apiKeys) {
      try {
        const result = await callGemini({
          apiKey,
          model,
          contents,
          ...settings
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

        return result;

      } catch (error) {
        usage.fallbackAttempts++;

        const geminiError = error instanceof GeminiError
          ? error
          : new GeminiError(error.message);

        errors.push({
          model,
          status: geminiError.status,
          message: geminiError.message
        });

        usage.lastError = geminiError.message;

        console.error('[Gemini Fallback]', {
          model,
          status: geminiError.status,
          message: geminiError.message
        });

        // Invalid request: trying another key/model won't fix it.
        if (
          geminiError.status >= 400 &&
          geminiError.status < 500 &&
          ![401, 403, 404, 408, 429].includes(geminiError.status)
        ) {
          usage.failedRequests++;
          throw geminiError;
        }

        // Try next key, then next model.
      }
    }
  }

  usage.failedRequests++;

  throw new GeminiError(
    'All configured Gemini models and API keys failed.',
    {
      details: errors
    }
  );
}

// --------------------------------------------------
// 7. MAIN SERVICE
// --------------------------------------------------

async function generate(prompt, options = {}) {
  const result = await generateText({
    ...options,
    prompt
  });

  return result.text;
}

async function healthCheck() {
  try {
    const result = await generateText({
      prompt: 'Reply with exactly: OK',
      temperature: 0,
      maxOutputTokens: 10
    });

    return {
      success: true,
      model: result.model,
      response: result.text
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

// --------------------------------------------------
// 8. EXPORTS
// --------------------------------------------------

module.exports = {
  generate,
  generateText,
  healthCheck,
  getApiKeys,
  getModels,
  getUsageStats,
  resetUsageStats,
  GeminiError
};
