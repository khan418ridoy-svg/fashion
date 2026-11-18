'use strict';

import { createElement } from '../helpers.js';

export function render() {
  return createElement('section', {
    className: 'page orders-page',
    attributes: {
      id: 'orders-page',
      'aria-label': 'Orders'
    }
  });
}
