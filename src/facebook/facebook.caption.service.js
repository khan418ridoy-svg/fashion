
'use strict';

const { db } = require('../config/firebase');
const geminiService = require('../services/ai/gemini.service');

const {
  FacebookError,
  cleanString
} = require('./facebook.utils');

const PRODUCTS_COLLECTION = 'products';

// ========================================
// Helpers
// ========================================

function getAvailableVariants(variants) {
  if (!Array.isArray(variants)) {
    return [];
  }

  return variants
    .filter(variant => (
      variant &&
      variant.isActive === true &&
      Number.isSafeInteger(Number(variant.stock)) &&
      Number(variant.stock) > 0
    ))
    .map(variant => ({
      color: cleanString(variant.color, 100),
      size: cleanString(variant.size, 100),
      stock: Number(variant.stock),

      sellingPrice:
        Number.isFinite(Number(variant.sellingPrice)) &&
        variant.sellingPrice !== null &&
        variant.sellingPrice !== ''
          ? Number(variant.sellingPrice)
          : null,

      sku: cleanString(
        variant.sku || variant.variantSku,
        100
      ),

      variantSku: cleanString(
        variant.variantSku || variant.sku,
        100
      )
    }));
}

// ========================================
// Load Product
// ========================================

async function getFacebookProduct(productId) {
  const id = cleanString(productId, 128);

  if (!id) {
    throw new FacebookError(
      'Product ID is required.',
      400,
      'PRODUCT_ID_REQUIRED'
    );
  }

  const snapshot = await db
    .collection(PRODUCTS_COLLECTION)
    .doc(id)
    .get();

  if (!snapshot.exists) {
    throw new FacebookError(
      'Product not found.',
      404,
      'PRODUCT_NOT_FOUND'
    );
  }

  const product = snapshot.data() || {};

  if (
    product.active !== true ||
    product.status !== 'active' ||
    product.deleted !== false ||
    product.summary?.hasStock !== true
  ) {
    throw new FacebookError(
      'This product is not eligible for Facebook posting.',
      400,
      'PRODUCT_NOT_ELIGIBLE'
    );
  }

  const variants = getAvailableVariants(product.variants);

  if (!variants.length) {
    throw new FacebookError(
      'No active variant with available stock.',
      400,
      'PRODUCT_OUT_OF_STOCK'
    );
  }

  return {
    id: snapshot.id,

    name: cleanString(
      product.name,
      300
    ),

    sku: cleanString(
      product.sku,
      100
    ),

    shortDescription: cleanString(
      product.shortDescription,
      1000
    ),

    description: cleanString(
      product.description,
      2000
    ),

    variants
  };
}

// ========================================
// Extract Exactly 5 Unique Hashtags
// ========================================

function extractHashtags(caption) {
  const matches = String(caption || '')
    .match(/#[\p{L}\p{N}_]+/gu) || [];

  const hashtags = [
    ...new Set(matches)
  ];

  if (hashtags.length !== 5) {
    throw new FacebookError(
      `Gemini must generate exactly 5 unique hashtags. Received: ${hashtags.length}. Please generate again.`,
      502,
      'INVALID_HASHTAG_COUNT'
    );
  }

  return hashtags;
}

// ========================================
// Parse Gemini Structured Caption
// ========================================

function parseGeminiCaption(rawCaption) {
  const text = String(rawCaption || '')
    .replace(/\r\n?/g, '\n')
    .trim();

  const banglaMatch = text.match(
    /\[BANGLA\]\s*([\s\S]*?)(?=\[ENGLISH\])/i
  );

  const englishMatch = text.match(
    /\[ENGLISH\]\s*([\s\S]*?)(?=\[HASHTAGS\])/i
  );

  const hashtagMatch = text.match(
    /\[HASHTAGS\]\s*([\s\S]*)$/i
  );

  if (!banglaMatch || !englishMatch || !hashtagMatch) {
    throw new FacebookError(
      'Gemini returned an invalid caption format. Please generate again.',
      502,
      'INVALID_CAPTION_FORMAT'
    );
  }

  const bangla = banglaMatch[1]
    .trim();

  const english = englishMatch[1]
    .trim();

  const hashtagText = hashtagMatch[1]
    .trim();

  if (!bangla || !english) {
    throw new FacebookError(
      'Gemini returned an empty promotional paragraph.',
      502,
      'EMPTY_PROMOTIONAL_CAPTION'
    );
  }

  // Reject extra marker sections or misplaced markers.
  if (
    /\[(?:BANGLA|ENGLISH|HASHTAGS)\]/i.test(
      bangla + english
    )
  ) {
    throw new FacebookError(
      'Gemini returned duplicated caption markers.',
      502,
      'INVALID_CAPTION_FORMAT'
    );
  }

  // Exactly 5 unique hashtags are required.
  const hashtags = extractHashtags(hashtagText);

  // Hashtag section must contain hashtags only.
  const remainingHashtagText = hashtagText
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .trim();

  if (remainingHashtagText) {
    throw new FacebookError(
      'Gemini returned unexpected text in the hashtag section.',
      502,
      'INVALID_HASHTAG_FORMAT'
    );
  }

  return {
    bangla,
    english,
    hashtags
  };
}

// ========================================
// Clean Promotional Paragraph
// ========================================

function cleanPromotionalParagraph(paragraph) {
  return String(paragraph || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s*/gm, '')
    .replace(/#[\p{L}\p{N}_]+/gu, '')
    .replace(
      /^\s*(?:product\s*)?sku(?:\s*code)?\s*[:：].*$/gim,
      ''
    )
    .replace(
      /^\s*variant\s*sku.*$/gim,
      ''
    )
    .replace(
      /^\s*(?:price|stock|quantity|available|availability|size|sizes|variant|variants)\s*[:：].*$/gim,
      ''
    )
    .replace(
      /^\s*অর্ডার করতে ইনবক্স করুন.*$/gim,
      ''
    )
    .replace(
      /^\s*DM\s+to\s+order.*$/gim,
      ''
    )
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, ' ')
    .trim();
}

// ========================================
// Generate Facebook Caption
// ========================================

async function generateFacebookCaption(productId) {
  const product = await getFacebookProduct(productId);

  if (!product.name) {
    throw new FacebookError(
      'Product name is missing.',
      400,
      'PRODUCT_NAME_REQUIRED'
    );
  }

  if (!product.sku) {
    throw new FacebookError(
      'Product SKU is missing from Firestore.',
      400,
      'PRODUCT_SKU_REQUIRED'
    );
  }

  // Product SKU is read directly from Firestore.
  // Gemini is not allowed to generate or modify it.
  const productSku = product.sku;

  const result = await geminiService.generateText({
    systemInstruction: [
      'You are a professional Facebook fashion copywriter for a Bangladeshi clothing store.',
      'Write a natural, attractive and concise promotional Facebook caption.',
      'Use only the supplied product name and descriptions.',
      'Never invent product features, fabric, material, measurements, discounts or claims.',
      'The output MUST contain exactly two promotional paragraphs.',
      'The first paragraph MUST be natural Bangla.',
      'The second paragraph MUST be natural English and accurately translate the Bangla paragraph.',
      'Do not mention price, stock, quantity, sizes, variants or availability.',
      'Never generate Product SKU or Variant SKU.',
      'Never invent, guess, alter, correct or change any SKU code.',
      'Do not include an order instruction.',
      'After the two paragraphs, generate exactly 5 unique and relevant hashtags.',
      'Hashtags must be directly relevant to the supplied product and fashion category.',
      'Do not repeat hashtags.',
      'Do not include explanations, analysis, notes or additional text.',
      'Do not repeat the caption.',
      'Return ONLY the required structured output.',
      'Use exactly these markers: [BANGLA], [ENGLISH], [HASHTAGS].'
    ].join(' '),

    prompt: [
      'Create a Facebook promotional caption using only these product facts.',
      '',
      'PRODUCT NAME:',
      product.name,
      '',
      'SHORT DESCRIPTION:',
      product.shortDescription || 'Not provided',
      '',
      'DESCRIPTION:',
      product.description || 'Not provided',
      '',
      'REQUIRED OUTPUT FORMAT:',
      '',
      '[BANGLA]',
      'Write one natural Bangla promotional paragraph.',
      '',
      '[ENGLISH]',
      'Write one English translation of the Bangla paragraph.',
      '',
      '[HASHTAGS]',
      '#Hashtag1 #Hashtag2 #Hashtag3 #Hashtag4 #Hashtag5',
      '',
      'STRICT REQUIREMENTS:',
      '- Exactly one Bangla paragraph.',
      '- Exactly one English paragraph.',
      '- Exactly 5 unique relevant hashtags.',
      '- Hashtags must appear only after [HASHTAGS].',
      '- Do not include Product SKU or Variant SKU.',
      '- Do not include price, stock, quantity or availability.',
      '- Do not include order instruction.',
      '- Do not include headings other than the three required markers.',
      '- Do not include any explanation or additional text.'
    ].join('\n'),

    temperature: 0.35,
    maxOutputTokens: 350
  });

  const rawCaption = String(result.text || '')
    .replace(/\r\n?/g, '\n')
    .trim();

  if (!rawCaption) {
    throw new FacebookError(
      'Gemini returned an empty caption.',
      502,
      'EMPTY_AI_CAPTION'
    );
  }

  // Parse and validate Gemini output.
  const parsed = parseGeminiCaption(rawCaption);

  // Clean the two promotional paragraphs.
  const bangla = cleanPromotionalParagraph(
    parsed.bangla
  );

  const english = cleanPromotionalParagraph(
    parsed.english
  );

  if (!bangla || !english) {
    throw new FacebookError(
      'Gemini returned an empty promotional paragraph.',
      502,
      'EMPTY_PROMOTIONAL_CAPTION'
    );
  }

  // Final Facebook caption.
  // Product SKU is always the verified Firestore value.
  // Variant SKU, price and stock are not included.
  const caption = [
    bangla,
    english,
    `Product SKU: ${productSku}`,
    'অর্ডার করতে ইনবক্স করুন 💌',
    parsed.hashtags.join(' ')
  ].join('\n\n');

  if (caption.length > 4000) {
    throw new FacebookError(
      'Generated caption exceeds the Facebook caption length limit.',
      502,
      'CAPTION_TOO_LONG'
    );
  }

  return {
    success: true,
    productId: product.id,
    productName: product.name,
    productSku: product.sku,

    // Response metadata only.
    // These values are never appended to the caption.
    variantSkus: product.variants
      .filter(variant => (
        variant.sku || variant.variantSku
      ))
      .map(variant => ({
        color: variant.color || '',
        size: variant.size || '',
        sku: variant.sku || variant.variantSku
      })),

    caption,
    model: result.model
  };
}

// ========================================
// Exports
// ========================================

module.exports = {
  getFacebookProduct,
  generateFacebookCaption
};
