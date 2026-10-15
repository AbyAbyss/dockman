// Container commands — listing, lifecycle, inspection and streaming
// logs / stats. List output is returned as raw JSON values because Docker and
// Podman emit slightly different shapes; the frontend normalises them.

use super::problems::{Failure, Problem};
use super::Registry;

// ─── Listing ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_containers(
    runtime: String,
    all: bool,
) -> Result<Vec<serde_json::Value>, String> {
    let bin = super::resolve(&runtime)?;
    let mut args = vec!["ps", "--format", "json"];
    if all {
        args.push("--all");
    }
    let raw = super::run(&bin, &args)?;
    Ok(super::parse_json_lines(&raw))
}

/// One-shot resource snapshot for all running containers (`stats --no-stream`).
#[tauri::command]
pub async fn list_container_stats(
    runtime: String,
) -> Result<Vec<serde_json::Value>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["stats", "--no-stream", "--format", "json"])?;
    Ok(super::parse_json_lines(&raw))
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn start_container(runtime: String, id: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["start", &id]).map(|_| ())
}

#[tauri::command]
pub async fn stop_container(runtime: String, id: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["stop", &id]).map(|_| ())
}

#[tauri::command]
pub async fn restart_container(runtime: String, id: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["restart", &id]).map(|_| ())
}

#[tauri::command]
pub async fn pause_container(runtime: String, id: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["pause", &id]).map(|_| ())
}

#[tauri::command]
pub async fn unpause_container(runtime: String, id: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["unpause", &id]).map(|_| ())
}

#[tauri::command]
pub async fn remove_container(runtime: String, id: String, force: bool) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args = vec!["rm"];
    if force {
        args.push("--force");
    }
    args.push(&id);
    super::run(&bin, &args).map(|_| ())
}

// ─── Inspection ──────────────────────────────────────────────────────────────

#[tauri::command]
pub async fn inspect_container(
    runtime: String,
    id: String,
) -> Result<serde_json::Value, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["inspect", &id])?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

/// Environment variables from the container's `.Config.Env`.
#[tauri::command]
pub async fn get_container_env(
    runtime: String,
    id: String,
) -> Result<Vec<String>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["inspect", &id])?;
    let v: serde_json::Value = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let env = v
        .get(0)
        .and_then(|c| c.get("Config"))
        .and_then(|c| c.get("Env"))
        .and_then(|e| e.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    Ok(env)
}

/// What `run_container` reports back: the new id, whether the image is
/// running under emulation (and which platform was used), and a diagnosed
/// problem when the container died right after starting.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub id: String,
    pub emulated: bool,
    pub platform: Option<String>,
    pub problem: Option<Problem>,
}

/// A detached container that exits non-zero within a few seconds of starting
/// usually died in its entrypoint. Fetch its last log lines and diagnose them.
fn early_exit_problem(bin: &str, runtime: &str, image: &str, id: &str) -> Option<Problem> {
    for wait_ms in [1000u64, 1500, 2500] {
        std::thread::sleep(std::time::Duration::from_millis(wait_ms));
        let state = super::run(
            bin,
            &["inspect", "--format", "{{.State.Status}} {{.State.ExitCode}}", id],
        )
        .ok()?;
        let mut parts = state.split_whitespace();
        let status = parts.next().unwrap_or("");
        let code = parts.next().unwrap_or("0");
        if status == "running" {
            continue;
        }
        if code == "0" {
            return None;
        }
        let logs = super::run_capture(bin, &["logs", "--tail", "40", id]).ok()?;
        let text = format!("{}\n{}", logs.stdout, logs.stderr);
        let rootless = runtime == "podman"
            && super::run(bin, &["machine", "inspect", "--format", "{{.Rootful}}"])
                .map(|s| s.trim() != "true")
                .unwrap_or(false);
        return super::problems::diagnose_exit(runtime, rootless, Some(image), Some(id), &text);
    }
    None
}

/// Create and start a container.
///
/// When the image has no build for this Mac's architecture, the run is
/// retried with `--platform` for the architecture it does have and the
/// result is marked `emulated` — the same thing dockerd does on its own, and
/// the one flag podman makes you type by hand.
#[tauri::command]
pub async fn run_container(
    runtime: String,
    image: String,
    name: Option<String>,
    ports: Vec<String>,
    env: Vec<String>,
    volumes: Vec<String>,
    command: Vec<String>,
    detach: bool,
    memory: Option<String>,
    memory_swap: Option<String>,
    cpus: Option<String>,
    storage_size: Option<String>,
    platform: Option<String>,
) -> Result<RunResult, Failure> {
    let bin = super::resolve(&runtime)?;
    if runtime == "docker" {
        // Registry pulls need the credential helper the standalone CLI omits.
        let _ = super::ensure_docker_helpers();
    }
    let mut args: Vec<String> = vec!["run".into()];
    if detach {
        args.push("-d".into());
    }
    let mut platform = platform.filter(|p| !p.is_empty());
    if let Some(p) = &platform {
        args.push("--platform".into());
        args.push(p.clone());
    }
    if let Some(n) = name {
        if !n.is_empty() {
            args.push("--name".into());
            args.push(n);
        }
    }
    for p in ports {
        args.push("-p".into());
        args.push(p);
    }
    for e in env {
        args.push("-e".into());
        args.push(e);
    }
    for v in volumes {
        args.push("-v".into());
        args.push(v);
    }
    // Optional resource limits — each flag is added only when its field is set,
    // so an untouched form leaves the container on the runtime defaults.
    if let Some(m) = memory.filter(|s| !s.is_empty()) {
        args.push("--memory".into());
        args.push(m);
    }
    if let Some(ms) = memory_swap.filter(|s| !s.is_empty()) {
        args.push("--memory-swap".into());
        args.push(ms);
    }
    if let Some(c) = cpus.filter(|s| !s.is_empty()) {
        args.push("--cpus".into());
        args.push(c);
    }
    if let Some(sz) = storage_size.filter(|s| !s.is_empty()) {
        args.push("--storage-opt".into());
        args.push(format!("size={sz}"));
    }
    args.push(image.clone());
    // An optional command / args override, appended after the image — also
    // covers one-off "run a command on an image" use.
    for c in command {
        args.push(c);
    }
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    let mut out = super::run_capture(&bin, &arg_refs)?;
    let mut emulated = super::problems::mentions_emulation(&out.stderr);

    if !out.ok && platform.is_none() {
        if let Some(arch) = super::problems::missing_arch(&out.stderr) {
            let other = super::problems::other_platform(&arch);
            let mut retry: Vec<&str> = vec!["run"];
            if detach {
                retry.push("-d");
            }
            retry.extend(["--platform", other]);
            retry.extend(arg_refs.iter().skip(if detach { 2 } else { 1 }).copied());
            out = super::run_capture(&bin, &retry)?;
            if out.ok {
                emulated = true;
                platform = Some(other.to_string());
            }
        }
    }

    if !out.ok {
        let problem = super::problems::diagnose(&runtime, Some(&image), None, &out.stderr);
        return Err(Failure { message: out.stderr, problem });
    }

    let id = out.stdout.trim().to_string();
    let problem = if detach {
        early_exit_problem(&bin, &runtime, &image, &id)
    } else {
        None
    };
    Ok(RunResult { id, emulated, platform, problem })
}

/// Update a container's memory / CPU limits via `{runtime} update`. These can
/// change on a stopped or running container; disk size cannot be updated.
#[tauri::command]
pub async fn update_container(
    runtime: String,
    id: String,
    memory: Option<String>,
    memory_swap: Option<String>,
    cpus: Option<String>,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args: Vec<String> = vec!["update".into()];
    if let Some(m) = memory.filter(|s| !s.is_empty()) {
        args.push("--memory".into());
        args.push(m);
    }
    if let Some(ms) = memory_swap.filter(|s| !s.is_empty()) {
        args.push("--memory-swap".into());
        args.push(ms);
    }
    if let Some(c) = cpus.filter(|s| !s.is_empty()) {
        args.push("--cpus".into());
        args.push(c);
    }
    // No flags supplied → nothing to do (a bare `update` would error).
    if args.len() == 1 {
        return Ok(());
    }
    args.push(id);
    let arg_refs: Vec<&str> = args.iter().map(String::as_str).collect();
    super::run(&bin, &arg_refs).map(|_| ())
}

// ─── Streaming logs ──────────────────────────────────────────────────────────

/// Stream `{runtime} logs --follow`; each line is emitted on
/// `container-logs-{id}`. Stop with `stop_container_logs`.
#[tauri::command]
pub async fn get_container_logs(
    app: tauri::AppHandle,
    registry: tauri::State<'_, Registry>,
    runtime: String,
    id: String,
    tail: u32,
    timestamps: bool,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let tail_s = tail.to_string();
    let mut args: Vec<&str> = vec!["logs", "--follow", "--tail", &tail_s];
    if timestamps {
        args.push("--timestamps");
    }
    args.push(&id);
    super::spawn_streaming(
        &app,
        registry.inner(),
        format!("logs-{id}"),
        format!("container-logs-{id}"),
        &bin,
        &args,
    )
}

#[tauri::command]
pub async fn stop_container_logs(
    registry: tauri::State<'_, Registry>,
    id: String,
) -> Result<(), String> {
    registry.kill(&format!("logs-{id}"));
    Ok(())
}

// ─── Streaming stats ─────────────────────────────────────────────────────────

/// Stream `{runtime} stats {id}`; each sample is emitted on
/// `container-stats-{id}`. Stop with `stop_container_stats`.
#[tauri::command]
pub async fn get_container_stats(
    app: tauri::AppHandle,
    registry: tauri::State<'_, Registry>,
    runtime: String,
    id: String,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::spawn_streaming(
        &app,
        registry.inner(),
        format!("stats-{id}"),
        format!("container-stats-{id}"),
        &bin,
        &["stats", &id, "--format", "json"],
    )
}

#[tauri::command]
pub async fn stop_container_stats(
    registry: tauri::State<'_, Registry>,
    id: String,
) -> Result<(), String> {
    registry.kill(&format!("stats-{id}"));
    Ok(())
}
