import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const desktopPort = process.env.ATLASTERM_DESKTOP_PORT ?? "5175";
const desktopUrl = `http://${host}:${desktopPort}`;
const testTimeout = Number(
  process.env.ATLASTERM_E2E_TEST_TIMEOUT_MS ?? "60000",
);

export default defineConfig({
  testDir: "./specs",
  timeout: testTimeout,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  projects: [
    {
      name: "desktop-workbench",
      testMatch: /desktop-workbench\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: desktopUrl,
      },
    },
    {
      name: "desktop-accessibility",
      testMatch: /accessibility\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: desktopUrl,
      },
    },
  ],
  webServer: {
    command: `npm --prefix ../.. run dev -w @atlasterm/desktop -- --host ${host} --port ${desktopPort} --strictPort`,
    url: desktopUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
