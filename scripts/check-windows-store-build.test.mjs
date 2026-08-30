import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import {
  checkWindowsStoreBuild,
  checkWindowsStoreBuildCiWiring,
  checkWindowsStoreBuildWorkflowSecurity,
} from "./check-windows-store-build.mjs";
import { checkWindowsStoreWorkflowSecurity } from "./check-windows-store-release.mjs";

const root = resolve(import.meta.dirname, "..");
const workflow = readFileSync(
  resolve(root, ".github/workflows/windows-store-build.yml"),
  "utf8",
);
const ci = readFileSync(resolve(root, ".github/workflows/ci.yml"), "utf8");

test("source producer and mandatory CI wiring pass the reviewed contract", () => {
  assert.deepEqual(
    checkWindowsStoreBuild().filter((result) => !result.passed),
    [],
  );
});

test("duplicate keys, aliases, invalid YAML, and non-mapping roots fail closed", () => {
  for (const source of [
    "on: {}\non: {}\n",
    "name: &name source\non: *name\n",
    "jobs: [\n",
    "- workflow_dispatch\n",
  ]) {
    assertFailure(source, "Workflow YAML");
  }
});

test("dispatch cannot become automatic, reusable, or accept artifacts and signing inputs", () => {
  for (const change of [
    (value) => {
      value.on.push = { branches: ["main"] };
    },
    (value) => {
      value.on.workflow_call = {};
    },
    (value) => {
      value.on.workflow_dispatch.inputs.artifact_url = {
        type: "string",
        required: true,
      };
    },
    (value) => {
      value.on.workflow_dispatch.inputs.pfx_base64 = {
        type: "string",
        required: true,
      };
    },
    (value) => {
      value.on.workflow_dispatch.inputs.reviewed_sha.required = false;
    },
    (value) => {
      value.concurrency["cancel-in-progress"] = true;
    },
  ])
    assertFailure(mutate(change), "only the reviewed manual dispatch");
});

test("both jobs require the exact protected-main dispatch guard and human environment", () => {
  for (const name of ["build", "attest"]) {
    for (const change of [
      (job) => {
        delete job.if;
      },
      (job) => {
        job.if = "always()";
      },
      (job) => {
        job.if = job.if.replace("inputs.reviewed_sha == github.sha", "true");
      },
      (job) => {
        job.if = job.if.replace("github.ref_protected == true", "true");
      },
      (job) => {
        job.environment = "windows-invite-stage-a";
      },
      (job) => {
        job.environment = { name: "windows-release-stage-b" };
      },
      (job) => {
        job["runs-on"] = "windows-latest";
      },
      (job) => {
        job["runs-on"] = ["self-hosted", "Windows"];
      },
    ])
      assertFailure(
        mutate((value) => change(value.jobs[name])),
        `${name} requires standard Windows`,
      );
  }
});

test("OIDC and artifact attestation writes cannot escape the isolated attestation job", () => {
  for (const change of [
    (value) => {
      value.permissions["id-token"] = "write";
    },
    (value) => {
      value.jobs.build.permissions["id-token"] = "write";
    },
    (value) => {
      value.jobs.build.permissions.attestations = "write";
    },
    (value) => {
      value.jobs.attest.permissions.contents = "write";
    },
    (value) => {
      value.jobs.attest.permissions.packages = "write";
    },
    (value) => {
      value.jobs.attest.permissions["artifact-metadata"] = "write";
    },
    (value) => {
      delete value.jobs.attest.needs;
    },
    (value) => {
      value.jobs.publish = {
        "runs-on": "windows-2025",
        permissions: { contents: "write" },
        steps: [],
      };
    },
  ])
    assertFailure(mutate(change), "Only the isolated attestation job");
});

test("actions must retain reviewed full-SHA pins and source checkout cannot persist credentials", () => {
  assertFailure(
    mutate((value) => {
      action(value.jobs.build, "actions/checkout").uses =
        "actions/checkout@main";
    }),
    "reviewed full SHA pin",
  );
  for (const change of [
    (step) => {
      step.with.ref = "main";
    },
    (step) => {
      step.with["persist-credentials"] = true;
    },
  ])
    assertFailure(
      mutate((value) => change(action(value.jobs.build, "actions/checkout"))),
      "source checkout",
    );
});

test("attestation job cannot check out source, compile, install packages, or execute repository scripts", () => {
  for (const injected of [
    {
      uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      with: { ref: "${{ github.sha }}", "persist-credentials": false },
    },
    { run: "npm ci --ignore-scripts" },
    { run: "cargo build --release --locked" },
    { run: "node scripts/build-windows-store-msix.mjs" },
    { run: "./scripts/prepare.ps1" },
  ])
    assertFailure(
      mutate((value) => value.jobs.attest.steps.unshift(injected)),
      "source checkout",
    );
});

test("default SLSA and custom attestation must bind the same final MSIX without extra write scopes", () => {
  for (const change of [
    (steps) => {
      steps.splice(
        steps.findIndex((step) => step.uses?.startsWith("actions/attest@")),
        1,
      );
    },
    (steps) => {
      steps.find((step) => step.with?.["predicate-type"]).with[
        "predicate-type"
      ] = "https://example.invalid/predicate";
    },
    (steps) => {
      steps.find((step) => step.with?.["predicate-type"]).with["subject-path"] =
        "unverified.msix";
    },
    (steps) => {
      steps.find((step) => step.uses?.startsWith("actions/attest@")).with[
        "push-to-registry"
      ] = true;
    },
    (steps) => {
      steps.find((step) => step.uses?.startsWith("actions/attest@")).with[
        "create-storage-record"
      ] = true;
    },
  ])
    assertFailure(
      mutate((value) => change(value.jobs.attest.steps)),
      "both default SLSA provenance",
    );
});

test("download cannot switch runs, repositories, names, or accept digest mismatches", () => {
  for (const change of [
    (step) => {
      step.with["artifact-ids"] = "123";
    },
    (step) => {
      step.with.name = "candidate";
    },
    (step) => {
      step.with.pattern = "*.msix";
    },
    (step) => {
      step.with["run-id"] = "${{ github.run_id }}";
    },
    (step) => {
      step.with.repository = "JoeWorkspace/JoeSSH";
    },
    (step) => {
      step.with["github-token"] = "${{ github.token }}";
    },
    (step) => {
      step.with["digest-mismatch"] = "warn";
    },
  ])
    assertFailure(
      mutate((value) =>
        change(action(value.jobs.attest, "actions/download-artifact")),
      ),
      "only exact same-run build artifact IDs",
    );
});

test("raw MSIX upload rejects globs, multiple paths, missing files, or overwrites", () => {
  for (const change of [
    (step) => {
      step.with.path = "**/*.msix";
    },
    (step) => {
      step.with.path = "first.msix\nsecond.msix";
    },
    (step) => {
      step.with["if-no-files-found"] = "warn";
    },
    (step) => {
      step.with.overwrite = true;
    },
    (step) => {
      step.with["retention-days"] = 90;
    },
  ])
    assertFailure(
      mutate((value) =>
        change(
          value.jobs.build.steps.find((step) => step.with?.archive === false),
        ),
      ),
      "Raw MSIX uploads",
    );
});

test("transport upload wraps only the exact raw MSIX with a run-bound name", () => {
  for (const change of [
    (step) => {
      step.with.name = "store-source-msix-transport";
    },
    (step) => {
      step.with.path = "other.msix";
    },
    (step) => {
      step.with.archive = false;
    },
    (step) => {
      step.with["compression-level"] = 6;
    },
    (step) => {
      step.with["if-no-files-found"] = "warn";
    },
    (step) => {
      step.with.overwrite = true;
    },
    (step) => {
      step.with["retention-days"] = 90;
    },
  ])
    assertFailure(
      mutate((value) =>
        change(value.jobs.build.steps.find((step) => step.id === "transport")),
      ),
      "Transport artifact wraps the exact raw MSIX",
    );
});

test("new secrets, token broadening, Authenticode signing, and publication commands are rejected", () => {
  for (const change of [
    (value) => {
      value.env = { GH_TOKEN: "${{ github.token }}" };
    },
    (value) => {
      value.jobs.attest.env = { GH_TOKEN: "${{ github.token }}" };
    },
    (value) => {
      value.jobs.build.env = { PFX: "${{ secrets.CERTIFICATE }}" };
    },
    (value) => {
      value.jobs.build.steps.push({
        run: "Import-PfxCertificate -FilePath signing.pfx",
      });
    },
    (value) => {
      value.jobs.build.steps.push({ run: "signtool sign candidate.msix" });
    },
    (value) => {
      value.jobs.attest.steps.push({
        run: "gh release upload beta candidate.msix",
      });
    },
  ])
    assertFailure(mutate(change), "adds no signing secret");
});

test("executable steps cannot be skipped, ignored, reordered, appended, or comment-spoofed", () => {
  for (const name of ["build", "attest"]) {
    for (const change of [
      (job) => {
        job["continue-on-error"] = true;
      },
      (job) => {
        job.steps[0]["continue-on-error"] = true;
      },
      (job) => {
        job.steps[0].if = "false";
      },
      (job) => {
        job.steps.reverse();
      },
      (job) => {
        job.steps.push({ shell: "pwsh", run: "Write-Output bypass" });
      },
      (job) => {
        const step = job.steps.find((item) => item.run);
        step.run = step.run
          .split("\n")
          .map((line) => `# ${line}`)
          .join("\n");
      },
    ])
      assertFailure(
        mutate((value) => change(value.jobs[name])),
        `${name} metadata and every executable step`,
      );
  }
});

test("hash protection catches otherwise inconspicuous step environment and output injections", () => {
  for (const change of [
    (value) => {
      value.jobs.build.steps[0].env = { BASH_ENV: "unreviewed.sh" };
    },
    (value) => {
      value.jobs.attest.steps[0].env = {
        NODE_OPTIONS: "--require injected.cjs",
      };
    },
    (value) => {
      value.jobs.build.outputs.injected = "${{ secrets.TOKEN }}";
    },
    (value) => {
      value.defaults = { run: { shell: "cmd" } };
    },
  ])
    assert.ok(
      failuresFor(mutate(change)).some((label) =>
        /exactly reviewed|every executable step/.test(label),
      ),
    );
});

test("CI job identities and both mandatory test/check steps cannot be weakened", () => {
  const changedJob = parse(ci);
  changedJob.jobs["store-runtime-windows"].name = "Store Runtime";
  assertCiFailure(stringify(changedJob), "all fourteen");
  for (const name of ["lint", "store-runtime-windows"]) {
    for (const change of [
      (job) => {
        job.if = "false";
      },
      (job) => {
        job["continue-on-error"] = true;
      },
      (job) => {
        job.steps = job.steps.filter(
          (step) => step.run !== "node scripts/check-windows-store-build.mjs",
        );
      },
      (job) => {
        job.steps.find(
          (step) => step.run === "node scripts/check-windows-store-build.mjs",
        )["continue-on-error"] = true;
      },
      (job) => {
        job.steps.find((step) =>
          step.run?.startsWith(
            "node --test scripts/check-windows-store-build.test.mjs",
          ),
        ).if = "false";
      },
    ]) {
      const value = parse(ci);
      change(value.jobs[name]);
      assertCiFailure(stringify(value), `CI ${name} executes`);
    }
  }
});

test("existing hosted verifier remains independently read-only and cannot inherit producer attestation permissions", () => {
  const legacySource = readFileSync(
    resolve(root, ".github/workflows/windows-store-candidate.yml"),
    "utf8",
  );
  assert.deepEqual(
    checkWindowsStoreWorkflowSecurity(legacySource).filter(
      (result) => !result.passed,
    ),
    [],
  );
  for (const permission of ["id-token", "attestations"]) {
    const value = parse(legacySource);
    value.jobs.verify.permissions[permission] = "write";
    assert.ok(
      checkWindowsStoreWorkflowSecurity(stringify(value)).some(
        (result) => !result.passed,
      ),
    );
  }
});

function action(job, prefix) {
  const value = job.steps.find((step) => step.uses?.startsWith(`${prefix}@`));
  assert.ok(value, `workflow must contain ${prefix}`);
  return value;
}

function mutate(change) {
  const value = parse(workflow);
  change(value);
  return stringify(value);
}

function failuresFor(source) {
  return checkWindowsStoreBuildWorkflowSecurity(source)
    .filter((result) => !result.passed)
    .map((result) => result.label);
}

function assertFailure(source, label) {
  const failures = failuresFor(source);
  assert.ok(
    failures.some((item) => item.includes(label)),
    `Expected failure containing ${JSON.stringify(label)}; received ${JSON.stringify(failures)}`,
  );
}

function assertCiFailure(source, label) {
  const failures = checkWindowsStoreBuildCiWiring(source).filter(
    (result) => !result.passed,
  );
  assert.ok(
    failures.some((item) => item.label.includes(label)),
    JSON.stringify(failures),
  );
}
