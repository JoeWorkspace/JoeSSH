import { defineConfig, devices } from "@playwright/test";

const host = "127.0.0.1";
const desktopPort = process.env.ATLASTERM_DESKTOP_PORT ?? "5175";
const desktopUrl = `http://${host}:${desktopPort}`;
const testTimeout = Number(
  process.env.ATLASTERM_E2E_TEST_TIMEOUT_MS ?? "60000",
);

export default defineConfig({
  expect: {
    timeout: 10_000,
  },
  projects: [
    {
      name: "desktop-visual-wide",
      testMatch: /visual-qa\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: desktopUrl,
        viewport: { height: 900, width: 1440 },
      },
    },
    {
      name: "desktop-visual-narrow",
      testMatch: /visual-qa\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: desktopUrl,
        viewport: { height: 768, width: 900 },
      },
    },
  ],
  reporter: [
    ["list"],
    [
      "html",
      { open: "never", outputFolder: "playwright-desktop-visual-report" },
    ],
  ],
  testDir: "./specs",
  timeout: testTimeout,
  use: {
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm --prefix ../.. run dev -w @atlasterm/desktop -- --host ${host} --port ${desktopPort} --strictPort`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    url: desktopUrl,
  },
});
