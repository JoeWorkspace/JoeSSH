# Repository Release Handoff Playbook

This playbook is required whenever the current working directory cannot prove
healthy Git checkout metadata. It exists to keep the Public Beta release path
auditable even when a planning workspace has useful file changes but a damaged
`.git` directory.

The rule is simple: do not publish from the damaged workspace. Use the damaged
workspace only as a source of reviewed file content and verification notes.
Tagging, release notes diffs, CI evidence, SBOM generation, checksums, and
GitHub Release drafts must happen from a healthy Git checkout.

## When To Use This

Use this playbook if any of these commands fail in the release workspace:

```bash
git status --short
git rev-parse --is-inside-work-tree
git fsck --strict
```

`0.1.0-beta.18` is permanently reserved for the source-only closeout described
below. Do not attach binaries to that Release or reuse its tag for Web, Sync,
Desktop, Mobile, or Store distribution. A future full public release must first
bump every version surface and release-note path to a distinct, unused version
after `0.1.0-beta.18`; its target remains Desktop, Web Admin, and the self-hosted
Sync Service. Mobile device smoke stays a strict-release route.

The maintenance closeout may be represented by a source-only GitHub prerelease
before the full public artifact gate is available. That prerelease is limited to
GitHub's automatically generated source archives: upload no `reports/release`
files, unsigned installers, or locally built binaries. It must be marked as a
prerelease, use an annotated tag on the exact protected `main` commit with passing
required checks, and state that Desktop signing/notarization and Store approval
remain incomplete. This narrow source record does not satisfy or weaken
`release:publish-preflight`; any later binary release must still pass the complete
artifact, signing, checksum, SBOM, provenance, and evidence workflow below.

After the version-preparation pull request is merged and its required check is
green, create and push only the single annotated source tag, remove every file
under `reports/release/`, then use the dedicated fail-closed entry point:

```bash
REVIEWED_COMMIT="$(git rev-parse HEAD)"
git tag -a v0.1.0-beta.18 -m "JoeSSH 0.1.0-beta.18 Source Preview"
git push origin refs/tags/v0.1.0-beta.18:refs/tags/v0.1.0-beta.18
npm run release:source-prerelease -- --confirm-billing-ready --dry-run
npm run release:source-prerelease -- --confirm-billing-ready
npm run release:source-prerelease:verify
```

The command creates a private draft first, verifies the exact tag, protected
`main`, latest `Public Release Readiness` check, reviewed notes, and zero assets,
and immediately runs the read-only GitHub release-controls gate with the
operator's Billing attestation. It repeats that controls gate before making the
draft public, then publishes it as a prerelease and verifies it again. A rejected
draft is deleted by its exact numeric Release ID. This entry point never uploads
a file and cannot publish a full binary release.

## Recovery Flow

The artifact-building and full-draft steps in this section apply only to a
future distinct `FULL_RELEASE_VERSION` after beta.18. They must not be used to
modify the permanent beta.18 source-only Release.

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
   # Windows release machine with local OpenSSH dogfood fixture:
   npm run qa:release:public:fixture
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
   npm run release:third-party-licenses
   npm run release:third-party-licenses:verify
   npm run release:verify-checksums
   ```

   `release:desktop:package` is the final Desktop aggregation step for the
   public beta; collect the signed Windows, notarized macOS, and Linux package
   artifacts into the bundle input before running it.

6. Merge the reviewed candidate through the protected `main` path. In a fresh
   healthy checkout, fetch the remote branch and prove that the checkout is the
   exact remote candidate before tagging:

   ```bash
   git fetch --prune origin main
   test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
   git status --short -- . ':(exclude)reports/release'
   git fsck --strict
   ```

   Stop if `HEAD` is not the exact `origin/main` commit. Do not create a tag
   from an unpushed topic branch or from a local commit that has not passed the
   protected `main` controls.

7. For a later full binary release, choose a distinct unused version after
   `0.1.0-beta.18`. Tag only after source QA is green, release evidence is
   complete, and the checks above are clean. Push that one annotated tag
   explicitly, then resolve the remote peeled tag and compare it with the
   reviewed commit:

   ```bash
   FULL_RELEASE_VERSION=0.1.0-beta.19 # example; replace with the reviewed unused version
   RELEASE_TAG="v${FULL_RELEASE_VERSION}"
   REVIEWED_COMMIT="$(git rev-parse HEAD)"
   git tag -a "${RELEASE_TAG}" -m "JoeSSH ${FULL_RELEASE_VERSION}"
   git push origin "refs/tags/${RELEASE_TAG}:refs/tags/${RELEASE_TAG}"
   REMOTE_TAG_COMMIT="$(
     git ls-remote origin "refs/tags/${RELEASE_TAG}^{}" |
       awk 'NR == 1 { print $1 }'
   )"
   test -n "${REMOTE_TAG_COMMIT}"
   test "${REMOTE_TAG_COMMIT}" = "${REVIEWED_COMMIT}"
   ```

   A missing peeled ref means the required annotated remote tag was not
   created. A different SHA means the remote tag is not the reviewed candidate;
   stop without drafting a release.

8. Confirm that the repository is still public, every release workflow uses a
   standard GitHub-hosted runner, larger runners are not enabled, artifact and
   cache usage remain inside the free allowances, and a zero paid budget or no
   payment method will block overages. Keep that GitHub Free operator
   attestation in the environment for both fail-closed release entry points:

   ```bash
   export JOESSH_GITHUB_BILLING_CONFIRMED=1
   npm run release:github-controls -- \
     --repo JoeWorkspace/JoeSSH \
     --confirm-billing-ready
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
- `npm run qa:release:public:fixture` result when the release machine is using
  the local OpenSSH dogfood fixture to supply `JOESSH_REAL_SSH_*` evidence.
- `node scripts/check-public-release-readiness.mjs` result without
  `--allow-unhealthy-git`.
- `gh --version`, `gh auth status`, and the
  `gh release view "${RELEASE_TAG}"` not-found check from
  `npm run release:publish-preflight`.
- The exact `origin/main` SHA, local annotated tag SHA, remote peeled tag SHA,
  and their equality check.
- The passing read-only GitHub release-controls report, including the explicit
  Billing/spending-limit operator attestation.
- `reports/release/**/SHA256SUMS.txt`.
- `reports/release/desktop/release-evidence.json`.
- `reports/release/desktop/release-evidence-source.json`.
- `reports/release/desktop/release-evidence-SHA256SUMS.txt`.
- `reports/handoff/desktop/formal-evidence-unblock-report.json` while the
  candidate is No-Go on Desktop formal evidence. This handoff-only diagnostic
  report is not a release upload artifact.
- `reports/release/SBOM-SHA256SUMS.txt`.
- `reports/release/cargo-workspace-sbom.cdx.json`.
- `reports/release/tauri-cargo-sbom.cdx.json`.
- `reports/release/npm-desktop-sbom.cdx.json`.
- `reports/release/npm-web-sbom.cdx.json`.
- `reports/release/third-party-licenses/manifest.json`.
- `reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt`.
- `reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt`.
- `reports/release/release-provenance.json`.
- `reports/release/release-provenance-SHA256SUMS.txt`.
- GitHub Release draft URL and the tag commit SHA.

## Failure Rules

- If `git status --short` is not empty at draft time, stop.
- If `git fsck --strict` fails, stop.
- If `HEAD` differs from `origin/main`, or the remote peeled release tag differs
  from `HEAD`, stop.
- If the repository, branch protection, PVR, protected environments, signing
  secret absence, Billing attestation, artifact summary, or cache summary does
  not pass the read-only GitHub release controls, stop.
- If `node scripts/check-public-release-readiness.mjs` requires
  `--allow-unhealthy-git` in the healthy checkout, stop.
- If a release artifact is not listed in a `SHA256SUMS.txt` manifest, stop.
- If raw files from `reports/internal/release-inputs/` appear in the public
  upload set, or the generated license bundle does not verify exactly, stop.
- If the installed notices do not include the hash-bound root `LICENSE`, or a
  platform redistributable lacks separate distribution-term review, stop.
- If release provenance does not verify against the tag, lockfiles, release
  notes, staged manifests, and artifacts, stop.
- If Windows signing, macOS signing/notarization, or Linux package evidence is
  missing for a public Desktop artifact, stop.
