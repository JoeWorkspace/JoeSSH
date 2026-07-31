import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const docsPath = resolve(root, "docs", "sync-api.md");
const dockerfilePath = resolve(root, "services", "sync", "Dockerfile");
const dockerignorePath = resolve(root, ".dockerignore");
const packageJsonPath = resolve(root, "package.json");
const qaChecklistPath = resolve(root, "docs", "qa-checklist.md");
const selfHostingPath = resolve(root, "docs", "self-hosting-sync.md");
const systemdPath = resolve(
  root,
  "services",
  "sync",
  "joessh-sync.service.example",
);
const syncReadmePath = resolve(root, "services", "sync", "README.md");
const syncSmokePath = resolve(root, "scripts", "smoke-self-hosted-sync.mjs");
const syncConfigGuardPath = resolve(
  root,
  "scripts",
  "smoke-sync-config-guard.mjs",
);
const sourcePath = resolve(root, "services", "sync", "src", "main.rs");
const configSourcePath = resolve(root, "services", "sync", "src", "config.rs");

const docs = readFileSync(docsPath, "utf8");
const dockerfile = readFileSync(dockerfilePath, "utf8");
const dockerignore = readFileSync(dockerignorePath, "utf8");
const packageJson = readFileSync(packageJsonPath, "utf8");
const qaChecklist = readFileSync(qaChecklistPath, "utf8");
const source = readFileSync(sourcePath, "utf8");
const configSource = readFileSync(configSourcePath, "utf8");
const selfHosting = readFileSync(selfHostingPath, "utf8");
const systemd = readFileSync(systemdPath, "utf8");
const syncReadme = readFileSync(syncReadmePath, "utf8");
const syncSmoke = readFileSync(syncSmokePath, "utf8");
const syncConfigGuard = readFileSync(syncConfigGuardPath, "utf8");

const checks = [
  {
    label: "Rust source exposes health endpoint",
    source: source,
    pattern: '.route("/healthz", get(healthz))',
  },
  {
    label: "Rust source exposes readiness endpoint",
    source: source,
    pattern: '.route("/readyz", get(readyz))',
  },
  {
    label: "Rust source exposes device registration endpoint",
    source: source,
    pattern: '.route("/v1/devices/register", post(register_device))',
  },
  {
    label: "Rust source exposes admin snapshot endpoint",
    source: source,
    pattern: '.route("/v1/admin/snapshot", get(admin_snapshot))',
  },
  {
    label: "Rust source keeps admin snapshot under the protected v1 router",
    source: source,
    pattern:
      /\.route\("\/v1\/admin\/snapshot", get\(admin_snapshot\)\)[\s\S]*?\.(?:route_)?layer\(middleware::from_fn_with_state\(/,
  },
  {
    label: "Rust source exposes sync push endpoint",
    source: source,
    pattern: '.route("/v1/sync/push", post(push_changes))',
  },
  {
    label: "Rust source exposes sync pull endpoint",
    source: source,
    pattern: '.route("/v1/sync/pull", get(pull_changes))',
  },
  {
    label: "Rust source returns 202 for accepted push requests",
    source: source,
    pattern: "StatusCode::ACCEPTED",
  },
  {
    label: "Rust source documents auth failure status constants",
    source: source,
    pattern: "StatusCode::UNAUTHORIZED",
  },
  {
    label: "Rust source documents invalid auth status constants",
    source: source,
    pattern: "StatusCode::FORBIDDEN",
  },
  {
    label: "Rust source documents bad request status constants",
    source: source,
    pattern: "StatusCode::BAD_REQUEST",
  },
  {
    label: "Rust source documents unknown device status constants",
    source: source,
    pattern: "StatusCode::NOT_FOUND",
  },
  {
    label: "Rust source documents storage unavailable status constants",
    source: source,
    pattern: "StatusCode::SERVICE_UNAVAILABLE",
  },
  {
    label: "Rust source documents ledger quota status constants",
    source: source,
    pattern: "StatusCode::PAYLOAD_TOO_LARGE",
  },
  {
    label: "Rust source probes JSON ledger storage in readiness",
    source: source,
    pattern:
      /async fn readyz[\s\S]*storage_readiness\(state\.storage_path\.as_deref\(\)\)[\s\S]*fn storage_readiness[\s\S]*\.joessh-sync-readyz-[\s\S]*configured sync storage is writable/,
  },
  {
    label: "Rust source includes documented sync and admin error codes",
    source: source,
    pattern:
      /(?=[\s\S]*missing_authorization)(?=[\s\S]*invalid_authorization)(?=[\s\S]*admin_forbidden)(?=[\s\S]*admin_token_required)(?=[\s\S]*metrics_forbidden)(?=[\s\S]*invalid_sync_request)(?=[\s\S]*empty_change_set)(?=[\s\S]*unknown_device)(?=[\s\S]*invalid_cursor)(?=[\s\S]*storage_unavailable)(?=[\s\S]*ledger_quota_exceeded)/,
  },
  {
    label:
      "Rust source validates Sync input fields before Web Admin snapshot projection",
    source: source,
    pattern:
      /validate_register_device_request[\s\S]*MAX_SYNC_APP_VERSION_CHARS[\s\S]*MAX_SYNC_DISPLAY_NAME_CHARS[\s\S]*validate_push_changes_request[\s\S]*validate_sync_entity_token[\s\S]*MAX_SYNC_ENTITY_TOKEN_CHARS[\s\S]*is_control_or_format_character/,
  },
  {
    label: "Rust source reads configurable JSON sync storage path",
    source: configSource,
    pattern: /ATLASTERM_SYNC_STORAGE_PATH[\s\S]*PathBuf::from/,
  },
  {
    label: "Rust source reads dedicated metrics bearer token",
    source: configSource,
    pattern: /ATLASTERM_SYNC_METRICS_TOKEN[\s\S]*metrics_token/,
  },
  {
    label: "Rust source reads explicit ephemeral storage escape hatch",
    source: configSource,
    pattern:
      /allow_ephemeral_storage[\s\S]*ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE/,
  },
  {
    label: "Rust source reads JSON ledger quota environment variables",
    source: configSource,
    pattern:
      /ATLASTERM_SYNC_MAX_PUSH_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_PULL_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_STORED_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_LEDGER_BYTES/,
  },
  {
    label:
      "Rust source requires metrics auth, scoped CORS, and durable storage for non-loopback binds",
    source: source,
    pattern:
      /fn check_bind_safety\(addr: &SocketAddr, config: &SyncConfig\)[\s\S]*config\.auth_token\.is_none\(\)[\s\S]*config\.metrics_token\.is_none\(\)[\s\S]*ATLASTERM_SYNC_METRICS_TOKEN[\s\S]*config\.cors_permissive[\s\S]*ATLASTERM_SYNC_CORS_PERMISSIVE[\s\S]*config\.storage_path\.is_none\(\) && !config\.allow_ephemeral_storage[\s\S]*ATLASTERM_SYNC_STORAGE_PATH/,
  },
  {
    label:
      "Rust source prepares storage and acquires a single-writer JSON ledger lock",
    source: source,
    pattern:
      /fn acquire_storage_lock\(path: Option<&Path>\) -> anyhow::Result<Option<StorageLock>>[\s\S]*fs::create_dir_all\(parent\)\.with_context[\s\S]*ATLASTERM_SYNC_STORAGE_PATH[\s\S]*path\.with_extension\("lock"\)[\s\S]*open_storage_lock_file\(&lock_path\)[\s\S]*another Sync Service instance may already be using this JSON ledger[\s\S]*fn create_storage_lock_file\(lock_path: &Path\) -> std::io::Result<fs::File>[\s\S]*\.create_new\(true\)/,
  },
  {
    label: "Rust source loads persisted sync ledger during app construction",
    source: source,
    pattern:
      /fn try_app_with_config\(config: SyncConfig\)[\s\S]*acquire_storage_lock\(config\.storage_path\.as_deref\(\)\)\?[\s\S]*load_store\(\s*config\.storage_path\.as_deref\(\),\s*config\.max_ledger_bytes,\s*config\.max_stored_changes,\s*\)\?[\s\S]*_storage_lock: storage_lock[\s\S]*max_push_changes: config\.max_push_changes[\s\S]*max_stored_changes: config\.max_stored_changes[\s\S]*max_ledger_bytes: config\.max_ledger_bytes/,
  },
  {
    label:
      "Rust source paginates pull responses without skipping scanned cursor windows",
    source: source,
    pattern:
      /(?=[\s\S]*struct PullQuery[\s\S]*limit: Option<usize>)(?=[\s\S]*fn resolve_pull_limit\(\s*limit: Option<usize>,\s*max_pull_changes: usize,\s*\))(?=[\s\S]*page_end_sequence = since_sequence[\s\S]*saturating_add\(page_limit as u64\)[\s\S]*change\.sequence <= page_end_sequence[\s\S]*next_cursor: cursor_from_sequence\(page_end_sequence\)[\s\S]*has_more)/,
  },
  {
    label: "Rust source serializes the sync store for durable persistence",
    source: source,
    pattern:
      /struct SyncStore[\s\S]*Serialize[\s\S]*Deserialize|Serialize, Deserialize[\s\S]*struct SyncStore/,
  },
  {
    label: "Rust source persists the documented JSON ledger fields",
    source: source,
    pattern:
      /struct SyncStore[\s\S]*schema_version: u32[\s\S]*devices: HashMap[\s\S]*processed_change_ids: HashSet[\s\S]*changes: Vec<StoredChange>[\s\S]*latest_sequence: u64/,
  },
  {
    label: "Rust source defines the current JSON ledger schema version",
    source: source,
    pattern: "const SYNC_LEDGER_SCHEMA_VERSION: u32 = 1",
  },
  {
    label:
      "Rust source normalizes loaded ledger cursors and processed change IDs",
    source: source,
    pattern:
      /fn normalize_loaded_store\(\s*mut store: SyncStore,\s*max_stored_changes: usize,\s*\) -> anyhow::Result<SyncStore>[\s\S]*store\.schema_version[\s\S]*0 \| SYNC_LEDGER_SCHEMA_VERSION[\s\S]*UnsupportedLedgerSchemaVersion[\s\S]*store\.schema_version = SYNC_LEDGER_SCHEMA_VERSION[\s\S]*store\.changes\.len\(\) <= max_stored_changes[\s\S]*ATLASTERM_SYNC_MAX_STORED_CHANGES[\s\S]*latest_sequence\.max\(change\.sequence\)[\s\S]*change\.cursor = cursor_from_sequence\(change\.sequence\)[\s\S]*processed_change_ids\.insert\(change\.id\)/,
  },
  {
    label: "Rust source does not recover future schema ledgers from backup",
    source: source,
    pattern:
      /Err\(primary_error\) => \{[\s\S]*downcast_ref::<UnsupportedLedgerSchemaVersion>\(\)[\s\S]*return Err\(primary_error\)[\s\S]*if backup_path\.exists\(\)/,
  },
  {
    label:
      "Rust source writes the current ledger schema version on persistence",
    source: source,
    pattern:
      /let mut persisted_store = store\.clone\(\);[\s\S]*persisted_store\.schema_version = SYNC_LEDGER_SCHEMA_VERSION[\s\S]*serialize_store_for_persistence\(&persisted_store\)/,
  },
  {
    label: "Rust source persists register and accepted push mutations",
    source: source,
    pattern:
      /async fn register_device[\s\S]*persist_store\(\s*state\.storage_path\.as_deref\(\),\s*&store,\s*state\.max_ledger_bytes,\s*\)[\s\S]*async fn push_changes[\s\S]*persist_store\(\s*state\.storage_path\.as_deref\(\),\s*&store,\s*state\.max_ledger_bytes,\s*\)/,
  },
  {
    label: "Rust source rolls back register mutations when persistence fails",
    source: source,
    pattern:
      /async fn register_device[\s\S]*let previous_store = store\.clone\(\);[\s\S]*persist_store\(\s*state\.storage_path\.as_deref\(\),\s*&store,\s*state\.max_ledger_bytes,\s*\)[\s\S]*\*store = previous_store;[\s\S]*storage_error_response\(error\)[\s\S]*async fn admin_snapshot/,
  },
  {
    label:
      "Rust source rolls back push mutations and change IDs when persistence fails",
    source: source,
    pattern:
      /async fn push_changes[\s\S]*previous_store = Some\(store\.clone\(\)\);[\s\S]*store\.accept_change\(request\.device_id, change\);[\s\S]*persist_store\(\s*state\.storage_path\.as_deref\(\),\s*&store,\s*state\.max_ledger_bytes,\s*\)[\s\S]*\*store = previous;[\s\S]*storage_error_response\(error\)[\s\S]*async fn pull_changes/,
  },
  {
    label: "Rust source enforces JSON ledger quotas before accepting mutations",
    source: source,
    pattern:
      /request\.changes\.len\(\) > state\.max_push_changes[\s\S]*store\.changes\.len\(\) >= state\.max_stored_changes[\s\S]*store_exceeds_ledger_byte_limit\(&store, state\.max_ledger_bytes\)/,
  },
  {
    label:
      "Rust tests cover paginated pull limits and self-change cursor advancement",
    source: source,
    pattern:
      /pull_pages_changes_with_server_limit[\s\S]*pull_limit_is_capped_by_configured_max[\s\S]*pull_advances_cursor_over_filtered_self_changes[\s\S]*pull_rejects_zero_limit/,
  },
  {
    label:
      "Rust source enforces JSON ledger quotas while loading and persisting storage",
    source: source,
    pattern:
      /fn load_required_store_file[\s\S]*metadata\.len\(\) <= max_ledger_bytes[\s\S]*normalize_loaded_store\(store, max_stored_changes\)[\s\S]*fn persist_store[\s\S]*bytes\.len\(\) as u64 <= max_ledger_bytes/,
  },
  {
    label: "Rust source writes storage through temp and backup files",
    source: source,
    pattern:
      /let temp_path = path\.with_extension\("tmp"\)[\s\S]*let backup_path = path\.with_extension\("bak"\)[\s\S]*fs::rename\(&temp_path, path\)/,
  },
  {
    label:
      "Rust source recovers unreadable or missing storage from backup before temp",
    source: source,
    pattern:
      /let backup_path = path\.with_extension\("bak"\)[\s\S]*let temp_path = path\.with_extension\("tmp"\)[\s\S]*primary sync storage ledger is unreadable; recovering from backup[\s\S]*primary sync storage ledger is missing; recovering from backup[\s\S]*primary sync storage ledger is missing; recovering from temp ledger/,
  },
  {
    label: "Rust source covers restart persistence behavior with a test",
    source: source,
    pattern:
      "storage_path_persists_registered_devices_and_changes_across_app_restarts",
  },
  {
    label: "Rust source covers backup and temp ledger recovery with tests",
    source: source,
    pattern:
      /storage_path_recovers_from_backup_when_primary_ledger_is_corrupt[\s\S]*storage_path_recovers_from_temp_ledger_when_primary_and_backup_are_missing/,
  },
  {
    label: "Rust source covers persistence failure rollback with tests",
    source: source,
    pattern:
      /register_device_rolls_back_memory_when_storage_write_fails[\s\S]*push_changes_rolls_back_memory_and_change_id_when_storage_write_fails/,
  },
  {
    label: "Rust source covers JSON ledger quota enforcement with tests",
    source: source,
    pattern:
      /(?=[\s\S]*push_rejects_change_sets_over_configured_limit)(?=[\s\S]*push_rejects_when_stored_change_limit_is_reached_and_rolls_back)(?=[\s\S]*push_rejects_when_ledger_byte_limit_would_be_exceeded_and_rolls_back)(?=[\s\S]*storage_path_rejects_ledgers_over_configured_size_before_parsing)(?=[\s\S]*storage_path_rejects_ledgers_with_too_many_changes)/,
  },
  {
    label: "Rust source covers Sync input safety with tests",
    source: source,
    pattern:
      /register_rejects_admin_snapshot_unsafe_display_names[\s\S]*push_rejects_admin_snapshot_unsafe_entity_tokens/,
  },
  {
    label: "Rust source covers readiness storage modes and failures",
    source: source,
    pattern:
      /readyz_reports_memory_storage_ready[\s\S]*readyz_reports_json_ledger_storage_ready[\s\S]*storage_path_rejects_unusable_ledger_parent_before_serving/,
  },
  {
    label: "Rust source covers loaded ledger normalization with a test",
    source: source,
    pattern: "loaded_storage_normalizes_latest_cursor_and_processed_change_ids",
  },
  {
    label:
      "Rust source bounds persisted audit log while preserving sync history",
    source: source,
    pattern:
      /const AUDIT_LOG_RETENTION: usize = 10_000;[\s\S]*fn record_audit_event\(&mut self, event: StoredAuditEvent\)[\s\S]*self\.prune_audit_log\(\);[\s\S]*fn accept_change\(&mut self, device_id: Uuid, change: SyncChange\)[\s\S]*self\.changes\.push[\s\S]*self\.prune_processed_ids\(\);/,
  },
  {
    label:
      "Rust source tests audit log retention and processed change id pruning",
    source: source,
    pattern:
      /accept_change_prunes_processed_change_ids_without_trimming_changes[\s\S]*audit_log_retention_is_bounded_before_persisting[\s\S]*admin_snapshot_returns_recent_audit_event_limit_from_bounded_log/,
  },
  {
    label:
      "Rust source covers ledger schema migration and future-version rejection",
    source: source,
    pattern:
      /storage_path_migrates_legacy_v0_ledger_without_schema_version[\s\S]*storage_path_rejects_future_ledger_schema_version/,
  },
  {
    label: "Rust source covers active and stale JSON ledger locks",
    source: source,
    pattern:
      /storage_path_rejects_active_ledger_lock[\s\S]*storage_path_removes_stale_ledger_lock/,
  },
  {
    label: "Rust source covers non-loopback production bind guards",
    source: source,
    pattern:
      /bind_safety_allows_non_loopback_with_token_and_durable_storage[\s\S]*bind_safety_rejects_non_loopback_without_metrics_token[\s\S]*bind_safety_rejects_non_loopback_with_token_but_no_storage[\s\S]*bind_safety_rejects_non_loopback_with_permissive_cors/,
  },
  {
    label:
      "Rust source constrains CORS origins to http(s) origins without paths",
    source: configSource,
    pattern: /matches!\(scheme, "http" \| "https"\)[\s\S]*without a path/,
  },
  {
    label: "Rust source defines Web Admin snapshot response shape",
    source: source,
    pattern:
      /struct AdminDashboardSnapshot[\s\S]*audit_events[\s\S]*devices[\s\S]*members[\s\S]*metrics[\s\S]*roles/,
  },
  {
    label: "Rust source serializes admin snapshot camelCase fields",
    source: source,
    pattern:
      /serde\(rename = "auditEvents"\)[\s\S]*serde\(rename = "activeMembers"\)[\s\S]*serde\(rename = "deviceCount"\)[\s\S]*serde\(rename = "memberCount"\)/,
  },
  {
    label: "Rust source keeps admin snapshot device order deterministic",
    source: source,
    pattern:
      /devices\.sort_by\(\|left, right\|[\s\S]*left\.name[\s\S]*\.cmp\(&right\.name\)[\s\S]*left\.id\.cmp\(&right\.id\)/,
  },
  {
    label: "Rust source avoids exposing sync payloads in admin audit events",
    source: source,
    pattern:
      /fn admin_audit_events\(&self\) -> Vec<AdminAuditEvent>[\s\S]*target: format!\("\{\}:\{\}", change\.entity_type, change\.entity_id\),[\s\S]*time: change\.server_time\.to_rfc3339\(\),/,
  },
  {
    label: "Rust source includes admin snapshot auth and projection tests",
    source: source,
    pattern:
      /async fn admin_snapshot_fails_closed_without_admin_token[\s\S]*async fn admin_snapshot_requires_admin_token_when_configured[\s\S]*async fn admin_snapshot_rejects_admin_token_matching_sync_token[\s\S]*async fn admin_snapshot_projects_registered_devices_and_audit_events/,
  },
  {
    label: "Docs show public health endpoint and 200 response",
    source: docs,
    pattern: /`GET \/healthz`[\s\S]*?Status:\s*`200 OK`/,
  },
  {
    label: "Docs show public readiness endpoint and storage failure response",
    source: docs,
    pattern:
      /`GET \/readyz`[\s\S]*?Status:\s*`200 OK`[\s\S]*?Startup fails before serving traffic[\s\S]*?`503 Service Unavailable`[\s\S]*?configured JSON ledger storage cannot be probed/,
  },
  {
    label: "Docs show register endpoint and 200 response",
    source: docs,
    pattern: /`POST \/v1\/devices\/register`[\s\S]*?Status:\s*`200 OK`/,
  },
  {
    label: "Docs show push endpoint and 202 response",
    source: docs,
    pattern: /`POST \/v1\/sync\/push`[\s\S]*?Status:\s*`202 Accepted`/,
  },
  {
    label: "Docs show pull endpoint and 200 response",
    source: docs,
    pattern:
      /`GET \/v1\/sync\/pull\?device_id=.*?&since=server-1&limit=100`[\s\S]*?Status:\s*`200 OK`/,
  },
  {
    label: "Docs show admin snapshot endpoint and 200 response",
    source: docs,
    pattern: /`GET \/v1\/admin\/snapshot`[\s\S]*?Status:\s*`200 OK`/,
  },
  {
    label: "Docs include bearer auth token environment variable",
    source: docs,
    pattern: "ATLASTERM_SYNC_AUTH_TOKEN",
  },
  {
    label: "Docs include metrics auth token environment variable",
    source: docs,
    pattern: "ATLASTERM_SYNC_METRICS_TOKEN",
  },
  {
    label: "Docs include Sync token startup validation contract",
    source: docs,
    pattern:
      /bearer tokens must be at least 32\s+characters[\s\S]*must not contain whitespace or control characters[\s\S]*distinct[\s\S]*fails startup/,
  },
  {
    label: "Docs include closed-by-default CORS behavior",
    source: docs,
    pattern:
      /If the allowlist is unset,\s+the service does not emit browser CORS allow-origin\s+headers\./,
  },
  {
    label: "Docs include explicit permissive local CORS opt-in",
    source: docs,
    pattern:
      /ATLASTERM_SYNC_CORS_PERMISSIVE=1[\s\S]*loopback[\s\S]*Non-loopback binds reject permissive CORS at startup/,
  },
  {
    label: "Docs include CORS allowlist environment variable",
    source: docs,
    pattern: "ATLASTERM_SYNC_CORS_ORIGINS",
  },
  {
    label: "Docs include durable JSON storage path environment variable",
    source: docs,
    pattern: "ATLASTERM_SYNC_STORAGE_PATH",
  },
  {
    label: "Docs include JSON ledger quota environment variables",
    source: docs,
    pattern:
      /ATLASTERM_SYNC_MAX_PUSH_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_PULL_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_STORED_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_LEDGER_BYTES/,
  },
  {
    label:
      "Docs include non-loopback metrics auth, scoped CORS, and durable storage startup guard",
    source: docs,
    pattern:
      /Non-loopback binds also\s+require[\s\S]*ATLASTERM_SYNC_METRICS_TOKEN[\s\S]*durable JSON ledger\s+storage[\s\S]*ATLASTERM_SYNC_CORS_ORIGINS[\s\S]*ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE=1[\s\S]*not a supported\s+Public Beta/,
  },
  {
    label: "Docs describe persisted sync ledger contents",
    source: docs,
    pattern:
      /registered\s+devices,\s+processed\s+change IDs,\s+accepted changes,\s+and the latest cursor/,
  },
  {
    label: "Docs distinguish complete sync history from bounded audit history",
    source: docs,
    pattern:
      /accepted `changes` as complete sync history[\s\S]*`GET \/v1\/sync\/pull\?since=0`[\s\S]*paginated replay[\s\S]*`audit_log` field is bounded operational history[\s\S]*accepted changes are not compacted/,
  },
  {
    label: "Docs describe JSON ledger schema version migration contract",
    source: docs,
    pattern:
      /New ledgers write `schema_version: 1`[\s\S]*legacy v0[\s\S]*future `schema_version` fail startup/,
  },
  {
    label: "Docs describe JSON ledger single-writer lock",
    source: docs,
    pattern:
      /`ledger\.lock`[\s\S]*single-writer guard[\s\S]*second service instance cannot open the same ledger/,
  },
  {
    label: "Docs describe backup and temp ledger startup recovery",
    source: docs,
    pattern:
      /prefers the primary ledger[\s\S]*recovers from a valid `\.bak` ledger[\s\S]*recover a complete `\.tmp`/,
  },
  {
    label: "Docs include storage unavailable error contract",
    source: docs,
    pattern:
      /`503 Service Unavailable` with\s+`code: "storage_unavailable"`[\s\S]*same change ID can be retried/,
  },
  {
    label: "Docs include ledger quota error contract",
    source: docs,
    pattern:
      /`413 Payload Too Large` with\s+`code: "ledger_quota_exceeded"`[\s\S]*configured JSON ledger quota/,
  },
  {
    label: "Docs include invalid rate-limit startup rejection",
    source: docs,
    pattern:
      /Invalid rate-limit values fail startup[\s\S]*`0` only when an upstream proxy enforces rate limiting/,
  },
  {
    label: "Docs include CORS methods and request headers",
    source: docs,
    pattern:
      /`GET`, `POST`, and `OPTIONS`[\s\S]*`Authorization` and\s+`Content-Type`/,
  },
  {
    label: "Docs include ambiguous CORS startup rejection",
    source: docs,
    pattern:
      /Do not combine permissive CORS with `ATLASTERM_SYNC_CORS_ORIGINS`[\s\S]*fail startup/,
  },
  {
    label: "Docs include CORS preflight auth bypass",
    source: docs,
    pattern: /CORS preflight requests bypass sync\s+authorization/,
  },
  {
    label: "Docs list supported device platforms",
    source: docs,
    pattern: "`desktop`, `web`, `ios`, and `android`",
  },
  {
    label: "Docs include Sync input field safety contract",
    source: docs,
    pattern:
      /`app_version` must be non-empty[\s\S]*`display_name` is optional[\s\S]*Unicode format characters[\s\S]*`entity_type` and `entity_id`[\s\S]*canonical sync entity token[\s\S]*lowercase ASCII letters/,
  },
  {
    label: "Docs list supported sync operations",
    source: docs,
    pattern: "`create`, `update`, and `delete`",
  },
  {
    label: "Docs include cursor grammar",
    source: docs,
    pattern: /Cursors are `0` or `server-N`/,
  },
  {
    label: "Docs include pull pagination contract",
    source: docs,
    pattern:
      /`limit` is[\s\S]*capped by[\s\S]*ATLASTERM_SYNC_MAX_PULL_CHANGES[\s\S]*"has_more"[\s\S]*scanned ledger sequence window[\s\S]*Continue pulling[\s\S]*`has_more` is `false`/,
  },
  {
    label: "Docs include unknown device error contract",
    source: docs,
    pattern: '`404 Not Found` with `code: "unknown_device"`',
  },
  {
    label: "Docs include missing auth error contract",
    source: docs,
    pattern: /`401 Unauthorized` with\s+`code: "missing_authorization"`/,
  },
  {
    label: "Docs include rejected auth error contract",
    source: docs,
    pattern: /`403 Forbidden`\s+with `code: "invalid_authorization"`/,
  },
  {
    label: "Docs include invalid sync request error contract",
    source: docs,
    pattern: /`400 Bad Request` with\s+`code: "invalid_sync_request"`/,
  },
  {
    label: "Docs include empty change set error contract",
    source: docs,
    pattern: '`400 Bad Request` with `code: "empty_change_set"`',
  },
  {
    label: "Docs include invalid cursor error contract",
    source: docs,
    pattern: /`400 Bad Request` with\s+`code: "invalid_cursor"`/,
  },
  {
    label: "Docs include change idempotency",
    source: docs,
    pattern: "`changes[].id` is idempotent",
  },
  {
    label: "Docs include conflict reason",
    source: docs,
    pattern: /`reason: "changed_after_base_cursor"`/,
  },
  {
    label: "Docs include conflict response shape",
    source: docs,
    pattern:
      /conflicts` entries include `entity_type`, `entity_id`, and `reason`/,
  },
  {
    label: "Docs include pull self-change exclusion",
    source: docs,
    pattern:
      "Pull responses exclude changes originally pushed by the requesting device.",
  },
  {
    label: "Docs include Web Admin-compatible admin snapshot fields",
    source: docs,
    pattern:
      /Web Admin-compatible\s+snapshot[\s\S]*"metrics"[\s\S]*"members"[\s\S]*"roles"[\s\S]*"devices"[\s\S]*"auditEvents"/,
  },
  {
    label: "Docs include admin snapshot dedicated admin token behavior",
    source: docs,
    pattern:
      /(?=[\s\S]*dedicated[\s\S]*`ATLASTERM_SYNC_ADMIN_TOKEN` bearer token[\s\S]*distinct from `ATLASTERM_SYNC_AUTH_TOKEN`)(?=[\s\S]*regular[\s\S]*`ATLASTERM_SYNC_AUTH_TOKEN`[\s\S]*`403 Forbidden`, `code: "admin_forbidden"`)(?=[\s\S]*unset or matches the sync token[\s\S]*`403 Forbidden`,[\s\S]*`code: "admin_token_required"`)/,
  },
  {
    label: "Docs include admin snapshot empty state",
    source: docs,
    pattern: /empty `members`, `roles`, `devices`, and `auditEvents`/,
  },
  {
    label: "Sync service README documents JSON ledger startup recovery",
    source: syncReadme,
    pattern:
      /primary ledger is preferred[\s\S]*valid `\.bak` ledger recovers[\s\S]*complete `\.tmp` ledger is used only when neither primary nor backup exists/,
  },
  {
    label: "Sync service README documents JSON ledger schema version behavior",
    source: syncReadme,
    pattern:
      /New ledgers include `schema_version: 1`[\s\S]*legacy v0[\s\S]*future `schema_version`[\s\S]*fail startup/,
  },
  {
    label: "Sync service README documents JSON ledger single-writer behavior",
    source: syncReadme,
    pattern:
      /`ledger\.lock`[\s\S]*single-writer[\s\S]*guard[\s\S]*second service instance[\s\S]*fails startup/,
  },
  {
    label:
      "Sync service README documents non-loopback metrics auth, scoped CORS, and durable storage guard",
    source: syncReadme,
    pattern:
      /non-loopback address[\s\S]*metrics bearer token[\s\S]*ATLASTERM_SYNC_STORAGE_PATH[\s\S]*permissive CORS is rejected[\s\S]*ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE=1[\s\S]*do not use it for Public Beta/,
  },
  {
    label: "Sync service README documents storage failure retry safety",
    source: syncReadme,
    pattern: /mutation is rolled back[\s\S]*same request can be retried/,
  },
  {
    label: "Sync service README documents JSON ledger quota limits",
    source: syncReadme,
    pattern:
      /ATLASTERM_SYNC_MAX_PUSH_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_STORED_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_LEDGER_BYTES[\s\S]*`413 Payload Too Large`[\s\S]*ledger_quota_exceeded/,
  },
  {
    label: "Self-hosting docs include JSON ledger quota limits",
    source: selfHosting,
    pattern:
      /ATLASTERM_SYNC_MAX_PUSH_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_STORED_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_LEDGER_BYTES[\s\S]*`413 Payload Too Large`[\s\S]*ledger_quota_exceeded/,
  },
  {
    label: "Sync Dockerfile builds the release binary with Cargo.lock",
    source: dockerfile,
    pattern: /cargo build --release -p atlasterm-sync --locked/,
  },
  {
    label: "Sync Dockerfile pins exact Rust and runtime image digests",
    source: dockerfile,
    pattern:
      /(?:^|\n)FROM rust:1\.96\.0-bookworm@sha256:[0-9a-f]{64} AS build\r?\n[\s\S]*(?:^|\n)FROM debian:bookworm-slim@sha256:[0-9a-f]{64}(?:\r?\n|$)/,
  },
  {
    label: "Sync Dockerfile keeps durable ledger defaults and healthcheck",
    source: dockerfile,
    pattern:
      /ATLASTERM_SYNC_BIND=0\.0\.0\.0:4100[\s\S]*ATLASTERM_SYNC_STORAGE_PATH=\/var\/lib\/joessh-sync\/ledger\.json[\s\S]*VOLUME \["\/var\/lib\/joessh-sync"\][\s\S]*HEALTHCHECK/,
  },
  {
    label: "Docker build context excludes generated and sensitive files",
    source: dockerignore,
    pattern:
      /(?=[\s\S]*\.git)(?=[\s\S]*node_modules)(?=[\s\S]*\*\*\/node_modules)(?=[\s\S]*target)(?=[\s\S]*\*\*\/target)(?=[\s\S]*\*\*\/dist)(?=[\s\S]*(?:^|\n)reports(?:\r?\n|$))(?=[\s\S]*\.env)/,
  },
  {
    label: "Self-hosting docs include hardened Docker runtime flags",
    source: selfHosting,
    pattern:
      /docker run[\s\S]*--read-only[\s\S]*--cap-drop=ALL[\s\S]*--security-opt no-new-privileges[\s\S]*--pids-limit 256[\s\S]*--memory 256m[\s\S]*--cpus 1[\s\S]*--tmpfs \/tmp:rw,noexec,nosuid,size=16m/,
  },
  {
    label: "Sync systemd example includes service sandbox and resource limits",
    source: systemd,
    pattern:
      /StateDirectory=joessh-sync[\s\S]*NoNewPrivileges=true[\s\S]*PrivateDevices=true[\s\S]*ProtectSystem=strict[\s\S]*ProtectControlGroups=true[\s\S]*ProtectKernelModules=true[\s\S]*ProtectKernelTunables=true[\s\S]*RestrictAddressFamilies=AF_INET AF_INET6[\s\S]*CapabilityBoundingSet=[\s\S]*AmbientCapabilities=[\s\S]*MemoryMax=256M[\s\S]*CPUQuota=100%/,
  },
  {
    label: "Self-hosting docs describe systemd sandboxing expectations",
    source: selfHosting,
    pattern:
      /StateDirectory=joessh-sync[\s\S]*NoNewPrivileges[\s\S]*PrivateDevices[\s\S]*strict filesystem protection[\s\S]*CapabilityBoundingSet[\s\S]*address-family restrictions[\s\S]*resource limits/,
  },
  {
    label: "QA checklist includes JSON ledger recovery gate",
    source: qaChecklist,
    pattern:
      /JSON ledger startup recovers from a valid `\.bak` file[\s\S]*complete `\.tmp` file/,
  },
  {
    label: "QA checklist includes JSON ledger schema migration gate",
    source: qaChecklist,
    pattern:
      /persisting `schema_version: 1`[\s\S]*migrates legacy v0 ledgers[\s\S]*rejects future `schema_version` values/,
  },
  {
    label: "QA checklist includes JSON ledger single-writer gate",
    source: qaChecklist,
    pattern:
      /configured storage directory before serving traffic[\s\S]*`ledger\.lock` single-writer guard[\s\S]*npm run qa:sync:config-guard-smoke[\s\S]*non-loopback bind without metrics auth fails startup[\s\S]*non-loopback bind without durable storage fails startup[\s\S]*non-loopback bind with an unusable storage path fails startup[\s\S]*non-loopback bind with permissive CORS fails startup/,
  },
  {
    label:
      "QA checklist includes Sync non-loopback metrics auth and durable storage gate",
    source: qaChecklist,
    pattern:
      /Non-loopback Sync binds require sync bearer auth, metrics bearer auth, durable JSON ledger storage, and scoped CORS[\s\S]*ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE=1/,
  },
  {
    label: "QA checklist includes JSON ledger rollback retry gate",
    source: qaChecklist,
    pattern: /roll back in-memory changes[\s\S]*same change ID can be retried/,
  },
  {
    label: "QA checklist includes JSON ledger quota gate",
    source: qaChecklist,
    pattern:
      /ATLASTERM_SYNC_MAX_PUSH_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_STORED_CHANGES[\s\S]*ATLASTERM_SYNC_MAX_LEDGER_BYTES[\s\S]*413 ledger_quota_exceeded/,
  },
  {
    label: "QA checklist includes Sync container and systemd hardening gate",
    source: qaChecklist,
    pattern:
      /Docker builds locked to `Cargo\.lock`[\s\S]*`\.dockerignore`[\s\S]*read-only root filesystem[\s\S]*drops Linux capabilities[\s\S]*`no-new-privileges`[\s\S]*StateDirectory=joessh-sync[\s\S]*CapabilityBoundingSet/,
  },
  {
    label: "QA checklist includes readiness gate",
    source: qaChecklist,
    pattern:
      /`GET \/readyz` returns `200`[\s\S]*returns `503`[\s\S]*unwritable/,
  },
  {
    label: "Self-hosted smoke checks readiness",
    source: syncSmoke,
    pattern: /await assertReady\(baseUrl\)[\s\S]*fetch\(`\$\{url\}\/readyz`\)/,
  },
  {
    label: "QA checklist includes Sync production config validation gate",
    source: qaChecklist,
    pattern:
      /(?=[\s\S]*bearer tokens must be at least 32 characters)(?=[\s\S]*must not be combined with permissive CORS)(?=[\s\S]*Non-loopback Sync binds require[\s\S]*scoped CORS)(?=[\s\S]*rejects invalid values at startup)/,
  },
  {
    label: "Config guard smoke rejects public permissive CORS",
    source: syncConfigGuard,
    pattern:
      /assertPublicBindRejectsPermissiveCors[\s\S]*ATLASTERM_SYNC_CORS_PERMISSIVE[\s\S]*ATLASTERM_SYNC_CORS_ORIGINS/,
  },
  {
    label: "Config guard smoke rejects unusable configured storage paths",
    source: syncConfigGuard,
    pattern:
      /assertConfiguredStoragePathMustBeUsable[\s\S]*blocked-storage-parent[\s\S]*ATLASTERM_SYNC_STORAGE_PATH[\s\S]*storage ledger directory/,
  },
  {
    label: "Root package keeps sync docs and Rust QA scripts",
    source: packageJson,
    pattern:
      /(?=[\s\S]*"qa:sync-api-docs": "node scripts\/verify-sync-api-docs\.mjs")(?=[\s\S]*"qa:rust": "cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings && cargo test --workspace")/,
  },
];

const failures = checks.filter(({ source, pattern }) => {
  if (pattern instanceof RegExp) {
    return !pattern.test(source);
  }

  return !source.includes(pattern);
});

if (failures.length > 0) {
  console.error("Sync API docs contract check failed:");
  for (const failure of failures) {
    console.error(`- ${failure.label}`);
  }
  process.exit(1);
}

console.log(`Sync API docs contract check passed (${checks.length} checks).`);
