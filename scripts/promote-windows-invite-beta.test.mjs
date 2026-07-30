import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const SCRIPT_PATH = resolve(
  import.meta.dirname,
  "promote-windows-invite-beta.mjs",
);
const UNSIGNED_PE_PATH = resolve(
  import.meta.dirname,
  "../node_modules/fb-dotslash/bin/windows/dotslash.exe",
);
const VERSION = "0.1.0-beta.9";
const gitHead = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: resolve(import.meta.dirname, ".."),
  encoding: "utf8",
  windowsHide: true,
});
assert.equal(gitHead.status, 0, gitHead.stderr);
const COMMIT = gitHead.stdout.trim();
const windowsOnly = { skip: process.platform !== "win32" };

test(
  "promotes a PE, attestation, external anchors, and clean native smoke into Stage A approval",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t);
    const result = runPromoter(fixture);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /3-5 trusted technical testers/);

    const approval = readJson(join(fixture.candidateDir, "invite-ready.json"));
    const approvalChecksums = readFileSync(
      join(fixture.candidateDir, "INVITE-READY-SHA256SUMS.txt"),
      "ascii",
    );
    assert.equal(approval.inviteDistributionReady, true);
    assert.equal(approval.publicReleaseEvidence, false);
    assert.equal(approval.releaseEligible, false);
    assert.equal(approval.artifact.sha256, fixture.artifactSha256);
    assert.equal(approval.externalReviewAnchor.reviewedCommit, COMMIT);
    assert.equal(
      approval.externalReviewAnchor.expectedArtifactSha256,
      fixture.artifactSha256,
    );
    assert.match(approvalChecksums, /invite-ready\.json/);
    assert.match(approvalChecksums, /native-smoke\.json/);
  },
);

test("rejects native evidence with an open P1", windowsOnly, (t) => {
  const fixture = createFixture(t, { evidence: { openP1: 1 } });
  const result = runPromoter(fixture);

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /incomplete, unbound, not clean, or has an open P0\/P1/,
  );
});

test(
  "rejects native evidence that is bound to another artifact",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t, {
      evidence: {
        candidate: {
          artifactSha256: "f".repeat(64),
          commit: COMMIT,
          version: VERSION,
        },
      },
    });
    const result = runPromoter(fixture);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /incomplete, unbound/);
  },
);

test("rejects a handoff file changed after packaging", windowsOnly, (t) => {
  const fixture = createFixture(t);
  writeFileSync(
    join(fixture.candidateDir, "signature-verification.txt"),
    "tampered\n",
  );
  const result = runPromoter(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /HANDOFF-SHA256SUMS\.txt contains an unexpected/);
});

test(
  "rejects a text file renamed to an installer even with matching manifests",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t, { textArtifact: true });
    const result = runPromoter(fixture);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /not a valid Windows PE installer/);
  },
);

test("rejects a forged or incomplete build attestation", windowsOnly, (t) => {
  const fixture = createFixture(t, {
    attestation: { sourceTreeClean: false },
  });
  const result = runPromoter(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Build attestation does not fully bind/);
});

test("rejects signature evidence that claims a signer", windowsOnly, (t) => {
  const fixture = createFixture(t, {
    signatureEvidence: [
      "Authenticode status: Valid",
      "Status message: Signed",
      "Signer subject: CN=Untrusted",
      "Signer thumbprint: 00",
      "Timestamp subject: none",
      "Timestamp thumbprint: none",
      "",
    ].join("\n"),
  });
  const result = runPromoter(fixture);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /does not prove an unsigned Stage A installer/);
});

test(
  "rejects duplicate SHA256SUMS entries even when the hashes match",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t);
    writeFileSync(
      join(fixture.candidateDir, "SHA256SUMS.txt"),
      `${fixture.artifactSha256}  ${fixture.artifactFileName}\n${fixture.artifactSha256}  ${fixture.artifactFileName}\n`,
      "ascii",
    );
    rewriteHandoffChecksum(fixture.candidateDir, fixture.artifactFileName);
    const result = runPromoter(fixture);

    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not cover the exact expected file set/);
  },
);

test(
  "requires independent full commit and artifact SHA anchors",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t);
    const missing = spawnSync(
      process.execPath,
      [SCRIPT_PATH, "--candidate-dir", fixture.candidateDir],
      {
        cwd: fixture.root,
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /--reviewed-sha must be a full/);

    const wrongHash = runPromoter(fixture, {
      expectedArtifactSha256: "f".repeat(64),
    });
    assert.equal(wrongHash.status, 1);
    assert.match(
      wrongHash.stderr,
      /does not bind the reviewed Stage A installer/,
    );
  },
);

test("rejects candidate directories outside reports/handoff", (t) => {
  const outsideRoot = mkdtempSync(
    join(tmpdir(), "joessh-windows-promotion-outside-"),
  );
  t.after(() => rmSync(outsideRoot, { force: true, recursive: true }));
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--candidate-dir",
      outsideRoot,
      "--reviewed-sha",
      COMMIT,
      "--expected-artifact-sha256",
      "f".repeat(64),
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      encoding: "utf8",
      windowsHide: true,
    },
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /must stay inside|must be a direct child/);
});

test(
  "rejects linked candidate directories inside handoff",
  windowsOnly,
  (t) => {
    const fixture = createFixture(t);
    const linkedCandidate = `${fixture.candidateDir}-link`;
    try {
      symlinkSync(fixture.candidateDir, linkedCandidate, "junction");
    } catch (error) {
      t.skip(`Junction creation is unavailable: ${String(error)}`);
      return;
    }
    t.after(() => rmSync(linkedCandidate, { force: true, recursive: true }));

    const result = spawnSync(
      process.execPath,
      [
        SCRIPT_PATH,
        "--candidate-dir",
        linkedCandidate,
        "--reviewed-sha",
        COMMIT,
        "--expected-artifact-sha256",
        fixture.artifactSha256,
      ],
      {
        cwd: fixture.root,
        encoding: "utf8",
        windowsHide: true,
      },
    );

    assert.equal(result.status, 1);
    assert.match(result.stderr, /Linked candidate paths are not allowed/);
  },
);

test("rejects a linked installer input", windowsOnly, (t) => {
  const fixture = createFixture(t);
  const externalArtifact = `${fixture.candidateDir}-linked-source.exe`;
  copyFileSync(fixture.artifactPath, externalArtifact);
  t.after(() => rmSync(externalArtifact, { force: true }));
  unlinkSync(fixture.artifactPath);
  try {
    symlinkSync(externalArtifact, fixture.artifactPath, "file");
  } catch (error) {
    copyFileSync(externalArtifact, fixture.artifactPath);
    t.skip(`File symlink creation is unavailable: ${String(error)}`);
    return;
  }

  const result = runPromoter(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /only direct, regular files|single-link file/);
});

test("rejects a hard-linked installer input", windowsOnly, (t) => {
  const fixture = createFixture(t);
  const externalArtifact = `${fixture.candidateDir}-hardlink-source.exe`;
  copyFileSync(fixture.artifactPath, externalArtifact);
  t.after(() => rmSync(externalArtifact, { force: true }));
  unlinkSync(fixture.artifactPath);
  linkSync(externalArtifact, fixture.artifactPath);

  const result = runPromoter(fixture);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /single-link file/);
});

function createFixture(t, overrides = {}) {
  assert.equal(
    existsSync(UNSIGNED_PE_PATH),
    true,
    "The Windows dotslash PE fixture must be installed by npm ci.",
  );
  const root = resolve(import.meta.dirname, "..");
  const handoffRoot = join(
    root,
    "reports",
    "handoff",
    "desktop",
    "windows-invite",
  );
  mkdirSync(handoffRoot, { recursive: true });
  const fixtureRoot = mkdtempSync(join(handoffRoot, "promotion-test-"));
  t.after(() => rmSync(fixtureRoot, { force: true, recursive: true }));

  const sourceFileName = `JoeSSH_${VERSION}_x64-setup.exe`;
  const artifactFileName = `JoeSSH_${VERSION}_x64-setup-UNSIGNED-INTERNAL-ONLY.exe`;
  const artifactPath = join(fixtureRoot, artifactFileName);
  if (overrides.textArtifact) {
    writeFileSync(artifactPath, "stage-a installer");
  } else {
    copyFileSync(UNSIGNED_PE_PATH, artifactPath);
  }
  const artifactSha256 = sha256File(artifactPath);
  const artifactSize = statSync(artifactPath).size;
  const peMachine = overrides.textArtifact
    ? "x64"
    : inspectPeMachine(readFileSync(artifactPath));
  writeFileSync(
    join(fixtureRoot, "SHA256SUMS.txt"),
    `${artifactSha256}  ${artifactFileName}\n`,
    "ascii",
  );

  const baseAttestation = {
    schemaVersion: 1,
    kind: "windows-invite-build-attestation",
    generatedAt: "2026-07-29T09:01:00.000Z",
    startedAt: "2026-07-29T09:00:00.000Z",
    platform: "windows",
    architecture: "x64",
    bundleTarget: "nsis",
    version: VERSION,
    commit: COMMIT,
    gitExecutable: "C:/Program Files/Git/cmd/git.exe",
    gitVersion: "git version 2.50.1.windows.1",
    sourceTreeClean: true,
    artifact: {
      fileName: sourceFileName,
      path: `apps/desktop/src-tauri/target/release/bundle/nsis/${sourceFileName}`,
      sizeBytes: artifactSize,
      sha256: artifactSha256,
      peMachine,
    },
  };
  const attestation = {
    ...baseAttestation,
    ...(overrides.attestation ?? {}),
    artifact: {
      ...baseAttestation.artifact,
      ...(overrides.attestation?.artifact ?? {}),
    },
  };
  writeJson(join(fixtureRoot, "build-attestation.json"), attestation);

  const authenticode = {
    status: "NotSigned",
    statusMessage: "The file is not digitally signed.",
    signerThumbprint: null,
    signerSubject: null,
    timeStamperThumbprint: null,
    timeStamperSubject: null,
  };
  const candidate = {
    schemaVersion: 1,
    generatedAt: "2026-07-29T09:02:00.000Z",
    stage: "A",
    state: "internal-unsigned-staging",
    decision: "internal-staging-only",
    distribution: "invite-only",
    publicReleaseEvidence: false,
    releaseEligible: false,
    inviteDistributionReady: false,
    nativeSmokeRequired: true,
    platform: "windows",
    version: VERSION,
    commit: COMMIT,
    artifactCommitBinding: "build-attestation",
    bundleMetadata: {
      identifier: "dev.atlasterm.joessh",
      productName: "JoeSSH",
      publisher: "JoeSSH Project",
    },
    verificationTools: {
      git: {
        path: "C:/Program Files/Git/cmd/git.exe",
        version: "git version 2.50.1.windows.1",
      },
      powershell: {
        path: "C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe",
        version: "5.1.26100.4652",
      },
    },
    sourceArtifact: `apps/desktop/src-tauri/target/release/bundle/nsis/${sourceFileName}`,
    artifact: {
      fileName: artifactFileName,
      path: `reports/handoff/desktop/windows-invite/test/${artifactFileName}`,
      sizeBytes: artifactSize,
      sha256: artifactSha256,
      peMachine,
    },
    authenticode,
    evidence: {
      checksum: "SHA256SUMS.txt",
      handoffChecksum: "HANDOFF-SHA256SUMS.txt",
      buildAttestation: "build-attestation.json",
      signatureVerification: "signature-verification.txt",
      nativeSmoke: null,
    },
    boundary:
      "Private Stage A handoff; native smoke required before distribution.",
  };
  writeJson(join(fixtureRoot, "candidate.json"), candidate);
  writeFileSync(
    join(fixtureRoot, "signature-verification.txt"),
    overrides.signatureEvidence ??
      [
        "Authenticode status: NotSigned",
        "Status message: The file is not digitally signed.",
        "Signer subject: none",
        "Signer thumbprint: none",
        "Timestamp subject: none",
        "Timestamp thumbprint: none",
        "",
      ].join("\n"),
    "utf8",
  );
  rewriteHandoffChecksum(fixtureRoot, artifactFileName);

  const evidence = mergeEvidence(
    {
      schemaVersion: 1,
      candidate: {
        version: VERSION,
        commit: COMMIT,
        artifactSha256,
      },
      testerId: "tester-03",
      testedAt: "2026-07-29T10:00:00.000Z",
      windows: {
        version: "Windows 11",
        build: "26100",
        webview2Version: "138.0.3351.121",
        scalePercent: 125,
      },
      environment: {
        isolated: true,
        productionCredentialsUsed: false,
      },
      defender: {
        status: "clean",
        artifactSha256,
        engineVersion: "1.1.25070.2",
        definitionVersion: "1.437.100.0",
        scannedAt: "2026-07-29T09:55:00.000Z",
      },
      checks: {
        install: true,
        firstLaunch: true,
        restart: true,
        uninstallOrRollback: true,
        settingsPersistence: true,
        unknownHostKey: true,
        changedHostKeyBlocked: true,
        pty: true,
        sftp: true,
        portForwarding: true,
      },
      openP0: 0,
      openP1: 0,
      redactionConfirmed: true,
      sensitiveDataIncluded: false,
    },
    overrides.evidence ?? {},
  );
  writeJson(join(fixtureRoot, "native-smoke.json"), evidence);

  return {
    artifactFileName,
    artifactPath,
    artifactSha256,
    candidateDir: fixtureRoot,
    root,
  };
}

function rewriteHandoffChecksum(candidateDir, artifactFileName) {
  const handoffFiles = [
    artifactFileName,
    "SHA256SUMS.txt",
    "candidate.json",
    "build-attestation.json",
    "signature-verification.txt",
  ];
  writeFileSync(
    join(candidateDir, "HANDOFF-SHA256SUMS.txt"),
    `${handoffFiles
      .map(
        (fileName) =>
          `${sha256File(join(candidateDir, fileName))}  ${fileName}`,
      )
      .join("\n")}\n`,
    "ascii",
  );
}

function runPromoter(fixture, overrides = {}) {
  return spawnSync(
    process.execPath,
    [
      SCRIPT_PATH,
      "--candidate-dir",
      fixture.candidateDir,
      "--reviewed-sha",
      overrides.reviewedSha ?? COMMIT,
      "--expected-artifact-sha256",
      overrides.expectedArtifactSha256 ?? fixture.artifactSha256,
    ],
    {
      cwd: fixture.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
}

function inspectPeMachine(data) {
  assert.equal(data.readUInt16LE(0), 0x5a4d);
  const peOffset = data.readUInt32LE(0x3c);
  assert.equal(
    data.subarray(peOffset, peOffset + 4).toString("hex"),
    "50450000",
  );
  const machineCode = data.readUInt16LE(peOffset + 4);
  if (machineCode === 0x014c) return "x86-nsis-bootstrapper";
  if (machineCode === 0x8664) return "x64";
  throw new Error(`Unsupported fixture PE machine: ${machineCode}`);
}

function mergeEvidence(base, overrides) {
  return {
    ...base,
    ...overrides,
    candidate: {
      ...base.candidate,
      ...overrides.candidate,
    },
    checks: {
      ...base.checks,
      ...overrides.checks,
    },
    defender: {
      ...base.defender,
      ...overrides.defender,
    },
    environment: {
      ...base.environment,
      ...overrides.environment,
    },
    windows: {
      ...base.windows,
      ...overrides.windows,
    },
  };
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
