use std::path::PathBuf;

use anyhow::Context;
use axum::http::{HeaderValue, Uri};

const DEFAULT_RATE_LIMIT_PER_SECOND: u64 = 100;
const DEFAULT_MAX_PUSH_CHANGES: usize = 256;
const DEFAULT_MAX_PULL_CHANGES: usize = 512;
const DEFAULT_MAX_STORED_CHANGES: usize = 100_000;
const DEFAULT_MAX_LEDGER_BYTES: u64 = 64 * 1024 * 1024;
const MIN_ENV_BEARER_TOKEN_LEN: usize = 32;

#[derive(Clone, Debug)]
pub(crate) struct SyncConfig {
    pub(crate) auth_token: Option<String>,
    pub(crate) admin_token: Option<String>,
    pub(crate) metrics_token: Option<String>,
    pub(crate) cors_allowed_origins: Option<Vec<HeaderValue>>,
    pub(crate) cors_permissive: bool,
    pub(crate) storage_path: Option<PathBuf>,
    pub(crate) allow_ephemeral_storage: bool,
    pub(crate) rate_limit_per_second: u64,
    pub(crate) max_push_changes: usize,
    pub(crate) max_pull_changes: usize,
    pub(crate) max_stored_changes: usize,
    pub(crate) max_ledger_bytes: u64,
}

impl Default for SyncConfig {
    fn default() -> Self {
        Self {
            auth_token: None,
            admin_token: None,
            metrics_token: None,
            cors_allowed_origins: None,
            cors_permissive: false,
            storage_path: None,
            allow_ephemeral_storage: false,
            rate_limit_per_second: DEFAULT_RATE_LIMIT_PER_SECOND,
            max_push_changes: DEFAULT_MAX_PUSH_CHANGES,
            max_pull_changes: DEFAULT_MAX_PULL_CHANGES,
            max_stored_changes: DEFAULT_MAX_STORED_CHANGES,
            max_ledger_bytes: DEFAULT_MAX_LEDGER_BYTES,
        }
    }
}

impl SyncConfig {
    pub(crate) fn from_env() -> anyhow::Result<Self> {
        let auth_token = read_trimmed_env("ATLASTERM_SYNC_AUTH_TOKEN");
        let admin_token = read_trimmed_env("ATLASTERM_SYNC_ADMIN_TOKEN");
        let metrics_token = read_trimmed_env("ATLASTERM_SYNC_METRICS_TOKEN");
        validate_env_tokens(
            auth_token.as_deref(),
            admin_token.as_deref(),
            metrics_token.as_deref(),
        )?;

        let cors_allowed_origins =
            parse_cors_allowed_origins(std::env::var("ATLASTERM_SYNC_CORS_ORIGINS").ok())?;
        let cors_permissive = env_flag_enabled("ATLASTERM_SYNC_CORS_PERMISSIVE");
        validate_cors_mode(cors_allowed_origins.is_some(), cors_permissive)?;

        Ok(Self {
            auth_token,
            admin_token,
            metrics_token,
            cors_allowed_origins,
            cors_permissive,
            storage_path: read_trimmed_env("ATLASTERM_SYNC_STORAGE_PATH").map(PathBuf::from),
            allow_ephemeral_storage: env_flag_enabled("ATLASTERM_SYNC_ALLOW_EPHEMERAL_STORAGE"),
            rate_limit_per_second: parse_rate_limit_per_second(
                std::env::var("ATLASTERM_SYNC_RATE_LIMIT").ok(),
            )?,
            max_push_changes: parse_positive_usize_env(
                "ATLASTERM_SYNC_MAX_PUSH_CHANGES",
                std::env::var("ATLASTERM_SYNC_MAX_PUSH_CHANGES").ok(),
                DEFAULT_MAX_PUSH_CHANGES,
            )?,
            max_pull_changes: parse_positive_usize_env(
                "ATLASTERM_SYNC_MAX_PULL_CHANGES",
                std::env::var("ATLASTERM_SYNC_MAX_PULL_CHANGES").ok(),
                DEFAULT_MAX_PULL_CHANGES,
            )?,
            max_stored_changes: parse_positive_usize_env(
                "ATLASTERM_SYNC_MAX_STORED_CHANGES",
                std::env::var("ATLASTERM_SYNC_MAX_STORED_CHANGES").ok(),
                DEFAULT_MAX_STORED_CHANGES,
            )?,
            max_ledger_bytes: parse_positive_u64_env(
                "ATLASTERM_SYNC_MAX_LEDGER_BYTES",
                std::env::var("ATLASTERM_SYNC_MAX_LEDGER_BYTES").ok(),
                DEFAULT_MAX_LEDGER_BYTES,
            )?,
        })
    }
}

fn read_trimmed_env(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub(crate) fn parse_cors_allowed_origins(
    raw: Option<String>,
) -> anyhow::Result<Option<Vec<HeaderValue>>> {
    let Some(raw) = raw else {
        return Ok(None);
    };

    let origins: Vec<HeaderValue> = raw
        .split(',')
        .map(str::trim)
        .filter(|origin| !origin.is_empty())
        .map(parse_cors_origin)
        .collect::<anyhow::Result<_>>()?;

    Ok(if origins.is_empty() {
        None
    } else {
        Some(origins)
    })
}

pub(crate) fn parse_rate_limit_per_second(raw: Option<String>) -> anyhow::Result<u64> {
    let Some(raw) = raw else {
        return Ok(DEFAULT_RATE_LIMIT_PER_SECOND);
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(DEFAULT_RATE_LIMIT_PER_SECOND);
    }

    raw.parse::<u64>()
        .with_context(|| "ATLASTERM_SYNC_RATE_LIMIT must be a non-negative integer".to_owned())
}

pub(crate) fn parse_positive_usize_env(
    name: &str,
    raw: Option<String>,
    default_value: usize,
) -> anyhow::Result<usize> {
    let Some(raw) = raw else {
        return Ok(default_value);
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(default_value);
    }

    let value = raw
        .parse::<usize>()
        .with_context(|| format!("{name} must be a positive integer"))?;
    anyhow::ensure!(value > 0, "{name} must be greater than zero");
    Ok(value)
}

pub(crate) fn parse_positive_u64_env(
    name: &str,
    raw: Option<String>,
    default_value: u64,
) -> anyhow::Result<u64> {
    let Some(raw) = raw else {
        return Ok(default_value);
    };
    let raw = raw.trim();
    if raw.is_empty() {
        return Ok(default_value);
    }

    let value = raw
        .parse::<u64>()
        .with_context(|| format!("{name} must be a positive integer"))?;
    anyhow::ensure!(value > 0, "{name} must be greater than zero");
    Ok(value)
}

pub(crate) fn validate_env_bearer_token(name: &str, token: Option<&str>) -> anyhow::Result<()> {
    let Some(token) = token else {
        return Ok(());
    };

    anyhow::ensure!(
        token.len() >= MIN_ENV_BEARER_TOKEN_LEN,
        "{name} must be at least {MIN_ENV_BEARER_TOKEN_LEN} characters"
    );
    anyhow::ensure!(
        !token.chars().any(char::is_whitespace),
        "{name} must not contain whitespace"
    );
    anyhow::ensure!(
        !token.chars().any(char::is_control),
        "{name} must not contain control characters"
    );
    Ok(())
}

fn validate_env_tokens(
    auth_token: Option<&str>,
    admin_token: Option<&str>,
    metrics_token: Option<&str>,
) -> anyhow::Result<()> {
    validate_env_bearer_token("ATLASTERM_SYNC_AUTH_TOKEN", auth_token)?;
    validate_env_bearer_token("ATLASTERM_SYNC_ADMIN_TOKEN", admin_token)?;
    validate_env_bearer_token("ATLASTERM_SYNC_METRICS_TOKEN", metrics_token)?;
    if auth_token
        .zip(admin_token)
        .is_some_and(|(sync_token, admin_token)| sync_token == admin_token)
    {
        anyhow::bail!("ATLASTERM_SYNC_ADMIN_TOKEN must be distinct from ATLASTERM_SYNC_AUTH_TOKEN");
    }
    if auth_token
        .zip(metrics_token)
        .is_some_and(|(sync_token, metrics_token)| sync_token == metrics_token)
    {
        anyhow::bail!(
            "ATLASTERM_SYNC_METRICS_TOKEN must be distinct from ATLASTERM_SYNC_AUTH_TOKEN"
        );
    }
    if admin_token
        .zip(metrics_token)
        .is_some_and(|(admin_token, metrics_token)| admin_token == metrics_token)
    {
        anyhow::bail!(
            "ATLASTERM_SYNC_METRICS_TOKEN must be distinct from ATLASTERM_SYNC_ADMIN_TOKEN"
        );
    }
    Ok(())
}

fn validate_cors_mode(has_allowed_origins: bool, cors_permissive: bool) -> anyhow::Result<()> {
    if cors_permissive && has_allowed_origins {
        anyhow::bail!(
            "ATLASTERM_SYNC_CORS_PERMISSIVE cannot be combined with ATLASTERM_SYNC_CORS_ORIGINS"
        );
    }
    Ok(())
}

fn parse_cors_origin(origin: &str) -> anyhow::Result<HeaderValue> {
    let uri = origin
        .parse::<Uri>()
        .with_context(|| format!("invalid CORS origin: {origin}"))?;
    let scheme = uri.scheme_str().unwrap_or_default();
    let Some(authority) = uri.authority().map(|authority| authority.as_str()) else {
        anyhow::bail!("CORS origin must include an authority: {origin}");
    };

    anyhow::ensure!(
        matches!(scheme, "http" | "https"),
        "CORS origin must use http or https: {origin}"
    );
    anyhow::ensure!(
        !authority.contains('@'),
        "CORS origin must not include userinfo: {origin}"
    );
    anyhow::ensure!(
        !authority.contains('*'),
        "CORS origin must not contain wildcards (use explicit origins instead): {origin}"
    );
    anyhow::ensure!(
        origin == format!("{scheme}://{authority}"),
        "CORS origin must be an http(s) origin without a path: {origin}"
    );

    HeaderValue::from_str(origin)
        .with_context(|| format!("invalid CORS origin header value: {origin}"))
}

pub(crate) fn env_flag_enabled(name: &str) -> bool {
    std::env::var(name)
        .ok()
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rate_limit_with_default_and_zero_override() {
        assert_eq!(parse_rate_limit_per_second(None).unwrap(), 100);
        assert_eq!(
            parse_rate_limit_per_second(Some("   ".into())).unwrap(),
            100
        );
        assert_eq!(parse_rate_limit_per_second(Some("0".into())).unwrap(), 0);
        assert_eq!(
            parse_rate_limit_per_second(Some("250".into())).unwrap(),
            250
        );
    }

    #[test]
    fn rejects_invalid_rate_limit_values() {
        assert!(parse_rate_limit_per_second(Some("-1".into())).is_err());
        assert!(parse_rate_limit_per_second(Some("fast".into())).is_err());
        assert!(parse_rate_limit_per_second(Some("10.5".into())).is_err());
    }

    #[test]
    fn parses_positive_sync_limit_env_values() {
        assert_eq!(parse_positive_usize_env("LIMIT", None, 7).unwrap(), 7);
        assert_eq!(
            parse_positive_usize_env("LIMIT", Some("   ".into()), 7).unwrap(),
            7
        );
        assert_eq!(
            parse_positive_usize_env("LIMIT", Some("12".into()), 7).unwrap(),
            12
        );
        assert_eq!(parse_positive_u64_env("LIMIT", None, 9).unwrap(), 9);
        assert_eq!(
            parse_positive_u64_env("LIMIT", Some("42".into()), 9).unwrap(),
            42
        );
    }

    #[test]
    fn rejects_invalid_sync_limit_env_values() {
        assert!(parse_positive_usize_env("LIMIT", Some("0".into()), 7).is_err());
        assert!(parse_positive_usize_env("LIMIT", Some("-1".into()), 7).is_err());
        assert!(parse_positive_usize_env("LIMIT", Some("many".into()), 7).is_err());
        assert!(parse_positive_u64_env("LIMIT", Some("0".into()), 7).is_err());
        assert!(parse_positive_u64_env("LIMIT", Some("-1".into()), 7).is_err());
        assert!(parse_positive_u64_env("LIMIT", Some("many".into()), 7).is_err());
    }

    #[test]
    fn validates_env_bearer_token_strength() {
        assert!(validate_env_bearer_token("TOKEN", None).is_ok());
        assert!(
            validate_env_bearer_token("TOKEN", Some("0123456789abcdef0123456789abcdef")).is_ok()
        );
        assert!(validate_env_bearer_token("TOKEN", Some("short-token")).is_err());
        assert!(
            validate_env_bearer_token("TOKEN", Some("0123456789abcdef 123456789abcdef")).is_err()
        );
    }

    #[test]
    fn rejects_reused_sync_and_admin_env_tokens() {
        let sync_token = "0123456789abcdef0123456789abcdef";
        assert!(validate_env_tokens(Some(sync_token), Some(sync_token), None).is_err());
        assert!(validate_env_tokens(
            Some(sync_token),
            Some("fedcba9876543210fedcba9876543210"),
            Some("00112233445566778899aabbccddeeff"),
        )
        .is_ok());
        assert!(validate_env_tokens(Some(sync_token), None, Some(sync_token)).is_err());
        assert!(validate_env_tokens(None, Some(sync_token), Some(sync_token)).is_err());
    }

    #[test]
    fn rejects_ambiguous_cors_modes() {
        assert!(validate_cors_mode(false, false).is_ok());
        assert!(validate_cors_mode(true, false).is_ok());
        assert!(validate_cors_mode(false, true).is_ok());
        assert!(validate_cors_mode(true, true).is_err());
    }
}
