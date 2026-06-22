import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const webPort = process.env.ATLASTERM_WEB_PORT ?? '4200';
const webLivePort = process.env.ATLASTERM_WEB_LIVE_PORT ?? '4211';
const desktopPort = process.env.ATLASTERM_DESKTOP_PORT ?? '5175';
const mobilePort = process.env.ATLASTERM_MOBILE_PORT ?? '8099';
const mobileLivePort = process.env.ATLASTERM_MOBILE_LIVE_PORT ?? '8101';
const adminSnapshotPort = process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_PORT ?? '4110';
const mobileSyncPort = process.env.ATLASTERM_E2E_MOBILE_SYNC_PORT ?? '4111';
const webUrl = process.env.ATLASTERM_WEB_URL ?? `http://${host}:${webPort}`;
const webLiveUrl = process.env.ATLASTERM_WEB_LIVE_URL ?? `http://${host}:${webLivePort}`;
const desktopUrl = process.env.ATLASTERM_DESKTOP_URL ?? `http://${host}:${desktopPort}`;
const mobileUrl = process.env.ATLASTERM_MOBILE_URL ?? `http://${host}:${mobilePort}`;
const mobileLiveUrl = process.env.ATLASTERM_MOBILE_LIVE_URL ?? `http://${host}:${mobileLivePort}`;
const adminSnapshotProxyTarget = process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_URL ?? `http://${host}:${adminSnapshotPort}`;
const mobileSyncUrl = process.env.ATLASTERM_E2E_MOBILE_SYNC_URL ?? `http://${host}:${mobileSyncPort}`;
const webAdminSnapshotAuthToken =
  process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_AUTH_TOKEN ?? 'e2e-admin-snapshot-token';
const mobileSyncAuthToken = process.env.ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN ?? 'e2e-mobile-sync-token';
const testTimeout = Number(process.env.ATLASTERM_E2E_TEST_TIMEOUT_MS ?? '30000');
const webServerEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);
webServerEnv.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET = adminSnapshotProxyTarget;
webServerEnv.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN = webAdminSnapshotAuthToken;
const webLiveServerEnv: Record<string, string> = {
  ...webServerEnv,
  VITE_ATLASTERM_ADMIN_SNAPSHOT_URL: '/api/admin/snapshot',
};
const mobileStaticServerEnv: Record<string, string> = {
  ...webServerEnv,
  ATLASTERM_E2E_MOBILE_STATIC_HOST: host,
  ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN: mobileSyncAuthToken,
  ATLASTERM_E2E_MOBILE_SYNC_URL: mobileSyncUrl,
};

export default defineConfig({
  testDir: './specs',
  timeout: testTimeout,
  expect: {
    timeout: 5_000,
  },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'web-admin-chromium',
      testMatch: /web-admin\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: webUrl,
      },
    },
    {
      name: 'web-admin-mobile',
      testMatch: /web-admin\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: webUrl,
      },
    },
    {
      name: 'web-admin-live-sync-api',
      testMatch: /web-admin-live-sync\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: webLiveUrl,
      },
    },
    {
      name: 'desktop-workbench',
      testMatch: /desktop-workbench\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: desktopUrl,
      },
    },
    {
      name: 'desktop-accessibility',
      testMatch: /accessibility\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: desktopUrl,
      },
    },
    {
      name: 'mobile-companion-web',
      testMatch: /mobile-companion\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: mobileUrl,
        locale: 'en-US',
        viewport: { width: 320, height: 700 },
      },
    },
    {
      name: 'mobile-companion-live-web',
      testMatch: /mobile-companion-live\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: mobileLiveUrl,
        locale: 'en-US',
        viewport: { width: 320, height: 700 },
      },
    },
  ],
  webServer: [
    {
      command: `node scripts/admin-snapshot-mock-server.mjs`,
      cwd: '.',
      env: {
        ATLASTERM_E2E_ADMIN_SNAPSHOT_AUTH_TOKEN: webAdminSnapshotAuthToken,
        ATLASTERM_E2E_ADMIN_SNAPSHOT_HOST: host,
        ATLASTERM_E2E_ADMIN_SNAPSHOT_PORT: adminSnapshotPort,
      },
      url: `http://${host}:${adminSnapshotPort}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `node scripts/mobile-sync-mock-server.mjs`,
      cwd: '.',
      env: {
        ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN: mobileSyncAuthToken,
        ATLASTERM_E2E_MOBILE_SYNC_HOST: host,
        ATLASTERM_E2E_MOBILE_SYNC_PORT: mobileSyncPort,
      },
      url: `${mobileSyncUrl}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: `npm --prefix ../.. run dev -w @atlasterm/web -- --host ${host} --port ${webPort} --strictPort`,
      env: webServerEnv,
      url: webUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm --prefix ../.. run dev -w @atlasterm/web -- --host ${host} --port ${webLivePort} --strictPort`,
      env: webLiveServerEnv,
      url: webLiveUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `npm --prefix ../.. run dev -w @atlasterm/desktop -- --host ${host} --port ${desktopPort} --strictPort`,
      url: desktopUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
    {
      command: `node scripts/mobile-static-web-server.mjs`,
      env: mobileStaticServerEnv,
      url: mobileLiveUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
