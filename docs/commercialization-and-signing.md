# Commercialization And Signing Strategy

Status checked: 2026-07-30. Vendor eligibility, pricing, and regional availability
can change; verify them again before a release purchase or application.

## Recommendation

Use JoeSSH as an open-source trust and acquisition channel, then monetize the
hosted team control plane and enterprise operations. Do not start by putting the
basic SSH terminal behind a subscription.

The public product name is JoeSSH. Use `JoeSSH Community` for open-source
artifacts and signing applications; keep the certificate publisher field tied
to the eventual legal entity rather than inventing a publisher identity.

For a Mainland China individual developer, start with the free Community
release and a verified creator-support page. Apply to a merchant of record for
global Pro sales only after product-category and real payout approval. Direct
domestic merchant checkout can later use an individual industrial and
commercial household; forming a company is not required. The dated provider
findings and fail-closed funding configuration are in
[funding-and-checkout.md](funding-and-checkout.md).

This fits the product for three reasons:

1. SSH software handles credentials and remote execution, so inspectable source
   is a meaningful adoption advantage.
2. The repository already ships a capable local-first Desktop/Core/Sync stack
   under MIT. Existing MIT releases cannot later be made proprietary.
3. The strongest differentiated features are team policy, JIT access, managed
   sync, audit retention, device posture, and support, not terminal rendering.

## Product Boundary

Keep the community edition useful on its own:

- Desktop SSH, PTY, SFTP, port forwarding, known-host verification, safety
  checks, connection profiles, and local storage.
- The Rust core and a self-hostable single-node Sync service.
- Basic Web Admin visibility and documented import/export formats.

Charge for operated services and organizational controls:

- Hosted encrypted Sync with backups, upgrades, availability targets, and
  regional hosting.
- Team vaults, JIT approval workflows, SSO/OIDC, SCIM, RBAC, and policy packs.
- Long-retention audit search/export, device posture, compliance evidence, and
  admin APIs.
- Enterprise support, deployment assistance, private networking, and custom
  retention or key-management requirements.

The paid service should be a real service boundary, not disabled buttons in the
community UI. Any unavailable feature must be labeled as unavailable or omitted.

## Initial Packaging Hypothesis

Treat pricing as an experiment until activation and retention data exists:

| Tier       | Intended user                    | Candidate offer                       |
| ---------- | -------------------------------- | ------------------------------------- |
| Community  | Individual and self-hoster       | Free, local-first, self-hosted Sync   |
| Pro        | Individual across devices        | Hosted Sync, backup, priority updates |
| Team       | Small engineering/SRE team       | Shared vaults, JIT, audit, RBAC       |
| Enterprise | Regulated or larger organization | SSO/SCIM, compliance, SLA, support    |

Do not finalize prices before measuring first real SSH activation, day-7
retention, multi-device Sync adoption, team invitations, and willingness to pay
for managed operations.

Candidate Founder and Windows Pro price tests, entitlement limits, and stop
signals are documented in [pricing-hypotheses.md](pricing-hypotheses.md). They
are internal hypotheses, not current offers.

## License And Trademark Implications

- The repository is currently MIT. Anyone may fork, redistribute, host, or sell
  the current code if they preserve the license notice.
- Do not change the existing license or add a CLA without a separate legal and
  contributor review.
- [TRADEMARKS.md](../TRADEMARKS.md) distinguishes official builds without
  removing source-code freedoms.
- Future proprietary services should live behind a clean network/API boundary.
  Published MIT code remains MIT.
- SignPath Foundation's free OSS terms disallow commercial dual licensing and
  proprietary components in the signed project. Confirm eligibility with
  SignPath before combining an OSS-signed client with affiliated proprietary
  modules or services.

## Signing Options

### Windows

| Option                          | Cost/eligibility                                                                             | Public trust                                     | JoeSSH fit                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| SignPath Foundation             | Free for accepted OSS projects                                                               | Authenticode certificate issued through SignPath | Best community-build candidate                  |
| Microsoft Artifact Signing      | Paid Azure service; regional identity restrictions apply                                     | Managed public-trust signing                     | Commercial option only for an eligible entity   |
| Certum Open Source Code Signing | Not free; official shop showed EUR 25 activation-code pricing and required existing hardware | Microsoft-trusted certificate                    | Fallback, but include hardware and renewal cost |
| Self-signed certificate         | Free                                                                                         | Not trusted on user machines                     | Internal QA only                                |

SignPath Foundation states that its OSS service is free, with the key held in an
HSM. Its published conditions require an OSI-approved license, no commercial
dual licensing, no proprietary component, an actively maintained and already
released project, documentation, and additional privacy/build rules.

Microsoft Artifact Signing pricing lists Basic and Premium monthly plans. The
official FAQ currently limits Public Trust identity validation to organizations
in the USA, Canada, European Union, and United Kingdom, plus individual
developers in the USA and Canada. A China-based person or entity should not plan
around that service unless Microsoft expands eligibility or a supported legal
entity owns the release.

### macOS

There is no equivalent free path for a normal public download. Apple documents:

- A free Apple account is for development and testing.
- The Apple Developer Program costs USD 99 per membership year.
- Notarization and Developer ID distribution are paid-program benefits.

Tauri also notes that a free account cannot notarize the app, so users still see
an unverified warning. Budget the Apple membership if macOS is in the public
beta scope; otherwise publish source/build instructions and defer the macOS
binary rather than claiming a fully trusted release.

### Linux And Supply-Chain Proof

- Sigstore Cosign supports keyless OIDC signing with short-lived certificates
  and transparency logging.
- GitHub Artifact Attestations are available for public repositories on GitHub
  Free, Pro, and Team plans.
- These are useful for AppImage/deb/rpm verification, containers, SBOMs, and
  provenance. They do not replace Windows Authenticode or macOS Developer ID.

## Practical Release Path

1. Verify the release checkout with `git fsck --strict` and review all source
   changes. The local metadata recovery is recorded in
   [the repository handoff playbook](repository-release-handoff.md); it does not
   establish clean source, tag, signature, or release provenance.
2. Keep the first community binary fully open source and apply to SignPath
   Foundation for Windows signing.
3. Pay for the Apple Developer Program only when a tested macOS artifact and
   support capacity are ready.
4. Add GitHub Artifact Attestations and Sigstore signatures to Linux packages,
   checksums, SBOMs, and release provenance.
5. Keep the existing fail-closed signing/notarization evidence checks.
6. Launch hosted Sync as an invite-only paid pilot before building broad billing
   UI. Validate operational demand with a small number of real teams.

Paid checkout, production telemetry, and live funding links remain disabled
until [commercial-release-readiness.md](commercial-release-readiness.md) passes.
The public policy set is `SUPPORT.md`, `PRIVACY.md`, `REFUND_POLICY.md`,
`TERMS_OF_SALE.md`, `TRADEMARKS.md`, and `THIRD_PARTY_NOTICES.md` at the
repository root. Files containing `{{...}}` values are intentionally
fail-closed drafts and must not be represented as completed seller disclosures.

## Official Sources

- SignPath Foundation: https://signpath.org/
- SignPath OSS conditions: https://signpath.org/terms
- Microsoft Artifact Signing overview:
  https://learn.microsoft.com/en-us/azure/artifact-signing/overview
- Microsoft Artifact Signing FAQ and regional eligibility:
  https://learn.microsoft.com/en-us/azure/artifact-signing/faq
- Microsoft pricing:
  https://azure.microsoft.com/en-us/pricing/details/trusted-signing/
- Apple membership comparison:
  https://developer.apple.com/support/compare-memberships/
- Tauri Windows signing: https://v2.tauri.app/distribute/sign/windows/
- Tauri macOS signing: https://v2.tauri.app/distribute/sign/macos/
- Sigstore keyless signing:
  https://docs.sigstore.dev/cosign/signing/signing_with_containers/
- GitHub Artifact Attestations:
  https://docs.github.com/en/actions/security-for-github-actions/using-artifact-attestations/using-artifact-attestations-to-establish-provenance-for-builds
- Certum OSS product page:
  https://shop.certum.eu/open-source-code-signing-code.html
