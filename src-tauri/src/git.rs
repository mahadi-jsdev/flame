use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone)]
pub struct GitStatusEntry {
    pub status: String,
    pub path: String,
    pub original_path: Option<String>,
}

fn unquote_path(s: &str) -> String {
    let s = s.trim();
    if !(s.len() >= 2 && s.starts_with('"') && s.ends_with('"')) {
        return s.to_string();
    }
    let inner = &s[1..s.len() - 1];
    let mut out = String::with_capacity(inner.len());
    let mut chars = inner.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') => out.push('\n'),
            Some('t') => out.push('\t'),
            Some('r') => out.push('\r'),
            Some('"') => out.push('"'),
            Some('\\') => out.push('\\'),
            Some(o @ '0'..='7') => {
                let mut v = o.to_digit(8).unwrap();
                for _ in 0..2 {
                    match chars.next().and_then(|c| c.to_digit(8)) {
                        Some(d) => v = v * 8 + d,
                        None => break,
                    }
                }
                if let Some(c) = char::from_u32(v) {
                    out.push(c);
                }
            }
            Some(other) => {
                out.push('\\');
                out.push(other);
            }
            None => out.push('\\'),
        }
    }
    out
}

pub fn git_status(path: &str) -> Result<Vec<GitStatusEntry>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("status")
        .arg("--porcelain")
        .arg("--")
        .arg(".")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.is_empty() {
            return Err("git status failed".into());
        }
        return Err(stderr.trim().to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let mut entries = Vec::new();

    for line in text.lines() {
        if line.len() < 4 {
            continue;
        }
        let status = line[0..2].to_string();
        let rest = &line[3..];

        if status.starts_with('R') || status.starts_with('C') {
            if let Some((from, to)) = rest.split_once(" -> ") {
                entries.push(GitStatusEntry {
                    status,
                    path: unquote_path(to),
                    original_path: Some(unquote_path(from)),
                });
            } else {
                entries.push(GitStatusEntry {
                    status,
                    path: unquote_path(rest),
                    original_path: None,
                });
            }
        } else {
            entries.push(GitStatusEntry {
                status,
                path: unquote_path(rest),
                original_path: None,
            });
        }
    }

    Ok(entries)
}

pub fn git_branches(path: &str) -> Result<Vec<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("branch")
        .arg("--format=%(refname:short)")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    Ok(text
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

pub fn git_checkout(path: &str, branch: &str) -> Result<(), String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("switch")
        .arg(branch)
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(())
}

fn run_git(path: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}

pub fn git_stage_all(path: &str) -> Result<(), String> {
    run_git(path, &["add", "-A"])?;
    Ok(())
}

pub fn git_diff_stat(path: &str) -> Result<String, String> {
    run_git(path, &["diff", "--cached", "--stat"])
}

pub fn git_diff_staged(path: &str, max_chars: usize) -> Result<String, String> {
    let diff = run_git(path, &["diff", "--cached", "--no-color", "-U2"])?;
    Ok(diff.chars().take(max_chars).collect())
}

pub fn git_commit(path: &str, message: &str) -> Result<(), String> {
    run_git(path, &["commit", "-m", message])?;
    Ok(())
}

pub fn git_root(path: &str) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("rev-parse")
        .arg("--show-toplevel")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

pub fn git_branch(path: &str) -> Result<Option<String>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("branch")
        .arg("--show-current")
        .output()
        .map_err(|e| e.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let branch = String::from_utf8_lossy(&output.stdout).trim().to_string();
    Ok(if branch.is_empty() {
        None
    } else {
        Some(branch)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    static COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TestRepo(PathBuf);

    impl TestRepo {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "aita-test-{}-{}",
                std::process::id(),
                COUNTER.fetch_add(1, Ordering::SeqCst)
            ));
            fs::create_dir_all(&dir).unwrap();
            let repo = TestRepo(dir);
            repo.run(&["init", "-b", "main"]);
            repo.run(&["config", "user.email", "t@t.dev"]);
            repo.run(&["config", "user.name", "t"]);
            repo
        }

        fn path(&self) -> &str {
            self.0.to_str().unwrap()
        }

        fn run(&self, args: &[&str]) {
            let out = Command::new("git")
                .arg("-C")
                .arg(&self.0)
                .args(args)
                .output()
                .unwrap();
            assert!(
                out.status.success(),
                "git {:?} failed: {}",
                args,
                String::from_utf8_lossy(&out.stderr)
            );
        }

        fn write(&self, name: &str, content: &str) {
            let p = self.0.join(name);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, content).unwrap();
        }

        fn commit_all(&self) {
            self.run(&["add", "-A"]);
            self.run(&["commit", "-m", "c"]);
        }
    }

    impl Drop for TestRepo {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn git_root_returns_toplevel() {
        let r = TestRepo::new();
        let root = git_root(r.path()).unwrap();
        assert_eq!(
            PathBuf::from(&root).canonicalize().unwrap(),
            r.0.canonicalize().unwrap()
        );
    }

    #[test]
    fn git_root_resolves_from_subdir() {
        let r = TestRepo::new();
        let sub = r.0.join("nested/deep");
        fs::create_dir_all(&sub).unwrap();
        let root = git_root(sub.to_str().unwrap()).unwrap();
        assert_eq!(
            PathBuf::from(&root).canonicalize().unwrap(),
            r.0.canonicalize().unwrap()
        );
    }

    #[test]
    fn git_root_errors_outside_repo() {
        let dir = std::env::temp_dir().join(format!("aita-norepo-{}-x", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        assert!(git_root(dir.to_str().unwrap()).is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn git_branch_returns_main() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        assert_eq!(git_branch(r.path()).unwrap(), Some("main".to_string()));
    }

    #[test]
    fn git_branch_detached_returns_none() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        r.run(&["checkout", "--detach", "HEAD"]);
        assert_eq!(git_branch(r.path()).unwrap(), None);
    }

    #[test]
    fn git_status_empty_repo_is_empty() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        assert!(git_status(r.path()).unwrap().is_empty());
    }

    #[test]
    fn git_status_reports_untracked() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        r.write("new.txt", "n");
        let s = git_status(r.path()).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].status, "??");
        assert_eq!(s[0].path, "new.txt");
    }

    #[test]
    fn git_status_reports_modified() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        r.write("a.txt", "changed");
        let s = git_status(r.path()).unwrap();
        assert_eq!(s[0].status, " M");
        assert_eq!(s[0].path, "a.txt");
    }

    #[test]
    fn git_status_reports_staged_add() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        r.write("b.txt", "x");
        r.run(&["add", "b.txt"]);
        let s = git_status(r.path()).unwrap();
        assert_eq!(s[0].status, "A ");
        assert_eq!(s[0].path, "b.txt");
    }

    #[test]
    fn git_status_reports_deleted() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        fs::remove_file(r.0.join("a.txt")).unwrap();
        let s = git_status(r.path()).unwrap();
        assert_eq!(s[0].status, " D");
    }

    #[test]
    fn git_status_reports_rename_with_original() {
        let r = TestRepo::new();
        r.write("old.txt", "hi");
        r.commit_all();
        r.run(&["mv", "old.txt", "new.txt"]);
        let s = git_status(r.path()).unwrap();
        assert_eq!(s[0].status, "R ");
        assert_eq!(s[0].path, "new.txt");
        assert_eq!(s[0].original_path, Some("old.txt".to_string()));
    }

    #[test]
    fn git_status_scoped_to_subdir() {
        let r = TestRepo::new();
        r.write("top.txt", "a");
        r.write("sub/inner.txt", "b");
        r.commit_all();
        // modify both; status from sub/ should only show inner
        r.write("top.txt", "a2");
        r.write("sub/inner.txt", "b2");
        let s = git_status(r.0.join("sub").to_str().unwrap()).unwrap();
        assert_eq!(s.len(), 1);
        assert_eq!(s[0].path, "sub/inner.txt");
    }

    #[test]
    fn git_status_reports_spaced_filename() {
        let r = TestRepo::new();
        r.write("my file.txt", "x");
        let s = git_status(r.path()).unwrap();
        assert_eq!(s[0].path, "my file.txt");
    }

    #[test]
    fn git_status_unquotes_special_chars() {
        let r = TestRepo::new();
        r.write("we\"ird.txt", "x");
        let s = git_status(r.path()).unwrap();
        assert_eq!(s[0].path, "we\"ird.txt");
    }

    #[test]
    fn git_branches_lists_and_checkout_switches() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        r.run(&["branch", "feature"]);
        let bs = git_branches(r.path()).unwrap();
        assert!(bs.contains(&"main".to_string()));
        assert!(bs.contains(&"feature".to_string()));

        git_checkout(r.path(), "feature").unwrap();
        assert_eq!(git_branch(r.path()).unwrap(), Some("feature".to_string()));
    }

    #[test]
    fn git_checkout_missing_branch_errors() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        assert!(git_checkout(r.path(), "nope").is_err());
    }

    #[test]
    fn git_status_errors_outside_repo() {
        assert!(git_status("/definitely/not/a/repo").is_err());
    }

    #[test]
    fn stage_all_then_commit() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        r.write("a.txt", "changed");
        r.write("new.txt", "new");
        git_stage_all(r.path()).unwrap();
        let stat = git_diff_stat(r.path()).unwrap();
        assert!(stat.contains("a.txt"));
        assert!(stat.contains("new.txt"));
        git_commit(r.path(), "test commit").unwrap();
        assert!(git_status(r.path()).unwrap().is_empty());
        let out = Command::new("git")
            .arg("-C")
            .arg(&r.0)
            .args(["log", "-1", "--format=%s"])
            .output()
            .unwrap();
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "test commit");
    }

    #[test]
    fn diff_staged_truncates() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        let big = "x".repeat(5000);
        r.write("a.txt", &big);
        r.run(&["add", "a.txt"]);
        let diff = git_diff_staged(r.path(), 100).unwrap();
        assert!(diff.chars().count() <= 100);
    }

    #[test]
    fn diff_stat_empty_when_nothing_staged() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        r.write("a.txt", "dirty"); // unstaged only
        assert!(git_diff_stat(r.path()).unwrap().trim().is_empty());
    }

    #[test]
    fn commit_without_staged_changes_errors() {
        let r = TestRepo::new();
        r.write("a.txt", "hi");
        r.commit_all();
        assert!(git_commit(r.path(), "nothing").is_err());
    }
}
