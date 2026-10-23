# Repository Release Handoff Playbook

This playbook is required whenever the current working directory cannot prove
healthy Git checkout metadata. It exists to keep the Public Beta release path
auditable even when a planning workspace has useful file changes but a damaged
`.git` directory.

The rule is simple: do not publish from the damaged workspace. Use the damaged
workspace only as a source of reviewed file content and verification notes.
Tagging, release notes diffs, CI evidence, SBOM generation, checksums, and
GitHub Release drafts must happen from a healthy Git checkout.

## Metadata Recovery Recorded 2026-09-12

The local `C:\JoeProject\JoeSSH` metadata was explicitly recovered from a fresh
clone of `https://github.com/JoeWorkspace/JoeSSH.git`. Three existing healthy
local clones independently identified this origin, and the fresh clone passed
`git fsck --strict`. Remote `main` at inspection was
`803fcef25b7808bd8257fb589373791d75451f58`.

The recovery branch `codex/recover-metadata-20260912` starts at
`d1ffb6c07c7c6d5ea6a7b7fad21c9b4d17c02476`, the canonical first-parent commit
with the closest source content match: 232 files match, 117 differ, and no
tracked source files are absent. This is an explicit review baseline, not a
claim that the lost HEAD, index, reflogs, local branches, or unpublished commits
were recovered. The current source differs from that historical beta baseline
and must be reconciled and reviewed before preparing a release.

The original partial `.git` and source SHA256 inventory were saved before
recovery. The new metadata was copied only to absent paths, keeping the original
pre-commit hook. All 505 inventoried source files and that hook matched their
pre-recovery hashes; the restored repository passed `git fsck --strict`. No
worktree checkout, hard reset, clean, source commit, tag, push, or publication
was performed. Build outputs under `target-security/` and generated release
evidence under `reports/release/` are ignored, consistent with the release
clean-tree exception below.

Keep dated historical handoff entries as historical evidence. For the current
checkout health, rerun the commands below. Passing a source-readiness check is
not signed artifact, real-device, real-SSH, or complete public-release evidence.

## Source Reconciliation Recorded 2026-10-23

The recovered workspace still has local changes based on the historical
`d1ffb6c` baseline. A fresh canonical fetch identified `main` at
`312811c070790e1bb04bf164214e1db97a3f8825` with version `0.1.0-beta.29`.
The old local `0.1.0-beta.1` metadata must not be treated as the next mainline
release. Existing version tags must remain unchanged.

The `codex/release-remediation-20261023` worktree is reserved for a local source
snapshot and review. It is not a release tag or a claim of mainline integration.
Keep the original working directory intact. Reconcile selected changes against
the canonical mainline before selecting the next release version or creating
provenance; do not overwrite newer SSH input, terminal, SFTP, or Store behavior
with whole files from the historical workspace.

Dependency and signing blockers, independent validation, and the source-copy
hash inventory are retained under `reports/release-remediation-2026-10-23/`.
That local report directory is not a release upload source. The public gates
and signed multi-platform artifact requirements below still apply.

## When To Use This

Use this playbook if any of these commands fail in the release workspace:

```bash
git status --short
git rev-parse --is-inside-work-tree
git fsck --strict
```

For `0.1.0-beta.1`, the first public release target remains Desktop, Web Admin,
and the self-hosted Sync Service. Mobile device smoke stays a strict-release
route, not a blocker for the first Public Beta.

## Recovery Flow

1. Create or locate a healthy clone of the canonical JoeSSH repository.
2. In the damaged workspace, produce a reviewable patch bundle:

   ```bash
   git diff --binary > joessh-release-handoff.patch
   ```

   If Git metadata is too damaged to create a patch, copy only the reviewed
   working files into a separate staging directory and record the file list in
   the handoff notes. Do not copy `.git`.

3. In the healthy checkout, apply the reviewed changes, then run:

   ```bash
   git status --short
   git diff --check
   git fsck --strict
   ```

4. Run the local Public Beta gate in the healthy checkout:

   ```bash
   npm run qa:release:public
   node scripts/check-public-release-readiness.mjs
   ```

5. Build release artifacts in the healthy checkout or release machine:

   ```bash
   npm run release:desktop:build
   npm run release:desktop:package
   npm run release:web
   npm run release:sync
   npm run release:sbom
   npm run release:sbom:verify
   npm run release:verify-checksums
   ```

   `release:desktop:package` is the final Desktop aggregation step for the
   public beta; collect the signed Windows, notarized macOS, and Linux package
   artifacts into the bundle input before running it.

6. Select a new, unused version only after reconciling with canonical main.
   Check both local and remote tags and existing GitHub releases. Never reuse
   or move `v0.1.0-beta.1` (or another existing tag). Tag only after source QA
   is green, the release evidence is complete, and the healthy checkout is
   clean outside generated release artifacts. Create the annotated tag for
   that reviewed version and commit, then run:

   ```bash
   git status --short -- . ':(exclude)reports/release'
   npm run release:provenance
   npm run release:provenance:verify
   npm run release:publish-preflight
   npm run release:desktop:draft
   ```

## Acceptance Evidence

Keep these outputs with the release handoff notes:

- `git status --short -- . ':(exclude)reports/release'` from the healthy
  checkout before tagging.
- `git fsck --strict` from the healthy checkout.
- `npm run qa:release:public` result.
- `node scripts/check-public-release-readiness.mjs` result without
  `--allow-unhealthy-git`.
- `gh --version`, `gh auth status`, and the selected version's GitHub Release
  not-found check from `npm run release:publish-preflight`.
- `reports/release/**/SHA256SUMS.txt`.
- `reports/release/desktop/release-evidence.json`.
- `reports/release/desktop/release-evidence-SHA256SUMS.txt`.
- `reports/release/SBOM-SHA256SUMS.txt`.
- `reports/release/release-provenance.json`.
- `reports/release/release-provenance-SHA256SUMS.txt`.
- GitHub Release draft URL and the tag commit SHA.

## Failure Rules

- If `git status --short` is not empty at draft time, stop.
- If `git fsck --strict` fails, stop.
- If `node scripts/check-public-release-readiness.mjs` requires
  `--allow-unhealthy-git` in the healthy checkout, stop.
- If a release artifact is not listed in a `SHA256SUMS.txt` manifest, stop.
- If release provenance does not verify against the tag, lockfiles, release
  notes, staged manifests, and artifacts, stop.
- If Windows signing, macOS signing/notarization, or Linux package evidence is
  missing for a public Desktop artifact, stop.
