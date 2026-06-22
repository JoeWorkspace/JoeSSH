import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_PUBLIC_MOBILE_ENV = "EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN";

export function checkMobilePublicEnv(env = process.env) {
  const failures = [];
  const syncAuthToken = env[FORBIDDEN_PUBLIC_MOBILE_ENV];

  if (typeof syncAuthToken === "string" && syncAuthToken.trim() !== "") {
    failures.push(
      `${FORBIDDEN_PUBLIC_MOBILE_ENV} must not be set for Public Beta mobile release builds because EXPO_PUBLIC_* values are embedded in the app bundle.`,
    );
  }

  return {
    failures,
    ok: failures.length === 0,
  };
}

export function formatMobilePublicEnvCheck(result) {
  if (result.ok) {
    return "OK Mobile public env guard passed.";
  }

  return ["Mobile public env guard failed:", ...result.failures.map((failure) => `- ${failure}`)].join("\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkMobilePublicEnv();
  const message = formatMobilePublicEnvCheck(result);

  if (result.ok) {
    console.log(message);
  } else {
    console.error(message);
    process.exitCode = 1;
  }
}
