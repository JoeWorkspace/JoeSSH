use std::{
    collections::{HashMap, HashSet},
    error::Error,
    fmt, fs,
    io::{ErrorKind, Write},
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use anyhow::Context;
use axum::{
    extract::{ConnectInfo, Query, Request, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use tokio::net::TcpListener;
use tower_http::{
    cors::{AllowOrigin, CorsLayer},
    limit::RequestBodyLimitLayer,
    set_header::SetResponseHeaderLayer,
    trace::TraceLayer,
};
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};
use uuid::Uuid;

mod rate_limit;
use rate_limit::RateLimiter;
mod config;
use config::SyncConfig;

const AUDIT_EVENT_LIMIT: usize = 8;
const AUDIT_LOG_RETENTION: usize = 10_000;
const MAX_SYNC_APP_VERSION_CHARS: usize = 64;
const MAX_SYNC_DISPLAY_NAME_CHARS: usize = 128;
const MAX_SYNC_ENTITY_TOKEN_CHARS: usize = 128;
const PROCESSED_ID_RETENTION: u64 = 100_000;
const SYNC_LEDGER_SCHEMA_VERSION: u32 = 1;

#[derive(Debug)]
struct UnsupportedLedgerSchemaVersion {
    version: u32,
}

impl fmt::Display for UnsupportedLedgerSchemaVersion {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "unsupported sync storage ledger schema_version {}; this binary supports up to {}",
            self.version, SYNC_LEDGER_SCHEMA_VERSION
        )
    }
}

impl Error for UnsupportedLedgerSchemaVersion {}

struct AppState {
    auth_token: Option<String>,
    admin_token: Option<String>,
    metrics_token: Option<String>,
    metrics: SyncMetrics,
    service_name: &'static str,
    storage_path: Option<PathBuf>,
    _storage_lock: Option<StorageLock>,
    store: Mutex<SyncStore>,
    rate_limit: Option<RateLimiter>,
    max_push_changes: usize,
    max_pull_changes: usize,
    max_stored_changes: usize,
    max_ledger_bytes: u64,
}

struct StorageLock {
    _file: fs::File,
    path: PathBuf,
}

impl Drop for StorageLock {
    fn drop(&mut self) {
        if let Err(error) = fs::remove_file(&self.path) {
            tracing::warn!(
                error = %error,
                path = %self.path.display(),
                "failed to remove sync storage ledger lock"
            );
        }
    }
}

#[derive(Default)]
struct SyncMetrics {
    admin_auth_failures: AtomicU64,
    backup_recoveries: AtomicU64,
    http_requests: Mutex<HashMap<HttpMetricKey, HttpMetricCounters>>,
    metrics_auth_failures: AtomicU64,
    rate_limited: AtomicU64,
    storage_write_failures: AtomicU64,
    sync_auth_failures: AtomicU64,
    temp_recoveries: AtomicU64,
}

#[derive(Clone, Eq, Hash, PartialEq)]
struct HttpMetricKey {
    method: String,
    path: String,
    status: u16,
}

#[derive(Clone, Default)]
struct HttpMetricCounters {
    count: u64,
    duration_micros: u64,
}

#[derive(Default)]
struct StoreMetricsSnapshot {
    audit_events: usize,
    changes: usize,
    devices: usize,
    latest_sequence: u64,
    processed_change_ids: usize,
}

struct LoadedStore {
    backup_recoveries: u64,
    store: SyncStore,
    temp_recoveries: u64,
}

impl SyncMetrics {
    fn with_recovery_counts(backup_recoveries: u64, temp_recoveries: u64) -> Self {
        let metrics = Self::default();
        metrics
            .backup_recoveries
            .store(backup_recoveries, Ordering::Relaxed);
        metrics
            .temp_recoveries
            .store(temp_recoveries, Ordering::Relaxed);
        metrics
    }

    fn record_request(&self, method: &Method, path: &str, status: StatusCode, duration: Duration) {
        let mut http_requests = self
            .http_requests
            .lock()
            .expect("sync metrics mutex poisoned");
        let counters = http_requests
            .entry(HttpMetricKey {
                method: method.as_str().into(),
                path: path.into(),
                status: status.as_u16(),
            })
            .or_default();
        counters.count += 1;
        counters.duration_micros += duration.as_micros().try_into().unwrap_or(u64::MAX);
    }

    fn render_prometheus(&self, store: StoreMetricsSnapshot) -> String {
        let mut lines = vec![
            "# HELP joessh_sync_http_requests_total HTTP requests by method, path, and status."
                .into(),
            "# TYPE joessh_sync_http_requests_total counter".into(),
        ];

        let mut http_requests: Vec<_> = self
            .http_requests
            .lock()
            .expect("sync metrics mutex poisoned")
            .iter()
            .map(|(key, counters)| (key.clone(), counters.clone()))
            .collect();
        http_requests.sort_by(|(left, _), (right, _)| {
            left.path
                .cmp(&right.path)
                .then(left.method.cmp(&right.method))
                .then(left.status.cmp(&right.status))
        });

        for (key, counters) in &http_requests {
            lines.push(format!(
                "joessh_sync_http_requests_total{{method=\"{}\",path=\"{}\",status=\"{}\"}} {}",
                prometheus_escape(&key.method),
                prometheus_escape(&key.path),
                key.status,
                counters.count
            ));
        }

        lines.extend([
            "# HELP joessh_sync_http_request_duration_seconds_sum Total HTTP request duration by method, path, and status.".into(),
            "# TYPE joessh_sync_http_request_duration_seconds_sum counter".into(),
        ]);
        for (key, counters) in &http_requests {
            lines.push(format!(
                "joessh_sync_http_request_duration_seconds_sum{{method=\"{}\",path=\"{}\",status=\"{}\"}} {:.6}",
                prometheus_escape(&key.method),
                prometheus_escape(&key.path),
                key.status,
                counters.duration_micros as f64 / 1_000_000.0
            ));
        }

        lines.extend([
            "# HELP joessh_sync_http_request_duration_seconds_count HTTP request duration sample count by method, path, and status.".into(),
            "# TYPE joessh_sync_http_request_duration_seconds_count counter".into(),
        ]);
        for (key, counters) in &http_requests {
            lines.push(format!(
                "joessh_sync_http_request_duration_seconds_count{{method=\"{}\",path=\"{}\",status=\"{}\"}} {}",
                prometheus_escape(&key.method),
                prometheus_escape(&key.path),
                key.status,
                counters.count
            ));
        }

        lines.extend([
            "# HELP joessh_sync_auth_failures_total Authorization failures by API surface.".into(),
            "# TYPE joessh_sync_auth_failures_total counter".into(),
            format!(
                "joessh_sync_auth_failures_total{{surface=\"sync\"}} {}",
                self.sync_auth_failures.load(Ordering::Relaxed)
            ),
            format!(
                "joessh_sync_auth_failures_total{{surface=\"admin\"}} {}",
                self.admin_auth_failures.load(Ordering::Relaxed)
            ),
            format!(
                "joessh_sync_auth_failures_total{{surface=\"metrics\"}} {}",
                self.metrics_auth_failures.load(Ordering::Relaxed)
            ),
            "# HELP joessh_sync_rate_limited_total Requests rejected by the per-client rate limiter.".into(),
            "# TYPE joessh_sync_rate_limited_total counter".into(),
            format!(
                "joessh_sync_rate_limited_total {}",
                self.rate_limited.load(Ordering::Relaxed)
            ),
            "# HELP joessh_sync_storage_write_failures_total JSON ledger write failures.".into(),
            "# TYPE joessh_sync_storage_write_failures_total counter".into(),
            format!(
                "joessh_sync_storage_write_failures_total {}",
                self.storage_write_failures.load(Ordering::Relaxed)
            ),
            "# HELP joessh_sync_ledger_recovery_total JSON ledger recoveries by source.".into(),
            "# TYPE joessh_sync_ledger_recovery_total counter".into(),
            format!(
                "joessh_sync_ledger_recovery_total{{source=\"backup\"}} {}",
                self.backup_recoveries.load(Ordering::Relaxed)
            ),
            format!(
                "joessh_sync_ledger_recovery_total{{source=\"temp\"}} {}",
                self.temp_recoveries.load(Ordering::Relaxed)
            ),
            "# HELP joessh_sync_devices_registered Current registered device records.".into(),
            "# TYPE joessh_sync_devices_registered gauge".into(),
            format!("joessh_sync_devices_registered {}", store.devices),
            "# HELP joessh_sync_changes_stored Current stored change records.".into(),
            "# TYPE joessh_sync_changes_stored gauge".into(),
            format!("joessh_sync_changes_stored {}", store.changes),
            "# HELP joessh_sync_latest_sequence Current server cursor sequence.".into(),
            "# TYPE joessh_sync_latest_sequence gauge".into(),
            format!("joessh_sync_latest_sequence {}", store.latest_sequence),
            "# HELP joessh_sync_processed_change_ids Current retained processed change identifiers.".into(),
            "# TYPE joessh_sync_processed_change_ids gauge".into(),
            format!(
                "joessh_sync_processed_change_ids {}",
                store.processed_change_ids
            ),
            "# HELP joessh_sync_audit_events Current retained admin audit events.".into(),
            "# TYPE joessh_sync_audit_events gauge".into(),
            format!("joessh_sync_audit_events {}", store.audit_events),
            String::new(),
        ]);

        lines.join("\n")
    }
}

impl From<&SyncStore> for StoreMetricsSnapshot {
    fn from(store: &SyncStore) -> Self {
        Self {
            audit_events: store.audit_log.len(),
            changes: store.changes.len(),
            devices: store.devices.len(),
            latest_sequence: store.latest_sequence,
            processed_change_ids: store.processed_change_ids.len(),
        }
    }
}

/// Fixed-window, per-client-IP rate limiter lives in the `rate_limit` module.
/// `SyncConfig` and env/CORS parsing live in the `config` module.

#[derive(Clone, Serialize, Deserialize)]
struct SyncStore {
    #[serde(default)]
    schema_version: u32,
    devices: HashMap<Uuid, RegisteredDeviceRecord>,
    processed_change_ids: HashSet<Uuid>,
    changes: Vec<StoredChange>,
    latest_sequence: u64,
    #[serde(default)]
    audit_log: Vec<StoredAuditEvent>,
}

impl Default for SyncStore {
    fn default() -> Self {
        Self {
            schema_version: SYNC_LEDGER_SCHEMA_VERSION,
            devices: HashMap::new(),
            processed_change_ids: HashSet::new(),
            changes: Vec::new(),
            latest_sequence: 0,
            audit_log: Vec::new(),
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Serialize, Deserialize)]
struct RegisteredDeviceRecord {
    device_id: Uuid,
    platform: DevicePlatform,
    app_version: String,
    display_name: Option<String>,
    registered_at: DateTime<Utc>,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredChange {
    sequence: u64,
    cursor: String,
    id: Uuid,
    device_id: Uuid,
    entity_type: String,
    entity_id: String,
    operation: SyncOperation,
    payload: serde_json::Value,
    #[allow(dead_code)]
    client_time: DateTime<Utc>,
    server_time: DateTime<Utc>,
}

#[derive(Clone, Serialize, Deserialize)]
struct StoredAuditEvent {
    id: String,
    action: String,
    actor: String,
    target: String,
    time: DateTime<Utc>,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "atlasterm_sync=debug,tower_http=info,axum=info".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    let bind = std::env::var("ATLASTERM_SYNC_BIND").unwrap_or_else(|_| "127.0.0.1:4100".into());
    let addr: SocketAddr = bind
        .parse()
        .context("ATLASTERM_SYNC_BIND must be host:port")?;
    let listener = TcpListener::bind(addr).await?;
    let config = SyncConfig::from_env()?;

    if let Err(message) = check_bind_safety(&addr, &config) {
        anyhow::bail!(message);
    }

    if config.cors_permissive && !cfg!(debug_assertions) {
        tracing::warn!(
            "ATLASTERM_SYNC_CORS_PERMISSIVE is enabled in a release build — this is intended for local development only"
        );
    }

    tracing::info!(%addr, "starting JoeSSH sync service");
    axum::serve(
        listener,
        try_app_with_config(config)?.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .await?;
    Ok(())
}

#[cfg(test)]
fn app() -> Router {
    app_with_config(SyncConfig::default())
}

/// Refuse unsafe production-facing binds. Non-loopback deployments must be
/// authenticated and durable unless an operator explicitly opts into ephemeral
/// storage for a short-lived evaluation environment.
fn check_bind_safety(addr: &SocketAddr, config: &SyncConfig) -> Result<(), String> {
    if addr.ip().is_loopback() {
        return Ok(());
    }

    if config.auth_token.is_none() {
        return Err(format!(
            "refusing to start: ATLASTERM_SYNC_BIND={addr} is non-loopback but no ATLASTERM_SYNC_AUTH_TOKEN is set; \
             set an auth token or bind to a loopback address"
        ));
    }

    if config.metrics_token.is_none() {
        return Err(format!(
            "refusing to start: ATLASTERM_SYNC_BIND={addr} is non-loopback but no ATLASTERM_SYNC_METRICS_TOKEN is set; \
             set a metrics token, bind to loopback, or keep /metrics behind a loopback-only scraper"
        ));
    }

    if config.cors_permissive {
        return Err(format!(
            "refusing to start: ATLASTERM_SYNC_BIND={addr} is non-loopback but ATLASTERM_SYNC_CORS_PERMISSIVE=1 is enabled; \
             set ATLASTERM_SYNC_CORS_ORIGINS to exact HTTP(S) origins or bind to loopback for local browser development"
        ));
    }

    if config.storage_path.is_none() && !config.allow_ephemeral_storage {
        return Err(format!(
            "refusing to start: ATLASTERM_SYNC_BIND={addr} is non-loopback but ATLASTERM_SYNC_STORAGE_PATH is not set; \
             configure durable JSON ledger storage or set ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE=1 for an explicit short-lived evaluation"
        ));
    }

    Ok(())
}

#[cfg(test)]
fn app_with_config(config: SyncConfig) -> Router {
    try_app_with_config(config).expect("sync service app configuration should be valid")
}

fn try_app_with_config(config: SyncConfig) -> anyhow::Result<Router> {
    let storage_lock = acquire_storage_lock(config.storage_path.as_deref())?;
    let loaded_store = load_store(
        config.storage_path.as_deref(),
        config.max_ledger_bytes,
        config.max_stored_changes,
    )?;
    let rate_limit = (config.rate_limit_per_second > 0)
        .then(|| RateLimiter::new(config.rate_limit_per_second, Duration::from_secs(1)));
    let state = Arc::new(AppState {
        auth_token: config.auth_token.clone(),
        admin_token: config.admin_token.clone(),
        metrics_token: config.metrics_token.clone(),
        metrics: SyncMetrics::with_recovery_counts(
            loaded_store.backup_recoveries,
            loaded_store.temp_recoveries,
        ),
        service_name: "atlasterm-sync",
        storage_path: config.storage_path.clone(),
        _storage_lock: storage_lock,
        store: Mutex::new(loaded_store.store),
        rate_limit,
        max_push_changes: config.max_push_changes,
        max_pull_changes: config.max_pull_changes,
        max_stored_changes: config.max_stored_changes,
        max_ledger_bytes: config.max_ledger_bytes,
    });

    let sync_routes = Router::new()
        .route("/v1/devices/register", post(register_device))
        .route("/v1/sync/push", post(push_changes))
        .route("/v1/sync/pull", get(pull_changes))
        .layer(cors_layer(&config))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_sync_authorization,
        ));

    let admin_routes = Router::new()
        .route("/v1/admin/snapshot", get(admin_snapshot))
        .layer(cors_layer(&config))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            require_admin_authorization,
        ));

    let v1_routes = sync_routes.merge(admin_routes);
    let metrics_routes =
        Router::new()
            .route("/metrics", get(metrics))
            .layer(middleware::from_fn_with_state(
                state.clone(),
                require_metrics_authorization,
            ));

    Ok(Router::new()
        .route("/healthz", get(healthz))
        .route("/readyz", get(readyz))
        .merge(metrics_routes)
        .merge(v1_routes)
        .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("no-referrer"),
        ))
        .layer(SetResponseHeaderLayer::overriding(
            header::HeaderName::from_static("permissions-policy"),
            HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=()"),
        ))
        .layer(TraceLayer::new_for_http())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            enforce_rate_limit,
        ))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            record_http_metrics,
        ))
        .with_state(state))
}

fn acquire_storage_lock(path: Option<&Path>) -> anyhow::Result<Option<StorageLock>> {
    let Some(path) = path else {
        return Ok(None);
    };

    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to prepare sync storage ledger directory {}; configured ATLASTERM_SYNC_STORAGE_PATH must be writable before startup",
                parent.display()
            )
        })?;
    }

    let lock_path = path.with_extension("lock");
    let mut file = open_storage_lock_file(&lock_path).with_context(|| {
        format!(
            "failed to acquire sync storage ledger lock at {}; another Sync Service instance may already be using this JSON ledger, or a stale lock may need operator cleanup after a crash",
            lock_path.display()
        )
    })?;
    writeln!(file, "pid={}", std::process::id()).with_context(|| {
        format!(
            "failed to write sync storage ledger lock owner at {}",
            lock_path.display()
        )
    })?;

    Ok(Some(StorageLock {
        _file: file,
        path: lock_path,
    }))
}

fn open_storage_lock_file(lock_path: &Path) -> anyhow::Result<fs::File> {
    match create_storage_lock_file(lock_path) {
        Ok(file) => Ok(file),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            if remove_stale_storage_lock(lock_path)? {
                return create_storage_lock_file(lock_path).with_context(|| {
                    format!(
                        "failed to recreate stale sync storage ledger lock at {}",
                        lock_path.display()
                    )
                });
            }

            Err(error).with_context(|| {
                format!(
                    "active sync storage ledger lock exists at {}",
                    lock_path.display()
                )
            })
        }
        Err(error) => Err(error).with_context(|| {
            format!(
                "failed to create sync storage ledger lock at {}",
                lock_path.display()
            )
        }),
    }
}

fn create_storage_lock_file(lock_path: &Path) -> std::io::Result<fs::File> {
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(lock_path)
}

fn remove_stale_storage_lock(lock_path: &Path) -> anyhow::Result<bool> {
    let contents = fs::read_to_string(lock_path).with_context(|| {
        format!(
            "failed to read existing sync storage ledger lock at {}",
            lock_path.display()
        )
    })?;
    let Some(pid) = parse_storage_lock_pid(&contents) else {
        return Ok(false);
    };
    if process_is_running(pid) {
        return Ok(false);
    }

    fs::remove_file(lock_path).with_context(|| {
        format!(
            "failed to remove stale sync storage ledger lock at {}",
            lock_path.display()
        )
    })?;
    tracing::warn!(
        pid,
        path = %lock_path.display(),
        "removed stale sync storage ledger lock"
    );
    Ok(true)
}

fn parse_storage_lock_pid(contents: &str) -> Option<u32> {
    contents
        .lines()
        .find_map(|line| line.strip_prefix("pid=")?.trim().parse().ok())
}

#[cfg(windows)]
fn process_is_running(pid: u32) -> bool {
    let Ok(output) = Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
    else {
        return true;
    };

    output.status.success() && String::from_utf8_lossy(&output.stdout).contains(&pid.to_string())
}

#[cfg(not(windows))]
fn process_is_running(pid: u32) -> bool {
    let Ok(status) = Command::new("kill").args(["-0", &pid.to_string()]).status() else {
        return true;
    };

    status.success()
}

async fn require_sync_authorization(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    if is_cors_preflight(request.method(), &headers) {
        return next.run(request).await;
    }

    let Some(expected_token) = state.auth_token.as_deref() else {
        return next.run(request).await;
    };

    let Some(header_value) = headers.get(header::AUTHORIZATION) else {
        state
            .metrics
            .sync_auth_failures
            .fetch_add(1, Ordering::Relaxed);
        return auth_error(
            StatusCode::UNAUTHORIZED,
            "missing_authorization",
            "sync requests require Authorization: Bearer credentials",
        );
    };

    let Ok(header_value) = header_value.to_str() else {
        state
            .metrics
            .sync_auth_failures
            .fetch_add(1, Ordering::Relaxed);
        return auth_error(
            StatusCode::UNAUTHORIZED,
            "invalid_authorization",
            "authorization credentials must be valid UTF-8",
        );
    };

    let Some(actual_token) = parse_bearer_token(header_value) else {
        state
            .metrics
            .sync_auth_failures
            .fetch_add(1, Ordering::Relaxed);
        return auth_error(
            StatusCode::FORBIDDEN,
            "invalid_authorization",
            "authorization credentials were rejected",
        );
    };

    if !constant_time_eq(actual_token, expected_token) {
        state
            .metrics
            .sync_auth_failures
            .fetch_add(1, Ordering::Relaxed);
        return auth_error(
            StatusCode::FORBIDDEN,
            "invalid_authorization",
            "authorization credentials were rejected",
        );
    }

    next.run(request).await
}

async fn require_admin_authorization(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    if is_cors_preflight(request.method(), &headers) {
        return next.run(request).await;
    }

    let Some(expected_token) = state.admin_token.as_deref() else {
        state
            .metrics
            .admin_auth_failures
            .fetch_add(1, Ordering::Relaxed);
        return auth_error(
            StatusCode::FORBIDDEN,
            "admin_token_required",
            "admin endpoints require a distinct ATLASTERM_SYNC_ADMIN_TOKEN to be configured",
        );
    };

    if state
        .auth_token
        .as_deref()
        .map(|sync_token| constant_time_eq(sync_token, expected_token))
        .unwrap_or(false)
    {
        state
            .metrics
            .admin_auth_failures
            .fetch_add(1, Ordering::Relaxed);
        return auth_error(
            StatusCode::FORBIDDEN,
            "admin_token_required",
            "admin endpoints require a distinct ATLASTERM_SYNC_ADMIN_TOKEN to be configured",
        );
    }

    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_bearer_token);

    match presented {
        Some(token) if constant_time_eq(token, expected_token) => next.run(request).await,
        Some(_) => {
            state
                .metrics
                .admin_auth_failures
                .fetch_add(1, Ordering::Relaxed);
            auth_error(
                StatusCode::FORBIDDEN,
                "admin_forbidden",
                "admin endpoints require valid admin credentials",
            )
        }
        None => {
            state
                .metrics
                .admin_auth_failures
                .fetch_add(1, Ordering::Relaxed);
            auth_error(
                StatusCode::UNAUTHORIZED,
                "missing_authorization",
                "sync requests require Authorization: Bearer credentials",
            )
        }
    }
}

async fn require_metrics_authorization(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    request: Request,
    next: Next,
) -> Response {
    let Some(expected_token) = state.metrics_token.as_deref() else {
        return next.run(request).await;
    };

    let presented = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(parse_bearer_token);

    match presented {
        Some(token) if constant_time_eq(token, expected_token) => next.run(request).await,
        Some(_) => {
            state
                .metrics
                .metrics_auth_failures
                .fetch_add(1, Ordering::Relaxed);
            auth_error(
                StatusCode::FORBIDDEN,
                "metrics_forbidden",
                "metrics endpoint requires valid metrics credentials",
            )
        }
        None => {
            state
                .metrics
                .metrics_auth_failures
                .fetch_add(1, Ordering::Relaxed);
            auth_error(
                StatusCode::UNAUTHORIZED,
                "missing_authorization",
                "metrics endpoint requires Authorization: Bearer credentials",
            )
        }
    }
}

async fn enforce_rate_limit(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    if let Some(limiter) = state.rate_limit.as_ref() {
        if let Some(ConnectInfo(peer)) = request.extensions().get::<ConnectInfo<SocketAddr>>() {
            if !limiter.check(peer.ip()) {
                state.metrics.rate_limited.fetch_add(1, Ordering::Relaxed);
                return auth_error(
                    StatusCode::TOO_MANY_REQUESTS,
                    "rate_limited",
                    "too many requests; slow down and retry shortly",
                );
            }
        }
    }
    next.run(request).await
}

async fn record_http_metrics(
    State(state): State<Arc<AppState>>,
    request: Request,
    next: Next,
) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let started_at = Instant::now();
    let response = next.run(request).await;
    state
        .metrics
        .record_request(&method, &path, response.status(), started_at.elapsed());
    response
}

fn is_cors_preflight(method: &Method, headers: &HeaderMap) -> bool {
    method == Method::OPTIONS
        && headers.contains_key(header::ORIGIN)
        && headers.contains_key(header::ACCESS_CONTROL_REQUEST_METHOD)
}

fn parse_bearer_token(header_value: &str) -> Option<&str> {
    let mut parts = header_value.split_whitespace();
    let scheme = parts.next()?;
    let token = parts.next()?;

    if scheme.eq_ignore_ascii_case("bearer") && parts.next().is_none() {
        Some(token)
    } else {
        None
    }
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let max_len = left.len().max(right.len());
    let mut diff = left.len() ^ right.len();

    for index in 0..max_len {
        let left_byte = left.get(index).copied().unwrap_or(0);
        let right_byte = right.get(index).copied().unwrap_or(0);
        diff |= usize::from(left_byte ^ right_byte);
    }

    diff == 0
}

fn auth_error(status: StatusCode, code: &'static str, message: &'static str) -> Response {
    (status, Json(ErrorResponse { code, message })).into_response()
}

fn prometheus_escape(value: &str) -> String {
    value
        .replace('\\', r"\\")
        .replace('\n', r"\n")
        .replace('"', r#"\""#)
}

fn cors_layer(config: &SyncConfig) -> CorsLayer {
    match &config.cors_allowed_origins {
        Some(origins) => CorsLayer::new()
            .allow_origin(AllowOrigin::list(origins.clone()))
            .allow_methods([Method::GET, Method::POST, Method::OPTIONS])
            .allow_headers([header::AUTHORIZATION, header::CONTENT_TYPE]),
        None if config.cors_permissive => CorsLayer::permissive(),
        None => CorsLayer::new(),
    }
}

fn load_store(
    path: Option<&Path>,
    max_ledger_bytes: u64,
    max_stored_changes: usize,
) -> anyhow::Result<LoadedStore> {
    let Some(path) = path else {
        return Ok(LoadedStore {
            backup_recoveries: 0,
            store: SyncStore::default(),
            temp_recoveries: 0,
        });
    };

    let backup_path = path.with_extension("bak");
    let temp_path = path.with_extension("tmp");

    match load_store_file(path, max_ledger_bytes, max_stored_changes) {
        Ok(Some(store)) => {
            return Ok(LoadedStore {
                backup_recoveries: 0,
                store,
                temp_recoveries: 0,
            })
        }
        Ok(None) => {}
        Err(primary_error) => {
            if primary_error
                .downcast_ref::<UnsupportedLedgerSchemaVersion>()
                .is_some()
            {
                return Err(primary_error);
            }

            if backup_path.exists() {
                tracing::warn!(
                    error = %primary_error,
                    path = %path.display(),
                    backup_path = %backup_path.display(),
                    "primary sync storage ledger is unreadable; recovering from backup"
                );
                let store =
                    load_required_store_file(&backup_path, max_ledger_bytes, max_stored_changes)
                        .with_context(|| {
                            format!(
                                "failed to recover sync storage ledger from backup at {}",
                                backup_path.display()
                            )
                        })?;
                return Ok(LoadedStore {
                    backup_recoveries: 1,
                    store,
                    temp_recoveries: 0,
                });
            }

            return Err(primary_error);
        }
    }

    if backup_path.exists() {
        tracing::warn!(
            path = %path.display(),
            backup_path = %backup_path.display(),
            "primary sync storage ledger is missing; recovering from backup"
        );
        let store = load_required_store_file(&backup_path, max_ledger_bytes, max_stored_changes)
            .with_context(|| {
                format!(
                    "failed to recover sync storage ledger from backup at {}",
                    backup_path.display()
                )
            })?;
        return Ok(LoadedStore {
            backup_recoveries: 1,
            store,
            temp_recoveries: 0,
        });
    }

    if temp_path.exists() {
        tracing::warn!(
            path = %path.display(),
            temp_path = %temp_path.display(),
            "primary sync storage ledger is missing; recovering from temp ledger"
        );
        let store = load_required_store_file(&temp_path, max_ledger_bytes, max_stored_changes)
            .with_context(|| {
                format!(
                    "failed to recover sync storage ledger from temp file at {}",
                    temp_path.display()
                )
            })?;
        return Ok(LoadedStore {
            backup_recoveries: 0,
            store,
            temp_recoveries: 1,
        });
    }

    Ok(LoadedStore {
        backup_recoveries: 0,
        store: SyncStore::default(),
        temp_recoveries: 0,
    })
}

fn load_store_file(
    path: &Path,
    max_ledger_bytes: u64,
    max_stored_changes: usize,
) -> anyhow::Result<Option<SyncStore>> {
    if !path.exists() {
        return Ok(None);
    }

    load_required_store_file(path, max_ledger_bytes, max_stored_changes).map(Some)
}

fn load_required_store_file(
    path: &Path,
    max_ledger_bytes: u64,
    max_stored_changes: usize,
) -> anyhow::Result<SyncStore> {
    let metadata = fs::metadata(path)
        .with_context(|| format!("failed to stat sync storage ledger at {}", path.display()))?;
    anyhow::ensure!(
        metadata.len() <= max_ledger_bytes,
        "sync storage ledger at {} exceeds ATLASTERM_SYNC_MAX_LEDGER_BYTES",
        path.display()
    );
    let bytes = fs::read(path)
        .with_context(|| format!("failed to read sync storage ledger at {}", path.display()))?;
    let store: SyncStore = serde_json::from_slice(&bytes)
        .with_context(|| format!("failed to parse sync storage ledger at {}", path.display()))?;

    normalize_loaded_store(store, max_stored_changes)
}

fn normalize_loaded_store(
    mut store: SyncStore,
    max_stored_changes: usize,
) -> anyhow::Result<SyncStore> {
    match store.schema_version {
        0 | SYNC_LEDGER_SCHEMA_VERSION => {}
        version => return Err(UnsupportedLedgerSchemaVersion { version }.into()),
    }
    store.schema_version = SYNC_LEDGER_SCHEMA_VERSION;
    anyhow::ensure!(
        store.changes.len() <= max_stored_changes,
        "sync storage ledger contains more changes than ATLASTERM_SYNC_MAX_STORED_CHANGES"
    );

    for change in &mut store.changes {
        store.latest_sequence = store.latest_sequence.max(change.sequence);
        change.cursor = cursor_from_sequence(change.sequence);
        store.processed_change_ids.insert(change.id);
    }
    store.prune_audit_log();

    Ok(store)
}

fn persist_store(
    path: Option<&Path>,
    store: &SyncStore,
    max_ledger_bytes: u64,
) -> anyhow::Result<()> {
    let Some(path) = path else {
        return Ok(());
    };

    if let Some(parent) = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
    {
        fs::create_dir_all(parent).with_context(|| {
            format!(
                "failed to create sync storage directory {}",
                parent.display()
            )
        })?;
    }

    let temp_path = path.with_extension("tmp");
    let backup_path = path.with_extension("bak");
    let mut persisted_store = store.clone();
    persisted_store.schema_version = SYNC_LEDGER_SCHEMA_VERSION;
    let bytes = serialize_store_for_persistence(&persisted_store)?;
    anyhow::ensure!(
        bytes.len() as u64 <= max_ledger_bytes,
        "sync storage ledger exceeds ATLASTERM_SYNC_MAX_LEDGER_BYTES"
    );
    fs::write(&temp_path, bytes).with_context(|| {
        format!(
            "failed to write sync storage temp ledger at {}",
            temp_path.display()
        )
    })?;

    if path.exists() {
        // Atomic rename replaces any existing backup in a single syscall,
        // avoiding the crash window between remove + rename that could lose both copies.
        fs::rename(path, &backup_path).with_context(|| {
            format!(
                "failed to back up sync storage ledger at {}",
                path.display()
            )
        })?;
    }

    if let Err(error) = fs::rename(&temp_path, path) {
        if backup_path.exists() {
            let _ = fs::rename(&backup_path, path);
        }

        return Err(error).with_context(|| {
            format!("failed to commit sync storage ledger at {}", path.display())
        });
    }

    if backup_path.exists() {
        if let Err(error) = fs::remove_file(&backup_path) {
            tracing::warn!(error = %error, path = %backup_path.display(), "failed to remove sync storage backup");
        }
    }

    Ok(())
}

fn serialize_store_for_persistence(store: &SyncStore) -> anyhow::Result<Vec<u8>> {
    serde_json::to_vec_pretty(store).context("failed to serialize sync storage ledger")
}

fn storage_error_response(error: anyhow::Error) -> Response {
    tracing::error!(error = %error, "sync storage persistence failed");

    (
        StatusCode::SERVICE_UNAVAILABLE,
        Json(ErrorResponse {
            code: "storage_unavailable",
            message: "sync storage could not be persisted",
        }),
    )
        .into_response()
}

fn ledger_quota_error_response() -> Response {
    (
        StatusCode::PAYLOAD_TOO_LARGE,
        Json(ErrorResponse {
            code: "ledger_quota_exceeded",
            message: "sync ledger quota exceeded; compact, raise the configured limit, or provision a database backend",
        }),
    )
        .into_response()
}

fn store_exceeds_ledger_byte_limit(
    store: &SyncStore,
    max_ledger_bytes: u64,
) -> anyhow::Result<bool> {
    Ok(serialize_store_for_persistence(store)?.len() as u64 > max_ledger_bytes)
}

async fn healthz(State(state): State<Arc<AppState>>) -> Json<HealthResponse> {
    Json(HealthResponse {
        ok: true,
        service: state.service_name,
        version: env!("CARGO_PKG_VERSION"),
        checked_at: Utc::now(),
    })
}

async fn metrics(State(state): State<Arc<AppState>>) -> Response {
    let store_metrics = {
        let store = state.store.lock().expect("sync store mutex poisoned");
        StoreMetricsSnapshot::from(&*store)
    };
    let body = state.metrics.render_prometheus(store_metrics);

    (
        [(
            header::CONTENT_TYPE,
            "text/plain; version=0.0.4; charset=utf-8",
        )],
        body,
    )
        .into_response()
}

async fn readyz(State(state): State<Arc<AppState>>) -> Response {
    let checked_at = Utc::now();
    match storage_readiness(state.storage_path.as_deref()) {
        Ok(storage) => (
            StatusCode::OK,
            Json(ReadinessResponse {
                ok: true,
                service: state.service_name,
                version: env!("CARGO_PKG_VERSION"),
                checked_at,
                storage,
            }),
        )
            .into_response(),
        Err(error) => {
            tracing::error!(error = %error, "sync readiness check failed");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(ReadinessResponse {
                    ok: false,
                    service: state.service_name,
                    version: env!("CARGO_PKG_VERSION"),
                    checked_at,
                    storage: StorageReadiness {
                        mode: "json_ledger",
                        writable: false,
                        message: "configured sync storage is not writable",
                    },
                }),
            )
                .into_response()
        }
    }
}

fn storage_readiness(path: Option<&Path>) -> anyhow::Result<StorageReadiness> {
    let Some(path) = path else {
        return Ok(StorageReadiness {
            mode: "memory",
            writable: true,
            message: "process-local memory ledger",
        });
    };

    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent).with_context(|| {
        format!(
            "failed to create sync storage readiness directory {}",
            parent.display()
        )
    })?;

    let probe_path = parent.join(format!(".joessh-sync-readyz-{}.tmp", Uuid::new_v4()));
    fs::write(&probe_path, b"ready").with_context(|| {
        format!(
            "failed to write sync storage readiness probe at {}",
            probe_path.display()
        )
    })?;
    fs::remove_file(&probe_path).with_context(|| {
        format!(
            "failed to remove sync storage readiness probe at {}",
            probe_path.display()
        )
    })?;

    Ok(StorageReadiness {
        mode: "json_ledger",
        writable: true,
        message: "configured sync storage is writable",
    })
}

async fn register_device(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RegisterDeviceRequest>,
) -> impl IntoResponse {
    if let Err(error) = validate_register_device_request(&request) {
        return (StatusCode::BAD_REQUEST, Json(error)).into_response();
    }

    let device_id = request.device_id.unwrap_or_else(Uuid::new_v4);
    let server_time = Utc::now();

    let mut store = state.store.lock().expect("sync store mutex poisoned");
    let previous_store = store.clone();
    let display_name = request.display_name.clone();
    store.register_device(RegisteredDeviceRecord {
        device_id,
        platform: request.platform,
        app_version: request.app_version,
        display_name: request.display_name,
        registered_at: server_time,
    });

    let device_label = display_name.as_deref().unwrap_or("unknown device");
    store.record_audit_event(StoredAuditEvent {
        id: format!("register-{device_id}"),
        action: format!("Registered {device_label}"),
        actor: "Sync API".into(),
        target: format!("device:{device_id}"),
        time: server_time,
    });

    match store_exceeds_ledger_byte_limit(&store, state.max_ledger_bytes) {
        Ok(true) => {
            *store = previous_store;
            return ledger_quota_error_response();
        }
        Ok(false) => {}
        Err(error) => {
            *store = previous_store;
            state
                .metrics
                .storage_write_failures
                .fetch_add(1, Ordering::Relaxed);
            return storage_error_response(error);
        }
    }

    if let Err(error) = persist_store(
        state.storage_path.as_deref(),
        &store,
        state.max_ledger_bytes,
    ) {
        *store = previous_store;
        state
            .metrics
            .storage_write_failures
            .fetch_add(1, Ordering::Relaxed);
        return storage_error_response(error);
    }

    Json(RegisterDeviceResponse {
        device_id,
        sync_cursor: "0".into(),
        server_time,
    })
    .into_response()
}

async fn admin_snapshot(State(state): State<Arc<AppState>>) -> Json<AdminDashboardSnapshot> {
    let store = state.store.lock().expect("sync store mutex poisoned");

    Json(store.admin_snapshot())
}

async fn push_changes(
    State(state): State<Arc<AppState>>,
    Json(request): Json<PushChangesRequest>,
) -> impl IntoResponse {
    if let Err(error) = validate_push_changes_request(&request) {
        return (StatusCode::BAD_REQUEST, Json(error)).into_response();
    }

    if request.changes.is_empty() {
        return (
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                code: "empty_change_set",
                message: "push requests must include at least one change",
            }),
        )
            .into_response();
    }

    if request.changes.len() > state.max_push_changes {
        return ledger_quota_error_response();
    }

    let base_sequence = match parse_cursor(Some(request.base_cursor.as_str())) {
        Ok(sequence) => sequence,
        Err(error) => return (StatusCode::BAD_REQUEST, Json(error)).into_response(),
    };

    let mut store = state.store.lock().expect("sync store mutex poisoned");

    if !store.is_registered_device(request.device_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                code: "unknown_device",
                message: "device must be registered before pushing changes",
            }),
        )
            .into_response();
    }

    let existing_changes = store.changes.clone();
    let mut previous_store: Option<SyncStore> = None;
    let mut accepted = 0;
    let mut conflicts = Vec::new();

    for change in request.changes {
        if store.processed_change_ids.contains(&change.id) {
            continue;
        }

        if existing_changes.iter().any(|stored| {
            stored.sequence > base_sequence
                && stored.entity_type == change.entity_type
                && stored.entity_id == change.entity_id
                && stored.id != change.id
        }) {
            conflicts.push(SyncConflict {
                entity_type: change.entity_type,
                entity_id: change.entity_id,
                reason: "changed_after_base_cursor".into(),
            });
            continue;
        }

        if store.changes.len() >= state.max_stored_changes {
            if let Some(previous) = previous_store {
                *store = previous;
            }
            return ledger_quota_error_response();
        }

        // Snapshot for rollback only once we are about to mutate.
        if previous_store.is_none() {
            previous_store = Some(store.clone());
        }
        store.accept_change(request.device_id, change);
        accepted += 1;
    }

    let sync_cursor = store.current_cursor();

    if accepted > 0 {
        match store_exceeds_ledger_byte_limit(&store, state.max_ledger_bytes) {
            Ok(true) => {
                if let Some(previous) = previous_store {
                    *store = previous;
                }
                return ledger_quota_error_response();
            }
            Ok(false) => {}
            Err(error) => {
                if let Some(previous) = previous_store {
                    *store = previous;
                }
                state
                    .metrics
                    .storage_write_failures
                    .fetch_add(1, Ordering::Relaxed);
                return storage_error_response(error);
            }
        }

        if let Err(error) = persist_store(
            state.storage_path.as_deref(),
            &store,
            state.max_ledger_bytes,
        ) {
            if let Some(previous) = previous_store {
                *store = previous;
            }
            state
                .metrics
                .storage_write_failures
                .fetch_add(1, Ordering::Relaxed);
            return storage_error_response(error);
        }
    }

    (
        StatusCode::ACCEPTED,
        Json(PushChangesResponse {
            accepted,
            sync_cursor,
            conflicts,
        }),
    )
        .into_response()
}

async fn pull_changes(
    State(state): State<Arc<AppState>>,
    Query(query): Query<PullQuery>,
) -> impl IntoResponse {
    let since_sequence = match parse_cursor(query.since.as_deref()) {
        Ok(sequence) => sequence,
        Err(error) => return (StatusCode::BAD_REQUEST, Json(error)).into_response(),
    };
    let page_limit = match resolve_pull_limit(query.limit, state.max_pull_changes) {
        Ok(limit) => limit,
        Err(error) => return (StatusCode::BAD_REQUEST, Json(error)).into_response(),
    };

    let store = state.store.lock().expect("sync store mutex poisoned");

    if !store.is_registered_device(query.device_id) {
        return (
            StatusCode::NOT_FOUND,
            Json(ErrorResponse {
                code: "unknown_device",
                message: "device must be registered before pulling changes",
            }),
        )
            .into_response();
    }

    let latest_sequence = store.latest_sequence;
    let page_end_sequence = since_sequence
        .saturating_add(page_limit as u64)
        .min(latest_sequence);
    let has_more = page_end_sequence < latest_sequence;
    let changes = store
        .changes
        .iter()
        .filter(|change| {
            change.sequence > since_sequence
                && change.sequence <= page_end_sequence
                && change.device_id != query.device_id
        })
        .map(SyncChangeEnvelope::from)
        .collect();

    (
        StatusCode::OK,
        Json(PullChangesResponse {
            next_cursor: cursor_from_sequence(page_end_sequence),
            has_more,
            changes,
            since: query.since,
            device_id: query.device_id,
        }),
    )
        .into_response()
}

impl SyncStore {
    fn register_device(&mut self, device: RegisteredDeviceRecord) {
        self.devices.insert(device.device_id, device);
    }

    fn record_audit_event(&mut self, event: StoredAuditEvent) {
        self.audit_log.push(event);
        self.prune_audit_log();
    }

    fn prune_audit_log(&mut self) {
        if self.audit_log.len() <= AUDIT_LOG_RETENTION {
            return;
        }

        let retained_start = self.audit_log.len() - AUDIT_LOG_RETENTION;
        self.audit_log.drain(0..retained_start);
    }

    fn is_registered_device(&self, device_id: Uuid) -> bool {
        self.devices.contains_key(&device_id)
    }

    fn accept_change(&mut self, device_id: Uuid, change: SyncChange) {
        self.latest_sequence += 1;
        let cursor = cursor_from_sequence(self.latest_sequence);

        self.processed_change_ids.insert(change.id);
        self.changes.push(StoredChange {
            sequence: self.latest_sequence,
            cursor,
            id: change.id,
            device_id,
            entity_type: change.entity_type,
            entity_id: change.entity_id,
            operation: change.operation,
            payload: change.payload,
            client_time: change.client_time,
            server_time: Utc::now(),
        });
        self.prune_processed_ids();
    }

    fn prune_processed_ids(&mut self) {
        if self.latest_sequence <= PROCESSED_ID_RETENTION {
            return;
        }

        let recent_ids: HashSet<Uuid> = self
            .changes
            .iter()
            .rev()
            .take(PROCESSED_ID_RETENTION as usize)
            .map(|change| change.id)
            .collect();

        self.processed_change_ids
            .retain(|id| recent_ids.contains(id));
    }

    fn current_cursor(&self) -> String {
        cursor_from_sequence(self.latest_sequence)
    }

    fn admin_snapshot(&self) -> AdminDashboardSnapshot {
        let mut devices: Vec<AdminDeviceRecord> = self
            .devices
            .values()
            .map(|device| self.admin_device_record(device))
            .collect();
        devices.sort_by(|left, right| {
            left.name
                .cmp(&right.name)
                .then_with(|| left.id.cmp(&right.id))
        });
        let active_members = if devices.is_empty() { 0 } else { 1 };
        let roles = if devices.is_empty() {
            Vec::new()
        } else {
            vec![AdminRoleRecord {
                id: "workspace-admin",
                member_count: active_members,
                name: "Workspace Admin",
                risk: AdminRoleRisk::Full,
                scope: "Members, roles, sync policy",
            }]
        };
        let members = if devices.is_empty() {
            Vec::new()
        } else {
            vec![AdminMemberRecord {
                device_count: devices.len(),
                email: "local-sync@atlasterm.dev",
                id: "member-local-sync",
                name: "Local Sync Operator",
                role: "Workspace Admin",
                status: AdminMemberStatus::Active,
            }]
        };
        let audit_events = self.admin_audit_events();

        AdminDashboardSnapshot {
            metrics: AdminMetrics {
                active_members,
                audit_events_today: audit_events.len(),
                healthy_devices: devices
                    .iter()
                    .filter(|device| {
                        matches!(
                            device.status,
                            AdminDeviceStatus::Current | AdminDeviceStatus::CatchingUp
                        )
                    })
                    .count(),
                roles_configured: roles.len(),
            },
            audit_events,
            devices,
            members,
            roles,
        }
    }

    fn admin_device_record(&self, device: &RegisteredDeviceRecord) -> AdminDeviceRecord {
        let last_change = self
            .changes
            .iter()
            .rev()
            .find(|change| change.device_id == device.device_id);
        let cursor = last_change
            .map(|change| change.cursor.clone())
            .unwrap_or_else(|| "0".into());
        let status = if self.latest_sequence == 0
            || last_change.map(|change| change.sequence) == Some(self.latest_sequence)
        {
            AdminDeviceStatus::Current
        } else {
            let last_activity = last_change
                .map(|change| change.server_time)
                .unwrap_or(device.registered_at);
            let seconds_since_activity = (Utc::now() - last_activity).num_seconds();

            if seconds_since_activity > 600 {
                AdminDeviceStatus::Offline
            } else if seconds_since_activity > 60 {
                AdminDeviceStatus::Degraded
            } else {
                AdminDeviceStatus::CatchingUp
            }
        };

        AdminDeviceRecord {
            cursor,
            id: device.device_id.to_string(),
            last_seen: last_change
                .map(|change| change.server_time.to_rfc3339())
                .unwrap_or_else(|| device.registered_at.to_rfc3339()),
            name: device
                .display_name
                .clone()
                .unwrap_or_else(|| format!("JoeSSH {}", device.platform.as_str())),
            owner: "Local Sync Operator",
            platform: device.platform.as_str(),
            status,
        }
    }

    fn admin_audit_events(&self) -> Vec<AdminAuditEvent> {
        let change_events = self.changes.iter().rev().map(|change| AdminAuditEvent {
            action: format!("Accepted {:?} sync change", change.operation),
            actor: "Sync API",
            id: format!("audit-{}", change.id),
            target: format!("{}:{}", change.entity_type, change.entity_id),
            time: change.server_time.to_rfc3339(),
        });

        let stored_events = self.audit_log.iter().rev().map(|event| AdminAuditEvent {
            action: event.action.clone(),
            actor: "Sync API",
            id: event.id.clone(),
            target: event.target.clone(),
            time: event.time.to_rfc3339(),
        });

        let mut events: Vec<AdminAuditEvent> = change_events.chain(stored_events).collect();
        events.sort_by(|a, b| b.time.cmp(&a.time));
        events.truncate(AUDIT_EVENT_LIMIT);
        events
    }
}

impl From<&StoredChange> for SyncChangeEnvelope {
    fn from(change: &StoredChange) -> Self {
        Self {
            id: change.id,
            entity_type: change.entity_type.clone(),
            entity_id: change.entity_id.clone(),
            operation: change.operation,
            payload: change.payload.clone(),
            server_time: change.server_time,
            sync_cursor: change.cursor.clone(),
        }
    }
}

fn cursor_from_sequence(sequence: u64) -> String {
    format!("server-{sequence}")
}

fn parse_cursor(cursor: Option<&str>) -> Result<u64, ErrorResponse> {
    match cursor.unwrap_or("0").trim() {
        "" | "0" => Ok(0),
        value => value
            .strip_prefix("server-")
            .and_then(|sequence| sequence.parse::<u64>().ok())
            .ok_or(ErrorResponse {
                code: "invalid_cursor",
                message: "sync cursor must be 0 or server-N",
            }),
    }
}

fn resolve_pull_limit(
    limit: Option<usize>,
    max_pull_changes: usize,
) -> Result<usize, ErrorResponse> {
    match limit {
        Some(0) => Err(ErrorResponse {
            code: "invalid_sync_request",
            message: "pull limit must be greater than zero",
        }),
        Some(limit) => Ok(limit.min(max_pull_changes.max(1))),
        None => Ok(max_pull_changes.max(1)),
    }
}

fn validate_register_device_request(request: &RegisterDeviceRequest) -> Result<(), ErrorResponse> {
    validate_sync_string(
        request.app_version.as_str(),
        MAX_SYNC_APP_VERSION_CHARS,
        "device registration requires a valid app version",
    )?;

    if let Some(display_name) = request.display_name.as_deref() {
        validate_sync_string(
            display_name,
            MAX_SYNC_DISPLAY_NAME_CHARS,
            "device registration requires a valid display name",
        )?;
    }

    Ok(())
}

fn validate_push_changes_request(request: &PushChangesRequest) -> Result<(), ErrorResponse> {
    if request.device_id.is_nil() || request.base_cursor.trim().is_empty() {
        return Err(ErrorResponse {
            code: "invalid_sync_request",
            message: "push requests require a device id and base cursor",
        });
    }

    for change in &request.changes {
        validate_sync_entity_token(change.entity_type.as_str())?;
        validate_sync_entity_token(change.entity_id.as_str())?;
    }

    Ok(())
}

fn validate_sync_string(
    value: &str,
    max_chars: usize,
    message: &'static str,
) -> Result<(), ErrorResponse> {
    if value.is_empty()
        || value != value.trim()
        || value.chars().count() > max_chars
        || value.chars().any(is_control_or_format_character)
    {
        return Err(ErrorResponse {
            code: "invalid_sync_request",
            message,
        });
    }

    Ok(())
}

fn validate_sync_entity_token(value: &str) -> Result<(), ErrorResponse> {
    if value.chars().count() > MAX_SYNC_ENTITY_TOKEN_CHARS || !is_sync_entity_token(value) {
        return Err(ErrorResponse {
            code: "invalid_sync_request",
            message: "sync changes require valid entity identifiers",
        });
    }

    Ok(())
}

fn is_sync_entity_token(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };

    (first.is_ascii_lowercase() || first.is_ascii_digit())
        && chars.all(|character| {
            character.is_ascii_lowercase()
                || character.is_ascii_digit()
                || matches!(character, '.' | '_' | ':' | '-')
        })
}

fn is_control_or_format_character(character: char) -> bool {
    character.is_control()
        || matches!(
            character,
            '\u{00ad}'
                | '\u{061c}'
                | '\u{070f}'
                | '\u{0890}'..='\u{0891}'
                | '\u{08e2}'
                | '\u{180e}'
                | '\u{200b}'..='\u{200f}'
                | '\u{202a}'..='\u{202e}'
                | '\u{2060}'..='\u{206f}'
                | '\u{feff}'
                | '\u{fff9}'..='\u{fffb}'
                | '\u{110bd}'
                | '\u{110cd}'
                | '\u{13430}'..='\u{1343f}'
                | '\u{1bca0}'..='\u{1bca3}'
                | '\u{1d173}'..='\u{1d17a}'
                | '\u{e0000}'..='\u{e007f}'
        )
}

#[derive(Serialize)]
struct HealthResponse {
    ok: bool,
    service: &'static str,
    version: &'static str,
    checked_at: DateTime<Utc>,
}

#[derive(Serialize)]
struct ReadinessResponse {
    ok: bool,
    service: &'static str,
    version: &'static str,
    checked_at: DateTime<Utc>,
    storage: StorageReadiness,
}

#[derive(Serialize)]
struct StorageReadiness {
    mode: &'static str,
    writable: bool,
    message: &'static str,
}

#[derive(Debug, Deserialize)]
struct RegisterDeviceRequest {
    device_id: Option<Uuid>,
    platform: DevicePlatform,
    app_version: String,
    display_name: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum DevicePlatform {
    Desktop,
    Web,
    Ios,
    Android,
}

impl DevicePlatform {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Web => "web",
            Self::Ios => "ios",
            Self::Android => "android",
        }
    }
}

#[derive(Serialize)]
struct RegisterDeviceResponse {
    device_id: Uuid,
    sync_cursor: String,
    server_time: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
struct PushChangesRequest {
    device_id: Uuid,
    base_cursor: String,
    changes: Vec<SyncChange>,
}

#[derive(Debug, Deserialize)]
struct SyncChange {
    id: Uuid,
    entity_type: String,
    entity_id: String,
    operation: SyncOperation,
    payload: serde_json::Value,
    client_time: DateTime<Utc>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SyncOperation {
    Create,
    Update,
    Delete,
}

#[derive(Serialize)]
struct AdminDashboardSnapshot {
    #[serde(rename = "auditEvents")]
    audit_events: Vec<AdminAuditEvent>,
    devices: Vec<AdminDeviceRecord>,
    members: Vec<AdminMemberRecord>,
    metrics: AdminMetrics,
    roles: Vec<AdminRoleRecord>,
}

#[derive(Serialize)]
struct AdminMetrics {
    #[serde(rename = "activeMembers")]
    active_members: usize,
    #[serde(rename = "auditEventsToday")]
    audit_events_today: usize,
    #[serde(rename = "healthyDevices")]
    healthy_devices: usize,
    #[serde(rename = "rolesConfigured")]
    roles_configured: usize,
}

#[derive(Serialize)]
struct AdminDeviceRecord {
    cursor: String,
    id: String,
    #[serde(rename = "lastSeen")]
    last_seen: String,
    name: String,
    owner: &'static str,
    platform: &'static str,
    status: AdminDeviceStatus,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum AdminDeviceStatus {
    CatchingUp,
    Current,
    Degraded,
    Offline,
}

#[derive(Serialize)]
struct AdminAuditEvent {
    action: String,
    actor: &'static str,
    id: String,
    target: String,
    time: String,
}

#[derive(Serialize)]
struct AdminMemberRecord {
    #[serde(rename = "deviceCount")]
    device_count: usize,
    email: &'static str,
    id: &'static str,
    name: &'static str,
    role: &'static str,
    status: AdminMemberStatus,
}

#[derive(Clone, Copy, Serialize)]
#[allow(dead_code)]
#[serde(rename_all = "snake_case")]
enum AdminMemberStatus {
    Active,
    Invited,
    Suspended,
}

#[derive(Serialize)]
struct AdminRoleRecord {
    id: &'static str,
    #[serde(rename = "memberCount")]
    member_count: usize,
    name: &'static str,
    risk: AdminRoleRisk,
    scope: &'static str,
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
enum AdminRoleRisk {
    Full,
}

#[derive(Serialize)]
struct PushChangesResponse {
    accepted: usize,
    sync_cursor: String,
    conflicts: Vec<SyncConflict>,
}

#[derive(Serialize)]
struct SyncConflict {
    entity_type: String,
    entity_id: String,
    reason: String,
}

#[derive(Debug, Deserialize)]
struct PullQuery {
    device_id: Uuid,
    since: Option<String>,
    limit: Option<usize>,
}

#[derive(Serialize)]
struct PullChangesResponse {
    device_id: Uuid,
    since: Option<String>,
    next_cursor: String,
    has_more: bool,
    changes: Vec<SyncChangeEnvelope>,
}

#[derive(Serialize)]
struct SyncChangeEnvelope {
    id: Uuid,
    entity_type: String,
    entity_id: String,
    operation: SyncOperation,
    payload: serde_json::Value,
    sync_cursor: String,
    server_time: DateTime<Utc>,
}

#[derive(Serialize)]
struct ErrorResponse {
    code: &'static str,
    message: &'static str,
}

#[cfg(test)]
mod tests {
    use super::config::parse_cors_allowed_origins;
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::{header, Request, StatusCode},
    };
    use serde_json::{json, Value};
    use tower::util::ServiceExt;

    #[test]
    fn bind_safety_allows_loopback_without_token() {
        let addr: SocketAddr = "127.0.0.1:4100".parse().unwrap();
        assert!(check_bind_safety(&addr, &SyncConfig::default()).is_ok());
    }

    #[test]
    fn bind_safety_allows_non_loopback_with_token_and_durable_storage() {
        let addr: SocketAddr = "0.0.0.0:4100".parse().unwrap();
        assert!(check_bind_safety(
            &addr,
            &SyncConfig {
                auth_token: Some("test-token".into()),
                metrics_token: Some("metrics-token".into()),
                storage_path: Some(PathBuf::from("ledger.json")),
                ..SyncConfig::default()
            },
        )
        .is_ok());
    }

    #[test]
    fn bind_safety_allows_non_loopback_with_explicit_ephemeral_storage() {
        let addr: SocketAddr = "0.0.0.0:4100".parse().unwrap();
        assert!(check_bind_safety(
            &addr,
            &SyncConfig {
                auth_token: Some("test-token".into()),
                metrics_token: Some("metrics-token".into()),
                allow_ephemeral_storage: true,
                ..SyncConfig::default()
            },
        )
        .is_ok());
    }

    #[test]
    fn bind_safety_rejects_non_loopback_without_metrics_token() {
        let addr: SocketAddr = "0.0.0.0:4100".parse().unwrap();
        let error = check_bind_safety(
            &addr,
            &SyncConfig {
                auth_token: Some("test-token".into()),
                storage_path: Some(PathBuf::from("ledger.json")),
                ..SyncConfig::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("ATLASTERM_SYNC_METRICS_TOKEN"));
    }

    #[test]
    fn bind_safety_rejects_non_loopback_with_token_but_no_storage() {
        let addr: SocketAddr = "0.0.0.0:4100".parse().unwrap();
        let error = check_bind_safety(
            &addr,
            &SyncConfig {
                auth_token: Some("test-token".into()),
                metrics_token: Some("metrics-token".into()),
                ..SyncConfig::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("ATLASTERM_SYNC_STORAGE_PATH"));
    }

    #[test]
    fn bind_safety_rejects_non_loopback_with_permissive_cors() {
        let addr: SocketAddr = "0.0.0.0:4100".parse().unwrap();
        let error = check_bind_safety(
            &addr,
            &SyncConfig {
                auth_token: Some("test-token".into()),
                metrics_token: Some("metrics-token".into()),
                cors_permissive: true,
                storage_path: Some(PathBuf::from("ledger.json")),
                ..SyncConfig::default()
            },
        )
        .unwrap_err();
        assert!(error.contains("ATLASTERM_SYNC_CORS_PERMISSIVE"));
        assert!(error.contains("ATLASTERM_SYNC_CORS_ORIGINS"));
    }

    #[test]
    fn bind_safety_rejects_non_loopback_without_token() {
        let addr: SocketAddr = "0.0.0.0:4100".parse().unwrap();
        assert!(check_bind_safety(&addr, &SyncConfig::default()).is_err());
    }

    #[tokio::test]
    async fn rate_limit_middleware_returns_429_over_limit() {
        let app = app_with_config(rate_limited_config(2));
        let peer: SocketAddr = "203.0.113.9:5555".parse().unwrap();
        let make_request = || {
            let mut request = Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap();
            request.extensions_mut().insert(ConnectInfo(peer));
            request
        };

        for _ in 0..2 {
            let ok = app.clone().oneshot(make_request()).await.unwrap();
            assert_eq!(ok.status(), StatusCode::OK);
        }

        let limited = app.oneshot(make_request()).await.unwrap();
        assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(to_json(limited.into_body()).await["code"], "rate_limited");
    }

    #[tokio::test]
    async fn healthz_returns_ok() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn readyz_reports_memory_storage_ready() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["ok"], true);
        assert_eq!(body["storage"]["mode"], "memory");
        assert_eq!(body["storage"]["writable"], true);
    }

    #[tokio::test]
    async fn readyz_reports_json_ledger_storage_ready() {
        let storage_path = test_storage_path("readyz-json-ledger");
        let app = app_with_config(storage_config(storage_path.clone()));
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/readyz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["ok"], true);
        assert_eq!(body["storage"]["mode"], "json_ledger");
        assert_eq!(body["storage"]["writable"], true);
        let _ = fs::remove_file(storage_path);
    }

    #[tokio::test]
    async fn metrics_reports_http_and_store_counters() {
        let app = app_with_config(admin_snapshot_config());
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;

        post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": Uuid::new_v4(),
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "host": "prod-edge-01" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;
        let _ = pull_changes_for(&app, mobile_id, Some("0")).await;
        let _ = admin_snapshot_for(&app).await;

        let metrics = metrics_for(&app).await;

        assert!(metrics.contains("joessh_sync_devices_registered 2"));
        assert!(metrics.contains("joessh_sync_changes_stored 1"));
        assert!(metrics.contains("joessh_sync_latest_sequence 1"));
        assert!(metrics.contains("joessh_sync_http_requests_total{method=\"POST\",path=\"/v1/devices/register\",status=\"200\"} 2"));
        assert!(metrics.contains("joessh_sync_http_requests_total{method=\"POST\",path=\"/v1/sync/push\",status=\"202\"} 1"));
        assert!(metrics.contains("joessh_sync_http_requests_total{method=\"GET\",path=\"/v1/sync/pull\",status=\"200\"} 1"));
        assert!(metrics.contains("joessh_sync_http_request_duration_seconds_sum"));
    }

    #[tokio::test]
    async fn metrics_counts_auth_failures_and_rate_limits() {
        let auth_app = app_with_config(admin_auth_config());
        let missing_auth = auth_app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/admin/snapshot")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing_auth.status(), StatusCode::UNAUTHORIZED);
        let auth_metrics = metrics_for(&auth_app).await;
        assert!(auth_metrics.contains("joessh_sync_auth_failures_total{surface=\"admin\"} 1"));

        let rate_app = app_with_config(rate_limited_config(1));
        let peer: SocketAddr = "203.0.113.20:5555".parse().unwrap();
        let make_request = || {
            let mut request = Request::builder()
                .uri("/healthz")
                .body(Body::empty())
                .unwrap();
            request.extensions_mut().insert(ConnectInfo(peer));
            request
        };

        let ok = rate_app.clone().oneshot(make_request()).await.unwrap();
        assert_eq!(ok.status(), StatusCode::OK);
        let limited = rate_app.clone().oneshot(make_request()).await.unwrap();
        assert_eq!(limited.status(), StatusCode::TOO_MANY_REQUESTS);
        let rate_metrics = metrics_for(&rate_app).await;
        assert!(rate_metrics.contains("joessh_sync_rate_limited_total 1"));
    }

    #[tokio::test]
    async fn metrics_requires_bearer_token_when_configured() {
        let app = app_with_config(metrics_auth_config());

        let missing = metrics_response_for(&app, None).await;
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            to_json(missing.into_body()).await["code"],
            "missing_authorization"
        );

        let wrong = metrics_response_for(&app, Some("Bearer admin-token")).await;
        assert_eq!(wrong.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            to_json(wrong.into_body()).await["code"],
            "metrics_forbidden"
        );

        let metrics = metrics_for(&app).await;
        assert!(metrics.contains("joessh_sync_auth_failures_total{surface=\"metrics\"} 2"));
    }

    #[test]
    fn storage_path_rejects_unusable_ledger_parent_before_serving() {
        let parent_file = test_storage_path("readyz-blocked-parent");
        fs::write(&parent_file, b"not-a-directory").unwrap();
        let storage_path = parent_file.join("ledger.json");
        let error = match try_app_with_config(storage_config(storage_path)) {
            Ok(_) => panic!("unusable storage parent should fail startup"),
            Err(error) => error,
        };

        assert!(error.to_string().contains("ATLASTERM_SYNC_STORAGE_PATH"));
        let _ = fs::remove_file(parent_file);
    }

    #[tokio::test]
    async fn register_device_returns_cursor() {
        let response = app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/devices/register")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(
                        json!({
                            "platform": "desktop",
                            "app_version": "0.1.0",
                            "display_name": "Atlas workstation"
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["sync_cursor"], "0");
        assert!(body["device_id"].as_str().is_some());
    }

    #[tokio::test]
    async fn healthz_remains_open_when_sync_auth_is_enabled() {
        let response = app_with_config(sync_auth_config())
            .oneshot(
                Request::builder()
                    .uri("/healthz")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn sync_routes_require_bearer_token_when_configured() {
        let app = app_with_config(sync_auth_config());

        let missing = post_register(&app, None).await;
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            to_json(missing.into_body()).await["code"],
            "missing_authorization"
        );

        let wrong = post_register(&app, Some("Bearer wrong-token")).await;
        assert_eq!(wrong.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            to_json(wrong.into_body()).await["code"],
            "invalid_authorization"
        );

        let valid = post_register(&app, Some("Bearer test-token")).await;
        assert_eq!(valid.status(), StatusCode::OK);
        assert!(to_json(valid.into_body()).await["device_id"]
            .as_str()
            .is_some());
    }

    #[tokio::test]
    async fn admin_snapshot_fails_closed_without_admin_token() {
        let app = app_with_config(sync_auth_config());

        let missing = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/admin/snapshot")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            to_json(missing.into_body()).await["code"],
            "admin_token_required"
        );

        let sync_token = app
            .oneshot(
                Request::builder()
                    .uri("/v1/admin/snapshot")
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(sync_token.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            to_json(sync_token.into_body()).await["code"],
            "admin_token_required"
        );
    }

    #[tokio::test]
    async fn admin_snapshot_requires_admin_token_when_configured() {
        let app = app_with_config(admin_auth_config());

        let missing = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/admin/snapshot")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(missing.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            to_json(missing.into_body()).await["code"],
            "missing_authorization"
        );

        // The plain sync token is rejected for the admin route.
        let sync_token = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/admin/snapshot")
                    .header(header::AUTHORIZATION, "Bearer test-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(sync_token.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            to_json(sync_token.into_body()).await["code"],
            "admin_forbidden"
        );

        // The dedicated admin token is accepted.
        let admin_token = app
            .oneshot(
                Request::builder()
                    .uri("/v1/admin/snapshot")
                    .header(header::AUTHORIZATION, "Bearer admin-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(admin_token.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn admin_snapshot_rejects_admin_token_matching_sync_token() {
        let app = app_with_config(shared_admin_sync_token_config());

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/v1/admin/snapshot")
                    .header(header::AUTHORIZATION, "Bearer shared-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            to_json(response.into_body()).await["code"],
            "admin_token_required"
        );
    }

    #[tokio::test]
    async fn admin_token_does_not_grant_regular_sync_routes() {
        let app = app_with_config(admin_auth_config());

        // The admin token is not a valid sync credential for non-admin routes.
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/sync/push")
                    .header(header::AUTHORIZATION, "Bearer admin-token")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from("{}"))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
        assert_eq!(
            to_json(response.into_body()).await["code"],
            "invalid_authorization"
        );
    }

    #[tokio::test]
    async fn admin_snapshot_projects_registered_devices_and_audit_events() {
        let app = app_with_config(admin_snapshot_config());
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;

        post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": Uuid::new_v4(),
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": "ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;

        let body = admin_snapshot_for(&app).await;
        assert_eq!(body["metrics"]["activeMembers"], 1);
        assert_eq!(body["metrics"]["healthyDevices"], 2);
        assert_eq!(body["metrics"]["rolesConfigured"], 1);
        assert_eq!(body["members"][0]["deviceCount"], 2);
        assert_eq!(body["roles"][0]["risk"], "full");
        assert_eq!(
            body["auditEvents"][0]["action"],
            "Accepted Update sync change"
        );
        assert_eq!(body["auditEvents"][0]["actor"], "Sync API");
        assert_eq!(body["devices"].as_array().unwrap().len(), 2);
        let desktop_id = desktop_id.to_string();
        let mobile_id = mobile_id.to_string();
        assert!(body["devices"].as_array().unwrap().iter().any(|device| {
            device["id"].as_str() == Some(desktop_id.as_str())
                && device["cursor"] == "server-1"
                && device["status"] == "current"
        }));
        assert!(body["devices"].as_array().unwrap().iter().any(|device| {
            device["id"].as_str() == Some(mobile_id.as_str())
                && device["cursor"] == "0"
                && device["status"] == "catching_up"
        }));
    }

    #[tokio::test]
    async fn configured_cors_allows_authorized_preflight_from_allowlisted_origin() {
        let app = app_with_config(SyncConfig {
            auth_token: Some("test-token".into()),
            cors_allowed_origins: Some(vec![HeaderValue::from_static(
                "https://admin.atlasterm.local",
            )]),
            ..SyncConfig::default()
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/v1/sync/push")
                    .header(header::ORIGIN, "https://admin.atlasterm.local")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .header(
                        header::ACCESS_CONTROL_REQUEST_HEADERS,
                        "authorization,content-type",
                    )
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap()
                .to_str()
                .unwrap(),
            "https://admin.atlasterm.local"
        );
        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_HEADERS)
            .unwrap()
            .to_str()
            .unwrap()
            .to_ascii_lowercase()
            .contains("authorization"));
    }

    #[tokio::test]
    async fn configured_cors_does_not_allow_unlisted_origin() {
        let app = app_with_config(SyncConfig {
            auth_token: Some("test-token".into()),
            cors_allowed_origins: Some(vec![HeaderValue::from_static(
                "https://admin.atlasterm.local",
            )]),
            ..SyncConfig::default()
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/v1/sync/push")
                    .header(header::ORIGIN, "https://evil.example")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    #[tokio::test]
    async fn default_cors_does_not_emit_browser_allow_origin() {
        let app = app();

        let response = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/v1/sync/push")
                    .header(header::ORIGIN, "https://admin.atlasterm.local")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert!(response
            .headers()
            .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
            .is_none());
    }

    #[tokio::test]
    async fn explicit_permissive_cors_allows_local_dev_origins() {
        let app = app_with_config(SyncConfig {
            cors_permissive: true,
            ..SyncConfig::default()
        });

        let response = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/v1/sync/push")
                    .header(header::ORIGIN, "http://localhost:5173")
                    .header(header::ACCESS_CONTROL_REQUEST_METHOD, "POST")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .unwrap()
                .to_str()
                .unwrap(),
            "*"
        );
    }

    #[test]
    fn parses_cors_allowlist_from_env_style_value() {
        let origins = parse_cors_allowed_origins(Some(
            " https://admin.atlasterm.local,https://ops.atlasterm.local ".into(),
        ))
        .unwrap()
        .unwrap();

        assert_eq!(origins.len(), 2);
        assert_eq!(
            origins[0].to_str().unwrap(),
            "https://admin.atlasterm.local"
        );
        assert_eq!(origins[1].to_str().unwrap(), "https://ops.atlasterm.local");
        assert!(parse_cors_allowed_origins(Some("   ".into()))
            .unwrap()
            .is_none());
    }

    #[test]
    fn rejects_non_origin_cors_allowlist_entries() {
        assert!(parse_cors_allowed_origins(Some("not-a-url".into())).is_err());
        assert!(parse_cors_allowed_origins(Some("ftp://admin.atlasterm.local".into())).is_err());
        assert!(
            parse_cors_allowed_origins(Some("https://admin.atlasterm.local/path".into())).is_err()
        );
    }

    #[test]
    fn rejects_wildcard_cors_origin() {
        assert!(parse_cors_allowed_origins(Some("https://*.example.com".into())).is_err());
        assert!(parse_cors_allowed_origins(Some("https://*.atlasterm.local".into())).is_err());
    }

    #[test]
    fn bearer_token_parser_accepts_case_insensitive_scheme_only() {
        assert_eq!(parse_bearer_token("bearer test-token"), Some("test-token"));
        assert_eq!(
            parse_bearer_token("  BEARER   test-token  "),
            Some("test-token")
        );
        assert_eq!(parse_bearer_token("Basic test-token"), None);
        assert_eq!(parse_bearer_token("Bearer"), None);
        assert_eq!(parse_bearer_token("Bearer test-token extra"), None);
    }

    #[tokio::test]
    async fn non_preflight_options_still_requires_sync_authorization() {
        let app = app_with_config(sync_auth_config());

        let response = app
            .oneshot(
                Request::builder()
                    .method("OPTIONS")
                    .uri("/v1/sync/push")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(
            to_json(response.into_body()).await["code"],
            "missing_authorization"
        );
    }

    #[test]
    fn bearer_token_comparison_is_length_aware() {
        assert!(constant_time_eq("test-token", "test-token"));
        assert!(!constant_time_eq("test-token", "test-token-extra"));
        assert!(!constant_time_eq("test-token", "wrong-token"));
    }

    #[tokio::test]
    async fn empty_push_is_rejected() {
        let app = app();
        let device_id = register_test_device(&app, "Desktop Workstation").await;
        let response = post_push(
            &app,
            json!({
                "device_id": device_id,
                "base_cursor": "0",
                "changes": []
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }

    #[tokio::test]
    async fn register_rejects_admin_snapshot_unsafe_display_names() {
        let app = app_with_config(admin_snapshot_config());
        let long_name = "a".repeat(MAX_SYNC_DISPLAY_NAME_CHARS + 1);
        let unsafe_names = vec![
            "",
            " Desktop Workstation",
            "Desktop Workstation ",
            "Desktop\nWorkstation",
            "Desktop\u{200b}Workstation",
            long_name.as_str(),
        ];

        for display_name in unsafe_names {
            let response = post_register_with_display_name(&app, display_name, None).await;
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(
                to_json(response.into_body()).await["code"],
                "invalid_sync_request"
            );
        }

        let snapshot = admin_snapshot_for(&app).await;
        assert_eq!(snapshot["devices"].as_array().unwrap().len(), 0);
        assert_eq!(snapshot["auditEvents"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn valid_push_is_accepted() {
        let app = app();
        let device_id = register_test_device(&app, "Desktop Workstation").await;
        let response = post_push(
            &app,
            json!({
                "device_id": device_id,
                "base_cursor": "0",
                "changes": [{
                    "id": Uuid::new_v4(),
                    "entity_type": "connection",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": "ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["accepted"], 1);
        assert_eq!(body["sync_cursor"], "server-1");
    }

    #[tokio::test]
    async fn push_rejects_admin_snapshot_unsafe_entity_tokens() {
        let app = app_with_config(admin_snapshot_config());
        let device_id = register_test_device(&app, "Desktop Workstation").await;
        let long_entity_id = "a".repeat(MAX_SYNC_ENTITY_TOKEN_CHARS + 1);
        let unsafe_tokens = vec![
            ("", "prod-edge-01"),
            ("connection", ""),
            (" connection", "prod-edge-01"),
            ("connection", "prod-edge-01 "),
            ("Connection", "prod-edge-01"),
            ("connection", "prod/edge/01"),
            ("connection\n", "prod-edge-01"),
            ("connection", "prod-edge-\u{202e}01"),
            ("connection", long_entity_id.as_str()),
        ];

        for (entity_type, entity_id) in unsafe_tokens {
            let response = post_push(
                &app,
                json!({
                    "device_id": device_id,
                    "base_cursor": "0",
                    "changes": [{
                        "id": Uuid::new_v4(),
                        "entity_type": entity_type,
                        "entity_id": entity_id,
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext" },
                        "client_time": Utc::now()
                    }]
                }),
            )
            .await;

            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
            assert_eq!(
                to_json(response.into_body()).await["code"],
                "invalid_sync_request"
            );
        }

        let snapshot = admin_snapshot_for(&app).await;
        assert_eq!(snapshot["devices"][0]["cursor"], "0");
        assert_eq!(snapshot["auditEvents"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn duplicate_push_is_idempotent_by_change_id() {
        let app = app();
        let device_id = register_test_device(&app, "Desktop Workstation").await;
        let change_id = Uuid::new_v4();
        let payload = json!({
            "device_id": device_id,
            "base_cursor": "0",
            "changes": [{
                "id": change_id,
                "entity_type": "connection",
                "entity_id": "prod-edge-01",
                "operation": "update",
                "payload": { "encrypted_blob": "ciphertext" },
                "client_time": Utc::now()
            }]
        });

        let first = post_push(&app, payload.clone()).await;
        let second = post_push(&app, payload).await;

        assert_eq!(first.status(), StatusCode::ACCEPTED);
        assert_eq!(second.status(), StatusCode::ACCEPTED);
        let body = to_json(second.into_body()).await;
        assert_eq!(body["accepted"], 0);
        assert_eq!(body["sync_cursor"], "server-1");
    }

    #[tokio::test]
    async fn push_rejects_change_sets_over_configured_limit() {
        let app = app_with_config(SyncConfig {
            admin_token: Some("admin-token".into()),
            max_push_changes: 1,
            ..SyncConfig::default()
        });
        let device_id = register_test_device(&app, "Desktop Workstation").await;

        let response = post_push(
            &app,
            json!({
                "device_id": device_id,
                "base_cursor": "0",
                "changes": [
                    {
                        "id": Uuid::new_v4(),
                        "entity_type": "profile",
                        "entity_id": "prod-edge-01",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-1" },
                        "client_time": Utc::now()
                    },
                    {
                        "id": Uuid::new_v4(),
                        "entity_type": "profile",
                        "entity_id": "prod-edge-02",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-2" },
                        "client_time": Utc::now()
                    }
                ]
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            to_json(response.into_body()).await["code"],
            "ledger_quota_exceeded"
        );

        let snapshot = admin_snapshot_for(&app).await;
        assert_eq!(snapshot["devices"][0]["cursor"], "0");
    }

    #[tokio::test]
    async fn push_rejects_when_stored_change_limit_is_reached_and_rolls_back() {
        let app = app_with_config(SyncConfig {
            max_stored_changes: 2,
            ..SyncConfig::default()
        });
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let retained_change_id = Uuid::new_v4();

        let first = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": retained_change_id,
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": "ciphertext-1" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;
        assert_eq!(first.status(), StatusCode::ACCEPTED);

        let rejected = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "server-1",
                "changes": [
                    {
                        "id": Uuid::new_v4(),
                        "entity_type": "profile",
                        "entity_id": "prod-edge-02",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-2" },
                        "client_time": Utc::now()
                    },
                    {
                        "id": Uuid::new_v4(),
                        "entity_type": "profile",
                        "entity_id": "prod-edge-03",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-3" },
                        "client_time": Utc::now()
                    }
                ]
            }),
        )
        .await;

        assert_eq!(rejected.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            to_json(rejected.into_body()).await["code"],
            "ledger_quota_exceeded"
        );

        let response = pull_changes_for(&app, mobile_id, Some("0")).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["next_cursor"], "server-1");
        let changes = body["changes"].as_array().unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["id"], retained_change_id.to_string());
    }

    #[tokio::test]
    async fn push_rejects_when_ledger_byte_limit_would_be_exceeded_and_rolls_back() {
        let app = app_with_config(SyncConfig {
            admin_token: Some("admin-token".into()),
            max_ledger_bytes: 1_500,
            ..SyncConfig::default()
        });
        let device_id = register_test_device(&app, "Desktop Workstation").await;
        let oversized_blob = "x".repeat(4_096);

        let response = post_push(
            &app,
            json!({
                "device_id": device_id,
                "base_cursor": "0",
                "changes": [{
                    "id": Uuid::new_v4(),
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": oversized_blob },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
        assert_eq!(
            to_json(response.into_body()).await["code"],
            "ledger_quota_exceeded"
        );

        let snapshot = admin_snapshot_for(&app).await;
        assert_eq!(snapshot["devices"][0]["cursor"], "0");
        assert_eq!(snapshot["auditEvents"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn pull_returns_remote_changes_after_cursor() {
        let app = app();
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let change_id = Uuid::new_v4();

        post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": change_id,
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": "ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;

        let response = pull_changes_for(&app, mobile_id, Some("0")).await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["device_id"], mobile_id.to_string());
        assert_eq!(body["next_cursor"], "server-1");
        assert_eq!(body["has_more"], false);
        assert_eq!(body["changes"].as_array().unwrap().len(), 1);
        assert_eq!(body["changes"][0]["id"], change_id.to_string());

        let own_changes = pull_changes_for(&app, desktop_id, Some("0")).await;
        let body = to_json(own_changes.into_body()).await;
        assert_eq!(body["has_more"], false);
        assert_eq!(body["changes"].as_array().unwrap().len(), 0);
    }

    #[tokio::test]
    async fn pull_cursor_is_stable_when_no_new_changes_exist() {
        let app = app();
        let device_id = register_test_device(&app, "JoeSSH Mobile").await;

        let first = pull_changes_for(&app, device_id, Some("0")).await;
        let second = pull_changes_for(&app, device_id, Some("0")).await;

        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(second.status(), StatusCode::OK);
        let first_body = to_json(first.into_body()).await;
        let second_body = to_json(second.into_body()).await;
        assert_eq!(first_body["next_cursor"], "server-0");
        assert_eq!(first_body["has_more"], false);
        assert_eq!(second_body["next_cursor"], "server-0");
        assert_eq!(second_body["has_more"], false);
    }

    #[tokio::test]
    async fn pull_pages_changes_with_server_limit() {
        let app = app_with_config(SyncConfig {
            max_pull_changes: 2,
            ..SyncConfig::default()
        });
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let first_change_id = Uuid::new_v4();
        let second_change_id = Uuid::new_v4();
        let third_change_id = Uuid::new_v4();

        let push = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [
                    {
                        "id": first_change_id,
                        "entity_type": "profile",
                        "entity_id": "prod-edge-01",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-1" },
                        "client_time": Utc::now()
                    },
                    {
                        "id": second_change_id,
                        "entity_type": "profile",
                        "entity_id": "prod-edge-02",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-2" },
                        "client_time": Utc::now()
                    },
                    {
                        "id": third_change_id,
                        "entity_type": "profile",
                        "entity_id": "prod-edge-03",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-3" },
                        "client_time": Utc::now()
                    }
                ]
            }),
        )
        .await;
        assert_eq!(push.status(), StatusCode::ACCEPTED);

        let first_page = pull_changes_for(&app, mobile_id, Some("0")).await;
        assert_eq!(first_page.status(), StatusCode::OK);
        let first_body = to_json(first_page.into_body()).await;
        assert_eq!(first_body["next_cursor"], "server-2");
        assert_eq!(first_body["has_more"], true);
        let first_changes = first_body["changes"].as_array().unwrap();
        assert_eq!(first_changes.len(), 2);
        assert_eq!(first_changes[0]["id"], first_change_id.to_string());
        assert_eq!(first_changes[1]["id"], second_change_id.to_string());

        let second_page = pull_changes_for(&app, mobile_id, Some("server-2")).await;
        assert_eq!(second_page.status(), StatusCode::OK);
        let second_body = to_json(second_page.into_body()).await;
        assert_eq!(second_body["next_cursor"], "server-3");
        assert_eq!(second_body["has_more"], false);
        let second_changes = second_body["changes"].as_array().unwrap();
        assert_eq!(second_changes.len(), 1);
        assert_eq!(second_changes[0]["id"], third_change_id.to_string());
    }

    #[tokio::test]
    async fn pull_limit_is_capped_by_configured_max() {
        let app = app_with_config(SyncConfig {
            max_pull_changes: 1,
            ..SyncConfig::default()
        });
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;

        let push = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [
                    {
                        "id": Uuid::new_v4(),
                        "entity_type": "profile",
                        "entity_id": "prod-edge-01",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-1" },
                        "client_time": Utc::now()
                    },
                    {
                        "id": Uuid::new_v4(),
                        "entity_type": "profile",
                        "entity_id": "prod-edge-02",
                        "operation": "update",
                        "payload": { "encrypted_blob": "ciphertext-2" },
                        "client_time": Utc::now()
                    }
                ]
            }),
        )
        .await;
        assert_eq!(push.status(), StatusCode::ACCEPTED);

        let response = pull_changes_for_with_limit(&app, mobile_id, Some("0"), Some(10)).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["next_cursor"], "server-1");
        assert_eq!(body["has_more"], true);
        assert_eq!(body["changes"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn pull_advances_cursor_over_filtered_self_changes() {
        let app = app_with_config(SyncConfig {
            max_pull_changes: 1,
            ..SyncConfig::default()
        });
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let mobile_change_id = Uuid::new_v4();

        let desktop_push = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": Uuid::new_v4(),
                    "entity_type": "profile",
                    "entity_id": "desktop-local",
                    "operation": "update",
                    "payload": { "encrypted_blob": "desktop" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;
        assert_eq!(desktop_push.status(), StatusCode::ACCEPTED);

        let mobile_push = post_push(
            &app,
            json!({
                "device_id": mobile_id,
                "base_cursor": "server-1",
                "changes": [{
                    "id": mobile_change_id,
                    "entity_type": "profile",
                    "entity_id": "mobile-local",
                    "operation": "update",
                    "payload": { "encrypted_blob": "mobile" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;
        assert_eq!(mobile_push.status(), StatusCode::ACCEPTED);

        let first_page = pull_changes_for_with_limit(&app, desktop_id, Some("0"), Some(1)).await;
        assert_eq!(first_page.status(), StatusCode::OK);
        let first_body = to_json(first_page.into_body()).await;
        assert_eq!(first_body["next_cursor"], "server-1");
        assert_eq!(first_body["has_more"], true);
        assert_eq!(first_body["changes"].as_array().unwrap().len(), 0);

        let second_page =
            pull_changes_for_with_limit(&app, desktop_id, Some("server-1"), Some(1)).await;
        assert_eq!(second_page.status(), StatusCode::OK);
        let second_body = to_json(second_page.into_body()).await;
        assert_eq!(second_body["next_cursor"], "server-2");
        assert_eq!(second_body["has_more"], false);
        let changes = second_body["changes"].as_array().unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(changes[0]["id"], mobile_change_id.to_string());
    }

    #[tokio::test]
    async fn pull_rejects_zero_limit() {
        let app = app();
        let device_id = register_test_device(&app, "JoeSSH Mobile").await;

        let response = pull_changes_for_with_limit(&app, device_id, Some("0"), Some(0)).await;

        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(
            to_json(response.into_body()).await["code"],
            "invalid_sync_request"
        );
    }

    #[tokio::test]
    async fn storage_path_persists_registered_devices_and_changes_across_app_restarts() {
        let storage_path = test_storage_path("persistent-ledger");
        let app = app_with_config(storage_config(storage_path.clone()));
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let change_id = Uuid::new_v4();

        let push = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": change_id,
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": "ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;
        assert_eq!(push.status(), StatusCode::ACCEPTED);
        let persisted_ledger: Value =
            serde_json::from_slice(&fs::read(&storage_path).unwrap()).unwrap();
        assert_eq!(
            persisted_ledger["schema_version"],
            SYNC_LEDGER_SCHEMA_VERSION
        );

        drop(app);
        let restarted_app = app_with_config(storage_config(storage_path.clone()));
        let response = pull_changes_for(&restarted_app, mobile_id, Some("0")).await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["next_cursor"], "server-1");
        assert_eq!(body["changes"][0]["id"], change_id.to_string());
        assert_eq!(body["changes"][0]["sync_cursor"], "server-1");

        let own_changes = pull_changes_for(&restarted_app, desktop_id, Some("0")).await;
        assert_eq!(
            to_json(own_changes.into_body()).await["changes"]
                .as_array()
                .unwrap()
                .len(),
            0
        );

        let _ = fs::remove_file(storage_path);
    }

    #[tokio::test]
    async fn storage_path_migrates_legacy_v0_ledger_without_schema_version() {
        let storage_path = test_storage_path("legacy-v0-ledger");
        let app = app_with_config(storage_config(storage_path.clone()));
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let change_id = Uuid::new_v4();

        let push = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": change_id,
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": "ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;
        assert_eq!(push.status(), StatusCode::ACCEPTED);

        let mut legacy_ledger: Value =
            serde_json::from_slice(&fs::read(&storage_path).unwrap()).unwrap();
        legacy_ledger
            .as_object_mut()
            .unwrap()
            .remove("schema_version");
        drop(app);
        fs::write(
            &storage_path,
            serde_json::to_vec_pretty(&legacy_ledger).unwrap(),
        )
        .unwrap();

        let migrated_app = app_with_config(storage_config(storage_path.clone()));
        let response = pull_changes_for(&migrated_app, mobile_id, Some("0")).await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["next_cursor"], "server-1");
        assert_eq!(body["changes"][0]["id"], change_id.to_string());

        let _ = register_test_device(&migrated_app, "Post-migration Workstation").await;
        let migrated_ledger: Value =
            serde_json::from_slice(&fs::read(&storage_path).unwrap()).unwrap();
        assert_eq!(
            migrated_ledger["schema_version"],
            SYNC_LEDGER_SCHEMA_VERSION
        );

        let _ = fs::remove_file(storage_path);
    }

    #[test]
    fn storage_path_rejects_future_ledger_schema_version() {
        let storage_path = test_storage_path("future-ledger");
        let backup_path = storage_path.with_extension("bak");
        fs::write(
            &storage_path,
            json!({
                "schema_version": SYNC_LEDGER_SCHEMA_VERSION + 1,
                "devices": {},
                "processed_change_ids": [],
                "changes": [],
                "latest_sequence": 0,
                "audit_log": []
            })
            .to_string(),
        )
        .unwrap();
        fs::write(
            &backup_path,
            serde_json::to_vec_pretty(&SyncStore::default()).unwrap(),
        )
        .unwrap();

        let error = match try_app_with_config(storage_config(storage_path.clone())) {
            Ok(_) => panic!("future ledger schema should fail startup"),
            Err(error) => error,
        };

        assert!(error
            .to_string()
            .contains("unsupported sync storage ledger schema_version"));
        let _ = fs::remove_file(storage_path);
        let _ = fs::remove_file(backup_path);
    }

    #[test]
    fn storage_path_rejects_ledgers_over_configured_size_before_parsing() {
        let storage_path = test_storage_path("oversized-ledger");
        fs::write(&storage_path, b"{not-json-but-too-large").unwrap();

        let error = match try_app_with_config(SyncConfig {
            storage_path: Some(storage_path.clone()),
            max_ledger_bytes: 8,
            ..SyncConfig::default()
        }) {
            Ok(_) => panic!("oversized ledger should fail startup"),
            Err(error) => error,
        };

        assert!(error
            .to_string()
            .contains("exceeds ATLASTERM_SYNC_MAX_LEDGER_BYTES"));
        let _ = fs::remove_file(storage_path);
    }

    #[test]
    fn storage_path_rejects_ledgers_with_too_many_changes() {
        let storage_path = test_storage_path("too-many-changes");
        let device_id = Uuid::new_v4();
        let now = Utc::now();
        fs::write(
            &storage_path,
            serde_json::to_vec_pretty(&SyncStore {
                schema_version: SYNC_LEDGER_SCHEMA_VERSION,
                devices: HashMap::new(),
                processed_change_ids: HashSet::new(),
                changes: vec![
                    StoredChange {
                        sequence: 1,
                        cursor: "server-1".into(),
                        id: Uuid::new_v4(),
                        device_id,
                        entity_type: "profile".into(),
                        entity_id: "prod-edge-01".into(),
                        operation: SyncOperation::Update,
                        payload: json!({ "encrypted_blob": "ciphertext-1" }),
                        client_time: now,
                        server_time: now,
                    },
                    StoredChange {
                        sequence: 2,
                        cursor: "server-2".into(),
                        id: Uuid::new_v4(),
                        device_id,
                        entity_type: "profile".into(),
                        entity_id: "prod-edge-02".into(),
                        operation: SyncOperation::Update,
                        payload: json!({ "encrypted_blob": "ciphertext-2" }),
                        client_time: now,
                        server_time: now,
                    },
                ],
                latest_sequence: 2,
                audit_log: Vec::new(),
            })
            .unwrap(),
        )
        .unwrap();

        let error = match try_app_with_config(SyncConfig {
            storage_path: Some(storage_path.clone()),
            max_stored_changes: 1,
            ..SyncConfig::default()
        }) {
            Ok(_) => panic!("ledger over stored-change limit should fail startup"),
            Err(error) => error,
        };

        assert!(error
            .to_string()
            .contains("ATLASTERM_SYNC_MAX_STORED_CHANGES"));
        let _ = fs::remove_file(storage_path);
    }

    #[test]
    fn storage_path_rejects_active_ledger_lock() {
        let storage_path = test_storage_path("active-lock");
        let lock_path = storage_path.with_extension("lock");
        fs::write(&lock_path, format!("pid={}\n", std::process::id())).unwrap();

        let error = match try_app_with_config(storage_config(storage_path.clone())) {
            Ok(_) => panic!("active ledger lock should fail startup"),
            Err(error) => error,
        };

        assert!(error
            .to_string()
            .contains("failed to acquire sync storage ledger lock"));
        let _ = fs::remove_file(storage_path);
        let _ = fs::remove_file(lock_path);
    }

    #[test]
    fn storage_path_removes_stale_ledger_lock() {
        let storage_path = test_storage_path("stale-lock");
        let lock_path = storage_path.with_extension("lock");
        fs::write(&lock_path, format!("pid={}\n", u32::MAX)).unwrap();

        let app = app_with_config(storage_config(storage_path.clone()));
        let lock_contents = fs::read_to_string(&lock_path).unwrap();

        assert!(lock_contents.contains(&format!("pid={}", std::process::id())));
        drop(app);
        assert!(!lock_path.exists());
        let _ = fs::remove_file(storage_path);
    }

    #[tokio::test]
    async fn storage_path_recovers_from_backup_when_primary_ledger_is_corrupt() {
        let storage_path = test_storage_path("backup-recovery");
        let backup_path = storage_path.with_extension("bak");
        let app = app_with_config(storage_config(storage_path.clone()));
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let change_id = Uuid::new_v4();

        let push = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": change_id,
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": "ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;
        assert_eq!(push.status(), StatusCode::ACCEPTED);

        fs::copy(&storage_path, &backup_path).unwrap();
        drop(app);
        fs::write(&storage_path, b"{not-json").unwrap();

        let recovered_app = app_with_config(storage_config(storage_path.clone()));
        let response = pull_changes_for(&recovered_app, mobile_id, Some("0")).await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["next_cursor"], "server-1");
        assert_eq!(body["changes"][0]["id"], change_id.to_string());

        let snapshot = admin_snapshot_for(&recovered_app).await;
        assert_eq!(snapshot["metrics"]["healthyDevices"], 2);
        assert_eq!(
            snapshot["auditEvents"][0]["id"],
            format!("audit-{change_id}")
        );
        let metrics = metrics_for(&recovered_app).await;
        assert!(metrics.contains("joessh_sync_ledger_recovery_total{source=\"backup\"} 1"));
        assert!(metrics.contains("joessh_sync_ledger_recovery_total{source=\"temp\"} 0"));

        let _ = fs::remove_file(storage_path);
        let _ = fs::remove_file(backup_path);
    }

    #[tokio::test]
    async fn storage_path_recovers_from_temp_ledger_when_primary_and_backup_are_missing() {
        let storage_path = test_storage_path("temp-recovery");
        let temp_path = storage_path.with_extension("tmp");
        let app = app_with_config(storage_config(storage_path.clone()));
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let change_id = Uuid::new_v4();

        let push = post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": change_id,
                    "entity_type": "profile",
                    "entity_id": "prod-edge-01",
                    "operation": "update",
                    "payload": { "encrypted_blob": "ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;
        assert_eq!(push.status(), StatusCode::ACCEPTED);

        drop(app);
        fs::rename(&storage_path, &temp_path).unwrap();

        let recovered_app = app_with_config(storage_config(storage_path.clone()));
        let response = pull_changes_for(&recovered_app, mobile_id, Some("0")).await;

        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["next_cursor"], "server-1");
        assert_eq!(body["changes"][0]["id"], change_id.to_string());
        let metrics = metrics_for(&recovered_app).await;
        assert!(metrics.contains("joessh_sync_ledger_recovery_total{source=\"backup\"} 0"));
        assert!(metrics.contains("joessh_sync_ledger_recovery_total{source=\"temp\"} 1"));

        let _ = fs::remove_file(storage_path);
        let _ = fs::remove_file(temp_path);
    }

    #[tokio::test]
    async fn register_device_rolls_back_memory_when_storage_write_fails() {
        let storage_path = test_storage_path("register-storage-failure");
        let app = app_with_config(storage_config(storage_path.clone()));
        let temp_path = block_temp_ledger(&storage_path);

        let response = post_register_with_display_name(&app, "Atlas workstation", None).await;

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            to_json(response.into_body()).await["code"],
            "storage_unavailable"
        );

        let snapshot = admin_snapshot_for(&app).await;
        assert_eq!(snapshot["metrics"]["healthyDevices"], 0);
        assert_eq!(snapshot["devices"].as_array().unwrap().len(), 0);
        let metrics = metrics_for(&app).await;
        assert!(metrics.contains("joessh_sync_storage_write_failures_total 1"));

        let _ = fs::remove_file(storage_path);
        let _ = fs::remove_dir_all(temp_path);
    }

    #[tokio::test]
    async fn push_changes_rolls_back_memory_and_change_id_when_storage_write_fails() {
        let storage_path = test_storage_path("push-storage-failure");
        let app = app_with_config(storage_config(storage_path.clone()));
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let temp_path = block_temp_ledger(&storage_path);
        let change_id = Uuid::new_v4();
        let payload = json!({
            "device_id": desktop_id,
            "base_cursor": "0",
            "changes": [{
                "id": change_id,
                "entity_type": "profile",
                "entity_id": "prod-edge-01",
                "operation": "update",
                "payload": { "encrypted_blob": "ciphertext" },
                "client_time": Utc::now()
            }]
        });

        let failed = post_push(&app, payload.clone()).await;

        assert_eq!(failed.status(), StatusCode::SERVICE_UNAVAILABLE);
        assert_eq!(
            to_json(failed.into_body()).await["code"],
            "storage_unavailable"
        );
        let metrics = metrics_for(&app).await;
        assert!(metrics.contains("joessh_sync_storage_write_failures_total 1"));

        let snapshot = admin_snapshot_for(&app).await;
        // The two device registrations persisted before storage was blocked; the
        // failed push must roll back only its own change-derived audit event.
        assert_eq!(snapshot["auditEvents"].as_array().unwrap().len(), 2);
        assert!(snapshot["devices"]
            .as_array()
            .unwrap()
            .iter()
            .all(|device| device["cursor"] == "0"));

        fs::remove_dir_all(&temp_path).unwrap();

        let retry = post_push(&app, payload).await;
        assert_eq!(retry.status(), StatusCode::ACCEPTED);
        let retry_body = to_json(retry.into_body()).await;
        assert_eq!(retry_body["accepted"], 1);
        assert_eq!(retry_body["sync_cursor"], "server-1");

        let response = pull_changes_for(&app, mobile_id, Some("0")).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["changes"].as_array().unwrap().len(), 1);
        assert_eq!(body["changes"][0]["id"], change_id.to_string());

        let _ = fs::remove_file(storage_path);
    }

    #[test]
    fn loaded_storage_normalizes_latest_cursor_and_processed_change_ids() {
        let device_id = Uuid::new_v4();
        let change_id = Uuid::new_v4();
        let now = Utc::now();
        let store = normalize_loaded_store(
            SyncStore {
                schema_version: 0,
                devices: HashMap::from([(
                    device_id,
                    RegisteredDeviceRecord {
                        device_id,
                        platform: DevicePlatform::Desktop,
                        app_version: "0.1.0".into(),
                        display_name: Some("Desktop Workstation".into()),
                        registered_at: now,
                    },
                )]),
                processed_change_ids: HashSet::new(),
                changes: vec![StoredChange {
                    sequence: 7,
                    cursor: "server-1".into(),
                    id: change_id,
                    device_id,
                    entity_type: "profile".into(),
                    entity_id: "prod-edge-01".into(),
                    operation: SyncOperation::Update,
                    payload: json!({ "encrypted_blob": "ciphertext" }),
                    client_time: now,
                    server_time: now,
                }],
                latest_sequence: 0,
                audit_log: Vec::new(),
            },
            10,
        )
        .unwrap();

        assert_eq!(store.schema_version, SYNC_LEDGER_SCHEMA_VERSION);
        assert_eq!(store.current_cursor(), "server-7");
        assert_eq!(store.changes[0].cursor, "server-7");
        assert!(store.processed_change_ids.contains(&change_id));
        assert_eq!(store.admin_snapshot().devices[0].cursor, "server-7");
    }

    #[test]
    fn accept_change_prunes_processed_change_ids_without_trimming_changes() {
        let device_id = Uuid::new_v4();
        let now = Utc::now();
        let first_change_id = Uuid::new_v4();
        let retained_change_id = Uuid::new_v4();
        let mut store = SyncStore::default();

        store.register_device(RegisteredDeviceRecord {
            device_id,
            platform: DevicePlatform::Desktop,
            app_version: "0.1.0".into(),
            display_name: Some("Desktop Workstation".into()),
            registered_at: now,
        });
        store.accept_change(
            device_id,
            SyncChange {
                id: first_change_id,
                entity_type: "profile".into(),
                entity_id: "oldest".into(),
                operation: SyncOperation::Update,
                payload: json!({ "encrypted_blob": "oldest" }),
                client_time: now,
            },
        );

        for index in 1..=PROCESSED_ID_RETENTION {
            let change_id = if index == PROCESSED_ID_RETENTION {
                retained_change_id
            } else {
                Uuid::new_v4()
            };
            store.accept_change(
                device_id,
                SyncChange {
                    id: change_id,
                    entity_type: "profile".into(),
                    entity_id: format!("retained-{index}"),
                    operation: SyncOperation::Update,
                    payload: json!({ "encrypted_blob": "ciphertext" }),
                    client_time: now,
                },
            );
        }

        assert_eq!(store.changes.len(), PROCESSED_ID_RETENTION as usize + 1);
        assert!(!store.processed_change_ids.contains(&first_change_id));
        assert!(store.processed_change_ids.contains(&retained_change_id));
        assert_eq!(
            store.processed_change_ids.len(),
            PROCESSED_ID_RETENTION as usize
        );
    }

    #[test]
    fn audit_log_retention_is_bounded_before_persisting() {
        let storage_path = test_storage_path("audit-log-retention");
        let now = Utc::now();
        let mut store = SyncStore::default();

        for index in 0..AUDIT_LOG_RETENTION + 3 {
            store.record_audit_event(StoredAuditEvent {
                id: format!("audit-{index}"),
                action: format!("Audit event {index}"),
                actor: "Sync API".into(),
                target: format!("device:{index}"),
                time: now + chrono::Duration::seconds(index as i64),
            });
        }
        persist_store(Some(storage_path.as_path()), &store, u64::MAX).unwrap();

        let persisted_ledger: Value =
            serde_json::from_slice(&fs::read(&storage_path).unwrap()).unwrap();
        let audit_log = persisted_ledger["audit_log"].as_array().unwrap();
        assert_eq!(audit_log.len(), AUDIT_LOG_RETENTION);
        assert_eq!(audit_log[0]["id"], "audit-3");
        assert_eq!(
            audit_log[AUDIT_LOG_RETENTION - 1]["id"],
            format!("audit-{}", AUDIT_LOG_RETENTION + 2)
        );

        let _ = fs::remove_file(storage_path);
    }

    #[test]
    fn admin_snapshot_returns_recent_audit_event_limit_from_bounded_log() {
        let now = Utc::now();
        let mut store = SyncStore::default();

        for index in 0..AUDIT_LOG_RETENTION + 2 {
            store.record_audit_event(StoredAuditEvent {
                id: format!("audit-{index}"),
                action: format!("Audit event {index}"),
                actor: "Sync API".into(),
                target: format!("device:{index}"),
                time: now + chrono::Duration::seconds(index as i64),
            });
        }

        let snapshot = store.admin_snapshot();
        assert_eq!(snapshot.audit_events.len(), AUDIT_EVENT_LIMIT);
        assert_eq!(
            snapshot.audit_events[0].id,
            format!("audit-{}", AUDIT_LOG_RETENTION + 1)
        );
        assert_eq!(
            snapshot.audit_events[AUDIT_EVENT_LIMIT - 1].id,
            format!(
                "audit-{}",
                AUDIT_LOG_RETENTION + 1 - (AUDIT_EVENT_LIMIT - 1)
            )
        );
    }

    #[tokio::test]
    async fn stale_base_cursor_reports_conflict() {
        let app = app();
        let desktop_id = register_test_device(&app, "Desktop Workstation").await;
        let mobile_id = register_test_device(&app, "JoeSSH Mobile").await;
        let entity_id = "prod-edge-01";

        post_push(
            &app,
            json!({
                "device_id": desktop_id,
                "base_cursor": "0",
                "changes": [{
                    "id": Uuid::new_v4(),
                    "entity_type": "profile",
                    "entity_id": entity_id,
                    "operation": "update",
                    "payload": { "encrypted_blob": "desktop-ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;

        let response = post_push(
            &app,
            json!({
                "device_id": mobile_id,
                "base_cursor": "0",
                "changes": [{
                    "id": Uuid::new_v4(),
                    "entity_type": "profile",
                    "entity_id": entity_id,
                    "operation": "update",
                    "payload": { "encrypted_blob": "mobile-ciphertext" },
                    "client_time": Utc::now()
                }]
            }),
        )
        .await;

        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let body = to_json(response.into_body()).await;
        assert_eq!(body["accepted"], 0);
        assert_eq!(body["conflicts"][0]["reason"], "changed_after_base_cursor");
    }

    fn sync_auth_config() -> SyncConfig {
        SyncConfig {
            auth_token: Some("test-token".into()),
            ..SyncConfig::default()
        }
    }

    fn admin_auth_config() -> SyncConfig {
        SyncConfig {
            auth_token: Some("test-token".into()),
            admin_token: Some("admin-token".into()),
            ..SyncConfig::default()
        }
    }

    fn shared_admin_sync_token_config() -> SyncConfig {
        SyncConfig {
            auth_token: Some("shared-token".into()),
            admin_token: Some("shared-token".into()),
            ..SyncConfig::default()
        }
    }

    fn admin_snapshot_config() -> SyncConfig {
        SyncConfig {
            admin_token: Some("admin-token".into()),
            ..SyncConfig::default()
        }
    }

    fn metrics_auth_config() -> SyncConfig {
        SyncConfig {
            auth_token: Some("test-token".into()),
            admin_token: Some("admin-token".into()),
            metrics_token: Some("metrics-token".into()),
            ..SyncConfig::default()
        }
    }

    fn storage_config(storage_path: PathBuf) -> SyncConfig {
        SyncConfig {
            admin_token: Some("admin-token".into()),
            storage_path: Some(storage_path),
            ..SyncConfig::default()
        }
    }

    fn test_storage_path(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!("atlasterm-sync-{name}-{}.json", Uuid::new_v4()))
    }

    fn rate_limited_config(max_per_second: u64) -> SyncConfig {
        SyncConfig {
            rate_limit_per_second: max_per_second,
            ..SyncConfig::default()
        }
    }

    fn block_temp_ledger(storage_path: &Path) -> PathBuf {
        let temp_path = storage_path.with_extension("tmp");
        fs::create_dir_all(&temp_path).unwrap();
        temp_path
    }

    async fn register_test_device(app: &Router, display_name: &str) -> Uuid {
        let response = post_register_with_display_name(app, display_name, None).await;
        let body = to_json(response.into_body()).await;
        Uuid::parse_str(body["device_id"].as_str().unwrap()).unwrap()
    }

    async fn post_register(app: &Router, authorization: Option<&str>) -> axum::response::Response {
        post_register_with_display_name(app, "Atlas workstation", authorization).await
    }

    async fn post_register_with_display_name(
        app: &Router,
        display_name: &str,
        authorization: Option<&str>,
    ) -> axum::response::Response {
        let mut request = Request::builder()
            .method("POST")
            .uri("/v1/devices/register")
            .header(header::CONTENT_TYPE, "application/json");

        if let Some(authorization) = authorization {
            request = request.header(header::AUTHORIZATION, authorization);
        }

        app.clone()
            .oneshot(
                request
                    .body(Body::from(
                        json!({
                            "platform": "desktop",
                            "app_version": "0.1.0",
                            "display_name": display_name
                        })
                        .to_string(),
                    ))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn post_push(app: &Router, payload: Value) -> axum::response::Response {
        app.clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/sync/push")
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(Body::from(payload.to_string()))
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn pull_changes_for(
        app: &Router,
        device_id: Uuid,
        since: Option<&str>,
    ) -> axum::response::Response {
        pull_changes_for_with_limit(app, device_id, since, None).await
    }

    async fn pull_changes_for_with_limit(
        app: &Router,
        device_id: Uuid,
        since: Option<&str>,
        limit: Option<usize>,
    ) -> axum::response::Response {
        let since = since
            .map(|cursor| format!("&since={cursor}"))
            .unwrap_or_default();
        let limit = limit
            .map(|limit| format!("&limit={limit}"))
            .unwrap_or_default();
        app.clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/v1/sync/pull?device_id={device_id}{since}{limit}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    async fn admin_snapshot_for(app: &Router) -> Value {
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/v1/admin/snapshot")
                    .header(header::AUTHORIZATION, "Bearer admin-token")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        to_json(response.into_body()).await
    }

    async fn metrics_for(app: &Router) -> String {
        let response = metrics_response_for(app, Some("Bearer metrics-token")).await;

        assert_eq!(response.status(), StatusCode::OK);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    async fn metrics_response_for(
        app: &Router,
        authorization: Option<&str>,
    ) -> axum::response::Response {
        let mut request = Request::builder().uri("/metrics");
        if let Some(authorization) = authorization {
            request = request.header(header::AUTHORIZATION, authorization);
        }

        app.clone()
            .oneshot(request.body(Body::empty()).unwrap())
            .await
            .unwrap()
    }

    async fn to_json(body: Body) -> Value {
        let bytes = to_bytes(body, usize::MAX).await.unwrap();
        serde_json::from_slice(&bytes).unwrap()
    }
}
