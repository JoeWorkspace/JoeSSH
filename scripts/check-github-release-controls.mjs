import { spawnSync } from "node:child_process";

const REQUIRED_ENVIRONMENT_CONTRACTS = [
  {
    environment: "windows-invite-stage-a",
    requireAdminBypassDisabled: true,
  },
  {
    environment: "windows-release-stage-b",
    requireAdminBypassDisabled: true,
  },
];
const REQUIRED_MAIN_STATUS_CHECK_CONTEXTS = ["Public Release Readiness"];
const REQUIRED_MAIN_STATUS_CHECK_APP_ID = 15368;
const MAIN_PROTECTION_CHECK_LABEL =
  "Direct classic main branch protection is readable and meets the release bar";
const HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES = [
  "ATLASTERM_WINDOWS_CERTIFICATE",
  "ATLASTERM_WINDOWS_CERTIFICATE_PASSWORD",
  "ATLASTERM_WINDOWS_CERTIFICATE_THUMBPRINT",
  "ATLASTERM_WINDOWS_TIMESTAMP_URL",
  "ATLASTERM_APPLE_CERTIFICATE",
  "ATLASTERM_APPLE_CERTIFICATE_PASSWORD",
  "ATLASTERM_APPLE_ID",
  "ATLASTERM_APPLE_PASSWORD",
  "ATLASTERM_APPLE_TEAM_ID",
  "ATLASTERM_KEYCHAIN_PASSWORD",
];
const scriptArgs = parseArgs(process.argv.slice(2));

if (scriptArgs.help) {
  printHelp();
  process.exit(0);
}

const ghCommand =
  process.env.JOESSH_GITHUB_RELEASE_CONTROLS_GH_COMMAND ??
  process.env.ATLASTERM_RELEASE_GH_COMMAND ??
  "gh";
const ghCommandPrefixArgs = parseCommandPrefixArgs(
  process.env.JOESSH_GITHUB_RELEASE_CONTROLS_GH_ARGS ??
    process.env.ATLASTERM_RELEASE_GH_ARGS,
);
const checks = [];
const report = {
  artifacts: null,
  caches: null,
  checks,
  decision: "fail",
  generatedAt: new Date().toISOString(),
  readOnly: true,
  repository: null,
  schemaVersion: 1,
  summary: {
    fail: 0,
    needsExternalConfirmation: 0,
    pass: 0,
  },
};

const ghVersion = runGh(["--version"]);
addCheck(
  "github-cli",
  "GitHub CLI is available",
  ghVersion.ok ? "pass" : "fail",
  ghVersion.ok
    ? firstNonEmptyLine(ghVersion.stdout) || "GitHub CLI responded."
    : commandDiagnostic(ghVersion),
);

const ghAuth = ghVersion.ok
  ? runGh(["auth", "status"])
  : {
      ok: false,
      status: null,
      stderr: "GitHub CLI availability check failed.",
      stdout: "",
    };
addCheck(
  "github-auth",
  "GitHub CLI authentication is available",
  ghAuth.ok ? "pass" : "fail",
  ghAuth.ok
    ? "Authenticated GitHub CLI state is available."
    : commandDiagnostic(ghAuth),
);

const repository = resolveRepository(scriptArgs.repo);
report.repository = repository;

if (repository) {
  const repositoryMetadata = auditRepositoryVisibility(repository);
  auditMainProtection(repository, repositoryMetadata);
  auditPrivateVulnerabilityReporting(repository);
  for (const contract of REQUIRED_ENVIRONMENT_CONTRACTS) {
    auditEnvironment(repository, contract, repositoryMetadata?.owner);
  }
  auditHistoricalDesktopSigningSecretAbsence(repository);
  for (const { environment } of REQUIRED_ENVIRONMENT_CONTRACTS) {
    auditHistoricalDesktopSigningEnvironmentSecretAbsence(
      repository,
      environment,
    );
  }
  auditArtifacts(repository);
  auditCaches(repository);
} else {
  addUnavailableRemoteChecks();
}

const billingConfirmed =
  scriptArgs.confirmBillingReady ||
  isEnabled(process.env.JOESSH_GITHUB_BILLING_CONFIRMED);
addCheck(
  "billing-spending-limit",
  "GitHub Free Actions usage and zero-paid-overage policy is externally confirmed",
  billingConfirmed ? "pass" : "needs_external_confirmation",
  billingConfirmed
    ? "Operator explicitly confirmed that the repository remains public, release workflows use only standard GitHub-hosted runners, larger runners are disabled, included storage allowances are respected, and paid overages are blocked. This is an operator attestation, not GitHub API evidence."
    : "GitHub exposes no reliable repository API that proves account budget and payment settings. Confirm that the public repository uses only standard GitHub-hosted runners, larger runners are disabled, storage remains within included allowances, and paid overages are blocked; then rerun with --confirm-billing-ready or JOESSH_GITHUB_BILLING_CONFIRMED=1.",
  {
    evidence: billingConfirmed
      ? "operator-attestation"
      : "external-confirmation-required",
  },
);

finalizeReport();
emitReport();
process.exit(report.decision === "pass" ? 0 : 1);

function resolveRepository(explicitRepository) {
  const candidate =
    explicitRepository ?? process.env.GITHUB_REPOSITORY?.trim() ?? null;
  if (candidate) {
    if (!isValidRepository(candidate)) {
      addCheck(
        "repository-identity",
        "GitHub repository identity is valid",
        "fail",
        `Repository must use owner/name syntax, received: ${candidate}`,
      );
      return null;
    }
    addCheck(
      "repository-identity",
      "GitHub repository identity is valid",
      "pass",
      candidate,
    );
    return candidate;
  }

  const result = runGh(["repo", "view", "--json", "nameWithOwner"]);
  if (!result.ok) {
    addCheck(
      "repository-identity",
      "GitHub repository identity is valid",
      "fail",
      commandDiagnostic(result),
    );
    return null;
  }

  const parsed = parseJson(result, "GitHub repository identity");
  const resolved = parsed.ok ? parsed.value?.nameWithOwner : null;
  if (!isValidRepository(resolved)) {
    addCheck(
      "repository-identity",
      "GitHub repository identity is valid",
      "fail",
      parsed.ok
        ? "gh repo view did not return a valid nameWithOwner value."
        : parsed.detail,
    );
    return null;
  }

  addCheck(
    "repository-identity",
    "GitHub repository identity is valid",
    "pass",
    resolved,
  );
  return resolved;
}

function auditRepositoryVisibility(repository) {
  const result = apiJson(`repos/${repository}`);
  if (!result.ok) {
    addCheck(
      "repository-public",
      "Repository is public",
      "fail",
      result.detail,
    );
    addCheck(
      "repository-default-main",
      "Repository default branch is main",
      "fail",
      "Repository metadata could not be read.",
    );
    return null;
  }

  const isPublic =
    result.value?.visibility === "public" && result.value?.private === false;
  addCheck(
    "repository-public",
    "Repository is public",
    isPublic ? "pass" : "fail",
    isPublic
      ? `${repository} is public.`
      : `${repository} visibility is ${String(
          result.value?.visibility ?? "unknown",
        )}; private=${String(result.value?.private ?? "unknown")}.`,
  );

  const defaultBranchIsMain = result.value?.default_branch === "main";
  addCheck(
    "repository-default-main",
    "Repository default branch is main",
    defaultBranchIsMain ? "pass" : "fail",
    defaultBranchIsMain
      ? "Default branch is main."
      : `Default branch is ${String(
          result.value?.default_branch ?? "unknown",
        )}.`,
  );
  return result.value;
}

function auditMainProtection(repository, repositoryMetadata) {
  const branch = apiJson(`repos/${repository}/branches/main`);
  if (!branch.ok) {
    addCheck(
      "main-protection",
      MAIN_PROTECTION_CHECK_LABEL,
      "fail",
      branch.detail,
    );
    return;
  }

  if (branch.value?.protected !== true) {
    addCheck(
      "main-protection",
      MAIN_PROTECTION_CHECK_LABEL,
      "fail",
      "GitHub reports main as unprotected.",
    );
    return;
  }

  const directProtection = apiJson(
    `repos/${repository}/branches/main/protection`,
  );
  if (
    directProtection.ok &&
    branchProtectionMeetsReleaseBar(
      directProtection.value,
      repositoryMetadata?.owner?.type,
    )
  ) {
    addCheck(
      "main-protection",
      MAIN_PROTECTION_CHECK_LABEL,
      "pass",
      `GitHub reports direct classic main branch protection as active with a solo-maintainer pull-request flow, zero required approvals, no latest-push approval requirement, strict ${REQUIRED_MAIN_STATUS_CHECK_CONTEXTS.join(
        ", ",
      )} status checks bound to GitHub Actions App ${REQUIRED_MAIN_STATUS_CHECK_APP_ID}, administrator enforcement, required linear history, required conversation resolution, no pull-request bypass allowances, force pushes disabled, and deletion disabled. Self-review in this solo-maintainer model is not independent review.`,
      {
        evidence: "branch-protection",
        independentReview: false,
        reviewModel: "solo-maintainer-self-review",
      },
    );
    return;
  }

  const rulesets = apiJson(
    `repos/${repository}/rulesets?includes_parents=true`,
  );
  const directProtectionDiagnostic = directProtection.ok
    ? `Direct classic branch protection does not prove strict required status checks for ${REQUIRED_MAIN_STATUS_CHECK_CONTEXTS.join(
        ", ",
      )} bound to GitHub Actions App ${REQUIRED_MAIN_STATUS_CHECK_APP_ID}, administrator enforcement, a solo-maintainer pull-request flow with exactly zero required approvals and no latest-push approval requirement, required linear history, required conversation resolution, zero pull-request bypass allowances, and force pushes and deletion disabled. Self-review is not independent review.`
    : directProtection.detail;
  const mandatoryDirectProtectionDiagnostic = `Direct classic branch protection from GET /repos/${repository}/branches/main/protection is required; an active ruleset may supplement it but cannot replace it.`;
  if (!rulesets.ok || !Array.isArray(rulesets.value)) {
    addCheck(
      "main-protection",
      MAIN_PROTECTION_CHECK_LABEL,
      "fail",
      [
        mandatoryDirectProtectionDiagnostic,
        directProtectionDiagnostic,
        rulesets.ok
          ? "The supplemental ruleset response was not an array."
          : `Supplemental rulesets were unreadable: ${rulesets.detail}`,
      ]
        .filter(Boolean)
        .join(" "),
    );
    return;
  }

  const candidates = rulesets.value.filter(
    (ruleset) =>
      ruleset?.target === "branch" &&
      ruleset?.enforcement === "active" &&
      Number.isInteger(ruleset?.id),
  );
  const diagnostics = [];
  for (const candidate of candidates) {
    const detail = apiJson(`repos/${repository}/rulesets/${candidate.id}`);
    if (!detail.ok) {
      diagnostics.push(`${candidate.name ?? candidate.id}: ${detail.detail}`);
      continue;
    }
    if (activeRulesetProtectsMain(detail.value)) {
      diagnostics.push(
        `Supplemental active ruleset ${
          detail.value?.name ?? candidate.id
        } meets the reviewed ruleset bar, but it cannot replace direct classic branch protection.`,
      );
      continue;
    }
    diagnostics.push(
      `${detail.value?.name ?? candidate.id}: active ruleset does not prove protection for refs/heads/main.`,
    );
  }

  addCheck(
    "main-protection",
    MAIN_PROTECTION_CHECK_LABEL,
    "fail",
    [
      mandatoryDirectProtectionDiagnostic,
      directProtectionDiagnostic,
      diagnostics.length > 0
        ? diagnostics.join(" ")
        : `No active branch ruleset supplements the required direct protection with strict ${REQUIRED_MAIN_STATUS_CHECK_CONTEXTS.join(
            ", ",
          )} status checks bound to GitHub Actions App ${REQUIRED_MAIN_STATUS_CHECK_APP_ID}, a solo-maintainer pull-request flow with exactly zero required approvals and no latest-push approval requirement, required review-thread resolution, required linear history, zero bypass actors, and blocks deletion and non-fast-forward updates for refs/heads/main. Self-review is not independent review.`,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function auditPrivateVulnerabilityReporting(repository) {
  const result = apiJson(`repos/${repository}/private-vulnerability-reporting`);
  const enabled = result.ok && result.value?.enabled === true;
  addCheck(
    "private-vulnerability-reporting",
    "Private Vulnerability Reporting is enabled",
    enabled ? "pass" : "fail",
    enabled
      ? "Private Vulnerability Reporting is enabled."
      : result.ok
        ? `GitHub returned enabled=${String(result.value?.enabled ?? "unknown")}.`
        : result.detail,
  );
}

function auditEnvironment(repository, contract, repositoryOwner) {
  const { environment, requireAdminBypassDisabled } = contract;
  const result = apiJson(
    `repos/${repository}/environments/${encodeURIComponent(environment)}`,
  );
  const label = `Environment ${environment} satisfies the reviewed protected-branch contract`;
  if (!result.ok) {
    addCheck(
      `environment-${environment}`,
      label,
      "fail",
      `GitHub environment API is unreadable for ${environment}; the release controls cannot be proven. ${result.detail}`,
      { evidence: "github-api-unreadable" },
    );
    return;
  }

  const value = result.value;
  const failures = [];
  if (!isNonEmptyObject(value)) {
    failures.push("GitHub returned no readable environment object");
  }
  if (value?.name !== environment) {
    failures.push(
      `name must exactly equal ${environment}; received ${String(
        value?.name ?? "unreadable",
      )}`,
    );
  }

  const protectionRules = value?.protection_rules;
  const protectionRulesReadable = Array.isArray(protectionRules);
  if (!protectionRulesReadable) {
    failures.push("protection_rules is not readable as an array");
  }
  const reviewerRules = protectionRulesReadable
    ? protectionRules.filter((rule) => rule?.type === "required_reviewers")
    : [];
  if (reviewerRules.length !== 1) {
    failures.push(
      `exactly one required_reviewers rule is required; found ${reviewerRules.length}`,
    );
  }

  const reviewerRule = reviewerRules.length === 1 ? reviewerRules[0] : null;
  const reviewers = reviewerRule?.reviewers;
  const concreteReviewers = Array.isArray(reviewers)
    ? reviewers.filter(isConcreteEnvironmentReviewer)
    : [];
  if (reviewerRule && !Array.isArray(reviewers)) {
    failures.push("required_reviewers.reviewers is not readable as an array");
  } else if (Array.isArray(reviewers) && reviewers.length < 1) {
    failures.push("required_reviewers must configure at least one reviewer");
  } else if (Array.isArray(reviewers) && reviewers.length !== 1) {
    failures.push(
      `solo-maintainer mode requires exactly one reviewer; found ${reviewers.length}`,
    );
  } else if (Array.isArray(reviewers) && concreteReviewers.length < 1) {
    failures.push(
      "required_reviewers must configure at least one concrete User or Team reviewer with a positive integer id",
    );
  }
  if (repositoryOwner?.type === "User") {
    if (!Number.isInteger(repositoryOwner.id) || repositoryOwner.id < 1) {
      failures.push(
        "personal repository owner id is unreadable; the solo-maintainer reviewer identity cannot be proven",
      );
    } else if (
      concreteReviewers.length !== 1 ||
      concreteReviewers[0]?.type !== "User" ||
      concreteReviewers[0]?.reviewer?.id !== repositoryOwner.id
    ) {
      failures.push(
        "the sole environment reviewer must be the personal repository owner",
      );
    }
  }
  if (reviewerRule && reviewerRule.prevent_self_review !== false) {
    failures.push(
      Object.hasOwn(reviewerRule, "prevent_self_review")
        ? `prevent_self_review must be false for the solo-maintainer self-review flow; received ${String(
            reviewerRule.prevent_self_review,
          )}`
        : "prevent_self_review is not readable and therefore cannot be proven explicitly disabled for the solo-maintainer self-review flow",
    );
  }

  const deploymentBranchPolicy = value?.deployment_branch_policy;
  if (!isNonEmptyObject(deploymentBranchPolicy)) {
    failures.push(
      "deployment_branch_policy is not readable; protected-branch-only deployment cannot be proven",
    );
  } else {
    if (deploymentBranchPolicy.protected_branches !== true) {
      failures.push(
        `deployment_branch_policy.protected_branches must be true; received ${String(
          deploymentBranchPolicy.protected_branches ?? "unreadable",
        )}`,
      );
    }
    if (deploymentBranchPolicy.custom_branch_policies !== false) {
      failures.push(
        `deployment_branch_policy.custom_branch_policies must be false so custom branch or tag patterns cannot widen release eligibility; received ${String(
          deploymentBranchPolicy.custom_branch_policies ?? "unreadable",
        )}`,
      );
    }
  }

  if (requireAdminBypassDisabled) {
    if (!Object.hasOwn(value ?? {}, "can_admins_bypass")) {
      failures.push(
        "can_admins_bypass is not readable and therefore cannot be proven disabled",
      );
    } else if (value.can_admins_bypass !== false) {
      failures.push(
        `can_admins_bypass must be false; received ${String(
          value.can_admins_bypass,
        )}`,
      );
    }
  }

  const satisfiesContract = failures.length === 0;
  const configuredReviewerCount = Array.isArray(reviewers)
    ? concreteReviewers.length
    : null;
  addCheck(
    `environment-${environment}`,
    label,
    satisfiesContract ? "pass" : "fail",
    satisfiesContract
      ? `${environment} has exactly one required_reviewers rule with exactly one configured reviewer, uses the personal repository owner when applicable, explicitly allows self-review for the solo maintainer, and accepts protected branches only.${
          requireAdminBypassDisabled ? " Administrator bypass is disabled." : ""
        } This self-review approval is not independent review.`
      : `${environment} does not satisfy the fail-closed environment contract: ${failures.join(
          "; ",
        )}.`,
    satisfiesContract
      ? {
          canAdminsBypass: requireAdminBypassDisabled
            ? value.can_admins_bypass
            : "not-required-for-stage-a",
          configuredReviewerCount,
          deploymentBranchPolicy: {
            customBranchPolicies: deploymentBranchPolicy.custom_branch_policies,
            protectedBranches: deploymentBranchPolicy.protected_branches,
          },
          evidence: "github-environment-api",
          independentReview: false,
          personalRepositoryOwnerIsReviewer:
            repositoryOwner?.type === "User" ? true : "not-applicable",
          preventSelfReview: reviewerRule.prevent_self_review,
          requiredReviewerRuleCount: reviewerRules.length,
          reviewModel: "solo-maintainer-self-review",
        }
      : {},
  );
}

function isConcreteEnvironmentReviewer(entry) {
  return (
    (entry?.type === "User" || entry?.type === "Team") &&
    Number.isInteger(entry?.reviewer?.id) &&
    entry.reviewer.id > 0
  );
}

function auditHistoricalDesktopSigningSecretAbsence(repository) {
  const repositoryCheckId = "desktop-signing-repository-secret-copies";
  const repositoryCheckLabel =
    "Repository scope contains no historical Desktop signing secrets";
  const repositorySecrets = readSecretNames(
    `repos/${repository}/actions/secrets?per_page=100`,
  );
  if (!repositorySecrets.ok) {
    addCheck(
      repositoryCheckId,
      repositoryCheckLabel,
      "fail",
      `GitHub repository secret-name API is unreadable; historical Desktop signing secrets cannot be ruled out at repository scope while formal signing automation is disabled. ${repositorySecrets.detail}`,
      { evidence: "github-api-unreadable" },
    );
    return;
  }

  const duplicates = HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES.filter((name) =>
    repositorySecrets.names.has(name),
  );
  addCheck(
    repositoryCheckId,
    repositoryCheckLabel,
    duplicates.length === 0 ? "pass" : "fail",
    duplicates.length === 0
      ? `Desktop formal signing automation is disabled, and none of the ${HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES.length} historical Desktop signing secret names exists at repository scope. Secret values were not read. Sensitive signing material must remain outside repository scope and may be stored only in a future approved isolated signer that is externally managed.`
      : `Remove repository-scoped copies of Desktop signing secret(s): ${duplicates.join(
          ", ",
        )}. Desktop formal signing automation is disabled; do not relocate them to a GitHub repository environment. Keep sensitive signing material outside repository scope and only in a future approved isolated signer that is externally managed.`,
    {
      duplicateSecretNames: duplicates,
      evidence: "github-secret-names-only",
    },
  );
}

function auditHistoricalDesktopSigningEnvironmentSecretAbsence(
  repository,
  environment,
) {
  const checkId = `desktop-signing-environment-${environment}-secret-copies`;
  const checkLabel = `Environment ${environment} contains no historical Desktop signing secrets`;
  const endpoint = `repos/${repository}/environments/${encodeURIComponent(
    environment,
  )}/secrets?per_page=100`;
  const environmentSecrets = readSecretNames(endpoint);
  if (!environmentSecrets.ok) {
    addCheck(
      checkId,
      checkLabel,
      "fail",
      `GitHub environment secret-name API is unreadable for ${environment}; historical Desktop signing secrets cannot be ruled out while formal signing automation is disabled. ${environmentSecrets.detail}`,
      { evidence: "github-api-unreadable" },
    );
    return;
  }

  const duplicates = HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES.filter((name) =>
    environmentSecrets.names.has(name),
  );
  addCheck(
    checkId,
    checkLabel,
    duplicates.length === 0 ? "pass" : "fail",
    duplicates.length === 0
      ? `Desktop formal signing automation is disabled, and none of the ${HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES.length} historical Desktop signing secret names exists in ${environment}. Secret values were not read.`
      : `Remove ${environment}-scoped copies of Desktop signing secret(s): ${duplicates.join(
          ", ",
        )}. Do not retain or relocate sensitive signing material in GitHub repository environments while formal signing automation is disabled.`,
    {
      duplicateSecretNames: duplicates,
      environment,
      evidence: "github-secret-names-only",
    },
  );
}

function readSecretNames(endpoint) {
  const result = apiJson(endpoint, { paginate: true });
  if (!result.ok) {
    return { detail: result.detail, names: new Set(), ok: false };
  }
  const pages = normalizePages(result.value, "secrets");
  if (!pages) {
    return {
      detail: `GET ${endpoint} did not return readable secret pages.`,
      names: new Set(),
      ok: false,
    };
  }
  const secretRecords = pages.flatMap((page) => page.secrets);
  const totalCount = firstFiniteNumber(pages.map((page) => page?.total_count));
  if (totalCount === null || totalCount !== secretRecords.length) {
    return {
      detail: `GET ${endpoint} returned ${secretRecords.length} secret record(s) but total_count is ${String(
        totalCount ?? "unreadable",
      )}; complete pagination cannot be proven.`,
      names: new Set(),
      ok: false,
    };
  }
  if (
    secretRecords.some(
      (secret) => typeof secret?.name !== "string" || secret.name.length === 0,
    )
  ) {
    return {
      detail: `GET ${endpoint} returned a secret record without a readable name.`,
      names: new Set(),
      ok: false,
    };
  }
  return {
    detail: "",
    names: new Set(secretRecords.map((secret) => secret.name)),
    ok: true,
  };
}

function auditArtifacts(repository) {
  const result = apiJson(`repos/${repository}/actions/artifacts?per_page=100`, {
    paginate: true,
  });
  if (!result.ok) {
    addCheck(
      "actions-artifacts",
      "Actions artifact summary is readable",
      "fail",
      result.detail,
    );
    return;
  }

  const pages = normalizePages(result.value, "artifacts");
  if (!pages) {
    addCheck(
      "actions-artifacts",
      "Actions artifact summary is readable",
      "fail",
      "GitHub artifact response did not contain artifact pages.",
    );
    return;
  }

  const artifacts = pages.flatMap((page) => page.artifacts);
  const active = artifacts.filter((artifact) => artifact?.expired !== true);
  const expired = artifacts.length - active.length;
  const sampledBytes = sumBytes(artifacts);
  const activeBytes = sumBytes(active);
  const totalCount =
    firstFiniteNumber(pages.map((page) => page.total_count)) ??
    artifacts.length;
  report.artifacts = {
    activeBytes,
    activeCount: active.length,
    expiredSampledCount: expired,
    sampledBytes,
    sampledCount: artifacts.length,
    totalCount,
  };
  addCheck(
    "actions-artifacts",
    "Actions artifact summary is readable",
    "pass",
    `GitHub reports ${totalCount} artifact(s); read ${artifacts.length} record(s), including ${active.length} active artifact(s) using ${formatBytes(activeBytes)}.`,
    { summary: report.artifacts },
  );
}

function auditCaches(repository) {
  const result = apiJson(`repos/${repository}/actions/cache/usage`);
  const count = result.ok
    ? finiteNumber(result.value?.active_caches_count)
    : null;
  const bytes = result.ok
    ? finiteNumber(result.value?.active_caches_size_in_bytes)
    : null;
  if (count === null || bytes === null) {
    addCheck(
      "actions-caches",
      "Actions cache summary is readable",
      "fail",
      result.ok
        ? "GitHub cache usage response is missing numeric count or byte fields."
        : result.detail,
    );
    return;
  }

  report.caches = {
    activeBytes: bytes,
    activeCount: count,
  };
  addCheck(
    "actions-caches",
    "Actions cache summary is readable",
    "pass",
    `GitHub reports ${count} active cache(s) using ${formatBytes(bytes)}.`,
    { summary: report.caches },
  );
}

function addUnavailableRemoteChecks() {
  for (const [id, label] of [
    ["repository-public", "Repository is public"],
    ["repository-default-main", "Repository default branch is main"],
    ["main-protection", MAIN_PROTECTION_CHECK_LABEL],
    [
      "private-vulnerability-reporting",
      "Private Vulnerability Reporting is enabled",
    ],
    ...REQUIRED_ENVIRONMENT_CONTRACTS.map(({ environment }) => [
      `environment-${environment}`,
      `Environment ${environment} satisfies the reviewed protected-branch contract`,
    ]),
    [
      "desktop-signing-repository-secret-copies",
      "Repository scope contains no historical Desktop signing secrets",
    ],
    ...REQUIRED_ENVIRONMENT_CONTRACTS.map(({ environment }) => [
      `desktop-signing-environment-${environment}-secret-copies`,
      `Environment ${environment} contains no historical Desktop signing secrets`,
    ]),
    ["actions-artifacts", "Actions artifact summary is readable"],
    ["actions-caches", "Actions cache summary is readable"],
  ]) {
    addCheck(
      id,
      label,
      "fail",
      "Repository identity is unavailable; remote control cannot be proven.",
    );
  }
}

function apiJson(endpoint, options = {}) {
  const args = ["api", endpoint];
  if (options.paginate) {
    args.push("--paginate", "--slurp");
  }
  const result = runGh(args);
  if (!result.ok) {
    return {
      detail: `GET ${endpoint} failed: ${commandDiagnostic(result)}`,
      ok: false,
      value: null,
    };
  }
  const parsed = parseJson(result, `GET ${endpoint}`);
  return parsed.ok
    ? { detail: "", ok: true, value: parsed.value }
    : { detail: parsed.detail, ok: false, value: null };
}

function runGh(args) {
  const result = spawnSync(ghCommand, [...ghCommandPrefixArgs, ...args], {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return {
    error: result.error ?? null,
    ok: !result.error && result.status === 0,
    status: result.status,
    stderr: result.stderr ?? "",
    stdout: result.stdout ?? "",
  };
}

function parseJson(result, label) {
  try {
    return {
      ok: true,
      value: JSON.parse(result.stdout),
    };
  } catch (error) {
    return {
      detail: `${label} returned invalid JSON: ${sanitizeDiagnostic(
        error instanceof Error ? error.message : String(error),
      )}`,
      ok: false,
      value: null,
    };
  }
}

function activeRulesetProtectsMain(ruleset) {
  if (
    ruleset?.target !== "branch" ||
    ruleset?.enforcement !== "active" ||
    !Array.isArray(ruleset?.bypass_actors) ||
    ruleset.bypass_actors.length !== 0 ||
    !Array.isArray(ruleset?.rules) ||
    ruleset.rules.length === 0
  ) {
    return false;
  }

  const refCondition =
    ruleset?.conditions?.ref_name ?? ruleset?.conditions?.refName;
  const includes = Array.isArray(refCondition?.include)
    ? refCondition.include
    : [];
  const excludes = Array.isArray(refCondition?.exclude)
    ? refCondition.exclude
    : [];
  const main = "refs/heads/main";
  const included = includes.some((pattern) => refPatternMatches(pattern, main));
  const excluded = excludes.some((pattern) => refPatternMatches(pattern, main));
  if (!included || excluded) {
    return false;
  }
  const deletionRules = ruleset.rules.filter(
    (rule) => rule?.type === "deletion",
  );
  const nonFastForwardRules = ruleset.rules.filter(
    (rule) => rule?.type === "non_fast_forward",
  );
  const requiredLinearHistoryRules = ruleset.rules.filter(
    (rule) => rule?.type === "required_linear_history",
  );
  const requiredStatusCheckRules = ruleset.rules.filter(
    (rule) => rule?.type === "required_status_checks",
  );
  const pullRequestRules = ruleset.rules.filter(
    (rule) => rule?.type === "pull_request",
  );
  if (
    deletionRules.length !== 1 ||
    nonFastForwardRules.length !== 1 ||
    requiredLinearHistoryRules.length !== 1 ||
    requiredStatusCheckRules.length !== 1 ||
    pullRequestRules.length !== 1
  ) {
    return false;
  }
  const requiredStatusChecks = requiredStatusCheckRules[0];
  const pullRequest = pullRequestRules[0];
  const requiredApprovalCount =
    pullRequest?.parameters?.required_approving_review_count;
  return (
    requiredStatusChecks?.parameters?.strict_required_status_checks_policy ===
      true &&
    hasRequiredStatusCheckBindings(
      requiredStatusChecks?.parameters?.required_status_checks,
      "integration_id",
    ) &&
    requiredApprovalCount === 0 &&
    pullRequest?.parameters?.require_last_push_approval === false &&
    pullRequest?.parameters?.required_review_thread_resolution === true
  );
}

function branchProtectionMeetsReleaseBar(value, repositoryOwnerType) {
  if (!isNonEmptyObject(value) || value?.message) {
    return false;
  }
  const requiredStatusChecks = value.required_status_checks;
  const pullRequestReviews = value.required_pull_request_reviews;
  const requiredApprovalCount =
    pullRequestReviews?.required_approving_review_count;
  return (
    requiredStatusChecks?.strict === true &&
    hasRequiredStatusCheckBindings(requiredStatusChecks?.checks, "app_id") &&
    value.enforce_admins?.enabled === true &&
    requiredApprovalCount === 0 &&
    pullRequestReviews?.require_last_push_approval === false &&
    hasNoPullRequestBypassAllowances(
      pullRequestReviews?.bypass_pull_request_allowances,
      repositoryOwnerType,
    ) &&
    value.required_linear_history?.enabled === true &&
    value.required_conversation_resolution?.enabled === true &&
    value.allow_force_pushes?.enabled === false &&
    value.allow_deletions?.enabled === false
  );
}

function hasNoPullRequestBypassAllowances(allowances, repositoryOwnerType) {
  if (allowances === undefined && repositoryOwnerType === "User") {
    // GitHub omits organization-only bypass actor restrictions for user-owned repositories.
    return true;
  }

  return (
    isNonEmptyObject(allowances) &&
    ["users", "teams", "apps"].every(
      (actorType) =>
        Array.isArray(allowances[actorType]) &&
        allowances[actorType].length === 0,
    )
  );
}

function hasRequiredStatusCheckBindings(entries, sourceIdKey) {
  if (!Array.isArray(entries)) {
    return false;
  }
  return REQUIRED_MAIN_STATUS_CHECK_CONTEXTS.every((context) =>
    entries.some(
      (entry) =>
        entry?.context === context &&
        entry?.[sourceIdKey] === REQUIRED_MAIN_STATUS_CHECK_APP_ID,
    ),
  );
}

function refPatternMatches(pattern, ref) {
  if (pattern === "~ALL" || pattern === "~DEFAULT_BRANCH") {
    return true;
  }
  if (typeof pattern !== "string" || pattern.length === 0) {
    return false;
  }
  const normalized = pattern.startsWith("refs/")
    ? pattern
    : `refs/heads/${pattern}`;
  const escaped = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replaceAll("**", "\u0000")
    .replaceAll("*", "[^/]*")
    .replaceAll("\u0000", ".*");
  return new RegExp(`^${escaped}$`).test(ref);
}

function normalizePages(value, collectionName) {
  if (value && !Array.isArray(value) && Array.isArray(value[collectionName])) {
    return [value];
  }
  if (
    Array.isArray(value) &&
    value.every((page) => Array.isArray(page?.[collectionName]))
  ) {
    return value;
  }
  return null;
}

function addCheck(id, label, status, detail, extra = {}) {
  checks.push({
    blocking: true,
    detail: sanitizeDiagnostic(detail),
    id,
    label,
    status,
    ...extra,
  });
}

function finalizeReport() {
  report.summary = {
    fail: checks.filter((check) => check.status === "fail").length,
    needsExternalConfirmation: checks.filter(
      (check) => check.status === "needs_external_confirmation",
    ).length,
    pass: checks.filter((check) => check.status === "pass").length,
  };
  report.decision =
    report.summary.fail === 0 && report.summary.needsExternalConfirmation === 0
      ? "pass"
      : "fail";
}

function emitReport() {
  if (scriptArgs.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(
    `Checking GitHub release controls for ${
      report.repository ?? "unknown repository"
    } (read-only).`,
  );
  for (const check of checks) {
    const marker = check.status === "pass" ? "PASS" : "FAIL";
    const qualifier =
      check.status === "needs_external_confirmation"
        ? " [EXTERNAL CONFIRMATION REQUIRED]"
        : "";
    console.log(
      `${marker} ${check.id}${qualifier} - ${check.label}: ${check.detail}`,
    );
  }
  console.log(
    `GitHub release controls: ${report.decision.toUpperCase()} (${report.summary.pass} pass, ${report.summary.fail} fail, ${report.summary.needsExternalConfirmation} external confirmation required).`,
  );
}

function parseArgs(args) {
  let confirmBillingReady = false;
  let help = false;
  let json = false;
  let repo = null;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--confirm-billing-ready") {
      confirmBillingReady = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      help = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg === "--repo") {
      repo = readArgValue(args, index, arg);
      index += 1;
      continue;
    }
    if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
      continue;
    }
    failArgument(`Unknown argument: ${arg}`);
  }

  return {
    confirmBillingReady,
    help,
    json,
    repo: repo?.trim() || null,
  };
}

function parseCommandPrefixArgs(value) {
  if (!value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    if (
      Array.isArray(parsed) &&
      parsed.every((entry) => typeof entry === "string")
    ) {
      return parsed;
    }
  } catch {
    // The error below is intentionally stable for human and CI output.
  }
  failArgument("GitHub CLI prefix args must be a JSON array of strings.");
}

function readArgValue(args, index, arg) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    failArgument(`${arg} requires a value.`);
  }
  return value;
}

function failArgument(message) {
  console.error(message);
  process.exit(2);
}

function printHelp() {
  console.log(`Usage: node scripts/check-github-release-controls.mjs [options]

Read-only, fail-closed GitHub release control preflight.

Options:
  --repo owner/name             Repository to inspect.
  --json                        Emit a machine-readable JSON report.
  --confirm-billing-ready       Attest that GitHub Free use is within allowance and paid overages are blocked.
  -h, --help                    Show this help.

Environment:
  JOESSH_GITHUB_RELEASE_CONTROLS_GH_COMMAND
  JOESSH_GITHUB_RELEASE_CONTROLS_GH_ARGS
  JOESSH_GITHUB_BILLING_CONFIRMED=1
`);
}

function commandDiagnostic(result) {
  if (result.error) {
    return sanitizeDiagnostic(result.error.message);
  }
  const output = `${result.stderr ?? ""}\n${result.stdout ?? ""}`.trim();
  return sanitizeDiagnostic(
    output || `GitHub CLI exited with status ${String(result.status)}.`,
  );
}

function sanitizeDiagnostic(value) {
  return String(value ?? "")
    .replace(
      /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{12,}\b/g,
      "<redacted-github-token>",
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 2000);
}

function isValidRepository(value) {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)
  );
}

function isEnabled(value) {
  return /^(?:1|true|yes)$/i.test(value?.trim() ?? "");
}

function isNonEmptyObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length > 0
  );
}

function firstNonEmptyLine(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function firstFiniteNumber(values) {
  for (const value of values) {
    const number = finiteNumber(value);
    if (number !== null) {
      return number;
    }
  }
  return null;
}

function sumBytes(entries) {
  return entries.reduce((sum, entry) => {
    const bytes = finiteNumber(entry?.size_in_bytes);
    return sum + (bytes ?? 0);
  }, 0);
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 ** 2) {
    return `${(bytes / 1024).toFixed(2)} KiB`;
  }
  if (bytes < 1024 ** 3) {
    return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  }
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
}
