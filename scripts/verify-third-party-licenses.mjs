import { createHash, timingSafeEqual } from "node:crypto";
import { existsSync, lstatSync, readFileSync, statSync } from "node:fs";
import { basename, resolve } from "node:path";
import {
  buildThirdPartyLicenseBundle,
  formatContractError,
  licenseArtifactPaths,
  verifyPublishedThirdPartyLicenseBundle,
} from "./third-party-license-contract.mjs";

const defaultRoot = resolve(import.meta.dirname, "..");
const { artifactOnly, root } = parseArgs(process.argv.slice(2));

try {
  if (artifactOnly) {
    const verified = verifyPublishedThirdPartyLicenseBundle(root);
    console.log(
      `Published third-party license bundle verified for ${verified.packageCount} package(s).`,
    );
    process.exit(0);
  }
  const expected = buildThirdPartyLicenseBundle(root);
  verifyExact(licenseArtifactPaths.manifest, expected.manifestText);
  verifyExact(licenseArtifactPaths.notices, expected.noticesText);
  verifyExact(licenseArtifactPaths.checksum, expected.checksumText);
  console.log(
    `Third-party license bundle verified for ${expected.manifest.packages.length} package(s).`,
  );
} catch (error) {
  fail(formatContractError(error));
}

function verifyExact(path, expected) {
  const fullPath = resolve(root, path);
  if (!existsSync(fullPath) || !statSync(fullPath).isFile()) {
    throw new Error(`Third-party license artifact is missing: ${path}.`);
  }
  if (lstatSync(fullPath).isSymbolicLink()) {
    throw new Error(
      `Third-party license artifact must not be a symbolic link: ${path}.`,
    );
  }
  const actualBytes = readFileSync(fullPath);
  const expectedBytes = Buffer.from(expected, "utf8");
  if (actualBytes.length !== expectedBytes.length) {
    throw new Error(
      `Third-party license artifact is stale or tampered: ${path}. Rerun npm run release:third-party-licenses.`,
    );
  }
  const actualHash = createHash("sha256").update(actualBytes).digest();
  const expectedHash = createHash("sha256").update(expectedBytes).digest();
  if (!timingSafeEqual(actualHash, expectedHash)) {
    throw new Error(
      `Third-party license artifact is stale or tampered: ${path}. Rerun npm run release:third-party-licenses.`,
    );
  }
}

function parseArgs(args) {
  let artifactOnly = false;
  let root = defaultRoot;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--artifact-only") {
      artifactOnly = true;
      continue;
    }
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
    fail(`Unknown argument: ${arg}`);
  }
  return { artifactOnly, root };
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
