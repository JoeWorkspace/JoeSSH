import { expect, test, type Page } from "@playwright/test";
import {
  commonMarketLocales,
  expectedAtlasLocaleByMarketLocale,
  expectedTextDirectionByMarketLocale,
  expectContainsText,
  expectVisibleText,
  oneOf,
} from "./i18n";

test.describe("JoeSSH desktop workbench", () => {
  test("keeps the workbench stable across common display-scaling viewports", async ({
    page,
  }) => {
    const scaledViewports = [
      { height: 768, label: "1366x768 at 100%", width: 1366 },
      { height: 614, label: "1366x768 at 125%", width: 1093 },
      { height: 512, label: "1366x768 at 150%", width: 911 },
      { height: 720, label: "1920x1080 at 150%", width: 1280 },
      { height: 864, label: "1920x1080 at 125%", width: 1536 },
      { height: 617, label: "1920x1080 at 175%", width: 1097 },
      { height: 540, label: "1920x1080 at 200%", width: 960 },
      { height: 960, label: "2560x1440 at 150%", width: 1707 },
      { height: 1080, label: "3840x2160 at 200%", width: 1920 },
    ] as const;

    for (const viewport of scaledViewports) {
      await test.step(viewport.label, async () => {
        await page.setViewportSize({
          height: viewport.height,
          width: viewport.width,
        });
        await page.goto("/?lang=en");
        await page.getByRole("tab", { name: /staging-api/ }).click();

        const layout = await page.evaluate(() => {
          const bounds = (selector: string) => {
            const element = document.querySelector(selector);
            if (!(element instanceof HTMLElement))
              throw new Error(`Missing ${selector}`);
            const rect = element.getBoundingClientRect();
            return {
              bottom: rect.bottom,
              height: rect.height,
              left: rect.left,
              right: rect.right,
              top: rect.top,
              width: rect.width,
            };
          };
          const terminalTabTops = [
            ...document.querySelectorAll<HTMLElement>('.tabbar [role="tab"]'),
          ].map((tab) => Math.round(tab.getBoundingClientRect().top));

          return {
            context: bounds(".context-pane"),
            documentHeight: document.documentElement.scrollHeight,
            documentWidth: document.documentElement.scrollWidth,
            pane: bounds(".terminal-pane"),
            status: bounds(".statusbar"),
            terminal: bounds(".terminal-zone"),
            terminalGrid: bounds(".terminal-grid"),
            terminalTabTops,
            viewportHeight: window.innerHeight,
            viewportWidth: window.innerWidth,
          };
        });

        expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
        expect(layout.documentHeight).toBeLessThanOrEqual(
          layout.viewportHeight,
        );
        expect(new Set(layout.terminalTabTops).size).toBe(1);
        expect(layout.pane.width).toBeGreaterThanOrEqual(
          layout.terminalGrid.width - 24,
        );
        expect(layout.pane.height).toBeGreaterThan(180);
        expect(layout.status.bottom).toBeLessThanOrEqual(
          layout.viewportHeight + 1,
        );
        expect(layout.terminal.right).toBeLessThanOrEqual(
          layout.viewportWidth + 1,
        );
        expect(layout.context.right).toBeLessThanOrEqual(
          layout.viewportWidth + 1,
        );
      });
    }

    await test.step("short 150% viewport keeps both default terminal panes inside the terminal row", async () => {
      await page.setViewportSize({ height: 512, width: 911 });
      await page.goto("/?lang=en");
      await page.getByRole("tab", { name: /prod-edge-01/ }).click();
      await expect(page.locator(".context-pane")).toBeVisible();

      const layout = await page.evaluate(() => {
        const grid = document.querySelector<HTMLElement>(".terminal-grid");
        const context = document.querySelector<HTMLElement>(".context-pane");
        if (!grid || !context)
          throw new Error("Missing scaled workbench regions");
        const gridRect = grid.getBoundingClientRect();
        const contextRect = context.getBoundingClientRect();
        const panes = [
          ...grid.querySelectorAll<HTMLElement>(".terminal-pane"),
        ].map((pane) => {
          const rect = pane.getBoundingClientRect();
          return { bottom: rect.bottom, height: rect.height, top: rect.top };
        });
        return {
          contextTop: contextRect.top,
          gridBottom: gridRect.bottom,
          gridTop: gridRect.top,
          panes,
        };
      });

      expect(layout.panes).toHaveLength(2);
      expect(layout.panes.every((pane) => pane.height >= 100)).toBe(true);
      expect(layout.panes.every((pane) => pane.top >= layout.gridTop - 1)).toBe(
        true,
      );
      expect(
        layout.panes.every((pane) => pane.bottom <= layout.gridBottom + 1),
      ).toBe(true);
      expect(layout.gridBottom).toBeLessThanOrEqual(layout.contextTop + 1);
    });

    await test.step("900px split-terminal layout", async () => {
      await page.setViewportSize({ height: 768, width: 900 });
      await page.goto("/?lang=en");
      await page.getByRole("tab", { name: /prod-edge-01/ }).click();

      const splitLayout = await page.evaluate(() => {
        const grid = document.querySelector(".terminal-grid");
        if (!(grid instanceof HTMLElement))
          throw new Error("Missing terminal grid");
        const gridRect = grid.getBoundingClientRect();
        const panes = [
          ...grid.querySelectorAll<HTMLElement>(".terminal-pane"),
        ].map((pane) => {
          const rect = pane.getBoundingClientRect();
          return { bottom: rect.bottom, height: rect.height, top: rect.top };
        });
        return { gridBottom: gridRect.bottom, gridTop: gridRect.top, panes };
      });

      expect(splitLayout.panes).toHaveLength(2);
      expect(splitLayout.panes.every((pane) => pane.height >= 180)).toBe(true);
      expect(splitLayout.panes[0].top).toBeGreaterThanOrEqual(
        splitLayout.gridTop,
      );
      expect(splitLayout.panes[1].bottom).toBeLessThanOrEqual(
        splitLayout.gridBottom + 1,
      );
    });
  });

  test("keeps the 320px minimum viewport free of document-level horizontal overflow", async ({
    page,
  }) => {
    await page.setViewportSize({ height: 700, width: 320 });
    await page.goto("/?lang=en");

    const layout = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: window.innerWidth,
      workbenchWidth:
        document.querySelector<HTMLElement>(".workbench")?.scrollWidth ?? 0,
    }));

    expect(layout.documentWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.workbenchWidth).toBeLessThanOrEqual(layout.clientWidth);
    expect(layout.clientWidth).toBeLessThanOrEqual(layout.viewportWidth);
  });

  test("opens directly to the usable terminal workbench", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("JoeSSH", { exact: true })).toBeVisible();
    await expect(
      page.getByPlaceholder(
        oneOf(
          "搜索主机、标签、用户",
          "搜索主机、标签、成员",
          "Search hosts, tags, users",
        ),
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", {
        name: oneOf("终端标签", "Terminal tabs"),
      }),
    ).toBeVisible();
    await expectVisibleText(page, "网关终端", "gateway shell", "sample shell");
    await expectVisibleText(page, "指标监控", "metrics watch");
    await expect(
      page.getByText(
        oneOf(
          "运行命令、打开主机、启动流程",
          "Run command, open host, start workflow",
        ),
      ),
    ).toHaveCount(0);
  });

  test("opens onboarding help and toggles terminal focus mode", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    await page.getByRole("button", { name: "Getting started" }).click();
    const guide = page.getByRole("dialog", { name: "Getting started" });
    await expect(guide).toBeVisible();
    await expect(guide.getByText(/Desktop opens SSH sessions/)).toBeVisible();
    await expect(
      guide.getByText(/Never sends hosts, usernames, commands/),
    ).toBeVisible();
    await guide.getByRole("button", { name: "Close" }).last().click();
    await expect(guide).toHaveCount(0);

    await page.getByRole("button", { name: "Maximize terminal" }).click();
    await expect(page.locator(".workbench")).toHaveClass(/terminal-maximized/);
    await expect(page.locator(".sidebar")).toBeHidden();
    await expect(page.locator(".context-pane")).toBeHidden();

    await page.getByRole("button", { name: "Restore workspace" }).click();
    await expect(page.locator(".sidebar")).toBeVisible();
    await expect(page.locator(".context-pane")).toBeVisible();
  });

  test("executes navigation commands from the command palette", async ({
    page,
  }) => {
    await page.goto("/?lang=en");
    await page.getByRole("button", { name: "Command palette" }).click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("Open SFTP");
    await palette.getByRole("option", { name: /Open SFTP/ }).click();

    await expect(page.getByText("/srv/atlas")).toBeVisible();
    await expect(page.getByRole("tab", { name: "SFTP" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("switches context, SFTP, and settings panels", async ({ page }) => {
    await page.goto("/");

    await expectVisibleText(page, "会话上下文", "Session Context");

    await page
      .getByRole("tab", { name: oneOf("SFTP", "文件", "文件传输") })
      .click();
    await expect(page.getByText("/srv/atlas")).toBeVisible();
    await expect(page.getByText("release.tar.zst")).toBeVisible();

    await page.getByRole("tab", { name: oneOf("设置", "Settings") }).click();
    await expectVisibleText(page, "工作区设置", "Workspace Settings");
    await expectVisibleText(page, "导出连接", "Export connections");
    await expectVisibleText(page, "导入连接", "Import connections");
    await expect(page.getByText(oneOf("商业层", "Business Layer"))).toHaveCount(
      0,
    );
  });

  test("shows team access, shared vault, and audit context", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByRole("tab", { name: oneOf("团队", "Team") }).click();
    await expectVisibleText(page, "团队访问", "Team Access");
    await expectContainsText(
      page.locator(
        '.team-summary[aria-label="Team access summary"], .team-summary[aria-label="团队访问摘要"]',
      ),
      "JIT 生效",
      "JIT active",
    );
    await expectVisibleText(page, "生产提权", "Production elevation");
    await expectVisibleText(page, "共享保险库", "Shared Vault");
    await expectVisibleText(page, "生产 SSH", "Production SSH");
    await expectVisibleText(page, "成员角色", "Member Roles");
    await expectVisibleText(page, "审计轨迹", "Audit Trail");
  });

  test("reviews a pending team access request from the Team panel", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    await page.getByRole("tab", { name: "Team" }).click();
    await page.getByRole("button", { name: "Review" }).focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("region", { name: "Team access review" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Team access request status" }),
    ).toContainText("pending");

    await page.getByRole("button", { name: "Approve" }).focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("status", { name: "Team access request status" }),
    ).toContainText("Approved");
    await expect(
      page.locator('.team-summary[aria-label="Team access summary"]'),
    ).toContainText("2");
    await expect(page.getByText("Access request approved")).toBeVisible();
    await expect(page.getByText("maya.rao / prod-edge-01")).toBeVisible();
  });

  test("reviews a pending team access request in Simplified Chinese", async ({
    page,
  }) => {
    await page.goto("/?lang=zh-CN");
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-CN");

    await page.getByRole("tab", { name: "团队" }).click();
    await page.getByRole("button", { name: "审核" }).focus();
    await page.keyboard.press("Enter");

    await expect(page.getByRole("region", { name: "访问审查" })).toBeVisible();
    await expect(
      page.getByRole("status", { name: "访问请求状态" }),
    ).toContainText("待处理");

    await page.getByRole("button", { name: "批准" }).focus();
    await page.keyboard.press("Enter");

    await expect(
      page.getByRole("status", { name: "访问请求状态" }),
    ).toContainText("已批准");
    await expect(
      page.locator('.team-summary[aria-label="团队访问摘要"]'),
    ).toContainText("2");
    await expect(page.getByText("访问请求已批准")).toBeVisible();
    await expect(page.getByText("maya.rao / prod-edge-01")).toBeVisible();
  });

  test("opens and dismisses the command palette", async ({ page }) => {
    await page.goto("/?lang=en");
    await page.getByRole("button", { name: "Command palette" }).click();
    const paletteDialog = page.getByRole("dialog", { name: "Command palette" });
    const paletteInput = paletteDialog.getByRole("combobox");
    await expect(paletteDialog).toBeVisible();
    await expect(paletteInput).toBeVisible();
    await expectVisibleText(page, "Request elevated access");

    // Dismiss by clicking the scrim backdrop
    await page.evaluate(() => {
      const scrim = document.querySelector(".palette-scrim");
      if (scrim) (scrim as HTMLElement).click();
    });
    await expect(paletteDialog).toHaveCount(0);
  });

  test("opens new connection from Ctrl+N without exposing native quick connect in browser preview", async ({
    page,
  }) => {
    await page.goto("/?lang=en");
    await expect(
      page.getByRole("button", { name: "Command palette" }),
    ).toBeVisible();

    const newConnectionDialog = page.getByRole("dialog", {
      name: "New connection",
    });
    await expect
      .poll(
        async () => {
          if (await newConnectionDialog.isVisible()) {
            return true;
          }

          // Keep sending the real Ctrl+N event while the shortcut effect mounts.
          await dispatchAppShortcut(page, "n");
          return newConnectionDialog.isVisible();
        },
        { intervals: [100, 250, 500], timeout: 5_000 },
      )
      .toBe(true);
    await newConnectionDialog.getByRole("button", { name: "Close" }).click();

    await page.getByRole("button", { name: "Command palette" }).click();
    const palette = page.getByRole("dialog", { name: "Command palette" });
    await palette.getByRole("combobox").fill("ssh://example.internal");
    await expect(palette.getByText("Quick connect")).toHaveCount(0);
  });

  test("activates a connection from the command palette with Enter", async ({
    page,
  }) => {
    await page.goto("/?lang=en");
    await page.getByRole("button", { name: "Command palette" }).click();
    const paletteDialog = page.getByRole("dialog", { name: "Command palette" });
    const paletteInput = paletteDialog.getByRole("combobox");
    await expect(paletteDialog).toBeVisible();
    await expect(paletteInput).toBeVisible();

    await paletteInput.fill("staging-api");
    await page.keyboard.press("Enter");

    // Palette closes and the chosen connection becomes the active session
    await expect(paletteDialog).toHaveCount(0);
    await expect(page.locator(".session-title")).toContainText("staging-api");
  });

  test("keeps terminal command submission unavailable until a live SSH session exists", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    const commandInput = page.getByLabel("Terminal command");
    await expect(commandInput).toHaveCount(0);
    const activeTerminalLog = page.getByRole("log", { name: "sample shell" });
    await expect(activeTerminalLog).toBeVisible();
    await expect(activeTerminalLog).toContainText(
      "Sample fixture transcript - no SSH session is connected.",
    );
    await expect(page.getByText("No SSH session").first()).toBeVisible();
    await expect(activeTerminalLog).not.toContainText("whoami token=");
  });

  test("does not expose command history controls for sample no-session terminals", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    const commandInput = page.getByLabel("Terminal command");
    await expect(commandInput).toHaveCount(0);
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("log", { name: "sample shell" })).toBeVisible();
  });

  test("keeps selected connection and terminal prompt coherent", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    await page
      .getByRole("button", { name: /staging-api stg-api\.atlas/i })
      .click();
    await expect(page.locator(".session-title")).toContainText("staging-api");

    const stagingLog = page.getByRole("log", { name: "sample shell" });
    await expect(stagingLog).toContainText(
      "atlas@staging-api:~$ ssh stg-api.atlas",
    );
    await expect(stagingLog).toContainText(
      "Use Connect to open a real SSH session before running commands.",
    );

    await page.keyboard.press("Alt+1");
    await expect(page.locator(".session-title")).toContainText("prod-edge-01");

    const prodLog = page.getByRole("log", { name: "sample shell" });
    await expect(prodLog).toContainText(
      "atlas@prod-edge-01:~$ kubectl get pods -n gateway",
    );
    await expect(prodLog).not.toContainText(
      "atlas@staging-api:~$ ssh stg-api.atlas",
    );
  });

  test("opens a long custom connection in one truthful, responsive terminal tab", async ({
    page,
  }) => {
    const connectionName =
      "customer-edge-with-a-long-profile-name-for-scaled-displays";
    await page.addInitScript(
      ({ name }) => {
        window.localStorage.setItem(
          "atlasterm.customConnections",
          JSON.stringify([
            {
              group: "Production",
              host: "customer-edge.internal",
              name,
              tags: ["custom"],
            },
          ]),
        );
      },
      { name: connectionName },
    );
    await page.setViewportSize({ height: 512, width: 911 });
    await page.goto("/?lang=en");

    const connectionButton = page.getByRole("button", {
      name: new RegExp(connectionName),
    });
    await expect(
      connectionButton.getByRole("img", { name: "Sample data" }),
    ).toBeVisible();
    await connectionButton.click();

    const customTab = page.getByRole("tab", { name: connectionName });
    await expect(customTab).toHaveCount(1);
    await expect(customTab).toHaveAttribute("aria-selected", "true");
    await expect(customTab).toHaveAttribute("title", connectionName);
    await expect(page.locator(".session-title")).toContainText(
      "Demo sample - no real SSH session",
    );

    await connectionButton.click();
    await expect(page.getByRole("tab", { name: connectionName })).toHaveCount(
      1,
    );

    await page.reload();
    await expect(page.getByRole("tab", { name: connectionName })).toHaveCount(
      1,
    );
    await expect(
      page.getByRole("tab", { name: connectionName }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.locator(".session-title")).toContainText(connectionName);

    const layout = await page.evaluate(() => {
      const label = document.querySelector<HTMLElement>(
        '.tabbar [aria-selected="true"] > span',
      );
      return {
        documentWidth: document.documentElement.scrollWidth,
        labelClientWidth: label?.clientWidth ?? 0,
        labelScrollWidth: label?.scrollWidth ?? 0,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    expect(layout.labelScrollWidth).toBeGreaterThan(layout.labelClientWidth);
  });

  test("keeps the Chinese default path and English regional path testable", async ({
    browser,
    baseURL,
  }) => {
    const zhContext = await browser.newContext({ baseURL, locale: "zh-CN" });
    const zhPage = await zhContext.newPage();
    await zhPage.goto("/");
    await expect(zhPage.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(zhPage.getByText("JoeSSH", { exact: true })).toBeVisible();
    await expect(
      zhPage.getByPlaceholder(
        oneOf(
          "搜索主机、标签、用户",
          "搜索主机、标签、成员",
          "Search hosts, tags, users",
        ),
      ),
    ).toBeVisible();
    await zhContext.close();

    const enContext = await browser.newContext({ baseURL, locale: "en-US" });
    const enPage = await enContext.newPage();
    await enPage.goto("/");
    await expect(enPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      enPage.getByRole("navigation", {
        name: /Terminal tabs|Terminal sessions/i,
      }),
    ).toBeVisible();
    await expect(
      enPage.getByRole("button", { name: /Command palette/i }),
    ).toBeVisible();
    await enContext.close();
  });

  test("enforces strict core localization paths @i18n-strict", async ({
    browser,
    baseURL,
  }) => {
    const zhContext = await browser.newContext({ baseURL, locale: "zh-CN" });
    const zhPage = await zhContext.newPage();
    await zhPage.goto("/");
    await expect(zhPage.locator("html")).toHaveAttribute("lang", "zh-CN");
    await expect(zhPage.locator("html")).toHaveAttribute("dir", "ltr");
    await expect(zhPage.getByPlaceholder("搜索主机、标签、成员")).toBeVisible();
    await expect(
      zhPage.getByRole("button", { name: "命令面板" }),
    ).toBeVisible();
    await zhContext.close();

    const enContext = await browser.newContext({ baseURL, locale: "en-US" });
    const enPage = await enContext.newPage();
    await enPage.goto("/");
    await expect(enPage.locator("html")).toHaveAttribute("lang", "en");
    await expect(
      enPage.getByRole("button", { name: "Command palette" }),
    ).toBeVisible();
    await expect(
      enPage.getByPlaceholder("Search hosts, tags, users"),
    ).toBeVisible();
    await expect(enPage.getByText("搜索主机、标签、成员")).toHaveCount(0);
    await enContext.close();

    const arContext = await browser.newContext({ baseURL, locale: "ar-SA" });
    const arPage = await arContext.newPage();
    await arPage.goto("/");
    await expect(arPage.locator("html")).toHaveAttribute("lang", "ar");
    await expect(arPage.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(arPage.locator("pre").first()).toHaveAttribute("dir", "ltr");
    await expect(arPage.getByText("prod-edge-01").first()).toBeVisible();
    await arContext.close();
  });

  test("renders the workbench shell under common market locales", async ({
    browser,
    baseURL,
  }) => {
    for (const locale of commonMarketLocales) {
      const context = await browser.newContext({ baseURL, locale });
      const localePage = await context.newPage();
      await localePage.goto("/");

      await expect(
        localePage.getByText("JoeSSH", { exact: true }),
      ).toBeVisible();
      await expect(localePage.locator("html")).toHaveAttribute(
        "lang",
        expectedAtlasLocaleByMarketLocale[locale],
      );
      await expect(localePage.locator("html")).toHaveAttribute(
        "dir",
        expectedTextDirectionByMarketLocale[locale],
      );
      await expect(localePage.locator("pre").first()).toHaveAttribute(
        "dir",
        "ltr",
      );
      await expect(localePage.getByText("prod-edge-01").first()).toBeVisible();

      await context.close();
    }
  });

  test("manages custom connection groups via group manager", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    // Open group manager via the Boxes icon button
    await page.getByRole("button", { name: /Manage Groups/i }).click();
    await expect(
      page.getByText(/Manage connection groups|Create/i),
    ).toBeVisible();

    // Create a new group
    const groupInput = page.getByPlaceholder(/New group name|新分组名称/i);
    await groupInput.fill("My Custom Group");
    await page.getByRole("button", { name: /Create|创建/i }).click();

    // Verify group appears in the list
    await expect(
      page.getByText("My Custom Group", { exact: true }),
    ).toBeVisible();
  });

  test("shows recording indicator in terminal header", async ({ page }) => {
    await page.goto("/?lang=en");

    // The recording toggle button should exist
    const recordButton = page.getByRole("button", {
      name: /Toggle recording|录制|Start recording/i,
    });
    await expect(recordButton).toBeVisible();
    await expect(recordButton).toBeDisabled();
  });

  test("terminal autocomplete stays hidden without a live SSH command input", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    const commandInput = page.getByLabel("Terminal command");
    await expect(commandInput).toHaveCount(0);
    await expect(page.locator(".terminal-autocomplete")).toHaveCount(0);
  });

  test("persists sidebar collapse state across reload", async ({ page }) => {
    await page.goto("/?lang=en");

    // Ensure page has focus
    await page.click("body");

    // Collapse sidebar via keyboard shortcut (Ctrl+B)
    await page.keyboard.down("Control");
    await page.keyboard.press("b");
    await page.keyboard.up("Control");

    // Sidebar should be collapsed
    await expect(page.locator(".sidebar.is-collapsed")).toBeVisible({
      timeout: 3000,
    });

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator(".sidebar.is-collapsed")).toBeVisible({
      timeout: 3000,
    });
  });

  test("persists connection drag order across reload", async ({ page }) => {
    await page.goto("/?lang=en");

    const productionGroup = page.getByRole("list", { name: "Production" });
    const prodEdge01 = productionGroup.getByRole("button", {
      name: /prod-edge-01/i,
    });
    const prodEdge02 = productionGroup.getByRole("button", {
      name: /prod-edge-02/i,
    });

    await expect(prodEdge01).toBeVisible();
    await expect(prodEdge02).toBeVisible();
    await expect(productionGroup.getByRole("listitem").first()).toContainText(
      "prod-edge-01",
    );

    await prodEdge02.dragTo(prodEdge01);
    await expect(productionGroup.getByRole("listitem").first()).toContainText(
      "prod-edge-02",
    );

    await page.reload();
    await expect(productionGroup.getByRole("listitem").first()).toContainText(
      "prod-edge-02",
    );
    await expect(productionGroup.getByRole("listitem").nth(1)).toContainText(
      "prod-edge-01",
    );
  });

  test("persists connection keyboard reorder across reload", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    const productionGroup = page.getByRole("list", { name: "Production" });
    const prodEdge01 = productionGroup.getByRole("button", {
      name: /prod-edge-01/i,
    });

    await expect(productionGroup.getByRole("listitem").first()).toContainText(
      "prod-edge-01",
    );
    await expect(prodEdge01).toHaveAttribute(
      "aria-keyshortcuts",
      /Alt\+ArrowUp/,
    );

    await prodEdge01.focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(productionGroup.getByRole("listitem").first()).toContainText(
      "prod-edge-02",
    );
    await expect(productionGroup.getByRole("listitem").nth(1)).toContainText(
      "prod-edge-01",
    );

    await page.reload();
    await expect(productionGroup.getByRole("listitem").first()).toContainText(
      "prod-edge-02",
    );
    await expect(productionGroup.getByRole("listitem").nth(1)).toContainText(
      "prod-edge-01",
    );

    await prodEdge01.focus();
    await page.keyboard.press("Alt+ArrowUp");
    await expect(productionGroup.getByRole("listitem").first()).toContainText(
      "prod-edge-01",
    );
    await expect(productionGroup.getByRole("listitem").nth(1)).toContainText(
      "prod-edge-02",
    );

    await page.reload();
    await expect(productionGroup.getByRole("listitem").first()).toContainText(
      "prod-edge-01",
    );
    await expect(productionGroup.getByRole("listitem").nth(1)).toContainText(
      "prod-edge-02",
    );
  });

  test("context menu has move-to-group submenu for connections", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    // Right-click on a connection to open context menu
    const connection = page.getByText("prod-edge-01").first();
    await connection.click({ button: "right" });

    // Context menu should appear with Move to group option
    await expect(page.getByText(/Move to group|移动到分组/i)).toBeVisible();
  });

  test("persists connection move-to-group changes across reload", async ({
    page,
  }) => {
    await page.goto("/?lang=en");

    await page.getByText("prod-edge-01").first().click({ button: "right" });
    await page.getByRole("menuitem", { name: /Move to group/i }).click();
    await page.getByRole("menuitem", { name: "Staging" }).click();

    const stagingGroup = page.getByRole("list", { name: "Staging" });
    await expect(
      stagingGroup.getByRole("button", { name: /prod-edge-01/i }),
    ).toBeVisible();

    await page.reload();
    await expect(
      stagingGroup.getByRole("button", { name: /prod-edge-01/i }),
    ).toBeVisible();
  });

  test("persists custom connection move-to-group changes across reload", async ({
    page,
  }) => {
    const customName = "customer-group-persistence";
    await page.addInitScript(
      ({ name }) => {
        window.localStorage.setItem(
          "atlasterm.customConnections",
          JSON.stringify([
            {
              group: "Production",
              host: "customer-group.internal",
              name,
              tags: ["custom"],
            },
          ]),
        );
      },
      { name: customName },
    );
    await page.goto("/?lang=en");

    await page
      .getByRole("button", { name: new RegExp(customName) })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: /Move to group/i }).click();
    await page.getByRole("menuitem", { name: "Staging" }).click();

    const stagingGroup = page.getByRole("list", { name: "Staging" });
    await expect(
      stagingGroup.getByRole("button", { name: new RegExp(customName) }),
    ).toBeVisible();

    await page.reload();
    await expect(
      stagingGroup.getByRole("button", { name: new RegExp(customName) }),
    ).toBeVisible();
  });

  test("connection context menu exposes only executable actions and stays inside the viewport", async ({
    page,
  }) => {
    const customName = "customer-ops";
    await page.addInitScript(
      ({ name }) => {
        window.localStorage.setItem(
          "atlasterm.customConnections",
          JSON.stringify([
            {
              group: "Production",
              host: "customer-ops.internal",
              name,
              tags: ["custom"],
            },
          ]),
        );
      },
      { name: customName },
    );
    await page.goto("/?lang=en");

    const connection = page.getByText("prod-edge-01").first();
    await connection.click({ button: "right" });

    await expect(
      page.getByRole("menuitem", { name: "Connect", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: /Test connection/i }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("menuitem", { name: /Edit connection/i }),
    ).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: /Delete/i })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("menuitem", { name: /Duplicate|复制/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("menuitem", { name: /Copy SSH command|SSH/i }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    const customConnection = page.getByRole("button", {
      name: new RegExp(customName),
    });
    await customConnection.evaluate((element) => {
      element.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX: 898,
          clientY: 766,
        }),
      );
    });
    await expect(
      page.getByRole("menuitem", { name: /Edit connection/i }),
    ).toBeVisible();
    await expect(page.getByRole("menuitem", { name: /Delete/i })).toBeVisible();

    const menuBounds = await page.getByRole("menu").evaluate((menu) => {
      const rect = menu.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        right: rect.right,
        viewportHeight: window.innerHeight,
        viewportWidth: window.innerWidth,
      };
    });
    expect(menuBounds.right).toBeLessThanOrEqual(menuBounds.viewportWidth - 7);
    expect(menuBounds.bottom).toBeLessThanOrEqual(
      menuBounds.viewportHeight - 7,
    );
  });

  test("toggles theme with keyboard shortcut", async ({ page }) => {
    await page.goto("/?lang=en");

    // Wait until the workbench shell is interactive so the keydown listener is mounted
    await expect(page.getByText("JoeSSH", { exact: true })).toBeVisible();

    // Theme should not have data-theme initially (system default)
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");

    // Press Ctrl+Shift+T to cycle to dark
    await dispatchThemeShortcutUntil(page, "dark");

    // Press again to cycle to light
    await dispatchThemeShortcutUntil(page, "light");

    // Press again to cycle back to system (no attribute)
    await dispatchThemeShortcutUntil(page, null);
  });

  test("explicit dark theme overrides light operating-system tokens", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/?lang=en");
    await expect(page.getByText("JoeSSH", { exact: true })).toBeVisible();

    await expect
      .poll(() =>
        page
          .locator("html")
          .evaluate((element) =>
            getComputedStyle(element)
              .getPropertyValue("--atlas-bg")
              .trim(),
          ),
      )
      .toBe("#f3f6f7");

    await dispatchThemeShortcutUntil(page, "dark");

    const colors = await page.evaluate(() => {
      const rootStyle = getComputedStyle(document.documentElement);
      const terminal = document.querySelector<HTMLElement>(
        ".terminal-pane pre",
      );

      return {
        background: rootStyle.getPropertyValue("--atlas-bg").trim(),
        terminalText: rootStyle
          .getPropertyValue("--atlas-terminal-text")
          .trim(),
        renderedTerminalText: terminal
          ? getComputedStyle(terminal).color
          : null,
      };
    });

    expect(colors).toEqual({
      background: "#080d12",
      terminalText: "#d9f7ec",
      renderedTerminalText: "rgb(217, 247, 236)",
    });
  });

  test("switches right panel with Ctrl+number shortcuts", async ({ page }) => {
    await page.goto("/?lang=en");

    // Default panel is inspector (Ctrl+1)
    await expect(page.getByText("Session Context")).toBeVisible();

    // Switch to SFTP panel with Ctrl+2
    await dispatchAppShortcut(page, "2");
    await expect(
      page.getByText("SFTP", { exact: false }).first(),
    ).toBeVisible();

    // Switch to Team panel with Ctrl+3
    await dispatchAppShortcut(page, "3");
    await expect(page.getByText(/Team|团队/).first()).toBeVisible();

    // Switch to Forwarding panel with Ctrl+4
    await dispatchAppShortcut(page, "4");
    await expect(page.getByText(/Forwarding|端口转发/).first()).toBeVisible();

    // Switch to Settings panel with Ctrl+5
    await dispatchAppShortcut(page, "5");
    await expect(page.getByText(/Settings|设置/).first()).toBeVisible();
  });

  test("sidebar search filters connections", async ({ page }) => {
    await page.goto("/?lang=en");

    // Type in the sidebar search field
    const searchInput = page.getByPlaceholder("Search hosts, tags, users");
    await searchInput.fill("db");

    // db connections should be visible in the sidebar connection list
    await expect(
      page.getByRole("button", { name: /db-primary/i }),
    ).toBeVisible();

    // prod connections should be filtered out
    await expect(
      page.getByRole("button", { name: /prod-edge-01/i }),
    ).toHaveCount(0);

    // Clear search — all connections should reappear
    await searchInput.clear();
    await expect(
      page.getByRole("button", { name: /prod-edge-01/i }),
    ).toBeVisible();
  });

  test("favorites star toggle persists across reload", async ({ page }) => {
    await page.goto("/?lang=en");

    // Find the favorite button for db-replica-03 (locked connection)
    const favButton = page
      .getByRole("button", { name: /Add to favorites|Remove from favorites/i })
      .first();
    await favButton.click();

    // Reload and verify the favorite persisted
    await page.reload();
    const favButtonAfterReload = page
      .getByRole("button", { name: /Add to favorites|Remove from favorites/i })
      .first();
    await expect(favButtonAfterReload).toBeVisible();
  });

  test("tag filters narrow sidebar connections", async ({ page }) => {
    await page.goto("/?lang=en");

    // Click the "database" tag filter chip (use exact match to avoid matching connection buttons)
    const dbTag = page.getByRole("button", { name: "database", exact: true });
    await expect(dbTag).toBeVisible();
    await dbTag.click();

    // Only database connections should remain visible in the sidebar
    await expect(
      page.getByRole("button", { name: /db-primary/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /db-replica-03/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /prod-edge-01/i }),
    ).toHaveCount(0);

    // Click the tag again to deselect — all connections reappear
    await dbTag.click();
    await expect(
      page.getByRole("button", { name: /prod-edge-01/i }),
    ).toBeVisible();
  });

  test("opens terminal search with Ctrl+F", async ({ page }) => {
    await page.goto("/?lang=en");

    // Ensure page has focus
    await page.click("body");

    // Open search via Ctrl+F using keyboard
    await page.keyboard.down("Control");
    await page.keyboard.press("f");
    await page.keyboard.up("Control");

    // Search input should appear inside the terminal search bar
    const searchInput = page.locator(".terminal-search-bar input");
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    // Type a query — matching lines should remain visible
    await searchInput.fill("kubectl");
    await expect(page.getByRole("log", { name: "sample shell" })).toContainText(
      "kubectl",
    );

    // Close search with Escape
    await page.keyboard.press("Escape");
    await expect(searchInput).toHaveCount(0);
  });

  test("toast appears after a successful action", async ({ page }) => {
    await page.goto("/?lang=en");

    // Duplicate is available in browser preview and reports the completed local action.
    await page
      .getByRole("button", { name: /prod-edge-01/i })
      .click({ button: "right" });
    await page.getByRole("menuitem", { name: /Duplicate/i }).click();

    // Toast container should show a status message
    const toast = page.locator('.toast-container [role="status"]');
    await expect(toast.first()).toBeVisible({ timeout: 3000 });
  });
});

async function dispatchAppShortcut(
  page: Page,
  key: string,
  options?: { shiftKey?: boolean },
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(
        ({ code, key, shiftKey }) => {
          window.dispatchEvent(
            new KeyboardEvent("keydown", {
              bubbles: true,
              cancelable: true,
              code,
              ctrlKey: true,
              key,
              metaKey: false,
              shiftKey,
            }),
          );
        },
        {
          code: getSyntheticShortcutCode(key),
          key,
          shiftKey: options?.shiftKey ?? false,
        },
      );
      return;
    } catch (error) {
      if (
        !String(error).includes("Execution context was destroyed") ||
        attempt === 2
      ) {
        throw error;
      }
      await page.waitForLoadState("domcontentloaded");
    }
  }
}

async function dispatchThemeShortcutUntil(
  page: Page,
  expectedTheme: "dark" | "light" | null,
) {
  const html = page.locator("html");
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await dispatchAppShortcut(page, "T", { shiftKey: true });
    try {
      await expect
        .poll(() => html.getAttribute("data-theme"), { timeout: 750 })
        .toBe(expectedTheme);
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await page.waitForTimeout(100);
    }
  }
}

function getSyntheticShortcutCode(key: string) {
  if (/^[a-z]$/i.test(key)) {
    return `Key${key.toUpperCase()}`;
  }

  if (/^\d$/.test(key)) {
    return `Digit${key}`;
  }

  return key;
}
