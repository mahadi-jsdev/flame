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

const MAX_LISTED_FILES: usize = 20_000;
const SKIP_DIR_NAMES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".next",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    ".turbo",
    ".parcel-cache",
];

/// Plain recursive walk for a file finder, used only when the project isn't
/// a git repo (git_list_files handles the common case with real .gitignore
/// support) — a fixed denylist stands in for gitignore here since there's no
/// repo to ask.
pub fn list_files_fallback_walk(root: &str) -> Result<Vec<String>, String> {
    let root_path = Path::new(root);
    if !root_path.is_dir() {
        return Err("not a directory".into());
    }
    let mut out = Vec::new();
    let mut stack = vec![root_path.to_path_buf()];
    while let Some(dir) = stack.pop() {
        if out.len() >= MAX_LISTED_FILES {
            break;
        }
        let entries = match fs::read_dir(&dir) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_dir() {
                let name = entry.file_name();
                if !SKIP_DIR_NAMES.contains(&name.to_string_lossy().as_ref()) {
                    stack.push(path);
                }
            } else if file_type.is_file() {
                if let Ok(rel) = path.strip_prefix(root_path) {
                    out.push(rel.to_string_lossy().replace('\\', "/"));
                    if out.len() >= MAX_LISTED_FILES {
                        break;
                    }
                }
            }
        }
    }
    out.sort();
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    fn temp_dir() -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "aita-files-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn temp_path(name: &str) -> std::path::PathBuf {
        temp_dir().join(name)
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

    #[test]
    fn walk_finds_nested_files() {
        let root = temp_dir();
        fs::write(root.join("a.txt"), "1").unwrap();
        fs::create_dir_all(root.join("src/lib")).unwrap();
        fs::write(root.join("src/lib/b.rs"), "2").unwrap();
        let files = list_files_fallback_walk(root.to_str().unwrap()).unwrap();
        assert!(files.contains(&"a.txt".to_string()));
        assert!(files.contains(&"src/lib/b.rs".to_string()));
    }

    #[test]
    fn walk_skips_denylisted_directories() {
        let root = temp_dir();
        fs::create_dir_all(root.join("node_modules/pkg")).unwrap();
        fs::write(root.join("node_modules/pkg/index.js"), "x").unwrap();
        fs::write(root.join("real.js"), "y").unwrap();
        let files = list_files_fallback_walk(root.to_str().unwrap()).unwrap();
        assert!(files.contains(&"real.js".to_string()));
        assert!(!files.iter().any(|f| f.contains("node_modules")));
    }

    #[test]
    fn walk_on_missing_directory_errors() {
        let p = temp_path("does-not-exist");
        assert!(list_files_fallback_walk(p.to_str().unwrap()).is_err());
    }

    #[test]
    fn walk_on_empty_directory_is_empty() {
        let root = temp_dir();
        assert_eq!(
            list_files_fallback_walk(root.to_str().unwrap()).unwrap(),
            Vec::<String>::new()
        );
    }
}
