import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/contracts/**/*.test.ts'],
    passWithNoTests: false,
    reporters: ['default'],
  },
});
