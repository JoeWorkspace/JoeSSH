# JoeSSH Brand Decision

Decision date: 2026-07-14.

## Decision

`JoeSSH` is the public product and community-project name. Public releases,
documentation, signing applications, websites, screenshots, and support
channels should use JoeSSH consistently.

`AtlasTerm` remains a temporary internal compatibility identifier in the
`@atlasterm/*` package namespace, environment variables, and persisted browser
storage keys. These identifiers must not be replaced mechanically because an
unmigrated storage-key rename would make existing connection profiles and user
preferences appear lost after an upgrade.

## Migration Rule

Before 1.0, migrate internal identifiers in a versioned compatibility change:

1. Read both legacy AtlasTerm keys and new JoeSSH keys.
2. Write the new key after a successful legacy read.
3. Keep legacy reads for at least one stable release cycle.
4. Rename package scopes only with matching workspace, import, release, and
   artifact-verification updates.
5. Keep the legal publisher name separate from the product name in signing
   metadata; the publisher must match the entity that owns the certificate.

Community release artifacts should be named `JoeSSH Community` until a legal
publisher and commercial hosted-service entity are established.
