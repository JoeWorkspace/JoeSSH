# Commercialization And Signing Strategy

Status checked: 2026-07-30. Vendor eligibility, pricing, and regional availability
can change; verify them again before a release purchase or application.

## Recommendation

Use JoeSSH Community as the open-source trust and acquisition channel. Validate
repeat Windows usage first, then validate voluntary support, and only then test
a narrowly defined one-time Founder or Pro offer. Do not start by putting the
basic SSH terminal behind a subscription, and do not make a hosted control
plane the first revenue dependency for a solo developer.

The public product name is JoeSSH. Use `JoeSSH Community` for open-source
artifacts and signing applications; keep the certificate publisher field tied
to the eventual legal entity rather than inventing a publisher identity.

For a Mainland China individual developer, start with the free Community
release and a verified creator-support page. The first evidence threshold is
the one defined by the invite plan: at least 10 repeat users and 5 real
supporters. That threshold permits merchant-of-record applications, customer
discovery, and a non-selling prototype; it does not permit checkout. A Founder
sale still requires the stronger launch gate in
[pricing-hypotheses.md](pricing-hypotheses.md), product-category approval, and
a tested payout route. Direct
domestic merchant checkout can later use a truthful eligible individual
business registration if required; forming a company is not the first step.
The dated provider findings and fail-closed funding configuration are in
[funding-and-checkout.md](funding-and-checkout.md).

For Microsoft Store onboarding, “solo developer” does not automatically mean
an Individual account. Microsoft currently reserves Individual onboarding for
distribution unrelated to a business, trade, or profession. A freelancer or
independent developer distributing commercially is directed to the free
Company onboarding flow, which still requires truthful government business
registration or equivalent documents plus domain/contact verification. Before
planning Store revenue, verify whether a Mainland China individual-business
registration can satisfy that review; otherwise keep the Individual release
genuinely non-commercial. Partner Center does not convert an Individual account
in place to Company.

This fits the product for three reasons:

1. SSH software handles credentials and remote execution, so inspectable source
   is a meaningful adoption advantage.
2. The repository already ships a capable local-first Desktop/Core/Sync stack
   under MIT. Existing MIT releases cannot later be made proprietary.
3. The first credible paid value is a focused local workflow improvement proven
   by users. Team policy, JIT access, managed Sync, audit retention, and support
   can become later products only after demand and operating capacity exist.

## Product Boundary

Keep the community edition useful on its own:

- Desktop SSH, PTY, SFTP, port forwarding, known-host verification, safety
  checks, connection profiles, and local storage.
- The Rust core and a self-hostable single-node Sync service.
- Basic Web Admin visibility and documented import/export formats.

Potential later paid value must be newly created and additive:

- Focused local workflow convenience that at least 10 qualified users request
  repeatedly, such as advanced workspace automation or repeatable operations.
- Optional update entitlement for that paid local capability, without disabling
  the purchased version when the update term ends.
- Much later, hosted Sync with backups, upgrades, availability targets, export,
  deletion, and regional hosting.
- Team vaults, JIT approval workflows, SSO/OIDC, SCIM, RBAC, and policy packs.
- Long-retention audit search/export, device posture, compliance evidence, and
  admin APIs.
- Enterprise support, deployment assistance, private networking, and custom
  retention or key-management requirements.

The paid service should be a real service boundary, not disabled buttons in the
community UI. Any unavailable feature must be labeled as unavailable or omitted.

## Initial Packaging Hypothesis

Treat pricing as an experiment until activation and retention data exists:

| Tier       | Intended user                    | Candidate offer                      |
| ---------- | -------------------------------- | ------------------------------------ |
| Community  | Individual and self-hoster       | Free, local-first, self-hosted Sync  |
| Pro        | Individual Windows operator      | New local workflow value and updates |
| Team       | Small engineering/SRE team       | Shared vaults, JIT, audit, RBAC      |
| Enterprise | Regulated or larger organization | SSO/SCIM, compliance, SLA, support   |

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
- Published MIT code remains MIT. A proprietary local Pro module cannot be
  committed to this MIT repository and then treated as exclusive; it needs a
  separate private codebase/package and a reviewed plugin, IPC, or service
  boundary. Alternatively, keep it MIT and sell convenience/support without
  claiming code exclusivity.
- Future proprietary hosted services should live behind a clean network/API
  boundary.
- SignPath Foundation's free OSS terms disallow commercial dual licensing and
  proprietary components in the signed project. Confirm eligibility with
  SignPath before combining an OSS-signed client with affiliated proprietary
  modules or services.

## Signing Options

### Windows

| Option                          | Cost/eligibility                                                                             | Public trust                                     | JoeSSH fit                                      |
| ------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------ | ----------------------------------------------- |
| Microsoft Store MSIX            | Free Store re-signing after certification; worldwide Store path                              | Store signs, hosts, and updates the package      | Preferred first feasibility path                |
| Microsoft Store MSI/EXE         | Publisher buys/obtains a public-CA certificate and operates hosting and updates              | Publisher Authenticode signature remains in use  | Fallback for the existing Tauri NSIS installer  |
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

1. Work only from a healthy Git checkout. If a planning workspace has incomplete
   Git metadata, move reviewed changes into a healthy checkout before tags,
   provenance, signing, or release automation.
2. The one-day Packaging Tool feasibility stage is complete. Use the protected
   source-build MSIX workflow as the primary Community path: bind the exact
   reviewed `main` SHA and Partner identity, compile and MakeAppx-roundtrip the
   package, preserve both Sigstore attestations, then run independent lifecycle,
   WACK, UI, upgrade, uninstall, and rollback qualification on the exact bytes.
   Microsoft can re-sign, host, and update an accepted Store MSIX without a
   separate public code-signing purchase.
3. Keep Tauri-native NSIS only as a fallback when the current source-built MSIX
   path exposes a new, reproducible compatibility blocker. That route requires
   every installer and installed PE
   to be signed by a public-trust CA identity, plus the project's own immutable
   versioned hosting and update plan. SignPath Foundation may be evaluated for
   the fully open-source Community build only; confirm eligibility and do not
   assume it covers a future proprietary Pro module.
4. Pay for the Apple Developer Program only when a tested macOS artifact and
   support capacity are ready.
5. Add GitHub Artifact Attestations and Sigstore signatures to Linux packages,
   checksums, SBOMs, and release provenance.
6. Keep the existing fail-closed signing/notarization evidence checks.
7. After the repeat-user and real-supporter thresholds are met, apply for the
   payment path and prototype one specific local Founder/Pro workflow without
   enabling checkout. Launch only after the stronger user/demand threshold in
   [pricing-hypotheses.md](pricing-hypotheses.md) and every commercial gate
   passes.
8. Consider hosted Sync or team operations only after real multi-device/team
   demand, backup/restore, account deletion, incident response, and sustainable
   on-call capacity are proven.

Paid checkout and production telemetry remain disabled until the full
[commercial-release-readiness.md](commercial-release-readiness.md) checklist
passes. The current no-reward voluntary-support link targets the repository-
owned notice and is bound to the exact `repository-link-unverified` attestation
with no payment verification claims. A future direct external destination still
requires the complete Funding Button verification lane; neither state
authorizes checkout or paid benefits.
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
- Microsoft Store account onboarding:
  https://learn.microsoft.com/en-us/windows/apps/publish/partner-center/open-a-developer-account
- Microsoft Windows distribution-path comparison:
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path
- Microsoft Windows code-signing options:
  https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options
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
