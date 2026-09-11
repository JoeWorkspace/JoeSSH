//! Cross-process trust coordination. Never hold this file lock across network I/O.
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use super::{
    current_unix_ms, known_host_record, read_known_hosts_file, write_known_hosts_file,
    KnownHostRecord, KnownHostSource, HOST_KEY_STORAGE_UNAVAILABLE, HOST_KEY_VERIFICATION_FAILED,
};
use std::collections::HashMap;

const LOCK_FILE: &str = "known-hosts.lock";
const REVOCATION_FILE: &str = "known-hosts-revocation.json";
const REVOKED: &str = "host key trust changed during connection; reconnect and verify again";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Revocation {
    version: u8,
    token: String,
}

pub(super) struct Snapshot {
    token: String,
    key: String,
    pub fingerprint: Option<String>,
}

pub(super) struct Store {
    path: PathBuf,
    revision_path: PathBuf,
    _lock: File,
}

fn unavailable<T>(_: T) -> String {
    HOST_KEY_STORAGE_UNAVAILABLE.to_string()
}

/// Must run on a blocking worker. The stable lock inode is never replaced/deleted.
pub(super) fn with_store<T>(
    path: &Path,
    deadline: Instant,
    run: impl FnOnce(&Store) -> Result<T, String>,
) -> Result<T, String> {
    let parent = path.parent().ok_or_else(|| unavailable(()))?;
    std::fs::create_dir_all(parent).map_err(unavailable)?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(parent.join(LOCK_FILE))
        .map_err(unavailable)?;
    loop {
        match lock.try_lock() {
            Ok(()) => break,
            Err(std::fs::TryLockError::WouldBlock) if Instant::now() < deadline => {
                std::thread::sleep(Duration::from_millis(10))
            }
            Err(_) => return Err(unavailable(())),
        }
    }
    if Instant::now() >= deadline {
        return Err(unavailable(()));
    }
    let store = Store {
        path: path.to_path_buf(),
        revision_path: parent.join(REVOCATION_FILE),
        _lock: lock,
    };
    // Validate the main file before creating coordination metadata.
    store.read()?;
    store.token()?;
    run(&store)
}

impl Store {
    fn token(&self) -> Result<String, String> {
        match std::fs::read(&self.revision_path) {
            Ok(bytes) => {
                let revision: Revocation = serde_json::from_slice(&bytes).map_err(unavailable)?;
                if revision.version != 1 || Uuid::parse_str(&revision.token).is_err() {
                    return Err(unavailable(()));
                }
                Ok(revision.token)
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => self.revoke(),
            Err(e) => Err(unavailable(e)),
        }
    }

    fn revoke(&self) -> Result<String, String> {
        let token = Uuid::new_v4().to_string();
        let bytes = serde_json::to_vec_pretty(&Revocation {
            version: 1,
            token: token.clone(),
        })
        .map_err(unavailable)?;
        atomic_write(&self.revision_path, &bytes)?;
        Ok(token)
    }

    pub fn read(&self) -> Result<HashMap<String, KnownHostRecord>, String> {
        read_known_hosts_file(&self.path)
    }

    pub fn snapshot(&self, key: &str) -> Result<Snapshot, String> {
        Ok(Snapshot {
            token: self.token()?,
            key: key.into(),
            fingerprint: self.read()?.get(key).map(|r| r.fingerprint.clone()),
        })
    }

    pub fn commit(&self, snapshot: &Snapshot, fingerprint: &str) -> Result<(), String> {
        if snapshot.token != self.token()? {
            return Err(REVOKED.into());
        }
        let mut hosts = self.read()?;
        if snapshot
            .fingerprint
            .as_deref()
            .is_some_and(|pin| pin != fingerprint)
        {
            return Err(HOST_KEY_VERIFICATION_FAILED.into());
        }
        match hosts.get_mut(&snapshot.key) {
            Some(record) if record.fingerprint == fingerprint => {
                record.last_seen_at_ms = Some(current_unix_ms());
            }
            Some(_) => return Err(HOST_KEY_VERIFICATION_FAILED.into()),
            None if snapshot.fingerprint.is_some() => return Err(REVOKED.into()),
            None => {
                hosts.insert(
                    snapshot.key.clone(),
                    known_host_record(
                        &snapshot.key,
                        fingerprint,
                        current_unix_ms(),
                        KnownHostSource::Confirmed,
                    ),
                );
            }
        }
        write_known_hosts_file(&self.path, &hosts)
    }

    pub fn remove(&self, key: Option<&str>) -> Result<(), String> {
        let mut hosts = self.read()?;
        match key {
            Some(key) => {
                hosts.remove(key);
            }
            None => hosts.clear(),
        }
        // Publish revocation first. Never roll it back even if the main save fails.
        self.revoke()?;
        write_known_hosts_file(&self.path, &hosts)
    }
}

/// A complete sibling file is flushed before replacement. The previous main JSON
/// survives any pre-rename failure; a failed post-rename sync is reported honestly.
pub(super) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or_else(|| unavailable(()))?;
    std::fs::create_dir_all(parent).map_err(unavailable)?;
    let temporary = parent.join(format!(".known-hosts-{}.tmp", Uuid::new_v4()));
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary).map_err(unavailable)?;
        file.write_all(bytes).map_err(unavailable)?;
        file.sync_all().map_err(unavailable)?;
        drop(file);
        std::fs::rename(&temporary, path).map_err(unavailable)?;
        #[cfg(unix)]
        File::open(parent)
            .and_then(|dir| dir.sync_all())
            .map_err(unavailable)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf {
        std::env::temp_dir()
            .join(format!("joessh-trust-{}", Uuid::new_v4()))
            .join("known-hosts.json")
    }
    fn access<T>(path: &Path, run: impl FnOnce(&Store) -> Result<T, String>) -> Result<T, String> {
        with_store(path, Instant::now() + Duration::from_secs(2), run)
    }
    #[test]
    fn concurrent_pins_recheck_and_revocation_prevents_aba() {
        let path = fixture();
        let a = access(&path, |s| s.snapshot("host:22")).unwrap();
        let b = access(&path, |s| s.snapshot("host:22")).unwrap();
        access(&path, |s| s.commit(&a, "SHA256:a")).unwrap();
        access(&path, |s| s.commit(&b, "SHA256:a")).unwrap();
        assert!(access(&path, |s| s.commit(&b, "SHA256:b")).is_err());
        let saved = access(&path, |s| s.snapshot("host:22")).unwrap();
        access(&path, |s| s.remove(Some("host:22"))).unwrap();
        let new = access(&path, |s| s.snapshot("host:22")).unwrap();
        access(&path, |s| s.commit(&new, "SHA256:a")).unwrap();
        assert!(access(&path, |s| s.commit(&saved, "SHA256:a")).is_err());
        assert!(access(&path, |s| s.commit(&b, "SHA256:a")).is_err());
    }
    #[test]
    fn malformed_revision_fails_closed_and_main_bytes_survive() {
        let path = fixture();
        access(&path, |s| {
            let snapshot = s.snapshot("host:22")?;
            s.commit(&snapshot, "SHA256:a")
        })
        .unwrap();
        let bytes = std::fs::read(&path).unwrap();
        std::fs::write(path.with_file_name(REVOCATION_FILE), b"broken").unwrap();
        assert!(access(&path, |s| s.remove(None)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
    }
    #[cfg(windows)]
    #[test]
    fn failed_main_replacement_keeps_bytes_but_does_not_undo_revocation() {
        let path = fixture();
        let snapshot = access(&path, |s| {
            let snapshot = s.snapshot("host:22")?;
            s.commit(&snapshot, "SHA256:a")?;
            s.snapshot("host:22")
        })
        .unwrap();
        let before = std::fs::read(&path).unwrap();
        let original_permissions = std::fs::metadata(&path).unwrap().permissions();
        let mut permissions = original_permissions.clone();
        permissions.set_readonly(true);
        std::fs::set_permissions(&path, permissions.clone()).unwrap();
        assert!(access(&path, |s| s.remove(None)).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::set_permissions(&path, original_permissions).unwrap();
        assert!(access(&path, |s| s.commit(&snapshot, "SHA256:a")).is_err());
        assert_eq!(
            access(&path, |s| s.read()).unwrap()["host:22"].fingerprint,
            "SHA256:a"
        );
    }
    #[test]
    fn process_lock_worker() {
        let Ok(path) = std::env::var("JOESSH_TRUST_TEST_PATH") else {
            return;
        };
        let path = PathBuf::from(path);
        access(&path, |s| {
            let snapshot = s.snapshot("child:22")?;
            s.commit(&snapshot, "SHA256:child")
        })
        .unwrap();
    }
    #[test]
    fn stable_lock_coordinates_a_second_process() {
        let path = fixture();
        let child = access(&path, |_s| {
            let mut child = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "known_hosts_store::tests::process_lock_worker",
                    "--exact",
                    "--nocapture",
                ])
                .env("JOESSH_TRUST_TEST_PATH", &path)
                .spawn()
                .unwrap();
            std::thread::sleep(Duration::from_millis(150));
            assert!(
                child.try_wait().unwrap().is_none(),
                "second process must wait for the stable file lock"
            );
            Ok(child)
        })
        .unwrap();
        assert!(child.wait_with_output().unwrap().status.success());
        assert!(access(&path, |s| s.read())
            .unwrap()
            .contains_key("child:22"));
    }
}
