// Runtime detection, runtime-mode/path config, daemon control and autostart.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeInfo {
    pub runtime: String,
    pub found: bool,
    pub path: String,
    pub version: String,
    pub is_running: bool,
    pub arch: String,
    pub compose_available: bool,
}

// ─── Persisted config (~/.config/dockman/config.json) ────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
struct Config {
    #[serde(default)]
    mode: Option<String>,
    #[serde(default)]
    docker_path: Option<String>,
    #[serde(default)]
    podman_path: Option<String>,
}

fn config_path() -> PathBuf {
    super::config_dir().join("config.json")
}

fn read_config() -> Config {
    std::fs::read_to_string(config_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_config(c: &Config) -> Result<(), String> {
    let json = serde_json::to_string_pretty(c).map_err(|e| e.to_string())?;
    std::fs::write(config_path(), json).map_err(|e| e.to_string())
}

fn custom_path(runtime: &str) -> Option<String> {
    let cfg = read_config();
    let p = match runtime {
        "docker" => cfg.docker_path,
        "podman" => cfg.podman_path,
        _ => None,
    }?;
    if !p.is_empty() && std::path::Path::new(&p).exists() {
        Some(p)
    } else {
        None
    }
}

// ─── Detection ───────────────────────────────────────────────────────────────

/// Detect a single runtime: locate the binary, read its version, probe whether
/// the engine is reachable and whether `compose` is available.
#[tauri::command]
pub async fn detect_runtime(runtime: String) -> Result<RuntimeInfo, String> {
    let arch = std::env::consts::ARCH.to_string();

    let path = match custom_path(&runtime).or_else(|| super::resolve(&runtime).ok()) {
        Some(p) => p,
        None => {
            return Ok(RuntimeInfo {
                runtime,
                found: false,
                path: String::new(),
                version: String::new(),
                is_running: false,
                arch,
                compose_available: false,
            });
        }
    };

    let version = super::run(&path, &["version", "--format", "{{.Client.Version}}"])
        .map(|s| s.trim().to_string())
        .unwrap_or_default();
    let is_running = super::run(&path, &["info"]).is_ok();
    let compose_available = super::run(&path, &["compose", "version"]).is_ok();

    Ok(RuntimeInfo {
        runtime,
        found: true,
        path,
        version,
        is_running,
        arch,
        compose_available,
    })
}

/// Detect every supported runtime at once.
#[tauri::command]
pub async fn detect_all_runtimes() -> Result<Vec<RuntimeInfo>, String> {
    let mut out = Vec::new();
    for rt in ["docker", "podman"] {
        out.push(detect_runtime(rt.to_string()).await?);
    }
    Ok(out)
}

// ─── Mode + path config ──────────────────────────────────────────────────────

#[tauri::command]
pub async fn get_runtime_mode() -> Result<String, String> {
    Ok(read_config().mode.unwrap_or_else(|| "all".to_string()))
}

#[tauri::command]
pub async fn set_runtime_mode(mode: String) -> Result<(), String> {
    let mut cfg = read_config();
    cfg.mode = Some(mode);
    write_config(&cfg)
}

#[tauri::command]
pub async fn get_runtime_path(runtime: String) -> Result<String, String> {
    let cfg = read_config();
    Ok(match runtime.as_str() {
        "docker" => cfg.docker_path.unwrap_or_default(),
        "podman" => cfg.podman_path.unwrap_or_default(),
        _ => String::new(),
    })
}

/// Open a native file picker for a runtime binary and, if the user picks one,
/// persist it as that runtime's path. Returns the chosen path, or `None` when
/// the dialog was cancelled.
#[tauri::command]
pub async fn pick_runtime_path(
    app: tauri::AppHandle,
    runtime: String,
) -> Result<Option<String>, String> {
    let picked = app.dialog().file().blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file.to_string();
    set_runtime_path(runtime, path.clone()).await?;
    Ok(Some(path))
}

#[tauri::command]
pub async fn set_runtime_path(runtime: String, path: String) -> Result<(), String> {
    let mut cfg = read_config();
    match runtime.as_str() {
        "docker" => cfg.docker_path = Some(path),
        "podman" => cfg.podman_path = Some(path),
        other => return Err(format!("unknown runtime: {other}")),
    }
    write_config(&cfg)
}

// ─── Daemon control ──────────────────────────────────────────────────────────

/// Podman's `machine` on macOS needs helper binaries (gvproxy, vfkit) that are
/// not part of the CLI. Download the official ones into a known directory and
/// return that directory's path.
#[cfg(target_os = "macos")]
fn ensure_podman_helpers() -> Result<String, String> {
    let home = std::env::var("HOME").map_err(|_| "no home directory".to_string())?;
    let dir = std::path::PathBuf::from(&home)
        .join(".local")
        .join("libexec")
        .join("podman");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let helpers = [
        (
            "gvproxy",
            "https://github.com/containers/gvisor-tap-vsock/releases/latest/download/gvproxy-darwin",
        ),
        (
            "vfkit",
            "https://github.com/crc-org/vfkit/releases/latest/download/vfkit",
        ),
    ];
    for (name, url) in helpers {
        let dest = dir.join(name);
        if dest.exists() {
            continue;
        }
        let dest_s = dest.to_string_lossy().into_owned();
        super::run("curl", &["-fSL", url, "-o", &dest_s])
            .map_err(|e| format!("could not download helper '{name}': {e}"))?;
        let _ = super::run("chmod", &["+x", &dest_s]);
    }
    Ok(dir.to_string_lossy().into_owned())
}

/// Register the helper directory in podman's containers.conf so any podman
/// binary can locate gvproxy / vfkit.
#[cfg(target_os = "macos")]
fn register_helper_dir(helpers_dir: &str) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "no home directory".to_string())?;
    let conf_dir = std::path::PathBuf::from(&home)
        .join(".config")
        .join("containers");
    std::fs::create_dir_all(&conf_dir).map_err(|e| e.to_string())?;
    let conf = conf_dir.join("containers.conf");
    let existing = std::fs::read_to_string(&conf).unwrap_or_default();
    if existing.contains("helper_binaries_dir") {
        return Ok(());
    }
    let key = format!("helper_binaries_dir = [\"{helpers_dir}\"]");
    let updated = if existing.trim().is_empty() {
        format!("[engine]\n{key}\n")
    } else if let Some(pos) = existing.find("[engine]") {
        let after = pos + "[engine]".len();
        let line_end = existing[after..]
            .find('\n')
            .map(|i| after + i + 1)
            .unwrap_or(existing.len());
        format!("{}{}\n{}", &existing[..line_end], key, &existing[line_end..])
    } else {
        format!("{existing}\n[engine]\n{key}\n")
    };
    std::fs::write(&conf, updated).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn start_runtime_daemon(runtime: String) -> Result<(), String> {
    match runtime.as_str() {
        "podman" => {
            let bin = super::resolve("podman")?;

            // podman machine on macOS needs gvproxy + vfkit helper binaries.
            #[cfg(target_os = "macos")]
            {
                let helpers = ensure_podman_helpers()?;
                register_helper_dir(&helpers)?;
            }

            // A Podman machine (Linux VM) must exist before it can be started.
            let machines = super::run(&bin, &["machine", "list", "--format", "json"])
                .map(|s| super::parse_json_lines(&s))
                .unwrap_or_default();
            if machines.is_empty() {
                super::run(&bin, &["machine", "init"])
                    .map_err(|e| format!("podman machine init failed: {e}"))?;
            }
            match super::run(&bin, &["machine", "start"]) {
                Ok(_) => Ok(()),
                Err(e) if e.contains("already running") => Ok(()),
                Err(e) => Err(format!("podman machine start failed: {e}")),
            }
        }
        "docker" => {
            // The standalone CLI omits the registry credential helper — fetch it.
            let _ = super::ensure_docker_helpers();
            // macOS has no native Docker daemon — `dockerd` is Linux-only, so a
            // Docker engine is always a Linux VM. First launch a desktop engine
            // app if one is installed (OrbStack / Docker Desktop / Rancher).
            for app in ["OrbStack", "Docker", "Rancher Desktop"] {
                let launched = std::process::Command::new("open")
                    .args(["-a", app])
                    .status()
                    .map(|s| s.success())
                    .unwrap_or(false);
                if launched {
                    return Ok(());
                }
            }
            // Otherwise fall back to Colima — a CLI-managed Docker VM, the
            // headless equivalent of `podman machine`. First run is slow: it
            // boots a Linux VM with dockerd inside.
            if let Some(colima) = super::which_optional("colima") {
                return super::run(&colima, &["start"])
                    .map(|_| ())
                    .map_err(|e| {
                        if e.contains("already running") {
                            String::new()
                        } else {
                            format!("colima start failed: {e}")
                        }
                    })
                    .or_else(|e| if e.is_empty() { Ok(()) } else { Err(e) });
            }
            Err("no Docker engine found — open OrbStack or Docker Desktop, or \
                 run `brew install colima` for a CLI-managed Docker daemon"
                .to_string())
        }
        other => Err(format!("unknown runtime: {other}")),
    }
}

#[tauri::command]
pub async fn stop_runtime_daemon(runtime: String) -> Result<(), String> {
    match runtime.as_str() {
        "podman" => {
            let bin = super::resolve("podman")?;
            super::run(&bin, &["machine", "stop"]).map(|_| ())
        }
        "docker" => Ok(()),
        other => Err(format!("unknown runtime: {other}")),
    }
}

// ─── Autostart ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn set_start_on_login(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let mgr = app.autolaunch();
    if enabled {
        mgr.enable().map_err(|e| e.to_string())
    } else {
        mgr.disable().map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub async fn get_start_on_login(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

// ─── Setup status + reset ────────────────────────────────────────────────────

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub runtime: String,
    pub cli_installed: bool,
    pub cli_version: String,
    pub engine_running: bool,
    pub helpers_ready: bool,
    pub machine_exists: bool,
    pub engine_app: String,
}

/// Granular setup status powering the install checklist.
#[tauri::command]
pub async fn get_setup_status(runtime: String) -> Result<SetupStatus, String> {
    let path = custom_path(&runtime).or_else(|| super::resolve(&runtime).ok());
    let cli_installed = path.is_some();
    let bin = path.unwrap_or_default();

    let cli_version = if cli_installed {
        super::run(&bin, &["version", "--format", "{{.Client.Version}}"])
            .map(|s| s.trim().to_string())
            .unwrap_or_default()
    } else {
        String::new()
    };
    let engine_running =
        cli_installed && super::run(&bin, &["info"]).is_ok();

    let mut helpers_ready = false;
    let mut machine_exists = false;
    let mut engine_app = String::new();

    if runtime == "podman" {
        let home = std::env::var("HOME").unwrap_or_default();
        let hdir = std::path::Path::new(&home)
            .join(".local")
            .join("libexec")
            .join("podman");
        helpers_ready = engine_running
            || (hdir.join("gvproxy").exists() && hdir.join("vfkit").exists());
        if cli_installed {
            machine_exists = super::run(&bin, &["machine", "list", "--format", "json"])
                .map(|s| !super::parse_json_lines(&s).is_empty())
                .unwrap_or(false);
        }
    } else if runtime == "docker" {
        let home = std::env::var("HOME").unwrap_or_default();
        let app_exists = |name: &str| {
            std::path::Path::new(&format!("/Applications/{name}.app")).exists()
                || std::path::Path::new(&format!("{home}/Applications/{name}.app"))
                    .exists()
        };
        if app_exists("OrbStack") {
            engine_app = "OrbStack".to_string();
        } else if app_exists("Docker") {
            engine_app = "Docker Desktop".to_string();
        } else if super::which_optional("colima").is_some() {
            engine_app = "Colima".to_string();
        } else if engine_running {
            // Engine is reachable but provided by something we don't recognise.
            engine_app = "running".to_string();
        }
    }

    Ok(SetupStatus {
        runtime,
        cli_installed,
        cli_version,
        engine_running,
        helpers_ready,
        machine_exists,
        engine_app,
    })
}

/// Remove the Dockman-installed binary (and Podman's helpers) — a clean reset.
/// System / Homebrew installs are never touched.
#[tauri::command]
pub async fn remove_binary(runtime: String) -> Result<(), String> {
    let home = std::env::var("HOME").map_err(|_| "no home directory".to_string())?;
    let bin = std::path::PathBuf::from(&home)
        .join(".local")
        .join("bin")
        .join(&runtime);
    let existed = bin.exists();
    if existed {
        std::fs::remove_file(&bin).map_err(|e| e.to_string())?;
    }
    if runtime == "podman" {
        let helpers = std::path::PathBuf::from(&home)
            .join(".local")
            .join("libexec")
            .join("podman");
        let _ = std::fs::remove_dir_all(&helpers);
    }
    // Clear the recorded custom path so detection falls back to PATH.
    let mut cfg = read_config();
    match runtime.as_str() {
        "docker" => cfg.docker_path = None,
        "podman" => cfg.podman_path = None,
        _ => {}
    }
    let _ = write_config(&cfg);

    if existed {
        Ok(())
    } else {
        Err(format!(
            "no Dockman-installed {runtime} binary found in ~/.local/bin"
        ))
    }
}
