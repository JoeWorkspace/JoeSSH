import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { RegisteredDevice } from '@/models/sync';

const nativeMocks = vi.hoisted(() => ({
  constants: {
    deviceName: 'Atlas Phone',
    expoConfig: { version: '9.9.9' },
    sessionId: 'mobile-session',
  },
  platform: { OS: 'ios' },
}));

const storageMocks = vi.hoisted(() => {
  const values = new Map<string, string>();

  return {
    getItem: vi.fn(async (key: string) => values.get(key) ?? null),
    removeItem: vi.fn(async (key: string) => {
      values.delete(key);
    }),
    setItem: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    values,
  };
});

vi.mock('expo-constants', () => ({
  default: nativeMocks.constants,
}));

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: storageMocks,
}));

vi.mock('react-native', () => ({
  Platform: nativeMocks.platform,
}));

import {
  asSyncError,
  fetchSyncPreview,
  getApiAuthToken,
  getApiBaseUrl,
  getFallbackPreview,
  isSyncError,
  MOBILE_SYNC_INSTALL_ID_STORAGE_KEY,
  MOBILE_SYNC_PENDING_PRESENCE_STORAGE_KEY,
  MOBILE_SYNC_REGISTRATION_STORAGE_KEY,
  normalizePlatform,
  pushMobilePresenceCheckpoint,
  registerDevice,
  resetRegisteredDeviceMemoryForTests,
  toSyncError,
} from './sync';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('mobile sync service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL;
    nativeMocks.constants.deviceName = 'Atlas Phone';
    nativeMocks.constants.expoConfig.version = '9.9.9';
    nativeMocks.constants.sessionId = 'mobile-session';
    nativeMocks.platform.OS = 'ios';
    storageMocks.getItem.mockClear();
    storageMocks.removeItem.mockClear();
    storageMocks.setItem.mockClear();
    storageMocks.values.clear();
    resetRegisteredDeviceMemoryForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN;
    delete process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL;
  });

  it('falls back to an offline device when no sync endpoint is configured', async () => {
    const pendingDevice = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    const device = await pendingDevice;

    expect(device).toMatchObject({
      name: 'Atlas Phone',
      platform: 'ios',
      connectionQuality: 'offline',
    });
    expect(device.id).toMatch(UUID_PATTERN);
    expect(storageMocks.values.get(MOBILE_SYNC_INSTALL_ID_STORAGE_KEY)).toBe(device.id);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('registers through the public v1 sync API and maps the response', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100/';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        server_time: '2026-05-25T00:00:00Z',
        sync_cursor: '0',
      }),
    );

    const pendingDevice = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    const device = await pendingDevice;

    expect(getApiBaseUrl()).toBe('http://127.0.0.1:4100');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/devices/register',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({
      device_id: expect.stringMatching(UUID_PATTERN),
      platform: 'ios',
      app_version: '9.9.9',
      display_name: 'Atlas Phone',
    });
    expect(device).toMatchObject({
      id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      registeredAt: '2026-05-25T00:00:00Z',
      connectionQuality: 'online',
    });
  });

  it('sends a persisted UUID install id when available', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    storageMocks.values.set(MOBILE_SYNC_INSTALL_ID_STORAGE_KEY, '1b9d5c4a-b2d8-4d38-9fb9-59ae1ce0e8ef');
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        device_id: '1b9d5c4a-b2d8-4d38-9fb9-59ae1ce0e8ef',
        server_time: '2026-05-25T00:00:00Z',
        sync_cursor: '0',
      }),
    );

    const pendingDevice = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    await pendingDevice;

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({
      device_id: '1b9d5c4a-b2d8-4d38-9fb9-59ae1ce0e8ef',
    });
  });

  it('reuses a server-assigned device id when the Expo install id is not a UUID', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          server_time: '2026-05-25T00:00:00Z',
          sync_cursor: '0',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          server_time: '2026-05-25T00:05:00Z',
          sync_cursor: '0',
        }),
      );

    const firstRegistration = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    await firstRegistration;

    resetRegisteredDeviceMemoryForTests();
    const secondRegistration = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    await secondRegistration;

    const firstDeviceId = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).device_id;
    expect(firstDeviceId).toMatch(UUID_PATTERN);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
    });
  });

  it('restores the last successful pull cursor after an app runtime restart', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          server_time: '2026-05-25T00:00:00Z',
          sync_cursor: '0',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changes: [{ id: 'change-1' }],
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          next_cursor: 'server-42',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          server_time: '2026-05-25T00:05:00Z',
          sync_cursor: '0',
        }),
      );

    const firstRegistration = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    const firstDevice = await firstRegistration;
    const firstPreview = fetchSyncPreview(firstDevice.id, firstDevice.syncCursor);
    await vi.advanceTimersByTimeAsync(350);
    await firstPreview;

    resetRegisteredDeviceMemoryForTests();
    const restoredRegistration = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    const restoredDevice = await restoredRegistration;

    expect(restoredDevice).toMatchObject({
      id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      syncCursor: 'server-42',
    });
    expect(JSON.parse(storageMocks.values.get(MOBILE_SYNC_REGISTRATION_STORAGE_KEY) ?? '{}')).toEqual({
      apiBaseUrl: 'http://127.0.0.1:4100',
      deviceId: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      syncCursor: 'server-42',
    });
  });

  it('does not reuse a registration that belongs to a different sync endpoint', async () => {
    storageMocks.values.set(MOBILE_SYNC_INSTALL_ID_STORAGE_KEY, '1b9d5c4a-b2d8-4d38-9fb9-59ae1ce0e8ef');
    storageMocks.values.set(
      MOBILE_SYNC_REGISTRATION_STORAGE_KEY,
      JSON.stringify({
        apiBaseUrl: 'https://old-sync.example',
        deviceId: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        syncCursor: 'server-99',
      }),
    );
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'https://new-sync.example';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        device_id: '1b9d5c4a-b2d8-4d38-9fb9-59ae1ce0e8ef',
        server_time: '2026-05-25T00:00:00Z',
        sync_cursor: '0',
      }),
    );

    const pendingDevice = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    await pendingDevice;

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({
      device_id: '1b9d5c4a-b2d8-4d38-9fb9-59ae1ce0e8ef',
    });
  });

  it('does not remember a server device id from a malformed register response', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          sync_cursor: '0',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          device_id: '26a2c7df-c3b8-4f0b-814a-1628f3da5a1d',
          server_time: '2026-05-25T00:05:00Z',
          sync_cursor: '0',
        }),
      );

    const failedRegistration = registerDevice();
    const failedRegistrationExpectation = expect(failedRegistration).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
    await vi.advanceTimersByTimeAsync(250);
    await failedRegistrationExpectation;

    const successfulRegistration = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    await successfulRegistration;

    const firstDeviceId = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).device_id;
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({
      device_id: firstDeviceId,
    });
  });

  it('rejects a non-UUID device identity from registration', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        device_id: 'not-a-device-uuid',
        server_time: '2026-05-25T00:00:00Z',
        sync_cursor: '0',
      }),
    );

    const pendingDevice = registerDevice();
    const expectation = expect(pendingDevice).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
    await vi.advanceTimersByTimeAsync(250);
    await expectation;
    expect(storageMocks.values.has(MOBILE_SYNC_REGISTRATION_STORAGE_KEY)).toBe(false);
  });

  it('pulls a preview from the public v1 sync API', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        changes: [{ id: 'change-1' }, { id: 'change-2' }],
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        next_cursor: 'server-128',
      }),
    );

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f');
    await vi.advanceTimersByTimeAsync(350);
    const preview = await pendingPreview;

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=0',
      expect.any(Object),
    );
    expect(preview.pendingChangeCount).toBe(2);
    expect(preview.cursor).toEqual({
      branch: '',
      lastCommand: '',
      workspace: '',
    });
    expect(preview.syncCursor).toBe('server-128');
  });

  it('classifies a web AbortError (DOMException) as a timeout, not unknown', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    // Web aborts reject with a DOMException (not instanceof Error).
    const abort =
      typeof DOMException === 'undefined'
        ? Object.assign(new Error('Aborted'), { name: 'AbortError' })
        : new DOMException('The operation was aborted.', 'AbortError');
    vi.mocked(fetch).mockRejectedValue(abort);

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f');
    const expectation = expect(pendingPreview).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(350);
    await expectation;
  });

  it('keeps the request timeout active while a response JSON body is stalled', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockImplementation(
      async (_url, init) =>
        ({
          json: () =>
            new Promise((_, reject) => {
              init?.signal?.addEventListener('abort', () => {
                reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
              });
            }),
          ok: true,
          status: 200,
        }) as Response,
    );

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f');
    const expectation = expect(pendingPreview).rejects.toMatchObject({
      code: 'timeout',
    });
    await vi.advanceTimersByTimeAsync(350);
    await vi.advanceTimersByTimeAsync(8_000);
    await expectation;
  });

  it('pulls a preview from a retained sync cursor', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        changes: [{ id: 'change-3' }],
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        next_cursor: 'server-129',
      }),
    );

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f', 'server-128');
    await vi.advanceTimersByTimeAsync(350);
    const preview = await pendingPreview;

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=server-128',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          'Content-Type': expect.any(String),
        }),
      }),
    );
    expect(preview.pendingChangeCount).toBe(1);
    expect(preview.syncCursor).toBe('server-129');
  });

  it('pulls every advertised page before reporting the preview ready', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          changes: [{ id: 'change-1' }, { id: 'change-2' }],
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          has_more: true,
          next_cursor: 'server-50',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changes: [{ id: 'change-3' }],
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          has_more: false,
          next_cursor: 'server-51',
        }),
      );

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f', 'server-40');
    await vi.advanceTimersByTimeAsync(350);
    const preview = await pendingPreview;

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4100/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=server-40',
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4100/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=server-50',
      expect.any(Object),
    );
    expect(preview.pendingChangeCount).toBe(3);
    expect(preview.syncCursor).toBe('server-51');
  });

  it('rejects a paginated pull whose cursor does not advance', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        changes: [],
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        has_more: true,
        next_cursor: 'server-40',
      }),
    );

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f', 'server-40');
    const expectation = expect(pendingPreview).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
    await vi.advanceTimersByTimeAsync(350);
    await expectation;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('rejects a malformed pull response instead of reading missing changes', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        next_cursor: 'server-129',
      }),
    );

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f', 'server-128');
    const pendingPreviewExpectation = expect(pendingPreview).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
    await vi.advanceTimersByTimeAsync(350);
    await pendingPreviewExpectation;
  });

  it('rejects a pull response for a different device identity', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        changes: [],
        device_id: '26a2c7df-c3b8-4f0b-814a-1628f3da5a1d',
        next_cursor: 'server-129',
      }),
    );

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f', 'server-128');
    const expectation = expect(pendingPreview).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
    await vi.advanceTimersByTimeAsync(350);
    await expectation;
  });

  it('does not send authorization when no sync token is configured', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse({
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        server_time: '2026-05-25T00:00:00Z',
        sync_cursor: '0',
      }),
    );

    const pendingDevice = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    await pendingDevice;

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/devices/register',
      expect.objectContaining({
        headers: expect.not.objectContaining({
          Authorization: expect.any(String),
        }),
      }),
    );
  });

  it('sends bearer authorization when sync token auth is configured', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN = '  mobile-token  ';
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        jsonResponse({
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          server_time: '2026-05-25T00:00:00Z',
          sync_cursor: '0',
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            accepted: 1,
            conflicts: [],
            sync_cursor: 'server-1',
          },
          202,
        ),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          changes: [],
          device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          next_cursor: 'server-129',
        }),
      );

    const pendingDevice = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    const device = await pendingDevice;

    await pushMobilePresenceCheckpoint(device);

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f');
    await vi.advanceTimersByTimeAsync(350);
    await pendingPreview;

    expect(getApiAuthToken()).toBe('mobile-token');
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'http://127.0.0.1:4100/v1/devices/register',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mobile-token',
        }),
      }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'http://127.0.0.1:4100/v1/sync/push',
      expect.objectContaining({
        body: expect.any(String),
        headers: expect.objectContaining({
          Authorization: 'Bearer mobile-token',
        }),
        method: 'POST',
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({
      base_cursor: '0',
      changes: [
        expect.objectContaining({
          entity_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          entity_type: 'mobile_presence',
          operation: 'update',
          payload: expect.objectContaining({
            client: 'atlasterm-mobile',
            connection_quality: 'online',
            device_name: 'Atlas Phone',
            platform: 'ios',
            preview_intent: 'pull_sync_preview',
          }),
        }),
      ],
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
    });
    expect(fetch).toHaveBeenNthCalledWith(
      3,
      'http://127.0.0.1:4100/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=0',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer mobile-token',
        }),
      }),
    );
  });

  it('pushes a mobile presence checkpoint with the registered sync cursor', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          accepted: 1,
          conflicts: [],
          sync_cursor: 'server-12',
        },
        202,
      ),
    );

    const result = await pushMobilePresenceCheckpoint({
      connectionQuality: 'online',
      id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      name: 'Atlas Phone',
      platform: 'ios',
      registeredAt: '2026-05-25T00:00:00Z',
      syncCursor: 'server-11',
    });

    expect(result).toMatchObject({
      accepted: 1,
      syncCursor: 'server-12',
    });
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/sync/push',
      expect.objectContaining({
        method: 'POST',
      }),
    );
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).toMatchObject({
      base_cursor: 'server-11',
      changes: [
        expect.objectContaining({
          entity_type: 'mobile_presence',
          id: expect.any(String),
        }),
      ],
    });
  });

  it('skips the mobile presence push when no endpoint is configured', async () => {
    const result = await pushMobilePresenceCheckpoint({
      connectionQuality: 'offline',
      id: 'offline-device',
      name: 'Offline Phone',
      platform: 'ios',
      registeredAt: '2026-05-25T00:00:00Z',
      syncCursor: '0',
    });

    expect(result).toMatchObject({
      accepted: 0,
      syncCursor: '0',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('classifies mobile presence push auth failures for the UI', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ code: 'invalid_authorization' }, 403));

    await expect(
      pushMobilePresenceCheckpoint({
        connectionQuality: 'online',
        id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        name: 'Atlas Phone',
        platform: 'ios',
        registeredAt: '2026-05-25T00:00:00Z',
        syncCursor: '0',
      }),
    ).rejects.toMatchObject({
      code: 'unauthorized',
      recoverable: false,
    });
  });

  it('returns sync API wire-format conflicts from mobile presence push', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          accepted: 0,
          conflicts: [
            {
              entity_type: 'mobile_presence',
              entity_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
              reason: 'changed_after_base_cursor',
            },
          ],
          sync_cursor: 'server-15',
        },
        202,
      ),
    );

    const result = await pushMobilePresenceCheckpoint({
      connectionQuality: 'online',
      id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      name: 'Atlas Phone',
      platform: 'ios',
      registeredAt: '2026-05-25T00:00:00Z',
      syncCursor: 'server-11',
    });

    expect(result.accepted).toBe(0);
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0]).toMatchObject({
      entity_type: 'mobile_presence',
      reason: 'changed_after_base_cursor',
    });
    expect(result.syncCursor).toBe('server-15');
  });

  it('rejects a malformed push response instead of returning undefined fields', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          accepted: 1,
          sync_cursor: 'server-12',
        },
        202,
      ),
    );

    await expect(
      pushMobilePresenceCheckpoint({
        connectionQuality: 'online',
        id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        name: 'Atlas Phone',
        platform: 'ios',
        registeredAt: '2026-05-25T00:00:00Z',
        syncCursor: 'server-11',
      }),
    ).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
  });

  it('reuses a pending presence change id after an ambiguous failed request', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch)
      .mockRejectedValueOnce(new Error('timeout while reading response'))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            accepted: 0,
            conflicts: [],
            sync_cursor: 'server-12',
          },
          202,
        ),
      );
    const device: RegisteredDevice = {
      connectionQuality: 'online',
      id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      name: 'Atlas Phone',
      platform: 'ios',
      registeredAt: '2026-05-25T00:00:00Z',
      syncCursor: 'server-11',
    };

    await expect(pushMobilePresenceCheckpoint(device)).rejects.toMatchObject({
      code: 'timeout',
    });
    const firstBody = JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body));
    expect(storageMocks.values.get(MOBILE_SYNC_PENDING_PRESENCE_STORAGE_KEY)).toContain(firstBody.changes[0].id);

    resetRegisteredDeviceMemoryForTests();
    await pushMobilePresenceCheckpoint(device);
    const retryBody = JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body));

    expect(retryBody.changes[0]).toMatchObject({
      client_time: firstBody.changes[0].client_time,
      id: firstBody.changes[0].id,
    });
    expect(storageMocks.values.has(MOBILE_SYNC_PENDING_PRESENCE_STORAGE_KEY)).toBe(false);
  });

  it('rejects fractional accepted counts in a push response', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(
      jsonResponse(
        {
          accepted: 0.5,
          conflicts: [],
          sync_cursor: 'server-12',
        },
        202,
      ),
    );

    await expect(
      pushMobilePresenceCheckpoint({
        connectionQuality: 'online',
        id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        name: 'Atlas Phone',
        platform: 'ios',
        registeredAt: '2026-05-25T00:00:00Z',
        syncCursor: 'server-11',
      }),
    ).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
  });

  it('returns an offline preview without a configured endpoint', async () => {
    const pendingPreview = fetchSyncPreview('offline-device');
    await vi.advanceTimersByTimeAsync(350);
    const preview = await pendingPreview;

    expect(preview.pendingChangeCount).toBe(0);
    expect(preview.devices[0]).toMatchObject({
      id: 'offline-device',
      connectionQuality: 'offline',
    });
    expect(preview.devices).toHaveLength(1);
    expect(preview.emergencyChannels).toEqual([]);
  });

  it('classifies sync failures for the mobile UI', () => {
    expect(toSyncError(new Error('network unavailable')).code).toBe('offline');
    // Web browsers reject offline fetches with these messages (no "network").
    expect(toSyncError(new Error('Failed to fetch')).code).toBe('offline');
    expect(toSyncError(new Error('Load failed')).code).toBe('offline');
    expect(toSyncError(new Error('timeout: sync API request exceeded 8000ms')).code).toBe('timeout');
    expect(toSyncError(new Error('sync API failed with 401')).code).toBe('unauthorized');
    expect(toSyncError(new Error('sync API failed with 403')).code).toBe('unauthorized');
    expect(toSyncError(new Error('sync API failed with 500')).code).toBe('unknown');
  });

  it('preserves structured sync errors at UI boundaries', () => {
    const unauthorized = toSyncError(new Error('sync API failed with 401'));

    expect(isSyncError(unauthorized)).toBe(true);
    expect(asSyncError(unauthorized)).toMatchObject({
      code: 'unauthorized',
      recoverable: false,
    });
    expect(asSyncError(new Error('render failed')).code).toBe('unknown');
    expect(
      isSyncError({
        code: 'not-a-real-code',
        message: {},
        recoverable: 'yes',
        title: 42,
      }),
    ).toBe(false);
  });

  it('normalizes Expo web and native platforms to the Sync API enum', () => {
    expect(normalizePlatform('ios')).toBe('ios');
    expect(normalizePlatform('android')).toBe('android');
    expect(normalizePlatform('web')).toBe('web');
    expect(normalizePlatform('windows')).toBe('web');
  });

  it('trims whitespace and trailing slashes from the configured API URL', () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = '  https://sync.example///  ';

    expect(getApiBaseUrl()).toBe('https://sync.example');
  });

  it('builds an honest empty fallback preview without fabricated recovery routes', () => {
    const preview = getFallbackPreview({
      connectionQuality: 'offline',
      id: 'mobile-offline',
      name: 'Offline phone',
      platform: 'ios',
      registeredAt: '2026-05-25T00:00:00Z',
    });

    expect(preview).toMatchObject({
      cursor: {
        branch: '',
        lastCommand: '',
        workspace: '',
      },
      devices: [{ id: 'mobile-offline' }],
      emergencyChannels: [],
      openSessionCount: 0,
      pendingChangeCount: 0,
      profileCount: 0,
    });
  });
});

function jsonResponse(body: unknown, status = 200) {
  return {
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}
