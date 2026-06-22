import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const root = fileURLToPath(new URL("..", import.meta.url));
const bundleOverride = parseBundleOverride(
  process.env.ATLASTERM_DESKTOP_RELEASE_BUNDLES,
);
const bundleArgs = bundleOverride ?? defaultBundleArgsForPlatform();
const args = ["run", "tauri:build", "-w", "@atlasterm/desktop"];

if (bundleArgs.length > 0) {
  args.push("--", "--bundles", ...bundleArgs);
}

if (bundleArgs.length > 0) {
  console.log(`Building Desktop release bundle(s): ${bundleArgs.join(", ")}`);
} else {
  console.log("Building Desktop release bundle(s): Tauri platform defaults");
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
