import { defineConfig } from 'vitest/config';

// Settings for `npm test`. Tests run in jsdom, a simulated browser, against the real index.html.
export default defineConfig({
  define: { __MOCK__: 'false' },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    restoreMocks: true
  }
});
