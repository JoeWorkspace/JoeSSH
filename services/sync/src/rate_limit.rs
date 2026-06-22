use std::collections::HashMap;
use std::net::IpAddr;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Fixed-window, per-client-IP rate limiter. Clone-compatible (unlike tower's
/// `RateLimit` service) so it can be used as an axum middleware.
pub(crate) struct RateLimiter {
    max_per_window: u64,
    window: Duration,
    clients: Mutex<HashMap<IpAddr, (Instant, u64)>>,
}

impl RateLimiter {
    pub(crate) fn new(max_per_window: u64, window: Duration) -> Self {
        Self {
            max_per_window,
            window,
            clients: Mutex::new(HashMap::new()),
        }
    }

    /// Returns true if the request from `ip` is allowed under the current window.
    pub(crate) fn check(&self, ip: IpAddr) -> bool {
        let now = Instant::now();
        let mut clients = self.clients.lock().expect("rate limiter mutex poisoned");
        // Opportunistically drop entries whose window has fully expired so the
        // map cannot grow unbounded across a large/rotating client-IP space.
        if clients.len() > EVICTION_THRESHOLD {
            clients.retain(|_, (start, _)| now.duration_since(*start) < self.window);
        }
        let entry = clients.entry(ip).or_insert((now, 0));
        if now.duration_since(entry.0) >= self.window {
            *entry = (now, 0);
        }
        entry.1 += 1;
        entry.1 <= self.max_per_window
    }

    #[cfg(test)]
    fn tracked_clients(&self) -> usize {
        self.clients
            .lock()
            .expect("rate limiter mutex poisoned")
            .len()
    }

    #[cfg(test)]
    fn track_client_for_test(&self, ip: IpAddr, window_start: Instant, count: u64) {
        self.clients
            .lock()
            .expect("rate limiter mutex poisoned")
            .insert(ip, (window_start, count));
    }
}

/// Sweep expired entries once the tracked client count exceeds this.
const EVICTION_THRESHOLD: usize = 1024;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rate_limiter_allows_up_to_limit_then_blocks() {
        let limiter = RateLimiter::new(2, Duration::from_secs(60));
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        assert!(limiter.check(ip));
        assert!(limiter.check(ip));
        assert!(!limiter.check(ip));
    }

    #[test]
    fn rate_limiter_is_per_client() {
        let limiter = RateLimiter::new(1, Duration::from_secs(60));
        let a: IpAddr = "203.0.113.7".parse().unwrap();
        let b: IpAddr = "203.0.113.8".parse().unwrap();
        assert!(limiter.check(a));
        assert!(!limiter.check(a));
        assert!(limiter.check(b));
    }

    #[test]
    fn rate_limiter_resets_after_window() {
        let limiter = RateLimiter::new(1, Duration::from_millis(1));
        let ip: IpAddr = "203.0.113.7".parse().unwrap();
        assert!(limiter.check(ip));
        assert!(!limiter.check(ip));
        std::thread::sleep(Duration::from_millis(3));
        assert!(limiter.check(ip));
    }

    #[test]
    fn rate_limiter_evicts_expired_entries_when_map_grows() {
        let limiter = RateLimiter::new(10, Duration::from_secs(60));
        let expired_window = Instant::now() - Duration::from_secs(120);
        for i in 0..=(EVICTION_THRESHOLD as u32 + 1) {
            let ip = IpAddr::from(std::net::Ipv4Addr::from(0x0a00_0000 + i));
            limiter.track_client_for_test(ip, expired_window, 1);
        }
        assert!(limiter.tracked_clients() > EVICTION_THRESHOLD);
        let fresh = IpAddr::from(std::net::Ipv4Addr::new(203, 0, 113, 7));
        limiter.check(fresh);
        // All previously-tracked IPs were expired and dropped; only `fresh` remains.
        assert_eq!(limiter.tracked_clients(), 1);
    }
}
