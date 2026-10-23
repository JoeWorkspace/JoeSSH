//! Best-effort preflight for explicit text sent to an interactive terminal.
//!
//! A PTY byte stream cannot reveal the command produced by remote history,
//! completion, shell expansion, or a full-screen application. Preserve those
//! controls instead of rejecting normal terminal use. Reconstruct common local
//! line edits and inspect the text we have actually received before submission;
//! this is an accident-prevention aid, not a remote authorization boundary.

use super::{detect_dangerous_command, DangerousCommandAction};

const PTY_COMMAND_BLOCKED: &str = "pty input blocked by desktop safety policy";
const PTY_COMMAND_BUFFER_MAX_BYTES: usize = 16 * 1024;
const ESCAPE_SEQUENCE_MAX_BYTES: usize = 16;

#[derive(Default)]
pub(super) struct PtyInputState {
    command: Vec<u8>,
    cursor: usize,
    escape_sequence: Vec<u8>,
}

impl PtyInputState {
    fn clear_line(&mut self) {
        self.command.clear();
        self.cursor = 0;
    }

    fn previous_character(&self) -> usize {
        let mut cursor = self.cursor.saturating_sub(1);
        while cursor > 0 && self.command[cursor] & 0xc0 == 0x80 {
            cursor -= 1;
        }
        cursor
    }

    fn next_character(&self) -> usize {
        let mut cursor = (self.cursor + 1).min(self.command.len());
        while cursor < self.command.len() && self.command[cursor] & 0xc0 == 0x80 {
            cursor += 1;
        }
        cursor
    }

    fn backspace(&mut self) {
        let previous = self.previous_character();
        self.command.drain(previous..self.cursor);
        self.cursor = previous;
    }

    fn delete(&mut self) {
        let next = self.next_character();
        self.command.drain(self.cursor..next);
    }

    fn apply_escape_edit(&mut self) {
        match self.escape_sequence.as_slice() {
            b"\x1b[H" | b"\x1bOH" | b"\x1b[1~" | b"\x1b[7~" => self.cursor = 0,
            b"\x1b[F" | b"\x1bOF" | b"\x1b[4~" | b"\x1b[8~" => {
                self.cursor = self.command.len();
            }
            b"\x1b[3~" => self.delete(),
            sequence => {
                if let Some((direction, count)) = horizontal_cursor_movement(sequence) {
                    for _ in 0..count {
                        self.cursor = match direction {
                            b'D' => self.previous_character(),
                            _ => self.next_character(),
                        };
                    }
                }
                // History, completion and other remote edits are opaque. Keep
                // inspecting subsequent explicit text, and let the server
                // interpret the original bytes; do not clear or skip the line.
            }
        }
    }
}

pub(super) fn apply_pty_input_safety(input: &mut PtyInputState, data: &[u8]) -> Result<(), String> {
    for byte in data {
        if !input.escape_sequence.is_empty() {
            // A partial/unknown escape must never consume a submission or
            // cancellation and hide the explicit text accumulated before it.
            if matches!(*byte, b'\r' | b'\n' | 0x03) {
                input.escape_sequence.clear();
            } else {
                input.escape_sequence.push(*byte);
                if escape_sequence_complete(&input.escape_sequence) {
                    input.apply_escape_edit();
                    input.escape_sequence.clear();
                } else if input.escape_sequence.len() >= ESCAPE_SEQUENCE_MAX_BYTES {
                    input.escape_sequence.clear();
                }
                continue;
            }
        }

        match *byte {
            0x1b => input.escape_sequence.push(*byte),
            b'\r' | b'\n' => {
                let command = String::from_utf8_lossy(&input.command);
                let blocked = detect_dangerous_command(&command)
                    .filter(|detected| detected.action == DangerousCommandAction::Block);
                input.clear_line();
                if let Some(detected) = blocked {
                    return Err(format!("{PTY_COMMAND_BLOCKED}: {}", detected.pattern));
                }
            }
            0x03 => input.clear_line(),
            0x01 => input.cursor = 0,
            0x05 => input.cursor = input.command.len(),
            0x02 => input.cursor = input.previous_character(),
            0x06 => input.cursor = input.next_character(),
            0x04 => input.delete(),
            0x08 | 0x7f => input.backspace(),
            0x0b => input.command.truncate(input.cursor),
            0x15 => {
                input.command.drain(..input.cursor);
                input.cursor = 0;
            }
            0x17 => {
                while input.cursor > 0 && input.command[input.cursor - 1].is_ascii_whitespace() {
                    input.backspace();
                }
                while input.cursor > 0 && !input.command[input.cursor - 1].is_ascii_whitespace() {
                    input.backspace();
                }
            }
            // Tab may request remote completion. Retain a whitespace boundary
            // so literal tab-separated commands/pastes still get inspected.
            byte if byte.is_ascii_control() && byte != b'\t' => {}
            byte => {
                if input.command.len() == PTY_COMMAND_BUFFER_MAX_BYTES {
                    input.clear_line();
                    return Err(format!(
                        "{PTY_COMMAND_BLOCKED}: input line exceeds safety limit"
                    ));
                }
                input.command.insert(input.cursor, byte);
                input.cursor += 1;
            }
        }
    }

    Ok(())
}

fn horizontal_cursor_movement(sequence: &[u8]) -> Option<(u8, usize)> {
    let [0x1b, b'[' | b'O', rest @ ..] = sequence else {
        return None;
    };
    let (&direction @ (b'C' | b'D'), digits) = rest.split_last()? else {
        return None;
    };
    let count = if digits.is_empty() {
        1
    } else {
        std::str::from_utf8(digits).ok()?.parse::<usize>().ok()?
    };
    Some((direction, count.clamp(1, PTY_COMMAND_BUFFER_MAX_BYTES)))
}

fn escape_sequence_complete(sequence: &[u8]) -> bool {
    match sequence {
        [0x1b] => false,
        [0x1b, b'[' | b'O'] => false,
        [0x1b, b'[' | b'O', rest @ ..] => {
            rest.last().is_some_and(|byte| (0x40..=0x7e).contains(byte))
        }
        [0x1b, ..] => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_lines_and_history_controls_remain_usable() {
        for data in [
            b"whoami\r".as_slice(),
            b"\x1b[A\r",
            b"\x1b[A\x1b[B\r",
            b"echo ok\x1b[D\r",
            b"echo ok\t\r",
            b"\x12whoami\r", // reverse history search
        ] {
            let mut input = PtyInputState::default();
            apply_pty_input_safety(&mut input, data).unwrap();
            assert!(input.command.is_empty());
            assert_eq!(input.cursor, 0);
        }
    }

    #[test]
    fn cursor_edits_reconstruct_insert_delete_home_and_end() {
        let mut input = PtyInputState::default();
        apply_pty_input_safety(&mut input, b"echo ok\x1b[2DX\x1b[3~").unwrap();
        assert_eq!(input.command, b"echo Xk");
        apply_pty_input_safety(&mut input, b"\x1b[H#\x1b[F!\x7f").unwrap();
        assert_eq!(input.command, b"#echo Xk");
        apply_pty_input_safety(&mut input, b"\r").unwrap();
    }

    #[test]
    fn utf8_movement_backspace_and_delete_preserve_character_boundaries() {
        let mut input = PtyInputState::default();
        apply_pty_input_safety(&mut input, "echo 中😀文".as_bytes()).unwrap();
        apply_pty_input_safety(&mut input, b"\x1b[D\x7f").unwrap();
        assert_eq!(input.command, "echo 中文".as_bytes());
        apply_pty_input_safety(&mut input, b"\x1b[3~").unwrap();
        assert_eq!(input.command, "echo 中".as_bytes());
        apply_pty_input_safety(&mut input, b"\x02\x06\x7f").unwrap();
        assert_eq!(input.command, b"echo ");
        apply_pty_input_safety(&mut input, b"ok\r").unwrap();
    }

    #[test]
    fn utf8_bytes_split_across_calls_remain_editable() {
        let mut input = PtyInputState::default();
        for byte in "echo 中文".as_bytes() {
            apply_pty_input_safety(&mut input, &[*byte]).unwrap();
        }
        apply_pty_input_safety(&mut input, b"\x7f\r").unwrap();
    }

    #[test]
    fn readline_control_edits_preserve_unremoved_text() {
        let mut input = PtyInputState::default();
        apply_pty_input_safety(&mut input, b"echo discarded\x17ok\x01\x06\x15").unwrap();
        assert_eq!(input.command, b"cho ok");
        apply_pty_input_safety(&mut input, b"\x05\x02\x0b").unwrap();
        assert_eq!(input.command, b"cho o");
        apply_pty_input_safety(&mut input, b"\x03whoami\r").unwrap();
    }

    #[test]
    fn explicit_destructive_input_stays_blocked_across_chunks() {
        let mut input = PtyInputState::default();
        apply_pty_input_safety(&mut input, b"sudo rm -r").unwrap();
        let error = apply_pty_input_safety(&mut input, b"f /\n").unwrap_err();
        assert!(error.starts_with(PTY_COMMAND_BLOCKED));
        assert!(error.contains("rm -rf /"));
        assert!(input.command.is_empty());
        apply_pty_input_safety(&mut input, b"whoami\r").unwrap();
    }

    #[test]
    fn destructive_lines_and_bracketed_pastes_remain_blocked() {
        for data in [
            b"sudo rm -rf /\r".as_slice(),
            b"echo ok\nsudo rm -rf /\n",
            b"\x1b[200~sudo rm -rf /\x1b[201~\r",
            b"\x1b[200~echo ok\nsudo rm -rf /\n\x1b[201~\r",
            b"rm\t-rf\t/\r",
        ] {
            let mut input = PtyInputState::default();
            assert!(apply_pty_input_safety(&mut input, data).is_err());
        }
    }

    #[test]
    fn split_bracketed_paste_markers_keep_inspecting_text() {
        let mut input = PtyInputState::default();
        for chunk in [b"\x1b[2".as_slice(), b"00~sudo rm -rf /", b"\x1b[201", b"~"] {
            apply_pty_input_safety(&mut input, chunk).unwrap();
        }
        assert!(apply_pty_input_safety(&mut input, b"\r").is_err());
    }

    #[test]
    fn known_cursor_edits_cannot_hide_an_explicit_destructive_line() {
        let mut input = PtyInputState::default();
        apply_pty_input_safety(&mut input, b"sudo rm -f /\x1b[3Dr").unwrap();
        assert_eq!(input.command, b"sudo rm -rf /");
        assert!(apply_pty_input_safety(&mut input, b"\r").is_err());
    }

    #[test]
    fn clearing_a_dangerous_draft_from_home_allows_a_safe_replacement() {
        let mut input = PtyInputState::default();
        apply_pty_input_safety(&mut input, b"sudo rm -rf /").unwrap();
        apply_pty_input_safety(&mut input, b"\x1b[H\x0bwhoami\r").unwrap();
        assert!(input.command.is_empty());
        assert_eq!(input.cursor, 0);
    }

    #[test]
    fn unknown_controls_do_not_bypass_explicit_command_preflight() {
        for data in [
            b"\x1b[Asudo rm -rf /\r".as_slice(),
            b"sudo rm -rf /\x1b[A\r",
            b"\x1b[99~sudo rm -rf /\r",
            b"sudo rm -rf /\x1b[\r",
        ] {
            let mut input = PtyInputState::default();
            assert!(apply_pty_input_safety(&mut input, data).is_err());
        }
    }

    #[test]
    fn safe_bracketed_paste_remains_usable() {
        let mut input = PtyInputState::default();
        apply_pty_input_safety(&mut input, b"\x1b[200~whoami\nls\x1b[201~\r").unwrap();
        assert!(input.command.is_empty());
    }

    #[test]
    fn input_and_escape_state_stay_bounded_and_recover_after_rejection() {
        let mut input = PtyInputState::default();
        let error =
            apply_pty_input_safety(&mut input, &vec![b'a'; PTY_COMMAND_BUFFER_MAX_BYTES + 1])
                .unwrap_err();
        assert!(error.contains("input line exceeds safety limit"));
        assert!(input.command.is_empty());
        assert_eq!(input.cursor, 0);
        apply_pty_input_safety(&mut input, b"\x1b[111111111111111111111111\x03whoami\r").unwrap();
        assert!(input.escape_sequence.len() < ESCAPE_SEQUENCE_MAX_BYTES);
        assert!(input.command.is_empty());
    }
}
