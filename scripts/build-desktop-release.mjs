import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const root = fileURLToPath(new URL("..", import.meta.url));
const bundleOverride = parseBundleOverride(
  process.env.ATLASTERM_DESKTOP_RELEASE_BUNDLES,
);
const bundleArgs = bundleOverride ?? defaultBundleArgsForPlatform();
const configArgs = parseConfigArgs(
  process.env.ATLASTERM_DESKTOP_RELEASE_TAURI_CONFIGS,
);
const args = ["run", "tauri:build", "-w", "@atlasterm/desktop"];
const tauriArgs = [];

for (const config of configArgs) {
  tauriArgs.push("--config", config);
}

if (bundleArgs.length > 0) {
  tauriArgs.push("--bundles", ...bundleArgs);
}

if (tauriArgs.length > 0) {
  args.push("--", ...tauriArgs);
}

if (bundleArgs.length > 0) {
  console.log(`Building Desktop release bundle(s): ${bundleArgs.join(", ")}`);
} else {
  console.log("Building Desktop release bundle(s): Tauri platform defaults");
}
if (configArgs.length > 0) {
  console.log(`Merging Tauri release config(s): ${configArgs.join(", ")}`);
}

const result = spawnSync(npmCommand, args, {
  cwd: root,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);

function defaultBundleArgsForPlatform() {
  if (process.platform === "win32") {
    // MSI rejects semver prerelease identifiers such as 0.1.0-beta.1. NSIS can
    // carry Public Beta Desktop staging builds without weakening signing gates.
    return ["nsis"];
  }

  return [];
}

function parseBundleOverride(value) {
  const raw = value?.trim();
  if (!raw) {
    return null;
  }

  const bundles = raw
    .split(/[\s,]+/)
    .map((bundle) => bundle.trim())
    .filter(Boolean);

  return bundles.length > 0 ? [...new Set(bundles)] : null;
}

function parseConfigArgs(value) {
  const raw = value?.trim();
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    ) {
      return parsed.map((entry) => entry.trim()).filter(Boolean);
    }
  } catch {
    // Fall back to a simple comma/newline list below.
  }

  return raw
    .split(/[,\r\n]+/)
    .map((config) => config.trim())
    .filter(Boolean);
}
