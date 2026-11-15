import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";
import { assertMicrosoftStoreTauriConfig } from "./windows-store-contract.mjs";

const defaultRoot = resolve(import.meta.dirname, "..");
const PUBLIC_SBOM_PATHS = [
  "reports/release/cargo-workspace-sbom.cdx.json",
  "reports/release/npm-desktop-sbom.cdx.json",
  "reports/release/npm-web-sbom.cdx.json",
  "reports/release/tauri-cargo-sbom.cdx.json",
];
const STORE_LISTING_HEADINGS = [
  "## en-US Listing",
  "## zh-CN Listing",
  "## Store Assets",
  "## Certification Notes Draft",
  "## Final Listing Gate",
];
const RELEASE_READINESS_STATUS_CHECK_MARKERS = [
  '$requiredStatusCheckContext = "Public Release Readiness"',
  "$requiredStatusCheckAppId = 15368",
  "required_status_checks.checks",
  "$_.context -ceq $requiredStatusCheckContext",
  "$_.app_id -eq $requiredStatusCheckAppId",
  "$requiredStatusCheckMatches.Count -ne 1",
];
const WORKFLOW_ROOT_METADATA_SHA256 =
  "aca14baffb51717373154e0b4012272361151d91d997972931d4927bf6f95157";
const POLICY_JOB_METADATA_SHA256 =
  "9c8715a99cc77c6cfdd546da7a6308f84f6b9ba1046d6582131efd39f1a24e15";
const POLICY_STEP_SHA256 = [
  "57f08fc5abe9562b6fd2fcfe97111ffe9e245ba58e1e62cf524d28fe008f516d",
  "a57e76cfc2b13abddbb25d7f1280456f7f324dc80bef3779e4877a14d723cd6a",
];
const VERIFY_JOB_METADATA_SHA256 =
  "9f4b741123d8af6d32906b339b0cb0b24abe0db35fceeef7eaabad91ef55d642";
const VERIFY_STEP_SHA256 = [
  "aa3aa6e4763c6f8956f77b0789587f7e853c5c83acfcfdae94ead56bee667cfc",
  "0ac9db6cdb4373f99c058059f3d71a9d0fd12a23352d45f8cea152c043ba540b",
  "133b96e641396fa411c6f6478f1f461b7cd8e2840befb437eb46a80b21ebd13b",
  "56e4a1a3d404f72568cb96c97653bf8b83aca6bcb9f98980c37e7db4bbd8438c",
  "0df39e34e085d11461b7ddebcd86d31997001d8ab6ff5f275fd03342eb9ae20d",
  "c76946633622c1d281ddae20edf82ac04c34a605efe3735c6ae0a1a6b14ccb66",
  "a533742872adc01aac48a25ed53b618053207f748e027029661d1798958d15cb",
  "7823f634c967bce65cc043e3143a2a06fb401ff9812854bca6a18ddb2d223553",
  "32ba0fa8b6dee20139fb08c1fa74231317912580add1c1bb8593e293e24a7fce",
  "609d2bdb767dc2a632538c25b75f94d208b7a7845fcd9b8c5d61aef4137b1bdb",
  "91f27f8712d42d89296e525bda84f14913b9614d0d1b2370f0da94552408e867",
  "6bc4bffa60da95559d341d4411f2c40997717003970b7f0ce5dd8be34f1b5f4e",
  "70d0af2b7a82eae9b981c44383595b7edc0063327e0b22d2cbcd7cd71eb8a9a3",
  "3733f5278ed88532bd1e9e2b7a4619bd201ae0d4bbb3593b64ae7c565577bd48",
  "b100d0a7d8819f186b85d56f46eced98dc322676874bda587dbb550737ad8095",
  "8814580d91df734c5da3a7396f848c8e10166b869783aba346e268187d7134c6",
  "ef00ff6c8edf782194cc26cc2c150ce8afad52b68365f15b9e3779e39e48d49b",
  "7bde7ba4c991c54953a0cdd03b47ec19062fb9e579abdad16e19a3e1562ace5d",
  "69d1f6cd03a69f78f2bea94d4d267fc9a930a880a03686d916b052eda43a69f9",
  "97493be7eae7f209f0f00db03ceac500112f6f250357a7f5f4ed4364e0b520a8",
  "af879350dd1cb129c4deeac46079a5b92db75ac9f0205016150726ddbe4e1e7b",
  "0e42f9d952b2540e6d759fbd5886d0eba8287dfbb687c22a9c653902f1e1c02b",
  "35a397cdaacf50e50ae3116587056bce92615b81c959222374e65ddf5b7a0fc5",
  "6083cc0b5c4c32cf6dffff667a1508db408b59f2bb6435c5d25e12391901a286",
];
const ALLOWED_POLICY_PRIVILEGED_EXPRESSION =
  "${{ secrets.ATLASTERM_RELEASE_POLICY_READ_TOKEN }}";

export function checkWindowsStoreRelease(rootPath = defaultRoot) {
  const root = resolve(rootPath);
  const packageJson = readJson(resolve(root, "package.json"));
  const config = readJson(
    resolve(root, "apps/desktop/src-tauri/tauri.microsoftstore.conf.json"),
  );
  const schema = readJson(
    resolve(root, "node_modules/@tauri-apps/cli/config.schema.json"),
  );
  const workflow = readText(
    resolve(root, ".github/workflows/windows-store-candidate.yml"),
  );
  const preflight = readText(
    resolve(root, "scripts/prepare-windows-store-candidate.mjs"),
  );
  const sourceArtifactVerifier = readText(
    resolve(root, "scripts/verify-windows-store-source-artifacts.mjs"),
  );
  const contract = readText(
    resolve(root, "scripts/windows-store-contract.mjs"),
  );
  const build = readText(
    resolve(root, "scripts/build-windows-store-candidate.mjs"),
  );
  const sandboxPreparation = readText(
    resolve(root, "scripts/prepare-windows-store-msix-sandbox.mjs"),
  );
  const msixLanguageFinalizer = readText(
    resolve(root, "scripts/finalize-windows-store-msix-languages.mjs"),
  );
  const msixLanguageContract = readText(
    resolve(root, "scripts/windows-store-language-contract.mjs"),
  );
  const sandboxBootstrap = readText(
    resolve(root, "scripts/windows-store-msix-sandbox-bootstrap.ps1"),
  );
  const documentation = readText(
    resolve(root, "docs/windows-store-release.md"),
  );
  const listingDraft = readText(
    resolve(root, "docs/microsoft-store-listing-draft.md"),
  );
  const results = [];

  for (const file of [
    "apps/desktop/src-tauri/tauri.microsoftstore.conf.json",
    "scripts/build-windows-store-candidate.mjs",
    "scripts/prepare-windows-store-candidate.mjs",
    "scripts/verify-windows-store-source-artifacts.mjs",
    "scripts/verify-windows-store-source-artifacts.test.mjs",
    "scripts/trusted-roots/github-attestation-trusted-root-2026-08-31.jsonl",
    "scripts/prepare-windows-store-msix-sandbox.mjs",
    "scripts/prepare-windows-store-msix-sandbox.test.mjs",
    "scripts/finalize-windows-store-msix-languages.mjs",
    "scripts/finalize-windows-store-msix-languages.test.mjs",
    "scripts/windows-store-language-contract.mjs",
    "packages/i18n/src/windows-store-manifest-languages.json",
    "scripts/windows-store-msix-sandbox-bootstrap.ps1",
    ".github/workflows/windows-store-candidate.yml",
    "docs/windows-store-release.md",
    "docs/microsoft-store-listing-draft.md",
  ]) {
    add(results, existsSync(resolve(root, file)), `${file} exists`);
  }

  try {
    assertMicrosoftStoreTauriConfig(config);
    add(results, true, "Store Tauri config is offline and NSIS-only");
  } catch (error) {
    add(results, false, error.message);
  }

  const bundleTypes = new Set(
    (schema?.definitions?.BundleType?.oneOf ?? []).flatMap(
      (entry) => entry.enum ?? [],
    ),
  );
  add(
    results,
    bundleTypes.has("nsis") &&
      bundleTypes.has("msi") &&
      !bundleTypes.has("msix"),
    "Locked Tauri CLI exposes NSIS/MSI and no native MSIX target",
  );

  const scripts = packageJson?.scripts ?? {};
  add(
    results,
    scripts["release:windows-store:build"] ===
      "node scripts/build-windows-store-candidate.mjs" &&
      scripts["release:windows-store:candidate"] ===
        "node scripts/prepare-windows-store-candidate.mjs" &&
      scripts["release:windows-store:msix-sandbox"] ===
        "node scripts/prepare-windows-store-msix-sandbox.mjs" &&
      scripts["release:windows-store:msix-finalize"] ===
        "node scripts/finalize-windows-store-msix-languages.mjs" &&
      scripts["test:windows-store-release"]?.includes(
        "build-windows-store-candidate.test.mjs",
      ) &&
      scripts["test:windows-store-release"]?.includes(
        "check-windows-store-release.test.mjs",
      ) &&
      scripts["test:windows-store-release"]?.includes(
        "check-windows-store-surfaces.test.mjs",
      ) &&
      scripts["test:windows-store-release"]?.includes(
        "prepare-windows-store-candidate.test.mjs",
      ) &&
      scripts["test:windows-store-release"]?.includes(
        "verify-windows-store-source-artifacts.test.mjs",
      ) &&
      scripts["test:windows-store-release"]?.includes(
        "prepare-windows-store-msix-sandbox.test.mjs",
      ) &&
      scripts["test:windows-store-release"]?.includes(
        "finalize-windows-store-msix-languages.test.mjs",
      ) &&
      scripts["qa:windows-store-release"]?.includes(
        "check-windows-store-release.mjs",
      ) &&
      scripts["qa:windows-store-surfaces"]?.includes("build:microsoft-store") &&
      scripts["qa:windows-store-surfaces:runtime"] ===
        "npx --no-install playwright install chromium && npm run qa:windows-store-surfaces && npm run qa:e2e:desktop:store:fresh",
    "Package scripts retain local tooling and hosted Store gates",
  );

  results.push(...checkWindowsStoreWorkflowSecurity(workflow));
  add(
    results,
    sourceArtifactVerifier.includes("WINDOWS_STORE_SOURCE_POLICY") &&
      sourceArtifactVerifier.includes("options.producerRunId") &&
      sourceArtifactVerifier.includes("options.candidateArtifactId") &&
      sourceArtifactVerifier.includes("options.evidenceArtifactId") &&
      sourceArtifactVerifier.includes("options.attestationsArtifactId") &&
      sourceArtifactVerifier.includes(
        "options.reviewedSha !== options.artifactSourceSha",
      ) &&
      !/sourceSha:\s*"[a-f0-9]{40}"/u.test(sourceArtifactVerifier) &&
      !/runId:\s*"[1-9][0-9]*"/u.test(sourceArtifactVerifier) &&
      !/artifactId:\s*"[1-9][0-9]*"/u.test(sourceArtifactVerifier) &&
      sourceArtifactVerifier.includes('"--custom-trusted-root"') &&
      sourceArtifactVerifier.includes('"--deny-self-hosted-runners"') &&
      sourceArtifactVerifier.includes('osNetworkIsolation: "not-enforced"') &&
      sourceArtifactVerifier.includes(
        'outboundProxyConfiguration: "loopback-refusal"',
      ) &&
      sourceArtifactVerifier.includes('version: "2.95.0"') &&
      sourceArtifactVerifier.includes(
        '"cfefbc730f2ef7dc0352d6a5435b72fe6afce7fc56d61c90eb7703cd5d97b149"',
      ) &&
      !sourceArtifactVerifier.includes(
        "networkDisabledForCryptographicVerification: true",
      ) &&
      sourceArtifactVerifier.includes("storePublicationReady: false"),
    "GitHub Actions source verifier resolves a same-commit runtime tuple and pins GitHub CLI, local Sigstore inputs, and the non-publication boundary",
  );

  add(
    results,
    preflight.includes('["verify", "/pa", "/all", "/v", path]') &&
      preflight.includes("Get-AuthenticodeSignature") &&
      preflight.includes("verifySilentUninstall") &&
      preflight.includes("MSIX preflight requires --partner-identity") &&
      preflight.includes("assertMsixDesktopFullTrustContract") &&
      preflight.includes("assertMsixManifestLanguages") &&
      preflight.includes("does not match requested architecture") &&
      preflight.includes("assertCertificateSubjectMatchesLegalPublisher") &&
      preflight.includes("assertPartnerCenterLegalPublisher") &&
      preflight.includes("pending-microsoft-store-signing") &&
      preflight.includes('status: "not-submitted"') &&
      contract.includes("deriveMsixVersion") &&
      contract.includes("decoy contract markers"),
    "Local preflight preserves EXE verification and pending Store-signing MSIX semantics",
  );
  add(
    results,
    sandboxPreparation.includes("manifestLanguageContract") &&
      msixLanguageContract.includes('defaultUiLocale: "en"') &&
      msixLanguageContract.includes("Intl.getCanonicalLocales") &&
      msixLanguageFinalizer.includes("replaceManifestLanguages") &&
      msixLanguageFinalizer.includes("assertPayloadTreesMatch") &&
      msixLanguageFinalizer.includes("payloadFilesByteIdentical: true") &&
      msixLanguageFinalizer.includes(
        'semanticContentChange: "AppxManifest.Resources-only"',
      ) &&
      msixLanguageFinalizer.includes("AppxBlockMap.xml") &&
      msixLanguageFinalizer.includes("assertCleanReviewedHead") &&
      msixLanguageFinalizer.includes("MakeAppx-unpack-edit-manifest-repack"),
    "MSIX finalization binds the exact app UI language contract without changing payload files",
  );
  add(
    results,
    preflight.includes("collectBundledThirdPartyNoticesEvidence") &&
      preflight.includes("verifyPublishedThirdPartyLicenseBundle") &&
      preflight.includes("verifyInstalledThirdPartyNotices") &&
      preflight.includes("verifyUnpackedThirdPartyNotices") &&
      preflight.includes("assertBundledThirdPartyNoticesMatch") &&
      preflight.includes('status: "exact-match"') &&
      preflight.includes("thirdPartyNoticesSha256") &&
      preflight.includes("thirdPartyNoticesBundled: true") &&
      PUBLIC_SBOM_PATHS.every((path) => preflight.includes(path)),
    "Candidate preflight binds legal resources and the exact four public SBOMs",
  );
  add(
    results,
    build.includes('"nsis"') &&
      build.includes("tauri.microsoftstore.conf.json") &&
      build.includes("loadWindowsStoreSigningConfig") &&
      build.includes("normalizeSigningConfig") &&
      build.includes("mkdtempSync") &&
      build.includes("finally") &&
      !build.includes('"msix"') &&
      !workflow.includes("release:windows-store:build") &&
      workflow.includes("verify-windows-store-source-artifacts.mjs") &&
      workflow.includes("--github-actions-provenance"),
    "Local build tooling is excluded while the formal workflow accepts only a live-verified same-commit source artifact tuple",
  );
  add(
    results,
    sandboxPreparation.includes("V7:EnforceMicrosoftStoreRequirements") &&
      sandboxPreparation.includes('Arguments="/S"') &&
      sandboxPreparation.includes("assertCleanReviewedHead") &&
      sandboxPreparation.includes("assertBuildProvenanceBinding") &&
      sandboxPreparation.includes("assertUnredirectedStagingPath") &&
      sandboxPreparation.includes("buildWindowsStoreCandidate") &&
      sandboxPreparation.includes("installerBootstrapMachine") &&
      sandboxPreparation.includes("fresh Tauri payload") &&
      sandboxPreparation.includes(
        'ATLASTERM_WINDOWS_STORE_SIGNING_CONFIG: ""',
      ) &&
      sandboxPreparation.includes("input-manifest.json") &&
      sandboxPreparation.includes('networking: "disabled"') &&
      sandboxPreparation.includes('inputMapping: "read-only"') &&
      sandboxPreparation.includes("659ae7d062ce617329842ae25ef19b935") &&
      sandboxPreparation.includes("dceed2e0ed2add3b65870d1aba097ae79") &&
      !sandboxPreparation.includes("--artifact-source-sha") &&
      !sandboxPreparation.includes("--expected-installer-sha256") &&
      !sandboxPreparation.includes("--installer") &&
      build.includes("assertCleanBuildHead") &&
      build.includes("restoreTauriGeneratedSchemas") &&
      build.includes("TAURI_PAYLOAD_EXECUTABLE_PATH") &&
      build.includes("writeWindowsStoreNsisBuildProvenance") &&
      build.includes(".build-provenance.json") &&
      sandboxBootstrap.includes("Assert-InputManifest") &&
      sandboxBootstrap.includes("Add-AppxProvisionedPackage") &&
      sandboxBootstrap.includes("MSIXPackagingTool.Driver.cab") &&
      sandboxBootstrap.includes('Status.ToString() -ne "NotSigned"') &&
      !/(?:Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|curl\.exe|https?:\/\/)/iu.test(
        sandboxBootstrap,
      ),
    "Local MSIX Sandbox conversion is offline, hash-bound, and Store-unsigned",
  );
  add(
    results,
    documentation.includes("github-actions-artifact") &&
      documentation.includes("artifact_url") &&
      documentation.includes("producer_run_id") &&
      documentation.includes("artifact_source_sha == reviewed_sha") &&
      documentation.includes("expected_sha256") &&
      documentation.includes("`policy`") &&
      documentation.includes("`verify`") &&
      documentation.includes("不能作为正式发布证据") &&
      documentation.includes("pending-microsoft-store-signing") &&
      documentation.includes("not-submitted"),
    "Documentation states the dual-source, evidence, and Store-signing boundaries",
  );
  results.push(...checkMicrosoftStoreListingDraft(listingDraft));

  return results;
}

export function checkMicrosoftStoreListingDraft(listingText) {
  const results = [];
  const normalized = listingText.replace(/\s+/gu, " ").trim();
  const headingOffsets = STORE_LISTING_HEADINGS.map((heading) =>
    listingText.indexOf(heading),
  );

  add(
    results,
    STORE_LISTING_HEADINGS.every(
      (heading, index) =>
        countOccurrences(listingText, heading) === 1 &&
        headingOffsets[index] >= 0 &&
        (index === 0 || headingOffsets[index - 1] < headingOffsets[index]),
    ),
    "Store listing preserves exact ordered en-US, zh-CN, Store Assets, Certification Notes, and Final Listing Gate sections",
  );
  add(
    results,
    normalized.includes(
      "Prepare four real-product screenshots for each submitted listing locale: four en-US and four zh-CN screenshots, eight files total.",
    ) &&
      normalized.includes(
        "Each locale set must cover both light and dark appearance.",
      ) &&
      normalized.includes(
        "four screenshots per submitted locale and required Store art are complete;",
      ),
    "Store listing requires four screenshots for each en-US and zh-CN locale",
  );
  add(
    results,
    normalized.includes(
      "Before submission, provision a reachable, isolated, non-production SSH fixture and one-time reviewer credentials that remain valid throughout certification.",
    ) &&
      normalized.includes(
        "steps for host-key review, password or private-key authentication, PTY, SFTP upload/download, and loopback port forwarding in the secure certification notes.",
      ) &&
      normalized.includes(
        "the isolated SSH certification fixture, temporary credentials, availability window, and PTY/SFTP/forward test steps are verified from outside the maintainer's network;",
      ),
    "Store certification requires an isolated SSH fixture, temporary reviewer credentials, and PTY/SFTP/forward steps",
  );
  add(
    results,
    normalized.includes(
      "records `pending-microsoft-store-signing` before certification",
    ) &&
      normalized.includes(
        "The listing is still `NO-GO` until all of the following are true:",
      ),
    "Store listing remains NO-GO with pending Microsoft Store signing",
  );

  return results;
}

export function checkWindowsStoreWorkflowSecurity(workflowText) {
  const results = [];
  let structure = null;
  let structureError = "";
  try {
    structure = inspectWindowsStoreWorkflowStructure(workflowText);
  } catch (error) {
    structureError = error.message;
  }

  const workflow = structure?.workflow;
  const jobs = structure?.jobs;
  const policy = jobs?.policy;
  const verify = jobs?.verify;
  const verifyText = JSON.stringify(verify ?? {});
  const policyRuns = collectStepRuns(policy);
  const verifyRuns = collectStepRuns(verify);
  const policySteps = Array.isArray(policy?.steps) ? policy.steps : [];
  const verifySteps = Array.isArray(verify?.steps) ? verify.steps : [];
  const workflowRoot = isRecord(workflow)
    ? Object.fromEntries(
        Object.entries(workflow).filter(([key]) => key !== "jobs"),
      )
    : {};
  const rootPrivilegedExpressions =
    collectPrivilegedContextExpressions(workflowRoot);
  const policyPrivilegedExpressions =
    collectPrivilegedContextExpressions(policy);
  const verifyPrivilegedExpressions =
    collectPrivilegedContextExpressions(verify);
  const dispatchInputs = workflow?.on?.workflow_dispatch?.inputs;
  const inputRun = getNamedStepRun(policy, "Validate hosted candidate inputs");
  const livePolicyRun = getNamedStepRun(
    policy,
    "Read live direct main, environment, and format identity policy",
  );
  const boundaryRun = getNamedStepRun(
    verify,
    "Prove exact checkout and unprivileged verification boundary",
  );
  const evidenceRun = getNamedStepRun(
    verify,
    "Recheck identity, legal resources, SBOMs, and hosted bytes",
  );
  const evidenceStep = getNamedStep(
    verify,
    "Recheck identity, legal resources, SBOMs, and hosted bytes",
  );
  const baselineRun = getNamedStepRun(
    verify,
    "Capture pre-execution verification baseline",
  );
  const finalEvidenceRun = getNamedStepRun(
    verify,
    "Finalize exact evidence allowlist and hashes",
  );
  const finalEvidenceStep = getNamedStep(
    verify,
    "Finalize exact evidence allowlist and hashes",
  );
  const prepareMsixIdentityStep = getNamedStep(
    verify,
    "Prepare public Partner Center identity input",
  );
  const exePreflightStep = getNamedStep(verify, "Preflight hosted EXE");
  const msixPreflightStep = getNamedStep(verify, "Preflight hosted MSIX");
  const artifactMsixPreflightStep = getNamedStep(
    verify,
    "Preflight selected GitHub Actions MSIX",
  );
  const sourceCandidateResolutionStep = getNamedStep(
    verify,
    "Resolve exact downloaded source candidate",
  );
  const sourceVerificationStep = getNamedStep(
    verify,
    "Verify selected producer metadata and offline Sigstore bundles",
  );
  const ghProvisionStep = getNamedStep(
    verify,
    "Provision exact GitHub CLI for offline Sigstore verification",
  );

  add(
    results,
    Boolean(structure),
    structureError
      ? `Workflow YAML structure is invalid: ${structureError}`
      : "Workflow YAML structure is exact policy + verify",
  );
  add(
    results,
    Boolean(structure?.actionsAreExactAndPinned),
    "Workflow actions are the exact allowlist pinned to full commit SHAs",
  );
  add(
    results,
    Boolean(structure?.containersAreDigestPinned),
    "Workflow rejects Docker actions and mutable container images",
  );
  add(
    results,
    Boolean(workflow) &&
      !Object.hasOwn(workflow, "env") &&
      rootPrivilegedExpressions.length === 0 &&
      hashCanonical(workflowRoot) === WORKFLOW_ROOT_METADATA_SHA256,
    "Workflow root metadata is exact and has no inherited environment or privileged contexts",
  );

  add(
    results,
    dispatchInputs?.candidate_source?.required === true &&
      dispatchInputs?.candidate_source?.default === "github-actions-artifact" &&
      exactScalarArray(dispatchInputs?.candidate_source?.options, [
        "github-actions-artifact",
        "https",
      ]) &&
      dispatchInputs?.artifact_source_sha?.required === true &&
      dispatchInputs?.producer_run_id?.required === false &&
      dispatchInputs?.producer_run_id?.default === "" &&
      dispatchInputs?.producer_run_attempt?.required === false &&
      dispatchInputs?.producer_run_attempt?.default === "" &&
      dispatchInputs?.candidate_artifact_id?.required === false &&
      dispatchInputs?.candidate_artifact_id?.default === "" &&
      dispatchInputs?.evidence_artifact_id?.required === false &&
      dispatchInputs?.evidence_artifact_id?.default === "" &&
      dispatchInputs?.attestations_artifact_id?.required === false &&
      dispatchInputs?.attestations_artifact_id?.default === "" &&
      dispatchInputs?.artifact_url?.required === false &&
      dispatchInputs?.expected_sha256?.required === true &&
      dispatchInputs?.reviewed_sha?.required === true &&
      executablePowerShellIncludes(inputRun, [
        "CANDIDATE_SOURCE_INPUT",
        "ARTIFACT_SOURCE_SHA_INPUT",
        "ARTIFACT_URL_INPUT",
        '$artifactUri.Scheme -cne "https"',
        "EXPECTED_SHA256_INPUT",
        "PRODUCER_RUN_ID_INPUT",
        "PRODUCER_RUN_ATTEMPT_INPUT",
        "CANDIDATE_ARTIFACT_ID_INPUT",
        "EVIDENCE_ARTIFACT_ID_INPUT",
        "ATTESTATIONS_ARTIFACT_ID_INPUT",
        '"\\A[0-9a-fA-F]{64}\\z"',
        '"\\A[1-9][0-9]{0,18}\\z"',
        "GitHub Actions artifact mode requires an MSIX produced from the exact reviewed commit.",
        "artifact IDs must be distinct",
        'CANDIDATE_FORMAT_INPUT -notin @("exe", "msix")',
      ]) &&
      inputRun.includes(
        "MSIX requires bounded public Partner Center identity",
      ) &&
      inputRun.includes(
        "HTTPS mode must leave every GitHub Actions runtime selector empty.",
      ) &&
      countOccurrences(verifyRuns, "--download-url") === 2 &&
      countOccurrences(verifyRuns, "--github-actions-provenance") === 1 &&
      countOccurrences(verifyRuns, "--expected-sha256") === 4,
    "Workflow requires one exact HTTPS or same-commit authenticated GitHub Actions artifact source plus expected SHA-256",
  );
  add(
    results,
    dispatchInputs?.candidate_format?.required === true &&
      dispatchInputs?.candidate_format?.default === "msix" &&
      dispatchInputs?.candidate_format?.type === "choice" &&
      exactScalarArray(dispatchInputs?.candidate_format?.options, [
        "msix",
        "exe",
      ]) &&
      dispatchInputs?.msix_fallback_justification?.required === false &&
      dispatchInputs?.msix_fallback_justification?.default === "" &&
      dispatchInputs?.msix_fallback_justification?.type === "string" &&
      executablePowerShellIncludes(inputRun, [
        "MSIX_FALLBACK_JUSTIFICATION_INPUT",
        "$fallbackJustification.Length -lt 40",
        "$fallbackJustification.Length -gt 1000",
        '$fallbackJustification -match "(?i:\\A(?:(?:change[-_ ]?me|example|placeholder|todo|tbd|unknown|not[-_ ]?set|lorem|ipsum|n/?a|none|test)[\\s.,;:_-]*)+\\z|<[^>]+>)"',
        '$env:MSIX_FALLBACK_JUSTIFICATION_INPUT -cne ""',
        "EXE requires a trimmed, bounded, non-placeholder MSIX fallback justification.",
        "MSIX must leave msix_fallback_justification empty.",
        '"candidate_format=$($env:CANDIDATE_FORMAT_INPUT)"',
        '"msix_fallback_justification=$fallbackJustification"',
      ]),
    "Workflow defaults to MSIX and requires an exact bounded EXE fallback justification",
  );

  const jobNames = jobs ? Object.keys(jobs) : [];
  add(
    results,
    jobNames.length === 2 &&
      jobNames.includes("policy") &&
      jobNames.includes("verify") &&
      policy?.["runs-on"] === "windows-2025" &&
      verify?.["runs-on"] === "windows-2025" &&
      !workflowText.includes("self-hosted"),
    "Workflow uses only GitHub-hosted Windows runners and exactly two jobs",
  );

  const policyUses = Array.isArray(policy?.steps)
    ? policy.steps.filter((step) => isRecord(step) && step.uses !== undefined)
    : [];
  const policyExecutesRepoCode =
    /\b(?:checkout|npm|npx|node|cargo|rustc|git)\b|(?:^|[\\/])scripts[\\/]/iu.test(
      policyRuns,
    );
  add(
    results,
    policy?.environment === "windows-release-stage-b" &&
      policyUses.length === 0 &&
      !policyExecutesRepoCode,
    "Policy job never checks out or executes repository code",
  );
  add(
    results,
    hashCanonicalRecordWithoutKey(policy, "steps") ===
      POLICY_JOB_METADATA_SHA256 &&
      exactCanonicalHashes(policySteps, POLICY_STEP_SHA256),
    "Policy job metadata and exact reviewed steps are immutable",
  );

  add(
    results,
    executablePowerShellIncludes(livePolicyRun, [
      '$repositoryMetadata = Get-GitHubJson "/repos/$($env:REPOSITORY)"',
      "/environments/windows-release-stage-b",
      "/branches/main/protection",
      "required_reviewers",
      "$environmentReviewers = @()",
      "if ($reviewRules.Count -eq 1)",
      '$repositoryMetadata.owner.PSObject.Properties["id"]',
      "$personalOwnerReviewerMismatch",
      "can_admins_bypass -ne $false",
      "prevent_self_review -ne $false",
      "environmentReviewers.Count -ne 1",
      "protected_branches -ne $true",
      "custom_branch_policies -ne $false",
      "required_status_checks.strict -ne $true",
      "enforce_admins.enabled -ne $true",
      "required_approving_review_count -ne 0",
      "require_last_push_approval -ne $false",
      "$null -eq $pullRequestReviews",
      '$bypassProperty = $pullRequestReviews.PSObject.Properties["bypass_pull_request_allowances"]',
      '$repositoryMetadata.owner.type -cne "User"',
      "Bypass allowances must be an object when present.",
      "bypassCount -ne 0",
      "required_linear_history.enabled -ne $true",
      "required_conversation_resolution.enabled -ne $true",
      "allow_force_pushes.enabled -ne $false",
      "allow_deletions.enabled -ne $false",
      "/variables/ATLASTERM_WINDOWS_LEGAL_PUBLISHER",
    ]) && hasExactReleaseReadinessStatusCheck(livePolicyRun),
    "Policy job reads exact live direct-main and protected environment controls",
  );
  add(
    results,
    executablePowerShellIncludes(livePolicyRun, [
      '$subject = ""',
      '$thumbprint = ""',
      'if ($env:CANDIDATE_FORMAT -ceq "exe")',
      "/variables/ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT",
      "/variables/ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT",
      "$commonNames.Count -ne 1",
      '} elseif ($env:CANDIDATE_FORMAT -cne "msix") {',
      '"certificate_subject=$subject"',
      '"certificate_thumbprint=$($thumbprint.ToUpperInvariant())"',
    ]) &&
      livePolicyRun.indexOf("/variables/ATLASTERM_WINDOWS_LEGAL_PUBLISHER") <
        livePolicyRun.indexOf('if ($env:CANDIDATE_FORMAT -ceq "exe")') &&
      livePolicyRun.indexOf(
        "/variables/ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT",
      ) > livePolicyRun.indexOf('if ($env:CANDIDATE_FORMAT -ceq "exe")'),
    "Policy requires only legal publisher for MSIX and exact certificate identity for EXE",
  );

  const allowedPolicyPrivilegedExpression = policyPrivilegedExpressions[0];
  const expectedPolicyOutputs = {
    artifact_source_sha: "${{ steps.inputs.outputs.artifact_source_sha }}",
    attestations_artifact_id:
      "${{ steps.inputs.outputs.attestations_artifact_id }}",
    candidate_artifact_id:
      "${{ steps.inputs.outputs.candidate_artifact_id }}",
    candidate_source: "${{ steps.inputs.outputs.candidate_source }}",
    candidate_format: "${{ steps.inputs.outputs.candidate_format }}",
    certificate_subject: "${{ steps.live_policy.outputs.certificate_subject }}",
    certificate_thumbprint:
      "${{ steps.live_policy.outputs.certificate_thumbprint }}",
    legal_publisher: "${{ steps.live_policy.outputs.legal_publisher }}",
    msix_fallback_justification:
      "${{ steps.inputs.outputs.msix_fallback_justification }}",
    evidence_artifact_id:
      "${{ steps.inputs.outputs.evidence_artifact_id }}",
    producer_run_attempt:
      "${{ steps.inputs.outputs.producer_run_attempt }}",
    producer_run_id: "${{ steps.inputs.outputs.producer_run_id }}",
    reviewed_sha: "${{ steps.inputs.outputs.reviewed_sha }}",
  };
  add(
    results,
    policyPrivilegedExpressions.length === 1 &&
      allowedPolicyPrivilegedExpression?.path ===
        "$.steps[1].env.POLICY_READ_TOKEN" &&
      allowedPolicyPrivilegedExpression?.expression ===
        ALLOWED_POLICY_PRIVILEGED_EXPRESSION &&
      isExactReadPermissions(policy?.permissions) &&
      !Object.hasOwn(policy?.permissions ?? {}, "id-token") &&
      exactRecord(policy?.outputs, expectedPolicyOutputs),
    "Policy has only the read-only policy token and public identity outputs",
  );

  const verifyEnv = verify?.env;
  const expectedVerifyEnv = {
    ATLASTERM_WINDOWS_CANDIDATE_FORMAT:
      "${{ needs.policy.outputs.candidate_format }}",
    ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT:
      "${{ needs.policy.outputs.certificate_subject }}",
    ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT:
      "${{ needs.policy.outputs.certificate_thumbprint }}",
    ATLASTERM_WINDOWS_LEGAL_PUBLISHER:
      "${{ needs.policy.outputs.legal_publisher }}",
    ATLASTERM_WINDOWS_MSIX_FALLBACK_JUSTIFICATION:
      "${{ needs.policy.outputs.msix_fallback_justification }}",
    JOESSH_WINDOWS_RELEASE_ENVIRONMENT: "windows-release-stage-b",
  };
  add(
    results,
    verify?.needs === "policy" &&
      !Object.hasOwn(verify ?? {}, "environment") &&
      isExactVerificationReadPermissions(verify?.permissions) &&
      !Object.hasOwn(verify?.permissions ?? {}, "id-token") &&
      verifyPrivilegedExpressions.length === 4 &&
      verifyPrivilegedExpressions.every(
        ({ expression }) => expression === "${{ github.token }}",
      ) &&
      exactRecord(verifyEnv, expectedVerifyEnv) &&
      executablePowerShellIncludes(boundaryRun, [
        "ACTIONS_ID_TOKEN_REQUEST_URL",
        "ACTIONS_ID_TOKEN_REQUEST_TOKEN",
        "ATLASTERM_RELEASE_POLICY_READ_TOKEN",
        "WINDOWS_CERTIFICATE_PASSWORD",
        "Verification job inherited privileged state",
      ]),
    "Verify job has only contents/actions read, no environment or OIDC, and only its job-scoped token",
  );
  add(
    results,
    hashCanonicalRecordWithoutKey(verify, "steps") ===
      VERIFY_JOB_METADATA_SHA256 &&
      exactCanonicalHashes(verifySteps, VERIFY_STEP_SHA256),
    "Verify job uses the exact ordered reviewed step contract",
  );

  const checkoutSteps = getActionSteps(verify, "actions/checkout");
  add(
    results,
    checkoutSteps.length === 1 &&
      checkoutSteps[0].with?.ref ===
        "${{ needs.policy.outputs.reviewed_sha }}" &&
      checkoutSteps[0].with?.["persist-credentials"] === false &&
      executablePowerShellIncludes(boundaryRun, [
        "git rev-parse HEAD",
        "$actual -cne $env:REVIEWED_SHA",
        "git status --porcelain",
      ]),
    "Verify checks out and rechecks the exact reviewed SHA without credentials",
  );

  const setupNodeSteps = getActionSteps(verify, "actions/setup-node");
  const rustSteps = getActionSteps(verify, "dtolnay/rust-toolchain");
  add(
    results,
    setupNodeSteps.length === 1 &&
      setupNodeSteps[0].with?.["node-version"] === "22.22.2" &&
      rustSteps.length === 1 &&
      rustSteps[0].with?.toolchain === "1.96.0" &&
      verifyRuns.includes("npm@10.9.7") &&
      verifyRuns.includes("npm ci --ignore-scripts --no-audit --no-fund") &&
      !verifyText.includes("cache:"),
    "Verify uses exact toolchains and ignore-scripts dependencies without caches",
  );

  const downloadSteps = getActionSteps(verify, "actions/download-artifact");
  const expectedDownloadedArtifactIds = [
    "${{ needs.policy.outputs.candidate_artifact_id }}",
    "${{ needs.policy.outputs.evidence_artifact_id }}",
    "${{ needs.policy.outputs.attestations_artifact_id }}",
  ];
  add(
    results,
    downloadSteps.length === 3 &&
      downloadSteps.every(
        (step, index) =>
          step.if ===
            "needs.policy.outputs.candidate_source == 'github-actions-artifact'" &&
          step.with?.["artifact-ids"] ===
            expectedDownloadedArtifactIds[index] &&
          step.with?.["run-id"] ===
            "${{ needs.policy.outputs.producer_run_id }}" &&
          step.with?.repository === "JoeWorkspace/JoeSSH" &&
          step.with?.["github-token"] === "${{ github.token }}" &&
          step.with?.["digest-mismatch"] === "error" &&
          step.with?.["merge-multiple"] === true,
      ) &&
      downloadSteps[0].with?.["skip-decompress"] === true &&
      !Object.hasOwn(downloadSteps[1].with ?? {}, "skip-decompress") &&
      !Object.hasOwn(downloadSteps[2].with ?? {}, "skip-decompress") &&
      sourceCandidateResolutionStep?.id === "source_candidate" &&
      sourceCandidateResolutionStep?.env?.ARTIFACT_SOURCE_SHA ===
        "${{ needs.policy.outputs.artifact_source_sha }}" &&
      executablePowerShellIncludes(sourceCandidateResolutionStep?.run, [
        '"\\AJoeSSH_([0-9]+)\\.([0-9]+)\\.([0-9]+)\\.([0-9]+)_x64_([a-f0-9]{12})_([1-9][0-9]{0,18})_([1-9][0-9]{0,18})\\.msix\\z"',
        "$number -gt 65535",
        "$nameMatch.Groups[5].Value -cne $env:ARTIFACT_SOURCE_SHA.Substring(0, 12)",
        "$nameMatch.Groups[6].Value -cne $env:PRODUCER_RUN_ID",
        "$nameMatch.Groups[7].Value -cne $env:PRODUCER_RUN_ATTEMPT",
        '"candidate_path=$($files[0].FullName)" >> $env:GITHUB_OUTPUT',
      ]) &&
      ghProvisionStep?.id === "gh_verifier" &&
      ghProvisionStep?.if ===
        "needs.policy.outputs.candidate_source == 'github-actions-artifact'" &&
      executablePowerShellIncludes(ghProvisionStep?.run, [
        "https://github.com/cli/cli/releases/download/v2.95.0/gh_2.95.0_windows_amd64.zip",
        "19a7154161ada9cfaa9e57edb752ecc679b75c391a62e4f7b586eea1df30b5bb",
        "cfefbc730f2ef7dc0352d6a5435b72fe6afce7fc56d61c90eb7703cd5d97b149",
        "release-assets.githubusercontent.com",
        "$handler.AllowAutoRedirect = $false",
        "$handler.UseDefaultCredentials = $false",
        "Get-AuthenticodeSignature",
        "EF53B4F7C8724BF491A7FD92743D38EEFB7C3947",
        '"gh_executable=$ghPath" >> $env:GITHUB_OUTPUT',
      ]) &&
      sourceVerificationStep?.if ===
        "needs.policy.outputs.candidate_source == 'github-actions-artifact'" &&
      sourceVerificationStep?.env?.GITHUB_TOKEN === "${{ github.token }}" &&
      sourceVerificationStep?.env?.GH_EXECUTABLE ===
        "${{ steps.gh_verifier.outputs.gh_executable }}" &&
      sourceVerificationStep?.run?.includes(
        "verify-windows-store-source-artifacts.mjs",
      ) &&
      sourceVerificationStep?.run?.includes(
        '--gh-executable "$env:GH_EXECUTABLE"',
      ) &&
      sourceVerificationStep?.run?.includes(
        "github-actions-source-provenance.json",
      ) &&
      sourceVerificationStep?.run?.includes("--reviewed-sha") &&
      sourceVerificationStep?.run?.includes("--producer-run-id") &&
      sourceVerificationStep?.run?.includes("--producer-run-attempt") &&
      sourceVerificationStep?.run?.includes("--candidate-artifact-id") &&
      sourceVerificationStep?.run?.includes("--evidence-artifact-id") &&
      sourceVerificationStep?.run?.includes("--attestations-artifact-id") &&
      sourceVerificationStep?.env?.CANDIDATE_PATH ===
        "${{ steps.source_candidate.outputs.candidate_path }}" &&
      exePreflightStep?.if ===
        "needs.policy.outputs.candidate_source == 'https' && needs.policy.outputs.candidate_format == 'exe'" &&
      msixPreflightStep?.if ===
        "needs.policy.outputs.candidate_source == 'https' && needs.policy.outputs.candidate_format == 'msix'" &&
      artifactMsixPreflightStep?.if ===
        "needs.policy.outputs.candidate_source == 'github-actions-artifact' && needs.policy.outputs.candidate_format == 'msix'" &&
      prepareMsixIdentityStep?.if ===
        "needs.policy.outputs.candidate_format == 'msix'" &&
      exePreflightStep?.run?.includes("--format exe") &&
      exePreflightStep?.run?.includes("--download-url $env:ARTIFACT_URL") &&
      msixPreflightStep?.run?.includes("--format msix") &&
      msixPreflightStep?.run?.includes("--download-url $env:ARTIFACT_URL") &&
      artifactMsixPreflightStep?.run?.includes("--format msix") &&
      artifactMsixPreflightStep?.run?.includes("--artifact ") &&
      artifactMsixPreflightStep?.run?.includes("--github-actions-provenance") &&
      !/(?:reports[\\/]handoff|release:windows-store:build|build-sign|signCommand)/imu.test(
        workflowText,
      ),
    "Workflow accepts direct HTTPS or exact selected private source artifacts with pinned download and provenance verification",
  );

  add(
    results,
    getNamedStepRun(
      verify,
      "Generate and verify legal resources and public SBOMs",
    ) === "npm run release:desktop:legal-resource" &&
      getNamedStepRun(
        verify,
        "Build and verify the real Microsoft Store frontend surface",
      ) === "npm run qa:windows-store-surfaces:runtime" &&
      executablePowerShellIncludes(baselineRun, [
        "$actualCommit -cne $env:REVIEWED_SHA",
        "git status --porcelain --untracked-files=no",
        '"surface_tree_sha256=$(Get-PathSetDigest $surfacePaths)"',
        '"legal_inputs_sha256=$(Get-PathSetDigest $legalPaths)"',
        ".github/workflows/windows-store-candidate.yml",
      ]) &&
      executablePowerShellIncludes(evidenceRun, [
        '$artifactMode = $env:CANDIDATE_SOURCE -ceq "github-actions-artifact"',
        "$expectedSource = if ($artifactMode)",
        "$candidate.artifact.source -cne $expectedSource",
        "$candidate.artifact.versionedHttpsUrl -cne $expectedUrl",
        "$candidate.artifact.sha256 -cne $expectedSha256",
        "$candidate.projectIdentity.publisher",
        "thirdPartyNoticesSha256",
        "thirdPartyLicenseChecksumManifestSha256",
        "sbomChecksumManifestSha256",
        "$candidate.gates.publicSbomsBound -ne $true",
        "$candidate.gates.authenticatedProvenance -ne $artifactMode",
        '"github-actions-source-provenance.json"',
        "$candidate.attestations.authenticatedProvenance.producerRunId -cne $env:PRODUCER_RUN_ID",
        "$candidate.attestations.authenticatedProvenance.producerRunAttempt -cne $env:PRODUCER_RUN_ATTEMPT",
        "$provenance.source.sha -cne $env:REVIEWED_SHA",
        "$provenance.candidate.artifactId -cne $env:CANDIDATE_ARTIFACT_ID",
        "$provenance.evidence.artifactId -cne $env:EVIDENCE_ARTIFACT_ID",
        "$provenance.attestations.artifactId -cne $env:ATTESTATIONS_ARTIFACT_ID",
        '$provenance.artifacts.candidate.metadataDigest -cne "sha256:$expectedSha256"',
        '$provenance.attestations.offlineVerification.osNetworkIsolation -cne "not-enforced"',
        '$provenance.verifier.githubCli.version -cne "2.95.0"',
        "19a7154161ada9cfaa9e57edb752ecc679b75c391a62e4f7b586eea1df30b5bb",
        "cfefbc730f2ef7dc0352d6a5435b72fe6afce7fc56d61c90eb7703cd5d97b149",
        "$noticeSizeBytes = (Get-Item -LiteralPath $noticePath).Length",
        "$candidate.legalNotices.sizeBytes -ne $noticeSizeBytes",
        "$candidate.gates.thirdPartyNoticesBundled -isnot [bool]",
        "$candidate.gates.thirdPartyNoticesBundled -ne $true",
        '$candidate.verification.bundledThirdPartyNotices.path -cne "legal/THIRD-PARTY-NOTICES.txt"',
        "$candidate.verification.bundledThirdPartyNotices.path -cne $candidate.legalNotices.bundleResourcePath",
        '$candidate.verification.bundledThirdPartyNotices.status -cne "exact-match"',
        "$candidate.verification.bundledThirdPartyNotices.sizeBytes -ne $noticeSizeBytes",
        "$candidate.verification.bundledThirdPartyNotices.sizeBytes -ne $candidate.legalNotices.sizeBytes",
        "$candidate.verification.bundledThirdPartyNotices.sha256 -cne $noticeSha256",
        "$candidate.verification.bundledThirdPartyNotices.sha256 -cne $candidate.legalNotices.sha256",
        "pending-microsoft-store-signing",
        '$candidate.storeSubmission.status -cne "not-submitted"',
        "joessh-release-surface-profile",
        "hosted-workflow-evidence.json",
      ]) &&
      executablePowerShellIncludes(finalEvidenceRun, [
        "$actualFiles.Count -ne $expectedFileNames.Count",
        "$filesOutsideCandidateDir.Count -ne 0",
        "$fileNameDifference.Count -ne 0",
        "$actualCommit -cne $env:BASELINE_SOURCE_SHA",
        "$workflowSha256 -cne $env:BASELINE_WORKFLOW_SHA256",
        "(Get-PathSetDigest $surfacePaths) -cne $env:BASELINE_SURFACE_TREE_SHA256",
        "(Get-PathSetDigest $legalPaths) -cne $env:BASELINE_LEGAL_INPUTS_SHA256",
        "$candidateSha256 -cne $workflowEvidence.candidateJsonSha256",
        "$workflowSha256 -cne $workflowEvidence.workflowSha256",
        "$surfaceSha256 -cne $workflowEvidence.surfaceIndexSha256",
        "$actualChecksumLines.Count -ne $expectedChecksumLines.Count",
        "Final checksum manifest changed before upload.",
      ]) &&
      PUBLIC_SBOM_PATHS.every((path) => evidenceRun.includes(path)),
    "Verify rechecks selected bytes, authenticated source receipt, identity, legal resources, SBOMs, Store surface, and final evidence",
  );
  add(
    results,
    evidenceStep?.env?.CANDIDATE_FORMAT ===
      "${{ needs.policy.outputs.candidate_format }}" &&
      evidenceStep?.env?.MSIX_FALLBACK_JUSTIFICATION ===
        "${{ needs.policy.outputs.msix_fallback_justification }}" &&
      finalEvidenceStep?.env?.CANDIDATE_FORMAT ===
        "${{ needs.policy.outputs.candidate_format }}" &&
      finalEvidenceStep?.env?.MSIX_FALLBACK_JUSTIFICATION ===
        "${{ needs.policy.outputs.msix_fallback_justification }}" &&
      executablePowerShellIncludes(evidenceRun, [
        "$env:CANDIDATE_FORMAT -cne $env:ATLASTERM_WINDOWS_CANDIDATE_FORMAT",
        "$env:MSIX_FALLBACK_JUSTIFICATION.Length -lt 40",
        "$candidate.verification.installerSignature.signerSubject -cne $env:ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT",
        "$candidate.verification.installerSignature.signerThumbprint",
        "$candidate.verification.signerPolicy.expectedSubject -cne $env:ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT",
        "$candidate.verification.signerPolicy.expectedThumbprint",
        '$env:MSIX_FALLBACK_JUSTIFICATION -cne ""',
        '$env:ATLASTERM_WINDOWS_CERTIFICATE_SUBJECT -cne ""',
        '$env:ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT -cne ""',
        "$candidate.verification.partnerIdentity.publisherDisplayName -cne $env:ATLASTERM_WINDOWS_LEGAL_PUBLISHER",
        '$isMsixFallback = $candidate.format -ceq "exe"',
        "if ($isMsixFallback)",
        "schemaVersion = 2",
        'preferredFormat = "msix"',
        "selectedFormat = $candidate.format",
        "msixFallback = $isMsixFallback",
        "msixFallbackJustification = $env:MSIX_FALLBACK_JUSTIFICATION",
        "identity = $identityEvidence",
      ]) &&
      executablePowerShellIncludes(finalEvidenceRun, [
        '$expectedMsixFallback = $env:CANDIDATE_FORMAT -ceq "exe"',
        '@("certificateSubject", "certificateThumbprint", "legalPublisher")',
        '@("legalPublisher")',
        "$identityPropertyDifference.Count -ne 0",
        '$workflowEvidence.releaseDecision.preferredFormat -cne "msix"',
        "$workflowEvidence.releaseDecision.selectedFormat -cne $env:CANDIDATE_FORMAT",
        "$workflowEvidence.releaseDecision.msixFallback -ne $expectedMsixFallback",
        "$workflowEvidence.releaseDecision.msixFallbackJustification -cne $env:MSIX_FALLBACK_JUSTIFICATION",
        "$expectedMsixFallback -and (",
      ]),
    "Verification and evidence record the MSIX-first choice and format-conditional identity",
  );

  const uploadSteps = getActionSteps(verify, "actions/upload-artifact");
  add(
    results,
    uploadSteps.length === 1 &&
      verifySteps.at(-1) === uploadSteps[0] &&
      verifySteps.at(-2)?.name ===
        "Finalize exact evidence allowlist and hashes" &&
      uploadSteps[0].with?.path === "reports/release/windows-store/" &&
      uploadSteps[0].with?.["if-no-files-found"] === "error" &&
      workflowText.includes(
        "Hosted candidate verification only; no build signing, Partner Center submission, certification, Store signing, or publication occurred.",
      ) &&
      !/\bgh\s+release\b|PartnerCenter|store\s+publish/iu.test(verifyRuns),
    "Workflow uploads candidate-only evidence and never publishes",
  );

  return results;
}

export function inspectWindowsStoreWorkflowStructure(workflowText) {
  const document = parseDocument(workflowText, {
    merge: false,
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new Error(document.errors.map((error) => error.message).join("; "));
  }
  const workflow = document.toJS({ maxAliasCount: 0 });
  if (!isRecord(workflow) || !isRecord(workflow.jobs)) {
    throw new Error("workflow root and jobs must be mappings");
  }
  const jobNames = Object.keys(workflow.jobs).sort();
  const expectedJobNames = ["policy", "verify"];
  if (
    jobNames.length !== expectedJobNames.length ||
    jobNames.some((name, index) => name !== expectedJobNames[index])
  ) {
    throw new Error(
      `workflow must contain exactly ${expectedJobNames.join(", ")}`,
    );
  }

  const actions = [];
  const containerImages = [];
  for (const [jobName, job] of Object.entries(workflow.jobs)) {
    if (!isRecord(job) || !Array.isArray(job.steps)) {
      throw new Error(`${jobName} must be a job with an explicit steps array`);
    }
    for (const [index, step] of job.steps.entries()) {
      if (!isRecord(step)) {
        throw new Error(`${jobName}.steps[${index}] must be a mapping`);
      }
      if (Object.hasOwn(step, "uses")) {
        actions.push(step.uses);
      }
    }
    collectContainerImage(
      job.container,
      `${jobName}.container`,
      containerImages,
    );
    if (job.services !== undefined) {
      if (!isRecord(job.services)) {
        throw new Error(`${jobName}.services must be a mapping`);
      }
      for (const [serviceName, service] of Object.entries(job.services)) {
        if (!isRecord(service)) {
          throw new Error(
            `${jobName}.services.${serviceName} must be a mapping`,
          );
        }
        collectContainerImage(
          service.image,
          `${jobName}.services.${serviceName}.image`,
          containerImages,
        );
      }
    }
  }

  const expectedActionReferences = new Map([
    ["actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1", 1],
    ["actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c", 3],
    ["actions/setup-node@820762786026740c76f36085b0efc47a31fe5020", 1],
    ["actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a", 1],
    ["dtolnay/rust-toolchain@2c7215f132e9ebf062739d9130488b56d53c060c", 1],
  ]);
  const observedActionReferences = new Map();
  let actionSyntaxValid = true;
  for (const action of actions) {
    if (
      typeof action !== "string" ||
      action.startsWith("docker://") ||
      !/^[a-z0-9_.-]+(?:\/[a-z0-9_.-]+)+@[a-f0-9]{40}$/iu.test(action)
    ) {
      actionSyntaxValid = false;
      continue;
    }
    observedActionReferences.set(
      action,
      (observedActionReferences.get(action) ?? 0) + 1,
    );
  }
  const actionsAreExactAndPinned =
    actionSyntaxValid &&
    actions.length === 7 &&
    observedActionReferences.size === expectedActionReferences.size &&
    [...expectedActionReferences].every(
      ([reference, count]) => observedActionReferences.get(reference) === count,
    );
  const containersAreDigestPinned =
    actions.every(
      (action) => typeof action === "string" && !action.startsWith("docker://"),
    ) &&
    containerImages.every(({ image }) =>
      /^[^@\s]+@sha256:[a-f0-9]{64}$/iu.test(image),
    );

  return {
    actions,
    actionsAreExactAndPinned,
    containerImages,
    containersAreDigestPinned,
    jobs: workflow.jobs,
    workflow,
  };
}

function collectContainerImage(container, label, images) {
  if (container === undefined) {
    return;
  }
  const image = typeof container === "string" ? container : container?.image;
  if (typeof image !== "string" || !image) {
    throw new Error(`${label} must define a non-empty image`);
  }
  images.push({ image, label });
}

function collectStepRuns(job) {
  if (!isRecord(job) || !Array.isArray(job.steps)) {
    return "";
  }
  return job.steps
    .filter((step) => isRecord(step) && typeof step.run === "string")
    .map((step) => step.run)
    .join("\n");
}

function getNamedStepRun(job, name) {
  const step = getNamedStep(job, name);
  return typeof step?.run === "string" ? step.run : "";
}

function getNamedStep(job, name) {
  if (!isRecord(job) || !Array.isArray(job.steps)) {
    return null;
  }
  const matches = job.steps.filter(
    (step) => isRecord(step) && step.name === name,
  );
  return matches.length === 1 ? matches[0] : null;
}

function getActionSteps(job, actionName) {
  if (!isRecord(job) || !Array.isArray(job.steps)) {
    return [];
  }
  return job.steps.filter(
    (step) =>
      isRecord(step) &&
      typeof step.uses === "string" &&
      step.uses.startsWith(`${actionName}@`),
  );
}

function executablePowerShellIncludes(script, markers) {
  if (typeof script !== "string" || !script) {
    return false;
  }
  const executable = script
    .split(/\r?\n/u)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n");
  if (
    /if\s*\(\s*\$(?:false|null)\s*\)/iu.test(executable) ||
    /^\s*(?:return|exit(?:\s+0)?)\s*$/imu.test(executable)
  ) {
    return false;
  }
  return markers.every((marker) => executable.includes(marker));
}

function hasExactReleaseReadinessStatusCheck(script) {
  return (
    executablePowerShellIncludes(
      script,
      RELEASE_READINESS_STATUS_CHECK_MARKERS,
    ) &&
    !script.includes("required_status_checks.contexts") &&
    !script.includes("$statusChecks.Count")
  );
}

function isExactReadPermissions(permissions) {
  return (
    isRecord(permissions) &&
    Object.keys(permissions).length === 1 &&
    permissions.contents === "read"
  );
}

function isExactVerificationReadPermissions(permissions) {
  return (
    isRecord(permissions) &&
    Object.keys(permissions).length === 2 &&
    permissions.actions === "read" &&
    permissions.contents === "read"
  );
}

function exactRecord(actual, expected) {
  return (
    isRecord(actual) &&
    Object.keys(actual).length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, value]) => actual[key] === value)
  );
}

function exactScalarArray(actual, expected) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    actual.every((value, index) => value === expected[index])
  );
}

function collectPrivilegedContextExpressions(value) {
  const references = [];

  function visit(current, path) {
    if (typeof current === "string") {
      for (const match of current.matchAll(/\$\{\{[\s\S]*?\}\}/gu)) {
        const expression = match[0];
        if (
          /\bsecrets\b/iu.test(expression) ||
          /\bgithub\s*(?:\.\s*token\b|\s*\[)/iu.test(expression)
        ) {
          references.push({ expression, path });
        }
      }
      return;
    }
    if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (isRecord(current)) {
      for (const [key, item] of Object.entries(current)) {
        visit(item, `${path}.${key}`);
      }
    }
  }

  visit(value, "$");
  return references;
}

function hashCanonicalRecordWithoutKey(value, omittedKey) {
  if (!isRecord(value)) {
    return "";
  }
  return hashCanonical(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== omittedKey),
    ),
  );
}

function exactCanonicalHashes(values, expectedHashes) {
  return (
    Array.isArray(values) &&
    values.length === expectedHashes.length &&
    values.every(
      (value, index) => hashCanonical(value) === expectedHashes[index],
    )
  );
}

function hashCanonical(value) {
  return createHash("sha256")
    .update(canonicalJson(value), "utf8")
    .digest("hex");
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function countOccurrences(value, needle) {
  return value.split(needle).length - 1;
}

function add(results, passed, label) {
  results.push({ label, passed: Boolean(passed) });
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/u, ""));
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/^\uFEFF/u, "");
}

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const results = checkWindowsStoreRelease();
    for (const result of results) {
      console.log(`${result.passed ? "[PASS]" : "[FAIL]"} ${result.label}`);
    }
    const failed = results.filter((result) => !result.passed);
    if (failed.length > 0) {
      process.exitCode = 1;
    } else {
      console.log("Windows Store release contract passed.");
    }
  } catch (error) {
    console.error(`${basename(import.meta.url)}: ${error.message}`);
    process.exitCode = 1;
  }
}
