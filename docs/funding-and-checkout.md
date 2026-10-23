# Funding And Checkout Plan

Status checked: 2026-07-30. Provider eligibility and fees can change; verify
again before activation.

## Current State

No sponsorship or checkout destination is configured. `.github/FUNDING.yml` is
intentionally comments-only, so GitHub renders no unverified funding button.
JoeSSH Community remains free and Pro/Founder remain unavailable.

## Recommended Order

1. Use the canonical repository and releases to build trust and adoption.
2. When a verified creator page exists, add one custom funding link for
   voluntary support or a clearly described digital reward.
3. Apply to Paddle for a later global Pro checkout, but do not integrate until
   the individual account, JoeSSH product category, domain, and real payout are
   approved.
4. Keep Lemon Squeezy as a fallback only after its store approval and the
   Mainland PayPal payout path have been tested.
5. Register an individual industrial and commercial household when direct
   domestic merchant checkout, invoicing, or transaction scale makes it
   appropriate; this is not the same as incorporating a company.

## Confirmed And Application-Dependent Paths

| Path                       | Status for a Mainland China individual developer                                                                                                                                                                    |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Afdian                     | Official terms accept natural persons and software programs; suitable for immediate creator support or digital rewards after identity and payout setup                                                              |
| Paddle                     | Individuals/sole traders are structurally eligible and Mainland China is not on the unsupported-country list; the product, domain, identity, payout, and any port-forwarding category review still require approval |
| Lemon Squeezy              | Individuals and software are supported in principle; Mainland China is absent from direct bank payouts, so the practical route depends on approved store identity plus a verified PayPal payout                     |
| GitHub Sponsors            | Mainland China is not listed as a supported recipient region; do not use Hong Kong or Macao eligibility unless the owner actually qualifies there                                                                   |
| GitHub custom funding link | Supported; can point to one verified creator or checkout URL after activation                                                                                                                                       |

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

Before adding a live funding or checkout URL:

1. complete the platform's identity and payout verification with truthful owner
   information;
2. confirm in writing that the exact JoeSSH offer and its SSH port-forwarding
   functionality are accepted;
3. publish the seller, privacy, terms, refund, support, and trademark contacts;
4. ensure the funding page distinguishes voluntary support from purchases;
5. make a real small payment, delivery, cancellation, refund, and withdrawal;
6. record the platform account owner, public URL, fee schedule, payout route,
   and evidence date in a private operator record;
7. replace the comments-only funding config with only the verified URL;
8. recheck the link from a logged-out browser.

Do not paste placeholder handles or example URLs into `.github/FUNDING.yml`.

## Configuration Template

After verification, replace the comments-only file with one of these minimal
forms:

```yaml
custom:
  - VERIFIED_HTTPS_FUNDING_URL
```

or, only if GitHub Sponsors later confirms recipient eligibility:

```yaml
github:
  - VERIFIED_GITHUB_SPONSORS_HANDLE
```

`VERIFIED_...` is documentation notation, not a value that may be committed.
Use at most one initial destination to avoid confusing support with product
checkout.
