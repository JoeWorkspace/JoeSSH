import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual, TextDecoder } from "node:util";
import {
  assertMicrosoftStoreTauriConfig,
  assertMsixIdentityMatches,
  assertMsixManifestLanguages,
  assertPartnerCenterLegalPublisher,
  assertProjectReleaseIdentity,
  deriveMsixVersion,
  parseMsixManifestContract,
  readCargoVersion,
  validatePartnerCenterIdentity,
} from "./windows-store-contract.mjs";
import { readWindowsStoreManifestLanguageContract } from "./windows-store-language-contract.mjs";
import {
  collectBundledThirdPartyNoticesEvidence,
  inspectPortableExecutable,
} from "./prepare-windows-store-candidate.mjs";
import { checkWindowsStoreSurfaces } from "./check-windows-store-surfaces.mjs";

const ROOT = resolve(import.meta.dirname, "..");
export const STORE_BUILD_WORKFLOW = ".github/workflows/windows-store-build.yml";
export const STORE_BUILD_PREDICATE =
  "https://github.com/JoeWorkspace/JoeSSH/attestations/windows-store-build/v1";
export const STORE_BUILD_REPOSITORY = "JoeWorkspace/JoeSSH";
export const STORE_CI_JOBS = Object.freeze(
  [
    "Lint",
    "Typecheck",
    "Unit Tests",
    "Mobile Tests",
    "Build",
    "E2E Tests",
    "Store Runtime Windows",
    "Visual QA",
    "Security Audit",
    "Rust Service",
    "Desktop Real SSH Smoke",
    "Tauri Shell",
    "Public Release Readiness",
    "Lighthouse",
  ].sort(),
);
export const STORE_MSIX_PROFILE = Object.freeze({
  applicationId: "ATLASTERMDESKTOPSHELL",
  identifier: "dev.atlasterm.joessh",
  executable: "app/atlasterm-desktop-shell.exe",
  entryPoint: "Windows.FullTrustApplication",
  minVersion: "10.0.17763.0",
  maxVersionTested: "10.0.22000.1",
  dependencyName: "Microsoft.WindowsAppRuntime.1.4",
  dependencyMinVersion: "4000.1010.1349.0",
  dependencyPublisher:
    "CN=Microsoft Corporation, O=Microsoft Corporation, L=Redmond, S=Washington, C=US",
});
const SCHEMAS = [
  "acl-manifests.json",
  "capabilities.json",
  "desktop-schema.json",
  "windows-schema.json",
].map((name) => `apps/desktop/src-tauri/gen/schemas/${name}`);
const SOURCE_BINDINGS = [
  "package.json",
  "package-lock.json",
  "Cargo.lock",
  "rust-toolchain.toml",
  "apps/desktop/package.json",
  "apps/desktop/src-tauri/Cargo.toml",
  "apps/desktop/src-tauri/Cargo.lock",
  "apps/desktop/src-tauri/tauri.conf.json",
  "apps/desktop/src-tauri/tauri.microsoftstore.conf.json",
  "apps/desktop/src-tauri/icons/joessh-icon-master-1024.png",
  "packages/i18n/src/windows-store-manifest-languages.json",
  STORE_BUILD_WORKFLOW,
  "scripts/build-windows-store-msix.mjs",
];
const ASSETS = Object.freeze({
  "Square44x44Logo.png": 44,
  "Square150x150Logo.png": 150,
  "StoreLogo.png": 50,
});

function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
function json(path) {
  return JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)),
  );
}
function saveJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
}
function run(
  command,
  args,
  {
    cwd = ROOT,
    env = process.env,
    inherit = false,
    allowStatus = [0],
    windowsVerbatimArguments = false,
  } = {},
) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
    windowsVerbatimArguments,
    stdio: inherit ? "inherit" : "pipe",
    maxBuffer: 16 * 1024 * 1024,
  });
  requireThat(
    !result.error && allowStatus.includes(result.status),
    `${basename(command)} failed (${result.status ?? "spawn"}).`,
  );
  return `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
}
function git(root, args) {
  return run("git", args, { cwd: root });
}
function inside(root, path) {
  const rel = relative(realpathSync.native(root), realpathSync.native(path));
  requireThat(
    rel !== ".." &&
      !rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) &&
      !isAbsolute(rel),
    "File escaped its source directory.",
  );
}
export function fileEvidence(root, path, { requireSingleLink = true } = {}) {
  const absolute = resolve(root, path);
  const info = lstatSync(absolute);
  requireThat(
    info.isFile() &&
      !info.isSymbolicLink() &&
      (!requireSingleLink || info.nlink === 1),
    "Evidence must be a direct single-link regular file.",
  );
  inside(root, absolute);
  const bytes = readFileSync(absolute);
  const after = lstatSync(absolute);
  requireThat(
    info.size === after.size &&
      info.mtimeMs === after.mtimeMs &&
      info.ctimeMs === after.ctimeMs &&
      info.ino === after.ino &&
      info.dev === after.dev &&
      info.nlink === after.nlink &&
      bytes.length === after.size,
    "Evidence changed while hashing.",
  );
  return {
    path: path.replaceAll("\\", "/"),
    sha256: sha256(bytes),
    sizeBytes: bytes.length,
  };
}
export function treeEvidence(root) {
  const files = [];
  const names = new Set();
  function visit(folder) {
    requireThat(
      !lstatSync(folder).isSymbolicLink(),
      "Package tree contains a symlink or junction.",
    );
    for (const name of readdirSync(folder).sort()) {
      requireThat(
        ![...name].some((character) => character.charCodeAt(0) < 32) &&
          !name.includes(":") &&
          !/[. ]$/.test(name),
        "Package contains an unsafe Windows filename.",
      );
      const path = join(folder, name);
      const info = lstatSync(path);
      requireThat(
        !info.isSymbolicLink(),
        "Package tree contains a symlink or junction.",
      );
      const rel = relative(root, path).replaceAll("\\", "/");
      requireThat(
        !names.has(rel.toLowerCase()),
        "Package contains case-colliding paths.",
      );
      names.add(rel.toLowerCase());
      if (info.isDirectory()) visit(path);
      else files.push(fileEvidence(root, rel));
    }
  }
  visit(root);
  return files.sort((a, b) => a.path.localeCompare(b.path, "en"));
}

export function validateBuildContext(env) {
  requireThat(
    env.GITHUB_ACTIONS === "true" &&
      env.GITHUB_EVENT_NAME === "workflow_dispatch",
    "Producer requires workflow_dispatch on GitHub Actions.",
  );
  requireThat(
    env.GITHUB_REPOSITORY === STORE_BUILD_REPOSITORY &&
      env.GITHUB_REF === "refs/heads/main" &&
      env.GITHUB_REF_PROTECTED === "true",
    "Producer requires this repository's protected main.",
  );
  requireThat(
    /^[a-f0-9]{40}$/.test(env.REVIEWED_SHA ?? "") &&
      env.REVIEWED_SHA === env.GITHUB_SHA &&
      env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA,
    "Reviewed source and workflow SHA must exactly equal github.sha.",
  );
  requireThat(
    env.GITHUB_WORKFLOW_REF ===
      `${STORE_BUILD_REPOSITORY}/${STORE_BUILD_WORKFLOW}@refs/heads/main`,
    "Unexpected producer workflow identity.",
  );
  requireThat(
    env.RUNNER_ENVIRONMENT === "github-hosted" &&
      env.RUNNER_OS === "Windows" &&
      env.RUNNER_ARCH === "X64" &&
      ["win25", "win25-vs2026"].includes(env.ImageOS),
    "Producer requires standard Windows 2025 x64 GitHub-hosted image.",
  );
  requireThat(
    /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID ?? "") &&
      /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT ?? ""),
    "Run identity is missing.",
  );
  requireThat(
    /^(?:[1-9]|[12][0-9]|30)$/.test(env.RETENTION_DAYS ?? ""),
    "Artifact retention must be 1-30 days.",
  );
  return {
    repository: STORE_BUILD_REPOSITORY,
    sha: env.GITHUB_SHA,
    ref: env.GITHUB_REF,
    workflow: STORE_BUILD_WORKFLOW,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT,
    retentionDays: Number(env.RETENTION_DAYS),
  };
}

export function validateCiEvidence(
  { branch, runs, jobs, environment, reviews },
  context,
) {
  requireThat(
    branch?.name === "main" &&
      branch.protected === true &&
      branch.commit?.sha === context.sha,
    "Reviewed SHA must still be the current protected main HEAD.",
  );
  const run = runs?.workflow_runs?.[0];
  requireThat(
    run &&
      run.path === ".github/workflows/ci.yml" &&
      run.head_sha === context.sha &&
      run.head_branch === "main" &&
      run.event === "push" &&
      run.status === "completed" &&
      run.conclusion === "success" &&
      run.repository?.full_name === STORE_BUILD_REPOSITORY &&
      Number.isSafeInteger(run.id) &&
      Number.isSafeInteger(run.run_attempt),
    "Latest push CI for this exact SHA must be completed and successful.",
  );
  requireThat(
    jobs?.total_count === 14 &&
      jobs.jobs?.length === 14 &&
      isDeepStrictEqual(jobs.jobs.map((job) => job.name).sort(), STORE_CI_JOBS),
    "CI must contain exactly the 14 reviewed jobs.",
  );
  requireThat(
    jobs.jobs.every(
      (job) =>
        job.status === "completed" &&
        job.conclusion === "success" &&
        job.head_sha === context.sha &&
        job.run_id === run.id &&
        job.run_attempt === run.run_attempt,
    ),
    "Every job in the latest CI attempt must succeed for this SHA.",
  );
  const rules = environment?.protection_rules?.filter(
    (rule) => rule.type === "required_reviewers",
  );
  requireThat(
    environment?.name === "windows-release-stage-b" &&
      environment.can_admins_bypass === false &&
      rules?.length === 1 &&
      rules[0].reviewers?.length > 0 &&
      environment.deployment_branch_policy?.protected_branches === true &&
      environment.deployment_branch_policy?.custom_branch_policies === false,
    "Stage B must require a reviewer, prevent admin bypass, and accept protected branches only.",
  );
  requireThat(
    Array.isArray(reviews) &&
      reviews.some(
        (review) =>
          review.state === "approved" &&
          review.user?.type === "User" &&
          review.environments?.some(
            (entry) =>
              entry.id === environment.id && entry.name === environment.name,
          ),
      ),
    "This workflow run requires an actual human Stage B approval.",
  );
  return {
    schemaVersion: 1,
    sourceSha: context.sha,
    producerRunId: context.runId,
    producerRunAttempt: context.runAttempt,
    ciRunId: run.id,
    ciRunAttempt: run.run_attempt,
    ciUrl: `https://github.com/${STORE_BUILD_REPOSITORY}/actions/runs/${run.id}`,
    jobs: jobs.jobs
      .map(({ name, id, conclusion }) => ({ name, id, conclusion }))
      .sort((a, b) => a.name.localeCompare(b.name, "en")),
    stageB: {
      environmentId: environment.id,
      humanApprovalVerified: true,
      protectedBranchesOnly: true,
      adminBypassDisabled: true,
    },
  };
}

export async function verifyLatestMainCi(env = process.env, fetchImpl = fetch) {
  const context = validateBuildContext(env);
  requireThat(
    typeof env.GH_TOKEN === "string" && env.GH_TOKEN.length > 0,
    "Ephemeral GitHub job token is required for read-only CI verification.",
  );
  async function api(path) {
    const response = await fetchImpl(
      `https://api.github.com/repos/${STORE_BUILD_REPOSITORY}/${path}`,
      {
        headers: {
          Authorization: `Bearer ${env.GH_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      },
    );
    requireThat(
      response.ok,
      `GitHub read-only CI policy query failed (${response.status}).`,
    );
    return response.json();
  }
  const [branch, runs, environment, reviews] = await Promise.all([
    api("branches/main"),
    api(
      `actions/workflows/ci.yml/runs?head_sha=${context.sha}&branch=main&event=push&per_page=1`,
    ),
    api("environments/windows-release-stage-b"),
    api(`actions/runs/${context.runId}/approvals`),
  ]);
  const latest = runs?.workflow_runs?.[0];
  requireThat(
    Number.isSafeInteger(latest?.id) &&
      Number.isSafeInteger(latest?.run_attempt),
    "Latest CI run is missing.",
  );
  const jobs = await api(
    `actions/runs/${latest.id}/attempts/${latest.run_attempt}/jobs?per_page=100`,
  );
  const [finalBranch, finalRuns] = await Promise.all([
    api("branches/main"),
    api(
      `actions/workflows/ci.yml/runs?head_sha=${context.sha}&branch=main&event=push&per_page=1`,
    ),
  ]);
  requireThat(
    finalBranch?.commit?.sha === branch?.commit?.sha &&
      finalBranch?.protected === true &&
      finalRuns?.workflow_runs?.[0]?.id === latest.id &&
      finalRuns.workflow_runs[0].run_attempt === latest.run_attempt &&
      finalRuns.workflow_runs[0].status === "completed" &&
      finalRuns.workflow_runs[0].conclusion === "success",
    "Main or its latest CI attempt changed during policy verification.",
  );
  return validateCiEvidence(
    { branch, runs, jobs, environment, reviews },
    context,
  );
}

export function decodePartnerIdentity(encoded, legalPublisher) {
  requireThat(
    typeof encoded === "string" &&
      encoded.length <= 32_768 &&
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
        encoded,
      ),
    "Partner identity must be canonical base64 JSON.",
  );
  const bytes = Buffer.from(encoded, "base64");
  requireThat(
    bytes.length > 0 && bytes.toString("base64") === encoded,
    "Partner identity must be canonical base64 JSON.",
  );
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Partner identity must be valid UTF-8 JSON.");
  }
  const expected = [
    "schemaVersion",
    "source",
    "productId",
    "packageIdentityName",
    "publisher",
    "publisherDisplayName",
    "publisherId",
    "packageFamilyName",
    "reservedAt",
  ].sort();
  requireThat(
    value &&
      isDeepStrictEqual(Object.keys(value).sort(), expected) &&
      Object.values(value).every(
        (entry) => typeof entry !== "string" || entry === entry.trim(),
      ),
    "Partner identity has unexpected or noncanonical fields.",
  );
  const validated = validatePartnerCenterIdentity(value);
  requireThat(
    validated.productId === "9NK5LLMF8LHM",
    "Partner identity must belong to the existing JoeSSH Store product.",
  );
  assertPartnerCenterLegalPublisher(validated, legalPublisher);
  return validated;
}
function xml(value) {
  requireThat(
    typeof value === "string" &&
      ![...value].some((character) => character.charCodeAt(0) < 32),
    "Manifest values must be control-free strings.",
  );
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("'", "&apos;");
}
export function createStoreManifest(partner, version, languages) {
  requireThat(
    languages.length === 15,
    "Producer requires all 15 reviewed UI locales.",
  );
  const p = STORE_MSIX_PROFILE;
  const manifest = `<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10" xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10" xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities" IgnorableNamespaces="uap rescap">
  <Identity Name="${xml(partner.packageIdentityName)}" Publisher="${xml(partner.publisher)}" Version="${deriveMsixVersion(version)}" ProcessorArchitecture="x64" />
  <Properties><DisplayName>JoeSSH</DisplayName><PublisherDisplayName>${xml(partner.publisherDisplayName)}</PublisherDisplayName><Description>SSH terminal, SFTP and local port forwarding</Description><Logo>Assets\\StoreLogo.png</Logo></Properties>
  <Resources>
${languages.map((language) => `    <Resource Language="${xml(language)}" />`).join("\n")}
  </Resources>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="${p.minVersion}" MaxVersionTested="${p.maxVersionTested}" />
    <PackageDependency Name="${p.dependencyName}" MinVersion="${p.dependencyMinVersion}" Publisher="${xml(p.dependencyPublisher)}" />
  </Dependencies>
  <Applications><Application Id="${p.applicationId}" Executable="${p.executable.replaceAll("/", "\\")}" EntryPoint="${p.entryPoint}"><uap:VisualElements DisplayName="JoeSSH" Description="SSH terminal, SFTP and local port forwarding" Square150x150Logo="Assets\\Square150x150Logo.png" Square44x44Logo="Assets\\Square44x44Logo.png" BackgroundColor="transparent" /></Application></Applications>
  <Capabilities><rescap:Capability Name="runFullTrust" /></Capabilities>
</Package>
`;
  const parsed = parseMsixManifestContract(manifest);
  assertMsixIdentityMatches(parsed.identity, partner);
  assertMsixManifestLanguages(parsed.languages, languages);
  return manifest;
}

export function assertPngDimensions(bytes, size) {
  requireThat(
    bytes.length > 24 &&
      bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
      bytes.toString("ascii", 12, 16) === "IHDR" &&
      bytes.readUInt32BE(16) === size &&
      bytes.readUInt32BE(20) === size,
    `Expected a ${size} by ${size} PNG.`,
  );
}
export function findMakeAppx(env = process.env, selectedVersion) {
  const sdkRoot = join(
    env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
    "Windows Kits",
    "10",
    "bin",
  );
  const versions = readdirSync(sdkRoot)
    .filter(
      (version) =>
        /^10\.0\.\d+\.0$/.test(version) &&
        existsSync(join(sdkRoot, version, "x64", "makeappx.exe")),
    )
    .sort((a, b) => Number(b.split(".")[2]) - Number(a.split(".")[2]));
  requireThat(versions.length > 0, "Windows SDK MakeAppx is required.");
  const version = selectedVersion ?? versions[0];
  requireThat(
    versions.includes(version),
    "Selected compiler Windows SDK must provide x64 MakeAppx.",
  );
  return { path: join(sdkRoot, version, "x64", "makeappx.exe"), version };
}
export function verifyPackageRoundTrip(stage, unpacked) {
  const before = treeEvidence(stage);
  const after = treeEvidence(unpacked);
  const generated = ["AppxBlockMap.xml", "[Content_Types].xml"];
  // MakeAppx unpack omits some container metadata depending on SDK version.
  // Every source file is still required byte-for-byte; only these two native
  // package metadata files may additionally appear in its unpacked output.
  requireThat(
    after
      .filter((file) => generated.includes(file.path))
      .every((file) => file.sizeBytes > 0),
    "Unpacked package metadata must not be empty.",
  );
  requireThat(
    isDeepStrictEqual(
      before,
      after.filter((file) => !generated.includes(file.path)),
    ),
    "Unpacked MSIX payload or manifest differs from the compiled staging tree.",
  );
  requireThat(
    !after.some((file) => /(?:^|\/)AppxSignature\.p7x$/i.test(file.path)),
    "Producer must not import signing material or a prior signed package.",
  );
  return after;
}
export function packAndVerifyMsix({ makeAppx, stage, destination, unpacked }) {
  requireThat(
    !existsSync(destination) && !existsSync(unpacked),
    "MSIX output and verification directory must be fresh.",
  );
  const before = treeEvidence(stage);
  run(makeAppx, ["pack", "/v", "/h", "SHA256", "/d", stage, "/p", destination]);
  run(makeAppx, ["unpack", "/v", "/p", destination, "/d", unpacked]);
  requireThat(
    isDeepStrictEqual(before, treeEvidence(stage)),
    "Staged payload changed during MakeAppx packaging.",
  );
  return verifyPackageRoundTrip(stage, unpacked);
}

function cleanSource(root, sha) {
  requireThat(
    git(root, ["rev-parse", "HEAD"]) === sha,
    "Build checkout differs from reviewed SHA.",
  );
  const gitRoot = realpathSync.native(
    git(root, ["rev-parse", "--show-toplevel"]),
  );
  requireThat(
    gitRoot.toLowerCase() === realpathSync.native(root).toLowerCase(),
    "Build must run from the actual repository root.",
  );
  requireThat(
    git(root, ["status", "--porcelain", "--untracked-files=all"]) === "",
    "Build requires a clean reviewed worktree.",
  );
}
function copyEvidenceTree(source, destination) {
  for (const file of treeEvidence(source)) {
    const target = resolve(destination, file.path);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(resolve(source, file.path), target);
    requireThat(
      fileEvidence(destination, file.path).sha256 === file.sha256,
      "Copied evidence changed.",
    );
  }
}
export function nativeBuildEnvironment(env) {
  const vswhere = join(
    env["ProgramFiles(x86)"] ?? "C:/Program Files (x86)",
    "Microsoft Visual Studio",
    "Installer",
    "vswhere.exe",
  );
  const install = run(vswhere, [
    "-latest",
    "-products",
    "*",
    "-requires",
    "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
    "-property",
    "installationPath",
  ]);
  const devcmd = join(install, "Common7", "Tools", "VsDevCmd.bat");
  requireThat(
    existsSync(devcmd) && !/[\r\n"&|<>^%!]/.test(devcmd),
    "MSVC developer tools path is unsafe or missing.",
  );
  const output = run(
    env.ComSpec || "cmd.exe",
    [
      "/d",
      "/s",
      "/c",
      'call "%JOESSH_VSDEV_CMD%" -no_logo -arch=x64 -host_arch=x64 >nul && set',
    ],
    {
      env: { ...env, JOESSH_VSDEV_CMD: devcmd },
      windowsVerbatimArguments: true,
    },
  );
  const native = { ...env };
  for (const line of output.split(/\r?\n/)) {
    const equal = line.indexOf("=");
    if (equal > 0) {
      const key = line.slice(0, equal);
      for (const existing of Object.keys(native)) {
        if (existing.toLowerCase() === key.toLowerCase())
          delete native[existing];
      }
      native[key] = line.slice(equal + 1);
    }
  }
  requireThat(
    native.VCToolsInstallDir &&
      native.VCToolsVersion &&
      native.WindowsSDKVersion,
    "MSVC and SDK environment discovery failed.",
  );
  return native;
}

export function buildWindowsStoreMsix(env = process.env, root = ROOT) {
  requireThat(
    process.platform === "win32",
    "Source MSIX build requires Windows.",
  );
  const context = validateBuildContext(env);
  cleanSource(root, context.sha);
  requireThat(
    !env.ACTIONS_ID_TOKEN_REQUEST_TOKEN && !env.GH_TOKEN && !env.GITHUB_TOKEN,
    "Compilation must not receive OIDC or GitHub API tokens.",
  );
  requireThat(
    !env.TAURI_CONFIG &&
      !env.RUSTFLAGS &&
      !env.CARGO_ENCODED_RUSTFLAGS &&
      !env.ATLASTERM_WINDOWS_STORE_SIGNING_CONFIG,
    "Unreviewed build or signing overrides are forbidden.",
  );
  const partner = decodePartnerIdentity(
    env.PARTNER_IDENTITY_BASE64,
    env.ATLASTERM_WINDOWS_LEGAL_PUBLISHER,
  );
  const tauri = json(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"));
  const identity = assertProjectReleaseIdentity({
    rootPackage: json(resolve(root, "package.json")),
    desktopPackage: json(resolve(root, "apps/desktop/package.json")),
    tauriConfig: tauri,
    cargoVersion: readCargoVersion(
      resolve(root, "apps/desktop/src-tauri/Cargo.toml"),
    ),
    legalPublisher: env.ATLASTERM_WINDOWS_LEGAL_PUBLISHER,
  });
  requireThat(
    identity.identifier === STORE_MSIX_PROFILE.identifier &&
      identity.productName === "JoeSSH",
    "Existing application identifier and product name must not change.",
  );
  assertMicrosoftStoreTauriConfig(
    json(
      resolve(root, "apps/desktop/src-tauri/tauri.microsoftstore.conf.json"),
    ),
  );
  const languageContract = readWindowsStoreManifestLanguageContract(
    resolve(root, "packages/i18n/src/windows-store-manifest-languages.json"),
  );
  requireThat(
    languageContract.manifestLanguages.length === 15,
    "Expected the complete 15-locale contract.",
  );
  const sourceBindings = SOURCE_BINDINGS.map((path) =>
    fileEvidence(root, path),
  );
  const schemaSnapshots = SCHEMAS.map((path) => ({
    path,
    bytes: readFileSync(resolve(root, path)),
  }));
  const temporaryRoot = realpathSync.native(env.RUNNER_TEMP);
  const work = join(
    temporaryRoot,
    `joessh-store-source-${context.runId}-${context.runAttempt}`,
  );
  mkdirSync(work); // No reuse of stale output, uploaded binaries, or earlier builds.
  const stage = join(work, "package");
  const evidenceRoot = join(work, "evidence");
  mkdirSync(stage);
  mkdirSync(evidenceRoot);
  const ci = json(join(temporaryRoot, "joessh-store-ci.json"));
  requireThat(
    ci.sourceSha === context.sha &&
      ci.producerRunId === context.runId &&
      ci.producerRunAttempt === context.runAttempt &&
      ci.stageB?.humanApprovalVerified === true &&
      ci.jobs?.length === 14,
    "Fresh CI policy evidence is missing or belongs to another run.",
  );
  const native = nativeBuildEnvironment(env);
  const buildEnv = {
    ...native,
    CARGO_TARGET_DIR: join(work, "cargo-target"),
    CARGO_BUILD_JOBS: "2",
  };
  const tauriCli = resolve(root, "node_modules/@tauri-apps/cli/tauri.js");
  const npmCommand = run("where.exe", ["npm.cmd"], { env: buildEnv }).split(
    /\r?\n/,
  )[0];
  const npmCli = resolve(
    dirname(npmCommand),
    "node_modules/npm/bin/npm-cli.js",
  );
  requireThat(
    json(resolve(root, "node_modules/@tauri-apps/cli/package.json")).version ===
      json(resolve(root, "package-lock.json")).packages[
        "node_modules/@tauri-apps/cli"
      ].version,
    "Installed Tauri CLI must equal the npm lock.",
  );
  const sdk = findMakeAppx(env, native.WindowsSDKVersion.replaceAll("\\", ""));
  requireThat(
    native.WindowsSDKVersion.replaceAll("\\", "") === sdk.version,
    "Compiler and packaging must use the same Windows SDK.",
  );
  const cl = join(native.VCToolsInstallDir, "bin", "Hostx64", "x64", "cl.exe");
  const linker = join(
    native.VCToolsInstallDir,
    "bin",
    "Hostx64",
    "x64",
    "link.exe",
  );
  buildEnv.CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER = linker;
  const rustc = run("rustup", ["which", "rustc"], { env: buildEnv });
  const cargo = run("rustup", ["which", "cargo"], { env: buildEnv });
  // Hosted toolchains may legitimately use hardlinks. They are measured, not
  // copied into the package; source/payload files keep the single-link rule.
  const toolHash = (path) =>
    fileEvidence(dirname(path), basename(path), { requireSingleLink: false })
      .sha256;
  const tools = {
    node: {
      version: process.version,
      sha256: toolHash(process.execPath),
    },
    npm: {
      version: run(process.execPath, [npmCli, "--version"], { env: buildEnv }),
    },
    tauri: {
      version: json(resolve(root, "node_modules/@tauri-apps/cli/package.json"))
        .version,
    },
    rustc: {
      version: run(rustc, ["--version", "--verbose"], { env: buildEnv }),
      sha256: toolHash(rustc),
    },
    cargo: {
      version: run(cargo, ["--version"], { env: buildEnv }),
      sha256: toolHash(cargo),
    },
    msvc: {
      version: native.VCToolsVersion,
      compilerSha256: toolHash(cl),
      linkerSha256: toolHash(linker),
    },
    windowsSdk: {
      version: sdk.version,
      makeAppxSha256: toolHash(sdk.path),
    },
    runner: {
      image: env.ImageOS,
      imageVersion: env.ImageVersion,
      architecture: env.RUNNER_ARCH,
    },
  };
  requireThat(
    tools.node.version === "v22.22.2" &&
      tools.npm.version === "10.9.7" &&
      tools.rustc.version.startsWith("rustc 1.96.0 ") &&
      tools.cargo.version.startsWith("cargo 1.96.0 "),
    "Pinned compiler/runtime versions are required.",
  );
  const override = join(work, "identity.json");
  saveJson(override, { bundle: { publisher: identity.publisher } });
  try {
    requireThat(
      !existsSync(resolve(root, "apps/desktop/dist")),
      "Fresh source producer must not reuse a frontend build.",
    );
    run(process.execPath, [npmCli, "run", "release:desktop:legal-resource"], {
      cwd: root,
      env: buildEnv,
      inherit: true,
    });
    const legal = collectBundledThirdPartyNoticesEvidence(root);
    run(
      process.execPath,
      [
        tauriCli,
        "build",
        "--ci",
        "--no-bundle",
        "--target",
        "x86_64-pc-windows-msvc",
        "--config",
        "src-tauri/tauri.microsoftstore.conf.json",
        "--config",
        override,
        "--",
        "--locked",
        "-j",
        "2",
      ],
      { cwd: resolve(root, "apps/desktop"), env: buildEnv, inherit: true },
    );
    const surfaces = checkWindowsStoreSurfaces(root, {
      distPath: "apps/desktop/dist",
    });
    requireThat(
      surfaces.every((result) => result.passed),
      "Compiled Store frontend surface checks failed.",
    );
    const payloadPath = join(
      buildEnv.CARGO_TARGET_DIR,
      "x86_64-pc-windows-msvc",
      "release",
      "atlasterm-desktop-shell.exe",
    );
    // Cargo can hardlink release binaries from its own deps directory. Only
    // this fresh target output may have multiple links; the copied staging
    // payload is independently hashed and must be a single-link regular file.
    const payload = fileEvidence(dirname(payloadPath), basename(payloadPath), {
      requireSingleLink: false,
    });
    requireThat(
      inspectPortableExecutable(readFileSync(payloadPath)).machine === "x64",
      "Compiled executable must be Windows x64 PE.",
    );
    const targetExe = resolve(stage, STORE_MSIX_PROFILE.executable);
    mkdirSync(dirname(targetExe), { recursive: true });
    copyFileSync(payloadPath, targetExe);
    mkdirSync(join(dirname(targetExe), "legal"));
    copyFileSync(
      legal.absolutePath,
      join(dirname(targetExe), "legal", "THIRD-PARTY-NOTICES.txt"),
    );
    const iconMaster = resolve(
      root,
      "apps/desktop/src-tauri/icons/joessh-icon-master-1024.png",
    );
    assertPngDimensions(readFileSync(iconMaster), 1024);
    const generatedIcons = join(work, "icons");
    run(
      process.execPath,
      [tauriCli, "icon", iconMaster, "--output", generatedIcons],
      { cwd: root, env: buildEnv },
    );
    mkdirSync(join(stage, "Assets"));
    for (const [name, size] of Object.entries(ASSETS)) {
      const bytes = readFileSync(join(generatedIcons, name));
      assertPngDimensions(bytes, size);
      writeFileSync(join(stage, "Assets", name), bytes, { flag: "wx" });
    }
    const manifest = createStoreManifest(
      partner,
      identity.version,
      languageContract.manifestLanguages,
    );
    writeFileSync(join(stage, "AppxManifest.xml"), manifest, { flag: "wx" });
    const fileName = `JoeSSH_${deriveMsixVersion(identity.version)}_x64_${context.sha.slice(0, 12)}_${context.runId}_${context.runAttempt}.msix`;
    const msixPath = join(work, fileName);
    const unpacked = join(work, "verified-unpacked");
    const packagedFiles = packAndVerifyMsix({
      makeAppx: sdk.path,
      stage,
      destination: msixPath,
      unpacked,
    });
    const legalAfter = collectBundledThirdPartyNoticesEvidence(root);
    requireThat(
      isDeepStrictEqual(
        legal.boundFiles.map(({ path, sha256 }) => ({ path, sha256 })),
        legalAfter.boundFiles.map(({ path, sha256 }) => ({ path, sha256 })),
      ),
      "Legal/SBOM evidence changed during compilation.",
    );
    requireThat(
      fileEvidence(unpacked, STORE_MSIX_PROFILE.executable).sha256 ===
        payload.sha256 &&
        fileEvidence(unpacked, "app/legal/THIRD-PARTY-NOTICES.txt").sha256 ===
          legal.sha256,
      "Unpacked executable and notices must equal fresh source build outputs.",
    );
    for (const snapshot of schemaSnapshots) {
      fileEvidence(root, snapshot.path);
      writeFileSync(resolve(root, snapshot.path), snapshot.bytes);
    }
    cleanSource(root, context.sha);
    requireThat(
      isDeepStrictEqual(
        sourceBindings,
        SOURCE_BINDINGS.map((path) => fileEvidence(root, path)),
      ),
      "Reviewed source inputs changed during build.",
    );
    const artifact = fileEvidence(work, fileName);
    const predicate = {
      schemaVersion: 1,
      source: {
        repository: context.repository,
        sha: context.sha,
        ref: context.ref,
        tree: git(root, ["rev-parse", "HEAD^{tree}"]),
      },
      builder: {
        workflow: STORE_BUILD_WORKFLOW,
        runId: context.runId,
        runAttempt: context.runAttempt,
        environment: "windows-release-stage-b",
        toolchainTarget: "x86_64-pc-windows-msvc",
        noBundle: true,
        cargoLocked: true,
      },
      artifact,
      projectVersion: identity.version,
      msixVersion: deriveMsixVersion(identity.version),
      identity: {
        productId: partner.productId,
        packageFamilyNameSha256: sha256(partner.packageFamilyName),
        partnerIdentitySha256: sha256(JSON.stringify(partner)),
        applicationId: STORE_MSIX_PROFILE.applicationId,
        tauriIdentifier: identity.identifier,
      },
      tools,
      sourceBindings,
      languageContract,
      ci,
      packagedFiles,
      manifestSha256: fileEvidence(stage, "AppxManifest.xml").sha256,
      frontend: {
        profile: "microsoft-store",
        files: treeEvidence(resolve(root, "apps/desktop/dist")),
      },
      legal: {
        bundleResourcePath: legal.bundleResourcePath,
        files: legal.boundFiles.map(({ path, sha256, sizeBytes }) => ({
          path,
          sha256,
          sizeBytes,
        })),
      },
      validation: {
        makeAppxPackAndUnpack: true,
        byteExactPayloadRoundTrip: true,
        allStoreSurfaceChecks: true,
      },
      publication: {
        authenticode: "unsigned-awaiting-Microsoft-Store",
        hostedCandidateVerification: "not-run",
        installation: "not-run",
        windowsAppCertificationKit: "not-run",
        partnerCenterUpload: "not-performed",
        storeCertification: "not-performed",
        storePublicationReady: false,
      },
    };
    saveJson(join(evidenceRoot, "predicate.json"), predicate);
    saveJson(join(evidenceRoot, "ci.json"), ci);
    copyFileSync(
      join(stage, "AppxManifest.xml"),
      join(evidenceRoot, "AppxManifest.xml"),
    );
    copyEvidenceTree(
      resolve(root, "reports/release/third-party-licenses"),
      join(evidenceRoot, "third-party-licenses"),
    );
    for (const file of legal.boundFiles) {
      const target = join(evidenceRoot, "release", basename(file.path));
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(resolve(root, file.path), target);
    }
    const evidenceFiles = treeEvidence(evidenceRoot);
    writeFileSync(
      join(evidenceRoot, "SHA256SUMS.txt"),
      evidenceFiles.map((file) => `${file.sha256}  ${file.path}\n`).join(""),
      { flag: "wx" },
    );
    const predicateSha256 = fileEvidence(evidenceRoot, "predicate.json").sha256;
    if (env.GITHUB_OUTPUT)
      appendFileSync(
        env.GITHUB_OUTPUT,
        `msix_path=${msixPath}\nfile_name=${fileName}\nmsix_sha256=${artifact.sha256}\npredicate_sha256=${predicateSha256}\nevidence_path=${evidenceRoot}\nretention_days=${context.retentionDays}\n`,
      );
    return { msixPath, evidenceRoot, artifact, predicateSha256 };
  } finally {
    // Only restore these four generated schema files; never reset arbitrary source changes.
    for (const snapshot of schemaSnapshots) {
      fileEvidence(root, snapshot.path);
      if (!readFileSync(resolve(root, snapshot.path)).equals(snapshot.bytes))
        writeFileSync(resolve(root, snapshot.path), snapshot.bytes);
    }
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (isDeepStrictEqual(process.argv.slice(2), ["--verify-ci"])) {
      const result = await verifyLatestMainCi();
      saveJson(
        join(
          realpathSync.native(process.env.RUNNER_TEMP),
          "joessh-store-ci.json",
        ),
        result,
      );
      console.log(
        `Verified exact source CI: ${result.ciRunId}, 14 successful jobs and human Stage B approval.`,
      );
    } else {
      requireThat(
        process.argv.length === 2,
        "Producer accepts no artifact path or build override arguments.",
      );
      const result = buildWindowsStoreMsix();
      console.log(
        `Built and MakeAppx-verified ${result.artifact.path}; sha256=${result.artifact.sha256}. Installation, hosted verification, WACK and Store certification remain separate.`,
      );
    }
  } catch (error) {
    console.error(`Windows Store source producer: ${error.message}`);
    process.exitCode = 1;
  }
}
