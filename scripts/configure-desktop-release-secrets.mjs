import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const scriptRoot = resolve(import.meta.dirname, "..");
const defaultTemplatePath = "reports/release/desktop/secret-input-template.env";
const {
  dryRun,
  repo: explicitRepo,
  root,
  skipVerify,
  templatePath,
  verifyOnly,
} = parseArgs(process.argv.slice(2));
const ghCommand = process.env.ATLASTERM_RELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GH_ARGS");
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const repo = explicitRepo ?? resolveRepoFromOrigin();
const secretDefinitions = [
  {
    description: "base64-encoded Windows .pfx certificate",
    fileEnv: "ATLASTERM_WINDOWS_CERTIFICATE_FILE",
    kind: "binary-certificate",
    name: "ATLASTERM_WINDOWS_CERTIFICATE",
  },
  {
    description: "Windows certificate password",
    fileEnv: "ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD_FILE",
    kind: "text",
    name: "ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD",
  },
  {
    description: "Windows certificate thumbprint",
    fileEnv: "ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT_FILE",
    kind: "text",
    name: "ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT",
  },
  {
    description: "Windows timestamp server URL",
    fileEnv: "ATLASTERM_WINDOWS_TIMESTAMP_URL_FILE",
    kind: "text",
    name: "ATLASTERM_WINDOWS_TIMESTAMP_URL",
  },
  {
    description: "base64-encoded macOS .p12 Developer ID Application certificate",
    fileEnv: "ATLASTERM_APPLE_CERTIFICATE_FILE",
    kind: "binary-certificate",
    name: "ATLASTERM_APPLE_CERTIFICATE",
  },
  {
    description: "macOS certificate password",
    fileEnv: "ATLASTERM_APPLE_CERTIFICATE_PASSWORD_FILE",
    kind: "text",
    name: "ATLASTERM_APPLE_CERTIFICATE_PASSWORD",
  },
  {
    description: "Apple ID",
    fileEnv: "ATLASTERM_APPLE_ID_FILE",
    kind: "text",
    name: "ATLASTERM_APPLE_ID",
  },
  {
    description: "Apple app-specific password",
    fileEnv: "ATLASTERM_APPLE_PASSWORD_FILE",
    kind: "text",
    name: "ATLASTERM_APPLE_PASSWORD",
  },
  {
    description: "Apple team ID",
    fileEnv: "ATLASTERM_APPLE_TEAM_ID_FILE",
    kind: "text",
    name: "ATLASTERM_APPLE_TEAM_ID",
  },
  {
    description: "temporary CI keychain password",
    fileEnv: "ATLASTERM_KEYCHAIN_PASSWORD_FILE",
    kind: "text",
    name: "ATLASTERM_KEYCHAIN_PASSWORD",
  },
];

console.log(`Configuring Desktop release GitHub Actions secrets for ${repo}.`);

if (templatePath) {
  writeSecretInputTemplate(templatePath);
  process.exit(0);
}

runGh(["--version"], "GitHub CLI is required to configure Desktop release secrets.");
runGh(["auth", "status"], "GitHub CLI must be authenticated to configure Desktop release secrets.");

if (!verifyOnly) {
  const secrets = collectSecretInputs();
  for (const secret of secrets) {
    if (dryRun) {
      console.log(`Would set ${secret.name} from ${secret.sourceLabel}.`);
      continue;
    }
    setGitHubSecret(secret);
    console.log(`Set ${secret.name} from ${secret.sourceLabel}.`);
  }
}

if (!skipVerify && !dryRun) {
  verifySecretNames();
}

if (dryRun) {
  console.log("Desktop release secret configuration dry run passed.");
} else if (verifyOnly) {
  console.log("Desktop release secret verification passed.");
} else {
  console.log("Desktop release secrets configured.");
}

function collectSecretInputs() {
  const secrets = [];
  const missing = [];
  const ambiguous = [];

  for (const definition of secretDefinitions) {
    const envValue = process.env[definition.name];
    const fileValue = process.env[definition.fileEnv];
    const hasEnvValue = envValue !== undefined && envValue !== "";
    const hasFileValue = fileValue !== undefined && fileValue !== "";

    if (hasEnvValue && hasFileValue) {
      ambiguous.push(`${definition.name} and ${definition.fileEnv}`);
      continue;
    }
    if (!hasEnvValue && !hasFileValue) {
      missing.push(`${definition.name} or ${definition.fileEnv}`);
      continue;
    }

    const secret = hasFileValue
      ? readSecretFromFile(definition, fileValue)
      : readSecretFromEnvironment(definition, envValue);
    secrets.push(secret);
  }

  if (ambiguous.length > 0) {
    fail(`Ambiguous Desktop release secret input(s); set only one source for:\n- ${ambiguous.join("\n- ")}`);
  }
  if (missing.length > 0) {
    fail(`Missing Desktop release secret input(s):\n- ${missing.join("\n- ")}`);
  }

  return secrets;
}

function readSecretFromFile(definition, filePath) {
  const path = resolve(filePath);
  if (!existsSync(path)) {
    fail(`${definition.fileEnv} points at a missing file.`);
  }

  if (definition.kind === "binary-certificate") {
    const value = readFileSync(path).toString("base64");
    validateBase64Certificate(definition.name, value);
    return {
      name: definition.name,
      sourceLabel: definition.fileEnv,
      value,
    };
  }

  const value = trimTrailingNewline(readFileSync(path, "utf8"));
  validateTextSecret(definition, value);
  return {
    name: definition.name,
    sourceLabel: definition.fileEnv,
    value,
  };
}

function readSecretFromEnvironment(definition, value) {
  if (definition.kind === "binary-certificate") {
    const normalizedValue = value.replace(/\s+/g, "");
    validateBase64Certificate(definition.name, normalizedValue);
    return {
      name: definition.name,
      sourceLabel: definition.name,
      value: normalizedValue,
    };
  }

  validateTextSecret(definition, value);
  return {
    name: definition.name,
    sourceLabel: definition.name,
    value,
  };
}

function validateBase64Certificate(name, value) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    fail(`${name} must be base64 text when provided directly. Use ${name}_FILE for a raw certificate file.`);
  }
  const decoded = Buffer.from(value, "base64");
  if (decoded.length === 0 || decoded.toString("base64").replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    fail(`${name} is not valid base64 certificate data.`);
  }
}

function validateTextSecret(definition, value) {
  if (value === "") {
    fail(`${definition.name} is empty; ${definition.description} is required.`);
  }
}

function setGitHubSecret(secret) {
  const result = spawnSync(ghCommand, [...ghCommandPrefixArgs, "secret", "set", secret.name, "--repo", repo, "--body-file", "-"], {
    cwd: root,
    encoding: "utf8",
    input: secret.value,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    fail(diagnostic ? `Failed to set GitHub Actions secret ${secret.name}.\n${diagnostic}` : `Failed to set GitHub Actions secret ${secret.name}.`);
  }
}

function writeSecretInputTemplate(path) {
  const outputPath = resolve(root, path);
  const lines = [
    "# JoeSSH Desktop formal release signing secret inputs.",
    "# Fill exactly one input source for each required GitHub Actions secret:",
    "# - either the direct secret variable, or",
    "# - the matching *_FILE variable pointing at a local file.",
    "# Leave unused alternatives commented out so the configurator can reject ambiguity.",
    "",
  ];

  for (const definition of secretDefinitions) {
    lines.push(`# ${definition.description}`);
    if (definition.kind === "binary-certificate") {
      lines.push(`${definition.fileEnv}=`);
      lines.push(`# ${definition.name}=`);
    } else {
      lines.push(`# ${definition.fileEnv}=`);
      lines.push(`${definition.name}=`);
    }
    lines.push("");
  }

  lines.push("# Example:");
  lines.push("# npm run release:desktop:configure-secrets -- --repo JoeWorkspace/JoeSSH");

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${lines.join("\n")}\n`);
  console.log(`Wrote Desktop release secret input template to ${outputPath}.`);
}

function verifySecretNames() {
  const result = spawnSync(
    process.execPath,
    [resolve(scriptRoot, "scripts", "desktop-release-evidence-preflight.mjs"), "--root", root, "--repo", repo],
    {
      cwd: root,
      encoding: "utf8",
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function resolveRepoFromOrigin() {
  const origin = runGit(["remote", "get-url", "origin"], "Unable to read Git origin URL.").stdout.trim();
  const match = origin.match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/i);
  if (!match?.groups) {
    fail(`Unable to infer GitHub repository from origin URL: ${origin}`);
  }
  return validateRepo(`${match.groups.owner}/${match.groups.repo}`);
}

function runGh(args, message) {
  return runCommand(ghCommand, [...ghCommandPrefixArgs, ...args], message);
}

function runGit(args, message) {
  return runCommand(gitCommand, [...gitCommandPrefixArgs, ...args], message);
}

function runCommand(command, args, message) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    fail(diagnostic ? `${message}\n${diagnostic}` : message);
  }
  return result;
}

function parseArgs(args) {
  let dryRun = false;
  let repo = null;
  let root = scriptRoot;
  let skipVerify = false;
  let templatePath = null;
  let verifyOnly = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--repo") {
      repo = validateRepo(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      repo = validateRepo(arg.slice("--repo=".length));
      continue;
    }
    if (arg === "--root") {
      root = resolve(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--root=")) {
      root = resolve(arg.slice("--root=".length));
      continue;
    }
    if (arg === "--skip-verify") {
      skipVerify = true;
      continue;
    }
    if (arg === "--write-template") {
      const value = args[index + 1];
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
    if (arg === "--verify-only") {
      verifyOnly = true;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (dryRun && verifyOnly) {
    fail("--dry-run and --verify-only cannot be used together.");
  }
  if (templatePath && (dryRun || skipVerify || verifyOnly)) {
    fail("--write-template cannot be combined with --dry-run, --skip-verify, or --verify-only.");
  }

  return { dryRun, repo, root, skipVerify, templatePath, verifyOnly };
}

function readValue(args, index, arg) {
  const value = args[index + 1];
  if (!value) {
    fail(`${arg} requires a value.`);
  }
  return value;
}

function validateRepo(value) {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    return value;
  }
  fail(`--repo must use owner/name format, received: ${value}`);
}

function parseCommandPrefixArgs(envName) {
  const raw = process.env[envName];
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw);
    if (Array.isArray(value) && value.every((entry) => typeof entry === "string")) {
      return value;
    }
  } catch {
    // Fall through to the explicit failure below.
  }

  fail(`${envName} must be a JSON string array when set.`);
}

function trimTrailingNewline(value) {
  return value.replace(/\r?\n$/, "");
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
