import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { basename, resolve } from "node:path";
import { verifyCanonicalReleaseCandidate } from "./release-candidate-github-contract.mjs";

const scriptRoot = resolve(import.meta.dirname, "..");
const { root } = parseArgs(process.argv.slice(2));
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_GIT_ARGS",
);
const ghCommand = process.env.ATLASTERM_RELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GH_ARGS");
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const releaseTag = `v${packageJson.version}`;
const releaseRepository = "JoeWorkspace/JoeSSH";
const githubRepositoryApiRoot = `repos/${releaseRepository}`;
const steps = [
  {
    label: "Verify release Git checkout",
    run: verifyReleaseGitCheckout,
  },
  {
    label: "Verify GitHub CLI publish readiness",
    run: verifyGithubPublishReadiness,
  },
  {
    label: "Verify GitHub release controls",
    args: [
      resolve(scriptRoot, "scripts", "check-github-release-controls.mjs"),
      "--repo",
      releaseRepository,
    ],
    env: {
      ...process.env,
      JOESSH_GITHUB_RELEASE_CONTROLS_GH_ARGS:
        JSON.stringify(ghCommandPrefixArgs),
      JOESSH_GITHUB_RELEASE_CONTROLS_GH_COMMAND: ghCommand,
    },
  },
  {
    label: "Verify release artifact checksums",
    args: [
      resolve(scriptRoot, "scripts", "verify-artifact-checksums.mjs"),
      "--root",
      root,
      "--all-release",
    ],
  },
  {
    label: "Verify Web Admin release package",
    args: [
      resolve(scriptRoot, "scripts", "verify-web-release-package.mjs"),
      "--root",
      root,
    ],
  },
  {
    label: "Verify Sync release evidence",
    args: [
      resolve(scriptRoot, "scripts", "verify-sync-release-evidence.mjs"),
      "--root",
      root,
    ],
  },
  {
    label: "Verify Desktop signing/distribution evidence",
    args: [
      resolve(scriptRoot, "scripts", "verify-desktop-release-evidence.mjs"),
      "--root",
      root,
      "--require-source",
    ],
  },
  {
    label: "Verify release SBOM",
    args: [
      resolve(scriptRoot, "scripts", "verify-release-sbom.mjs"),
      "--root",
      root,
    ],
  },
  {
    label: "Verify third-party license bundle",
    args: [
      resolve(scriptRoot, "scripts", "verify-third-party-licenses.mjs"),
      "--root",
      root,
    ],
  },
  {
    label: "Verify release provenance",
    args: [
      resolve(scriptRoot, "scripts", "verify-release-provenance.mjs"),
      "--root",
      root,
    ],
  },
  {
    label: "Verify GitHub Release draft dry run",
    args: [
      resolve(scriptRoot, "scripts", "create-github-release-draft.mjs"),
      "--root",
      root,
      "--dry-run",
    ],
  },
];

console.log(`Running public release publish preflight in ${root}`);

for (const step of steps) {
  console.log(`\n> ${step.label}`);
  const result = step.run
    ? step.run()
    : spawnSync(process.execPath, step.args, {
        cwd: root,
        encoding: "utf8",
        env: step.env ?? process.env,
        stdio: ["ignore", "pipe", "pipe"],
      });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }
  if (result.status !== 0) {
    console.error(`Public release publish preflight failed: ${step.label}`);
    process.exit(result.status ?? 1);
  }
}

console.log("\nPublic release publish preflight passed.");

function verifyReleaseGitCheckout() {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"]);
  if (insideWorkTree.status !== 0) {
    return gitFailure(
      "Git checkout metadata is required for publish preflight.",
      insideWorkTree,
    );
  }
  if (insideWorkTree.stdout.trim() !== "true") {
    return gitFailure(
      "Git checkout metadata is required for publish preflight.",
      insideWorkTree,
    );
  }

  const status = runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "--",
    ".",
    ":(exclude)reports/release",
  ]);
  if (status.status !== 0) {
    return gitFailure(
      "Git working tree status is required for publish preflight.",
      status,
    );
  }
  if (status.stdout.trim() !== "") {
    return {
      status: 1,
      stdout: "",
      stderr: `Git working tree outside reports/release must be clean for publish preflight:\n${status.stdout}`,
    };
  }

  const head = runGit(["rev-parse", "HEAD"]);
  if (head.status !== 0) {
    return gitFailure("Unable to resolve HEAD for publish preflight.", head);
  }

  const tagCommit = runGit(["rev-parse", "--verify", `${releaseTag}^{}`]);
  if (tagCommit.status !== 0) {
    return gitFailure(
      `Release tag ${releaseTag} must exist for publish preflight.`,
      tagCommit,
    );
  }

  if (head.stdout.trim() !== tagCommit.stdout.trim()) {
    return {
      status: 1,
      stdout: "",
      stderr: `Release tag ${releaseTag} must point at HEAD for publish preflight.\n`,
    };
  }

  return {
    status: 0,
    stdout: `Verified clean Git checkout at ${releaseTag}.\n`,
    stderr: "",
  };
}

function verifyGithubPublishReadiness() {
  const version = runGh(["--version"]);
  if (version.status !== 0) {
    return commandFailure(
      "GitHub CLI is required for publish preflight.",
      version,
    );
  }

  const auth = runGh(["auth", "status"]);
  if (auth.status !== 0) {
    return commandFailure(
      "GitHub CLI must be authenticated for publish preflight.",
      auth,
    );
  }

  const head = runGit(["rev-parse", "HEAD"]);
  if (head.status !== 0) {
    return gitFailure(
      "Unable to resolve HEAD for remote release tag verification.",
      head,
    );
  }
  const remoteTag = resolveRemoteReleaseTagCommit();
  if (!remoteTag.ok) {
    return {
      status: 1,
      stdout: "",
      stderr: `${remoteTag.detail}\n`,
    };
  }
  if (remoteTag.commit !== head.stdout.trim()) {
    return {
      status: 1,
      stdout: "",
      stderr: `Remote release tag ${releaseTag} points at ${remoteTag.commit}; expected reviewed commit ${head.stdout.trim()}.\n`,
    };
  }

  let candidate;
  try {
    candidate = verifyCanonicalReleaseCandidate({
      candidateCommit: head.stdout.trim(),
      readGithubJson: readRequiredGithubApiJson,
      repository: releaseRepository,
    });
  } catch (error) {
    return {
      status: 1,
      stdout: "",
      stderr: `${error instanceof Error ? error.message : String(error)}\n`,
    };
  }

  const release = runGh([
    "release",
    "view",
    releaseTag,
    "--repo",
    releaseRepository,
    "--json",
    "url",
  ]);
  if (release.status === 0) {
    return {
      status: 1,
      stdout: "",
      stderr: `GitHub Release ${releaseTag} already exists; refusing to publish a duplicate release.\n`,
    };
  }

  const diagnostic = `${release.stdout}\n${release.stderr}`.trim();
  if (!/not found|not_found|could not find|HTTP 404/i.test(diagnostic)) {
    return {
      status: 1,
      stdout: "",
      stderr: `Unable to confirm GitHub Release ${releaseTag} does not already exist for publish preflight.${diagnostic ? `\n${diagnostic}\n` : "\n"}`,
    };
  }

  return {
    status: 0,
    stdout: `Verified GitHub CLI authentication, remote ${releaseTag} at ${remoteTag.commit}, protected ${candidate.branch}, successful Public Release Readiness check, and no existing release in ${releaseRepository}.\n`,
    stderr: "",
  };
}

function readRequiredGithubApiJson(endpoint, label) {
  const result = readGithubApiJson(endpoint, label);
  if (!result.ok) {
    throw new Error(result.detail);
  }
  return result.value;
}

function resolveRemoteReleaseTagCommit() {
  const ref = readGithubApiJson(
    `${githubRepositoryApiRoot}/git/ref/tags/${encodeURIComponent(releaseTag)}`,
    `remote release tag ${releaseTag}`,
  );
  if (!ref.ok) {
    return ref;
  }

  let object = readRemoteGitObject(
    ref.value,
    `remote release tag ${releaseTag}`,
  );
  if (!object.ok) {
    return object;
  }
  const visited = new Set();
  for (let depth = 0; depth < 8; depth += 1) {
    if (object.type === "commit") {
      return { commit: object.sha, detail: "", ok: true };
    }
    if (object.type !== "tag" || visited.has(object.sha)) {
      break;
    }
    visited.add(object.sha);
    const annotatedTag = readGithubApiJson(
      `${githubRepositoryApiRoot}/git/tags/${encodeURIComponent(object.sha)}`,
      `annotated Git tag object ${object.sha}`,
    );
    if (!annotatedTag.ok) {
      return annotatedTag;
    }
    object = readRemoteGitObject(
      annotatedTag.value,
      `annotated Git tag object ${object.sha}`,
    );
    if (!object.ok) {
      return object;
    }
  }
  return {
    detail: `Remote release tag ${releaseTag} does not resolve to one unambiguous commit.`,
    ok: false,
  };
}

function readGithubApiJson(endpoint, label) {
  const result = runGh(["api", "--method", "GET", endpoint]);
  if (result.status !== 0) {
    return {
      detail: `Unable to query ${label}: ${commandDiagnostic(result)}`,
      ok: false,
    };
  }
  try {
    return { detail: "", ok: true, value: JSON.parse(result.stdout) };
  } catch {
    return {
      detail: `Unable to parse ${label} API response as JSON.`,
      ok: false,
    };
  }
}

function readRemoteGitObject(payload, label) {
  const object =
    typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? payload.object
      : null;
  if (
    typeof object !== "object" ||
    object === null ||
    Array.isArray(object) ||
    !["commit", "tag"].includes(object.type) ||
    typeof object.sha !== "string" ||
    !/^[0-9a-f]+$/u.test(object.sha)
  ) {
    return {
      detail: `${label} returned an invalid Git object.`,
      ok: false,
    };
  }
  return { detail: "", ok: true, sha: object.sha, type: object.type };
}

function runGit(args) {
  return spawnSync(gitCommand, [...gitCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function runGh(args) {
  return spawnSync(ghCommand, [...ghCommandPrefixArgs, ...args], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function gitFailure(message, result) {
  return commandFailure(message, result);
}

function commandFailure(message, result) {
  const diagnostic = commandDiagnostic(result);
  return {
    status: 1,
    stdout: "",
    stderr: diagnostic ? `${message}\n${diagnostic}\n` : `${message}\n`,
  };
}

function commandDiagnostic(result) {
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (diagnostic !== "") {
    return diagnostic;
  }
  if (result.error instanceof Error) {
    return result.error.message;
  }
  return `command exited with status ${String(result.status)}`;
}

function parseArgs(args) {
  let root = scriptRoot;

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

  return { root };
}

function parseCommandPrefixArgs(envName) {
  const raw = process.env[envName];
  if (!raw) {
    return [];
  }

  try {
    const value = JSON.parse(raw);
    if (
      Array.isArray(value) &&
      value.every((entry) => typeof entry === "string")
    ) {
      return value;
    }
  } catch {
    // Fall through to the explicit failure below.
  }

  fail(`${envName} must be a JSON string array when set.`);
}

function fail(message) {
  console.error(`${basename(import.meta.url)}: ${message}`);
  process.exit(1);
}
