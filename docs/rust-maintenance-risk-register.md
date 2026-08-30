# Rust maintenance notices

Reviewed on 2026-08-30; review expires on 2026-11-28. The machine-readable
register binds each advisory to the exact Tauri lockfile package, version,
registry source and checksum. Any new, changed, removed or expired registration
blocks the audit until reviewed again.

The root Rust workspace still denies every warning. The separately locked
Tauri dependency graph now receives its own audit. Neither audit accepts
vulnerabilities, unsoundness, yanked releases, filtered reports, incomplete
network checks or stale-database fallback. The Tauri check explicitly reports
the 16 informational **unmaintained** notices in
[the register](rust-maintenance-risk-register.json); these are maintenance
risks, not vulnerabilities claimed to have been repaired.

Tauri's stable GTK3 dependency still requires the final gtk-rs 0.18 bindings
and their proc-macro-error dependency. Its tauri-utils dependency still uses
urlpattern 0.3, which requires the five UNIC 0.9 packages. A compatible update
does not remove these chains. Replacing the UI framework or its API generation
is not treated as a routine security patch. The register must be revisited
when Tauri supplies a maintained compatible replacement, and at least every
90 days in the meantime.

References:

- [gtk-rs GTK3 maintenance notice](https://github.com/gtk-rs/gtk3-rs/commit/508a69b63a3c5bf73790e0e59101a955847f30d6)
- [proc-macro-error maintenance notice](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)
- [UNIC maintenance tracking](https://github.com/rustsec/advisory-db/issues/2414)

Known code defects are handled separately: the vulnerable GLib iterator is
backported from the official upstream fix with source provenance and an
optimized native regression test. Local source dependencies must remain in
the SBOM and third-party license inventory; a missing registry advisory for
a local patch is not evidence that the patch is correct. The gate verifies the
complete vendored tree against pinned upstream and patch hashes, then audits
its original registry identity separately. Only the verified backport accounts
for RUSTSEC-2024-0429; any new advisory, changed advisory or yanked upstream
version fails. Nothing is added to cargo-audit's ignore list.

The repository pins cargo-audit 0.22.2 and a strict local configuration. Each
machine-readable scan is preceded by a non-quiet online scan whose database,
registry update and lockfile scan evidence must be present. This also rejects
registry failures that cargo-audit can otherwise hide in JSON mode. Offline
configuration, incomplete reports and network failures cannot produce a pass.
