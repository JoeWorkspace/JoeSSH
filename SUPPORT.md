# JoeSSH Support

JoeSSH Community is a free, MIT-licensed, community-supported project. Support
is provided on a best-effort basis; downloading or using JoeSSH Community does
not create a service-level agreement, guaranteed response time, or entitlement
to private support.

## Public Support Scope

The first release line is Windows-first. The supported surface for a specific
version is the surface named in that version's release notes:

- JoeSSH Community Desktop on Windows is the primary end-user target.
- Web Admin and the single-process self-hosted Sync Service are supported
  according to their deployment documentation and Public Beta limits.
- macOS and Linux packages are supported only when the release notes mark their
  signed or packaged artifacts as release-ready.
- Mobile native apps remain preflight software until a release note explicitly
  promotes them into the public support scope.

Community support covers reproducible product defects, documentation errors,
installation problems with official artifacts, and focused feature requests. It
does not include operating a user's SSH hosts, recovering third-party systems,
custom deployments, incident response, or general infrastructure consulting.

## Where To Ask

- Use the canonical repository's issue tracker for reproducible bugs.
- Use the feature-request template for a focused product proposal.
- Check the release notes, known limitations, and existing issues before filing.
- Report security vulnerabilities only through the private route documented in
  [SECURITY.md](SECURITY.md). Never disclose a vulnerability in a public issue.

The Store release support route is still blocked. Before publication, render
the static support template from a private staging copy, insert a monitored
public HTTPS page or form that works while logged out, and pass the checklist in
[docs/commercial-release-readiness.md](docs/commercial-release-readiness.md)
before the free Store listing is submitted. Do not commit the personal
publisher identity or private contact material here. No customer portal or
paid-support channel is currently offered.

## Voluntary Support

The [voluntary-support page](docs/voluntary-support.md) provides optional
Weixin Pay and Alipay QR codes supplied by the independent maintainer. A support
payment is not a purchase and creates no software entitlement, private-support
right, response target, roadmap influence, or other benefit. JoeSSH Community
remains free and MIT-licensed whether or not a person provides support.

Payment questions are separate from product support. These are personal payment
codes. JoeSSH creates no order, cannot use the codes to cancel, reverse, refund,
or automatically return a payment, and does not offer or promise a
project-operated return or remedy for mistaken, duplicate, or incorrectly
entered payments. For suspected account misuse or an unauthorized payment, use
the official dispute channel in the payment record or contact official Weixin
Pay or Alipay customer service; available remedies are governed by platform
rules and applicable law. Never post a real name, phone number, payment
screenshot, transaction identifier, or other payment detail in a public issue,
Discussion, or pull request.

## A Useful Bug Report

Include:

- the JoeSSH version and whether it came from an official release artifact or a
  source build;
- the operating system, architecture, and installation format;
- the smallest reliable reproduction;
- expected and actual behavior;
- sanitized logs or screenshots, if they are necessary.

Before attaching anything, remove SSH host names and addresses, usernames,
commands, terminal output, file names and paths, private keys, passwords,
passphrases, bearer tokens, license keys, and other secrets. When in doubt,
describe the symptom without attaching the data.

## Self-Hosted Components

The person or organization running Web Admin or the Sync Service is responsible
for its infrastructure, access controls, backups, retention, monitoring, and
compliance. Community maintainers can review a minimal reproducible defect, but
cannot inspect or administer a private deployment.

The Public Beta Sync Service is a single-process service with bounded JSON
storage. Its documented limits are not an enterprise availability or compliance
commitment. See
[docs/self-hosting-sync.md](docs/self-hosting-sync.md).

## Pro, Founder, And Paid Support

JoeSSH Pro, Founder access, hosted Sync, and paid support are product
hypotheses, not currently available offers. No issue, pull request, sponsorship,
or contribution creates a future Pro entitlement.

If a paid offer launches, its checkout page must state the exact entitlement,
support channel, response target (if any), term, update period, price, renewal
behavior, and refund policy. Community support remains available independently
and may not be degraded to manufacture a paid-support need.
