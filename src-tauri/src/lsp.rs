use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
pub struct LspMessagePayload {
    pub root: String,
    pub message: String,
}

#[derive(Clone, Serialize)]
pub struct LspExitPayload {
    pub root: String,
}

pub struct LspManager {
    sessions: Mutex<HashMap<String, LspSession>>,
    app: AppHandle,
}

struct LspSession {
    writer: Arc<Mutex<ChildStdin>>,
    child: Child,
}

impl LspManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            app,
        }
    }

    pub fn spawn(&self, root: String) -> Result<(), Box<dyn std::error::Error>> {
        // Idempotent: a second spawn for the same root would overwrite the
        // HashMap entry, dropping the previous LspSession (and its Child)
        // without killing or waiting on it — silently orphaning a live
        // server process. The frontend's session cache already prevents
        // this in practice, but lsp_spawn is directly invokable.
        if self.sessions.lock().unwrap().contains_key(&root) {
            return Ok(());
        }

        let mut child = Command::new("typescript-language-server")
            .arg("--stdio")
            .current_dir(&root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()?;

        let writer = child.stdin.take().ok_or("no stdin on lsp child")?;
        let mut reader = child.stdout.take().ok_or("no stdout on lsp child")?;

        let session = LspSession {
            writer: Arc::new(Mutex::new(writer)),
            child,
        };

        let root_for_reader = root.clone();
        self.sessions.lock().unwrap().insert(root, session);

        let app = self.app.clone();
        std::thread::spawn(move || {
            let mut pending: Vec<u8> = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match reader.read(&mut chunk) {
                    Ok(0) => {
                        let _ = app.emit(
                            "lsp-exit",
                            LspExitPayload {
                                root: root_for_reader,
                            },
                        );
                        break;
                    }
                    Ok(n) => {
                        pending.extend_from_slice(&chunk[..n]);
                        for message in extract_messages(&mut pending) {
                            let _ = app.emit(
                                "lsp-message",
                                LspMessagePayload {
                                    root: root_for_reader.clone(),
                                    message,
                                },
                            );
                        }
                    }
                    Err(_) => {
                        let _ = app.emit(
                            "lsp-exit",
                            LspExitPayload {
                                root: root_for_reader,
                            },
                        );
                        break;
                    }
                }
            }
        });

        Ok(())
    }

    pub fn send(&self, root: &str, message: &str) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(session) = self.sessions.lock().unwrap().get(root) {
            let mut writer = session.writer.lock().unwrap();
            let framed = format!("Content-Length: {}\r\n\r\n{}", message.len(), message);
            writer.write_all(framed.as_bytes())?;
            writer.flush()?;
        }
        Ok(())
    }

    pub fn kill(&self, root: &str) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(mut session) = self.sessions.lock().unwrap().remove(root) {
            session.child.kill()?;
        }
        Ok(())
    }
}

/// Pulls complete `Content-Length`-framed JSON-RPC messages out of `buf`,
/// LSP's wire format (HTTP-style headers, blank line, then exactly
/// `Content-Length` body bytes — not newline-delimited JSON). Leaves any
/// trailing partial message in `buf` for the next read.
fn extract_messages(buf: &mut Vec<u8>) -> Vec<String> {
    /// Generous upper bound for any real LSP message — past this, a
    /// Content-Length is treated as garbage rather than buffered.
    const MAX_MESSAGE_LEN: usize = 64 * 1024 * 1024; // 64 MiB

    let mut messages = Vec::new();
    while let Some(header_end) = find_subslice(buf, b"\r\n\r\n") {
        let content_length = std::str::from_utf8(&buf[..header_end])
            .ok()
            .and_then(|headers| {
                headers
                    .split("\r\n")
                    .find_map(|line| line.strip_prefix("Content-Length:"))
            })
            .and_then(|value| value.trim().parse::<usize>().ok());

        let content_length = match content_length {
            Some(n) => n,
            None => {
                // No usable Content-Length in this header block — drop it
                // and keep scanning, rather than looping on the same bytes.
                buf.drain(..header_end + 4);
                continue;
            }
        };

        let body_start = header_end + 4;
        let body_end = match body_start.checked_add(content_length) {
            Some(end) if content_length <= MAX_MESSAGE_LEN => end,
            _ => {
                // A bogus Content-Length (overflowing usize, or merely
                // absurd enough to buffer unboundedly) would otherwise
                // panic this reader thread — on the addition in debug, or
                // on an inverted slice range after a release-mode wrap —
                // which kills the thread before it can emit `lsp-exit`,
                // leaving the frontend hung on a session it thinks is
                // alive. Drop the header block and keep scanning, the same
                // recovery as the "no Content-Length" branch above.
                buf.drain(..header_end + 4);
                continue;
            }
        };
        if buf.len() < body_end {
            break; // Body not fully received yet.
        }

        if let Ok(text) = String::from_utf8(buf[body_start..body_end].to_vec()) {
            messages.push(text);
        }
        buf.drain(..body_end);
    }
    messages
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_a_single_complete_message() {
        let mut buf = b"Content-Length: 13\r\n\r\n{\"foo\":\"bar\"}".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{\"foo\":\"bar\"}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn leaves_a_partial_message_in_the_buffer() {
        let mut buf = b"Content-Length: 13\r\n\r\n{\"foo\":".to_vec();
        let messages = extract_messages(&mut buf);
        assert!(messages.is_empty());
        assert_eq!(buf, b"Content-Length: 13\r\n\r\n{\"foo\":".to_vec());
    }

    #[test]
    fn extracts_a_message_split_across_two_reads() {
        let mut buf = b"Content-Length: 13\r\n\r\n{\"foo\":".to_vec();
        assert!(extract_messages(&mut buf).is_empty());
        buf.extend_from_slice(b"\"bar\"}");
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{\"foo\":\"bar\"}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn extracts_multiple_messages_in_one_buffer() {
        let mut buf = b"Content-Length: 2\r\n\r\n{}Content-Length: 2\r\n\r\n[]".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{}".to_string(), "[]".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn ignores_extra_headers_before_the_blank_line() {
        let mut buf =
            b"Content-Type: application/vscode-jsonrpc\r\nContent-Length: 2\r\n\r\n{}".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn drops_a_header_with_no_content_length_rather_than_looping_forever() {
        let mut buf = b"Bogus-Header: nope\r\n\r\nContent-Length: 2\r\n\r\n{}".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn drops_a_frame_with_an_overflowing_content_length_instead_of_panicking() {
        let mut buf =
            b"Content-Length: 18446744073709551615\r\n\r\nContent-Length: 2\r\n\r\n{}".to_vec();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{}".to_string()]);
        assert!(buf.is_empty());
    }

    #[test]
    fn drops_a_frame_whose_content_length_exceeds_the_sanity_cap() {
        let mut buf = format!(
            "Content-Length: {}\r\n\r\nContent-Length: 2\r\n\r\n{{}}",
            64 * 1024 * 1024 + 1
        )
        .into_bytes();
        let messages = extract_messages(&mut buf);
        assert_eq!(messages, vec!["{}".to_string()]);
        assert!(buf.is_empty());
    }
}
