import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { Platform } from "react-native";

import type {
  RegisteredDevice,
  SyncConflict,
  SyncError,
  SyncPreview,
} from "@/models/sync";

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
  changes: unknown[];
  device_id: string;
  has_more: boolean;
  next_cursor: string;
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
const MAX_PULL_PAGES = 20;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const MOBILE_SYNC_INSTALL_ID_STORAGE_KEY =
  "atlasterm.mobile.sync.install-id.v1";
export const MOBILE_SYNC_PENDING_PRESENCE_STORAGE_KEY =
  "atlasterm.mobile.sync.pending-presence.v1";
export const MOBILE_SYNC_REGISTRATION_STORAGE_KEY =
  "atlasterm.mobile.sync.registration.v1";

type StoredSyncRegistration = {
  apiBaseUrl: string;
  deviceId: string;
  syncCursor: string;
};

type StoredPendingPresence = {
  apiBaseUrl: string;
  baseCursor: string;
  changeId: string;
  clientTime: string;
  deviceId: string;
};

let rememberedInstallId: string | undefined;
let rememberedInstallIdPromise: Promise<string> | undefined;
let rememberedPendingPresence: StoredPendingPresence | undefined;
let rememberedRegistration: StoredSyncRegistration | undefined;

class SyncApiInvalidJsonError extends Error {
  constructor() {
    super("sync API response was not valid JSON");
    this.name = "SyncApiInvalidJsonError";
  }
}

class SyncApiResponseAbortedError extends Error {
  constructor() {
    super("sync API response body read was aborted");
    this.name = "SyncApiResponseAbortedError";
  }
}

export function resetRegisteredDeviceMemoryForTests() {
  rememberedInstallId = undefined;
  rememberedInstallIdPromise = undefined;
  rememberedPendingPresence = undefined;
  rememberedRegistration = undefined;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function toSyncError(error: unknown): SyncError {
  if (isSyncError(error)) {
    return error;
  }

  if (error instanceof SyncApiInvalidJsonError) {
    return {
      code: "unknown",
      title: "Sync response rejected",
      message: "The sync service returned a response that was not valid JSON.",
      recoverable: true,
    };
  }

  if (
    error instanceof Error &&
    /network|failed to fetch|load failed/.test(error.message.toLowerCase())
  ) {
    return {
      code: "offline",
      title: "Sync unavailable",
      message:
        "JoeSSH could not reach the configured sync service. No live workspace data was received.",
      recoverable: true,
    };
  }

  if (
    error instanceof Error &&
    error.message.toLowerCase().includes("timeout")
  ) {
    return {
      code: "timeout",
      title: "Sync timed out",
      message:
        "The sync service did not answer in time. No live workspace data was received.",
      recoverable: true,
    };
  }

  if (
    error instanceof Error &&
    (error.message.includes("401") || error.message.includes("403"))
  ) {
    return {
      code: "unauthorized",
      title: "Sync authorization failed",
      message:
        "The configured sync credentials were rejected. Update the preview configuration before retrying.",
      recoverable: false,
    };
  }

  return {
    code: "unknown",
    title: "Sync interrupted",
    message:
      "The preview could not be refreshed. Try again when the service connection is stable.",
    recoverable: true,
  };
}

export function asSyncError(error: unknown): SyncError {
  return isSyncError(error) ? error : toSyncError(error);
}

export function isSyncError(error: unknown): error is SyncError {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const candidate = error as Partial<SyncError>;

  return (
    (candidate.code === "offline" ||
      candidate.code === "timeout" ||
      candidate.code === "unauthorized" ||
      candidate.code === "unknown") &&
    typeof candidate.title === "string" &&
    typeof candidate.message === "string" &&
    typeof candidate.recoverable === "boolean"
  );
}

async function requestJson(path: string, init?: RequestInit): Promise<unknown> {
  const apiBaseUrl = getApiBaseUrl();

  if (!apiBaseUrl) {
    throw new Error("network: sync API base URL is not configured");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: getRequestHeaders(init?.headers, init?.body !== undefined),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`sync API failed with ${response.status}`);
    }

    return await readResponseJsonWithAbort(response, controller.signal);
  } catch (error) {
    // On web, an aborted fetch rejects with a DOMException (name 'AbortError'),
    // which is not `instanceof Error`; on native it is a plain Error.
    if (
      timedOut ||
      isAbortError(error) ||
      error instanceof SyncApiResponseAbortedError
    ) {
      throw new Error(
        `timeout: sync API request exceeded ${REQUEST_TIMEOUT_MS}ms`,
        {
          cause: error,
        },
      );
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readResponseJsonWithAbort(
  response: Response,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) {
    throw new SyncApiResponseAbortedError();
  }

  const bodyRead = (async () => {
    const responseText = await response.text();

    try {
      return JSON.parse(responseText) as unknown;
    } catch {
      throw new SyncApiInvalidJsonError();
    }
  })();

  return awaitWithAbort(bodyRead, signal, () =>
    cancelResponseBody(response, "sync API response body read was aborted"),
  );
}

function awaitWithAbort<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  handleAbort: () => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      handleAbort();
      reject(new SyncApiResponseAbortedError());
    };

    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(value);
        }
      },
      (error: unknown) => {
        if (!settled) {
          settled = true;
          cleanup();
          reject(error);
        }
      },
    );
  });
}

function cancelResponseBody(response: Response, reason: string) {
  if (response.body && typeof response.body.cancel === "function") {
    void response.body.cancel(reason).catch(() => undefined);
  }
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: string }).name === "AbortError"
  );
}

export function getApiBaseUrl() {
  const apiBaseUrl = process.env.EXPO_PUBLIC_ATLASTERM_SYNC_URL?.trim().replace(
    /\/+$/,
    "",
  );

  return apiBaseUrl || undefined;
}

export function getApiAuthToken() {
  const token = process.env.EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN?.trim();

  return token || undefined;
}

function getRequestHeaders(
  initHeaders?: HeadersInit,
  hasBody = false,
): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const authToken = getApiAuthToken();

  if (hasBody) {
    headers["Content-Type"] = "application/json";
  }

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

  for (const [name, value] of Object.entries(
    initHeaders as Record<string, string>,
  )) {
    headers[name] = value;
  }

  return headers;
}

function hasHeaderForEach(value: HeadersInit): value is Headers {
  return typeof (value as Headers).forEach === "function";
}

function parseRegisterDeviceResponse(
  value: unknown,
): SyncRegisterDeviceResponse {
  const response = requireObject(value, "register");

  return {
    device_id: requireUuidString(response, "device_id", "register"),
    server_time: requireString(response, "server_time", "register"),
    sync_cursor: requireString(response, "sync_cursor", "register"),
  };
}

function parsePushResponse(value: unknown): SyncPushResponse {
  const response = requireObject(value, "push");

  return {
    accepted: requireNonNegativeNumber(response, "accepted", "push"),
    conflicts: requireConflicts(response.conflicts, "push"),
    sync_cursor: requireString(response, "sync_cursor", "push"),
  };
}

function parsePullResponse(value: unknown): SyncPullResponse {
  const response = requireObject(value, "pull");
  const changes = response.changes;

  if (!Array.isArray(changes)) {
    throw new Error("invalid sync API pull response: changes must be an array");
  }

  return {
    changes,
    device_id: requireUuidString(response, "device_id", "pull"),
    has_more: requireOptionalBoolean(response, "has_more", "pull") ?? false,
    next_cursor: requireString(response, "next_cursor", "pull"),
  };
}

function requireObject(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`invalid sync API ${context} response: expected object`);
  }

  return value as Record<string, unknown>;
}

function requireString(
  response: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const value = response[field];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(
      `invalid sync API ${context} response: ${field} must be a string`,
    );
  }

  return value;
}

function requireUuidString(
  response: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const value = requireString(response, field, context);

  if (!isUuidLike(value)) {
    throw new Error(
      `invalid sync API ${context} response: ${field} must be a UUID`,
    );
  }

  return value;
}

function requireNonNegativeNumber(
  response: Record<string, unknown>,
  field: string,
  context: string,
): number {
  const value = response[field];

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `invalid sync API ${context} response: ${field} must be a non-negative integer`,
    );
  }

  return value;
}

function requireOptionalBoolean(
  response: Record<string, unknown>,
  field: string,
  context: string,
): boolean | undefined {
  const value = response[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "boolean") {
    throw new Error(
      `invalid sync API ${context} response: ${field} must be a boolean`,
    );
  }

  return value;
}

function requireConflicts(value: unknown, context: string): SyncConflict[] {
  if (!Array.isArray(value)) {
    throw new Error(
      `invalid sync API ${context} response: conflicts must be an array`,
    );
  }

  return value.map((conflict) => {
    const record = requireObject(conflict, context);
    const reason = record.reason;

    if (reason !== "changed_after_base_cursor") {
      throw new Error(
        `invalid sync API ${context} response: conflict reason is unsupported`,
      );
    }

    return {
      entity_type: requireString(record, "entity_type", context),
      entity_id: requireString(record, "entity_id", context),
      reason,
    };
  });
}

export function normalizePlatform(platform: string) {
  if (platform === "ios" || platform === "android") {
    return platform;
  }

  return "web";
}

function getFallbackDevice(
  request: DeviceRegistrationRequest,
): RegisteredDevice {
  return {
    id: request.installId,
    name: request.displayName,
    platform: request.platform,
    registeredAt: new Date().toISOString(),
    connectionQuality: getApiBaseUrl() ? "degraded" : "offline",
    syncCursor: "0",
  };
}

export function getFallbackPreview(
  device: RegisteredDevice,
  pendingChangeCount = 0,
): SyncPreview {
  return {
    generatedAt: new Date().toISOString(),
    profileCount: 0,
    openSessionCount: 0,
    pendingChangeCount,
    cursor: {
      workspace: "",
      branch: "",
      lastCommand: "",
    },
    devices: [device],
    emergencyChannels: [],
  };
}

function mapRegisteredDevice(
  response: SyncRegisterDeviceResponse,
  request: DeviceRegistrationRequest,
): RegisteredDevice {
  return {
    id: response.device_id,
    name: request.displayName,
    platform: request.platform,
    registeredAt: response.server_time,
    connectionQuality: "online",
    syncCursor: response.sync_cursor,
  };
}

export async function registerDevice(): Promise<RegisteredDevice> {
  const installId = await getOrCreateInstallId();
  const request: DeviceRegistrationRequest = {
    installId,
    displayName: Constants.deviceName ?? "JoeSSH Mobile",
    platform: normalizePlatform(Platform.OS),
  };
  const apiBaseUrl = getApiBaseUrl();
  const storedRegistration = apiBaseUrl
    ? await getStoredRegistration(apiBaseUrl)
    : undefined;
  const existingDeviceId = storedRegistration?.deviceId ?? installId;

  await delay(250);

  try {
    const response = parseRegisterDeviceResponse(
      await requestJson("/v1/devices/register", {
        body: JSON.stringify({
          ...(isUuidLike(existingDeviceId)
            ? { device_id: existingDeviceId }
            : {}),
          platform: request.platform,
          app_version: Constants.expoConfig?.version ?? "0.1.0-beta.19",
          display_name: request.displayName,
        }),
        method: "POST",
      }),
    );

    const registeredDevice = mapRegisteredDevice(response, request);
    const device =
      storedRegistration?.deviceId === registeredDevice.id
        ? { ...registeredDevice, syncCursor: storedRegistration.syncCursor }
        : registeredDevice;

    await persistRegistration(apiBaseUrl, device.id, device.syncCursor ?? "0");

    return device;
  } catch (error) {
    if (!getApiBaseUrl()) {
      return getFallbackDevice(request);
    }

    throw toSyncError(error);
  }
}

export async function pushMobilePresenceCheckpoint(
  device: RegisteredDevice,
): Promise<SyncCheckpointResult> {
  if (!getApiBaseUrl()) {
    return {
      accepted: 0,
      conflicts: [],
      syncCursor: device.syncCursor ?? "0",
    };
  }

  try {
    const pendingPresence = await getOrCreatePendingPresence(device);
    const response = parsePushResponse(
      await requestJson("/v1/sync/push", {
        body: JSON.stringify({
          device_id: device.id,
          base_cursor: device.syncCursor ?? "0",
          changes: [
            {
              id: pendingPresence.changeId,
              entity_type: "mobile_presence",
              entity_id: device.id,
              operation: "update",
              payload: {
                client: "atlasterm-mobile",
                connection_quality: device.connectionQuality,
                device_name: device.name,
                platform: normalizePlatform(device.platform),
                preview_intent: "pull_sync_preview",
              },
              client_time: pendingPresence.clientTime,
            },
          ],
        }),
        method: "POST",
      }),
    );

    await clearPendingPresence(pendingPresence);

    return {
      accepted: response.accepted,
      conflicts: response.conflicts,
      syncCursor: response.sync_cursor,
    };
  } catch (error) {
    throw toSyncError(error);
  }
}

export async function fetchSyncPreview(
  deviceId: string,
  sinceCursor = "0",
): Promise<SyncPreview> {
  await delay(350);

  try {
    const changes: unknown[] = [];
    let cursor = sinceCursor;
    let response: SyncPullResponse | undefined;

    for (let page = 0; page < MAX_PULL_PAGES; page += 1) {
      response = parsePullResponse(
        await requestJson(
          `/v1/sync/pull?device_id=${encodeURIComponent(deviceId)}&since=${encodeURIComponent(cursor)}`,
        ),
      );

      if (response.device_id !== deviceId) {
        throw new Error(
          "invalid sync API pull response: device_id does not match the requested device",
        );
      }

      changes.push(...response.changes);

      if (!response.has_more) {
        break;
      }

      if (response.next_cursor === cursor) {
        throw new Error(
          "invalid sync API pull response: paginated cursor did not advance",
        );
      }

      cursor = response.next_cursor;
      response = undefined;
    }

    if (!response) {
      throw new Error(`sync API pull exceeded ${MAX_PULL_PAGES} pages`);
    }

    const liveDevice = getFallbackDevice({
      installId: response.device_id,
      displayName: Constants.deviceName ?? "JoeSSH Mobile",
      platform: normalizePlatform(Platform.OS),
    });

    const preview: SyncPreview = {
      ...getFallbackPreview(
        { ...liveDevice, connectionQuality: "online" },
        changes.length,
      ),
      generatedAt: new Date().toISOString(),
      syncCursor: response.next_cursor,
    };

    await persistRegistration(getApiBaseUrl(), deviceId, response.next_cursor);

    return preview;
  } catch (error) {
    const fallbackDevice = getFallbackDevice({
      installId: deviceId,
      displayName: Constants.deviceName ?? "JoeSSH Mobile",
      platform: normalizePlatform(Platform.OS),
    });

    if (!getApiBaseUrl()) {
      return getFallbackPreview(fallbackDevice);
    }

    throw toSyncError(error);
  }
}

function isUuidLike(value: string) {
  return UUID_PATTERN.test(value);
}

async function getOrCreateInstallId() {
  if (rememberedInstallId) {
    return rememberedInstallId;
  }

  if (rememberedInstallIdPromise) {
    return rememberedInstallIdPromise;
  }

  rememberedInstallIdPromise = (async () => {
    try {
      const storedInstallId = await AsyncStorage.getItem(
        MOBILE_SYNC_INSTALL_ID_STORAGE_KEY,
      );

      if (storedInstallId && isUuidLike(storedInstallId)) {
        rememberedInstallId = storedInstallId;
        return storedInstallId;
      }
    } catch {
      // Storage is best effort; a runtime identifier still keeps the flow usable.
    }

    const installId = createChangeId();
    rememberedInstallId = installId;

    try {
      await AsyncStorage.setItem(MOBILE_SYNC_INSTALL_ID_STORAGE_KEY, installId);
    } catch {
      // The in-memory ID remains stable for this runtime.
    }

    return installId;
  })();

  try {
    return await rememberedInstallIdPromise;
  } finally {
    rememberedInstallIdPromise = undefined;
  }
}

async function getStoredRegistration(apiBaseUrl: string) {
  if (rememberedRegistration?.apiBaseUrl === apiBaseUrl) {
    return rememberedRegistration;
  }

  try {
    const value = await AsyncStorage.getItem(
      MOBILE_SYNC_REGISTRATION_STORAGE_KEY,
    );

    if (!value) {
      return undefined;
    }

    const candidate = JSON.parse(value) as Partial<StoredSyncRegistration>;

    if (
      candidate.apiBaseUrl !== apiBaseUrl ||
      typeof candidate.deviceId !== "string" ||
      !isUuidLike(candidate.deviceId) ||
      typeof candidate.syncCursor !== "string" ||
      candidate.syncCursor.length === 0
    ) {
      return undefined;
    }

    rememberedRegistration = candidate as StoredSyncRegistration;
    return rememberedRegistration;
  } catch {
    return undefined;
  }
}

async function persistRegistration(
  apiBaseUrl: string | undefined,
  deviceId: string,
  syncCursor: string,
) {
  if (!apiBaseUrl || !isUuidLike(deviceId) || syncCursor.length === 0) {
    return;
  }

  const registration: StoredSyncRegistration = {
    apiBaseUrl,
    deviceId,
    syncCursor,
  };
  rememberedRegistration = registration;

  try {
    await AsyncStorage.setItem(
      MOBILE_SYNC_REGISTRATION_STORAGE_KEY,
      JSON.stringify(registration),
    );
  } catch {
    // Registration remains available in memory when durable storage is unavailable.
  }
}

async function getOrCreatePendingPresence(
  device: RegisteredDevice,
): Promise<StoredPendingPresence> {
  const apiBaseUrl = getApiBaseUrl();
  const baseCursor = device.syncCursor ?? "0";

  if (!apiBaseUrl) {
    throw getOfflineError();
  }

  if (
    rememberedPendingPresence?.apiBaseUrl === apiBaseUrl &&
    rememberedPendingPresence.deviceId === device.id &&
    rememberedPendingPresence.baseCursor === baseCursor
  ) {
    return rememberedPendingPresence;
  }

  try {
    const value = await AsyncStorage.getItem(
      MOBILE_SYNC_PENDING_PRESENCE_STORAGE_KEY,
    );

    if (value) {
      const candidate = JSON.parse(value) as Partial<StoredPendingPresence>;

      if (
        candidate.apiBaseUrl === apiBaseUrl &&
        candidate.deviceId === device.id &&
        candidate.baseCursor === baseCursor &&
        typeof candidate.changeId === "string" &&
        isUuidLike(candidate.changeId) &&
        typeof candidate.clientTime === "string" &&
        !Number.isNaN(Date.parse(candidate.clientTime))
      ) {
        rememberedPendingPresence = candidate as StoredPendingPresence;
        return rememberedPendingPresence;
      }
    }
  } catch {
    // A fresh in-memory checkpoint can still be sent when storage is unavailable.
  }

  const pendingPresence: StoredPendingPresence = {
    apiBaseUrl,
    baseCursor,
    changeId: createChangeId(),
    clientTime: new Date().toISOString(),
    deviceId: device.id,
  };
  rememberedPendingPresence = pendingPresence;

  try {
    await AsyncStorage.setItem(
      MOBILE_SYNC_PENDING_PRESENCE_STORAGE_KEY,
      JSON.stringify(pendingPresence),
    );
  } catch {
    // The pending ID remains reusable for retries during this runtime.
  }

  return pendingPresence;
}

async function clearPendingPresence(pendingPresence: StoredPendingPresence) {
  if (rememberedPendingPresence?.changeId === pendingPresence.changeId) {
    rememberedPendingPresence = undefined;
  }

  try {
    const value = await AsyncStorage.getItem(
      MOBILE_SYNC_PENDING_PRESENCE_STORAGE_KEY,
    );

    if (
      value &&
      (JSON.parse(value) as Partial<StoredPendingPresence>).changeId ===
        pendingPresence.changeId
    ) {
      await AsyncStorage.removeItem(MOBILE_SYNC_PENDING_PRESENCE_STORAGE_KEY);
    }
  } catch {
    // An acknowledged checkpoint never needs to block the UI on storage cleanup.
  }
}

function createChangeId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();

  if (randomUuid) {
    return randomUuid;
  }

  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (token) => {
    const random = Math.floor(Math.random() * 16);
    const value = token === "x" ? random : (random & 0x3) | 0x8;

    return value.toString(16);
  });
}

export function getOfflineError(): SyncError {
  return {
    code: "offline",
    title: "Sync unavailable",
    message:
      "No live sync endpoint is configured. No live or cached workspace data was loaded.",
    recoverable: true,
  };
}
