import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN_PUBLIC_MOBILE_ENV = "EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN";
const defaultRoot = resolve(import.meta.dirname, "..");
const mobileEnvDirs = ["", join("apps", "mobile")];

function isMobileEnvFileName(name) {
  if (name === ".env") {
    return true;
  }

  if (!name.startsWith(".env.")) {
    return false;
  }

  return name !== ".env.example";
}

export function discoverMobilePublicEnvFiles(root = defaultRoot) {
  const files = [];

  for (const dir of mobileEnvDirs) {
    const absoluteDir = resolve(root, dir);
    if (!existsSync(absoluteDir)) {
      continue;
    }

    for (const entry of readdirSync(absoluteDir, { withFileTypes: true })) {
      if (!isMobileEnvFileName(entry.name)) {
        continue;
      }

      const candidate = join(absoluteDir, entry.name);
      try {
        if (statSync(candidate).isFile()) {
          files.push(candidate);
        }
      } catch {
        // Broken or inaccessible symlinks cannot contribute build-time env.
      }
    }
  }

  return files;
}

function unquoteEnvValue(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const quote = trimmed[0];
    if ((quote === "'" || quote === '"') && trimmed.at(-1) === quote) {
      return trimmed.slice(1, -1).trim();
    }
  }

  return trimmed;
}

function activeForbiddenEnvAssignments(filePath) {
  const content = readFileSync(filePath, "utf8");
  const activeAssignments = [];

  for (const [index, rawLine] of content.split(/\r?\n/u).entries()) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const assignment = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/u.exec(trimmed);
    if (!assignment || assignment[1] !== FORBIDDEN_PUBLIC_MOBILE_ENV) {
      continue;
    }

    if (unquoteEnvValue(assignment[2]) !== "") {
      activeAssignments.push({ line: index + 1 });
    }
  }

  return activeAssignments;
}

export function checkMobilePublicEnv(env = process.env, options = {}) {
  const failures = [];
  const syncAuthToken = env[FORBIDDEN_PUBLIC_MOBILE_ENV];
  const root = resolve(options.root ?? defaultRoot);
  const envFilePaths = options.envFilePaths ?? [];

  if (typeof syncAuthToken === "string" && syncAuthToken.trim() !== "") {
    failures.push(
      `${FORBIDDEN_PUBLIC_MOBILE_ENV} must not be set for Public Beta mobile release builds because EXPO_PUBLIC_* values are embedded in the app bundle.`,
    );
  }

  for (const envFilePath of envFilePaths) {
    const absolutePath = resolve(root, envFilePath);
    if (!existsSync(absolutePath) || !statSync(absolutePath).isFile()) {
      continue;
    }

    for (const assignment of activeForbiddenEnvAssignments(absolutePath)) {
      const displayPath = relative(root, absolutePath) || basename(absolutePath);
      failures.push(
        `${displayPath}:${assignment.line} sets ${FORBIDDEN_PUBLIC_MOBILE_ENV}; remove this build-time public token before any Public Beta mobile release build.`,
      );
    }
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
  const result = checkMobilePublicEnv(process.env, {
    envFilePaths: discoverMobilePublicEnvFiles(defaultRoot),
    root: defaultRoot,
  });
  const message = formatMobilePublicEnvCheck(result);

  if (result.ok) {
    console.log(message);
  } else {
    console.error(message);
    process.exitCode = 1;
  }
}
