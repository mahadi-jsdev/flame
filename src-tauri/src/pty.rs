use base64::{engine::general_purpose, Engine as _};
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Clone, Serialize)]
pub struct PtyDataPayload {
    pub id: String,
    pub chunk_b64: String,
}

#[derive(Clone, Serialize)]
pub struct PtyExitPayload {
    pub id: String,
    pub exit_code: Option<i32>,
}

pub struct PtyManager {
    sessions: Mutex<HashMap<String, PtySession>>,
    app: AppHandle,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    child: Box<dyn Child + Send + Sync>,
}

impl PtyManager {
    pub fn new(app: AppHandle) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            app,
        }
    }

    pub fn spawn(
        &self,
        shell: Option<String>,
        rows: u16,
        cols: u16,
    ) -> Result<String, Box<dyn std::error::Error>> {
        let pty_system = native_pty_system();
        let pair = pty_system.openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })?;

        let shell = shell.unwrap_or_else(default_shell);
        let cmd = CommandBuilder::new(shell);
        let child = pair.slave.spawn_command(cmd)?;
        drop(pair.slave);

        let master = pair.master;
        let writer = master.take_writer()?;
        let mut reader = master.try_clone_reader()?;

        let id = Uuid::new_v4().to_string();
        let session = PtySession {
            master,
            writer: Arc::new(Mutex::new(writer)),
            child,
        };
        self.sessions.lock().unwrap().insert(id.clone(), session);

        // Spawn a thread to read PTY output and emit it to the frontend.
        let app = self.app.clone();
        let id_for_reader = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => {
                        let _ = app.emit(
                            "pty-exit",
                            PtyExitPayload {
                                id: id_for_reader,
                                exit_code: None,
                            },
                        );
                        break;
                    }
                    Ok(n) => {
                        let chunk_b64 = general_purpose::STANDARD.encode(&buf[..n]);
                        let _ = app.emit(
                            "pty-data",
                            PtyDataPayload {
                                id: id_for_reader.clone(),
                                chunk_b64,
                            },
                        );
                    }
                    Err(_) => {
                        let _ = app.emit(
                            "pty-exit",
                            PtyExitPayload {
                                id: id_for_reader,
                                exit_code: None,
                            },
                        );
                        break;
                    }
                }
            }
        });

        Ok(id)
    }

    pub fn write(&self, id: &str, data: &str) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(session) = self.sessions.lock().unwrap().get(id) {
            let mut writer = session.writer.lock().unwrap();
            writer.write_all(data.as_bytes())?;
            writer.flush()?;
        }
        Ok(())
    }

    pub fn resize(&self, id: &str, rows: u16, cols: u16) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(session) = self.sessions.lock().unwrap().get(id) {
            session.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })?;
        }
        Ok(())
    }

    pub fn kill(&self, id: &str) -> Result<(), Box<dyn std::error::Error>> {
        if let Some(mut session) = self.sessions.lock().unwrap().remove(id) {
            session.child.kill()?;
        }
        Ok(())
    }
}

fn default_shell() -> String {
    #[cfg(target_os = "windows")]
    return std::env::var("COMSPEC").unwrap_or_else(|_| "cmd".into());

    std::env::var("SHELL").unwrap_or_else(|_| "bash".into())
}
