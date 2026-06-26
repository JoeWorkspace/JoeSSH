import assert from "node:assert/strict";
import test from "node:test";

import {
  E2E_MOBILE_SYNC_AUTH_ENV,
  PUBLIC_MOBILE_SYNC_AUTH_ENV,
  PUBLIC_MOBILE_SYNC_URL_ENV,
  REAL_SYNC_AUTH_ENV,
  sanitizeFreshPlaywrightEnv,
  validateMobileE2eSyncAuthEnv,
} from "../tests/e2e/scripts/mobile-e2e-env-guard.mjs";

test("fresh Playwright env removes ambient Expo public mobile sync credentials", () => {
  const env = sanitizeFreshPlaywrightEnv({
    KEEP_ME: "yes",
    [PUBLIC_MOBILE_SYNC_AUTH_ENV]: "ambient-public-token",
    [PUBLIC_MOBILE_SYNC_URL_ENV]: "https://sync.example.test",
  });

  assert.deepEqual(env, { KEEP_ME: "yes" });
});

test("mobile e2e live sync rejects reuse of the real Sync bearer token", () => {
  assert.throws(
    () =>
      validateMobileE2eSyncAuthEnv({
        [E2E_MOBILE_SYNC_AUTH_ENV]: "shared-real-token",
        [REAL_SYNC_AUTH_ENV]: "shared-real-token",
      }),
    /must not reuse ATLASTERM_SYNC_AUTH_TOKEN/,
  );
});

test("mobile e2e live sync accepts an isolated fake test token", () => {
  const result = validateMobileE2eSyncAuthEnv({
    [E2E_MOBILE_SYNC_AUTH_ENV]: "e2e-mobile-sync-token",
    [REAL_SYNC_AUTH_ENV]: "real-sync-token",
  });

  assert.equal(result.ok, true);
  assert.equal(result.e2eToken, "e2e-mobile-sync-token");
});
