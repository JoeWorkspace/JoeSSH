import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  commonMarketLocales,
  expectNoDocumentOverflow,
  expectedAtlasLocaleByMarketLocale,
  expectedTextDirectionByMarketLocale,
} from './i18n';

const expectedAdminSnapshotAuthToken =
  process.env.ATLASTERM_E2E_ADMIN_SNAPSHOT_AUTH_TOKEN ?? 'e2e-admin-snapshot-token';
const longDeviceName = 'Riley Admin MacBook Pro staging-runner-with-very-long-hostname-prod-east-001';
const longDeviceCursor = 'server-7:cursor:profile-sync:2026-06-06T15-16-00Z:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const authPanelName = /Authentication required[\s\S]*Sign in before viewing sync data/;
const emptyPanelName = /Empty snapshot[\s\S]*No admin sync data yet/;
const loadingPanelName = /Loading snapshot[\s\S]*Loading admin dashboard/;
const unavailablePanelName = /Snapshot unavailable[\s\S]*Admin snapshot could not be loaded/;
const unavailablePanelNameZh =
  /\u5feb\u7167\u4e0d\u53ef\u7528[\s\S]*\u65e0\u6cd5\u52a0\u8f7d\u7ba1\u7406\u5feb\u7167/;
const unavailablePanelMessageZh = '\u8bf7\u5237\u65b0\u6216\u68c0\u67e5\u7ba1\u7406\u5feb\u7167\u7aef\u70b9\u914d\u7f6e\u3002';
const fatalBoundaryMessageEn = 'Reload JoeSSH or contact support if the issue continues.';
const fatalBoundaryMessageZh = '\u8bf7\u91cd\u65b0\u52a0\u8f7d JoeSSH\uff1b\u5982\u679c\u95ee\u9898\u4ecd\u7136\u5b58\u5728\uff0c\u8bf7\u8054\u7cfb\u652f\u6301\u3002';
const rawAdminSnapshotErrorDetails = [
  'Admin snapshot failed with 503.',
  'Admin snapshot response did not match the expected shape.',
  'Admin snapshot response was not valid JSON.',
  'Admin snapshot is unreachable.',
] as const;

test.describe('JoeSSH web admin', () => {
  test('renders team operations dashboard from fixture fallback', async ({ page }) => {
    await page.goto('/?lang=en&adminSnapshot=fixture');

    await expect(page.getByRole('heading', { exact: true, name: 'Team operations' })).toBeVisible();
    await expect(page.getByRole('main', { name: 'Team operations' })).toBeVisible();
    await expect(page.getByRole('main')).toHaveCount(1);
    const adminNavigation = page.getByRole('navigation', { name: 'JoeSSH admin navigation' });
    await expect(adminNavigation).toBeVisible();
    await expect(adminNavigation).toHaveAttribute('aria-labelledby', 'admin-navigation-title');
    await expect(adminNavigation).not.toHaveAttribute('aria-label');
    await expect(adminNavigation.getByRole('heading', { level: 2, name: 'JoeSSH admin navigation' })).toBeAttached();
    await expect(page.locator('[aria-label]')).toHaveCount(0);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    const teamOverviewRegion = page.getByRole('region', { name: 'Team management overview' });
    await expect(teamOverviewRegion).toBeVisible();
    await expect(teamOverviewRegion.getByRole('heading', { level: 2, name: 'Team management overview' })).toBeAttached();
    const membersPanel = page.getByRole('region', { exact: true, name: 'Members' });
    await expect(membersPanel).toBeVisible();
    await expectDescribedByText(page, membersPanel, 'Fixture fallback');
    await expectSnapshotSource(page, 'Fixture fallback');
    const teamMetrics = page.getByRole('list', { name: 'Team operations metrics' });
    await expect(teamMetrics).toBeVisible();
    await expect(teamMetrics).toHaveAttribute('aria-labelledby', 'admin-metrics-title');
    await expect(teamMetrics).not.toHaveAttribute('aria-label');
    await expect(page.getByRole('heading', { level: 2, name: 'Team operations metrics' })).toBeAttached();
    await expect(teamMetrics.getByRole('listitem')).toHaveCount(4);
    await expect(teamMetrics.getByRole('listitem', { name: /Active members\s+2/ })).toBeVisible();
    await expect(teamMetrics.getByRole('listitem', { name: /Audit events today\s+18/ })).toBeVisible();

    const teamMembers = page.getByRole('table', { name: 'Team members' });
    await expect(teamMembers).toBeVisible();
    await expect(teamMembers).toHaveAttribute('aria-labelledby', 'admin-members-table-title');
    await expect(teamMembers).not.toHaveAttribute('aria-label');
    await expect(page.getByRole('heading', { level: 3, name: 'Team members' })).toBeAttached();
    await expect(teamMembers).toHaveAttribute('aria-colcount', '4');
    await expect(teamMembers).toHaveAttribute('aria-rowcount', '5');
    await expect(teamMembers.getByRole('columnheader')).toHaveCount(4);
    await expect(teamMembers.getByRole('columnheader', { name: 'Member' })).toHaveAttribute('aria-colindex', '1');
    await expect(teamMembers.getByRole('row')).toHaveCount(5);
    await expect(teamMembers.getByRole('row').nth(1)).toHaveAttribute('aria-rowindex', '2');
    const mayaMemberRow = teamMembers.getByRole('row', { name: /Maya Chen[\s\S]*maya@atlasterm\.dev[\s\S]*Workspace Admin[\s\S]*Active[\s\S]*2/ });
    await expect(mayaMemberRow).toBeVisible();
    await expect(mayaMemberRow).toHaveAttribute('aria-labelledby', /\S/);
    await expect(mayaMemberRow).not.toHaveAttribute('aria-label');
    await expect(mayaMemberRow.getByRole('cell', { name: 'Workspace Admin' })).not.toHaveAttribute('aria-label');
    await expect(mayaMemberRow.locator('mark')).not.toHaveAttribute('aria-label');
    const jordanMemberRow = teamMembers.getByRole('row', { name: /Jordan Lee[\s\S]*jordan@atlasterm\.dev[\s\S]*Support Viewer[\s\S]*Invited[\s\S]*0/ });
    await expect(jordanMemberRow).toBeVisible();
    await expect(jordanMemberRow).toHaveAttribute('aria-labelledby', /\S/);
    await expect(jordanMemberRow).not.toHaveAttribute('aria-label');
    await expect(teamMembers.getByRole('rowheader', { name: /Maya Chen/ })).toHaveAttribute('aria-colindex', '1');
    await expect(teamMembers).toContainText('Workspace Admin');
    await expect(teamMembers).toContainText('Support Viewer');
    const refreshButton = page.getByRole('button', { name: 'Refresh team dashboard' });
    await expect(refreshButton).toBeVisible();
    await expect(refreshButton).not.toHaveAttribute('aria-label');
    await expect(page.getByRole('link', { name: 'Sync' })).toHaveAttribute('aria-current', 'location');
  });

  test('shows role, audit, and device status from the admin snapshot boundary', async ({ page }) => {
    await page.goto('/?lang=en&adminSnapshot=fixture');

    const rolePermissions = page.getByRole('list', { name: 'Role permissions' });
    await expect(rolePermissions).toContainText(/sync policy/i);
    await expect(rolePermissions).toHaveAttribute('aria-labelledby', 'admin-role-permissions-title');
    await expect(rolePermissions).not.toHaveAttribute('aria-label');
    await expect(page.getByRole('heading', { level: 3, name: 'Role permissions' })).toBeAttached();
    await expect(rolePermissions.getByRole('listitem')).toHaveCount(3);
    await expect(rolePermissions.getByRole('listitem', { name: /Workspace Admin[\s\S]*Full access/ })).toBeVisible();
    await expect(rolePermissions.getByRole('listitem', { name: /Operator[\s\S]*Elevated/ })).toBeVisible();
    const rolesPanel = page.getByRole('region', { exact: true, name: 'Roles' });
    await expect(rolesPanel).toBeVisible();
    await expectDescribedByText(page, rolesPanel, 'Access model');
    const deviceStatusPanel = page.getByRole('region', { exact: true, name: 'Device status' });
    await expect(deviceStatusPanel).toBeVisible();
    await expectDescribedByText(page, deviceStatusPanel, 'Managed endpoints');
    const auditLogPanel = page.getByRole('region', { exact: true, name: 'Audit log' });
    await expect(auditLogPanel).toBeVisible();
    await expectDescribedByText(page, auditLogPanel, 'Last 60 minutes');
    const devicesTable = page.getByRole('table', { name: 'Managed team devices' });
    await expect(devicesTable).toHaveAttribute('aria-labelledby', 'admin-storage-title admin-managed-devices-title');
    await expect(devicesTable).not.toHaveAttribute('aria-label');
    await expect(page.getByRole('heading', { level: 3, name: 'Storage' })).toBeAttached();
    await expect(page.getByRole('heading', { level: 3, name: 'Managed team devices' })).toBeAttached();
    await expect(devicesTable).toHaveAttribute('aria-colcount', '6');
    await expect(devicesTable).toHaveAttribute('aria-rowcount', '6');
    await expect(devicesTable.getByRole('columnheader')).toHaveCount(6);
    await expect(devicesTable.getByRole('columnheader', { name: 'Cursor' })).toHaveAttribute('aria-colindex', '4');
    await expect(devicesTable.getByRole('row')).toHaveCount(6);
    await expect(devicesTable.getByRole('row').nth(2)).toHaveAttribute('aria-rowindex', '3');
    const joeSshMobileRow = devicesTable.getByRole('row', { name: /JoeSSH Mobile[\s\S]*Eli Park[\s\S]*ios[\s\S]*server-126[\s\S]*Catching up[\s\S]*8 minutes ago/ });
    await expect(joeSshMobileRow).toBeVisible();
    await expect(joeSshMobileRow).toHaveAttribute('aria-labelledby', /\S/);
    await expect(joeSshMobileRow).not.toHaveAttribute('aria-label');
    const archiveLaptopRow = devicesTable.getByRole('row', { name: /Archive Laptop[\s\S]*Jordan Lee[\s\S]*desktop[\s\S]*server-90[\s\S]*Offline[\s\S]*2 hours ago/ });
    await expect(archiveLaptopRow).toBeVisible();
    await expect(archiveLaptopRow).toHaveAttribute('aria-labelledby', /\S/);
    await expect(archiveLaptopRow).not.toHaveAttribute('aria-label');
    await expect(devicesTable.getByRole('rowheader', { name: 'JoeSSH Mobile' })).toHaveAttribute('aria-colindex', '1');
    await expect(devicesTable.getByRole('cell', { name: 'server-126' })).toHaveAttribute('aria-colindex', '4');
    await expect(devicesTable).toContainText('Catching up');
    await expect(devicesTable).toContainText('Degraded');
    await expect(devicesTable).toContainText('Offline');
    await expect(page.getByRole('table', { name: 'Team members' })).toContainText('Suspended');
    const auditEvents = page.getByRole('list', { name: 'Recent audit events' });
    await expect(auditEvents).toContainText('Blocked export from unmanaged device');
    await expect(auditEvents).toHaveAttribute('aria-labelledby', 'admin-recent-audit-events-title');
    await expect(auditEvents).not.toHaveAttribute('aria-label');
    await expect(page.getByRole('heading', { level: 3, name: 'Recent audit events' })).toBeAttached();
    await expect(auditEvents.getByRole('listitem')).toHaveCount(4);
    await expect(auditEvents.getByRole('listitem', { name: /Maya Chen[\s\S]*Accepted 12 profile changes[\s\S]*Desktop Workstation/ })).toBeVisible();
    await expect(auditEvents.getByRole('listitem', { name: /Policy[\s\S]*Blocked export from unmanaged device[\s\S]*Unknown browser/ })).toBeVisible();
    await expect(page.getByText('Audit events today')).toBeVisible();
  });

  test('has no critical or serious a11y violations in dashboard and auth states', async ({ page }) => {
    await page.goto('/?lang=en&adminSnapshot=fixture');

    await expect(page.getByRole('heading', { exact: true, name: 'Team operations' })).toBeVisible();
    await expectNoCriticalOrSeriousAccessibilityViolations(page);

    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: { debugToken: expectedAdminSnapshotAuthToken, error: 'login required' },
        status: 401,
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');

    const authPanel = page.getByRole('status', { name: authPanelName });
    await expect(authPanel).toBeVisible();
    await expectAdminSnapshotAuthTokenHidden(page, authPanel);
    await expectNoCriticalOrSeriousAccessibilityViolations(page);
  });

  test('surfaces fatal render errors through the localized error boundary', async ({ page }) => {
    await page.addInitScript(() => {
      const originalNumberFormat = Intl.NumberFormat;
      function CrashingNumberFormat() {
        throw new Error('forced web fatal boundary crash');
      }
      Object.defineProperty(CrashingNumberFormat, 'supportedLocalesOf', {
        value: originalNumberFormat.supportedLocalesOf.bind(originalNumberFormat),
      });
      Object.defineProperty(Intl, 'NumberFormat', {
        configurable: true,
        value: CrashingNumberFormat,
      });
    });

    await page.goto('/?lang=en&adminSnapshot=fixture');

    const fatalAlert = page.getByRole('alert', { name: 'Something went wrong' });
    await expect(fatalAlert).toBeVisible();
    await expect(fatalAlert).toHaveAttribute('aria-live', 'assertive');
    await expect(fatalAlert).toHaveAttribute('aria-atomic', 'true');
    await expectDescribedByText(page, fatalAlert, fatalBoundaryMessageEn);
    await expect(fatalAlert).toContainText('Something went wrong');
    await expect(fatalAlert).toContainText(fatalBoundaryMessageEn);
    await expect(fatalAlert).not.toContainText('forced web fatal boundary crash');
    await expect(page.getByRole('button', { name: 'Reload' })).toBeFocused();

    await page.goto('/?lang=zh-CN&adminSnapshot=fixture');

    const localizedFatalAlert = page.getByRole('alert', { name: '出现错误' });
    await expect(localizedFatalAlert).toBeVisible();
    await expect(localizedFatalAlert).toHaveAttribute('aria-live', 'assertive');
    await expect(localizedFatalAlert).toHaveAttribute('aria-atomic', 'true');
    await expectDescribedByText(page, localizedFatalAlert, fatalBoundaryMessageZh);
    await expect(localizedFatalAlert).toContainText('出现错误');
    await expect(localizedFatalAlert).toContainText(fatalBoundaryMessageZh);
    await expect(localizedFatalAlert).not.toContainText('forced web fatal boundary crash');
    await expect(localizedFatalAlert).not.toContainText('Something went wrong');
    await expect(page.getByRole('button', { name: '重新加载' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0);
  });

  test('uses the runtime language for fatal render errors after language switches', async ({ page }) => {
    await page.goto('/?lang=en&adminSnapshot=fixture');
    await expect(page.getByRole('heading', { exact: true, name: 'Team operations' })).toBeVisible();

    await page.evaluate(() => {
      const originalNumberFormat = Intl.NumberFormat;
      function CrashingNumberFormat() {
        throw new Error('forced runtime language boundary crash');
      }
      Object.defineProperty(CrashingNumberFormat, 'supportedLocalesOf', {
        value: originalNumberFormat.supportedLocalesOf.bind(originalNumberFormat),
      });
      Object.defineProperty(Intl, 'NumberFormat', {
        configurable: true,
        value: CrashingNumberFormat,
      });
    });

    await page.getByLabel('Language').selectOption('zh-CN');

    const localizedFatalAlert = page.getByRole('alert', { name: '\u51fa\u73b0\u9519\u8bef' });
    await expect(localizedFatalAlert).toBeVisible();
    await expect(localizedFatalAlert).toHaveAttribute('aria-live', 'assertive');
    await expect(localizedFatalAlert).toHaveAttribute('aria-atomic', 'true');
    await expectDescribedByText(page, localizedFatalAlert, fatalBoundaryMessageZh);
    await expect(localizedFatalAlert).toContainText('\u51fa\u73b0\u9519\u8bef');
    await expect(localizedFatalAlert).toContainText(fatalBoundaryMessageZh);
    await expect(localizedFatalAlert).not.toContainText('forced runtime language boundary crash');
    await expect(localizedFatalAlert).not.toContainText('Something went wrong');
    await expect(page.getByRole('button', { name: '\u91cd\u65b0\u52a0\u8f7d' })).toBeFocused();
    await expect(page.getByRole('button', { name: 'Reload' })).toHaveCount(0);
  });

  test('moves keyboard focus to the main content from the skip link', async ({ page }) => {
    await page.goto('/?lang=en&adminSnapshot=fixture');

    const skipLink = page.getByRole('link', { name: 'Skip to main content' });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();

    await page.keyboard.press('Enter');

    const mainContent = page.getByRole('main', { name: 'Team operations' });
    await expect(mainContent).toBeFocused();
  });

  test('stays usable when browser language storage is blocked', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        value: {
          getItem: () => {
            throw new Error('localStorage read blocked');
          },
          removeItem: () => {
            throw new Error('localStorage remove blocked');
          },
          setItem: () => {
            throw new Error('localStorage write blocked');
          },
        },
      });
    });

    await page.goto('/?lang=en&adminSnapshot=fixture');
    await expect(page.getByRole('heading', { exact: true, name: 'Team operations' })).toBeVisible();

    const languageSelector = page.getByLabel('Language');
    await expect(languageSelector).not.toHaveAttribute('aria-label');
    const languageLabelledById = await languageSelector.getAttribute('aria-labelledby');
    expect(languageLabelledById).toBeTruthy();
    await expect(page.locator(`[id="${languageLabelledById}"]`)).toHaveText('Display language');
    const currentLanguageDescriptionId = await languageSelector.getAttribute('aria-describedby');
    expect(currentLanguageDescriptionId).toBeTruthy();
    await expect(page.locator(`[id="${currentLanguageDescriptionId}"]`)).toContainText('Current');

    await languageSelector.selectOption('zh-CN');

    await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(page.getByRole('heading', { exact: true, name: '\u56e2\u961f\u8fd0\u8425' })).toBeVisible();
    await expect(page.locator(`[id="${currentLanguageDescriptionId}"]`)).toContainText('\u5f53\u524d');
    expect(pageErrors).toEqual([]);
  });

  test('loads a live admin snapshot through the data boundary', async ({ page }) => {
    await page.route('**/api/admin/snapshot', async (route) => {
      expect(route.request().headers().authorization).toBeUndefined();
      await route.fulfill({
        contentType: 'application/json',
        json: liveSnapshot(),
      });
    });

    await page.goto('/?lang=en&adminSnapshot=live');

    await expectSnapshotSource(page, 'Live snapshot');
    const liveDevicesTable = page.getByRole('table', { name: 'Managed team devices' });
    await expect(liveDevicesTable).toHaveAttribute('aria-colcount', '6');
    await expect(liveDevicesTable).toHaveAttribute('aria-rowcount', '4');
    await expect(liveDevicesTable.getByRole('row')).toHaveCount(4);
    await expect(liveDevicesTable.getByRole('rowheader', { name: longDeviceName })).toHaveAttribute('aria-colindex', '1');
    await expect(liveDevicesTable.getByRole('cell', { name: longDeviceCursor })).toHaveAttribute('aria-colindex', '4');
    await expect(liveDevicesTable).toContainText(longDeviceName);
    await expect(liveDevicesTable).toContainText(longDeviceCursor);
    await expectNoDocumentOverflow(page);
    await expect(liveDevicesTable).toContainText('Degraded');
    await expect(liveDevicesTable).toContainText('not-a-live-timestamp');
    await expect(liveDevicesTable).toContainText('Offline');
    const liveMembersTable = page.getByRole('table', { name: 'Team members' });
    await expect(liveMembersTable).toHaveAttribute('aria-colcount', '4');
    await expect(liveMembersTable).toHaveAttribute('aria-rowcount', '3');
    await expect(liveMembersTable.getByRole('row')).toHaveCount(3);
    await expect(liveMembersTable.getByRole('rowheader', { name: /Riley Admin/ })).toHaveAttribute('aria-colindex', '1');
    await expectDescribedByText(page, page.getByRole('region', { exact: true, name: 'Members' }), 'Live snapshot');
    await expect(liveMembersTable).toContainText('Riley Admin');
    await expect(liveMembersTable).toContainText('Suspended');
    const liveAuditEvents = page.getByRole('list', { name: 'Recent audit events' });
    await expect(liveAuditEvents).toContainText('Accepted live sync batch');
    await expect(liveAuditEvents).toContainText('not-an-audit-timestamp');
    await expect(liveAuditEvents.getByRole('listitem')).toHaveCount(1);
    await expect(
      liveAuditEvents.getByRole('listitem', { name: /not-an-audit-timestamp[\s\S]*Sync API[\s\S]*Accepted live sync batch[\s\S]*JoeSSH Sync/ }),
    ).toBeVisible();
    await expect(page.getByText('not-an-audit-timestamp')).not.toHaveAttribute('datetime');
  });

  test('surfaces auth, empty, malformed, and unavailable admin snapshot states', async ({ page }) => {
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: { debugToken: expectedAdminSnapshotAuthToken, error: 'login required' },
        status: 401,
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    const authPanel = page.getByRole('status', { name: authPanelName });
    await expect(authPanel).toBeVisible();
    await expect(authPanel).toHaveAttribute('aria-live', 'polite');
    await expectDescribedByText(page, authPanel, 'Authentication is required before sync data can be shown.');
    await expect(authPanel).toBeFocused();
    await expectAdminSnapshotAuthTokenHidden(page, authPanel);
    await expect(page.getByText('Sign in before viewing sync data')).toBeVisible();

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: { code: 'admin_forbidden', debugToken: expectedAdminSnapshotAuthToken },
        status: 403,
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    const forbiddenAuthPanel = page.getByRole('status', { name: authPanelName });
    await expect(forbiddenAuthPanel).toBeVisible();
    await expect(forbiddenAuthPanel).toHaveAttribute('aria-live', 'polite');
    await expectDescribedByText(page, forbiddenAuthPanel, 'Authentication is required before sync data can be shown.');
    await expect(forbiddenAuthPanel).toBeFocused();
    await expectAdminSnapshotAuthTokenHidden(page, forbiddenAuthPanel);
    await expect(page.getByText('Sign in before viewing sync data')).toBeVisible();
    await expectNoCriticalOrSeriousAccessibilityViolations(page);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: emptySnapshot(),
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    const emptyPanel = page.getByRole('status', { name: emptyPanelName });
    await expect(emptyPanel).toBeVisible();
    await expect(emptyPanel).toHaveAttribute('aria-live', 'polite');
    await expectDescribedByText(page, emptyPanel, 'No team sync data is available yet.');
    await expect(emptyPanel).toBeFocused();
    await expect(page.getByText('No admin sync data yet')).toBeVisible();
    await expectNoCriticalOrSeriousAccessibilityViolations(page);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: { error: 'service unavailable' },
        status: 503,
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    const unavailablePanel = await expectUnavailablePanelWithSafeCopy(page);
    await expect(unavailablePanel).toHaveAttribute('aria-live', 'assertive');
    await expect(unavailablePanel).toBeFocused();
    await expect(page.getByText('Admin snapshot could not be loaded')).toBeVisible();
    await expectNoCriticalOrSeriousAccessibilityViolations(page);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.abort('failed');
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    await expectUnavailablePanelWithSafeCopy(page);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        body: `{not-valid-json:${expectedAdminSnapshotAuthToken}`,
        contentType: 'application/json',
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    await expectUnavailablePanelWithSafeCopy(page);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: { debugToken: expectedAdminSnapshotAuthToken, devices: 'not an array' },
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    await expectUnavailablePanelWithSafeCopy(page);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      const snapshot = liveSnapshot();
      await route.fulfill({
        contentType: 'application/json',
        json: {
          ...snapshot,
          metrics: {
            ...snapshot.metrics,
            activeMembers: -1,
          },
        },
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    await expectUnavailablePanelWithSafeCopy(page);
    await expect(page.getByText('Active members')).toHaveCount(0);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      const snapshot = liveSnapshot();
      await route.fulfill({
        contentType: 'application/json',
        json: {
          ...snapshot,
          devices: [
            snapshot.devices[0],
            {
              ...snapshot.devices[1],
              id: snapshot.devices[0].id,
            },
          ],
        },
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    await expectUnavailablePanelWithSafeCopy(page);
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toHaveCount(0);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      const snapshot = liveSnapshot();
      await route.fulfill({
        contentType: 'application/json',
        json: {
          ...snapshot,
          devices: [
            {
              ...snapshot.devices[0],
              id: ` ${snapshot.devices[0].id} `,
            },
          ],
        },
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    await expectUnavailablePanelWithSafeCopy(page);
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toHaveCount(0);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      const snapshot = liveSnapshot();
      await route.fulfill({
        contentType: 'application/json',
        json: {
          ...snapshot,
          devices: [
            {
              ...snapshot.devices[0],
              cursor: '   ',
            },
          ],
        },
      });
    });
    await page.goto('/?lang=en&adminSnapshot=live');
    await expectUnavailablePanelWithSafeCopy(page);
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toHaveCount(0);
  });

  test('recovers a live admin snapshot after authentication becomes available and clears it after forbidden responses', async ({ page }) => {
    let authMode: 'forbidden' | 'missing' | 'ready' = 'missing';
    const snapshotRequests: Array<string | undefined> = [];

    await page.route('**/api/admin/snapshot', async (route) => {
      snapshotRequests.push(route.request().headers().authorization);

      if (authMode === 'missing') {
        await route.fulfill({
          contentType: 'application/json',
          json: { error: 'login required' },
          status: 401,
        });
        return;
      }

      if (authMode === 'forbidden') {
        await route.fulfill({
          contentType: 'application/json',
          json: { code: 'admin_forbidden' },
          status: 403,
        });
        return;
      }

      await route.fulfill({
        contentType: 'application/json',
        json: liveSnapshot(),
      });
    });

    await page.goto('/?lang=en&adminSnapshot=live');
    const initialAuthPanel = page.getByRole('status', { name: authPanelName });
    await expect(initialAuthPanel).toBeVisible();
    await expect(initialAuthPanel).toHaveAttribute('aria-live', 'polite');
    await expect(initialAuthPanel).toBeFocused();
    await expect(page.getByText('Sign in before viewing sync data')).toBeVisible();

    authMode = 'ready';
    await page.getByRole('button', { name: 'Refresh team dashboard' }).click();

    await expectSnapshotSource(page, 'Live snapshot');
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toContainText(longDeviceCursor);
    await expect(page.getByRole('table', { name: 'Team members' })).toContainText('Riley Admin');
    await expect(page.getByRole('list', { name: 'Recent audit events' })).toContainText('Accepted live sync batch');

    authMode = 'forbidden';
    await page.getByRole('button', { name: 'Refresh team dashboard' }).click();

    const forbiddenAuthPanel = page.getByRole('status', { name: authPanelName });
    await expect(forbiddenAuthPanel).toBeVisible();
    await expect(forbiddenAuthPanel).toHaveAttribute('aria-live', 'polite');
    await expect(forbiddenAuthPanel).toBeFocused();
    await expect(page.getByText('Live snapshot')).toHaveCount(0);
    await expect(page.getByText(longDeviceCursor)).toHaveCount(0);
    await expect(page.getByText('Accepted live sync batch')).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toHaveCount(0);
    expect(snapshotRequests.length).toBeGreaterThanOrEqual(2);
    expect(snapshotRequests.every((header) => header === undefined)).toBe(true);
  });

  test('aborts stale live admin snapshot refreshes before rendering newer data', async ({ page }) => {
    await page.addInitScript(() => {
      type PendingSnapshot = {
        resolve: (response: Response) => void;
      };
      const pendingSnapshots: PendingSnapshot[] = [];
      const originalFetch = window.fetch.bind(window);
      const abortError = () => new DOMException('Aborted', 'AbortError');

      Object.assign(window, {
        __adminSnapshotAbortCount: 0,
        __adminSnapshotPendingCount: () => pendingSnapshots.length,
        __resolveNextAdminSnapshot: (body: unknown) => {
          const pending = pendingSnapshots.shift();
          if (!pending) {
            throw new Error('No pending admin snapshot request');
          }

          pending.resolve(
            new Response(JSON.stringify(body), {
              headers: { 'Content-Type': 'application/json' },
              status: 200,
            }),
          );
        },
      });

      window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (!url.includes('/api/admin/snapshot')) {
          return originalFetch(input, init);
        }

        const signal = init?.signal;
        if (signal?.aborted) {
          return Promise.reject(abortError());
        }

        return new Promise<Response>((resolve, reject) => {
          const cleanup = () => signal?.removeEventListener('abort', handleAbort);
          const handleAbort = () => {
            cleanup();
            const index = pendingSnapshots.indexOf(pending);
            if (index >= 0) {
              pendingSnapshots.splice(index, 1);
            }
            (window as typeof window & { __adminSnapshotAbortCount: number }).__adminSnapshotAbortCount += 1;
            reject(abortError());
          };

          const pending: PendingSnapshot = {
            resolve: (response: Response) => {
              cleanup();
              resolve(response);
            },
          };
          signal?.addEventListener('abort', handleAbort, { once: true });
          pendingSnapshots.push(pending);
        });
      };
    });

    await page.goto('/?lang=en&adminSnapshot=live');
    await expect
      .poll(() => readAdminSnapshotHarnessState(page).then((state) => state.pendingCount))
      .toBe(1);
    const initialAbortCount = (await readAdminSnapshotHarnessState(page)).abortCount;
    const refreshButton = page.getByRole('button', { name: 'Refresh team dashboard' });
    const loadingPanel = page.getByRole('status', { name: loadingPanelName });
    await expect(page.locator('#main-content')).toHaveAttribute('aria-busy', 'true');
    await expect(loadingPanel).toBeVisible();
    await expect(loadingPanel).toHaveAttribute('aria-live', 'polite');
    await expectDescribedByText(page, loadingPanel, 'JoeSSH is fetching team, device, role, and audit state.');
    await expect(refreshButton).toHaveAttribute('aria-busy', 'true');
    await expect(refreshButton).toHaveAttribute('aria-describedby', 'admin-refresh-status');
    await expect(refreshButton).not.toHaveAttribute('aria-label');
    await expect(page.locator('#admin-refresh-status')).toHaveText('Loading snapshot');

    await refreshButton.click();

    await expect
      .poll(() => readAdminSnapshotHarnessState(page).then((state) => state.abortCount))
      .toBeGreaterThan(initialAbortCount);
    await expect
      .poll(() => readAdminSnapshotHarnessState(page).then((state) => state.pendingCount))
      .toBe(1);

    await page.evaluate((snapshot) => {
      (window as typeof window & { __resolveNextAdminSnapshot: (body: unknown) => void }).__resolveNextAdminSnapshot(snapshot);
    }, liveSnapshot());

    await expectSnapshotSource(page, 'Live snapshot');
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toContainText(longDeviceCursor);
    await expect(page.locator('#main-content')).toHaveAttribute('aria-busy', 'false');
    await expect(loadingPanel).toHaveCount(0);
    await expect(refreshButton).not.toHaveAttribute('aria-busy', 'true');
    await expect(refreshButton).not.toHaveAttribute('aria-describedby', 'admin-refresh-status');
  });

  test('aborts stale live admin snapshot body reads before rendering newer data', async ({ page }) => {
    await page.addInitScript(() => {
      type PendingSnapshotBody = {
        cancel: () => void;
        resolve: (body: unknown) => void;
      };
      const pendingBodies: PendingSnapshotBody[] = [];
      const originalFetch = window.fetch.bind(window);

      Object.assign(window, {
        __adminSnapshotAbortCount: 0,
        __adminSnapshotPendingCount: () => pendingBodies.length,
        __resolveNextAdminSnapshot: (body: unknown) => {
          const pending = pendingBodies.shift();
          if (!pending) {
            throw new Error('No pending admin snapshot body');
          }

          pending.resolve(body);
        },
      });

      window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        if (!url.includes('/api/admin/snapshot')) {
          return originalFetch(input, init);
        }

        const signal = init?.signal;
        if (signal?.aborted) {
          return Promise.reject(new DOMException('Aborted', 'AbortError'));
        }

        let pending: PendingSnapshotBody;
        const response = {
          body: {
            cancel: () => {
              pending.cancel();
              return Promise.resolve();
            },
          },
          headers: {
            get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
          },
          json: () =>
            new Promise((resolve) => {
              pending = {
                cancel: () => {
                  const index = pendingBodies.indexOf(pending);
                  if (index >= 0) {
                    pendingBodies.splice(index, 1);
                  }
                  (window as typeof window & { __adminSnapshotAbortCount: number }).__adminSnapshotAbortCount += 1;
                },
                resolve: (body: unknown) => resolve(body),
              };
              pendingBodies.push(pending);
            }),
          ok: true,
          status: 200,
        };

        return Promise.resolve(response as Response);
      };
    });

    await page.goto('/?lang=en&adminSnapshot=live');
    await expect
      .poll(() => readAdminSnapshotHarnessState(page).then((state) => state.pendingCount))
      .toBe(1);
    const initialAbortCount = (await readAdminSnapshotHarnessState(page)).abortCount;

    await page.getByRole('button', { name: 'Refresh team dashboard' }).click();

    await expect
      .poll(() => readAdminSnapshotHarnessState(page).then((state) => state.abortCount))
      .toBeGreaterThan(initialAbortCount);
    await expect
      .poll(() => readAdminSnapshotHarnessState(page).then((state) => state.pendingCount))
      .toBe(1);

    await page.evaluate((snapshot) => {
      (window as typeof window & { __resolveNextAdminSnapshot: (body: unknown) => void }).__resolveNextAdminSnapshot(snapshot);
    }, liveSnapshot());

    await expectSnapshotSource(page, 'Live snapshot');
    await expect(page.getByRole('table', { name: 'Managed team devices' })).toContainText(longDeviceCursor);
  });

  test('keeps admin state chrome localized outside English', async ({ page }) => {
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: emptySnapshot(),
      });
    });

    await page.goto('/?lang=zh-CN&adminSnapshot=live');

    const localizedEmptyPanel = page.getByRole('status', { name: '快照为空' });
    await expect(localizedEmptyPanel).toBeVisible();
    await expect(localizedEmptyPanel).toHaveAttribute('aria-live', 'polite');
    await expectDescribedByText(page, localizedEmptyPanel, '团队同步数据出现后会显示在这里。');
    await expect(localizedEmptyPanel).toBeFocused();
    await expect(page.getByText('尚无管理同步数据')).toBeVisible();
    await expect(page.getByText('团队同步数据出现后会显示在这里。')).toBeVisible();
    await expect(page.getByText('Empty snapshot')).toHaveCount(0);
    await expect(page.getByText('No admin sync data yet')).toHaveCount(0);
    await expect(page.getByText('No team sync data is available yet.')).toHaveCount(0);

    await page.unroute('**/api/admin/snapshot');
    await page.route('**/api/admin/snapshot', async (route) => {
      await route.fulfill({
        contentType: 'application/json',
        json: { debugToken: expectedAdminSnapshotAuthToken, error: 'service unavailable' },
        status: 503,
      });
    });

    await page.goto('/?lang=zh-CN&adminSnapshot=live');

    const localizedUnavailablePanel = page.getByRole('alert', { name: unavailablePanelNameZh });
    await expect(localizedUnavailablePanel).toBeVisible();
    await expect(localizedUnavailablePanel).toHaveAttribute('aria-live', 'assertive');
    await expectDescribedByText(page, localizedUnavailablePanel, unavailablePanelMessageZh);
    await expect(page.getByText(unavailablePanelMessageZh)).toBeVisible();
    await expect(page.getByText('Snapshot unavailable')).toHaveCount(0);
    await expect(page.getByText('Admin snapshot could not be loaded')).toHaveCount(0);
    await expect(page.getByText('Try refreshing or check the configured admin snapshot endpoint.')).toHaveCount(0);
    await expectRawAdminSnapshotErrorDetailsHidden(page, localizedUnavailablePanel);
    await expectAdminSnapshotAuthTokenHidden(page, localizedUnavailablePanel);
  });

  test('keeps navigation usable on mobile viewport', async ({ page }) => {
    await page.goto('/?lang=en&adminSnapshot=fixture');

    const adminNavigation = page.getByRole('navigation', { name: 'JoeSSH admin navigation' });
    await expect(adminNavigation).toBeVisible();
    await expect(adminNavigation).toHaveAttribute('aria-labelledby', 'admin-navigation-title');
    await expect(adminNavigation).not.toHaveAttribute('aria-label');
    await expect(page.locator('[aria-label]')).toHaveCount(0);
    const syncLink = page.getByRole('link', { name: 'Sync' });
    await expect(syncLink).toBeVisible();
    await expect(syncLink).toHaveAttribute('aria-current', 'location');
    for (const label of ['Sync', 'Devices', 'Team', 'Audit', 'Storage']) {
      const navigationLink = page.getByRole('link', { name: label });
      await expect(navigationLink).toBeVisible();
      await expect(navigationLink).not.toHaveAttribute('aria-label');
    }
    await page.goto('/?lang=en&adminSnapshot=fixture#devices');
    await expect(page.getByRole('link', { name: 'Devices' })).toHaveAttribute('aria-current', 'location');
    await expect(page.getByRole('link', { name: 'Sync' })).not.toHaveAttribute('aria-current', 'location');
    await page.getByRole('link', { name: 'Audit' }).click();
    await expect(page.getByRole('link', { name: 'Audit' })).toHaveAttribute('aria-current', 'location');
    await expect(page.getByRole('link', { name: 'Sync' })).not.toHaveAttribute('aria-current', 'location');
    await expect(page).toHaveURL(/#audit$/);
    await page.getByRole('link', { name: 'Sync' }).click();
    await expect(page.getByRole('link', { name: 'Sync' })).toHaveAttribute('aria-current', 'location');
    await page.getByRole('link', { name: 'Storage' }).click();
    await expect(page.getByRole('link', { name: 'Storage' })).toHaveAttribute('aria-current', 'location');
    await expect(page.locator('#storage')).toHaveAttribute('aria-labelledby', 'admin-storage-title admin-managed-devices-title');
    await expect(page.getByRole('table', { name: /Storage[\s\S]*Managed team devices/ })).toBeVisible();
    await expect(page.locator('#sync')).toBeVisible();
    await expect(page.locator('#devices')).toBeVisible();
    await expect(page.locator('#team')).toBeVisible();
    await expect(page.locator('#audit')).toBeVisible();
    await expect(page.locator('#storage')).toBeVisible();

    if ((page.viewportSize()?.width ?? Number.POSITIVE_INFINITY) <= 760) {
      await expectMobileTableCellLabel(page.locator('.memberTable [role="rowheader"][data-label="Member"]').first(), 'Member');
      await expectMobileTableCellLabel(page.locator('.deviceTable [role="cell"][data-label="Cursor"]').first(), 'Cursor');

      await page.goto('/?lang=ar-SA&adminSnapshot=fixture');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expectMobileTableCellLabel(page.locator('.memberTable .row:not(.headerRow) [role="rowheader"]').first(), 'عضو');
      await expectMobileTableCellLabel(page.locator('.deviceTable [role="cell"][data-label="المؤشر"]').first(), 'المؤشر');
      await expectNoDocumentOverflow(page);
    }
  });

  test('keeps the Chinese default path and English regional path testable', async ({ browser, baseURL }) => {
    const zhContext = await browser.newContext({ baseURL, locale: 'zh-CN' });
    const zhPage = await zhContext.newPage();
    await zhPage.goto('/?adminSnapshot=fixture');
    await expect(zhPage.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(zhPage.getByRole('heading', { exact: true, name: '\u56e2\u961f\u8fd0\u8425' })).toBeVisible();
    await expect(zhPage.getByRole('link').first()).toBeVisible();
    await zhContext.close();

    const enContext = await browser.newContext({ baseURL, locale: 'en-US' });
    const enPage = await enContext.newPage();
    await enPage.goto('/?adminSnapshot=fixture');
    await expect(enPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(enPage.getByRole('heading', { exact: true, name: 'Team operations' })).toBeVisible();
    await expect(enPage.getByRole('link', { name: /Sync/i })).toBeVisible();
    await enContext.close();
  });

  test('enforces strict core localization paths @i18n-strict', async ({ browser, baseURL }) => {
    const zhContext = await browser.newContext({ baseURL, locale: 'zh-CN' });
    const zhPage = await zhContext.newPage();
    await zhPage.goto('/?adminSnapshot=fixture');
    await expect(zhPage.locator('html')).toHaveAttribute('lang', 'zh-CN');
    await expect(zhPage.locator('html')).toHaveAttribute('dir', 'ltr');
    await expect(zhPage.getByText('Team operations')).toHaveCount(0);
    await expect(zhPage.getByText('Fixture fallback')).toHaveCount(0);
    await expect(zhPage.getByRole('link', { name: '\u540c\u6b65' })).toHaveAttribute('aria-current', 'location');
    await expect(zhPage.getByRole('cell', { name: /Current/ })).toHaveCount(0);
    await expect(zhPage.getByText('Current')).toHaveCount(2);
    await zhContext.close();

    const enContext = await browser.newContext({ baseURL, locale: 'en-US' });
    const enPage = await enContext.newPage();
    await enPage.goto('/');
    await expect(enPage.locator('html')).toHaveAttribute('lang', 'en');
    await expect(enPage.getByRole('heading', { exact: true, name: 'Team operations' })).toBeVisible();
    await expect(enPage.getByRole('link', { name: 'Sync' })).toBeVisible();
    await enContext.close();

    const arContext = await browser.newContext({ baseURL, locale: 'ar-SA' });
    const arPage = await arContext.newPage();
    await arPage.goto('/?adminSnapshot=fixture');
    await expect(arPage.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(arPage.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(arPage.getByRole('table').first()).toBeVisible();
    await arContext.close();
  });

  test('renders the admin shell under common market locales', async ({ browser, baseURL }) => {
    for (const locale of commonMarketLocales) {
      const context = await browser.newContext({ baseURL, locale });
      const localePage = await context.newPage();
      await localePage.goto('/?adminSnapshot=fixture');

      await expect(localePage.getByText('JoeSSH', { exact: true })).toBeVisible();
      await expect(localePage.locator('html')).toHaveAttribute('lang', expectedAtlasLocaleByMarketLocale[locale]);
      await expect(localePage.locator('html')).toHaveAttribute('dir', expectedTextDirectionByMarketLocale[locale]);
      await expect(localePage.getByRole('table').first()).toBeVisible();

      await context.close();
    }
  });
});

async function expectNoCriticalOrSeriousAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .options({
      runOnly: {
        type: 'tag',
        values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'],
      },
      rules: {
        'target-size': { enabled: true },
      },
    })
    .analyze();

  const violations = results.violations.filter(
    (violation) =>
      violation.id === 'target-size' || violation.impact === 'critical' || violation.impact === 'serious',
  );

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(`[${violation.impact}] ${violation.id}: ${violation.description}`);
      console.error(`  Help: ${violation.helpUrl}`);
      for (const node of violation.nodes.slice(0, 3)) {
        console.error(`  Target: ${node.target.join(', ')}`);
      }
    }
  }

  expect(violations).toEqual([]);
}

async function expectDescribedByText(page: Page, locator: Locator, expectedText: string | RegExp) {
  const descriptionId = await locator.getAttribute('aria-describedby');
  if (!descriptionId) {
    throw new Error('Expected locator to reference an aria-describedby target');
  }

  await expect(page.locator(`[id="${descriptionId}"]`)).toContainText(expectedText);
}

async function expectSnapshotSource(page: Page, expectedSource: string) {
  await expect(page.getByLabel('Snapshot status').getByText(expectedSource, { exact: true })).toBeVisible();
}

async function expectUnavailablePanelWithSafeCopy(page: Page) {
  const unavailablePanel = page.getByRole('alert', { name: unavailablePanelName });

  await expect(unavailablePanel).toBeVisible();
  const descriptionId = await unavailablePanel.getAttribute('aria-describedby');
  if (!descriptionId) {
    throw new Error('Expected unavailable panel to reference an aria-describedby target');
  }
  await expect(page.locator(`[id="${descriptionId}"]`)).toHaveText('Try refreshing or check the configured admin snapshot endpoint.');
  await expectRawAdminSnapshotErrorDetailsHidden(page, unavailablePanel);
  await expectAdminSnapshotAuthTokenHidden(page, unavailablePanel);

  return unavailablePanel;
}

async function expectRawAdminSnapshotErrorDetailsHidden(page: Page, unavailablePanel: Locator) {
  for (const detail of rawAdminSnapshotErrorDetails) {
    await expect(unavailablePanel).not.toContainText(detail);
    await expect(page.getByText(detail, { exact: true })).toHaveCount(0);
  }
}

async function expectAdminSnapshotAuthTokenHidden(page: Page, statePanel: Locator) {
  const trimmedToken = expectedAdminSnapshotAuthToken.trim();
  if (!trimmedToken) {
    return;
  }

  await expect(statePanel).not.toContainText(trimmedToken);
  await expect(page.getByRole('alert').filter({ hasText: trimmedToken })).toHaveCount(0);
  await expect(page.getByText(trimmedToken)).toHaveCount(0);
}

async function readAdminSnapshotHarnessState(page: Page) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      return await page.evaluate(() => {
        const windowWithHarness = window as typeof window & {
          __adminSnapshotAbortCount: number;
          __adminSnapshotPendingCount: () => number;
        };

        return {
          abortCount: windowWithHarness.__adminSnapshotAbortCount,
          pendingCount: windowWithHarness.__adminSnapshotPendingCount(),
        };
      });
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed') || attempt === 9) {
        throw error;
      }
      await page.waitForTimeout(100);
    }
  }

  throw new Error('Could not read admin snapshot harness state');
}

function liveSnapshot() {
  return {
    auditEvents: [
      {
        action: 'Accepted live sync batch',
        actor: 'Sync API',
        id: 'audit-live-sync',
        target: 'JoeSSH Sync',
        time: 'not-an-audit-timestamp',
      },
    ],
    devices: [
      {
        cursor: longDeviceCursor,
        id: 'live-desktop',
        lastSeen: 'Live',
        name: longDeviceName,
        owner: 'Riley Admin',
        platform: 'desktop',
        status: 'current',
      },
      {
        cursor: 'server-6',
        id: 'live-degraded',
        lastSeen: 'not-a-live-timestamp',
        name: 'Live Degraded Laptop',
        owner: 'Riley Admin',
        platform: 'desktop',
        status: 'degraded',
      },
      {
        cursor: 'server-4',
        id: 'live-offline',
        lastSeen: '2 hr ago',
        name: 'Live Offline Mobile',
        owner: 'Taylor Suspended',
        platform: 'ios',
        status: 'offline',
      },
    ],
    members: [
      {
        deviceCount: 1,
        email: 'riley@atlasterm.dev',
        id: 'member-riley',
        name: 'Riley Admin',
        role: 'Workspace Admin',
        status: 'active',
      },
      {
        deviceCount: 1,
        email: 'taylor@atlasterm.dev',
        id: 'member-taylor',
        name: 'Taylor Suspended',
        role: 'Operator',
        status: 'suspended',
      },
    ],
    metrics: {
      activeMembers: 1,
      auditEventsToday: 1,
      healthyDevices: 1,
      rolesConfigured: 1,
    },
    roles: [
      {
        id: 'workspace-admin',
        memberCount: 2,
        name: 'Workspace Admin',
        risk: 'full',
        scope: 'Members, roles, sync policy',
      },
    ],
  };
}

function emptySnapshot() {
  return {
    auditEvents: [],
    devices: [],
    members: [],
    metrics: {
      activeMembers: 0,
      auditEventsToday: 0,
      healthyDevices: 0,
      rolesConfigured: 0,
    },
    roles: [],
  };
}

async function expectMobileTableCellLabel(cell: Locator, label: string) {
  await expect(cell).toHaveAttribute('data-label', label);
  await expect
    .poll(async () =>
      cell.evaluate((element) => getComputedStyle(element, '::before').content.replace(/^["']|["']$/g, '')),
    )
    .toBe(label);
}
