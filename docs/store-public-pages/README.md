# Microsoft Store Public Pages

Status: preparation-only. The templates in this directory intentionally contain
blocking fields. They are not public policy pages and must never be used as
Store URLs until every field is truthfully replaced and the remote checker
passes.

## Static Source Map

The public pages are static HTML with no JavaScript, account, cookie, or hosted
JoeSSH dependency. Keep this mapping exact so a hosted copy cannot silently
drift into a different policy:

| Store field        | Static template                | Canonical factual source | Recommended path |
| ------------------ | ------------------------------ | ------------------------ | ---------------- |
| Privacy policy URL | `privacy-policy.template.html` | `PRIVACY.md`             | `/privacy/`      |
| Support URL        | `support.template.html`        | `SUPPORT.md`             | `/support/`      |

The templates intentionally narrow the root policies to the free, noncommercial
Windows Community release. Do not add paid support, hosted Sync, advertising,
accounts, or production telemetry unless those features actually ship and the
root policies are updated first.

## Identity And Contact Boundary

The committed templates contain no personal legal name, identity document,
address, phone number, or private email address. Complete these fields only in a
private staging copy:

- `PARTNER_CENTER_PUBLISHER_DISPLAY_NAME`: the exact personal publisher display
  name shown after Microsoft verifies the Individual account;
- `POLICY_EFFECTIVE_DATE_ISO`: the actual publication date in `YYYY-MM-DD`;
- `PUBLIC_PRIVACY_CONTACT_HREF` and `PUBLIC_PRIVACY_CONTACT_LABEL`: a public
  privacy contact form or dedicated email link and its visible label;
- `PUBLIC_SUPPORT_CONTACT_HREF` and `PUBLIC_SUPPORT_CONTACT_LABEL`: a public
  support form or dedicated email link and its visible label;
- `PUBLIC_PRIVACY_URL`: the final canonical public privacy page URL.

Keep the template's exact `data-joessh-contact="privacy"` and
`data-joessh-contact="support"` attributes on the corresponding contact links.
The remote checker requires exactly one role-matched marker and validates that
its own `href` is public HTTPS or a direct email address; an unrelated link on
the page cannot substitute for a broken contact route.

HTML-escape every visible replacement. The two `HREF` replacements must be an
absolute `https://` URL or a `mailto:` link. Do not put identity documents,
verification screenshots, private addresses, tokens, or account credentials in
the rendered files or Git history.

Publishing a privacy policy necessarily makes the publisher name and selected
contact route public. GitHub Pages can host static pages without a paid GitHub
plan for a public repository, but a rendered page committed to that repository
also leaves the personal fields in Git history. Use a separately managed static
host or a deliberately separate publication repository when that history
boundary matters.

The tracked root `PRIVACY.md` and `SUPPORT.md` remain fail-closed source
documents and must not receive the personal publisher name. The Store wrapper
loads that name from the gitignored canonical Partner Center identity file and
passes it to the logged-out checker through the child-process environment. Both
remote pages must visibly contain the exact value, but reports and command-line
arguments never echo it.

## Publication Procedure

1. Reconcile each template statement with the exact signed candidate and its
   root policy source.
2. Copy the two templates to private staging outside this repository, replace
   every named field, and keep the final pages at distinct canonical paths.
3. Publish with HTTPS as `text/html; charset=utf-8`. Do not add login, OAuth,
   access-control, meta-refresh, or client-side redirect behavior.
4. Run the remote check from a network and shell with no logged-in browser or
   host credentials:

   ```powershell
   $env:JOESSH_PRIVACY_URL = "https://<public-host>/privacy/"
   $env:JOESSH_SUPPORT_URL = "https://<public-host>/support/"
   $JoeSshPartnerIdentity = Get-Content -Raw `
     reports/handoff/windows-store/partner-center-identity.json | ConvertFrom-Json
   $env:ATLASTERM_WINDOWS_LEGAL_PUBLISHER = `
     $JoeSshPartnerIdentity.publisherDisplayName

   try {
     node scripts/check-store-public-pages.mjs --json
     if ($LASTEXITCODE -ne 0) {
       throw "Store public page check failed."
     }
   } finally {
     Remove-Item Env:\ATLASTERM_WINDOWS_LEGAL_PUBLISHER
     Remove-Variable JoeSshPartnerIdentity
   }
   ```

   This loads the value without putting the personal name in command history or
   checker output. Use only the canonical file produced by the identity writer.

5. Open both exact URLs in a fresh private browser window, verify the visible
   publisher and contact routes, follow each contact link, and save the checked
   URLs and date with the release evidence.
6. Supply those same URLs to the Store policy preflight. Use
   `--confirm-public-links` only after the machine check and the separate visual
   check both pass.

The Node check is deliberately fail-closed. It sends no Cookie or Authorization
header, follows only bounded same-origin non-auth redirects, rejects private DNS
answers, and pins each HTTPS socket to one of the public addresses returned by
that validation so a second unbound DNS lookup cannot redirect the request to a
private service. Canonical page and HTTPS contact URLs cannot contain query
strings, so signed preview credentials cannot leak through argv or reports. It
requires HTTP 200 UTF-8 HTML, caps the decoded body at 1 MiB, and rejects
placeholders, draft notices, login/challenge pages, broken role-marked contacts,
a publisher-name mismatch, or missing role-specific content. It does not prove
legal adequacy, ownership of the publisher identity, deliverability of an email
address, or the behavior after a contact link is clicked; those remain manual
release evidence.
