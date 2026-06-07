import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E testing configuration for TikiTaka AI Grader LMS
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 45 * 1000,
  expect: {
    timeout: 8000,
  },
  fullyParallel: false, // Run sequentially to avoid emulator write conflicts
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1, // Use single worker to avoid parallel conflict in DB emulators
  reporter: 'list',
  use: {
    actionTimeout: 15000,
    baseURL: 'http://localhost:5002',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
