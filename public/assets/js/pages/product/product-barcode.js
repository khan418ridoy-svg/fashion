'use strict';

import { escapeHTML } from '../../helpers.js';

// Code 128 module widths for values 0-106.
const CODE_128_PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222',
  '122213', '122312', '132212', '221213', '221312', '231212',
  '112232', '122132', '122231', '113222', '123122', '123221',
  '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321',
  '112313', '132113', '132311', '211313', '231113', '231311',
  '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131',
  '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124',
  '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111',
  '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141',
  '411131', '211412', '211214', '211232', '2331112'
];

const START_CODE_B = 104;
const START_CODE_C = 105;
const SWITCH_TO_CODE_C = 99;
const STOP_CODE = 106;
const QUIET_ZONE = 10;

function getCodeValues(text) {
  if (/^\d+$/.test(text) && text.length > 1) {
    const values = [];
    let index = 0;
    let startCode = START_CODE_C;

    if (text.length % 2 !== 0) {
      startCode = START_CODE_B;
      values.push(text.charCodeAt(0) - 32);
      values.push(SWITCH_TO_CODE_C);
      index = 1;
    }

    for (; index < text.length; index += 2) {
      values.push(Number(text.slice(index, index + 2)));
    }

    return { startCode, values };
  }

  const values = Array.from(text).map(character => (
    character.charCodeAt(0) - 32
  ));

  return {
    startCode: START_CODE_B,
    values
  };
}

function getCodeSequence(text) {
  const { startCode, values } = getCodeValues(text);
  const checksum = values.reduce(
    (total, value, index) => total + value * (index + 1),
    startCode
  ) % 103;

  return [
    startCode,
    ...values,
    checksum,
    STOP_CODE
  ];
}

function createBarcodeBars(sequence) {
  let x = QUIET_ZONE;
  const bars = [];

  sequence.forEach(code => {
    const pattern = CODE_128_PATTERNS[code];

    pattern.split('').forEach((widthValue, index) => {
      const width = Number(widthValue);

      if (index % 2 === 0) {
        bars.push(
          `<rect x="${x}" y="0" width="${width}" height="64"></rect>`
        );
      }

      x += width;
    });
  });

  return {
    bars: bars.join(''),
    width: x + QUIET_ZONE
  };
}

export function renderProductBarcode(value) {
  const text = String(value ?? '').trim();

  if (!text || text === '—') {
    return '<span>—</span>';
  }

  const isCode128BCompatible = Array.from(text).every(character => {
    const code = character.charCodeAt(0);
    return code >= 32 && code <= 126;
  });

  if (!isCode128BCompatible) {
    return `<span>${escapeHTML(text)}</span>`;
  }

  const { bars, width } = createBarcodeBars(
    getCodeSequence(text)
  );
  const safeText = escapeHTML(text);

  return `
    <div class="product-view-barcode" role="img"
      aria-label="Barcode ${safeText}">
      <svg viewBox="0 0 ${width} 64" aria-hidden="true"
        focusable="false" preserveAspectRatio="none"
        shape-rendering="crispEdges">
        ${bars}
      </svg>
      <span class="product-view-barcode-number">${safeText}</span>
    </div>
  `;
}
