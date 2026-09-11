//! A PTY owns its input serialization and cancellation; registry locks never do I/O.
use atlasterm_core::PtyWriter;
use std::collections::VecDeque;
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;
use tokio::sync::{watch, Mutex, Semaphore};
use tokio::task::AbortHandle;

const OUTPUT_WINDOW_BYTES: usize = 256 * 1024;

pub(super) struct OutputWindow {
    available: Arc<Semaphore>,
    pending: StdMutex<VecDeque<(u64, tokio::sync::OwnedSemaphorePermit)>>,
    sequence: std::sync::atomic::AtomicU64,
}
impl OutputWindow {
    fn new() -> Self {
        Self {
            available: Arc::new(Semaphore::new(OUTPUT_WINDOW_BYTES)),
            pending: StdMutex::new(VecDeque::new()),
            sequence: std::sync::atomic::AtomicU64::new(0),
        }
    }
    pub async fn reserve(&self, bytes: usize) -> Result<u64, String> {
        let permit = tokio::time::timeout(
            Duration::from_secs(30),
            self.available.clone().acquire_many_owned(bytes as u32),
        )
        .await
        .map_err(|_| "terminal output consumer timed out".to_string())?
        .map_err(|_| "terminal output closed".to_string())?;
        let sequence = self
            .sequence
            .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
            + 1;
        self.pending.lock().unwrap().push_back((sequence, permit));
        Ok(sequence)
    }
    pub fn acknowledge(&self, sequence: u64) {
        let mut pending = self.pending.lock().unwrap();
        if pending.back().is_some_and(|(last, _)| sequence <= *last) {
            while pending.front().is_some_and(|(first, _)| *first <= sequence) {
                pending.pop_front();
            }
        }
    }
    fn close(&self) {
        self.available.close();
        self.pending.lock().unwrap().clear();
    }
}

pub(super) const MAX_INPUT_CHUNK: usize = 16 * 1024;
const MAX_PENDING_INPUT: usize = 64 * 1024;
const IO_TIMEOUT: Duration = Duration::from_secs(5);

pub(super) struct PtyRuntime {
    writer: PtyWriter,
    input: Mutex<Vec<u8>>,
    budget: Arc<Semaphore>,
    closed: watch::Sender<bool>,
    reader: StdMutex<Option<AbortHandle>>,
    pub output: OutputWindow,
}

impl PtyRuntime {
    pub fn new(writer: PtyWriter) -> Self {
        Self {
            writer,
            input: Mutex::new(Vec::new()),
            budget: Arc::new(Semaphore::new(MAX_PENDING_INPUT)),
            closed: watch::channel(false).0,
            reader: StdMutex::new(None),
            output: OutputWindow::new(),
        }
    }
    pub fn set_reader(&self, handle: AbortHandle) {
        let mut reader = self.reader.lock().unwrap();
        if *self.closed.borrow() {
            handle.abort();
        } else {
            *reader = Some(handle);
        }
    }
    pub fn mark_closed(&self) {
        self.closed.send_replace(true);
        self.budget.close();
        self.output.close();
    }
    async fn run<T>(
        &self,
        operation: impl std::future::Future<Output = Result<T, String>>,
    ) -> Result<T, String> {
        let mut closed = self.closed.subscribe();
        tokio::select! {
            biased;
            _ = closed.wait_for(|closed| *closed) => Err("pty not found".into()),
            result = tokio::time::timeout(IO_TIMEOUT, operation) => result.map_err(|_| "pty I/O timed out".to_string())?,
        }
    }
    pub async fn write(&self, data: &[u8]) -> Result<(), String> {
        if data.len() > MAX_INPUT_CHUNK {
            return Err("pty input exceeds chunk limit".into());
        }
        let _budget = self
            .budget
            .clone()
            .try_acquire_many_owned(data.len() as u32)
            .map_err(|_| "pty input queue is full or closed".to_string())?;
        self.run(async {
            let mut input = self.input.lock().await;
            if let Err(error) = super::apply_pty_input_safety(&mut input, data) {
                self.writer
                    .write(&[0x03])
                    .await
                    .map_err(super::sanitize_ssh_error)?;
                return Err(error);
            }
            self.writer
                .write(data)
                .await
                .map_err(super::sanitize_ssh_error)
        })
        .await
    }
    pub async fn resize(&self, cols: u32, rows: u32) -> Result<(), String> {
        self.run(async {
            self.writer
                .resize(cols, rows)
                .await
                .map_err(super::sanitize_ssh_error)
        })
        .await
    }
    pub async fn close(&self) {
        self.mark_closed();
        if let Some(reader) = self.reader.lock().unwrap().take() {
            reader.abort();
        }
        self.finish().await;
    }
    pub async fn finish(&self) {
        self.mark_closed();
        // Never wait for the input mutex. The cancellation wakes all queued I/O.
        let _ = tokio::time::timeout(Duration::from_secs(1), self.writer.close()).await;
    }
}

impl Drop for PtyRuntime {
    fn drop(&mut self) {
        if let Ok(reader) = self.reader.get_mut() {
            if let Some(reader) = reader.take() {
                reader.abort();
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use atlasterm_core::{HostKeyPolicy, SshAuth, SshClient, SshConfig};

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn stalled_real_pty_is_isolated_bounded_and_can_be_closed() {
        struct Server {
            stall: bool,
            entered: Arc<tokio::sync::Notify>,
            release: Arc<tokio::sync::Notify>,
        }
        impl russh::server::Handler for Server {
            type Error = russh::Error;
            async fn auth_password(
                &mut self,
                _: &str,
                _: &str,
            ) -> Result<russh::server::Auth, Self::Error> {
                Ok(russh::server::Auth::Accept)
            }
            async fn channel_open_session(
                &mut self,
                _: russh::Channel<russh::server::Msg>,
                reply: russh::server::ChannelOpenHandle,
                _: &mut russh::server::Session,
            ) -> Result<(), Self::Error> {
                reply.accept().await;
                Ok(())
            }
            async fn shell_request(
                &mut self,
                id: russh::ChannelId,
                session: &mut russh::server::Session,
            ) -> Result<(), Self::Error> {
                session.channel_success(id)?;
                Ok(())
            }
            async fn data(
                &mut self,
                _: russh::ChannelId,
                _: &[u8],
                _: &mut russh::server::Session,
            ) -> Result<(), Self::Error> {
                self.entered.notify_one();
                if self.stall {
                    self.release.notified().await;
                }
                Ok(())
            }
        }
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let entered = [
            Arc::new(tokio::sync::Notify::new()),
            Arc::new(tokio::sync::Notify::new()),
        ];
        let release = Arc::new(tokio::sync::Notify::new());
        let config = Arc::new(russh::server::Config {
            keys: vec![russh::keys::PrivateKey::random(
                &mut rand::rng(),
                russh::keys::Algorithm::Ed25519,
            )
            .unwrap()],
            window_size: 1024,
            ..Default::default()
        });
        let server_entered = entered.clone();
        let server_release = release.clone();
        let server = tokio::spawn(async move {
            let mut tasks = tokio::task::JoinSet::new();
            for (index, entered) in server_entered.into_iter().enumerate() {
                let (socket, _) = listener.accept().await.unwrap();
                let handler = Server {
                    stall: index == 0,
                    entered,
                    release: server_release.clone(),
                };
                let config = config.clone();
                tasks.spawn(async move {
                    let session = russh::server::run_stream(config, socket, handler)
                        .await
                        .unwrap();
                    let _ = session.await;
                });
            }
            while tasks.join_next().await.is_some() {}
        });
        let mut clients = Vec::new();
        let mut runtimes = Vec::new();
        let mut readers = Vec::new();
        for _ in 0..2 {
            let client = SshClient::connect(SshConfig {
                host: address.ip().to_string(),
                port: address.port(),
                username: "fixture".into(),
                auth: SshAuth::Password("fixture".into()),
                host_key_policy: HostKeyPolicy::AcceptAny,
                connect_timeout_ms: 5000,
            })
            .await
            .unwrap();
            let (writer, reader) = client.open_shell(80, 24).await.unwrap().split();
            clients.push(client);
            readers.push(reader);
            runtimes.push(Arc::new(PtyRuntime::new(writer)));
        }
        let first = runtimes[0].clone();
        let blocked = tokio::spawn(async move { first.write(&vec![b'a'; MAX_INPUT_CHUNK]).await });
        tokio::time::timeout(Duration::from_secs(2), entered[0].notified())
            .await
            .unwrap();
        assert!(
            !blocked.is_finished(),
            "fixture must exhaust the SSH receive window"
        );
        tokio::time::timeout(
            Duration::from_millis(500),
            runtimes[1].write(b"echo healthy\r"),
        )
        .await
        .unwrap()
        .unwrap();
        tokio::time::timeout(Duration::from_secs(2), entered[1].notified())
            .await
            .unwrap();
        let mut queued = Vec::new();
        for _ in 0..3 {
            let first = runtimes[0].clone();
            queued.push(tokio::spawn(async move {
                first.write(&vec![b'b'; MAX_INPUT_CHUNK]).await
            }));
        }
        tokio::time::timeout(Duration::from_secs(2), async {
            while runtimes[0].budget.available_permits() != 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        assert!(runtimes[0].write(b"overflow").await.is_err());
        tokio::time::timeout(Duration::from_millis(1500), runtimes[0].close())
            .await
            .unwrap();
        assert!(blocked.await.unwrap().is_err());
        for pending in queued {
            assert!(pending.await.unwrap().is_err());
        }
        assert!(runtimes[0].write(b"after-close").await.is_err());
        runtimes[1].resize(100, 30).await.unwrap();
        runtimes[1].close().await;
        for client in clients {
            client.disconnect();
        }
        release.notify_one();
        tokio::time::timeout(Duration::from_secs(2), server)
            .await
            .unwrap()
            .unwrap();
    }

    #[tokio::test]
    async fn output_window_bounds_slow_consumers_and_close_wakes_waiters() {
        let first = OutputWindow::new();
        let second = OutputWindow::new();
        let sequence = first.reserve(OUTPUT_WINDOW_BYTES).await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_millis(20), first.reserve(1))
                .await
                .is_err()
        );
        second.reserve(16 * 1024).await.unwrap();
        first.acknowledge(sequence);
        first.reserve(OUTPUT_WINDOW_BYTES).await.unwrap();
        first.close();
        assert!(first.reserve(1).await.is_err());
        assert!(first.pending.lock().unwrap().is_empty());
    }
}
