import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  getAdminLoadMode,
  getAdminSnapshotSourceDescriptor,
  getAdminSnapshotUrl,
  isAdminDashboardSnapshot,
  isEmptySnapshot,
  loadAdminDashboard,
  type AdminDashboardSnapshot,
} from './adminData';
import { fixtureAdminSnapshot } from './adminData.fixture';

const productionAdminDataSources = import.meta.glob<string>(['./adminData.ts', './main.tsx'], {
  eager: true,
  import: 'default',
  query: '?raw',
});
const ADMIN_SNAPSHOT_AUTH_ENV_NAME = ['VITE_ATLASTERM_ADMIN_SNAPSHOT', 'AUTH_TOKEN'].join('_');
const ADMIN_SNAPSHOT_SENTINEL_TOKEN = ['atlasterm', 'admin', 'snapshot', 'sentinel', 'token'].join('-');

describe('admin data boundary', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses live mode unless fixture snapshots are explicitly requested', () => {
    expect(getAdminLoadMode('')).toBe('live');
    expect(getAdminLoadMode('?adminSnapshot=fixture')).toBe('fixture');
    expect(getAdminLoadMode('?adminSnapshot=live')).toBe('live');
    expect(getAdminLoadMode('?adminSnapshot=unknown')).toBe('live');
  });

  it('fixture device lastSeen values are localizable (Live or "<n> min|hr ago")', () => {
    for (const device of fixtureAdminSnapshot.devices) {
      expect(device.lastSeen === 'Live' || /^\d+\s+(min|hr)\s+ago$/i.test(device.lastSeen)).toBe(true);
    }
  });

  it('reads load mode from window.location.search when no argument is provided', () => {
    // window is defined in happy-dom; getAdminLoadMode() reads window.location.search
    // In test env, location.search is '' → fixture mode
    expect(getAdminLoadMode()).toBe('live');
  });

  it('falls back to empty search string in SSR environment (no window)', () => {
    const origWindow = globalThis.window;
    // simulating SSR by deleting window
    delete (globalThis as Record<string, unknown>).window;
    try {
      expect(getAdminLoadMode()).toBe('live');
    } finally {
      globalThis.window = origWindow;
    }
  });

  it('loads a populated admin snapshot from the configured endpoint', async () => {
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(fixtureAdminSnapshot));

    await expect(loadAdminDashboard(fetcher, '/api/admin/snapshot')).resolves.toEqual(fixtureAdminSnapshot);
    await expect(
      loadAdminDashboard(
        vi.fn().mockResolvedValue(jsonResponse(fixtureAdminSnapshot, 200, 'application/problem+json')),
        '/api/admin/snapshot',
      ),
    ).resolves.toEqual(fixtureAdminSnapshot);
    const unsafeUrlFetcher = vi.fn().mockResolvedValue(jsonResponse(fixtureAdminSnapshot));

    await expect(loadAdminDashboard(unsafeUrlFetcher, 'https://sync.example.com/v1/admin/snapshot\r\nX-Injected: true')).resolves.toEqual(
      fixtureAdminSnapshot,
    );

    expect(fetcher).toHaveBeenCalledWith('/api/admin/snapshot', {
      body: null,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
      keepalive: false,
      method: 'GET',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(unsafeUrlFetcher).toHaveBeenCalledWith('/api/admin/snapshot', {
      body: null,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
      keepalive: false,
      method: 'GET',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
  });

  it('loads a populated admin snapshot from a streaming response body', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify(fixtureAdminSnapshot), { headers: jsonHeaders(), status: 200 }) as Response,
      );

    await expect(loadAdminDashboard(fetcher, '/api/admin/snapshot')).resolves.toEqual(fixtureAdminSnapshot);
  });

  it('keeps admin snapshot auth token names and sentinel values out of the production source contract', () => {
    expect(productionAdminDataSources['./adminData.ts'], './adminData.ts source contract').toBeTruthy();
    expect(productionAdminDataSources['./main.tsx'], './main.tsx source contract').toBeTruthy();

    for (const [sourcePath, source] of Object.entries(productionAdminDataSources)) {
      expect(source, `${sourcePath} admin snapshot auth env guard`).not.toContain(ADMIN_SNAPSHOT_AUTH_ENV_NAME);
      expect(source, `${sourcePath} admin snapshot sentinel token guard`).not.toContain(ADMIN_SNAPSHOT_SENTINEL_TOKEN);
    }

    expect(productionAdminDataSources['./adminData.ts'], './adminData.ts authorization header guard').not.toContain('Authorization');
    expect(productionAdminDataSources['./adminData.ts'], './adminData.ts bearer header guard').not.toContain('Bearer ');
  });

  it('returns the configured admin snapshot URL', () => {
    vi.stubEnv('VITE_ATLASTERM_ADMIN_SNAPSHOT_URL', '/custom/snapshot');

    expect(getAdminSnapshotUrl()).toBe('/custom/snapshot');

    vi.stubEnv('VITE_ATLASTERM_ADMIN_SNAPSHOT_URL', ' https://sync.example.com:8443/v1/admin/snapshot ');

    expect(getAdminSnapshotUrl()).toBe('https://sync.example.com:8443/v1/admin/snapshot');

    vi.stubEnv('VITE_ATLASTERM_ADMIN_SNAPSHOT_URL', ' https://sync.example.com:8443/v1/admin/snapshot?team=atlas#admin-token ');

    expect(getAdminSnapshotUrl()).toBe('https://sync.example.com:8443/v1/admin/snapshot?team=atlas');

    vi.stubEnv('VITE_ATLASTERM_ADMIN_SNAPSHOT_URL', '/custom/snapshot#admin-token');

    expect(getAdminSnapshotUrl()).toBe('/custom/snapshot');
  });

  it('describes the active admin snapshot source for operations UI', () => {
    vi.stubEnv('VITE_ATLASTERM_ADMIN_SNAPSHOT_URL', ' https://sync.example.com:8443/v1/admin/snapshot?team=atlas#admin-token ');

    expect(getAdminSnapshotSourceDescriptor('?adminSnapshot=fixture')).toEqual({
      mode: 'fixture',
      snapshotUrl: null,
      source: 'fixture',
    });
    expect(getAdminSnapshotSourceDescriptor('?adminSnapshot=live')).toEqual({
      mode: 'live',
      snapshotUrl: 'https://sync.example.com:8443/v1/admin/snapshot?team=atlas',
      source: 'live',
    });

    vi.stubEnv('VITE_ATLASTERM_ADMIN_SNAPSHOT_URL', 'javascript:alert(1)');

    expect(getAdminSnapshotSourceDescriptor()).toEqual({
      mode: 'live',
      snapshotUrl: '/api/admin/snapshot',
      source: 'live',
    });
  });

  it('falls back to default admin snapshot URL when env is not set', () => {
    vi.unstubAllEnvs();

    expect(getAdminSnapshotUrl()).toBe('/api/admin/snapshot');

    vi.stubEnv('VITE_ATLASTERM_ADMIN_SNAPSHOT_URL', '   ');

    expect(getAdminSnapshotUrl()).toBe('/api/admin/snapshot');
  });

  it('uses the same-origin proxy path for default live snapshot requests', async () => {
    vi.unstubAllEnvs();
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(fixtureAdminSnapshot));

    await expect(loadAdminDashboard(fetcher)).resolves.toEqual(fixtureAdminSnapshot);

    expect(fetcher).toHaveBeenCalledWith(
      '/api/admin/snapshot',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
        },
        method: 'GET',
      }),
    );
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('falls back to default admin snapshot URL for unsafe endpoints', () => {
    for (const value of [
      'javascript:alert(1)',
      'file:///tmp/admin-snapshot.json',
      'data:text/html,<script></script>',
      '//sync.example.com/v1/admin/snapshot',
      'https://admin:secret@sync.example.com/v1/admin/snapshot',
      'http://admin@sync.example.com/v1/admin/snapshot',
      'https://',
      'https:evil.com',
      'https:\\evil.com',
      'http:////host',
      'admin/snapshot',
      './admin/snapshot',
      '../admin/snapshot',
      '?adminSnapshot=live',
      '\\\\sync.example.com/v1/admin/snapshot',
      '/\\sync.example.com/v1/admin/snapshot',
      'https://sync.example.com\\@evil.example/v1/admin/snapshot',
      'https://exa mple.com/v1/admin/snapshot',
      'https://sync.example.com/v1/admin snapshot',
      '/custom/snapshot with space',
      'http://[::1',
      '/custom/snapshot\r\nX-Injected: true',
      'https://sync.example.com/v1/admin/snapshot\r\nX-Injected: true',
      '/custom/snapshot\u007fsecret',
      '/custom/snapshot\u009fsecret',
      `/custom/snapshot${String.fromCodePoint(0x200b)}secret`,
      `https://sync.example.com/v1/admin/${String.fromCodePoint(0x202e)}snapshot`,
    ]) {
      vi.stubEnv('VITE_ATLASTERM_ADMIN_SNAPSHOT_URL', value);

      expect(getAdminSnapshotUrl()).toBe('/api/admin/snapshot');
    }
  });

  it('does not send authorization for live admin snapshots even when a legacy token env is present', async () => {
    vi.stubEnv(ADMIN_SNAPSHOT_AUTH_ENV_NAME, `  ${ADMIN_SNAPSHOT_SENTINEL_TOKEN}  `);
    const fetcher = vi.fn().mockResolvedValue(jsonResponse(fixtureAdminSnapshot));

    await expect(loadAdminDashboard(fetcher, '/api/admin/snapshot')).resolves.toEqual(fixtureAdminSnapshot);
    expect(fetcher).toHaveBeenCalledWith('/api/admin/snapshot', {
      body: null,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
      },
      keepalive: false,
      method: 'GET',
      mode: 'cors',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      signal: expect.any(AbortSignal),
    });
    expect(fetcher.mock.calls[0]?.[1]?.headers).not.toHaveProperty('Authorization');
  });

  it('maps auth, empty, and network states to typed errors', async () => {
    const readUnauthorizedBody = vi.fn().mockResolvedValue({ token: 'admin-token' });
    await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponseWithReader(readUnauthorizedBody, 401)), '/snapshot')).rejects.toMatchObject({
      code: 'auth_required',
      message: 'Authentication is required before sync data can be shown.',
    });
    expect(readUnauthorizedBody).not.toHaveBeenCalled();

    const readForbiddenBody = vi.fn().mockResolvedValue({ code: 'admin_forbidden', token: 'admin-token' });
    await expect(
      loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponseWithReader(readForbiddenBody, 403)), '/snapshot'),
    ).rejects.toMatchObject({
      code: 'auth_required',
      message: 'Authentication is required before sync data can be shown.',
    });
    expect(readForbiddenBody).not.toHaveBeenCalled();

    await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponse(emptySnapshot())), '/snapshot')).rejects.toMatchObject({
      code: 'empty',
    });

    await expect(loadAdminDashboard(vi.fn().mockRejectedValue(new Error('offline admin-token')), '/snapshot')).rejects.toMatchObject({
      code: 'network',
      message: 'Admin snapshot is unreachable.',
    });
  });

  it('aborts a hung admin snapshot body via timeout and reports a network error', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn((_url: string, _init?: RequestInit) =>
        Promise.resolve({
          headers: jsonHeaders(),
          json: () => new Promise(() => {}),
          ok: true,
          status: 200,
        } as Response),
      );

      const pending = loadAdminDashboard(fetcher as unknown as typeof fetch, '/snapshot');
      const assertion = expect(pending).rejects.toMatchObject({ code: 'network' });
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(8_000);
      await assertion;
      expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts a hung admin snapshot request via timeout and reports a network error', async () => {
    vi.useFakeTimers();
    try {
      const fetcher = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          }),
      );

      const pending = loadAdminDashboard(fetcher as unknown as typeof fetch, '/snapshot');
      const assertion = expect(pending).rejects.toMatchObject({ code: 'network' });
      await vi.advanceTimersByTimeAsync(8_000);
      await assertion;
      expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts an in-flight admin snapshot when the caller signal aborts', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
    );

    const pending = loadAdminDashboard(fetcher as unknown as typeof fetch, '/snapshot', {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'network' });

    controller.abort();

    await assertion;
    expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('does not call fetch when the caller signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();

    await expect(
      loadAdminDashboard(fetcher as unknown as typeof fetch, '/snapshot', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('keeps caller abort ahead of a resolved non-OK admin snapshot response', async () => {
    const controller = new AbortController();
    const fetcher = vi.fn().mockResolvedValue(jsonResponse({}, 500));

    const pending = loadAdminDashboard(fetcher, '/snapshot', {
      signal: controller.signal,
    });

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: 'network' });
    expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('aborts an in-flight admin snapshot body read when the caller signal aborts', async () => {
    const controller = new AbortController();
    const cancelBodyRead = vi.fn().mockResolvedValue(undefined);
    let resolveJson: (snapshot: AdminDashboardSnapshot) => void = () => {};
    const fetcher = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        body: {
          cancel: cancelBodyRead,
        },
        headers: jsonHeaders(),
        json: () =>
          new Promise((resolve) => {
            resolveJson = resolve;
          }),
        ok: true,
        status: 200,
      } as unknown as Response),
    );

    const pending = loadAdminDashboard(fetcher as unknown as typeof fetch, '/snapshot', {
      signal: controller.signal,
    });
    const assertion = expect(pending).rejects.toMatchObject({ code: 'network' });

    await Promise.resolve();
    await Promise.resolve();
    controller.abort();

    await assertion;
    expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    expect(cancelBodyRead).toHaveBeenCalledWith('Admin snapshot request was aborted.');

    resolveJson(fixtureAdminSnapshot);
    await Promise.resolve();
    await expect(pending).rejects.toMatchObject({ code: 'network' });
  });

  it('rejects oversized admin snapshot content-length before reading the body', async () => {
    const cancelBodyRead = vi.fn().mockResolvedValue(undefined);
    const readJson = vi.fn().mockResolvedValue(fixtureAdminSnapshot);
    const fetcher = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        body: {
          cancel: cancelBodyRead,
        },
        headers: jsonHeaders('application/json; charset=utf-8', {
          'Content-Length': '1048577',
        }),
        json: readJson,
        ok: true,
        status: 200,
      } as unknown as Response),
    );

    await expect(loadAdminDashboard(fetcher as unknown as typeof fetch, '/snapshot')).rejects.toMatchObject({
      code: 'unknown',
      message: 'Admin snapshot response was too large.',
    });
    expect(readJson).not.toHaveBeenCalled();
    expect(cancelBodyRead).toHaveBeenCalledWith('Admin snapshot response was too large.');
  });

  it('rejects oversized streaming admin snapshot bodies and cancels the reader', async () => {
    const cancelSource = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      cancel: cancelSource,
      start(controller) {
        controller.enqueue(new Uint8Array(900_000));
        controller.enqueue(new Uint8Array(200_000));
      },
    });
    const fetcher = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        body,
        headers: jsonHeaders(),
        ok: true,
        status: 200,
      } as Response),
    );

    await expect(loadAdminDashboard(fetcher as unknown as typeof fetch, '/snapshot')).rejects.toMatchObject({
      code: 'unknown',
      message: 'Admin snapshot response was too large.',
    });
    expect(cancelSource).toHaveBeenCalledWith('Admin snapshot response was too large.');
  });

  it('does not start the admin snapshot body read when the caller aborts before queued JSON parsing', async () => {
    const controller = new AbortController();
    const readJson = vi.fn().mockResolvedValue(fixtureAdminSnapshot);
    const fetcher = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve({
        get ok() {
          queueMicrotask(() => controller.abort());
          return true;
        },
        headers: jsonHeaders(),
        json: readJson,
        status: 200,
      } as unknown as Response),
    );

    await expect(
      loadAdminDashboard(fetcher as unknown as typeof fetch, '/snapshot', {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ code: 'network' });
    expect(readJson).not.toHaveBeenCalled();
    expect((fetcher.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
  });

  it('recognizes empty snapshots without relying on metric values', () => {
    expect(isEmptySnapshot(emptySnapshot())).toBe(true);
    expect(isEmptySnapshot(fixtureAdminSnapshot)).toBe(false);
  });

  it('rejects malformed live snapshots before render code can consume them', async () => {
    await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponse({ devices: 'not an array', token: 'admin-token' })), '/snapshot')).rejects.toMatchObject({
      code: 'unknown',
      message: 'Admin snapshot response did not match the expected shape.',
    });

    await expect(
      loadAdminDashboard(
        vi.fn().mockResolvedValue(
          jsonResponse({
            ...fixtureAdminSnapshot,
            debugToken: 'admin-token',
            devices: [{ ...fixtureAdminSnapshot.devices[0], status: 'missing' }],
          }),
        ),
        '/snapshot',
      ),
    ).rejects.toMatchObject({
      code: 'unknown',
      message: 'Admin snapshot response did not match the expected shape.',
    });
  });

  it('rejects unsafe numeric counters before render code can consume them', async () => {
    const unsafeSnapshots = [
      {
        ...fixtureAdminSnapshot,
        metrics: { ...fixtureAdminSnapshot.metrics, activeMembers: -1 },
      },
      {
        ...fixtureAdminSnapshot,
        metrics: { ...fixtureAdminSnapshot.metrics, auditEventsToday: 1.5 },
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], deviceCount: -1 }],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [{ ...fixtureAdminSnapshot.roles[0], memberCount: 1.5 }],
      },
    ];

    for (const snapshot of unsafeSnapshots) {
      await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponse(snapshot)), '/snapshot')).rejects.toMatchObject({
        code: 'unknown',
      });
    }
  });

  it('rejects duplicate record ids before render code can consume them', async () => {
    const duplicateSnapshots = [
      {
        ...fixtureAdminSnapshot,
        auditEvents: [
          fixtureAdminSnapshot.auditEvents[0],
          { ...fixtureAdminSnapshot.auditEvents[1], id: fixtureAdminSnapshot.auditEvents[0].id },
        ],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [
          fixtureAdminSnapshot.devices[0],
          { ...fixtureAdminSnapshot.devices[1], id: ` ${fixtureAdminSnapshot.devices[0].id} ` },
        ],
      },
      {
        ...fixtureAdminSnapshot,
        members: [
          fixtureAdminSnapshot.members[0],
          { ...fixtureAdminSnapshot.members[1], id: fixtureAdminSnapshot.members[0].id },
        ],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [
          fixtureAdminSnapshot.roles[0],
          { ...fixtureAdminSnapshot.roles[1], id: fixtureAdminSnapshot.roles[0].id },
        ],
      },
    ];

    for (const snapshot of duplicateSnapshots) {
      await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponse(snapshot)), '/snapshot')).rejects.toMatchObject({
        code: 'unknown',
      });
    }
  });

  it('rejects blank, unsafe-character, or non-canonical record ids before render code can consume them', async () => {
    const unsafeIdSnapshots = [
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], id: '   ' }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], id: '' }],
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], id: '   ' }],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [{ ...fixtureAdminSnapshot.roles[0], id: '' }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], id: `device-${String.fromCharCode(0)}root` }],
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], id: 'member\nroot' }],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [{ ...fixtureAdminSnapshot.roles[0], id: `role-${String.fromCharCode(159)}root` }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], id: `device-${String.fromCodePoint(0x200d)}root` }],
      },
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], id: `audit-${String.fromCodePoint(0x202e)}root` }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], id: 'device root' }],
      },
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], id: 'audit/root' }],
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], id: 'Member-Root' }],
      },
    ];

    for (const snapshot of unsafeIdSnapshots) {
      await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponse(snapshot)), '/snapshot')).rejects.toMatchObject({
        code: 'unknown',
      });
    }
  });

  it('rejects record ids with surrounding whitespace before render code can consume them', async () => {
    const paddedIdSnapshots = [
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], id: ` ${fixtureAdminSnapshot.auditEvents[0].id}` }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], id: `${fixtureAdminSnapshot.devices[0].id} ` }],
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], id: ` ${fixtureAdminSnapshot.members[0].id} ` }],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [{ ...fixtureAdminSnapshot.roles[0], id: `${fixtureAdminSnapshot.roles[0].id} ` }],
      },
    ];

    for (const snapshot of paddedIdSnapshots) {
      await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponse(snapshot)), '/snapshot')).rejects.toMatchObject({
        code: 'unknown',
      });
    }
  });

  it('rejects blank, padded, or control-character display fields before render code can consume them', async () => {
    const unsafeFieldSnapshots = [
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], action: '   ' }],
      },
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], target: `${fixtureAdminSnapshot.auditEvents[0].target} ` }],
      },
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], time: '' }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], cursor: '   ' }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], lastSeen: ` ${fixtureAdminSnapshot.devices[0].lastSeen}` }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], name: '' }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], platform: `${fixtureAdminSnapshot.devices[0].platform} ` }],
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], email: '   ' }],
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], name: `${fixtureAdminSnapshot.members[0].name} ` }],
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], role: '' }],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [{ ...fixtureAdminSnapshot.roles[0], name: '   ' }],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [{ ...fixtureAdminSnapshot.roles[0], scope: '' }],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [{ ...fixtureAdminSnapshot.roles[0], scope: ` ${fixtureAdminSnapshot.roles[0].scope}` }],
      },
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], actor: 'Policy\nAdmin' }],
      },
      {
        ...fixtureAdminSnapshot,
        devices: [{ ...fixtureAdminSnapshot.devices[0], owner: `Riley${String.fromCharCode(127)}Admin` }],
      },
      {
        ...fixtureAdminSnapshot,
        roles: [{ ...fixtureAdminSnapshot.roles[0], scope: `Scope${String.fromCharCode(159)}Admin` }],
      },
      {
        ...fixtureAdminSnapshot,
        members: [{ ...fixtureAdminSnapshot.members[0], name: `Maya${String.fromCodePoint(0x200b)}Chen` }],
      },
      {
        ...fixtureAdminSnapshot,
        auditEvents: [{ ...fixtureAdminSnapshot.auditEvents[0], actor: `Policy${String.fromCodePoint(0x202e)}Admin` }],
      },
    ];

    for (const snapshot of unsafeFieldSnapshots) {
      await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponse(snapshot)), '/snapshot')).rejects.toMatchObject({
        code: 'unknown',
      });
    }
  });

  it('throws on non-OK responses that are not auth errors', async () => {
    const readServerErrorBody = vi.fn().mockResolvedValue({ error: 'server failed with admin-token' });
    await expect(loadAdminDashboard(vi.fn().mockResolvedValue(jsonResponseWithReader(readServerErrorBody, 500)), '/snapshot')).rejects.toMatchObject({
      code: 'unknown',
      message: 'Admin snapshot failed with 500.',
    });
    expect(readServerErrorBody).not.toHaveBeenCalled();
  });

  it('throws when response JSON is malformed or served with a non-JSON media type', async () => {
    const readMalformedJson = vi.fn().mockRejectedValue(new Error('invalid json with admin-token'));
    const fetcher = vi.fn().mockResolvedValue({
      headers: jsonHeaders(),
      json: readMalformedJson,
      ok: true,
      status: 200,
    });

    await expect(loadAdminDashboard(fetcher, '/snapshot')).rejects.toMatchObject({
      code: 'unknown',
      message: 'Admin snapshot response was not valid JSON.',
    });
    expect(readMalformedJson).toHaveBeenCalledOnce();

    const readNonJsonBody = vi.fn().mockResolvedValue(fixtureAdminSnapshot);
    await expect(
      loadAdminDashboard(
        vi.fn().mockResolvedValue({
          headers: new Headers({ 'Content-Type': 'text/html; charset=utf-8' }),
          json: readNonJsonBody,
          ok: true,
          status: 200,
        }),
        '/snapshot',
      ),
    ).rejects.toMatchObject({
      code: 'unknown',
      message: 'Admin snapshot response was not JSON.',
    });
    expect(readNonJsonBody).not.toHaveBeenCalled();
  });

  it('validates every status value accepted by the admin snapshot contract', () => {
    expect(
      isAdminDashboardSnapshot({
        ...fixtureAdminSnapshot,
        devices: [
          { ...fixtureAdminSnapshot.devices[0], status: 'current' },
          { ...fixtureAdminSnapshot.devices[0], id: 'catching-up', status: 'catching_up' },
          { ...fixtureAdminSnapshot.devices[0], id: 'degraded', status: 'degraded' },
          { ...fixtureAdminSnapshot.devices[0], id: 'offline', status: 'offline' },
        ],
        members: [
          { ...fixtureAdminSnapshot.members[0], status: 'active' },
          { ...fixtureAdminSnapshot.members[0], id: 'invited', status: 'invited' },
          { ...fixtureAdminSnapshot.members[0], id: 'suspended', status: 'suspended' },
        ],
      }),
    ).toBe(true);
  });

  it('rejects non-record values in isAdminDashboardSnapshot', () => {
    expect(isAdminDashboardSnapshot(null)).toBe(false);
    expect(isAdminDashboardSnapshot(undefined)).toBe(false);
    expect(isAdminDashboardSnapshot(42)).toBe(false);
    expect(isAdminDashboardSnapshot('string')).toBe(false);
    expect(isAdminDashboardSnapshot([1, 2, 3])).toBe(false);
  });
});

function jsonResponse(body: unknown, status = 200, contentType = 'application/json; charset=utf-8') {
  return jsonResponseWithReader(() => Promise.resolve(body), status, contentType);
}

function jsonResponseWithReader(readJson: () => Promise<unknown>, status = 200, contentType = 'application/json; charset=utf-8') {
  return {
    headers: jsonHeaders(contentType),
    json: readJson,
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}

function jsonHeaders(contentType = 'application/json; charset=utf-8', headers: Record<string, string> = {}) {
  return new Headers({ 'Content-Type': contentType, ...headers });
}

function emptySnapshot(): AdminDashboardSnapshot {
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
