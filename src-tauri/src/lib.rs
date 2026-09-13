mod pty;

use pty::PtyManager;
use tauri::Manager;

#[tauri::command]
fn spawn_pty(
    state: tauri::State<'_, PtyManager>,
    shell: Option<String>,
    rows: u16,
    cols: u16,
) -> Result<String, String> {
    state.spawn(shell, rows, cols).map_err(|e| e.to_string())
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
fn greet(name: &str) -> String {
    format!("Hello, {name}! You've been greeted from Rust!")
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            app.manage(PtyManager::new(app.handle().clone()));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            kill_pty,
            greet
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
