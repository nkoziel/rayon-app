import { defineConfig } from 'vitest/config';

/*
 * The modules under test touch localStorage, document and navigator at import time
 * (core/state.js reads the library, core/i18n.js picks a locale), so they need a DOM.
 * happy-dom is enough and starts faster than jsdom.
 */
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.js'],
    /* core/state.js starts a save interval at module scope; without this the run
       would not exit on its own. */
    teardownTimeout: 1000,
  },
});
