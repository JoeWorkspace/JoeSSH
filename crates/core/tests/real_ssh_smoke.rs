use std::net::SocketAddr;
use std::time::Duration;

use atlasterm_core::{probe_host_key, HostKeyPolicy, PtyOutput, SshAuth, SshClient, SshConfig};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn real_ssh_smoke_covers_exec_pty_sftp_and_forwarding() {
    let Some(fixture) = RealSshFixture::from_env() else {
        eprintln!("skipping real SSH smoke; set JOESSH_REAL_SSH_SMOKE=1 to enable");
        return;
    };

    let fingerprint = probe_host_key(&fixture.host, fixture.port, 10_000)
        .await
        .expect("host-key probe should complete against the live SSH server");
    assert!(
        fingerprint.starts_with("SHA256:"),
        "host-key probe should return an OpenSSH-style SHA256 fingerprint"
    );

    let client = SshClient::connect(SshConfig {
        host: fixture.host.clone(),
        port: fixture.port,
        username: fixture.username.clone(),
        auth: SshAuth::Password(fixture.password.clone()),
        host_key_policy: HostKeyPolicy::Pinned(fingerprint.clone()),
        connect_timeout_ms: 10_000,
    })
    .await
    .expect("real SSH client should connect with pinned host-key trust");

    assert_eq!(
        client.server_fingerprint(),
        Some(fingerprint.as_str()),
        "authenticated session should capture the same host-key fingerprint"
    );

    verify_exec(&client).await;
    verify_sftp(&client, &fixture.remote_dir).await;
    verify_pty(&client).await;
    verify_forwarding(&client).await;
}

async fn verify_exec(client: &SshClient) {
    let (exit_status, stdout) = client
        .exec("printf 'joessh-exec-ok'")
        .await
        .expect("exec should run through the real SSH session");

    assert_eq!(exit_status, 0);
    assert_eq!(stdout, b"joessh-exec-ok");
}

async fn verify_sftp(client: &SshClient, remote_dir: &str) {
    let sftp = client
        .open_sftp()
        .await
        .expect("SFTP subsystem should open over the authenticated SSH session");

    let marker = "joessh-sftp-smoke.txt";
    let remote_path = format!("{}/{}", remote_dir.trim_end_matches('/'), marker);

    sftp.upload(&remote_path, b"first")
        .await
        .expect("SFTP upload should create the smoke file");
    let first_download = sftp
        .download_limited(&remote_path, 1024)
        .await
        .expect("SFTP download should read the uploaded smoke file");
    assert_eq!(first_download, b"first");

    sftp.upload(&remote_path, b"overwrite")
        .await
        .expect("SFTP upload should overwrite the smoke file");
    let overwritten = sftp
        .download_limited(&remote_path, 1024)
        .await
        .expect("SFTP download should read the overwritten smoke file");
    assert_eq!(overwritten, b"overwrite");

    let entries = sftp
        .list_dir(remote_dir)
        .await
        .expect("SFTP list should include the smoke file");
    assert!(
        entries
            .iter()
            .any(|entry| entry.name == marker && !entry.is_dir),
        "SFTP list should include the uploaded smoke file"
    );
}

async fn verify_pty(client: &SshClient) {
    let session = client
        .open_shell(80, 24)
        .await
        .expect("PTY shell should open over the authenticated SSH session");
    let (writer, mut reader) = session.split();
    writer
        .write(b"printf 'joessh-pty-ok'\nexit\n")
        .await
        .expect("PTY should accept input");

    let mut output = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(10);

    loop {
        let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
        if remaining.is_zero() {
            break;
        }

        match tokio::time::timeout(remaining, reader.next_output()).await {
            Ok(Some(PtyOutput::Data(chunk))) => {
                output.extend_from_slice(&chunk);
                if output
                    .windows(b"joessh-pty-ok".len())
                    .any(|window| window == b"joessh-pty-ok")
                {
                    writer.close().await.ok();
                    return;
                }
            }
            Ok(Some(PtyOutput::Exit(_))) | Ok(None) => break,
            Err(_) => break,
        }
    }

    panic!(
        "PTY output did not contain marker; captured output: {}",
        String::from_utf8_lossy(&output)
    );
}

async fn verify_forwarding(client: &SshClient) {
    let echo_addr = spawn_echo_server().await;
    let mut forward = client
        .forward_local("127.0.0.1:0", "127.0.0.1".to_string(), echo_addr.port())
        .await
        .expect("local SSH forward should bind an ephemeral loopback port");

    let mut socket = TcpStream::connect(forward.bound_addr())
        .await
        .expect("client should connect to the local forwarded port");
    socket
        .write_all(b"joessh-forward-ok")
        .await
        .expect("client should write through the forwarded socket");
    socket.flush().await.expect("forwarded socket should flush");

    let mut buf = vec![0; b"joessh-forward-ok".len()];
    socket
        .read_exact(&mut buf)
        .await
        .expect("client should read echo bytes through the SSH direct-tcpip tunnel");
    assert_eq!(buf, b"joessh-forward-ok");
    assert_eq!(forward.accepted_count(), 1);
    forward.shutdown();
}

async fn spawn_echo_server() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("echo server should bind");
    let addr = listener
        .local_addr()
        .expect("echo server should have address");

    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                break;
            };
            tokio::spawn(async move {
                let mut buf = [0_u8; 1024];
                loop {
                    match socket.read(&mut buf).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            if socket.write_all(&buf[..n]).await.is_err() {
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

struct RealSshFixture {
    host: String,
    port: u16,
    username: String,
    password: String,
    remote_dir: String,
}

impl RealSshFixture {
    fn from_env() -> Option<Self> {
        if std::env::var("JOESSH_REAL_SSH_SMOKE").ok().as_deref() != Some("1") {
            return None;
        }

        Some(Self {
            host: required_env("JOESSH_REAL_SSH_HOST"),
            port: required_env("JOESSH_REAL_SSH_PORT")
                .parse()
                .expect("JOESSH_REAL_SSH_PORT must be a u16"),
            username: required_env("JOESSH_REAL_SSH_USERNAME"),
            password: required_env("JOESSH_REAL_SSH_PASSWORD"),
            remote_dir: required_env("JOESSH_REAL_SSH_REMOTE_DIR"),
        })
    }
}

fn required_env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} must be set for real SSH smoke"))
}
