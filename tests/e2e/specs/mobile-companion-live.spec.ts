import { expect, test } from '@playwright/test';
import { expectNoDocumentOverflow } from './i18n';

const expectedMobileSyncAuthToken = process.env.ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN ?? 'e2e-mobile-sync-token';

test.describe('JoeSSH mobile companion live sync smoke', () => {
  test.describe.configure({ timeout: 60_000 });

  test('registers the device, pushes mobile presence, and pulls a live sync preview with bearer auth', async ({ page }) => {
    const registerRequests: unknown[] = [];
    const pushRequests: unknown[] = [];
    const pullRequests: string[] = [];
    const syncRequestOrigins = new Set<string>();

    page.on('request', (request) => {
      const requestUrl = new URL(request.url());

      if (!requestUrl.pathname.startsWith('/v1/')) {
        return;
      }

      syncRequestOrigins.add(requestUrl.origin);
      expect(request.headers().authorization).toBe(`Bearer ${expectedMobileSyncAuthToken}`);

      if (requestUrl.pathname === '/v1/devices/register') {
        registerRequests.push(request.postDataJSON());
      } else if (requestUrl.pathname === '/v1/sync/push') {
        pushRequests.push(request.postDataJSON());
      } else if (requestUrl.pathname === '/v1/sync/pull') {
        pullRequests.push(request.url());
      }
    });

    await page.goto('/');
    const appOrigin = new URL(page.url()).origin;
    // Hide Expo dev error toast that intercepts pointer events
    await page.addStyleTag({ content: '#error-toast { display: none !important; }' });
    await expect(page.getByTestId('sync-status-panel')).toContainText('Ready to connect');

    await page.getByTestId('sync-primary-action').click();

    await expect(page.getByTestId('sync-status-panel')).toContainText('Preview ready');
    await expect(page.getByTestId('sync-device-quality')).toContainText('online');
    await expect(page.locator('[aria-label="Profiles: 0"]')).toBeVisible();
    await expect(page.locator('[aria-label="Open sessions: 0"]')).toBeVisible();
    await expect(page.locator('[aria-label="Changes pulled: 3"]')).toBeVisible();
    await expect(page.getByText('No workspace pulled yet')).toBeVisible();
    await expect(page.getByText('Run preview to load cursor state')).toBeVisible();
    await expect(page.getByText('No recovery routes are configured for this preview.')).toBeVisible();
    await expect(page.getByText('C:\\Tools\\agenttool')).toHaveCount(0);
    await expect(page.getByText('sync-api / next cursor server-42')).toHaveCount(0);
    await expect(page.getByText('Relay Connect')).toHaveCount(0);
    await expect(page.getByText('Cached Key')).toHaveCount(0);
    await expect(page.locator('[data-testid^="emergency-channel-"]')).toHaveCount(0);
    await expectNoDocumentOverflow(page);

    await page.getByTestId('sync-primary-action').click();

    await expect(page.getByTestId('sync-status-panel')).toContainText('Preview ready');
    await expect(page.locator('[aria-label="Changes pulled: 3"]')).toBeVisible();
    await expect(page.getByText('sync-api / next cursor server-43')).toHaveCount(0);
    await expect(page.getByText('No workspace pulled yet')).toBeVisible();
    await expectNoDocumentOverflow(page);

    expect(registerRequests).toEqual([
      expect.objectContaining({
        app_version: expect.any(String),
        display_name: expect.any(String),
        platform: 'web',
      }),
      expect.objectContaining({
        app_version: expect.any(String),
        display_name: expect.any(String),
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        platform: 'web',
      }),
    ]);
    expect(pushRequests).toEqual([
      expect.objectContaining({
        base_cursor: '0',
        changes: [
          expect.objectContaining({
            entity_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
            entity_type: 'mobile_presence',
            operation: 'update',
            payload: expect.objectContaining({
              client: 'atlasterm-mobile',
              platform: 'web',
              preview_intent: 'pull_sync_preview',
            }),
          }),
        ],
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      }),
      expect.objectContaining({
        base_cursor: 'server-42',
        changes: [
          expect.objectContaining({
            entity_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
            entity_type: 'mobile_presence',
            operation: 'update',
            payload: expect.objectContaining({
              client: 'atlasterm-mobile',
              platform: 'web',
              preview_intent: 'pull_sync_preview',
            }),
          }),
        ],
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      }),
    ]);
    expect(pullRequests).toEqual([
      expect.stringContaining('/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=0'),
      expect.stringContaining('/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=server-42'),
    ]);
    expect([...syncRequestOrigins]).toHaveLength(1);
    expect(syncRequestOrigins.has(appOrigin)).toBe(false);
  });
});
