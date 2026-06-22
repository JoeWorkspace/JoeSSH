use std::collections::BTreeMap;
use thiserror::Error;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenSshConfig {
    pub hosts: Vec<HostBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostBlock {
    pub patterns: Vec<String>,
    pub options: BTreeMap<String, String>,
}

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum OpenSshConfigError {
    #[error("option appears before any Host block at line {0}")]
    OptionBeforeHost(usize),
    #[error("invalid directive at line {0}")]
    InvalidDirective(usize),
}

pub fn parse_openssh_config(input: &str) -> Result<OpenSshConfig, OpenSshConfigError> {
    let mut hosts = Vec::<HostBlock>::new();
    let mut current: Option<HostBlock> = None;

    for (index, raw_line) in input.lines().enumerate() {
        let line_number = index + 1;
        let line = strip_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }

        let (key, value) =
            split_directive(line).ok_or(OpenSshConfigError::InvalidDirective(line_number))?;

        if key.eq_ignore_ascii_case("Host") {
            if let Some(block) = current.take() {
                hosts.push(block);
            }
            let patterns = value.split_whitespace().map(str::to_string).collect();
            current = Some(HostBlock {
                patterns,
                options: BTreeMap::new(),
            });
        } else {
            let block = current
                .as_mut()
                .ok_or(OpenSshConfigError::OptionBeforeHost(line_number))?;
            block
                .options
                .insert(key.to_ascii_lowercase(), value.to_string());
        }
    }

    if let Some(block) = current {
        hosts.push(block);
    }

    Ok(OpenSshConfig { hosts })
}

fn strip_comment(line: &str) -> &str {
    line.split_once('#').map_or(line, |(before, _)| before)
}

fn split_directive(line: &str) -> Option<(&str, &str)> {
    if let Some(index) = line.find(char::is_whitespace) {
        let (key, value) = line.split_at(index);
        let value = value.trim();
        if !key.is_empty() && !value.is_empty() {
            return Some((key, value));
        }
    }
    None
}
