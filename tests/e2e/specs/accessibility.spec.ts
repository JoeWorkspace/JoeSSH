import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.describe('JoeSSH accessibility audit', () => {
  test('desktop workbench has no critical or serious a11y violations', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

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

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

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

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

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

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

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

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

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

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const violations = results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious');

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
});
