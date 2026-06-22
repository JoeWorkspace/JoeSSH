//! Real TCP reachability/latency probe.
//!
//! [`probe_tcp`] opens a timed TCP connection to a target and reports whether
//! it was reachable (with the connect latency), timed out, or was refused.
//! This backs the "test connection" action and is fully verifiable headless
//! via a loopback listener.

use std::time::{Duration, Instant};

use tokio::net::TcpStream;
use tokio::time::timeout;

/// Outcome of a TCP reachability probe.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProbeOutcome {
    /// Connected within the timeout; carries the connect latency in ms.
    Reachable { latency_ms: u64 },
    /// The connect did not complete within the timeout.
    TimedOut,
    /// The connect failed (refused, DNS failure, etc.) with a message.
    Unreachable { message: String },
}

/// Attempt a timed TCP connection to `addr` (`host:port`), giving up after
/// `timeout_ms`. Never panics; classifies every result.
pub async fn probe_tcp(addr: &str, timeout_ms: u64) -> ProbeOutcome {
    let started = Instant::now();
    match timeout(Duration::from_millis(timeout_ms), TcpStream::connect(addr)).await {
        Ok(Ok(_stream)) => ProbeOutcome::Reachable {
            latency_ms: started.elapsed().as_millis() as u64,
        },
        Ok(Err(error)) => ProbeOutcome::Unreachable {
            message: error.to_string(),
        },
        Err(_elapsed) => ProbeOutcome::TimedOut,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn reachable_reports_latency() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        // Accept in the background so the connect completes.
        tokio::spawn(async move {
            let _ = listener.accept().await;
        });

        let outcome = probe_tcp(&addr, 1_000).await;
        assert!(
            matches!(outcome, ProbeOutcome::Reachable { .. }),
            "got {outcome:?}"
        );
    }

    #[tokio::test]
    async fn unreachable_port_is_not_reachable() {
        // Bind then drop the listener to get a port nothing is listening on.
        // Depending on the OS this surfaces as a refused connection or, if the
        // SYN is silently dropped, a timeout — both are non-Reachable.
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap().to_string();
        drop(listener);

        let outcome = probe_tcp(&addr, 200).await;
        assert!(
            matches!(
                outcome,
                ProbeOutcome::Unreachable { .. } | ProbeOutcome::TimedOut
            ),
            "got {outcome:?}"
        );
    }
}
