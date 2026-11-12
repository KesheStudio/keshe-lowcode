import { defineConfig } from '@playwright/test';
import {
  E2E_ARTIFACTS_DIR,
  E2E_BASE_URL,
  E2E_PORT,
  E2E_REPORT_DIR,
  E2E_RUN_ID,
  E2E_RUN_ROOT,
  detectBrowser
} from './tests/e2e/support/config.mjs';

const browser = detectBrowser();

/* 并行跑多轮时，用 LC_E2E_ARTIFACTS_DIR / LC_E2E_REPORT_DIR 让每轮各写各的目录。 */
export default defineConfig({
  testDir: './tests/e2e/specs',
  testMatch: '**/*.spec.mjs',
  outputDir: E2E_ARTIFACTS_DIR,
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  retries: 0,
  reporter: [
    ['list'],
    ['./tests/e2e/support/reporter.mjs'],
    ['html', { outputFolder: E2E_REPORT_DIR, open: 'never' }],
    ['json', { outputFile: E2E_REPORT_DIR + '/results.json' }]
  ],
  use: {
    baseURL: E2E_BASE_URL,
    channel: browser.channel,
    headless: true,
    viewport: { width: 1440, height: 900 },
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off'
  },
  globalTeardown: './tests/e2e/support/teardown.mjs',
  webServer: {
    command: 'node tests/e2e/support/serve.mjs',
    url: E2E_BASE_URL + '/api/health',
    reuseExistingServer: false,
    timeout: 45_000,
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      LC_E2E_PORT: String(E2E_PORT),
      LC_E2E_RUN_ID: E2E_RUN_ID,
      LC_E2E_RUN_ROOT: E2E_RUN_ROOT
    }
  }
});
