// Container exec — pipe-based interactive shell.
//
// xterm.js lives in the frontend; here we spawn `{runtime} exec -i {id} {shell}`,
// stream stdout/stderr over events and feed stdin from `exec_input`.

use super::Registry;
use std::io::Write;
use std::process::{Command, Stdio};
use tauri::Emitter;

/// Start an exec session; returns a session id used to address it.
#[tauri::command]
pub async fn exec_start(
    app: tauri::AppHandle,
    registry: tauri::State<'_, Registry>,
    runtime: String,
    id: String,
    shell: String,
) -> Result<String, String> {
    let bin = super::resolve(&runtime)?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let session_id = format!("exec-{millis:x}");
    let event = format!("exec-output-{session_id}");

    let mut child = Command::new(&bin)
        .args(["exec", "-i", &id, &shell])
        .env("PATH", super::shell_path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to start exec: {e}"))?;

    for reader in [
        child.stdout.take().map(Reader::Out),
        child.stderr.take().map(Reader::Err),
    ]
    .into_iter()
    .flatten()
    {
        let app = app.clone();
        let event = event.clone();
        std::thread::spawn(move || {
            use std::io::BufRead;
            match reader {
                Reader::Out(r) => {
                    for line in std::io::BufReader::new(r).lines().map_while(Result::ok) {
                        let _ = app.emit(&event, line);
                    }
                }
                Reader::Err(r) => {
                    for line in std::io::BufReader::new(r).lines().map_while(Result::ok) {
                        let _ = app.emit(&event, line);
                    }
                }
            }
        });
    }

    registry.insert(session_id.clone(), child);
    Ok(session_id)
}

enum Reader {
    Out(std::process::ChildStdout),
    Err(std::process::ChildStderr),
}

/// Write input to a running exec session's stdin.
#[tauri::command]
pub async fn exec_input(
    registry: tauri::State<'_, Registry>,
    session_id: String,
    input: String,
) -> Result<(), String> {
    let mut map = registry
        .procs
        .lock()
        .map_err(|_| "registry lock poisoned".to_string())?;
    let child = map
        .get_mut(&session_id)
        .ok_or_else(|| "no such exec session".to_string())?;
    let stdin = child
        .stdin
        .as_mut()
        .ok_or_else(|| "exec stdin closed".to_string())?;
    stdin.write_all(input.as_bytes()).map_err(|e| e.to_string())?;
    stdin.flush().map_err(|e| e.to_string())
}

/// Pipe-based exec has no PTY to resize — accepted as a no-op.
#[tauri::command]
pub async fn exec_resize(
    _session_id: String,
    _cols: u32,
    _rows: u32,
) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub async fn exec_stop(
    registry: tauri::State<'_, Registry>,
    session_id: String,
) -> Result<(), String> {
    registry.kill(&session_id);
    Ok(())
}
