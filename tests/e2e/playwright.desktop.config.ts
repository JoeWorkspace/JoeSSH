import { defineConfig, devices } from '@playwright/test';

const host = '127.0.0.1';
const desktopPort = process.env.ATLASTERM_DESKTOP_PORT ?? '5175';
const desktopUrl = `http://${host}:${desktopPort}`;

export default defineConfig({
  testDir: './specs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [['list']],
  projects: [
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
  ],
});
