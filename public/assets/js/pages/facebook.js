'use strict';

import { createElement } from '../helpers.js';

export function render() {
  return createElement('section', {
    className: 'page facebook-page',
    attributes: {
      id: 'facebook-page',
      'aria-label': 'Facebook'
    }
  });
}
