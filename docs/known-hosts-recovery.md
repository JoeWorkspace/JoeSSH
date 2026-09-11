# Recovering trust coordination metadata on Windows

The maintenance version keeps the existing `known-hosts.json` format and app-data location. It adds a stable `known-hosts.lock` file and a `known-hosts-revocation.json` sidecar. All participating app instances coordinate through that lock. Removing or clearing a pin changes the revocation token before saving the main file, preventing a connection already authenticating from restoring revoked trust.

Malformed or unknown coordination metadata causes trust operations to fail closed. Do not delete the main trust file or turn off verification to work around that failure.

1. Close every JoeSSH process, including any old or unpackaged build. Older versions do not participate in the new coordination protocol and must not run against this directory alongside the maintenance version.
2. Identify the actual data directory used by that installed app and Windows account. Its last component is `dev.atlasterm.joessh`. Packaged Store apps can use a redirected app-data location; do not guess a path or use a development profile just because it contains the same file name.
3. Back up the directory for investigation. Run the repository's `scripts/repair-known-hosts-revocation.ps1` explicitly with `-AppDataDirectory` set to that verified directory. The script refuses a running app, malformed main data, or a recognized newer sidecar format. It takes the same stable OS file lock, backs up a corrupt sidecar, writes a fresh token atomically, and verifies that the main JSON hash did not change.
4. Restart JoeSSH. Confirm the existing trust list and reconnect normally. The repair does not authenticate or authorize any new host key.

Never replace/delete `known-hosts.lock`, restore an old token, or overwrite a current trust list with a backup. A token change can remain committed if a subsequent main-file save fails; retry the intended trust action after resolving the storage error. Already authenticated sessions are unaffected by pin removal, matching the existing product behavior; disconnect them explicitly when required.

Test recovery using copied data only. The script supports a missing or damaged version-1 sidecar. Newer versions or unknown sidecar fields need a matching application/tool version. Main trust-file corruption needs separate recovery and is deliberately outside this script's scope. Run `npm run test:known-hosts-recovery` on Windows to verify the recovery cases; the Windows CI job runs the same tests.
