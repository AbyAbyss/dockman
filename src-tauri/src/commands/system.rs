// System-wide maintenance and host-integration commands.

use tauri::Manager;

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

/// Toggle native window translucency: macOS vibrancy / Windows acrylic.
/// The frosted backdrop is a native effect; the frontend additionally controls
/// how much of it shows through via CSS alpha.
#[tauri::command]
pub fn set_window_translucent(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Main window not found".to_string())?;

    #[cfg(target_os = "macos")]
    {
        if enabled {
            window_vibrancy::apply_vibrancy(
                &window,
                window_vibrancy::NSVisualEffectMaterial::HudWindow,
                None,
                None,
            )
            .map_err(|e| e.to_string())?;
        } else {
            window_vibrancy::clear_vibrancy(&window).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(target_os = "windows")]
    {
        if enabled {
            window_vibrancy::apply_acrylic(&window, None).map_err(|e| e.to_string())?;
        } else {
            window_vibrancy::clear_acrylic(&window).map_err(|e| e.to_string())?;
        }
    }

    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (enabled, window);
    }

    Ok(())
}
