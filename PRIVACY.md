# JoeSSH Privacy Policy

Last updated: 2026-08-01

> **Publication status: fail-closed Store source.** This tracked file is not the
> public Microsoft Store privacy URL. JoeSSH does not currently operate a public
> hosted service, paid checkout, customer account system, or production
> telemetry endpoint. Render the Store page from the static template in private
> staging, insert the verified individual publisher and public contact there,
> and keep those personal values out of this repository. Any future hosted,
> telemetry, account, or paid service requires a new policy update before it is
> enabled.

This policy explains how JoeSSH Community Desktop, Web Admin, the self-hosted
Sync Service, and any future operator-run service handle information. It does
not govern an SSH server, network, identity provider, hosting provider, or other
third-party system selected or operated by the user.

## 1. Who Is Responsible

For the current free, noncommercial JoeSSH Community release, the responsible
publisher is:

- legal name: `{{SELLER_LEGAL_NAME}}`;
- publishing capacity: an individual acting personally, with no company;
- privacy contact: `{{PRIVACY_CONTACT_EMAIL_OR_FORM_URL}}`.

The public Microsoft Store listing identifies the same verified individual
publisher. If a postal address becomes legally required for a selected market,
it must be supplied through the applicable Store or legal disclosure before
that market is enabled; no placeholder address is presented as a real address.

For a self-hosted Sync Service or Web Admin deployment, the person or
organization operating that deployment controls the server-side information.
That operator must provide its own privacy disclosures. Installing the
open-source server does not send its ledger to the JoeSSH project.

## 2. Community Defaults

JoeSSH Community is local-first:

- it does not require a JoeSSH account;
- SSH, SFTP, terminal, and port-forwarding traffic goes between the user's
  device and the destination the user selects;
- the project does not receive that traffic merely because JoeSSH is used;
- telemetry is unavailable or off unless a release operator configures an
  endpoint and the user separately opts in;
- the self-hosted Sync Service is run and controlled by its operator.

## 3. Information Stored On The Device

Depending on the feature used, JoeSSH Desktop may store the following in its
application or browser-profile storage:

- locale, theme, layout, onboarding state, and telemetry-consent choice;
- connection names, host values, ports, usernames, groups, tags, ordering, and
  favorite or recent-connection state;
- recent command text used by local convenience features;
- known-host fingerprints and related verification metadata;
- local import/export preferences and other settings.

Host values, usernames, and command text can be sensitive even though they stay
local by default. Device or browser access controls protect this data; users
should use an appropriately secured operating-system account and storage
volume. Passwords, passphrases, and private-key contents are processed in memory
when supplied for a connection and are excluded from the documented profile
persistence and telemetry payloads.

Local data remains until the user deletes it through the product, clears the
application/browser data, or removes the relevant operating-system profile.
Uninstall behavior varies by platform and may leave application data behind.

## 4. Direct Connections

When a user connects to an SSH or SFTP server or starts a port forward, JoeSSH
processes connection details, credentials, commands, terminal output, file
paths, and file content as needed to perform the requested operation. This
information is not sent to a JoeSSH-operated service by default. The selected
server, network operator, proxy, DNS provider, or device administrator may
observe or log traffic according to its own configuration.

JoeSSH can place user-requested text on the system clipboard. Clipboard history,
cloud clipboard, endpoint security, and other operating-system features are
controlled by the user's device environment.

## 5. Self-Hosted Sync And Web Admin

A self-hosted Sync Service can process:

- device identifiers, device labels, platform values, and registration times;
- sync cursors, change identifiers, entity types and identifiers, change
  payloads, and timestamps;
- bounded administration audit events and service metrics;
- network metadata normally present in HTTP and reverse-proxy logs.

The current Public Beta server stores its configured JSON ledger until the
self-hosting operator deletes, replaces, or restores it. Its recent
administration audit list is bounded, but its sync change history is retained
for replay subject to operator-configured quotas. Backups and proxy logs have
the retention selected by the operator.

The Public Beta Sync protocol does not provide end-to-end payload encryption.
The service stores each JSON payload as submitted. Deployment operators must
use TLS for non-loopback traffic, protect the ledger and its backups, and tell
their users not to submit private keys, passwords, bearer tokens, terminal
output, or other secrets. A client that needs field confidentiality must
encrypt those fields before submission and manage its own keys.

Web Admin requests data from the endpoint configured by its operator. A
deployment must keep admin credentials server-side behind the documented
same-origin proxy. The JoeSSH project does not receive a self-hosted snapshot
unless the deployment operator deliberately sends it.

## 6. Optional Error Telemetry

Production error telemetry is not operated for this release. The current
Community publication has no telemetry processor, production endpoint,
cross-border telemetry transfer, or server-side telemetry retention period.
A future build may expose the existing opt-in control only after this policy is
updated to identify the real endpoint operator, processor, destination
countries, retention period, and deletion route.

If configured and explicitly enabled by the user, the client is designed to
send a bounded, sanitized error report containing items such as:

- app name and version, platform or browser user-agent, time, and sanitized app
  URL;
- error class, sanitized message and stack, count, and coarse performance data;
- bounded, sanitized diagnostic breadcrumbs and non-sensitive tags.

The telemetry sanitizer is designed to exclude SSH hosts, usernames, commands,
terminal output, file paths and names, file content, clipboard content, private
keys, passwords, passphrases, and authentication or sync tokens. Sanitization
reduces risk but is not a guarantee; users should still inspect any manually
submitted diagnostic material.

Telemetry consent can be withdrawn in settings. Withdrawal stops new
submissions and clears the in-memory queue in the current client. Because no
production endpoint is configured for this release, the JoeSSH publisher does
not receive or retain a server-side telemetry record. Production telemetry must
remain disabled until the disclosures above are added and reviewed.

## 7. Support And Security Reports

Information included in an issue or support request is supplied by the
submitter. Public issues are visible to everyone, so they must not contain
secrets or private infrastructure details. The project may process a contact
identifier, issue content, attachments, and follow-up correspondence to
investigate the report.

Security reports use the private route in [SECURITY.md](SECURITY.md). Security
material is used to validate, remediate, coordinate, and disclose the issue.
GitHub retains public issues and private vulnerability reports under its own
service terms and retention practices. The publisher may retain the minimum
report content needed to investigate, remediate, and document a security issue.
No paid-support record system is operated for this release.

## 8. Purchases And Licensing

JoeSSH Community is free. JoeSSH Pro, Founder access, hosted Sync, and paid
support are not currently for sale.

No checkout provider, merchant of record, license-delivery provider, purchase
record, or payment-card flow is used for this release. Checkout must remain
disabled until a later policy names the real providers, information exchanged,
retention periods, customer rights, and verified live account.

## 9. Purposes And Legal Grounds

Where applicable law requires a legal ground, information may be processed:

- to perform a requested connection, sync, support, or paid-service contract;
- with consent, for optional error telemetry;
- for legitimate security, abuse-prevention, and reliability interests that do
  not override the user's rights;
- to comply with tax, accounting, consumer-protection, and other legal duties.

The precise ground and controller role can depend on the user's location and
whether a deployment is local, self-hosted, or operated by JoeSSH.

## 10. Sharing, Transfers, And Sale Of Information

The Community client does not sell personal information. Local data is not
shared with advertisers. A self-hosting operator chooses its own infrastructure
and service providers.

Any future JoeSSH-operated processor must be listed in this policy before data
is sent to it. If information is transferred across borders, the operator will
use the safeguards required by applicable law and disclose the relevant
destinations. The absence of a processor in this release is not permission to
enable one without updating the policy.

## 11. Security

JoeSSH uses measures such as local-first defaults, opt-in telemetry, payload
redaction, scoped authentication, explicit CORS origins, release checksums, and
dependency review. No software or transmission is completely secure. Users and
self-hosting operators remain responsible for endpoint security, backups,
access control, token rotation, TLS termination, and server configuration.

## 12. User Choices And Rights

Users can choose whether to configure connections, enable telemetry, or use
Sync; can remove local profiles and application data; and can ask a future
operator to exercise applicable access, correction, deletion, restriction,
objection, portability, or consent-withdrawal rights.

Requests concerning a self-hosted deployment must go to that deployment's
operator. Requests concerning a future JoeSSH-operated service must use
`{{PRIVACY_CONTACT_EMAIL_OR_FORM_URL}}`. Identity may be verified before acting
on a request, and legally required records may be retained.

## 13. Children

JoeSSH is a technical remote-administration tool and is not directed to
children. This release does not provide a JoeSSH account or paid service. Any
future account or paid service must define and enforce an appropriate minimum
age for each market before launch.

## 14. Changes

Material changes will be dated and announced through the canonical repository,
release notes, application notice, or service notice as appropriate. Changes do
not retroactively create consent for optional processing.
