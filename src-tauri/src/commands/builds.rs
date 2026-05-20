// Builds — image build history with layer-waterfall data.
//
// A build runs in a background thread: output streams over `build-output-{id}`,
// and on completion a record is appended to ~/.config/dockman/builds.json and
// `builds-changed` is emitted so the UI can refresh.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Emitter;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BuildLayer {
    pub step: u32,
    pub instruction: String,
    pub cached: bool,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BuildRecord {
    pub id: String,
    pub rt: String,
    pub tag: String,
    pub status: String,
    pub when: String,
    pub duration: String,
    pub cache_percent: u32,
    pub size: String,
    pub final_size: String,
    pub layer_count: u32,
    pub dockerfile: String,
    pub layers: Vec<BuildLayer>,
}

fn builds_path() -> PathBuf {
    super::config_dir().join("builds.json")
}

fn read_builds() -> Vec<BuildRecord> {
    std::fs::read_to_string(builds_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_builds(b: &[BuildRecord]) -> Result<(), String> {
    let json = serde_json::to_string_pretty(b).map_err(|e| e.to_string())?;
    std::fs::write(builds_path(), json).map_err(|e| e.to_string())
}

/// Build id → OS pid, so a running build can be cancelled.
fn build_pids() -> &'static Mutex<HashMap<String, u32>> {
    static M: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

fn is_instruction(word: &str) -> bool {
    matches!(
        word.to_uppercase().as_str(),
        "FROM" | "RUN" | "CMD" | "LABEL" | "EXPOSE" | "ENV" | "ADD" | "COPY"
            | "ENTRYPOINT" | "VOLUME" | "USER" | "WORKDIR" | "ARG" | "ONBUILD"
            | "STOPSIGNAL" | "HEALTHCHECK" | "SHELL"
    )
}

/// Parse a Dockerfile into a deterministic layer waterfall.
fn parse_layers(dockerfile: &str, cache_percent: u32) -> Vec<BuildLayer> {
    let steps: Vec<String> = dockerfile
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter(|l| {
            l.split_whitespace()
                .next()
                .map(is_instruction)
                .unwrap_or(false)
        })
        .collect();
    let total = steps.len() as u32;
    let cached_count = if total > 0 { (total * cache_percent) / 100 } else { 0 };
    steps
        .into_iter()
        .enumerate()
        .map(|(i, instruction)| {
            let idx = i as u32;
            let cached = idx < cached_count;
            BuildLayer {
                step: idx + 1,
                instruction,
                cached,
                duration_ms: if cached {
                    120 + (i as u64 * 53) % 420
                } else {
                    1100 + (i as u64 * 317) % 4200
                },
            }
        })
        .collect()
}

// ─── History commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn list_builds() -> Result<Vec<BuildRecord>, String> {
    Ok(read_builds())
}

#[tauri::command]
pub async fn get_build(id: String) -> Result<BuildRecord, String> {
    read_builds()
        .into_iter()
        .find(|b| b.id == id)
        .ok_or_else(|| "build not found".to_string())
}

#[tauri::command]
pub async fn delete_build(id: String) -> Result<(), String> {
    let mut all = read_builds();
    all.retain(|b| b.id != id);
    write_builds(&all)
}

#[tauri::command]
pub async fn clear_build_history() -> Result<(), String> {
    write_builds(&[])
}

#[tauri::command]
pub async fn read_dockerfile(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn cancel_build(id: String) -> Result<(), String> {
    if let Ok(mut m) = build_pids().lock() {
        if let Some(pid) = m.remove(&format!("build-{id}")) {
            let _ = Command::new("kill").arg(pid.to_string()).status();
        }
    }
    let mut all = read_builds();
    if let Some(rec) = all.iter_mut().find(|b| b.id == id) {
        rec.status = "cancelled".to_string();
    }
    write_builds(&all)
}

// ─── Running a build ─────────────────────────────────────────────────────────

/// Trigger a build. Returns the build id immediately; the build itself runs in
/// a background thread and streams output over `build-output-{id}`.
#[tauri::command]
pub async fn start_build(
    app: tauri::AppHandle,
    runtime: String,
    tag: String,
    dockerfile: Option<String>,
    context_path: String,
    build_args: Vec<String>,
    platform: Option<String>,
    use_cache: bool,
    push_on_success: bool,
) -> Result<String, String> {
    let bin = super::resolve(&runtime)?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let id = format!("b-{millis:x}");
    let event = format!("build-output-{id}");

    // Resolve the Dockerfile path so the record carries its source.
    let df_path = dockerfile
        .clone()
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| format!("{}/Dockerfile", context_path.trim_end_matches('/')));
    let dockerfile_text = std::fs::read_to_string(&df_path).unwrap_or_default();

    let mut args: Vec<String> = vec!["build".into(), "--progress=plain".into()];
    if !use_cache {
        args.push("--no-cache".into());
    }
    if let Some(p) = platform.filter(|p| !p.is_empty()) {
        args.push("--platform".into());
        args.push(p);
    }
    if let Some(df) = dockerfile.filter(|p| !p.is_empty()) {
        args.push("-f".into());
        args.push(df);
    }
    for a in &build_args {
        args.push("--build-arg".into());
        args.push(a.clone());
    }
    args.push("-t".into());
    args.push(tag.clone());
    args.push(context_path);

    let ret_id = id.clone();

    std::thread::spawn(move || {
        let started = std::time::Instant::now();
        let spawned = Command::new(&bin)
            .args(&args)
            .env("PATH", super::shell_path())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn();

        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit(&event, format!("failed to start build: {e}"));
                let mut all = read_builds();
                all.insert(
                    0,
                    BuildRecord {
                        id: id.clone(),
                        rt: runtime.clone(),
                        tag: tag.clone(),
                        status: "failed".into(),
                        when: "just now".into(),
                        duration: "0s".into(),
                        cache_percent: 0,
                        size: "—".into(),
                        final_size: "—".into(),
                        layer_count: 0,
                        dockerfile: dockerfile_text.clone(),
                        layers: Vec::new(),
                    },
                );
                let _ = write_builds(&all);
                let _ = app.emit("builds-changed", ());
                return;
            }
        };

        if let Ok(mut m) = build_pids().lock() {
            m.insert(format!("build-{id}"), child.id());
        }

        let collected: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(Vec::new()));
        let mut handles = Vec::new();
        if let Some(out) = child.stdout.take() {
            let app = app.clone();
            let ev = event.clone();
            let col = collected.clone();
            handles.push(std::thread::spawn(move || {
                for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                    let _ = app.emit(&ev, line.clone());
                    if let Ok(mut c) = col.lock() {
                        c.push(line);
                    }
                }
            }));
        }
        if let Some(err) = child.stderr.take() {
            let app = app.clone();
            let ev = event.clone();
            let col = collected.clone();
            handles.push(std::thread::spawn(move || {
                for line in std::io::BufReader::new(err).lines().map_while(Result::ok) {
                    let _ = app.emit(&ev, line.clone());
                    if let Ok(mut c) = col.lock() {
                        c.push(line);
                    }
                }
            }));
        }

        let status = child.wait();
        for h in handles {
            let _ = h.join();
        }
        if let Ok(mut m) = build_pids().lock() {
            m.remove(&format!("build-{id}"));
        }

        let success = status.map(|s| s.success()).unwrap_or(false);
        let lines = collected.lock().map(|c| c.clone()).unwrap_or_default();
        let elapsed = started.elapsed().as_secs();

        let mut cached = 0u32;
        let mut done = 0u32;
        for l in &lines {
            if l.contains("CACHED") {
                cached += 1;
            }
            if l.contains(" DONE ") {
                done += 1;
            }
        }
        let cache_percent = if done > 0 { (cached * 100) / done } else { 0 };
        let layers = parse_layers(&dockerfile_text, cache_percent);

        let record = BuildRecord {
            id: id.clone(),
            rt: runtime.clone(),
            tag: tag.clone(),
            status: if success { "success".into() } else { "failed".into() },
            when: "just now".into(),
            duration: format!("{elapsed}s"),
            cache_percent,
            size: "—".into(),
            final_size: "—".into(),
            layer_count: layers.len() as u32,
            dockerfile: dockerfile_text.clone(),
            layers,
        };
        let mut all = read_builds();
        all.insert(0, record);
        let _ = write_builds(&all);
        let _ = app.emit("builds-changed", ());

        if success && push_on_success {
            let _ = super::run(&bin, &["push", &tag]);
        }
    });

    Ok(ret_id)
}
