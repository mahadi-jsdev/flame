use base64::{engine::general_purpose, Engine as _};
use std::fs;
use std::path::Path;

/// Above this, a plain `<textarea>` editor stops being usable — reject
/// early with a clear message instead of freezing the UI trying to render it.
const MAX_EDITABLE_BYTES: u64 = 5 * 1024 * 1024;

/// Base64 inflates payload size by ~33% on top of the IPC round-trip, so cap
/// well below what a "just show a picture" feature should ever need.
const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;

fn image_mime_type(path: &str) -> Option<&'static str> {
    let ext = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        _ => return None,
    })
}

/// Reads an image file and returns it as a ready-to-use `data:` URL —
/// simpler than wiring up the Tauri asset protocol (which needs an explicit,
/// updated-on-the-fly scope per user-added project directory) for what's
/// just a handful of small preview images at a time.
pub fn read_image_file_as_data_url(path: &str) -> Result<String, String> {
    let mime = image_mime_type(path).ok_or_else(|| "not a supported image type".to_string())?;
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("not a file".into());
    }
    if meta.len() > MAX_IMAGE_BYTES {
        return Err(format!(
            "image is too large to preview ({:.1} MB, limit {} MB)",
            meta.len() as f64 / 1024.0 / 1024.0,
            MAX_IMAGE_BYTES / 1024 / 1024
        ));
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let b64 = general_purpose::STANDARD.encode(&bytes);
    Ok(format!("data:{mime};base64,{b64}"))
}

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
    fn read_image_file_returns_a_data_url_with_correct_mime_and_bytes() {
        let p = temp_path("pic.png");
        fs::write(&p, [0x89, 0x50, 0x4e, 0x47]).unwrap();
        let url = read_image_file_as_data_url(p.to_str().unwrap()).unwrap();
        assert!(url.starts_with("data:image/png;base64,"));
        let (_, b64) = url.split_once(',').unwrap();
        let decoded = general_purpose::STANDARD.decode(b64).unwrap();
        assert_eq!(decoded, [0x89, 0x50, 0x4e, 0x47]);
    }

    #[test]
    fn read_image_file_maps_jpg_and_jpeg_and_webp_extensions() {
        for (name, mime) in [
            ("a.jpg", "image/jpeg"),
            ("a.jpeg", "image/jpeg"),
            ("a.webp", "image/webp"),
            ("a.JPG", "image/jpeg"),
        ] {
            let p = temp_path(name);
            fs::write(&p, [1, 2, 3]).unwrap();
            let url = read_image_file_as_data_url(p.to_str().unwrap()).unwrap();
            assert!(url.starts_with(&format!("data:{mime};base64,")), "{name}");
        }
    }

    #[test]
    fn read_image_file_rejects_unsupported_extension() {
        let p = temp_path("notes.txt");
        fs::write(&p, "hello").unwrap();
        let err = read_image_file_as_data_url(p.to_str().unwrap()).unwrap_err();
        assert!(err.contains("not a supported image type"));
    }

    #[test]
    fn read_image_file_missing_file_errors() {
        let p = temp_path("missing.png");
        assert!(read_image_file_as_data_url(p.to_str().unwrap()).is_err());
    }

    #[test]
    fn read_image_file_rejects_oversized_image() {
        let p = temp_path("huge.png");
        let f = fs::File::create(&p).unwrap();
        f.set_len(MAX_IMAGE_BYTES + 1).unwrap();
        let err = read_image_file_as_data_url(p.to_str().unwrap()).unwrap_err();
        assert!(err.contains("too large"));
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
