import { defineConfig, devices } from '@playwright/test';

const recordVideo =
  process.env.E2E_VIDEO === '1' || process.argv.some((arg) => arg.includes('batch-demo.spec'));
if (recordVideo) {
  process.env.E2E_VIDEO = '1';
}

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:4173';
const startWebServer = !process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  timeout: 60_000,
  expect: {
    toHaveScreenshot: { maxDiffPixelRatio: 0.03, animations: 'disabled' },
  },
  use: {
    baseURL,
    viewport: { width: 1440, height: 1000 },
    colorScheme: 'dark',
    trace: 'retain-on-failure',
    video: process.env.E2E_VIDEO === '1' ? 'on' : 'retain-on-failure',
    launchOptions: process.env.E2E_VIDEO === '1' ? { slowMo: 400 } : undefined,
  },
  webServer: startWebServer
    ? {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      }
    : undefined,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } },
    },
  ],
});
