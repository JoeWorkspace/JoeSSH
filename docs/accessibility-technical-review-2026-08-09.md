# JoeSSH 0.1.0-beta.20 agent-assisted accessibility review

Review date: 2026-08-09

## Decision

The tested source-preview paths are suitable for a zero-asset prerelease after
the minimum-window keyboard finding below was fixed. This review provides
bounded engineering evidence only. It makes no formal conformance claim for
WCAG 2.2, EN 301 549, the European Accessibility Act, a native platform, or an
assistive-technology combination.

## Scope and method

The review used the repository-pinned Playwright 1.62.1 and Axe 4.12.1 toolchain
on Windows Chromium, together with an agent-assisted inspection of the rendered
Desktop accessibility semantics and focus behavior.

Covered paths:

- Desktop workbench at 1280 × 720 and the supported 900 × 480 minimum release
  viewport, in dark and light themes;
- Desktop command palette, inspector, SFTP, settings, team-access preview, skip
  target, focus return, and context-tab keyboard navigation;
- Web Admin at desktop and mobile viewports, including a 320 CSS pixel Arabic
  right-to-left path;
- Expo mobile web export at 320 CSS pixels in English and Arabic, plus the dark
  operating-system theme; and
- source-level React Native roles, labels, states, font scaling, and target-size
  contracts already maintained by the mobile test suite.

The locator-driven Desktop inspection covered 49 visible interactive controls.
All 49 had a non-empty accessible name, accepted programmatic keyboard focus,
matched `:focus-visible`, displayed an outline or box-shadow focus indicator,
and remained within the viewport after focus. The command palette received
initial focus, closed with Escape, and restored focus to its trigger. The
context tab list moved selection and focus with the right-arrow key.

All Axe violations tagged for WCAG 2.0, 2.1, or 2.2 Level A/AA are now release
failures; the gate no longer filters findings by Axe impact. The WCAG 2.2
`target-size` rule remains explicitly enabled.

## Finding and remediation

At 900 × 480, the default Desktop inspector changed to a horizontal card strip.
Its `.stack` container could scroll but had no enabled focusable descendant, so
Axe reported `scrollable-region-focusable` with serious impact and mappings to
WCAG 2.1.1, WCAG 2.1.3, and EN 301 549.

The inspector strip is now a named, keyboard-focusable region. The Desktop Axe
suite includes the exact 900 × 480 viewport, and the accessibility-readiness
contract rejects removal of that test or restoration of severity-only
filtering.

## Verification evidence

- Fresh cross-surface Playwright E2E: 78/78 passed across Desktop, Web Admin,
  Expo mobile web, visual, and live self-hosted Sync paths.
- Desktop accessibility E2E: 8/8 passed, including the minimum viewport and all
  tested Desktop states with zero WCAG-tagged Axe violations.
- Web Admin mobile keyboard/navigation subset: 3/3 passed, including skip-link
  focus transfer and narrow-screen navigation without document overflow.
- Mobile companion web smoke: 3/3 passed at 320 CSS pixels, including Arabic and
  dark theme.
- Accessibility readiness contract: 6/6 passed, including negative tests for
  severity filtering and removal of the minimum viewport.
- Commercial readiness contract: paid mode now fails closed until EU market
  scope and accessibility applicability are explicitly reassessed.

## Explicit limitations

This review did not observe actual speech, braille output, rotor navigation, or
gesture behavior from NVDA, VoiceOver, or TalkBack. It did not use physical iOS
or Android devices, and it did not include representative disabled users or a
native-speaker review of every locale. Remote shell and terminal-application
output remains outside JoeSSH's control. These limitations prevent this report
from being used as a certification or formal conformance statement.
