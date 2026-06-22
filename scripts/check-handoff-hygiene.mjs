#!/usr/bin/env node

/**
 * Controller handoff hygiene checker.
 *
 * Keeps the long-running controller thread from drifting back into stale
 * resume instructions, ambiguous "latest" sections, or unsafe broad dispatch
 * guidance.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { TextDecoder } from 'node:util';

function requireMatch(failures, label, text, pattern) {
  if (!pattern.test(text)) {
    failures.push(`Missing ${label}`);
  }
}

function forbidMatch(failures, label, text, pattern) {
  const match = pattern.exec(text);
  if (match) {
    failures.push(`Forbidden ${label}: ${JSON.stringify(match[0])}`);
  }
}

const SAFE_DISPATCH_LANES = [
  {
    lane: 'Controller cleanup/docs',
    scope: /HANDOFF\.md.*docs\/qa-checklist\.md.*README\.md.*CHANGELOG\.md/,
    codeSpans: ['HANDOFF.md', 'docs/qa-checklist.md', 'README.md', 'CHANGELOG.md'],
  },
  {
    lane: 'Desktop UX/a11y',
    scope: /apps\/desktop\/src\/\*.*packages\/i18n\/src\/\*.*tests\/e2e\/specs\/desktop-\*/,
    codeSpans: ['apps/desktop/src/*', 'packages/i18n/src/*', 'tests/e2e/specs/desktop-*'],
  },
  {
    lane: 'Web admin',
    scope: /apps\/web\/src\/\*.*tests\/e2e\/specs\/web-\*.*docs\/sync-api\.md/,
    codeSpans: ['apps/web/src/*', 'tests/e2e/specs/web-*', 'docs/sync-api.md'],
  },
  {
    lane: 'Mobile companion',
    scope: /apps\/mobile\/\*.*mobile service\/model tests/,
    codeSpans: ['apps/mobile/*'],
  },
  {
    lane: 'Sync service/core engine',
    scope: /services\/sync\/\*.*crates\/\*/,
    codeSpans: ['services/sync/*', 'crates/*'],
  },
  {
    lane: 'QA infra',
    scope: /tests\/e2e\/playwright\*\.config\.ts.*tests\/e2e\/scripts\/\*.*scripts\/\*.*\.github\/workflows\/\*/,
    codeSpans: ['tests/e2e/playwright*.config.ts', 'tests/e2e/scripts/*', 'scripts/*', '.github/workflows/*'],
  },
];

const STRICT_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

function isDisallowedTextControlCharacter(codePoint) {
  return codePoint !== undefined && ((codePoint >= 0x00 && codePoint <= 0x08) || codePoint === 0x0b || codePoint === 0x0c || (codePoint >= 0x0e && codePoint <= 0x1f) || (codePoint >= 0x7f && codePoint <= 0x9f));
}

function isDisallowedTextFormatCharacter(codePoint, offset) {
  if (codePoint === undefined || (offset === 0 && codePoint === 0xfeff)) {
    return false;
  }

  return /\p{Cf}/u.test(String.fromCodePoint(codePoint));
}

function getLineAndColumn(text, offset) {
  const prefix = text.slice(0, offset);
  const line = prefix.split(/\r?\n/).length;
  const lastLineBreakIndex = Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('\r'));
  return {
    line,
    column: offset - lastLineBreakIndex,
  };
}

function collectDisallowedControlCharacterFailures(failures, text, label) {
  for (let offset = 0; offset < text.length; offset += 1) {
    const rawCodePoint = text.codePointAt(offset);
    if (!isDisallowedTextControlCharacter(rawCodePoint)) {
      continue;
    }
    const { line, column } = getLineAndColumn(text, offset);
    const codePoint = (rawCodePoint ?? 0).toString(16).toUpperCase().padStart(4, '0');
    failures.push(`${label} must not contain control character U+${codePoint} at line ${line}, column ${column}`);
  }
}

function collectDisallowedFormatCharacterFailures(failures, text, label) {
  for (let offset = 0; offset < text.length; offset += 1) {
    const rawCodePoint = text.codePointAt(offset);
    if (!isDisallowedTextFormatCharacter(rawCodePoint, offset)) {
      continue;
    }
    const { line, column } = getLineAndColumn(text, offset);
    const codePoint = (rawCodePoint ?? 0).toString(16).toUpperCase().padStart(4, '0');
    failures.push(`${label} must not contain format character U+${codePoint} at line ${line}, column ${column}`);
  }
}

function readUtf8File(failures, path, label) {
  const buffer = readFileSync(path);
  try {
    STRICT_UTF8_DECODER.decode(buffer);
  } catch {
    failures.push(`${label} must be valid UTF-8`);
  }

  const text = buffer.toString('utf-8');
  collectDisallowedControlCharacterFailures(failures, text, label);
  collectDisallowedFormatCharacterFailures(failures, text, label);
  return text;
}

const POLICY_TERM_BOUNDARY_PATTERN = String.raw`(?![\p{L}\p{N}])`;
const POLICY_TERM_LEFT_BOUNDARY_PATTERN = String.raw`(?<![\p{L}\p{N}])`;
const POLICY_TERM_SEPARATOR_PATTERN = String.raw`[-_./:;|\\\s\u2010-\u2015\u2212]*`;

const WHITELIST_TERMINOLOGY_PATTERN = new RegExp(
  [
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}white${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`\u767d${POLICY_TERM_SEPARATOR_PATTERN}\u540d${POLICY_TERM_SEPARATOR_PATTERN}[\u5355\u55ae]`,
  ].join('|'),
  'iu',
);

const BLOCKLIST_ALTERNATE_TERMINOLOGY_PATTERN = new RegExp(
  [
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}black${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:ban|banned|banning)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:bar|barred|barring)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}deny${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:disallow|disallowed|disallowing)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:exclude|excluded|excluding|exclusion)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:forbid|forbidden|forbidding)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:prohibit|prohibited|prohibiting|prohibition)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:refuse|refused|refusing|refusal)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}reject(?:ion)?${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:revoke|revoked|revoking|revocation)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:suspend|suspended|suspending|suspension)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:quarantine|quarantined|quarantining)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:restrict|restricted|restricting|restriction)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`\u9ed1${POLICY_TERM_SEPARATOR_PATTERN}\u540d${POLICY_TERM_SEPARATOR_PATTERN}[\u5355\u55ae]`,
  ].join('|'),
  'iu',
);

const ALLOWLIST_TERMINOLOGY_PATTERN = new RegExp(
  [
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}allow${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}accept${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}admit${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:consent|consented|consenting)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:validat(?:e|ed|ing|ion)|verif(?:y|ied|ying|ication)|certif(?:y|ied|ying|ication))${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:approve|approved|approving|approval)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}green${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}trust(?:ed)?${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:permit|permitted|permitting|(?<!role-)permissions?)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}safe${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}authori[sz](?:e|ed|ing|ation|ations)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:grant|granted|granting)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:clear|cleared|clearing|clearance)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:include|included|including|inclusion)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}access${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}privileg(?:e|ed|ing)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:eligible|eligibility)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:except|excepted|exception)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:exempt|exempted|exemption)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`${POLICY_TERM_LEFT_BOUNDARY_PATTERN}(?:bypass|bypassed|bypassing)${POLICY_TERM_SEPARATOR_PATTERN}list(?:ed|ing|s)?${POLICY_TERM_BOUNDARY_PATTERN}`,
    String.raw`\u5141${POLICY_TERM_SEPARATOR_PATTERN}\u8bb8${POLICY_TERM_SEPARATOR_PATTERN}(?:\u5217${POLICY_TERM_SEPARATOR_PATTERN}\u8868|\u540d${POLICY_TERM_SEPARATOR_PATTERN}\u5355)`,
    String.raw`\u5141${POLICY_TERM_SEPARATOR_PATTERN}\u8a31${POLICY_TERM_SEPARATOR_PATTERN}(?:\u6e05${POLICY_TERM_SEPARATOR_PATTERN}\u55ae|\u540d${POLICY_TERM_SEPARATOR_PATTERN}\u55ae)`,
  ].join('|'),
  'iu',
);
const CORS_ORIGIN_ALLOWLIST_CONTEXT_PATTERN =
  /\b(?:exact(?:\s+English)?\s+)?(?:CORS|ATLASTERM_SYNC_CORS)[-_\s\u2010-\u2015]+origin\s+`?allowlist`?\s+(?:context|carve[-_\s\u2010-\u2015]+out|policy\s+language)\b|\blegitimate\s+Sync\s+CORS[-_\s\u2010-\u2015]+origin\s+`?allowlist`?\s+wording\b|\b(?:CORS|ATLASTERM_SYNC_CORS)[-_\s\u2010-\u2015]+origin\s+`?allowlist`?\s+wording\s+is\s+legitimate\s+policy\s+language\b/gi;

const RETIRED_ARCHIVED_SESSION_ID = '019e55bc-3dbf-78f3-8461-624a01b7825b';
const HANDOFF_HYGIENE_TEST_SCRIPT = 'node --test scripts/check-handoff-hygiene.test.mjs';
const HANDOFF_HYGIENE_QA_SCRIPT = 'npm run test:handoff-hygiene && node scripts/check-handoff-hygiene.mjs';
const TASK_CARD_PREFIX_PATTERN = String.raw`(?:[Tt]|\uFF34|\uFF54|\u03A4|\u03C4|\u0422|\u0442)`;
const TASK_CARD_DIGIT_PATTERN = String.raw`(?:\p{Nd}|[\u00B2\u00B3\u00B9\u2070-\u2079\u2080-\u2089])`;
const HANDOFF_SEPARATOR_PATTERN = /\r?\n[ \t]*---[ \t]*\r?\n/g;
const PRIOR_CONTINUATION_HEADING_PATTERN = /^## Prior continuation state\b/m;
const PRIOR_CONTINUATION_HEADING_SCAN_PATTERN = /^## Prior continuation state\b/gm;
const DO_NOT_RESURRECT_WARNING = 'Do not resurrect archived session ids from historical notes below.';
const CURRENT_WORKSPACE_START_LINE = 'Start from the current workspace state and this top section.';

function containsNonAscii(text) {
  return [...text].some((character) => (character.codePointAt(0) ?? 0) > 0x7f);
}

const SCOPE_SEPARATOR_PATTERN = String.raw`[-_\s\u2010-\u2015]+`;
const ACTIVE_ARCHIVAL_CONTEXT_QUALIFIER_PATTERN = String.raw`(?:archived|closed|historical|legacy|old|obsolete|previous|prior|retired|stale|superseded)`;
const ACTIVE_ARCHIVAL_CONTEXT_NOUN_PATTERN = String.raw`(?:controllers?|contexts?|lanes?|passes?|rollouts?|sessions?|threads?)`;
const ACTIVE_ARCHIVAL_LIFECYCLE_VERB_PATTERN = String.raw`(?:adopt|adopted|base|based|borrow|borrowed|carry${SCOPE_SEPARATOR_PATTERN}forward|continue|continued|copy|copied|delegate|delegated|derive|derived|follow|followed|graft|grafted|hand${SCOPE_SEPARATOR_PATTERN}off|handed${SCOPE_SEPARATOR_PATTERN}off|hand${SCOPE_SEPARATOR_PATTERN}over|handed${SCOPE_SEPARATOR_PATTERN}over|handover|inherit|inherited|mirror|mirrored|pick${SCOPE_SEPARATOR_PATTERN}up|restore|restored|reopen|reopened|restart|restarted|resurrect|resurrected|resume|resumed|revive|revived|revival|reuse|reused|take${SCOPE_SEPARATOR_PATTERN}from|take${SCOPE_SEPARATOR_PATTERN}over|transfer|transferred)`;
const BROAD_FILESYSTEM_SCOPE_PATTERN = String.raw`directories|directory|dirs?|folders?|files?|paths?`;
const BROAD_REPOSITORY_SCOPE_PATTERN = String.raw`repos?|repository|repositories`;
const BROAD_TEST_SCOPE_PATTERN = String.raw`tests?|test${SCOPE_SEPARATOR_PATTERN}suites?|specs?|suites?`;
const BROAD_COORDINATION_SCOPE_PATTERN = String.raw`lanes?|workstreams?`;
const BROAD_PRODUCT_SURFACE_SCOPE_PATTERN = String.raw`apis?|endpoints?|features?|pages?|routes?|screens?|surfaces?|views?`;
const BROAD_UI_SURFACE_SCOPE_PATTERN = String.raw`alerts?|buttons?|cards?|controls?|dialogs?|forms?|lists?|menus?|modals?|nav(?:igation)?|panels?|sidebars?|tables?|toasts?|toolbars?`;
const BROAD_DATA_CONFIG_SCOPE_PATTERN = String.raw`caches?|configs?|configurations?|columns?|databases?|datasets?|environments?|preferences?|queues?|records?|rows?|schemas?|secrets?|settings?|stores?|storage|variables?|vars?`;
const BROAD_CONTENT_RESOURCE_SCOPE_PATTERN = String.raw`assets?|artifacts?|bundles?|content|docs?|documentation|guides?|icons?|images?|manuals?|media|resources?|screenshots?|styles?|themes?`;
const BROAD_SCOPE_NOUN_PATTERN = String.raw`code|${BROAD_FILESYSTEM_SCOPE_PATTERN}|${BROAD_REPOSITORY_SCOPE_PATTERN}|workspaces?|codebases?|projects?|apps?|packages?|modules?|components?|services?|sources?|trees?|${BROAD_PRODUCT_SURFACE_SCOPE_PATTERN}|${BROAD_UI_SURFACE_SCOPE_PATTERN}|${BROAD_DATA_CONFIG_SCOPE_PATTERN}|${BROAD_CONTENT_RESOURCE_SCOPE_PATTERN}|${BROAD_TEST_SCOPE_PATTERN}|${BROAD_COORDINATION_SCOPE_PATTERN}`;
const BROAD_SCOPE_ARTICLE_PATTERN = String.raw`(?:the${SCOPE_SEPARATOR_PATTERN})?`;
const BROAD_QUANTIFIER_SCOPE_PATTERN = String.raw`assorted|both|many|mixed|multiple|numerous|several|various`;
const BROAD_QUANTIFIER_CONNECTOR_PATTERN = String.raw`(?:${SCOPE_SEPARATOR_PATTERN}(?:of|separate|different|distinct|parallel|concurrent))*`;
const BROAD_COUNT_SCOPE_PATTERN = String.raw`(?:1(?:(?:\+)|${SCOPE_SEPARATOR_PATTERN}(?:plus|or${SCOPE_SEPARATOR_PATTERN}more))|[2-9]\d*(?:(?:\+)|${SCOPE_SEPARATOR_PATTERN}(?:plus|or${SCOPE_SEPARATOR_PATTERN}more))?|one${SCOPE_SEPARATOR_PATTERN}(?:plus|or${SCOPE_SEPARATOR_PATTERN}more)|(?:(?:a|one)${SCOPE_SEPARATOR_PATTERN})?(?:couple|pair)(?:${SCOPE_SEPARATOR_PATTERN}(?:plus|or${SCOPE_SEPARATOR_PATTERN}more))?|(?:two|three|four|five|six|seven|eight|nine|ten|dozen)(?:${SCOPE_SEPARATOR_PATTERN}(?:plus|or${SCOPE_SEPARATOR_PATTERN}more))?)`;
const BROAD_COUNT_CONNECTOR_PATTERN = String.raw`(?:${SCOPE_SEPARATOR_PATTERN}(?:of|separate|different|distinct|parallel|concurrent))*`;
const BROAD_LOWER_BOUND_SCOPE_PATTERN = String.raw`(?:at${SCOPE_SEPARATOR_PATTERN}least|more${SCOPE_SEPARATOR_PATTERN}than|greater${SCOPE_SEPARATOR_PATTERN}than|no${SCOPE_SEPARATOR_PATTERN}fewer${SCOPE_SEPARATOR_PATTERN}than|minimum${SCOPE_SEPARATOR_PATTERN}of|over)`;
const BROAD_LOWER_BOUND_COUNT_PATTERN = String.raw`(?:[1-9]\d*|one|two|three|four|five|six|seven|eight|nine|ten|dozen|(?:(?:a|one)${SCOPE_SEPARATOR_PATTERN})?(?:couple|pair))`;
const BROAD_TRAVERSAL_SCOPE_PATTERN = String.raw`(?:among|amongst|around|between|inside|through|throughout|within)`;
const BROAD_ACTION_SCOPE_PATTERN = String.raw`(?:add|adds|adding|adjust|adjusts|adjusting|audit|audits|auditing|baseline|baselines|baselining|build|builds|building|change|changes|changing|check|checks|checking|clean${SCOPE_SEPARATOR_PATTERN}up|cleanup|cleanups|cleaning${SCOPE_SEPARATOR_PATTERN}up|configure|configures|configuring|create|creates|creating|delete|deletes|deleting|deliver|delivers|delivering|deploy|deploys|deploying|develop|develops|developing|document|documents|documenting|edit|edits|editing|enhance|enhances|enhancing|fix|fixes|fixing|harden|hardens|hardening|implement|implements|implementing|improve|improves|improving|inspect|inspects|inspecting|integrate|integrates|integrating|instrument|instruments|instrumenting|localize|localizes|localizing|maintain|maintains|maintaining|migrate|migrates|migrating|modernize|modernizes|modernizing|modify|modifies|modifying|optimize|optimizes|optimizing|patch|patches|patching|polish|polishes|polishing|publish|publishes|publishing|refactor|refactors|refactoring|release|releases|releasing|remove|removes|removing|repair|repairs|repairing|review|reviews|reviewing|revise|revises|revising|rewrite|rewrites|rewriting|secure|secures|securing|ship|ships|shipping|stabilize|stabilizes|stabilizing|sweep|sweeps|sweeping|test|tests|testing|touch|touches|touching|translate|translates|translating|tune|tunes|tuning|update|updates|updating|upgrade|upgrades|upgrading|validate|validates|validating|verify|verifies|verifying|wire|wires|wiring)`;
const BROAD_ACTION_NOUN_SCOPE_PATTERN = String.raw`(?:additions?|audits?|builds?|checks?|clean(?:${SCOPE_SEPARATOR_PATTERN})?ups?|configurations?|creations?|deletions?|deliveries|deployments?|developments?|documentation|documents?|enhancements?|fix(?:es)?|hardenings?|implementations?|improvements?|inspections?|instrumentation|integrations?|localizations?|maintenance|migrations?|modernizations?|optimizations?|patch(?:es)?|polish(?:es)?|publications?|releases?|removals?|repairs?|reviews?|security${SCOPE_SEPARATOR_PATTERN}fix(?:es)?|stabilizations?|test(?:s|ing)?|translations?|upgrades?|validations?|verifications?|wirings?)`;
const BROAD_CONTROL_SCOPE_PATTERN = String.raw`(?:allocate|allocates|allocating|assign|assigns|assigning|coordinate|coordinates|coordinating|cover|covers|covering|delegate|delegates|delegating|direct|directs|directing|drive|drives|driving|govern|governs|governing|handle|handles|handling|lead|leads|leading|manage|manages|managing|orchestrate|orchestrates|orchestrating|own|owns|owning|oversee|oversees|overseeing|route|routes|routing|steer|steers|steering|supervise|supervises|supervising)`;
const BROAD_OPERATION_SCOPE_PATTERN = String.raw`(?:operate|operates|operating|work|works|working)${SCOPE_SEPARATOR_PATTERN}(?:in|on|over)`;
const BROAD_ACTION_TARGET_SCOPE_PATTERN = String.raw`(?:(?:${BROAD_ACTION_SCOPE_PATTERN})|(?:${BROAD_ACTION_NOUN_SCOPE_PATTERN})|adjustments?|modifications?|revisions?)${SCOPE_SEPARATOR_PATTERN}(?:for|in|on|to|of)`;
const BROAD_RESPONSIBILITY_SCOPE_PATTERN = String.raw`(?:(?:accountability|responsibility|accountable|responsible)${SCOPE_SEPARATOR_PATTERN}for|(?:allocation|assignment|coordination|delegation|leadership|ownership|oversight|routing|stewardship)${SCOPE_SEPARATOR_PATTERN}of)`;
const BROAD_SCOPE_ACTION_NOUN_PATTERN = String.raw`(?:(?:${BROAD_ACTION_NOUN_SCOPE_PATTERN})|adjustments?|changes?|edits?|modifications?|refactors?|revisions?|rewrites?|updates?)`;
const BROAD_AGGREGATE_SCOPE_PATTERN = String.raw`(?:(?:a|an)${SCOPE_SEPARATOR_PATTERN})?(?:batches|batch|bundles?|clusters?|collections?|groups?|lists?|ranges?|series|sets?|variet(?:y|ies))${SCOPE_SEPARATOR_PATTERN}of`;
const BROAD_PROCESS_SCOPE_PATTERN = String.raw`(?:(?:(?:clean${SCOPE_SEPARATOR_PATTERN}up|cleanup|hardening|maintenance|migration|qa|release|review)${SCOPE_SEPARATOR_PATTERN})?(?:baselines?|pass(?:es)?|rounds?|sweeps?))`;

const BROAD_SAFE_DISPATCH_SCOPE_PATTERN = new RegExp(
  [
    String.raw`\b(?:anywhere|everywhere|everything|global|unbounded|unrestricted|unlimited|entire${SCOPE_SEPARATOR_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})|whole${SCOPE_SEPARATOR_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})|(?:monorepo|root|${BROAD_SCOPE_NOUN_PATTERN})${SCOPE_SEPARATOR_PATTERN}(?:wide|spanning)|any${SCOPE_SEPARATOR_PATTERN}(?:code|${BROAD_FILESYSTEM_SCOPE_PATTERN}|${BROAD_REPOSITORY_SCOPE_PATTERN}|codebases?|projects?|trees?|apps?|components?|modules?|packages?|services?|workspaces?|source|${BROAD_PRODUCT_SURFACE_SCOPE_PATTERN}|${BROAD_UI_SURFACE_SCOPE_PATTERN}|${BROAD_DATA_CONFIG_SCOPE_PATTERN}|${BROAD_CONTENT_RESOURCE_SCOPE_PATTERN}|${BROAD_TEST_SCOPE_PATTERN}|${BROAD_COORDINATION_SCOPE_PATTERN})|all${SCOPE_SEPARATOR_PATTERN}(?:(?:app|source)${SCOPE_SEPARATOR_PATTERN}code|${BROAD_FILESYSTEM_SCOPE_PATTERN}|${BROAD_REPOSITORY_SCOPE_PATTERN}|projects?|workspaces?|codebases?|trees?|code|apps?|components?|modules?|source|packages|services?|${BROAD_PRODUCT_SURFACE_SCOPE_PATTERN}|${BROAD_UI_SURFACE_SCOPE_PATTERN}|${BROAD_DATA_CONFIG_SCOPE_PATTERN}|${BROAD_CONTENT_RESOURCE_SCOPE_PATTERN}|${BROAD_TEST_SCOPE_PATTERN}|${BROAD_COORDINATION_SCOPE_PATTERN})|every${SCOPE_SEPARATOR_PATTERN}(?:${BROAD_FILESYSTEM_SCOPE_PATTERN}|${BROAD_REPOSITORY_SCOPE_PATTERN}|workspace|codebase|project|tree|app|component|module|package|service|source|code|api|endpoint|feature|page|route|screen|surface|view|alert|button|card|control|dialog|form|list|menu|modal|nav|navigation|panel|sidebar|table|toast|toolbar|cache|config|configuration|column|database|dataset|environment|preference|queue|record|row|schema|secret|setting|store|storage|variable|var|asset|artifact|bundle|content|doc|documentation|guide|icon|image|manual|media|resource|screenshot|style|theme|lane|workstream|test|test${SCOPE_SEPARATOR_PATTERN}suite|spec|suite)|full${SCOPE_SEPARATOR_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})|across${SCOPE_SEPARATOR_PATTERN}(?:the${SCOPE_SEPARATOR_PATTERN})?(?:${BROAD_SCOPE_NOUN_PATTERN})|no${SCOPE_SEPARATOR_PATTERN}scope${SCOPE_SEPARATOR_PATTERN}limits?|touch${SCOPE_SEPARATOR_PATTERN}whatever)\b`,
    String.raw`\b(?:${BROAD_QUANTIFIER_SCOPE_PATTERN})${BROAD_QUANTIFIER_CONNECTOR_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_AGGREGATE_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_COUNT_SCOPE_PATTERN}${BROAD_COUNT_CONNECTOR_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_LOWER_BOUND_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_LOWER_BOUND_COUNT_PATTERN}${BROAD_COUNT_CONNECTOR_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_TRAVERSAL_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_CONTROL_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_OPERATION_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_ACTION_TARGET_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_RESPONSIBILITY_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_ACTION_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b${BROAD_PROCESS_SCOPE_PATTERN}${SCOPE_SEPARATOR_PATTERN}(?:for|in|on|to|of)${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ARTICLE_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b(?:${BROAD_SCOPE_NOUN_PATTERN})${SCOPE_SEPARATOR_PATTERN}${BROAD_SCOPE_ACTION_NOUN_PATTERN}\b`,
    String.raw`\b(?:${BROAD_SCOPE_NOUN_PATTERN})${SCOPE_SEPARATOR_PATTERN}${BROAD_PROCESS_SCOPE_PATTERN}\b`,
    String.raw`\b(?:cross|multi)${SCOPE_SEPARATOR_PATTERN}(?:${BROAD_SCOPE_NOUN_PATTERN})\b`,
    String.raw`\b(?:${BROAD_SCOPE_NOUN_PATTERN})${SCOPE_SEPARATOR_PATTERN}crossing\b`,
  ].join('|'),
  'i',
);

function normalizeGuardText(text) {
  return text.normalize('NFKC').replace(/[\p{M}\p{Cf}\p{Cc}\uFE0F\u20E3]/gu, '');
}

function normalizeIdentifierText(text) {
  return normalizeGuardText(text)
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .toLowerCase();
}

function codeSpanBelongsToLane(codeSpan, lane) {
  return lane.codeSpans.some((expectedCodeSpan) => {
    if (expectedCodeSpan === codeSpan) {
      return true;
    }

    const pattern = new RegExp(
      `^${expectedCodeSpan
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/\\\*/g, '.*')}$`,
    );
    return pattern.test(codeSpan);
  });
}

function collectBacktickRanges(text) {
  return [...text.matchAll(/`[^`]+`/g)].map((match) => [match.index ?? 0, (match.index ?? 0) + match[0].length]);
}

function isOffsetInsideRanges(offset, ranges) {
  return ranges.some(([start, end]) => offset >= start && offset < end);
}

function collectUnquotedScopePathTokens(scope) {
  const backtickRanges = collectBacktickRanges(scope);
  const pathTokenPattern = /(?:^|[^\p{L}\p{N}_`])((?:\.github|apps|crates|docs|packages|scripts|services|tests)\/[^\s`,;:!?)]*|\b(?:CHANGELOG|HANDOFF|README)\.md\b)/gu;
  const tokens = [];

  for (const match of scope.matchAll(pathTokenPattern)) {
    const tokenStart = (match.index ?? 0) + match[0].indexOf(match[1]);
    if (isOffsetInsideRanges(tokenStart, backtickRanges)) {
      continue;
    }

    const token = match[1].replace(/[.]+$/g, '');
    if (token) {
      tokens.push(token);
    }
  }

  return tokens;
}

function getHandoffSectionInfo(handoff) {
  const separatorMatches = [...handoff.matchAll(HANDOFF_SEPARATOR_PATTERN)];
  const priorHeadingIndex = PRIOR_CONTINUATION_HEADING_PATTERN.exec(handoff)?.index;
  const boundaryIndex = priorHeadingIndex ?? handoff.length;
  const activeSeparatorMatches = separatorMatches.filter((match) => (match.index ?? 0) < boundaryIndex);
  const separatorMatch = activeSeparatorMatches[0];
  const separatorIndex = separatorMatch?.index;
  const separatorEndIndex = separatorMatch && separatorIndex !== undefined ? separatorIndex + separatorMatch[0].length : undefined;
  const separatorGap = separatorEndIndex !== undefined && priorHeadingIndex !== undefined ? handoff.slice(separatorEndIndex, priorHeadingIndex) : '';

  return {
    activeSeparatorCount: activeSeparatorMatches.length,
    hasPriorContinuationHeading: priorHeadingIndex !== undefined,
    historicalStartIndex: separatorMatch && separatorIndex !== undefined ? separatorIndex + separatorMatch[0].length : Number.POSITIVE_INFINITY,
    separatorGap,
    topSection: separatorIndex === undefined ? handoff : handoff.slice(0, separatorIndex),
  };
}

function collectSafeDispatchQueueFailures(failures, topSection) {
  const lines = topSection.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => (/^Safe next dispatch queue \(choose non-overlapping write scopes\):$/.test(line) ? index : -1))
    .filter((index) => index !== -1);
  const headingIndex = headingIndexes[0] ?? -1;

  if (headingIndex === -1) {
    return;
  }

  if (headingIndexes.length > 1) {
    failures.push(`Expected one safe dispatch queue heading in active handoff section, found ${headingIndexes.length}`);
  }

  const queue = [];
  let started = false;
  let currentLane;
  let queueClosed = false;

  for (const line of lines.slice(headingIndex + 1)) {
    if (/^Active lane ledger \(current controller occupancy\):$/.test(line)) {
      break;
    }

    if (!started && line.trim() === '') {
      continue;
    }

    if (queueClosed) {
      if (line.trim() !== '') {
        failures.push(`Unexpected safe dispatch queue gap line: ${line}`);
      }
      continue;
    }

    if (/^- /.test(line)) {
      started = true;
      const match = /^- ([^:]+):\s+(.+)$/.exec(line);
      if (!match) {
        failures.push(`Malformed safe dispatch lane: ${line}`);
        continue;
      }
      currentLane = { lane: match[1], scope: match[2] };
      queue.push(currentLane);
      continue;
    }

    if (started && line.trim() === '') {
      queueClosed = true;
      currentLane = undefined;
      continue;
    }

    if (started && currentLane && /^[ \t]+-\s+/.test(line)) {
      failures.push(`Indented safe dispatch lane must not masquerade as continuation: ${line}`);
      continue;
    }

    if (started && currentLane && /^[ \t]+/.test(line)) {
      currentLane.scope += ` ${line.trim()}`;
      continue;
    }

    if (line.trim() !== '') {
      failures.push(`Unexpected safe dispatch queue line: ${line}`);
    }
  }

  if (queue.length !== SAFE_DISPATCH_LANES.length) {
    failures.push(`Expected ${SAFE_DISPATCH_LANES.length} safe dispatch lanes, found ${queue.length}`);
  }

  const seenLanes = new Map();
  for (const { lane } of queue) {
    seenLanes.set(lane, (seenLanes.get(lane) ?? 0) + 1);
  }

  for (const [lane, count] of seenLanes) {
    if (count > 1) {
      failures.push(`Duplicate safe dispatch lane: ${lane}`);
    }
  }

  for (const [index, expected] of SAFE_DISPATCH_LANES.entries()) {
    const actual = queue[index];
    if (!actual) {
      failures.push(`Missing safe dispatch lane at position ${index + 1}: ${expected.lane}`);
      continue;
    }

    if (actual.lane !== expected.lane) {
      failures.push(`Safe dispatch lane ${index + 1} must be ${expected.lane}, found ${actual.lane}`);
    }

    if (!expected.scope.test(actual.scope)) {
      failures.push(`Safe dispatch lane ${expected.lane} must keep scoped write targets: ${actual.scope}`);
    }

    for (const codeSpan of expected.codeSpans) {
      if (!actual.scope.includes(`\`${codeSpan}\``)) {
        failures.push(`Safe dispatch lane ${expected.lane} must code-span scoped target ${codeSpan}: ${actual.scope}`);
      }
    }

    const actualCodeSpans = [...actual.scope.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
    for (const codeSpan of actualCodeSpans) {
      if (!expected.codeSpans.includes(codeSpan)) {
        failures.push(`Safe dispatch lane ${expected.lane} must not include out-of-lane code span ${codeSpan}: ${actual.scope}`);
      }
    }

    for (const pathToken of collectUnquotedScopePathTokens(actual.scope)) {
      const outOfLanePath = SAFE_DISPATCH_LANES
        .filter((lane) => lane.lane !== expected.lane)
        .find((lane) => codeSpanBelongsToLane(pathToken, lane));
      if (outOfLanePath) {
        failures.push(`Safe dispatch lane ${expected.lane} must not include out-of-lane path ${pathToken}: ${actual.scope}`);
      }
    }

    if (BROAD_SAFE_DISPATCH_SCOPE_PATTERN.test(normalizeGuardText(actual.scope))) {
      failures.push(`Safe dispatch lane ${expected.lane} is too broad: ${actual.scope}`);
    }
  }
}

function collectActiveLaneLedgerFailures(failures, topSection) {
  const lines = topSection.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => (/^Active lane ledger \(current controller occupancy\):$/.test(line) ? index : -1))
    .filter((index) => index !== -1);
  const headingIndex = headingIndexes[0] ?? -1;

  if (headingIndex === -1) {
    failures.push('Missing active lane ledger heading');
    return;
  }

  if (headingIndexes.length > 1) {
    failures.push(`Expected one active lane ledger heading in active handoff section, found ${headingIndexes.length}`);
  }

  const ledger = [];
  let started = false;
  let ledgerClosed = false;
  let reachedStopWarning = false;
  let currentWorkspaceStartLineCount = 0;

  for (const line of lines.slice(headingIndex + 1)) {
    if (reachedStopWarning) {
      if (line.trim() === '') {
        continue;
      }
      if (line === CURRENT_WORKSPACE_START_LINE) {
        currentWorkspaceStartLineCount += 1;
        continue;
      }
      failures.push(`Unexpected active lane ledger footer line: ${line}`);
      continue;
    }

    if (!started && line.trim() === '') {
      continue;
    }

    if (line === DO_NOT_RESURRECT_WARNING) {
      reachedStopWarning = true;
      continue;
    }

    if (ledgerClosed) {
      if (line.trim() !== '') {
        failures.push(`Unexpected active lane ledger gap line: ${line}`);
      }
      continue;
    }

    if (/^- /.test(line)) {
      started = true;
      const match = /^- ([^:]+):\s+(active|available)\s+-\s+(.+)$/.exec(line);
      if (!match) {
        failures.push(`Malformed active lane ledger entry: ${line}`);
        continue;
      }
      ledger.push({ lane: match[1], status: match[2], detail: match[3] });
      continue;
    }

    if (started && line.trim() === '') {
      ledgerClosed = true;
      continue;
    }

    if (started && /^[ \t]+-\s+/.test(line)) {
      failures.push(`Indented active lane ledger entry must not masquerade as continuation: ${line}`);
      continue;
    }

    if (line.trim() !== '') {
      failures.push(`Unexpected active lane ledger line: ${line}`);
    }
  }

  if (!reachedStopWarning) {
    failures.push('Active lane ledger must end with the do-not-resurrect archived session warning');
  }

  if (reachedStopWarning && currentWorkspaceStartLineCount !== 1) {
    failures.push(
      `Expected exactly one current-workspace handoff footer after stop warning, found ${currentWorkspaceStartLineCount}`,
    );
  }

  if (ledger.length !== SAFE_DISPATCH_LANES.length) {
    failures.push(`Expected ${SAFE_DISPATCH_LANES.length} active lane ledger entries, found ${ledger.length}`);
  }

  const seenLanes = new Map();
  for (const { lane } of ledger) {
    seenLanes.set(lane, (seenLanes.get(lane) ?? 0) + 1);
  }

  for (const [lane, count] of seenLanes) {
    if (count > 1) {
      failures.push(`Duplicate active lane ledger entry: ${lane}`);
    }
  }

  const activeLanes = ledger.filter((entry) => entry.status === 'active');
  if (activeLanes.length !== 1) {
    failures.push(`Expected exactly one active lane ledger entry, found ${activeLanes.length}`);
  } else if (activeLanes[0]?.lane !== 'Web admin') {
    failures.push(`Active lane ledger must keep Web admin active, found ${activeLanes[0]?.lane}`);
  }

  for (const [index, expected] of SAFE_DISPATCH_LANES.entries()) {
    const actual = ledger[index];
    if (!actual) {
      failures.push(`Missing active lane ledger entry at position ${index + 1}: ${expected.lane}`);
      continue;
    }

    if (actual.lane !== expected.lane) {
      failures.push(`Active lane ledger entry ${index + 1} must be ${expected.lane}, found ${actual.lane}`);
    }

    if (actual.status === 'active' && !/current controller/i.test(actual.detail)) {
      failures.push(`Active lane ledger entry ${actual.lane} must name current controller ownership: ${actual.detail}`);
    }

    if (actual.status === 'active') {
      if (BROAD_SAFE_DISPATCH_SCOPE_PATTERN.test(normalizeGuardText(actual.detail))) {
        failures.push(`Active lane ledger entry ${actual.lane} must not use broad ownership scope: ${actual.detail}`);
      }

      for (const lane of SAFE_DISPATCH_LANES) {
        if (lane.lane === actual.lane) {
          continue;
        }

        const laneNamePattern = new RegExp(`\\b${lane.lane.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (laneNamePattern.test(actual.detail)) {
          failures.push(`Active lane ledger entry ${actual.lane} must not mention non-active lane ${lane.lane}: ${actual.detail}`);
        }

        const outOfLaneCodeSpan = [...actual.detail.matchAll(/`([^`]+)`/g)]
          .map((match) => match[1])
          .find((actualCodeSpan) => codeSpanBelongsToLane(actualCodeSpan, lane));
        if (outOfLaneCodeSpan) {
          failures.push(`Active lane ledger entry ${actual.lane} must not mention out-of-lane code span ${outOfLaneCodeSpan}: ${actual.detail}`);
        }
      }
    }

    if (actual.status === 'available' && actual.detail !== 'no active owner in this thread.') {
      failures.push(`Available lane ledger entry ${actual.lane} must stay ownerless: ${actual.detail}`);
    }

    if (
      /\b(?:archived|closed|historical|resume|rollout|session|retired|old|obsolete)\b/i.test(actual.detail) ||
      /\bstale[-\s]+(?:controller|context|handoff|lane|owner|session|thread)\b/i.test(actual.detail)
    ) {
      failures.push(`Active lane ledger entry ${actual.lane} must not point at stale controller context: ${actual.detail}`);
    }

    if (/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(actual.detail)) {
      failures.push(`Active lane ledger entry ${actual.lane} must not contain a session id: ${actual.detail}`);
    }
  }
}

function getActiveLedgerLane(topSection) {
  const lines = topSection.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => /^Active lane ledger \(current controller occupancy\):$/.test(line));

  if (headingIndex === -1) {
    return undefined;
  }

  let started = false;

  for (const line of lines.slice(headingIndex + 1)) {
    if (/^- /.test(line)) {
      started = true;
      const match = /^- ([^:]+):\s+(active|available)\s+-\s+(.+)$/.exec(line);
      if (match?.[2] === 'active') {
        return match[1];
      }
      continue;
    }

    if (started && line.trim() === '') {
      return undefined;
    }
  }

  return undefined;
}

function collectNonLedgerActiveLaneMentionFailures(failures, topSection) {
  const activeLane = getActiveLedgerLane(topSection);

  if (!activeLane) {
    return;
  }

  const laneNamePattern = SAFE_DISPATCH_LANES.map(({ lane }) => lane.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const laneReferencePattern = `(${laneNamePattern})`;
  const activeLaneTokenPattern = String.raw`active[-_\s\u2010-\u2015]+lane`;
  const activeLaneMentionPattern = new RegExp(`\\bactive\\s+(${laneNamePattern})\\s+lane\\b`, 'i');
  const laneTrailingActivePattern = new RegExp(
    `\\b${laneReferencePattern}(?:\\s+lane)?\\s+(?:is|remains|stays)\\s+(?:currently\\s+)?active\\b|\\b${laneReferencePattern}\\s+(?:is|remains|stays)\\s+(?:currently\\s+)?the\\s+active\\s+lane\\b|\\b${laneReferencePattern}\\s+active\\s+lane\\b`,
    'i',
  );
  const activeLaneSubjectPattern = new RegExp(
    `\\b${activeLaneTokenPattern}(?:\\s+(?:is|remains|stays)\\s+(?:currently\\s+)?|\\s*(?::|=|->|\u2192)\\s*)${laneReferencePattern}\\b`,
    'i',
  );
  const activeControllerPattern = /\bactive\s+controller\s+(?:lane|pass)\b/i;

  for (const line of topSection.split(/\r?\n/)) {
    const scanLine = line.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/(?:\*\*|__|`)/g, '');
    const laneMatch = activeLaneMentionPattern.exec(scanLine);
    if (laneMatch && laneMatch[1].toLowerCase() !== activeLane.toLowerCase()) {
      failures.push(`Active handoff mentions non-ledger active lane ${laneMatch[1]} while ledger active lane is ${activeLane}: ${line}`);
    }

    const trailingActiveLaneMatch = laneTrailingActivePattern.exec(scanLine);
    const trailingActiveLane = trailingActiveLaneMatch?.[1] ?? trailingActiveLaneMatch?.[2] ?? trailingActiveLaneMatch?.[3];
    if (trailingActiveLane && trailingActiveLane.toLowerCase() !== activeLane.toLowerCase()) {
      failures.push(`Active handoff mentions non-ledger active lane ${trailingActiveLane} while ledger active lane is ${activeLane}: ${line}`);
    }

    const activeLaneSubjectMatch = activeLaneSubjectPattern.exec(scanLine);
    const activeLaneSubject = activeLaneSubjectMatch?.[1];
    if (activeLaneSubject && activeLaneSubject.toLowerCase() !== activeLane.toLowerCase()) {
      failures.push(`Active handoff mentions non-ledger active lane ${activeLaneSubject} while ledger active lane is ${activeLane}: ${line}`);
    }

    if (activeControllerPattern.test(scanLine)) {
      failures.push(`Active handoff must not use ambiguous active controller lane/pass wording: ${line}`);
    }
  }
}

function collectActiveTaskCardFailures(failures, topSection) {
  const activeTaskCardCounts = new Map();

  for (const line of topSection.split(/\r?\n/)) {
    const historicalAuditMatch = /historical task-card references are limited to T04\/T05\/T12\/T15/i.exec(line);
    if (historicalAuditMatch) {
      const auditSuffix = line.slice((historicalAuditMatch.index ?? 0) + historicalAuditMatch[0].length);
      for (const match of auditSuffix.matchAll(/\bT\d{2}\b/g)) {
        failures.push(`Active task-card id must not be appended to historical audit line: ${match[0]}`);
      }
    }

    const scanLine = historicalAuditMatch ? line.replace(historicalAuditMatch[0], '') : line;
    const normalizedScanLine = normalizeGuardText(scanLine);
    if (normalizedScanLine !== scanLine) {
      const asciiTaskCardCounts = new Map();
      for (const match of scanLine.matchAll(/\bT\d+\b/g)) {
        asciiTaskCardCounts.set(match[0], (asciiTaskCardCounts.get(match[0]) ?? 0) + 1);
      }

      for (const match of normalizedScanLine.matchAll(/\bT\d+\b/g)) {
        const id = match[0];
        const asciiCount = asciiTaskCardCounts.get(id) ?? 0;
        if (asciiCount > 0) {
          asciiTaskCardCounts.set(id, asciiCount - 1);
          continue;
        }

        failures.push(`Active task-card id must use ASCII compact TNN form: ${id}`);
      }
    }

    const taskCardLookalikePattern = new RegExp(
      String.raw`(?:^|[^\p{L}\p{N}_])(${TASK_CARD_PREFIX_PATTERN}${TASK_CARD_DIGIT_PATTERN}+)(?=$|[^\p{L}\p{N}_])`,
      'gu',
    );

    for (const match of scanLine.matchAll(taskCardLookalikePattern)) {
      const id = match[1];
      if (containsNonAscii(id)) {
        failures.push(`Active task-card id must use ASCII compact TNN form: ${id}`);
      }
    }

    const separatedTaskCardPattern = new RegExp(
      String.raw`(?:^|[^\p{L}\p{N}_])(${TASK_CARD_PREFIX_PATTERN}[^\p{L}\p{N}_]+${TASK_CARD_DIGIT_PATTERN}+(?:[)\]}\uFF09\uFF3D\uFF5D])?)(?=$|[^\p{L}\p{N}_])`,
      'gu',
    );

    for (const match of scanLine.matchAll(separatedTaskCardPattern)) {
      failures.push(`Active task-card id must use compact TNN form: ${match[1]}`);
    }

    const suffixedTaskCardPattern = /(?:^|[^\p{L}\p{N}_])([Tt]\d+(?:(?:[\p{L}_][\p{L}\p{N}_-]*)|[-./][\p{L}\p{N}_][\p{L}\p{N}_-]*))(?=$|[^\p{L}\p{N}_-])/gu;
    const suffixedTaskCardRanges = [];
    for (const match of scanLine.matchAll(suffixedTaskCardPattern)) {
      const matchStart = match.index ?? 0;
      const idStart = matchStart + match[0].indexOf(match[1]);
      suffixedTaskCardRanges.push([idStart, idStart + match[1].length]);
      failures.push(`Active task-card id must use compact TNN form: ${match[1]}`);
    }

    const hiddenSuffixTaskCardPattern = /(?:^|[^\p{L}\p{N}_])([Tt]\d+[\p{M}\p{Cf}\uFE0F\u20E3]+)(?=$|[^\p{L}\p{N}_-])/gu;
    for (const match of scanLine.matchAll(hiddenSuffixTaskCardPattern)) {
      const matchStart = match.index ?? 0;
      const idStart = matchStart + match[0].indexOf(match[1]);
      suffixedTaskCardRanges.push([idStart, idStart + match[1].length]);
      failures.push(`Active task-card id must use compact TNN form: ${match[1]}`);
    }

    for (const match of scanLine.matchAll(/\b([Tt])(\d+)\b/g)) {
      if (suffixedTaskCardRanges.some(([start, end]) => (match.index ?? 0) >= start && (match.index ?? 0) < end)) {
        continue;
      }

      const id = match[0];
      const prefix = match[1];
      const digits = match[2];

      if (prefix !== 'T') {
        failures.push(`Active task-card id must use uppercase TNN form: ${id}`);
        continue;
      }

      if (digits.length !== 2) {
        failures.push(`Active task-card id must use two digits: ${id}`);
        continue;
      }

      activeTaskCardCounts.set(id, (activeTaskCardCounts.get(id) ?? 0) + 1);
    }
  }

  for (const [id, count] of activeTaskCardCounts) {
    if (count > 1) {
      failures.push(`Duplicate active task-card id ${id} appears ${count} times`);
    }
  }
}

function collectDoNotResurrectWarningFailures(failures, topSection) {
  const warningCount = topSection.split(/\r?\n/).filter((line) => line === DO_NOT_RESURRECT_WARNING).length;
  const warningLikePatterns = [
    /\b(?:do\s+not|don'?t)\b/i,
    /\b(?:resurrect|resume|reuse|revive|revivals?|restore|reopen|restart)\b/i,
    /\b(?:archived|historical|old|prior|previous|retired|stale)\b/i,
    /\b(?:ids?|rollouts?|sessions?|threads?)\b/i,
  ];
  const cjkWarningLikePattern =
    /(?:不要|不得|禁止|勿|不能).{0,16}(?:恢复|恢復|复活|復活|重启|重啟|重开|重開|重用|沿用|接手|继续|繼續).{0,16}(?:归档|歸檔|历史|歷史|旧|舊|过期|過期|先前|之前|退役|废弃|廢棄|弃用|棄用).{0,16}(?:会话|會話|线程|線程|上下文|记录|記錄|编号|編號|id|ID)/i;

  if (warningCount === 0) {
    failures.push('Missing do-not-resurrect archived session warning');
  }

  if (warningCount > 1) {
    failures.push(`Expected one do-not-resurrect archived session warning in active handoff section, found ${warningCount}`);
  }

  const isWarningLike = (text) => {
    const normalizedText = normalizeGuardText(text);
    return warningLikePatterns.every((pattern) => pattern.test(normalizedText)) ||
      cjkWarningLikePattern.test(normalizedText);
  };
  const lines = topSection.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    if (line === DO_NOT_RESURRECT_WARNING) {
      continue;
    }

    if (isWarningLike(line)) {
      failures.push(`Unexpected near-duplicate do-not-resurrect archived session warning: ${line}`);
      continue;
    }

    const nextLine = lines[index + 1];
    if (nextLine && nextLine !== DO_NOT_RESURRECT_WARNING && isWarningLike(`${line} ${nextLine}`)) {
      failures.push(`Unexpected near-duplicate do-not-resurrect archived session warning: ${line} / ${nextLine}`);
    }
  }
}

function collectProtectedRootWordingFailures(failures, text) {
  for (const line of text.split(/\r?\n/)) {
    const normalizedLine = normalizeGuardText(line);
    const protectedRootContext = /(?:protected-root|terminal-safety|wget\s+-O\s+\/|--output-document=\/|curl\s+-o\s+\/)/i.test(normalizedLine);
    const allowlistWording =
      ALLOWLIST_TERMINOLOGY_PATTERN.test(normalizedLine) ||
      WHITELIST_TERMINOLOGY_PATTERN.test(normalizedLine) ||
      BLOCKLIST_ALTERNATE_TERMINOLOGY_PATTERN.test(normalizedLine);

    if (protectedRootContext && allowlistWording) {
      failures.push(`Protected-root terminal-safety line must use blocklist wording: ${line}`);
    }
  }
}

function collectActiveAllowlistTerminologyFailures(failures, topSection, handoff) {
  for (const line of topSection.split(/\r?\n/)) {
    const normalizedLine = normalizeGuardText(line);
    if (WHITELIST_TERMINOLOGY_PATTERN.test(normalizedLine)) {
      failures.push(`Active handoff must not use whitelist terminology: ${line}`);
      continue;
    }

    if (BLOCKLIST_ALTERNATE_TERMINOLOGY_PATTERN.test(normalizedLine)) {
      failures.push(`Active handoff must use blocklist terminology: ${line}`);
      continue;
    }

    const allowlistOutsideCorsOriginContext = normalizedLine.replace(CORS_ORIGIN_ALLOWLIST_CONTEXT_PATTERN, '');
    if (ALLOWLIST_TERMINOLOGY_PATTERN.test(allowlistOutsideCorsOriginContext)) {
      failures.push(`Active handoff allowlist wording must stay in CORS origin context: ${line}`);
    }
  }

  for (const line of handoff.slice(topSection.length).split(/\r?\n/)) {
    const normalizedLine = normalizeGuardText(line);
    if (WHITELIST_TERMINOLOGY_PATTERN.test(normalizedLine)) {
      failures.push(`Handoff must not use whitelist terminology: ${line}`);
      continue;
    }

    if (BLOCKLIST_ALTERNATE_TERMINOLOGY_PATTERN.test(normalizedLine)) {
      failures.push(`Handoff must use blocklist terminology: ${line}`);
      continue;
    }

    const allowlistOutsideCorsOriginContext = normalizedLine.replace(CORS_ORIGIN_ALLOWLIST_CONTEXT_PATTERN, '');
    if (ALLOWLIST_TERMINOLOGY_PATTERN.test(allowlistOutsideCorsOriginContext)) {
      failures.push(`Handoff allowlist wording must stay in CORS origin context: ${line}`);
    }
  }
}

function collectActiveMojibakeFailures(failures, topSection) {
  const mojibakePattern =
    /\uFFFD|\u9225|\u5bb8\u8336\u7e5b|\u6d7c\u6c33\u763d|\u59dd\uff45\u6e6a|\u935b\u6212\u62a4|\u95c8\u3221\u6fb6|\u6d93\ue044|\u7487\u66df|\u934f\u62bd|\u59af\u0022|\u566f\u6fbe|\u9286\u4fd9|\u9438\u52eb/;

  for (const line of topSection.split(/\r?\n/)) {
    if (mojibakePattern.test(line)) {
      failures.push(`Active handoff contains likely mojibake: ${line}`);
    }
  }
}

function collectArchivedReferenceFailures(failures, handoff, historicalStartIndex) {
  const archivalReferencePattern =
    /(?:Archived Codex session reference|Archived rollout file|~\/\.codex\/sessions\/|rollout-\d{4}-\d{2}-\d{2}T|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)/i;
  const normalizedArchivalReferencePattern =
    /(?:archived codex session reference|archived rollout file|~\/\.codex\/sessions\/|rollout-\d{4}-\d{2}-\d{2}t|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b)/i;

  for (const match of handoff.matchAll(/^.*$/gm)) {
    const line = match[0];
    const lineStart = match.index ?? 0;
    const normalizedLine = normalizeIdentifierText(line);
    if (!archivalReferencePattern.test(line) && !normalizedArchivalReferencePattern.test(normalizedLine)) {
      continue;
    }

    if (normalizedLine.includes(RETIRED_ARCHIVED_SESSION_ID)) {
      failures.push(`Retired archived session id must stay out of live handoff text: ${line}`);
    }

    if (lineStart < historicalStartIndex) {
      failures.push(`Archived session/rollout reference must stay below first handoff separator: ${line}`);
    }

    if (!/\barchived\b/i.test(line) || !/\bhistorical only\b/i.test(line)) {
      failures.push(`Archived session/rollout reference must be labeled archived and historical only: ${line}`);
    }
  }
}

function collectActiveArchivedSessionProseFailures(failures, topSection) {
  const archivalContextPattern = new RegExp(
    String.raw`\b(?:archived|closed|historical|legacy|old|obsolete|previous|retired|stale|superseded)(?:[-\s/\u2010-\u2015]+\w+){0,3}[-\s/\u2010-\u2015]+(?:controllers?|contexts?|lanes?|passes?|rollouts?|sessions?|threads?)\b`,
    'i',
  );
  const reverseArchivalContextPattern =
    /\b(?:controllers?|contexts?|lanes?|passes?|rollouts?|sessions?|threads?)\s+(?:(?:is|are|was|were|remains?|stays?)\s+|still\s+)?(?:archived|closed|historical|legacy|old|obsolete|previous|retired|stale|superseded)\b/i;
  const lifecycleArchivalContextPattern = new RegExp(
    String.raw`\b${ACTIVE_ARCHIVAL_LIFECYCLE_VERB_PATTERN}\b(?:[-\s/\u2010-\u2015]+\w+){0,5}[-\s/\u2010-\u2015]+${ACTIVE_ARCHIVAL_CONTEXT_QUALIFIER_PATTERN}(?:[-\s/\u2010-\u2015]+\w+){0,5}[-\s/\u2010-\u2015]+${ACTIVE_ARCHIVAL_CONTEXT_NOUN_PATTERN}\b|\b${ACTIVE_ARCHIVAL_CONTEXT_QUALIFIER_PATTERN}(?:[-\s/\u2010-\u2015]+\w+){0,5}[-\s/\u2010-\u2015]+${ACTIVE_ARCHIVAL_CONTEXT_NOUN_PATTERN}(?:[-\s/\u2010-\u2015]+\w+){0,5}[-\s/\u2010-\u2015]+${ACTIVE_ARCHIVAL_LIFECYCLE_VERB_PATTERN}\b`,
    'i',
  );
  const cjkArchivalContextPattern =
    /(?:(?:归档|歸檔|历史|歷史|旧|舊|过期|過期|先前|之前|退役|废弃|廢棄|弃用|棄用).{0,12}(?:会话|會話|线程|線程|上下文|记录|記錄|编号|編號|id|ID)|(?:会话|會話|线程|線程|上下文|记录|記錄|编号|編號|id|ID).{0,12}(?:归档|歸檔|历史|歷史|旧|舊|过期|過期|先前|之前|退役|废弃|廢棄|弃用|棄用))/i;

  for (const line of topSection.split(/\r?\n/)) {
    if (line === DO_NOT_RESURRECT_WARNING) {
      continue;
    }
    const normalizedLine = normalizeGuardText(line);

    if (
      archivalContextPattern.test(normalizedLine) ||
      reverseArchivalContextPattern.test(normalizedLine) ||
      lifecycleArchivalContextPattern.test(normalizedLine) ||
      cjkArchivalContextPattern.test(normalizedLine)
    ) {
      failures.push(`Active handoff must reserve stale session wording for the stop warning: ${line}`);
    }
  }
}

function collectActiveWebOnlyCountFailures(failures, topSection) {
  const webOnlySegmentPattern = /\bWeb-only\b[^,.;\n]*(?:E2E|fresh)[^,.;\n]*/gi;

  for (const match of topSection.matchAll(webOnlySegmentPattern)) {
    const segment = match[0];
    const staleCount = [...segment.matchAll(/\b(\d+)\/(\d+)\b/g)].find(
      (countMatch) => countMatch[1] !== '35' || countMatch[2] !== '35',
    );

    if (staleCount) {
      failures.push(`Active Web Admin Web-only E2E evidence must stay 35/35: ${segment}`);
    }
  }
}

function findMatchingBracket(source, openIndex) {
  let depth = 0;
  let quote;
  let escaped = false;

  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }

    if (character === '[') {
      depth += 1;
      continue;
    }

    if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function isInsideStringLiteral(source, offset) {
  let quote;
  let escaped = false;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
    }
  }

  return Boolean(quote);
}

function countTopLevelObjectNameProperties(arraySource) {
  let count = 0;
  let braceDepth = 0;
  let quote;
  let escaped = false;

  for (let index = 0; index < arraySource.length; index += 1) {
    const character = arraySource[index];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    const previousSignificantCharacter = arraySource.slice(0, index).trimEnd().at(-1);
    const startsProperty = previousSignificantCharacter === '{' || previousSignificantCharacter === ',';
    const quotedNameKey =
      startsProperty &&
      braceDepth === 1 &&
      (character === '"' || character === "'") &&
      arraySource.slice(index + 1, index + 5) === 'name' &&
      arraySource[index + 5] === character &&
      /^\s*:/.test(arraySource.slice(index + 6));

    if (quotedNameKey) {
      count += 1;
      index += 5;
      continue;
    }

    if (character === '"' || character === "'" || character === '`') {
      quote = character;
      continue;
    }

    if (character === '{') {
      braceDepth += 1;
      continue;
    }

    if (character === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (
      startsProperty &&
      braceDepth === 1 &&
      arraySource.startsWith('name', index) &&
      !/[\w$]/.test(arraySource[index - 1] ?? '') &&
      !/[\w$]/.test(arraySource[index + 4] ?? '') &&
      /^\s*:/.test(arraySource.slice(index + 4))
    ) {
      count += 1;
      index += 3;
    }
  }

  return count;
}

function collectNamedCaseArrayCounts(testSource) {
  const namedCaseArrayCounts = new Map();

  for (const match of testSource.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*\[/g)) {
    if (isInsideStringLiteral(testSource, match.index ?? 0)) {
      continue;
    }

    const openIndex = (match.index ?? 0) + match[0].lastIndexOf('[');
    const closeIndex = findMatchingBracket(testSource, openIndex);
    if (closeIndex === -1) {
      continue;
    }

    const caseCount = countTopLevelObjectNameProperties(testSource.slice(openIndex + 1, closeIndex));
    if (caseCount > 0) {
      namedCaseArrayCounts.set(match[1], caseCount);
    }
  }

  return namedCaseArrayCounts;
}

function loopPreviewDefinesTests(loopBodyPreview) {
  return /\btest\s*\(\s*(?:name|[A-Za-z_$][\w$]*\.name)\b/.test(loopBodyPreview) ||
    /\btest\s*\(\s*`[^`]*\$\{\s*(?:name|[A-Za-z_$][\w$]*\.name)\b/.test(loopBodyPreview);
}

function isDynamicTemplateTestName(testSource, offset) {
  const openQuoteIndex = testSource.indexOf('`', offset);
  if (openQuoteIndex === -1) {
    return false;
  }

  const commaIndex = testSource.indexOf(',', openQuoteIndex + 1);
  const closeParenIndex = testSource.indexOf(')', openQuoteIndex + 1);
  const nameEndIndex = commaIndex === -1 ? closeParenIndex : closeParenIndex === -1 ? commaIndex : Math.min(commaIndex, closeParenIndex);
  if (nameEndIndex === -1) {
    return false;
  }

  return testSource.slice(openQuoteIndex + 1, nameEndIndex).includes('${');
}

function countHandoffHygieneSelfTests(testSource) {
  const standaloneTests = [...testSource.matchAll(/^\s*test(?:\.only)?\(\s*['"`]/gm)].filter((match) => {
    const offset = match.index ?? 0;
    const startsWithTemplateName = match[0].endsWith('`');
    return !isInsideStringLiteral(testSource, offset) && !(startsWithTemplateName && isDynamicTemplateTestName(testSource, offset));
  }).length;
  let tableDrivenCases = 0;
  const namedCaseArrayCounts = collectNamedCaseArrayCounts(testSource);

  for (const match of testSource.matchAll(/\bfor\s*\([^)]*\bof\s*\[/g)) {
    if (isInsideStringLiteral(testSource, match.index ?? 0)) {
      continue;
    }

    const openIndex = (match.index ?? 0) + match[0].lastIndexOf('[');
    const closeIndex = findMatchingBracket(testSource, openIndex);
    if (closeIndex === -1) {
      continue;
    }

    const loopBodyPreview = testSource.slice(closeIndex + 1, closeIndex + 800);
    if (!loopPreviewDefinesTests(loopBodyPreview)) {
      continue;
    }

    tableDrivenCases += countTopLevelObjectNameProperties(testSource.slice(openIndex + 1, closeIndex));
  }

  for (const match of testSource.matchAll(/\bfor\s*\([^)]*\bof\s*([A-Za-z_$][\w$]*)\s*\)/g)) {
    if (isInsideStringLiteral(testSource, match.index ?? 0)) {
      continue;
    }

    const caseCount = namedCaseArrayCounts.get(match[1]);
    if (!caseCount) {
      continue;
    }

    const loopBodyPreview = testSource.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 800);
    if (loopPreviewDefinesTests(loopBodyPreview)) {
      tableDrivenCases += caseCount;
    }
  }

  for (const match of testSource.matchAll(/\b([A-Za-z_$][\w$]*)\.forEach\s*\(/g)) {
    if (isInsideStringLiteral(testSource, match.index ?? 0)) {
      continue;
    }

    const caseCount = namedCaseArrayCounts.get(match[1]);
    if (!caseCount) {
      continue;
    }

    const callbackPreview = testSource.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 800);
    if (loopPreviewDefinesTests(callbackPreview)) {
      tableDrivenCases += caseCount;
    }
  }

  return standaloneTests + tableDrivenCases;
}

function collectSelfTestCountFailures(failures, topSection, testSource) {
  const expectedCount = countHandoffHygieneSelfTests(testSource);
  if (expectedCount === 0) {
    failures.push('Could not count handoff hygiene self-tests');
    return;
  }

  const commandCountPattern =
    /`(node --test scripts\/check-handoff-hygiene\.test\.mjs|npm run qa:handoff-hygiene)`\s+\((\d+)\/(\d+)(?: plus live scan)?\)/g;
  const proseCountPattern = /with `node:test` self-tests \((\d+)\/(\d+)\) plus the live handoff scan/g;
  const looseHandoffCountPattern =
    /(?:`node --test scripts\/check-handoff-hygiene\.test\.mjs`|`npm run qa:handoff-hygiene`|`node:test` self-tests|\bhandoff hygiene\b[^\n.;]*(?:self-tests?|live-scan|rerun|count|evidence))[^\n.;]*?\b(\d+)\/(\d+)\b/gi;
  let sawNodeSelfTestCount = false;
  let sawLiveScanSelfTestCount = false;

  for (const match of topSection.matchAll(commandCountPattern)) {
    const command = match[1];
    const passedCount = Number(match[2]);
    const totalCount = Number(match[3]);

    if (command === 'node --test scripts/check-handoff-hygiene.test.mjs') {
      sawNodeSelfTestCount = true;
    }

    if (command === 'npm run qa:handoff-hygiene') {
      sawLiveScanSelfTestCount = true;
    }

    if (passedCount !== expectedCount || totalCount !== expectedCount) {
      failures.push(
        `Handoff hygiene self-test count for ${command} is ${passedCount}/${totalCount}, expected ${expectedCount}/${expectedCount}`,
      );
    }
  }

  for (const match of topSection.matchAll(proseCountPattern)) {
    const passedCount = Number(match[1]);
    const totalCount = Number(match[2]);

    if (passedCount !== expectedCount || totalCount !== expectedCount) {
      failures.push(
        `Handoff hygiene self-test count for node:test prose is ${passedCount}/${totalCount}, expected ${expectedCount}/${expectedCount}`,
      );
    }
  }

  for (const line of topSection.split(/\r?\n/)) {
    if (commandCountPattern.test(line) || proseCountPattern.test(line)) {
      commandCountPattern.lastIndex = 0;
      proseCountPattern.lastIndex = 0;
      continue;
    }

    commandCountPattern.lastIndex = 0;
    proseCountPattern.lastIndex = 0;
    const looseLine = line.replace(commandCountPattern, '').replace(proseCountPattern, '');
    for (const match of looseLine.matchAll(looseHandoffCountPattern)) {
      const passedCount = Number(match[1]);
      const totalCount = Number(match[2]);
      if (passedCount !== expectedCount || totalCount !== expectedCount) {
        failures.push(
          `Loose handoff hygiene count is ${passedCount}/${totalCount}, expected ${expectedCount}/${expectedCount}: ${line}`,
        );
      }
    }
  }

  if (!sawNodeSelfTestCount) {
    failures.push('Missing handoff hygiene self-test count in top handoff verification');
  }

  if (!sawLiveScanSelfTestCount) {
    failures.push('Missing handoff hygiene live-scan count in top handoff verification');
  }
}

export function checkHandoffHygiene(root = process.cwd()) {
  const failures = [];
  const handoffPath = join(root, 'HANDOFF.md');
  const lastRunPath = join(root, 'tests/e2e/test-results/.last-run.json');
  const packageJsonPath = join(root, 'package.json');
  const qaChecklistPath = join(root, 'docs/qa-checklist.md');
  const ciWorkflowPath = join(root, '.github/workflows/ci.yml');
  const hygieneTestPath = join(root, 'scripts/check-handoff-hygiene.test.mjs');

  if (!existsSync(handoffPath)) {
    failures.push('HANDOFF.md does not exist');
  } else {
    const handoff = readUtf8File(failures, handoffPath, 'HANDOFF.md');
    const { activeSeparatorCount, historicalStartIndex, separatorGap, topSection } = getHandoffSectionInfo(handoff);
    const latestHeadings = [...topSection.matchAll(/^## 0\. Latest continuation state\b/gm)];
    const priorContinuationHeadings = [...handoff.matchAll(PRIOR_CONTINUATION_HEADING_SCAN_PATTERN)];

    if (activeSeparatorCount !== 1) {
      failures.push(`Expected exactly one active handoff separator before prior continuation state, found ${activeSeparatorCount}`);
    }

    if (priorContinuationHeadings.length !== 1) {
      failures.push(`Expected exactly one prior continuation state heading, found ${priorContinuationHeadings.length}`);
    }

    if (separatorGap.trim() !== '') {
      failures.push(`Active handoff separator must be followed immediately by prior continuation state heading: ${separatorGap.trim()}`);
    }

    if (latestHeadings.length !== 1) {
      failures.push(`Expected exactly one active latest continuation heading, found ${latestHeadings.length}`);
    }

    requireMatch(failures, 'safe dispatch queue heading', topSection, /^Safe next dispatch queue \(choose non-overlapping write scopes\):$/m);

    requireMatch(failures, 'task-card audit statement', topSection, /historical task-card references are limited to T04\/T05\/T12\/T15/);
    requireMatch(failures, 'no active duplicate task-card queue statement', topSection, /there is no active duplicate card queue/);
    requireMatch(failures, 'CORS allowlist policy statement', topSection, /CORS origin `allowlist` wording is legitimate policy language\./);
    requireMatch(failures, 'protected-root blocklist wording', topSection, /protected-root blocklist/);
    requireMatch(
      failures,
      'git metadata caveat',
      topSection,
      /`?\.git\/?`?.*`git status`\s+fails.*files on disk plus verification output as truth/is,
    );
    requireMatch(
      failures,
      'stable full root E2E statement',
      topSection,
      /full root `npm run qa:e2e`.*passes.*73\/73/is,
    );
    requireMatch(
      failures,
      'static mobile E2E server statement',
      topSection,
      /mobile static web server|static mobile web server/i,
    );
    requireMatch(
      failures,
      'Web Admin record-ID whitespace rejection evidence',
      topSection,
      /rejects .*leading or trailing whitespace.*`id` values|padded IDs/i,
    );
    requireMatch(
      failures,
      'Web Admin adminData 30/30 evidence',
      topSection,
      /`npm run test:web -- adminData`\s+\(30\/30\)/,
    );
    requireMatch(
      failures,
      'Web Admin Web-only E2E 35/35 evidence',
      topSection,
      /`npm run test:web:fresh -w @atlasterm\/e2e`\s+\(35\/35\)/,
    );
    requireMatch(
      failures,
      'Web Admin qa:web 160/160 evidence',
      topSection,
      /`npm run qa:web`\s+\(Web typecheck,\s+160\/160 Web tests, production build \+ SRI\)/,
    );

    forbidMatch(failures, 'stale active session resume directive', handoff, /\*\*Codex session to resume:\*\*/i);
    forbidMatch(failures, 'stale active rollout directive', handoff, /\*\*Rollout file:\*\*/i);
    forbidMatch(failures, 'stale active full-root E2E timeout caveat', topSection, /full root `npm run qa:e2e` can time out/i);
    forbidMatch(failures, 'stale active full-root E2E 67/67 evidence', topSection, /full root `npm run qa:e2e`[^\n]*67\/67/i);
    forbidMatch(failures, 'stale active full-root E2E 65/65 evidence', topSection, /full root `npm run qa:e2e`[^\n]*65\/65/i);
    forbidMatch(failures, 'stale active full-root E2E 63/63 evidence', topSection, /full root `npm run qa:e2e`[^\n]*63\/63/i);
    forbidMatch(
      failures,
      'stale active root E2E command-form evidence',
      topSection,
      /`npm run qa:e2e(?::fresh)?`\s+\((?!73\/73\))\d+\/\d+\)/i,
    );
    forbidMatch(
      failures,
      'stale Web Admin Web-only command count evidence',
      topSection,
      /`npm run test:web:fresh -w @atlasterm\/e2e`\s+\((?!35\/35\b)\d+\/\d+\)/,
    );
    forbidMatch(failures, 'stale Web Admin qa:web 143/143 evidence', topSection, /`npm run qa:web`\s+\(Web typecheck,\s+143\/143 Web tests, production build \+ SRI\)/);
    forbidMatch(failures, 'stale Web Admin qa:web 141/141 evidence', topSection, /`npm run qa:web`\s+\(Web typecheck,\s+141\/141 Web tests, production build \+ SRI\)/);
    forbidMatch(failures, 'stale Web Admin qa:web 140/140 evidence', topSection, /`npm run qa:web`\s+\(Web typecheck,\s+140\/140 Web tests, production build \+ SRI\)/);
    forbidMatch(failures, 'stale Web Admin qa:web 138/138 evidence', topSection, /`npm run qa:web`\s+\(Web typecheck,\s+138\/138 Web tests, production build \+ SRI\)/);
    forbidMatch(failures, 'stale Web Admin qa:web 137/137 evidence', topSection, /`npm run qa:web`\s+\(Web typecheck,\s+137\/137 Web tests, production build \+ SRI\)/);
    forbidMatch(failures, 'stale Web Admin qa:web 136/136 evidence', topSection, /`npm run qa:web`\s+\(Web typecheck,\s+136\/136 Web tests, production build \+ SRI\)/);
    forbidMatch(failures, 'stale Web Admin qa:web command count evidence', topSection, /`npm run qa:web`\s+\(Web typecheck,\s+(?!160\/160\b)\d+\/\d+\s+Web tests, production build \+ SRI\)/);
    forbidMatch(failures, 'stale Web Admin adminData 29/29 evidence', topSection, /`npm run test:web -- adminData`\s+\(29\/29\)/);
    forbidMatch(failures, 'stale Web Admin adminData 28/28 evidence', topSection, /`npm run test:web -- adminData`\s+\(28\/28\)/);
    forbidMatch(failures, 'stale Web Admin adminData 26/26 evidence', topSection, /`npm run test:web -- adminData`\s+\(26\/26\)/);
    forbidMatch(failures, 'stale Web Admin adminData 25/25 evidence', topSection, /`npm run test:web -- adminData`\s+\(25\/25\)/);
    forbidMatch(failures, 'stale Web Admin adminData 24/24 evidence', topSection, /`npm run test:web -- adminData`\s+\(24\/24\)/);
    forbidMatch(failures, 'stale Web Admin adminData 23/23 evidence', topSection, /`npm run test:web -- adminData`\s+\(23\/23\)/);
    forbidMatch(failures, 'stale Web Admin adminData command count evidence', topSection, /`npm run test:web -- adminData`\s+\((?!30\/30\))\d+\/\d+\)/);
    forbidMatch(failures, 'stale TerminalPane browser count evidence', topSection, /TerminalPane\.browser\.test\.tsx[^\n()]*\((?!61\/61\b)\d+\/\d+\)/i);
    forbidMatch(failures, 'old system-path allowlist wording', handoff, /system-path allowlist/i);
    forbidMatch(failures, 'broad spawn-20 instruction', handoff, /spawn\s+20/i);
    forbidMatch(failures, 'broad Explore-agent instruction', handoff, /Explore (?:sub)?agents/i);
    forbidMatch(failures, 'open Section 3 punch list heading', handoff, /^## 3\. Open issues\b/im);
    forbidMatch(failures, 'resume instruction pointing at Section 3', handoff, /Pick a task from .*Section 3/i);
    forbidMatch(failures, 'stale mouse-only reorder note', handoff, /mouse-only/i);

    collectDoNotResurrectWarningFailures(failures, topSection);
    collectActiveArchivedSessionProseFailures(failures, topSection);
    collectActiveWebOnlyCountFailures(failures, topSection);
    collectActiveTaskCardFailures(failures, topSection);
    collectNonLedgerActiveLaneMentionFailures(failures, topSection);
    collectActiveAllowlistTerminologyFailures(failures, topSection, handoff);
    collectActiveMojibakeFailures(failures, topSection);
    collectProtectedRootWordingFailures(failures, handoff);
    collectArchivedReferenceFailures(failures, handoff, historicalStartIndex);
    if (existsSync(hygieneTestPath)) {
      collectSelfTestCountFailures(
        failures,
        topSection,
        readUtf8File(failures, hygieneTestPath, 'scripts/check-handoff-hygiene.test.mjs'),
      );
    }
    collectSafeDispatchQueueFailures(failures, topSection);
    collectActiveLaneLedgerFailures(failures, topSection);
  }

  if (existsSync(packageJsonPath)) {
    try {
      const packageJson = JSON.parse(readUtf8File(failures, packageJsonPath, 'package.json'));
      if (typeof packageJson?.scripts?.qa !== 'string' || !packageJson.scripts.qa.includes('qa:handoff-hygiene')) {
        failures.push('package.json root qa script must include qa:handoff-hygiene');
      }
      if (packageJson?.scripts?.['test:handoff-hygiene'] !== HANDOFF_HYGIENE_TEST_SCRIPT) {
        failures.push(`package.json test:handoff-hygiene script must run ${HANDOFF_HYGIENE_TEST_SCRIPT}`);
      }
      if (packageJson?.scripts?.['qa:handoff-hygiene'] !== HANDOFF_HYGIENE_QA_SCRIPT) {
        failures.push('package.json qa:handoff-hygiene script must run self-tests before live scan');
      }
    } catch (error) {
      failures.push(`Could not parse ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (existsSync(qaChecklistPath)) {
    const qaChecklist = readUtf8File(failures, qaChecklistPath, 'docs/qa-checklist.md');
    requireMatch(failures, 'QA checklist handoff hygiene entry', qaChecklist, /qa:handoff-hygiene/);
    requireMatch(failures, 'QA checklist task-card hygiene coverage', qaChecklist, /task-card/i);
    requireMatch(failures, 'QA checklist safe dispatch queue coverage', qaChecklist, /safe dispatch queue/i);
    requireMatch(failures, 'QA checklist safe dispatch code-span coverage', qaChecklist, /code-span/i);
    requireMatch(failures, 'QA checklist active lane ledger coverage', qaChecklist, /active lane ledger/i);
    requireMatch(failures, 'QA checklist non-ledger active lane wording coverage', qaChecklist, /non-ledger active lane|active lane wording/i);
    requireMatch(failures, 'QA checklist duplicate active coordination coverage', qaChecklist, /duplicate active coordination/i);
    requireMatch(failures, 'QA checklist available lane ownerless coverage', qaChecklist, /available lane ownerless/i);
    requireMatch(failures, 'QA checklist archived session reference coverage', qaChecklist, /archived session/i);
    requireMatch(failures, 'QA checklist self-test count coverage', qaChecklist, /self-test count/i);
    requireMatch(failures, 'QA checklist git metadata caveat coverage', qaChecklist, /\.git/i);
    requireMatch(
      failures,
      'QA checklist production-source no-aria-label guard coverage',
      qaChecklist,
      /production-source no-`aria-label` unit guard|production source no-`aria-label` unit guard/i,
    );
    requireMatch(
      failures,
      'QA checklist CORS-origin allowlist context coverage',
      qaChecklist,
      /CORS[-\s]+origin\s+`?allowlist`?\s+(?:context|wording|policy[-\s]+language|carve[-\s]+out)/i,
    );
    requireMatch(failures, 'QA checklist active handoff mojibake coverage', qaChecklist, /active handoff.*mojibake|mojibake.*active handoff/i);
  }

  if (existsSync(ciWorkflowPath)) {
    const ciWorkflow = readUtf8File(failures, ciWorkflowPath, '.github/workflows/ci.yml');
    requireMatch(failures, 'CI handoff hygiene step', ciWorkflow, /npm run qa:handoff-hygiene/);
  }

  if (existsSync(lastRunPath)) {
    try {
      const lastRun = JSON.parse(readUtf8File(failures, lastRunPath, 'tests/e2e/test-results/.last-run.json'));
      if (lastRun.status !== 'passed') {
        failures.push(`E2E last-run status is ${JSON.stringify(lastRun.status)}, expected "passed"`);
      }
    } catch (error) {
      failures.push(`Could not parse ${lastRunPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const failures = checkHandoffHygiene();
  if (failures.length > 0) {
    console.error('Handoff hygiene check FAILED');
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    process.exit(1);
  }

  console.log('Handoff hygiene check PASSED');
}
