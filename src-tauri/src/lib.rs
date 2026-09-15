mod git;
mod pty;

use git::{
    git_branch, git_branches, git_checkout, git_diff_file, git_list_files, git_root, git_status,
    GitStatusEntry,
};

mod files;
mod openai;
mod secrets;
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
    state
        .spawn(shell, rows, cols, cwd)
        .map_err(|e| e.to_string())
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

#[tauri::command]
fn git_diff_file_cmd(path: String, file: String) -> Result<String, String> {
    git_diff_file(&path, &file)
}

#[tauri::command]
fn read_text_file_cmd(path: String) -> Result<String, String> {
    files::read_text_file(&path)
}

#[tauri::command]
fn write_text_file_cmd(path: String, content: String) -> Result<(), String> {
    files::write_text_file(&path, &content)
}

#[tauri::command]
fn list_project_files_cmd(path: String) -> Result<Vec<String>, String> {
    git_list_files(&path).or_else(|_| files::list_files_fallback_walk(&path))
}

#[tauri::command]
fn has_api_key_cmd() -> bool {
    secrets::has_api_key()
}

#[tauri::command]
fn save_api_key_cmd(key: String) -> Result<(), String> {
    secrets::save_api_key(&key)
}

#[tauri::command]
fn delete_api_key_cmd() -> Result<(), String> {
    secrets::delete_api_key()
}

#[tauri::command]
async fn git_auto_commit_cmd(path: String, model: Option<String>) -> Result<String, String> {
    let api_key = secrets::get_api_key()
        .filter(|k| !k.trim().is_empty())
        .or_else(|| std::env::var("OPENAI_API_KEY").ok())
        .ok_or_else(|| "no OpenAI API key configured — set one in Settings".to_string())?;

    git::git_stage_all(&path)?;
    let stat = git::git_diff_stat(&path)?;
    if stat.trim().is_empty() {
        return Err("nothing to commit".into());
    }
    let diff = git::git_diff_staged(&path, 12_000)?;
    let model = model
        .filter(|m| !m.trim().is_empty())
        .unwrap_or_else(|| "gpt-4o-mini".into());
    let message = openai::commit_message(&stat, &diff, &api_key, &model).await?;
    git::git_commit(&path, &message)?;
    Ok(message)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
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
            git_root_cmd,
            git_diff_file_cmd,
            git_auto_commit_cmd,
            has_api_key_cmd,
            save_api_key_cmd,
            delete_api_key_cmd,
            read_text_file_cmd,
            write_text_file_cmd,
            list_project_files_cmd
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
