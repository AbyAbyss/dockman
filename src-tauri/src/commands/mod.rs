// Shared helpers for shelling out to the Docker / Podman CLIs.
//
// Dockman never talks to a daemon socket or an SDK — every operation is a
// plain CLI invocation. These helpers cover the cross-cutting concerns:
//   1. GUI apps on macOS don't inherit the shell PATH, so we rebuild one.
//   2. Docker emits newline-delimited JSON while Podman emits a JSON array.
//   3. Long-running commands (logs, stats, builds, exec) stream over events
//      and their child processes are tracked so they can be cancelled.

pub mod builds;
pub mod compose;
pub mod containers;
pub mod downloader;
pub mod exec;
pub mod images;
pub mod networks;
pub mod runtime;
pub mod system;
pub mod volumes;

use std::collections::HashMap;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::Emitter;

/// Registry of long-running child processes, keyed by a caller-chosen id
/// (container id, exec session id, build id …). Stored as Tauri managed state.
#[derive(Default)]
pub struct Registry {
    pub procs: Mutex<HashMap<String, Child>>,
}

impl Registry {
    pub fn insert(&self, key: String, child: Child) {
        if let Ok(mut map) = self.procs.lock() {
            map.insert(key, child);
        }
    }

    /// Kill and forget a tracked process.
    pub fn kill(&self, key: &str) {
        if let Ok(mut map) = self.procs.lock() {
            if let Some(mut child) = map.remove(key) {
                let _ = child.kill();
            }
        }
    }
}

/// Build a PATH that includes the usual binary locations. GUI processes on
/// macOS launch without the interactive shell's PATH.
pub fn shell_path() -> String {
    let mut paths: Vec<String> = std::env::var("PATH")
        .map(|p| p.split(':').map(String::from).collect())
        .unwrap_or_default();
    for extra in [
        "/opt/homebrew/bin",
        "/usr/local/bin",
        "/usr/bin",
        "/bin",
        "/Applications/Docker.app/Contents/Resources/bin",
    ] {
        if !paths.iter().any(|p| p == extra) {
            paths.push(extra.to_string());
        }
    }
    paths.join(":")
}

/// Resolve a runtime name ("docker" / "podman") to an absolute binary path.
pub fn resolve(runtime: &str) -> Result<String, String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    if let Ok(p) = which::which_in(runtime, Some(shell_path()), &cwd) {
        return Ok(p.to_string_lossy().into_owned());
    }
    // User-local install directory used by the binary downloader.
    if let Ok(home) = std::env::var("HOME") {
        let local = format!("{home}/.local/bin/{runtime}");
        if std::path::Path::new(&local).exists() {
            return Ok(local);
        }
    }
    let candidates: &[&str] = match runtime {
        "docker" => &[
            "/usr/local/bin/docker",
            "/opt/homebrew/bin/docker",
            "/usr/bin/docker",
            "/Applications/Docker.app/Contents/Resources/bin/docker",
        ],
        "podman" => &[
            "/opt/homebrew/bin/podman",
            "/usr/local/bin/podman",
            "/usr/bin/podman",
        ],
        other => return Err(format!("unknown runtime: {other}")),
    };
    for c in candidates {
        if std::path::Path::new(c).exists() {
            return Ok((*c).to_string());
        }
    }
    Err(format!("{runtime} binary not found"))
}

/// Locate any binary on the augmented PATH (used for optional tools like colima).
pub fn which_optional(name: &str) -> Option<String> {
    let cwd = std::env::current_dir().unwrap_or_default();
    which::which_in(name, Some(shell_path()), &cwd)
        .ok()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Run a CLI command to completion, returning stdout on success.
pub fn run(bin: &str, args: &[&str]) -> Result<String, String> {
    let output = Command::new(bin)
        .args(args)
        .env("PATH", shell_path())
        .output()
        .map_err(|e| format!("failed to run {bin}: {e}"))?;
    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

/// Parse CLI JSON output that may be a JSON array (Podman) or newline-delimited
/// JSON objects (Docker).
pub fn parse_json_lines(raw: &str) -> Vec<serde_json::Value> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    if trimmed.starts_with('[') {
        return serde_json::from_str(trimmed).unwrap_or_default();
    }
    trimmed
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str(l).ok())
        .collect()
}

/// Spawn a streaming command: every stdout/stderr line is emitted on `event`,
/// and the child is tracked in the registry under `key` so it can be cancelled.
pub fn spawn_streaming(
    app: &tauri::AppHandle,
    registry: &Registry,
    key: String,
    event: String,
    bin: &str,
    args: &[&str],
) -> Result<(), String> {
    let mut child = Command::new(bin)
        .args(args)
        .env("PATH", shell_path())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {bin}: {e}"))?;

    for pipe in [child.stdout.take().map(Pipe::Out), child.stderr.take().map(Pipe::Err)]
        .into_iter()
        .flatten()
    {
        let app = app.clone();
        let event = event.clone();
        std::thread::spawn(move || {
            match pipe {
                Pipe::Out(r) => {
                    let reader = std::io::BufReader::new(r);
                    for line in reader.lines().map_while(Result::ok) {
                        let _ = app.emit(&event, line);
                    }
                }
                Pipe::Err(r) => {
                    let reader = std::io::BufReader::new(r);
                    for line in reader.lines().map_while(Result::ok) {
                        let _ = app.emit(&event, line);
                    }
                }
            }
        });
    }

    registry.insert(key, child);
    Ok(())
}

enum Pipe {
    Out(std::process::ChildStdout),
    Err(std::process::ChildStderr),
}

/// The Dockman config directory (`~/.config/dockman`), created on demand.
pub fn config_dir() -> PathBuf {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(home).join(".config").join("dockman");
    let _ = std::fs::create_dir_all(&dir);
    dir
}
