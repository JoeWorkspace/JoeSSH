import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const defaultOutputPath = resolve(root, "reports", "release", "SHA256SUMS.txt");
const { inputs, outputPath } = parseArgs(process.argv.slice(2));
const outputDir = resolve(outputPath, "..");

if (inputs.length === 0) {
  fail("Usage: node scripts/generate-artifact-checksums.mjs [--output <path>] <file-or-directory> [...]");
}

const files = inputs.flatMap((input) => collectFiles(resolve(root, input)));
if (files.length === 0) {
  fail("No release artifact files found for checksum generation.");
}

const lines = files
  .sort((left, right) => left.localeCompare(right))
  .map((file) => `${sha256(file)}  ${relative(root, file).replace(/\\/g, "/")}`);

mkdirSync(outputDir, { recursive: true });
writeFileSync(outputPath, `${lines.join("\n")}\n`);
console.log(`Wrote ${files.length} SHA256 checksum(s) to ${relative(root, outputPath).replace(/\\/g, "/")}`);

function collectFiles(path) {
  if (!existsSync(path)) {
    return [];
  }

  const stat = statSync(path);
  if (stat.isFile()) {
    return [path];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  return readdirSync(path)
    .filter((name) => !name.startsWith(".") && name !== "node_modules" && name !== "target")
    .flatMap((name) => collectFiles(join(path, name)));
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

function parseArgs(args) {
  const inputs = [];
  let outputPath = defaultOutputPath;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--output") {
      const value = args[index + 1];
      if (!value) {
        fail("--output requires a path.");
      }
      outputPath = resolve(root, value);
      index += 1;
      continue;
    }

    if (arg.startsWith("--output=")) {
      outputPath = resolve(root, arg.slice("--output=".length));
      continue;
    }

    inputs.push(arg);
  }

  return { inputs, outputPath };
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
