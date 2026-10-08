// Host and engine facts that the UI shows as-is: machine details, `info`,
// `system df`, image layer history, container mounts / addresses, registry
// logins, the Podman machine's resources and the update check.
//
// Everything here is read from the CLIs or from well-known config files.
// Nothing is estimated.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::Write;
use std::path::PathBuf;

// ─── Size parsing ────────────────────────────────────────────────────────────

/// Parse a CLI size string ("7.8MB", "53.25kB", "1.2GiB", "0B (0%)") to bytes.
/// Docker and Podman print decimal units (kB = 1000) except the explicit
/// binary ones (KiB, MiB, GiB).
pub fn parse_size(s: &str) -> u64 {
    let s = s.trim();
    let s = s.split(' ').next().unwrap_or("");
    let num_end = s
        .find(|c: char| !(c.is_ascii_digit() || c == '.'))
        .unwrap_or(s.len());
    let value: f64 = s[..num_end].parse().unwrap_or(0.0);
    let unit = s[num_end..].trim().to_ascii_lowercase();
    let mult: f64 = match unit.as_str() {
        "" | "b" => 1.0,
        "kb" => 1e3,
        "mb" => 1e6,
        "gb" => 1e9,
        "tb" => 1e12,
        "kib" => 1024.0,
        "mib" => 1024.0 * 1024.0,
        "gib" => 1024.0 * 1024.0 * 1024.0,
        "tib" => 1024.0 * 1024.0 * 1024.0 * 1024.0,
        _ => 1.0,
    };
    (value * mult).round() as u64
}

/// Human-readable size, decimal units like the CLIs use.
pub fn format_size(bytes: u64) -> String {
    let b = bytes as f64;
    if b >= 1e9 {
        format!("{:.2} GB", b / 1e9)
    } else if b >= 1e6 {
        format!("{:.1} MB", b / 1e6)
    } else if b >= 1e3 {
        format!("{:.0} kB", b / 1e3)
    } else {
        format!("{bytes} B")
    }
}

/// Read a number that the CLI may print as a JSON number or a string.
fn num(v: Option<&Value>) -> u64 {
    match v {
        Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse().unwrap_or(0),
        _ => 0,
    }
}

fn text(v: Option<&Value>) -> String {
    match v {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::Bool(b)) => b.to_string(),
        _ => String::new(),
    }
}

/// Walk a dotted path into a JSON value.
fn at<'a>(v: &'a Value, path: &str) -> Option<&'a Value> {
    path.split('.').try_fold(v, |cur, key| cur.get(key))
}

// ─── Host ────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HostInfo {
    pub os: String,
    pub os_label: String,
    pub arch: String,
    pub arch_label: String,
    pub docker_source: String,
    pub podman_source: String,
    pub app_version: String,
    pub install_dir: String,
}

/// Facts about the machine Dockman runs on.
#[tauri::command]
pub async fn get_host_info(app: tauri::AppHandle) -> Result<HostInfo, String> {
    let os = std::env::consts::OS.to_string();
    let arch = std::env::consts::ARCH.to_string();
    let os_label = match os.as_str() {
        "macos" => "macOS",
        "windows" => "Windows",
        "linux" => "Linux",
        other => other,
    }
    .to_string();
    let arch_label = match (os.as_str(), arch.as_str()) {
        ("macos", "aarch64") => "Apple Silicon".to_string(),
        ("macos", "x86_64") => "Intel".to_string(),
        (_, "aarch64") => "arm64".to_string(),
        (_, "x86_64") => "x86_64".to_string(),
        (_, a) => a.to_string(),
    };
    Ok(HostInfo {
        docker_source: format!(
            "download.docker.com/{}/static/stable/{arch}",
            super::downloader::docker_os()
        ),
        podman_source: "github.com/containers/podman/releases".to_string(),
        app_version: app.package_info().version.to_string(),
        install_dir: super::home_dir()
            .join(".local")
            .join("bin")
            .to_string_lossy()
            .into_owned(),
        os,
        os_label,
        arch,
        arch_label,
    })
}

// ─── Engine info ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineInfo {
    pub runtime: String,
    pub server_version: String,
    pub ncpu: u64,
    pub mem_total: u64,
    pub os_type: String,
    pub architecture: String,
    pub operating_system: String,
    pub storage_driver: String,
    pub cgroup_version: String,
    pub rootless: bool,
    pub containers_running: u64,
    pub images: u64,
}

/// `info --format json`, normalised across Docker (flat) and Podman (nested).
#[tauri::command]
pub async fn get_engine_info(runtime: String) -> Result<EngineInfo, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["info", "--format", "json"])?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let is_podman = v.get("host").is_some();
    let info = if is_podman {
        let distro = text(at(&v, "host.distribution.distribution"));
        let distro_ver = text(at(&v, "host.distribution.version"));
        EngineInfo {
            runtime: runtime.clone(),
            server_version: text(at(&v, "version.Version")),
            ncpu: num(at(&v, "host.cpus")),
            mem_total: num(at(&v, "host.memTotal")),
            os_type: text(at(&v, "host.os")),
            architecture: text(at(&v, "host.arch")),
            operating_system: format!("{distro} {distro_ver}").trim().to_string(),
            storage_driver: text(at(&v, "store.graphDriverName")),
            cgroup_version: text(at(&v, "host.cgroupVersion")),
            rootless: at(&v, "host.security.rootless")
                .and_then(|b| b.as_bool())
                .unwrap_or(false),
            containers_running: num(at(&v, "store.containerStore.running")),
            images: num(at(&v, "store.imageStore.number")),
        }
    } else {
        let rootless = v
            .get("SecurityOptions")
            .and_then(|a| a.as_array())
            .map(|a| a.iter().any(|s| s.as_str().unwrap_or("").contains("rootless")))
            .unwrap_or(false);
        EngineInfo {
            runtime: runtime.clone(),
            server_version: text(v.get("ServerVersion")),
            ncpu: num(v.get("NCPU")),
            mem_total: num(v.get("MemTotal")),
            os_type: text(v.get("OSType")),
            architecture: text(v.get("Architecture")),
            operating_system: text(v.get("OperatingSystem")),
            storage_driver: text(v.get("Driver")),
            cgroup_version: text(v.get("CgroupVersion")),
            rootless,
            containers_running: num(v.get("ContainersRunning")),
            images: num(v.get("Images")),
        }
    };
    if info.server_version.is_empty() {
        return Err(format!("{runtime} engine is not reachable"));
    }
    Ok(info)
}

// ─── Disk usage ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DfRow {
    /// images | containers | volumes | build_cache
    pub kind: String,
    pub total: u64,
    pub active: u64,
    pub size_bytes: u64,
    pub reclaimable_bytes: u64,
}

/// `system df --format json` rows with sizes in bytes.
#[tauri::command]
pub async fn system_df(runtime: String) -> Result<Vec<DfRow>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["system", "df", "--format", "json"])?;
    Ok(super::parse_json_lines(&raw)
        .iter()
        .map(|r| {
            let kind = match text(r.get("Type")).to_ascii_lowercase().as_str() {
                "images" => "images",
                "containers" => "containers",
                "local volumes" => "volumes",
                "build cache" => "build_cache",
                _ => "other",
            }
            .to_string();
            let size_bytes = match r.get("RawSize") {
                Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
                _ => parse_size(&text(r.get("Size"))),
            };
            let reclaimable_bytes = match r.get("RawReclaimable") {
                Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
                _ => parse_size(&text(r.get("Reclaimable"))),
            };
            DfRow {
                kind,
                total: num(r.get("TotalCount").or(r.get("Total"))),
                active: num(r.get("Active")),
                size_bytes,
                reclaimable_bytes,
            }
        })
        .collect())
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VolumeUsage {
    pub name: String,
    pub links: u64,
    pub size_bytes: u64,
}

/// Per-volume disk usage. Docker prints it as JSON; Podman only prints the
/// verbose table, so that one is parsed from the "Local Volumes" section.
#[tauri::command]
pub async fn volume_usage(runtime: String) -> Result<Vec<VolumeUsage>, String> {
    let bin = super::resolve(&runtime)?;
    if runtime == "docker" {
        let raw = super::run(&bin, &["system", "df", "-v", "--format", "json"])?;
        let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        return Ok(v
            .get("Volumes")
            .and_then(|a| a.as_array())
            .map(|a| {
                a.iter()
                    .map(|r| VolumeUsage {
                        name: text(r.get("Name")),
                        links: num(r.get("Links")),
                        size_bytes: parse_size(&text(r.get("Size"))),
                    })
                    .collect()
            })
            .unwrap_or_default());
    }
    let raw = super::run(&bin, &["system", "df", "-v"])?;
    let mut out = Vec::new();
    let mut in_volumes = false;
    for line in raw.lines() {
        let l = line.trim();
        if l.starts_with("VOLUME NAME") {
            in_volumes = true;
            continue;
        }
        if !in_volumes {
            continue;
        }
        if l.is_empty() {
            break;
        }
        let cols: Vec<&str> = l.split_whitespace().collect();
        if cols.len() >= 3 {
            out.push(VolumeUsage {
                name: cols[0].to_string(),
                links: cols[1].parse().unwrap_or(0),
                size_bytes: parse_size(cols[2]),
            });
        }
    }
    Ok(out)
}

// ─── Image layers ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageLayer {
    pub id: String,
    pub created_by: String,
    pub size_bytes: u64,
    pub created: String,
}

/// `image history` for one image, newest layer first (as the CLIs print it).
#[tauri::command]
pub async fn image_history(runtime: String, id: String) -> Result<Vec<ImageLayer>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["image", "history", "--format", "json", &id])?;
    Ok(super::parse_json_lines(&raw)
        .iter()
        .map(|r| ImageLayer {
            id: text(r.get("ID").or(r.get("id")))
                .trim_start_matches("sha256:")
                .chars()
                .take(12)
                .collect(),
            created_by: text(r.get("CreatedBy")),
            size_bytes: match r.get("Size").or(r.get("size")) {
                Some(Value::Number(n)) => n.as_u64().unwrap_or(0),
                other => parse_size(&text(other)),
            },
            created: text(r.get("CreatedSince").or(r.get("CreatedAt")).or(r.get("Created"))),
        })
        .collect())
}

// ─── Container details (mounts + addresses) ──────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MountInfo {
    /// bind | volume | tmpfs
    pub kind: String,
    pub source: String,
    pub destination: String,
    pub rw: bool,
    /// Volume name for volume mounts.
    pub name: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetworkEndpoint {
    pub network: String,
    pub ip: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ContainerDetail {
    pub id: String,
    pub name: String,
    pub image: String,
    pub status: String,
    pub mounts: Vec<MountInfo>,
    pub networks: Vec<NetworkEndpoint>,
}

/// Inspect every container once and return the parts other pages join on:
/// mounts (bind mounts and volume attachments) and per-network addresses.
#[tauri::command]
pub async fn list_container_details(runtime: String) -> Result<Vec<ContainerDetail>, String> {
    let bin = super::resolve(&runtime)?;
    let ids_raw = super::run(&bin, &["ps", "-a", "-q", "--no-trunc"])?;
    let ids: Vec<&str> = ids_raw.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let mut args = vec!["container", "inspect"];
    args.extend(ids.iter().copied());
    let raw = super::run(&bin, &args)?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let arr = v.as_array().cloned().unwrap_or_default();
    Ok(arr
        .iter()
        .map(|c| {
            let mounts = c
                .get("Mounts")
                .and_then(|m| m.as_array())
                .map(|m| {
                    m.iter()
                        .map(|x| MountInfo {
                            kind: text(x.get("Type")),
                            source: text(x.get("Source")),
                            destination: text(x.get("Destination")),
                            rw: x.get("RW").and_then(|b| b.as_bool()).unwrap_or(true),
                            name: text(x.get("Name")),
                        })
                        .collect()
                })
                .unwrap_or_default();
            let networks = at(c, "NetworkSettings.Networks")
                .and_then(|n| n.as_object())
                .map(|n| {
                    n.iter()
                        .map(|(name, ep)| NetworkEndpoint {
                            network: name.clone(),
                            ip: text(ep.get("IPAddress")),
                        })
                        .collect()
                })
                .unwrap_or_default();
            ContainerDetail {
                id: text(c.get("Id")).chars().take(12).collect(),
                name: text(c.get("Name")).trim_start_matches('/').to_string(),
                image: text(at(c, "Config.Image")),
                status: text(at(c, "State.Status")),
                mounts,
                networks,
            }
        })
        .collect())
}

// ─── Download history ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DownloadEntry {
    pub runtime: String,
    pub version: String,
    pub path: String,
    /// installed | failed
    pub status: String,
    pub message: String,
    /// Unix seconds.
    pub at: u64,
}

fn downloads_path() -> PathBuf {
    super::config_dir().join("downloads.json")
}

pub fn record_download(entry: DownloadEntry) {
    let mut all: Vec<DownloadEntry> = std::fs::read_to_string(downloads_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    all.insert(0, entry);
    all.truncate(50);
    if let Ok(json) = serde_json::to_string_pretty(&all) {
        let _ = std::fs::write(downloads_path(), json);
    }
}

#[tauri::command]
pub async fn list_downloads() -> Result<Vec<DownloadEntry>, String> {
    Ok(std::fs::read_to_string(downloads_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default())
}

// ─── Registries ──────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RegistryLogin {
    pub registry: String,
    /// Which CLI's credential file holds it.
    pub runtime: String,
    pub file: String,
}

fn auth_files() -> Vec<(String, PathBuf)> {
    let home = super::home_dir();
    let mut files = vec![("docker".to_string(), home.join(".docker").join("config.json"))];
    if let Ok(p) = std::env::var("REGISTRY_AUTH_FILE") {
        files.push(("podman".to_string(), PathBuf::from(p)));
    }
    if let Ok(xdg) = std::env::var("XDG_RUNTIME_DIR") {
        files.push(("podman".to_string(), PathBuf::from(xdg).join("containers").join("auth.json")));
    }
    files.push((
        "podman".to_string(),
        home.join(".config").join("containers").join("auth.json"),
    ));
    files
}

/// Registries with stored credentials, read from the Docker and Podman auth
/// files. With a credential store Docker keeps the registry key and leaves
/// the secret to the helper, so the key alone is the sign-in record.
#[tauri::command]
pub async fn list_registry_logins() -> Result<Vec<RegistryLogin>, String> {
    let mut out: Vec<RegistryLogin> = Vec::new();
    for (runtime, path) in auth_files() {
        let Ok(raw) = std::fs::read_to_string(&path) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&raw) else { continue };
        if let Some(auths) = v.get("auths").and_then(|a| a.as_object()) {
            for registry in auths.keys() {
                let reg = registry
                    .trim_start_matches("https://")
                    .trim_start_matches("http://")
                    .trim_end_matches('/')
                    .to_string();
                if out.iter().any(|r| r.registry == reg && r.runtime == runtime) {
                    continue;
                }
                out.push(RegistryLogin {
                    registry: reg,
                    runtime: runtime.clone(),
                    file: path.to_string_lossy().into_owned(),
                });
            }
        }
    }
    Ok(out)
}

/// `login -u user --password-stdin registry`. The password never touches the
/// command line.
#[tauri::command]
pub async fn registry_login(
    runtime: String,
    registry: String,
    username: String,
    password: String,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut child = std::process::Command::new(&bin)
        .args(["login", "-u", &username, "--password-stdin", &registry])
        .env("PATH", super::shell_path())
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to run {bin}: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(password.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[tauri::command]
pub async fn registry_logout(runtime: String, registry: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["logout", &registry]).map(|_| ())
}

// ─── Engine resources ────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineResources {
    pub runtime: String,
    pub cpus: u64,
    pub memory_mb: u64,
    pub disk_gb: u64,
    /// True only for a Podman machine, which `podman machine set` can resize.
    pub editable: bool,
    pub source: String,
}

/// What the engine has to work with. A Podman machine reports its VM
/// settings; everything else reports what `info` sees.
#[tauri::command]
pub async fn get_engine_resources(runtime: String) -> Result<EngineResources, String> {
    let bin = super::resolve(&runtime)?;
    if runtime == "podman" && cfg!(any(target_os = "macos", target_os = "windows")) {
        let raw = super::run(&bin, &["machine", "inspect"])?;
        let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
        let m = v
            .as_array()
            .and_then(|a| a.first())
            .ok_or_else(|| "no podman machine".to_string())?;
        return Ok(EngineResources {
            runtime,
            cpus: num(at(m, "Resources.CPUs")),
            memory_mb: num(at(m, "Resources.Memory")),
            disk_gb: num(at(m, "Resources.DiskSize")),
            editable: true,
            source: format!("podman machine {}", text(m.get("Name"))),
        });
    }
    let info = get_engine_info(runtime.clone()).await?;
    Ok(EngineResources {
        runtime,
        cpus: info.ncpu,
        memory_mb: info.mem_total / (1024 * 1024),
        disk_gb: 0,
        editable: false,
        source: format!("{} engine", info.operating_system),
    })
}

/// Resize the Podman machine. The VM must be stopped to change CPUs / memory,
/// so this stops it, applies the settings and starts it again.
#[tauri::command]
pub async fn set_machine_resources(
    cpus: u64,
    memory_mb: u64,
    disk_gb: u64,
) -> Result<(), String> {
    let bin = super::resolve("podman")?;
    let _ = super::run(&bin, &["machine", "stop"]);
    let cpus_s = cpus.to_string();
    let mem_s = memory_mb.to_string();
    let disk_s = disk_gb.to_string();
    let mut args = vec!["machine", "set", "--cpus", &cpus_s, "--memory", &mem_s];
    if disk_gb > 0 {
        args.push("--disk-size");
        args.push(&disk_s);
    }
    super::run(&bin, &args)?;
    super::run(&bin, &["machine", "start"]).map(|_| ())
}

// ─── Update check ────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub current: String,
    pub latest: String,
    pub url: String,
    pub update_available: bool,
}

/// Compare the running version with the latest GitHub release.
#[tauri::command]
pub async fn check_for_update(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    let current = app.package_info().version.to_string();
    let raw = super::run(
        "curl",
        &[
            "-fsSL",
            "-A",
            "Dockman",
            "-H",
            "Accept: application/vnd.github+json",
            "https://api.github.com/repos/AbyAbyss/dockman/releases/latest",
        ],
    )?;
    let v: Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let latest = text(v.get("tag_name")).trim_start_matches('v').to_string();
    if latest.is_empty() {
        return Err("no release found".to_string());
    }
    let url = text(v.get("html_url"));
    let update_available =
        super::downloader::cmp_version(&latest, &current) == std::cmp::Ordering::Greater;
    Ok(UpdateInfo {
        current,
        latest,
        url,
        update_available,
    })
}

// ─── Files ───────────────────────────────────────────────────────────────────

/// Write a text file (used to save Dockerfile edits back to disk).
#[tauri::command]
pub async fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(super::expand_home(&path), content).map_err(|e| e.to_string())
}
