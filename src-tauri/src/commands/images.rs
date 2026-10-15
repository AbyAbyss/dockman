// Image commands — listing, removal, pull, inspection and search.

use super::problems::Failure;

#[tauri::command]
pub async fn list_images(runtime: String) -> Result<Vec<serde_json::Value>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["images", "--format", "json"])?;
    Ok(super::parse_json_lines(&raw))
}

#[tauri::command]
pub async fn remove_image(runtime: String, id: String, force: bool) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    let mut args = vec!["rmi"];
    if force {
        args.push("--force");
    }
    args.push(&id);
    super::run(&bin, &args).map(|_| ())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PullResult {
    pub emulated: bool,
    pub platform: Option<String>,
}

/// Pull an image, blocking until complete (the frontend renders its own
/// progress indicator). An image with no build for this Mac is pulled again
/// with `--platform` for the architecture it does have, and reported as
/// emulated.
#[tauri::command]
pub async fn pull_image(runtime: String, image: String) -> Result<PullResult, Failure> {
    let bin = super::resolve(&runtime)?;
    if runtime == "docker" {
        let _ = super::ensure_docker_helpers();
    }
    let mut out = super::run_capture(&bin, &["pull", &image])?;
    let mut platform = None;
    if !out.ok {
        if let Some(arch) = super::problems::missing_arch(&out.stderr) {
            let other = super::problems::other_platform(&arch);
            out = super::run_capture(&bin, &["pull", "--platform", other, &image])?;
            if out.ok {
                platform = Some(other.to_string());
            }
        }
    }
    if !out.ok {
        let problem = super::problems::diagnose(&runtime, Some(&image), None, &out.stderr);
        return Err(Failure { message: out.stderr, problem });
    }
    let emulated = platform.is_some() || super::problems::mentions_emulation(&out.stderr);
    Ok(PullResult { emulated, platform })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageArch {
    pub id: String,
    pub names: Vec<String>,
    pub arch: String,
    /// True when the image's architecture differs from this Mac's.
    pub emulated: bool,
}

fn host_arch() -> &'static str {
    match std::env::consts::ARCH {
        "aarch64" => "arm64",
        "x86_64" => "amd64",
        other => other,
    }
}

/// Architecture of every local image, so containers built from a foreign-arch
/// image can be labelled "emulated". Podman lists it directly; Docker needs
/// one `image inspect` over all ids.
#[tauri::command]
pub async fn image_archs(runtime: String) -> Result<Vec<ImageArch>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["images", "--format", "json"])?;
    let rows = super::parse_json_lines(&raw);
    let host = host_arch();
    let mut out: Vec<ImageArch> = rows
        .iter()
        .map(|r| {
            let id = r
                .get("Id")
                .or_else(|| r.get("ID"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim_start_matches("sha256:")
                .to_string();
            let mut names: Vec<String> = r
                .get("Names")
                .and_then(|v| v.as_array())
                .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
                .unwrap_or_default();
            if let (Some(repo), Some(tag)) = (
                r.get("Repository").and_then(|v| v.as_str()),
                r.get("Tag").and_then(|v| v.as_str()),
            ) {
                names.push(format!("{repo}:{tag}"));
            }
            let arch = r.get("Arch").and_then(|v| v.as_str()).unwrap_or("").to_string();
            ImageArch { id, names, arch, emulated: false }
        })
        .collect();

    // Docker's list carries no architecture: ask inspect for all ids at once.
    if out.iter().any(|i| i.arch.is_empty()) && !out.is_empty() {
        let mut args: Vec<String> =
            vec!["image".into(), "inspect".into(), "--format".into(), "{{.Id}} {{.Architecture}}".into()];
        args.extend(out.iter().map(|i| i.id.clone()));
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        if let Ok(text) = super::run(&bin, &refs) {
            for line in text.lines() {
                let mut parts = line.split_whitespace();
                let (Some(id), Some(arch)) = (parts.next(), parts.next()) else { continue };
                let id = id.trim_start_matches("sha256:");
                if let Some(img) = out.iter_mut().find(|i| id.starts_with(&i.id) || i.id.starts_with(id)) {
                    img.arch = arch.to_string();
                }
            }
        }
    }

    for img in &mut out {
        img.emulated = !img.arch.is_empty() && img.arch != host;
    }
    Ok(out)
}

#[tauri::command]
pub async fn inspect_image(
    runtime: String,
    id: String,
) -> Result<serde_json::Value, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(&bin, &["image", "inspect", &id])?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_image(
    runtime: String,
    term: String,
) -> Result<Vec<serde_json::Value>, String> {
    let bin = super::resolve(&runtime)?;
    let raw = super::run(
        &bin,
        &["search", &term, "--format", "json", "--limit", "25"],
    )?;
    Ok(super::parse_json_lines(&raw))
}

/// Push an image to its registry (blocks until complete).
#[tauri::command]
pub async fn push_image(runtime: String, tag: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["push", &tag]).map(|_| ())
}

/// Remove all images not used by a container; returns the CLI summary.
#[tauri::command]
pub async fn prune_images(runtime: String) -> Result<String, String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["image", "prune", "--all", "--force"])
}

/// Add a new tag (`name:tag`) pointing at an existing image.
#[tauri::command]
pub async fn tag_image(
    runtime: String,
    source: String,
    target: String,
) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["tag", &source, &target]).map(|_| ())
}
