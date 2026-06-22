# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 0.1.0-beta.8 | Public Beta |
| 0.1.x   | :white_check_mark: |

## Reporting a Vulnerability

If you discover a security vulnerability in JoeSSH, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

### How to Report

1. Email: **security@atlasterm.dev**
2. Include a description of the vulnerability
3. Include steps to reproduce the issue
4. Include the potential impact

### What to Expect

- **Acknowledgment** within 48 hours
- **Status update** within 5 business days
- **Resolution timeline** within 10 business days

For Public Beta, critical issues that expose credentials, command output, sync
tokens, private keys, or remote command execution paths can trigger an immediate
artifact withdrawal while a fixed build is prepared.

### Scope

The following are in scope:

- Remote code execution
- Authentication/authorization bypass
- Data exfiltration
- Cross-site scripting (XSS)
- SQL injection
- Path traversal
- Denial of service (critical severity only)

### Out of Scope

- Social engineering
- Physical attacks
- Third-party dependencies (report to their maintainers)
- Issues requiring physical access to the device

## Security Measures

JoeSSH implements the following security measures:

### Client-Side (Web/Desktop)

- **Content Security Policy (CSP)** - Strict `default-src 'self'` meta policy plus deployment `frame-ancestors 'none'`
- **Subresource Integrity (SRI)** - All production assets
- **Permissions-Policy** - Camera, microphone, geolocation disabled
- **X-Frame-Options** - Deployment `DENY`
- **X-Content-Type-Options** - `nosniff`
- **Referrer-Policy** - `strict-origin-when-cross-origin`
- **Service Workers** - Static asset caching only, API bypassed

HTML security metadata and static deployment `_headers` are verified in CI via the `qa:security-headers` script.

### Server-Side (Sync Service)

- **Bearer Token Authentication** - Constant-time comparison
- **CORS** - Explicit CORS origin `allowlist` (no wildcards)
- **Request Body Limits** - 8MB maximum
- **Security Headers** - X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy
- **Input Validation** - All sync requests validated

### Development

- **Pre-commit Hooks** - ESLint + related tests
- **Dependency Auditing** - `npm run qa:prod-audit` plus Dependabot
- **CI/CD** - Lint, typecheck, unit tests, build, bundle size, security
  headers, SRI, E2E, fresh visual QA, Rust workspace gates, Tauri shell build,
  Sync self-hosted smoke, mobile native preflight, and Public Beta readiness

## Responsible Disclosure

We appreciate the security research community and will credit reporters (with permission) in our security advisories.

## Public Beta Dependency Policy

- High and critical production dependency findings block release.
- Moderate production dependency findings must be documented in
  `docs/dependency-risk-register.md` with advisory URL, affected path, runtime
  impact, Public Beta decision, and follow-up.
- Current mobile React Native/Expo moderate findings do not block the Desktop +
  Web Admin + self-hosted Sync Public Beta unless mobile native apps enter the
  public release scope.
- Dependabot auto-merge is restricted to direct development dependency updates.
  Direct production and transitive dependency updates require review and the
  public release gate before merge.

## Public Beta Telemetry Policy

Telemetry is opt-in only. JoeSSH must not collect SSH host values, usernames,
commands, filesystem paths, file names, private keys, passwords, bearer tokens,
terminal output, SFTP file content, or clipboard content. See
`docs/privacy-public-beta.md` for the full Public Beta privacy note.
