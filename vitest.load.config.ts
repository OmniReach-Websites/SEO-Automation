import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: ['tests/load/**/*.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
    testTimeout: 20_000,
  },
});
