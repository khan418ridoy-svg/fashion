'use strict';

import { createElement } from '../helpers.js';

export function render() {
  return createElement('section', {
    className: 'page pos-page',
    attributes: {
      id: 'pos-page',
      'aria-label': 'POS'
    }
  });
}
