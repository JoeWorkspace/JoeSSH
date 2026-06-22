//! Real TCP port-forwarding engine.
//!
//! [`TcpForwarder`] binds a local listener and, for every accepted client,
//! opens a TCP connection to a target address and copies bytes in both
//! directions until either side closes. This is the transport used by local
//! port forwards; the SSH-channel bridge (Foundation 5) swaps the target dial
//! for a `direct-tcpip` channel while reusing the same accept/copy loop shape.

use std::future::Future;
use std::io;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::oneshot;

/// A running forwarder. Dropping or calling [`TcpForwardHandle::shutdown`]
/// stops accepting new connections; in-flight copies finish on their own.
#[derive(Debug)]
pub struct TcpForwardHandle {
    bound_addr: SocketAddr,
    accepted: Arc<AtomicU64>,
    shutdown_tx: Option<oneshot::Sender<()>>,
}

impl TcpForwardHandle {
    /// The address the listener actually bound to (resolves an ephemeral
    /// port 0 to the concrete OS-assigned port).
    pub fn bound_addr(&self) -> SocketAddr {
        self.bound_addr
    }

    /// Number of client connections accepted so far.
    pub fn accepted_count(&self) -> u64 {
        self.accepted.load(Ordering::SeqCst)
    }

    /// Signal the accept loop to stop. Idempotent.
    pub fn shutdown(&mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
    }
}

impl Drop for TcpForwardHandle {
    fn drop(&mut self) {
        self.shutdown();
    }
}

/// Bind `bind_addr` and forward every accepted connection to `target_addr`
/// over a plain TCP connection. Thin wrapper over [`spawn_forward_with_dialer`].
pub async fn spawn_tcp_forward(
    bind_addr: &str,
    target_addr: String,
) -> io::Result<TcpForwardHandle> {
    spawn_forward_with_dialer(bind_addr, move |_peer| {
        let target_addr = target_addr.clone();
        async move { TcpStream::connect(&target_addr).await }
    })
    .await
}

/// Bind `bind_addr` and forward every accepted connection to whatever stream
/// `dial` produces for the accepted peer. The dialer lets callers tunnel the
/// target side over anything that is `AsyncRead + AsyncWrite` — a plain
/// [`TcpStream`] for local TCP, or an SSH `direct-tcpip` channel stream for a
/// real `ssh -L` forward.
pub async fn spawn_forward_with_dialer<D, F, S>(
    bind_addr: &str,
    dial: D,
) -> io::Result<TcpForwardHandle>
where
    D: Fn(SocketAddr) -> F + Send + Sync + 'static,
    F: Future<Output = io::Result<S>> + Send + 'static,
    S: AsyncRead + AsyncWrite + Unpin + Send + 'static,
{
    let listener = TcpListener::bind(bind_addr).await?;
    let bound_addr = listener.local_addr()?;
    let accepted = Arc::new(AtomicU64::new(0));
    let (shutdown_tx, mut shutdown_rx) = oneshot::channel();
    let dial = Arc::new(dial);

    let accept_accepted = Arc::clone(&accepted);
    tokio::spawn(async move {
        loop {
            tokio::select! {
                _ = &mut shutdown_rx => break,
                accepted_conn = listener.accept() => {
                    let Ok((inbound, peer)) = accepted_conn else { break };
                    accept_accepted.fetch_add(1, Ordering::SeqCst);
                    let dial = Arc::clone(&dial);
                    tokio::spawn(async move {
                        if let Ok(outbound) = dial(peer).await {
                            let _ = proxy(inbound, outbound).await;
                        }
                    });
                }
            }
        }
    });

    Ok(TcpForwardHandle {
        bound_addr,
        accepted,
        shutdown_tx: Some(shutdown_tx),
    })
}

/// Copy bytes bidirectionally between the inbound client and the target stream
/// until both halves close.
async fn proxy<S>(mut inbound: TcpStream, mut outbound: S) -> io::Result<()>
where
    S: AsyncRead + AsyncWrite + Unpin,
{
    let (mut ri, mut wi) = inbound.split();
    let (mut ro, mut wo) = tokio::io::split(&mut outbound);

    let client_to_target = async {
        copy_half(&mut ri, &mut wo).await?;
        wo.shutdown().await
    };
    let target_to_client = async {
        copy_half(&mut ro, &mut wi).await?;
        wi.shutdown().await
    };

    tokio::try_join!(client_to_target, target_to_client)?;
    Ok(())
}

async fn copy_half<R, W>(reader: &mut R, writer: &mut W) -> io::Result<()>
where
    R: AsyncReadExt + Unpin,
    W: AsyncWriteExt + Unpin,
{
    let mut buf = [0u8; 8 * 1024];
    loop {
        let n = reader.read(&mut buf).await?;
        if n == 0 {
            return Ok(());
        }
        writer.write_all(&buf[..n]).await?;
        writer.flush().await?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Start a loopback echo server; returns its bound address.
    async fn spawn_echo_server() -> SocketAddr {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut sock, _)) = listener.accept().await else {
                    break;
                };
                tokio::spawn(async move {
                    let mut buf = [0u8; 1024];
                    loop {
                        match sock.read(&mut buf).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                if sock.write_all(&buf[..n]).await.is_err() {
                                    break;
                                }
                            }
                        }
                    }
                });
            }
        });
        addr
    }

    #[tokio::test]
    async fn forwards_bytes_round_trip_through_loopback() {
        let echo = spawn_echo_server().await;
        let handle = spawn_tcp_forward("127.0.0.1:0", echo.to_string())
            .await
            .unwrap();
        let forward_addr = handle.bound_addr();

        // Connect to the forwarder (not the echo server directly).
        let mut client = TcpStream::connect(forward_addr).await.unwrap();
        client.write_all(b"hello forward").await.unwrap();
        client.flush().await.unwrap();

        let mut buf = [0u8; 13];
        client.read_exact(&mut buf).await.unwrap();
        assert_eq!(&buf, b"hello forward");
        assert_eq!(handle.accepted_count(), 1);
    }

    #[tokio::test]
    async fn binds_ephemeral_port_and_reports_it() {
        let handle = spawn_tcp_forward("127.0.0.1:0", "127.0.0.1:9".to_string())
            .await
            .unwrap();
        assert!(handle.bound_addr().port() != 0);
        assert!(handle.bound_addr().ip().is_loopback());
    }

    #[tokio::test]
    async fn shutdown_stops_accepting_new_connections() {
        let echo = spawn_echo_server().await;
        let mut handle = spawn_tcp_forward("127.0.0.1:0", echo.to_string())
            .await
            .unwrap();
        let addr = handle.bound_addr();
        handle.shutdown();

        // Give the accept loop a tick to observe the shutdown signal.
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // A fresh connection either fails to connect or is immediately closed
        // (never echoes), so a write+read returns 0 bytes / errors.
        if let Ok(mut client) = TcpStream::connect(addr).await {
            let _ = client.write_all(b"after shutdown").await;
            let mut buf = [0u8; 16];
            let read =
                tokio::time::timeout(std::time::Duration::from_millis(300), client.read(&mut buf))
                    .await;
            if let Ok(Ok(n)) = read {
                assert_eq!(n, 0, "no bytes should be echoed after shutdown");
            }
        }
    }
}
