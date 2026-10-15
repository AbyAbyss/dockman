// Compose commands — uses the `docker compose` plugin or `podman compose`.
// No separate docker-compose binary is required.
//
// "podman-root" is the exception: `podman compose` always hands the provider
// the machine's default (rootless) socket whatever `--connection` says, so
// for root-in-the-VM stacks the provider is driven directly with
// `DOCKER_HOST` pointing at the forwarded root socket (see `rootvm`).

use super::problems::Fix;
use super::Registry;
use std::io::BufRead;
use tauri::Emitter;
use tauri_plugin_dialog::DialogExt;

/// Binary, leading args and environment for compose on a runtime.
struct ComposeCmd {
    bin: String,
    base: Vec<String>,
    envs: Vec<(String, String)>,
}

impl ComposeCmd {
    fn args<'a>(&'a self, rest: &[&'a str]) -> Vec<&'a str> {
        self.base.iter().map(String::as_str).chain(rest.iter().copied()).collect()
    }
    fn envs(&self) -> Vec<(&str, &str)> {
        self.envs.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect()
    }
}

fn compose_cmd(runtime: &str) -> Result<ComposeCmd, String> {
    if runtime == "podman-root" {
        let (bin, base) = super::rootvm::compose_provider()?;
        let sock = super::rootvm::socket()?;
        return Ok(ComposeCmd {
            bin,
            base,
            envs: vec![("DOCKER_HOST".into(), format!("unix://{sock}"))],
        });
    }
    Ok(ComposeCmd {
        bin: super::resolve(runtime)?,
        base: vec!["compose".into()],
        envs: vec![],
    })
}

/// List discovered compose projects.
#[tauri::command]
pub async fn list_compose_projects(
    runtime: String,
) -> Result<Vec<serde_json::Value>, String> {
    let c = compose_cmd(&runtime)?;
    let raw = super::run_env(&c.bin, &c.args(&["ls", "--format", "json"]), &c.envs())?;
    Ok(super::parse_json_lines(&raw))
}

/// Exit status of a `compose up`, delivered on the `compose-done` event.
#[derive(Clone, serde::Serialize)]
struct ComposeDone {
    success: bool,
    code: i32,
}

/// List the service names declared in a compose file. Doubles as a probe — it
/// fails when the runtime has no working `compose` provider.
#[tauri::command]
pub async fn compose_services(
    runtime: String,
    compose_file: String,
) -> Result<Vec<String>, String> {
    let c = compose_cmd(&runtime)?;
    let raw = super::run_env(
        &c.bin,
        &c.args(&["-f", &compose_file, "config", "--services"]),
        &c.envs(),
    )?;
    Ok(raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect())
}

/// Compose's default project name: the compose file's directory, lower-cased,
/// with anything but `[a-z0-9_-]` dropped.
fn project_name(compose_file: &str) -> String {
    std::path::Path::new(compose_file)
        .parent()
        .and_then(|p| p.file_name())
        .map(|n| n.to_string_lossy().to_lowercase())
        .unwrap_or_default()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

#[cfg(test)]
mod tests {
    #[test]
    fn project_name_follows_compose_defaults() {
        assert_eq!(super::project_name("/Users/aby/sandkit/docker/piston/docker-compose.yml"), "piston");
        assert_eq!(super::project_name("/x/My App.v2/compose.yaml"), "myappv2");
    }
}

/// After a rootless podman `compose up` succeeds, look for a service that died
/// right after starting and diagnose it. A stack hitting the rootless cgroup
/// limit (Piston) reports "Started" and then restart-loops, so the exit
/// status alone says nothing. Emits `compose-problem` with the fix.
fn check_rootless_stack(app: &tauri::AppHandle, bin: &str, compose_file: &str) {
    let rootful = super::run(bin, &["machine", "inspect", "--format", "{{.Rootful}}"])
        .map(|s| s.trim() == "true")
        .unwrap_or(true);
    if rootful {
        return;
    }
    std::thread::sleep(std::time::Duration::from_secs(6));
    let project = project_name(compose_file);
    let filter = format!("label=com.docker.compose.project={project}");
    let Ok(raw) = super::run(bin, &["ps", "-a", "--filter", &filter, "--format", "json"]) else {
        return;
    };
    for c in super::parse_json_lines(&raw) {
        let state = c.get("State").and_then(|v| v.as_str()).unwrap_or("");
        let code = c.get("ExitCode").and_then(|v| v.as_i64()).unwrap_or(0);
        if state == "running" || code == 0 {
            continue;
        }
        let id = c.get("Id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let image = c.get("Image").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let Ok(logs) = super::run_capture(bin, &["logs", "--tail", "40", &id]) else { continue };
        let text = format!("{}\n{}", logs.stdout, logs.stderr);
        if let Some(mut p) =
            super::problems::diagnose_exit("podman", true, Some(&image), Some(&id), &text)
        {
            if p.code.starts_with("engine.rootless") {
                p.file = Some(compose_file.to_string());
                p.fixes = vec![Fix {
                    label: "Run this stack again as root in the VM".into(),
                    action: Some("retry_compose_as_root".into()),
                    command: Some(format!(
                        "DOCKER_HOST=unix://<root socket> docker-compose -f {compose_file} up -d"
                    )),
                }];
            }
            let _ = app.emit("compose-problem", p.clone());
            return;
        }
    }
}

/// Bring a compose project up. Every output line streams on `compose-output`;
/// a `compose-done` event carries the exit status once the command finishes.
/// `scale` entries are `service=count` strings passed as `--scale`.
#[tauri::command]
pub async fn compose_up(
    app: tauri::AppHandle,
    runtime: String,
    compose_file: String,
    detach: bool,
    scale: Vec<String>,
) -> Result<(), String> {
    let c = compose_cmd(&runtime)?;
    let mut args: Vec<String> = c.base.clone();
    args.extend(["-f".to_string(), compose_file.clone(), "up".to_string()]);
    if detach {
        args.push("--detach".into());
    }
    for s in scale {
        args.push("--scale".into());
        args.push(s);
    }
    let bin = c.bin.clone();
    let envs = c.envs.clone();
    let podman_bin = if runtime == "podman" { super::resolve("podman").ok() } else { None };

    std::thread::spawn(move || {
        let spawned = std::process::Command::new(&bin)
            .args(&args)
            .env("PATH", super::shell_path())
            .envs(envs.iter().map(|(k, v)| (k.as_str(), v.as_str())))
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn();
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                let _ = app.emit("compose-output", format!("failed to start compose: {e}"));
                let _ = app.emit("compose-done", ComposeDone { success: false, code: -1 });
                return;
            }
        };

        let mut handles = Vec::new();
        if let Some(out) = child.stdout.take() {
            let app = app.clone();
            handles.push(std::thread::spawn(move || {
                for line in std::io::BufReader::new(out).lines().map_while(Result::ok) {
                    let _ = app.emit("compose-output", line);
                }
            }));
        }
        if let Some(err) = child.stderr.take() {
            let app = app.clone();
            handles.push(std::thread::spawn(move || {
                for line in std::io::BufReader::new(err).lines().map_while(Result::ok) {
                    let _ = app.emit("compose-output", line);
                }
            }));
        }

        let status = child.wait();
        for h in handles {
            let _ = h.join();
        }
        let (success, code) = match status {
            Ok(s) => (s.success(), s.code().unwrap_or(-1)),
            Err(_) => (false, -1),
        };
        let _ = app.emit("compose-done", ComposeDone { success, code });

        if success && detach {
            if let Some(pb) = podman_bin {
                check_rootless_stack(&app, &pb, &compose_file);
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub async fn compose_down(
    runtime: String,
    compose_file: String,
    remove_volumes: bool,
) -> Result<(), String> {
    let c = compose_cmd(&runtime)?;
    let mut rest: Vec<&str> = vec!["-f", &compose_file, "down"];
    if remove_volumes {
        rest.push("--volumes");
    }
    super::run_env(&c.bin, &c.args(&rest), &c.envs()).map(|_| ())
}

#[tauri::command]
pub async fn compose_restart(
    runtime: String,
    compose_file: String,
    service: Option<String>,
) -> Result<(), String> {
    let c = compose_cmd(&runtime)?;
    let mut rest: Vec<&str> = vec!["-f", &compose_file, "restart"];
    if let Some(s) = &service {
        rest.push(s);
    }
    super::run_env(&c.bin, &c.args(&rest), &c.envs()).map(|_| ())
}

/// Stream compose logs on `compose-logs-{project_name}`.
#[tauri::command]
pub async fn compose_logs(
    app: tauri::AppHandle,
    registry: tauri::State<'_, Registry>,
    runtime: String,
    project_name: String,
    compose_file: String,
    service: Option<String>,
) -> Result<(), String> {
    let c = compose_cmd(&runtime)?;
    let mut rest: Vec<&str> = vec!["-f", &compose_file, "logs", "--follow"];
    if let Some(s) = &service {
        rest.push(s);
    }
    super::spawn_streaming_env(
        &app,
        registry.inner(),
        format!("compose-logs-{project_name}"),
        format!("compose-logs-{project_name}"),
        &c.bin,
        &c.args(&rest),
        &c.envs(),
    )
}

/// Open a compose file in the system default application.
#[tauri::command]
pub async fn open_compose_file(compose_file: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let opener = "open";
    #[cfg(target_os = "windows")]
    let opener = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let opener = "xdg-open";

    std::process::Command::new(opener)
        .arg(&compose_file)
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open a native file picker for a compose file; returns the chosen path, or
/// `None` when the dialog is cancelled.
#[tauri::command]
pub async fn pick_compose_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let picked = app
        .dialog()
        .file()
        .add_filter("Compose file", &["yml", "yaml"])
        .blocking_pick_file();
    Ok(picked.map(|f| f.to_string()))
}
