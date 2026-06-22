import { expect, test } from '@playwright/test';

test.describe('JoeSSH web admin real Sync service integration', () => {
  test('renders a real Sync admin snapshot through the same-origin proxy', async ({ page }) => {
    const snapshotRequest = page.waitForRequest((request) => {
      return request.method() === 'GET' && request.url().endsWith('/api/admin/snapshot');
    });
    const snapshotResponse = page.waitForResponse((response) => {
      return response.request().method() === 'GET' && response.url().endsWith('/api/admin/snapshot');
    });

    await page.goto('/?lang=en&adminSnapshot=live');

    const request = await snapshotRequest;
    expect(new URL(request.url()).origin).toBe(new URL(page.url()).origin);
    expect(request.headers().authorization).toBeUndefined();
    expect((await snapshotResponse).ok()).toBe(true);
    await expect(page.getByLabel('Snapshot status').getByText('Live snapshot', { exact: true })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toContainText('Real Sync Desktop');
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toContainText('server-1');
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toContainText('Real Sync Mobile');
    await expect(page.getByRole('table', { name: 'Team members' })).toContainText('Local Sync Operator');
    await expect(page.getByLabel('Recent audit events')).toContainText('Accepted Update sync change');
    await expect(page.getByLabel('Recent audit events')).toContainText('connection:real-sync-connection');
  });
});
