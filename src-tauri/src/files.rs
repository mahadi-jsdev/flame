use std::fs;
use std::path::Path;

/// Above this, a plain `<textarea>` editor stops being usable — reject
/// early with a clear message instead of freezing the UI trying to render it.
const MAX_EDITABLE_BYTES: u64 = 5 * 1024 * 1024;

pub fn read_text_file(path: &str) -> Result<String, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    if meta.len() > MAX_EDITABLE_BYTES {
        return Err(format!(
            "file is too large to edit here ({:.1} MB, limit 5 MB)",
            meta.len() as f64 / 1024.0 / 1024.0
        ));
    }
    fs::read_to_string(path).map_err(|e| {
        if e.kind() == std::io::ErrorKind::InvalidData {
            "file isn't valid UTF-8 text (likely binary) — can't open it here".to_string()
        } else {
            e.to_string()
        }
    })
}

pub fn write_text_file(path: &str, content: &str) -> Result<(), String> {
    if let Some(parent) = Path::new(path).parent() {
        if !parent.as_os_str().is_empty() && !parent.exists() {
            return Err("parent directory does not exist".into());
        }
    }
    fs::write(path, content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_path(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aita-files-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir.join(name)
    }

    #[test]
    fn reads_back_written_content() {
        let p = temp_path("a.txt");
        write_text_file(p.to_str().unwrap(), "hello world").unwrap();
        assert_eq!(read_text_file(p.to_str().unwrap()).unwrap(), "hello world");
    }

    #[test]
    fn overwrites_existing_content() {
        let p = temp_path("a.txt");
        write_text_file(p.to_str().unwrap(), "first").unwrap();
        write_text_file(p.to_str().unwrap(), "second").unwrap();
        assert_eq!(read_text_file(p.to_str().unwrap()).unwrap(), "second");
    }

    #[test]
    fn read_missing_file_errors() {
        let p = temp_path("missing.txt");
        assert!(read_text_file(p.to_str().unwrap()).is_err());
    }

    #[test]
    fn read_a_directory_errors() {
        let dir = temp_path("adir");
        fs::create_dir_all(&dir).unwrap();
        assert!(read_text_file(dir.to_str().unwrap()).is_err());
    }

    #[test]
    fn read_non_utf8_file_errors_with_friendly_message() {
        let p = temp_path("bin.dat");
        fs::write(&p, [0xff, 0xfe, 0x00, 0xff]).unwrap();
        let err = read_text_file(p.to_str().unwrap()).unwrap_err();
        assert!(err.contains("binary"));
    }

    #[test]
    fn write_into_nonexistent_directory_errors() {
        let p = temp_path("nope").join("sub").join("a.txt");
        assert!(write_text_file(p.to_str().unwrap(), "x").is_err());
    }

    #[test]
    fn rejects_files_over_the_size_cap() {
        let p = temp_path("big.txt");
        // Sparse file — cheap to create, still reports the real length.
        let f = fs::File::create(&p).unwrap();
        f.set_len(MAX_EDITABLE_BYTES + 1).unwrap();
        let err = read_text_file(p.to_str().unwrap()).unwrap_err();
        assert!(err.contains("too large"));
    }
}
