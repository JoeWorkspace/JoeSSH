# Funding And Checkout Plan

Status checked: 2026-07-30. Provider eligibility and fees can change; verify
again before activation.

## Current State

The repository includes an operator-supplied
[voluntary-support page](voluntary-support.md) with Weixin Pay and Alipay QR
codes. It is separate from product checkout and promises no reward or software
benefit. `.github/FUNDING.yml` remains intentionally comments-only, so GitHub
does not render a Sponsor button before both payment methods pass the complete
live verification below. `.github/funding-operator-attestation.json` remains in
the exact `inactive` state. JoeSSH Community remains free and Pro/Founder remain
unavailable.

## Recommended Order

1. Use the canonical repository and releases to build trust and adoption.
2. Keep the repository support page separate from Store listing copy, binaries,
   application UI, downloads, updates, support priority, and roadmap decisions.
3. After every displayed payment method passes the live checks below, use the
   canonical support-page URL as the single custom GitHub Funding link. Treat
   any digital reward or software benefit as a later sale, not as this support
   lane.
4. Apply to Paddle for a later global Pro checkout, but do not integrate until
   the individual account, JoeSSH product category, domain, and real payout are
   approved.
5. Keep Lemon Squeezy as a fallback only after its store approval and the
   Mainland PayPal payout path have been tested.
6. Register an individual industrial and commercial household when direct
   domestic merchant checkout, invoicing, or transaction scale makes it
   appropriate; this is not the same as incorporating a company.

## Confirmed And Application-Dependent Paths

| Path                       | Status for a Mainland China individual developer                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Afdian                     | Official terms accept natural persons and software programs; suitable for the initial no-reward creator-support test after identity and payout setup                                                                |
| Paddle                     | Individuals/sole traders are structurally eligible and Mainland China is not on the unsupported-country list; the product, domain, identity, payout, and any port-forwarding category review still require approval |
| Lemon Squeezy              | Individuals and software are supported in principle; Mainland China is absent from direct bank payouts, so the practical route depends on approved store identity plus a verified PayPal payout                     |
| GitHub Sponsors            | Mainland China is not listed as a supported recipient region; do not use Hong Kong or Macao eligibility unless the owner actually qualifies there                                                                   |
| GitHub custom funding link | Supported; can point to one verified creator or checkout URL after activation                                                                                                                                       |
| Direct QR support page     | Operator-supplied personal Weixin Pay and Alipay codes are prepared for no-reward support; public-display eligibility, live payment, payout, and tax handling still require operator verification                   |

Official references:

- [Afdian terms](https://afdian.com/term) and
  [creator FAQ](https://guide.afdian.com/faq/faq-for-creators)
- [Paddle supported countries](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle),
  [business verification](https://www.paddle.com/help/start/account-verification/what-is-business-verification),
  and [restricted products](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle)
- [Lemon Squeezy supported countries](https://docs.lemonsqueezy.com/help/getting-started/supported-countries)
  and [store activation](https://docs.lemonsqueezy.com/help/getting-started/activate-your-store)
- [GitHub Sponsors regions](https://docs.github.com/zh/sponsors/getting-started-with-github-sponsors/about-github-sponsors)
  and [custom funding links](https://docs.github.com/zh/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/displaying-a-sponsor-button-in-your-repository)

## Separate Support From Sales

A no-reward support payment must be described as voluntary support. A payment
that delivers software, a license key, membership content, updates, hosted
service, or support is a sale and must show the deliverable, seller, price,
refund policy, and support route. Do not call a paid entitlement a donation.

A merchant of record may handle customer-side sales tax or VAT, but that does
not remove the developer's local income-reporting and tax duties.

## Activation Procedure

Before enabling the repository support page through `.github/FUNDING.yml`:

1. complete the platform's identity and payout verification with truthful owner
   information;
2. confirm from current, retainable platform rules that each displayed payment
   method accepts public QR display for no-reward support of the JoeSSH project,
   disclosing its SSH port-forwarding context if requested;
3. publish the truthful operator/contact, privacy/support route, and the payment
   limitations/non-purchase wording; future sale terms may remain explicitly
   inactive;
4. ensure the funding page distinguishes voluntary support from purchases;
5. for every displayed payment method, make a real small payment, verify the
   disclosed lack of a project-operated cancellation, reversal, refund, or
   automatic-return capability and of any promised project-operated remedy for
   mistaken or duplicate payments, record the platform's official
   unauthorized-payment route, and complete a payout/withdrawal;
6. record the platform account owner, public URL, fee schedule, payout route,
   and evidence date in a private operator record;
7. verify the exact canonical support-page URL from a logged-out desktop and
   mobile browser, then replace the comments-only funding config with only that
   URL;
8. in the same reviewed commit, change
   `.github/funding-operator-attestation.json` to `verified`, bind the exact same
   URL, record the real UTC verification date, and set all five reviewed checks
   to `true`;
9. run `npm run qa:commercial:community` without CLI confirmation flags and
   recheck the link from a logged-out browser.

Paid checkout is a separate lane. It must not reuse this funding attestation as
purchase evidence and still requires merchant approval, the complete policy
set, price/tax/delivery disclosures, customer portal, purchase/recovery/
cancellation/refund/failure drills, and `release:commercial:preflight`.

Do not paste placeholder handles or example URLs into `.github/FUNDING.yml`.
The committed attestation is public operational evidence, not a place for
account IDs, identity documents, transaction IDs, payout details, tokens, or
other secrets. Keep the private receipts and operator records outside the
repository.

The verification expires after 180 days. Repeat the ownership, logged-out page,
small-payment, payment-limitations/non-purchase wording, and payout checks before
updating `verifiedAt`; a future, impossible, or older date fails CI. URL changes
require a fresh verification and an atomic update of both files. The optional
`--funding-url ... --confirm-funding-verified` arguments are a one-time
diagnostic only and never replace the committed attestation.

## Configuration Template

After verification, replace the comments-only file with this single supported
minimal form:

```yaml
custom:
  - VERIFIED_HTTPS_FUNDING_URL
```

In the same commit, replace the inactive attestation with:

```json
{
  "schemaVersion": 1,
  "status": "verified",
  "fundingUrl": "VERIFIED_HTTPS_FUNDING_URL",
  "verifiedAt": "YYYY-MM-DD",
  "checks": {
    "destinationOwnedByVerifiedOperator": true,
    "loggedOutPageReachable": true,
    "smallPaymentCompleted": true,
    "paymentLimitationsAndNonPurchaseWordingVerified": true,
    "payoutCompleted": true
  }
}
```

`VERIFIED_...` and `YYYY-MM-DD` are documentation notation, not values that may
be committed. JSON formatting, fields, URL binding, booleans, and date freshness
are exact and fail closed. Use at most one initial destination to avoid
confusing support with product checkout. A future GitHub Sponsors handle needs a
separate reviewed checker change first; the current contract accepts only one
public HTTPS custom URL.
