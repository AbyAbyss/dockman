// Network commands — listing and inspection.

/// List networks for the given runtime.
#[tauri::command]
pub async fn list_networks(runtime: String) -> Result<Vec<serde_json::Value>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["network", "ls", "--format", "json"])?;
    Ok(super::parse_json_lines(&raw))
}

/// Full inspect JSON for a single network.
#[tauri::command]
pub async fn inspect_network(
    runtime: String,
    name: String,
) -> Result<serde_json::Value, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["network", "inspect", &name])?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}
