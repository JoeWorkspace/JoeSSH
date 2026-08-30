import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { WINDOWS_AUTHENTICODE_SETUP } from "./windows-powershell.mjs";

const scriptRoot = resolve(import.meta.dirname, "..");
const FORMAL_SIGNING_DISABLED = "FORMAL_SIGNING_DISABLED";
const {
  noFail,
  outputPath,
  ref,
  repo: explicitRepo,
  root,
  workflow,
} = parseArgs(process.argv.slice(2));
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_GIT_ARGS",
);
const ghCommand = process.env.ATLASTERM_RELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GH_ARGS");
const powershellCommand =
  process.env.ATLASTERM_RELEASE_POWERSHELL_COMMAND ?? "powershell";
const powershellCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_POWERSHELL_ARGS",
);
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const releaseRef = ref ?? `v${packageJson.version}`;
const repo = explicitRepo ?? resolveRepoFromOrigin();
const desktopReleaseDir = resolve(root, "reports", "release", "desktop");
const report = buildReport();
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(
  `Desktop formal evidence diagnostics wrote ${toReleasePath(outputPath)} (${report.decision}).`,
);
for (const blocker of report.blockers) {
  console.log(`- ${blocker.id}: ${blocker.detail.split(/\r?\n/)[0]}`);
}

if (report.blockers.length > 0 && !noFail) {
  process.exit(1);
}

function buildReport() {
  const git = inspectGit();
  const desktop = inspectDesktopReleaseFiles();
  const github = inspectGitHub(git.head);
  const blockers = [
    {
      id: "desktop-formal-signing-disabled",
      label: "Desktop formal signing boundary",
      detail:
        `${FORMAL_SIGNING_DISABLED}: repository-managed signing, credential inventory, and workflow dispatch are intentionally unavailable. ` +
        "A future formal release requires an approved externally managed isolated signer and independently verified evidence.",
    },
    ...git.blockers,
    ...desktop.blockers,
    ...github.blockers,
  ];

  return {
    generatedAt: new Date().toISOString(),
    repository: repo,
    version: packageJson.version,
    releaseRef,
    head: git.head,
    releaseTagCommit: git.releaseTagCommit,
    git: {
      remoteReleaseRef: git.remoteReleaseRef,
      upstream: git.upstream,
    },
    decision: blockers.length === 0 ? "go" : "no-go",
    blockers,
    formalSigning: {
      repositoryAutomation: FORMAL_SIGNING_DISABLED,
      requiredBoundary: "approved externally managed isolated signer",
    },
    localEvidence: desktop.localEvidence,
    github: github.summary,
    unblockSteps: buildUnblockSteps(blockers),
  };
}

function inspectGit() {
  const blockers = [];
  const headResult = runGit(["rev-parse", "HEAD"]);
  const head = headResult.status === 0 ? headResult.stdout.trim() : null;
  if (!head) {
    blockers.push({
      id: "release-git-head",
      label: "Release Git HEAD",
      detail: commandDiagnostic("Unable to resolve HEAD.", headResult),
    });
  }

  const tagResult = runGit(["rev-parse", "--verify", `${releaseRef}^{}`]);
  const releaseTagCommit =
    tagResult.status === 0 ? tagResult.stdout.trim() : null;
  if (!releaseTagCommit) {
    blockers.push({
      id: "release-tag",
      label: "Release tag",
      detail: commandDiagnostic(
        `Release tag ${releaseRef} must exist before Desktop formal evidence can be imported.`,
        tagResult,
      ),
    });
  } else if (head && releaseTagCommit !== head) {
    blockers.push({
      id: "release-tag",
      label: "Release tag",
      detail: `Release tag ${releaseRef} points at ${releaseTagCommit}, but HEAD is ${head}. Create a new candidate tag or retag only by explicit release decision before provenance/publish preflight.`,
    });
  }

  const fsckResult = runGit(["fsck", "--strict"]);
  if (fsckResult.status !== 0) {
    blockers.push({
      id: "release-git-fsck",
      label: "Release Git fsck",
      detail: commandDiagnostic("git fsck --strict must pass.", fsckResult),
    });
  }

  const remoteReleaseRef = inspectRemoteReleaseRef(head);
  blockers.push(...remoteReleaseRef.blockers);

  return {
    blockers,
    head,
    releaseTagCommit,
    remoteReleaseRef: remoteReleaseRef.summary,
    upstream: inspectUpstreamDivergence(),
  };
}

function inspectRemoteReleaseRef(head) {
  const candidates = remoteRefCandidates(releaseRef);
  const diagnostics = [];
  for (const candidate of candidates) {
    const result = runGit(["ls-remote", "--exit-code", "origin", candidate]);
    if (result.status === 0) {
      const commit = parseLsRemoteCommit(result.stdout);
      if (!commit) {
        diagnostics.push(`${candidate}: empty ls-remote output`);
        continue;
      }
      if (head && commit !== head) {
        return {
          blockers: [
            {
              id: "release-remote-ref",
              label: "Published release ref",
              detail: `Release ref ${releaseRef} resolves to ${commit} on origin, but HEAD is ${head}. Push the candidate commit and release ref before formal Desktop evidence can run in GitHub Actions.`,
            },
          ],
          summary: { candidates, commit, status: "mismatch" },
        };
      }
      return {
        blockers: [],
        summary: { candidates, commit, status: "published" },
      };
    }
    const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
    diagnostics.push(diagnostic ? `${candidate}: ${diagnostic}` : candidate);
  }

  return {
    blockers: [
      {
        id: "release-remote-ref",
        label: "Published release ref",
        detail: `Release ref ${releaseRef} was not found on origin. Push the candidate commit and release ref before formal Desktop evidence can run in GitHub Actions.`,
      },
    ],
    summary: { candidates, diagnostics, status: "missing" },
  };
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
  const upstreamResult = runGit([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{u}",
  ]);
  if (upstreamResult.status !== 0) {
    return { status: "unavailable" };
  }

  const upstream = upstreamResult.stdout.trim();
  const divergenceResult = runGit([
    "rev-list",
    "--left-right",
    "--count",
    `${upstream}...HEAD`,
  ]);
  if (divergenceResult.status !== 0) {
    return { name: upstream, status: "unknown" };
  }

  const [behind, ahead] = divergenceResult.stdout.trim().split(/\s+/);
  return {
    ahead: ahead ?? "unknown",
    behind: behind ?? "unknown",
    name: upstream,
    status: "ok",
  };
}

function inspectDesktopReleaseFiles() {
  const blockers = [];
  const manifestPath = resolve(desktopReleaseDir, "SHA256SUMS.txt");
  const evidencePath = resolve(desktopReleaseDir, "release-evidence.json");
  const evidenceSourcePath = resolve(
    desktopReleaseDir,
    "release-evidence-source.json",
  );
  const evidenceChecksumPath = resolve(
    desktopReleaseDir,
    "release-evidence-SHA256SUMS.txt",
  );
  const artifacts = collectFiles(desktopReleaseDir)
    .filter((path) => classifyArtifact(path) !== null)
    .map((path) => ({
      path: toReleasePath(path),
      platform: classifyArtifact(path).platform,
      packageType: classifyArtifact(path).packageType ?? null,
      sha256: sha256File(path),
      signature: inspectSignature(path),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const stagedPlatforms = [
    ...new Set(artifacts.map((artifact) => artifact.platform)),
  ].sort();
  const staleArtifacts = artifacts.filter(
    (artifact) =>
      !artifactFileName(artifact.path).includes(packageJson.version),
  );

  const manifestEntries = readChecksumManifestIfPresent(manifestPath);
  const evidenceChecksumEntries =
    readChecksumManifestIfPresent(evidenceChecksumPath);
  const missingFiles = [
    [
      manifestPath,
      "release-desktop",
      "Desktop signed release checksum manifest",
    ],
    [
      evidencePath,
      "release-desktop-evidence",
      "Desktop formal release evidence",
    ],
    [
      evidenceSourcePath,
      "release-desktop-evidence-source",
      "Desktop formal release evidence source sidecar",
    ],
    [
      evidenceChecksumPath,
      "release-desktop-evidence-checksum",
      "Desktop formal release evidence checksum manifest",
    ],
  ].filter(([path]) => !existsSync(path) || !statSync(path).isFile());

  for (const [path, id, label] of missingFiles) {
    blockers.push({
      id,
      label,
      detail: `${toReleasePath(path)} is missing.`,
    });
  }

  const missingPlatforms = ["windows", "macos", "linux"].filter(
    (platform) => !stagedPlatforms.includes(platform),
  );
  if (missingPlatforms.length > 0) {
    blockers.push({
      id: "release-desktop-platforms",
      label: "Desktop platform coverage",
      detail: `reports/release/desktop is missing required platform artifact(s): ${missingPlatforms.join(", ")}.`,
    });
  }
  if (staleArtifacts.length > 0) {
    blockers.push({
      id: "release-desktop-stale-artifacts",
      label: "Desktop stale release artifacts",
      detail: `reports/release/desktop contains artifact(s) that do not include ${packageJson.version}: ${staleArtifacts
        .map((artifact) => artifact.path)
        .join(", ")}.`,
    });
  }

  const missingSourceCoverage = existsSync(evidenceChecksumPath)
    ? !evidenceChecksumEntries.some(
        (entry) =>
          entry.path === "reports/release/desktop/release-evidence-source.json",
      )
    : false;
  if (missingSourceCoverage) {
    blockers.push({
      id: "release-desktop-evidence-source",
      label: "Desktop formal release evidence source sidecar",
      detail:
        "reports/release/desktop/release-evidence-SHA256SUMS.txt does not cover reports/release/desktop/release-evidence-source.json.",
    });
  }

  const verifierResult = spawnSync(
    process.execPath,
    [
      resolve(scriptRoot, "scripts", "verify-desktop-release-evidence.mjs"),
      "--root",
      root,
      "--require-source",
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (verifierResult.status !== 0) {
    blockers.push({
      id: "release-desktop-evidence-verify",
      label: "Desktop formal evidence verifier",
      detail: commandDiagnostic(
        "Desktop formal evidence verification with source provenance failed.",
        verifierResult,
      ),
    });
  }

  return {
    blockers,
    localEvidence: {
      desktopReleaseDir: toReleasePath(desktopReleaseDir),
      artifacts,
      staleArtifacts,
      manifests: {
        checksum: manifestSummary(manifestPath, manifestEntries),
        evidenceChecksum: manifestSummary(
          evidenceChecksumPath,
          evidenceChecksumEntries,
        ),
      },
      evidence: fileSummary(evidencePath),
      evidenceSource: fileSummary(evidenceSourcePath),
    },
  };
}

function inspectGitHub(head) {
  const blockers = [];
  const summary = {
    auth: "unknown",
    formalSigning: FORMAL_SIGNING_DISABLED,
    workflow: null,
    desktopWorkflowRuns: [],
    ci: null,
  };

  const version = runGh(["--version"]);
  if (version.status !== 0) {
    blockers.push({
      id: "github-cli",
      label: "GitHub CLI",
      detail: commandDiagnostic(
        "GitHub CLI is required for Desktop formal evidence diagnostics.",
        version,
      ),
    });
    summary.auth = "unavailable";
    return { blockers, summary };
  }

  const auth = runGh(["auth", "status"]);
  if (auth.status !== 0) {
    blockers.push({
      id: "github-auth",
      label: "GitHub CLI authentication",
      detail: commandDiagnostic("GitHub CLI must be authenticated.", auth),
    });
    summary.auth = "failed";
    return { blockers, summary };
  }
  summary.auth = "ok";

  const workflowResult = runGh(["workflow", "view", workflow, "--repo", repo]);
  if (workflowResult.status !== 0) {
    blockers.push({
      id: "desktop-formal-workflow",
      label: "Desktop release artifacts workflow visibility",
      detail: commandDiagnostic(
        `Unable to inspect the unsigned Desktop release artifacts workflow: ${workflow}.`,
        workflowResult,
      ),
    });
    summary.workflow = { available: false, workflow };
  } else {
    summary.workflow = { available: true, workflow };
  }

  const desktopRuns = listWorkflowRuns(workflow, 5);
  summary.desktopWorkflowRuns = desktopRuns.runs;
  if (desktopRuns.error) {
    blockers.push({
      id: "desktop-formal-workflow-runs",
      label: "Desktop release artifacts workflow runs",
      detail: desktopRuns.error,
    });
  } else if (
    head &&
    !desktopRuns.runs.some(
      (run) =>
        run.headSha === head &&
        run.status === "completed" &&
        run.conclusion === "success",
    )
  ) {
    blockers.push({
      id: "desktop-formal-workflow-run",
      label: "Desktop release artifacts workflow run for HEAD",
      detail:
        "No successful Desktop Release Artifacts workflow run was found for the current HEAD.",
    });
  }

  const ci = inspectLatestCiForHead(head);
  summary.ci = ci.summary;
  blockers.push(...ci.blockers);

  return { blockers, summary };
}

function listWorkflowRuns(workflowName, limit) {
  const result = runGh([
    "run",
    "list",
    "--repo",
    repo,
    "--workflow",
    workflowName,
    "--limit",
    String(limit),
    "--json",
    "databaseId,headSha,status,conclusion,url,createdAt,event,workflowName",
  ]);
  if (result.status !== 0) {
    return {
      error: commandDiagnostic(
        `Unable to list GitHub Actions runs for workflow ${workflowName}.`,
        result,
      ),
      runs: [],
    };
  }

  const runs = parseJsonOr([], result.stdout)
    .filter((run) => run && typeof run === "object")
    .map((run) => ({
      conclusion: run.conclusion ?? null,
      createdAt: run.createdAt ?? null,
      databaseId: run.databaseId ?? null,
      event: run.event ?? null,
      headSha: run.headSha ?? null,
      status: run.status ?? null,
      url: run.url ?? null,
      workflowName: run.workflowName ?? workflowName,
    }));
  return { error: null, runs };
}

function inspectLatestCiForHead(head) {
  if (!head) {
    return {
      blockers: [],
      summary: { status: "unknown", detail: "HEAD is unavailable." },
    };
  }

  const runs = listWorkflowRuns("CI", 10);
  if (runs.error) {
    return {
      blockers: [
        {
          id: "github-ci",
          label: "Latest GitHub CI for HEAD",
          detail: runs.error,
        },
      ],
      summary: { status: "unknown", detail: runs.error },
    };
  }

  const ciRun = runs.runs.find((run) => run.headSha === head);
  if (!ciRun) {
    return {
      blockers: [
        {
          id: "github-ci",
          label: "Latest GitHub CI for HEAD",
          detail: "No GitHub CI run was found for the current HEAD.",
        },
      ],
      summary: { status: "missing", latestRuns: runs.runs },
    };
  }

  if (ciRun.status === "completed" && ciRun.conclusion === "success") {
    return {
      blockers: [],
      summary: { status: "success", run: ciRun },
    };
  }

  const diagnostics = collectRunFailureDiagnostics(ciRun.databaseId);
  return {
    blockers: [
      {
        id: "github-ci",
        label: "Latest GitHub CI for HEAD",
        detail: [ciRun.url, ...diagnostics].filter(Boolean).join("\n"),
      },
    ],
    summary: {
      status: "failed",
      run: ciRun,
      diagnostics,
    },
  };
}

function collectRunFailureDiagnostics(runId) {
  if (!runId) {
    return [];
  }
  const result = runGh([
    "run",
    "view",
    String(runId),
    "--repo",
    repo,
    "--json",
    "jobs",
  ]);
  if (result.status !== 0) {
    return [];
  }
  const payload = parseJsonOr({}, result.stdout);
  const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
  const lines = [];
  for (const job of jobs) {
    if (!job || job.conclusion === "success" || job.conclusion === "skipped") {
      continue;
    }
    const jobName = job.name ?? "unknown job";
    lines.push(
      `${jobName}: ${job.status ?? "unknown"}/${job.conclusion ?? "unknown"}`,
    );
    if (job.databaseId) {
      for (const annotation of collectCheckRunAnnotations(job.databaseId)) {
        lines.push(`${jobName}: ${annotation}`);
      }
    }
  }
  return [...new Set(lines)];
}

function collectCheckRunAnnotations(checkRunId) {
  const result = runGh([
    "api",
    `repos/${repo}/check-runs/${checkRunId}/annotations`,
  ]);
  if (result.status !== 0) {
    return [];
  }
  const annotations = parseJsonOr([], result.stdout);
  if (!Array.isArray(annotations)) {
    return [];
  }

  return annotations
    .map((annotation) => {
      const path =
        typeof annotation?.path === "string" ? annotation.path.trim() : "";
      const message =
        typeof annotation?.message === "string"
          ? annotation.message.trim()
          : "";
      return [path, message].filter(Boolean).join(": ");
    })
    .filter(Boolean);
}

function buildUnblockSteps(blockers) {
  const ids = new Set(blockers.map((blocker) => blocker.id));
  const steps = [];
  if (ids.has("release-tag")) {
    steps.push(
      `Create a new candidate tag for the current HEAD, or explicitly move ${releaseRef} only after a release decision.`,
    );
  }
  if (ids.has("release-remote-ref")) {
    steps.push(
      `Push the candidate commit and ${releaseRef} release ref to origin before running GitHub Actions formal Desktop evidence.`,
    );
  }
  if (ids.has("github-ci")) {
    steps.push(
      "Resolve GitHub Actions billing/spending-limit or runner availability, then rerun CI for the candidate HEAD.",
    );
  }
  if (ids.has("desktop-formal-signing-disabled")) {
    steps.push(
      "Keep repository signing automation disabled. Establish a separately approved, externally managed isolated signer and an independently verified evidence handoff before any formal release.",
    );
  }
  if (
    ids.has("release-desktop-platforms") ||
    ids.has("desktop-formal-workflow-run") ||
    ids.has("release-desktop-evidence-verify")
  ) {
    steps.push(
      `After the approved external signer produces independently verified evidence for ${repo}, import the historical-compatible evidence bundle with npm run release:desktop:evidence-download -- --repo ${repo} --run-id <external-run-id>.`,
    );
  }
  steps.push(
    "After Desktop formal evidence imports, rerun release:provenance, release:provenance:verify, release:publish-preflight, and release:rc-audit:report.",
  );
  return [...new Set(steps)];
}

function readChecksumManifestIfPresent(path) {
  if (!existsSync(path) || !statSync(path).isFile()) {
    return [];
  }
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .flatMap((line) => {
      if (line.trim() === "" || line.trimStart().startsWith("#")) {
        return [];
      }
      const match = line.match(/^([a-fA-F0-9]{64})\s\s(.+)$/);
      if (!match) {
        return [];
      }
      return [
        {
          path: match[2].replaceAll("\\", "/"),
          sha256: match[1].toLowerCase(),
        },
      ];
    });
}

function manifestSummary(path, entries) {
  return {
    exists: existsSync(path) && statSync(path).isFile(),
    path: toReleasePath(path),
    entries,
  };
}

function fileSummary(path) {
  const exists = existsSync(path) && statSync(path).isFile();
  return {
    exists,
    path: toReleasePath(path),
    sha256: exists ? sha256File(path) : null,
  };
}

function inspectSignature(path) {
  if (classifyArtifact(path)?.platform !== "windows") {
    return null;
  }
  const command = [
    WINDOWS_AUTHENTICODE_SETUP,
    "$path = [Console]::In.ReadToEnd();",
    "$signature = Get-AuthenticodeSignature -LiteralPath $path;",
    "$signature | Select-Object Status,StatusMessage | ConvertTo-Json -Compress",
  ].join(" ");
  const result = spawnSync(
    powershellCommand,
    [...powershellCommandPrefixArgs, "-NoProfile", "-Command", command],
    {
      cwd: root,
      encoding: "utf8",
      input: path,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  if (result.status !== 0) {
    return {
      status: "unknown",
      detail: commandDiagnostic(
        "Unable to inspect Windows Authenticode signature.",
        result,
      ),
    };
  }
  const parsed = parseJsonOr(null, result.stdout);
  return {
    status: parsed?.Status ?? "unknown",
    statusMessage: parsed?.StatusMessage ?? "",
  };
}

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

  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function classifyArtifact(path) {
  const lower = path.toLowerCase();
  if (/\.(exe|msi|msix)$/.test(lower)) {
    return { platform: "windows" };
  }
  if (
    lower.endsWith(".dmg") ||
    lower.endsWith(".pkg") ||
    lower.endsWith(".app.tar.gz")
  ) {
    return { platform: "macos" };
  }
  if (lower.endsWith(".appimage")) {
    return { packageType: "AppImage", platform: "linux" };
  }
  if (lower.endsWith(".deb")) {
    return { packageType: "deb", platform: "linux" };
  }
  if (lower.endsWith(".rpm")) {
    return { packageType: "rpm", platform: "linux" };
  }
  return null;
}

function artifactFileName(path) {
  return path.split(/[\\/]/).pop() ?? path;
}

function resolveRepoFromOrigin() {
  const origin = runGit(["remote", "get-url", "origin"]);
  if (origin.status !== 0) {
    fail(commandDiagnostic("Unable to read Git origin URL.", origin));
  }
  const match = origin.stdout
    .trim()
    .match(/github\.com[:/](?<owner>[^/\s]+)\/(?<repo>[^/\s]+?)(?:\.git)?$/i);
  if (!match?.groups) {
    fail(
      `Unable to infer GitHub repository from origin URL: ${origin.stdout.trim()}`,
    );
  }
  return validateRepo(`${match.groups.owner}/${match.groups.repo}`);
}

function runGit(args) {
  return runCommand(gitCommand, [...gitCommandPrefixArgs, ...args]);
}

function runGh(args) {
  return runCommand(ghCommand, [...ghCommandPrefixArgs, ...args]);
}

function runCommand(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function commandDiagnostic(message, result) {
  const diagnostic = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  return diagnostic ? `${message}\n${diagnostic}` : message;
}

function parseJsonOr(fallback, raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function toReleasePath(path) {
  const resolved = isAbsolute(path) ? path : resolve(root, path);
  return relative(root, resolved).replace(/\\/g, "/") || basename(resolved);
}

function parseArgs(args) {
  let noFail = false;
  let outputPath = null;
  let ref = null;
  let repo = null;
  let root = scriptRoot;
  let workflow = "desktop-release-artifacts.yml";

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--no-fail") {
      noFail = true;
      continue;
    }
    if (arg === "--output") {
      outputPath = readValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--output=")) {
      outputPath = arg.slice("--output=".length);
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

  return {
    noFail,
    outputPath: resolve(
      root,
      outputPath ??
        "reports/handoff/desktop/formal-evidence-unblock-report.json",
    ),
    ref,
    repo,
    root,
    workflow,
  };
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
