/**
 * Lightweight error monitor for JoeSSH apps.
 * Captures unhandled errors/rejections and reports them to a configurable endpoint.
 * Falls back to console in development.
 *
 * Optional Web Vitals tracking via `trackWebVitals()`:
 * - LCP (Largest Contentful Paint)
 * - FID (First Input Delay)
 * - CLS (Cumulative Layout Shift)
 * - FCP (First Contentful Paint)
 * - TTFB (Time to First Byte)
 * - INP (Interaction to Next Paint)
 */

export type Breadcrumb = {
  category: string;
  message: string;
  timestamp: string;
  data?: Record<string, unknown>;
};

export function getLCPRating(value: number): 'good' | 'needs-improvement' | 'poor' {
  return value <= 2500 ? 'good' : value <= 4000 ? 'needs-improvement' : 'poor';
}

export function getFIDRating(value: number): 'good' | 'needs-improvement' | 'poor' {
  return value <= 100 ? 'good' : value <= 300 ? 'needs-improvement' : 'poor';
}

export function getCLSRating(value: number): 'good' | 'needs-improvement' | 'poor' {
  return value <= 0.1 ? 'good' : value <= 0.25 ? 'needs-improvement' : 'poor';
}

export function getFCPRating(value: number): 'good' | 'needs-improvement' | 'poor' {
  return value <= 1800 ? 'good' : value <= 3000 ? 'needs-improvement' : 'poor';
}

export function getTTFBRating(value: number): 'good' | 'needs-improvement' | 'poor' {
  return value <= 800 ? 'good' : value <= 1800 ? 'needs-improvement' : 'poor';
}

export function getINPRating(value: number): 'good' | 'needs-improvement' | 'poor' {
  return value <= 200 ? 'good' : value <= 500 ? 'needs-improvement' : 'poor';
}

export type ErrorReport = {
  message: string;
  stack?: string;
  url: string;
  userAgent: string;
  timestamp: string;
  app: string;
  version: string;
  breadcrumbs: Breadcrumb[];
  groupId?: string;
  count?: number;
  userId?: string;
  sessionId?: string;
  tags?: Record<string, string | number>;
};

export type ErrorGroup = {
  id: string;
  message: string;
  stack: string;
  count: number;
  firstSeen: number;
  lastSeen: number;
};

export type HealthReport = {
  totalErrors: number;
  uniqueGroups: number;
  recentErrors: number;
  queueSize: number;
  breadcrumbCount: number;
  topGroups: ErrorGroup[];
};

export type WebVitalEntry = {
  value: number;
  rating: string;
  timestamp: string;
};

export type WebVitalsReport = Record<string, WebVitalEntry>;

export type ErrorMonitorConfig = {
  app: string;
  version: string;
  endpoint?: string;
  maxQueue?: number;
  flushInterval?: number;
  maxBreadcrumbs?: number;
  dedupeWindow?: number;
  rateLimit?: number;
  rateLimitWindow?: number;
};

type TelemetryConsentStorage = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
};

const DEFAULT_MAX_QUEUE = 20;
const DEFAULT_FLUSH_INTERVAL = 30_000;
const DEFAULT_MAX_BREADCRUMBS = 30;
const DEFAULT_DEDUPE_WINDOW = 5_000;
const DEFAULT_RATE_LIMIT = 10;
const DEFAULT_RATE_LIMIT_WINDOW = 60_000;
export const TELEMETRY_CONSENT_STORAGE_KEY = 'atlasterm.telemetry.enabled';
const TELEMETRY_REDACTED = '[redacted]';
const PRIVATE_KEY_PATTERN = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi;
const SENSITIVE_ASSIGNMENT_PATTERN =
  /\b(token|password|passphrase|private[_\s-]?key|authorization|auth[_\s-]?token|sync[_\s-]?token|admin[_\s-]?token|host|hostname|username|user|command|cmd|path|filename|file|stdout|stderr|terminal[_\s-]?output)\b\s*[:=]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
const SENSITIVE_TELEMETRY_KEY_PATTERN =
  /^(?:token|password|passphrase|private[_\s-]?key|authorization|secret|auth[_\s-]?token|sync[_\s-]?token|admin[_\s-]?token|host|hostname|username|user|command|cmd|path|filename|file|stdout|stderr|terminal[_\s-]?output)$/i;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const SSH_TARGET_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+(?::\d+)?\b/g;
const WINDOWS_PATH_PATTERN = /[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g;
const UNIX_PATH_PATTERN = /(?:^|[\s"'(=])\/(?:Users|home|var|etc|srv|opt|tmp|mnt|Volumes)\/[^\s"',)]+/g;

export function isTelemetryOptedIn(value: unknown): boolean {
  return typeof value === 'string' && ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

export function readTelemetryConsent(storage: TelemetryConsentStorage | null | undefined): boolean {
  if (!storage) return false;

  try {
    return isTelemetryOptedIn(storage.getItem(TELEMETRY_CONSENT_STORAGE_KEY));
  } catch {
    return false;
  }
}

export function writeTelemetryConsent(storage: TelemetryConsentStorage | null | undefined, enabled: boolean): boolean {
  if (!storage) return false;

  try {
    storage.setItem(TELEMETRY_CONSENT_STORAGE_KEY, enabled ? 'true' : 'false');
    return true;
  } catch {
    return false;
  }
}

export function getBrowserTelemetryConsentStorage(): TelemetryConsentStorage | undefined {
  if (typeof window === 'undefined') return undefined;

  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function sanitizeTelemetryText(value: string): string {
  return value
    .replace(PRIVATE_KEY_PATTERN, TELEMETRY_REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${TELEMETRY_REDACTED}`)
    .replace(SENSITIVE_ASSIGNMENT_PATTERN, (_match, key: string) => `${key}=${TELEMETRY_REDACTED}`)
    .replace(SSH_TARGET_PATTERN, TELEMETRY_REDACTED)
    .replace(WINDOWS_PATH_PATTERN, TELEMETRY_REDACTED)
    .replace(UNIX_PATH_PATTERN, (match) => `${match[0] === '/' ? '' : match[0]}${TELEMETRY_REDACTED}`);
}

function sanitizeTelemetryUrl(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname === '/' ? '' : sanitizeTelemetryText(url.pathname)}`;
  } catch {
    return sanitizeTelemetryText(value);
  }
}

function sanitizeTelemetryData(value: unknown, depth = 0): unknown {
  if (depth > 4) return TELEMETRY_REDACTED;
  if (typeof value === 'string') return sanitizeTelemetryText(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeTelemetryData(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        sanitizeTelemetryData(
          isSensitiveTelemetryKey(key) ? TELEMETRY_REDACTED : item,
          depth + 1,
        ),
      ]),
    );
  }
  return TELEMETRY_REDACTED;
}

function sanitizeTelemetryTags(value: Record<string, string | number> | undefined): Record<string, string | number> | undefined {
  if (!value) return undefined;

  const entries = Object.entries(value).flatMap(([key, item]) => {
    const safeKey = sanitizeTelemetryTagKey(key);
    if (!safeKey) return [];

    return [[safeKey, sanitizeTelemetryTagValue(item)] as const];
  });

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeTelemetryTagKey(key: string): string | null {
  const safeKey = sanitizeTelemetryText(key).trim();
  if (!safeKey || safeKey === TELEMETRY_REDACTED || isSensitiveTelemetryKey(safeKey)) {
    return null;
  }
  return safeKey.slice(0, 64);
}

function sanitizeTelemetryTagValue(value: string | number): string | number {
  if (typeof value === 'number') return value;
  return sanitizeTelemetryText(value);
}

function sanitizeBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  return {
    category: sanitizeTelemetryText(breadcrumb.category),
    message: sanitizeTelemetryText(breadcrumb.message),
    timestamp: breadcrumb.timestamp,
    data: breadcrumb.data ? sanitizeTelemetryData(breadcrumb.data) as Record<string, unknown> : undefined,
  };
}

function sanitizeErrorReport(report: ErrorReport): ErrorReport {
  return {
    message: sanitizeTelemetryText(report.message),
    stack: report.stack ? sanitizeTelemetryText(report.stack) : undefined,
    url: sanitizeTelemetryUrl(report.url),
    userAgent: sanitizeTelemetryText(report.userAgent),
    timestamp: report.timestamp,
    app: sanitizeTelemetryText(report.app),
    version: sanitizeTelemetryText(report.version),
    breadcrumbs: report.breadcrumbs.map(sanitizeBreadcrumb),
    groupId: report.groupId ? sanitizeTelemetryText(report.groupId) : undefined,
    count: report.count,
    userId: report.userId ? sanitizeTelemetryText(report.userId) : undefined,
    sessionId: report.sessionId ? sanitizeTelemetryText(report.sessionId) : undefined,
    tags: sanitizeTelemetryTags(report.tags),
  };
}

function isSensitiveTelemetryKey(key: string): boolean {
  return SENSITIVE_TELEMETRY_KEY_PATTERN.test(key);
}

export function createNoopErrorMonitor() {
  return {
    report: (_message: string, _stack?: string) => undefined,
    flush: () => undefined,
    install: () => undefined,
    enable: () => undefined,
    disable: () => undefined,
    isEnabled: () => false,
    addBreadcrumb: (_category: string, _message: string, _data?: Record<string, unknown>) => undefined,
    setUser: (_id: string) => undefined,
    setSession: (_id: string) => undefined,
    setTag: (_key: string, _value: string | number) => undefined,
    removeTag: (_key: string) => undefined,
    trackWebVitals: () => undefined,
    getHealthReport: (): HealthReport => ({
      totalErrors: 0,
      uniqueGroups: 0,
      recentErrors: 0,
      queueSize: 0,
      breadcrumbCount: 0,
      topGroups: [],
    }),
    getWebVitals: (): WebVitalsReport => ({}),
  };
}

export function createErrorMonitor(config: ErrorMonitorConfig) {
  const queue: ErrorReport[] = [];
  const breadcrumbs: Breadcrumb[] = [];
  const maxQueue = config.maxQueue ?? DEFAULT_MAX_QUEUE;
  const flushInterval = config.flushInterval ?? DEFAULT_FLUSH_INTERVAL;
  const maxBreadcrumbs = config.maxBreadcrumbs ?? DEFAULT_MAX_BREADCRUMBS;
  const dedupeWindow = config.dedupeWindow ?? DEFAULT_DEDUPE_WINDOW;
  const rateLimit = config.rateLimit ?? DEFAULT_RATE_LIMIT;
  const rateLimitWindow = config.rateLimitWindow ?? DEFAULT_RATE_LIMIT_WINDOW;
  const recentErrors = new Map<string, number>();
  const errorGroups = new Map<string, { id: string; message: string; stack: string; count: number; firstSeen: number; lastSeen: number }>();
  let groupCounter = 0;
  const reportTimestamps: number[] = [];
  let userId: string | undefined;
  let sessionId: string | undefined;
  const tags: Record<string, string | number> = {};
  let disabled = false;

  function clearTelemetryState() {
    queue.splice(0);
    breadcrumbs.splice(0);
    recentErrors.clear();
    errorGroups.clear();
    reportTimestamps.splice(0);
    groupCounter = 0;
    userId = undefined;
    sessionId = undefined;
    for (const key of Object.keys(tags)) {
      delete tags[key];
    }
  }

  function enable() {
    disabled = false;
  }

  function disable() {
    disabled = true;
    clearTelemetryState();
  }

  function isEnabled() {
    return !disabled;
  }

  function addBreadcrumb(category: string, message: string, data?: Record<string, unknown>) {
    if (disabled) return;

    breadcrumbs.push({
      category: sanitizeTelemetryText(category),
      message: sanitizeTelemetryText(message),
      timestamp: new Date().toISOString(),
      data: data ? sanitizeTelemetryData(data) as Record<string, unknown> : undefined,
    });
    if (breadcrumbs.length > maxBreadcrumbs) {
      breadcrumbs.splice(0, breadcrumbs.length - maxBreadcrumbs);
    }
  }

  function report(message: string, stack?: string) {
    if (disabled) return;

    const now = Date.now();
    const safeMessage = sanitizeTelemetryText(message);
    const safeStack = stack ? sanitizeTelemetryText(stack) : undefined;
    const errorKey = safeStack ? safeStack.split('\n').slice(0, 3).join('\n') : safeMessage;
    const lastSeen = recentErrors.get(errorKey);
    if (lastSeen && now - lastSeen < dedupeWindow) {
      return;
    }
    recentErrors.set(errorKey, now);
    if (recentErrors.size > maxQueue * 2) {
      const oldest = now - dedupeWindow * 2;
      for (const [key, timestamp] of recentErrors) {
        if (timestamp < oldest) recentErrors.delete(key);
      }
    }

    reportTimestamps.push(now);
    const windowStart = now - rateLimitWindow;
    while (reportTimestamps.length > 0 && reportTimestamps[0] < windowStart) {
      reportTimestamps.shift();
    }
    if (reportTimestamps.length > rateLimit) {
      return;
    }

    let group = errorGroups.get(errorKey);
    if (!group) {
      groupCounter += 1;
      const groupId = `group-${groupCounter}`;
      group = { id: groupId, message: safeMessage, stack: safeStack ?? '', count: 0, firstSeen: now, lastSeen: 0 };
      errorGroups.set(errorKey, group);
      if (errorGroups.size > maxQueue * 2) {
        const oldestKey = errorGroups.keys().next().value;
        if (oldestKey !== undefined) errorGroups.delete(oldestKey);
      }
    }
    group.count++;
    group.lastSeen = now;

    const entry: ErrorReport = sanitizeErrorReport({
      message: safeMessage,
      stack: safeStack,
      url: typeof window !== 'undefined' ? sanitizeTelemetryUrl(window.location.href) : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      timestamp: new Date().toISOString(),
      app: config.app,
      version: config.version,
      breadcrumbs: [...breadcrumbs],
      groupId: group.id,
      count: group.count,
      userId,
      sessionId,
      tags: Object.keys(tags).length > 0 ? { ...tags } : undefined,
    });

    if (!config.endpoint) {
      console.error('[ErrorMonitor]', entry);
      return;
    }

    queue.push(entry);
    if (queue.length > maxQueue) {
      queue.splice(0, queue.length - maxQueue);
    }
    if (queue.length >= maxQueue) {
      flush();
    }
  }

  function retainFailedBatch(batch: ErrorReport[]) {
    const retained = batch.concat(queue).slice(-maxQueue);
    queue.splice(0, queue.length, ...retained);
  }

  function flush() {
    if (disabled) {
      queue.splice(0);
      return;
    }

    if (queue.length === 0 || !config.endpoint) return;
    const endpoint = config.endpoint;
    const batch = queue.splice(0);
    const body = JSON.stringify(batch);

    const tryFetch = () => {
      if (typeof fetch === 'undefined') {
        retainFailedBatch(batch);
        return;
      }

      try {
        fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body,
          keepalive: true,
        }).catch(() => {
          retainFailedBatch(batch);
        });
      } catch {
        retainFailedBatch(batch);
      }
    };

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const beaconBody =
        typeof Blob === 'undefined' ? body : new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(endpoint, beaconBody)) return;
      tryFetch();
      return;
    }

    tryFetch();
  }

  function install() {
    if (disabled) return;
    if (typeof window === 'undefined') return;

    const onError = (event: ErrorEvent) => {
      report(event.message, event.error?.stack);
    };

    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report(
        reason instanceof Error ? reason.message : String(reason),
        reason instanceof Error ? reason.stack : undefined,
      );
    };

    const onBeforeUnload = () => {
      flush();
    };

    const onVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        flush();
      }
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('beforeunload', onBeforeUnload);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange);
    }

    const timer = setInterval(flush, flushInterval);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
      clearInterval(timer);
    };
  }

  function setUser(id: string) {
    if (disabled) return;
    userId = sanitizeTelemetryText(id);
  }

  function setSession(id: string) {
    if (disabled) return;
    sessionId = sanitizeTelemetryText(id);
  }

  function setTag(key: string, value: string | number) {
    if (disabled) return;
    const safeKey = sanitizeTelemetryTagKey(key);
    if (!safeKey) return;
    tags[safeKey] = sanitizeTelemetryTagValue(value);
  }

  function removeTag(key: string) {
    const safeKey = sanitizeTelemetryTagKey(key);
    if (safeKey) delete tags[safeKey];
    delete tags[key];
  }

  /**
   * Track Core Web Vitals and report them as performance breadcrumbs.
   * Uses the native Performance Observer API where available.
   * Metrics tracked: LCP, FID, CLS, FCP, TTFB, INP.
   */
  function trackWebVitals() {
    if (disabled) return;
    if (typeof window === 'undefined' || typeof PerformanceObserver === 'undefined') return;

    const reportedMetrics = new Set<string>();

    function reportMetric(name: string, value: number, rating: 'good' | 'needs-improvement' | 'poor') {
      if (reportedMetrics.has(name)) return;
      reportedMetrics.add(name);
      addBreadcrumb('performance', `Web Vital: ${name}`, {
        name,
        value: Math.round(value),
        rating,
        url: window.location.href,
      });
    }

    /* v8 ignore start */
    // LCP - Largest Contentful Paint
    try {
      const lcpObserver = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length > 0) {
          const lastEntry = entries[entries.length - 1] as PerformanceEntry & { startTime: number };
          reportMetric('LCP', lastEntry.startTime, getLCPRating(lastEntry.startTime));
        }
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* LCP not supported */ }

    // FID - First Input Delay
    try {
      const fidObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const fidEntry = entry as PerformanceEntry & { processingStart: number };
          const fid = fidEntry.processingStart - fidEntry.startTime;
          reportMetric('FID', fid, getFIDRating(fid));
        }
      });
      fidObserver.observe({ type: 'first-input', buffered: true });
    } catch { /* FID not supported */ }

    // CLS - Cumulative Layout Shift
    try {
      let clsValue = 0;
      const clsObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const clsEntry = entry as PerformanceEntry & { hadRecentInput?: boolean; value?: number };
          if (!clsEntry.hadRecentInput && clsEntry.value !== undefined) {
            clsValue += clsEntry.value;
          }
        }
        reportMetric('CLS', clsValue, getCLSRating(clsValue));
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
    } catch { /* CLS not supported */ }

    // FCP - First Contentful Paint
    try {
      const fcpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.name === 'first-contentful-paint') {
            reportMetric('FCP', entry.startTime, getFCPRating(entry.startTime));
          }
        }
      });
      fcpObserver.observe({ type: 'paint', buffered: true });
    } catch { /* FCP not supported */ }

    // TTFB - Time to First Byte
    try {
      const navigationEntries = performance.getEntriesByType('navigation');
      if (navigationEntries.length > 0) {
        const navEntry = navigationEntries[0] as PerformanceNavigationTiming;
        const ttfb = navEntry.responseStart - navEntry.requestStart;
        reportMetric('TTFB', ttfb, getTTFBRating(ttfb));
      }
    } catch { /* TTFB not supported */ }

    // INP - Interaction to Next Paint
    try {
      let worstINP = 0;
      const inpObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const inpEntry = entry as PerformanceEntry & { duration: number };
          if (inpEntry.duration > worstINP) {
            worstINP = inpEntry.duration;
            reportMetric('INP', worstINP, getINPRating(worstINP));
          }
        }
      });
      inpObserver.observe({ type: 'event', buffered: true });
    } catch { /* INP not supported */ }
    /* v8 ignore stop */
  }

  function getHealthReport(): HealthReport {
    const groups = Array.from(errorGroups.values())
      .sort((a, b) => b.count - a.count || b.lastSeen - a.lastSeen || a.firstSeen - b.firstSeen)
      .map((g) => ({ ...g }));

    return {
      totalErrors: groups.reduce((sum, g) => sum + g.count, 0),
      uniqueGroups: groups.length,
      recentErrors: reportTimestamps.filter((t) => t > Date.now() - rateLimitWindow).length,
      queueSize: queue.length,
      breadcrumbCount: breadcrumbs.length,
      topGroups: groups.slice(0, 10),
    };
  }

  /**
   * Return collected Core Web Vitals from breadcrumbs.
   * Useful for performance monitoring dashboards.
   */
  function getWebVitals(): WebVitalsReport {
    const vitals: WebVitalsReport = {};
    for (const bc of breadcrumbs) {
      if (bc.category === 'performance' && bc.data && typeof bc.data === 'object') {
        const data = bc.data as Record<string, unknown>;
        if (typeof data.name === 'string' && typeof data.value === 'number' && typeof data.rating === 'string') {
          vitals[data.name] = { value: data.value, rating: data.rating, timestamp: bc.timestamp };
        }
      }
    }
    return vitals;
  }

  return { report, flush, install, enable, disable, isEnabled, addBreadcrumb, setUser, setSession, setTag, removeTag, trackWebVitals, getHealthReport, getWebVitals };
}
