// Container exec — a real PTY behind xterm.js.
//
// The previous implementation piped stdin/stdout around `{runtime} exec -i`.
// That had two problems: `exec_input` wrote the command without a trailing
// newline, so the shell never saw a complete line and never ran anything; and
// with no TTY there was no prompt, no colours and no interactive programs.
//
// Now we allocate a PTY, run `{runtime} exec -it {id} {shell}` inside it, and
// stream raw bytes both ways. The frontend owns the terminal emulation, so
// keystrokes (including Enter, Ctrl-C and arrow keys) pass straight through.

use portable_pty::{CommandBuilder, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::Emitter;

/// One live PTY session: the writer half plus a handle to resize and kill it.
struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct ExecSessions {
    sessions: Mutex<HashMap<String, Session>>,
}

impl ExecSessions {
    fn with<T>(&self, id: &str, f: impl FnOnce(&mut Session) -> T) -> Result<T, String> {
        let mut map = self
            .sessions
            .lock()
            .map_err(|_| "exec registry poisoned".to_string())?;
        let s = map
            .get_mut(id)
            .ok_or_else(|| "no such exec session".to_string())?;
        Ok(f(s))
    }
}

/// Start an exec session; returns a session id used to address it.
#[tauri::command]
pub async fn exec_start(
    app: tauri::AppHandle,
    sessions: tauri::State<'_, Arc<ExecSessions>>,
    runtime: String,
    id: String,
    shell: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<String, String> {
    let bin = super::resolve(&runtime)?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let session_id = format!("exec-{millis:x}");
    let event = format!("exec-output-{session_id}");

    let pty = NativePtySystem::default();
    let pair = pty
        .openpty(PtySize {
            rows: rows.unwrap_or(24),
            cols: cols.unwrap_or(80),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("could not open a pty: {e}"))?;

    let mut cmd = CommandBuilder::new(&bin);
    cmd.args(["exec", "-it", &id, &shell]);
    cmd.env("PATH", super::shell_path());
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("failed to start exec: {e}"))?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("could not read from the pty: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("could not write to the pty: {e}"))?;

    // Stream raw chunks — not lines. A shell prompt arrives without a newline,
    // so line-buffering would hide it until the next command completed.
    let emit_app = app.clone();
    let done_event = event.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = emit_app.emit(&done_event, chunk);
                }
            }
        }
        let _ = emit_app.emit(&format!("{done_event}-exit"), ());
    });

    if let Ok(mut map) = sessions.sessions.lock() {
        map.insert(
            session_id.clone(),
            Session {
                writer,
                master: pair.master,
                child,
            },
        );
    }
    Ok(session_id)
}

/// Write raw input to a session. The frontend sends keystrokes verbatim, so
/// Enter arrives as `\r` and control keys arrive as their control bytes.
#[tauri::command]
pub async fn exec_input(
    sessions: tauri::State<'_, Arc<ExecSessions>>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    sessions.with(&session_id, |s| {
        s.writer
            .write_all(input.as_bytes())
            .and_then(|_| s.writer.flush())
            .map_err(|e| e.to_string())
    })?
}

/// Resize the PTY so full-screen programs lay out correctly.
#[tauri::command]
pub async fn exec_resize(
    sessions: tauri::State<'_, Arc<ExecSessions>>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    sessions.with(&session_id, |s| {
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| e.to_string())
    })?
}

#[tauri::command]
pub async fn exec_stop(
    sessions: tauri::State<'_, Arc<ExecSessions>>,
    session_id: String,
) -> Result<(), String> {
    if let Ok(mut map) = sessions.sessions.lock() {
        if let Some(mut s) = map.remove(&session_id) {
            let _ = s.child.kill();
        }
    }
    Ok(())
}
