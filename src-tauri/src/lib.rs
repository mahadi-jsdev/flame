mod git;
mod pty;

use git::{git_branch, git_branches, git_checkout, git_root, git_status, GitStatusEntry};
use pty::{PtyManager, PtySpawnResult};
use tauri::Manager;

#[tauri::command]
fn spawn_pty(
    state: tauri::State<'_, PtyManager>,
    shell: Option<String>,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
) -> Result<PtySpawnResult, String> {
    state.spawn(shell, rows, cols, cwd).map_err(|e| e.to_string())
}

#[tauri::command]
fn write_pty(state: tauri::State<'_, PtyManager>, id: String, data: String) -> Result<(), String> {
    state.write(&id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_pty(
    state: tauri::State<'_, PtyManager>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    state.resize(&id, rows, cols).map_err(|e| e.to_string())
}

#[tauri::command]
fn kill_pty(state: tauri::State<'_, PtyManager>, id: String) -> Result<(), String> {
    state.kill(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn git_status_cmd(path: String) -> Result<Vec<GitStatusEntry>, String> {
    git_status(&path)
}

#[tauri::command]
fn git_branch_cmd(path: String) -> Result<Option<String>, String> {
    git_branch(&path)
}

#[tauri::command]
fn git_branches_cmd(path: String) -> Result<Vec<String>, String> {
    git_branches(&path)
}

#[tauri::command]
fn git_checkout_cmd(path: String, branch: String) -> Result<(), String> {
    git_checkout(&path, &branch)
}

#[tauri::command]
fn git_root_cmd(path: String) -> Result<String, String> {
    git_root(&path)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            app.manage(PtyManager::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            kill_pty,
            git_status_cmd,
            git_branch_cmd,
            git_branches_cmd,
            git_checkout_cmd,
            git_root_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
