import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

import type { RegisteredDevice, SyncConflict, SyncError, SyncPreview } from '@/models/sync';

type DeviceRegistrationRequest = {
  installId: string;
  displayName: string;
  platform: string;
};

type SyncRegisterDeviceResponse = {
  device_id: string;
  server_time: string;
  sync_cursor: string;
};

type SyncPullResponse = {
  changes: SyncChangeEnvelope[];
  device_id: string;
  has_more: boolean;
  next_cursor: string;
};

type SyncChangeEnvelope = {
  entity_id: string;
  entity_type: string;
  id: string;
  operation: 'create' | 'delete' | 'update';
  payload: unknown;
  server_time: string;
  sync_cursor: string;
};

type SyncPushResponse = {
  accepted: number;
  conflicts: SyncConflict[];
  sync_cursor: string;
};

export type SyncCheckpointResult = {
  accepted: number;
  conflicts: SyncConflict[];
  syncCursor: string;
};

const REQUEST_TIMEOUT_MS = 8_000;
const MAX_PULL_PAGES = 256;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MOBILE_DEVICE_ID_STORAGE_KEY = 'atlasterm.mobile.deviceId';

let rememberedRegisteredDeviceId: string | undefined;
const syncedEntitiesByDevice = new Map<string, Map<string, SyncChangeEnvelope>>();

export function resetRegisteredDeviceMemoryForTests() {
  rememberedRegisteredDeviceId = undefined;
  syncedEntitiesByDevice.clear();
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toSyncError(error: unknown): SyncError {
  if (isSyncError(error)) {
    return error;
  }

  if (error instanceof Error && /network|failed to fetch|load failed/.test(error.message.toLowerCase())) {
    return {
      code: 'offline',
      title: 'Offline mode',
      message: 'JoeSSH cannot reach sync services. Emergency channels and cached device context are still available.',
      recoverable: true,
    };
  }

  if (error instanceof Error && error.message.toLowerCase().includes('timeout')) {
    return {
      code: 'timeout',
      title: 'Sync timed out',
      message: 'The sync service did not answer in time. Cached context and emergency channels remain available.',
      recoverable: true,
    };
  }

  if (error instanceof Error && (error.message.includes('401') || error.message.includes('403'))) {
    return {
      code: 'unauthorized',
      title: 'Sign-in required',
      message: 'JoeSSH sync rejected this mobile device. Sign in again before pulling live workspace state.',
      recoverable: false,
    };
  }

  return {
    code: 'unknown',
    title: 'Sync interrupted',
    message: 'The preview could not be refreshed. Try again when the service connection is stable.',
    recoverable: true,
  };
}

export function asSyncError(error: unknown): SyncError {
  return isSyncError(error) ? error : getOfflineError();
}

export function isSyncError(error: unknown): error is SyncError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    'title' in error &&
    'message' in error &&
    'recoverable' in error
  );
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    throw new Error('network: sync API base URL is not configured');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;

  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: getRequestHeaders(init?.headers),
      signal: controller.signal,
    });
  } catch (error) {
    // On web, an aborted fetch rejects with a DOMException (name 'AbortError'),
    // which is not `instanceof Error`; on native it is a plain Error.
    if (typeof error === 'object' && error !== null && (error as { name?: string }).name === 'AbortError') {
      throw new Error(`timeout: sync API request exceeded ${REQUEST_TIMEOUT_MS}ms`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }

  if (!response.ok) {
    throw new Error(`sync API failed with ${response.status}`);
  }

  return response.json();
}

export function getApiBaseUrl() {
  return process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL?.replace(/\/$/, '');
}

export function getApiAuthToken() {
  const token = process.env.EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN?.trim();

  return token || undefined;
}

function getRequestHeaders(initHeaders?: HeadersInit): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  const authToken = getApiAuthToken();

  if (authToken) {
    headers.Authorization = `Bearer ${authToken}`;
  }

  if (!initHeaders) {
    return headers;
  }

  if (Array.isArray(initHeaders)) {
    for (const [name, value] of initHeaders) {
      headers[name] = value;
    }

    return headers;
  }

  if (hasHeaderForEach(initHeaders)) {
    initHeaders.forEach((value: string, name: string) => {
      headers[name] = value;
    });

    return headers;
  }

  for (const [name, value] of Object.entries(initHeaders as Record<string, string>)) {
    headers[name] = value;
  }

  return headers;
}

function hasHeaderForEach(value: HeadersInit): value is Headers {
  return typeof (value as Headers).forEach === 'function';
}

function parseRegisterDeviceResponse(value: unknown): SyncRegisterDeviceResponse {
  const response = requireObject(value, 'register');

  return {
    device_id: requireString(response, 'device_id', 'register'),
    server_time: requireString(response, 'server_time', 'register'),
    sync_cursor: requireString(response, 'sync_cursor', 'register'),
  };
}

function parsePushResponse(value: unknown): SyncPushResponse {
  const response = requireObject(value, 'push');

  return {
    accepted: requireNonNegativeNumber(response, 'accepted', 'push'),
    conflicts: requireConflicts(response.conflicts, 'push'),
    sync_cursor: requireString(response, 'sync_cursor', 'push'),
  };
}

function parsePullResponse(value: unknown): SyncPullResponse {
  const response = requireObject(value, 'pull');
  const changes = response.changes;

  if (!Array.isArray(changes)) {
    throw new Error('invalid sync API pull response: changes must be an array');
  }

  return {
    changes: changes.map(parseSyncChangeEnvelope),
    device_id: requireString(response, 'device_id', 'pull'),
    has_more: requireBoolean(response, 'has_more', 'pull'),
    next_cursor: requireString(response, 'next_cursor', 'pull'),
  };
}

function parseSyncChangeEnvelope(value: unknown): SyncChangeEnvelope {
  const change = requireObject(value, 'pull change');
  const operation = requireString(change, 'operation', 'pull change');

  if (operation !== 'create' && operation !== 'delete' && operation !== 'update') {
    throw new Error('invalid sync API pull change response: operation is unsupported');
  }

  return {
    entity_id: requireString(change, 'entity_id', 'pull change'),
    entity_type: requireString(change, 'entity_type', 'pull change'),
    id: requireString(change, 'id', 'pull change'),
    operation,
    payload: change.payload,
    server_time: requireString(change, 'server_time', 'pull change'),
    sync_cursor: requireString(change, 'sync_cursor', 'pull change'),
  };
}

function requireObject(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`invalid sync API ${context} response: expected object`);
  }

  return value as Record<string, unknown>;
}

function requireString(response: Record<string, unknown>, field: string, context: string): string {
  const value = response[field];

  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`invalid sync API ${context} response: ${field} must be a string`);
  }

  return value;
}

function requireNonNegativeNumber(response: Record<string, unknown>, field: string, context: string): number {
  const value = response[field];

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid sync API ${context} response: ${field} must be a non-negative number`);
  }

  return value;
}

function requireBoolean(response: Record<string, unknown>, field: string, context: string): boolean {
  const value = response[field];

  if (typeof value !== 'boolean') {
    throw new Error(`invalid sync API ${context} response: ${field} must be a boolean`);
  }

  return value;
}

function requireConflicts(value: unknown, context: string): SyncConflict[] {
  if (!Array.isArray(value)) {
    throw new Error(`invalid sync API ${context} response: conflicts must be an array`);
  }

  return value.map((conflict) => {
    const record = requireObject(conflict, context);
    const reason = record.reason;

    if (reason !== 'changed_after_base_cursor') {
      throw new Error(`invalid sync API ${context} response: conflict reason is unsupported`);
    }

    return {
      entity_type: requireString(record, 'entity_type', context),
      entity_id: requireString(record, 'entity_id', context),
      reason,
    };
  });
}

export function normalizePlatform(platform: string) {
  if (platform === 'ios' || platform === 'android') {
    return platform;
  }

  return 'web';
}

function getFallbackDevice(request: DeviceRegistrationRequest): RegisteredDevice {
  return {
    id: request.installId,
    name: request.displayName,
    platform: request.platform,
    registeredAt: new Date().toISOString(),
    connectionQuality: getApiBaseUrl() ? 'degraded' : 'offline',
    syncCursor: '0',
  };
}

export function getFallbackPreview(device: RegisteredDevice): SyncPreview {
  return {
    generatedAt: new Date().toISOString(),
    profileCount: 0,
    openSessionCount: 0,
    pendingChangeCount: 0,
    cursor: {
      workspace: 'JoeSSH Sync',
      branch: device.connectionQuality,
      lastCommand: device.syncCursor ?? '0',
    },
    devices: [device],
    emergencyChannels: [
      {
        id: 'relay',
        label: 'Relay Connect',
        detail: 'Route a short-lived terminal handoff through the last trusted desktop.',
        availableOffline: false,
      },
      {
        id: 'local-cache',
        label: 'Cached Key',
        detail: 'Open cached profiles and recovery notes while the network is down.',
        availableOffline: true,
      },
    ],
  };
}

function mapRegisteredDevice(response: SyncRegisterDeviceResponse, request: DeviceRegistrationRequest): RegisteredDevice {
  rememberedRegisteredDeviceId = response.device_id;

  return {
    id: response.device_id,
    name: request.displayName,
    platform: request.platform,
    registeredAt: response.server_time,
    connectionQuality: 'online',
    syncCursor: response.sync_cursor,
  };
}

async function readStoredDeviceId(): Promise<string | undefined> {
  if (rememberedRegisteredDeviceId) {
    return rememberedRegisteredDeviceId;
  }

  try {
    const stored = await AsyncStorage.getItem(MOBILE_DEVICE_ID_STORAGE_KEY);
    if (stored && isUuidLike(stored)) {
      rememberedRegisteredDeviceId = stored;
      return stored;
    }
  } catch {
    // A storage outage must not make the mobile companion unusable.
  }

  return undefined;
}

async function persistDeviceId(deviceId: string): Promise<void> {
  rememberedRegisteredDeviceId = deviceId;
  try {
    await AsyncStorage.setItem(MOBILE_DEVICE_ID_STORAGE_KEY, deviceId);
  } catch {
    // Keep the in-memory identity for this runtime and retry persistence later.
  }
}

export async function registerDevice(): Promise<RegisteredDevice> {
  const installId = Constants.sessionId ?? `mobile-${Platform.OS}`;
  const request: DeviceRegistrationRequest = {
    installId,
    displayName: Constants.deviceName ?? 'JoeSSH Mobile',
    platform: normalizePlatform(Platform.OS),
  };
  const existingDeviceId = await readStoredDeviceId();

  await delay(250);

  try {
    const response = parseRegisterDeviceResponse(await requestJson('/v1/devices/register', {
      body: JSON.stringify({
        ...(existingDeviceId ? { device_id: existingDeviceId } : {}),
        platform: request.platform,
        app_version: Constants.expoConfig?.version ?? '0.1.0',
        display_name: request.displayName,
      }),
      method: 'POST',
    }));

    const device = mapRegisteredDevice(response, request);
    await persistDeviceId(device.id);
    return device;
  } catch (error) {
    if (!getApiBaseUrl()) {
      return getFallbackDevice(request);
    }

    throw toSyncError(error);
  }
}

export async function pushMobilePresenceCheckpoint(device: RegisteredDevice): Promise<SyncCheckpointResult> {
  if (!getApiBaseUrl()) {
    return {
      accepted: 0,
      conflicts: [],
      syncCursor: device.syncCursor ?? '0',
    };
  }

  try {
    const response = parsePushResponse(await requestJson('/v1/sync/push', {
      body: JSON.stringify({
        device_id: device.id,
        base_cursor: device.syncCursor ?? '0',
        changes: [
          {
            id: createChangeId(),
            entity_type: 'mobile_presence',
            entity_id: device.id,
            operation: 'update',
            payload: {
              client: 'atlasterm-mobile',
              connection_quality: device.connectionQuality,
              device_name: device.name,
              platform: normalizePlatform(device.platform),
              preview_intent: 'pull_sync_preview',
            },
            client_time: new Date().toISOString(),
          },
        ],
      }),
      method: 'POST',
    }));

    return {
      accepted: response.accepted,
      conflicts: response.conflicts,
      syncCursor: response.sync_cursor,
    };
  } catch (error) {
    throw toSyncError(error);
  }
}

export async function fetchSyncPreview(deviceId: string, sinceCursor = '0'): Promise<SyncPreview> {
  await delay(350);

  try {
    const changes: SyncChangeEnvelope[] = [];
    let cursor = sinceCursor;
    let response: SyncPullResponse | undefined;

    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      response = parsePullResponse(await requestJson(
        `/v1/sync/pull?device_id=${encodeURIComponent(deviceId)}&since=${encodeURIComponent(cursor)}`,
      ));
      if (response.device_id !== deviceId) {
        throw new Error('invalid sync API pull response: device_id did not match the request');
      }
      changes.push(...response.changes);

      if (!response.has_more) {
        break;
      }
      if (response.next_cursor === cursor) {
        throw new Error('invalid sync API pull response: pagination cursor did not advance');
      }
      cursor = response.next_cursor;
    }

    if (!response || response.has_more) {
      throw new Error(`sync API pull exceeded ${MAX_PULL_PAGES} pages`);
    }

    const entityState = applySyncChanges(deviceId, changes);
    const lastChange = changes.at(-1);
    const liveDevice = getFallbackDevice({
      installId: response.device_id,
      displayName: Constants.deviceName ?? 'JoeSSH Mobile',
      platform: normalizePlatform(Platform.OS),
    });

    return {
      ...getFallbackPreview({ ...liveDevice, connectionQuality: 'online' }),
      profileCount: countEntityTypes(entityState, ['connection_profile', 'profile']),
      openSessionCount: countEntityTypes(entityState, ['session', 'ssh_session', 'terminal_session']),
      pendingChangeCount: changes.length,
      cursor: {
        workspace: lastChange ? `${lastChange.entity_type}:${lastChange.entity_id}` : 'JoeSSH Sync',
        branch: lastChange?.operation ?? 'current',
        lastCommand: response.next_cursor,
      },
      generatedAt: new Date().toISOString(),
      syncCursor: response.next_cursor,
    };
  } catch (error) {
    const fallbackDevice = getFallbackDevice({
      installId: deviceId,
      displayName: Constants.deviceName ?? 'JoeSSH Mobile',
      platform: normalizePlatform(Platform.OS),
    });

    if (!getApiBaseUrl()) {
      return getFallbackPreview(fallbackDevice);
    }

    throw toSyncError(error);
  }
}

function applySyncChanges(deviceId: string, changes: readonly SyncChangeEnvelope[]) {
  const entities = syncedEntitiesByDevice.get(deviceId) ?? new Map<string, SyncChangeEnvelope>();
  syncedEntitiesByDevice.set(deviceId, entities);

  for (const change of changes) {
    const key = `${change.entity_type}:${change.entity_id}`;
    if (change.operation === 'delete') {
      entities.delete(key);
    } else {
      entities.set(key, change);
    }
  }

  return entities;
}

function countEntityTypes(entities: ReadonlyMap<string, SyncChangeEnvelope>, entityTypes: readonly string[]) {
  const allowed = new Set(entityTypes);
  let count = 0;
  for (const change of entities.values()) {
    if (allowed.has(change.entity_type)) {
      count += 1;
    }
  }
  return count;
}

function isUuidLike(value: string) {
  return UUID_PATTERN.test(value);
}

function createChangeId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();

  if (randomUuid) {
    return randomUuid;
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === 'x' ? random : (random & 0x3) | 0x8;

    return value.toString(16);
  });
}

export function getOfflineError(): SyncError {
  return {
    code: 'offline',
    title: 'Sync service offline',
    message: 'No live sync endpoint is configured. You can still inspect cached context or open an emergency connection path.',
    recoverable: true,
  };
}
