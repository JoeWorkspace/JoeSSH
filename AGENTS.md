# JoeSSH

## Scope and safety

- JoeSSH is the local-first SSH, terminal, SFTP, forwarding, and sync workspace; package names still use `@atlasterm/*`. Locate the owning app/package/service before changing a contract.
- Preserve host-key verification, credential encryption/redaction, authorization, bounded remote operations, and fail-closed release checks. Never log private keys, passwords, tokens, terminal contents, or private host data as routine evidence.
- Read the relevant section of [SECURITY.md](SECURITY.md), [QA checklist](docs/qa-checklist.md), or [sync API](docs/sync-api.md) when changing those surfaces. Plans and historical reports are context; the current user request defines the work.
- Preserve existing files and unrelated changes. If Git commands fail, continue authorized local editing with file backups and hashes. Follow the [release handoff playbook](docs/repository-release-handoff.md) for recovery; repair `.git` only when the current user explicitly requests recovery, using verified canonical history, backups, and worktree/hash preservation. Routine edits must not repair `.git`, publish, tag, or claim provenance from a damaged directory.
- Unsigned candidates, local smoke, mock services, and mobile emulation are distinct from signed releases, real SSH/device evidence, and public readiness. Keep those distinctions in reports.

## Commands and completion

- Install the lockfile with `npm ci` (Node 22 in CI; npm version is declared in `package.json`).
- Run the affected workspace checks, for example `npm run typecheck:desktop`, `npm run test:desktop`, or the corresponding `web`, `mobile`, `ui`, and `i18n` scripts. Run `npm run lint` for code changes.
- Workflow/candidate changes: `npm run test:desktop-candidate-stage`. Handoff docs: `npm run qa:handoff-hygiene`; sync contracts: `npm run qa:sync-api-docs`.
- Rust changes: `npm run qa:rust`; security/release changes also use the applicable `qa:rust-advisory`, package/evidence, and public-release checks in `package.json`.
- Use focused checks during edits and the required CI/release matrix at the relevant gate. `--allow-unhealthy-git` is local diagnostic evidence only and cannot satisfy public release readiness.
- Report changed behavior, commands/results, evidence paths, unresolved risks, and any missing environment. Update the owning document when contracts, deployment, or acceptance evidence change.

## Astra and parallel work

- Preserve the selected model. For GPT-6 Astra, state the intended result, relevant sources, constraints, and acceptance checks. Start with the current default effort; adjust toward the lowest effort that reliably completes the task.
- Search and read the affected modules and document sections; load large artifacts, release histories, and tool output only to resolve a specific question. Keep task notes separate from permanent rules.
- Delegate bounded independent exploration, fixes, or checks when useful. Name each lane's files and acceptance checks; keep shared API/schema, lockfiles, release metadata, and final integration under one writer. Subagents return findings, changes, results, and risks; unavailable tools fall back to local execution.
- Keep Fast mode and persistent configuration changes explicit. Do not change user-wide model, permissions, authentication, or experimental context settings during repository work.
- Verify saved model and speed choices against official [Models](https://learn.chatgpt.com/docs/models.md), [Speed](https://learn.chatgpt.com/docs/agent-configuration/speed.md), and [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents.md); availability depends on client and sign-in method.
