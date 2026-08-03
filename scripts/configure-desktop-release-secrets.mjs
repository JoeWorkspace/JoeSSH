import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, extname, relative, resolve, sep } from "node:path";

const FORMAL_SIGNING_DISABLED = "FORMAL_SIGNING_DISABLED";
const scriptRoot = resolve(import.meta.dirname, "..");
const defaultTemplatePath =
  "reports/handoff/desktop/external-signer-input-template.env";
const args = parseArgs(process.argv.slice(2));

if (args.help) {
  printHelp();
  process.exit(0);
}

if (!args.templatePath) {
  failClosed(
    "Repository-managed Desktop signing configuration, verification, and GitHub workflow dispatch are unavailable.",
  );
}

writeOfflineTemplate(args.root, args.templatePath);

function parseArgs(argv) {
  let help = false;
  let root = scriptRoot;
  let templatePath = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--root") {
      root = resolve(readValue(argv, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
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
      templatePath = arg.slice("--write-template=".length);
      continue;
    }

    failClosed(
      `Legacy or unsupported option ${JSON.stringify(arg)} is disabled.`,
    );
  }

  if (help && (templatePath || argv.length > 1)) {
    failClosed("--help cannot be combined with template or legacy options.");
  }

  return { help, root, templatePath };
}

function writeOfflineTemplate(root, templatePath) {
  const handoffDirectory = resolve(root, "reports", "handoff", "desktop");
  const outputPath = resolve(root, templatePath);
  const pathWithinHandoff = relative(handoffDirectory, outputPath);
  if (
    pathWithinHandoff === "" ||
    pathWithinHandoff === ".." ||
    pathWithinHandoff.startsWith(`..${sep}`) ||
    resolve(handoffDirectory, pathWithinHandoff) !== outputPath ||
    extname(outputPath) !== ".env"
  ) {
    failClosed(
      "The offline template must be a .env file below reports/handoff/desktop.",
    );
  }

  const template = [
    "# JoeSSH external Desktop signer handoff template.",
    "# OFFLINE, LOCAL, GITIGNORED, AND NON-SECRET ONLY.",
    "# Never source this file into a shell.",
    "# Never import, upload, copy, or pass this file to GitHub.",
    "# Never place certificates, passwords, tokens, private keys, or signing identities here.",
    "# A future approved externally managed isolated signer owns all credentials.",
    "",
    `FORMAL_SIGNING_STATUS=${FORMAL_SIGNING_DISABLED}`,
    "UNSIGNED_ARTIFACT_MANIFEST=",
    "UNSIGNED_ARTIFACT_SHA256=",
    "ISOLATED_SIGNER_APPROVAL_REFERENCE=",
    "EXTERNAL_SIGNER_EVIDENCE_PATH=",
    "",
  ].join("\n");

  try {
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, template, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if (error?.code === "EEXIST") {
      failClosed(
        `Refusing to overwrite the existing offline template at ${outputPath}.`,
      );
    }
    failClosed(
      `Unable to create the offline external-signer template: ${error?.message ?? String(error)}`,
    );
  }

  console.log(`Wrote non-secret offline handoff template to ${outputPath}.`);
  console.log(
    "Keep it local and gitignored; never import or upload it to GitHub.",
  );
}

function readValue(argv, index, option) {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    failClosed(`${option} requires a value.`);
  }
  return value;
}

function printHelp() {
  console.log(`Desktop formal signing automation is disabled.

The only supported action is creating a local, gitignored, non-secret handoff
template for a future approved externally managed isolated signer:

  node scripts/configure-desktop-release-secrets.mjs --write-template [path]

The path defaults to ${defaultTemplatePath}. Never import or upload the template
to GitHub. Repository environments, repository secrets, signing verification,
and workflow dispatch are intentionally unavailable.`);
}

function failClosed(message) {
  console.error(`${FORMAL_SIGNING_DISABLED}: ${message}`);
  console.error(
    "Use only a future approved externally managed isolated signer; do not place signing material in this repository or any GitHub environment.",
  );
  process.exit(1);
}
