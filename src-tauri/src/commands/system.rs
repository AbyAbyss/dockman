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

/// Static host facts for the resource meters.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub cores: usize,
    pub mem_total_bytes: u64,
    pub disk_total_bytes: u64,
    pub disk_free_bytes: u64,
}

/// CPU core count, total RAM and disk size / free space for the volume
/// holding $HOME. Unknown values come back as 0.
#[tauri::command]
pub async fn host_info() -> Result<HostInfo, String> {
    let cores = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(0);

    #[cfg(target_os = "macos")]
    let mem_total_bytes = super::run("/usr/sbin/sysctl", &["-n", "hw.memsize"])
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0);
    #[cfg(not(target_os = "macos"))]
    let mem_total_bytes = std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines()
                .find(|l| l.starts_with("MemTotal:"))
                .and_then(|l| l.split_whitespace().nth(1))
                .and_then(|kb| kb.parse::<u64>().ok())
        })
        .map(|kb| kb * 1024)
        .unwrap_or(0);

    // `df -kP` prints a header, then: filesystem, 1K-blocks, used, available, …
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".to_string());
    let (disk_total_bytes, disk_free_bytes) = super::run("df", &["-kP", &home])
        .ok()
        .and_then(|out| {
            let line = out.lines().nth(1)?.to_string();
            let cols: Vec<&str> = line.split_whitespace().collect();
            let total: u64 = cols.get(1)?.parse().ok()?;
            let free: u64 = cols.get(3)?.parse().ok()?;
            Some((total * 1024, free * 1024))
        })
        .unwrap_or((0, 0));

    Ok(HostInfo {
        cores,
        mem_total_bytes,
        disk_total_bytes,
        disk_free_bytes,
    })
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
