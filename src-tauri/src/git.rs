use serde::Serialize;
use std::process::Command;

#[derive(Serialize, Clone)]
pub struct GitStatusEntry {
    pub status: String,
    pub path: String,
    pub original_path: Option<String>,
}

pub fn git_status(path: &str) -> Result<Vec<GitStatusEntry>, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .arg("status")
        .arg("--porcelain")
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
                    path: to.to_string(),
                    original_path: Some(from.to_string()),
                });
            } else {
                entries.push(GitStatusEntry {
                    status,
                    path: rest.to_string(),
                    original_path: None,
                });
            }
        } else {
            entries.push(GitStatusEntry {
                status,
                path: rest.to_string(),
                original_path: None,
            });
        }
    }

    Ok(entries)
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
    Ok(if branch.is_empty() { None } else { Some(branch) })
}
