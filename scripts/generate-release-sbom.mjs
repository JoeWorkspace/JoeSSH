import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, relative, resolve } from "node:path";
import { assertReportOutput, bindSbom, lockfileBinding, sanitizeCargoMetadata, sbomFileNames, sha256File, validateCargoInventory, validateNpmInventory } from "./release-sbom-lib.mjs";
import { collectLicenseMaterials, licenseInventoryName, licenseTextsName } from "./release-license-lib.mjs";

const root = resolve(import.meta.dirname, "..");
let output = "reports/release";
const args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] !== "--output-dir" || !args[index + 1]) throw new Error("Usage: generate-release-sbom.mjs [--output-dir reports/path]");
  output = args[++index];
}
const outputDir = assertReportOutput(root, output);
const originalBinding = lockfileBinding(root);
const documents = {};
try {
  for (const workspace of ["desktop", "web"]) {
    const document = commandJson("npm", ["sbom", "--workspace", `@atlasterm/${workspace}`, "--sbom-format", "cyclonedx", "--package-lock-only", "--json"], root);
    validateNpmInventory(document, root, workspace);
    documents[`npm-${workspace}-sbom.cdx.json`] = bindSbom(document, root, "npm");
  }
  for (const [name, directory, lockfile] of [
    ["cargo-metadata.json", root, "Cargo.lock"],
    ["tauri-cargo-metadata.json", resolve(root, "apps/desktop/src-tauri"), "apps/desktop/src-tauri/Cargo.lock"],
  ]) {
    const document = commandJson("cargo", ["metadata", "--locked", "--format-version", "1"], directory);
    validateCargoInventory(document, root, lockfile);
    documents[name] = bindSbom(document, root, "cargo");
  }
  console.log("Collecting pinned third-party license material...");
  const archiveCachePath = commandOutput("npm", ["config", "get", "cache"], root).trim();
  const materials = await collectLicenseMaterials(root, documents, { archiveCachePath, onProgress: (done, total) => { if (done % 100 === 0 || done === total) console.log(`Checked license sources: ${done}/${total}`); } });
  if (JSON.stringify(originalBinding) !== JSON.stringify(lockfileBinding(root))) throw new Error("Lockfiles changed during SBOM generation; retry from a stable checkout");
  assertReportOutput(root, outputDir);
  mkdirSync(outputDir, { recursive: true });
  for (const [name, document] of Object.entries(documents)) {
    writeOutput(name, `${JSON.stringify(name.startsWith("npm-") ? document : sanitizeCargoMetadata(document, root), null, 2)}\n`);
  }
  materials.inventory.sboms = Object.fromEntries(sbomFileNames.map((name) => [name, sha256File(resolve(outputDir, name))]));
  writeOutput(licenseTextsName, `${JSON.stringify(Object.fromEntries([...materials.texts].sort(([a], [b]) => a.localeCompare(b)).map(([digest, content]) => [digest, content.toString("utf8")])), null, 2)}\n`);
  writeOutput(licenseInventoryName, `${JSON.stringify(materials.inventory, null, 2)}\n`);
  const paths = [...sbomFileNames, licenseInventoryName, licenseTextsName].sort();
  writeOutput("SBOM-SHA256SUMS.txt", paths.map((name) => {
    const file = resolve(outputDir, name);
    return `${sha256File(file)}  ${relative(root, file).replaceAll("\\", "/")}`;
  }).join("\n") + "\n");
  const diagnosticDirectory = assertReportOutput(root, "reports/release-license-diagnostics");
  mkdirSync(diagnosticDirectory, { recursive: true });
  const diagnosticPath = assertReportOutput(root, resolve(diagnosticDirectory, `${basename(outputDir)}.json`));
  writeFileSync(diagnosticPath, `${JSON.stringify(materials.errors, null, 2)}\n`);
  if (materials.errors.length) throw new Error(`${materials.errors.length} components lack verified license material; see ${relative(root, diagnosticPath)}. Generated materials are incomplete and fail verification.`);
  console.log(`Generated four current-lock SBOMs and ${materials.inventory.components.length} third-party license entries in ${relative(root, outputDir)}.`);
} catch (error) {
  console.error(`Release SBOM generation failed: ${error.message}`);
  process.exitCode = 1;
}

function writeOutput(name, content) {
  writeFileSync(assertReportOutput(root, resolve(outputDir, name)), content);
}

function commandJson(command, args, cwd) {
  return JSON.parse(commandOutput(command, args, cwd));
}

function commandOutput(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: process.platform === "win32", stdio: ["ignore", "pipe", "inherit"], timeout: 15 * 60 * 1000 });
  if (result.status !== 0) throw new Error(`${command} ${args[0]} failed (${result.status ?? result.error?.code ?? "unknown"})`);
  return result.stdout;
}
