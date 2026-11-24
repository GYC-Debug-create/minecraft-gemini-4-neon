import { defineConfig, devices } from '@playwright/test';
import fs from 'node:fs';

const systemChrome = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const useSystemChrome = fs.existsSync(systemChrome) && !process.env.PLAYWRIGHT_FORCE_BUNDLED;

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    viewport: { width: 1280, height: 720 },
    headless: true,
    launchOptions: {
      ...(useSystemChrome ? { executablePath: systemChrome } : {}),
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
