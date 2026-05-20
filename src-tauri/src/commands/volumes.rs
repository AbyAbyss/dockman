// Volume commands — listing, create, remove, inspect, prune.

#[tauri::command]
pub async fn list_volumes(runtime: String) -> Result<Vec<serde_json::Value>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["volume", "ls", "--format", "json"])?;
    Ok(super::parse_json_lines(&raw))
}

#[tauri::command]
pub async fn create_volume(runtime: String, name: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["volume", "create", &name]).map(|_| ())
}

#[tauri::command]
pub async fn remove_volume(runtime: String, name: String, force: bool) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args = vec!["volume", "rm"];
    if force {
        args.push("--force");
    }
    args.push(&name);
    super::run(&bin, &args).map(|_| ())
}

#[tauri::command]
pub async fn inspect_volume(
    runtime: String,
    name: String,
) -> Result<serde_json::Value, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["volume", "inspect", &name])?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Remove unused volumes; returns the CLI summary.
#[tauri::command]
pub async fn prune_volumes(runtime: String) -> Result<String, String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["volume", "prune", "--force"])
}
