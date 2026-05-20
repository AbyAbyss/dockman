// System-wide maintenance and host-integration commands.

/// Reclaim space: stopped containers, dangling images, unused networks and the
/// build cache. Returns the CLI summary.
#[tauri::command]
pub async fn system_prune(runtime: String) -> Result<String, String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["system", "prune", "--force"])
}

/// Open a URL (or file) in the host's default application.
#[tauri::command]
pub async fn open_url(url: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let opener = "xdg-open";

    std::process::Command::new(opener)
        .arg(&url)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Quit the application.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}
