import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nativeMocks = vi.hoisted(() => ({
  constants: {
    deviceName: 'Atlas Phone',
    expoConfig: { version: '9.9.9' },
    sessionId: 'mobile-session',
  },
  platform: { OS: 'ios' },
}));

vi.mock('expo-constants', () => ({
  default: nativeMocks.constants,
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
  normalizePlatform,
  pushMobilePresenceCheckpoint,
  registerDevice,
  resetRegisteredDeviceMemoryForTests,
  toSyncError,
} from './sync';

describe('mobile sync service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL;
    nativeMocks.constants.deviceName = 'Atlas Phone';
    nativeMocks.constants.expoConfig.version = '9.9.9';
    nativeMocks.constants.sessionId = 'mobile-session';
    nativeMocks.platform.OS = 'ios';
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
      id: 'mobile-session',
      name: 'Atlas Phone',
      platform: 'ios',
      connectionQuality: 'offline',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('registers through the public v1 sync API and maps the response', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100/';
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      server_time: '2026-05-25T00:00:00Z',
      sync_cursor: '0',
    }));

    const pendingDevice = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    const device = await pendingDevice;

    expect(getApiBaseUrl()).toBe('http://127.0.0.1:4100');
    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/devices/register',
      expect.objectContaining({
        body: JSON.stringify({
          platform: 'ios',
          app_version: '9.9.9',
          display_name: 'Atlas Phone',
        }),
        method: 'POST',
      }),
    );
    expect(device).toMatchObject({
      id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      registeredAt: '2026-05-25T00:00:00Z',
      connectionQuality: 'online',
    });
  });

  it('sends an existing UUID install id when available', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    nativeMocks.constants.sessionId = '1b9d5c4a-b2d8-4d38-9fb9-59ae1ce0e8ef';
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      device_id: '1b9d5c4a-b2d8-4d38-9fb9-59ae1ce0e8ef',
      server_time: '2026-05-25T00:00:00Z',
      sync_cursor: '0',
    }));

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
      .mockResolvedValueOnce(jsonResponse({
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        server_time: '2026-05-25T00:00:00Z',
        sync_cursor: '0',
      }))
      .mockResolvedValueOnce(jsonResponse({
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        server_time: '2026-05-25T00:05:00Z',
        sync_cursor: '0',
      }));

    const firstRegistration = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    await firstRegistration;

    const secondRegistration = registerDevice();
    await vi.advanceTimersByTimeAsync(250);
    await secondRegistration;

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body))).not.toHaveProperty('device_id');
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).toMatchObject({
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
    });
  });

  it('does not remember a server device id from a malformed register response', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch)
      .mockResolvedValueOnce(jsonResponse({
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        sync_cursor: '0',
      }))
      .mockResolvedValueOnce(jsonResponse({
        device_id: '26a2c7df-c3b8-4f0b-814a-1628f3da5a1d',
        server_time: '2026-05-25T00:05:00Z',
        sync_cursor: '0',
    }));

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

    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1][1]?.body))).not.toHaveProperty('device_id');
  });

  it('pulls a preview from the public v1 sync API', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      changes: [{ id: 'change-1' }, { id: 'change-2' }],
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      next_cursor: 'server-128',
    }));

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f');
    await vi.advanceTimersByTimeAsync(350);
    const preview = await pendingPreview;

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=0',
      expect.any(Object),
    );
    expect(preview.pendingChangeCount).toBe(2);
    expect(preview.cursor).toMatchObject({
      branch: 'sync-api',
      lastCommand: 'next cursor server-128',
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
    const expectation = expect(pendingPreview).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(350);
    await expectation;
  });

  it('pulls a preview from a retained sync cursor', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      changes: [{ id: 'change-3' }],
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      next_cursor: 'server-129',
    }));

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f', 'server-128');
    await vi.advanceTimersByTimeAsync(350);
    const preview = await pendingPreview;

    expect(fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4100/v1/sync/pull?device_id=0af7b567-8c34-4318-8c6b-31cddfc36e6f&since=server-128',
      expect.any(Object),
    );
    expect(preview.pendingChangeCount).toBe(1);
    expect(preview.syncCursor).toBe('server-129');
  });

  it('rejects a malformed pull response instead of reading missing changes', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      next_cursor: 'server-129',
    }));

    const pendingPreview = fetchSyncPreview('0af7b567-8c34-4318-8c6b-31cddfc36e6f', 'server-128');
    const pendingPreviewExpectation = expect(pendingPreview).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
    await vi.advanceTimersByTimeAsync(350);
    await pendingPreviewExpectation;
  });

  it('does not send authorization when no sync token is configured', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      server_time: '2026-05-25T00:00:00Z',
      sync_cursor: '0',
    }));

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
      .mockResolvedValueOnce(jsonResponse({
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        server_time: '2026-05-25T00:00:00Z',
        sync_cursor: '0',
      }))
      .mockResolvedValueOnce(jsonResponse({
        accepted: 1,
        conflicts: [],
        sync_cursor: 'server-1',
      }, 202))
      .mockResolvedValueOnce(jsonResponse({
        changes: [],
        device_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
        next_cursor: 'server-129',
      }));

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
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      accepted: 1,
      conflicts: [],
      sync_cursor: 'server-12',
    }, 202));

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

    await expect(pushMobilePresenceCheckpoint({
      connectionQuality: 'online',
      id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      name: 'Atlas Phone',
      platform: 'ios',
      registeredAt: '2026-05-25T00:00:00Z',
      syncCursor: '0',
    })).rejects.toMatchObject({
      code: 'unauthorized',
      recoverable: false,
    });
  });

  it('returns sync API wire-format conflicts from mobile presence push', async () => {
    process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL = 'http://127.0.0.1:4100';
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      accepted: 0,
      conflicts: [
        {
          entity_type: 'mobile_presence',
          entity_id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
          reason: 'changed_after_base_cursor',
        },
      ],
      sync_cursor: 'server-15',
    }, 202));

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
    vi.mocked(fetch).mockResolvedValue(jsonResponse({
      accepted: 1,
      sync_cursor: 'server-12',
    }, 202));

    await expect(pushMobilePresenceCheckpoint({
      connectionQuality: 'online',
      id: '0af7b567-8c34-4318-8c6b-31cddfc36e6f',
      name: 'Atlas Phone',
      platform: 'ios',
      registeredAt: '2026-05-25T00:00:00Z',
      syncCursor: 'server-11',
    })).rejects.toMatchObject({
      code: 'unknown',
      recoverable: true,
    });
  });

  it('returns an offline preview without a configured endpoint', async () => {
    const pendingPreview = fetchSyncPreview('offline-device');
    await vi.advanceTimersByTimeAsync(350);
    const preview = await pendingPreview;

    expect(preview.pendingChangeCount).toBe(2);
    expect(preview.devices[0]).toMatchObject({
      id: 'offline-device',
      connectionQuality: 'offline',
    });
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
    expect(asSyncError(new Error('render failed')).code).toBe('offline');
  });

  it('normalizes Expo web and native platforms to the Sync API enum', () => {
    expect(normalizePlatform('ios')).toBe('ios');
    expect(normalizePlatform('android')).toBe('android');
    expect(normalizePlatform('web')).toBe('web');
    expect(normalizePlatform('windows')).toBe('web');
  });

  it('builds fallback previews with emergency channels', () => {
    const preview = getFallbackPreview({
      connectionQuality: 'offline',
      id: 'mobile-offline',
      name: 'Offline phone',
      platform: 'ios',
      registeredAt: '2026-05-25T00:00:00Z',
    });

    expect(preview.emergencyChannels.some((channel) => channel.availableOffline)).toBe(true);
  });
});

function jsonResponse(body: unknown, status = 200) {
  return {
    json: () => Promise.resolve(body),
    ok: status >= 200 && status < 300,
    status,
  } as Response;
}
