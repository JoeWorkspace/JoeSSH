import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { checkHandoffHygiene } from './check-handoff-hygiene.mjs';

const FIXTURE_ARCHIVED_SESSION_ID = '00000000-0000-4000-8000-000000000001';

const GOOD_HANDOFF = `# AtlasTerm/JoeSSH Codex Session Handoff

## 0. Latest continuation state (fixture controller)

Current controller baseline:

- Handoff hygiene is executable and enforced: \`node --test scripts/check-handoff-hygiene.test.mjs\` (114/114), \`npm run qa:handoff-hygiene\` (114/114 plus live scan).
- Controller audit: historical task-card references are limited to T04/T05/T12/T15; there is no active duplicate card queue.
- Web Admin snapshot list identity validation rejects blank, duplicate trim-equivalent, and leading or trailing whitespace \`id\` values; \`npm run test:web -- adminData\` (30/30) is green.
- Web Admin durable QA evidence is current: \`npm run test:web:fresh -w @atlasterm/e2e\` (35/35) and \`npm run qa:web\` (Web typecheck, 160/160 Web tests, production build + SRI) are green.
- CORS origin \`allowlist\` wording is legitimate policy language.
- Terminal-safety \`wget -O /\` is documented as a protected-root blocklist.
- Workspace caveat remains: \`.git/\` is partial on this host and \`git status\` fails. Treat files on disk plus verification output as truth here.
- Full root \`npm run qa:e2e\` now passes 73/73 with the static mobile web server path, so the active handoff must not carry the old Windows webServer timeout caveat.

Safe next dispatch queue (choose non-overlapping write scopes):

- Controller cleanup/docs: \`HANDOFF.md\`, \`docs/qa-checklist.md\`, \`README.md\`, \`CHANGELOG.md\`.
- Desktop UX/a11y: \`apps/desktop/src/*\`, \`packages/i18n/src/*\`, \`tests/e2e/specs/desktop-*\`.
- Web admin: \`apps/web/src/*\`, \`tests/e2e/specs/web-*\`, \`docs/sync-api.md\`.
- Mobile companion: \`apps/mobile/*\`, mobile service/model tests.
- Sync service/core engine: \`services/sync/*\`, \`crates/*\`.
- QA infra: \`tests/e2e/playwright*.config.ts\`, \`tests/e2e/scripts/*\`, \`scripts/*\`, \`.github/workflows/*\`.

Active lane ledger (current controller occupancy):

- Controller cleanup/docs: available - no active owner in this thread.
- Desktop UX/a11y: available - no active owner in this thread.
- Web admin: active - current controller owns Web admin QA, a11y, and documentation.
- Mobile companion: available - no active owner in this thread.
- Sync service/core engine: available - no active owner in this thread.
- QA infra: available - no active owner in this thread.

Do not resurrect archived session ids from historical notes below.
Start from the current workspace state and this top section.

---

## Prior continuation state

Historical context only.
**Archived Codex session reference (historical only):** \`${FIXTURE_ARCHIVED_SESSION_ID}\`
**Archived rollout file (historical only):** \`~/.codex/sessions/2026/05/24/rollout-2026-05-24T00-47-40-${FIXTURE_ARCHIVED_SESSION_ID}.jsonl\`
`;

const GOOD_PACKAGE_JSON = {
  name: 'atlasterm-fixture',
  private: true,
  scripts: {
    qa: 'npm run lint && npm run qa:sync-api-docs && npm run qa:handoff-hygiene',
    'test:handoff-hygiene': 'node --test scripts/check-handoff-hygiene.test.mjs',
    'qa:handoff-hygiene': 'npm run test:handoff-hygiene && node scripts/check-handoff-hygiene.mjs',
  },
};

const GOOD_QA_CHECKLIST = `# JoeSSH QA Checklist

- Controller handoff hygiene is checked with \`npm run qa:handoff-hygiene\`, including active task-card numbering, safe dispatch queue scope and code-span formatting, CORS-origin allowlist context, active lane ledger ownership, non-ledger active lane wording, available lane ownerless wording, duplicate active coordination blocks, archived session reference labeling, self-test count drift, active handoff mojibake and control-character rejection, production-source no-\`aria-label\` unit guard coverage, and the \`.git\` metadata caveat.
`;

const GOOD_CI_WORKFLOW = `name: CI

jobs:
  lint:
    steps:
      - run: npm run lint
      - run: npm run qa:handoff-hygiene
`;

const GOOD_HANDOFF_HYGIENE_EVIDENCE =
  '`node --test scripts/check-handoff-hygiene.test.mjs` (114/114), `npm run qa:handoff-hygiene` (114/114 plus live scan)';

function withHandoffHygieneEvidence(handoff, nodeCount, liveCount = nodeCount) {
  return handoff.replace(
    GOOD_HANDOFF_HYGIENE_EVIDENCE,
    `\`node --test scripts/check-handoff-hygiene.test.mjs\` (${nodeCount}/${nodeCount}), ` +
      `\`npm run qa:handoff-hygiene\` (${liveCount}/${liveCount} plus live scan)`,
  );
}

function writeText(root, relativePath, contents) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents, 'utf8');
}

function writeBytes(root, relativePath, contents) {
  const target = join(root, relativePath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function writeJson(root, relativePath, data) {
  writeText(root, relativePath, `${JSON.stringify(data, null, 2)}\n`);
}

function createFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'handoff-hygiene-'));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  if (overrides.handoffBytes) {
    writeBytes(root, 'HANDOFF.md', overrides.handoffBytes);
  } else {
    writeText(root, 'HANDOFF.md', overrides.handoff ?? GOOD_HANDOFF);
  }
  writeJson(root, 'package.json', overrides.packageJson ?? GOOD_PACKAGE_JSON);
  if (overrides.qaChecklistBytes) {
    writeBytes(root, 'docs/qa-checklist.md', overrides.qaChecklistBytes);
  } else {
    writeText(root, 'docs/qa-checklist.md', overrides.qaChecklist ?? GOOD_QA_CHECKLIST);
  }
  writeText(root, '.github/workflows/ci.yml', overrides.ciWorkflow ?? GOOD_CI_WORKFLOW);

  const hygieneTestSource = overrides.hygieneTestSource ?? readFileSync(new URL(import.meta.url), 'utf-8');
  if (hygieneTestSource) {
    writeText(root, 'scripts/check-handoff-hygiene.test.mjs', hygieneTestSource);
  }

  if (overrides.lastRun) {
    writeJson(root, 'tests/e2e/test-results/.last-run.json', overrides.lastRun);
  }

  return root;
}

function assertFailures(root, expectedFailures) {
  assert.deepEqual(checkHandoffHygiene(root), expectedFailures);
}

function assertSingleFailure(root, expectedFailure) {
  assertFailures(root, [expectedFailure]);
}

test('passes a clean handoff fixture', (t) => {
  const root = createFixture(t);

  assert.deepEqual(checkHandoffHygiene(root), []);
});

test('allows stale count evidence only in historical handoff sections', (t) => {
  const root = createFixture(t, {
    handoff: `${GOOD_HANDOFF.replace(
      'Safe next dispatch queue (choose non-overlapping write scopes):',
      '- Mixed verifier evidence stays readable: `node --test scripts/check-handoff-hygiene.test.mjs` (114/114), `npm run qa:handoff-hygiene` (114/114 plus live scan), and unrelated `npm run qa:web` (160/160).\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
    )}\n- Historical Web-only fresh E2E (27/27) and TerminalPane.browser.test.tsx (63/63) evidence.\n`,
  });

  assert.deepEqual(checkHandoffHygiene(root), []);
});

test('allows archived historical latest headings below the active separator', (t) => {
  const root = createFixture(t, {
    handoff: `${GOOD_HANDOFF}\n## 0. Latest continuation state (historical archived note)\n`,
  });

  assert.deepEqual(checkHandoffHygiene(root), []);
});

test('allows active handoff separator lines with trailing spaces', (t) => {
  const root = createFixture(t, {
    handoff: GOOD_HANDOFF.replace('\n---\n', '\n---   \n'),
  });

  assert.deepEqual(checkHandoffHygiene(root), []);
});

test('rejects missing prior continuation heading', (t) => {
  const root = createFixture(t, {
    handoff: GOOD_HANDOFF.replace('## Prior continuation state', '## Archived notes'),
  });

  assertSingleFailure(root, 'Expected exactly one prior continuation state heading, found 0');
});

test('rejects duplicate active separators before the prior continuation section', (t) => {
  const root = createFixture(t, {
    handoff: GOOD_HANDOFF.replace(
      'Do not resurrect archived session ids from historical notes below.\nStart from the current workspace state and this top section.\n\n---\n\n## Prior continuation state',
      'Do not resurrect archived session ids from historical notes below.\nStart from the current workspace state and this top section.\n\n---\n\n- Hidden active text must not sit between active separators.\n\n---\n\n## Prior continuation state',
    ),
  });

  assertFailures(root, [
    'Expected exactly one active handoff separator before prior continuation state, found 2',
    'Active handoff separator must be followed immediately by prior continuation state heading: - Hidden active text must not sit between active separators.\n\n---',
  ]);

  const missingHeadingRoot = createFixture(t, {
    handoff: GOOD_HANDOFF.replace('## Prior continuation state', '## Continuation archive'),
  });

  assertSingleFailure(missingHeadingRoot, 'Expected exactly one prior continuation state heading, found 0');
});

test('rejects content between active separator and prior continuation heading', (t) => {
  const root = createFixture(t, {
    handoff: GOOD_HANDOFF.replace(
      '\n---\n\n## Prior continuation state',
      '\n---\n\n## 0. Latest continuation state (hidden stale active note)\n\n**Codex session to resume:** stale\n\n## Prior continuation state',
    ),
  });

  assertFailures(root, [
    'Active handoff separator must be followed immediately by prior continuation state heading: ## 0. Latest continuation state (hidden stale active note)\n\n**Codex session to resume:** stale',
    'Forbidden stale active session resume directive: "**Codex session to resume:**"',
  ]);
});

test('rejects separated task-card ids with superscript digits', (t) => {
  const root = createFixture(t, {
    handoff: GOOD_HANDOFF.replace(
      'Safe next dispatch queue (choose non-overlapping write scopes):',
      '- Active queue: T-\u2070\u2077 must not bypass compact task-card parsing.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
    ),
  });

  assertSingleFailure(root, 'Active task-card id must use compact TNN form: T-\u2070\u2077');
});

test('rejects active task cards appended to the historical-audit statement', (t) => {
  const root = createFixture(t, {
    handoff: GOOD_HANDOFF.replace(
      'there is no active duplicate card queue.',
      'there is no active duplicate card queue; active follow-up T04 should not be masked by the audit exception.',
    ),
  });

  assertSingleFailure(root, 'Active task-card id must not be appended to historical audit line: T04');
});

test('counts refactored table-driven self-tests without nested name noise', (t) => {
  const root = createFixture(t, {
    handoff: withHandoffHygieneEvidence(GOOD_HANDOFF, 3),
    hygieneTestSource: `test('standalone one', () => {});

for (const caseItem of [
  {
    metadata: { name: 'nested noise must not count' },
    name: 'table case one',
  },
  {
    overrides: {},
    name: 'table case two',
  },
]) {
  test(caseItem.name, () => {});
}
`,
  });

  assert.deepEqual(checkHandoffHygiene(root), []);
});

test('counts external table-driven self-test cases', (t) => {
  const root = createFixture(t, {
    handoff: withHandoffHygieneEvidence(GOOD_HANDOFF, 3, 4),
    hygieneTestSource: `const cases = [
  { 'name': 'external case one' },
  { "name": 'external case two' },
];
const forEachCases = [
  { name: 'forEach case one' },
];

test('standalone one', () => {});

for (const { name } of cases) {
  test(name, () => {});
}

forEachCases.forEach((caseItem) => {
  test(caseItem.name, () => {});
});
`,
  });

  assertSingleFailure(root, 'Handoff hygiene self-test count for node --test scripts/check-handoff-hygiene.test.mjs is 3/3, expected 4/4');
});

test('counts dynamic template table-driven self-test names', (t) => {
  const root = createFixture(t, {
    handoff: withHandoffHygieneEvidence(GOOD_HANDOFF, 2, 3),
    hygieneTestSource: `const cases = [
  { name: 'template case one' },
  { name: 'template case two' },
];

test('standalone one', () => {});

for (const caseItem of cases) {
  test(\`rejects \${caseItem.name}\`, () => {});
}
`,
  });

  assertSingleFailure(root, 'Handoff hygiene self-test count for node --test scripts/check-handoff-hygiene.test.mjs is 2/2, expected 3/3');
});

test('rejects normalized task-card lookalikes even when ASCII ids share the line', (t) => {
  const root = createFixture(t, {
    handoff: GOOD_HANDOFF.replace(
      'Safe next dispatch queue (choose non-overlapping write scopes):',
      '- Active queue: T07 and \u{1D413}07 must not collapse to one clean ASCII task card.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
    ),
  });

  assertSingleFailure(root, 'Active task-card id must use ASCII compact TNN form: T07');
});

test('rejects broad safe-dispatch aliases individually', (t) => {
  const broadScopeAliases = [
    'everywhere',
    'all app code',
    'all source code',
    'workspace-spanning',
    'monorepo-spanning',
    'code-wide',
    'source-wide',
    'page-wide',
    'view-spanning',
    'dialog-wide',
    'modal-spanning',
    'schema-wide',
    'database-spanning',
    'docs-wide',
    'documentation-spanning',
    'file-wide',
    'directory-spanning',
    'path-spanning',
    'test-suite-wide',
    'spec-spanning',
    'workstream-spanning',
    'full code',
    'full surfaces',
    'full panels',
    'full settings',
    'full assets',
    'full folders',
    'across paths',
    'cross-file',
    'files-crossing',
    'multiple lanes',
    'several workstreams',
    'many files',
    'both services',
    'various modules',
    'numerous components',
    'assorted paths',
    'mixed packages',
    'several screens',
    'various features',
    'collection of pages',
    'several forms',
    'various tables',
    'collection of cards',
    'several environments',
    'various caches',
    'collection of records',
    'several resources',
    'various artifacts',
    'collection of images',
    'both of the services',
    'several of the workstreams',
    'various different modules',
    'collection of services',
    'group of paths',
    'range of packages',
    'a variety of modules',
    'collection of the services',
    'two lanes',
    '1+ services',
    '1 or more packages',
    'one or more workstreams',
    'at least two lanes',
    'more than one package',
    'over 3 modules',
    'no fewer than two workstreams',
    '3 services',
    '2+ workstreams',
    'two or more packages',
    'couple modules',
    'two of the lanes',
    'pair of the lanes',
    'pair of lanes',
    'a couple of workstreams',
    'two separate services',
    '3 different packages',
    'across code',
    'throughout codebase',
    'through packages',
    'between services',
    'among modules',
    'throughout routes',
    'between views',
    'throughout navigation',
    'between dialogs',
    'throughout schemas',
    'between datasets',
    'throughout docs',
    'between themes',
    'touch packages',
    'edit services',
    'modify modules',
    'implement packages',
    'build services',
    'create modules',
    'remove codebase',
    'fix packages',
    'patch services',
    'deploy packages',
    'develop services',
    'deliver modules',
    'ship codebase',
    'improve packages',
    'enhance services',
    'maintain modules',
    'release codebase',
    'harden packages',
    'secure services',
    'optimize modules',
    'upgrade codebase',
    'modernize packages',
    'repair services',
    'stabilize modules',
    'polish codebase',
    'hardening of packages',
    'security fixes for services',
    'optimization of modules',
    'package upgrades',
    'service repairs',
    'audit packages',
    'review services',
    'inspect modules',
    'validate codebase',
    'verify packages',
    'test services',
    'audits of modules',
    'package reviews',
    'clean up packages',
    'cleanup codebase',
    'configure services',
    'document modules',
    'migrate codebase',
    'integrate packages',
    'instrument services',
    'wire modules',
    'baseline packages',
    'sweep services',
    'documentation of services',
    'package migrations',
    'service integrations',
    'package sweep',
    'service pass',
    'endpoint pass',
    'route sweep',
    'alert pass',
    'menu sweep',
    'config pass',
    'schema sweep',
    'guide pass',
    'resource sweep',
    'module round',
    'codebase baseline',
    'cleanup round for services',
    'QA pass of modules',
    'release baseline for packages',
    'maintenance sweep of workstreams',
    'handle packages',
    'cover services',
    'manage modules',
    'own codebase',
    'lead packages',
    'coordinate services',
    'orchestrate modules',
    'supervise codebase',
    'drive packages',
    'direct services',
    'steer modules',
    'govern codebase',
    'assign packages',
    'delegate services',
    'allocate modules',
    'route codebase',
    'responsible for packages',
    'accountable for services',
    'ownership of modules',
    'coordination of codebase',
    'responsibility for packages',
    'accountability for services',
    'oversight of modules',
    'stewardship of codebase',
    'assignment of packages',
    'delegation of services',
    'allocation of modules',
    'routing of codebase',
    'adjust services',
    'revise codebase',
    'work on packages',
    'operate on modules',
    'work in packages',
    'operate over services',
    'changes to packages',
    'updates for services',
    'edits in modules',
    'modifications to codebase',
    'implementation of packages',
    'creation of services',
    'removal of modules',
    'patches to codebase',
    'package changes',
    'service updates',
    'module edits',
    'codebase modifications',
    'screen changes',
    'feature updates',
    'toolbar changes',
    'button updates',
    'cache updates',
    'setting changes',
    'style updates',
    'icon changes',
    'package implementations',
    'service fixes',
    'rewrite codebase',
    'cross-code',
    'code-crossing',
    'every code',
    'any repository',
    'any endpoint',
    'any modal',
    'any schema',
    'any docs',
    'entire repository',
    'full repository',
    'across repository',
    'any repositories',
    'all projects',
    'all routes',
    'all tables',
    'all databases',
    'all resources',
    'all lanes',
    'every screen',
    'every form',
    'every setting',
    'every artifact',
    'multi-workstream',
    'lane-wide',
    'whole codebases',
    'full trees',
    'across the repositories',
    'across repositories',
    'cross-repository',
    'repository-crossing',
    'across apps',
    'across test suites',
    'cross-repo',
    'multi-project',
    'workspace-crossing',
    'cross-package',
    'multi-service',
    'module-crossing',
    'cross-test-suite',
    'cross-surface',
    'multi-page',
    'views-crossing',
    'cross-panel',
    'multi-dialog',
    'controls-crossing',
    'cross-config',
    'multi-dataset',
    'records-crossing',
    'cross-asset',
    'multi-theme',
    'images-crossing',
    'scoped continuation.\n  across services',
  ];

  for (const alias of broadScopeAliases) {
    const qaInfraScope = '`tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`';
    const expectedScope = `${qaInfraScope}, ${alias}.`.replace(/\s*\n\s*/g, ' ');
    const root = createFixture(t, {
      handoff: GOOD_HANDOFF.replace(
        `- QA infra: ${qaInfraScope}.`,
        `- QA infra: ${qaInfraScope}, ${alias}.`,
      ),
    });

    assertSingleFailure(root, `Safe dispatch lane QA infra is too broad: ${expectedScope}`);
  }
});

test('rejects CJK allowlist synonyms outside CORS origin context', (t) => {
  const allowlistTerms = ['\u5141\u8bb8\u540d\u5355', '\u5141\u8a31\u540d\u55ae'];

  for (const term of allowlistTerms) {
    const root = createFixture(t, {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        `- Controller note: ${term} wording is not CORS origin policy.\n\nSafe next dispatch queue (choose non-overlapping write scopes):`,
      ),
    });

    assertSingleFailure(
      root,
      `Active handoff allowlist wording must stay in CORS origin context: - Controller note: ${term} wording is not CORS origin policy.`,
    );
  }
});

test('rejects markdown and arrow active-lane prose variants', (t) => {
  const activeLaneLines = [
    '- Desktop polish says Desktop UX/a11y is currently the active lane.',
    '- Desktop polish says **Desktop UX/a11y** is currently the active lane.',
    '- Desktop polish says [Desktop UX/a11y](https://example.test/lane) remains the active lane.',
    '- Desktop polish says active lane -> Desktop UX/a11y.',
    '- Desktop polish says active lane \u2192 Desktop UX/a11y.',
  ];

  for (const line of activeLaneLines) {
    const root = createFixture(t, {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        `${line}\n\nSafe next dispatch queue (choose non-overlapping write scopes):`,
      ),
    });

    assertSingleFailure(
      root,
      `Active handoff mentions non-ledger active lane Desktop UX/a11y while ledger active lane is Web admin: ${line}`,
    );
  }
});

test('rejects legacy previous and superseded controller collision prose', (t) => {
  const collisionLines = [
    '- Active lane note: legacy session context must not be followed here.',
    '- Active lane note: superseded controller pass must not be followed here.',
    '- Active lane note: previous controller lane must not be followed here.',
    '- Active lane note: archived controller lane must not be followed here.',
    '- Active lane note: closed session restore must not be followed here.',
  ];

  for (const line of collisionLines) {
    const root = createFixture(t, {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        `${line}\n\nSafe next dispatch queue (choose non-overlapping write scopes):`,
      ),
    });

    assertSingleFailure(root, `Active handoff must reserve stale session wording for the stop warning: ${line}`);
  }
});

for (const { name, overrides, expectedFailure, expectedFailures, expectedFailureCount } of [
  {
    name: 'rejects duplicate active latest headings',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Current controller baseline:',
        '## 0. Latest continuation state (duplicate)\n\nCurrent controller baseline:',
      ),
    },
    expectedFailure: /Expected exactly one active latest continuation heading/,
  },
  {
    name: 'rejects stale active session resume directives',
    overrides: {
      handoff: `${GOOD_HANDOFF}\n**Codex session to resume:** old-session-id\n`,
    },
    expectedFailure: /Forbidden stale active session resume directive/,
  },
  {
    name: 'rejects missing CI and weakened package handoff hygiene wiring',
    overrides: {
      packageJson: {
        ...GOOD_PACKAGE_JSON,
        scripts: {
          qa: 'npm run lint',
          'test:handoff-hygiene': 'node scripts/check-handoff-hygiene.test.mjs',
          'qa:handoff-hygiene': 'node scripts/check-handoff-hygiene.mjs',
        },
      },
      ciWorkflow: 'name: CI\njobs:\n  lint:\n    steps:\n      - run: npm run lint\n',
    },
    expectedFailures: [
      'package.json root qa script must include qa:handoff-hygiene',
      'package.json test:handoff-hygiene script must run node --test scripts/check-handoff-hygiene.test.mjs',
      'package.json qa:handoff-hygiene script must run self-tests before live scan',
      'Missing CI handoff hygiene step',
    ],
  },
  {
    name: 'rejects protected-root wget lines that still say allowlist',
    overrides: {
      handoff: `${GOOD_HANDOFF}\nwget -O /tmp/file https://example.test # allowlist exception\n`,
    },
    expectedFailure: /Protected-root terminal-safety line must use blocklist wording/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects protected-root terminal-safety lines that say whitelist',
    overrides: {
      handoff: `${GOOD_HANDOFF}\nTerminal-safety protected-root whitelist exception documented for local writes.\n`,
    },
    expectedFailure: /Protected-root terminal-safety line must use blocklist wording/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects protected-root terminal-safety lines with Traditional Chinese whitelist wording',
    overrides: {
      handoff: `${GOOD_HANDOFF}\nTerminal-safety protected-root \u767d\u540d\u55ae exception documented for local writes.\n`,
    },
    expectedFailure: /Protected-root terminal-safety line must use blocklist wording/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active allowlist wording outside CORS origin context',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Terminal-safety `wget -O /` is documented as a protected-root blocklist.',
        '- CORS origin allowlist grants root path exceptions, which is not a terminology-context statement.',
      ),
    },
    expectedFailure: /Active handoff allowlist wording must stay in CORS origin context/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active whitelist terminology',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- CORS origin `allowlist` wording is legitimate policy language.',
        '- CORS origin whitelist wording is legitimate policy language.',
      ),
    },
    expectedFailure: /Active handoff must not use whitelist terminology/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active spaced white list terminology',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- CORS origin `allowlist` wording is legitimate policy language.',
        '- CORS origin \uFF57\uFF48\uFF49\uFF54\uFF45\uFF4C\uFF49\uFF53\uFF54 wording is legitimate policy language.',
      ),
    },
    expectedFailure: /Active handoff must not use whitelist terminology/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active Chinese whitelist terminology',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- CORS origin `allowlist` wording is legitimate policy language.',
        '- CORS origin \u767D\u2011\u540D\u5355 wording is legitimate policy language.',
      ),
    },
    expectedFailure: /Active handoff must not use whitelist terminology/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active Traditional Chinese whitelist terminology',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- CORS origin `allowlist` wording is legitimate policy language.',
        '- CORS origin \u767d\u540d\u55ae wording is legitimate policy language.',
      ),
    },
    expectedFailure: /Active handoff must not use whitelist terminology/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active spaced CJK whitelist terminology',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- CORS origin `allowlist` wording is legitimate policy language.',
        '- CORS origin \u767d \u540d\u2013\u5355 wording is legitimate policy language.',
      ),
    },
    expectedFailure: /Active handoff must not use whitelist terminology/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active hyphenated allow-list outside CORS context',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Terminal-safety `wget -O /` is documented as a protected-root blocklist.',
        '- Terminal-safety allow\u2013list wording is allowed for protected-root exceptions.',
      ),
    },
    expectedFailure: /Active handoff allowlist wording must stay in CORS origin context/,
    expectedFailureCount: 3,
  },
  {
    name: 'rejects active spaced allow list wording outside CORS origin context',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Terminal-safety `wget -O /` is documented as a protected-root blocklist.',
        '- Terminal-safety allow list and \u5141\u8bb8\u5217\u8868 wording are allowed for protected-root exceptions.',
      ),
    },
    expectedFailure: /Active handoff allowlist wording must stay in CORS origin context/,
    expectedFailureCount: 3,
  },
  {
    name: 'rejects active white-list terminology variants',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- CORS origin `allowlist` wording is legitimate policy language.',
        '- CORS origin white\u2011listed wording is legitimate policy language.',
      ),
    },
    expectedFailure: /Active handoff must not use whitelist terminology/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active policy terminology plural slash and dot variants',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Controller note: whitelists are still disallowed.\n- Controller note: white/list is still disallowed.\n- Controller note: ROOT_PATH_WHITELIST must be rejected.\n- Controller note: white:list must be rejected.\n- Controller note: allow.lists are not CORS origin policy.\n- Controller note: ROOT_PATH_ALLOWLIST must be rejected.\n- Controller note: allow:list must be rejected.\n- Controller note: allow\u2212list must be rejected.\n- Controller note: safelists are not CORS origin policy.\n- Controller note: SAFE_PATH_SAFELIST must be rejected.\n- Controller note: permit:list must be rejected.\n- Controller note: PERMITTED_PATH_PERMITTEDLIST must be rejected.\n- Controller note: permission:list must be rejected.\n- Controller note: acceptlists are not CORS origin policy.\n- Controller note: ADMIT_PATH_ADMITLIST must be rejected.\n- Controller note: CONSENT_PATH_CONSENTLIST must be rejected.\n- Controller note: consented:list must be rejected.\n- Controller note: VALIDATED_PATH_VALIDATEDLIST must be rejected.\n- Controller note: verified:list must be rejected.\n- Controller note: CERTIFIED_PATH_CERTIFIEDLIST must be rejected.\n- Controller note: approved:list must be rejected.\n- Controller note: APPROVE_PATH_APPROVELIST must be rejected.\n- Controller note: approval:list must be rejected.\n- Controller note: green-list must be rejected.\n- Controller note: trust/list must be rejected.\n- Controller note: trusted list must be rejected.\n- Controller note: AUTHORIZED_PATH_AUTHORIZEDLIST must be rejected.\n- Controller note: authorized:list must be rejected.\n- Controller note: GRANT_PATH_GRANTLIST must be rejected.\n- Controller note: granted:list must be rejected.\n- Controller note: CLEARANCE_PATH_CLEARANCELIST must be rejected.\n- Controller note: cleared:list must be rejected.\n- Controller note: INCLUDE_PATH_INCLUDELIST must be rejected.\n- Controller note: include:list must be rejected.\n- Controller note: INCLUSION_PATH_INCLUSIONLIST must be rejected.\n- Controller note: inclusion:list must be rejected.\n- Controller note: ACCESS_PATH_ACCESSLIST must be rejected.\n- Controller note: access:list must be rejected.\n- Controller note: PRIVILEGE_PATH_PRIVILEGELIST must be rejected.\n- Controller note: privileged:list must be rejected.\n- Controller note: ELIGIBLE_PATH_ELIGIBLELIST must be rejected.\n- Controller note: eligibility:list must be rejected.\n- Controller note: EXCEPTION_PATH_EXCEPTIONLIST must be rejected.\n- Controller note: except:list must be rejected.\n- Controller note: EXEMPT_PATH_EXEMPTLIST must be rejected.\n- Controller note: exemption:list must be rejected.\n- Controller note: BYPASS_PATH_BYPASSLIST must be rejected.\n- Controller note: bypass:list must be rejected.\n- Controller note: blacklists must be rejected.\n- Controller note: black/list must be rejected.\n- Controller note: BAN_PATH_BANLIST must be rejected.\n- Controller note: ban:list must be rejected.\n- Controller note: BARRED_PATH_BARREDLIST must be rejected.\n- Controller note: bar:list must be rejected.\n- Controller note: BANNED_PATH_BANNEDLIST must be rejected.\n- Controller note: banned:list must be rejected.\n- Controller note: DENY_PATH_DENYLIST must be rejected.\n- Controller note: deny:list must be rejected.\n- Controller note: DISALLOW_PATH_DISALLOWLIST must be rejected.\n- Controller note: disallowed:list must be rejected.\n- Controller note: exclusion-list must be rejected.\n- Controller note: exclude/list must be rejected.\n- Controller note: FORBIDDEN_PATH_FORBIDDENLIST must be rejected.\n- Controller note: forbidden:list must be rejected.\n- Controller note: PROHIBITION_PATH_PROHIBITIONLIST must be rejected.\n- Controller note: prohibited:list must be rejected.\n- Controller note: REFUSAL_PATH_REFUSALLIST must be rejected.\n- Controller note: refused:list must be rejected.\n- Controller note: REJECTION_PATH_REJECTIONLIST must be rejected.\n- Controller note: reject:list must be rejected.\n- Controller note: REVOCATION_PATH_REVOCATIONLIST must be rejected.\n- Controller note: revoked:list must be rejected.\n- Controller note: SUSPENSION_PATH_SUSPENSIONLIST must be rejected.\n- Controller note: suspended:list must be rejected.\n- Controller note: QUARANTINE_PATH_QUARANTINELIST must be rejected.\n- Controller note: quarantined:list must be rejected.\n- Controller note: RESTRICTION_PATH_RESTRICTIONLIST must be rejected.\n- Controller note: restricted:list must be rejected.\n- Controller note: \u9ed1\u540d\u5355 must be rejected.\n- CORS origin allow-list wording is not exact policy context.\n- CORS origin allow/list wording is not exact policy context.\n- CORS origin allow.lists wording is not exact policy context.\n- CORS origin safelist wording is not exact policy context.\n- CORS origin permit-list wording is not exact policy context.\n- CORS origin permission-list wording is not exact policy context.\n- CORS origin consent-list wording is not exact policy context.\n- CORS origin verified-list wording is not exact policy context.\n- CORS origin greenlist wording is not exact policy context.\n- CORS origin trust-list wording is not exact policy context.\n- CORS origin approval-list wording is not exact policy context.\n- CORS origin authorized-list wording is not exact policy context.\n- CORS origin grant-list wording is not exact policy context.\n- CORS origin clearance-list wording is not exact policy context.\n- CORS origin inclusion-list wording is not exact policy context.\n- CORS origin access-list wording is not exact policy context.\n- CORS origin privilege-list wording is not exact policy context.\n- CORS origin eligibility-list wording is not exact policy context.\n- CORS origin exception-list wording is not exact policy context.\n- CORS origin exemption-list wording is not exact policy context.\n- CORS origin bypass-list wording is not exact policy context.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailures: [
      'Active handoff must not use whitelist terminology: - Controller note: whitelists are still disallowed.',
      'Active handoff must not use whitelist terminology: - Controller note: white/list is still disallowed.',
      'Active handoff must not use whitelist terminology: - Controller note: ROOT_PATH_WHITELIST must be rejected.',
      'Active handoff must not use whitelist terminology: - Controller note: white:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: allow.lists are not CORS origin policy.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: ROOT_PATH_ALLOWLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: allow:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: allow\u2212list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: safelists are not CORS origin policy.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: SAFE_PATH_SAFELIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: permit:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: PERMITTED_PATH_PERMITTEDLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: permission:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: acceptlists are not CORS origin policy.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: ADMIT_PATH_ADMITLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: CONSENT_PATH_CONSENTLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: consented:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: VALIDATED_PATH_VALIDATEDLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: verified:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: CERTIFIED_PATH_CERTIFIEDLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: approved:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: APPROVE_PATH_APPROVELIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: approval:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: green-list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: trust/list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: trusted list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: AUTHORIZED_PATH_AUTHORIZEDLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: authorized:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: GRANT_PATH_GRANTLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: granted:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: CLEARANCE_PATH_CLEARANCELIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: cleared:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: INCLUDE_PATH_INCLUDELIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: include:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: INCLUSION_PATH_INCLUSIONLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: inclusion:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: ACCESS_PATH_ACCESSLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: access:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: PRIVILEGE_PATH_PRIVILEGELIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: privileged:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: ELIGIBLE_PATH_ELIGIBLELIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: eligibility:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: EXCEPTION_PATH_EXCEPTIONLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: except:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: EXEMPT_PATH_EXEMPTLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: exemption:list must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: BYPASS_PATH_BYPASSLIST must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - Controller note: bypass:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: blacklists must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: black/list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: BAN_PATH_BANLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: ban:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: BARRED_PATH_BARREDLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: bar:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: BANNED_PATH_BANNEDLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: banned:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: DENY_PATH_DENYLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: deny:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: DISALLOW_PATH_DISALLOWLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: disallowed:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: exclusion-list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: exclude/list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: FORBIDDEN_PATH_FORBIDDENLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: forbidden:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: PROHIBITION_PATH_PROHIBITIONLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: prohibited:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: REFUSAL_PATH_REFUSALLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: refused:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: REJECTION_PATH_REJECTIONLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: reject:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: REVOCATION_PATH_REVOCATIONLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: revoked:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: SUSPENSION_PATH_SUSPENSIONLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: suspended:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: QUARANTINE_PATH_QUARANTINELIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: quarantined:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: RESTRICTION_PATH_RESTRICTIONLIST must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: restricted:list must be rejected.',
      'Active handoff must use blocklist terminology: - Controller note: \u9ed1\u540d\u5355 must be rejected.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin allow-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin allow/list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin allow.lists wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin safelist wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin permit-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin permission-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin consent-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin verified-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin greenlist wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin trust-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin approval-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin authorized-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin grant-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin clearance-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin inclusion-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin access-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin privilege-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin eligibility-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin exception-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin exemption-list wording is not exact policy context.',
      'Active handoff allowlist wording must stay in CORS origin context: - CORS origin bypass-list wording is not exact policy context.',
    ],
  },
  {
    name: 'rejects historical handoff whitelist terminology',
    overrides: {
      handoff: `${GOOD_HANDOFF}\nHistorical policy notes must not say whitelist here.\nHistorical policy notes must not say denylist here.\n`,
    },
    expectedFailures: [
      'Handoff must not use whitelist terminology: Historical policy notes must not say whitelist here.',
      'Handoff must use blocklist terminology: Historical policy notes must not say denylist here.',
    ],
  },
  {
    name: 'rejects historical allowlist terminology outside CORS origin context',
    overrides: {
      handoff: `${GOOD_HANDOFF}\nHistorical policy notes must not say allowlist here.\n`,
    },
    expectedFailures: ['Handoff allowlist wording must stay in CORS origin context: Historical policy notes must not say allowlist here.'],
  },
  {
    name: 'rejects active handoff sections missing the CORS allowlist policy statement',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- CORS origin `allowlist` wording is legitimate policy language.\n',
        '',
      ),
    },
    expectedFailure: /Missing CORS allowlist policy statement/,
  },
  {
    name: 'rejects duplicate do-not-resurrect archived session warnings',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Do not resurrect archived session ids from historical notes below.',
        'Do not resurrect archived session ids from historical notes below.\nDo not resurrect archived session ids from historical notes below.',
      ),
    },
    expectedFailure: /Expected one do-not-resurrect archived session warning/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects modified do-not-resurrect archived session warnings',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Do not resurrect archived session ids from historical notes below.',
        'Do not restore archived session ids from historical notes below.\n不要恢复历史会话编号。',
      ),
    },
    expectedFailures: [
      'Missing do-not-resurrect archived session warning',
      'Unexpected near-duplicate do-not-resurrect archived session warning:  / Do not restore archived session ids from historical notes below.',
      'Unexpected near-duplicate do-not-resurrect archived session warning: Do not restore archived session ids from historical notes below.',
      'Unexpected near-duplicate do-not-resurrect archived session warning: 不要恢复历史会话编号。',
      'Active handoff must reserve stale session wording for the stop warning: Do not restore archived session ids from historical notes below.',
      'Active handoff must reserve stale session wording for the stop warning: 不要恢复历史会话编号。',
      'Unexpected active lane ledger gap line: Do not restore archived session ids from historical notes below.',
      'Unexpected active lane ledger gap line: 不要恢复历史会话编号。',
      'Unexpected active lane ledger gap line: Start from the current workspace state and this top section.',
      'Active lane ledger must end with the do-not-resurrect archived session warning',
    ],
  },
  {
    name: 'rejects active handoff sections missing the git metadata caveat',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Workspace caveat remains: `.git/` is partial on this host and `git status` fails. Treat files on disk plus verification output as truth here.\n',
        '',
      ),
    },
    expectedFailure: /Missing git metadata caveat/,
  },
  {
    name: 'rejects stale active full-root E2E timeout caveats',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Full root `npm run qa:e2e` now passes 73/73 with the static mobile web server path, so the active handoff must not carry the old Windows webServer timeout caveat.',
        '- Full root `npm run qa:e2e` can time out on this Windows host while web/mobile servers start.',
      ),
    },
    expectedFailure: /Forbidden stale active full-root E2E timeout caveat/,
    expectedFailureCount: 3,
  },
  {
    name: 'rejects stale full-root E2E test counts',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Full root `npm run qa:e2e` now passes 73/73 with the static mobile web server path, so the active handoff must not carry the old Windows webServer timeout caveat.',
        '- Full root `npm run qa:e2e` now passes 67/67 with the static mobile web server path, so the active handoff must not carry the old Windows webServer timeout caveat.',
      ),
    },
    expectedFailures: [
      'Missing stable full root E2E statement',
      'Forbidden stale active full-root E2E 67/67 evidence: "Full root `npm run qa:e2e` now passes 67/67"',
    ],
  },
  {
    name: 'rejects stale command-form root E2E test counts',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Latest root E2E command evidence: `npm run qa:e2e:fresh` (67/67).\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Forbidden stale active root E2E command-form evidence/,
  },
  {
    name: 'rejects duplicate active task-card ids',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: T21 Desktop polish.\n- Active queue: T21 QA follow-up.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Duplicate active task-card id T21 appears 2 times/,
  },
  {
    name: 'rejects active task-card ids without two digits',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: T7 Desktop polish.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Active task-card id must use two digits: T7/,
  },
  {
    name: 'rejects padded active task-card ids with extra digits',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: T007, T\uFF10\uFF17, T\u0660\u0667, T\u0966\u096D, \uFF3407, \u03A407, \u042207, and T-\uFF10\uFF17 Desktop polish.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailures: [
      'Active task-card id must use ASCII compact TNN form: T07',
      'Active task-card id must use ASCII compact TNN form: T07',
      'Active task-card id must use ASCII compact TNN form: T\uFF10\uFF17',
      'Active task-card id must use ASCII compact TNN form: T\u0660\u0667',
      'Active task-card id must use ASCII compact TNN form: T\u0966\u096D',
      'Active task-card id must use ASCII compact TNN form: \uFF3407',
      'Active task-card id must use ASCII compact TNN form: \u03A407',
      'Active task-card id must use ASCII compact TNN form: \u042207',
      'Active task-card id must use compact TNN form: T-\uFF10\uFF17',
      'Active task-card id must use two digits: T007',
    ],
  },
  {
    name: 'rejects active task-card ids with internal spacing',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: T 07 Desktop polish.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Active task-card id must use compact TNN form: T 07/,
  },
  {
    name: 'rejects lowercase active task-card ids',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: t21 Desktop polish.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Active task-card id must use uppercase TNN form: t21/,
  },
  {
    name: 'rejects active task-card ids with trailing suffixes',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: T07a, T07_foo, T07-foo, T07.foo, T07/foo, T07\u03B2, T07\u4FEE, T07\u0301, T07\u200D, and T07\uFE0F\u20E3 Desktop polish.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailures: [
      'HANDOFF.md must not contain format character U+200D at line 16, column 80',
      'Active task-card id must use compact TNN form: T07a',
      'Active task-card id must use compact TNN form: T07_foo',
      'Active task-card id must use compact TNN form: T07-foo',
      'Active task-card id must use compact TNN form: T07.foo',
      'Active task-card id must use compact TNN form: T07/foo',
      'Active task-card id must use compact TNN form: T07\u03B2',
      'Active task-card id must use compact TNN form: T07\u4FEE',
      'Active task-card id must use compact TNN form: T07\u0301',
      'Active task-card id must use compact TNN form: T07\u200D',
      'Active task-card id must use compact TNN form: T07\uFE0F\u20E3',
    ],
  },
  {
    name: 'rejects active task-card ids with punctuation separators',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: T\u201321, \uFF34:07, T\uFF0F07, T\uFF0D07, T\u202207, T\u270507, T\u030107, T\u200B07, \u{1D413}07, T\u2070\u2077, and T\uFE0F\u20E307 Desktop polish.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailures: [
      'HANDOFF.md must not contain format character U+200B at line 16, column 60',
      'Active task-card id must use ASCII compact TNN form: T07',
      'Active task-card id must use ASCII compact TNN form: T07',
      'Active task-card id must use ASCII compact TNN form: T07',
      'Active task-card id must use ASCII compact TNN form: T07',
      'Active task-card id must use ASCII compact TNN form: T07',
      'Active task-card id must use ASCII compact TNN form: T\u2070\u2077',
      'Active task-card id must use compact TNN form: T\u201321',
      'Active task-card id must use compact TNN form: \uFF34:07',
      'Active task-card id must use compact TNN form: T\uFF0F07',
      'Active task-card id must use compact TNN form: T\uFF0D07',
      'Active task-card id must use compact TNN form: T\u202207',
      'Active task-card id must use compact TNN form: T\u270507',
      'Active task-card id must use compact TNN form: T\u030107',
      'Active task-card id must use compact TNN form: T\u200B07',
      'Active task-card id must use compact TNN form: T\uFE0F\u20E307',
    ],
  },
  {
    name: 'rejects active task-card ids with colon separators',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: T:07 Desktop polish.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Active task-card id must use compact TNN form: T:07/,
  },
  {
    name: 'rejects active task-card ids with parenthesized separators',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active queue: T(07) Desktop polish.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Active task-card id must use compact TNN form: T\(07\)/,
  },
  {
    name: 'rejects active task-card ids appended to historical audit lines',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Controller audit: historical task-card references are limited to T04/T05/T12/T15; there is no active duplicate card queue.',
        '- Controller audit: historical task-card references are limited to T04/T05/T12/T15; there is no active duplicate card queue; next active card is T7.',
      ),
    },
    expectedFailure: /Active task-card id must use two digits: T7/,
  },
  {
    name: 'rejects active handoff missing Web Admin record-ID whitespace evidence',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Web Admin snapshot list identity validation rejects blank, duplicate trim-equivalent, and leading or trailing whitespace `id` values; `npm run test:web -- adminData` (30/30) is green.\n',
        '',
      ),
    },
    expectedFailure: /Missing Web Admin record-ID whitespace rejection evidence/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects stale Web Admin adminData test counts',
    overrides: {
      handoff: GOOD_HANDOFF.replace('`npm run test:web -- adminData` (30/30)', '`npm run test:web -- adminData` (28/28)'),
    },
    expectedFailures: [
      'Missing Web Admin adminData 30/30 evidence',
      'Forbidden stale Web Admin adminData 28/28 evidence: "`npm run test:web -- adminData` (28/28)"',
      'Forbidden stale Web Admin adminData command count evidence: "`npm run test:web -- adminData` (28/28)"',
    ],
  },
  {
    name: 'rejects stale Web Admin Web-only E2E test counts',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '`npm run test:web:fresh -w @atlasterm/e2e` (35/35)',
        '`npm run test:web:fresh -w @atlasterm/e2e` (35/35) and stale `npm run test:web:fresh -w @atlasterm/e2e` (34/34)',
      ),
    },
    expectedFailure: /Forbidden stale Web Admin Web-only command count evidence/,
  },
  {
    name: 'rejects stale Web Admin Web-only prose test counts',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Full Web-only fresh E2E (34/34) was green before the current Web Admin coverage landed.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Active Web Admin Web-only E2E evidence must stay 35\/35/,
  },
  {
    name: 'rejects stale Web Admin qa:web test counts',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '`npm run qa:web` (Web typecheck, 160/160 Web tests, production build + SRI)',
        '`npm run qa:web` (Web typecheck, 143/143 Web tests, production build + SRI)',
      ),
    },
    expectedFailures: [
      'Missing Web Admin qa:web 160/160 evidence',
      'Forbidden stale Web Admin qa:web 143/143 evidence: "`npm run qa:web` (Web typecheck, 143/143 Web tests, production build + SRI)"',
      'Forbidden stale Web Admin qa:web command count evidence: "`npm run qa:web` (Web typecheck, 143/143 Web tests, production build + SRI)"',
    ],
  },
  {
    name: 'rejects appended stale Web Admin qa:web counts when current evidence remains',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Older Web QA command evidence: `npm run qa:web` (Web typecheck, 142/142 Web tests, production build + SRI).\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Forbidden stale Web Admin qa:web command count evidence/,
  },
  {
    name: 'rejects appended stale Web Admin adminData counts when current evidence remains',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Older adminData command evidence: `npm run test:web -- adminData` (27/27).\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Forbidden stale Web Admin adminData command count evidence/,
  },
  {
    name: 'rejects stale active TerminalPane browser test counts',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Verification for the terminal autocomplete hint localization slice is green: `npm run test -w @atlasterm/desktop -- TerminalPane.browser.test.tsx` (63/63).\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Forbidden stale TerminalPane browser count evidence/,
  },
  {
    name: 'rejects appended stale TerminalPane browser test counts when current evidence remains',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Current terminal focused evidence: `npm run test -w @atlasterm/desktop -- TerminalPane.browser.test.tsx` (61/61).\n- Older terminal focused evidence: `npm run test -w @atlasterm/desktop -- TerminalPane.browser.test.tsx` (60/60).\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Forbidden stale TerminalPane browser count evidence/,
  },
  {
    name: 'rejects active handoff mojibake and control characters',
    overrides: {
      handoffBytes: (() => {
        const heading = 'Safe next dispatch queue (choose non-overlapping write scopes):';
        const [beforeHeading, afterHeading] = GOOD_HANDOFF.split(heading);
        return Buffer.concat([
          Buffer.from(`${beforeHeading}- Fresh QA observed \`\uFFFD\` in active copy, a NUL control character \u0000, and invalid bytes here: `),
          Buffer.from([0xe9, 0x94, 0x3f]),
          Buffer.from(`\n\n${heading}${afterHeading}`),
        ]);
      })(),
    },
    expectedFailures: [
      'HANDOFF.md must be valid UTF-8',
      'HANDOFF.md must not contain control character U+0000 at line 16, column 65',
      'Active handoff contains likely mojibake: - Fresh QA observed `�` in active copy, a NUL control character \u0000, and invalid bytes here: �?',
    ],
  },
  {
    name: 'rejects C1 control characters in handoff text',
    overrides: {
      handoffBytes: (() => {
        const heading = 'Safe next dispatch queue (choose non-overlapping write scopes):';
        const [beforeHeading, afterHeading] = GOOD_HANDOFF.split(heading);
        return Buffer.from(`${beforeHeading}- Fresh QA observed hidden C1 control \u009f in active copy.\n\n${heading}${afterHeading}`, 'utf8');
      })(),
    },
    expectedFailure: /HANDOFF\.md must not contain control character U\+009F/,
  },
  {
    name: 'rejects Unicode format characters in handoff text',
    overrides: {
      handoffBytes: (() => {
        const heading = 'Safe next dispatch queue (choose non-overlapping write scopes):';
        const [beforeHeading, afterHeading] = GOOD_HANDOFF.split(heading);
        return Buffer.from(`${beforeHeading}- Fresh QA observed hidden bidi format \u202e in active copy.\n\n${heading}${afterHeading}`, 'utf8');
      })(),
    },
    expectedFailure: /HANDOFF\.md must not contain format character U\+202E/,
  },
  {
    name: 'rejects QA checklist docs that omit task-card hygiene coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`.\n',
    },
    expectedFailure: /Missing QA checklist task-card hygiene coverage/,
    expectedFailureCount: 13,
  },
  {
    name: 'rejects duplicate safe dispatch lanes',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- QA infra: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`.',
        '- Controller cleanup/docs: `HANDOFF.md`, `docs/qa-checklist.md`, `README.md`, `CHANGELOG.md`.',
      ),
    },
    expectedFailure: /Duplicate safe dispatch lane: Controller cleanup\/docs/,
    expectedFailureCount: 11,
  },
  {
    name: 'rejects safe dispatch lanes in the wrong order',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Controller cleanup/docs: `HANDOFF.md`, `docs/qa-checklist.md`, `README.md`, `CHANGELOG.md`.\n- Desktop UX/a11y: `apps/desktop/src/*`, `packages/i18n/src/*`, `tests/e2e/specs/desktop-*`.',
        '- Desktop UX/a11y: `apps/desktop/src/*`, `packages/i18n/src/*`, `tests/e2e/specs/desktop-*`.\n- Controller cleanup/docs: `HANDOFF.md`, `docs/qa-checklist.md`, `README.md`, `CHANGELOG.md`.',
      ),
    },
    expectedFailure: /Safe dispatch lane 1 must be Controller cleanup\/docs, found Desktop UX\/a11y/,
    expectedFailureCount: 18,
  },
  {
    name: 'rejects safe dispatch lanes with broad write scopes',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- QA infra: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`.',
        '- QA infra: Playwright configs/scripts, release scripts, CI docs, any code touched by QA, all tests touched by QA, test-wide follow-up, any\u2011directories touched by QA, any\u2013modules across the entire\u2011project, root-wide follow-up, full workspace edits, global coverage, unrestricted writes, all repo files, across the codebase, no scope limits, and touch whatever.\n  - QA infra: repo-wide hidden sublane.',
      ).replace(
        '\n\nActive lane ledger (current controller occupancy):',
        '\n\nUnscoped QA queue gap tries to cover all services.\n\nActive lane ledger (current controller occupancy):',
      ),
    },
    expectedFailures: [
      'Indented safe dispatch lane must not masquerade as continuation:   - QA infra: repo-wide hidden sublane.',
      'Unexpected safe dispatch queue gap line: Unscoped QA queue gap tries to cover all services.',
      'Safe dispatch lane QA infra must keep scoped write targets: Playwright configs/scripts, release scripts, CI docs, any code touched by QA, all tests touched by QA, test-wide follow-up, any‑directories touched by QA, any–modules across the entire‑project, root-wide follow-up, full workspace edits, global coverage, unrestricted writes, all repo files, across the codebase, no scope limits, and touch whatever.',
      'Safe dispatch lane QA infra must code-span scoped target tests/e2e/playwright*.config.ts: Playwright configs/scripts, release scripts, CI docs, any code touched by QA, all tests touched by QA, test-wide follow-up, any‑directories touched by QA, any–modules across the entire‑project, root-wide follow-up, full workspace edits, global coverage, unrestricted writes, all repo files, across the codebase, no scope limits, and touch whatever.',
      'Safe dispatch lane QA infra must code-span scoped target tests/e2e/scripts/*: Playwright configs/scripts, release scripts, CI docs, any code touched by QA, all tests touched by QA, test-wide follow-up, any‑directories touched by QA, any–modules across the entire‑project, root-wide follow-up, full workspace edits, global coverage, unrestricted writes, all repo files, across the codebase, no scope limits, and touch whatever.',
      'Safe dispatch lane QA infra must code-span scoped target scripts/*: Playwright configs/scripts, release scripts, CI docs, any code touched by QA, all tests touched by QA, test-wide follow-up, any‑directories touched by QA, any–modules across the entire‑project, root-wide follow-up, full workspace edits, global coverage, unrestricted writes, all repo files, across the codebase, no scope limits, and touch whatever.',
      'Safe dispatch lane QA infra must code-span scoped target .github/workflows/*: Playwright configs/scripts, release scripts, CI docs, any code touched by QA, all tests touched by QA, test-wide follow-up, any‑directories touched by QA, any–modules across the entire‑project, root-wide follow-up, full workspace edits, global coverage, unrestricted writes, all repo files, across the codebase, no scope limits, and touch whatever.',
      'Safe dispatch lane QA infra is too broad: Playwright configs/scripts, release scripts, CI docs, any code touched by QA, all tests touched by QA, test-wide follow-up, any‑directories touched by QA, any–modules across the entire‑project, root-wide follow-up, full workspace edits, global coverage, unrestricted writes, all repo files, across the codebase, no scope limits, and touch whatever.',
    ],
  },
  {
    name: 'rejects safe dispatch lanes with repo-wide write scopes',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- QA infra: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`.',
        '- QA infra: repo-wide Playwright configs/scripts and all paths.',
      ),
    },
    expectedFailure: /Safe dispatch lane QA infra is too broad/,
    expectedFailureCount: 6,
  },
  {
    name: 'rejects safe dispatch lanes with repository-wide write scopes',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- QA infra: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`.',
        '- QA infra: repository-wide Playwright configs/scripts and CI docs.',
      ),
    },
    expectedFailure: /Safe dispatch lane QA infra is too broad/,
    expectedFailureCount: 6,
  },
  {
    name: 'rejects safe dispatch lanes with all-source write scopes',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- QA infra: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`.',
        '- QA infra: all-source and release scripts.',
      ),
    },
    expectedFailure: /Safe dispatch lane QA infra is too broad/,
    expectedFailureCount: 6,
  },
  {
    name: 'rejects safe dispatch lanes with normalized broad write scopes',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- QA infra: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`.',
        '- QA infra: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`, repo\u200D-wide follow-up.',
      ),
    },
    expectedFailures: [
      'HANDOFF.md must not contain format character U+200D at line 23, column 111',
      'Safe dispatch lane QA infra is too broad: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`, repo\u200D-wide follow-up.',
    ],
  },
  {
    name: 'rejects safe dispatch out-of-lane code spans',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Web admin: `apps/web/src/*`, `tests/e2e/specs/web-*`, `docs/sync-api.md`.',
        '- Web admin: `apps/web/src/*`, `tests/e2e/specs/web-*`, `docs/sync-api.md`, `apps/mobile/*`.',
      ),
    },
    expectedFailures: [
      'Safe dispatch lane Web admin must not include out-of-lane code span apps/mobile/*: `apps/web/src/*`, `tests/e2e/specs/web-*`, `docs/sync-api.md`, `apps/mobile/*`.',
    ],
  },
  {
    name: 'rejects safe dispatch unquoted out-of-lane paths',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Web admin: `apps/web/src/*`, `tests/e2e/specs/web-*`, `docs/sync-api.md`.',
        '- Web admin: `apps/web/src/*`, `tests/e2e/specs/web-*`, `docs/sync-api.md`, apps/mobile/src/App.tsx.',
      ),
    },
    expectedFailures: [
      'Safe dispatch lane Web admin must not include out-of-lane path apps/mobile/src/App.tsx: `apps/web/src/*`, `tests/e2e/specs/web-*`, `docs/sync-api.md`, apps/mobile/src/App.tsx.',
    ],
  },
  {
    name: 'rejects safe dispatch lanes missing scoped write targets',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Web admin: `apps/web/src/*`, `tests/e2e/specs/web-*`, `docs/sync-api.md`.',
        '- Web admin: `apps/web/src/*`.',
      ),
    },
    expectedFailures: [
      'Safe dispatch lane Web admin must keep scoped write targets: `apps/web/src/*`.',
      'Safe dispatch lane Web admin must code-span scoped target tests/e2e/specs/web-*: `apps/web/src/*`.',
      'Safe dispatch lane Web admin must code-span scoped target docs/sync-api.md: `apps/web/src/*`.',
    ],
  },
  {
    name: 'rejects safe dispatch scoped targets without code spans',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Desktop UX/a11y: `apps/desktop/src/*`, `packages/i18n/src/*`, `tests/e2e/specs/desktop-*`.',
        '- Desktop UX/a11y: apps/desktop/src/*, tests/e2e/specs/desktop-*.',
      ).replace(
        '- QA infra: `tests/e2e/playwright*.config.ts`, `tests/e2e/scripts/*`, `scripts/*`, `.github/workflows/*`.',
        '- QA infra: tests/e2e/playwright*.config.ts, tests/e2e/scripts/*, scripts/*, .github/workflows/*.',
      ),
    },
    expectedFailures: [
      'Safe dispatch lane Desktop UX/a11y must keep scoped write targets: apps/desktop/src/*, tests/e2e/specs/desktop-*.',
      'Safe dispatch lane Desktop UX/a11y must code-span scoped target apps/desktop/src/*: apps/desktop/src/*, tests/e2e/specs/desktop-*.',
      'Safe dispatch lane Desktop UX/a11y must code-span scoped target packages/i18n/src/*: apps/desktop/src/*, tests/e2e/specs/desktop-*.',
      'Safe dispatch lane Desktop UX/a11y must code-span scoped target tests/e2e/specs/desktop-*: apps/desktop/src/*, tests/e2e/specs/desktop-*.',
      'Safe dispatch lane QA infra must code-span scoped target tests/e2e/playwright*.config.ts: tests/e2e/playwright*.config.ts, tests/e2e/scripts/*, scripts/*, .github/workflows/*.',
      'Safe dispatch lane QA infra must code-span scoped target tests/e2e/scripts/*: tests/e2e/playwright*.config.ts, tests/e2e/scripts/*, scripts/*, .github/workflows/*.',
      'Safe dispatch lane QA infra must code-span scoped target scripts/*: tests/e2e/playwright*.config.ts, tests/e2e/scripts/*, scripts/*, .github/workflows/*.',
      'Safe dispatch lane QA infra must code-span scoped target .github/workflows/*: tests/e2e/playwright*.config.ts, tests/e2e/scripts/*, scripts/*, .github/workflows/*.',
    ],
  },
  {
    name: 'rejects duplicate safe dispatch queue headings in the active section',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Active lane ledger (current controller occupancy):',
        'Safe next dispatch queue (choose non-overlapping write scopes):\n\n- Controller cleanup/docs: `HANDOFF.md`, `docs/qa-checklist.md`, `README.md`, `CHANGELOG.md`.\n\nActive lane ledger (current controller occupancy):',
      ),
    },
    expectedFailures: [
      'Expected one safe dispatch queue heading in active handoff section, found 2',
      'Unexpected safe dispatch queue gap line: Safe next dispatch queue (choose non-overlapping write scopes):',
      'Unexpected safe dispatch queue gap line: - Controller cleanup/docs: `HANDOFF.md`, `docs/qa-checklist.md`, `README.md`, `CHANGELOG.md`.',
    ],
  },
  {
    name: 'rejects safe dispatch queue phrase that is not the exact heading',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Safe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Missing safe dispatch queue heading/,
  },
  {
    name: 'rejects QA checklist docs that omit safe dispatch queue coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering.\n',
    },
    expectedFailure: /Missing QA checklist safe dispatch queue coverage/,
    expectedFailureCount: 12,
  },
  {
    name: 'rejects QA checklist docs that omit safe dispatch code-span coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering and safe dispatch queue scope.\n',
    },
    expectedFailure: /Missing QA checklist safe dispatch code-span coverage/,
    expectedFailureCount: 11,
  },
  {
    name: 'rejects QA checklist docs that omit CORS-origin allowlist context coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering, safe dispatch queue scope and code-span formatting.\n',
    },
    expectedFailure: /Missing QA checklist CORS-origin allowlist context coverage/,
    expectedFailureCount: 10,
  },
  {
    name: 'rejects a missing active lane ledger',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        /\nActive lane ledger \(current controller occupancy\):\n\n(?:- .+\n){6}/,
        '\n',
      ),
    },
    expectedFailure: /Missing active lane ledger heading/,
    expectedFailureCount: 3,
  },
  {
    name: 'rejects duplicate active lane ledger entries',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- QA infra: available - no active owner in this thread.',
        '- Controller cleanup/docs: available - no active owner in this thread.',
      ),
    },
    expectedFailure: /Duplicate active lane ledger entry: Controller cleanup\/docs/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects duplicate active lane ledger headings in the active section',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Do not resurrect archived session ids from historical notes below.',
        'Active lane ledger (current controller occupancy):\n\n- Web admin: active - current controller owns duplicate ledger check.\n\nDo not resurrect archived session ids from historical notes below.',
      ),
    },
    expectedFailure: /Expected one active lane ledger heading in active handoff section, found 2/,
    expectedFailureCount: 3,
  },
  {
    name: 'rejects active lane ledger entries in the wrong order',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Controller cleanup/docs: available - no active owner in this thread.\n- Desktop UX/a11y: available - no active owner in this thread.',
        '- Desktop UX/a11y: available - no active owner in this thread.\n- Controller cleanup/docs: available - no active owner in this thread.',
      ),
    },
    expectedFailure: /Active lane ledger entry 1 must be Controller cleanup\/docs, found Desktop UX\/a11y/,
    expectedFailureCount: 2,
  },
  {
    name: 'rejects active lane ledger continuation and gap prose before the stop warning',
    overrides: {
      handoff: GOOD_HANDOFF
        .replace(
          '- Controller cleanup/docs: available - no active owner in this thread.',
          '- Controller cleanup/docs: available - no active owner in this thread.\n  - QA infra: active - current controller owns hidden ledger continuation.',
        )
        .replace(
          '\n\nDo not resurrect archived session ids from historical notes below.\nStart from the current workspace state and this top section.\n\n---',
          '\n\nAvailable lanes may self-assign broad work.\n\nDo not resurrect archived session ids from historical notes below.\nFooter prose may widen ownership.\n\n---',
        ),
    },
    expectedFailures: [
      'Indented active lane ledger entry must not masquerade as continuation:   - QA infra: active - current controller owns hidden ledger continuation.',
      'Unexpected active lane ledger gap line: Available lanes may self-assign broad work.',
      'Unexpected active lane ledger footer line: Footer prose may widen ownership.',
      'Expected exactly one current-workspace handoff footer after stop warning, found 0',
    ],
  },
  {
    name: 'rejects multiple active lane ledger owners',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Desktop UX/a11y: available - no active owner in this thread.',
        '- Desktop UX/a11y: active - current controller owns desktop polish follow-up.',
      ),
    },
    expectedFailure: /Expected exactly one active lane ledger entry, found 2/,
  },
  {
    name: 'rejects active lane ledgers with non-Web active owner',
    overrides: {
      handoff: GOOD_HANDOFF
        .replace(
          '- Controller cleanup/docs: available - no active owner in this thread.',
          '- Controller cleanup/docs: active - current controller owns handoff hygiene, QA checklist, README, and changelog notes.',
        )
        .replace(
          '- Web admin: active - current controller owns Web admin QA, a11y, and documentation.',
          '- Web admin: available - no active owner in this thread.',
        ),
    },
    expectedFailures: ['Active lane ledger must keep Web admin active, found Controller cleanup/docs'],
  },
  {
    name: 'rejects non-ledger active lane mentions',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Desktop polish continued while current active lane: Desktop UX/a11y.\n- QA note says active lane = Desktop UX/a11y.\n- QA note says active-lane = Desktop UX/a11y.\n- QA note says active lane is currently `Desktop UX/a11y`.\n- Desktop UX/a11y remains the active lane.\n- Desktop UX/a11y active lane is not owned here.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailures: [
      'Active handoff mentions non-ledger active lane Desktop UX/a11y while ledger active lane is Web admin: - Desktop polish continued while current active lane: Desktop UX/a11y.',
      'Active handoff mentions non-ledger active lane Desktop UX/a11y while ledger active lane is Web admin: - QA note says active lane = Desktop UX/a11y.',
      'Active handoff mentions non-ledger active lane Desktop UX/a11y while ledger active lane is Web admin: - QA note says active-lane = Desktop UX/a11y.',
      'Active handoff mentions non-ledger active lane Desktop UX/a11y while ledger active lane is Web admin: - QA note says active lane is currently `Desktop UX/a11y`.',
      'Active handoff mentions non-ledger active lane Desktop UX/a11y while ledger active lane is Web admin: - Desktop UX/a11y remains the active lane.',
      'Active handoff mentions non-ledger active lane Desktop UX/a11y while ledger active lane is Web admin: - Desktop UX/a11y active lane is not owned here.',
    ],
  },
  {
    name: 'rejects non-ledger active lane mentions when a prose ledger phrase appears first',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Prose only: Active lane ledger (current controller occupancy): still documented while the active Desktop UX/a11y lane is not owned here.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Active handoff mentions non-ledger active lane Desktop UX\/a11y while ledger active lane is Web admin/,
  },
  {
    name: 'rejects ambiguous active controller lane wording',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- QA infra hardening continued under the active controller lane.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailure: /Active handoff must not use ambiguous active controller lane\/pass wording/,
  },
  {
    name: 'rejects available lane ledger entries with owner text',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Desktop UX/a11y: available - no active owner in this thread.',
        '- Desktop UX/a11y: available - current desktop worker is preparing a polish pass.',
      ),
    },
    expectedFailures: [
      'Available lane ledger entry Desktop UX/a11y must stay ownerless: current desktop worker is preparing a polish pass.',
    ],
  },
  {
    name: 'rejects available lane ledger ownerless wording without the period',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Desktop UX/a11y: available - no active owner in this thread.',
        '- Desktop UX/a11y: available - no active owner in this thread',
      ),
    },
    expectedFailures: [
      'Available lane ledger entry Desktop UX/a11y must stay ownerless: no active owner in this thread',
    ],
  },
  {
    name: 'rejects active lane ledger entries that point at stale controller context',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Web admin: active - current controller owns Web admin QA, a11y, and documentation.',
        '- Web admin: active - current controller owns all services and retired thread follow-up.',
      ),
    },
    expectedFailures: [
      'Active handoff must reserve stale session wording for the stop warning: - Web admin: active - current controller owns all services and retired thread follow-up.',
      'Active lane ledger entry Web admin must not use broad ownership scope: current controller owns all services and retired thread follow-up.',
      'Active lane ledger entry Web admin must not point at stale controller context: current controller owns all services and retired thread follow-up.',
    ],
  },
  {
    name: 'rejects active lane ledger entries that mention other lanes',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Web admin: active - current controller owns Web admin QA, a11y, and documentation.',
        '- Web admin: active - current controller owns Desktop UX/a11y polish.',
      ),
    },
    expectedFailures: [
      'Active lane ledger entry Web admin must not mention non-active lane Desktop UX/a11y: current controller owns Desktop UX/a11y polish.',
    ],
  },
  {
    name: 'rejects active lane ledger entries that mention other lane code spans',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        '- Web admin: active - current controller owns Web admin QA, a11y, and documentation.',
        '- Web admin: active - current controller owns `apps/mobile/src/App.tsx` follow-up.',
      ),
    },
    expectedFailures: [
      'Active lane ledger entry Web admin must not mention out-of-lane code span apps/mobile/src/App.tsx: current controller owns `apps/mobile/src/App.tsx` follow-up.',
    ],
  },
  {
    name: 'rejects QA checklist docs that omit active lane ledger coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering and safe dispatch queue scope.\n',
    },
    expectedFailure: /Missing QA checklist active lane ledger coverage/,
    expectedFailureCount: 11,
  },
  {
    name: 'rejects QA checklist docs that omit duplicate active coordination coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering, safe dispatch queue scope, and active lane ledger ownership.\n',
    },
    expectedFailures: [
      'Missing QA checklist safe dispatch code-span coverage',
      'Missing QA checklist non-ledger active lane wording coverage',
      'Missing QA checklist duplicate active coordination coverage',
      'Missing QA checklist available lane ownerless coverage',
      'Missing QA checklist archived session reference coverage',
      'Missing QA checklist self-test count coverage',
      'Missing QA checklist git metadata caveat coverage',
      'Missing QA checklist production-source no-aria-label guard coverage',
      'Missing QA checklist CORS-origin allowlist context coverage',
      'Missing QA checklist active handoff mojibake coverage',
    ],
  },
  {
    name: 'rejects QA checklist docs that omit non-ledger active lane wording coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering, safe dispatch queue scope, active lane ledger ownership, available lane ownerless wording, duplicate active coordination blocks.\n',
    },
    expectedFailure: /Missing QA checklist non-ledger active lane wording coverage/,
    expectedFailureCount: 8,
  },
  {
    name: 'rejects QA checklist docs that omit available lane ownerless coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering, safe dispatch queue scope, active lane ledger ownership, and duplicate active coordination blocks.\n',
    },
    expectedFailure: /Missing QA checklist available lane ownerless coverage/,
    expectedFailureCount: 9,
  },
  {
    name: 'rejects raw old-session UUIDs in the active top section',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active lane note: retired session context must not resume 019e55bc-3dbf-78f3-8461-624a01b7825b from this controller thread.\n- Active lane note: archived Codex session context must not be followed here.\n- Active lane note: historical session context must not be followed here.\n- Active lane note: archived rollout context must not be followed here.\n- Active lane note: retired controller thread must not be followed here.\n- Active lane note: retired/stale sessions must not be followed here.\n- Active lane note: archived\u2011session context must not be followed here.\n- Active lane note: session is archived and must not be followed here.\n- Active lane note: session remains retired and must not be followed here.\n- Active lane note: 历史会话上下文仍在活动说明里。\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailures: [
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: retired session context must not resume 019e55bc-3dbf-78f3-8461-624a01b7825b from this controller thread.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: archived Codex session context must not be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: historical session context must not be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: archived rollout context must not be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: retired controller thread must not be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: retired/stale sessions must not be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: archived\u2011session context must not be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: session is archived and must not be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: session remains retired and must not be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: 历史会话上下文仍在活动说明里。',
      'Retired archived session id must stay out of live handoff text: - Active lane note: retired session context must not resume 019e55bc-3dbf-78f3-8461-624a01b7825b from this controller thread.',
      'Archived session/rollout reference must stay below first handoff separator: - Active lane note: retired session context must not resume 019e55bc-3dbf-78f3-8461-624a01b7825b from this controller thread.',
      'Archived session/rollout reference must be labeled archived and historical only: - Active lane note: retired session context must not resume 019e55bc-3dbf-78f3-8461-624a01b7825b from this controller thread.',
    ],
  },
  {
    name: 'rejects prior session lifecycle prose in the active top section',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Active lane note: prior session restore path is reopened here.\n- Active lane note: continue prior session context here.\n- Active lane note: pick up retired thread lane here.\n- Active lane note: historical session context should be followed here.\n- Active lane note: inherit stale controller pass here.\n- Active lane note: base on prior session context here.\n- Active lane note: derive from historical session context here.\n- Active lane note: handover from retired thread lane here.\n- Active lane note: copy previous rollout context here.\n- Active lane note: delegate from stale controller pass here.\n- Active lane note: transfer obsolete controller pass here.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailures: [
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: prior session restore path is reopened here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: continue prior session context here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: pick up retired thread lane here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: historical session context should be followed here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: inherit stale controller pass here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: base on prior session context here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: derive from historical session context here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: handover from retired thread lane here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: copy previous rollout context here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: delegate from stale controller pass here.',
      'Active handoff must reserve stale session wording for the stop warning: - Active lane note: transfer obsolete controller pass here.',
    ],
  },
  {
    name: 'rejects active CJK lifecycle archived-session prose',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- 控制器备注：禁止重启历史会话上下文。\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
    },
    expectedFailures: [
      'Unexpected near-duplicate do-not-resurrect archived session warning:  / - 控制器备注：禁止重启历史会话上下文。',
      'Unexpected near-duplicate do-not-resurrect archived session warning: - 控制器备注：禁止重启历史会话上下文。',
      'Active handoff must reserve stale session wording for the stop warning: - 控制器备注：禁止重启历史会话上下文。',
    ],
  },
  {
    name: 'rejects real old-session UUIDs in historical-only handoff text',
    overrides: {
      handoff: GOOD_HANDOFF.replaceAll(FIXTURE_ARCHIVED_SESSION_ID, '019E55BC-3DBF-78F3-8461-624A01B7825B'),
    },
    expectedFailures: [
      'Retired archived session id must stay out of live handoff text: **Archived Codex session reference (historical only):** `019E55BC-3DBF-78F3-8461-624A01B7825B`',
      'Retired archived session id must stay out of live handoff text: **Archived rollout file (historical only):** `~/.codex/sessions/2026/05/24/rollout-2026-05-24T00-47-40-019E55BC-3DBF-78F3-8461-624A01B7825B.jsonl`',
    ],
  },
  {
    name: 'rejects archived session references without historical-only labeling',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        `**Archived Codex session reference (historical only):** \`${FIXTURE_ARCHIVED_SESSION_ID}\``,
        `**Codex session reference:** \`${FIXTURE_ARCHIVED_SESSION_ID}\``,
      ),
    },
    expectedFailure: /Archived session\/rollout reference must be labeled archived and historical only/,
  },
  {
    name: 'rejects QA checklist docs that omit archived session reference coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering, safe dispatch queue scope, active lane ledger ownership, available lane ownerless wording, duplicate active coordination blocks, and self-test count drift.\n',
    },
    expectedFailure: /Missing QA checklist archived session reference coverage/,
    expectedFailureCount: 7,
  },
  {
    name: 'rejects QA checklist docs that omit self-test count coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering, safe dispatch queue scope, active lane ledger ownership, available lane ownerless wording, duplicate active coordination blocks, and archived session reference labeling.\n',
    },
    expectedFailure: /Missing QA checklist self-test count coverage/,
    expectedFailureCount: 7,
  },
  {
    name: 'rejects QA checklist docs that omit git metadata caveat coverage',
    overrides: {
      qaChecklist: '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering, safe dispatch queue scope, active lane ledger ownership, available lane ownerless wording, duplicate active coordination blocks, archived session reference labeling, and self-test count drift.\n',
    },
    expectedFailure: /Missing QA checklist git metadata caveat coverage/,
    expectedFailureCount: 6,
  },
  {
    name: 'rejects QA checklist docs that omit production source no-aria-label guard coverage',
    overrides: {
      qaChecklist: GOOD_QA_CHECKLIST.replace(/, production-source no-`aria-label` unit guard coverage/, ''),
    },
    expectedFailure: /Missing QA checklist production-source no-aria-label guard coverage/,
  },
  {
    name: 'rejects QA checklist docs that omit active handoff mojibake coverage',
    overrides: {
      qaChecklistBytes: Buffer.concat([
        Buffer.from(
          '# JoeSSH QA Checklist\n\n- Controller handoff hygiene is checked with `npm run qa:handoff-hygiene`, including active task-card numbering, safe dispatch queue scope, active lane ledger ownership, available lane ownerless wording, duplicate active coordination blocks, archived session reference labeling, self-test count drift, and the `.git` metadata caveat. Invalid bytes: ',
        ),
        Buffer.from([0xe9, 0x94, 0x3f]),
        Buffer.from('\n'),
      ]),
    },
    expectedFailures: [
      'docs/qa-checklist.md must be valid UTF-8',
      'Missing QA checklist safe dispatch code-span coverage',
      'Missing QA checklist non-ledger active lane wording coverage',
      'Missing QA checklist production-source no-aria-label guard coverage',
      'Missing QA checklist CORS-origin allowlist context coverage',
      'Missing QA checklist active handoff mojibake coverage',
    ],
  },
  {
    name: 'rejects stale handoff hygiene self-test counts',
    overrides: {
      handoff: GOOD_HANDOFF.replace(
        GOOD_HANDOFF_HYGIENE_EVIDENCE,
        '`node --test scripts/check-handoff-hygiene.test.mjs` (1/1)',
      ),
      hygieneTestSource:
        "test('one', () => {});\nfor (const { name, overrides, expectedFailure } of [\n  {\n    name: 'two',\n  },\n]) {\n  test(name, () => {});\n}\n",
    },
    expectedFailures: [
      'Handoff hygiene self-test count for node --test scripts/check-handoff-hygiene.test.mjs is 1/1, expected 2/2',
      'Missing handoff hygiene live-scan count in top handoff verification',
    ],
  },
  {
    name: 'rejects stale handoff hygiene live-scan command counts',
    overrides: {
      handoff: withHandoffHygieneEvidence(GOOD_HANDOFF, 2, 1).replace(
        'Safe next dispatch queue (choose non-overlapping write scopes):',
        '- Loose handoff hygiene rerun evidence: 1/1.\n\nSafe next dispatch queue (choose non-overlapping write scopes):',
      ),
      hygieneTestSource:
        "test('one', () => {});\nfor (const { name, overrides, expectedFailure } of [\n  {\n    name: 'two',\n  },\n]) {\n  test(name, () => {});\n}\n",
    },
    expectedFailures: [
      'Handoff hygiene self-test count for npm run qa:handoff-hygiene is 1/1, expected 2/2',
      'Loose handoff hygiene count is 1/1, expected 2/2: - Loose handoff hygiene rerun evidence: 1/1.',
    ],
  },
  {
    name: 'rejects stale handoff hygiene prose self-test counts',
    overrides: {
      handoff: withHandoffHygieneEvidence(GOOD_HANDOFF, 2).replace(
        '- Controller audit:',
        '- Controller verifier passed with `node:test` self-tests (1/1) plus the live handoff scan.\n- Controller audit:',
      ),
      hygieneTestSource:
        "test('one', () => {});\nfor (const { name, overrides, expectedFailure } of [\n  {\n    name: 'two',\n  },\n]) {\n  test(name, () => {});\n}\n",
    },
    expectedFailures: ['Handoff hygiene self-test count for node:test prose is 1/1, expected 2/2'],
  },
  {
    name: 'rejects failing E2E last-run metadata',
    overrides: {
      lastRun: { status: 'failed' },
    },
    expectedFailure: /E2E last-run status is "failed"/,
    expectedFailureCount: 1,
  },
]) {
  test(name, (t) => {
    const root = createFixture(t, overrides);
    const failures = checkHandoffHygiene(root);

    if (expectedFailures) {
      assert.deepEqual(failures, expectedFailures);
      return;
    }

    assert.match(failures.join('\n'), expectedFailure);
    assert.equal(failures.length, expectedFailureCount ?? 1, failures.join('\n'));
  });
}






