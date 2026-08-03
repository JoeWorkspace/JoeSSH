import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { relative, resolve } from "node:path";
import {
  buildCargoCycloneDx,
  canonicalizeNpmCycloneDx,
} from "./release-sbom-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const rootPackage = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
if (
  typeof rootPackage.name !== "string" ||
  rootPackage.name.trim() === "" ||
  typeof rootPackage.version !== "string" ||
  rootPackage.version.trim() === ""
) {
  throw new Error("Root package.json name/version must be non-empty strings.");
}
const outputDir = resolve(root, "reports", "release");
const privateInputDir = resolve(root, "reports", "internal", "release-inputs");
const npmCommand = "npm";
const cargoCommand = "cargo";
const fifteenMinutesMs = 15 * 60 * 1000;
const outputBufferBytes = 64 * 1024 * 1024;
const generatedFiles = [];

mkdirSync(outputDir, { recursive: true });
for (const legacyPublicPath of [
  resolve(outputDir, "cargo-metadata.json"),
  resolve(outputDir, "tauri-cargo-metadata.json"),
]) {
  if (existsSync(legacyPublicPath)) {
    rmSync(legacyPublicPath);
  }
}

writeCommandOutput({
  args: [
    "sbom",
    "--workspace",
    "@atlasterm/desktop",
    "--sbom-format",
    "cyclonedx",
    "--package-lock-only",
    "--json",
  ],
  command: npmCommand,
  label: "Desktop npm CycloneDX SBOM",
  outputPath: resolve(outputDir, "npm-desktop-sbom.cdx.json"),
  transformOutput: (stdout) =>
    canonicalizeNpmCycloneDx(stdout, {
      label: "Desktop npm CycloneDX SBOM",
      packageName: rootPackage.name,
      rootPath: root,
    }),
  workingDirectory: root,
});

writeCommandOutput({
  args: [
    "sbom",
    "--workspace",
    "@atlasterm/web",
    "--sbom-format",
    "cyclonedx",
    "--package-lock-only",
    "--json",
  ],
  command: npmCommand,
  label: "Web Admin npm CycloneDX SBOM",
  outputPath: resolve(outputDir, "npm-web-sbom.cdx.json"),
  transformOutput: (stdout) =>
    canonicalizeNpmCycloneDx(stdout, {
      label: "Web Admin npm CycloneDX SBOM",
      packageName: rootPackage.name,
      rootPath: root,
    }),
  workingDirectory: root,
});

writeCommandOutput({
  args: ["metadata", "--format-version", "1", "--locked"],
  command: cargoCommand,
  label: "Rust workspace cargo metadata",
  outputPath: resolve(privateInputDir, "cargo-metadata.json"),
  publicArtifact: false,
  workingDirectory: root,
});

writeCommandOutput({
  args: ["metadata", "--format-version", "1", "--locked"],
  command: cargoCommand,
  label: "Tauri shell cargo metadata",
  outputPath: resolve(privateInputDir, "tauri-cargo-metadata.json"),
  publicArtifact: false,
  workingDirectory: resolve(root, "apps", "desktop", "src-tauri"),
});

writeCargoSbom({
  boundary:
    "All non-development packages reachable from the Rust workspace members, including normal and build dependencies.",
  label: "Rust workspace Cargo CycloneDX SBOM",
  lockPath: resolve(root, "Cargo.lock"),
  metadataPath: resolve(privateInputDir, "cargo-metadata.json"),
  outputPath: resolve(outputDir, "cargo-workspace-sbom.cdx.json"),
  packageName: "atlasterm-rust-workspace",
});

writeCargoSbom({
  boundary:
    "All non-development packages reachable from the Tauri shell workspace members, including normal and build dependencies.",
  label: "Tauri shell Cargo CycloneDX SBOM",
  lockPath: resolve(root, "apps", "desktop", "src-tauri", "Cargo.lock"),
  metadataPath: resolve(privateInputDir, "tauri-cargo-metadata.json"),
  outputPath: resolve(outputDir, "tauri-cargo-sbom.cdx.json"),
  packageName: "atlasterm-tauri-shell",
});

writeSbomChecksumManifest(generatedFiles);

function writeCommandOutput({
  args,
  command,
  label,
  outputPath,
  publicArtifact = true,
  transformOutput,
  workingDirectory,
}) {
  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    maxBuffer: outputBufferBytes,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: fifteenMinutesMs,
  });

  if (result.status !== 0) {
    const diagnostic =
      result.error?.message || result.stdout?.toString("utf8") || "";
    console.error(`${label} generation failed:\n${diagnostic}`);
    process.exit(result.status ?? 1);
  }

  let output = result.stdout;
  if (transformOutput) {
    try {
      output = transformOutput(result.stdout);
    } catch (error) {
      console.error(
        `${label} canonicalization failed:\n${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      process.exit(1);
    }
  }
  mkdirSync(resolve(outputPath, ".."), { recursive: true });
  writeFileSync(outputPath, output);
  if (publicArtifact) {
    generatedFiles.push(outputPath);
  }
  console.log(
    `Wrote ${label} to ${relative(root, outputPath).replace(/\\/g, "/")}`,
  );
}

function writeCargoSbom({
  boundary,
  label,
  lockPath,
  metadataPath,
  outputPath,
  packageName,
}) {
  let output;
  try {
    output = buildCargoCycloneDx(
      readFileSync(metadataPath),
      readFileSync(lockPath),
      {
        boundary,
        label,
        packageName,
        packageVersion: rootPackage.version,
        rootPath: root,
      },
    );
  } catch (error) {
    console.error(
      `${label} canonicalization failed:\n${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
  writeFileSync(outputPath, output);
  generatedFiles.push(outputPath);
  console.log(
    `Wrote ${label} to ${relative(root, outputPath).replace(/\\/g, "/")}`,
  );
}

function writeSbomChecksumManifest(files) {
  const manifestPath = resolve(outputDir, "SBOM-SHA256SUMS.txt");
  const lines = files
    .sort((left, right) => left.localeCompare(right))
    .map(
      (file) => `${sha256(file)}  ${relative(root, file).replace(/\\/g, "/")}`,
    );
  writeFileSync(manifestPath, `${lines.join("\n")}\n`);
  console.log(
    `Wrote SBOM checksums to ${relative(root, manifestPath).replace(/\\/g, "/")}`,
  );
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
