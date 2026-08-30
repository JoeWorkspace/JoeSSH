import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  cpSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import {
  STORE_BUILD_REPOSITORY,
  STORE_BUILD_WORKFLOW,
  STORE_CI_JOBS,
  STORE_MSIX_PROFILE,
  assertPngDimensions,
  createStoreManifest,
  decodePartnerIdentity,
  fileEvidence,
  findMakeAppx,
  nativeBuildEnvironment,
  packAndVerifyMsix,
  treeEvidence,
  validateBuildContext,
  validateCiEvidence,
  verifyLatestMainCi,
  verifyPackageRoundTrip,
} from "./build-windows-store-msix.mjs";
import { parseMsixManifestContract } from "./windows-store-contract.mjs";
import { readWindowsStoreManifestLanguageContract } from "./windows-store-language-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const sourceSha = "a".repeat(40);
const legalPublisher = "JoeSSH Release Team";
const partner = {
  schemaVersion: 1,
  source: "partner-center",
  productId: "9NK5LLMF8LHM",
  packageIdentityName: "JoeSSH.JoeSSH",
  publisher: `CN=${legalPublisher}`,
  publisherDisplayName: legalPublisher,
  publisherId: "a1b2c3d4e5f6g",
  packageFamilyName: "JoeSSH.JoeSSH_a1b2c3d4e5f6g",
  reservedAt: "2026-08-30T00:00:00.000Z",
};
const languages = readWindowsStoreManifestLanguageContract().manifestLanguages;
const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64");
function contextEnv() {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REPOSITORY: STORE_BUILD_REPOSITORY,
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_PROTECTED: "true",
    REVIEWED_SHA: sourceSha,
    GITHUB_SHA: sourceSha,
    GITHUB_WORKFLOW_SHA: sourceSha,
    GITHUB_WORKFLOW_REF: `${STORE_BUILD_REPOSITORY}/${STORE_BUILD_WORKFLOW}@refs/heads/main`,
    RUNNER_ENVIRONMENT: "github-hosted",
    RUNNER_OS: "Windows",
    RUNNER_ARCH: "X64",
    ImageOS: "win25-vs2026",
    GITHUB_RUN_ID: "1234",
    GITHUB_RUN_ATTEMPT: "1",
    RETENTION_DAYS: "14",
  };
}
function ciFixture() {
  return {
    branch: { name: "main", protected: true, commit: { sha: sourceSha } },
    runs: {
      workflow_runs: [
        {
          id: 5678,
          run_attempt: 2,
          path: ".github/workflows/ci.yml",
          head_sha: sourceSha,
          head_branch: "main",
          event: "push",
          status: "completed",
          conclusion: "success",
          repository: { full_name: STORE_BUILD_REPOSITORY },
        },
      ],
    },
    jobs: {
      total_count: 14,
      jobs: STORE_CI_JOBS.map((name, index) => ({
        name,
        id: index + 100,
        status: "completed",
        conclusion: "success",
        head_sha: sourceSha,
        run_id: 5678,
        run_attempt: 2,
      })),
    },
    environment: {
      id: 99,
      name: "windows-release-stage-b",
      can_admins_bypass: false,
      protection_rules: [
        {
          type: "required_reviewers",
          reviewers: [{ type: "User", reviewer: { id: 10 } }],
        },
      ],
      deployment_branch_policy: {
        protected_branches: true,
        custom_branch_policies: false,
      },
    },
    reviews: [
      {
        state: "approved",
        user: { type: "User" },
        environments: [{ id: 99, name: "windows-release-stage-b" }],
      },
    ],
  };
}
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "joessh-msix-producer-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function file(path, bytes = "source-bound content") {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

test("context accepts only the exact protected dispatch source on standard Windows 2025", () => {
  assert.equal(validateBuildContext(contextEnv()).sha, sourceSha);
  assert.equal(
    validateBuildContext({ ...contextEnv(), ImageOS: "win25" }).sha,
    sourceSha,
  );
  assert.throws(() =>
    validateBuildContext({ ...contextEnv(), ImageOS: "win25-unreviewed" }),
  );
  for (const [key, value] of Object.entries({
    GITHUB_ACTIONS: "false",
    GITHUB_EVENT_NAME: "pull_request",
    GITHUB_REPOSITORY: "fork/JoeSSH",
    GITHUB_REF: "refs/heads/release",
    GITHUB_REF_PROTECTED: "false",
    REVIEWED_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_SHA: "b".repeat(40),
    GITHUB_WORKFLOW_REF: "other/workflow@refs/heads/main",
    RUNNER_ENVIRONMENT: "self-hosted",
    RUNNER_OS: "Linux",
    RUNNER_ARCH: "ARM64",
    ImageOS: "win22",
    GITHUB_RUN_ID: "",
    GITHUB_RUN_ATTEMPT: "0",
    RETENTION_DAYS: "31",
  })) {
    assert.throws(
      () => validateBuildContext({ ...contextEnv(), [key]: value }),
      undefined,
      key,
    );
  }
});

test("latest exact-SHA CI binds all 14 successful jobs and actual human environment approval", () => {
  const result = validateCiEvidence(
    ciFixture(),
    validateBuildContext(contextEnv()),
  );
  assert.equal(result.jobs.length, 14);
  assert.equal(result.ciRunAttempt, 2);
  assert.equal(result.stageB.humanApprovalVerified, true);
  assert.equal(JSON.stringify(result).includes("reviewer"), false);
});

for (const [name, mutate] of [
  [
    "main moved",
    (f) => {
      f.branch.commit.sha = "b".repeat(40);
    },
  ],
  [
    "unprotected branch",
    (f) => {
      f.branch.protected = false;
    },
  ],
  [
    "no CI",
    (f) => {
      f.runs.workflow_runs = [];
    },
  ],
  [
    "older successful run behind failed latest",
    (f) => {
      f.runs.workflow_runs.unshift({
        ...f.runs.workflow_runs[0],
        id: 7777,
        conclusion: "failure",
      });
    },
  ],
  [
    "PR CI instead of main push",
    (f) => {
      f.runs.workflow_runs[0].event = "pull_request";
    },
  ],
  [
    "wrong workflow",
    (f) => {
      f.runs.workflow_runs[0].path = ".github/workflows/fake.yml";
    },
  ],
  [
    "wrong SHA",
    (f) => {
      f.runs.workflow_runs[0].head_sha = "b".repeat(40);
    },
  ],
  [
    "running CI",
    (f) => {
      f.runs.workflow_runs[0].status = "in_progress";
    },
  ],
  [
    "failed job",
    (f) => {
      f.jobs.jobs[0].conclusion = "failure";
    },
  ],
  [
    "skipped job",
    (f) => {
      f.jobs.jobs[0].conclusion = "skipped";
    },
  ],
  [
    "missing job",
    (f) => {
      f.jobs.jobs.pop();
    },
  ],
  [
    "extra job",
    (f) => {
      f.jobs.jobs.push(f.jobs.jobs[0]);
    },
  ],
  [
    "duplicate job name",
    (f) => {
      f.jobs.jobs[0].name = f.jobs.jobs[1].name;
    },
  ],
  [
    "job from another attempt",
    (f) => {
      f.jobs.jobs[0].run_attempt = 1;
    },
  ],
  [
    "job from another run",
    (f) => {
      f.jobs.jobs[0].run_id = 1111;
    },
  ],
  [
    "admin bypass",
    (f) => {
      f.environment.can_admins_bypass = true;
    },
  ],
  [
    "no required reviewer",
    (f) => {
      f.environment.protection_rules = [];
    },
  ],
  [
    "any branch can deploy",
    (f) => {
      f.environment.deployment_branch_policy = null;
    },
  ],
  [
    "no actual approval",
    (f) => {
      f.reviews = [];
    },
  ],
  [
    "bot approval",
    (f) => {
      f.reviews[0].user.type = "Bot";
    },
  ],
  [
    "wrong environment approval",
    (f) => {
      f.reviews[0].environments[0].id = 98;
    },
  ],
]) {
  test(`CI policy rejects ${name}`, () => {
    const fixture = ciFixture();
    mutate(fixture);
    assert.throws(() =>
      validateCiEvidence(fixture, validateBuildContext(contextEnv())),
    );
  });
}

function mockedApi(fixture, alter = () => {}) {
  const calls = [];
  return {
    calls,
    fetch: async (url, options) => {
      calls.push(url);
      assert.equal(options.redirect, "error");
      assert.match(
        url,
        /^https:\/\/api\.github\.com\/repos\/JoeWorkspace\/JoeSSH\//,
      );
      let response;
      if (url.endsWith("branches/main")) response = fixture.branch;
      else if (url.includes("workflows/ci.yml/runs?")) response = fixture.runs;
      else if (url.includes("/jobs?")) response = fixture.jobs;
      else if (url.endsWith("/approvals")) response = fixture.reviews;
      else if (url.endsWith("windows-release-stage-b"))
        response = fixture.environment;
      else throw new Error("Unexpected API path.");
      const copy = structuredClone(response);
      alter(url, copy, calls);
      return { ok: true, status: 200, json: async () => copy };
    },
  };
}

test("online preflight requests exact SHA/latest attempt and rechecks races", async () => {
  const api = mockedApi(ciFixture());
  await verifyLatestMainCi(
    { ...contextEnv(), GH_TOKEN: "ephemeral-test-only" },
    api.fetch,
  );
  assert.ok(
    api.calls.includes(
      `https://api.github.com/repos/${STORE_BUILD_REPOSITORY}/actions/runs/5678/attempts/2/jobs?per_page=100`,
    ),
  );
  assert.equal(
    api.calls.filter((url) => url.endsWith("branches/main")).length,
    2,
  );
  const race = mockedApi(ciFixture(), (url, value, calls) => {
    if (
      url.endsWith("branches/main") &&
      calls.filter((entry) => entry === url).length > 1
    )
      value.commit.sha = "b".repeat(40);
  });
  await assert.rejects(
    verifyLatestMainCi(
      { ...contextEnv(), GH_TOKEN: "ephemeral-test-only" },
      race.fetch,
    ),
    /changed/,
  );
});

test("online policy fails closed on HTTP/network errors without cached fallback", async () => {
  await assert.rejects(
    verifyLatestMainCi(
      { ...contextEnv(), GH_TOKEN: "ephemeral-test-only" },
      async () => ({ ok: false, status: 403 }),
    ),
    /failed/,
  );
  await assert.rejects(
    verifyLatestMainCi(
      { ...contextEnv(), GH_TOKEN: "ephemeral-test-only" },
      async () => {
        throw new Error("timeout");
      },
    ),
    /timeout/,
  );
  await assert.rejects(
    verifyLatestMainCi(contextEnv(), async () => {
      throw new Error("must not fetch");
    }),
    /token/,
  );
});

test("Partner identity is canonical, product-bound and protected-publisher-bound", () => {
  assert.equal(
    decodePartnerIdentity(encode(partner), legalPublisher).productId,
    "9NK5LLMF8LHM",
  );
  for (const value of [
    { ...partner, extra: "signing" },
    { ...partner, productId: "9OTHERPRODUCT" },
    { ...partner, publisherDisplayName: "Another Publisher" },
    { ...partner, packageFamilyName: "AnotherPackage_a1b2c3d4e5f6g" },
    { ...partner, packageIdentityName: " JoeSSH.JoeSSH" },
  ])
    assert.throws(() => decodePartnerIdentity(encode(value), legalPublisher));
  for (const value of ["", `${encode(partner)}\n`, "not base64", "/w=="])
    assert.throws(() => decodePartnerIdentity(value, legalPublisher));
});

test("manifest preserves upgrade identity, old OS floor/runtime dependency, legal resource path and all locales", () => {
  const manifest = createStoreManifest(partner, "0.1.0-beta.23", languages);
  const parsed = parseMsixManifestContract(manifest);
  assert.equal(parsed.identity.version, "1.1.23.0");
  assert.equal(parsed.identity.architecture, "x64");
  assert.equal(
    parsed.desktopApplication.executable,
    STORE_MSIX_PROFILE.executable,
  );
  assert.deepEqual(parsed.languages, languages);
  assert.match(manifest, /Id="ATLASTERMDESKTOPSHELL"/);
  assert.match(manifest, /EntryPoint="Windows.FullTrustApplication"/);
  assert.match(
    manifest,
    /MinVersion="10.0.17763.0" MaxVersionTested="10.0.22000.1"/,
  );
  assert.match(
    manifest,
    /PackageDependency Name="Microsoft.WindowsAppRuntime.1.4" MinVersion="4000.1010.1349.0"/,
  );
  assert.doesNotMatch(
    manifest,
    /uninstall|Registry.dat|User.dat|\.lnk|broadFileSystemAccess|runFullTrust.*runFullTrust/,
  );
  assert.match(
    createStoreManifest(partner, "0.1.0-beta.24", languages),
    /Version="1.1.24.0"/,
  );
  assert.throws(
    () => createStoreManifest(partner, "0.1.0-beta.23", languages.slice(1)),
    /15/,
  );
  assert.throws(
    () =>
      createStoreManifest(partner, "0.1.0-beta.23", Array(15).fill("en-US")),
    /duplicate/,
  );
});

test("manifest escapes public identity fields instead of admitting XML injection", () => {
  const value = { ...partner, publisherDisplayName: 'Release & Team "One"' };
  const manifest = createStoreManifest(value, "0.1.0-beta.23", languages);
  assert.match(manifest, /Release &amp; Team &quot;One&quot;/);
  assert.equal(
    parseMsixManifestContract(manifest).identity.publisherDisplayName,
    value.publisherDisplayName,
  );
});

test("tree evidence catches changed bytes, extras, hardlinks and filesystem redirection", (t) => {
  const directory = temporary(t);
  const stage = join(directory, "stage");
  const unpacked = join(directory, "unpacked");
  file(join(stage, "app/main.exe"));
  file(join(stage, "AppxManifest.xml"));
  cpSync(stage, unpacked, { recursive: true });
  file(join(unpacked, "AppxBlockMap.xml"));
  file(join(unpacked, "[Content_Types].xml"));
  assert.equal(verifyPackageRoundTrip(stage, unpacked).length, 4);
  file(join(unpacked, "app/main.exe"), "tampered");
  assert.throws(() => verifyPackageRoundTrip(stage, unpacked), /differs/);
  copyFileSync(join(stage, "app/main.exe"), join(unpacked, "app/main.exe"));
  file(join(unpacked, "app/uninstall.exe"));
  assert.throws(() => verifyPackageRoundTrip(stage, unpacked), /differs/);
  linkSync(join(stage, "app/main.exe"), join(directory, "hardlink.exe"));
  assert.throws(() => fileEvidence(stage, "app/main.exe"), /single-link/);
  assert.equal(
    fileEvidence(stage, "app/main.exe", { requireSingleLink: false }).sha256,
    fileEvidence(directory, "hardlink.exe", { requireSingleLink: false })
      .sha256,
  );
});

test(
  "Windows native compiler discovery executes the real quoted Program Files tool path",
  { skip: process.platform !== "win32" },
  () => {
    const native = nativeBuildEnvironment(process.env);
    assert.match(native.VCToolsVersion, /^\d+\.\d+\.\d+/);
    const sdkVersion = native.WindowsSDKVersion.replaceAll("\\", "");
    assert.equal(findMakeAppx(process.env, sdkVersion).version, sdkVersion);
    const compiler = join(native.VCToolsInstallDir, "bin/Hostx64/x64/cl.exe");
    assert.match(
      fileEvidence(dirname(compiler), "cl.exe", { requireSingleLink: false })
        .sha256,
      /^[a-f0-9]{64}$/,
    );
    assert.throws(
      () => findMakeAppx(process.env, "10.0.1.0"),
      /Selected compiler/,
    );
  },
);

test("tree rejects symlinked or junction directories even when their target is internal", (t) => {
  const directory = temporary(t);
  const stage = join(directory, "stage");
  file(join(stage, "real/payload.exe"));
  symlinkSync(
    join(stage, "real"),
    join(stage, "alias"),
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => treeEvidence(stage), /symlink|junction/);
});

test("icon master and generated Microsoft assets have their actual required PNG dimensions", (t) => {
  const directory = temporary(t);
  const master = join(
    root,
    "apps/desktop/src-tauri/icons/joessh-icon-master-1024.png",
  );
  assertPngDimensions(readFileSync(master), 1024);
  const result = spawnSync(
    process.execPath,
    [
      join(root, "node_modules/@tauri-apps/cli/tauri.js"),
      "icon",
      master,
      "--output",
      join(directory, "icons"),
    ],
    { cwd: root, encoding: "utf8", shell: false, windowsHide: true },
  );
  assert.equal(result.status, 0, result.stderr);
  for (const [name, size] of [
    ["Square44x44Logo.png", 44],
    ["Square150x150Logo.png", 150],
    ["StoreLogo.png", 50],
  ]) {
    const bytes = readFileSync(join(directory, "icons", name));
    assertPngDimensions(bytes, size);
    assert.throws(() => assertPngDimensions(bytes, size + 1));
  }
});

test(
  "Windows SDK really packs and unpacks source payload, manifest, legal notice and generated icons",
  { skip: process.platform !== "win32" },
  (t) => {
    const directory = temporary(t);
    const stage = join(directory, "stage");
    file(
      join(stage, "AppxManifest.xml"),
      createStoreManifest(partner, "0.1.0-beta.23", languages),
    );
    // A real Windows PE from this test runtime; this fixture is never a release candidate.
    copyFileSync(process.execPath, join(stage, "fixture-node.exe"));
    mkdirSync(join(stage, "app"));
    copyFileSync(process.execPath, join(stage, STORE_MSIX_PROFILE.executable));
    rmSync(join(stage, "fixture-node.exe"));
    file(
      join(stage, "app/legal/THIRD-PARTY-NOTICES.txt"),
      "Native MakeAppx contract test; not a distribution artifact.\n",
    );
    const generated = join(directory, "icons");
    const icon = spawnSync(
      process.execPath,
      [
        join(root, "node_modules/@tauri-apps/cli/tauri.js"),
        "icon",
        join(root, "apps/desktop/src-tauri/icons/joessh-icon-master-1024.png"),
        "--output",
        generated,
      ],
      { cwd: root, encoding: "utf8", windowsHide: true },
    );
    assert.equal(icon.status, 0, icon.stderr);
    mkdirSync(join(stage, "Assets"));
    for (const name of [
      "Square44x44Logo.png",
      "Square150x150Logo.png",
      "StoreLogo.png",
    ])
      copyFileSync(join(generated, name), join(stage, "Assets", name));
    const args = {
      makeAppx: findMakeAppx().path,
      stage,
      destination: join(directory, "fixture.msix"),
      unpacked: join(directory, "unpacked"),
    };
    const verified = packAndVerifyMsix(args);
    assert.ok(verified.length >= 6 && verified.length <= 8);
    assert.equal(
      fileEvidence(args.unpacked, STORE_MSIX_PROFILE.executable).sha256,
      fileEvidence(stage, STORE_MSIX_PROFILE.executable).sha256,
    );
    assert.throws(() => packAndVerifyMsix(args), /fresh/);
    writeFileSync(
      join(args.unpacked, "app/legal/THIRD-PARTY-NOTICES.txt"),
      "changed",
    );
    assert.throws(
      () => verifyPackageRoundTrip(stage, args.unpacked),
      /differs/,
    );
  },
);
