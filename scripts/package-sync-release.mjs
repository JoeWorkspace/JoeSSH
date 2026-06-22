import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, relative, resolve } from "node:path";
import { createHash } from "node:crypto";

const defaultRoot = resolve(import.meta.dirname, "..");
const { root, skipBuild } = parseArgs(process.argv.slice(2));
const version = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8")).version;
const cargoCommand = "cargo";
const binaryName = process.platform === "win32" ? "atlasterm-sync.exe" : "atlasterm-sync";
const sourceBinary = resolve(root, "target", "release", binaryName);
const outputDir = resolve(root, "reports", "release", "sync");
const releaseBinary = resolve(outputDir, `joessh-sync-${version}-${process.platform}-${process.arch}${process.platform === "win32" ? ".exe" : ""}`);
const checksumPath = resolve(outputDir, "SHA256SUMS.txt");

if (!skipBuild) {
  const build = spawnSync(cargoCommand, ["build", "--release", "-p", "atlasterm-sync"], {
    cwd: root,
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }
}

if (!existsSync(sourceBinary)) {
  console.error(`Expected sync release binary at ${relative(root, sourceBinary).replace(/\\/g, "/")}`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
removeStaleSyncReleaseBinaries(outputDir, releaseBinary);
copyFileSync(sourceBinary, releaseBinary);
writeFileSync(checksumPath, `${sha256(releaseBinary)}  ${relative(root, releaseBinary).replace(/\\/g, "/")}\n`);

console.log(`Packaged ${relative(root, releaseBinary).replace(/\\/g, "/")}`);
console.log(`Wrote ${relative(root, checksumPath).replace(/\\/g, "/")}`);

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function removeStaleSyncReleaseBinaries(path, currentReleaseBinary) {
  if (!existsSync(path)) {
    return;
  }

  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const candidate = resolve(path, entry.name);
    if (entry.isFile() && isSyncReleaseBinaryName(entry.name) && candidate !== currentReleaseBinary) {
      rmSync(candidate);
    }
  }
}

function isSyncReleaseBinaryName(name) {
  return /^joessh-sync-[0-9][0-9A-Za-z._-]*-(?:aix|darwin|freebsd|linux|openbsd|sunos|win32)-[A-Za-z0-9_-]+(?:\.exe)?$/i.test(
    name,
  );
}

function parseArgs(args) {
  let root = defaultRoot;
  let skipBuild = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--root") {
      const value = args[index + 1];
      if (!value) {
        fail("--root requires a path.");
      }
      root = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    if (arg === "--skip-build") {
      skipBuild = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  return { root, skipBuild };
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
