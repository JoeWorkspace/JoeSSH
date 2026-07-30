import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const lockPath = resolve(root, "package-lock.json");

const supportedNativePackages = [
  {
    parent: "node_modules/esbuild",
    packages: [
      "@esbuild/darwin-arm64",
      "@esbuild/darwin-x64",
      "@esbuild/linux-x64",
      "@esbuild/win32-x64",
    ],
  },
  {
    parent: "node_modules/rollup",
    packages: [
      "@rollup/rollup-darwin-arm64",
      "@rollup/rollup-darwin-x64",
      "@rollup/rollup-linux-x64-gnu",
      "@rollup/rollup-win32-x64-msvc",
    ],
  },
  {
    parent: "node_modules/@tauri-apps/cli",
    packages: [
      "@tauri-apps/cli-darwin-arm64",
      "@tauri-apps/cli-darwin-x64",
      "@tauri-apps/cli-linux-x64-gnu",
      "@tauri-apps/cli-win32-x64-msvc",
    ],
  },
  {
    parent: "node_modules/lightningcss",
    packages: [
      "lightningcss-darwin-arm64",
      "lightningcss-darwin-x64",
      "lightningcss-linux-x64-gnu",
      "lightningcss-win32-x64-msvc",
    ],
  },
];

export function auditPackageLock(lock) {
  const issues = [];
  const packages = lock?.packages;

  if (!packages || typeof packages !== "object" || Array.isArray(packages)) {
    return {
      issues: ["package-lock.json must contain a packages object."],
      registryPackages: 0,
      optionalPackages: 0,
    };
  }

  const packageEntriesByName = new Map();
  let registryPackages = 0;

  for (const [packagePath, entry] of Object.entries(packages)) {
    if (!packagePath.includes("node_modules/") || entry?.link === true) {
      continue;
    }

    registryPackages += 1;
    const packageName = packageNameFromPath(packagePath);
    const entries = packageEntriesByName.get(packageName) ?? [];
    entries.push({ packagePath, entry });
    packageEntriesByName.set(packageName, entries);

    if (typeof entry?.resolved !== "string" || entry.resolved.length === 0) {
      issues.push(`${packagePath} is missing resolved.`);
    } else if (
      entry.resolved.startsWith("file:") ||
      entry.resolved.startsWith(".") ||
      /^[a-zA-Z]:[\\/]/u.test(entry.resolved)
    ) {
      issues.push(`${packagePath} resolves to a local path: ${entry.resolved}`);
    }

    if (
      typeof entry?.integrity !== "string" ||
      !/^sha(?:1|256|384|512)-/u.test(entry.integrity)
    ) {
      issues.push(`${packagePath} is missing a valid integrity hash.`);
    }
  }

  const optionalPackageNames = new Set();
  for (const [packagePath, entry] of Object.entries(packages)) {
    for (const packageName of Object.keys(entry?.optionalDependencies ?? {})) {
      optionalPackageNames.add(packageName);
      if (!packageEntriesByName.has(packageName)) {
        issues.push(
          `${packagePath || "<root>"} references missing optional package ${packageName}.`,
        );
      }
    }
  }

  for (const contract of supportedNativePackages) {
    const parent = packages[contract.parent];
    if (!parent) {
      issues.push(`Missing native package parent ${contract.parent}.`);
      continue;
    }

    for (const packageName of contract.packages) {
      const expectedVersion = parent.optionalDependencies?.[packageName];
      if (!expectedVersion) {
        issues.push(
          `${contract.parent} does not declare ${packageName} as optional.`,
        );
        continue;
      }

      const candidates = packageEntriesByName.get(packageName) ?? [];
      if (!candidates.some(({ entry }) => entry.version === expectedVersion)) {
        issues.push(`${packageName} must be locked at ${expectedVersion}.`);
      }
    }
  }

  return {
    issues: [...new Set(issues)].sort(),
    registryPackages,
    optionalPackages: optionalPackageNames.size,
  };
}

function packageNameFromPath(packagePath) {
  return packagePath.slice(
    packagePath.lastIndexOf("node_modules/") + "node_modules/".length,
  );
}

function main() {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const result = auditPackageLock(lock);

  if (result.issues.length > 0) {
    console.error(
      `package-lock portability audit failed:\n- ${result.issues.join("\n- ")}`,
    );
    process.exit(1);
  }

  console.log(
    `package-lock portability audit passed: ${result.registryPackages} registry packages, ${result.optionalPackages} optional package names.`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main();
}
