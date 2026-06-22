import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const webPort = process.env.ATLASTERM_WEB_PORT ?? '4200';
const webLivePort = process.env.ATLASTERM_WEB_LIVE_PORT ?? '4211';
const adminSnapshotPort = process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_PORT ?? '4110';
const webUrl = process.env.ATLASTERM_WEB_URL ?? `http://${host}:${webPort}`;
const webLiveUrl = process.env.ATLASTERM_WEB_LIVE_URL ?? `http://${host}:${webLivePort}`;
const adminSnapshotProxyTarget = process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_URL ?? `http://${host}:${adminSnapshotPort}`;
const webAdminSnapshotAuthToken =
  process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_AUTH_TOKEN ?? 'e2e-admin-snapshot-token';
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
  ],
});
