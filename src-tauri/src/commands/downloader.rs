// Binary downloader — fetches the official standalone Docker / Podman CLI.
//
//   Docker  → download.docker.com static binaries
//   Podman  → github.com/containers/podman release assets
//
// Network and archive work is delegated to `curl`, `tar` and `unzip`, so no
// extra crates are required. Downloads run on a background thread and report
// progress over the `download-progress` event.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BinaryRelease {
    pub version: String,
    pub url: String,
    pub platform: String,
    pub arch: String,
}

/// download.docker.com path component for the current OS.
pub(crate) fn docker_os() -> &'static str {
    match std::env::consts::OS {
        "macos" => "mac",
        "windows" => "win",
        _ => "linux",
    }
}

/// Compare two dotted numeric version strings (e.g. "26.1.4").
pub(crate) fn cmp_version(a: &str, b: &str) -> std::cmp::Ordering {
    let pa: Vec<u32> = a.split('.').filter_map(|s| s.parse().ok()).collect();
    let pb: Vec<u32> = b.split('.').filter_map(|s| s.parse().ok()).collect();
    pa.cmp(&pb)
}

/// Scrape the Docker static-binary index for stable releases.
fn docker_releases() -> Result<Vec<BinaryRelease>, String> {
    let os = docker_os();
    let arch = std::env::consts::ARCH.to_string();
    let ext = if os == "win" { ".zip" } else { ".tgz" };
    let base = format!("https://download.docker.com/{os}/static/stable/{arch}/");
    let html = super::run("curl", &["-fsSL", &base])?;

    let mut versions: Vec<String> = Vec::new();
    let mut rest = html.as_str();
    while let Some(idx) = rest.find("docker-") {
        rest = &rest[idx + "docker-".len()..];
        if let Some(end) = rest.find(ext) {
            let ver = &rest[..end];
            // Stable versions only — digits and dots, no "-rc"/"-beta".
            if !ver.is_empty()
                && ver.chars().all(|c| c.is_ascii_digit() || c == '.')
                && !versions.iter().any(|v| v == ver)
            {
                versions.push(ver.to_string());
            }
        }
    }
    versions.sort_by(|a, b| cmp_version(b, a));
    versions.truncate(6);

    Ok(versions
        .into_iter()
        .map(|v| BinaryRelease {
            url: format!("{base}docker-{v}{ext}"),
            version: v,
            platform: os.to_string(),
            arch: arch.clone(),
        })
        .collect())
}

/// Read Podman release assets from the GitHub API.
fn podman_releases() -> Result<Vec<BinaryRelease>, String> {
    let raw = super::run(
        "curl",
        &[
            "-fsSL",
            "-A",
            "Dockman",
            "-H",
            "Accept: application/vnd.github+json",
            "https://api.github.com/repos/containers/podman/releases?per_page=15",
        ],
    )?;
    let json: serde_json::Value =
        serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let arr = json
        .as_array()
        .ok_or_else(|| "unexpected GitHub response".to_string())?;

    let want_os = match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "windows",
        _ => "linux",
    };
    let want_arch = match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        other => other,
    };

    let mut out = Vec::new();
    for rel in arr {
        if rel
            .get("prerelease")
            .and_then(|p| p.as_bool())
            .unwrap_or(false)
        {
            continue;
        }
        let version = rel
            .get("tag_name")
            .and_then(|t| t.as_str())
            .unwrap_or("")
            .trim_start_matches('v')
            .to_string();
        if version.is_empty() {
            continue;
        }
        let url = rel
            .get("assets")
            .and_then(|a| a.as_array())
            .and_then(|assets| {
                assets.iter().find_map(|asset| {
                    let name = asset
                        .get("name")
                        .and_then(|n| n.as_str())?
                        .to_lowercase();
                    if name.contains(want_os)
                        && name.contains(want_arch)
                        && (name.ends_with(".zip") || name.ends_with(".tar.gz"))
                    {
                        asset
                            .get("browser_download_url")
                            .and_then(|u| u.as_str())
                            .map(String::from)
                    } else {
                        None
                    }
                })
            });
        if let Some(url) = url {
            out.push(BinaryRelease {
                version,
                url,
                platform: std::env::consts::OS.to_string(),
                arch: std::env::consts::ARCH.to_string(),
            });
        }
        if out.len() >= 6 {
            break;
        }
    }
    Ok(out)
}

/// List available official CLI releases for a runtime.
#[tauri::command]
pub async fn get_available_releases(
    runtime: String,
) -> Result<Vec<BinaryRelease>, String> {
    match runtime.as_str() {
        "docker" => docker_releases(),
        "podman" => podman_releases(),
        other => Err(format!("unknown runtime: {other}")),
    }
}

/// Default install directory for downloaded binaries (`~/.local/bin`).
#[tauri::command]
pub async fn get_default_install_dir() -> Result<String, String> {
    let dir = super::home_dir().join(".local").join("bin");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// Verify an installed binary by running `{path} --version`, which works
/// without a running engine (plain `version` errors when the daemon is down).
#[tauri::command]
pub async fn verify_binary(path: String) -> Result<String, String> {
    super::run(&path, &["--version"])
        .map(|s| s.lines().next().unwrap_or("").trim().to_string())
}

/// Run the installed binary and check it reports the requested version.
fn verify_installed(path: &str, version: &str) -> Result<String, String> {
    let out = super::run(path, &["--version"])?;
    let line = out.lines().next().unwrap_or("").trim().to_string();
    if line.contains(version) {
        Ok(line)
    } else {
        Err(format!("expected version {version}, binary reports \"{line}\""))
    }
}

/// Locate the runtime's CLI inside an extracted release archive. Podman's
/// Linux asset ships `podman-remote-static-linux_<arch>`, macOS / Windows
/// ship `podman` / `podman.exe`, Docker ships `docker/docker(.exe)`.
fn find_binary(dir: &std::path::Path, runtime: &str) -> Option<PathBuf> {
    let mut files = Vec::new();
    collect_files(dir, &mut files);
    let name_of = |p: &PathBuf| {
        p.file_name()
            .map(|n| n.to_string_lossy().to_lowercase())
            .unwrap_or_default()
    };
    let exact = [runtime.to_string(), format!("{runtime}.exe")];
    if let Some(p) = files.iter().find(|p| exact.contains(&name_of(p))) {
        return Some(p.clone());
    }
    if runtime == "podman" {
        return files
            .iter()
            .find(|p| {
                let n = name_of(p);
                n.starts_with("podman-remote") && !n.ends_with(".1") && !n.ends_with(".md")
            })
            .cloned();
    }
    None
}

fn collect_files(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let p = e.path();
        if p.is_dir() {
            collect_files(&p, out);
        } else {
            out.push(p);
        }
    }
}

/// Make the install directory part of the user's PATH for new shells.
/// Unix: appended to the zsh / bash rc files and fish's config. Windows:
/// written to the user-scope Path through PowerShell.
#[tauri::command]
pub async fn add_to_path(dir: String) -> Result<(), String> {
    use std::io::Write;
    if cfg!(windows) {
        let script = format!(
            "$p=[Environment]::GetEnvironmentVariable('Path','User'); \
             if (($p -split ';') -notcontains '{dir}') {{ \
               [Environment]::SetEnvironmentVariable('Path', ($p.TrimEnd(';') + ';{dir}'), 'User') }}"
        );
        return super::run("powershell", &["-NoProfile", "-Command", &script]).map(|_| ());
    }
    let home = super::home_dir();
    let targets: [(PathBuf, String); 4] = [
        (home.join(".zshrc"), format!("\n# added by Dockman\nexport PATH=\"$PATH:{dir}\"\n")),
        (home.join(".bashrc"), format!("\n# added by Dockman\nexport PATH=\"$PATH:{dir}\"\n")),
        (home.join(".profile"), format!("\n# added by Dockman\nexport PATH=\"$PATH:{dir}\"\n")),
        (
            home.join(".config").join("fish").join("config.fish"),
            format!("\n# added by Dockman\nfish_add_path {dir}\n"),
        ),
    ];
    for (rc, line) in targets {
        // Only touch rc files that already exist, except the ones every
        // account has; never create a fish config for a user without fish.
        let is_fish = rc.ends_with("config.fish");
        if is_fish && !rc.exists() {
            continue;
        }
        let existing = std::fs::read_to_string(&rc).unwrap_or_default();
        if existing.contains(&dir) {
            continue;
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&rc) {
            let _ = f.write_all(line.as_bytes());
        }
    }
    Ok(())
}

/// Download and install an official CLI binary. Returns immediately; progress
/// is reported on `download-progress` as `{ runtime, phase, percent, message }`.
#[tauri::command]
pub async fn download_binary(
    app: tauri::AppHandle,
    runtime: String,
    version: String,
    url: String,
    install_dir: String,
) -> Result<(), String> {
    if url.is_empty() {
        return Err("no download URL for this release".to_string());
    }

    std::thread::spawn(move || {
        let runtime_for_log = runtime.clone();
        let version_for_log = version.clone();
        let app_for_progress = app.clone();
        let progress = move |phase: &str, percent: u32, message: &str| {
            if phase == "done" || phase == "error" {
                let now = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_secs())
                    .unwrap_or(0);
                super::host::record_download(super::host::DownloadEntry {
                    runtime: runtime_for_log.clone(),
                    version: version_for_log.clone(),
                    path: if phase == "done" { message.to_string() } else { String::new() },
                    status: if phase == "done" { "installed".into() } else { "failed".into() },
                    message: if phase == "error" { message.to_string() } else { String::new() },
                    at: now,
                });
            }
            let _ = app_for_progress.emit(
                "download-progress",
                serde_json::json!({
                    "runtime": runtime_for_log,
                    "phase": phase,
                    "percent": percent,
                    "message": message,
                }),
            );
        };

        progress("downloading", 10, "");
        let ext = if url.ends_with(".zip") { "zip" } else { "tgz" };
        let tmp = std::env::temp_dir().join(format!("dockman-{runtime}-{version}.{ext}"));
        let tmp_s = tmp.to_string_lossy().into_owned();
        if let Err(e) = super::run("curl", &["-fSL", &url, "-o", &tmp_s]) {
            progress("error", 0, &format!("download failed: {e}"));
            return;
        }

        progress("extracting", 55, "");
        let extract_dir =
            std::env::temp_dir().join(format!("dockman-extract-{runtime}-{version}"));
        let _ = std::fs::remove_dir_all(&extract_dir);
        if std::fs::create_dir_all(&extract_dir).is_err() {
            progress("error", 0, "could not create a temp directory");
            return;
        }
        let ed = extract_dir.to_string_lossy().into_owned();
        let extracted = if ext == "zip" && cfg!(windows) {
            super::run("tar", &["-xf", &tmp_s, "-C", &ed]).is_ok()
        } else if ext == "zip" {
            super::run("unzip", &["-o", "-q", &tmp_s, "-d", &ed]).is_ok()
        } else {
            super::run("tar", &["-xzf", &tmp_s, "-C", &ed]).is_ok()
        };
        if !extracted {
            progress("error", 0, "could not extract the archive");
            return;
        }

        progress("installing", 75, "");
        let bin = match find_binary(&extract_dir, &runtime) {
            Some(b) => b,
            None => {
                progress("error", 0, "binary not found inside the archive");
                return;
            }
        };

        let _ = std::fs::create_dir_all(&install_dir);
        let dest = PathBuf::from(&install_dir)
            .join(format!("{runtime}{}", std::env::consts::EXE_SUFFIX));
        if let Err(e) = std::fs::copy(&bin, &dest) {
            progress("error", 0, &format!("install failed: {e}"));
            return;
        }
        let dest_s = dest.to_string_lossy().into_owned();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Err(e) =
                std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755))
            {
                progress("error", 0, &format!("could not make {dest_s} executable: {e}"));
                return;
            }
        }
        let _ = std::fs::remove_file(&tmp);
        let _ = std::fs::remove_dir_all(&extract_dir);

        // Run the installed file to prove it executes on this machine and is
        // the version that was asked for. `--version` needs no engine.
        progress("verifying", 90, "");
        if let Err(e) = verify_installed(&dest_s, &version) {
            progress(
                "error",
                0,
                &format!("installed to {dest_s} but it failed verification: {e}"),
            );
            return;
        }

        progress("done", 100, &dest_s);
    });

    Ok(())
}
