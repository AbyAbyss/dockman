// Builds — image build history with a layer waterfall read from the real
// build output.
//
// A build runs in a background thread: output streams over `build-output-{id}`
// and on completion a record is appended to ~/.config/dockman/builds.json and
// `builds-changed` is emitted so the UI can refresh. Every number on a record
// comes from the build itself: step timings from the CLI's progress lines,
// the cache ratio from the steps it reported as cached, the size from
// `image inspect` on the result.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Instant;
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
    /// success | failed | cancelled
    pub status: String,
    /// Relative time, filled in when the record is read.
    #[serde(default)]
    pub when: String,
    pub duration: String,
    pub cache_percent: u32,
    pub size: String,
    pub final_size: String,
    pub layer_count: u32,
    pub dockerfile: String,
    pub layers: Vec<BuildLayer>,
    /// Unix seconds when the build started.
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub dockerfile_path: String,
    #[serde(default)]
    pub context_path: String,
    /// The last error line the build printed, for failed builds.
    #[serde(default)]
    pub error: String,
}

fn builds_path() -> PathBuf {
    super::config_dir().join("builds.json")
}

fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn relative(secs: u64) -> String {
    if secs == 0 {
        return String::new();
    }
    let diff = now_secs().saturating_sub(secs);
    if diff < 60 {
        "just now".into()
    } else if diff < 3600 {
        format!("{}m ago", diff / 60)
    } else if diff < 86400 {
        format!("{}h ago", diff / 3600)
    } else {
        format!("{}d ago", diff / 86400)
    }
}

fn read_builds() -> Vec<BuildRecord> {
    let mut all: Vec<BuildRecord> = std::fs::read_to_string(builds_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default();
    for b in &mut all {
        b.when = relative(b.created_at);
    }
    all
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

// ─── Output parsing ──────────────────────────────────────────────────────────

/// One output line with the time it arrived, relative to the build start.
struct Timed {
    at_ms: u64,
    line: String,
}

/// Turn the CLI's progress output into per-step timings.
///
/// Docker (BuildKit, `--progress=plain`) numbers each vertex:
///   `#5 [2/4] RUN apk add curl` · `#5 CACHED` · `#5 DONE 1.3s`
/// Podman prints steps in sequence and marks cache hits:
///   `STEP 3/5: RUN apk add curl` · `--> Using cache 7f1…`
/// A Podman step lasts until the next STEP or COMMIT line.
fn parse_output(lines: &[Timed]) -> Vec<BuildLayer> {
    struct Step {
        order: usize,
        instruction: String,
        cached: bool,
        duration_ms: Option<u64>,
        started_ms: u64,
    }
    let mut docker: HashMap<u32, Step> = HashMap::new();
    let mut podman: Vec<Step> = Vec::new();

    for (i, t) in lines.iter().enumerate() {
        let l = t.line.trim();

        // Docker: "#N rest"
        if let Some(rest) = l.strip_prefix('#') {
            let (num, rest) = match rest.split_once(' ') {
                Some((n, r)) => (n, r.trim()),
                None => continue,
            };
            let Ok(n) = num.parse::<u32>() else { continue };
            if rest == "CACHED" {
                if let Some(s) = docker.get_mut(&n) {
                    s.cached = true;
                    s.duration_ms = Some(0);
                }
            } else if let Some(d) = rest.strip_prefix("DONE ") {
                if let Some(s) = docker.get_mut(&n) {
                    s.duration_ms = Some(parse_secs(d));
                }
            } else if rest.starts_with('[') {
                // "[builder 2/6] RUN …" — keep stage steps, skip "[internal]".
                if let Some(end) = rest.find(']') {
                    let bracket = &rest[1..end];
                    let instruction = rest[end + 1..].trim();
                    if bracket.contains('/') && !instruction.is_empty() && !docker.contains_key(&n) {
                        docker.insert(
                            n,
                            Step {
                                order: i,
                                instruction: instruction.to_string(),
                                cached: false,
                                duration_ms: None,
                                started_ms: t.at_ms,
                            },
                        );
                    }
                }
            }
            continue;
        }

        // Podman: "STEP k/m: INSTR …"
        if let Some(rest) = l.strip_prefix("STEP ") {
            if let Some((_, instr)) = rest.split_once(": ") {
                if let Some(prev) = podman.last_mut() {
                    if prev.duration_ms.is_none() {
                        prev.duration_ms = Some(t.at_ms.saturating_sub(prev.started_ms));
                    }
                }
                podman.push(Step {
                    order: i,
                    instruction: instr.trim().to_string(),
                    cached: false,
                    duration_ms: None,
                    started_ms: t.at_ms,
                });
            }
            continue;
        }
        if l.starts_with("--> Using cache") {
            if let Some(prev) = podman.last_mut() {
                prev.cached = true;
            }
            continue;
        }
        if l.starts_with("COMMIT ") {
            if let Some(prev) = podman.last_mut() {
                if prev.duration_ms.is_none() {
                    prev.duration_ms = Some(t.at_ms.saturating_sub(prev.started_ms));
                }
            }
        }
    }

    let mut steps: Vec<Step> = if !docker.is_empty() {
        docker.into_values().collect()
    } else {
        podman
    };
    steps.sort_by_key(|s| s.order);
    steps
        .into_iter()
        .enumerate()
        .map(|(i, s)| BuildLayer {
            step: i as u32 + 1,
            instruction: s.instruction,
            cached: s.cached,
            duration_ms: if s.cached { 0 } else { s.duration_ms.unwrap_or(0) },
        })
        .collect()
}

/// "1.3s" / "0.04s" / "2m1.5s" → milliseconds.
fn parse_secs(s: &str) -> u64 {
    let s = s.trim();
    let (mins, rest) = match s.split_once('m') {
        Some((m, r)) if !m.is_empty() && m.chars().all(|c| c.is_ascii_digit()) => {
            (m.parse::<u64>().unwrap_or(0), r)
        }
        _ => (0, s),
    };
    let secs: f64 = rest.trim_end_matches('s').parse().unwrap_or(0.0);
    mins * 60_000 + (secs * 1000.0).round() as u64
}

/// Dockerfile instructions, used as the layer list when the runtime printed
/// no step lines at all (every step then shows as unknown duration).
fn dockerfile_steps(dockerfile: &str) -> Vec<BuildLayer> {
    dockerfile
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter(|l| l.split_whitespace().next().map(is_instruction).unwrap_or(false))
        .enumerate()
        .map(|(i, l)| BuildLayer {
            step: i as u32 + 1,
            instruction: l.to_string(),
            cached: false,
            duration_ms: 0,
        })
        .collect()
}

fn last_error(lines: &[Timed]) -> String {
    lines
        .iter()
        .rev()
        .map(|t| t.line.trim())
        .find(|l| {
            let low = l.to_ascii_lowercase();
            low.contains("error") || low.starts_with("failed")
        })
        .unwrap_or("")
        .to_string()
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
    std::fs::read_to_string(super::expand_home(&path)).map_err(|e| e.to_string())
}

/// Write an edited Dockerfile back to the path the build used and keep the
/// record's copy in sync.
#[tauri::command]
pub async fn save_build_dockerfile(id: String, content: String) -> Result<(), String> {
    let mut all = read_builds();
    let rec = all
        .iter_mut()
        .find(|b| b.id == id)
        .ok_or_else(|| "build not found".to_string())?;
    if rec.dockerfile_path.is_empty() {
        return Err("this build has no Dockerfile path on record".to_string());
    }
    std::fs::write(&rec.dockerfile_path, &content).map_err(|e| e.to_string())?;
    rec.dockerfile = content;
    write_builds(&all)
}

#[tauri::command]
pub async fn cancel_build(id: String) -> Result<(), String> {
    if let Ok(mut m) = build_pids().lock() {
        if let Some(pid) = m.remove(&format!("build-{id}")) {
            #[cfg(windows)]
            let _ = Command::new("taskkill").args(["/PID", &pid.to_string(), "/T", "/F"]).status();
            #[cfg(not(windows))]
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
    let context_path = super::expand_home(context_path.trim());
    if context_path.is_empty() {
        return Err("choose a build context folder".to_string());
    }
    if !std::path::Path::new(&context_path).is_dir() {
        return Err(format!("build context is not a folder: {context_path}"));
    }
    if tag.trim().is_empty() {
        return Err("give the image a name:tag".to_string());
    }
    let dockerfile = dockerfile
        .map(|p| super::expand_home(&p))
        .filter(|p| !p.is_empty());
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let id = format!("b-{millis:x}");
    let event = format!("build-output-{id}");

    // Resolve the Dockerfile path so the record carries its source.
    let df_path = dockerfile.clone().unwrap_or_else(|| {
        PathBuf::from(&context_path)
            .join("Dockerfile")
            .to_string_lossy()
            .into_owned()
    });
    let dockerfile_text = std::fs::read_to_string(&df_path)
        .map_err(|e| format!("cannot read {df_path}: {e}"))?;

    let mut args: Vec<String> = vec!["build".into()];
    if runtime == "docker" {
        args.push("--progress=plain".into());
    }
    if !use_cache {
        args.push("--no-cache".into());
    }
    if let Some(p) = platform.filter(|p| !p.is_empty()) {
        args.push("--platform".into());
        args.push(p);
    }
    if let Some(df) = dockerfile {
        args.push("-f".into());
        args.push(df);
    }
    for a in &build_args {
        args.push("--build-arg".into());
        args.push(a.clone());
    }
    args.push("-t".into());
    args.push(tag.clone());
    args.push(context_path.clone());

    let ret_id = id.clone();
    let created_at = now_secs();

    std::thread::spawn(move || {
        let started = Instant::now();
        let base = BuildRecord {
            id: id.clone(),
            rt: runtime.clone(),
            tag: tag.clone(),
            status: "failed".into(),
            when: String::new(),
            duration: "0s".into(),
            cache_percent: 0,
            size: "—".into(),
            final_size: "—".into(),
            layer_count: 0,
            dockerfile: dockerfile_text.clone(),
            layers: Vec::new(),
            created_at,
            dockerfile_path: df_path.clone(),
            context_path: context_path.clone(),
            error: String::new(),
        };

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
                        error: format!("failed to start build: {e}"),
                        ..base
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

        let collected: Arc<Mutex<Vec<Timed>>> = Arc::new(Mutex::new(Vec::new()));
        let mut handles = Vec::new();
        for reader in [
            child.stdout.take().map(|o| Box::new(o) as Box<dyn std::io::Read + Send>),
            child.stderr.take().map(|e| Box::new(e) as Box<dyn std::io::Read + Send>),
        ]
        .into_iter()
        .flatten()
        {
            let app = app.clone();
            let ev = event.clone();
            let col = collected.clone();
            handles.push(std::thread::spawn(move || {
                for line in std::io::BufReader::new(reader).lines().map_while(Result::ok) {
                    let _ = app.emit(&ev, line.clone());
                    if let Ok(mut c) = col.lock() {
                        c.push(Timed {
                            at_ms: started.elapsed().as_millis() as u64,
                            line,
                        });
                    }
                }
            }));
        }

        let status = child.wait();
        for h in handles {
            let _ = h.join();
        }
        let cancelled = build_pids()
            .lock()
            .map(|mut m| m.remove(&format!("build-{id}")).is_none())
            .unwrap_or(false);

        let success = status.map(|s| s.success()).unwrap_or(false);
        let mut lines = collected.lock().map(|mut c| std::mem::take(&mut *c)).unwrap_or_default();
        lines.sort_by_key(|t| t.at_ms);
        let elapsed = started.elapsed();

        let mut layers = parse_output(&lines);
        if layers.is_empty() {
            layers = dockerfile_steps(&dockerfile_text);
        }
        let cached = layers.iter().filter(|l| l.cached).count() as u32;
        let cache_percent = if layers.is_empty() {
            0
        } else {
            cached * 100 / layers.len() as u32
        };

        let final_size = if success {
            super::run(&bin, &["image", "inspect", "--format", "{{.Size}}", &tag])
                .ok()
                .and_then(|s| s.trim().parse::<u64>().ok())
                .map(super::host::format_size)
                .unwrap_or_else(|| "—".into())
        } else {
            "—".into()
        };

        let secs = elapsed.as_secs();
        let duration = if secs >= 60 {
            format!("{}m{:02}s", secs / 60, secs % 60)
        } else {
            format!("{:.1}s", elapsed.as_secs_f64())
        };

        let record = BuildRecord {
            status: if success {
                "success".into()
            } else if cancelled {
                "cancelled".into()
            } else {
                "failed".into()
            },
            duration,
            cache_percent,
            size: final_size.clone(),
            final_size,
            layer_count: layers.len() as u32,
            layers,
            error: if success { String::new() } else { last_error(&lines) },
            ..base
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
