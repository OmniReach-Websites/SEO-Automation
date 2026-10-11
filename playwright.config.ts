import { defineConfig } from '@playwright/test';

export default defineConfig({
  forbidOnly: true,
  fullyParallel: false,
  outputDir: 'test-results',
  reporter: [['list']],
  retries: 0,
  testDir: 'tests/e2e',
  timeout: 20000,
  use: {
    trace: 'retain-on-failure',
  },
  workers: 1,
});
