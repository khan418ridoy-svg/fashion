'use strict';

import { createElement } from '../helpers.js';

export function render() {
  return createElement('section', {
    className: 'page reports-page',
    attributes: {
      id: 'reports-page',
      'aria-label': 'Reports'
    }
  });
}
