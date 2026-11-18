'use strict';

import { createElement } from '../helpers.js';

export function render() {
  return createElement('section', {
    className: 'page bot-chats-page',
    attributes: {
      id: 'bot-chats-page',
      'aria-label': 'Bot Chats'
    }
  });
}
