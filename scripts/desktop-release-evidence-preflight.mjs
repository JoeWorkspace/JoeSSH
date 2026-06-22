import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";

const scriptRoot = resolve(import.meta.dirname, "..");
const {
  dispatch,
  dryRun,
  ref,
  repo: explicitRepo,
  retentionDays,
  root,
  workflow,
} = parseArgs(process.argv.slice(2));
const ghCommand = process.env.ATLASTERM_RELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GH_ARGS");
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GIT_ARGS");
const packageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const releaseRef = ref ?? `v${packageJson.version}`;
const repo = explicitRepo ?? resolveRepoFromOrigin();
const requiredSecretGroups = [
  {
    label: "Windows signing",
    names: [
      "ATLASTERM_WINDOWS_CERTIFICATE",
      "ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD",
      "ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT",
      "ATLASTERM_WINDOWS_TIMESTAMP_URL",
    ],
  },
  {
    label: "macOS signing/notarization",
    names: [
      "ATLASTERM_APPLE_CERTIFICATE",
      "ATLASTERM_APPLE_CERTIFICATE_PASSWORD",
      "ATLASTERM_APPLE_ID",
      "ATLASTERM_APPLE_PASSWORD",
      "ATLASTERM_APPLE_TEAM_ID",
      "ATLASTERM_KEYCHAIN_PASSWORD",
    ],
  },
];

console.log(`Checking Desktop formal evidence prerequisites for ${repo} at ${releaseRef}.`);

const releaseGitState = assertReleaseRefReadyForWorkflow();
console.log(
  `Verified release ref ${releaseRef} resolves to current HEAD ${shortSha(
    releaseGitState.head,
  )} and origin ${shortSha(releaseGitState.remoteCommit)}.`,
);
if (releaseGitState.upstream) {
  console.log(
    `Current branch upstream ${releaseGitState.upstream.name}: ahead ${releaseGitState.upstream.ahead}, behind ${releaseGitState.upstream.behind}.`,
  );
}

runGh(["--version"], "GitHub CLI is required to check Desktop release evidence prerequisites.");
runGh(["auth", "status"], "GitHub CLI must be authenticated to check Desktop release evidence prerequisites.");

const availableSecrets = listGitHubActionsSecrets();
const missingGroups = requiredSecretGroups
  .map((group) => ({
    ...group,
    missing: group.names.filter((name) => !availableSecrets.has(name)),
  }))
  .filter((group) => group.missing.length > 0);

if (missingGroups.length > 0) {
  const details = missingGroups
    .map((group) => `- ${group.label}: ${group.missing.join(", ")}`)
    .join("\n");
  fail(
    `Missing GitHub Actions secret(s) required for formal Desktop evidence:\n${details}\nSet these repository secrets before running the Desktop Release Artifacts workflow with formal_evidence=true.`,
  );
}

const requiredSecretCount = requiredSecretGroups.reduce((count, group) => count + group.names.length, 0);
console.log(`Verified ${requiredSecretCount} required GitHub Actions secret name(s).`);

runGh(
  ["workflow", "view", workflow, "--repo", repo],
  `GitHub Actions workflow is required before generating Desktop formal evidence: ${workflow}`,
);
console.log(`Verified GitHub Actions workflow ${workflow}.`);

const workflowRunArgs = [
  "workflow",
  "run",
  workflow,
  "--repo",
  repo,
  "--ref",
  releaseRef,
  "-f",
  "formal_evidence=true",
  "-f",
  `retention_days=${retentionDays}`,
];

if (dryRun) {
  console.log(`Desktop formal evidence workflow dry run passed for ${repo} at ${releaseRef}.`);
  console.log(`gh ${workflowRunArgs.map(shellQuote).join(" ")}`);
  process.exit(0);
}

if (dispatch) {
  const result = runGh(
    workflowRunArgs,
    `Failed to dispatch Desktop formal evidence workflow ${workflow} for ${repo} at ${releaseRef}.`,
  );
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  console.log(`Dispatched Desktop formal evidence workflow ${workflow} for ${repo} at ${releaseRef}.`);
  process.exit(0);
}

console.log("Desktop formal evidence preflight passed. Re-run with --dispatch to start the workflow.");

function listGitHubActionsSecrets() {
  const result = runGh(
    ["api", `repos/${repo}/actions/secrets`, "--jq", ".secrets[].name"],
    `Unable to list GitHub Actions secret names for ${repo}.`,
  );

  return new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean),
  );
}

function assertReleaseRefReadyForWorkflow() {
  const head = runGit(
    ["rev-parse", "HEAD"],
    "Unable to resolve current Git HEAD before Desktop formal evidence preflight.",
  ).stdout.trim();
  const refCommit = runGit(
    ["rev-parse", "--verify", `${releaseRef}^{}`],
    `Release ref ${releaseRef} must resolve locally before Desktop formal evidence can be dispatched.`,
  ).stdout.trim();
  if (refCommit !== head) {
    fail(
      `Release ref ${releaseRef} points at ${refCommit}, but current HEAD is ${head}. Create a new candidate tag for the current checkout before dispatching Desktop formal evidence.`,
    );
  }

  const remoteCommit = resolveRemoteRefCommit(releaseRef);
  if (remoteCommit !== head) {
    fail(
      `Release ref ${releaseRef} resolves to ${remoteCommit} on origin, but current HEAD is ${head}. Push the candidate commit and release ref before dispatching Desktop formal evidence.`,
    );
  }

  return {
    head,
    refCommit,
    remoteCommit,
    upstream: inspectUpstreamDivergence(),
  };
}

function resolveRemoteRefCommit(value) {
  const candidates = remoteRefCandidates(value);
  const diagnostics = [];
  for (const candidate of candidates) {
    const result = runGitAllowFailure(["ls-remote", "--exit-code", "origin", candidate]);
    if (result.status === 0) {
      const commit = parseLsRemoteCommit(result.stdout);
      if (commit) {
        return commit;
      }
    }
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    diagnostics.push(diagnostic ? `${candidate}: ${diagnostic}` : candidate);
  }

  fail(
    `Release ref ${value} must be published to origin before Desktop formal evidence can be dispatched.\nChecked:\n- ${candidates.join(
      "\n- ",
    )}${diagnostics.length > 0 ? `\nDiagnostics:\n- ${diagnostics.join("\n- ")}` : ""}`,
  );
}

function remoteRefCandidates(value) {
  const candidates = [];
  if (value.startsWith("v")) {
    candidates.push(`refs/tags/${value}^{}`, `refs/tags/${value}`);
  }
  if (value !== "HEAD") {
    candidates.push(`refs/heads/${value}`);
  }
  candidates.push(value);
  return [...new Set(candidates)];
}

function parseLsRemoteCommit(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .find(Boolean);
  return line?.split(/\s+/)[0] ?? null;
}

function inspectUpstreamDivergence() {
  const upstreamResult = runGitAllowFailure([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (upstreamResult.status !== 0) {
    return null;
  }

  const upstream = upstreamResult.stdout.trim();
  const divergenceResult = runGitAllowFailure([
    "rev-list",
    "--left-right",
    "--count",
    `${upstream}...HEAD`,
  ]);
  if (divergenceResult.status !== 0) {
    return { ahead: "unknown", behind: "unknown", name: upstream };
  }

  const [behind, ahead] = divergenceResult.stdout.trim().split(/\s+/);
  return {
    ahead: ahead ?? "unknown",
    behind: behind ?? "unknown",
    name: upstream,
  };
}

function resolveRepoFromOrigin() {
  const origin = runGit(["remote", "get-url", "origin"], "Unable to read Git origin URL.").stdout.trim();
  const match = origin.match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/i);
  if (!match?.groups) {
    fail(`Unable to infer GitHub repository from origin URL: ${origin}`);
  }
  return validateRepo(`${match.groups.owner}/${match.groups.repo}`);
}

function validateRepo(value) {
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    return value;
  }
  fail(`--repo must use owner/name format, received: ${value}`);
}

function runGh(args, message) {
  return runCommand(ghCommand, [...ghCommandPrefixArgs, ...args], message);
}

function runGit(args, message) {
  return runCommand(gitCommand, [...gitCommandPrefixArgs, ...args], message);
}

function runGitAllowFailure(args) {
  return spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
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
  let dispatch = false;
  let dryRun = false;
  let ref = null;
  let repo = null;
  let retentionDays = "14";
  let root = scriptRoot;
  let workflow = "desktop-release-artifacts.yml";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dispatch") {
      dispatch = true;
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--ref") {
      ref = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--ref=")) {
      ref = arg.slice("--ref=".length);
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
    if (arg === "--retention-days") {
      retentionDays = validateRetentionDays(readValue(args, index, arg));
      index += 1;
      continue;
    }
    if (arg.startsWith("--retention-days=")) {
      retentionDays = validateRetentionDays(arg.slice("--retention-days=".length));
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
    if (arg === "--workflow") {
      workflow = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--workflow=")) {
      workflow = arg.slice("--workflow=".length);
      continue;
    }

    fail(`Unknown argument: ${arg}`);
  }

  if (dryRun && !dispatch) {
    fail("--dry-run is only meaningful with --dispatch.");
  }

  return { dispatch, dryRun, ref, repo, retentionDays, root, workflow };
}

function readValue(args, index, arg) {
  const value = args[index + 1];
  if (!value) {
    fail(`${arg} requires a value.`);
  }
  return value;
}

function validateRetentionDays(value) {
  if (/^[1-9][0-9]{0,2}$/.test(value)) {
    return value;
  }
  fail(`--retention-days must be a positive integer string, received: ${value}`);
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

function shellQuote(value) {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value);
}

function shortSha(value) {
  return value.slice(0, 12);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
