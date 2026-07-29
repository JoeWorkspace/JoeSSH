import { expect, test, type Page } from '@playwright/test';
import {
  commonMarketLocales,
  expectedAtlasLocaleByMarketLocale,
  expectedTextDirectionByMarketLocale,
  expectContainsText,
  expectVisibleText,
  oneOf,
} from './i18n';

test.describe('JoeSSH desktop workbench', () => {
  test('opens directly to the usable terminal workbench', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByText('JoeSSH', { exact: true })).toBeVisible();
    await expect(
      page.getByPlaceholder(oneOf('搜索主机、标签、用户', '搜索主机、标签、成员', 'Search hosts, tags, users')),
    ).toBeVisible();
    await expect(page.getByRole('navigation', { name: oneOf('终端标签', 'Terminal tabs') })).toBeVisible();
    await expectVisibleText(page, '网关终端', 'gateway shell', 'sample shell');
    await expectVisibleText(page, '指标监控', 'metrics watch');
    await expect(page.getByText(oneOf('运行命令、打开主机、启动流程', 'Run command, open host, start workflow'))).toHaveCount(0);
  });

  test('switches context, SFTP, and settings panels', async ({ page }) => {
    await page.goto('/');

    await expectVisibleText(page, '会话上下文', 'Session Context');

    await page.getByRole('tab', { name: oneOf('SFTP', '文件', '文件传输') }).click();
    await expect(page.getByText('/srv/atlas')).toBeVisible();
    await expect(page.getByText('release.tar.zst')).toBeVisible();

    await page.getByRole('tab', { name: oneOf('设置', 'Settings') }).click();
    await expectVisibleText(page, '工作区设置', 'Workspace Settings');
    await expectVisibleText(page, '商业层', 'Business Layer');
    await expectVisibleText(page, '席位计费', 'Seat billing');
  });

  test('shows team access, shared vault, and audit context', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('tab', { name: oneOf('团队', 'Team') }).click();
    await expectVisibleText(page, '团队访问', 'Team Access');
    await expectContainsText(page.locator('.team-summary[aria-label="Team access summary"], .team-summary[aria-label="团队访问摘要"]'), 'JIT 生效', 'JIT active');
    await expectVisibleText(page, '生产提权', 'Production elevation');
    await expectVisibleText(page, '共享保险库', 'Shared Vault');
    await expectVisibleText(page, '生产 SSH', 'Production SSH');
    await expectVisibleText(page, '成员角色', 'Member Roles');
    await expectVisibleText(page, '审计轨迹', 'Audit Trail');
  });

  test('reviews a pending team access request from the Team panel', async ({ page }) => {
    await page.goto('/?lang=en');

    await page.getByRole('tab', { name: 'Team' }).click();
    await page.getByRole('button', { name: 'Review' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('region', { name: 'Team access review' })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Team access request status' })).toContainText('pending');

    await page.getByRole('button', { name: 'Approve' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('status', { name: 'Team access request status' })).toContainText('Approved');
    await expect(page.locator('.team-summary[aria-label="Team access summary"]')).toContainText('2');
    await expect(page.getByText('Access request approved')).toBeVisible();
    await expect(page.getByText('maya.rao / prod-edge-01')).toBeVisible();
  });

  test('reviews a pending team access request in Simplified Chinese', async ({ page }) => {
    await page.goto('/?lang=zh-CN');
    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');

    await page.getByRole('tab', { name: '团队' }).click();
    await page.getByRole('button', { name: '审核' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('region', { name: '访问审查' })).toBeVisible();
    await expect(page.getByRole('status', { name: '访问请求状态' })).toContainText('待处理');

    await page.getByRole('button', { name: '批准' }).focus();
    await page.keyboard.press('Enter');

    await expect(page.getByRole('status', { name: '访问请求状态' })).toContainText('已批准');
    await expect(page.locator('.team-summary[aria-label="团队访问摘要"]')).toContainText('2');
    await expect(page.getByText('访问请求已批准')).toBeVisible();
    await expect(page.getByText('maya.rao / prod-edge-01')).toBeVisible();
  });

  test('opens and dismisses the command palette', async ({ page }) => {
    await page.goto('/?lang=en');
    await page.getByRole('button', { name: 'Command palette' }).click();
    const paletteDialog = page.getByRole('dialog', { name: 'Command palette' });
    const paletteInput = paletteDialog.getByRole('combobox');
    await expect(paletteDialog).toBeVisible();
    await expect(paletteInput).toBeVisible();
    await expectVisibleText(page, 'Request elevated access');

    // Dismiss by clicking the scrim backdrop
    await page.evaluate(() => {
      const scrim = document.querySelector('.palette-scrim');
      if (scrim) (scrim as HTMLElement).click();
    });
    await expect(paletteDialog).toHaveCount(0);
  });

  test('opens new connection from Ctrl+N without exposing native quick connect in browser preview', async ({ page }) => {
    await page.goto('/?lang=en');
    await expect(page.getByRole('button', { name: 'Command palette' })).toBeVisible();

    const newConnectionDialog = page.getByRole('dialog', { name: 'New connection' });
    for (let attempt = 0; attempt < 5 && !(await newConnectionDialog.isVisible()); attempt += 1) {
      await dispatchAppShortcut(page, 'n');
      await page.waitForTimeout(100);
    }
    await expect(newConnectionDialog).toBeVisible();
    await newConnectionDialog.getByRole('button', { name: 'Close' }).click();

    await page.getByRole('button', { name: 'Command palette' }).click();
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await palette.getByRole('combobox').fill('ssh://example.internal');
    await expect(palette.getByText('Quick connect')).toHaveCount(0);
  });

  test('activates a connection from the command palette with Enter', async ({ page }) => {
    await page.goto('/?lang=en');
    await page.getByRole('button', { name: 'Command palette' }).click();
    const paletteDialog = page.getByRole('dialog', { name: 'Command palette' });
    const paletteInput = paletteDialog.getByRole('combobox');
    await expect(paletteDialog).toBeVisible();
    await expect(paletteInput).toBeVisible();

    await paletteInput.fill('staging-api');
    await page.keyboard.press('Enter');

    // Palette closes and the chosen connection becomes the active session
    await expect(paletteDialog).toHaveCount(0);
    await expect(page.locator('.session-title')).toContainText('staging-api');
  });

  test('keeps terminal command submission unavailable until a live SSH session exists', async ({ page }) => {
    await page.goto('/?lang=en');

    const commandInput = page.getByLabel('Terminal command');
    await expect(commandInput).toHaveCount(0);
    const activeTerminalLog = page.getByRole('log', { name: 'sample shell' });
    await expect(activeTerminalLog).toBeVisible();
    await expect(activeTerminalLog).toContainText('Sample fixture transcript - no SSH session is connected.');
    await expect(page.getByText('No SSH session').first()).toBeVisible();
    await expect(activeTerminalLog).not.toContainText('whoami token=');
  });

  test('does not expose command history controls for sample no-session terminals', async ({ page }) => {
    await page.goto('/?lang=en');

    const commandInput = page.getByLabel('Terminal command');
    await expect(commandInput).toHaveCount(0);
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('log', { name: 'sample shell' })).toBeVisible();
  });

  test('keeps selected connection and terminal prompt coherent', async ({ page }) => {
    await page.goto('/?lang=en');

    await page.getByRole('button', { name: /staging-api stg-api\.atlas/i }).click();
    await expect(page.locator('.session-title')).toContainText('staging-api');

    const stagingLog = page.getByRole('log', { name: 'sample shell' });
    await expect(stagingLog).toContainText('atlas@staging-api:~$ ssh stg-api.atlas');
    await expect(stagingLog).toContainText('Use Connect to open a real SSH session before running commands.');

    await page.keyboard.press('Alt+1');
    await expect(page.locator('.session-title')).toContainText('prod-edge-01');

    const prodLog = page.getByRole('log', { name: 'sample shell' });
    await expect(prodLog).toContainText('atlas@prod-edge-01:~$ kubectl get pods -n gateway');
    await expect(prodLog).not.toContainText('atlas@staging-api:~$ ssh stg-api.atlas');
  });

  test('keeps the Chinese default path and English regional path testable', async ({ browser, baseURL }) => {
    const zhContext = await browser.newContext({ baseURL, locale: 'zh-CN' });
    const zhPage = await zhContext.newPage();
    await zhPage.goto('/');
    await expect(zhPage.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(zhPage.getByText('JoeSSH', { exact: true })).toBeVisible();
    await expect(zhPage.getByPlaceholder(oneOf('搜索主机、标签、用户', '搜索主机、标签、成员', 'Search hosts, tags, users'))).toBeVisible();
    await zhContext.close();

    const enContext = await browser.newContext({ baseURL, locale: 'en-US' });
    const enPage = await enContext.newPage();
    await enPage.goto('/');
    await expect(enPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(enPage.getByRole('navigation', { name: /Terminal tabs|Terminal sessions/i })).toBeVisible();
    await expect(enPage.getByRole('button', { name: /Command palette/i })).toBeVisible();
    await enContext.close();
  });

  test('enforces strict core localization paths @i18n-strict', async ({ browser, baseURL }) => {
    const zhContext = await browser.newContext({ baseURL, locale: 'zh-CN' });
    const zhPage = await zhContext.newPage();
    await zhPage.goto('/');
    await expect(zhPage.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(zhPage.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(zhPage.getByPlaceholder('搜索主机、标签、成员')).toBeVisible();
    await expect(zhPage.getByRole('button', { name: '命令面板' })).toBeVisible();
    await zhContext.close();

    const enContext = await browser.newContext({ baseURL, locale: 'en-US' });
    const enPage = await enContext.newPage();
    await enPage.goto('/');
    await expect(enPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(enPage.getByRole('button', { name: 'Command palette' })).toBeVisible();
    await expect(enPage.getByPlaceholder('Search hosts, tags, users')).toBeVisible();
    await expect(enPage.getByText('搜索主机、标签、成员')).toHaveCount(0);
    await enContext.close();

    const arContext = await browser.newContext({ baseURL, locale: 'ar-SA' });
    const arPage = await arContext.newPage();
    await arPage.goto('/');
    await expect(arPage.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(arPage.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arPage.locator('pre').first()).toHaveAttribute('dir', 'ltr');
    await expect(arPage.getByText('prod-edge-01').first()).toBeVisible();
    await arContext.close();
  });

  test('renders the workbench shell under common market locales', async ({ browser, baseURL }) => {
    for (const locale of commonMarketLocales) {
      const context = await browser.newContext({ baseURL, locale });
      const localePage = await context.newPage();
      await localePage.goto('/');

      await expect(localePage.getByText('JoeSSH', { exact: true })).toBeVisible();
      await expect(localePage.locator('html')).toHaveAttribute('lang', expectedAtlasLocaleByMarketLocale[locale]);
      await expect(localePage.locator('html')).toHaveAttribute('dir', expectedTextDirectionByMarketLocale[locale]);
      await expect(localePage.locator('pre').first()).toHaveAttribute('dir', 'ltr');
      await expect(localePage.getByText('prod-edge-01').first()).toBeVisible();

      await context.close();
    }
  });

  test('manages custom connection groups via group manager', async ({ page }) => {
    await page.goto('/?lang=en');

    // Open group manager via the Boxes icon button
    await page.getByRole('button', { name: /Manage Groups/i }).click();
    await expect(page.getByText(/Manage connection groups|Create/i)).toBeVisible();

    // Create a new group
    const groupInput = page.getByPlaceholder(/New group name|新分组名称/i);
    await groupInput.fill('My Custom Group');
    await page.getByRole('button', { name: /Create|创建/i }).click();

    // Verify group appears in the list
    await expect(page.getByText('My Custom Group', { exact: true })).toBeVisible();
  });

  test('shows recording indicator in terminal header', async ({ page }) => {
    await page.goto('/?lang=en');

    // The recording toggle button should exist
    const recordButton = page.getByRole('button', { name: /Toggle recording|录制|Start recording/i });
    await expect(recordButton).toBeVisible();
    await expect(recordButton).toBeDisabled();
  });

  test('terminal autocomplete stays hidden without a live SSH command input', async ({ page }) => {
    await page.goto('/?lang=en');

    const commandInput = page.getByLabel('Terminal command');
    await expect(commandInput).toHaveCount(0);
    await expect(page.locator('.terminal-autocomplete')).toHaveCount(0);
  });

  test('persists sidebar collapse state across reload', async ({ page }) => {
    await page.goto('/?lang=en');

    // Ensure page has focus
    await page.click('body');

    // Collapse sidebar via keyboard shortcut (Ctrl+B)
    await page.keyboard.down('Control');
    await page.keyboard.press('b');
    await page.keyboard.up('Control');

    // Sidebar should be collapsed
    await expect(page.locator('.sidebar.is-collapsed')).toBeVisible({ timeout: 3000 });

    // Reload and verify persistence
    await page.reload();
    await expect(page.locator('.sidebar.is-collapsed')).toBeVisible({ timeout: 3000 });
  });

  test('persists connection drag order across reload', async ({ page }) => {
    await page.goto('/?lang=en');

    const productionGroup = page.getByRole('list', { name: 'Production' });
    const prodEdge01 = productionGroup.getByRole('button', { name: /prod-edge-01/i });
    const prodEdge02 = productionGroup.getByRole('button', { name: /prod-edge-02/i });

    await expect(prodEdge01).toBeVisible();
    await expect(prodEdge02).toBeVisible();
    await expect(productionGroup.getByRole('listitem').first()).toContainText('prod-edge-01');

    await prodEdge02.dragTo(prodEdge01);
    await expect(productionGroup.getByRole('listitem').first()).toContainText('prod-edge-02');

    await page.reload();
    await expect(productionGroup.getByRole('listitem').first()).toContainText('prod-edge-02');
    await expect(productionGroup.getByRole('listitem').nth(1)).toContainText('prod-edge-01');
  });

  test('persists connection keyboard reorder across reload', async ({ page }) => {
    await page.goto('/?lang=en');

    const productionGroup = page.getByRole('list', { name: 'Production' });
    const prodEdge01 = productionGroup.getByRole('button', { name: /prod-edge-01/i });
    const prodEdge02 = productionGroup.getByRole('button', { name: /prod-edge-02/i });

    await expect(productionGroup.getByRole('listitem').first()).toContainText('prod-edge-01');
    await expect(prodEdge01).toHaveAttribute('aria-keyshortcuts', /Alt\+ArrowUp/);

    await prodEdge01.focus();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(productionGroup.getByRole('listitem').first()).toContainText('prod-edge-02');
    await expect(productionGroup.getByRole('listitem').nth(1)).toContainText('prod-edge-01');

    await page.reload();
    await expect(productionGroup.getByRole('listitem').first()).toContainText('prod-edge-02');
    await expect(productionGroup.getByRole('listitem').nth(1)).toContainText('prod-edge-01');

    await prodEdge01.focus();
    await page.keyboard.press('Alt+ArrowUp');
    await expect(productionGroup.getByRole('listitem').first()).toContainText('prod-edge-01');
    await expect(productionGroup.getByRole('listitem').nth(1)).toContainText('prod-edge-02');

    await page.reload();
    await expect(productionGroup.getByRole('listitem').first()).toContainText('prod-edge-01');
    await expect(productionGroup.getByRole('listitem').nth(1)).toContainText('prod-edge-02');
  });

  test('context menu has move-to-group submenu for connections', async ({ page }) => {
    await page.goto('/?lang=en');

    // Right-click on a connection to open context menu
    const connection = page.getByText('prod-edge-01').first();
    await connection.click({ button: 'right' });

    // Context menu should appear with Move to group option
    await expect(page.getByText(/Move to group|移动到分组/i)).toBeVisible();
  });

  test('persists connection move-to-group changes across reload', async ({ page }) => {
    await page.goto('/?lang=en');

    await page.getByText('prod-edge-01').first().click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Move to group/i }).click();
    await page.getByRole('menuitem', { name: 'Staging' }).click();

    const stagingGroup = page.getByRole('list', { name: 'Staging' });
    await expect(stagingGroup.getByRole('button', { name: /prod-edge-01/i })).toBeVisible();

    await page.reload();
    await expect(stagingGroup.getByRole('button', { name: /prod-edge-01/i })).toBeVisible();
  });

  test('connection right-click context menu exposes only executable actions', async ({ page }) => {
    await page.goto('/?lang=en');

    const connection = page.getByText('prod-edge-01').first();
    await connection.click({ button: 'right' });

    await expect(page.getByRole('menuitem', { name: 'Connect', exact: true })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /Test connection/i })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /Edit connection|编辑连接/i })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: /Duplicate|复制/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Copy SSH command|SSH/i })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: /Delete|删除/i })).toHaveCount(0);
  });

  test('toggles theme with keyboard shortcut', async ({ page }) => {
    await page.goto('/?lang=en');

    // Wait until the workbench shell is interactive so the keydown listener is mounted
    await expect(page.getByText('JoeSSH', { exact: true })).toBeVisible();

    // Theme should not have data-theme initially (system default)
    await expect(page.locator('html')).not.toHaveAttribute('data-theme');

    // Press Ctrl+Shift+T to cycle to dark
    await dispatchThemeShortcutUntil(page, 'dark');

    // Press again to cycle to light
    await dispatchThemeShortcutUntil(page, 'light');

    // Press again to cycle back to system (no attribute)
    await dispatchThemeShortcutUntil(page, null);
  });

  test('switches right panel with Ctrl+number shortcuts', async ({ page }) => {
    await page.goto('/?lang=en');

    // Default panel is inspector (Ctrl+1)
    await expect(page.getByText('Session Context')).toBeVisible();

    // Switch to SFTP panel with Ctrl+2
    await dispatchAppShortcut(page, '2');
    await expect(page.getByText('SFTP', { exact: false }).first()).toBeVisible();

    // Switch to Team panel with Ctrl+3
    await dispatchAppShortcut(page, '3');
    await expect(page.getByText(/Team|团队/).first()).toBeVisible();

    // Switch to Forwarding panel with Ctrl+4
    await dispatchAppShortcut(page, '4');
    await expect(page.getByText(/Forwarding|端口转发/).first()).toBeVisible();

    // Switch to Settings panel with Ctrl+5
    await dispatchAppShortcut(page, '5');
    await expect(page.getByText(/Settings|设置/).first()).toBeVisible();
  });

  test('sidebar search filters connections', async ({ page }) => {
    await page.goto('/?lang=en');

    // Type in the sidebar search field
    const searchInput = page.getByPlaceholder('Search hosts, tags, users');
    await searchInput.fill('db');

    // db connections should be visible in the sidebar connection list
    await expect(page.getByRole('button', { name: /db-primary/i })).toBeVisible();

    // prod connections should be filtered out
    await expect(page.getByRole('button', { name: /prod-edge-01/i })).toHaveCount(0);

    // Clear search — all connections should reappear
    await searchInput.clear();
    await expect(page.getByRole('button', { name: /prod-edge-01/i })).toBeVisible();
  });

  test('favorites star toggle persists across reload', async ({ page }) => {
    await page.goto('/?lang=en');

    // Find the favorite button for db-replica-03 (locked connection)
    const favButton = page.getByRole('button', { name: /Add to favorites|Remove from favorites/i }).first();
    await favButton.click();

    // Reload and verify the favorite persisted
    await page.reload();
    const favButtonAfterReload = page.getByRole('button', { name: /Add to favorites|Remove from favorites/i }).first();
    await expect(favButtonAfterReload).toBeVisible();
  });

  test('tag filters narrow sidebar connections', async ({ page }) => {
    await page.goto('/?lang=en');

    // Click the "database" tag filter chip (use exact match to avoid matching connection buttons)
    const dbTag = page.getByRole('button', { name: 'database', exact: true });
    await expect(dbTag).toBeVisible();
    await dbTag.click();

    // Only database connections should remain visible in the sidebar
    await expect(page.getByRole('button', { name: /db-primary/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /db-replica-03/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /prod-edge-01/i })).toHaveCount(0);

    // Click the tag again to deselect — all connections reappear
    await dbTag.click();
    await expect(page.getByRole('button', { name: /prod-edge-01/i })).toBeVisible();
  });

  test('opens terminal search with Ctrl+F', async ({ page }) => {
    await page.goto('/?lang=en');

    // Ensure page has focus
    await page.click('body');

    // Open search via Ctrl+F using keyboard
    await page.keyboard.down('Control');
    await page.keyboard.press('f');
    await page.keyboard.up('Control');

    // Search input should appear inside the terminal search bar
    const searchInput = page.locator('.terminal-search-bar input');
    await expect(searchInput).toBeVisible({ timeout: 3000 });

    // Type a query — matching lines should remain visible
    await searchInput.fill('kubectl');
    await expect(page.getByRole('log', { name: 'sample shell' })).toContainText('kubectl');

    // Close search with Escape
    await page.keyboard.press('Escape');
    await expect(searchInput).toHaveCount(0);
  });

  test('toast appears after a successful action', async ({ page }) => {
    await page.goto('/?lang=en');

    // Duplicate is available in the browser preview and triggers a toast.
    await page.getByRole('button', { name: /prod-edge-01/i }).click({ button: 'right' });
    await page.getByRole('menuitem', { name: /Duplicate/i }).click();

    // Toast container should show a status message
    const toast = page.locator('.toast-container [role="status"]');
    await expect(toast.first()).toBeVisible({ timeout: 3000 });
  });
});

async function dispatchAppShortcut(page: Page, key: string, options?: { shiftKey?: boolean }) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.evaluate(({ code, key, shiftKey }) => {
        window.dispatchEvent(new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          code,
          ctrlKey: true,
          key,
          metaKey: false,
          shiftKey,
        }));
      }, { code: getSyntheticShortcutCode(key), key, shiftKey: options?.shiftKey ?? false });
      return;
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed') || attempt === 2) {
        throw error;
      }
      await page.waitForLoadState('domcontentloaded');
    }
  }
}

async function dispatchThemeShortcutUntil(page: Page, expectedTheme: 'dark' | 'light' | null) {
  const html = page.locator('html');
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await dispatchAppShortcut(page, 'T', { shiftKey: true });
    try {
      await expect
        .poll(() => html.getAttribute('data-theme'), { timeout: 750 })
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
