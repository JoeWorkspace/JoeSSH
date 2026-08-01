import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertWindowsLegalPublisher,
  validatePartnerCenterIdentity,
} from "./windows-store-contract.mjs";

const scriptRoot = resolve(import.meta.dirname, "..");
const localIdentityDirectory = "reports/handoff/windows-store";
const defaultTemplatePath = `${localIdentityDirectory}/partner-center-identity.input.json`;
const defaultOutputPath = `${localIdentityDirectory}/partner-center-identity.json`;
const maximumInputBytes = 64 * 1024;
const identityFields = Object.freeze([
  "schemaVersion",
  "source",
  "productId",
  "packageIdentityName",
  "publisher",
  "publisherDisplayName",
  "publisherId",
  "packageFamilyName",
  "reservedAt",
]);
const stringIdentityFields = identityFields.filter(
  (field) => field !== "schemaVersion",
);
const rejectedIndividualPublisherAliases = new Set([
  "joessh",
  "joessh community",
  "joessh project",
  "joeworkspace",
]);

export function runPartnerCenterIdentityWriter(
  argv,
  { log = console.log } = {},
) {
  const args = parseArgs(argv, scriptRoot);
  if (args.help) {
    printHelp(log);
    return;
  }
  if (args.templatePath) {
    writeTemplate(args.root, args.templatePath, log);
    return;
  }
  writeValidatedIdentity(args.root, args.input, args.output, log);
}

function parseArgs(argv, root) {
  let help = false;
  let input = "";
  let output = "";
  let templatePath = "";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--write-template") {
      const value = argv[index + 1];
      if (value && !value.startsWith("--")) {
        templatePath = value;
        index += 1;
      } else {
        templatePath = defaultTemplatePath;
      }
      continue;
    }
    if (arg.startsWith("--write-template=")) {
      templatePath = nonEmptyInlineValue(arg, "--write-template");
      continue;
    }
    if (arg === "--input") {
      input = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--input=")) {
      input = nonEmptyInlineValue(arg, "--input");
      continue;
    }
    if (arg === "--output") {
      output = readValue(argv, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      output = nonEmptyInlineValue(arg, "--output");
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (help) {
    if (argv.length !== 1) {
      throw new Error("--help cannot be combined with other options.");
    }
    return { help: true, input, output, root, templatePath };
  }
  if (templatePath) {
    if (input || output) {
      throw new Error(
        "--write-template cannot be combined with --input or --output.",
      );
    }
    return { help: false, input, output, root, templatePath };
  }
  if (!input) {
    throw new Error(
      "Use --write-template first, or provide the locally edited JSON with --input.",
    );
  }
  return {
    help: false,
    input,
    output: output || defaultOutputPath,
    root,
    templatePath,
  };
}

function writeTemplate(root, requestedPath, log) {
  const outputPath = resolveSafeOutputPath(root, requestedPath, "template");
  const template = {
    schemaVersion: 1,
    source: "partner-center",
    productId: "CHANGE-ME-EXACT-PRODUCT-ID",
    packageIdentityName: "CHANGE-ME-EXACT-PACKAGE-IDENTITY-NAME",
    publisher: "CN=CHANGE-ME-EXACT-PACKAGE-PUBLISHER",
    publisherDisplayName: "CHANGE-ME-EXACT-VERIFIED-PERSONAL-NAME",
    publisherId: "CHANGE-ME-13-CHAR-PUBLISHER-ID",
    packageFamilyName: "CHANGE-ME-EXACT-PACKAGE-FAMILY-NAME",
    reservedAt: "CHANGE-ME-NORMALIZED-UTC-RESERVATION-TIMESTAMP",
  };

  writeExclusiveJson(outputPath, template, "template");
  log(`Wrote local identity template to ${displayPath(root, outputPath)}.`);
  log(
    "For the confirmed Individual account, copy publisherDisplayName exactly from Partner Center after identity verification; use the separate CN= value for publisher.",
  );
  log(
    "Edit the file locally. Do not commit it, paste the personal name into chat, or add identity documents, tokens, or signing material.",
  );
}

function writeValidatedIdentity(root, requestedInput, requestedOutput, log) {
  const inputPath = resolve(root, requestedInput);
  const outputPath = resolveSafeOutputPath(root, requestedOutput, "output");
  if (inputPath === outputPath) {
    throw new Error("--input and --output must be different files.");
  }

  const identity = readStrictJson(inputPath);
  assertExactIdentityFields(identity);
  const normalized = validatePartnerCenterIdentity(identity);
  assertExactCopiedValues(identity, normalized);
  assertIndividualPublisherDisplayName(normalized.publisherDisplayName);

  const canonicalIdentity = Object.fromEntries(
    identityFields.map((field) => [field, normalized[field]]),
  );
  writeExclusiveJson(outputPath, canonicalIdentity, "validated identity");

  log(
    `Wrote validated Partner Center identity to ${displayPath(root, outputPath)}.`,
  );
  log(
    `Pass this file to --partner-identity and set ATLASTERM_WINDOWS_LEGAL_PUBLISHER to its exact publisherDisplayName; no identity value was printed.`,
  );
}

function assertExactIdentityFields(identity) {
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new Error("The input must be one JSON object.");
  }
  const actualFields = Object.keys(identity);
  const missing = identityFields.filter(
    (field) => !actualFields.includes(field),
  );
  const unexpected = actualFields.filter(
    (field) => !identityFields.includes(field),
  );
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [];
    if (missing.length > 0) details.push(`missing: ${missing.join(", ")}`);
    if (unexpected.length > 0) {
      details.push(`unexpected: ${unexpected.join(", ")}`);
    }
    throw new Error(
      `The input must contain only the Partner Center preflight fields (${details.join("; ")}). Never include tokens, identity documents, or signing material.`,
    );
  }
}

function assertExactCopiedValues(identity, normalized) {
  for (const field of stringIdentityFields) {
    if (identity[field] !== normalized[field]) {
      throw new Error(
        `Partner Center identity field ${field} must be copied exactly without surrounding whitespace or normalization changes.`,
      );
    }
  }
}

function assertIndividualPublisherDisplayName(publisherDisplayName) {
  assertWindowsLegalPublisher(publisherDisplayName);
  if (
    rejectedIndividualPublisherAliases.has(publisherDisplayName.toLowerCase())
  ) {
    throw new Error(
      "For an Individual account, publisherDisplayName must be the exact personal name shown after Partner Center identity verification, not JoeSSH, JoeSSH Project, JoeSSH Community, or a GitHub identity.",
    );
  }
}

function readStrictJson(path) {
  let bytes;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    throw new Error(
      `Unable to read the local input file at ${path}: ${error?.message ?? String(error)}`,
      { cause: error },
    );
  }
  if (bytes.length < 2 || bytes.length > maximumInputBytes) {
    throw new Error(
      `The input must be between 2 and ${maximumInputBytes} bytes, matching the hosted preflight boundary.`,
    );
  }

  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("The input must be valid UTF-8 JSON.");
  }
  try {
    return JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    throw new Error("The input must be valid UTF-8 JSON.");
  }
}

function resolveSafeOutputPath(root, requestedPath, label) {
  const outputPath = resolve(root, requestedPath);
  if (extname(outputPath).toLowerCase() !== ".json") {
    throw new Error(`The ${label} path must end in .json.`);
  }
  const localDirectory = resolve(root, localIdentityDirectory);
  const physicalRoot = resolvePhysicalPath(root);
  const physicalLocalDirectory = resolvePhysicalPath(localDirectory);
  const physicalOutputPath = resolvePhysicalPath(outputPath);
  const lexicallyInsideRepository = isWithin(root, outputPath);
  const insideRepository =
    lexicallyInsideRepository || isWithin(physicalRoot, physicalOutputPath);
  const insideLocalDirectory =
    isWithin(localDirectory, outputPath) &&
    isWithin(physicalRoot, physicalLocalDirectory) &&
    isWithin(physicalLocalDirectory, physicalOutputPath);
  if (insideRepository && !insideLocalDirectory) {
    throw new Error(
      `A ${label} inside the repository must stay below ${localIdentityDirectory}, which is gitignored. An absolute path outside the repository is also allowed.`,
    );
  }
  if (lexicallyInsideRepository) {
    assertNoLinkAncestors(root, outputPath, label);
  }
  if (!insideRepository && !isAbsolute(requestedPath)) {
    throw new Error(
      `A ${label} outside the repository must use an explicit absolute path.`,
    );
  }
  return outputPath;
}

function isWithin(parent, child) {
  const pathWithinParent = relative(parent, child);
  return (
    pathWithinParent === "" ||
    (pathWithinParent !== ".." &&
      !pathWithinParent.startsWith(`..${sep}`) &&
      !isAbsolute(pathWithinParent))
  );
}

function resolvePhysicalPath(path) {
  let existing = resolve(path);
  const missingSegments = [];
  while (!existsSync(existing)) {
    const parent = dirname(existing);
    if (parent === existing) break;
    missingSegments.unshift(basename(existing));
    existing = parent;
  }
  return resolve(realpathSync.native(existing), ...missingSegments);
}

function assertNoLinkAncestors(root, outputPath, label) {
  const parentPath = dirname(outputPath);
  const relativeParent = relative(root, parentPath);
  if (
    relativeParent === "" ||
    relativeParent === ".." ||
    relativeParent.startsWith(`..${sep}`) ||
    isAbsolute(relativeParent)
  ) {
    return;
  }
  let current = resolve(root);
  for (const segment of relativeParent.split(sep)) {
    current = resolve(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(
        `Refusing to write the ${label} through a symbolic link or junction inside the repository.`,
      );
    }
  }
}

function writeExclusiveJson(path, value, label) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(
        `Refusing to overwrite the existing ${label} at ${path}.`,
        { cause: error },
      );
    }
    throw new Error(
      `Unable to write the ${label} at ${path}: ${error?.message ?? String(error)}`,
      { cause: error },
    );
  }
}

function displayPath(root, path) {
  return isWithin(root, path) ? relative(root, path) : path;
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${option} requires a value.`);
  }
  return value;
}

function nonEmptyInlineValue(arg, option) {
  const value = arg.slice(option.length + 1);
  if (!value) throw new Error(`${option} requires a value.`);
  return value;
}

function printHelp(log) {
  log(`Create a local Partner Center identity file for the existing
Windows Store MSIX --partner-identity preflight.

First create a private local template, then edit it without posting the verified
personal name or any identity document to the repository or chat:

  node scripts/write-partner-center-identity.mjs --write-template [path]

Validate the edited input and write a canonical preflight file:

  node scripts/write-partner-center-identity.mjs --input <path> [--output <path>]

Defaults:
  template  ${defaultTemplatePath}
  output    ${defaultOutputPath}

For the confirmed noncommercial Individual account, publisherDisplayName is the
exact personal name shown after Partner Center verification. publisher is a
different package identity field beginning with CN=. Files written inside the
repository are restricted to the gitignored ${localIdentityDirectory} directory.
Existing files are never overwritten.`);
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) {
  try {
    runPartnerCenterIdentityWriter(process.argv.slice(2));
  } catch (error) {
    console.error(
      `Partner Center identity error: ${error?.message ?? String(error)}`,
    );
    process.exitCode = 1;
  }
}
