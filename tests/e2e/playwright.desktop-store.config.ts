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
  forbidOnly: true,
  retries: 0,
  workers: 1,
  outputDir: "test-results/store-runtime",
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: "test-results/store-runtime/results.json",
      },
    ],
  ],
  projects: [
    {
      name: "desktop-store-release",
      testMatch: /desktop-store-release\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: desktopUrl,
        locale: "en-US",
        screenshot: "only-on-failure",
        trace: "retain-on-failure",
      },
    },
  ],
  webServer: {
    command: `npm --prefix ../.. run preview -w @atlasterm/desktop -- --port ${desktopPort} --strictPort`,
    url: desktopUrl,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
