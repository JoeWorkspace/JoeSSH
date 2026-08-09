import assert from "node:assert/strict";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const checkerPath = fileURLToPath(
  new URL("./check-accessibility-readiness.mjs", import.meta.url),
);
const contractPaths = [
  "ACCESSIBILITY.md",
  ".github/ISSUE_TEMPLATE/accessibility.yml",
  ".github/workflows/ci.yml",
  "README.md",
  "apps/web/public/humans.txt",
  "apps/web/src/styles.css",
  "apps/desktop/src/styles.css",
  "docs/qa-checklist.md",
  "docs/release-checklist.md",
  "docs/accessibility-technical-review-2026-08-09.md",
  "package.json",
  "tests/e2e/specs/accessibility.spec.ts",
  "tests/e2e/specs/web-admin.spec.ts",
];

test("accepts the repository accessibility evidence", () => {
  const result = runChecker(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /Accessibility readiness contracts passed/);
});

test("rejects a statement that hides known limitations", (t) => {
  const fixtureRoot = createFixture(t);

  const statementPath = join(fixtureRoot, "ACCESSIBILITY.md");
  writeFileSync(
    statementPath,
    readFileSync(statementPath, "utf8").replace(
      "## Known limitations",
      "## Product notes",
    ),
    "utf8",
  );

  const result = runChecker(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    /FAIL ACCESSIBILITY\.md includes '## Known limitations'/,
  );
});

test("rejects a formal or partial conformance claim", (t) => {
  const fixtureRoot = createFixture(t);
  const assessmentPath = join(fixtureRoot, "ACCESSIBILITY.md");
  writeFileSync(
    assessmentPath,
    `${readFileSync(assessmentPath, "utf8")}\nJoeSSH is partially conformant with WCAG 2.2 Level AA.\n`,
    "utf8",
  );

  const result = runChecker(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    /FAIL ACCESSIBILITY\.md avoids 'partially conformant'/,
  );
});

test("rejects an unqualified WCAG AA claim in humans.txt", (t) => {
  const fixtureRoot = createFixture(t);
  const humansPath = join(fixtureRoot, "apps/web/public/humans.txt");
  writeFileSync(
    humansPath,
    `${readFileSync(humansPath, "utf8")}\nStandards: HTML5, CSS3, ES2020, WCAG 2.2 AA\n`,
    "utf8",
  );

  const result = runChecker(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    /FAIL apps\/web\/public\/humans\.txt avoids 'Standards: HTML5, CSS3, ES2020, WCAG 2.2 AA'/,
  );
});

test("rejects severity filtering that can omit WCAG-tagged violations", (t) => {
  const fixtureRoot = createFixture(t);
  const desktopAuditPath = join(
    fixtureRoot,
    "tests/e2e/specs/accessibility.spec.ts",
  );
  const webAuditPath = join(fixtureRoot, "tests/e2e/specs/web-admin.spec.ts");
  writeFileSync(
    desktopAuditPath,
    readFileSync(desktopAuditPath, "utf8").replace(
      "expect(results.violations).toEqual([]);",
      "expect(results.violations.filter((violation) => violation.impact === 'serious')).toEqual([]);",
    ),
    "utf8",
  );
  writeFileSync(
    webAuditPath,
    readFileSync(webAuditPath, "utf8").replace(
      "const violations = results.violations;",
      "const violations = results.violations.filter((violation) => violation.impact === 'critical');",
    ),
    "utf8",
  );

  const result = runChecker(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    /FAIL tests\/e2e\/specs\/accessibility\.spec\.ts avoids 'results\.violations\.filter\('/,
  );
  assert.match(
    result.stdout,
    /FAIL tests\/e2e\/specs\/web-admin\.spec\.ts avoids 'results\.violations\.filter\('/,
  );
});

test("rejects removing the minimum release viewport audit", (t) => {
  const fixtureRoot = createFixture(t);
  const desktopAuditPath = join(
    fixtureRoot,
    "tests/e2e/specs/accessibility.spec.ts",
  );
  writeFileSync(
    desktopAuditPath,
    readFileSync(desktopAuditPath, "utf8").replace(
      "height: 480, width: 900",
      "height: 720, width: 1280",
    ),
    "utf8",
  );

  const result = runChecker(fixtureRoot);
  assert.notEqual(result.status, 0);
  assert.match(
    result.stdout,
    /FAIL tests\/e2e\/specs\/accessibility\.spec\.ts includes 'height: 480, width: 900'/,
  );
});

function createFixture(t) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "joessh-a11y-"));
  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));

  for (const relativePath of contractPaths) {
    const target = join(fixtureRoot, relativePath);
    mkdirSync(dirname(target), { recursive: true });
    cpSync(join(root, relativePath), target);
  }

  return fixtureRoot;
}

function runChecker(checkRoot) {
  return spawnSync(process.execPath, [checkerPath, "--root", checkRoot], {
    encoding: "utf8",
  });
}
