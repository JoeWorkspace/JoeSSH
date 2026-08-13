# Commercial Release Readiness

This document has two separate fail-closed lanes. A voluntary-support link is
governed by the Community boundary plus **Funding Button** below and the
persistent public attestation in
`.github/funding-operator-attestation.json`; it does not unlock software,
support, or another paid benefit. Founder, Pro, hosted Sync, paid support, paid
checkout, and production telemetry require the complete commercial checklist.
Neither lane blocks a free Community source release with a repository-owned
voluntary-support link, but Community release notes must not advertise
unavailable paid benefits.

Before any paid launch, classify EU distribution with `--eu-market-scope` as
`not-offered`, `business-only`, `consumer-microenterprise-exempt`, or
`consumer-in-scope`, and run the paid gate with
`--confirm-eu-accessibility-assessed`. This is a fail-closed reassessment trigger,
not an EAA exemption or conformance claim. A consumer-facing checkout can itself
be an EAA-covered e-commerce service even when the standalone SSH application is
not a listed EAA product. Verify the applicable Member State law, the actual
buyer population, and any microenterprise basis before choosing the value.

## Identity And Contact

- [ ] The seller's truthful legal name and business form are published where
      required.
- [ ] For Microsoft Store release, the canonical local Partner Center identity
      supplies a seller name that exactly equals the protected
      `ATLASTERM_WINDOWS_LEGAL_PUBLISHER`; the same value is bound to NSIS ARP
      Publisher and the certificate's unique CN, or to Partner Center
      PublisherDisplayName for MSIX. Do not put a personal publisher name in
      command-line arguments, logs, or tracked policy sources; the remote page
      checker binds it from the gitignored identity file instead.
- [ ] A monitored support email or HTTPS form has been tested from a logged-out
      browser.
- [ ] Privacy and trademark contacts resolve to verified routes.
- [ ] Required address, registration, tax, invoice, and consumer complaint
      information is published for each market.
- [ ] No `{{...}}` placeholder remains in a policy exposed to customers.

## Offer

- [ ] The checkout names Community, Founder, Pro, or hosted Sync correctly.
- [ ] Platform, version, system requirements, features, limitations, delivery,
      update period, and support scope are explicit.
- [ ] Founder is capped and is not described as lifetime, equity, investment,
      or an unlimited roadmap promise.
- [ ] A one-time Pro license continues to run after its optional update period.
- [ ] Hosted capacity, backups, export, deletion, maintenance, incident response,
      and service wind-down are documented before a hosted sale.
- [ ] Community MIT functionality remains available without paid activation.

## Checkout And Consumer Flow

- [ ] Provider identity, product approval, country eligibility, payout account,
      and public domain are verified.
- [ ] Price, currency, taxes, total, one-time/recurring status, renewal price,
      and cancellation route appear before the final button.
- [ ] Terms of Sale, Privacy Policy, Refund Policy, and Support are linked before
      payment and archived with the offer version.
- [ ] A real purchase, license delivery, recovery, cancellation, refund, failed
      payment, and payout have been tested.
- [ ] Duplicate and unauthorized-charge procedures are documented.
- [ ] Transaction and tax records have a private retention and backup plan.

## Privacy And Security

- [ ] The data-flow inventory matches the shipped build and live providers.
- [ ] Every processor, purpose, region, retention period, and deletion route is
      stated in `PRIVACY.md`.
- [ ] Telemetry remains disabled until its production endpoint and disclosures
      are complete; user opt-in and runtime disable are verified.
- [ ] License activation collects only disclosed data and has an offline or
      recovery story appropriate to the offer.
- [ ] Security reports use the private route in `SECURITY.md`; public support
      never requests secrets.

## License, Brand, And Dependencies

- [ ] The paid boundary does not relicense code already published under MIT.
- [ ] Official artifacts use JoeSSH Community consistently and the certificate
      publisher matches the verified signer.
- [ ] The trademark owner/contact field is completed before discretionary
      permissions or enforcement.
- [ ] The exact release has a verified SBOM, checksums, required license text,
      third-party notices, and asset provenance.

## Funding Button

- [ ] The destination is owned by the verified project operator.
- [ ] The page clearly distinguishes voluntary support from a purchase.
- [x] The current GitHub Sponsor destination is the exact repository-owned
      voluntary-support notice, not a direct checkout or third-party profile.
- [ ] Every payment method displayed on the destination has separately passed
      ownership, public-display, recipient-display, small-payment,
      platform-rules, and payout checks.
- [ ] The page works while logged out on desktop and mobile, and a real scan
      shows the exact disclosed recipient: Weixin Pay `Joe(*添)` and Alipay
      `慈善家(*添)`.
- [ ] The page discloses that JoeSSH cannot cancel, reverse, refund, or
      automatically return personal-code payments and does not promise a
      project-operated remedy for mistaken or duplicate payments; it names the
      platforms' official unauthorized-payment routes and warns against posting
      payment details publicly.
- [ ] `.github/FUNDING.yml` contains exactly one public HTTPS custom URL, with no
      placeholder.
- [ ] `.github/funding-operator-attestation.json` uses the exact reviewed schema,
      binds that URL byte-for-byte, records a real non-future UTC `verifiedAt`
      date no more than 180 days old, and sets the five live checks to `true`.
- [ ] Private receipts, identity documents, transaction IDs, and payout records
      remain outside the repository; the committed file contains only public,
      non-secret operator assertions.

This section together with the direct-destination procedure in
`docs/funding-and-checkout.md` is the whole repository gate for a no-reward
voluntary-support button. The checkout/consumer-flow sections above remain
mandatory for a paid offer, but they are not prerequisites for linking the
repository-owned notice. That link must retain the exact
`repository-link-unverified`
attestation: its URL is bound, its date is null, and all five payment/operator
checks remain false. A future direct funding destination still requires the
complete current `verified` attestation.

## Final Search

Before a paid or hosted launch, inspect the customer-facing result and resolve
every match:

```powershell
rg -n '\{\{[A-Z0-9_]+\}\}|VERIFIED_(HTTPS|GITHUB)' `
  SUPPORT.md PRIVACY.md REFUND_POLICY.md TERMS_OF_SALE.md TRADEMARKS.md `
  .github/FUNDING.yml .github/funding-operator-attestation.json
```

Do not blindly replace tokens. Each replacement must match the verified live
account, legal identity, and public offer. Documentation-only templates remain
notation, not publishable values. Keep paid checkout and production telemetry
disabled if any required fact is unknown.
