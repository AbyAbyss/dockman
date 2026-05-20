// Compose commands — uses the `docker compose` plugin or `podman compose`.
// No separate docker-compose binary is required.

use super::Registry;

/// List discovered compose projects.
#[tauri::command]
pub async fn list_compose_projects(
    runtime: String,
) -> Result<Vec<serde_json::Value>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["compose", "ls", "--format", "json"])?;
    Ok(super::parse_json_lines(&raw))
}

/// Bring a compose project up; output streams on `compose-output`.
#[tauri::command]
pub async fn compose_up(
    app: tauri::AppHandle,
    registry: tauri::State<'_, Registry>,
    runtime: String,
    project_name: String,
    compose_file: String,
    detach: bool,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args: Vec<&str> = vec!["compose", "-f", &compose_file, "up"];
    if detach {
        args.push("--detach");
    }
    super::spawn_streaming(
        &app,
        registry.inner(),
        format!("compose-up-{project_name}"),
        "compose-output".to_string(),
        &bin,
        &args,
    )
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
