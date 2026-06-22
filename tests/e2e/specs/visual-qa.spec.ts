import { expect, test, type Page } from '@playwright/test';
import { expectNoDocumentOverflow } from './i18n';

test.describe('JoeSSH scripted visual QA', () => {
  test('desktop workbench visual baseline for Chinese and English paths @visual', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop-visual-'), 'Desktop visual baseline runs only in desktop projects.');

    await assertDesktopVisualPath(page, 'zh-CN');
    await expect(page).toHaveScreenshot(`desktop-${testInfo.project.name}-zh-CN.png`, {
      animations: 'disabled',
      fullPage: true,
    });

    await assertDesktopVisualPath(page, 'en');
    await expect(page).toHaveScreenshot(`desktop-${testInfo.project.name}-en.png`, {
      animations: 'disabled',
      fullPage: true,
    });
  });

  test('mobile companion web visual baseline for Chinese and English paths @visual', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile-web-visual', 'Mobile visual baseline runs only in the mobile project.');

    await assertMobileVisualPath(page, 'zh-CN');
    await expect(page).toHaveScreenshot('mobile-web-visual-zh-CN.png', {
      animations: 'disabled',
      fullPage: true,
      mask: [page.getByTestId('language-panel')],
    });

    await assertMobileVisualPath(page, 'en');
    await expect(page).toHaveScreenshot('mobile-web-visual-en.png', {
      animations: 'disabled',
      fullPage: true,
      mask: [page.getByTestId('language-panel')],
    });
  });

  test('web admin visual baseline for Chinese and English paths @visual', async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('web-admin-visual-'), 'Web Admin visual baseline runs only in Web Admin projects.');

    await assertWebAdminVisualPath(page, 'zh-CN');
    await expect(page).toHaveScreenshot(`web-admin-${testInfo.project.name}-zh-CN.png`, {
      animations: 'disabled',
      fullPage: true,
      mask: [page.locator('.snapshotStatus time')],
    });

    await assertWebAdminVisualPath(page, 'en');
    await expect(page).toHaveScreenshot(`web-admin-${testInfo.project.name}-en.png`, {
      animations: 'disabled',
      fullPage: true,
      mask: [page.locator('.snapshotStatus dl > div').nth(3).locator('dd')],
    });
  });
});

async function assertDesktopVisualPath(page: Page, language: 'en' | 'zh-CN') {
  await page.goto(`/?lang=${language}`);

  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.getByText('JoeSSH', { exact: true })).toBeVisible();
  await expect(page.locator('.workbench')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.terminal-pane').first()).toBeVisible();
  await expect(page.locator('.context-pane')).toBeVisible();
  await expect(page.locator('.context-pane .skeleton--card')).toHaveCount(0);
  await expect(page.getByRole('log', { name: language === 'en' ? 'sample shell' : undefined }).first()).toBeVisible();
  if (language === 'en') {
    await expect(page.getByText('No SSH session').first()).toBeVisible();
  }
  await expectNoDocumentOverflow(page);
}

async function assertMobileVisualPath(page: Page, language: 'en' | 'zh-CN') {
  await page.goto('/');
  await page.addStyleTag({ content: '#error-toast { display: none !important; }' });

  await expect(page.getByTestId('mobile-home-root')).toBeVisible();
  const selectedLanguage = page.getByTestId(language === 'en' ? 'language-option-en' : 'language-option-zh-CN');
  await selectedLanguage.click();
  await selectedLanguage.evaluate((element) => {
    const target = element as HTMLElement;
    let scrollContainer = target.parentElement;

    while (scrollContainer && scrollContainer.scrollWidth <= scrollContainer.clientWidth) {
      scrollContainer = scrollContainer.parentElement;
    }

    if (!scrollContainer) {
      return;
    }

    const targetLeft = target.offsetLeft - (scrollContainer.clientWidth - target.clientWidth) / 2;
    scrollContainer.scrollLeft = Math.max(0, targetLeft);
  });
  await expect(page.getByTestId('sync-status-panel')).toBeVisible();
  await expect(page.getByTestId('sync-primary-action')).toBeVisible();

  if (language === 'en') {
    await expect(page.getByText('JoeSSH Mobile', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register and Pull Preview' })).toBeVisible();
  } else {
    await expect(page.getByText('JoeSSH 移动端', { exact: true })).toBeVisible();
    await expect
      .poll(async () => page.evaluate(() => /[\u4e00-\u9fff]/.test(document.body.textContent ?? '')))
      .toBe(true);
  }

  await expectNoDocumentOverflow(page);
}

async function assertWebAdminVisualPath(page: Page, language: 'en' | 'zh-CN') {
  await page.goto(`/?lang=${language}&adminSnapshot=fixture`);

  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await expect(page.locator('.shell')).toBeVisible();
  await expect(page.locator('.workspace')).toBeVisible();
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.getByText('JoeSSH', { exact: true })).toBeVisible();
  await expect(page.getByRole('link').first()).toBeVisible();
  await expect(page.locator('#sync')).toBeVisible();
  await expect(page.locator('#devices')).toBeVisible();
  await expect(page.locator('#team')).toBeVisible();
  await expect(page.locator('#audit')).toBeVisible();
  await expect(page.locator('#storage')).toBeVisible();
  await expect(page.getByRole('table').first()).toBeVisible();

  if (language === 'en') {
    await expect(page.getByRole('heading', { exact: true, level: 1, name: 'Team operations' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Team members' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toBeVisible();
  } else {
    await expect(page.locator('h1')).toBeVisible();
    await expect
      .poll(async () => page.evaluate(() => /[\u4e00-\u9fff]/.test(document.body.textContent ?? '')))
      .toBe(true);
  }

  await expectNoDocumentOverflow(page);
}
