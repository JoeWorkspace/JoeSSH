import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseDocument } from "yaml";

const defaultRoot = resolve(import.meta.dirname, "..");
const BUILD_WORKFLOW = ".github/workflows/windows-store-build.yml";
const BUILD_TESTS =
  "node --test scripts/check-windows-store-build.test.mjs scripts/build-windows-store-msix.test.mjs";
const BUILD_CHECK = "node scripts/check-windows-store-build.mjs";
const PINNED_ACTIONS = Object.freeze({
  checkout: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  node: "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  rust: "dtolnay/rust-toolchain@2c7215f132e9ebf062739d9130488b56d53c060c",
  upload: "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  download:
    "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c",
  attest: "actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6",
});
const BUILD_PREDICATE_TYPE =
  "https://github.com/JoeWorkspace/JoeSSH/attestations/windows-store-build/v1";
const EXPECTED_CI_JOB_NAMES = Object.freeze({
  lint: "Lint",
  typecheck: "Typecheck",
  "test-unit": "Unit Tests",
  "test-mobile": "Mobile Tests",
  build: "Build",
  "test-e2e": "E2E Tests",
  "store-runtime-windows": "Store Runtime Windows",
  "visual-qa": "Visual QA",
  "security-audit": "Security Audit",
  rust: "Rust Service",
  "desktop-real-ssh-smoke": "Desktop Real SSH Smoke",
  "tauri-shell": "Tauri Shell",
  "public-release-readiness": "Public Release Readiness",
  lighthouse: "Lighthouse",
});

// These hashes bind the executable workflow, not generated build evidence.
// Updating them requires reviewing every changed field and execution step.
const REVIEWED_WORKFLOW_METADATA_SHA256 =
  "c780a3efbc701a7d3817dc331648130c23cd4bcde55c74de0ca6d5fcfc92f12d";
const REVIEWED_JOB_METADATA_SHA256 = Object.freeze({
  build: "58596890a9017fc6a97bbdad484abe6985d0e60716f7e980ec6c2389dcb1859a",
  attest: "4c44110ace2148ce7b6fdebb21b53c89341b8bcb5016091bc0e30977f46153d3",
});
const REVIEWED_STEP_SHA256 = Object.freeze({
  build: [
    "69837b2c84dfb805146948b9c0527df814373da0bbc275f0c71ede54140d0d70",
    "0ac9db6cdb4373f99c058059f3d71a9d0fd12a23352d45f8cea152c043ba540b",
    "133b96e641396fa411c6f6478f1f461b7cd8e2840befb437eb46a80b21ebd13b",
    "59005435e1a2f95b4061a9ac33fda3f9d6fef20c9c8cf81e8170d0949b4010fb",
    "109ae239eaec1e4bc23b7f2afd3feae295b236af863f62fdda671b8619935716",
    "cb5ef2ce1a45bbeb0ad772b7f5bb7466677090e94ab80160a06dc5b00e3e4920",
    "d247a1b86594ba845aa5ccaea78d3caba09108bca47f8a5ab51d110367f7d681",
    "6ced7fd10d582699b0b754c6e6e029095e2034c9da0fff36248dfc002c6a74a0",
    "c0e0758d692b06d516d137fa5e4313626e0bfe8dab2f8f9d5f0e0cae7ee2afe6",
  ],
  attest: [
    "2f3bc8fb1de2403fac3aea8cc23ea75393187499a3fb138a073994d807905035",
    "4b9f2406a4b88ebfbfb267b5362a54629127ed019565f79470733860029c7ca0",
    "f6494182d7d1304a42bdb9f96e489fade8609b4a7557481907b17414eafda649",
    "8e1a32e8cc42c2f1fdd41a292a254bde7008b680bcda1a7a8851754364182ca6",
    "add78218e9b001c40130391f11aaa3ea018889ade8a0a181037d3a08e53208d0",
    "38bcae6a7a239b7a8d7b4f51fbdd8e54c79ef931a2a17c658ec31e9a02fcff9b",
    "15bc1955c3cac018af1a94c5f48107f3df4ef5dfe9e85193f9a116e2ce7280d6",
  ],
});

export function checkWindowsStoreBuild(rootPath = defaultRoot) {
  const root = resolve(rootPath);
  return [
    ...checkWindowsStoreBuildWorkflowSecurity(
      readFileSync(resolve(root, BUILD_WORKFLOW), "utf8"),
    ),
    ...checkWindowsStoreBuildCiWiring(
      readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8"),
    ),
  ];
}

export function checkWindowsStoreBuildWorkflowSecurity(workflowText) {
  const parsed = parseWorkflow(workflowText);
  if (!parsed.ok) return [failure(parsed.error)];
  const workflow = parsed.value;
  const results = [];
  const jobs = isRecord(workflow?.jobs) ? workflow.jobs : {};
  const build = jobs.build;
  const attest = jobs.attest;
  const buildSteps = Array.isArray(build?.steps) ? build.steps : [];
  const attestSteps = Array.isArray(attest?.steps) ? attest.steps : [];
  const allSteps = [...buildSteps, ...attestSteps];
  const inputs = workflow?.on?.workflow_dispatch?.inputs;

  add(
    results,
    sameKeys(workflow?.on, ["workflow_dispatch"]) &&
      sameKeys(workflow?.on?.workflow_dispatch, ["inputs"]) &&
      sameKeys(inputs, [
        "reviewed_sha",
        "partner_identity_base64",
        "retention_days",
      ]) &&
      inputs?.reviewed_sha?.type === "string" &&
      inputs?.reviewed_sha?.required === true &&
      inputs?.partner_identity_base64?.type === "string" &&
      inputs?.partner_identity_base64?.required === true &&
      inputs?.retention_days?.type === "string" &&
      inputs?.retention_days?.required === true &&
      workflow?.concurrency?.["cancel-in-progress"] === false,
    "Source producer accepts only the reviewed manual dispatch inputs and never cancels a release build",
  );
  add(
    results,
    sameKeys(jobs, ["build", "attest"]) &&
      sameRecord(workflow?.permissions, { contents: "read" }) &&
      sameRecord(build?.permissions, {
        contents: "read",
        actions: "read",
      }) &&
      sameRecord(attest?.permissions, {
        contents: "read",
        "id-token": "write",
        attestations: "write",
      }) &&
      (attest?.needs === "build" || sameRecord(attest?.needs, ["build"])),
    "Only the isolated attestation job receives OIDC and attestation write permissions",
  );
  for (const [name, job] of Object.entries({ build, attest })) {
    add(
      results,
      job?.["runs-on"] === "windows-2025" &&
        job?.environment === "windows-release-stage-b" &&
        hasMainDispatchGuard(job?.if),
      `${name} requires standard Windows 2025, the Stage B human gate, and the exact protected main SHA`,
    );
  }
  add(
    results,
    allSteps.every(
      (step) =>
        !Object.hasOwn(step ?? {}, "uses") ||
        Object.values(PINNED_ACTIONS).includes(step.uses),
    ),
    "Every source producer action uses its reviewed full SHA pin",
  );
  const checkouts = buildSteps.filter(
    (step) => step?.uses === PINNED_ACTIONS.checkout,
  );
  add(
    results,
    checkouts.length === 1 &&
      checkouts[0].with?.ref === "${{ github.sha }}" &&
      checkouts[0].with?.["persist-credentials"] === false &&
      attestSteps.every(
        (step) =>
          ![
            PINNED_ACTIONS.checkout,
            PINNED_ACTIONS.node,
            PINNED_ACTIONS.rust,
          ].includes(step?.uses),
      ) &&
      !attestSteps.some((step) =>
        /\b(?:node|npm|npx|cargo|rustc|tauri|git|checkout)\b|scripts[\\/]/iu.test(
          step?.run ?? "",
        ),
      ),
    "Reviewed source checkout and repository code run only in the job without signing permissions",
  );
  const attestations = attestSteps.filter(
    (step) => step?.uses === PINNED_ACTIONS.attest,
  );
  const slsa = attestations.filter(
    (step) => !Object.hasOwn(step.with ?? {}, "predicate-type"),
  );
  const custom = attestations.filter(
    (step) => step.with?.["predicate-type"] === BUILD_PREDICATE_TYPE,
  );
  add(
    results,
    attestations.length === 2 &&
      slsa.length === 1 &&
      custom.length === 1 &&
      attestations.every(
        (step) =>
          step.with?.["push-to-registry"] === false &&
          step.with?.["create-storage-record"] === false &&
          typeof step.with?.["subject-path"] === "string",
      ) &&
      slsa[0]?.with?.["subject-path"] === custom[0]?.with?.["subject-path"] &&
      typeof custom[0]?.with?.["predicate-path"] === "string",
    "Final MSIX receives both default SLSA provenance and the reviewed custom predicate without registry writes",
  );
  const downloads = attestSteps.filter(
    (step) => step?.uses === PINNED_ACTIONS.download,
  );
  add(
    results,
    downloads.length > 0 &&
      downloads.every(
        (step) =>
          /^\$\{\{ needs\.build\.outputs\.[a-z_]+ \}\}$/u.test(
            step.with?.["artifact-ids"] ?? "",
          ) &&
          step.with?.["digest-mismatch"] === "error" &&
          !["name", "pattern", "run-id", "repository", "github-token"].some(
            (key) => Object.hasOwn(step.with ?? {}, key),
          ),
      ),
    "Attestation downloads only exact same-run build artifact IDs and fails on digest mismatch",
  );
  const rawUploads = allSteps.filter(
    (step) =>
      step?.uses === PINNED_ACTIONS.upload && step.with?.archive === false,
  );
  add(
    results,
    rawUploads.length > 0 &&
      rawUploads.every(
        (step) =>
          step.with?.["if-no-files-found"] === "error" &&
          step.with?.overwrite === false &&
          step.with?.["retention-days"] ===
            "${{ steps.build.outputs.retention_days }}" &&
          typeof step.with?.path === "string" &&
          !/[\n*?]/u.test(step.with.path),
      ),
    "Raw MSIX uploads contain one exact file, preserve raw bytes, and fail closed without overwrite",
  );
  const serialized = JSON.stringify(workflow);
  add(
    results,
    !/\bsecrets\b|Import-PfxCertificate|ATLASTERM_WINDOWS_CERTIFICATE|signtool\s+sign|gh\s+release|workflow_call|workflow_run|pull_request_target/iu.test(
      serialized,
    ) &&
      !collectPrivilegedExpressions(workflow).some(
        ({ path, expression }) =>
          !/^\$\.jobs\.build\.steps\[\d+\]\.env\.[A-Z_]+$/u.test(path) ||
          expression !== "${{ github.token }}",
      ),
    "The producer adds no signing secret, long-lived token, release publication, or privileged token outside the read-only build preflight",
  );
  add(
    results,
    hashWithout(workflow, "jobs") === REVIEWED_WORKFLOW_METADATA_SHA256,
    "Source producer root metadata is exactly reviewed",
  );
  for (const [name, job] of Object.entries({ build, attest })) {
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    add(
      results,
      hashWithout(job, "steps") === REVIEWED_JOB_METADATA_SHA256[name] &&
        steps.length === REVIEWED_STEP_SHA256[name].length &&
        steps.every(
          (step, index) =>
            hashCanonical(step) === REVIEWED_STEP_SHA256[name][index],
        ),
      `${name} metadata and every executable step exactly preserve the reviewed security boundary`,
    );
  }
  return results;
}

export function checkWindowsStoreBuildCiWiring(workflowText) {
  const parsed = parseWorkflow(workflowText);
  if (!parsed.ok) return [failure(parsed.error)];
  const workflow = parsed.value;
  const results = [];
  add(
    results,
    sameRecord(
      Object.fromEntries(
        Object.entries(workflow?.jobs ?? {}).map(([id, job]) => [
          id,
          job?.name,
        ]),
      ),
      EXPECTED_CI_JOB_NAMES,
    ),
    "CI keeps all fourteen required job identities used by the source producer approval check",
  );
  for (const name of ["lint", "store-runtime-windows"]) {
    const job = workflow?.jobs?.[name];
    const steps = Array.isArray(job?.steps) ? job.steps : [];
    add(
      results,
      !Object.hasOwn(job ?? {}, "if") &&
        !Object.hasOwn(job ?? {}, "continue-on-error") &&
        [BUILD_TESTS, BUILD_CHECK].every((command) => {
          const matching = steps.filter((step) => step?.run === command);
          return (
            matching.length === 1 &&
            matching.every(
              (step) =>
                !Object.hasOwn(step, "if") &&
                !Object.hasOwn(step, "continue-on-error"),
            )
          );
        }),
      `CI ${name} executes source producer tests and security checks without skipping or ignoring failures`,
    );
  }
  return results;
}

function hasMainDispatchGuard(value) {
  if (typeof value !== "string") return false;
  const normalized = value
    .trim()
    .replace(/^\$\{\{\s*/u, "")
    .replace(/\s*\}\}$/u, "")
    .replace(/\s+/gu, " ");
  return (
    normalized ===
    "github.event_name == 'workflow_dispatch' && github.repository == 'JoeWorkspace/JoeSSH' && github.ref == 'refs/heads/main' && github.ref_protected == true && inputs.reviewed_sha == github.sha"
  );
}

function parseWorkflow(source) {
  try {
    const document = parseDocument(source.replace(/^\uFEFF/u, ""), {
      uniqueKeys: true,
      merge: false,
    });
    if (document.errors.length !== 0)
      throw new Error(document.errors.map((error) => error.message).join("; "));
    const value = document.toJS({ maxAliasCount: 0 });
    if (!isRecord(value)) throw new Error("root must be a mapping");
    return { ok: true, value };
  } catch (error) {
    return {
      ok: false,
      error: `Workflow YAML must parse with unique keys and no aliases: ${error.message}`,
    };
  }
}

function collectPrivilegedExpressions(value) {
  const results = [];
  function visit(current, path) {
    if (typeof current === "string") {
      for (const match of current.matchAll(/\$\{\{[\s\S]*?\}\}/gu)) {
        if (/\bsecrets\b|\bgithub\s*(?:\.\s*token\b|\s*\[)/iu.test(match[0]))
          results.push({ expression: match[0], path });
      }
    } else if (Array.isArray(current)) {
      current.forEach((item, index) => visit(item, `${path}[${index}]`));
    } else if (isRecord(current)) {
      for (const [key, item] of Object.entries(current))
        visit(item, `${path}.${key}`);
    }
  }
  visit(value, "$");
  return results;
}

function isRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function sameKeys(value, keys) {
  return (
    isRecord(value) &&
    JSON.stringify(Object.keys(value).sort()) ===
      JSON.stringify([...keys].sort())
  );
}

function sameRecord(actual, expected) {
  return canonicalJson(actual) === canonicalJson(expected);
}

function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function hashCanonical(value) {
  return createHash("sha256")
    .update(canonicalJson(value) ?? "undefined", "utf8")
    .digest("hex");
}

function hashWithout(value, key) {
  return isRecord(value)
    ? hashCanonical(
        Object.fromEntries(
          Object.entries(value).filter(([name]) => name !== key),
        ),
      )
    : "";
}

function add(results, passed, label) {
  results.push({ passed: Boolean(passed), label });
}

function failure(label) {
  return { passed: false, label };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const results = checkWindowsStoreBuild();
    for (const result of results)
      console.log(`[${result.passed ? "PASS" : "FAIL"}] ${result.label}`);
    if (results.some((result) => !result.passed)) process.exitCode = 1;
  } catch (error) {
    console.error(`check-windows-store-build.mjs: ${error.message}`);
    process.exitCode = 1;
  }
}
