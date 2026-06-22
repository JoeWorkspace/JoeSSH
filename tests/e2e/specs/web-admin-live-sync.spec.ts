import { expect, test } from '@playwright/test';

test.describe('JoeSSH web admin live Sync API integration', () => {
  test('loads the same-origin admin snapshot proxy without browser bearer auth', async ({ page }) => {
    const snapshotRequest = page.waitForRequest((request) => {
      return request.method() === 'GET' && request.url().endsWith('/api/admin/snapshot');
    });

    await page.goto('/?lang=en&adminSnapshot=live');

    const request = await snapshotRequest;
    expect(new URL(request.url()).origin).toBe(new URL(page.url()).origin);
    expect(request.headers().authorization).toBeUndefined();
    await expect(page.getByLabel('Snapshot status').getByText('Live snapshot', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toContainText('Sync API Desktop');
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toContainText('server-4100');
    await expect(page.getByRole('table', { name: 'Team members' })).toContainText('Local Sync Operator');
    await expect(page.getByLabel('Recent audit events')).toContainText('Accepted Update sync change');
  });
});
