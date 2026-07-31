import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  readSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { verifyCanonicalReleaseCandidate } from "./release-candidate-github-contract.mjs";

const scriptRoot = resolve(import.meta.dirname, "..");
const { dryRun, notesFile, root } = parseArgs(process.argv.slice(2));
const gitCommand = process.env.ATLASTERM_RELEASE_GIT_COMMAND ?? "git";
const gitCommandPrefixArgs = parseCommandPrefixArgs(
  "ATLASTERM_RELEASE_GIT_ARGS",
);
const ghCommand = process.env.ATLASTERM_RELEASE_GH_COMMAND ?? "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs("ATLASTERM_RELEASE_GH_ARGS");
const releaseRepository = "JoeWorkspace/JoeSSH";
const githubRepositoryApiRoot = `repos/${releaseRepository}`;
const packageJson = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
);
const tag = `v${packageJson.version}`;
const releaseTitle = `JoeSSH ${packageJson.version}`;
const releaseNotesPath = resolve(
  root,
  notesFile ?? `docs/release-notes/${packageJson.version}.md`,
);
const requiredChecksumManifests = [
  "reports/release/SBOM-SHA256SUMS.txt",
  "reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt",
  "reports/release/desktop/SHA256SUMS.txt",
  "reports/release/desktop/release-evidence-SHA256SUMS.txt",
  "reports/release/release-provenance-SHA256SUMS.txt",
  "reports/release/web/SHA256SUMS.txt",
  "reports/release/sync/SHA256SUMS.txt",
  "reports/release/sync/backup-restore-smoke-SHA256SUMS.txt",
];
const artifacts = collectReleaseArtifacts();
const checksumManifests = [
  ...new Set([...requiredChecksumManifests, ...collectChecksumManifests()]),
];
const localOnlyReleaseFiles = [
  "reports/release/desktop/formal-evidence-unblock-report.json",
  "reports/release/desktop/secret-input-template.env",
];

const releaseCommit = dryRun ? null : assertReleaseMachineReady();

validateReleaseNotes();

if (artifacts.length === 0) {
  console.error(
    "No release artifacts found. Build desktop/web/sync artifacts and checksums before drafting a release.",
  );
  process.exit(1);
}

const localOnlyArtifacts = artifacts.filter((artifact) =>
  localOnlyReleaseFiles.includes(artifact),
);
if (localOnlyArtifacts.length > 0) {
  console.error(
    `Local-only handoff file(s) must not be uploaded from reports/release:\n- ${localOnlyArtifacts.join(
      "\n- ",
    )}\nMove diagnostics and signing-secret templates under reports/handoff before drafting a release.`,
  );
  process.exit(1);
}

const missingChecksumManifests = requiredChecksumManifests.filter(
  (manifest) => !existsSync(resolve(root, manifest)),
);
if (missingChecksumManifests.length > 0) {
  console.error(
    `Missing required SHA256 checksum manifest(s):\n- ${missingChecksumManifests.join("\n- ")}\nGenerate Desktop, Web Admin, Sync, SBOM, third-party-license, evidence, and provenance checksums before drafting a release.`,
  );
  process.exit(1);
}

const expectedWebArtifact = `reports/release/web/joessh-web-admin-${packageJson.version}.zip`;
const webManifestArtifacts = readChecksumManifestArtifactPaths(
  resolve(root, "reports", "release", "web", "SHA256SUMS.txt"),
);
if (!webManifestArtifacts.includes(expectedWebArtifact)) {
  console.error(
    `Missing Web Admin release package in reports/release/web/SHA256SUMS.txt: ${expectedWebArtifact}\nRun npm run release:web before drafting a release.`,
  );
  process.exit(1);
}

assertReleaseArtifactsChecksumCovered();
assertReleaseArtifactAllowlist();
let sourceArtifactEvidence;
let releaseNotesEvidence;
try {
  sourceArtifactEvidence = captureSourceArtifactEvidence();
  releaseNotesEvidence = captureRegularFileEvidence(
    releaseNotesPath,
    "release notes",
    toReleasePath(releaseNotesPath),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const desktopEvidenceVerification = spawnSync(
  process.execPath,
  [
    resolve(scriptRoot, "scripts", "verify-desktop-release-evidence.mjs"),
    "--root",
    root,
    "--require-source",
  ],
  {
    cwd: scriptRoot,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (desktopEvidenceVerification.status !== 0) {
  process.exit(desktopEvidenceVerification.status ?? 1);
}

const checksumVerification = spawnSync(
  process.execPath,
  [
    resolve(scriptRoot, "scripts", "verify-artifact-checksums.mjs"),
    "--root",
    root,
    ...checksumManifests,
  ],
  {
    cwd: scriptRoot,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (checksumVerification.status !== 0) {
  process.exit(checksumVerification.status ?? 1);
}

assertReleaseArtifactsChecksumCovered();
assertNoLocalPathLeaks();

const sbomVerification = spawnSync(
  process.execPath,
  [resolve(scriptRoot, "scripts", "verify-release-sbom.mjs"), "--root", root],
  {
    cwd: scriptRoot,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (sbomVerification.status !== 0) {
  process.exit(sbomVerification.status ?? 1);
}

const licenseVerification = spawnSync(
  process.execPath,
  [
    resolve(scriptRoot, "scripts", "verify-third-party-licenses.mjs"),
    "--root",
    root,
  ],
  {
    cwd: scriptRoot,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (licenseVerification.status !== 0) {
  process.exit(licenseVerification.status ?? 1);
}

const provenanceVerificationArgs = [
  resolve(scriptRoot, "scripts", "verify-release-provenance.mjs"),
  "--root",
  root,
];
if (dryRun) {
  provenanceVerificationArgs.push("--skip-current-git-check");
}
const provenanceVerification = spawnSync(
  process.execPath,
  provenanceVerificationArgs,
  {
    cwd: scriptRoot,
    encoding: "utf8",
    stdio: "inherit",
  },
);
if (provenanceVerification.status !== 0) {
  process.exit(provenanceVerification.status ?? 1);
}

let privateSnapshot = null;
let exitStatus;
try {
  privateSnapshot = createPrivateReleaseSnapshot(
    sourceArtifactEvidence,
    releaseNotesEvidence,
  );
  assertSourceEvidenceUnchanged(sourceArtifactEvidence, releaseNotesEvidence);
  assertPrivateSnapshotUnchanged(privateSnapshot);
  const releaseArgs = [
    "release",
    "create",
    tag,
    "--repo",
    releaseRepository,
    "--draft",
    "--verify-tag",
    "--title",
    releaseTitle,
    "--notes-file",
    privateSnapshot.releaseNotes.absolutePath,
    ...privateSnapshot.artifacts.map(({ absolutePath }) => absolutePath),
  ];
  if (dryRun) {
    console.log(
      `Release draft dry run passed for ${tag} with ${artifacts.length} artifact(s).`,
    );
    console.log(
      `Snapshot upload allowlist:\n- ${privateSnapshot.artifacts
        .map(({ logicalPath, uploadName }) => `${uploadName} <- ${logicalPath}`)
        .join("\n- ")}`,
    );
    console.log(`gh ${releaseArgs.map(shellQuote).join(" ")}`);
    console.log(
      "Private snapshot paths above are intentionally removed after this dry run.",
    );
    exitStatus = 0;
  } else {
    assertSourceEvidenceUnchanged(sourceArtifactEvidence, releaseNotesEvidence);
    assertPrivateSnapshotUnchanged(privateSnapshot);
    assertRemoteReleaseTagMatchesCommit(releaseCommit);
    assertCanonicalGithubReleaseCandidate(releaseCommit);
    const result = spawnSync(
      ghCommand,
      [...ghCommandPrefixArgs, ...releaseArgs],
      {
        cwd: root,
        encoding: "utf8",
        stdio: "inherit",
      },
    );
    if (result.status === 0) {
      verifyNewGithubDraft(privateSnapshot, releaseCommit);
      exitStatus = 0;
    } else {
      reconcileFailedGithubDraftCreation();
      if (result.error) {
        console.error(
          `${basename(import.meta.url)}: GitHub draft creation failed: ${result.error.message}`,
        );
      }
      exitStatus = result.status ?? 1;
    }
  }
} catch (error) {
  console.error(
    `${basename(import.meta.url)}: ${
      error instanceof Error ? error.message : String(error)
    }`,
  );
  exitStatus = 1;
} finally {
  if (privateSnapshot !== null) {
    try {
      removePrivateSnapshot(privateSnapshot.root);
    } catch (error) {
      console.error(
        `${basename(import.meta.url)}: Unable to remove the private release snapshot: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      exitStatus = 1;
    }
  }
}

process.exit(exitStatus);

function collectReleaseArtifacts() {
  return collectFiles(resolve(root, "reports", "release"))
    .filter((file) => !file.endsWith(".map"))
    .map((file) => toReleasePath(file))
    .sort((left, right) => left.localeCompare(right));
}

function collectChecksumManifests() {
  return collectFiles(resolve(root, "reports", "release"))
    .filter((file) => file.endsWith("SHA256SUMS.txt"))
    .map((file) => toReleasePath(file))
    .sort((left, right) => left.localeCompare(right));
}

function readChecksumManifestArtifactPaths(path) {
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) =>
      line.match(/^[a-fA-F0-9]{64}\s\s(.+)$/)?.[1]?.replaceAll("\\", "/"),
    )
    .filter((artifactPath) => typeof artifactPath === "string");
}

function assertReleaseArtifactsChecksumCovered() {
  const coveredArtifacts = new Set(
    checksumManifests.flatMap((manifest) =>
      readChecksumManifestArtifactPaths(resolve(root, manifest)),
    ),
  );
  const missingCoverage = artifacts.filter(
    (artifact) =>
      !artifact.endsWith("SHA256SUMS.txt") && !coveredArtifacts.has(artifact),
  );

  if (missingCoverage.length === 0) {
    return;
  }

  fail(
    `Release artifacts missing SHA256 coverage:\n- ${missingCoverage.join(
      "\n- ",
    )}\nEvery uploaded file under reports/release must be listed in a SHA256SUMS.txt manifest before drafting a release.`,
  );
}

function assertReleaseArtifactAllowlist() {
  const exactPaths = new Set([
    ...requiredChecksumManifests,
    "reports/release/cargo-workspace-sbom.cdx.json",
    "reports/release/npm-desktop-sbom.cdx.json",
    "reports/release/npm-web-sbom.cdx.json",
    "reports/release/tauri-cargo-sbom.cdx.json",
    "reports/release/third-party-licenses/manifest.json",
    "reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt",
    "reports/release/release-provenance.json",
    "reports/release/release-provenance-SHA256SUMS.txt",
    "reports/release/desktop/release-evidence.json",
    "reports/release/desktop/release-evidence-source.json",
    "reports/release/sync/backup-restore-smoke.json",
  ]);
  const escapedVersion = packageJson.version.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
  const allowedPatterns = [
    new RegExp(
      `^reports/release/desktop/[^/]*${escapedVersion}[^/]*\\.(?:exe|msi|msix|dmg|pkg|AppImage|deb|rpm)$`,
      "i",
    ),
    new RegExp(
      `^reports/release/desktop/[^/]*${escapedVersion}[^/]*\\.app\\.tar\\.gz$`,
      "i",
    ),
    new RegExp(
      `^reports/release/sync/joessh-sync-${escapedVersion}-(?:aix|darwin|freebsd|linux|openbsd|sunos|win32)-[A-Za-z0-9_-]+(?:\\.exe)?$`,
      "i",
    ),
    new RegExp(
      `^reports/release/web/joessh-web-admin-${escapedVersion}\\.zip$`,
    ),
  ];
  const unexpected = artifacts.filter(
    (artifact) =>
      !exactPaths.has(artifact) &&
      !allowedPatterns.some((pattern) => pattern.test(artifact)),
  );
  if (unexpected.length > 0) {
    fail(
      `Release artifact(s) are outside the exact public upload allowlist:\n- ${unexpected.join(
        "\n- ",
      )}`,
    );
  }
}

function assertNoLocalPathLeaks() {
  const localPathPattern =
    /(?:^|[^A-Za-z0-9])(?:[A-Za-z]:[\\/](?![\\/])|\/(?:Users|home)\/|path\+file:\/\/|file:\/\/)/i;
  const leaked = artifacts.filter((artifact) => {
    if (!/\.(?:json|txt)$/i.test(artifact)) {
      return false;
    }
    return localPathPattern.test(readFileSync(resolve(root, artifact), "utf8"));
  });
  if (leaked.length > 0) {
    fail(
      `Public JSON/TXT artifact(s) contain local absolute path identifiers:\n- ${leaked.join(
        "\n- ",
      )}`,
    );
  }
}

function captureSourceArtifactEvidence() {
  assertSourceArtifactSetUnchanged();
  return artifacts.map((artifact) =>
    captureRegularFileEvidence(
      resolve(root, ...artifact.split("/")),
      `release artifact ${artifact}`,
      artifact,
    ),
  );
}

function captureRegularFileEvidence(absolutePath, label, logicalPath) {
  let link;
  let before;
  try {
    link = lstatSync(absolutePath);
    before = statSync(absolutePath);
  } catch {
    throw new Error(`${label} is missing: ${logicalPath}.`);
  }
  if (
    link.isSymbolicLink() ||
    !link.isFile() ||
    link.nlink !== 1 ||
    before.nlink !== 1
  ) {
    throw new Error(`${label} must be a direct regular file: ${logicalPath}.`);
  }
  const sha256 = sha256File(absolutePath);
  const after = statSync(absolutePath);
  if (!sameFileState(before, after)) {
    throw new Error(
      `${label} changed while it was being hashed: ${logicalPath}.`,
    );
  }
  return {
    absolutePath,
    label,
    logicalPath,
    sha256,
    sizeBytes: after.size,
    state: after,
  };
}

function assertSourceEvidenceUnchanged(artifactEvidence, notesEvidence) {
  assertSourceArtifactSetUnchanged();
  for (const evidence of [...artifactEvidence, notesEvidence]) {
    assertRegularFileEvidenceUnchanged(
      evidence,
      "changed after release verification",
    );
  }
}

function assertSourceArtifactSetUnchanged() {
  const releaseRoot = resolve(root, "reports", "release");
  const current = collectStrictRegularFiles(releaseRoot)
    .filter((file) => !file.endsWith(".map"))
    .map((file) => relative(root, file).replace(/\\/g, "/"))
    .sort((left, right) => left.localeCompare(right));
  if (current.join("\0") !== artifacts.join("\0")) {
    throw new Error(
      "The reports/release artifact set changed after exact allowlist review.",
    );
  }
}

function createPrivateReleaseSnapshot(artifactEvidence, notesEvidence) {
  const snapshotRoot = mkdtempSync(
    join(tmpdir(), "joessh-release-draft-snapshot-"),
  );
  try {
    chmodSync(snapshotRoot, 0o700);
    const artifactRoot = resolve(snapshotRoot, "artifacts");
    mkdirSync(artifactRoot, { mode: 0o700 });
    const uploadNames = createUniqueUploadNames(artifactEvidence);
    const snapshotArtifacts = artifactEvidence.map((source, index) => {
      assertRegularFileEvidenceUnchanged(
        source,
        "changed before private snapshot capture",
      );
      const uploadName = uploadNames[index];
      const destination = resolve(artifactRoot, uploadName);
      assertInside(artifactRoot, destination, "private artifact snapshot");
      copyFileSync(source.absolutePath, destination, constants.COPYFILE_EXCL);
      chmodSync(destination, 0o400);
      assertRegularFileEvidenceUnchanged(
        source,
        "changed during private snapshot capture",
      );
      const captured = captureRegularFileEvidence(
        destination,
        `private snapshot of ${source.logicalPath}`,
        source.logicalPath,
      );
      assertSnapshotMatchesSource(source, captured);
      return { ...captured, uploadName };
    });

    assertRegularFileEvidenceUnchanged(
      notesEvidence,
      "changed before private snapshot capture",
    );
    const snapshotNotesPath = resolve(snapshotRoot, "release-notes.md");
    copyFileSync(
      notesEvidence.absolutePath,
      snapshotNotesPath,
      constants.COPYFILE_EXCL,
    );
    chmodSync(snapshotNotesPath, 0o400);
    assertRegularFileEvidenceUnchanged(
      notesEvidence,
      "changed during private snapshot capture",
    );
    const snapshotNotes = captureRegularFileEvidence(
      snapshotNotesPath,
      "private release-notes snapshot",
      "release-notes.md",
    );
    assertSnapshotMatchesSource(notesEvidence, snapshotNotes);

    const snapshot = {
      artifacts: snapshotArtifacts,
      artifactRoot,
      releaseNotes: snapshotNotes,
      root: snapshotRoot,
    };
    assertPrivateSnapshotExactAllowlist(snapshot);
    freezeSnapshotDirectories(snapshotRoot);
    assertPrivateSnapshotUnchanged(snapshot);
    return snapshot;
  } catch (error) {
    let cleanupError = null;
    try {
      removePrivateSnapshot(snapshotRoot);
    } catch (candidateCleanupError) {
      cleanupError = candidateCleanupError;
    }
    if (cleanupError !== null) {
      throw new Error(
        `${
          error instanceof Error ? error.message : String(error)
        } Private snapshot cleanup also failed: ${
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        }`,
        { cause: error },
      );
    }
    throw error;
  }
}

function createUniqueUploadNames(artifactEvidence) {
  const basenameCounts = new Map();
  for (const { logicalPath } of artifactEvidence) {
    const key = basename(logicalPath).toLocaleLowerCase("en-US");
    basenameCounts.set(key, (basenameCounts.get(key) ?? 0) + 1);
  }

  const uploadNames = artifactEvidence.map(({ logicalPath }) => {
    const leafName = basename(logicalPath);
    const hasCollision =
      (basenameCounts.get(leafName.toLocaleLowerCase("en-US")) ?? 0) > 1;
    const relativeReleasePath = logicalPath.startsWith("reports/release/")
      ? logicalPath.slice("reports/release/".length)
      : logicalPath;
    const uploadName = hasCollision
      ? relativeReleasePath.replaceAll("/", "-")
      : leafName;
    const hasControlCharacter = [...uploadName].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
      );
    });

    if (
      uploadName === "" ||
      uploadName === "." ||
      uploadName === ".." ||
      uploadName.includes("/") ||
      uploadName.includes("\\") ||
      uploadName.includes("#") ||
      hasControlCharacter ||
      Buffer.byteLength(uploadName, "utf8") > 255
    ) {
      throw new Error(
        `Release artifact cannot be mapped to a safe GitHub asset name: ${logicalPath}.`,
      );
    }
    return uploadName;
  });

  const seen = new Map();
  for (let index = 0; index < uploadNames.length; index += 1) {
    const uploadName = uploadNames[index];
    const key = uploadName.toLocaleLowerCase("en-US");
    const previous = seen.get(key);
    if (previous !== undefined) {
      throw new Error(
        `Release artifacts map to the same GitHub asset name ${uploadName}: ${previous} and ${artifactEvidence[index].logicalPath}.`,
      );
    }
    seen.set(key, artifactEvidence[index].logicalPath);
  }
  return uploadNames;
}

function assertSnapshotMatchesSource(source, snapshot) {
  if (
    snapshot.sha256 !== source.sha256 ||
    snapshot.sizeBytes !== source.sizeBytes
  ) {
    throw new Error(
      `Private snapshot hash/size mismatch for ${source.logicalPath}.`,
    );
  }
}

function assertPrivateSnapshotUnchanged(snapshot) {
  assertPrivateSnapshotExactAllowlist(snapshot);
  for (const evidence of [...snapshot.artifacts, snapshot.releaseNotes]) {
    assertRegularFileEvidenceUnchanged(
      evidence,
      "changed after private snapshot capture",
    );
  }
}

function assertPrivateSnapshotExactAllowlist(snapshot) {
  const actual = collectStrictRegularFiles(snapshot.root)
    .map((file) => relative(snapshot.root, file).replace(/\\/g, "/"))
    .sort((left, right) => left.localeCompare(right));
  const expected = [
    ...snapshot.artifacts.map(({ uploadName }) => `artifacts/${uploadName}`),
    "release-notes.md",
  ].sort((left, right) => left.localeCompare(right));
  if (actual.join("\0") !== expected.join("\0")) {
    throw new Error(
      "Private release snapshot does not exactly match the reviewed upload allowlist.",
    );
  }
}

function verifyNewGithubDraft(snapshot, expectedCommit) {
  let createdDraft = null;
  try {
    createdDraft = requireCreatedGithubDraftByTag();
    assertRemoteReleaseTagMatchesCommit(expectedCommit);
    assertCanonicalGithubReleaseCandidate(expectedCommit);
    assertRemoteDraftAssets(createdDraft, snapshot);

    const releaseById = lookupGithubRelease(
      `${githubRepositoryApiRoot}/releases/${createdDraft.id}`,
      `newly created GitHub draft release ID ${createdDraft.id}`,
    );
    if (releaseById === null) {
      throw new Error(
        `The newly created GitHub draft disappeared before release ID ${createdDraft.id} could be verified.`,
      );
    }
    assertCreatedDraftIdentity(releaseById, createdDraft.id);
    assertRemoteDraftAssets(releaseById, snapshot);

    assertPrivateSnapshotUnchanged(snapshot);
    console.log(
      `Verified GitHub draft ${tag} as release ID ${createdDraft.id} with ${snapshot.artifacts.length} exact SHA-256 asset match(es).`,
    );
  } catch (error) {
    const verificationMessage =
      error instanceof Error ? error.message : String(error);
    if (createdDraft === null) {
      throw new Error(
        `${verificationMessage}\n${manualIsolationInstructions(
          null,
          "The script could not establish the numeric identity of the draft returned after creation.",
        )}`,
        { cause: error },
      );
    }

    try {
      deleteCreatedGithubDraftAndConfirm(createdDraft);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `${verificationMessage}\nUnable to safely remove the rejected GitHub draft: ${
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        }\n${manualIsolationInstructions(
          createdDraft,
          "Automatic deletion or its HTTP 404 confirmation was unsuccessful.",
        )}`,
        { cause: cleanupError },
      );
    }

    throw new Error(
      `${verificationMessage}\nRejected GitHub draft ${tag} (release ID ${createdDraft.id}) was deleted by exact ID and its absence was confirmed by both ID and tag.`,
      { cause: error },
    );
  }
}

function reconcileFailedGithubDraftCreation() {
  let candidate;
  try {
    candidate = lookupGithubRelease(
      githubReleaseByTagEndpoint(),
      `GitHub release ${tag} after the failed creation command`,
    );
  } catch (error) {
    throw new Error(
      `${
        error instanceof Error ? error.message : String(error)
      }\n${manualIsolationInstructions(
        null,
        "The creation command failed and the API lookup could not prove whether a partial draft exists.",
      )}`,
      { cause: error },
    );
  }

  if (candidate === null) {
    return;
  }

  throw new Error(
    `The GitHub creation command failed but tag ${tag} now resolves to a release. The script cannot prove that this release belongs to the failed process, so it will not delete it automatically.\n${manualIsolationInstructions(
      isGithubReleaseObject(candidate) ? candidate : null,
      "A possibly partial draft exists after a failed creation command.",
    )}`,
  );
}

function requireCreatedGithubDraftByTag() {
  const release = lookupGithubRelease(
    githubReleaseByTagEndpoint(),
    `newly created GitHub draft ${tag}`,
  );
  if (release === null) {
    throw new Error(
      `GitHub API did not return the newly created draft for tag ${tag}.`,
    );
  }
  assertCreatedDraftIdentity(release);
  return release;
}

function assertCreatedDraftIdentity(release, expectedId = null) {
  if (!isGithubReleaseObject(release)) {
    throw new Error("GitHub API returned a non-object release payload.");
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) {
    throw new Error(
      "GitHub API did not return a positive numeric release ID for the newly created draft.",
    );
  }
  if (expectedId !== null && release.id !== expectedId) {
    throw new Error(
      `GitHub API release identity changed from ID ${expectedId} to ${release.id}.`,
    );
  }
  if (release.tag_name !== tag) {
    throw new Error(
      `GitHub API returned tag ${JSON.stringify(release.tag_name)} instead of ${tag}.`,
    );
  }
  if (release.name !== releaseTitle) {
    throw new Error(
      `GitHub API returned release title ${JSON.stringify(release.name)} instead of ${releaseTitle}.`,
    );
  }
  if (release.draft !== true) {
    throw new Error(
      `GitHub release ID ${release.id} is not an unpublished draft.`,
    );
  }
  if (!Array.isArray(release.assets)) {
    throw new Error(
      `GitHub release ID ${release.id} did not return an asset array.`,
    );
  }
  if (
    typeof release.html_url !== "string" ||
    !/^https:\/\/github\.com\//u.test(release.html_url)
  ) {
    throw new Error(
      `GitHub release ID ${release.id} did not return a canonical GitHub URL.`,
    );
  }
}

function assertRemoteDraftAssets(release, snapshot) {
  const expectedAssets = snapshot.artifacts.map(
    ({ uploadName, sizeBytes, sha256 }) => ({
      digest: `sha256:${sha256}`,
      name: uploadName,
      size: sizeBytes,
    }),
  );
  const expectedByName = new Map(
    expectedAssets.map((asset) => [asset.name, asset]),
  );
  const actualByName = new Map();
  const issues = [];

  if (release.assets.length !== expectedAssets.length) {
    issues.push(
      `asset count is ${release.assets.length}; expected ${expectedAssets.length}`,
    );
  }

  for (const asset of release.assets) {
    if (
      !isGithubReleaseObject(asset) ||
      typeof asset.name !== "string" ||
      asset.name === ""
    ) {
      issues.push("an asset is missing a valid name");
      continue;
    }
    if (actualByName.has(asset.name)) {
      issues.push(`asset name ${asset.name} appears more than once`);
      continue;
    }
    actualByName.set(asset.name, asset);
  }

  for (const expected of expectedAssets) {
    const actual = actualByName.get(expected.name);
    if (actual === undefined) {
      issues.push(`missing asset ${expected.name}`);
      continue;
    }
    if (!Number.isSafeInteger(actual.id) || actual.id <= 0) {
      issues.push(`asset ${expected.name} is missing a positive numeric ID`);
    }
    if (actual.state !== "uploaded") {
      issues.push(
        `asset ${expected.name} state is ${JSON.stringify(actual.state)}; expected "uploaded"`,
      );
    }
    if (actual.size !== expected.size) {
      issues.push(
        `asset ${expected.name} size is ${JSON.stringify(actual.size)}; expected ${expected.size}`,
      );
    }
    if (
      typeof actual.digest !== "string" ||
      !/^sha256:[a-f0-9]{64}$/u.test(actual.digest)
    ) {
      issues.push(
        `asset ${expected.name} digest is ${JSON.stringify(actual.digest)}; an exact sha256:<lowercase-hex> digest is required`,
      );
    } else if (actual.digest !== expected.digest) {
      issues.push(
        `asset ${expected.name} digest is ${actual.digest}; expected ${expected.digest}`,
      );
    }
  }

  for (const actualName of actualByName.keys()) {
    if (!expectedByName.has(actualName)) {
      issues.push(`unexpected asset ${actualName}`);
    }
  }

  if (issues.length > 0) {
    throw new Error(
      `Remote GitHub draft asset verification failed for release ID ${release.id}:\n- ${issues.join(
        "\n- ",
      )}`,
    );
  }
}

function deleteCreatedGithubDraftAndConfirm(release) {
  const endpoint = `${githubRepositoryApiRoot}/releases/${release.id}`;
  const deletion = runGhApi(["--method", "DELETE", endpoint]);
  if (deletion.status !== 0 && !isNotFoundResponse(deletion)) {
    throw new Error(
      `DELETE of release ID ${release.id} failed: ${commandDiagnostic(deletion)}`,
    );
  }

  const releaseById = lookupGithubRelease(
    endpoint,
    `deleted GitHub release ID ${release.id}`,
  );
  if (releaseById !== null) {
    throw new Error(
      `release ID ${release.id} still exists after the DELETE request`,
    );
  }
  const releaseByTag = lookupGithubRelease(
    githubReleaseByTagEndpoint(),
    `deleted GitHub release tag ${tag}`,
  );
  if (releaseByTag !== null) {
    throw new Error(
      `tag ${tag} still resolves to a release after deleting ID ${release.id}`,
    );
  }
}

function lookupGithubRelease(endpoint, label) {
  const result = runGhApi(["--method", "GET", endpoint]);
  if (result.status !== 0) {
    if (isNotFoundResponse(result)) {
      return null;
    }
    throw new Error(`Unable to query ${label}: ${commandDiagnostic(result)}`);
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `Unable to parse ${label} API response as JSON: ${JSON.stringify(
        result.stdout,
      )}`,
    );
  }
}

function runGhApi(args) {
  return spawnSync(ghCommand, [...ghCommandPrefixArgs, "api", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
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

function isNotFoundResponse(result) {
  return (
    result.status !== 0 &&
    /(?:HTTP\s*404|\b404\b[^\r\n]*not[\s_-]*found|not[\s_-]*found[^\r\n]*\b404\b)/iu.test(
      `${result.stdout ?? ""}\n${result.stderr ?? ""}`,
    )
  );
}

function githubReleaseByTagEndpoint() {
  return `${githubRepositoryApiRoot}/releases/tags/${encodeURIComponent(tag)}`;
}

function assertRemoteReleaseTagMatchesCommit(expectedCommit) {
  const actualCommit = resolveRemoteReleaseTagCommit();
  if (actualCommit !== expectedCommit) {
    throw new Error(
      `Remote release tag ${tag} points at ${actualCommit}; expected reviewed commit ${expectedCommit}.`,
    );
  }
}

function assertCanonicalGithubReleaseCandidate(expectedCommit) {
  verifyCanonicalReleaseCandidate({
    candidateCommit: expectedCommit,
    readGithubJson: readRequiredGithubApiJson,
    repository: releaseRepository,
  });
}

function readRequiredGithubApiJson(endpoint, label) {
  const value = lookupGithubRelease(endpoint, label);
  if (value === null) {
    throw new Error(`GitHub returned HTTP 404 for ${label}.`);
  }
  return value;
}

function resolveRemoteReleaseTagCommit() {
  const ref = lookupGithubRelease(
    `${githubRepositoryApiRoot}/git/ref/tags/${encodeURIComponent(tag)}`,
    `remote release tag ${tag}`,
  );
  if (ref === null) {
    throw new Error(
      `Remote release tag ${tag} must exist before drafting a public release.`,
    );
  }

  let object = readRemoteGitObject(ref, `remote release tag ${tag}`);
  const visited = new Set();
  for (let depth = 0; depth < 8; depth += 1) {
    if (object.type === "commit") {
      return object.sha;
    }
    if (object.type !== "tag" || visited.has(object.sha)) {
      break;
    }
    visited.add(object.sha);
    const annotatedTag = lookupGithubRelease(
      `${githubRepositoryApiRoot}/git/tags/${encodeURIComponent(object.sha)}`,
      `annotated Git tag object ${object.sha}`,
    );
    if (annotatedTag === null) {
      throw new Error(
        `Annotated remote release tag object ${object.sha} is missing.`,
      );
    }
    object = readRemoteGitObject(
      annotatedTag,
      `annotated Git tag object ${object.sha}`,
    );
  }
  throw new Error(
    `Remote release tag ${tag} does not resolve to one unambiguous commit.`,
  );
}

function readRemoteGitObject(payload, label) {
  const object = isGithubReleaseObject(payload) ? payload.object : null;
  if (
    !isGithubReleaseObject(object) ||
    !["commit", "tag"].includes(object.type) ||
    typeof object.sha !== "string" ||
    !/^[0-9a-f]+$/u.test(object.sha)
  ) {
    throw new Error(`${label} returned an invalid Git object.`);
  }
  return { sha: object.sha, type: object.type };
}

function isGithubReleaseObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function manualIsolationInstructions(release, reason) {
  const safeReleaseId =
    isGithubReleaseObject(release) &&
    Number.isSafeInteger(release.id) &&
    release.id > 0
      ? release.id
      : "<先核实数值 release ID>";
  const releaseUrl =
    isGithubReleaseObject(release) && typeof release.html_url === "string"
      ? `\n草稿地址：${release.html_url}`
      : "";
  return `人工隔离（MANUAL ISOLATION REQUIRED）：${reason}
1. 立即停止发布或重试 ${tag}，并保持相关 Release 为 draft。
2. 在 GitHub Releases 中按 tag=${tag}、title=${releaseTitle} 核实草稿身份与数值 release ID。${releaseUrl}
3. 身份确认后执行：gh api --method DELETE ${githubRepositoryApiRoot}/releases/${safeReleaseId}
4. 分别按 release ID 与 tag 再次 GET，只有两者都明确返回 HTTP 404 才算清理完成。`;
}

function assertRegularFileEvidenceUnchanged(evidence, action) {
  let link;
  let current;
  try {
    link = lstatSync(evidence.absolutePath);
    current = statSync(evidence.absolutePath);
  } catch {
    throw new Error(
      `${evidence.label} disappeared after it was verified: ${evidence.logicalPath}.`,
    );
  }
  if (
    link.isSymbolicLink() ||
    !link.isFile() ||
    link.nlink !== 1 ||
    current.nlink !== 1 ||
    !sameFileState(evidence.state, current) ||
    current.size !== evidence.sizeBytes ||
    sha256File(evidence.absolutePath) !== evidence.sha256
  ) {
    throw new Error(`${evidence.label} ${action}: ${evidence.logicalPath}.`);
  }
}

function collectStrictRegularFiles(path) {
  let metadata;
  try {
    metadata = lstatSync(path);
  } catch {
    throw new Error(`Required release path is missing: ${path}.`);
  }
  if (metadata.isSymbolicLink()) {
    throw new Error(`Release paths must not contain symbolic links: ${path}.`);
  }
  if (metadata.isFile()) {
    return [path];
  }
  if (!metadata.isDirectory()) {
    throw new Error(
      `Release paths must contain only directories and regular files: ${path}.`,
    );
  }
  return readdirSync(path).flatMap((name) =>
    collectStrictRegularFiles(resolve(path, name)),
  );
}

function freezeSnapshotDirectories(path) {
  const metadata = lstatSync(path);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error(`Private snapshot directory is invalid: ${path}.`);
  }
  for (const name of readdirSync(path)) {
    const child = resolve(path, name);
    const childMetadata = lstatSync(child);
    if (childMetadata.isDirectory() && !childMetadata.isSymbolicLink()) {
      freezeSnapshotDirectories(child);
    }
  }
  chmodSync(path, 0o500);
}

function removePrivateSnapshot(path) {
  makeSnapshotWritable(path);
  rmSync(path, { force: true, maxRetries: 3, recursive: true });
}

function makeSnapshotWritable(path) {
  if (!existsSync(path)) {
    return;
  }
  const metadata = lstatSync(path);
  if (metadata.isSymbolicLink()) {
    return;
  }
  if (metadata.isDirectory()) {
    chmodSync(path, 0o700);
    for (const name of readdirSync(path)) {
      makeSnapshotWritable(resolve(path, name));
    }
    return;
  }
  if (metadata.isFile()) {
    chmodSync(path, 0o600);
  }
}

function assertInside(parent, child, label) {
  const relativePath = relative(resolve(parent), resolve(child));
  if (
    relativePath !== "" &&
    !relativePath.startsWith("..") &&
    !isAbsolute(relativePath)
  ) {
    return;
  }
  throw new Error(`${label} escapes its private root.`);
}

function sameFileState(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function sha256File(path) {
  const hash = createHash("sha256");
  const descriptor = openSync(path, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) {
        hash.update(buffer.subarray(0, bytesRead));
      }
    } while (bytesRead > 0);
  } finally {
    closeSync(descriptor);
  }
  return hash.digest("hex");
}

function collectFiles(path) {
  if (!existsSync(path)) {
    return [];
  }

  const entries = readdirSync(path, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const child = resolve(path, entry.name);
    if (entry.isDirectory()) {
      return collectFiles(child);
    }
    return entry.isFile() ? [child] : [];
  });
}

function toReleasePath(file) {
  return relative(root, file).replace(/\\/g, "/");
}

function parseArgs(args) {
  let dryRun = false;
  let notesFile = null;
  let root = scriptRoot;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (arg === "--desktop") {
      continue;
    }
    if (arg === "--notes-file") {
      const value = args[index + 1];
      if (!value) {
        fail("--notes-file requires a path.");
      }
      notesFile = value;
      index += 1;
      continue;
    }
    if (arg.startsWith("--notes-file=")) {
      notesFile = arg.slice("--notes-file=".length);
      continue;
    }
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

  return { dryRun, notesFile, root };
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:@-]+$/.test(value) ? value : JSON.stringify(value);
}

function validateReleaseNotes() {
  if (!existsSync(releaseNotesPath) || !statSync(releaseNotesPath).isFile()) {
    fail(`Release notes file is required: ${toReleasePath(releaseNotesPath)}`);
  }

  const notes = readFileSync(releaseNotesPath, "utf8").trim();
  if (notes.length === 0) {
    fail(
      `Release notes file must not be empty: ${toReleasePath(releaseNotesPath)}`,
    );
  }
  if (!notes.includes(packageJson.version)) {
    fail(
      `Release notes file must mention ${packageJson.version}: ${toReleasePath(releaseNotesPath)}`,
    );
  }
}

function assertReleaseMachineReady() {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"], {
    message: "Git checkout metadata is required to draft a release.",
  });
  if (insideWorkTree !== "true") {
    fail("Git checkout metadata is required to draft a release.");
  }

  const status = runGit(
    [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--",
      ".",
      ":(exclude)reports/release",
    ],
    {
      message:
        "Git working tree outside reports/release must be clean before drafting a public release.",
    },
  );
  if (status.trim() !== "") {
    fail(
      `Git working tree outside reports/release must be clean before drafting a public release:\n${status}`,
    );
  }

  const head = runGit(["rev-parse", "HEAD"], {
    message:
      "Unable to resolve the current Git commit before drafting a release.",
  });
  const tagCommit = runGit(["rev-parse", "--verify", `${tag}^{}`], {
    message: `Release tag ${tag} must exist before drafting a public release.`,
  });
  if (head !== tagCommit) {
    fail(
      `Release tag ${tag} must point at HEAD before drafting a public release.`,
    );
  }

  runGh(["--version"], {
    message: "GitHub CLI is required to draft a release.",
  });
  runGh(["auth", "status"], {
    message: "GitHub CLI must be authenticated before drafting a release.",
  });
  try {
    assertRemoteReleaseTagMatchesCommit(head);
    assertCanonicalGithubReleaseCandidate(head);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  assertGithubReleaseControls();
  assertGithubReleaseDoesNotExist();
  return head;
}

function assertGithubReleaseControls() {
  const result = spawnSync(
    process.execPath,
    [
      resolve(scriptRoot, "scripts", "check-github-release-controls.mjs"),
      "--repo",
      releaseRepository,
    ],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        JOESSH_GITHUB_RELEASE_CONTROLS_GH_ARGS:
          JSON.stringify(ghCommandPrefixArgs),
        JOESSH_GITHUB_RELEASE_CONTROLS_GH_COMMAND: ghCommand,
      },
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
    fail(
      `GitHub release controls must pass before drafting a public release.${
        result.error instanceof Error ? ` ${result.error.message}` : ""
      }`,
    );
  }
}

function assertGithubReleaseDoesNotExist() {
  const result = spawnSync(
    ghCommand,
    [
      ...ghCommandPrefixArgs,
      "release",
      "view",
      tag,
      "--repo",
      releaseRepository,
      "--json",
      "url",
    ],
    {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  if (result.status === 0) {
    fail(
      `GitHub Release ${tag} already exists; refusing to create a duplicate draft.`,
    );
  }

  const diagnostic = `${result.stdout}\n${result.stderr}`;
  if (
    !/(?:release[^\r\n]*not[\s_-]*found|not_found[^\r\n]*release|could not find[^\r\n]*release|HTTP\s*404)/iu.test(
      diagnostic,
    )
  ) {
    fail(
      `Unable to confirm GitHub Release ${tag} does not already exist:\n${diagnostic.trim()}`,
    );
  }
}

function runGit(args, options) {
  return runCommand(gitCommand, [...gitCommandPrefixArgs, ...args], options);
}

function runGh(args, options) {
  return runCommand(ghCommand, [...ghCommandPrefixArgs, ...args], options);
}

function runCommand(command, args, { message }) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const diagnostic = `${result.stdout}\n${result.stderr}`.trim();
    fail(diagnostic ? `${message}\n${diagnostic}` : message);
  }
  return result.stdout.trim();
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
