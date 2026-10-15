// Diagnosed problems — known failure modes turned into a plain-words message,
// a cause and a fix the UI can offer. Each has a stable `code` so the
// frontend can dedupe, and a severity so it can be shown as a warning before
// anything actually fails (e.g. a rootless podman machine).
//
// The catalogue grew from real failures reproduced on a Mac (see
// docs/ENGINE_PLAN.md, "Why this app exists"): podman refusing to pull an
// image with no host-arch variant, and rootless podman lacking the cgroup
// controllers a privileged image asks for.

use serde::Serialize;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Fix {
    pub label: String,
    /// Something the app can do with one click (`set_rootful`, `open_engines`).
    pub action: Option<String>,
    /// A command to show / copy for the terminal.
    pub command: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Problem {
    pub code: String,
    /// `info` | `warning` | `error`
    pub severity: String,
    pub engine: String,
    pub container: Option<String>,
    pub image: Option<String>,
    /// Compose file, when the problem belongs to a stack.
    pub file: Option<String>,
    pub message: String,
    pub cause: String,
    pub fixes: Vec<Fix>,
    pub log_tail: String,
}

/// The default fix for a rootless failure: run that one container (or stack)
/// as root inside the VM, leaving the machine and everything else rootless.
fn root_fixes(image: Option<&str>) -> Vec<Fix> {
    let conn = super::rootvm::connection()
        .map(|c| c.name)
        .unwrap_or_else(|_| "podman-machine-default-root".to_string());
    vec![
        fix(
            "Run again as root in the VM",
            Some("retry_as_root"),
            Some(&format!(
                "podman --connection {conn} run … {}",
                image.unwrap_or("<image>")
            )),
        ),
        fix(
            "Compose: use the root socket",
            None,
            Some("Dockman forwards it; from a terminal: DOCKER_HOST=unix://~/.local/libexec/dockman/podman-root.sock docker-compose up -d"),
        ),
    ]
}

/// A command failure that may carry a diagnosis. Returned as the `Err` of
/// run / pull so the frontend gets both the raw message and the problem.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub message: String,
    pub problem: Option<Problem>,
}

impl From<String> for Failure {
    fn from(message: String) -> Self {
        Failure { message, problem: None }
    }
}

fn fix(label: &str, action: Option<&str>, command: Option<&str>) -> Fix {
    Fix {
        label: label.to_string(),
        action: action.map(String::from),
        command: command.map(String::from),
    }
}

fn tail(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(30);
    lines[start..].join("\n")
}

/// The architecture named in podman's refusal to pull a manifest list that
/// has no variant for the host, e.g.
/// `no image found in image index for architecture "arm64", variant "v8"`.
pub fn missing_arch(text: &str) -> Option<String> {
    let idx = text.find("no image found in image index for architecture")?;
    let rest = &text[idx..];
    let open = rest.find('"')? + 1;
    let close = open + rest[open..].find('"')?;
    Some(rest[open..close].to_string())
}

/// The platform to retry with when the image has no build for `host_arch`.
pub fn other_platform(host_arch: &str) -> &'static str {
    if host_arch.starts_with("arm") || host_arch == "aarch64" {
        "linux/amd64"
    } else {
        "linux/arm64"
    }
}

/// The "image platform does not match" warning both CLIs print when they run
/// a foreign-arch image under emulation.
pub fn mentions_emulation(text: &str) -> bool {
    text.contains("does not match the expected platform")
        || text.contains("does not match the detected host platform")
}

/// Match command output against the catalogue.
pub fn diagnose(
    engine: &str,
    image: Option<&str>,
    container: Option<&str>,
    text: &str,
) -> Option<Problem> {
    let t = text;
    let base = |code: &str, severity: &str, message: String, cause: String, fixes: Vec<Fix>| Problem {
        code: code.to_string(),
        severity: severity.to_string(),
        engine: engine.to_string(),
        container: container.map(String::from),
        image: image.map(String::from),
        file: None,
        message,
        cause,
        fixes,
        log_tail: tail(t),
    };

    if let Some(arch) = missing_arch(t) {
        let other = other_platform(&arch);
        let name = image.unwrap_or("this image");
        return Some(base(
            "image.no_host_arch",
            "error",
            format!("{name} has no {arch} build."),
            format!(
                "{engine} refuses to pull a multi-arch image that has no variant for this Mac unless a platform is given. The engine can still run it under emulation."
            ),
            vec![
                fix(
                    &format!("Run as {} (emulated)", other.trim_start_matches("linux/")),
                    Some("retry_platform"),
                    Some(&format!("{engine} run --platform {other} {name}")),
                ),
                fix(
                    "Compose: add a platform to the service",
                    None,
                    Some(&format!("platform: {other}")),
                ),
            ],
        ));
    }

    let cgroup_write = t.contains("cgroup")
        && (t.contains("No such file or directory")
            || t.contains("Permission denied")
            || t.contains("cpuset"));
    if engine == "podman" && cgroup_write {
        return Some(base(
            "engine.rootless_cgroups",
            "error",
            "Rootless podman can't give this container the cgroup controllers it asked for."
                .to_string(),
            "The podman machine runs containers as a normal user, and the user session only gets the cpu, io, memory and pids controllers. Images that set up their own cgroups (sandboxes, code runners) need the full set, which root inside the VM has."
                .to_string(),
            root_fixes(image),
        ));
    }

    if engine == "podman"
        && t.contains("permission denied")
        && (t.contains("rootlessport") || t.contains("bind"))
    {
        return Some(base(
            "engine.rootless_port",
            "error",
            "Rootless podman can't publish ports below 1024.".to_string(),
            "Only root may bind privileged ports inside the machine.".to_string(),
            {
                let mut f = root_fixes(image);
                f.push(fix("Or use a host port above 1024", None, Some("-p 8080:80")));
                f
            },
        ));
    }

    if t.contains("no space left on device") {
        return Some(base(
            "engine.disk_full",
            "error",
            format!("The {engine} engine's disk is full."),
            "Images, build cache and volumes have used the machine's disk.".to_string(),
            vec![fix("Prune unused data", None, Some(&format!("{engine} system prune")))],
        ));
    }

    if t.contains("is not a docker command") && (t.contains("compose") || t.contains("buildx")) {
        return Some(base(
            "engine.plugins_missing",
            "error",
            "The docker compose / buildx plugin is missing.".to_string(),
            "The standalone docker CLI ships without its plugins.".to_string(),
            vec![fix("Open Engines", Some("open_engines"), None)],
        ));
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    // Real output from podman 6.1.4 on an Apple Silicon Mac, 2026-10-15.
    const NO_ARCH: &str = "Trying to pull docker.io/amd64/alpine:latest...\nError: unable to copy from source docker://amd64/alpine:latest: choosing an image from manifest list docker://amd64/alpine:latest: no image found in image index for architecture \"arm64\", variant \"v8\", OS \"linux\"";
    const PISTON_LOG: &str =
        "/piston_api/src/docker-entrypoint.sh: line 22: echo: write error: No such file or directory";
    const EMULATED: &str =
        "WARNING: image platform (linux/amd64) does not match the expected platform (linux/arm64)";

    #[test]
    fn missing_arch_reads_the_host_arch() {
        assert_eq!(missing_arch(NO_ARCH).as_deref(), Some("arm64"));
        assert_eq!(other_platform("arm64"), "linux/amd64");
        assert_eq!(other_platform("amd64"), "linux/arm64");
        assert!(missing_arch("some other error").is_none());
    }

    #[test]
    fn no_host_arch_is_diagnosed_with_a_platform_fix() {
        let p = diagnose("podman", Some("amd64/alpine"), None, NO_ARCH).unwrap();
        assert_eq!(p.code, "image.no_host_arch");
        assert!(p.fixes[0].command.as_deref().unwrap().contains("--platform linux/amd64"));
    }

    #[test]
    fn piston_entrypoint_failure_is_rootless_cgroups_on_a_rootless_machine() {
        // Bash reports the failing redirect without the file name, so the
        // real log never says "cgroup"; the exit heuristic has to catch it.
        assert!(diagnose("podman", Some("piston"), Some("abc"), PISTON_LOG).is_none());
        let p = diagnose_exit("podman", true, Some("piston"), Some("abc"), PISTON_LOG).unwrap();
        assert_eq!(p.code, "engine.rootless_cgroups");
        assert_eq!(p.fixes[0].action.as_deref(), Some("retry_as_root"));
        // A rootful machine, or docker, gets no such diagnosis.
        assert!(diagnose_exit("podman", false, None, None, PISTON_LOG).is_none());
        assert!(diagnose_exit("docker", true, None, None, PISTON_LOG).is_none());
    }

    #[test]
    fn explicit_cgroup_errors_match_without_the_heuristic() {
        let text = "Error: writing to cgroup.subtree_control: No such file or directory";
        assert_eq!(diagnose("podman", None, None, text).unwrap().code, "engine.rootless_cgroups");
    }

    #[test]
    fn emulation_warning_is_recognised() {
        assert!(mentions_emulation(EMULATED));
        assert!(!mentions_emulation("pulled fine"));
    }
}

/// Diagnose a container that died right after starting. Tries the output
/// catalogue first; then, on a rootless podman machine, treats a failed
/// write / permission error in the entrypoint as the cgroup problem. Bash
/// reports Piston's failure as just `echo: write error: No such file or
/// directory`, with no "cgroup" in the text, so the plain matcher misses it.
pub fn diagnose_exit(
    engine: &str,
    rootless: bool,
    image: Option<&str>,
    container: Option<&str>,
    text: &str,
) -> Option<Problem> {
    if let Some(p) = diagnose(engine, image, container, text) {
        return Some(p);
    }
    let looks_like_privilege = text.contains("write error")
        || text.contains("Operation not permitted")
        || text.contains("Permission denied")
        || text.contains("cgroup");
    if engine == "podman" && rootless && looks_like_privilege {
        return Some(Problem {
            code: "engine.rootless_cgroups".into(),
            severity: "error".into(),
            engine: engine.into(),
            container: container.map(String::from),
            image: image.map(String::from),
            file: None,
            message: "The container died right after starting on a rootless podman machine."
                .into(),
            cause: "Its startup script failed on a write or permission error. On a rootless machine the usual cause is a missing cgroup controller (cpuset) or a privileged operation only root may do. Docker Desktop and OrbStack always run as root inside their VM, which is why the same image works there. Running this one container as root inside the podman VM gives it the same thing, and nothing else changes."
                .into(),
            fixes: root_fixes(image),
            log_tail: tail(text),
        });
    }
    None
}

// ─── Engine probes ───────────────────────────────────────────────────────────

/// True when Rosetta 2 is installed on this (Apple Silicon) Mac.
#[cfg(target_os = "macos")]
fn rosetta_installed() -> bool {
    std::path::Path::new("/Library/Apple/usr/share/rosetta/rosetta").exists()
}

/// Problems visible from the engine's configuration alone, before anything
/// fails: a rootless podman machine, Rosetta missing, a shared docker socket.
#[tauri::command]
pub async fn engine_problems(runtime: String) -> Result<Vec<Problem>, String> {
    let mut out = Vec::new();
    if super::resolve(&runtime).is_err() {
        return Ok(out);
    }

    // A rootless podman machine is podman's default and most images are fine
    // with it, so it is not reported here. The rootful switch is offered only
    // when a container actually fails for that reason (`diagnose_exit`).

    #[cfg(target_os = "macos")]
    if std::env::consts::ARCH == "aarch64" && !rosetta_installed() {
        out.push(Problem {
            code: "engine.rosetta_missing".into(),
            severity: "info".into(),
            engine: runtime.clone(),
            container: None,
            image: None,
            file: None,
            message: "Rosetta isn't installed, so Intel (amd64) images run on slow QEMU emulation.".into(),
            cause: "Apple Silicon Macs don't ship Rosetta 2. Both engines can use it for much faster amd64 emulation. A podman machine created before Rosetta is installed has to be recreated to use it."
                .into(),
            fixes: vec![fix(
                "Copy the Rosetta install command",
                None,
                Some("softwareupdate --install-rosetta --agree-to-license"),
            )],
            log_tail: String::new(),
        });
    }

    if runtime == "docker" && super::runtime::docker_served_by_podman() {
        out.push(Problem {
            code: "engine.shared_socket".into(),
            severity: "info".into(),
            engine: "docker".into(),
            container: None,
            image: None,
            file: None,
            message: "docker commands go to the podman engine.".into(),
            cause: "/var/run/docker.sock is linked to the podman machine (podman-mac-helper), so both CLIs see the same containers. Dockman shows them once, under podman."
                .into(),
            fixes: vec![fix(
                "Copy the command to remove the link",
                None,
                Some("sudo podman-mac-helper uninstall"),
            )],
            log_tail: String::new(),
        });
    }

    Ok(out)
}
