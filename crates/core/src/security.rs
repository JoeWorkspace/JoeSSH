use std::borrow::Cow;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DangerousCommandMatch {
    pub pattern: &'static str,
    pub reason: &'static str,
    pub action: DangerousCommandAction,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DangerousCommandAction {
    Warn,
    Block,
}

const DANGEROUS_PATTERNS: &[(&str, &str, DangerousCommandAction)] = &[
    (
        "rm -rf /",
        "recursively removes the filesystem root",
        DangerousCommandAction::Block,
    ),
    (
        "mkfs",
        "formats a filesystem",
        DangerousCommandAction::Block,
    ),
    (":(){:|:&};:", "fork bomb", DangerousCommandAction::Block),
    (
        "dd if=",
        "raw disk copy can destroy data",
        DangerousCommandAction::Block,
    ),
    (
        "> /dev/sd",
        "writes directly to a block device",
        DangerousCommandAction::Block,
    ),
    (
        "chmod -R 777 /",
        "opens permissions broadly from filesystem root",
        DangerousCommandAction::Block,
    ),
    (
        "chown -R",
        "recursively changes ownership",
        DangerousCommandAction::Warn,
    ),
    (
        "curl ",
        "downloads and runs remote content; review before executing",
        DangerousCommandAction::Warn,
    ),
    (
        "wget ",
        "downloads and runs remote content; review before executing",
        DangerousCommandAction::Warn,
    ),
];

const SENSITIVE_KEYS: &[&str] = &[
    "password",
    "passwd",
    "passphrase",
    "secret",
    "token",
    "api_key",
    "apikey",
    "private_key",
    "authorization",
];

pub fn detect_dangerous_command(command: &str) -> Option<DangerousCommandMatch> {
    let lower = normalize_command_for_detection(command);

    if matches_rm_root(&lower) {
        return Some(command_match(
            "rm -rf /",
            "recursively removes the filesystem root",
            DangerousCommandAction::Block,
        ));
    }

    if matches_fork_bomb(&lower) {
        return Some(command_match(
            ":(){:|:&};:",
            "fork bomb",
            DangerousCommandAction::Block,
        ));
    }

    if matches_block_device_redirect(&lower) {
        return Some(command_match(
            "> /dev/sd",
            "writes directly to a block device",
            DangerousCommandAction::Block,
        ));
    }

    if matches_tee_block_device(&lower) {
        return Some(command_match(
            "tee /dev/sd*",
            "writes directly to a block device",
            DangerousCommandAction::Block,
        ));
    }

    if matches_chmod_root(&lower) {
        return Some(command_match(
            "chmod -R 777 /",
            "opens permissions broadly from filesystem root",
            DangerousCommandAction::Block,
        ));
    }

    if matches_find_root_delete(&lower) {
        return Some(command_match(
            "find / -delete",
            "deletes from a filesystem root path",
            DangerousCommandAction::Block,
        ));
    }

    if matches_disk_wipe(&lower) {
        return Some(command_match(
            "disk wipe",
            "destructive disk or partition operation",
            DangerousCommandAction::Block,
        ));
    }

    if matches_firewall_flush(&lower) {
        return Some(command_match(
            "iptables -F",
            "flushes host firewall rules",
            DangerousCommandAction::Block,
        ));
    }

    if matches_remote_shell_pipe(&lower) {
        return Some(command_match(
            "curl|sh",
            "pipes downloaded content into a shell",
            DangerousCommandAction::Block,
        ));
    }

    if matches_root_download_overwrite(&lower) {
        return Some(command_match(
            "wget -O /",
            "overwrites a protected root path with remote content",
            DangerousCommandAction::Block,
        ));
    }

    if matches_shutdown(&lower) {
        return Some(command_match(
            "shutdown",
            "powers off or reboots the remote host",
            DangerousCommandAction::Block,
        ));
    }

    if matches_windows_destructive(&lower) {
        return Some(command_match(
            "windows destructive",
            "destructive Windows filesystem or disk command",
            DangerousCommandAction::Block,
        ));
    }

    if matches_powershell_destructive(&lower) {
        return Some(command_match(
            "powershell destructive",
            "destructive PowerShell filesystem or disk command",
            DangerousCommandAction::Block,
        ));
    }

    if lower.contains("drop database") {
        return Some(command_match(
            "drop database",
            "drops a database",
            DangerousCommandAction::Block,
        ));
    }

    if matches_command_substitution(&lower) {
        return Some(command_match(
            "command substitution",
            "uses command substitution that can hide execution",
            DangerousCommandAction::Block,
        ));
    }

    if matches_shell_variable_expansion(&lower) {
        return Some(command_match(
            "shell variable expansion",
            "uses shell variable expansion that can hide execution",
            DangerousCommandAction::Block,
        ));
    }

    DANGEROUS_PATTERNS
        .iter()
        .filter(|(pattern, _, _)| lower.contains(&pattern.to_ascii_lowercase()))
        .max_by_key(|(_, _, action)| match action {
            DangerousCommandAction::Warn => 0,
            DangerousCommandAction::Block => 1,
        })
        .map(|(pattern, reason, action)| DangerousCommandMatch {
            pattern,
            reason,
            action: *action,
        })
}

fn command_match(
    pattern: &'static str,
    reason: &'static str,
    action: DangerousCommandAction,
) -> DangerousCommandMatch {
    DangerousCommandMatch {
        pattern,
        reason,
        action,
    }
}

fn normalize_command_for_detection(command: &str) -> String {
    let lower = command.to_ascii_lowercase();
    let collapsed = lower.split_whitespace().collect::<Vec<_>>().join(" ");
    let expanded = expand_simple_shell_assignments(&collapsed)
        .replace("${ifs}", " ")
        .replace("$ifs", " ");

    expanded.replace(['"', '\''], "")
}

fn expand_simple_shell_assignments(command: &str) -> String {
    let mut assignments = Vec::new();

    // Keep this deliberately small and shell-oriented. Splitting only on
    // whitespace misses assignments immediately before a command separator
    // (`r=rm; $r -rf /`), while accepting the separator as part of the value
    // prevents the expanded command from being tokenized correctly.
    let bytes = command.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        while index < bytes.len() && bytes[index].is_ascii_whitespace() {
            index += 1;
        }
        if index >= bytes.len() {
            break;
        }

        let name_start = index;
        while index < bytes.len()
            && (bytes[index] == b'_' || bytes[index].is_ascii_alphanumeric())
        {
            index += 1;
        }
        if index == name_start || index >= bytes.len() || bytes[index] != b'=' {
            while index < bytes.len() && !matches!(bytes[index], b';' | b'&' | b'|') {
                index += 1;
            }
            index += usize::from(index < bytes.len());
            continue;
        }

        let name = &command[name_start..index];
        if !is_shell_identifier(name) {
            index += 1;
            continue;
        }
        index += 1;
        let value_start = index;
        let value_end;
        if let Some(quote @ (b'\'' | b'"')) = bytes.get(index).copied() {
            index += 1;
            let quoted_start = index;
            while index < bytes.len() && bytes[index] != quote {
                index += 1;
            }
            value_end = index;
            if index < bytes.len() {
                index += 1;
            }
            if value_end > quoted_start {
                assignments.push((name.to_string(), command[quoted_start..value_end].to_string()));
            }
        } else {
            while index < bytes.len()
                && !bytes[index].is_ascii_whitespace()
                && !matches!(bytes[index], b';' | b'&' | b'|')
            {
                index += 1;
            }
            value_end = index;
            if value_end > value_start {
                assignments.push((name.to_string(), command[value_start..value_end].to_string()));
            }
        }
    }

    if assignments.is_empty() {
        return command.to_string();
    }

    let mut expanded = command.to_string();
    for (name, value) in assignments {
        expanded = expanded.replace(&format!("${{{name}}}"), &value);
        expanded = expanded.replace(&format!("${name}"), &value);
    }

    expanded
}

fn is_shell_identifier(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    (first == '_' || first.is_ascii_alphabetic())
        && chars.all(|ch| ch == '_' || ch.is_ascii_alphanumeric())
}

fn matches_rm_root(command: &str) -> bool {
    let tokens = command.split_whitespace().collect::<Vec<_>>();

    for (index, token) in tokens.iter().enumerate() {
        let executable = token.rsplit('/').next().unwrap_or(token);
        if executable != "rm" {
            continue;
        }

        let mut recursive = false;
        let mut force = false;
        let mut options_done = false;

        for argument in tokens.iter().skip(index + 1) {
            if !options_done && *argument == "--" {
                options_done = true;
                continue;
            }

            if !options_done && argument.starts_with("--") {
                match *argument {
                    "--recursive" => recursive = true,
                    "--force" => force = true,
                    // `--no-preserve-root` is not itself required for rm to
                    // target `/`, but it is a strong signal that the root is
                    // intentional. Keep scanning for the actual flags/path.
                    "--no-preserve-root" => {}
                    _ => {}
                }
                continue;
            }

            if !options_done && argument.starts_with('-') && argument.len() > 1 {
                for flag in argument.chars().skip(1) {
                    if flag == 'r' {
                        recursive = true;
                    } else if flag == 'f' {
                        force = true;
                    }
                }
                continue;
            }

            options_done = true;
            if recursive && force && is_root_rm_target(argument) {
                return true;
            }
        }
    }

    false
}

fn matches_fork_bomb(command: &str) -> bool {
    command
        .chars()
        .filter(|ch| !ch.is_whitespace())
        .collect::<String>()
        .contains(":(){:|:&};:")
}

fn matches_block_device_redirect(command: &str) -> bool {
    command.contains('>') && contains_block_device_path(command)
}

fn matches_tee_block_device(command: &str) -> bool {
    command.contains("tee ") && contains_block_device_path(command)
}

fn matches_chmod_root(command: &str) -> bool {
    command.contains("chmod 777 /")
        || command.contains("chmod -r 777 /")
        || command.contains("chmod --recursive 777 /")
        || command.contains("chmod 777 -r /")
        || command.contains("chmod 777 --recursive /")
}

fn matches_find_root_delete(command: &str) -> bool {
    command.contains("find /") && (command.contains(" -delete") || command.contains(" -exec rm"))
}

fn matches_disk_wipe(command: &str) -> bool {
    ((command.contains("wipefs ")
        || command.contains("blkdiscard ")
        || command.contains("shred ")
        || command.contains("parted "))
        && contains_block_device_path(command))
        || command.contains("sgdisk --zap-all")
        || command.contains("sgdisk -z")
}

fn matches_firewall_flush(command: &str) -> bool {
    command.contains("iptables -f")
        || command.contains("iptables --flush")
        || command.contains("ip6tables -f")
        || command.contains("ip6tables --flush")
        || command.contains("nft flush")
        || command.contains("nftables flush")
}

fn matches_remote_shell_pipe(command: &str) -> bool {
    (command.contains("curl ") || command.contains("wget ") || command.contains("base64 "))
        && (command.contains("| sh")
            || command.contains("| bash")
            || command.contains("| zsh")
            || command.contains("| dash")
            || command.contains("| ksh")
            || command.contains("| sudo sh")
            || command.contains("| sudo bash"))
}

fn matches_root_download_overwrite(command: &str) -> bool {
    (command.contains("wget ") || command.contains("curl "))
        && (command.contains(" -o /etc")
            || command.contains(" -o /bin")
            || command.contains(" -o /sbin")
            || command.contains(" -o /usr")
            || command.contains(" -o /boot")
            || command.contains(" -o /dev")
            || command.contains(" -o /proc")
            || command.contains(" -o /sys")
            || command.contains(" -o /var")
            || command.contains(" -o /lib")
            || command.contains(" --output /etc")
            || command.contains(" --output-document /etc")
            || command.contains(" --output-document=/etc"))
}

fn matches_shutdown(command: &str) -> bool {
    command.contains("shutdown now")
        || command.contains(" shutdown ")
        || command.starts_with("shutdown ")
        || command.contains(" reboot")
        || command.starts_with("reboot")
        || command.contains(" poweroff")
        || command.starts_with("poweroff")
        || command.contains(" halt")
        || command.starts_with("halt")
}

fn matches_windows_destructive(command: &str) -> bool {
    command.contains("format c:")
        || command.contains("diskpart")
        || command.contains("cipher /w:c:")
        || ((command.contains("del ") || command.contains("rd ") || command.contains("rmdir "))
            && (command.contains("c:\\windows")
                || command.contains("c:\\program files")
                || command.contains("%systemroot%")
                || command.contains("%windir%")
                || command.contains("\\\\")))
}

fn matches_powershell_destructive(command: &str) -> bool {
    command.contains("clear-disk")
        || command.contains("format-volume")
        || command.contains("initialize-disk")
        || command.contains("remove-partition")
        || command.contains("stop-computer")
        || command.contains("restart-computer")
        || ((command.contains("remove-item")
            || command.contains(" rm ")
            || command.contains(" rmdir "))
            && (command.contains("-recurse") || command.contains(" -r "))
            && (command.contains("c:\\windows")
                || command.contains("c:\\program files")
                || command.contains("c:\\programdata")
                || command.contains("c:\\users")
                || command.contains("\\\\")))
}

fn matches_command_substitution(command: &str) -> bool {
    command.contains("$(") || command.contains('`')
}

fn matches_shell_variable_expansion(command: &str) -> bool {
    let bytes = command.as_bytes();
    let mut index = 0;
    while index + 1 < bytes.len() {
        if bytes[index] != b'$' {
            index += 1;
            continue;
        }

        match bytes[index + 1] {
            b'{' => {
                if let Some(next) = bytes.get(index + 2) {
                    if next.is_ascii_alphabetic() || *next == b'_' {
                        return true;
                    }
                }
            }
            next if next.is_ascii_alphabetic() || next == b'_' => return true,
            _ => {}
        }
        index += 1;
    }
    false
}

fn is_root_rm_target(argument: &str) -> bool {
    let target = argument.trim_end_matches(|ch| matches!(ch, ';' | '&' | '|' | '>'));
    let canonical = target.trim_end_matches('/');
    let canonical = if canonical.is_empty() { "/" } else { canonical };
    canonical == "/"
        || canonical == "/."
        || canonical == "/.."
        || canonical.starts_with("/*")
        || canonical.starts_with("//")
}

fn contains_block_device_path(command: &str) -> bool {
    command.contains("/dev/sd")
        || command.contains("/dev/nvme")
        || command.contains("/dev/hd")
        || command.contains("/dev/vd")
        || command.contains("/dev/mmcblk")
}

pub fn is_dangerous_command(command: &str) -> bool {
    detect_dangerous_command(command).is_some()
}

pub fn redact_log(input: &str) -> String {
    let tokens = input.split_whitespace().collect::<Vec<_>>();
    let mut redacted = Vec::with_capacity(tokens.len());
    let mut index = 0;

    while index < tokens.len() {
        let token = tokens[index];
        if let Some(option) = credential_option(token, &tokens, index) {
            match option {
                CredentialOption::Attached { prefix } => {
                    redacted.push(format!("{prefix}<redacted>"));
                }
                CredentialOption::Next {
                    consume_option_like,
                } => {
                    redacted.push(token.to_string());
                    if let Some(next) = tokens.get(index + 1) {
                        if consume_option_like || !looks_like_option(next) {
                            redacted.push("<redacted>".to_string());
                            index += 1;
                        }
                    }
                }
            }
        } else {
            redacted.push(redact_token(token).into_owned());
        }
        index += 1;
    }

    redacted.join(" ")
}

enum CredentialOption {
    Next { consume_option_like: bool },
    Attached { prefix: String },
}

fn credential_option(token: &str, tokens: &[&str], index: usize) -> Option<CredentialOption> {
    let normalized = trim_matching_quotes(token);
    if normalized.is_empty() {
        return None;
    }

    if normalized.eq_ignore_ascii_case("--password") {
        return Some(CredentialOption::Next {
            consume_option_like: true,
        });
    }
    if let Some((key, _)) = normalized.split_once('=') {
        if key.eq_ignore_ascii_case("--password") {
            return Some(CredentialOption::Attached {
                prefix: format!("{key}="),
            });
        }
    }

    if has_command_before(tokens, index, &["sshpass"]) {
        if normalized == "-p" {
            return Some(CredentialOption::Next {
                consume_option_like: true,
            });
        }
        if normalized.starts_with("-p") && normalized.len() > 2 {
            return Some(CredentialOption::Attached {
                prefix: "-p".to_string(),
            });
        }
    }

    if has_command_before(tokens, index, &["mysql", "mariadb"]) {
        if normalized == "-p" {
            return Some(CredentialOption::Next {
                consume_option_like: false,
            });
        }
        if normalized.starts_with("-p") && normalized.len() > 2 {
            return Some(CredentialOption::Attached {
                prefix: "-p".to_string(),
            });
        }
    }

    if has_command_before(tokens, index, &["curl", "wget"]) {
        if normalized == "-u" || normalized.eq_ignore_ascii_case("--user") {
            return Some(CredentialOption::Next {
                consume_option_like: true,
            });
        }
        if let Some((key, _)) = normalized.split_once('=') {
            if key.eq_ignore_ascii_case("--user") {
                return Some(CredentialOption::Attached {
                    prefix: format!("{key}="),
                });
            }
        }
        if normalized.starts_with("-u") && normalized.len() > 2 {
            return Some(CredentialOption::Attached {
                prefix: "-u".to_string(),
            });
        }
    }

    None
}

fn has_command_before(tokens: &[&str], index: usize, names: &[&str]) -> bool {
    tokens[..index].iter().any(|token| {
        let normalized = trim_matching_quotes(token);
        if normalized.is_empty() || normalized.contains('=') || looks_like_option(&normalized) {
            return false;
        }
        let command_name = normalized.rsplit('/').next().unwrap_or(normalized);
        names
            .iter()
            .any(|name| command_name.eq_ignore_ascii_case(name))
    })
}

fn trim_matching_quotes(token: &str) -> &str {
    let bytes = token.as_bytes();
    if bytes.len() >= 2
        && (bytes[0] == b'\'' || bytes[0] == b'"')
        && bytes[bytes.len() - 1] == bytes[0]
    {
        &token[1..token.len() - 1]
    } else {
        token
    }
}

fn looks_like_option(token: &str) -> bool {
    let bytes = token.as_bytes();
    bytes.len() > 1 && bytes[0] == b'-' && bytes[1].is_ascii_alphanumeric()
}

fn redact_token(token: &str) -> Cow<'_, str> {
    if let Some((key, value)) = token.split_once('=') {
        if !value.is_empty() && is_sensitive_key(key) {
            return Cow::Owned(format!("{key}=<redacted>"));
        }
    }

    if token.to_ascii_lowercase().starts_with("bearer ") {
        return Cow::Borrowed("Bearer <redacted>");
    }

    Cow::Borrowed(token)
}

fn is_sensitive_key(key: &str) -> bool {
    let normalized = key
        .trim_matches(|c: char| !c.is_ascii_alphanumeric() && c != '_')
        .to_ascii_lowercase();
    SENSITIVE_KEYS
        .iter()
        .any(|sensitive| normalized.contains(sensitive))
}
