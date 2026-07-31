import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { parse, stringify } from "yaml";
import { checkDesktopReleaseWorkflowSecurity } from "./check-desktop-release-workflow-security.mjs";

const workflow = readFileSync(
  resolve(
    import.meta.dirname,
    "..",
    ".github/workflows/desktop-release-artifacts.yml",
  ),
  "utf8",
).replace(/^\uFEFF/, "");

test("repository Desktop release workflow passes the structured unsigned contract", () => {
  assert.deepEqual(failuresFor(workflow), []);
});

test("rejects a deleted, weakened, or comment-spoofed formal guard", () => {
  const deleted = mutate((candidate) => {
    candidate.jobs.policy.steps = [];
  });
  const weakened = mutate((candidate) => {
    candidate.jobs.policy.steps[0].run =
      candidate.jobs.policy.steps[0].run.replace(
        '"${FORMAL_EVIDENCE}" == "true"',
        '"${FORMAL_EVIDENCE}" == "false"',
      );
  });
  const commentSpoof = mutate((candidate) => {
    candidate.jobs.policy.steps[0].run =
      candidate.jobs.policy.steps[0].run.replace(
        'echo "FORMAL_SIGNING_DISABLED:',
        '# echo "FORMAL_SIGNING_DISABLED:',
      );
  });
  const ignoredFailure = mutate((candidate) => {
    candidate.jobs.policy.steps[0]["continue-on-error"] = true;
  });
  const skippedGuard = mutate((candidate) => {
    candidate.jobs.policy.steps[0].if = "false";
  });
  const bypassedDependencyFailure = mutate((candidate) => {
    candidate.jobs["build-unsigned"].if = "always()";
  });

  for (const candidate of [
    deleted,
    weakened,
    commentSpoof,
    ignoredFailure,
    skippedGuard,
    bypassedDependencyFailure,
  ]) {
    assertFailure(candidate, "FORMAL_SIGNING_DISABLED");
  }
});

test("rejects environment, id-token, and GitHub secret injection", () => {
  const environment = mutate((candidate) => {
    candidate.jobs["build-unsigned"].environment = "desktop-release-signing";
  });
  const idToken = mutate((candidate) => {
    candidate.jobs["build-unsigned"].permissions["id-token"] = "write";
  });
  const secret = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[8].env.RELEASE_SECRET =
      "${{ secrets.ATLASTERM_WINDOWS_CERTIFICATE }}";
  });

  for (const candidate of [environment, idToken, secret]) {
    assertFailure(candidate, "No job exposes environments");
  }
});

test("rejects repository build execution in a privileged policy job", () => {
  const candidate = mutate((value) => {
    value.jobs.policy.environment = "desktop-release-signing";
    value.jobs.policy.steps.push({
      name: "Privileged repository build",
      run: "npm run release:desktop:build",
    });
  });
  assertFailure(candidate, "Repository build code runs only");
});

test("rejects mutable actions and persisted checkout credentials", () => {
  const mutableAction = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[1].uses = "actions/checkout@main";
  });
  const persistedCredentials = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[1].with["persist-credentials"] =
      true;
  });

  assertFailure(mutableAction, "full-SHA pinned");
  assertFailure(persistedCredentials, "checkout credentials are disabled");
});

test("rejects policy runner, matrix runner, and architecture drift", () => {
  const policyRunner = mutate((candidate) => {
    candidate.jobs.policy["runs-on"] = "ubuntu-latest";
  });
  const matrixRunner = mutate((candidate) => {
    candidate.jobs["build-unsigned"].strategy.matrix.include[0].os =
      "windows-latest";
  });
  const architecture = mutate((candidate) => {
    candidate.jobs["build-unsigned"].strategy.matrix.include[1].runner_arch =
      "x86_64";
  });
  const guard = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[0].run = candidate.jobs[
      "build-unsigned"
    ].steps[0].run.replace(
      '"${actual_arch}" != "${EXPECTED_RUNNER_ARCH}"',
      '"${actual_arch}" == "${EXPECTED_RUNNER_ARCH}"',
    );
  });

  assertFailure(policyRunner, "FORMAL_SIGNING_DISABLED");
  assertFailure(matrixRunner, "fixed runners");
  assertFailure(architecture, "exact architectures");
  assertFailure(guard, "runner architecture before checkout");
});

test("rejects Node, npm, Rust, and dependency-installation drift", () => {
  const node = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[2].with["node-version"] = "latest";
  });
  const npm = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[3].run = candidate.jobs[
      "build-unsigned"
    ].steps[3].run.replace("npm@10.9.7", "npm@latest");
  });
  const rust = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[4].with.toolchain = "stable";
  });
  const install = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[6].run = "npm install";
  });

  for (const candidate of [node, npm, rust, install]) {
    assertFailure(candidate, "exact-pinned");
  }
});

test("rejects missing or late legal-resource generation", () => {
  const missing = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[7].run = "npm run release:sbom";
  });
  const late = mutate((candidate) => {
    const steps = candidate.jobs["build-unsigned"].steps;
    const [legal] = steps.splice(7, 1);
    steps.splice(8, 0, legal);
  });

  for (const candidate of [missing, late]) {
    assertFailure(candidate, "Legal resources");
  }
});

test("rejects formal aggregation and unsigned artifacts masquerading as formal", () => {
  const aggregate = mutate((candidate) => {
    candidate.jobs["package-formal-evidence"] = {
      name: "Package Formal Desktop Evidence",
      "runs-on": "ubuntu-24.04",
      steps: [],
    };
  });
  const formalName = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[9].with.name =
      "desktop-release-evidence";
  });
  const formalPath = mutate((candidate) => {
    candidate.jobs["build-unsigned"].steps[9].with.path +=
      "\nwindows-signature-verification.txt\n";
  });

  assertFailure(aggregate, "structurally limited");
  assertFailure(formalName, "cannot masquerade");
  assertFailure(formalPath, "cannot masquerade");
});

function mutate(mutator) {
  const candidate = parse(workflow);
  mutator(candidate);
  return stringify(candidate);
}

function failuresFor(candidate) {
  return checkDesktopReleaseWorkflowSecurity(candidate)
    .filter((result) => !result.passed)
    .map((result) => result.label);
}

function assertFailure(candidate, labelFragment) {
  const failures = failuresFor(candidate);
  assert.ok(
    failures.some((label) =>
      label.toLowerCase().includes(labelFragment.toLowerCase()),
    ),
    'Expected a failure containing "' +
      labelFragment +
      '", received:\n' +
      failures.join("\n"),
  );
}
