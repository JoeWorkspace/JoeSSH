import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import test from "node:test";

import {
  WINDOWS_STORE_SOURCE_POLICY,
  buildGhAttestationVerificationArgs,
  buildOfflineGhEnvironment,
  inspectApprovedGitHubCli,
  parseSourceArtifactArgs,
  removeOwnedTemporaryDirectory,
  validateArtifactMetadata,
  validateCanonicalSourceCandidateName,
  validateProducerRunMetadata,
  validateVerifiedAttestation,
  validateWindowsStoreSourceReceiptMetadata,
  verifyWindowsStoreSourceArtifacts,
} from "./verify-windows-store-source-artifacts.mjs";

const policy = WINDOWS_STORE_SOURCE_POLICY;
const REPOSITORY_ROOT = resolve(import.meta.dirname, "..");
const SOURCE_SHA = "a".repeat(40);
const RUN_ID = "40000000001";
const RUN_ATTEMPT = "2";
const ARTIFACT_IDS = Object.freeze({
  candidate: "50000000001",
  evidence: "50000000002",
  attestations: "50000000003",
});
const NOW = new Date("2026-08-31T12:00:00.000Z");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function context(candidate = {}) {
  return {
    candidate,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    sourceSha: SOURCE_SHA,
  };
}

function runMetadata() {
  return {
    id: Number(RUN_ID),
    name: policy.workflowName,
    path: policy.workflowPath,
    workflow_id: policy.workflowId,
    run_number: 17,
    run_attempt: Number(RUN_ATTEMPT),
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    head_branch: policy.sourceBranch,
    head_sha: SOURCE_SHA,
    head_commit: { id: SOURCE_SHA },
    head_repository: {
      id: policy.repositoryId,
      full_name: policy.repository,
    },
    repository: {
      id: policy.repositoryId,
      full_name: policy.repository,
    },
  };
}

function artifactMetadata({ id, name, digest, sizeBytes }) {
  return {
    id: Number(id),
    name,
    size_in_bytes: sizeBytes,
    digest,
    expired: false,
    created_at: "2026-08-31T11:00:00Z",
    updated_at: "2026-08-31T11:01:00Z",
    expires_at: "2026-09-14T11:00:00Z",
    workflow_run: {
      id: Number(RUN_ID),
      repository_id: policy.repositoryId,
      head_repository_id: policy.repositoryId,
      head_branch: policy.sourceBranch,
      head_sha: SOURCE_SHA,
    },
  };
}

function certificate() {
  const identity = `https://github.com/${policy.repository}/${policy.workflowPath}@${policy.sourceRef}`;
  return {
    subjectAlternativeName: identity,
    issuer: "https://token.actions.githubusercontent.com",
    githubWorkflowTrigger: "workflow_dispatch",
    githubWorkflowSHA: SOURCE_SHA,
    githubWorkflowName: policy.workflowName,
    githubWorkflowRepository: policy.repository,
    githubWorkflowRef: policy.sourceRef,
    buildSignerURI: identity,
    buildSignerDigest: SOURCE_SHA,
    runnerEnvironment: "github-hosted",
    sourceRepositoryURI: `https://github.com/${policy.repository}`,
    sourceRepositoryDigest: SOURCE_SHA,
    sourceRepositoryRef: policy.sourceRef,
    sourceRepositoryIdentifier: String(policy.repositoryId),
    sourceRepositoryOwnerURI: `https://github.com/${policy.repositoryOwner}`,
    sourceRepositoryOwnerIdentifier: String(policy.repositoryOwnerId),
    buildConfigURI: identity,
    buildConfigDigest: SOURCE_SHA,
    buildTrigger: "workflow_dispatch",
    runInvocationURI: `https://github.com/${policy.repository}/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT}`,
    sourceRepositoryVisibilityAtSigning: "public",
  };
}

function buildBindings(candidate) {
  const jobs = Array.from({ length: policy.expectedCiJobCount }, (_, index) => ({
    name: `required-${index + 1}`,
    conclusion: "success",
  }));
  return {
    schemaVersion: 1,
    source: {
      repository: policy.repository,
      sha: SOURCE_SHA,
      ref: policy.sourceRef,
    },
    builder: {
      workflow: policy.workflowPath,
      runId: RUN_ID,
      runAttempt: RUN_ATTEMPT,
      environment: policy.protectedEnvironment,
    },
    artifact: {
      path: candidate.fileName,
      sha256: candidate.sha256,
      sizeBytes: candidate.sizeBytes,
    },
    ci: {
      sourceSha: SOURCE_SHA,
      producerRunId: RUN_ID,
      producerRunAttempt: RUN_ATTEMPT,
      jobs,
      stageB: {
        humanApprovalVerified: true,
        protectedBranchesOnly: true,
        adminBypassDisabled: true,
      },
    },
    validation: {
      makeAppxPackAndUnpack: true,
      byteExactPayloadRoundTrip: true,
      allStoreSurfaceChecks: true,
    },
    publication: {
      storePublicationReady: false,
      partnerCenterUpload: "not-performed",
      storeCertification: "not-performed",
    },
  };
}

function slsaPredicate() {
  const identity = `https://github.com/${policy.repository}/${policy.workflowPath}@${policy.sourceRef}`;
  return {
    buildDefinition: {
      buildType: "https://actions.github.io/buildtypes/workflow/v1",
      externalParameters: {
        workflow: {
          path: policy.workflowPath,
          ref: policy.sourceRef,
          repository: `https://github.com/${policy.repository}`,
        },
      },
      internalParameters: {
        github: {
          event_name: "workflow_dispatch",
          repository_id: String(policy.repositoryId),
          repository_owner_id: String(policy.repositoryOwnerId),
          runner_environment: "github-hosted",
        },
      },
      resolvedDependencies: [
        {
          uri: `git+https://github.com/${policy.repository}@${policy.sourceRef}`,
          digest: { gitCommit: SOURCE_SHA },
        },
      ],
    },
    runDetails: {
      builder: { id: identity },
      metadata: {
        invocationId: `https://github.com/${policy.repository}/actions/runs/${RUN_ID}/attempts/${RUN_ATTEMPT}`,
      },
    },
  };
}

function attestationResult(candidate, predicateType, predicate) {
  return [
    {
      verificationResult: {
        signature: { certificate: certificate() },
        verifiedTimestamps: [
          {
            type: "Tlog",
            uri: "https://rekor.sigstore.dev",
            timestamp: "2026-08-31T11:02:00.000Z",
          },
        ],
        statement: {
          _type: "https://in-toto.io/Statement/v1",
          subject: [
            {
              name: candidate.fileName,
              digest: { sha256: candidate.sha256 },
            },
          ],
          predicateType,
          predicate,
        },
      },
    },
  ];
}

function writeEvidenceTree(directory, predicate) {
  const payloads = new Map([
    ["predicate.json", `${JSON.stringify(predicate, null, 2)}\n`],
    ["ci.json", `${JSON.stringify(predicate.ci, null, 2)}\n`],
  ]);
  for (let index = 0; index < 11; index += 1) {
    payloads.set(`support-${String(index + 1).padStart(2, "0")}.json`, `{"ok":true,"index":${index + 1}}\n`);
  }
  for (const [name, contents] of payloads) {
    writeFileSync(resolve(directory, name), contents);
  }
  const manifest = [...payloads]
    .sort(([left], [right]) => left.localeCompare(right, "en"))
    .map(([name, contents]) => `${sha256(contents)}  ${name}`)
    .join("\n");
  writeFileSync(resolve(directory, "SHA256SUMS.txt"), `${manifest}\n`);
}

function fakeGitHubCli(path) {
  return {
    path,
    fileName: policy.githubCli.executableName,
    sha256: policy.githubCli.executableSha256,
    sizeBytes: policy.githubCli.executableSizeBytes,
    version: policy.githubCli.version,
    versionLines: [...policy.githubCli.versionLines],
    signatureStatus: "Valid",
    signerSubject: policy.githubCli.signerSubject,
    signerThumbprint: policy.githubCli.signerThumbprint,
  };
}

test("trust policy contains no one-off source run, artifact ID, or candidate hash", () => {
  assert.equal(Object.hasOwn(policy, "sourceSha"), false);
  assert.equal(Object.hasOwn(policy, "runId"), false);
  assert.equal(Object.hasOwn(policy, "candidate"), false);
  assert.equal(Object.hasOwn(policy, "evidence"), false);
  assert.equal(Object.hasOwn(policy, "attestations"), false);
  assert.equal(policy.workflowPath, ".github/workflows/windows-store-build.yml");
  assert.equal(policy.sourceRef, "refs/heads/main");
});

test("producer metadata derives a successful runtime tuple and rejects cross-run/source substitution", () => {
  assert.deepEqual(validateProducerRunMetadata(runMetadata(), context()), {
    workflowId: policy.workflowId,
    workflowName: policy.workflowName,
    workflowPath: policy.workflowPath,
    runId: RUN_ID,
    runAttempt: RUN_ATTEMPT,
    runNumber: 17,
    event: "workflow_dispatch",
    status: "completed",
    conclusion: "success",
    headRepository: policy.repository,
    headBranch: policy.sourceBranch,
    headSha: SOURCE_SHA,
  });
  for (const mutate of [
    (run) => (run.id += 1),
    (run) => (run.run_attempt += 1),
    (run) => (run.path = ".github/workflows/decoy.yml"),
    (run) => (run.head_sha = "b".repeat(40)),
    (run) => (run.head_commit.id = "b".repeat(40)),
    (run) => (run.head_repository.full_name = "attacker/fork"),
    (run) => (run.conclusion = "failure"),
  ]) {
    const run = runMetadata();
    mutate(run);
    assert.throws(
      () => validateProducerRunMetadata(run, context()),
      /approved successful run/,
    );
  }
});

test("artifact metadata treats IDs as selectors and proves same run, source, digest, size, and retention", () => {
  const candidate = { fileName: "candidate.msix", sha256: "c".repeat(64), sizeBytes: 123 };
  const expected = {
    artifactId: ARTIFACT_IDS.candidate,
    expectedName: candidate.fileName,
    expectedDigest: `sha256:${candidate.sha256}`,
    expectedSizeBytes: candidate.sizeBytes,
    maximumSizeBytes: 1024,
    role: "candidate",
  };
  const metadata = artifactMetadata({
    id: expected.artifactId,
    name: expected.expectedName,
    digest: expected.expectedDigest,
    sizeBytes: expected.expectedSizeBytes,
  });
  assert.equal(
    validateArtifactMetadata(metadata, expected, context(candidate), NOW).metadataDigest,
    expected.expectedDigest,
  );
  for (const mutate of [
    (value) => (value.digest = `sha256:${"0".repeat(64)}`),
    (value) => (value.workflow_run.id += 1),
    (value) => (value.workflow_run.head_sha = "0".repeat(40)),
    (value) => (value.expired = true),
    (value) => (value.size_in_bytes += 1),
  ]) {
    const changed = structuredClone(metadata);
    mutate(changed);
    assert.throws(
      () => validateArtifactMetadata(changed, expected, context(candidate), NOW),
      /metadata mismatch/,
    );
  }
});

test("candidate name is canonical ASCII and bound to source SHA, run, and attempt", () => {
  const valid = `JoeSSH_1.1.25.0_x64_${SOURCE_SHA.slice(0, 12)}_${RUN_ID}_${RUN_ATTEMPT}.msix`;
  assert.equal(validateCanonicalSourceCandidateName(valid, context()), valid);
  for (const invalid of [
    valid.replace(SOURCE_SHA.slice(0, 12), "b".repeat(12)),
    valid.replace(`_${RUN_ID}_`, "_40000000002_"),
    valid.replace(`_${RUN_ATTEMPT}.msix`, "_3.msix"),
    valid.replace("1.1.25.0", "01.1.25.0"),
    valid.replace("1.1.25.0", "1.1.65536.0"),
    valid.replace(".msix", ".MSIX"),
    valid.replace("JoeSSH_", "JoeSSH_\n"),
    valid.replace("_x64_", "/x64/"),
  ]) {
    assert.throws(
      () => validateCanonicalSourceCandidateName(invalid, context()),
      /canonical source\/SHA\/run\/attempt-bound ASCII MSIX name/,
    );
  }
});

test("offline attestation validation binds one exact candidate subject and hosted workflow identity", () => {
  const candidate = { fileName: "candidate.msix", sha256: "d".repeat(64), sizeBytes: 123 };
  const type = "https://slsa.dev/provenance/v1";
  const valid = attestationResult(candidate, type, slsaPredicate());
  const verified = validateVerifiedAttestation(valid, type, candidate, context(candidate), NOW);
  assert.equal(verified.signer.workflowSha, SOURCE_SHA);
  assert.equal(verified.signer.runnerEnvironment, "github-hosted");
  for (const mutate of [
    (result) => (result[0].verificationResult.statement.subject[0].digest.sha256 = "0".repeat(64)),
    (result) => (result[0].verificationResult.signature.certificate.runnerEnvironment = "self-hosted"),
    (result) => (result[0].verificationResult.signature.certificate.runInvocationURI = "https://github.com/JoeWorkspace/JoeSSH/actions/runs/1/attempts/1"),
    (result) => (result[0].verificationResult.verifiedTimestamps[0].uri = "https://attacker.invalid"),
  ]) {
    const changed = structuredClone(valid);
    mutate(changed);
    assert.throws(
      () => validateVerifiedAttestation(changed, type, candidate, context(candidate), NOW),
      /mismatch|invalid/,
    );
  }
});

test("generic verifier resolves a full tuple from live API and both offline bundles", async () => {
  const root = mkdtempSync(resolve(tmpdir(), "joessh-source-verifier-test-"));
  try {
    const candidateDirectory = resolve(root, "candidate");
    const evidenceDirectory = resolve(root, "evidence");
    const attestationsDirectory = resolve(root, "attestations");
    mkdirSync(candidateDirectory);
    mkdirSync(evidenceDirectory);
    mkdirSync(attestationsDirectory);
    const candidatePath = resolve(
      candidateDirectory,
      `JoeSSH_1.1.25.0_x64_${SOURCE_SHA.slice(0, 12)}_${RUN_ID}_${RUN_ATTEMPT}.msix`,
    );
    writeFileSync(candidatePath, "fixture candidate bytes\n");
    const candidateBytes = readFileSync(candidatePath);
    const candidate = {
      fileName: basename(candidatePath),
      sha256: sha256(candidateBytes),
      sizeBytes: candidateBytes.length,
    };
    const bindings = buildBindings(candidate);
    writeEvidenceTree(evidenceDirectory, bindings);
    writeFileSync(resolve(attestationsDirectory, "slsa.sigstore.json"), "slsa bundle\n");
    writeFileSync(resolve(attestationsDirectory, "bindings.sigstore.json"), "bindings bundle\n");
    const outputPath = resolve(root, "receipt.json");
    const ghPath = resolve(root, "gh.exe");
    const metadataByPath = new Map([
      [`/repos/${policy.repository}/actions/runs/${RUN_ID}`, runMetadata()],
      [
        `/repos/${policy.repository}/actions/artifacts/${ARTIFACT_IDS.candidate}`,
        artifactMetadata({
          id: ARTIFACT_IDS.candidate,
          name: candidate.fileName,
          digest: `sha256:${candidate.sha256}`,
          sizeBytes: candidate.sizeBytes,
        }),
      ],
      [
        `/repos/${policy.repository}/actions/artifacts/${ARTIFACT_IDS.evidence}`,
        artifactMetadata({
          id: ARTIFACT_IDS.evidence,
          name: `store-source-evidence-${RUN_ID}-${RUN_ATTEMPT}`,
          digest: `sha256:${"e".repeat(64)}`,
          sizeBytes: 12345,
        }),
      ],
      [
        `/repos/${policy.repository}/actions/artifacts/${ARTIFACT_IDS.attestations}`,
        artifactMetadata({
          id: ARTIFACT_IDS.attestations,
          name: `store-source-attestations-${RUN_ID}-${RUN_ATTEMPT}`,
          digest: `sha256:${"f".repeat(64)}`,
          sizeBytes: 54321,
        }),
      ],
    ]);
    const receipt = await verifyWindowsStoreSourceArtifacts(
      {
        root: REPOSITORY_ROOT,
        reviewedSha: SOURCE_SHA,
        artifactSourceSha: SOURCE_SHA,
        producerRunId: RUN_ID,
        producerRunAttempt: RUN_ATTEMPT,
        candidateArtifactId: ARTIFACT_IDS.candidate,
        evidenceArtifactId: ARTIFACT_IDS.evidence,
        attestationsArtifactId: ARTIFACT_IDS.attestations,
        candidatePath,
        evidenceDirectory,
        attestationsDirectory,
        expectedSha256: candidate.sha256,
        ghExecutablePath: ghPath,
        outputPath,
        githubToken: "fixture-token-not-used",
      },
      {
        now: NOW,
        inspectGitHubCli: () => fakeGitHubCli(ghPath),
        getGitHubJson: async (path) => {
          assert.ok(metadataByPath.has(path), `unexpected API path: ${path}`);
          return structuredClone(metadataByPath.get(path));
        },
        runGh: ({ predicateType }) =>
          predicateType === "https://slsa.dev/provenance/v1"
            ? attestationResult(candidate, predicateType, slsaPredicate())
            : attestationResult(candidate, predicateType, bindings),
      },
    );
    assert.equal(receipt.source.sha, SOURCE_SHA);
    assert.equal(receipt.producer.runId, RUN_ID);
    assert.equal(receipt.candidate.artifactId, ARTIFACT_IDS.candidate);
    assert.equal(receipt.artifacts.candidate.metadataDigest, `sha256:${candidate.sha256}`);
    assert.equal(receipt.attestations.buildBindings.exactEvidencePredicate, true);
    assert.equal(existsSync(outputPath), true);
    validateWindowsStoreSourceReceiptMetadata(receipt, {
      reviewedSha: SOURCE_SHA,
      artifactSourceSha: SOURCE_SHA,
      candidate,
      expectedSha256: candidate.sha256,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("source contains no reviewed runtime tuple and forces the same commit", () => {
  const source = readFileSync(
    resolve(import.meta.dirname, "verify-windows-store-source-artifacts.mjs"),
    "utf8",
  );
  assert.doesNotMatch(source, /sourceSha:\s*"[a-f0-9]{40}"/u);
  assert.doesNotMatch(source, /runId:\s*"[1-9][0-9]*"/u);
  assert.doesNotMatch(source, /artifactId:\s*"[1-9][0-9]*"/u);
  assert.match(source, /options\.reviewedSha !== options\.artifactSourceSha/u);
});

test("CLI requires same-commit runtime selectors and rejects omitted, repeated, and unknown values", () => {
  const valid = [
    "--reviewed-sha", SOURCE_SHA,
    "--artifact-source-sha", SOURCE_SHA,
    "--producer-run-id", RUN_ID,
    "--producer-run-attempt", RUN_ATTEMPT,
    "--candidate-artifact-id", ARTIFACT_IDS.candidate,
    "--evidence-artifact-id", ARTIFACT_IDS.evidence,
    "--attestations-artifact-id", ARTIFACT_IDS.attestations,
    "--attestations-directory", "attestations",
    "--candidate", "candidate.msix",
    "--evidence-directory", "evidence",
    "--expected-sha256", "c".repeat(64),
    "--gh-executable", resolve("fixtures", "gh.exe"),
    "--output", "receipt.json",
  ];
  const parsed = parseSourceArtifactArgs(valid, { GITHUB_TOKEN: "job-token" });
  assert.equal(parsed.producerRunId, RUN_ID);
  assert.equal(parsed.candidateArtifactId, ARTIFACT_IDS.candidate);
  assert.equal(parsed.githubToken, "job-token");
  assert.throws(() => parseSourceArtifactArgs(valid.slice(0, -2)), /Required arguments/);
  assert.throws(() => parseSourceArtifactArgs([...valid, "--candidate", "decoy.msix"]), /repeated argument/);
  assert.throws(() => parseSourceArtifactArgs([...valid, "--token", "secret"]), /Unknown or repeated argument/);
  assert.throws(() => inspectApprovedGitHubCli("gh.exe"), /explicit and absolute/);
});

test("offline gh child receives an allowlist without tokens and arguments bind the runtime source", () => {
  const isolatedRoot = resolve("fixtures", "empty-gh-home");
  const environment = buildOfflineGhEnvironment(
    {
      SystemRoot: "C:\\Windows",
      TEMP: "C:\\Temp",
      GH_TOKEN: "must-not-pass",
      GITHUB_TOKEN: "must-not-pass",
      ACTIONS_ID_TOKEN_REQUEST_TOKEN: "must-not-pass",
    },
    isolatedRoot,
  );
  assert.equal(environment.HTTPS_PROXY, "http://127.0.0.1:9");
  assert.equal(environment.GH_CONFIG_DIR, isolatedRoot);
  assert.equal(Object.hasOwn(environment, "GITHUB_TOKEN"), false);
  assert.equal(Object.hasOwn(environment, "ACTIONS_ID_TOKEN_REQUEST_TOKEN"), false);
  const args = buildGhAttestationVerificationArgs({
    bundlePath: "C:\\evidence\\bundle.json",
    candidatePath: "C:\\evidence\\candidate.msix",
    predicateType: "https://slsa.dev/provenance/v1",
    trustedRootPath: "C:\\verifier\\trusted-root.jsonl",
    verificationContext: context(),
  });
  assert.equal(args[args.indexOf("--repo") + 1], policy.repository);
  assert.equal(args[args.indexOf("--source-digest") + 1], SOURCE_SHA);
  assert.equal(args[args.indexOf("--signer-digest") + 1], SOURCE_SHA);
  assert.ok(args.includes("--deny-self-hosted-runners"));
});

test("recursive verifier cleanup remains limited to an owned direct temp directory", () => {
  const prefix = "joessh-gh-cleanup-test-";
  const owned = mkdtempSync(resolve(tmpdir(), prefix));
  try {
    mkdirSync(resolve(owned, "nested"));
    writeFileSync(resolve(owned, "nested", "marker.txt"), "owned\n");
    assert.throws(() => removeOwnedTemporaryDirectory(owned, "wrong-prefix-"), /Refusing recursive cleanup/);
    assert.equal(existsSync(owned), true);
    assert.throws(() => removeOwnedTemporaryDirectory(REPOSITORY_ROOT, prefix), /Refusing recursive cleanup/);
    removeOwnedTemporaryDirectory(owned, prefix);
    assert.equal(existsSync(owned), false);
  } finally {
    if (existsSync(owned)) removeOwnedTemporaryDirectory(owned, prefix);
  }
});
