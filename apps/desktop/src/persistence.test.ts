import { afterEach, describe, expect, it } from 'vitest';

import {
  CONNECTION_GROUPS_STORAGE_KEY,
  CONNECTION_ORDER_STORAGE_KEY,
  CUSTOM_CONNECTIONS_STORAGE_KEY,
  FAVORITES_KEY,
  LAYOUT_STORAGE_KEY,
  THEME_STORAGE_KEY,
  readStorageText,
  readStoredConnectionGroups,
  readStoredConnectionOrder,
  readStoredCustomConnections,
  readStoredLayout,
  readStoredStringList,
  readStoredTheme,
  writeStorageJson,
  writeStorageText,
  type DesktopLayoutState,
} from './persistence';

const originalWindow = globalThis.window;

const defaultLayout: DesktopLayoutState = {
  activeConnection: 'prod-edge-01',
  activeTab: 0,
  rightPanel: 'inspector',
  sidebarCollapsed: false,
};

function installStorage(
  initialValues: Record<string, string>,
  options: { throwOnGet?: boolean; throwOnSet?: boolean } = {},
) {
  const values = new Map(Object.entries(initialValues));
  const storage = {
    getItem(key: string) {
      if (options.throwOnGet) {
        throw new Error('storage unavailable');
      }

      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (options.throwOnSet) {
        throw new Error('storage quota exceeded');
      }

      values.set(key, value);
    },
  };

  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });

  return values;
}

afterEach(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: originalWindow,
  });
});

describe('desktop persistence helpers', () => {
  it('falls back from corrupt layout JSON', () => {
    installStorage({ [LAYOUT_STORAGE_KEY]: '{broken' });

    expect(readStoredLayout(defaultLayout)).toEqual(defaultLayout);
  });

  it('validates persisted layout values', () => {
    installStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        activeConnection: 'unknown-host',
        activeTab: 99,
        rightPanel: 'billing',
        sidebarCollapsed: 'yes',
      }),
    });

    expect(readStoredLayout(defaultLayout, {
      activeConnections: ['prod-edge-01', 'staging-api'],
      maxActiveTab: 2,
    })).toEqual(defaultLayout);
  });

  it('keeps valid persisted layout fields', () => {
    installStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        activeConnection: 'staging-api',
        activeTab: 1,
        rightPanel: 'sftp',
        sidebarCollapsed: true,
      }),
    });

    expect(readStoredLayout(defaultLayout, {
      activeConnections: ['prod-edge-01', 'staging-api'],
      maxActiveTab: 2,
    })).toEqual({
      activeConnection: 'staging-api',
      activeTab: 1,
      rightPanel: 'sftp',
      sidebarCollapsed: true,
    });
  });

  it('sanitizes stored string lists', () => {
    installStorage({
      [FAVORITES_KEY]: JSON.stringify([' prod-edge-01 ', '', 42, 'prod-edge-01', 'staging-api']),
    });

    expect(readStoredStringList(FAVORITES_KEY, { maxItems: 2 })).toEqual(['prod-edge-01', 'staging-api']);
  });

  it('sanitizes persisted connection group overrides', () => {
    installStorage({
      [CONNECTION_GROUPS_STORAGE_KEY]: JSON.stringify({
        ' prod-edge-01 ': ' Staging ',
        'staging-api': 'Unknown',
        'unknown-host': 'Production',
        'db-primary': '',
        '': 'Data',
        'db-replica-03': 42,
      }),
    });

    expect(readStoredConnectionGroups({
      allowedGroups: ['Production', 'Staging', 'Data'],
      connectionNames: ['prod-edge-01', 'staging-api', 'db-primary', 'db-replica-03'],
    })).toEqual({
      'prod-edge-01': 'Staging',
    });
  });

  it('falls back from invalid persisted connection group JSON', () => {
    installStorage({ [CONNECTION_GROUPS_STORAGE_KEY]: '[]' });

    expect(readStoredConnectionGroups()).toEqual({});
  });

  it('sanitizes persisted connection order and appends missing defaults', () => {
    installStorage({
      [CONNECTION_ORDER_STORAGE_KEY]: JSON.stringify([
        'staging-api',
        'unknown-host',
        'prod-edge-01',
        'staging-api',
      ]),
    });

    expect(readStoredConnectionOrder(['prod-edge-01', 'prod-edge-02', 'staging-api'])).toEqual([
      'staging-api',
      'prod-edge-01',
      'prod-edge-02',
    ]);
  });

  it('falls back to the default connection order when storage is invalid', () => {
    installStorage({ [CONNECTION_ORDER_STORAGE_KEY]: '{broken' });

    expect(readStoredConnectionOrder(['prod-edge-01', 'prod-edge-02'])).toEqual([
      'prod-edge-01',
      'prod-edge-02',
    ]);
  });

  it('falls back from unknown themes', () => {
    installStorage({ [THEME_STORAGE_KEY]: 'neon' });

    expect(readStoredTheme('system')).toBe('system');
  });

  it('swallows localStorage read and write failures', () => {
    installStorage({ [THEME_STORAGE_KEY]: 'dark' }, { throwOnGet: true, throwOnSet: true });

    expect(readStorageText(THEME_STORAGE_KEY)).toBeNull();
    expect(readStoredTheme('system')).toBe('system');
    expect(writeStorageText(THEME_STORAGE_KEY, 'light')).toBe(false);
    expect(writeStorageJson(LAYOUT_STORAGE_KEY, defaultLayout)).toBe(false);
  });

  it('writes text and JSON values when storage is available', () => {
    const values = installStorage({});

    expect(writeStorageText(THEME_STORAGE_KEY, 'dark')).toBe(true);
    expect(writeStorageJson(LAYOUT_STORAGE_KEY, defaultLayout)).toBe(true);
    expect(values.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(values.get(LAYOUT_STORAGE_KEY)).toBe(JSON.stringify(defaultLayout));
  });

  it('returns undefined when localStorage access throws (e.g. security error)', () => {
    // Simulate browsers that throw when accessing window.localStorage
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {},
    });
    Object.defineProperty(globalThis.window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('localStorage is not available');
      },
    });

    expect(readStorageText(THEME_STORAGE_KEY)).toBeNull();
    expect(writeStorageText(THEME_STORAGE_KEY, 'dark')).toBe(false);
    expect(writeStorageJson(LAYOUT_STORAGE_KEY, defaultLayout)).toBe(false);
  });

  it('returns null/false when window is undefined (SSR)', () => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: undefined,
    });

    expect(readStorageText(THEME_STORAGE_KEY)).toBeNull();
    expect(writeStorageText(THEME_STORAGE_KEY, 'dark')).toBe(false);
    expect(writeStorageJson(LAYOUT_STORAGE_KEY, defaultLayout)).toBe(false);
  });

  it('returns false when writeStorageJson receives a value that cannot be serialized', () => {
    installStorage({});

    // Create a circular reference that JSON.stringify cannot handle
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(writeStorageJson(THEME_STORAGE_KEY, circular)).toBe(false);
  });

  it('returns default layout when storage key does not exist', () => {
    installStorage({});

    expect(readStoredLayout(defaultLayout)).toEqual(defaultLayout);
  });

  it('accepts valid persisted themes', () => {
    installStorage({ [THEME_STORAGE_KEY]: 'dark' });
    expect(readStoredTheme('system')).toBe('dark');

    installStorage({ [THEME_STORAGE_KEY]: 'light' });
    expect(readStoredTheme('system')).toBe('light');

    installStorage({ [THEME_STORAGE_KEY]: 'system' });
    expect(readStoredTheme('dark')).toBe('system');
  });

  it('reads stored layout without options (defaults for undefined options)', () => {
    installStorage({
      [LAYOUT_STORAGE_KEY]: JSON.stringify({
        activeConnection: 'staging-api',
        activeTab: 1,
        rightPanel: 'sftp',
        sidebarCollapsed: true,
      }),
    });

    expect(readStoredLayout(defaultLayout)).toEqual({
      activeConnection: 'staging-api',
      activeTab: 1,
      rightPanel: 'sftp',
      sidebarCollapsed: true,
    });
  });

  it('reads stored connection groups without options', () => {
    installStorage({
      [CONNECTION_GROUPS_STORAGE_KEY]: JSON.stringify({
        'prod-edge-01': 'Production',
        'staging-api': 'Staging',
      }),
    });

    const result = readStoredConnectionGroups();
    expect(result).toEqual({
      'prod-edge-01': 'Production',
      'staging-api': 'Staging',
    });
  });

  it('reads valid custom connections and drops malformed entries', () => {
    installStorage({
      [CUSTOM_CONNECTIONS_STORAGE_KEY]: JSON.stringify([
        { name: 'my-box', host: '10.0.0.1', group: 'Personal', tags: ['ssh'], port: 22, username: 'lin' },
        { name: 'bad-no-host', group: 'Personal', tags: [] }, // missing host -> dropped
        { name: '', host: 'h', group: 'g', tags: [] }, // empty name -> dropped
        { name: 'bad-tags', host: 'h', group: 'g', tags: [1, 2] }, // non-string tags -> dropped
        { name: 'bad-port', host: 'h', group: 'g', tags: [], port: 70000 }, // out-of-range -> dropped
        'not-an-object', // dropped
      ]),
    });

    const result = readStoredCustomConnections();
    expect(result).toEqual([
      { name: 'my-box', host: '10.0.0.1', group: 'Personal', tags: ['ssh'], port: 22, username: 'lin' },
    ]);
  });

  it('de-duplicates custom connections by name (first wins)', () => {
    installStorage({
      [CUSTOM_CONNECTIONS_STORAGE_KEY]: JSON.stringify([
        { name: 'dup', host: 'first', group: 'g', tags: [] },
        { name: 'dup', host: 'second', group: 'g', tags: [] },
      ]),
    });

    expect(readStoredCustomConnections()).toEqual([
      { name: 'dup', host: 'first', group: 'g', tags: [] },
    ]);
  });

  it('returns an empty array for missing or non-array custom-connection storage', () => {
    installStorage({});
    expect(readStoredCustomConnections()).toEqual([]);

    installStorage({ [CUSTOM_CONNECTIONS_STORAGE_KEY]: JSON.stringify({ not: 'an array' }) });
    expect(readStoredCustomConnections()).toEqual([]);

    installStorage({ [CUSTOM_CONNECTIONS_STORAGE_KEY]: '{broken' });
    expect(readStoredCustomConnections()).toEqual([]);
  });

});
