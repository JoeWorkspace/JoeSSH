import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, isAbsolute, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  assertMicrosoftStoreTauriConfig,
  assertProjectReleaseIdentity,
  assertWindowsLegalPublisher,
  fileNameContainsVersion,
  readCargoVersion,
} from "./windows-store-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const SIGNING_CONFIG_MAX_BYTES = 64 * 1024;
const SIGNING_FIELDS = new Set([
  "certificateThumbprint",
  "digestAlgorithm",
  "signCommand",
  "timestampUrl",
  "tsp",
]);

export function buildWindowsStoreCandidate({
  env = process.env,
  platform = process.platform,
  spawn = spawnSync,
} = {}) {
  if (platform !== "win32") {
    throw new Error(
      "Microsoft Store NSIS candidates must be built on Windows.",
    );
  }

  const storeConfigPath = resolve(
    root,
    "apps/desktop/src-tauri/tauri.microsoftstore.conf.json",
  );
  const rootPackage = readJson(resolve(root, "package.json"));
  const desktopPackage = readJson(resolve(root, "apps/desktop/package.json"));
  const tauriConfig = readJson(
    resolve(root, "apps/desktop/src-tauri/tauri.conf.json"),
  );
  const storeConfig = readJson(storeConfigPath);
  const identity = assertProjectReleaseIdentity({
    cargoVersion: readCargoVersion(
      resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
    ),
    desktopPackage,
    legalPublisher: env.ATLASTERM_WINDOWS_LEGAL_PUBLISHER,
    rootPackage,
    tauriConfig,
  });
  assertMicrosoftStoreTauriConfig(storeConfig);

  const signingConfig = loadWindowsStoreSigningConfig(
    env.ATLASTERM_WINDOWS_STORE_SIGNING_CONFIG,
  );
  const storeConfigArgument = "src-tauri/tauri.microsoftstore.conf.json";
  let temporarySigningDirectory;

  try {
    temporarySigningDirectory = mkdtempSync(
      join(tmpdir(), "joessh-store-signing-"),
    );
    const identityConfigPath = join(
      temporarySigningDirectory,
      "tauri.windows.legal-publisher.json",
    );
    writeFileSync(
      identityConfigPath,
      `${JSON.stringify(createWindowsStoreIdentityConfig(identity.publisher), null, 2)}\n`,
      {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      },
    );
    const configArguments = [storeConfigArgument, identityConfigPath];
    if (signingConfig) {
      assertMicrosoftStoreTauriConfig({
        ...storeConfig,
        bundle: {
          ...storeConfig.bundle,
          windows: {
            ...storeConfig.bundle.windows,
            ...signingConfig.bundle.windows,
          },
        },
      });
      const sanitizedConfigPath = join(
        temporarySigningDirectory,
        "tauri.windows.signing.json",
      );
      writeFileSync(
        sanitizedConfigPath,
        `${JSON.stringify(signingConfig, null, 2)}\n`,
        {
          encoding: "utf8",
          flag: "wx",
          mode: 0o600,
        },
      );
      configArguments.push(sanitizedConfigPath);
    }

    console.log(
      `Building signed-capable Microsoft Store NSIS candidate for ${identity.version}.`,
    );
    const result = spawn("npm.cmd", ["run", "release:desktop:build"], {
      cwd: root,
      env: {
        ...env,
        ATLASTERM_DESKTOP_RELEASE_BUNDLES: "nsis",
        ATLASTERM_DESKTOP_RELEASE_TAURI_CONFIGS:
          JSON.stringify(configArguments),
      },
      shell: false,
      stdio: "inherit",
    });
    if (result.error) {
      throw result.error;
    }
    if (result.status !== 0) {
      throw new Error(
        `Microsoft Store NSIS build failed with exit code ${result.status}.`,
      );
    }

    const bundleDir = resolve(
      root,
      "apps/desktop/src-tauri/target/release/bundle/nsis",
    );
    if (!existsSync(bundleDir)) {
      throw new Error("Tauri did not create the NSIS bundle directory.");
    }
    const candidates = readdirSync(bundleDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.toLowerCase().endsWith(".exe") &&
          fileNameContainsVersion(entry.name, identity.version),
      )
      .map((entry) => resolve(bundleDir, entry.name))
      .filter((path) => statSync(path).size > 0)
      .sort((left, right) => left.localeCompare(right));
    if (candidates.length !== 1) {
      throw new Error(
        `Expected exactly one current-version NSIS candidate, found ${candidates.length}.`,
      );
    }
    console.log(`Microsoft Store build candidate: ${candidates[0]}`);
    console.log(
      "This build is not Store evidence. Run the Windows Store candidate preflight before submission.",
    );
    return candidates[0];
  } finally {
    if (temporarySigningDirectory) {
      rmSync(temporarySigningDirectory, { force: true, recursive: true });
    }
  }
}

export function createWindowsStoreIdentityConfig(legalPublisher) {
  return {
    bundle: {
      publisher: assertWindowsLegalPublisher(legalPublisher),
    },
  };
}

export function loadWindowsStoreSigningConfig(value) {
  const configPaths = parseSigningConfigPaths(value);
  if (configPaths.length === 0) {
    return null;
  }

  const canonicalPaths = new Set();
  const mergedWindowsConfig = Object.create(null);
  for (const configPath of configPaths) {
    let canonicalPath;
    try {
      canonicalPath = realpathSync(configPath);
    } catch {
      throw new Error(`Signing config does not exist: ${configPath}`);
    }
    const canonicalKey =
      process.platform === "win32"
        ? canonicalPath.toLowerCase()
        : canonicalPath;
    if (canonicalPaths.has(canonicalKey)) {
      throw new Error(`Signing config is listed more than once: ${configPath}`);
    }
    canonicalPaths.add(canonicalKey);

    const stats = statSync(canonicalPath);
    if (!stats.isFile() || stats.size <= 0) {
      throw new Error(`Signing config must be a non-empty file: ${configPath}`);
    }
    if (stats.size > SIGNING_CONFIG_MAX_BYTES) {
      throw new Error(
        `Signing config exceeds ${SIGNING_CONFIG_MAX_BYTES} bytes: ${configPath}`,
      );
    }

    const parsed = readJson(canonicalPath);
    const normalized = normalizeSigningConfig(parsed, canonicalPath);
    Object.assign(mergedWindowsConfig, normalized.bundle.windows);
  }

  assertCompleteSigningConfig(mergedWindowsConfig);
  return {
    bundle: {
      windows: { ...mergedWindowsConfig },
    },
  };
}

export function parseSigningConfigPaths(value) {
  const raw = value?.trim();
  if (!raw) {
    return [];
  }

  let entries;
  if (raw.startsWith("[") || raw.startsWith('"') || raw.startsWith("{")) {
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        "ATLASTERM_WINDOWS_STORE_SIGNING_CONFIG contains invalid JSON.",
      );
    }
    if (typeof parsed === "string") {
      entries = [parsed];
    } else if (Array.isArray(parsed)) {
      entries = parsed;
    } else {
      throw new Error(
        "ATLASTERM_WINDOWS_STORE_SIGNING_CONFIG must be an absolute path or a JSON array of absolute paths.",
      );
    }
  } else {
    entries = [raw];
  }

  if (
    entries.length === 0 ||
    entries.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new Error(
      "Every Windows Store signing config entry must be a non-empty path.",
    );
  }

  return entries.map((entry) => {
    const path = entry.trim();
    if (!isAbsolute(path)) {
      throw new Error(`Signing config path must be absolute: ${path}`);
    }
    return path;
  });
}

export function normalizeSigningConfig(config, source = "signing config") {
  assertExactObjectKeys(config, ["bundle"], source);
  assertExactObjectKeys(config.bundle, ["windows"], `${source}.bundle`);
  const windowsConfig = config.bundle.windows;
  if (!isPlainObject(windowsConfig)) {
    throw new Error(`${source}.bundle.windows must be an object.`);
  }
  const fields = Object.keys(windowsConfig);
  if (fields.length === 0) {
    throw new Error(`${source}.bundle.windows cannot be empty.`);
  }
  for (const field of fields) {
    if (!SIGNING_FIELDS.has(field)) {
      throw new Error(
        `${source}.bundle.windows.${field} is not an allowed signing field.`,
      );
    }
  }

  const normalized = Object.create(null);
  if (Object.hasOwn(windowsConfig, "certificateThumbprint")) {
    const thumbprint = windowsConfig.certificateThumbprint;
    if (typeof thumbprint !== "string" || !/^[a-f0-9]{40}$/i.test(thumbprint)) {
      throw new Error(
        `${source}.bundle.windows.certificateThumbprint must be exactly 40 hexadecimal characters.`,
      );
    }
    normalized.certificateThumbprint = thumbprint.toUpperCase();
  }
  if (Object.hasOwn(windowsConfig, "digestAlgorithm")) {
    if (
      typeof windowsConfig.digestAlgorithm !== "string" ||
      windowsConfig.digestAlgorithm.toLowerCase() !== "sha256"
    ) {
      throw new Error(
        `${source}.bundle.windows.digestAlgorithm must be sha256.`,
      );
    }
    normalized.digestAlgorithm = "sha256";
  }
  if (Object.hasOwn(windowsConfig, "timestampUrl")) {
    normalized.timestampUrl = normalizeTimestampUrl(
      windowsConfig.timestampUrl,
      source,
    );
  }
  if (Object.hasOwn(windowsConfig, "tsp")) {
    if (typeof windowsConfig.tsp !== "boolean") {
      throw new Error(`${source}.bundle.windows.tsp must be a boolean.`);
    }
    normalized.tsp = windowsConfig.tsp;
  }
  if (Object.hasOwn(windowsConfig, "signCommand")) {
    normalized.signCommand = normalizeSignCommand(
      windowsConfig.signCommand,
      source,
    );
  }

  return {
    bundle: {
      windows: { ...normalized },
    },
  };
}

function assertCompleteSigningConfig(windowsConfig) {
  const fields = Object.keys(windowsConfig);
  const hasSignCommand = Object.hasOwn(windowsConfig, "signCommand");
  const hasCertificate = Object.hasOwn(windowsConfig, "certificateThumbprint");
  if (hasSignCommand && fields.length !== 1) {
    throw new Error(
      "A custom signCommand cannot be combined with certificateThumbprint, digestAlgorithm, timestampUrl, or tsp.",
    );
  }
  if (hasSignCommand) {
    return;
  }
  if (!hasCertificate) {
    throw new Error(
      "Signing config must provide either signCommand or certificateThumbprint.",
    );
  }
  if (
    windowsConfig.digestAlgorithm !== "sha256" ||
    !windowsConfig.timestampUrl
  ) {
    throw new Error(
      "Certificate signing requires digestAlgorithm=sha256 and timestampUrl.",
    );
  }
}

function normalizeSignCommand(signCommand, source) {
  const label = `${source}.bundle.windows.signCommand`;
  if (typeof signCommand === "string") {
    assertSafeCommandText(signCommand, label);
    if (!signCommand.includes("%1")) {
      throw new Error(`${label} must contain the Tauri %1 file placeholder.`);
    }
    return signCommand;
  }
  assertExactObjectKeys(signCommand, ["args", "cmd"], label);
  assertSafeCommandText(signCommand.cmd, `${label}.cmd`);
  if (
    !Array.isArray(signCommand.args) ||
    signCommand.args.length === 0 ||
    signCommand.args.some((argument) => typeof argument !== "string")
  ) {
    throw new Error(`${label}.args must be a non-empty string array.`);
  }
  for (const [index, argument] of signCommand.args.entries()) {
    assertSafeCommandText(argument, `${label}.args[${index}]`, {
      allowEmpty: true,
    });
  }
  if (!signCommand.args.some((argument) => argument.includes("%1"))) {
    throw new Error(
      `${label}.args must contain the Tauri %1 file placeholder.`,
    );
  }
  return {
    args: [...signCommand.args],
    cmd: signCommand.cmd,
  };
}

function assertSafeCommandText(value, label, { allowEmpty = false } = {}) {
  if (
    typeof value !== "string" ||
    (!allowEmpty && !value.trim()) ||
    /[\0\r\n]/.test(value)
  ) {
    throw new Error(
      `${label} must be ${allowEmpty ? "a" : "a non-empty"} single-line string.`,
    );
  }
}

function normalizeTimestampUrl(value, source) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(
      `${source}.bundle.windows.timestampUrl must be a non-empty URL.`,
    );
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `${source}.bundle.windows.timestampUrl must be a valid HTTP(S) URL.`,
    );
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new Error(
      `${source}.bundle.windows.timestampUrl must be HTTP(S) without credentials or a fragment.`,
    );
  }
  return parsed.toString();
}

function assertExactObjectKeys(value, expectedKeys, label) {
  if (!isPlainObject(value)) {
    throw new Error(`${label} must be an object.`);
  }
  const actualKeys = Object.keys(value).sort();
  const allowedKeys = new Set(expectedKeys);
  for (const key of actualKeys) {
    if (!allowedKeys.has(key)) {
      throw new Error(`${label}.${key} is not allowed.`);
    }
  }
  for (const key of expectedKeys) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${label}.${key} is required.`);
    }
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function readJson(path) {
  let text;
  try {
    text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  } catch {
    throw new Error(`Unable to read JSON: ${path}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON: ${path}`);
  }
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exitCode = 1;
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    buildWindowsStoreCandidate();
  } catch (error) {
    fail(error.message);
  }
}
