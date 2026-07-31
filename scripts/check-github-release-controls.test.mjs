import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { parseDocument } from "yaml";

const SCRIPT_PATH = fileURLToPath(
  new URL("./check-github-release-controls.mjs", import.meta.url),
);
const REPOSITORY = "JoeWorkspace/JoeSSH";
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
const PINNED_RUST_TOOLCHAIN_ACTION =
  "dtolnay/rust-toolchain@2c7215f132e9ebf062739d9130488b56d53c060c";
const PINNED_SETUP_NODE_ACTION =
  "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020";
const REQUIRED_NODE_VERSION = "22.22.2";
const REQUIRED_NPM_PIN_SCRIPT = [
  "set -euo pipefail",
  "npm install --global --ignore-scripts --no-audit --no-fund npm@10.9.7",
  'test "$(npm --version)" = "10.9.7"',
].join("\n");
const REQUIRED_RUST_TOOLCHAIN = "1.96.0";
const REQUIRED_SETUP_NODE_JOBS = Object.freeze(
  [
    "ci.yml:build",
    "ci.yml:desktop-real-ssh-smoke",
    "ci.yml:lighthouse",
    "ci.yml:lint",
    "ci.yml:public-release-readiness",
    "ci.yml:security-audit",
    "ci.yml:store-runtime-windows",
    "ci.yml:tauri-shell",
    "ci.yml:test-e2e",
    "ci.yml:test-mobile",
    "ci.yml:test-unit",
    "ci.yml:typecheck",
    "ci.yml:visual-qa",
    "desktop-release-artifacts.yml:build-unsigned",
    "windows-invite-beta.yml:build-stage-a",
    "windows-store-candidate.yml:verify",
  ].sort(),
);

function validEnvironment(name) {
  return {
    can_admins_bypass: false,
    deployment_branch_policy: {
      custom_branch_policies: false,
      protected_branches: true,
    },
    name,
    protection_rules: [
      {
        prevent_self_review: true,
        reviewers: [
          {
            reviewer: {
              id: 1,
              login: "release-reviewer",
            },
            type: "User",
          },
        ],
        type: "required_reviewers",
      },
    ],
  };
}

function validEnvironments(overrides = {}) {
  return {
    "windows-invite-stage-a": validEnvironment("windows-invite-stage-a"),
    "windows-release-stage-b": validEnvironment("windows-release-stage-b"),
    ...overrides,
  };
}

function validDirectProtection(overrides = {}) {
  return {
    allow_deletions: { enabled: false },
    allow_force_pushes: { enabled: false },
    enforce_admins: { enabled: true },
    required_pull_request_reviews: {
      bypass_pull_request_allowances: {
        apps: [],
        teams: [],
        users: [],
      },
      require_last_push_approval: true,
      required_approving_review_count: 1,
    },
    required_status_checks: {
      checks: [
        {
          app_id: 15368,
          context: "Public Release Readiness",
        },
      ],
      contexts: ["Public Release Readiness"],
      strict: true,
    },
    url: "https://api.github.test/protection",
    ...overrides,
  };
}

function validRulesetDetail(name = "Release main") {
  return {
    bypass_actors: [],
    conditions: {
      ref_name: {
        exclude: [],
        include: ["refs/heads/main"],
      },
    },
    enforcement: "active",
    id: 42,
    name,
    rules: [
      { type: "deletion" },
      { type: "non_fast_forward" },
      {
        parameters: {
          required_status_checks: [
            {
              context: "Public Release Readiness",
              integration_id: 15368,
            },
          ],
          strict_required_status_checks_policy: true,
        },
        type: "required_status_checks",
      },
      {
        parameters: {
          require_last_push_approval: true,
          required_approving_review_count: 1,
        },
        type: "pull_request",
      },
    ],
    target: "branch",
  };
}

function createFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "github-release-controls-"));
  t.after(() => {
    rmSync(root, { force: true, recursive: true });
  });

  const logPath = join(root, "gh-invocations.jsonl");
  const state = {
    artifactsPages: [
      {
        artifacts: [
          {
            expired: false,
            name: "windows-stage-a",
            size_in_bytes: 1024,
          },
          {
            expired: true,
            name: "old-diagnostics",
            size_in_bytes: 2048,
          },
        ],
        total_count: 2,
      },
    ],
    apiFailureStderr: "",
    apiFailureStdout: "",
    authFailureStderr: "not logged in",
    authFailureStdout: "",
    authFails: false,
    branch: {
      name: "main",
      protected: true,
    },
    cacheUsage: {
      active_caches_count: 4,
      active_caches_size_in_bytes: 4096,
    },
    directProtection: validDirectProtection(),
    environments: validEnvironments(),
    environmentSecretPages: {
      "windows-invite-stage-a": [
        {
          secrets: [],
          total_count: 0,
        },
      ],
      "windows-release-stage-b": [
        {
          secrets: [],
          total_count: 0,
        },
      ],
    },
    failEndpoints: [],
    invalidJsonEndpoints: [],
    logPath,
    privateVulnerabilityReporting: {
      enabled: true,
    },
    repoMetadata: {
      default_branch: "main",
      id: 123456,
      owner: {
        type: "Organization",
      },
      private: false,
      visibility: "public",
    },
    repositorySecretPages: [
      {
        secrets: [],
        total_count: 0,
      },
    ],
    repository: REPOSITORY,
    rulesetDetails: {},
    rulesets: [],
    ...overrides,
  };

  const fakeGhPath = join(root, "fake-gh.mjs");
  writeFileSync(
    fakeGhPath,
    `
import { appendFileSync } from "node:fs";

const state = ${JSON.stringify(state)};
const args = process.argv.slice(2);
appendFileSync(state.logPath, JSON.stringify(args) + "\\n", "utf8");
const key = args.join("\\0");

if (key === "--version") {
  console.log("gh version 2.76.0");
  process.exit(0);
}

if (key === "auth\\0status") {
  if (state.authFails) {
    if (state.authFailureStderr) {
      console.error(state.authFailureStderr);
    }
    if (state.authFailureStdout) {
      console.log(state.authFailureStdout);
    }
    process.exit(1);
  }
  console.log("authenticated");
  process.exit(0);
}

if (key === "repo\\0view\\0--json\\0nameWithOwner") {
  console.log(JSON.stringify({ nameWithOwner: state.repository }));
  process.exit(0);
}

if (args[0] !== "api" || typeof args[1] !== "string") {
  console.error("unexpected mutating or unsupported gh command: " + args.join(" "));
  process.exit(2);
}

const endpoint = args[1];
if (state.failEndpoints.includes(endpoint)) {
  if (state.apiFailureStderr) {
    console.error(state.apiFailureStderr);
  } else {
    console.error("mock API failure for " + endpoint);
  }
  if (state.apiFailureStdout) {
    console.log(state.apiFailureStdout);
  }
  process.exit(1);
}
if (state.invalidJsonEndpoints.includes(endpoint)) {
  console.log("{not-json");
  process.exit(0);
}

let response;
if (endpoint === "repos/" + state.repository) {
  response = state.repoMetadata;
} else if (endpoint === "repos/" + state.repository + "/branches/main") {
  response = state.branch;
} else if (endpoint === "repos/" + state.repository + "/branches/main/protection") {
  if (state.directProtection === null) {
    console.error("branch protection endpoint unavailable");
    process.exit(1);
  }
  response = state.directProtection;
} else if (endpoint === "repos/" + state.repository + "/rulesets?includes_parents=true") {
  response = state.rulesets;
} else if (endpoint.startsWith("repos/" + state.repository + "/rulesets/")) {
  const id = endpoint.split("/").at(-1);
  response = state.rulesetDetails[id];
  if (!response) {
    console.error("ruleset detail missing");
    process.exit(1);
  }
} else if (endpoint === "repos/" + state.repository + "/private-vulnerability-reporting") {
  response = state.privateVulnerabilityReporting;
} else if (
  endpoint.startsWith("repos/" + state.repository + "/environments/") &&
  endpoint.endsWith("/secrets?per_page=100")
) {
  if (!args.includes("--paginate") || !args.includes("--slurp")) {
    console.error("environment secret names must use read-only pagination");
    process.exit(2);
  }
  const prefix = "repos/" + state.repository + "/environments/";
  const encodedName = endpoint.slice(
    prefix.length,
    -"/secrets?per_page=100".length,
  );
  const name = decodeURIComponent(encodedName);
  response = state.environmentSecretPages[name];
  if (!response) {
    console.error("environment secret names not found");
    process.exit(1);
  }
} else if (endpoint.startsWith("repos/" + state.repository + "/environments/")) {
  const name = decodeURIComponent(endpoint.split("/").at(-1));
  response = state.environments[name];
  if (!response) {
    console.error("environment not found");
    process.exit(1);
  }
} else if (endpoint === "repos/" + state.repository + "/actions/secrets?per_page=100") {
  if (!args.includes("--paginate") || !args.includes("--slurp")) {
    console.error("repository secret names must use read-only pagination");
    process.exit(2);
  }
  response = state.repositorySecretPages;
} else if (endpoint === "repos/" + state.repository + "/actions/artifacts?per_page=100") {
  if (!args.includes("--paginate") || !args.includes("--slurp")) {
    console.error("artifact summary must use read-only pagination");
    process.exit(2);
  }
  response = state.artifactsPages;
} else if (endpoint === "repos/" + state.repository + "/actions/cache/usage") {
  response = state.cacheUsage;
} else {
  console.error("unexpected API endpoint: " + endpoint);
  process.exit(2);
}

console.log(JSON.stringify(response));
`,
    "utf8",
  );

  return {
    env: {
      GITHUB_REPOSITORY: "",
      JOESSH_GITHUB_BILLING_CONFIRMED: "",
      JOESSH_GITHUB_RELEASE_CONTROLS_GH_ARGS: JSON.stringify([fakeGhPath]),
      JOESSH_GITHUB_RELEASE_CONTROLS_GH_COMMAND: process.execPath,
    },
    logPath,
  };
}

function runChecker(args, env) {
  return spawnSync(process.execPath, [SCRIPT_PATH, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...env,
    },
  });
}

function readInvocations(logPath) {
  return readFileSync(logPath, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test("fails closed until billing and spending-limit state is explicitly confirmed", (t) => {
  const fixture = createFixture(t);
  const result = runChecker(["--repo", REPOSITORY], fixture.env);

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS repository-public/);
  assert.match(result.stdout, /PASS main-protection/);
  assert.match(result.stdout, /PASS private-vulnerability-reporting/);
  assert.match(
    result.stdout,
    /FAIL billing-spending-limit \[EXTERNAL CONFIRMATION REQUIRED\]/,
  );
  assert.match(result.stdout, /GitHub release controls: FAIL/);
});

test("redacts supported GitHub token prefixes from auth stderr and stdout", (t) => {
  const tokens = ["ghp_", "gho_", "ghu_", "github_pat_"].map(
    (prefix, index) => `${prefix}${String(index + 1).repeat(16)}`,
  );
  const ordinaryDiagnostic = `ghx_${"N".repeat(16)}`;
  const shortPrefixedValue = `ghp_${"S".repeat(11)}`;
  const fixture = createFixture(t, {
    authFails: true,
    authFailureStderr: `auth stderr ${tokens[0]} ${tokens[1]} ${ordinaryDiagnostic}`,
    authFailureStdout: `auth stdout ${tokens[2]} ${tokens[3]} ${shortPrefixedValue}`,
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready", "--json"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  const serializedReport = JSON.stringify(JSON.parse(result.stdout));
  for (const token of tokens) {
    assert.equal(serializedReport.includes(token), false);
  }
  assert.match(serializedReport, /<redacted-github-token>/);
  assert.match(serializedReport, /auth stderr/);
  assert.match(serializedReport, /auth stdout/);
  assert.match(serializedReport, new RegExp(ordinaryDiagnostic));
  assert.match(serializedReport, new RegExp(shortPrefixedValue));
});

test("redacts GitHub server and refresh tokens from API stderr and stdout", (t) => {
  const serverToken = `ghs_${"T".repeat(16)}`;
  const refreshToken = `ghr_${"R".repeat(16)}`;
  const failedEndpoint = `repos/${REPOSITORY}/private-vulnerability-reporting`;
  const fixture = createFixture(t, {
    apiFailureStderr: `api stderr ${serverToken}`,
    apiFailureStdout: `api stdout ${refreshToken}`,
    failEndpoints: [failedEndpoint],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready", "--json"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  const serializedReport = JSON.stringify(JSON.parse(result.stdout));
  assert.equal(serializedReport.includes(serverToken), false);
  assert.equal(serializedReport.includes(refreshToken), false);
  assert.match(serializedReport, /api stderr/);
  assert.match(serializedReport, /api stdout/);
  assert.match(serializedReport, /<redacted-github-token>/);
});

test("passes only after every remote control and external billing confirmation passes", (t) => {
  const fixture = createFixture(t);
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS repository-public/);
  assert.match(result.stdout, /PASS repository-default-main/);
  assert.match(result.stdout, /PASS main-protection/);
  assert.match(result.stdout, /PASS environment-windows-invite-stage-a/);
  assert.match(result.stdout, /PASS environment-windows-release-stage-b/);
  assert.match(result.stdout, /PASS desktop-signing-repository-secret-copies/);
  assert.match(
    result.stdout,
    /PASS desktop-signing-environment-windows-invite-stage-a-secret-copies/,
  );
  assert.match(
    result.stdout,
    /PASS desktop-signing-environment-windows-release-stage-b-secret-copies/,
  );
  assert.match(result.stdout, /Desktop formal signing automation is disabled/);
  assert.match(
    result.stdout,
    /future approved isolated signer that is externally managed/,
  );
  assert.match(result.stdout, /PASS actions-artifacts/);
  assert.match(result.stdout, /PASS actions-caches/);
  assert.match(result.stdout, /GitHub release controls: PASS/);

  const invocations = readInvocations(fixture.logPath);
  assert(invocations.length > 0);
  assert.equal(
    invocations.some(
      (invocation) =>
        invocation[0] === "api" &&
        invocation.some((arg) => arg.includes("desktop-release-signing")),
    ),
    false,
    "disabled Desktop formal signing must not trigger Desktop environment API requests",
  );
  for (const invocation of invocations) {
    assert(
      invocation[0] === "--version" ||
        invocation[0] === "auth" ||
        invocation[0] === "api",
      `unexpected gh command: ${invocation.join(" ")}`,
    );
    assert.equal(invocation.includes("--method"), false);
    assert.equal(invocation.includes("-X"), false);
    assert.equal(invocation.includes("-f"), false);
    assert.equal(invocation.includes("-F"), false);
    assert.equal(invocation.includes("--field"), false);
    assert.equal(invocation.includes("--raw-field"), false);
    assert.equal(invocation.includes("--input"), false);
  }
});

test("emits a machine-readable JSON report with artifact and cache summaries", (t) => {
  const fixture = createFixture(t);
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready", "--json"],
    fixture.env,
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.readOnly, true);
  assert.equal(report.repository, REPOSITORY);
  assert.equal(report.decision, "pass");
  assert.deepEqual(report.artifacts, {
    activeBytes: 1024,
    activeCount: 1,
    expiredSampledCount: 1,
    sampledBytes: 3072,
    sampledCount: 2,
    totalCount: 2,
  });
  assert.deepEqual(report.caches, {
    activeBytes: 4096,
    activeCount: 4,
  });
  assert.equal(
    report.checks.find((check) => check.id === "billing-spending-limit")
      .evidence,
    "operator-attestation",
  );
  assert.equal(
    report.checks.some(
      (check) =>
        check.id === "environment-desktop-release-signing" ||
        check.id === "desktop-signing-environment-secrets",
    ),
    false,
  );
  assert.equal(
    report.checks.some(
      (check) => check.id === "desktop-signing-repository-secret-copies",
    ),
    true,
  );
});

test("unavailable repository reporting retains only the repository-scope Desktop secret check", (t) => {
  const fixture = createFixture(t);
  const result = runChecker(
    ["--repo", "invalid-repository", "--confirm-billing-ready", "--json"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(
    report.checks.some(
      (check) => check.id === "desktop-signing-repository-secret-copies",
    ),
    true,
  );
  assert.equal(
    report.checks.some(
      (check) =>
        check.id === "environment-desktop-release-signing" ||
        check.id === "desktop-signing-environment-secrets",
    ),
    false,
  );
});

test("rejects a private repository", (t) => {
  const fixture = createFixture(t, {
    repoMetadata: {
      default_branch: "main",
      id: 123456,
      private: true,
      visibility: "private",
    },
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL repository-public/);
  assert.match(result.stdout, /visibility is private; private=true/);
});

test("rejects main when GitHub reports it as unprotected", (t) => {
  const fixture = createFixture(t, {
    branch: {
      name: "main",
      protected: false,
    },
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(result.stdout, /GitHub reports main as unprotected/);
});

test("rejects a ruleset-only main even when the ruleset meets the supplemental bar", (t) => {
  const fixture = createFixture(t, {
    directProtection: null,
    rulesetDetails: {
      42: validRulesetDetail(),
    },
    rulesets: [
      {
        enforcement: "active",
        id: 42,
        name: "Release main",
        target: "branch",
      },
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(
    result.stdout,
    /Direct classic branch protection from GET \/repos\/JoeWorkspace\/JoeSSH\/branches\/main\/protection is required/,
  );
  assert.match(
    result.stdout,
    /Supplemental active ruleset Release main meets the reviewed ruleset bar, but it cannot replace direct classic branch protection/,
  );
});

test("rejects an active ruleset with any bypass actor", (t) => {
  const detail = validRulesetDetail("Bypassable main");
  detail.bypass_actors = [
    {
      actor_id: 5,
      actor_type: "RepositoryRole",
      bypass_mode: "always",
    },
  ];
  const fixture = createFixture(t, {
    directProtection: null,
    rulesetDetails: { 42: detail },
    rulesets: [
      {
        enforcement: "active",
        id: 42,
        name: detail.name,
        target: "branch",
      },
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(
    result.stdout,
    /Bypassable main: active ruleset does not prove protection for refs\/heads\/main/,
  );
});

test("fails an active ruleset closed when bypass actors are unreadable", (t) => {
  const detail = validRulesetDetail("Unreadable bypass policy");
  delete detail.bypass_actors;
  const fixture = createFixture(t, {
    directProtection: null,
    rulesetDetails: { 42: detail },
    rulesets: [
      {
        enforcement: "active",
        id: 42,
        name: detail.name,
        target: "branch",
      },
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(result.stdout, /Unreadable bypass policy/);
});

test("rejects an active ruleset without approval of the latest push", (t) => {
  const detail = validRulesetDetail("Weak review policy");
  const pullRequestRule = detail.rules.find(
    (rule) => rule.type === "pull_request",
  );
  pullRequestRule.parameters.required_approving_review_count = 0;
  pullRequestRule.parameters.require_last_push_approval = false;
  const fixture = createFixture(t, {
    directProtection: null,
    rulesetDetails: { 42: detail },
    rulesets: [
      {
        enforcement: "active",
        id: 42,
        name: detail.name,
        target: "branch",
      },
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(result.stdout, /Weak review policy/);
});

test("rejects an active ruleset that requires only an unrelated status check", (t) => {
  const fixture = createFixture(t, {
    directProtection: null,
    rulesetDetails: {
      42: {
        bypass_actors: [],
        conditions: {
          ref_name: {
            exclude: [],
            include: ["refs/heads/main"],
          },
        },
        enforcement: "active",
        id: 42,
        name: "Trivial main gate",
        rules: [
          { type: "deletion" },
          { type: "non_fast_forward" },
          {
            parameters: {
              required_status_checks: [
                {
                  context: "Unrelated Green Check",
                  integration_id: 15368,
                },
              ],
              strict_required_status_checks_policy: true,
            },
            type: "required_status_checks",
          },
          {
            parameters: {
              require_last_push_approval: true,
              required_approving_review_count: 1,
            },
            type: "pull_request",
          },
        ],
        target: "branch",
      },
    },
    rulesets: [
      {
        enforcement: "active",
        id: 42,
        name: "Trivial main gate",
        target: "branch",
      },
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(
    result.stdout,
    /Trivial main gate: active ruleset does not prove protection for refs\/heads\/main/,
  );
});

test("rejects an active ruleset whose release-readiness check is not bound to GitHub Actions", (t) => {
  const fixture = createFixture(t, {
    directProtection: null,
    rulesetDetails: {
      42: {
        bypass_actors: [],
        conditions: {
          ref_name: {
            exclude: [],
            include: ["refs/heads/main"],
          },
        },
        enforcement: "active",
        id: 42,
        name: "Unbound release gate",
        rules: [
          { type: "deletion" },
          { type: "non_fast_forward" },
          {
            parameters: {
              required_status_checks: [
                {
                  context: "Public Release Readiness",
                  integration_id: null,
                },
              ],
              strict_required_status_checks_policy: true,
            },
            type: "required_status_checks",
          },
          {
            parameters: {
              require_last_push_approval: true,
              required_approving_review_count: 1,
            },
            type: "pull_request",
          },
        ],
        target: "branch",
      },
    },
    rulesets: [
      {
        enforcement: "active",
        id: 42,
        name: "Unbound release gate",
        target: "branch",
      },
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(
    result.stdout,
    /Unbound release gate: active ruleset does not prove protection for refs\/heads\/main/,
  );
});

test("rejects branch protection that does not require strict status checks", (t) => {
  const fixture = createFixture(t, {
    directProtection: validDirectProtection({
      required_status_checks: null,
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(
    result.stdout,
    /Direct classic branch protection does not prove strict required status checks/,
  );
});

test("rejects direct branch protection that requires only an unrelated status check", (t) => {
  const fixture = createFixture(t, {
    directProtection: validDirectProtection({
      required_status_checks: {
        checks: [
          {
            app_id: 15368,
            context: "Unrelated Green Check",
          },
        ],
        strict: true,
      },
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(
    result.stdout,
    /does not prove strict required status checks for Public Release Readiness/,
  );
});

test("rejects direct branch protection whose release-readiness check is not bound to GitHub Actions", (t) => {
  const fixture = createFixture(t, {
    directProtection: validDirectProtection({
      required_status_checks: {
        checks: [
          {
            app_id: null,
            context: "Public Release Readiness",
          },
        ],
        strict: true,
      },
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(result.stdout, /bound to GitHub Actions App 15368/);
});

test("rejects direct branch protection that does not enforce administrators", (t) => {
  const fixture = createFixture(t, {
    directProtection: validDirectProtection({
      enforce_admins: { enabled: false },
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(result.stdout, /administrator enforcement/);
});

test("rejects direct branch protection with pull-request bypass allowances", (t) => {
  const protection = validDirectProtection();
  protection.required_pull_request_reviews.bypass_pull_request_allowances.users =
    [{ id: 1, login: "release-admin" }];
  const fixture = createFixture(t, {
    directProtection: protection,
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(result.stdout, /zero pull-request bypass allowances/);
});

test("rejects null bypass allowances for every repository owner type", (t) => {
  for (const ownerType of ["User", "Organization", null]) {
    const protection = validDirectProtection();
    protection.required_pull_request_reviews.bypass_pull_request_allowances =
      null;
    const repoMetadata = {
      default_branch: "main",
      id: 123456,
      private: false,
      visibility: "public",
    };
    if (ownerType !== null) {
      repoMetadata.owner = { type: ownerType };
    }
    const fixture = createFixture(t, {
      directProtection: protection,
      repoMetadata,
    });
    const result = runChecker(
      ["--repo", REPOSITORY, "--confirm-billing-ready"],
      fixture.env,
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL main-protection/);
    assert.match(result.stdout, /zero pull-request bypass allowances/);
  }
});

test("accepts omitted bypass allowances only for personal repositories", (t) => {
  const protection = validDirectProtection();
  delete protection.required_pull_request_reviews
    .bypass_pull_request_allowances;
  const fixture = createFixture(t, {
    directProtection: protection,
    repoMetadata: {
      default_branch: "main",
      id: 123456,
      owner: {
        type: "User",
      },
      private: false,
      visibility: "public",
    },
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS main-protection/);
  assert.match(result.stdout, /GitHub release controls: PASS/);
});

test("fails direct branch protection closed when bypass allowances are unreadable", (t) => {
  const protection = validDirectProtection();
  delete protection.required_pull_request_reviews
    .bypass_pull_request_allowances;
  const fixture = createFixture(t, {
    directProtection: protection,
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(result.stdout, /zero pull-request bypass allowances/);
});

test("rejects direct branch protection without approval of the latest push", (t) => {
  const protection = validDirectProtection();
  protection.required_pull_request_reviews.required_approving_review_count = 0;
  protection.required_pull_request_reviews.require_last_push_approval = false;
  const fixture = createFixture(t, {
    directProtection: protection,
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL main-protection/);
  assert.match(result.stdout, /at least one approval of the latest push/);
});

test("rejects disabled Private Vulnerability Reporting", (t) => {
  const fixture = createFixture(t, {
    privateVulnerabilityReporting: {
      enabled: false,
    },
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL private-vulnerability-reporting/);
  assert.match(result.stdout, /enabled=false/);
});

test("rejects missing environments and environments without protection rules", (t) => {
  const fixture = createFixture(t, {
    environments: {
      "windows-invite-stage-a": {
        name: "windows-invite-stage-a",
        protection_rules: [],
      },
    },
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL environment-windows-invite-stage-a/);
  assert.match(
    result.stdout,
    /exactly one required_reviewers rule is required/,
  );
  assert.match(result.stdout, /FAIL environment-windows-release-stage-b/);
  assert.match(result.stdout, /GitHub environment API is unreadable/);
  assert.match(result.stdout, /environment not found/);
});

test("rejects a Stage A environment protected only by a wait timer", (t) => {
  const stageA = {
    ...validEnvironment("windows-invite-stage-a"),
    protection_rules: [{ type: "wait_timer", wait_timer: 30 }],
  };
  const fixture = createFixture(t, {
    environments: validEnvironments({
      "windows-invite-stage-a": stageA,
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL environment-windows-invite-stage-a/);
  assert.match(
    result.stdout,
    /exactly one required_reviewers rule is required; found 0/,
  );
  assert.match(result.stdout, /PASS environment-windows-release-stage-b/);
});

for (const environment of [
  "windows-invite-stage-a",
  "windows-release-stage-b",
]) {
  test(`rejects ${environment} when the dispatcher can self-review`, (t) => {
    const candidate = validEnvironment(environment);
    candidate.protection_rules[0].prevent_self_review = false;
    const fixture = createFixture(t, {
      environments: validEnvironments({
        [environment]: candidate,
      }),
    });
    const result = runChecker(
      ["--repo", REPOSITORY, "--confirm-billing-ready"],
      fixture.env,
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`FAIL environment-${environment}`));
    assert.match(
      result.stdout,
      /prevent_self_review must be true; received false/,
    );
  });

  test(`rejects ${environment} when custom branch or tag patterns replace protected branches`, (t) => {
    const candidate = validEnvironment(environment);
    candidate.deployment_branch_policy = {
      custom_branch_policies: true,
      protected_branches: false,
    };
    const fixture = createFixture(t, {
      environments: validEnvironments({
        [environment]: candidate,
      }),
    });
    const result = runChecker(
      ["--repo", REPOSITORY, "--confirm-billing-ready"],
      fixture.env,
    );

    assert.equal(result.status, 1);
    assert.match(result.stdout, new RegExp(`FAIL environment-${environment}`));
    assert.match(
      result.stdout,
      /deployment_branch_policy\.protected_branches must be true/,
    );
    assert.match(
      result.stdout,
      /custom branch or tag patterns cannot widen release eligibility/,
    );
  });
}

test("rejects Stage B when no concrete required reviewer is configured", (t) => {
  const stageB = validEnvironment("windows-release-stage-b");
  stageB.protection_rules[0].reviewers = [];
  const fixture = createFixture(t, {
    environments: validEnvironments({
      "windows-release-stage-b": stageB,
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL environment-windows-release-stage-b/);
  assert.match(
    result.stdout,
    /required_reviewers must configure at least one reviewer/,
  );
});

test("rejects a malformed environment reviewer as unreadable evidence", (t) => {
  const stageB = validEnvironment("windows-release-stage-b");
  stageB.protection_rules[0].reviewers = [
    {
      reviewer: {
        login: "release-reviewer",
      },
      type: "User",
    },
  ];
  const fixture = createFixture(t, {
    environments: validEnvironments({
      "windows-release-stage-b": stageB,
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL environment-windows-release-stage-b/);
  assert.match(
    result.stdout,
    /at least one concrete User or Team reviewer with a positive integer id/,
  );
});

test("never queries the disabled Desktop signing environment or its secrets", (t) => {
  const fixture = createFixture(t);
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /environment-desktop-release-signing/);
  assert.doesNotMatch(result.stdout, /desktop-signing-environment-secrets/);
  const invocations = readInvocations(fixture.logPath);
  assert.equal(
    invocations.some((invocation) =>
      invocation.some((arg) => arg.includes("desktop-release-signing")),
    ),
    false,
  );
});

test("rejects repository-scoped copies of Desktop signing secrets", (t) => {
  const fixture = createFixture(t, {
    repositorySecretPages: [
      {
        secrets: HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES.map((name) => ({
          name,
        })),
        total_count: HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES.length,
      },
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL desktop-signing-repository-secret-copies/);
  for (const duplicateName of HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES) {
    assert.match(result.stdout, new RegExp(duplicateName));
  }
  assert.match(result.stdout, /formal signing automation is disabled/i);
  assert.match(
    result.stdout,
    /do not relocate them to a GitHub repository environment/,
  );
  assert.match(result.stdout, /future approved isolated signer/);
});

test("fails closed when repository secret names are unreadable", (t) => {
  const fixture = createFixture(t, {
    failEndpoints: [`repos/${REPOSITORY}/actions/secrets?per_page=100`],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL desktop-signing-repository-secret-copies/);
  assert.match(result.stdout, /secret-name API is unreadable/);
  assert.match(result.stdout, /formal signing automation is disabled/i);
  assert.doesNotMatch(result.stdout, /desktop-signing-environment-secrets/);
});

test("fails closed when repository secret pagination is incomplete", (t) => {
  const fixture = createFixture(t, {
    repositorySecretPages: [
      {
        secrets: [],
        total_count: 1,
      },
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL desktop-signing-repository-secret-copies/);
  assert.match(result.stdout, /complete pagination cannot be proven/);
});

test("rejects environment-scoped copies of Desktop signing secrets", (t) => {
  const duplicateName = HISTORICAL_DESKTOP_SIGNING_SECRET_NAMES[0];
  const fixture = createFixture(t, {
    environmentSecretPages: {
      "windows-invite-stage-a": [
        {
          secrets: [{ name: duplicateName }],
          total_count: 1,
        },
      ],
      "windows-release-stage-b": [
        {
          secrets: [],
          total_count: 0,
        },
      ],
    },
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL desktop-signing-environment-windows-invite-stage-a-secret-copies/,
  );
  assert.match(result.stdout, new RegExp(duplicateName));
  assert.match(
    result.stdout,
    /Do not retain or relocate sensitive signing material in GitHub repository environments/,
  );
});

test("fails closed when environment secret names are unreadable or incomplete", async (t) => {
  await t.test("unreadable", (subtest) => {
    const endpoint = `repos/${REPOSITORY}/environments/windows-release-stage-b/secrets?per_page=100`;
    const fixture = createFixture(subtest, {
      failEndpoints: [endpoint],
    });
    const result = runChecker(
      ["--repo", REPOSITORY, "--confirm-billing-ready"],
      fixture.env,
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL desktop-signing-environment-windows-release-stage-b-secret-copies/,
    );
    assert.match(result.stdout, /environment secret-name API is unreadable/);
  });

  await t.test("incomplete pagination", (subtest) => {
    const fixture = createFixture(subtest, {
      environmentSecretPages: {
        "windows-invite-stage-a": [
          {
            secrets: [],
            total_count: 0,
          },
        ],
        "windows-release-stage-b": [
          {
            secrets: [],
            total_count: 1,
          },
        ],
      },
    });
    const result = runChecker(
      ["--repo", REPOSITORY, "--confirm-billing-ready"],
      fixture.env,
    );

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL desktop-signing-environment-windows-release-stage-b-secret-copies/,
    );
    assert.match(result.stdout, /complete pagination cannot be proven/);
  });
});

test("rejects Stage A administrator bypass", (t) => {
  const stageA = {
    ...validEnvironment("windows-invite-stage-a"),
    can_admins_bypass: true,
  };
  const fixture = createFixture(t, {
    environments: validEnvironments({
      "windows-invite-stage-a": stageA,
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL environment-windows-invite-stage-a/);
  assert.match(result.stdout, /can_admins_bypass must be false/);
});

test("does not audit a legacy Desktop signing environment", (t) => {
  const legacyEnvironment = {
    ...validEnvironment("desktop-release-signing"),
    can_admins_bypass: true,
  };
  const fixture = createFixture(t, {
    environments: validEnvironments({
      "desktop-release-signing": legacyEnvironment,
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const invocations = readInvocations(fixture.logPath);
  assert.equal(
    invocations.some(
      (invocation) =>
        invocation[0] === "api" &&
        invocation.some((arg) => arg.includes("desktop-release-signing")),
    ),
    false,
  );
});

test("rejects Stage B administrator bypass", (t) => {
  const stageB = {
    ...validEnvironment("windows-release-stage-b"),
    can_admins_bypass: true,
  };
  const fixture = createFixture(t, {
    environments: validEnvironments({
      "windows-release-stage-b": stageB,
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL environment-windows-release-stage-b/);
  assert.match(result.stdout, /can_admins_bypass must be false/);
});

test("fails Stage B closed when the API does not expose administrator bypass state", (t) => {
  const stageB = validEnvironment("windows-release-stage-b");
  delete stageB.can_admins_bypass;
  const fixture = createFixture(t, {
    environments: validEnvironments({
      "windows-release-stage-b": stageB,
    }),
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL environment-windows-release-stage-b/);
  assert.match(
    result.stdout,
    /can_admins_bypass is not readable and therefore cannot be proven disabled/,
  );
});

test("rejects unreadable Actions artifact and cache summaries", (t) => {
  const fixture = createFixture(t, {
    failEndpoints: [
      `repos/${REPOSITORY}/actions/artifacts?per_page=100`,
      `repos/${REPOSITORY}/actions/cache/usage`,
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL actions-artifacts/);
  assert.match(result.stdout, /FAIL actions-caches/);
});

test("fails closed on malformed GitHub API JSON", (t) => {
  const fixture = createFixture(t, {
    invalidJsonEndpoints: [
      `repos/${REPOSITORY}/private-vulnerability-reporting`,
    ],
  });
  const result = runChecker(
    ["--repo", REPOSITORY, "--confirm-billing-ready"],
    fixture.env,
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL private-vulnerability-reporting/);
  assert.match(result.stdout, /returned invalid JSON/);
});

test("resolves the repository through the injected read-only gh command", (t) => {
  const fixture = createFixture(t);
  const result = runChecker(["--confirm-billing-ready"], fixture.env);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS repository-identity/);
  assert(
    readInvocations(fixture.logPath).some(
      (invocation) =>
        invocation.join("\0") === "repo\0view\0--json\0nameWithOwner",
    ),
  );
});

test("every pinned Rust toolchain action explicitly selects Rust 1.96.0", () => {
  const workflowDirectory = join(
    import.meta.dirname,
    "..",
    ".github",
    "workflows",
  );
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort();
  const observed = [];

  for (const file of workflowFiles) {
    const source = readFileSync(join(workflowDirectory, file), "utf8").replace(
      /^\uFEFF/,
      "",
    );
    const document = parseDocument(source, { uniqueKeys: true });
    assert.deepEqual(
      document.errors.map((error) => error.message),
      [],
      `${file} must remain valid YAML`,
    );
    const workflow = document.toJS();
    assert.ok(
      workflow?.jobs && typeof workflow.jobs === "object",
      `${file} must define a jobs mapping`,
    );

    for (const [jobName, job] of Object.entries(workflow.jobs)) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [stepIndex, step] of steps.entries()) {
        if (
          typeof step?.uses !== "string" ||
          !step.uses.startsWith("dtolnay/rust-toolchain")
        ) {
          continue;
        }
        observed.push({
          file,
          jobName,
          stepIndex,
          toolchain: step.with?.toolchain,
          uses: step.uses,
        });
      }
    }
  }

  assert.equal(
    observed.length,
    8,
    `Review any added or removed Rust toolchain action: ${JSON.stringify(
      observed,
    )}`,
  );
  for (const action of observed) {
    assert.equal(
      action.uses,
      PINNED_RUST_TOOLCHAIN_ACTION,
      `${action.file}:${action.jobName}[${action.stepIndex}] must use the reviewed action commit`,
    );
    assert.equal(
      action.toolchain,
      REQUIRED_RUST_TOOLCHAIN,
      `${action.file}:${action.jobName}[${action.stepIndex}] must explicitly select Rust ${REQUIRED_RUST_TOOLCHAIN}`,
    );
  }
});

test("repository Rust manifests and toolchain file lock Rust 1.96", () => {
  const repositoryRoot = join(import.meta.dirname, "..");
  const toolchain = readFileSync(
    join(repositoryRoot, "rust-toolchain.toml"),
    "utf8",
  ).replaceAll("\r\n", "\n");
  assert.equal(
    toolchain,
    [
      "[toolchain]",
      'channel = "1.96.0"',
      'profile = "minimal"',
      'components = ["clippy", "rustfmt"]',
      "",
    ].join("\n"),
  );

  const rootManifest = readFileSync(join(repositoryRoot, "Cargo.toml"), "utf8");
  const coreManifest = readFileSync(
    join(repositoryRoot, "crates", "core", "Cargo.toml"),
    "utf8",
  );
  const syncManifest = readFileSync(
    join(repositoryRoot, "services", "sync", "Cargo.toml"),
    "utf8",
  );
  const tauriManifest = readFileSync(
    join(repositoryRoot, "apps", "desktop", "src-tauri", "Cargo.toml"),
    "utf8",
  );

  assert.match(rootManifest, /^rust-version = "1\.96"$/m);
  assert.match(coreManifest, /^rust-version\.workspace = true$/m);
  assert.match(syncManifest, /^rust-version = "1\.96"$/m);
  assert.match(tauriManifest, /^rust-version = "1\.96"$/m);
});

test("every workflow pins Node 22.22.2 and forbids implicit npx installs", () => {
  const workflowDirectory = join(
    import.meta.dirname,
    "..",
    ".github",
    "workflows",
  );
  const workflowFiles = readdirSync(workflowDirectory)
    .filter((file) => /\.ya?ml$/i.test(file))
    .sort();
  const nodeSteps = [];
  const unsafeNpxSteps = [];

  for (const file of workflowFiles) {
    const source = readFileSync(join(workflowDirectory, file), "utf8").replace(
      /^\uFEFF/,
      "",
    );
    const document = parseDocument(source, { uniqueKeys: true });
    assert.deepEqual(
      document.errors.map((error) => error.message),
      [],
      `${file} must remain valid YAML`,
    );
    const workflow = document.toJS();

    for (const [jobName, job] of Object.entries(workflow?.jobs ?? {})) {
      const steps = Array.isArray(job?.steps) ? job.steps : [];
      for (const [stepIndex, step] of steps.entries()) {
        if (
          typeof step?.uses === "string" &&
          step.uses.startsWith("actions/setup-node")
        ) {
          nodeSteps.push({
            file,
            jobName,
            npmPinName: steps[stepIndex + 1]?.name,
            npmPinRun: steps[stepIndex + 1]?.run?.trim(),
            npmPinShell: steps[stepIndex + 1]?.shell,
            nodeVersion: step.with?.["node-version"],
            stepIndex,
            uses: step.uses,
          });
        }
        if (
          typeof step?.run === "string" &&
          /(?:^|\s)npx\s+(?!--no-install(?:\s|$))/m.test(step.run)
        ) {
          unsafeNpxSteps.push({ file, jobName, stepIndex });
        }
      }
    }
  }

  assert.deepEqual(
    nodeSteps.map(({ file, jobName }) => `${file}:${jobName}`).sort(),
    REQUIRED_SETUP_NODE_JOBS,
    `Every setup-node action must belong to the reviewed workflow/job allowlist: ${JSON.stringify(nodeSteps)}`,
  );
  for (const action of nodeSteps) {
    assert.equal(
      action.uses,
      PINNED_SETUP_NODE_ACTION,
      `${action.file}:${action.jobName}[${action.stepIndex}] must use the reviewed setup-node commit`,
    );
    assert.equal(
      action.nodeVersion,
      REQUIRED_NODE_VERSION,
      `${action.file}:${action.jobName}[${action.stepIndex}] must explicitly select Node ${REQUIRED_NODE_VERSION}`,
    );
    assert.equal(
      action.npmPinName,
      "Pin npm 10.9.7",
      `${action.file}:${action.jobName}[${action.stepIndex}] must immediately pin npm after setup-node`,
    );
    assert.equal(
      action.npmPinShell,
      "bash",
      `${action.file}:${action.jobName}[${action.stepIndex}] npm pin must fail closed in bash`,
    );
    assert.equal(
      action.npmPinRun,
      REQUIRED_NPM_PIN_SCRIPT,
      `${action.file}:${action.jobName}[${action.stepIndex}] must install and assert exact npm 10.9.7 before npm ci or npx`,
    );
  }
  assert.deepEqual(
    unsafeNpxSteps,
    [],
    `npx must never download an unreviewed missing package: ${JSON.stringify(
      unsafeNpxSteps,
    )}`,
  );
});

test("local Node and npm declarations match the release workflow runtime", () => {
  const repositoryRoot = join(import.meta.dirname, "..");
  const nvmVersion = readFileSync(
    join(repositoryRoot, ".nvmrc"),
    "utf8",
  ).trim();
  const rootPackage = JSON.parse(
    readFileSync(join(repositoryRoot, "package.json"), "utf8"),
  );

  assert.equal(nvmVersion, REQUIRED_NODE_VERSION);
  assert.equal(rootPackage.packageManager, "npm@10.9.7");
});

test("release inputs use repository-enforced LF normalization", () => {
  const attributesPath = join(import.meta.dirname, "..", ".gitattributes");
  const source = readFileSync(attributesPath, "utf8");
  const rules = new Set(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#")),
  );

  for (const rule of [
    "* text=auto eol=lf",
    ".gitattributes text eol=lf",
    ".nvmrc text eol=lf",
    ".gitleaks.toml text eol=lf",
    ".gitleaksignore text eol=lf",
    "*.lock text eol=lf",
    "*.json text eol=lf",
    "*.toml text eol=lf",
    "*.md text eol=lf",
    "*.yml text eol=lf",
    "*.yaml text eol=lf",
    "*.mjs text eol=lf",
    "*.ts text eol=lf",
    "*.tsx text eol=lf",
  ]) {
    assert.equal(rules.has(rule), true, `.gitattributes must include: ${rule}`);
  }

  for (const extension of [
    "png",
    "ico",
    "jpg",
    "jpeg",
    "webp",
    "zip",
    "gz",
    "pfx",
  ]) {
    assert.equal(
      rules.has(`*.${extension} binary`),
      true,
      `.${extension} files must remain binary`,
    );
  }
});
