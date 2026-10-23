# Pricing And Packaging Hypotheses

Status: internal experiment, not a public offer.

JoeSSH remains MIT-licensed and Windows-first. Community is a complete free
local tool; Pro and Founder are later experiments around additional local
workflow value or operated services. Existing MIT code and releases stay MIT.

## Proposed Packaging

| Tier          | Hypothesis                                   | Candidate price            | Boundary                                                                                             |
| ------------- | -------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------- |
| Community     | Permanent free acquisition and trust channel | Free                       | Local SSH, PTY, SFTP, forwarding, known hosts, profiles, safety checks, self-hosted single-node Sync |
| Founder pilot | Limited early-adopter Windows package        | CNY 199 or USD 29 one-time | Named preview features, updates through 1.0 plus 12 months; no lifetime cloud or support promise     |
| Pro           | Later Windows individual license             | CNY 299 or USD 39 one-time | Purchased major version plus 12 months of updates; optional renewal, not forced subscription         |
| Hosted Sync   | Later operated service                       | Not priced                 | Separate recurring offer only after operational, privacy, account, export, and wind-down readiness   |

These are willingness-to-pay test points, not final prices. Do not put them in
the product or checkout until a seller, channel, entitlement system, refund
flow, and support route are ready.

## Founder Guardrails

- Cap the first cohort at 100 licenses.
- Describe exact included features; “all future features” is prohibited.
- Do not describe the entitlement as lifetime.
- Do not bundle hosted Sync, storage, SLA, or guaranteed support without a
  stated term and capacity.
- Apply the same 14-day proposed refund window as Pro.
- Give Founder users a stable license-recovery and feedback route.
- Treat feedback access as optional participation, not unpaid labor.

## Pro Guardrails

- Community must stay useful without activation.
- Paid value should be additive workflow capability or an operated service, not
  removal of MIT functionality.
- One-time local licensing is the first hypothesis because it matches an
  individual Windows utility and avoids subscription fatigue.
- Any update renewal is optional; an expired update period must not disable the
  purchased version.
- Hosted Sync and team operations are separate products with separate cost and
  reliability assumptions.

## Unit-Economics Checks

At low prices, a percentage fee plus a fixed per-transaction fee is material.
Before confirming a price, model:

- payment or merchant-of-record fee;
- refund and chargeback reserve;
- currency conversion and payout fees;
- indirect tax handling and local income tax;
- code signing, hosting, storage, monitoring, and support time;
- the expected share of users needing manual license recovery.

Use a verified live fee schedule rather than copying dated rates into checkout.
For each experiment, record gross receipts, all channel fees, refunds,
chargebacks, tax reserves, support hours, and net proceeds.

## Decision Gates

Launch Founder only after at least 30 external Windows users have completed a
real SSH session and at least 10 request the same clearly paid-worthy workflow.
Move from Founder to Pro only when activation, day-30 use, refund rate, support
load, and license recovery are understood.

Hosted Sync should wait until there is evidence of repeat multi-device demand,
tested backup/restore, an account and deletion model, and a sustainable on-call
plan. Team and Enterprise pricing should not be invented before real team
pilots.

## Success And Stop Signals

Useful pilot signals:

- paid conversion among invited qualified users;
- activation within 24 hours;
- day-30 use of the paid capability;
- refund and chargeback rates;
- support minutes per active license;
- net receipts after all fees.

Stop or redesign when purchasers mainly pay to support the project rather than
for the stated entitlement, a feature cannot be explained without roadmap
promises, support load overwhelms development, or a payment provider will not
approve the product or payout route.
