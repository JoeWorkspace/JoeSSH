# JoeSSH Product Excellence Plan

Status date: 2026-06-22.

This plan turns the ambition of a world-class, finished JoeSSH into explicit standards, phases, operating cadence, and proof. The target is not "more features"; the target is a remote operations product that expert users trust under pressure, enjoy using every day, and can recommend without caveats.

## Product Promise

JoeSSH is the local-first remote workbench for SSH, terminal sessions, SFTP, port forwarding, encrypted sync, team access, and self-hosted operational visibility.

The product wins when it makes a real operator feel:

- "I can connect safely."
- "I can move fast without losing context."
- "I can recover from mistakes."
- "My team can see enough without exposing secrets."
- "The release and self-hosting story is boring in the best possible way."

## Definition Of Finished

JoeSSH is finished only when each requirement below has direct evidence.

| Area                  | Completion Standard                                                                                                                                       | Evidence                                                                                                            |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Repository health     | Release work happens in a healthy Git checkout with a clean tree outside generated release evidence.                                                      | `git status --short`, `git fsck --strict`, `node scripts/check-public-release-readiness.mjs` without local bypasses |
| Core desktop workflow | Connect, authenticate, confirm host keys, run terminal sessions, transfer files, manage forwards, recover PTY state, and handle errors without dead ends. | Desktop unit tests, Playwright desktop specs, manual dogfood scripts, signed desktop release evidence               |
| SSH safety            | Dangerous native command paths, unsafe SFTP paths, host-key changes, oversized outputs, and unsafe transfer sizes are blocked or confirmed visibly.       | Rust tests, desktop tests, release-readiness checks, QA checklist evidence                                          |
| Web Admin             | Live Sync snapshots are the default, fixture mode is explicit, proxy auth is server-side, and status surfaces are understandable.                         | Web tests, Web Admin proxy smoke, topology smoke, Lighthouse evidence                                               |
| Sync Service          | Self-hosted Sync supports durable storage, auth, CORS controls, backup/restore, packaged release smokes, and clear limits.                                | Sync API docs contract, self-hosted smoke, release smoke, backup/restore evidence                                   |
| Mobile companion      | Mobile remains safe for preview, blocks public embedded sync auth tokens, and has a public-beta path based on pairing or scoped device credentials.       | Mobile tests, native preflight, `qa:mobile-public-env`, future pairing/OIDC tests                                   |
| Privacy               | Telemetry and error reporting are opt-in, runtime-disablable, and never collect sensitive SSH material.                                                   | Privacy docs, app shell tests, error-monitor tests, release-readiness checks                                        |
| Accessibility         | Keyboard, focus, labels, contrast, and reduced-motion expectations hold across desktop, web, and mobile-web paths.                                        | Playwright accessibility specs, manual keyboard pass, visual QA                                                     |
| Performance           | The product feels instant for ordinary operations and bounded under stress.                                                                               | Bundle budgets, Lighthouse gates, Web Vitals, terminal and SFTP stress tests                                        |
| Internationalization  | Advertised locales are complete, readable, and stable under production release gates.                                                                     | `qa:i18n-release`, mojibake tests, visual snapshots                                                                 |
| Distribution          | Desktop, Web Admin, Sync, SBOM, provenance, checksums, rollback, and release notes are complete and repeatable.                                           | `qa:release:public`, publish preflight, release checklist, release artifacts                                        |
| Supportability        | Operators can install, configure, debug, rollback, and hand off incidents without private tribal knowledge.                                               | Docs, health endpoints, admin status, logs, support bundle redaction rules                                          |

## Phase 0: Restore A Trustworthy Release Base

Goal: make the workspace capable of proving release integrity.

1. Move all current changes into a healthy checkout following `docs/repository-release-handoff.md`.
2. Run `git status --short`, `git fsck --strict`, and `node scripts/check-public-release-readiness.mjs` without `--allow-unhealthy-git`.
3. Keep this damaged-planning workspace out of publish, tag, provenance, checksum, and GitHub draft steps.
4. Record the healthy checkout path and release-machine prerequisites in handoff notes.

Exit criteria:

- A healthy checkout can run the readiness checker without Git bypasses.
- Release provenance can bind the tag, commit, lockfiles, release notes, and checksum manifests.

## Phase 1: Make Public Beta Unquestionably Safe

Goal: ship Desktop, Web Admin, and self-hosted Sync without hidden safety or release-risk caveats.

Focus:

- Finish every item in `docs/release-checklist.md`.
- Keep mobile out of public release scope until token embedding is replaced by pairing, OIDC, or scoped device credentials.
- Run `npm run qa:release:public` on the release machine.
- Run Web Admin proxy, bundle-token, topology, Sync backup/restore, SBOM, provenance, and publish preflight gates.
- Prove rollback for Desktop, Web Admin, and Sync artifacts.

Non-negotiables:

- No public bundle contains bearer tokens or high-entropy credentials.
- No release is drafted from raw Tauri bundle output.
- No release proceeds from an unhealthy Git checkout.
- No telemetry transport installs before explicit opt-in.

Exit criteria:

- A draft Public Beta release exists with verified artifacts, checksums, SBOM, provenance, and release notes.
- A rollback rehearsal is documented.
- A small dogfood group can install and complete the top desktop and Web Admin workflows.

## Phase 2: Become A Daily-Driver Workbench

Goal: make JoeSSH good enough that operators prefer it for ordinary work.

Workstreams:

| Workstream       | Target Experience                                                                               | Proof                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Connection setup | New hosts, saved hosts, groups, tags, and search feel predictable.                              | Desktop tests plus 10-user dogfood task success                |
| Terminal         | PTY reconnect, blocked-command status, command palette, shortcuts, and panes are fast and calm. | Terminal stress tests, visual QA, keyboard audit               |
| SFTP             | Browse, upload, download, overwrite, path safety, and limits are clear.                         | SFTP integration tests, large-file limit tests, dogfood script |
| Port forwarding  | Start, stop, pending, duplicate action, and error states are obvious.                           | Forwarding tests and live loopback drill                       |
| Team access      | Role summaries, member state, audit language, and risk badges are useful.                       | Web Admin and desktop panel tests                              |
| Sync             | Device registration, push, pull, conflict, backup, restore, and admin snapshots are boring.     | Real Sync E2E and backup/restore drills                        |

Exit criteria:

- Ten representative operator tasks complete without developer help.
- No P0 or P1 user-flow bug remains open.
- The product can be used for a full day of SSH/SFTP/forwarding dogfood without data loss or forced restart.

## Phase 3: Industrialize Release And Operations

Goal: make every release repeatable, observable, and reversible.

Build:

- Signed and notarized Desktop release paths for Windows, macOS, and Linux.
- Web Admin deploy package with verified headers, SRI, security.txt, and rollback bundle.
- Sync binary package with durable storage docs, healthcheck, metrics, backup/restore, and systemd/Docker examples.
- Release evidence that ties every uploaded artifact to SHA256 manifests and provenance.

Operate:

- One-page install guides per target.
- One-page rollback guides per target.
- Healthcheck and metrics examples with alert thresholds.
- Redacted support bundle rules.

Exit criteria:

- A fresh release operator can build, verify, draft, rollback, and document a release using only repo docs.
- Release rehearsal passes twice in a row on a clean machine.

## Phase 4: Make Mobile And Team Collaboration Real

Goal: promote mobile and team workflows from companion preview to trustworthy product surface.

Mobile:

- Replace public embedded sync auth with pairing, OIDC, or scoped device credentials.
- Add device revocation and session expiry.
- Add emergency read-only access mode.
- Add offline state, stale-data warnings, and conflict-safe sync UX.
- Require native device smoke for public mobile scope.

Team:

- Make role/risk language actionable.
- Add audit trails that explain who did what, when, and from where.
- Add least-privilege defaults.
- Add admin snapshot health and degraded-mode guidance.

Exit criteria:

- Mobile public beta has no shared static bearer token path.
- Team admins can invite, review, revoke, and audit access with clear evidence.

## Phase 5: Build The Product Moat

Goal: become hard to replace, not merely feature-complete.

Moat candidates:

- Session memory that preserves context across terminals, SFTP, forwards, and team audit.
- Safe runbooks that turn repeated terminal operations into reviewed workflows.
- Local-first encrypted workspace sync with transparent conflict handling.
- Operator-grade search across hosts, commands, files, forwards, and incidents.
- Extensible command and panel model without weakening security boundaries.
- AI assistance only where it is bounded, local-first when possible, and never exposed to secrets by default.

Exit criteria:

- Users can describe at least one JoeSSH workflow they cannot easily reproduce in ordinary terminal clients.
- Retention, dogfood frequency, and qualitative feedback show product pull rather than novelty.

## Operating Cadence

Daily:

- Pick one user-visible workflow or one release-risk reducer.
- Land only changes with focused tests or documented manual evidence.
- Keep `npm run lint` and the relevant scoped tests green.
- Record unresolved risk in the nearest doc or issue list.

Weekly:

- Run a release-readiness rehearsal.
- Run one full dogfood script from a clean user profile.
- Review top friction from tests, logs, user notes, and manual QA.
- Delete or defer work that does not improve trust, speed, safety, or repeatability.

Every two weeks:

- Re-score the product with the scorecard below.
- Promote the next most important milestone only after exit criteria are met.
- Revisit dependency risk, mobile release scope, and release-machine health.

Before every public release:

- Complete `docs/release-checklist.md`.
- Run public gates in a healthy checkout.
- Verify artifacts, checksums, provenance, SBOM, and rollback.
- Confirm privacy and token exposure checks are still active.

## Product Scorecard

Use this as the steering dashboard.

| Dimension      | Red                                                | Yellow                                           | Green                                                     |
| -------------- | -------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------- |
| Trust          | Known P0/P1 safety issue or unhealthy release base | Safety issue has mitigation but no release proof | Safety gates pass and issue has regression coverage       |
| Workflow       | Core task needs developer help                     | Core task works with rough edges                 | Core task is discoverable, fast, recoverable, and tested  |
| Reliability    | Flaky tests or known data-loss path                | Scoped flake or manual workaround                | Repeatable tests and dogfood pass                         |
| Performance    | User-visible lag or budget failure                 | Budget passes but stress behavior unknown        | Budgets pass and stress path is measured                  |
| Design quality | Inconsistent layout, copy, or states               | Functional but not polished                      | Calm, dense, accessible, and coherent                     |
| Release        | Manual tribal steps or missing artifact evidence   | Checklist exists but rehearsal is incomplete     | Fresh operator can repeat release and rollback            |
| Support        | Logs/docs are insufficient for incidents           | Docs exist but do not cover degraded states      | Install, health, recovery, and support evidence are clear |

World-class work means converting red to yellow quickly, then yellow to green permanently.

## Immediate 30-Day Plan

Week 1:

- Restore or clone into a healthy Git checkout.
- Run `node scripts/check-public-release-readiness.mjs` without local bypass.
- Freeze `0.1.0-beta.4` scope to Desktop, Web Admin, and self-hosted Sync.
- Create a top-10 dogfood task script for SSH, PTY, SFTP, forwarding, Web Admin, and Sync.

Week 2:

- Run `npm run qa:release:public` on the release machine.
- Fix every release blocker before adding new product scope.
- Rehearse Desktop, Web Admin, Sync packaging and rollback.
- Tighten docs wherever the rehearsal needed private knowledge.

Week 3:

- Dogfood daily with a clean profile and real local services.
- Convert friction into tests or checklist items.
- Polish the highest-friction workflow, not the most convenient component.
- Validate Web Admin live Sync and backup/restore flows end to end.

Week 4:

- Draft the Public Beta release from the healthy checkout.
- Collect install feedback from a small dogfood group.
- Triage feedback into P0/P1/P2, with P0/P1 blocking wider release.
- Decide the mobile public beta auth design before expanding mobile scope.

## Priority Rules

P0:

- Data loss, credential leak, unsafe command execution, broken release provenance, broken rollback, or a public bundle secret.

P1:

- Core workflow dead end, inaccessible critical action, flaky release gate, misleading status, or hard-to-recover sync failure.

P2:

- Noticeable polish issue, missing convenience, copy inconsistency, or incomplete secondary workflow.

P3:

- Nice-to-have, speculative moat work, or automation that does not protect the current release.

## Decision Principles

- Ship trust before novelty.
- Make the happy path fast and the dangerous path explicit.
- Prefer evidence over confidence.
- Prefer one finished workflow over five impressive demos.
- Keep mobile public scope closed until credential handling is product-grade.
- Treat release engineering as a product feature.
- Never let local planning shortcuts become release habits.

## Completion Contract

The product can be called a world-class finished release only when:

1. The healthy-checkout release path is proven without bypasses.
2. The public release gate, publish preflight, SBOM, provenance, and rollback evidence all pass.
3. The core operator workflows pass automated tests and dogfood scripts.
4. Privacy, token exposure, host-key trust, SFTP safety, command safety, and backup/restore gates have regression coverage.
5. Documentation is sufficient for a fresh operator to install, run, verify, troubleshoot, and rollback.
6. User feedback shows pull from real workflows, not only appreciation of technical breadth.
7. The next release can be repeated by someone who did not build the current one.
