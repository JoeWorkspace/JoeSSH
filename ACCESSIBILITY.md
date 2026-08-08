# JoeSSH accessibility assessment status

Last reviewed: 2026-08-08
Applies to: JoeSSH `0.1.0-beta.12`

JoeSSH is designed to be usable by people with visual, hearing, motor, and
cognitive disabilities. The project targets WCAG 2.2 Level AA for its web-based
interfaces and uses EN 301 549 V3.2.1 as the additional ICT accessibility
baseline where its requirements apply. This document records EAA-oriented
readiness work for Directive (EU) 2019/882. It is not a certification, legal
determination, or formal WCAG, EN 301 549, or European Accessibility Act
conformance claim.

## Assessment status

Assessment is in progress. Automated and documented checks pass for the tested
product paths described below, but JoeSSH does not currently make a formal
conformance claim for WCAG 2.2, EN 301 549, or the European Accessibility Act.
A criteria-by-criteria assessment and broader assistive-technology and
native-device validation remain incomplete.

The current assessment scope includes:

- the Windows-first Desktop workbench, including connection management,
  terminal controls, SFTP, port forwarding, settings, and team-access previews;
- the read-only Web Admin dashboard;
- the React Native/Expo mobile sync companion preview; and
- the public documentation and static fallback pages shipped from this
  repository.

It does not cover content produced by remote SSH hosts, third-party shells or
terminal applications, operator-provided deployment pages, or authentication
systems added by a downstream deployer.

## Accessibility measures

JoeSSH currently provides:

- keyboard access to primary Desktop and Web Admin workflows, visible focus
  indicators, a skip link, focus trapping in dialogs, and keyboard alternatives
  for connection drag-and-drop ordering;
- programmatic names, states, headings, landmarks, status and alert live
  regions, table relationships, and error descriptions for assistive
  technologies;
- layouts that reflow on narrow screens, tolerate large text, and preserve a
  minimum 24 CSS pixel target size or equivalent target spacing for interactive
  web controls;
- light and dark themes, Windows forced-colors support, and reduced-motion
  behavior;
- no time-limited interaction, CAPTCHA, memory puzzle, or user-facing
  authentication challenge in the shipped interfaces; and
- localized UI for the supported languages, including right-to-left layout for
  Arabic.

## Assessment method and evidence

The project evaluates accessibility through:

- Playwright and Axe checks for WCAG 2.0, 2.1, and 2.2 A/AA rules, including the
  WCAG 2.2 target-size rule;
- keyboard-only workflow tests, focus visibility and focus-not-obscured checks,
  narrow-viewport and large-text coverage, Lighthouse accessibility audits,
  and source-level semantic contracts;
- automated React Native accessibility-role, label, state, dynamic-type, and
  target-size tests; and
- Windows Chromium-based browser verification during this review.

Automated checks cannot prove accessibility on their own. A formal release for
a regulated deployment should add manual testing with representative disabled
users and current combinations of NVDA with Edge or Firefox, VoiceOver with
Safari and iOS, and TalkBack with Android.

## Known limitations

- Raw terminal output is controlled by the connected host and terminal
  application. Xterm-compatible screen-reader behavior can vary with the shell,
  full-screen terminal program, browser engine, and assistive technology.
- The current assessment evidence does not include a complete manual audit on
  physical iOS and Android devices with VoiceOver and TalkBack.
- The Web Admin accepts operator-configured bearer credentials rather than
  providing an end-user sign-in flow. If a deployer adds authentication, that
  flow must independently meet WCAG 2.2 criterion 3.3.8 and the applicable EN
  301 549 requirements.
- Translations are checked for completeness and layout safety, but every
  language has not yet received a native-speaker accessibility review.

These limitations prevent a formal conformance claim. The community Beta keeps
its accessibility assessment explicitly in progress until they are resolved or
evaluated with representative manual evidence.

## Feedback and assistance

Report an accessibility barrier with the
[accessibility issue form](https://github.com/JoeWorkspace/JoeSSH/issues/new?template=accessibility.yml).
Please include the affected surface, steps to reproduce, expected result, and
assistive technology or input method if relevant. Do not include passwords,
private keys, access tokens, hostnames, terminal output, or other sensitive
operational data.

We aim to acknowledge accessibility reports within 10 business days and to
publish the disposition or planned remediation in the issue when it is safe to
do so. Security-sensitive barriers should instead follow [SECURITY.md](SECURITY.md).

If JoeSSH is supplied as part of a service that falls within Directive (EU)
2019/882, the service provider remains responsible for its deployment-specific
assessment, accessible support channel, documentation retention, and any notice
to the competent national authority.

## Standards references

- [Directive (EU) 2019/882](https://eur-lex.europa.eu/eli/dir/2019/882/oj/eng)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [EN 301 549 V3.2.1](https://www.etsi.org/deliver/etsi_en/301500_301599/301549/03.02.01_20/en_301549v030201a.pdf)
