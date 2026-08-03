import { mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";
import {
  buildThirdPartyLicenseBundle,
  formatContractError,
  licenseArtifactPaths,
} from "./third-party-license-contract.mjs";

const defaultRoot = resolve(import.meta.dirname, "..");
const root = parseArgs(process.argv.slice(2));

try {
  const bundle = buildThirdPartyLicenseBundle(root);
  writeArtifact(licenseArtifactPaths.manifest, bundle.manifestText);
  writeArtifact(licenseArtifactPaths.notices, bundle.noticesText);
  writeArtifact(licenseArtifactPaths.checksum, bundle.checksumText);
  console.log(
    `Wrote third-party license manifest for ${bundle.manifest.packages.length} package(s) with ${bundle.manifest.texts.length} embedded text(s).`,
  );
} catch (error) {
  fail(formatContractError(error));
}

function writeArtifact(path, content) {
  const fullPath = resolve(root, path);
  mkdirSync(dirname(fullPath), { recursive: true });
  writeFileSync(fullPath, content, { encoding: "utf8", flag: "w" });
  console.log(relative(root, fullPath).replace(/\\/g, "/"));
}

function parseArgs(args) {
  let root = defaultRoot;
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
    fail(`Unknown argument: ${arg}`);
  }
  return root;
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
