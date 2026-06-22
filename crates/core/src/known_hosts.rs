use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownHostFingerprint {
    pub host: String,
    pub port: Option<u16>,
    pub key_type: String,
    pub fingerprint: String,
    pub hash_algorithm: FingerprintAlgorithm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FingerprintAlgorithm {
    Sha256,
    Md5,
    Unknown,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum KnownHostsError {
    #[error("known_hosts line is empty")]
    Empty,
    #[error("known_hosts line is missing fields")]
    MissingFields,
    #[error("hashed known_hosts entries are not supported")]
    HashedHostUnsupported,
}

pub fn parse_known_host_line(line: &str) -> Result<KnownHostFingerprint, KnownHostsError> {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return Err(KnownHostsError::Empty);
    }

    let mut parts = trimmed.split_whitespace();
    let hosts = parts.next().ok_or(KnownHostsError::MissingFields)?;
    let key_type = parts.next().ok_or(KnownHostsError::MissingFields)?;
    let key_body = parts.next().ok_or(KnownHostsError::MissingFields)?;

    let host = hosts
        .split(',')
        .next()
        .ok_or(KnownHostsError::MissingFields)?;
    if host.starts_with('|') {
        return Err(KnownHostsError::HashedHostUnsupported);
    }

    let (host, port) = parse_host_port(host);
    Ok(KnownHostFingerprint {
        host,
        port,
        key_type: key_type.to_string(),
        fingerprint: key_body.to_string(),
        hash_algorithm: FingerprintAlgorithm::Unknown,
    })
}

fn parse_host_port(host: &str) -> (String, Option<u16>) {
    if let Some(rest) = host.strip_prefix('[') {
        if let Some((name, suffix)) = rest.split_once("]:") {
            return (name.to_string(), suffix.parse().ok());
        }
    }
    (host.to_string(), None)
}

/// The trust-on-first-use decision for a presented host-key fingerprint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TofuVerdict {
    /// No fingerprint was stored for this host: accept and persist it.
    FirstUse,
    /// The presented fingerprint matches the stored one: accept.
    Match,
    /// The presented fingerprint differs from the stored one: reject (possible
    /// MITM or a legitimately rotated key requiring manual re-trust).
    Mismatch,
}

/// Decide trust for a presented fingerprint given what (if anything) was
/// previously stored for the host. Pure and side-effect free.
pub fn tofu_decision(stored: Option<&str>, presented: &str) -> TofuVerdict {
    match stored {
        None => TofuVerdict::FirstUse,
        Some(stored) if stored == presented => TofuVerdict::Match,
        Some(_) => TofuVerdict::Mismatch,
    }
}

#[cfg(test)]
mod tofu_tests {
    use super::*;

    #[test]
    fn first_use_when_nothing_stored() {
        assert_eq!(tofu_decision(None, "SHA256:abc"), TofuVerdict::FirstUse);
    }

    #[test]
    fn match_when_stored_equals_presented() {
        assert_eq!(
            tofu_decision(Some("SHA256:abc"), "SHA256:abc"),
            TofuVerdict::Match
        );
    }

    #[test]
    fn mismatch_when_stored_differs() {
        assert_eq!(
            tofu_decision(Some("SHA256:abc"), "SHA256:xyz"),
            TofuVerdict::Mismatch
        );
    }
}
