import assert from "node:assert/strict";
import test from "node:test";

import { checkMobilePublicEnv, formatMobilePublicEnvCheck } from "./check-mobile-public-env.mjs";

test("passes when the mobile sync auth token env is absent or blank", () => {
  assert.equal(checkMobilePublicEnv({}).ok, true);
  assert.equal(checkMobilePublicEnv({ EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN: "" }).ok, true);
  assert.equal(checkMobilePublicEnv({ EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN: "   " }).ok, true);
});

test("fails when a mobile public sync auth token would be embedded", () => {
  const result = checkMobilePublicEnv({
    EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN: "mobile-release-token",
  });

  assert.equal(result.ok, false);
  assert.match(formatMobilePublicEnvCheck(result), /EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN/);
  assert.match(formatMobilePublicEnvCheck(result), /embedded in the app bundle/);
});
