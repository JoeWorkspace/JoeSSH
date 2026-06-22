import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputDir = resolve(root, "reports", "release");
const npmCommand = "npm";
const cargoCommand = "cargo";
const fifteenMinutesMs = 15 * 60 * 1000;
const outputBufferBytes = 64 * 1024 * 1024;
const generatedFiles = [];

mkdirSync(outputDir, { recursive: true });

writeCommandOutput({
  args: ["sbom", "--workspace", "@atlasterm/desktop", "--sbom-format", "cyclonedx", "--package-lock-only", "--json"],
  command: npmCommand,
  label: "Desktop npm CycloneDX SBOM",
  outputPath: resolve(outputDir, "npm-desktop-sbom.cdx.json"),
  workingDirectory: root,
});

writeCommandOutput({
  args: ["sbom", "--workspace", "@atlasterm/web", "--sbom-format", "cyclonedx", "--package-lock-only", "--json"],
  command: npmCommand,
  label: "Web Admin npm CycloneDX SBOM",
  outputPath: resolve(outputDir, "npm-web-sbom.cdx.json"),
  workingDirectory: root,
});

writeCommandOutput({
  args: ["metadata", "--format-version", "1"],
  command: cargoCommand,
  label: "Rust workspace cargo metadata",
  outputPath: resolve(outputDir, "cargo-metadata.json"),
  workingDirectory: root,
});

writeCommandOutput({
  args: ["metadata", "--format-version", "1"],
  command: cargoCommand,
  label: "Tauri shell cargo metadata",
  outputPath: resolve(outputDir, "tauri-cargo-metadata.json"),
  workingDirectory: resolve(root, "apps", "desktop", "src-tauri"),
});

writeSbomChecksumManifest(generatedFiles);

function writeCommandOutput({ args, command, label, outputPath, workingDirectory }) {
  const result = spawnSync(command, args, {
    cwd: workingDirectory,
    encoding: "utf8",
    maxBuffer: outputBufferBytes,
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
    timeout: fifteenMinutesMs,
  });

  if (result.status !== 0) {
    const diagnostic = result.error?.message || result.stdout;
    console.error(`${label} generation failed:\n${diagnostic}`);
    process.exit(result.status ?? 1);
  }

  writeFileSync(outputPath, result.stdout);
  generatedFiles.push(outputPath);
  console.log(`Wrote ${label} to ${relative(root, outputPath).replace(/\\/g, "/")}`);
}

function writeSbomChecksumManifest(files) {
  const manifestPath = resolve(outputDir, "SBOM-SHA256SUMS.txt");
  const lines = files
    .sort((left, right) => left.localeCompare(right))
    .map((file) => `${sha256(file)}  ${relative(root, file).replace(/\\/g, "/")}`);
  writeFileSync(manifestPath, `${lines.join("\n")}\n`);
  console.log(`Wrote SBOM checksums to ${relative(root, manifestPath).replace(/\\/g, "/")}`);
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}
