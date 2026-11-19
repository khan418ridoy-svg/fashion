
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
    console.log('First successful model:', result.model);
    console.log('First successful response:', result.response);
    console.log('Tested combinations:', result.testedCombinations);
    console.log('Successful combinations:', result.successfulAttempts);
    console.log('Failed combinations:', result.failedAttempts);
  } else {
    console.error('[Gemini Health Check] FAILED');
    console.error('Error:', result.error);
    console.error('Tested combinations:', result.testedCombinations || 0);
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
