import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createErrorMonitor,
  createNoopErrorMonitor,
  getLCPRating,
  getFIDRating,
  getCLSRating,
  getFCPRating,
  getBrowserTelemetryConsentStorage,
  getTTFBRating,
  getINPRating,
  isTelemetryOptedIn,
  readTelemetryConsent,
  sanitizeTelemetryText,
  TELEMETRY_CONSENT_STORAGE_KEY,
  writeTelemetryConsent,
} from './index';

const endpoint = '/api/errors';

function stubBrowserGlobals(overrides: { sendBeacon?: ReturnType<typeof vi.fn>; fetch?: ReturnType<typeof vi.fn> } = {}) {
  vi.stubGlobal('navigator', {
    userAgent: 'Vitest Browser',
    ...(overrides.sendBeacon ? { sendBeacon: overrides.sendBeacon } : {}),
  });
  vi.stubGlobal('window', { location: { href: 'http://localhost' } });

  if (overrides.fetch) {
    vi.stubGlobal('fetch', overrides.fetch);
  } else {
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', {
      userAgent: 'Vitest Browser',
      ...(overrides.sendBeacon ? { sendBeacon: overrides.sendBeacon } : {}),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
  }
}

describe('createErrorMonitor', () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('creates a monitor with report, flush, and install functions', () => {
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    expect(typeof monitor.report).toBe('function');
    expect(typeof monitor.flush).toBe('function');
    expect(typeof monitor.install).toBe('function');
  });

  it('parses explicit telemetry opt-in flags only', () => {
    expect(isTelemetryOptedIn('1')).toBe(true);
    expect(isTelemetryOptedIn(' true ')).toBe(true);
    expect(isTelemetryOptedIn('YES')).toBe(true);
    expect(isTelemetryOptedIn('on')).toBe(true);
    expect(isTelemetryOptedIn('0')).toBe(false);
    expect(isTelemetryOptedIn('false')).toBe(false);
    expect(isTelemetryOptedIn(undefined)).toBe(false);
  });

  it('reads and writes runtime telemetry consent defensively', () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => items.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        items.set(key, value);
      }),
    };

    expect(readTelemetryConsent(storage)).toBe(false);
    expect(writeTelemetryConsent(storage, true)).toBe(true);
    expect(storage.setItem).toHaveBeenCalledWith(TELEMETRY_CONSENT_STORAGE_KEY, 'true');
    expect(readTelemetryConsent(storage)).toBe(true);
    expect(writeTelemetryConsent(storage, false)).toBe(true);
    expect(readTelemetryConsent(storage)).toBe(false);

    const throwingStorage = {
      getItem: vi.fn(() => {
        throw new Error('blocked');
      }),
      setItem: vi.fn(() => {
        throw new Error('blocked');
      }),
    };

    expect(readTelemetryConsent(throwingStorage)).toBe(false);
    expect(writeTelemetryConsent(throwingStorage, true)).toBe(false);
    expect(readTelemetryConsent(undefined)).toBe(false);
    expect(writeTelemetryConsent(undefined, true)).toBe(false);
  });

  it('reads browser consent storage only when it is available and accessible', () => {
    expect(getBrowserTelemetryConsentStorage()).toBeUndefined();

    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('storage blocked');
      },
    });
    expect(getBrowserTelemetryConsentStorage()).toBeUndefined();

    const storage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
    };
    vi.stubGlobal('window', { localStorage: storage });
    expect(getBrowserTelemetryConsentStorage()).toBe(storage);
  });

  it('provides a no-op monitor for telemetry-off application shells', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createNoopErrorMonitor();

    expect(monitor.install()).toBeUndefined();
    expect(monitor.isEnabled()).toBe(false);
    monitor.enable();
    monitor.disable();
    monitor.addBreadcrumb('react', 'caught');
    monitor.report('private crash detail', 'stack');
    monitor.flush();

    expect(spy).not.toHaveBeenCalled();
    expect(monitor.getHealthReport()).toMatchObject({
      totalErrors: 0,
      uniqueGroups: 0,
      queueSize: 0,
    });
    expect(monitor.getWebVitals()).toEqual({});
  });

  it('disables runtime telemetry immediately by clearing queued reports and blocking new submissions', () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    stubBrowserGlobals({ fetch });
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint, maxQueue: 3, dedupeWindow: 0 });

    monitor.addBreadcrumb('ssh', 'connect alice@prod.example.com');
    monitor.setUser('alice');
    monitor.setSession('session-1');
    monitor.setTag('surface', 'desktop');
    monitor.report('queued before disable');
    expect(monitor.getHealthReport().queueSize).toBe(1);

    monitor.disable();
    expect(monitor.isEnabled()).toBe(false);
    expect(monitor.getHealthReport()).toMatchObject({
      breadcrumbCount: 0,
      queueSize: 0,
      totalErrors: 0,
      uniqueGroups: 0,
    });

    monitor.report('blocked after disable');
    monitor.flush();
    expect(fetch).not.toHaveBeenCalled();

    monitor.enable();
    monitor.report('allowed after enable');
    monitor.flush();
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject([{ message: 'allowed after enable' }]);
  });

  it('blocks every state-mutating telemetry API while disabled', () => {
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.disable();

    monitor.addBreadcrumb('ssh', 'connect');
    monitor.setUser('user-1');
    monitor.setSession('session-1');
    monitor.setTag('surface', 'desktop');
    monitor.removeTag('token');

    expect(monitor.install()).toBeUndefined();
    expect(monitor.trackWebVitals()).toBeUndefined();
    expect(monitor.getHealthReport()).toMatchObject({
      breadcrumbCount: 0,
      queueSize: 0,
      totalErrors: 0,
      uniqueGroups: 0,
    });
  });

  it('redacts sensitive telemetry text before transport', () => {
    const input = [
      'Authorization: Bearer sync-token-123',
      'username=alice',
      'host=prod.example.com',
      'command="cat /srv/secrets.txt"',
      'path=C:\\Users\\alice\\.ssh\\id_ed25519',
      'ssh alice@prod.example.com:22',
      '-----BEGIN OPENSSH PRIVATE KEY-----abc-----END OPENSSH PRIVATE KEY-----',
    ].join(' ');

    const redacted = sanitizeTelemetryText(input);

    expect(redacted).not.toContain('sync-token-123');
    expect(redacted).not.toContain('alice');
    expect(redacted).not.toContain('prod.example.com');
    expect(redacted).not.toContain('/srv/secrets.txt');
    expect(redacted).not.toContain('id_ed25519');
    expect(redacted).not.toContain('OPENSSH PRIVATE KEY');
    expect(redacted).toContain('[redacted]');
  });

  it('redacts Unix paths both at the start of text and after a delimiter', () => {
    expect(sanitizeTelemetryText('/home/alice/.ssh/id_ed25519')).toBe('[redacted]');
    expect(sanitizeTelemetryText('open /var/log/auth.log')).toBe('open [redacted]');
  });

  it('sanitizes reports, URLs, breadcrumbs, and context values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('navigator', { userAgent: 'Vitest Browser' });
    vi.stubGlobal('window', {
      location: {
        href: 'https://admin.example.test/workspace?token=secret&host=prod.example.com#private',
      },
    });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });
    monitor.setUser('alice@prod.example.com');
    monitor.setSession('session path=/home/alice/.ssh/id_ed25519');
    monitor.setTag('surface', 'desktop alice@prod.example.com');
    monitor.setTag('path', '/home/alice/.ssh/config');
    monitor.setTag('token', 'admin-token');
    monitor.setTag('build', 42);
    monitor.addBreadcrumb('ssh', 'connect alice@prod.example.com', {
      host: 'db-01.internal',
      username: 'jdoe',
      command: 'cat /etc/passwd',
      path: 'relative/project/.ssh/config',
      fileName: 'id_ed25519',
      nested: { token: 'admin-token', safeLabel: 'release-channel' },
    });
    monitor.report('failed username=alice path=/home/alice/.ssh/config', 'Error: token=secret\n    at C:\\Users\\alice\\app.ts:1:1');

    const report = spy.mock.calls[0][1];
    const breadcrumbData = report.breadcrumbs[0].data;
    const payload = JSON.stringify(report);
    expect(payload).not.toContain('alice');
    expect(payload).not.toContain('db-01.internal');
    expect(payload).not.toContain('jdoe');
    expect(payload).not.toContain('prod.example.com');
    expect(payload).not.toContain('admin-token');
    expect(payload).not.toContain('relative/project/.ssh/config');
    expect(payload).not.toContain('id_ed25519');
    expect(payload).not.toContain('/home/alice/.ssh/config');
    expect(payload).not.toContain('C:\\Users');
    expect(report.userId).toBe('[redacted]');
    expect(report.sessionId).toBe('session path=[redacted]');
    expect(report.tags).toEqual({
      build: 42,
      surface: 'desktop [redacted]',
    });
    expect(breadcrumbData).toMatchObject({
      host: '[redacted]',
      username: '[redacted]',
      command: '[redacted]',
      path: '[redacted]',
      fileName: '[redacted]',
      nested: { token: '[redacted]', safeLabel: 'release-channel' },
    });
    expect(report.url).toBe('https://admin.example.test/workspace');
    expect(payload).toContain('[redacted]');
  });

  it('sanitizes arrays, unsupported values, deep objects, and root URLs', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('navigator', { userAgent: 'Vitest Browser' });
    vi.stubGlobal('window', { location: { href: 'https://admin.example.test/' } });
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.addBreadcrumb('context', 'mixed data', {
      list: ['safe', 42, true, null, undefined, () => 'private'],
      nested: {
        one: {
          two: {
            three: {
              four: {
                privateValue: 'must not escape',
              },
            },
          },
        },
      },
    });
    monitor.report('mixed telemetry');

    const report = spy.mock.calls[0][1];
    expect(report.url).toBe('https://admin.example.test');
    expect(report.breadcrumbs[0].data.list).toEqual([
      'safe',
      42,
      true,
      null,
      undefined,
      '[redacted]',
    ]);
    expect(report.breadcrumbs[0].data.nested.one.two.three.four).toBe('[redacted]');
  });

  it('logs to console when no endpoint is configured', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.report('test error', 'stack trace');
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toBe('[ErrorMonitor]');
    expect(spy.mock.calls[0][1]).toMatchObject({
      message: 'test error',
      stack: 'stack trace',
      app: 'test',
      version: '1.0.0',
    });
  });

  it('queues reports and flushes with sendBeacon when maxQueue is reached', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    stubBrowserGlobals({ sendBeacon });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint, maxQueue: 2 });
    monitor.report('error 1');
    expect(sendBeacon).not.toHaveBeenCalled();
    monitor.report('error 2');
    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(sendBeacon.mock.calls[0][0]).toBe(endpoint);
    const beaconBody = sendBeacon.mock.calls[0][1];
    expect(beaconBody).toBeInstanceOf(Blob);
    expect((beaconBody as Blob).type).toBe('application/json');
  });

  it('uses a string beacon body when Blob is unavailable', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    stubBrowserGlobals({ sendBeacon });
    vi.stubGlobal('Blob', undefined);

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    monitor.report('string beacon');
    monitor.flush();

    expect(sendBeacon).toHaveBeenCalledWith(endpoint, expect.any(String));
  });

  it('falls back to fetch when sendBeacon refuses the payload', () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    stubBrowserGlobals({ sendBeacon, fetch });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    monitor.report('queued report');
    monitor.flush();

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][0]).toBe(endpoint);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'POST', keepalive: true });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ 'Content-Type': 'application/json' });
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toMatchObject([{ message: 'queued report' }]);
  });

  it('retains reports when fetch rejects so a later flush can retry them', async () => {
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true });
    stubBrowserGlobals({ fetch });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    monitor.report('retry me');
    monitor.flush();
    await Promise.resolve();

    monitor.flush();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toMatchObject([{ message: 'retry me' }]);
  });

  it('retains only the newest maxQueue reports after failed transport', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('network down'));
    stubBrowserGlobals({ fetch });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint, maxQueue: 2 });
    monitor.report('older');
    monitor.report('newer');
    await Promise.resolve();
    monitor.report('newest');
    await Promise.resolve();

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(JSON.parse(fetch.mock.calls[1][1].body).map((report: { message: string }) => report.message)).toEqual([
      'newer',
      'newest',
    ]);
  });

  it('flush is a no-op when queue is empty', () => {
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.flush(); // should not throw
  });

  it('report includes timestamp as ISO string', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.report('test');
    const report = spy.mock.calls[0][1];
    expect(report.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('install reports browser errors, flushes before unload, and removes listeners on cleanup', () => {
    vi.useFakeTimers();
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn((type: string, listener: EventListener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('navigator', { userAgent: 'Vitest Browser' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener,
      location: { href: 'http://localhost' },
    });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    const cleanup = monitor.install();

    expect(addEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    expect(addEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));

    listeners.get('error')?.({ message: 'boom', error: new Error('boom') } as ErrorEvent);
    listeners.get('beforeunload')?.({} as Event);
    expect(fetch).toHaveBeenCalledOnce();

    cleanup?.();
    expect(removeEventListener).toHaveBeenCalledWith('error', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('unhandledrejection', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('beforeunload', expect.any(Function));
    expect(listeners.size).toBe(0);

    vi.advanceTimersByTime(30_000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('install returns undefined when window is not defined (SSR)', () => {
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });
    // no window
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    const cleanup = monitor.install();
    expect(cleanup).toBeUndefined();
  });

  it('report works in SSR without window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // no window — url should be empty, userAgent comes from global navigator (Node.js has one)
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.report('ssr error');
    expect(spy).toHaveBeenCalledOnce();
    const report = spy.mock.calls[0][1];
    expect(report.url).toBe('');
    expect(typeof report.userAgent).toBe('string');
  });

  it('report works without navigator (pure SSR)', () => {
    const origNavigator = globalThis.navigator;
    // intentionally removing navigator
    delete (globalThis as Record<string, unknown>).navigator;
    try {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
      monitor.report('pure ssr');
      expect(spy).toHaveBeenCalledOnce();
      const report = spy.mock.calls[0][1];
      expect(report.url).toBe('');
      expect(report.userAgent).toBe('');
    } finally {
      globalThis.navigator = origNavigator;
    }
  });

  it('install handles unhandledrejection events', () => {
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener,
      location: { href: 'http://localhost' },
    });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    monitor.install();

    // unhandledrejection with Error reason
    listeners.get('unhandledrejection')?.({ reason: new Error('promise failed') } as PromiseRejectionEvent);
    monitor.flush();
    expect(fetch).toHaveBeenCalledOnce();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body[0].message).toBe('promise failed');
  });

  it('install handles unhandledrejection with non-Error reason', () => {
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener,
      location: { href: 'http://localhost' },
    });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    monitor.install();

    listeners.get('unhandledrejection')?.({ reason: 'string reason' } as unknown as PromiseRejectionEvent);
    monitor.flush();
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body[0].message).toBe('string reason');
    expect(body[0].stack).toBeUndefined();
  });

  it('periodic flush fires on interval', () => {
    vi.useFakeTimers();
    const listeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn();
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener,
      location: { href: 'http://localhost' },
    });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint, flushInterval: 5000 });
    monitor.install();
    monitor.report('periodic test');

    expect(fetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('flush is a no-op without endpoint even with queued reports', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.report('queued');
    monitor.flush(); // should not throw, no fetch/sendBeacon
    expect(spy).toHaveBeenCalledOnce(); // only the report log
  });

  it('retains batch when fetch is undefined and sendBeacon fails', () => {
    const sendBeacon = vi.fn().mockReturnValue(false);
    // Remove fetch so typeof fetch === 'undefined' on line 70
    const origFetch = (globalThis as any).fetch;
    delete (globalThis as any).fetch;
    vi.stubGlobal('navigator', { sendBeacon, userAgent: 'Vitest' });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });

    try {
      const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint, maxQueue: 1 });
      monitor.report('no-fetch');
      // sendBeacon fails, fetch is undefined → retainFailedBatch (lines 70-72)
      // Now restore fetch and flush to verify the report was retained
      (globalThis as any).fetch = origFetch;
      const fetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetch);
      monitor.flush();
      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.parse(fetch.mock.calls[0][1].body)[0].message).toBe('no-fetch');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  it('retains batch when fetch is not available (no sendBeacon)', () => {
    // No sendBeacon at all, no fetch → tryFetch hits typeof fetch === 'undefined' via line 90
    const origFetch = (globalThis as any).fetch;
    delete (globalThis as any).fetch;
    vi.stubGlobal('navigator', { userAgent: 'Vitest' }); // no sendBeacon
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });

    try {
      const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint, maxQueue: 1 });
      monitor.report('no-fetch-no-beacon');
      // Now restore and flush to verify retention
      (globalThis as any).fetch = origFetch;
      const fetch = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetch);
      monitor.flush();
      expect(fetch).toHaveBeenCalledOnce();
      expect(JSON.parse(fetch.mock.calls[0][1].body)[0].message).toBe('no-fetch-no-beacon');
    } finally {
      (globalThis as any).fetch = origFetch;
    }
  });

  it('retains batch when fetch throws synchronously', () => {
    // Line 79-80: fetch throws (not rejects) synchronously
    const fetch = vi.fn().mockImplementation(() => { throw new Error('sync throw'); });
    stubBrowserGlobals({ fetch });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    monitor.report('sync-throw');
    monitor.flush();
    // The batch was retained; flush again with a working fetch
    const fetch2 = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetch2);
    monitor.flush();
    expect(fetch2).toHaveBeenCalledOnce();
    expect(JSON.parse(fetch2.mock.calls[0][1].body)[0].message).toBe('sync-throw');
  });

  it('sendBeacon success path does not fall back to fetch', () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    const fetch = vi.fn();
    stubBrowserGlobals({ sendBeacon, fetch });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    monitor.report('beacon test');
    monitor.flush();

    expect(sendBeacon).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('drops oldest entries when queue exceeds maxQueue', () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    stubBrowserGlobals({ fetch });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint, maxQueue: 2 });
    monitor.report('first');
    monitor.report('second');
    // Queue is now at maxQueue=2, next report should trigger flush and then add third
    monitor.report('third');

    // flush was triggered at maxQueue, fetch should have been called with first two
    expect(fetch).toHaveBeenCalledOnce();
    const flushed = JSON.parse(fetch.mock.calls[0][1].body);
    expect(flushed.length).toBe(2);
    expect(flushed[0].message).toBe('first');
    expect(flushed[1].message).toBe('second');

    // third is still in queue awaiting next flush
    monitor.flush();
    const secondBatch = JSON.parse(fetch.mock.calls[1][1].body);
    expect(secondBatch[0].message).toBe('third');
  });

  it('addBreadcrumb stores breadcrumbs and includes them in reports', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.addBreadcrumb('navigation', 'Navigated to /dashboard');
    monitor.addBreadcrumb('user', 'Clicked login button', { button: 'login' });
    monitor.report('test error');

    const report = spy.mock.calls[0][1];
    expect(report.breadcrumbs).toHaveLength(2);
    expect(report.breadcrumbs[0]).toMatchObject({
      category: 'navigation',
      message: 'Navigated to /dashboard',
    });
    expect(report.breadcrumbs[1]).toMatchObject({
      category: 'user',
      message: 'Clicked login button',
      data: { button: 'login' },
    });
  });

  it('addBreadcrumb respects maxBreadcrumbs limit', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', maxBreadcrumbs: 2 });

    monitor.addBreadcrumb('cat', 'first');
    monitor.addBreadcrumb('cat', 'second');
    monitor.addBreadcrumb('cat', 'third');
    monitor.report('test error');

    const report = spy.mock.calls[0][1];
    expect(report.breadcrumbs).toHaveLength(2);
    expect(report.breadcrumbs[0].message).toBe('second');
    expect(report.breadcrumbs[1].message).toBe('third');
  });

  it('each report gets a snapshot of breadcrumbs at report time', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.addBreadcrumb('cat', 'first');
    monitor.report('error 1');
    monitor.addBreadcrumb('cat', 'second');
    monitor.report('error 2');

    expect(spy.mock.calls[0][1].breadcrumbs).toHaveLength(1);
    expect(spy.mock.calls[1][1].breadcrumbs).toHaveLength(2);
  });

  it('install registers visibilitychange listener and flushes on hidden', () => {
    const listeners = new Map<string, EventListener>();
    const docListeners = new Map<string, EventListener>();
    const addEventListener = vi.fn((type: string, listener: EventListener) => {
      listeners.set(type, listener);
    });
    const removeEventListener = vi.fn((type: string, listener: EventListener) => {
      if (listeners.get(type) === listener) listeners.delete(type);
    });
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    const docAdd = vi.fn((type: string, listener: EventListener) => {
      docListeners.set(type, listener);
    });
    const docRemove = vi.fn((type: string, listener: EventListener) => {
      if (docListeners.get(type) === listener) docListeners.delete(type);
    });
    const docStub = {
      addEventListener: docAdd,
      removeEventListener: docRemove,
      visibilityState: 'visible' as string,
    };
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('window', {
      addEventListener,
      removeEventListener,
      location: { href: 'http://localhost' },
    });
    vi.stubGlobal('document', docStub);

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    const cleanup = monitor.install();

    expect(docAdd).toHaveBeenCalledWith('visibilitychange', expect.any(Function));

    monitor.report('test');
    // Simulate tab becoming hidden
    docStub.visibilityState = 'hidden';
    docListeners.get('visibilitychange')?.({} as Event);
    expect(fetch).toHaveBeenCalledOnce();

    cleanup?.();
    expect(docRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
  });

  it('visibilitychange handler is safe when document becomes undefined after install', () => {
    const docListeners = new Map<string, EventListener>();
    const docStub = {
      addEventListener: vi.fn((type: string, listener: EventListener) => {
        docListeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
      visibilityState: 'visible',
    };
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { href: 'http://localhost' },
    });
    vi.stubGlobal('document', docStub);

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint });
    monitor.install();
    monitor.report('test');

    // Remove document after install — handler should not throw
    vi.unstubAllGlobals();
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      location: { href: 'http://localhost' },
    });

    // This should not throw even though document is undefined
    expect(() => docListeners.get('visibilitychange')?.({} as Event)).not.toThrow();
  });

  it('deduplicates identical errors within the dedup window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 5000 });

    monitor.report('duplicate error', 'Error: duplicate\n    at foo.ts:1:1\n    at bar.ts:2:2');
    monitor.report('duplicate error', 'Error: duplicate\n    at foo.ts:1:1\n    at bar.ts:2:2');
    monitor.report('duplicate error', 'Error: duplicate\n    at foo.ts:1:1\n    at bar.ts:2:2');

    expect(spy).toHaveBeenCalledOnce();
  });

  it('reports different errors separately', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 5000 });

    monitor.report('error A', 'Error: A\n    at foo.ts:1:1');
    monitor.report('error B', 'Error: B\n    at bar.ts:1:1');

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reports same error again after dedup window expires', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 1000 });

    monitor.report('expiring error', 'Error: expiring\n    at foo.ts:1:1');
    expect(spy).toHaveBeenCalledOnce();

    vi.advanceTimersByTime(1500);
    monitor.report('expiring error', 'Error: expiring\n    at foo.ts:1:1');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('dedup uses message when stack is undefined', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 5000 });

    monitor.report('no-stack');
    monitor.report('no-stack');

    expect(spy).toHaveBeenCalledOnce();
  });

  it('recentErrors map is cleaned up when it grows too large', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', maxQueue: 3, dedupeWindow: 1000 });

    for (let i = 0; i < 5; i++) {
      monitor.report(`error-${i}`, `Error: ${i}\n    at file${i}.ts:1:1`);
    }

    vi.advanceTimersByTime(3000);

    for (let i = 5; i < 10; i++) {
      monitor.report(`error-${i}`, `Error: ${i}\n    at file${i}.ts:1:1`);
    }

    expect(spy).toHaveBeenCalledTimes(10);
  });

  it('rate limits reports when exceeding rate limit within window', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', rateLimit: 3, rateLimitWindow: 60000 });

    monitor.report('error 1');
    monitor.report('error 2');
    monitor.report('error 3');
    monitor.report('error 4');
    monitor.report('error 5');

    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('allows reports again after rate limit window expires', () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', rateLimit: 2, rateLimitWindow: 5000 });

    monitor.report('error 1');
    monitor.report('error 2');
    monitor.report('error 3');
    expect(spy).toHaveBeenCalledTimes(2);

    vi.advanceTimersByTime(6000);
    monitor.report('error 4');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('rate limit defaults to 10 per 60 seconds', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    for (let i = 0; i < 15; i++) {
      monitor.report(`error-${i}`);
    }

    expect(spy).toHaveBeenCalledTimes(10);
  });

  it('rate limit and dedup work together', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', rateLimit: 5, dedupeWindow: 5000 });

    monitor.report('dup error');
    monitor.report('dup error');
    monitor.report('unique 1');
    monitor.report('unique 2');
    monitor.report('unique 3');
    monitor.report('unique 4');
    monitor.report('unique 5');

    expect(spy).toHaveBeenCalledTimes(5);
  });

  it('assigns groupId and count to reports', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });

    monitor.report('grouped error', 'Error: grouped\n    at foo.ts:1:1');
    monitor.report('grouped error', 'Error: grouped\n    at foo.ts:1:1');
    monitor.report('different error', 'Error: different\n    at bar.ts:1:1');

    expect(spy).toHaveBeenCalledTimes(3);
    expect(spy.mock.calls[0][1].groupId).toBe('group-1');
    expect(spy.mock.calls[0][1].count).toBe(1);
    expect(spy.mock.calls[1][1].groupId).toBe('group-1');
    expect(spy.mock.calls[1][1].count).toBe(2);
    expect(spy.mock.calls[2][1].groupId).toBe('group-2');
    expect(spy.mock.calls[2][1].count).toBe(1);
  });

  it('bounds the error-group map and keeps group ids unique after eviction', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0, maxQueue: 2, rateLimit: 1000 });

    const total = 12; // exceeds the maxQueue*2 cap of 4 distinct signatures
    const ids = new Set<string>();
    for (let i = 0; i < total; i += 1) {
      monitor.report(`error ${i}`, `Error: ${i}\n    at file.ts:${i}:1`);
      ids.add(spy.mock.calls[i][1].groupId);
    }

    // Every distinct signature got a unique id (no size-based collision after eviction)...
    expect(ids.size).toBe(total);
    // ...and the live group map never grows past the cap (maxQueue*2).
    const health = monitor.getHealthReport();
    expect(health.uniqueGroups).toBeLessThanOrEqual(4);
  });

  it('groups errors by stack trace prefix', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });

    monitor.report('error A', 'Error: A\n    at foo.ts:1:1\n    at bar.ts:2:2');
    monitor.report('error A', 'Error: A\n    at foo.ts:1:1\n    at bar.ts:2:2');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1].groupId).toBe('group-1');
    expect(spy.mock.calls[1][1].groupId).toBe('group-1');
  });

  it('groups errors by message when stack is undefined', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });

    monitor.report('same message');
    monitor.report('same message');

    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][1].groupId).toBe('group-1');
    expect(spy.mock.calls[1][1].groupId).toBe('group-1');
  });

  it('includes groupId and count in reports sent to endpoint', () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    stubBrowserGlobals({ fetch });
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint: '/api/errors', dedupeWindow: 0 });

    monitor.report('endpoint error', 'Error: endpoint\n    at test.ts:1:1');
    monitor.report('endpoint error', 'Error: endpoint\n    at test.ts:1:1');
    monitor.flush();

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body[0].groupId).toBe('group-1');
    expect(body[0].count).toBe(1);
    expect(body[1].groupId).toBe('group-1');
    expect(body[1].count).toBe(2);
  });

  it('setUser adds userId to reports', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.setUser('user-123');
    monitor.report('error with user');

    expect(spy.mock.calls[0][1].userId).toBe('user-123');
  });

  it('setSession adds sessionId to reports', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.setSession('session-456');
    monitor.report('error with session');

    expect(spy.mock.calls[0][1].sessionId).toBe('session-456');
  });

  it('setTag adds tags to reports', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.setTag('environment', 'production');
    monitor.setTag('feature', 'checkout');
    monitor.report('error with tags');

    expect(spy.mock.calls[0][1].tags).toEqual({ environment: 'production', feature: 'checkout' });
  });

  it('setTag accepts number values', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.setTag('retryCount', 3);
    monitor.setTag('latencyMs', 250);
    monitor.report('error with numeric tags');

    expect(spy.mock.calls[0][1].tags).toEqual({ retryCount: 3, latencyMs: 250 });
  });

  it('removeTag removes tags from reports', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.setTag('environment', 'production');
    monitor.setTag('feature', 'checkout');
    monitor.removeTag('feature');
    monitor.report('error after remove tag');

    expect(spy.mock.calls[0][1].tags).toEqual({ environment: 'production' });
  });

  it('tags are undefined when no tags are set', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.report('error without tags');

    expect(spy.mock.calls[0][1].tags).toBeUndefined();
  });

  it('userId and sessionId are undefined when not set', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });

    monitor.report('error without user');

    expect(spy.mock.calls[0][1].userId).toBeUndefined();
    expect(spy.mock.calls[0][1].sessionId).toBeUndefined();
  });

  it('includes userId, sessionId, and tags in reports sent to endpoint', () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true });
    stubBrowserGlobals({ fetch });
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', endpoint: '/api/errors' });

    monitor.setUser('user-789');
    monitor.setSession('session-abc');
    monitor.setTag('region', 'us-east-1');
    monitor.report('endpoint error with context');
    monitor.flush();

    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body[0].userId).toBe('user-789');
    expect(body[0].sessionId).toBe('session-abc');
    expect(body[0].tags).toEqual({ region: 'us-east-1' });
  });

  it('getHealthReport returns error statistics', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });

    monitor.report('error A', 'Error: A\n    at foo.ts:1:1');
    monitor.report('error A', 'Error: A\n    at foo.ts:1:1');
    monitor.report('error B', 'Error: B\n    at bar.ts:1:1');

    const report = monitor.getHealthReport();
    expect(report.totalErrors).toBe(3);
    expect(report.uniqueGroups).toBe(2);
    expect(report.topGroups).toHaveLength(2);
    expect(report.topGroups[0].count).toBe(2);
    expect(report.topGroups[1].count).toBe(1);
  });

  it('getHealthReport includes message and stack from error groups', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });

    monitor.report('TypeError: cannot read property', 'TypeError: cannot read property\n    at main.ts:10:5');
    monitor.report('no-stack error');

    const report = monitor.getHealthReport();
    expect(report.topGroups).toHaveLength(2);
    const groupWithStack = report.topGroups.find((g) => g.message === 'TypeError: cannot read property');
    expect(groupWithStack).toBeDefined();
    if (groupWithStack) {
      expect(groupWithStack.stack).toContain('main.ts:10:5');
      expect(groupWithStack.firstSeen).toBeGreaterThan(0);
    }

    const groupWithoutStack = report.topGroups.find((g) => g.message === 'no-stack error');
    expect(groupWithoutStack).toBeDefined();
    if (groupWithoutStack) {
      expect(groupWithoutStack.stack).toBe('');
    }
  });

  it('getHealthReport returns empty state when no errors', () => {
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    const report = monitor.getHealthReport();
    expect(report.totalErrors).toBe(0);
    expect(report.uniqueGroups).toBe(0);
    expect(report.topGroups).toHaveLength(0);
    expect(report.queueSize).toBe(0);
    expect(report.breadcrumbCount).toBe(0);
  });

  it('trackWebVitals is a function on the monitor', () => {
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    expect(typeof monitor.trackWebVitals).toBe('function');
  });

  it('trackWebVitals is safe to call in SSR (no window)', () => {
    vi.unstubAllGlobals();
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    expect(() => monitor.trackWebVitals()).not.toThrow();
  });

  it('trackWebVitals sets up PerformanceObservers when available', () => {
    const observe = vi.fn();
    const observers: Array<{ type: string; buffered: boolean }> = [];

    class MockPerformanceObserver {
      constructor(_callback: PerformanceObserverCallback) {}
      observe(options: { type: string; buffered: boolean }) {
        observers.push(options);
        observe(options);
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Should observe LCP, FID, CLS, FCP, and INP
    expect(observe).toHaveBeenCalled();
    const types = observers.map((o) => o.type);
    expect(types).toContain('largest-contentful-paint');
    expect(types).toContain('first-input');
    expect(types).toContain('layout-shift');
    expect(types).toContain('paint');
    expect(types).toContain('event');
  });

  it('trackWebVitals reports LCP metric as breadcrumb', () => {
    const callbacks: Record<string, PerformanceObserverCallback> = {};

    class MockPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        this._callback = callback;
      }
      _callback: PerformanceObserverCallback;
      observe(options: { type: string; buffered: boolean }) {
        callbacks[options.type] = this._callback;
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Simulate LCP entry
    const lcpCallback = callbacks['largest-contentful-paint'];
    expect(lcpCallback).toBeDefined();
    lcpCallback(
      { getEntries: () => [{ startTime: 1500 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    monitor.report('test after vitals');

    const report = spy.mock.calls[0][1];
    const perfBreadcrumb = report.breadcrumbs.find(
      (b: { category: string }) => b.category === 'performance',
    );
    expect(perfBreadcrumb).toBeDefined();
    expect(perfBreadcrumb.message).toBe('Web Vital: LCP');
    expect(perfBreadcrumb.data).toMatchObject({
      name: 'LCP',
      value: 1500,
      rating: 'good',
    });
  });

  it('trackWebVitals rates LCP correctly', () => {
    const callbacks: Record<string, PerformanceObserverCallback> = {};

    class MockPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        this._callback = callback;
      }
      _callback: PerformanceObserverCallback;
      observe(options: { type: string; buffered: boolean }) {
        callbacks[options.type] = this._callback;
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Simulate poor LCP (>4000ms)
    callbacks['largest-contentful-paint'](
      { getEntries: () => [{ startTime: 5000 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    monitor.report('test');
    const perfBreadcrumb = spy.mock.calls[0][1].breadcrumbs.find(
      (b: { category: string }) => b.category === 'performance',
    );
    expect(perfBreadcrumb.data).toMatchObject({ rating: 'poor', value: 5000 });
  });

  it('trackWebVitals reports TTFB metric as breadcrumb', () => {
    class MockPerformanceObserver {
      constructor(_callback: PerformanceObserverCallback) {}
      observe(_options: { type: string; buffered: boolean }) {}
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([
        { requestStart: 100, responseStart: 500 },
      ]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    monitor.report('test after ttfb');
    const report = spy.mock.calls[0][1];
    const perfBreadcrumb = report.breadcrumbs.find(
      (b: { category: string }) => b.category === 'performance',
    );
    expect(perfBreadcrumb).toBeDefined();
    expect(perfBreadcrumb.message).toBe('Web Vital: TTFB');
    expect(perfBreadcrumb.data).toMatchObject({
      name: 'TTFB',
      value: 400,
      rating: 'good',
    });
  });

  it('trackWebVitals reports INP metric as breadcrumb', () => {
    const callbacks: Record<string, PerformanceObserverCallback> = {};

    class MockPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        this._callback = callback;
      }
      _callback: PerformanceObserverCallback;
      observe(options: { type: string; buffered: boolean }) {
        callbacks[options.type] = this._callback;
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Simulate INP entry
    const inpCallback = callbacks['event'];
    expect(inpCallback).toBeDefined();
    inpCallback(
      { getEntries: () => [{ duration: 150 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    monitor.report('test after inp');
    const report = spy.mock.calls[0][1];
    const perfBreadcrumb = report.breadcrumbs.find(
      (b: { category: string }) => b.category === 'performance',
    );
    expect(perfBreadcrumb).toBeDefined();
    expect(perfBreadcrumb.message).toBe('Web Vital: INP');
    expect(perfBreadcrumb.data).toMatchObject({
      name: 'INP',
      value: 150,
      rating: 'good',
    });
  });

  it('trackWebVitals rates INP correctly', () => {
    const callbacks: Record<string, PerformanceObserverCallback> = {};

    class MockPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        this._callback = callback;
      }
      _callback: PerformanceObserverCallback;
      observe(options: { type: string; buffered: boolean }) {
        callbacks[options.type] = this._callback;
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Simulate poor INP (>500ms)
    callbacks['event'](
      { getEntries: () => [{ duration: 600 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    monitor.report('test');
    const perfBreadcrumb = spy.mock.calls[0][1].breadcrumbs.find(
      (b: { category: string }) => b.category === 'performance',
    );
    expect(perfBreadcrumb.data).toMatchObject({ rating: 'poor', value: 600 });
  });

  it('trackWebVitals deduplicates repeated metrics', () => {
    const callbacks: Record<string, PerformanceObserverCallback> = {};

    class MockPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        this._callback = callback;
      }
      _callback: PerformanceObserverCallback;
      observe(options: { type: string; buffered: boolean }) {
        callbacks[options.type] = this._callback;
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Trigger LCP twice
    const lcpCallback = callbacks['largest-contentful-paint'];
    lcpCallback(
      { getEntries: () => [{ startTime: 1500 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    lcpCallback(
      { getEntries: () => [{ startTime: 2000 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    monitor.report('test dedup');
    const report = spy.mock.calls[0][1];
    const perfBreadcrumbs = report.breadcrumbs.filter(
      (b: { category: string }) => b.category === 'performance',
    );
    // Should only have one LCP breadcrumb due to dedup
    expect(perfBreadcrumbs).toHaveLength(1);
    expect(perfBreadcrumbs[0].data).toMatchObject({ name: 'LCP', value: 1500 });
  });

  it('trackWebVitals reports FID metric as breadcrumb', () => {
    const callbacks: Record<string, PerformanceObserverCallback> = {};

    class MockPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        this._callback = callback;
      }
      _callback: PerformanceObserverCallback;
      observe(options: { type: string; buffered: boolean }) {
        callbacks[options.type] = this._callback;
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Simulate FID entry
    const fidCallback = callbacks['first-input'];
    expect(fidCallback).toBeDefined();
    fidCallback(
      { getEntries: () => [{ startTime: 100, processingStart: 150 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    monitor.report('test after fid');
    const report = spy.mock.calls[0][1];
    const perfBreadcrumb = report.breadcrumbs.find(
      (b: { category: string }) => b.category === 'performance',
    );
    expect(perfBreadcrumb).toBeDefined();
    expect(perfBreadcrumb.message).toBe('Web Vital: FID');
    expect(perfBreadcrumb.data).toMatchObject({
      name: 'FID',
      value: 50,
      rating: 'good',
    });
  });

  it('trackWebVitals reports CLS metric as breadcrumb', () => {
    const callbacks: Record<string, PerformanceObserverCallback> = {};

    class MockPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        this._callback = callback;
      }
      _callback: PerformanceObserverCallback;
      observe(options: { type: string; buffered: boolean }) {
        callbacks[options.type] = this._callback;
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Simulate CLS entry
    const clsCallback = callbacks['layout-shift'];
    expect(clsCallback).toBeDefined();
    clsCallback(
      { getEntries: () => [{ entryType: 'layout-shift', hadRecentInput: false, value: 0.05 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    monitor.report('test after cls');
    const report = spy.mock.calls[0][1];
    const perfBreadcrumb = report.breadcrumbs.find(
      (b: { category: string }) => b.category === 'performance',
    );
    expect(perfBreadcrumb).toBeDefined();
    expect(perfBreadcrumb.message).toBe('Web Vital: CLS');
    expect(perfBreadcrumb.data).toMatchObject({
      name: 'CLS',
      rating: 'good',
    });
  });

  it('trackWebVitals reports FCP metric as breadcrumb', () => {
    const callbacks: Record<string, PerformanceObserverCallback> = {};

    class MockPerformanceObserver {
      constructor(callback: PerformanceObserverCallback) {
        this._callback = callback;
      }
      _callback: PerformanceObserverCallback;
      observe(options: { type: string; buffered: boolean }) {
        callbacks[options.type] = this._callback;
      }
      disconnect() {}
    }

    vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
    vi.stubGlobal('performance', {
      getEntriesByType: vi.fn().mockReturnValue([]),
    });
    vi.stubGlobal('window', { location: { href: 'http://localhost' } });
    vi.stubGlobal('navigator', { userAgent: 'Vitest' });

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
    monitor.trackWebVitals();

    // Simulate FCP entry
    const fcpCallback = callbacks['paint'];
    expect(fcpCallback).toBeDefined();
    fcpCallback(
      { getEntries: () => [{ name: 'first-contentful-paint', startTime: 1200 }] } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );

    monitor.report('test after fcp');
    const report = spy.mock.calls[0][1];
    const perfBreadcrumb = report.breadcrumbs.find(
      (b: { category: string }) => b.category === 'performance',
    );
    expect(perfBreadcrumb).toBeDefined();
    expect(perfBreadcrumb.message).toBe('Web Vital: FCP');
    expect(perfBreadcrumb.data).toMatchObject({
      name: 'FCP',
      value: 1200,
      rating: 'good',
    });
  });
});

describe('Web Vitals rating functions', () => {
  describe('getLCPRating', () => {
    it('returns good for values <= 2500', () => {
      expect(getLCPRating(0)).toBe('good');
      expect(getLCPRating(2500)).toBe('good');
    });
    it('returns needs-improvement for values 2501-4000', () => {
      expect(getLCPRating(2501)).toBe('needs-improvement');
      expect(getLCPRating(4000)).toBe('needs-improvement');
    });
    it('returns poor for values > 4000', () => {
      expect(getLCPRating(4001)).toBe('poor');
      expect(getLCPRating(10000)).toBe('poor');
    });
  });

  describe('getFIDRating', () => {
    it('returns good for values <= 100', () => {
      expect(getFIDRating(0)).toBe('good');
      expect(getFIDRating(100)).toBe('good');
    });
    it('returns needs-improvement for values 101-300', () => {
      expect(getFIDRating(101)).toBe('needs-improvement');
      expect(getFIDRating(300)).toBe('needs-improvement');
    });
    it('returns poor for values > 300', () => {
      expect(getFIDRating(301)).toBe('poor');
      expect(getFIDRating(500)).toBe('poor');
    });
  });

  describe('getCLSRating', () => {
    it('returns good for values <= 0.1', () => {
      expect(getCLSRating(0)).toBe('good');
      expect(getCLSRating(0.1)).toBe('good');
    });
    it('returns needs-improvement for values 0.11-0.25', () => {
      expect(getCLSRating(0.11)).toBe('needs-improvement');
      expect(getCLSRating(0.25)).toBe('needs-improvement');
    });
    it('returns poor for values > 0.25', () => {
      expect(getCLSRating(0.26)).toBe('poor');
      expect(getCLSRating(1)).toBe('poor');
    });
  });

  describe('getFCPRating', () => {
    it('returns good for values <= 1800', () => {
      expect(getFCPRating(0)).toBe('good');
      expect(getFCPRating(1800)).toBe('good');
    });
    it('returns needs-improvement for values 1801-3000', () => {
      expect(getFCPRating(1801)).toBe('needs-improvement');
      expect(getFCPRating(3000)).toBe('needs-improvement');
    });
    it('returns poor for values > 3000', () => {
      expect(getFCPRating(3001)).toBe('poor');
      expect(getFCPRating(5000)).toBe('poor');
    });
  });

  describe('getTTFBRating', () => {
    it('returns good for values <= 800', () => {
      expect(getTTFBRating(0)).toBe('good');
      expect(getTTFBRating(800)).toBe('good');
    });
    it('returns needs-improvement for values 801-1800', () => {
      expect(getTTFBRating(801)).toBe('needs-improvement');
      expect(getTTFBRating(1800)).toBe('needs-improvement');
    });
    it('returns poor for values > 1800', () => {
      expect(getTTFBRating(1801)).toBe('poor');
      expect(getTTFBRating(3000)).toBe('poor');
    });
  });

  describe('getINPRating', () => {
    it('returns good for values <= 200', () => {
      expect(getINPRating(0)).toBe('good');
      expect(getINPRating(200)).toBe('good');
    });
    it('returns needs-improvement for values 201-500', () => {
      expect(getINPRating(201)).toBe('needs-improvement');
      expect(getINPRating(500)).toBe('needs-improvement');
    });
    it('returns poor for values > 500', () => {
      expect(getINPRating(501)).toBe('poor');
      expect(getINPRating(1000)).toBe('poor');
    });
  });

  describe('getWebVitals', () => {
    it('returns empty object when no vitals tracked', () => {
      const monitor = createErrorMonitor({ app: 'test', version: '1.0.0' });
      expect(monitor.getWebVitals()).toEqual({});
    });

    it('skips non-performance breadcrumbs and breadcrumbs without data', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });
      monitor.addBreadcrumb('user', 'clicked button');
      monitor.addBreadcrumb('navigation', 'page load');
      expect(monitor.getWebVitals()).toEqual({});
      spy.mockRestore();
    });

    it('skips performance breadcrumbs with mismatched data shape', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });
      // Manually add a performance breadcrumb with wrong data shape
      monitor.addBreadcrumb('performance', 'custom metric', { custom: true });
      expect(monitor.getWebVitals()).toEqual({});
      spy.mockRestore();
    });

    it('returns collected web vitals from breadcrumbs', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const callbacks: Record<string, PerformanceObserverCallback> = {};

      class MockPerformanceObserver {
        constructor(callback: PerformanceObserverCallback) {
          this._callback = callback;
        }
        _callback: PerformanceObserverCallback;
        observe(options: { type: string; buffered: boolean }) {
          callbacks[options.type] = this._callback;
        }
        disconnect() {}
      }

      vi.stubGlobal('PerformanceObserver', MockPerformanceObserver);
      vi.stubGlobal('performance', { getEntriesByType: () => [] });

      const monitor = createErrorMonitor({ app: 'test', version: '1.0.0', dedupeWindow: 0 });
      monitor.trackWebVitals();

      // Simulate LCP
      callbacks['largest-contentful-paint'](
        { getEntries: () => [{ startTime: 1500 }] } as unknown as PerformanceObserverEntryList,
        {} as PerformanceObserver,
      );

      // Simulate FCP
      callbacks['paint'](
        { getEntries: () => [{ name: 'first-contentful-paint', startTime: 800 }] } as unknown as PerformanceObserverEntryList,
        {} as PerformanceObserver,
      );

      const vitals = monitor.getWebVitals();
      expect(vitals.LCP).toMatchObject({ value: 1500, rating: 'good' });
      expect(vitals.FCP).toMatchObject({ value: 800, rating: 'good' });
      expect(vitals.LCP.timestamp).toBeDefined();

      spy.mockRestore();
    });
  });
});
