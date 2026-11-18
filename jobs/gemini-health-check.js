
'use strict';

require('dotenv').config();

const {
  healthCheck
} = require('../src/services/ai/gemini.service');

// ========================================
// Gemini Health Check Job
// ========================================

async function runGeminiHealthCheck() {
  console.log('========================================');
  console.log('[Gemini Health Check] Starting...');
  console.log('========================================');

  const result = await healthCheck();

  if (result.success) {
    console.log('[Gemini Health Check] SUCCESS');
    console.log('Model:', result.model);
    console.log('Response:', result.response);
  } else {
    console.error('[Gemini Health Check] FAILED');
    console.error('Error:', result.error);
  }

  console.log('========================================');

  return result;
}

// ========================================
// Main
// ========================================

async function main() {
  try {
    const result = await runGeminiHealthCheck();

    if (!result.success) {
      process.exitCode = 1;
    }

    return result;

  } catch (error) {
    console.error('[Gemini Health Check Error]', error.message);
    process.exitCode = 1;
  }
}

// ========================================
// Run Directly
// ========================================

if (require.main === module) {
  main();
}

module.exports = {
  runGeminiHealthCheck
};
