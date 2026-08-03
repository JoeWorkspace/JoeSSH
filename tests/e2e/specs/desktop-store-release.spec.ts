import { expect, test, type Page } from "@playwright/test";

test.describe("Microsoft Store release surface", () => {
  test("exposes only shipped features in light and dark themes at the minimum release viewport", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 480, width: 900 });
    await page.goto("/?lang=en&panel=team");

    await expect(
      page.locator(
        'meta[name="joessh-release-surface-profile"][content="microsoft-store"]',
      ),
    ).toHaveCount(1);
    await expect(page.getByText("JoeSSH", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Session Context", { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Team" })).toHaveCount(0);
    await expect(page.getByText("Team Access", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Command palette" }).click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await expect(palette).toBeVisible();
    await palette.getByRole("combobox").fill("team");
    await expect(
      palette.getByText("Request elevated access", { exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await dispatchAppShortcut(page, "3");
    await expect(
      page.getByText("Session Context", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Team Access", { exact: true })).toHaveCount(0);

    await dispatchAppShortcut(page, "?", { shiftKey: true });
    const shortcuts = page.getByRole("dialog", {
      name: "Keyboard shortcuts",
    });
    await expect(shortcuts).toBeVisible();
    await expect(
      shortcuts.locator("kbd").filter({ hasText: "Ctrl+3" }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");

    await page.getByRole("tab", { name: "Settings" }).click();
    await expect(
      page.getByText("Workspace Settings", { exact: true }),
    ).toBeVisible();
    for (const unavailableText of [
      "Business Layer",
      "Seat billing",
      "Sync encrypted snippets",
      "Recording",
    ]) {
      await expect(
        page.getByText(unavailableText, { exact: true }),
      ).toHaveCount(0);
    }

    await expectNoDocumentOverflow(page);

    await page.evaluate(() => {
      localStorage.setItem("atlasterm.theme", "light");
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.getByRole("tab", { name: "Team" })).toHaveCount(0);
    await expectNoDocumentOverflow(page);

    await page.evaluate(() => {
      localStorage.setItem("atlasterm.theme", "dark");
    });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByRole("tab", { name: "Team" })).toHaveCount(0);
    await expectNoDocumentOverflow(page);
  });
});

async function dispatchAppShortcut(
  page: Page,
  key: string,
  options?: { shiftKey?: boolean },
) {
  await page.evaluate(
    ({ key, shiftKey }) => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          code: key === "?" ? "Slash" : `Digit${key}`,
          ctrlKey: true,
          key,
          metaKey: false,
          shiftKey,
        }),
      );
    },
    { key, shiftKey: options?.shiftKey ?? false },
  );
}

async function expectNoDocumentOverflow(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      ),
    )
    .toBeLessThanOrEqual(1);
}
