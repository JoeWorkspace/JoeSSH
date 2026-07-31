# JoeSSH Third-Party Notices

JoeSSH source code is released under the MIT License in [LICENSE](LICENSE).
JoeSSH also depends on third-party open-source software whose licenses and
copyrights remain with their respective owners.

This file is a human-readable overview, not the build-specific legal resource.
Exact dependencies vary by platform and release. Every distributed binary must
ship with the full JoeSSH MIT license plus the license or notice text required
by its inventoried dependencies. The four verified npm/Cargo release SBOMs are
the authoritative resolved graph inventory for this pipeline; they do not prove
that every listed build package is linked into a runtime binary. Platform
redistributables and non-npm/Cargo payloads require separate distribution-term
review.

## Principal JavaScript Components

| Component                                                  | License shown by the locked/installed package metadata |
| ---------------------------------------------------------- | ------------------------------------------------------ |
| React and React DOM                                        | MIT                                                    |
| Tauri JavaScript API                                       | Apache-2.0 OR MIT                                      |
| xterm.js (`@xterm/xterm`)                                  | MIT                                                    |
| Lucide / `lucide-react`                                    | ISC                                                    |
| Expo and Expo Router packages                              | MIT                                                    |
| React Native and React Native Web                          | MIT                                                    |
| React Native Async Storage, Safe Area Context, and Screens | MIT                                                    |
| `clsx`                                                     | MIT                                                    |

## Principal Rust Components

| Component                                                                 | License shown by Cargo metadata                  |
| ------------------------------------------------------------------------- | ------------------------------------------------ |
| Tauri                                                                     | Apache-2.0 OR MIT                                |
| Tokio, Axum, Tower, Tower HTTP, and Tracing                               | MIT                                              |
| Serde, Serde JSON, UUID, Anyhow, Async Trait, Thiserror, Time, and Chrono | MIT and/or Apache-2.0, as declared by each crate |
| `russh` and `russh-sftp`                                                  | Apache-2.0                                       |

The full transitive graph includes additional packages. Do not use the tables
above as a substitute for the release SBOM or license bundle.

## Release Requirements

Before publishing an installer, archive, container, or hosted bundle:

1. run `npm run release:sbom` and `npm run release:sbom:verify` from the exact
   lockfiles and source commit;
2. run `npm run release:third-party-licenses` and
   `npm run release:third-party-licenses:verify`;
3. include all required license and `NOTICE` text with the artifact or in an
   accessible installed location;
4. verify that bundled fonts, icons, images, dictionaries, test fixtures, and
   platform redistributables have documented provenance;
5. reject unknown, missing, custom, or non-commercial license terms until they
   are reviewed;
6. keep this overview aligned when a principal runtime component changes.

The publishable build-specific outputs are:

- `reports/release/third-party-licenses/manifest.json`;
- `reports/release/third-party-licenses/THIRD-PARTY-NOTICES.txt`;
- `reports/release/THIRD-PARTY-LICENSES-SHA256SUMS.txt`.

The SBOM checksum manifest covers
`cargo-workspace-sbom.cdx.json`, `tauri-cargo-sbom.cdx.json`,
`npm-desktop-sbom.cdx.json`, and `npm-web-sbom.cdx.json`. The generated legal
resource hash-binds and embeds the complete root `LICENSE` before the
third-party component notices.

Raw Cargo metadata is a generation input under
`reports/internal/release-inputs/`; it can contain machine-local paths and must
not be uploaded or renamed into the public release. The public npm CycloneDX
SBOMs are canonical JSON: random serial numbers, generation timestamps, local
paths, and checkout names are rejected.

The Desktop build maps the verified notices file into the installed resource
directory as `legal/THIRD-PARTY-NOTICES.txt`. The in-app Settings legal panel
reads that exact resource. A clean Desktop build runs
`npm run release:desktop:legal-resource` before Tauri packaging so a missing or
stale legal resource fails closed.

Third-party names are used only to identify their software. Their inclusion
does not imply endorsement of JoeSSH.
