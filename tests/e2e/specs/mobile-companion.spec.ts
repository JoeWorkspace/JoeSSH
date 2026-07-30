import { expect, test, type Page } from '@playwright/test';
import { expectNoDocumentOverflow } from './i18n';

test.describe('JoeSSH mobile companion web smoke', () => {
  test.describe.configure({ timeout: 60_000 });

  test('launches at 320px and renders an honest empty offline fallback', async ({ page }) => {
    await page.goto('/');
    // Hide Expo dev error toast that intercepts pointer events
    await page.addStyleTag({ content: '#error-toast { display: none !important; }' });

    await expect(page.getByText('JoeSSH Mobile', { exact: true })).toBeVisible();
    await expect(page.getByText('Sync and emergency access')).toBeVisible();
    await expect(page.getByTestId('sync-status-panel')).toContainText('Ready to connect');
    await expect(page.getByText('No workspace pulled yet')).toBeVisible();
    await expect(page.getByText('No recovery routes are configured for this preview.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Register and Pull Preview' })).toBeVisible();
    await expectNoDocumentOverflow(page);

    await page.getByTestId('sync-primary-action').click();

    await expect(page.getByTestId('sync-status-panel')).toContainText('Offline fallback active');
    await expect(page.getByTestId('sync-error-panel')).toContainText('Sync unavailable');
    await expect(page.getByTestId('sync-error-panel')).toContainText(
      'No live sync endpoint is configured. No live or cached workspace data was loaded.',
    );
    await expect(page.locator('[aria-label="Profiles: 0"]')).toBeVisible();
    await expect(page.locator('[aria-label="Open sessions: 0"]')).toBeVisible();
    await expect(page.locator('[aria-label="Changes pulled: 0"]')).toBeVisible();
    await expect(page.getByText('No workspace pulled yet')).toBeVisible();
    await expect(page.getByText('Run preview to load cursor state')).toBeVisible();
    await expect(page.getByText('No recovery routes are configured for this preview.')).toBeVisible();
    await expect(page.getByText('C:\\Tools\\agenttool')).toHaveCount(0);
    await expect(page.getByText('mobile-sync-preview / npm run typecheck')).toHaveCount(0);
    await expect(page.getByText('Relay Connect')).toHaveCount(0);
    await expect(page.getByText('Cached Key')).toHaveCount(0);
    await expect(page.locator('[data-testid^="emergency-channel-"]')).toHaveCount(0);
    await expectNoDocumentOverflow(page);
  });

  test('keeps the Arabic mobile shell usable at 320px', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      locale: 'ar-SA',
      viewport: { width: 320, height: 700 },
    });
    const page = await context.newPage();

    await page.goto('/');

    await expect(page.getByText('JoeSSH Mobile', { exact: true })).toBeVisible();
    await expect
      .poll(async () => page.evaluate(() => /[\u0600-\u06ff]/.test(document.body.textContent ?? '')))
      .toBe(true);
    await expect(page.getByTestId('sync-status-panel')).toBeVisible();
    await expect(page.getByTestId('sync-primary-action')).toBeVisible();
    await expectNoDocumentOverflow(page);

    await context.close();
  });

  test('applies the dark OS theme to the mobile status surface', async ({ browser, baseURL }) => {
    const context = await browser.newContext({
      baseURL,
      colorScheme: 'dark',
      locale: 'en-US',
      viewport: { width: 320, height: 700 },
    });
    const page = await context.newPage();

    await page.goto('/');

    await expect(page.getByTestId('sync-status-panel')).toContainText('Ready to connect');
    await expectComputedStyle(page, '[data-testid="mobile-home-root"]', 'backgroundColor', 'rgb(8, 13, 18)');
    await expectComputedStyle(page, '[data-testid="sync-status-panel"]', 'backgroundColor', 'rgb(17, 25, 35)');
    await expect(page.getByText('Start by registering this phone and pulling a safe preview from JoeSSH sync.')).toHaveCSS(
      'color',
      'rgb(162, 177, 186)',
    );
    await expectNoDocumentOverflow(page);

    await context.close();
  });
});

type ComputedStyleProperty = 'backgroundColor' | 'color';

async function expectComputedStyle(page: Page, selector: string, property: ComputedStyleProperty, value: string) {
  await expect
    .poll(async () =>
      page.evaluate(
        ({ property: styleProperty, selector: targetSelector }: { property: ComputedStyleProperty; selector: string }) => {
          const element = document.querySelector(targetSelector);

          if (!element) {
            return '';
          }

          return getComputedStyle(element)[styleProperty]?.toString() ?? '';
        },
        { property, selector },
      ),
    )
    .toBe(value);
}
