# JoeSSH Third-Party Notices

JoeSSH source code is released under the MIT License in [LICENSE](LICENSE).
JoeSSH also depends on third-party open-source software whose licenses and
copyrights remain with their respective owners.

This file is a human-readable overview, not a complete build-specific license
bundle. Exact dependencies vary by platform and release. Every distributed
binary must ship with or link to a generated third-party license inventory and
the license or notice text required by each included component. The verified
release SBOM is the authoritative dependency inventory for that artifact.

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

`npm run release:sbom` generates the four dependency inventories together with
`reports/release/third-party-licenses.json` and
`reports/release/third-party-license-texts.json`. The latter preserves the
original license and notice text; the inventory binds each component to that
text and the current lockfiles. All six files are covered by
`reports/release/SBOM-SHA256SUMS.txt`. Run `npm run release:sbom:verify` before
distributing them. Generation or verification failures remain release blockers.

## Release Requirements

Before publishing an installer, archive, container, or hosted bundle:

1. generate and verify the release SBOM from the exact lockfiles and source
   commit;
2. generate a build-specific third-party license report;
3. include all required license and `NOTICE` text with the artifact or in an
   accessible installed location;
4. verify that bundled fonts, icons, images, dictionaries, test fixtures, and
   platform redistributables have documented provenance;
5. reject unknown, missing, custom, or non-commercial license terms until they
   are reviewed;
6. keep this overview aligned when a principal runtime component changes.

Third-party names are used only to identify their software. Their inclusion
does not imply endorsement of JoeSSH.
