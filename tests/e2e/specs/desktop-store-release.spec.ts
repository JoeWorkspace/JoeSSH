import { expect, test, type Page } from "@playwright/test";

test.describe("Microsoft Store release surface", () => {
  test("onboarding routes a sample host to creation before asking for credentials", async ({
    page,
  }) => {
    await installOnboardingRuntimeMock(page);
    await page.goto("/?lang=en");
    await openOnboardingConnect(page);

    const createDialog = page.getByRole("dialog", { name: "New connection" });
    await expect(createDialog).toBeVisible();
    await expect(
      page.getByRole("dialog", { name: "Connect to host" }),
    ).toHaveCount(0);
    await expect(createDialog.getByLabel("Host", { exact: true })).toHaveValue(
      "",
    );
    await createDialog.getByLabel("Name", { exact: true }).fill("My test host");
    await createDialog
      .getByLabel("Host", { exact: true })
      .fill("198.51.100.10");
    await createDialog.getByLabel("Port", { exact: true }).fill("2222");
    await createDialog.getByLabel("User", { exact: true }).fill("tester");
    await createDialog
      .getByRole("button", { name: "Create connection", exact: true })
      .click();

    await expectConnectTarget(page, "198.51.100.10", "2222", "tester");
    await expectNoConnectionAttempt(page);
  });

  test("onboarding keeps an existing custom host selected", async ({
    page,
  }) => {
    await installOnboardingRuntimeMock(page);
    await page.addInitScript(() => {
      localStorage.setItem(
        "atlasterm.customConnections",
        JSON.stringify([
          {
            name: "Saved test host",
            host: "198.51.100.20",
            port: 2200,
            username: "saved-user",
            group: "Test",
            tags: [],
          },
        ]),
      );
      localStorage.setItem(
        "atlasterm.layout",
        JSON.stringify({
          activeConnection: "Saved test host",
          activeTab: 0,
          rightPanel: "inspector",
          sidebarCollapsed: false,
        }),
      );
    });
    await page.goto("/?lang=en");
    await openOnboardingConnect(page);

    await expectConnectTarget(page, "198.51.100.20", "2200", "saved-user");
    await expect(
      page.getByRole("dialog", { name: "New connection" }),
    ).toHaveCount(0);
    await expectNoConnectionAttempt(page);
  });

  for (const target of [
    {
      name: "new host",
      url: "ssh://quick-user@198.51.100.30:2223",
      host: "198.51.100.30",
      port: "2223",
      username: "quick-user",
    },
    {
      name: "host matching a built-in sample",
      url: "ssh://10.48.12.11",
      host: "10.48.12.11",
      port: "22",
      username: "",
    },
  ]) {
    test(`onboarding keeps a Quick Connect ${target.name} selected`, async ({
      page,
    }) => {
      await installOnboardingRuntimeMock(page);
      await page.goto("/?lang=en&onboarding=0");
      await page
        .getByRole("button", { name: "Command palette", exact: true })
        .click();
      const palette = page.getByRole("dialog", { name: "Command palette" });
      await palette.getByRole("combobox").fill(target.url);
      await palette.getByRole("option").first().click();
      const connectDialog = page.getByRole("dialog", {
        name: "Connect to host",
      });
      await expectConnectTarget(
        page,
        target.host,
        target.port,
        target.username,
      );
      await connectDialog
        .getByRole("button", { name: "Close", exact: true })
        .click();
      await page
        .getByRole("button", { name: "Getting started", exact: true })
        .click();
      await openOnboardingConnect(page);

      await expectConnectTarget(
        page,
        target.host,
        target.port,
        target.username,
      );
      await expect(
        page.getByRole("dialog", { name: "New connection" }),
      ).toHaveCount(0);
      await expectNoConnectionAttempt(page);
    });
  }

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

// Browser behavior evidence only: no SSH server or authentication is contacted.
async function installOnboardingRuntimeMock(page: Page) {
  await page.addInitScript(() => {
    const commandNames: string[] = [];
    Object.defineProperty(window, "__onboardingCommandNames", {
      value: commandNames,
    });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async (command: string) => {
          commandNames.push(command);
          if (command === "known_hosts_list") return [];
          throw new Error(`Unexpected mock command: ${command}`);
        },
      },
    });
  });
}

async function openOnboardingConnect(page: Page) {
  const guide = page.getByRole("dialog", { name: "Getting started" });
  await expect(guide).toBeVisible();
  await guide
    .getByRole("button", { name: "2 Secure the connection", exact: true })
    .click();
  await guide
    .getByRole("button", { name: "Open Connect", exact: true })
    .click();
}

async function expectConnectTarget(
  page: Page,
  host: string,
  port: string,
  username: string,
) {
  const dialog = page.getByRole("dialog", { name: "Connect to host" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Host", { exact: true })).toHaveValue(host);
  await expect(dialog.getByLabel("Port", { exact: true })).toHaveValue(port);
  await expect(dialog.getByLabel("User", { exact: true })).toHaveValue(
    username,
  );
  await expect(dialog.getByLabel("Password", { exact: true })).toHaveValue("");
}

async function expectNoConnectionAttempt(page: Page) {
  const commandNames = await page.evaluate(
    () =>
      (window as unknown as { __onboardingCommandNames: string[] })
        .__onboardingCommandNames,
  );
  expect(commandNames).not.toContain("ssh_host_key_probe");
  expect(commandNames).not.toContain("ssh_connect");
}

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
