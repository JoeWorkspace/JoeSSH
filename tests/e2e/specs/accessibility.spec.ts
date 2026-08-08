import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const wcagTags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

function accessibilityAudit(page: Page) {
  return new AxeBuilder({ page }).options({
    runOnly: {
      type: 'tag',
      values: wcagTags,
    },
    rules: {
      'target-size': { enabled: true },
    },
  });
}

test.describe('JoeSSH accessibility audit', () => {
  test('desktop workbench has no critical or serious a11y violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await accessibilityAudit(page).analyze();

    const violations = results.violations.filter(
      (v) => v.id === 'target-size' || v.impact === 'critical' || v.impact === 'serious',
    );

    // Log violations for debugging
    if (violations.length > 0) {
      for (const v of violations) {
        console.error(`[${v.impact}] ${v.id}: ${v.description}`);
        console.error(`  Help: ${v.helpUrl}`);
        for (const node of v.nodes.slice(0, 3)) {
          console.error(`  Target: ${node.target.join(', ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('light theme has no critical or serious a11y violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Switch to light theme via the theme button
    const themeButton = page.getByLabel(/Switch to light|切换到浅色|切换至浅色模式/);
    if (await themeButton.isVisible()) {
      await themeButton.click();
      await page.waitForTimeout(300);
    }

    const results = await accessibilityAudit(page).analyze();

    const violations = results.violations.filter(
      (v) => v.id === 'target-size' || v.impact === 'critical' || v.impact === 'serious',
    );

    if (violations.length > 0) {
      for (const v of violations) {
        console.error(`[${v.impact}] ${v.id}: ${v.description}`);
        console.error(`  Help: ${v.helpUrl}`);
        for (const node of v.nodes.slice(0, 3)) {
          console.error(`  Target: ${node.target.join(', ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('command palette has no critical or serious a11y violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Open command palette
    await page.keyboard.press('Control+k');
    await page.waitForTimeout(300);

    const results = await accessibilityAudit(page).analyze();

    const violations = results.violations.filter(
      (v) => v.id === 'target-size' || v.impact === 'critical' || v.impact === 'serious',
    );

    if (violations.length > 0) {
      for (const v of violations) {
        console.error(`[${v.impact}] ${v.id}: ${v.description}`);
        console.error(`  Help: ${v.helpUrl}`);
        for (const node of v.nodes.slice(0, 3)) {
          console.error(`  Target: ${node.target.join(', ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('SFTP panel has no critical or serious a11y violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /SFTP|文件|文件传输/ }).click();
    await page.waitForTimeout(300);

    const results = await accessibilityAudit(page).analyze();

    const violations = results.violations.filter(
      (v) => v.id === 'target-size' || v.impact === 'critical' || v.impact === 'serious',
    );

    if (violations.length > 0) {
      for (const v of violations) {
        console.error(`[${v.impact}] ${v.id}: ${v.description}`);
        console.error(`  Help: ${v.helpUrl}`);
        for (const node of v.nodes.slice(0, 3)) {
          console.error(`  Target: ${node.target.join(', ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('settings panel has no critical or serious a11y violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /Settings|设置/ }).click();
    await page.waitForTimeout(300);

    const results = await accessibilityAudit(page).analyze();

    const violations = results.violations.filter(
      (v) => v.id === 'target-size' || v.impact === 'critical' || v.impact === 'serious',
    );

    if (violations.length > 0) {
      for (const v of violations) {
        console.error(`[${v.impact}] ${v.id}: ${v.description}`);
        console.error(`  Help: ${v.helpUrl}`);
        for (const node of v.nodes.slice(0, 3)) {
          console.error(`  Target: ${node.target.join(', ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('team access panel has no critical or serious a11y violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    await page.getByRole('tab', { name: /Team|团队/ }).click();
    await page.waitForTimeout(300);

    const results = await accessibilityAudit(page).analyze();

    const violations = results.violations.filter(
      (v) => v.id === 'target-size' || v.impact === 'critical' || v.impact === 'serious',
    );

    if (violations.length > 0) {
      for (const v of violations) {
        console.error(`[${v.impact}] ${v.id}: ${v.description}`);
        console.error(`  Help: ${v.helpUrl}`);
        for (const node of v.nodes.slice(0, 3)) {
          console.error(`  Target: ${node.target.join(', ')}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test('keyboard focus remains unobscured in scroll containers', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.getByRole('tab', { name: /Settings|设置/ }).click();

    const target = page.locator('.context-pane button:not(:disabled)').last();
    await expect(target).toBeVisible();
    await target.focus();

    const focusGeometry = await target.evaluate((element) => {
      const targetRect = element.getBoundingClientRect();
      let scrollParent = element.parentElement;
      while (scrollParent) {
        const style = window.getComputedStyle(scrollParent);
        if (/(auto|scroll)/.test(`${style.overflow} ${style.overflowY}`)) {
          break;
        }
        scrollParent = scrollParent.parentElement;
      }

      const parentRect = scrollParent?.getBoundingClientRect() ?? {
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
        left: 0,
      };
      const visibleTop = Math.max(targetRect.top, parentRect.top, 0);
      const visibleRight = Math.min(targetRect.right, parentRect.right, window.innerWidth);
      const visibleBottom = Math.min(targetRect.bottom, parentRect.bottom, window.innerHeight);
      const visibleLeft = Math.max(targetRect.left, parentRect.left, 0);
      const hit = document.elementFromPoint((visibleLeft + visibleRight) / 2, (visibleTop + visibleBottom) / 2);

      return {
        fullyVisible:
          targetRect.top >= parentRect.top &&
          targetRect.right <= parentRect.right &&
          targetRect.bottom <= parentRect.bottom &&
          targetRect.left >= parentRect.left,
        hasVisibleArea: visibleRight > visibleLeft && visibleBottom > visibleTop,
        unobscured: hit !== null && (element.contains(hit) || hit.contains(element)),
      };
    });

    expect(focusGeometry).toEqual({
      fullyVisible: true,
      hasVisibleArea: true,
      unobscured: true,
    });
  });
});
