// Image commands — listing, removal, pull, inspection and search.

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

/// Pull an image, blocking until complete (the frontend renders its own
/// progress indicator).
#[tauri::command]
pub async fn pull_image(runtime: String, image: String) -> Result<(), String> {
    let bin = super::resolve(&runtime)?;
    super::run(&bin, &["pull", &image]).map(|_| ())
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
