use crate::models::{PortForwardDirection, PortForwardRule, PortForwardRuleId};
use async_trait::async_trait;
use std::net::IpAddr;
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ForwardError {
    #[error("port forward rule not found")]
    NotFound,
    #[error("port forward failed: {0}")]
    Failed(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ForwardHandle {
    pub rule_id: PortForwardRuleId,
    pub bound_addr: String,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum ForwardBindValidationError {
    #[error("bind host is empty")]
    EmptyBindHost,
    #[error("wildcard bind host is not allowed for {direction:?} forwards")]
    WildcardBindHost {
        direction: PortForwardDirection,
        bind_host: String,
    },
    #[error("non-loopback bind host is not allowed for {direction:?} forwards")]
    NonLoopbackBindHost {
        direction: PortForwardDirection,
        bind_host: String,
    },
}

pub fn validate_bind_host(rule: &PortForwardRule) -> Result<(), ForwardBindValidationError> {
    let bind_host = rule.bind_host.trim();

    if bind_host.is_empty() {
        return Err(ForwardBindValidationError::EmptyBindHost);
    }

    if is_wildcard_bind_host(bind_host) {
        return Err(ForwardBindValidationError::WildcardBindHost {
            direction: rule.direction,
            bind_host: rule.bind_host.clone(),
        });
    }

    if matches!(
        rule.direction,
        PortForwardDirection::Local | PortForwardDirection::Dynamic
    ) && !is_loopback_bind_host(bind_host)
    {
        return Err(ForwardBindValidationError::NonLoopbackBindHost {
            direction: rule.direction,
            bind_host: rule.bind_host.clone(),
        });
    }

    Ok(())
}

/// Validate a `host:port` bind address for a **local** forward (the SSH
/// `forward_local` always binds locally). Rejects wildcard binds and any
/// non-loopback host, so a local tunnel cannot be exposed to the network.
/// The host portion is extracted by stripping the trailing `:port`.
pub fn validate_local_bind_addr(bind_addr: &str) -> Result<(), ForwardBindValidationError> {
    let trimmed = bind_addr.trim();
    // Split off the final ":port" (works for IPv4/host; bracketed IPv6 keeps
    // its brackets, which is_loopback_bind_host already strips).
    let host = match trimmed.rfind(':') {
        Some(idx) => &trimmed[..idx],
        None => trimmed,
    };

    if host.is_empty() {
        return Err(ForwardBindValidationError::EmptyBindHost);
    }
    if is_wildcard_bind_host(host) {
        return Err(ForwardBindValidationError::WildcardBindHost {
            direction: PortForwardDirection::Local,
            bind_host: host.to_string(),
        });
    }
    if !is_loopback_bind_host(host) {
        return Err(ForwardBindValidationError::NonLoopbackBindHost {
            direction: PortForwardDirection::Local,
            bind_host: host.to_string(),
        });
    }
    Ok(())
}

fn is_wildcard_bind_host(bind_host: &str) -> bool {
    matches!(bind_host, "*" | "0.0.0.0" | "::" | "[::]")
}

fn is_loopback_bind_host(bind_host: &str) -> bool {
    if bind_host.eq_ignore_ascii_case("localhost") {
        return true;
    }

    bind_host
        .trim_matches(|c| c == '[' || c == ']')
        .parse::<IpAddr>()
        .map(|addr| addr.is_loopback())
        .unwrap_or(false)
}

#[async_trait]
pub trait ForwardService: Send + Sync {
    async fn list_rules(&self) -> Result<Vec<PortForwardRule>, ForwardError>;
    async fn save_rule(&self, rule: PortForwardRule) -> Result<PortForwardRule, ForwardError>;
    async fn start(&self, rule_id: PortForwardRuleId) -> Result<ForwardHandle, ForwardError>;
    async fn stop(&self, rule_id: PortForwardRuleId) -> Result<(), ForwardError>;
}

#[cfg(test)]
mod bind_addr_tests {
    use super::*;

    #[test]
    fn accepts_loopback_binds() {
        assert!(validate_local_bind_addr("127.0.0.1:8080").is_ok());
        assert!(validate_local_bind_addr("localhost:5432").is_ok());
        assert!(validate_local_bind_addr("[::1]:9000").is_ok());
    }

    #[test]
    fn rejects_wildcard_binds() {
        assert!(matches!(
            validate_local_bind_addr("0.0.0.0:8080"),
            Err(ForwardBindValidationError::WildcardBindHost { .. })
        ));
        assert!(matches!(
            validate_local_bind_addr("*:8080"),
            Err(ForwardBindValidationError::WildcardBindHost { .. })
        ));
    }

    #[test]
    fn rejects_non_loopback_binds() {
        assert!(matches!(
            validate_local_bind_addr("192.168.1.10:8080"),
            Err(ForwardBindValidationError::NonLoopbackBindHost { .. })
        ));
    }

    #[test]
    fn rejects_empty_host() {
        assert!(matches!(
            validate_local_bind_addr(":8080"),
            Err(ForwardBindValidationError::EmptyBindHost)
        ));
    }
}
