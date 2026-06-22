import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const webRealSyncPort = process.env.ATLASTERM_WEB_REAL_SYNC_PORT ?? '4212';
const realSyncPort = process.env.ATLASTERM_E2E_REAL_SYNC_PORT ?? '4112';
const webRealSyncUrl = process.env.ATLASTERM_WEB_REAL_SYNC_URL ?? `http://${host}:${webRealSyncPort}`;
const realSyncUrl = process.env.ATLASTERM_E2E_REAL_SYNC_URL ?? `http://${host}:${realSyncPort}`;
const realSyncAdminToken =
  process.env.ATLASTERM_E2E_REAL_SYNC_ADMIN_TOKEN ?? 'e2e-real-admin-token-fedcba9876543210';
const testTimeout = Number(process.env.ATLASTERM_E2E_TEST_TIMEOUT_MS ?? '120000');
const webServerEnv: Record<string, string> = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
);

webServerEnv.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TARGET = realSyncUrl;
webServerEnv.ATLASTERM_ADMIN_SNAPSHOT_PROXY_TOKEN = realSyncAdminToken;
webServerEnv.VITE_ATLASTERM_ADMIN_SNAPSHOT_URL = '/api/admin/snapshot';

export default defineConfig({
  testDir: './specs',
  timeout: testTimeout,
  expect: {
    timeout: 10_000,
  },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'web-admin-real-sync',
      testMatch: /web-admin-real-sync\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        baseURL: webRealSyncUrl,
      },
    },
  ],
  webServer: [
    {
      command: 'node scripts/sync-admin-snapshot-real-server.mjs',
      cwd: '.',
      env: {
        ATLASTERM_E2E_REAL_SYNC_ADMIN_TOKEN: realSyncAdminToken,
        ATLASTERM_E2E_REAL_SYNC_HOST: host,
        ATLASTERM_E2E_REAL_SYNC_PORT: realSyncPort,
        ATLASTERM_E2E_REAL_SYNC_WEB_ORIGIN: webRealSyncUrl,
      },
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      url: `${realSyncUrl}/healthz`,
    },
    {
      command: `npm --prefix ../.. run dev -w @atlasterm/web -- --host ${host} --port ${webRealSyncPort} --strictPort`,
      env: webServerEnv,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      url: webRealSyncUrl,
    },
  ],
});
