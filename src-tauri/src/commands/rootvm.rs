// Root-in-the-VM access for podman, per container or per stack, without
// switching the whole machine to rootful.
//
// Every podman machine has two connections on the same VM: the rootless
// default and a `<name>-root` one. `podman --connection <name>-root run …`
// gives one container the full cgroup set (what dockerd always has) while
// everything else stays rootless. Nothing on the Mac runs as root.
//
// Two helpers make that usable from the existing code paths:
//   - `wrapper()`: a tiny `podman-root` script that pins the connection, so
//     every command that resolves a runtime binary works unchanged.
//   - `socket()`: an SSH forward of the VM's root podman socket to a host
//     unix socket, because `podman compose` always hands the compose provider
//     the machine's default (rootless) socket, whatever `--connection` says.

use std::path::PathBuf;

pub struct RootConn {
    pub name: String,
    pub port: String,
    pub identity: String,
    /// Socket path inside the VM (`/run/podman/podman.sock`).
    pub remote_sock: String,
}

fn dir() -> Result<PathBuf, String> {
    let home = std::env::var("HOME").map_err(|_| "no home directory".to_string())?;
    let d = PathBuf::from(home).join(".local").join("libexec").join("dockman");
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d)
}

/// The root connection of the default podman machine.
pub fn connection() -> Result<RootConn, String> {
    let bin = super::resolve("podman")?;
    let raw = super::run(&bin, &["system", "connection", "list", "--format", "json"])?;
    let list = super::parse_json_lines(&raw);
    let default_name = list
        .iter()
        .find(|c| c.get("Default").and_then(|v| v.as_bool()) == Some(true))
        .and_then(|c| c.get("Name").and_then(|v| v.as_str()))
        .map(|s| s.trim_end_matches("-root").to_string());
    let conn = list
        .iter()
        .filter(|c| {
            c.get("Name")
                .and_then(|v| v.as_str())
                .map(|n| n.ends_with("-root"))
                .unwrap_or(false)
        })
        .find(|c| match &default_name {
            Some(d) => c.get("Name").and_then(|v| v.as_str()) == Some(&format!("{d}-root")),
            None => true,
        })
        .or_else(|| {
            list.iter().find(|c| {
                c.get("Name")
                    .and_then(|v| v.as_str())
                    .map(|n| n.ends_with("-root"))
                    .unwrap_or(false)
            })
        })
        .ok_or_else(|| "podman machine has no root connection (is a machine created?)".to_string())?;
    let name = conn.get("Name").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let uri = conn.get("URI").and_then(|v| v.as_str()).unwrap_or("");
    let identity = conn.get("Identity").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let (port, remote_sock) = parse_uri(uri);
    if port.is_empty() || identity.is_empty() {
        return Err(format!("could not parse podman root connection: {uri}"));
    }
    Ok(RootConn { name, port, identity, remote_sock })
}

/// Port and remote socket path from a machine connection URI such as
/// `ssh://root@127.0.0.1:57892/run/podman/podman.sock`.
fn parse_uri(uri: &str) -> (String, String) {
    let after_host = uri.rsplit_once(':').map(|(_, r)| r).unwrap_or("");
    after_host
        .split_once('/')
        .map(|(p, s)| (p.to_string(), format!("/{s}")))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_machine_connection_uri() {
        let (port, sock) = parse_uri("ssh://root@127.0.0.1:57892/run/podman/podman.sock");
        assert_eq!(port, "57892");
        assert_eq!(sock, "/run/podman/podman.sock");
        assert_eq!(parse_uri("garbage"), (String::new(), String::new()));
    }
}

/// Path of a `podman-root` wrapper that runs podman against the root
/// connection. Rewritten whenever the podman path or connection name changes.
pub fn wrapper() -> Result<String, String> {
    use std::os::unix::fs::PermissionsExt;
    let podman = super::resolve("podman")?;
    let conn = connection()?;
    let path = dir()?.join("podman-root");
    let script = format!("#!/bin/sh\nexec \"{podman}\" --connection \"{}\" \"$@\"\n", conn.name);
    if std::fs::read_to_string(&path).ok().as_deref() != Some(script.as_str()) {
        std::fs::write(&path, script).map_err(|e| e.to_string())?;
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| e.to_string())?;
    }
    Ok(path.to_string_lossy().into_owned())
}

fn pid_alive(pid: &str) -> bool {
    std::process::Command::new("kill")
        .args(["-0", pid])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

/// Host unix socket that reaches the VM's root podman service, forwarded over
/// the machine's own SSH key. Started on first use and reused while the
/// forward is alive; a machine restart changes the port and kills the forward,
/// so the next call starts a fresh one.
pub fn socket() -> Result<String, String> {
    let d = dir()?;
    let sock = d.join("podman-root.sock");
    let pidfile = d.join("podman-root-ssh.pid");
    let sock_s = sock.to_string_lossy().into_owned();

    if sock.exists() {
        if let Ok(pid) = std::fs::read_to_string(&pidfile) {
            if pid_alive(pid.trim()) {
                return Ok(sock_s);
            }
        }
    }

    let conn = connection()?;
    let _ = std::fs::remove_file(&sock);
    use std::os::unix::process::CommandExt;
    let child = std::process::Command::new("ssh")
        .args([
            "-i", &conn.identity,
            "-p", &conn.port,
            "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null",
            "-o", "LogLevel=ERROR",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ServerAliveInterval=30",
            "-N",
            "-L", &format!("{sock_s}:{}", conn.remote_sock),
            "root@127.0.0.1",
        ])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .process_group(0)
        .spawn()
        .map_err(|e| format!("could not start the root socket forward: {e}"))?;
    let _ = std::fs::write(&pidfile, child.id().to_string());

    for _ in 0..40 {
        if sock.exists() {
            return Ok(sock_s);
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    Err("the root socket forward did not come up (is the podman machine running?)".to_string())
}

/// The compose provider to drive the root socket with: a standalone
/// `docker-compose`, the docker CLI plugin, or `docker compose`.
pub fn compose_provider() -> Result<(String, Vec<String>), String> {
    if let Some(p) = super::which_optional("docker-compose") {
        return Ok((p, vec![]));
    }
    if let Ok(home) = std::env::var("HOME") {
        let plugin = PathBuf::from(home).join(".docker").join("cli-plugins").join("docker-compose");
        if plugin.exists() {
            return Ok((plugin.to_string_lossy().into_owned(), vec![]));
        }
    }
    let docker = super::resolve("docker")?;
    Ok((docker, vec!["compose".to_string()]))
}
