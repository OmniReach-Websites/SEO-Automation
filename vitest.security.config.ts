import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/security/**/*.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
    testTimeout: 15000,
  },
});
