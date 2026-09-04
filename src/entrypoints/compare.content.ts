import { defineContentScript } from '#imports';

export default defineContentScript({
  matches: ['https://github.com/*/*/compare/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  main() {
    console.debug('[compare-tree] content script loaded');
  },
});
