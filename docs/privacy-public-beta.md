# Public Beta Privacy Note

JoeSSH Public Beta telemetry is opt-in. The app must either keep telemetry off
by default or ask for explicit consent before sending any error or crash report.

## Allowed Data After Opt-In

- App version, platform, locale, and non-identifying feature area.
- Error class, sanitized stack signature, and coarse timing information.
- Whether the app was running as Desktop, Web Admin, Mobile preflight, or Sync
  Service.

## Data That Must Not Be Collected

- SSH host values.
- username values.
- command text or terminal command history.
- path values from local or remote filesystems.
- file name values from SFTP or terminal output.
- private key material, passphrases, passwords, or auth prompts.
- token values, including sync bearer tokens and admin snapshot tokens.
- terminal output, SFTP file content, or copied clipboard content.

## User Control

- Telemetry must be disabled until the user opts in.
- Public Beta app shells only install the error-report transport when
  `VITE_ATLASTERM_TELEMETRY_OPT_IN` or
  `EXPO_PUBLIC_ATLASTERM_TELEMETRY_OPT_IN` is explicitly set to an enabled
  value such as `1` or `true`.
- Users must be able to turn telemetry off without reinstalling.
- Disabling telemetry must stop new network submissions immediately.
- Runtime telemetry off must also clear queued reports, revoke installed
  listeners/timers through install cleanup, and keep future reports on the no-op
  path until the user opts in again.
- Release notes must explain what is collected and link to this document.

## Runtime Control Evidence

- The release readiness gate must find code evidence for runtime telemetry off,
  including a consent/disable control, transport short-circuit, queue clearing,
  and install cleanup.
- The release readiness gate must also find tests that cover telemetry being
  disabled or consent being revoked at runtime, with no new fetch/sendBeacon
  submissions after shutdown.
- Desktop and Web Admin shells must retain the active telemetry install cleanup
  and invoke it when runtime consent changes from enabled to disabled.

## Operational Rules

- Error payloads must be sanitized before transport.
- Public Beta logs and support bundles must use the same redaction rules as the
  application UI.
- Any future expansion beyond error/crash summaries requires a separate opt-in
  prompt and documentation update.
