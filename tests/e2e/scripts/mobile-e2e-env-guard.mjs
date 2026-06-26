export const E2E_MOBILE_SYNC_AUTH_ENV = "ATLASTERM_E2E_MOBILE_SYNC_AUTH_TOKEN";
export const PUBLIC_MOBILE_SYNC_AUTH_ENV = "EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN";
export const PUBLIC_MOBILE_SYNC_URL_ENV = "EXPO_PUBLIC_ATLASTERM_SYNC_URL";
export const REAL_SYNC_AUTH_ENV = "ATLASTERM_SYNC_AUTH_TOKEN";

export function sanitizeFreshPlaywrightEnv(env = process.env) {
  const sanitized = { ...env };
  delete sanitized[PUBLIC_MOBILE_SYNC_AUTH_ENV];
  delete sanitized[PUBLIC_MOBILE_SYNC_URL_ENV];
  return sanitized;
}

export function validateMobileE2eSyncAuthEnv(env = process.env, options = {}) {
  const e2eToken = (options.mobileSyncAuthToken ?? env[E2E_MOBILE_SYNC_AUTH_ENV] ?? "e2e-mobile-sync-token").trim();
  const realSyncToken = env[REAL_SYNC_AUTH_ENV]?.trim() ?? "";

  if (realSyncToken && e2eToken === realSyncToken) {
    throw new Error(
      `${E2E_MOBILE_SYNC_AUTH_ENV} must not reuse ${REAL_SYNC_AUTH_ENV}; Expo web exports embed the e2e token as ${PUBLIC_MOBILE_SYNC_AUTH_ENV}.`,
    );
  }

  return {
    e2eToken,
    ok: true,
  };
}
