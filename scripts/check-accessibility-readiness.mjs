import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(
  readCliValue("--root") ?? resolve(import.meta.dirname, ".."),
);
const checks = [];

const contracts = [
  {
    path: "ACCESSIBILITY.md",
    required: [
      "Last reviewed: 2026-08-08",
      "WCAG 2.2 Level AA",
      "EN 301 549 V3.2.1",
      "Directive (EU) 2019/882",
      "## Assessment status",
      "Assessment is in progress",
      "does not currently make a formal",
      "conformance claim",
      "not a certification",
      "## Known limitations",
      "## Feedback and assistance",
      "issues/new?template=accessibility.yml",
      "NVDA",
      "VoiceOver",
      "TalkBack",
    ],
    forbidden: [
      "## Conformance status",
      "partially conformant",
      "fully conformant",
    ],
  },
  {
    path: ".github/ISSUE_TEMPLATE/accessibility.yml",
    required: [
      "name: Accessibility barrier",
      "id: barrier",
      "id: steps",
      "id: expected",
      "id: assistive_technology",
      "id: safety",
      "private keys",
    ],
  },
  {
    path: "README.md",
    required: [
      "[ACCESSIBILITY.md](ACCESSIBILITY.md)",
      "WCAG 2.2",
      "assessment targets",
    ],
  },
  {
    path: "apps/web/public/humans.txt",
    required: ["Accessibility target: WCAG 2.2 AA (assessment in progress)"],
    forbidden: ["Standards: HTML5, CSS3, ES2020, WCAG 2.2 AA"],
  },
  {
    path: "docs/qa-checklist.md",
    required: [
      "assessment-in-progress notice",
      "no-formal-conformance-claim boundary",
    ],
    forbidden: ["partial-conformance statement"],
  },
  {
    path: "docs/release-checklist.md",
    required: [
      "assessment-in-progress",
      "no-formal-conformance-claim",
      "known-limitations",
    ],
    forbidden: ["partial-conformance"],
  },
  {
    path: "tests/e2e/specs/accessibility.spec.ts",
    required: [
      "wcag22aa",
      "target-size",
      "v.id === 'target-size'",
      "focus remains unobscured",
    ],
  },
  {
    path: "tests/e2e/specs/web-admin.spec.ts",
    required: ["wcag22aa", "target-size", "violation.id === 'target-size'"],
  },
  {
    path: "apps/web/src/styles.css",
    required: ["scroll-padding-block", "scroll-margin-block"],
  },
  {
    path: "apps/desktop/src/styles.css",
    required: ["scroll-padding-block", "scroll-margin-block"],
  },
  {
    path: "package.json",
    required: [
      '"test:accessibility-readiness"',
      '"qa:accessibility-readiness"',
    ],
  },
  {
    path: ".github/workflows/ci.yml",
    required: ["npm run qa:accessibility-readiness"],
  },
];

for (const contract of contracts) {
  const fullPath = resolve(root, contract.path);
  if (!existsSync(fullPath)) {
    checks.push({ ok: false, label: `${contract.path} exists` });
    continue;
  }

  const source = readFileSync(fullPath, "utf8");
  checks.push({ ok: true, label: `${contract.path} exists` });
  for (const requiredText of contract.required) {
    checks.push({
      ok: source.includes(requiredText),
      label: `${contract.path} includes '${requiredText}'`,
    });
  }
  for (const forbiddenText of contract.forbidden ?? []) {
    checks.push({
      ok: !source.toLowerCase().includes(forbiddenText.toLowerCase()),
      label: `${contract.path} avoids '${forbiddenText}'`,
    });
  }
}

const failures = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "PASS" : "FAIL"} ${check.label}`);
}

if (failures.length > 0) {
  process.exit(1);
}

console.log("Accessibility readiness contracts passed.");

function readCliValue(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return undefined;
  }

  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
