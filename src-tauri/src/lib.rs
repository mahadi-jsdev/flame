mod filesystem;
mod git;
mod pty;

use filesystem::{list_directory, DirEntry};
use git::{git_branch, git_status, GitStatusEntry};
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
fn list_dir(path: String) -> Result<Vec<DirEntry>, String> {
    list_directory(&path)
}

#[tauri::command]
fn git_status_cmd(path: String) -> Result<Vec<GitStatusEntry>, String> {
    git_status(&path)
}

#[tauri::command]
fn git_branch_cmd(path: String) -> Result<Option<String>, String> {
    git_branch(&path)
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
            list_dir,
            git_status_cmd,
            git_branch_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
