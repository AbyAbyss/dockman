// Compose commands — uses the `docker compose` plugin or `podman compose`.
// No separate docker-compose binary is required.

use super::Registry;
use std::io::BufRead;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

/// List discovered compose projects.
#[tauri::command]
pub async fn list_compose_projects(
    runtime: String,
) -> Result<Vec<serde_json::Value>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["compose", "ls", "--format", "json"])?;
    Ok(super::parse_json_lines(&raw))
}

/// Exit status of a `compose up`, delivered on the `compose-done` event.
#[derive(Clone, serde::Serialize)]
struct ComposeDone {
    success: bool,
    code: i32,
}

/// List the service names declared in a compose file. Doubles as a probe — it
/// fails when the runtime has no working `compose` provider.
#[tauri::command]
pub async fn compose_services(
    runtime: String,
    compose_file: String,
) -> Result<Vec<String>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(
        &bin,
        &["compose", "-f", &compose_file, "config", "--services"],
    )?;
    Ok(raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Bring a compose project up. Every output line streams on `compose-output`;
/// a `compose-done` event carries the exit status once the command finishes.
/// `scale` entries are `service=count` strings passed as `--scale`.
#[tauri::command]
pub async fn compose_up(
    app: tauri::AppHandle,
    runtime: String,
    compose_file: String,
    detach: bool,
    scale: Vec<String>,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args: Vec<String> =
        vec!["compose".into(), "-f".into(), compose_file, "up".into()];
    if detach {
        args.push("--detach".into());
    }
    for s in scale {
        args.push("--scale".into());
        args.push(s);
    }

    std::thread::spawn(move || {
        let spawned = std::process::Command::new(&bin)
            .args(&args)
            .env("PATH", super::shell_path())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("compose-output", format!("failed to start compose: {e}"));
                let _ = app.emit("compose-done", ComposeDone { success: false, code: -1 });
                return;
            }
        };

        let mut handles = Vec::new();
        if let Some(out) = child.stdout.take() {
            let app = app.clone();
            handles.push(std::thread::spawn(move || {
                for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                    let _ = app.emit("compose-output", line);
                }
            }));
        }
        if let Some(err) = child.stderr.take() {
            let app = app.clone();
            handles.push(std::thread::spawn(move || {
                for line in std::io::BufReader::new(err).lines().map_while(Result::ok) {
                    let _ = app.emit("compose-output", line);
                }
            }));
        }

        let status = child.wait();
        for h in handles {
            let _ = h.join();
        }
        let (success, code) = match status {
            Ok(s) => (s.success(), s.code().unwrap_or(-1)),
            Err(_) => (false, -1),
        };
        let _ = app.emit("compose-done", ComposeDone { success, code });
    });

    Ok(())
}

#[tauri::command]
pub async fn compose_down(
    runtime: String,
    compose_file: String,
    remove_volumes: bool,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args: Vec<&str> = vec!["compose", "-f", &compose_file, "down"];
    if remove_volumes {
        args.push("--volumes");
    }
    super::run(&bin, &args).map(|_| ())
}

#[tauri::command]
pub async fn compose_restart(
    runtime: String,
    compose_file: String,
    service: Option<String>,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args: Vec<&str> = vec!["compose", "-f", &compose_file, "restart"];
    if let Some(s) = &service {
        args.push(s);
    }
    super::run(&bin, &args).map(|_| ())
}

/// Stream compose logs on `compose-logs-{project_name}`.
#[tauri::command]
pub async fn compose_logs(
    app: tauri::AppHandle,
    registry: tauri::State<'_, Registry>,
    runtime: String,
    project_name: String,
    compose_file: String,
    service: Option<String>,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args: Vec<&str> = vec!["compose", "-f", &compose_file, "logs", "--follow"];
    if let Some(s) = &service {
        args.push(s);
    }
    super::spawn_streaming(
        &app,
        registry.inner(),
        format!("compose-logs-{project_name}"),
        format!("compose-logs-{project_name}"),
        &bin,
        &args,
    )
}

/// Open a compose file in the system default application.
#[tauri::command]
pub async fn open_compose_file(compose_file: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let opener = "xdg-open";

    std::process::Command::new(opener)
        .arg(&compose_file)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open a native file picker for a compose file; returns the chosen path, or
/// `None` when the dialog is cancelled.
#[tauri::command]
pub async fn pick_compose_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Compose file", &["yml", "yaml"])
        .blocking_pick_file();
    Ok(picked.map(|f| f.to_string()))
}
