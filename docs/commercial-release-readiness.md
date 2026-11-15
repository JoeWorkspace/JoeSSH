# Commercial Release Readiness

This is the fail-closed gate for funding, Founder, Pro, hosted Sync, or paid
support. It does not block a free Community source release, but Community
release notes must not advertise unavailable paid benefits.

## Identity And Contact

- [ ] The seller's truthful legal name and business form are published where
      required.
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
- [ ] `.github/FUNDING.yml` contains only a verified provider handle or HTTPS
      URL, with no placeholder.
- [ ] The logged-out funding flow, refund route, and withdrawal have been tested.

## Final Search

From a healthy release checkout, inspect the result and resolve every match:

```powershell
rg -n '\{\{[A-Z0-9_]+\}\}|VERIFIED_(HTTPS|GITHUB)' `
  SUPPORT.md PRIVACY.md REFUND_POLICY.md TERMS_OF_SALE.md TRADEMARKS.md `
  docs .github
```

Do not blindly replace tokens. Each replacement must match the verified live
account, legal identity, and public offer. Keep paid checkout and production
telemetry disabled if any required fact is unknown.
