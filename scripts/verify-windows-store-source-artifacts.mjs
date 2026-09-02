import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "..");
const TRUSTED_ROOT_RELATIVE_PATH =
  "scripts/trusted-roots/github-attestation-trusted-root-2026-08-31.jsonl";
const SLSA_PREDICATE_TYPE = "https://slsa.dev/provenance/v1";
const BINDINGS_PREDICATE_TYPE =
  "https://github.com/JoeWorkspace/JoeSSH/attestations/windows-store-build/v1";
const OFFLINE_VERIFICATION_TEMP_PREFIX = "joessh-gh-offline-verification-";
const GH_VERSION_TEMP_PREFIX = "joessh-gh-version-";

// These are stable trust-policy values. Runtime run IDs, artifact IDs, artifact
// names, hashes, sizes, and timestamps are deliberately supplied or discovered
// at verification time and must never be approved by editing this file.
export const WINDOWS_STORE_SOURCE_POLICY = Object.freeze({
  repository: "JoeWorkspace/JoeSSH",
  repositoryId: 1276401634,
  repositoryOwnerId: 141906009,
  repositoryOwner: "JoeWorkspace",
  sourceRef: "refs/heads/main",
  sourceBranch: "main",
  workflowId: 345799031,
  workflowName: "Windows Store Source Build",
  workflowPath: ".github/workflows/windows-store-build.yml",
  protectedEnvironment: "windows-release-stage-b",
  expectedCiJobCount: 14,
  expectedEvidenceFileCount: 14,
  trustedRoot: Object.freeze({
    path: TRUSTED_ROOT_RELATIVE_PATH,
    sha256: "65ca537f6ed8a47fd0e560c421baa1f6c1efb8b25fc200d8c5c02c0e92eb2b9c",
  }),
  githubCli: Object.freeze({
    version: "2.95.0",
    releaseUrl:
      "https://github.com/cli/cli/releases/download/v2.95.0/gh_2.95.0_windows_amd64.zip",
    archiveSha256:
      "19a7154161ada9cfaa9e57edb752ecc679b75c391a62e4f7b586eea1df30b5bb",
    archiveSizeBytes: 14814893,
    executableName: "gh.exe",
    executableSha256:
      "cfefbc730f2ef7dc0352d6a5435b72fe6afce7fc56d61c90eb7703cd5d97b149",
    executableSizeBytes: 41483064,
    versionLines: Object.freeze([
      "gh version 2.95.0 (2026-06-17)",
      "https://github.com/cli/cli/releases/tag/v2.95.0",
    ]),
    signerSubject:
      'CN="GitHub, Inc.", O="GitHub, Inc.", L=San Francisco, S=California, C=US',
    signerThumbprint: "EF53B4F7C8724BF491A7FD92743D38EEFB7C3947",
  }),
});

export async function verifyWindowsStoreSourceArtifacts(
  rawOptions,
  runtime = {},
) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  const options = normalizeOptions(rawOptions);
  assertApprovedInputs(options);
  const now = runtime.now instanceof Date ? runtime.now : new Date();
  if (!Number.isFinite(now.getTime())) {
    throw new Error("The verification clock is invalid.");
  }

  const candidate = inspectDirectFile(options.candidatePath, "candidate MSIX");
  if (!candidate.fileName.toLowerCase().endsWith(".msix")) {
    throw new Error("The authenticated source candidate must be one MSIX file.");
  }
  if (candidate.sha256 !== options.expectedSha256) {
    throw new Error("Candidate bytes do not match the caller's SHA-256 constraint.");
  }

  const evidence = verifyEvidenceTree(options.evidenceDirectory);
  const verificationContext = {
    candidate,
    runAttempt: options.producerRunAttempt,
    runId: options.producerRunId,
    sourceSha: options.artifactSourceSha,
  };
  validateCanonicalSourceCandidateName(
    candidate.fileName,
    verificationContext,
  );
  validateBindingsPredicate(evidence.predicate, verificationContext);
  const attestations = verifyAttestationTree(options.attestationsDirectory);
  const trustedRoot = inspectDirectFile(
    options.trustedRootPath,
    "pinned Sigstore trusted root",
  );
  if (trustedRoot.sha256 !== policy.trustedRoot.sha256) {
    throw new Error("Pinned Sigstore trusted root digest mismatch.");
  }
  const inspectGitHubCli =
    runtime.inspectGitHubCli ?? inspectApprovedGitHubCli;
  const githubCli = inspectGitHubCli(options.ghExecutablePath);

  const getGitHubJson =
    runtime.getGitHubJson ??
    ((apiPath) => getGitHubJsonFromApi(apiPath, options.githubToken));
  const [
    runMetadata,
    candidateMetadata,
    evidenceMetadata,
    attestationMetadata,
  ] = await Promise.all([
    getGitHubJson(
      `/repos/${policy.repository}/actions/runs/${options.producerRunId}`,
    ),
    getGitHubJson(
      `/repos/${policy.repository}/actions/artifacts/${options.candidateArtifactId}`,
    ),
    getGitHubJson(
      `/repos/${policy.repository}/actions/artifacts/${options.evidenceArtifactId}`,
    ),
    getGitHubJson(
      `/repos/${policy.repository}/actions/artifacts/${options.attestationsArtifactId}`,
    ),
  ]);
  const producer = validateProducerRunMetadata(runMetadata, verificationContext);
  const artifacts = {
    candidate: validateArtifactMetadata(
      candidateMetadata,
      {
        artifactId: options.candidateArtifactId,
        expectedDigest: `sha256:${candidate.sha256}`,
        expectedName: candidate.fileName,
        expectedSizeBytes: candidate.sizeBytes,
        maximumSizeBytes: 256 * 1024 * 1024,
        role: "candidate",
      },
      verificationContext,
      now,
    ),
    evidence: validateArtifactMetadata(
      evidenceMetadata,
      {
        artifactId: options.evidenceArtifactId,
        expectedName: `store-source-evidence-${options.producerRunId}-${options.producerRunAttempt}`,
        maximumSizeBytes: 64 * 1024 * 1024,
        role: "evidence",
      },
      verificationContext,
      now,
    ),
    attestations: validateArtifactMetadata(
      attestationMetadata,
      {
        artifactId: options.attestationsArtifactId,
        expectedName: `store-source-attestations-${options.producerRunId}-${options.producerRunAttempt}`,
        maximumSizeBytes: 4 * 1024 * 1024,
        role: "attestations",
      },
      verificationContext,
      now,
    ),
  };

  const runGh = runtime.runGh ?? runGhAttestationVerification;
  const slsaResult = runGh({
    bundlePath: attestations.slsa.path,
    candidatePath: candidate.path,
    ghExecutablePath: githubCli.path,
    predicateType: SLSA_PREDICATE_TYPE,
    trustedRootPath: trustedRoot.path,
    verificationContext,
  });
  const bindingsResult = runGh({
    bundlePath: attestations.bindings.path,
    candidatePath: candidate.path,
    ghExecutablePath: githubCli.path,
    predicateType: BINDINGS_PREDICATE_TYPE,
    trustedRootPath: trustedRoot.path,
    verificationContext,
  });
  const slsa = validateVerifiedAttestation(
    slsaResult,
    SLSA_PREDICATE_TYPE,
    candidate,
    verificationContext,
    now,
  );
  const bindings = validateVerifiedAttestation(
    bindingsResult,
    BINDINGS_PREDICATE_TYPE,
    candidate,
    verificationContext,
    now,
  );
  validateSlsaPredicate(slsa.statement.predicate, verificationContext);
  if (!deepEqualJson(bindings.statement.predicate, evidence.predicate)) {
    throw new Error(
      "Signed build bindings do not exactly match evidence/predicate.json.",
    );
  }

  const receipt = {
    schemaVersion: 1,
    kind: "windows-store-github-actions-artifact-provenance",
    generatedAt: now.toISOString(),
    source: {
      repository: policy.repository,
      repositoryId: policy.repositoryId,
      ref: policy.sourceRef,
      sha: options.artifactSourceSha,
    },
    producer,
    candidate: {
      artifactId: options.candidateArtifactId,
      fileName: candidate.fileName,
      sha256: candidate.sha256,
      sizeBytes: candidate.sizeBytes,
    },
    artifacts,
    evidence: {
      artifactId: options.evidenceArtifactId,
      checksumManifestSha256: evidence.checksumManifest.sha256,
      predicateSha256: evidence.predicateFile.sha256,
      ciSha256: evidence.ciFile.sha256,
      fileCount: evidence.fileCount,
    },
    attestations: {
      artifactId: options.attestationsArtifactId,
      slsaBundleSha256: attestations.slsa.sha256,
      bindingsBundleSha256: attestations.bindings.sha256,
      signer: slsa.signer,
      slsa: {
        predicateType: slsa.statement.predicateType,
        transparencyLog: slsa.transparencyLog,
      },
      buildBindings: {
        predicateType: bindings.statement.predicateType,
        transparencyLog: bindings.transparencyLog,
        exactEvidencePredicate: true,
      },
      offlineVerification: {
        mode: "local-bundle-and-pinned-trusted-root",
        customTrustedRootPath: policy.trustedRoot.path,
        customTrustedRootSha256: trustedRoot.sha256,
        githubApiAttestationLookup: false,
        osNetworkIsolation: "not-enforced",
        outboundProxyConfiguration: "loopback-refusal",
        tokensRemovedFromCryptographicVerifier: true,
      },
    },
    verifier: {
      githubCli: {
        version: githubCli.version,
        releaseUrl: policy.githubCli.releaseUrl,
        archiveSha256: policy.githubCli.archiveSha256,
        archiveSizeBytes: policy.githubCli.archiveSizeBytes,
        executableName: githubCli.fileName,
        executableSha256: githubCli.sha256,
        executableSizeBytes: githubCli.sizeBytes,
        versionLines: githubCli.versionLines,
        signatureStatus: githubCli.signatureStatus,
        signerSubject: githubCli.signerSubject,
        signerThumbprint: githubCli.signerThumbprint,
      },
    },
    gates: {
      authenticatedProvenance: true,
      sourceArtifactMetadata: "exact-live-match",
      storePublicationReady: false,
    },
    boundary:
      "This authenticates the approved source build and exact MSIX only. Installation, WACK, Partner Center upload, Store signing, certification, and publication remain separate gates.",
  };
  validateWindowsStoreSourceReceipt(receipt, {
    artifactSourceSha: options.artifactSourceSha,
    candidatePath: candidate.path,
    expectedSha256: options.expectedSha256,
    reviewedSha: options.reviewedSha,
  });
  writeReceipt(options.outputPath, receipt);
  return receipt;
}

export function validateWindowsStoreSourceReceipt(
  receipt,
  { artifactSourceSha, candidatePath, expectedSha256, reviewedSha },
) {
  const candidate = inspectDirectFile(candidatePath, "receipt-bound candidate");
  return validateWindowsStoreSourceReceiptMetadata(receipt, {
    artifactSourceSha,
    candidate,
    expectedSha256,
    reviewedSha,
  });
}

export function validateWindowsStoreSourceReceiptMetadata(
  receipt,
  { artifactSourceSha, candidate, expectedSha256, reviewedSha },
) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  const generatedAtMs = Date.parse(receipt?.generatedAt ?? "");
  const context = {
    runAttempt: receipt?.producer?.runAttempt,
    runId: receipt?.producer?.runId,
    sourceSha: receipt?.source?.sha,
  };
  const requiredExact = [
    [receipt?.schemaVersion, 1],
    [receipt?.kind, "windows-store-github-actions-artifact-provenance"],
    [receipt?.source?.repository, policy.repository],
    [receipt?.source?.repositoryId, policy.repositoryId],
    [receipt?.source?.ref, policy.sourceRef],
    [receipt?.source?.sha, artifactSourceSha],
    [receipt?.producer?.workflowId, policy.workflowId],
    [receipt?.producer?.workflowName, policy.workflowName],
    [receipt?.producer?.workflowPath, policy.workflowPath],
    [receipt?.producer?.event, "workflow_dispatch"],
    [receipt?.producer?.status, "completed"],
    [receipt?.producer?.conclusion, "success"],
    [receipt?.producer?.headRepository, policy.repository],
    [receipt?.producer?.headBranch, policy.sourceBranch],
    [receipt?.producer?.headSha, artifactSourceSha],
    [receipt?.candidate?.fileName, candidate.fileName],
    [receipt?.candidate?.sha256, candidate.sha256],
    [receipt?.candidate?.sizeBytes, candidate.sizeBytes],
    [receipt?.candidate?.sha256, expectedSha256],
    [receipt?.candidate?.artifactId, receipt?.artifacts?.candidate?.artifactId],
    [receipt?.evidence?.artifactId, receipt?.artifacts?.evidence?.artifactId],
    [
      receipt?.attestations?.artifactId,
      receipt?.artifacts?.attestations?.artifactId,
    ],
    [receipt?.attestations?.slsa?.predicateType, SLSA_PREDICATE_TYPE],
    [
      receipt?.attestations?.buildBindings?.predicateType,
      BINDINGS_PREDICATE_TYPE,
    ],
    [receipt?.attestations?.buildBindings?.exactEvidencePredicate, true],
    [
      receipt?.attestations?.offlineVerification?.mode,
      "local-bundle-and-pinned-trusted-root",
    ],
    [
      receipt?.attestations?.offlineVerification?.customTrustedRootPath,
      policy.trustedRoot.path,
    ],
    [
      receipt?.attestations?.offlineVerification?.customTrustedRootSha256,
      policy.trustedRoot.sha256,
    ],
    [
      receipt?.attestations?.offlineVerification?.githubApiAttestationLookup,
      false,
    ],
    [
      receipt?.attestations?.offlineVerification?.osNetworkIsolation,
      "not-enforced",
    ],
    [
      receipt?.attestations?.offlineVerification?.outboundProxyConfiguration,
      "loopback-refusal",
    ],
    [receipt?.verifier?.githubCli?.version, policy.githubCli.version],
    [receipt?.verifier?.githubCli?.releaseUrl, policy.githubCli.releaseUrl],
    [
      receipt?.verifier?.githubCli?.archiveSha256,
      policy.githubCli.archiveSha256,
    ],
    [
      receipt?.verifier?.githubCli?.archiveSizeBytes,
      policy.githubCli.archiveSizeBytes,
    ],
    [
      receipt?.verifier?.githubCli?.executableName,
      policy.githubCli.executableName,
    ],
    [
      receipt?.verifier?.githubCli?.executableSha256,
      policy.githubCli.executableSha256,
    ],
    [
      receipt?.verifier?.githubCli?.executableSizeBytes,
      policy.githubCli.executableSizeBytes,
    ],
    [receipt?.verifier?.githubCli?.signatureStatus, "Valid"],
    [
      receipt?.verifier?.githubCli?.signerSubject,
      policy.githubCli.signerSubject,
    ],
    [
      receipt?.verifier?.githubCli?.signerThumbprint,
      policy.githubCli.signerThumbprint,
    ],
    [
      receipt?.attestations?.offlineVerification
        ?.tokensRemovedFromCryptographicVerifier,
      true,
    ],
    [receipt?.gates?.authenticatedProvenance, true],
    [receipt?.gates?.sourceArtifactMetadata, "exact-live-match"],
    [receipt?.gates?.storePublicationReady, false],
  ];
  if (
    requiredExact.some(([actual, expected]) => actual !== expected) ||
    !deepEqualJson(
      receipt?.verifier?.githubCli?.versionLines,
      policy.githubCli.versionLines,
    ) ||
    !Number.isFinite(generatedAtMs) ||
    !isFullSha(artifactSourceSha) ||
    (reviewedSha !== undefined && reviewedSha !== artifactSourceSha) ||
    !isPositiveIntegerString(receipt?.producer?.runId) ||
    !isPositiveIntegerString(receipt?.producer?.runAttempt) ||
    !Number.isSafeInteger(receipt?.producer?.runNumber) ||
    receipt.producer.runNumber <= 0 ||
    !isPositiveIntegerString(receipt?.candidate?.artifactId) ||
    !isPositiveIntegerString(receipt?.evidence?.artifactId) ||
    !isPositiveIntegerString(receipt?.attestations?.artifactId) ||
    new Set([
      receipt?.candidate?.artifactId,
      receipt?.evidence?.artifactId,
      receipt?.attestations?.artifactId,
    ]).size !== 3 ||
    !isSha256(receipt?.evidence?.checksumManifestSha256) ||
    !isSha256(receipt?.evidence?.predicateSha256) ||
    !isSha256(receipt?.evidence?.ciSha256) ||
    receipt?.evidence?.fileCount !== policy.expectedEvidenceFileCount ||
    !isSha256(receipt?.attestations?.slsaBundleSha256) ||
    !isSha256(receipt?.attestations?.bindingsBundleSha256) ||
    Object.hasOwn(
      receipt?.attestations?.offlineVerification ?? {},
      "networkDisabledForCryptographicVerification",
    )
  ) {
    throw new Error("GitHub Actions provenance receipt is not canonical.");
  }
  if (!isSha256(expectedSha256) || candidate.sha256 !== expectedSha256) {
    throw new Error("GitHub Actions provenance receipt binding mismatch.");
  }
  validateCanonicalSourceCandidateName(candidate.fileName, context);
  for (const role of ["candidate", "evidence", "attestations"]) {
    const actual = receipt?.artifacts?.[role];
    const createdAtMs = Date.parse(actual?.createdAt ?? "");
    const updatedAtMs = Date.parse(actual?.updatedAt ?? "");
    const expiresAtMs = Date.parse(actual?.expiresAt ?? "");
    const expectedName =
      role === "candidate"
        ? candidate.fileName
        : `store-source-${role}-${context.runId}-${context.runAttempt}`;
    if (
      actual?.artifactId !== receipt?.[role]?.artifactId ||
      actual?.name !== expectedName ||
      !Number.isSafeInteger(actual?.sizeBytes) ||
      actual.sizeBytes <= 0 ||
      !/^sha256:[a-f0-9]{64}$/u.test(actual?.metadataDigest ?? "") ||
      actual?.expired !== false ||
      !Number.isFinite(createdAtMs) ||
      !Number.isFinite(updatedAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      createdAtMs > updatedAtMs ||
      updatedAtMs > generatedAtMs + 5 * 60_000 ||
      expiresAtMs <= generatedAtMs
    ) {
      throw new Error(`GitHub Actions ${role} artifact receipt mismatch.`);
    }
  }
  if (
    receipt.artifacts.candidate.sizeBytes !== candidate.sizeBytes ||
    receipt.artifacts.candidate.metadataDigest !== `sha256:${candidate.sha256}`
  ) {
    throw new Error("GitHub Actions candidate artifact receipt mismatch.");
  }
  validateReceiptSigner(receipt?.attestations?.signer, context);
  return receipt;
}

export function validateProducerRunMetadata(run, context) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  if (
    String(run?.id) !== context?.runId ||
    run?.name !== policy.workflowName ||
    run?.path !== policy.workflowPath ||
    Number(run?.workflow_id) !== policy.workflowId ||
    !Number.isSafeInteger(Number(run?.run_number)) ||
    Number(run.run_number) <= 0 ||
    String(run?.run_attempt) !== context?.runAttempt ||
    run?.event !== "workflow_dispatch" ||
    run?.status !== "completed" ||
    run?.conclusion !== "success" ||
    run?.head_branch !== policy.sourceBranch ||
    run?.head_sha !== context?.sourceSha ||
    run?.head_repository?.full_name !== policy.repository ||
    Number(run?.head_repository?.id) !== policy.repositoryId ||
    run?.repository?.full_name !== policy.repository ||
    Number(run?.repository?.id) !== policy.repositoryId ||
    run?.head_commit?.id !== context?.sourceSha
  ) {
    throw new Error(
      "Source producer run metadata is not the approved successful run.",
    );
  }
  return {
    workflowId: policy.workflowId,
    workflowName: policy.workflowName,
    workflowPath: policy.workflowPath,
    runId: context.runId,
    runAttempt: context.runAttempt,
    runNumber: Number(run.run_number),
    event: run.event,
    status: run.status,
    conclusion: run.conclusion,
    headRepository: run.head_repository.full_name,
    headBranch: run.head_branch,
    headSha: run.head_sha,
  };
}

export function validateCanonicalSourceCandidateName(fileName, context) {
  if (
    typeof fileName !== "string" ||
    !isFullSha(context?.sourceSha) ||
    !isPositiveIntegerString(context?.runId) ||
    !isPositiveIntegerString(context?.runAttempt)
  ) {
    throw new Error("Canonical source candidate naming context is invalid.");
  }
  const match =
    /^JoeSSH_([0-9]+)\.([0-9]+)\.([0-9]+)\.([0-9]+)_x64_([a-f0-9]{12})_([1-9][0-9]{0,18})_([1-9][0-9]{0,18})\.msix$/u.exec(
      fileName,
    );
  const versionSegments = match?.slice(1, 5) ?? [];
  if (
    !match ||
    versionSegments.some(
      (segment) =>
        !/^(?:0|[1-9][0-9]{0,4})$/u.test(segment) ||
        Number(segment) > 65_535,
    ) ||
    match[5] !== context.sourceSha.slice(0, 12) ||
    match[6] !== context.runId ||
    match[7] !== context.runAttempt
  ) {
    throw new Error(
      "Source candidate name is not the canonical source/SHA/run/attempt-bound ASCII MSIX name.",
    );
  }
  return fileName;
}

export function validateArtifactMetadata(
  metadata,
  expected,
  context,
  now = new Date(),
) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  const createdAtMs = Date.parse(metadata?.created_at ?? "");
  const updatedAtMs = Date.parse(metadata?.updated_at ?? "");
  const expiresAtMs = Date.parse(metadata?.expires_at ?? "");
  const sizeBytes = Number(metadata?.size_in_bytes);
  const metadataDigest = metadata?.digest;
  if (
    String(metadata?.id) !== expected.artifactId ||
    metadata?.name !== expected.expectedName ||
    !Number.isSafeInteger(sizeBytes) ||
    sizeBytes <= 0 ||
    sizeBytes > expected.maximumSizeBytes ||
    (expected.expectedSizeBytes !== undefined &&
      sizeBytes !== expected.expectedSizeBytes) ||
    !/^sha256:[a-f0-9]{64}$/u.test(metadataDigest ?? "") ||
    (expected.expectedDigest !== undefined &&
      metadataDigest !== expected.expectedDigest) ||
    metadata?.expired !== false ||
    !Number.isFinite(createdAtMs) ||
    !Number.isFinite(updatedAtMs) ||
    !Number.isFinite(expiresAtMs) ||
    createdAtMs > updatedAtMs ||
    updatedAtMs > now.getTime() + 5 * 60_000 ||
    expiresAtMs <= now.getTime() ||
    String(metadata?.workflow_run?.id) !== context?.runId ||
    Number(metadata?.workflow_run?.repository_id) !== policy.repositoryId ||
    Number(metadata?.workflow_run?.head_repository_id) !==
      policy.repositoryId ||
    metadata?.workflow_run?.head_branch !== policy.sourceBranch ||
    metadata?.workflow_run?.head_sha !== context?.sourceSha
  ) {
    throw new Error(
      `GitHub Actions artifact ${expected.artifactId} metadata mismatch.`,
    );
  }
  return {
    artifactId: expected.artifactId,
    name: expected.expectedName,
    sizeBytes,
    metadataDigest,
    expired: false,
    createdAt: metadata.created_at,
    updatedAt: metadata.updated_at,
    expiresAt: metadata.expires_at,
  };
}

export function inspectApprovedGitHubCli(ghExecutablePath, runtime = {}) {
  if (typeof ghExecutablePath !== "string" || !isAbsolute(ghExecutablePath)) {
    throw new Error(
      "The GitHub CLI verifier path must be explicit and absolute.",
    );
  }
  const approved = WINDOWS_STORE_SOURCE_POLICY.githubCli;
  const executable = inspectDirectFile(
    ghExecutablePath,
    "pinned GitHub CLI verifier",
  );
  if (
    executable.fileName !== approved.executableName ||
    executable.sha256 !== approved.executableSha256 ||
    executable.sizeBytes !== approved.executableSizeBytes
  ) {
    throw new Error(
      "GitHub CLI verifier bytes do not match the approved tool.",
    );
  }

  const runVersion = runtime.runVersion ?? runGitHubCliVersion;
  const inspectSignature =
    runtime.inspectSignature ?? inspectGitHubCliAuthenticode;
  const versionLines = runVersion(executable.path);
  const signature = inspectSignature(executable.path);
  if (
    !deepEqualJson(versionLines, approved.versionLines) ||
    signature.status !== "Valid" ||
    signature.subject !== approved.signerSubject ||
    signature.thumbprint !== approved.signerThumbprint
  ) {
    throw new Error(
      "GitHub CLI verifier version or Authenticode identity mismatch.",
    );
  }
  return {
    ...executable,
    signatureStatus: signature.status,
    signerSubject: signature.subject,
    signerThumbprint: signature.thumbprint,
    version: approved.version,
    versionLines,
  };
}

export function buildOfflineGhEnvironment(
  environment = process.env,
  isolatedRoot,
) {
  if (typeof isolatedRoot !== "string" || !isAbsolute(isolatedRoot)) {
    throw new Error("The isolated GitHub CLI home must be absolute.");
  }
  const result = {};
  for (const name of [
    "ComSpec",
    "PATHEXT",
    "SystemRoot",
    "TEMP",
    "TMP",
    "WINDIR",
  ]) {
    if (typeof environment[name] === "string" && environment[name]) {
      result[name] = environment[name];
    }
  }
  return {
    ...result,
    ALL_PROXY: "http://127.0.0.1:9",
    APPDATA: isolatedRoot,
    GH_CONFIG_DIR: isolatedRoot,
    GH_PROMPT_DISABLED: "1",
    HOME: isolatedRoot,
    HTTP_PROXY: "http://127.0.0.1:9",
    HTTPS_PROXY: "http://127.0.0.1:9",
    LOCALAPPDATA: isolatedRoot,
    NO_PROXY: "",
    USERPROFILE: isolatedRoot,
  };
}

export function buildGhAttestationVerificationArgs({
  bundlePath,
  candidatePath,
  predicateType,
  trustedRootPath,
  verificationContext,
}) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  return [
    "attestation",
    "verify",
    candidatePath,
    "--bundle",
    bundlePath,
    "--custom-trusted-root",
    trustedRootPath,
    "--repo",
    policy.repository,
    "--signer-workflow",
    `${policy.repository}/${policy.workflowPath}`,
    "--source-digest",
    verificationContext.sourceSha,
    "--source-ref",
    policy.sourceRef,
    "--signer-digest",
    verificationContext.sourceSha,
    "--predicate-type",
    predicateType,
    "--deny-self-hosted-runners",
    "--format",
    "json",
  ];
}

export function removeOwnedTemporaryDirectory(
  directory,
  expectedPrefix,
  temporaryRoot = tmpdir(),
) {
  if (
    typeof directory !== "string" ||
    !isAbsolute(directory) ||
    typeof expectedPrefix !== "string" ||
    expectedPrefix.length < 8 ||
    expectedPrefix.includes("/") ||
    expectedPrefix.includes("\\") ||
    expectedPrefix.includes("\0")
  ) {
    throw new Error("Temporary cleanup boundary is invalid.");
  }
  const physicalTemporaryRoot = realpathSync.native(temporaryRoot);
  const directoryLink = lstatSync(directory);
  const physicalDirectory = realpathSync.native(directory);
  const leaf = basename(physicalDirectory);
  if (
    !directoryLink.isDirectory() ||
    directoryLink.isSymbolicLink() ||
    !isWithin(physicalTemporaryRoot, physicalDirectory) ||
    relative(physicalTemporaryRoot, dirname(physicalDirectory)) !== "" ||
    !leaf.startsWith(expectedPrefix) ||
    leaf.length <= expectedPrefix.length
  ) {
    throw new Error(
      "Refusing recursive cleanup outside an owned temp directory.",
    );
  }
  rmSync(physicalDirectory, { force: true, recursive: true });
  if (existsSync(physicalDirectory)) {
    throw new Error("Owned temp directory cleanup did not complete.");
  }
}

export function validateVerifiedAttestation(
  result,
  predicateType,
  candidate,
  verificationContext,
  now = new Date(),
) {
  if (!Array.isArray(result) || result.length !== 1) {
    throw new Error(
      "Offline attestation verification must return exactly one result.",
    );
  }
  const verification = result[0]?.verificationResult;
  const statement = verification?.statement;
  const signer = verification?.signature?.certificate;
  if (
    statement?._type !== "https://in-toto.io/Statement/v1" ||
    statement?.predicateType !== predicateType ||
    !Array.isArray(statement?.subject) ||
    statement.subject.length !== 1 ||
    statement.subject[0]?.name !== candidate?.fileName ||
    statement.subject[0]?.digest?.sha256 !== candidate?.sha256
  ) {
    throw new Error("Offline attestation subject or predicate type mismatch.");
  }
  validateSigner(signer, verificationContext);
  const timestamps = verification?.verifiedTimestamps;
  if (!Array.isArray(timestamps) || timestamps.length !== 1) {
    throw new Error(
      "Attestation must have exactly one verified transparency timestamp.",
    );
  }
  const timestampMs = Date.parse(timestamps[0]?.timestamp ?? "");
  if (
    timestamps[0]?.type !== "Tlog" ||
    timestamps[0]?.uri !== "https://rekor.sigstore.dev" ||
    !Number.isFinite(timestampMs) ||
    timestampMs > now.getTime()
  ) {
    throw new Error("Attestation transparency timestamp is invalid.");
  }
  return {
    signer: selectSigner(signer),
    statement,
    transparencyLog: {
      type: timestamps[0].type,
      uri: timestamps[0].uri,
      timestamp: timestamps[0].timestamp,
    },
  };
}

function validateSigner(signer, context) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  const workflowIdentity = `https://github.com/${policy.repository}/${policy.workflowPath}@${policy.sourceRef}`;
  const expected = {
    subjectAlternativeName: workflowIdentity,
    issuer: "https://token.actions.githubusercontent.com",
    githubWorkflowTrigger: "workflow_dispatch",
    githubWorkflowSHA: context.sourceSha,
    githubWorkflowName: policy.workflowName,
    githubWorkflowRepository: policy.repository,
    githubWorkflowRef: policy.sourceRef,
    buildSignerURI: workflowIdentity,
    buildSignerDigest: context.sourceSha,
    runnerEnvironment: "github-hosted",
    sourceRepositoryURI: `https://github.com/${policy.repository}`,
    sourceRepositoryDigest: context.sourceSha,
    sourceRepositoryRef: policy.sourceRef,
    sourceRepositoryIdentifier: String(policy.repositoryId),
    sourceRepositoryOwnerURI: `https://github.com/${policy.repositoryOwner}`,
    sourceRepositoryOwnerIdentifier: String(policy.repositoryOwnerId),
    buildConfigURI: workflowIdentity,
    buildConfigDigest: context.sourceSha,
    buildTrigger: "workflow_dispatch",
    runInvocationURI: `https://github.com/${policy.repository}/actions/runs/${context.runId}/attempts/${context.runAttempt}`,
    sourceRepositoryVisibilityAtSigning: "public",
  };
  if (
    !signer ||
    typeof signer !== "object" ||
    Object.entries(expected).some(([key, value]) => signer[key] !== value)
  ) {
    throw new Error(
      "Attestation signing certificate producer identity mismatch.",
    );
  }
}

function selectSigner(signer) {
  return {
    subjectAlternativeName: signer.subjectAlternativeName,
    issuer: signer.issuer,
    workflowName: signer.githubWorkflowName,
    workflowRepository: signer.githubWorkflowRepository,
    workflowRef: signer.githubWorkflowRef,
    workflowSha: signer.githubWorkflowSHA,
    runInvocationURI: signer.runInvocationURI,
    runnerEnvironment: signer.runnerEnvironment,
  };
}

function validateReceiptSigner(signer, context) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  if (
    signer?.subjectAlternativeName !==
      `https://github.com/${policy.repository}/${policy.workflowPath}@${policy.sourceRef}` ||
    signer?.issuer !== "https://token.actions.githubusercontent.com" ||
    signer?.workflowName !== policy.workflowName ||
    signer?.workflowRepository !== policy.repository ||
    signer?.workflowRef !== policy.sourceRef ||
    signer?.workflowSha !== context.sourceSha ||
    signer?.runInvocationURI !==
      `https://github.com/${policy.repository}/actions/runs/${context.runId}/attempts/${context.runAttempt}` ||
    signer?.runnerEnvironment !== "github-hosted"
  ) {
    throw new Error("Provenance receipt signer identity mismatch.");
  }
}

function validateSlsaPredicate(predicate, context) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  const workflow = predicate?.buildDefinition?.externalParameters?.workflow;
  const internal = predicate?.buildDefinition?.internalParameters?.github;
  const dependencies = predicate?.buildDefinition?.resolvedDependencies;
  if (
    predicate?.buildDefinition?.buildType !==
      "https://actions.github.io/buildtypes/workflow/v1" ||
    workflow?.path !== policy.workflowPath ||
    workflow?.ref !== policy.sourceRef ||
    workflow?.repository !== `https://github.com/${policy.repository}` ||
    internal?.event_name !== "workflow_dispatch" ||
    internal?.repository_id !== String(policy.repositoryId) ||
    internal?.repository_owner_id !== String(policy.repositoryOwnerId) ||
    internal?.runner_environment !== "github-hosted" ||
    !Array.isArray(dependencies) ||
    dependencies.length !== 1 ||
    dependencies[0]?.uri !==
      `git+https://github.com/${policy.repository}@${policy.sourceRef}` ||
    dependencies[0]?.digest?.gitCommit !== context.sourceSha ||
    predicate?.runDetails?.builder?.id !==
      `https://github.com/${policy.repository}/${policy.workflowPath}@${policy.sourceRef}` ||
    predicate?.runDetails?.metadata?.invocationId !==
      `https://github.com/${policy.repository}/actions/runs/${context.runId}/attempts/${context.runAttempt}`
  ) {
    throw new Error("SLSA provenance producer or source binding mismatch.");
  }
}

function verifyEvidenceTree(directory) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  const files = listDirectRegularTree(directory, "source evidence");
  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  const checksumManifest = byPath.get("SHA256SUMS.txt");
  if (!checksumManifest) {
    throw new Error("Source evidence checksum manifest is missing.");
  }
  const lines = readFileSync(checksumManifest.path, "ascii").split(/\r?\n/u);
  if (lines.at(-1) !== "") {
    throw new Error(
      "Source evidence checksum manifest must end with one newline.",
    );
  }
  lines.pop();
  const expectedPaths = new Set();
  let previousPath = "";
  for (const line of lines) {
    const match = /^([a-f0-9]{64})[ ]{2}([^\0\r\n]+)$/u.exec(line);
    if (
      !match ||
      !isSafeRelativePath(match[2]) ||
      expectedPaths.has(match[2]) ||
      (previousPath !== "" &&
        previousPath.localeCompare(match[2], "en") >= 0)
    ) {
      throw new Error("Source evidence checksum manifest is not canonical.");
    }
    expectedPaths.add(match[2]);
    previousPath = match[2];
    const file = byPath.get(match[2]);
    if (!file || file.sha256 !== match[1]) {
      throw new Error(`Source evidence digest mismatch: ${match[2]}`);
    }
  }
  if (
    byPath.size !== expectedPaths.size + 1 ||
    [...byPath.keys()].some(
      (path) => path !== "SHA256SUMS.txt" && !expectedPaths.has(path),
    )
  ) {
    throw new Error("Source evidence tree contains an unlisted file.");
  }
  const predicateFile = byPath.get("predicate.json");
  const ciFile = byPath.get("ci.json");
  if (
    !predicateFile ||
    !ciFile ||
    files.length !== policy.expectedEvidenceFileCount
  ) {
    throw new Error("Source predicate, CI evidence, or evidence file count mismatch.");
  }
  const predicate = readJson(predicateFile.path, "source build predicate");
  const ci = readJson(ciFile.path, "source CI evidence");
  if (!deepEqualJson(predicate.ci, ci)) {
    throw new Error("Source predicate CI evidence does not match ci.json.");
  }
  return {
    checksumManifest,
    ciFile,
    fileCount: files.length,
    predicate,
    predicateFile,
  };
}

export function validateBindingsPredicate(predicate, context) {
  const policy = WINDOWS_STORE_SOURCE_POLICY;
  if (
    predicate?.schemaVersion !== 1 ||
    predicate?.source?.repository !== policy.repository ||
    predicate?.source?.sha !== context.sourceSha ||
    predicate?.source?.ref !== policy.sourceRef ||
    predicate?.builder?.workflow !== policy.workflowPath ||
    predicate?.builder?.runId !== context.runId ||
    predicate?.builder?.runAttempt !== context.runAttempt ||
    predicate?.builder?.environment !== policy.protectedEnvironment ||
    predicate?.artifact?.path !== context.candidate.fileName ||
    predicate?.artifact?.sha256 !== context.candidate.sha256 ||
    predicate?.artifact?.sizeBytes !== context.candidate.sizeBytes ||
    predicate?.ci?.sourceSha !== context.sourceSha ||
    predicate?.ci?.producerRunId !== context.runId ||
    predicate?.ci?.producerRunAttempt !== context.runAttempt ||
    !Array.isArray(predicate?.ci?.jobs) ||
    predicate.ci.jobs.length !== policy.expectedCiJobCount ||
    predicate.ci.jobs.some((job) => job?.conclusion !== "success") ||
    predicate?.ci?.stageB?.humanApprovalVerified !== true ||
    predicate?.ci?.stageB?.protectedBranchesOnly !== true ||
    predicate?.ci?.stageB?.adminBypassDisabled !== true ||
    predicate?.validation?.makeAppxPackAndUnpack !== true ||
    predicate?.validation?.byteExactPayloadRoundTrip !== true ||
    predicate?.validation?.allStoreSurfaceChecks !== true ||
    predicate?.validation?.embeddedRtManifestMtStrict !== true ||
    predicate?.validation?.embeddedRtManifestRawByteExact !== true ||
    predicate?.validation?.blockedProcessLaunchApiNamesAndNamedImportsAbsent !==
      true ||
    predicate?.publication?.storePublicationReady !== false ||
    predicate?.publication?.partnerCenterUpload !== "not-performed" ||
    predicate?.publication?.storeCertification !== "not-performed"
  ) {
    throw new Error(
      "Signed source build predicate is outside the approved boundary.",
    );
  }
}

function verifyAttestationTree(directory) {
  const files = listDirectRegularTree(directory, "source attestations");
  if (
    files.length !== 2 ||
    files.some((file) => file.relativePath.includes("/"))
  ) {
    throw new Error(
      "Source attestation artifact must contain exactly two files.",
    );
  }
  const byPath = new Map(files.map((file) => [file.relativePath, file]));
  const slsa = byPath.get("slsa.sigstore.json");
  const bindings = byPath.get("bindings.sigstore.json");
  if (!slsa || !bindings) {
    throw new Error("Source attestation bundle set is incomplete.");
  }
  return { bindings, slsa };
}

function runGhAttestationVerification({
  bundlePath,
  candidatePath,
  ghExecutablePath,
  predicateType,
  trustedRootPath,
  verificationContext,
}) {
  const isolatedRoot = mkdtempSync(
    resolve(tmpdir(), OFFLINE_VERIFICATION_TEMP_PREFIX),
  );
  try {
    const result = spawnSync(
      ghExecutablePath,
      buildGhAttestationVerificationArgs({
        bundlePath,
        candidatePath,
        predicateType,
        trustedRootPath,
        verificationContext,
      }),
      {
        encoding: "utf8",
        env: buildOfflineGhEnvironment(process.env, isolatedRoot),
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 2 * 60_000,
        windowsHide: true,
      },
    );
    if (result.error || result.status !== 0) {
      throw new Error(
        `Offline Sigstore verification failed: ${[
          result.error?.message,
          result.stderr,
          result.stdout,
        ]
          .filter(Boolean)
          .join("\n")}`,
      );
    }
    try {
      return JSON.parse(result.stdout.replace(/^\uFEFF/u, ""));
    } catch (error) {
      throw new Error("Offline Sigstore verifier returned invalid JSON.", {
        cause: error,
      });
    }
  } finally {
    removeOwnedTemporaryDirectory(
      isolatedRoot,
      OFFLINE_VERIFICATION_TEMP_PREFIX,
    );
  }
}

function runGitHubCliVersion(ghExecutablePath) {
  const isolatedRoot = mkdtempSync(resolve(tmpdir(), GH_VERSION_TEMP_PREFIX));
  try {
    const result = spawnSync(ghExecutablePath, ["--version"], {
      encoding: "utf8",
      env: buildOfflineGhEnvironment(process.env, isolatedRoot),
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    });
    if (result.error || result.status !== 0 || result.stderr) {
      throw new Error("Unable to read the pinned GitHub CLI version.");
    }
    return result.stdout.trimEnd().split(/\r?\n/u);
  } finally {
    removeOwnedTemporaryDirectory(isolatedRoot, GH_VERSION_TEMP_PREFIX);
  }
}

function inspectGitHubCliAuthenticode(ghExecutablePath) {
  if (process.platform !== "win32") {
    throw new Error("GitHub CLI Authenticode verification requires Windows.");
  }
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  if (!systemRoot) {
    throw new Error("Windows system root is unavailable.");
  }
  const powershell = realpathSync.native(
    resolve(systemRoot, "System32/WindowsPowerShell/v1.0/powershell.exe"),
  );
  const script = [
    '$ErrorActionPreference = "Stop"',
    "$signature = Get-AuthenticodeSignature -LiteralPath $env:JOESSH_GH_EXECUTABLE",
    "[ordered]@{ status = [string]$signature.Status; subject = [string]$signature.SignerCertificate.Subject; thumbprint = [string]$signature.SignerCertificate.Thumbprint } | ConvertTo-Json -Compress",
  ].join("; ");
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
    {
      encoding: "utf8",
      env: {
        ...buildOfflineGhEnvironment(process.env, dirname(ghExecutablePath)),
        JOESSH_GH_EXECUTABLE: ghExecutablePath,
      },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result.error || result.status !== 0 || result.stderr) {
    throw new Error("Unable to verify the GitHub CLI Authenticode signature.");
  }
  let signature;
  try {
    signature = JSON.parse(result.stdout.replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error("GitHub CLI Authenticode result is invalid.", {
      cause: error,
    });
  }
  return {
    status: signature.status,
    subject: signature.subject,
    thumbprint: String(signature.thumbprint ?? "").toUpperCase(),
  };
}

async function getGitHubJsonFromApi(apiPath, token) {
  if (typeof token !== "string" || token.trim().length < 20) {
    throw new Error(
      "A job-scoped GitHub token with only actions:read is required for live artifact metadata.",
    );
  }
  const response = await fetch(`https://api.github.com${apiPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "JoeSSH-Windows-Store-source-verifier",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Unable to read GitHub Actions source metadata at ${apiPath}: HTTP ${response.status}.`,
    );
  }
  return response.json();
}

function normalizeOptions(raw) {
  const root = resolve(raw?.root ?? repositoryRoot);
  return {
    artifactSourceSha: String(raw?.artifactSourceSha ?? "").toLowerCase(),
    attestationsArtifactId: String(raw?.attestationsArtifactId ?? ""),
    attestationsDirectory: resolve(String(raw?.attestationsDirectory ?? "")),
    candidateArtifactId: String(raw?.candidateArtifactId ?? ""),
    candidatePath: resolve(String(raw?.candidatePath ?? "")),
    evidenceArtifactId: String(raw?.evidenceArtifactId ?? ""),
    evidenceDirectory: resolve(String(raw?.evidenceDirectory ?? "")),
    expectedSha256: String(raw?.expectedSha256 ?? "").toLowerCase(),
    ghExecutablePath: String(raw?.ghExecutablePath ?? ""),
    githubToken: raw?.githubToken ?? process.env.GITHUB_TOKEN ?? "",
    outputPath: resolve(String(raw?.outputPath ?? "")),
    producerRunAttempt: String(raw?.producerRunAttempt ?? ""),
    producerRunId: String(raw?.producerRunId ?? ""),
    reviewedSha: String(raw?.reviewedSha ?? "").toLowerCase(),
    root,
    trustedRootPath: resolve(root, TRUSTED_ROOT_RELATIVE_PATH),
  };
}

function assertApprovedInputs(options) {
  if (
    !isFullSha(options.artifactSourceSha) ||
    options.reviewedSha !== options.artifactSourceSha ||
    !isSha256(options.expectedSha256)
  ) {
    throw new Error(
      "Artifact source SHA must exactly equal the reviewed SHA, and the candidate SHA must be valid.",
    );
  }
  const selectors = [
    options.producerRunId,
    options.producerRunAttempt,
    options.candidateArtifactId,
    options.evidenceArtifactId,
    options.attestationsArtifactId,
  ];
  if (
    selectors.some((value) => !isPositiveIntegerString(value)) ||
    new Set(selectors.slice(2)).size !== 3
  ) {
    throw new Error(
      "Producer run, attempt, and three distinct artifact IDs must be positive decimal integers.",
    );
  }
  if (!isAbsolute(options.ghExecutablePath)) {
    throw new Error("The approved GitHub CLI verifier path must be absolute.");
  }
  if (
    !options.candidatePath ||
    !options.evidenceDirectory ||
    !options.attestationsDirectory ||
    !options.outputPath
  ) {
    throw new Error(
      "Candidate, evidence, attestations, and output paths are required.",
    );
  }
  const physicalRoot = realpathSync.native(options.root);
  const physicalTrustedRoot = realpathSync.native(options.trustedRootPath);
  if (!isWithin(physicalRoot, physicalTrustedRoot)) {
    throw new Error(
      "Pinned Sigstore trusted root escaped the verifier checkout.",
    );
  }
}

function inspectDirectFile(path, label) {
  let link;
  let stat;
  try {
    link = lstatSync(path);
    stat = statSync(path);
  } catch (error) {
    throw new Error(`Unable to read ${label}.`, { cause: error });
  }
  if (
    !link.isFile() ||
    link.isSymbolicLink() ||
    (link.mode & 0o170000) !== 0o100000 ||
    stat.nlink !== 1 ||
    stat.size <= 0
  ) {
    throw new Error(`${label} must be one nonempty direct regular file.`);
  }
  const before = stat;
  const bytes = readFileSync(path);
  const after = statSync(path);
  if (!sameFile(before, after) || bytes.length !== after.size) {
    throw new Error(`${label} changed while it was hashed.`);
  }
  return {
    fileName: basename(path),
    path: realpathSync.native(path),
    sha256: sha256(bytes),
    sizeBytes: bytes.length,
  };
}

function listDirectRegularTree(root, label) {
  const physicalRoot = realpathSync.native(root);
  const rootLink = lstatSync(root);
  if (!rootLink.isDirectory() || rootLink.isSymbolicLink()) {
    throw new Error(`${label} root must be a direct directory.`);
  }
  const files = [];
  const pending = [physicalRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    const entries = readdirSync(current, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name, "en"),
    );
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      const link = lstatSync(path);
      if (entry.isSymbolicLink() || link.isSymbolicLink()) {
        throw new Error(`${label} contains a symbolic link or reparse point.`);
      }
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (!entry.isFile()) {
        throw new Error(`${label} contains a non-regular entry.`);
      }
      const physical = realpathSync.native(path);
      if (!isWithin(physicalRoot, physical)) {
        throw new Error(`${label} file escaped its root.`);
      }
      const inspected = inspectDirectFile(physical, `${label} file`);
      const relativePath = relative(physicalRoot, physical).replaceAll(
        "\\",
        "/",
      );
      if (!isSafeRelativePath(relativePath)) {
        throw new Error(`${label} contains an unsafe relative path.`);
      }
      files.push({ ...inspected, relativePath });
    }
  }
  files.sort((a, b) => a.relativePath.localeCompare(b.relativePath, "en"));
  return files;
}

function isSafeRelativePath(path) {
  return (
    typeof path === "string" &&
    path.length > 0 &&
    path.length <= 512 &&
    !isAbsolute(path) &&
    !path.includes("\\") &&
    !path.includes("\0") &&
    !path.includes(":") &&
    !path.startsWith("/") &&
    path
      .split("/")
      .every((segment) => segment && segment !== "." && segment !== "..")
  );
}

function writeReceipt(path, receipt) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true });
  if (existsSync(path)) {
    throw new Error("Refusing to overwrite a provenance receipt.");
  }
  const temporaryPath = resolve(
    directory,
    `.${basename(path)}.${process.pid}.${Date.now()}.tmp`,
  );
  writeFileSync(temporaryPath, `${JSON.stringify(receipt, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  renameSync(temporaryPath, path);
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/u, ""));
  } catch (error) {
    throw new Error(`Unable to parse ${label}.`, { cause: error });
  }
}

function deepEqualJson(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sameFile(left, right) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isFullSha(value) {
  return typeof value === "string" && /^[a-f0-9]{40}$/u.test(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

function isPositiveIntegerString(value) {
  return (
    typeof value === "string" &&
    /^(?:[1-9][0-9]{0,18})$/u.test(value) &&
    Number.isSafeInteger(Number(value))
  );
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return (
    path === "" ||
    (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))
  );
}

export function parseSourceArtifactArgs(args, environment = process.env) {
  const values = new Map();
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const separator = arg.indexOf("=");
    const flag = separator === -1 ? arg : arg.slice(0, separator);
    const inlineValue = separator === -1 ? undefined : arg.slice(separator + 1);
    const allowed = new Set([
      "--artifact-source-sha",
      "--attestations-artifact-id",
      "--attestations-directory",
      "--candidate",
      "--candidate-artifact-id",
      "--evidence-artifact-id",
      "--evidence-directory",
      "--expected-sha256",
      "--gh-executable",
      "--output",
      "--producer-run-attempt",
      "--producer-run-id",
      "--reviewed-sha",
      "--root",
    ]);
    if (!allowed.has(flag) || values.has(flag)) {
      throw new Error(`Unknown or repeated argument: ${flag}`);
    }
    const value = inlineValue ?? args[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`${flag} requires a value.`);
    }
    if (inlineValue === undefined) index += 1;
    values.set(flag, value);
  }
  const required = [
    "--artifact-source-sha",
    "--attestations-artifact-id",
    "--attestations-directory",
    "--candidate",
    "--candidate-artifact-id",
    "--evidence-artifact-id",
    "--evidence-directory",
    "--expected-sha256",
    "--gh-executable",
    "--output",
    "--producer-run-attempt",
    "--producer-run-id",
    "--reviewed-sha",
  ];
  if (required.some((flag) => !values.has(flag))) {
    throw new Error(`Required arguments: ${required.join(", ")}.`);
  }
  if (!isAbsolute(values.get("--gh-executable"))) {
    throw new Error("--gh-executable must be an explicit absolute path.");
  }
  return {
    artifactSourceSha: values.get("--artifact-source-sha"),
    attestationsArtifactId: values.get("--attestations-artifact-id"),
    attestationsDirectory: values.get("--attestations-directory"),
    candidateArtifactId: values.get("--candidate-artifact-id"),
    candidatePath: values.get("--candidate"),
    evidenceArtifactId: values.get("--evidence-artifact-id"),
    evidenceDirectory: values.get("--evidence-directory"),
    expectedSha256: values.get("--expected-sha256"),
    ghExecutablePath: values.get("--gh-executable"),
    githubToken: environment.GITHUB_TOKEN ?? "",
    outputPath: values.get("--output"),
    producerRunAttempt: values.get("--producer-run-attempt"),
    producerRunId: values.get("--producer-run-id"),
    reviewedSha: values.get("--reviewed-sha"),
    root: values.get("--root") ?? repositoryRoot,
  };
}

async function main() {
  try {
    const receipt = await verifyWindowsStoreSourceArtifacts(
      parseSourceArtifactArgs(process.argv.slice(2)),
    );
    console.log(
      `Verified source run ${receipt.producer.runId}, artifact ${receipt.candidate.artifactId}, and both offline Sigstore bundles.`,
    );
  } catch (error) {
    console.error(
      `Windows Store source artifact verification error: ${error instanceof Error ? error.message : "Unknown failure."}`,
    );
    process.exitCode = 2;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
) {
  await main();
}
