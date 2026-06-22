import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const webPort = process.env.ATLASTERM_WEB_PORT ?? '4200';
const desktopPort = process.env.ATLASTERM_DESKTOP_PORT ?? '5175';
const mobilePort = process.env.ATLASTERM_MOBILE_PORT ?? '8099';
const webUrl = `http://${host}:${webPort}`;
const desktopUrl = `http://${host}:${desktopPort}`;
const mobileUrl = `http://${host}:${mobilePort}`;
const testTimeout = Number(process.env.ATLASTERM_E2E_TEST_TIMEOUT_MS ?? '60000');
const webServerEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
const mobileStaticServerEnv: Record<string, string> = {
  ...webServerEnv,
  ATLASTERM_E2E_MOBILE_STATIC_HOST: host,
  ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN: process.env.ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN ?? 'e2e-mobile-sync-token',
  ATLASTERM_E2E_MOBILE_SYNC_URL:
    process.env.ATLASTERM_E2E_MOBILE_SYNC_URL ??
    `http://${host}:${process.env.ATLASTERM_E2E_MOBILE_SYNC_PORT ?? '4111'}`,
};

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: 'web-admin-visual-wide',
      testMatch: /visual-qa\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: webUrl,
        viewport: { height: 900, width: 1440 },
      },
    },
    {
      name: 'web-admin-visual-mobile',
      testMatch: /visual-qa\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: webUrl,
        locale: 'en-US',
        viewport: { height: 844, width: 390 },
      },
    },
    {
      name: 'desktop-visual-wide',
      testMatch: /visual-qa\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: desktopUrl,
        viewport: { height: 900, width: 1440 },
      },
    },
    {
      name: 'desktop-visual-narrow',
      testMatch: /visual-qa\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: desktopUrl,
        viewport: { height: 768, width: 900 },
      },
    },
    {
      name: 'mobile-web-visual',
      testMatch: /visual-qa\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: mobileUrl,
        locale: 'en-US',
        viewport: { height: 700, width: 320 },
      },
    },
  ],
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-visual-report' }]],
  testDir: './specs',
  timeout: testTimeout,
  use: {
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: `npm --prefix ../.. run dev -w @atlasterm/web -- --host ${host} --port ${webPort} --strictPort`,
      env: webServerEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: webUrl,
    },
    {
      command: `npm --prefix ../.. run dev -w @atlasterm/desktop -- --host ${host} --port ${desktopPort} --strictPort`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: desktopUrl,
    },
    {
      command: `node scripts/mobile-static-web-server.mjs`,
      env: mobileStaticServerEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      url: mobileUrl,
    },
  ],
});
