/// Pulls complete `Content-Length`-framed JSON-RPC messages out of `buf`,
/// LSP's wire format (HTTP-style headers, blank line, then exactly
/// `Content-Length` body bytes — not newline-delimited JSON). Leaves any
/// trailing partial message in `buf` for the next read.
fn extract_messages(buf: &mut Vec<u8>) -> Vec<String> {
    let mut messages = Vec::new();
    loop {
        let header_end = match find_subslice(buf, b"\r\n\r\n") {
            Some(pos) => pos,
            None => break,
        };

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
        let body_end = body_start + content_length;
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
}
