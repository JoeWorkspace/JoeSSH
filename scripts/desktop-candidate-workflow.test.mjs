import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../.github/workflows/desktop-candidates.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");

test("CI runs the release readiness regression suite as a required lint step", () => {
  const ci = readFileSync(
    fileURLToPath(new URL("../.github/workflows/ci.yml", import.meta.url)),
    "utf8",
  );
  const lintJob = ci.split("  lint:")[1]?.split("  typecheck:")[0];
  assert.ok(lintJob, "lint job must exist");
  assert.match(lintJob, /^ {6}- run: npm run qa:release-readiness\s*$/m);
});

test("every candidate builds the exact commit checked by the source gate", () => {
  const sourceGate = workflow.split("  source-gate:")[1]?.split("  build-candidate:")[0];
  const buildCandidate = workflow.split("  build-candidate:")[1];
  assert.ok(sourceGate && buildCandidate, "both source and build jobs must exist");
  assert.match(sourceGate, /source_commit: \$\{\{ steps\.source\.outputs\.commit \}\}/);
  assert.match(sourceGate, /git rev-parse HEAD/);
  assert.match(buildCandidate, /needs: source-gate/);
  assert.match(buildCandidate, /ref: \$\{\{ needs\.source-gate\.outputs\.source_commit \}\}/);
  assert.doesNotMatch(buildCandidate, /inputs\.source_ref|github\.ref/);
  assert.match(buildCandidate, /EXPECTED_SOURCE_COMMIT: \$\{\{ needs\.source-gate\.outputs\.source_commit \}\}/);
  assert.match(buildCandidate, /test "\$commit" = "\$EXPECTED_SOURCE_COMMIT"/);
  assert.ok(buildCandidate.indexOf('test "$commit"') < buildCandidate.indexOf("npm run release:desktop:build"));
});

test("desktop candidate workflow is manual, non-publishing, and multi-platform", () => {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*(push|pull_request|release):/m);
  assert.match(workflow, /contents:\s*read/);
  assert.doesNotMatch(workflow, /contents:\s*write/);
  assert.doesNotMatch(
    workflow,
    /gh\s+release|release\s+create|create-github-release/i,
  );
  for (const platform of ["windows", "macos", "linux"]) {
    assert.match(workflow, new RegExp(`platform: ${platform}`));
  }
  assert.match(workflow, /npm run release:desktop:build/);
  assert.match(workflow, /git rev-parse HEAD/);
  assert.match(
    workflow,
    /stage-desktop-candidate\.mjs --platform[^\n]+--source-commit \$\{\{ steps\.source\.outputs\.commit \}\}/,
  );
  assert.match(
    workflow,
    /release:desktop:verify-candidate -- --platform[^\n]+--source-commit \$\{\{ steps\.source\.outputs\.commit \}\}/,
  );
  assert.ok(
    workflow.indexOf("release:desktop:verify-candidate") <
      workflow.indexOf("actions/upload-artifact"),
    "candidate verification must run before upload",
  );
  assert.match(workflow, /unsigned-candidate/);
  assert.match(workflow, /reports\/candidates\/desktop/);
  assert.doesNotMatch(workflow, /reports\/release\/desktop/);
});
