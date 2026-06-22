export type AdminLoadMode = 'fixture' | 'live';

export type AdminSnapshotSourceDescriptor =
  | { mode: 'fixture'; snapshotUrl: null; source: 'fixture' }
  | { mode: 'live'; snapshotUrl: string; source: 'live' };

export type AdminDashboardSnapshot = {
  auditEvents: AuditEvent[];
  devices: DeviceRecord[];
  members: MemberRecord[];
  metrics: AdminMetrics;
  roles: RoleRecord[];
};

export type AdminMetrics = {
  activeMembers: number;
  auditEventsToday: number;
  healthyDevices: number;
  rolesConfigured: number;
};

export type DeviceStatus = 'catching_up' | 'current' | 'degraded' | 'offline';

export type DeviceRecord = {
  cursor: string;
  id: string;
  lastSeen: string;
  name: string;
  owner: string;
  platform: string;
  status: DeviceStatus;
};

export type AuditEvent = {
  action: string;
  actor: string;
  id: string;
  target: string;
  time: string;
};

export type MemberStatus = 'active' | 'invited' | 'suspended';

export type MemberRecord = {
  deviceCount: number;
  email: string;
  id: string;
  name: string;
  role: string;
  status: MemberStatus;
};

export type RoleRisk = 'elevated' | 'full' | 'limited';

export type RoleRecord = {
  id: string;
  memberCount: number;
  name: string;
  risk: RoleRisk;
  scope: string;
};

export type AdminDataErrorCode = 'auth_required' | 'empty' | 'network' | 'unknown';

export type LoadAdminDashboardOptions = {
  signal?: AbortSignal;
};

export class AdminDataError extends Error {
  code: AdminDataErrorCode;

  constructor(code: AdminDataErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = 'AdminDataError';
  }
}

const REQUEST_TIMEOUT_MS = 8_000;
const ADMIN_SNAPSHOT_MAX_BYTES = 1_048_576;
const DEFAULT_ADMIN_SNAPSHOT_URL = '/api/admin/snapshot';
const HTTP_SCHEME_PATTERN = /^https?:/i;
const ABSOLUTE_HTTP_URL_PATTERN = /^https?:\/\/[^/\\\s]/i;
const RECORD_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]*$/;
const URL_SCHEME_PATTERN = /^[A-Za-z][A-Za-z0-9+.-]*:/;

export function getAdminLoadMode(search: string = /* v8 ignore next */ (typeof window === 'undefined' ? '' : window.location.search)): AdminLoadMode {
  const params = new URLSearchParams(search);
  return params.get('adminSnapshot') === 'fixture' ? 'fixture' : 'live';
}

export function getAdminSnapshotUrl() {
  return normalizeAdminSnapshotUrl(import.meta.env.VITE_ATLASTERM_ADMIN_SNAPSHOT_URL);
}

export function getAdminSnapshotSourceDescriptor(
  search: string = /* v8 ignore next */ (typeof window === 'undefined' ? '' : window.location.search),
  snapshotUrl = getAdminSnapshotUrl(),
): AdminSnapshotSourceDescriptor {
  const mode = getAdminLoadMode(search);

  if (mode === 'fixture') {
    return {
      mode,
      snapshotUrl: null,
      source: 'fixture',
    };
  }

  return {
    mode,
    snapshotUrl: normalizeAdminSnapshotUrl(snapshotUrl),
    source: 'live',
  };
}

export async function loadAdminDashboard(
  fetcher: typeof fetch,
  snapshotUrl = getAdminSnapshotUrl(),
  options: LoadAdminDashboardOptions = {},
): Promise<AdminDashboardSnapshot> {
  let response: Response;

  const normalizedSnapshotUrl = normalizeAdminSnapshotUrl(snapshotUrl);
  const controller = new AbortController();
  const abortRequest = () => controller.abort();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  if (options.signal?.aborted) {
    controller.abort();
  } else {
    options.signal?.addEventListener('abort', abortRequest, { once: true });
  }

  try {
    if (controller.signal.aborted) {
      throw new AdminDataError('network', 'Admin snapshot is unreachable.');
    }

    try {
      response = await fetcher(normalizedSnapshotUrl, {
        body: null,
        cache: 'no-store',
        credentials: 'same-origin',
        headers: getAdminSnapshotHeaders(),
        keepalive: false,
        method: 'GET',
        mode: 'cors',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      throw new AdminDataError('network', 'Admin snapshot is unreachable.');
    }

    if (controller.signal.aborted) {
      throw new AdminDataError('network', 'Admin snapshot is unreachable.');
    }

    if (response.status === 401 || response.status === 403) {
      throw new AdminDataError('auth_required', 'Authentication is required before sync data can be shown.');
    }

    if (!response.ok) {
      throw new AdminDataError('unknown', `Admin snapshot failed with ${response.status}.`);
    }

    if (!isJsonResponse(response)) {
      throw new AdminDataError('unknown', 'Admin snapshot response was not JSON.');
    }

    let snapshot: unknown;

    try {
      snapshot = await readJsonWithAbort(response, controller.signal);
    } catch (error) {
      if (error instanceof AdminSnapshotBodyTooLargeError) {
        throw new AdminDataError('unknown', 'Admin snapshot response was too large.');
      }
      throw new AdminDataError(
        controller.signal.aborted ? 'network' : 'unknown',
        controller.signal.aborted ? 'Admin snapshot is unreachable.' : 'Admin snapshot response was not valid JSON.',
      );
    }

    if (!isAdminDashboardSnapshot(snapshot)) {
      throw new AdminDataError('unknown', 'Admin snapshot response did not match the expected shape.');
    }

    if (isEmptySnapshot(snapshot)) {
      throw new AdminDataError('empty', 'No team sync data is available yet.');
    }

    return snapshot;
  } finally {
    clearTimeout(timeoutId);
    options.signal?.removeEventListener('abort', abortRequest);
  }
}

function getAdminSnapshotHeaders(): Record<string, string> {
  return {
    Accept: 'application/json',
  };
}

function isJsonResponse(response: Response) {
  const contentType = response.headers.get('content-type')?.toLowerCase().split(';')[0]?.trim();

  return contentType === 'application/json' || Boolean(contentType?.endsWith('+json'));
}

function hasControlOrFormatCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) || /\p{Cf}/u.test(character)) {
      return true;
    }
  }

  return false;
}

function normalizeAdminSnapshotUrl(snapshotUrl?: string) {
  const url = snapshotUrl?.trim();

  if (!url || url.startsWith('//') || url.includes('\\') || hasUnsafeUrlCharacter(url) || hasMalformedAbsoluteHttpUrl(url)) {
    return DEFAULT_ADMIN_SNAPSHOT_URL;
  }

  if (!HTTP_SCHEME_PATTERN.test(url) && !url.startsWith('/')) {
    return DEFAULT_ADMIN_SNAPSHOT_URL;
  }

  try {
    const parsedUrl = new URL(url);

    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
      return DEFAULT_ADMIN_SNAPSHOT_URL;
    }
    if (parsedUrl.username || parsedUrl.password) {
      return DEFAULT_ADMIN_SNAPSHOT_URL;
    }

    parsedUrl.hash = '';

    return parsedUrl.toString();
  } catch {
    if (URL_SCHEME_PATTERN.test(url)) {
      return DEFAULT_ADMIN_SNAPSHOT_URL;
    }

    const hashIndex = url.indexOf('#');
    const urlWithoutFragment = hashIndex >= 0 ? url.slice(0, hashIndex) : url;

    return urlWithoutFragment || DEFAULT_ADMIN_SNAPSHOT_URL;
  }
}

function hasMalformedAbsoluteHttpUrl(url: string) {
  return HTTP_SCHEME_PATTERN.test(url) && !ABSOLUTE_HTTP_URL_PATTERN.test(url);
}

function hasUnsafeUrlCharacter(value: string) {
  return hasControlOrFormatCharacter(value) || /\s/u.test(value);
}

class AdminSnapshotBodyTooLargeError extends Error {
  constructor() {
    super('Admin snapshot response was too large.');
    this.name = 'AdminSnapshotBodyTooLargeError';
  }
}

function readJsonWithAbort(response: Response, signal: AbortSignal): Promise<unknown> {
  if (signal.aborted) {
    return Promise.reject(new Error('Admin snapshot request was aborted.'));
  }

  const contentLength = getResponseContentLength(response);
  if (contentLength !== null && contentLength > ADMIN_SNAPSHOT_MAX_BYTES) {
    cancelResponseBody(response, 'Admin snapshot response was too large.');
    return Promise.reject(new AdminSnapshotBodyTooLargeError());
  }

  return new Promise((resolve, reject) => {
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    const cleanup = () => signal.removeEventListener('abort', handleAbort);
    const handleAbort = () => {
      cleanup();
      if (reader) {
        void reader.cancel('Admin snapshot request was aborted.').catch(() => undefined);
      } else {
        cancelResponseBody(response, 'Admin snapshot request was aborted.');
      }
      reject(new Error('Admin snapshot request was aborted.'));
    };

    signal.addEventListener('abort', handleAbort, { once: true });
    Promise.resolve()
      .then(async () => {
        if (signal.aborted) {
          throw new Error('Admin snapshot request was aborted.');
        }

        return readResponseJsonWithLimit(response, signal, (bodyReader) => {
          reader = bodyReader;
        });
      })
      .then(
        (snapshot) => {
          cleanup();
          resolve(snapshot);
        },
        (error: unknown) => {
          cleanup();
          reject(error);
        },
      );
  });
}

async function readResponseJsonWithLimit(
  response: Response,
  signal: AbortSignal,
  setReader: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
) {
  if (response.body && typeof response.body.getReader === 'function') {
    return JSON.parse(await readResponseTextStreamWithLimit(response.body, signal, setReader));
  }

  if (typeof response.text === 'function') {
    const responseText = await response.text();
    if (new TextEncoder().encode(responseText).byteLength > ADMIN_SNAPSHOT_MAX_BYTES) {
      throw new AdminSnapshotBodyTooLargeError();
    }

    return JSON.parse(responseText);
  }

  return response.json();
}

async function readResponseTextStreamWithLimit(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
  setReader: (reader: ReadableStreamDefaultReader<Uint8Array>) => void,
) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let responseText = '';
  setReader(reader);

  while (true) {
    if (signal.aborted) {
      throw new Error('Admin snapshot request was aborted.');
    }

    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    if (!value) {
      continue;
    }

    bytesRead += value.byteLength;
    if (bytesRead > ADMIN_SNAPSHOT_MAX_BYTES) {
      await reader.cancel('Admin snapshot response was too large.').catch(() => undefined);
      throw new AdminSnapshotBodyTooLargeError();
    }

    responseText += decoder.decode(value, { stream: true });
  }

  return responseText + decoder.decode();
}

function getResponseContentLength(response: Response) {
  const contentLength = response.headers.get('content-length')?.trim();
  if (!contentLength || !/^[0-9]+$/.test(contentLength)) {
    return null;
  }

  const parsedContentLength = Number.parseInt(contentLength, 10);
  return Number.isSafeInteger(parsedContentLength) ? parsedContentLength : null;
}

function cancelResponseBody(response: Response, reason: string) {
  try {
    void response.body?.cancel(reason).catch(() => undefined);
  } catch (error) {
    void error;
  }
}

export function isAdminDashboardSnapshot(value: unknown): value is AdminDashboardSnapshot {
  if (!isRecord(value)) {
    return false;
  }

  const { auditEvents, devices, members, metrics, roles } = value;

  if (!Array.isArray(auditEvents) || !auditEvents.every(isAuditEvent) || !hasUniqueIds(auditEvents)) {
    return false;
  }

  if (!Array.isArray(devices) || !devices.every(isDeviceRecord) || !hasUniqueIds(devices)) {
    return false;
  }

  if (!Array.isArray(members) || !members.every(isMemberRecord) || !hasUniqueIds(members)) {
    return false;
  }

  if (!isAdminMetrics(metrics)) {
    return false;
  }

  return Array.isArray(roles) && roles.every(isRoleRecord) && hasUniqueIds(roles);
}

export function isEmptySnapshot(snapshot: AdminDashboardSnapshot) {
  return (
    snapshot.auditEvents.length === 0 &&
    snapshot.devices.length === 0 &&
    snapshot.members.length === 0 &&
    snapshot.roles.length === 0
  );
}

function isAdminMetrics(value: unknown): value is AdminMetrics {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.activeMembers) &&
    isNonNegativeInteger(value.auditEventsToday) &&
    isNonNegativeInteger(value.healthyDevices) &&
    isNonNegativeInteger(value.rolesConfigured)
  );
}

function isDeviceRecord(value: unknown): value is DeviceRecord {
  return (
    isRecord(value) &&
    isNonBlankString(value.cursor) &&
    isRecordId(value.id) &&
    isNonBlankString(value.lastSeen) &&
    isNonBlankString(value.name) &&
    isNonBlankString(value.owner) &&
    isNonBlankString(value.platform) &&
    isDeviceStatus(value.status)
  );
}

function isAuditEvent(value: unknown): value is AuditEvent {
  return (
    isRecord(value) &&
    isNonBlankString(value.action) &&
    isNonBlankString(value.actor) &&
    isRecordId(value.id) &&
    isNonBlankString(value.target) &&
    isNonBlankString(value.time)
  );
}

function isMemberRecord(value: unknown): value is MemberRecord {
  return (
    isRecord(value) &&
    isNonNegativeInteger(value.deviceCount) &&
    isNonBlankString(value.email) &&
    isRecordId(value.id) &&
    isNonBlankString(value.name) &&
    isNonBlankString(value.role) &&
    isMemberStatus(value.status)
  );
}

function isRoleRecord(value: unknown): value is RoleRecord {
  return (
    isRecord(value) &&
    isRecordId(value.id) &&
    isNonNegativeInteger(value.memberCount) &&
    isNonBlankString(value.name) &&
    isRoleRisk(value.risk) &&
    isNonBlankString(value.scope)
  );
}

function isDeviceStatus(value: unknown): value is DeviceStatus {
  return value === 'catching_up' || value === 'current' || value === 'degraded' || value === 'offline';
}

function isMemberStatus(value: unknown): value is MemberStatus {
  return value === 'active' || value === 'invited' || value === 'suspended';
}

function isRoleRisk(value: unknown): value is RoleRisk {
  return value === 'elevated' || value === 'full' || value === 'limited';
}

function hasUniqueIds(records: readonly { id: string }[]) {
  return new Set(records.map((record) => record.id.trim())).size === records.length;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isRecordId(value: unknown): value is string {
  return isString(value) && RECORD_ID_PATTERN.test(value) && !hasControlOrFormatCharacter(value);
}

function isNonBlankString(value: unknown): value is string {
  return isString(value) && value.length > 0 && value === value.trim() && !hasControlOrFormatCharacter(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
