import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflowPath = fileURLToPath(
  new URL("../.github/workflows/desktop-candidates.yml", import.meta.url),
);
const workflow = readFileSync(workflowPath, "utf8");
const buildScript = readFileSync(
  fileURLToPath(new URL("./build-desktop-release.mjs", import.meta.url)),
  "utf8",
);

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

test("Windows candidates build both MSI and NSIS installers", () => {
  assert.match(buildScript, /return \["msi", "nsis"\]/);
  assert.match(buildScript, /maps the prerelease to a numeric WiX version/);
  assert.doesNotMatch(buildScript, /MSI rejects semver prerelease identifiers/);
});
