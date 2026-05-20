# DOCKMAN — Unified Docker + Podman Desktop GUI
## Claude Code Agent Master Prompt

> Feed this entire document as the initial prompt. Implement phases in order.
> Stop and confirm with the user before starting Phase 5 (Frontend Pages).

---

## 🧭 What We're Building

**Dockman** is a free, open-source desktop GUI that unifies Docker and Podman into one interface. It:

- Works with whatever the dev already has installed (Docker, Podman, or both)
- Lets the dev choose which runtime(s) to use — single or both simultaneously
- Detects existing binaries automatically, or downloads them if missing
- Starts the runtime daemon on system login (like Docker Desktop does)
- Has a first-run setup wizard so there's zero config friction
- Shells directly to CLI binaries — no SDK, no daemon socket hacks

**What it is NOT:**
- Not a Docker Desktop replacement that bundles a VM
- Not a server tool (no Portainer-style remote management in v1)
- Does not install or require docker-compose as a standalone binary
  (uses `docker compose` plugin or `podman compose` which is built into Podman 4+)

---

## 🗂 Phase 0: Project Scaffold

### 0.1 Bootstrap

```bash
npm create tauri-app@latest
# Prompts:
#   Project name:   dockman
#   Identifier:     com.dockman.app
#   Frontend:       React
#   Package manager: npm
#   TypeScript:     yes

cd dockman
npm install
```

### 0.2 Frontend dependencies

```bash
npm install @tanstack/react-query zustand react-router-dom lucide-react
npm install xterm xterm-addon-fit xterm-addon-web-links
npm install -D tailwindcss @tailwindcss/vite
```

> **xterm.js** is used for the in-app container terminal (exec) and live log viewer.

### 0.3 Cargo.toml additions

```toml
[dependencies]
tauri = { version = "2", features = [] }
tauri-plugin-shell = "2"
tauri-plugin-fs = "2"
tauri-plugin-http = "2"
tauri-plugin-dialog = "2"
tauri-plugin-notification = "2"
tauri-plugin-autostart = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
which = "6"
dirs = "5"
```

### 0.4 Register all plugins in `src-tauri/src/lib.rs`

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    .plugin(tauri_plugin_fs::init())
    .plugin(tauri_plugin_http::init())
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_autostart::init(
        tauri_plugin_autostart::MacosLauncher::LaunchAgent,
        Some(vec!["--minimized"])
    ))
    .invoke_handler(tauri::generate_handler![ /* all commands */ ])
```

---

## 🗃 Phase 1: Project Structure

```
dockman/
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── router.tsx
│   ├── index.css
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   └── StatusBar.tsx
│   │   ├── wizard/
│   │   │   ├── SetupWizard.tsx          ← first-run flow
│   │   │   ├── WizardStep1_Runtime.tsx  ← choose Docker / Podman / Both
│   │   │   ├── WizardStep2_Binary.tsx   ← detect or download
│   │   │   └── WizardStep3_Done.tsx
│   │   ├── runtime/
│   │   │   ├── RuntimeBadge.tsx
│   │   │   ├── RuntimeSwitcher.tsx
│   │   │   └── RuntimeStatusCard.tsx
│   │   ├── containers/
│   │   │   ├── ContainerList.tsx
│   │   │   ├── ContainerCard.tsx
│   │   │   ├── ContainerDetail.tsx      ← slide-over panel
│   │   │   ├── ContainerLogs.tsx        ← xterm.js log viewer
│   │   │   ├── ContainerTerminal.tsx    ← xterm.js exec shell
│   │   │   ├── ContainerEnvVars.tsx
│   │   │   ├── ContainerPortList.tsx
│   │   │   └── RunContainerModal.tsx
│   │   ├── compose/
│   │   │   ├── ComposeList.tsx          ← discovered compose projects
│   │   │   ├── ComposeDetail.tsx
│   │   │   └── ComposeFileViewer.tsx
│   │   ├── images/
│   │   │   ├── ImageList.tsx
│   │   │   ├── PullImageModal.tsx
│   │   │   └── RegistryAuthModal.tsx
│   │   ├── builds/
│   │   │   ├── BuildList.tsx            ← build history list
│   │   │   ├── BuildCard.tsx            ← single build row
│   │   │   ├── BuildDetail.tsx          ← right panel: layers, stats, dockerfile
│   │   │   ├── BuildLayerWaterfall.tsx  ← visual layer timeline chart
│   │   │   ├── BuildCacheStats.tsx      ← cache size + base image breakdown
│   │   │   ├── BuildOutputTerminal.tsx  ← xterm.js live build output
│   │   │   ├── NewBuildModal.tsx        ← trigger new build with options
│   │   │   └── DockerfileViewer.tsx     ← syntax-highlighted dockerfile source
│   │   ├── volumes/
│   │   │   ├── VolumeList.tsx
│   │   │   └── VolumeCard.tsx
│   │   └── shared/
│   │       ├── SearchBar.tsx
│   │       ├── Badge.tsx
│   │       ├── ConfirmModal.tsx
│   │       ├── Toast.tsx
│   │       └── EmptyState.tsx
│   ├── pages/
│   │   ├── Dashboard.tsx
│   │   ├── Containers.tsx
│   │   ├── Compose.tsx
│   │   ├── Images.tsx
│   │   ├── Builds.tsx
│   │   ├── Volumes.tsx
│   │   ├── BinaryManager.tsx
│   │   └── Settings.tsx
│   ├── store/
│   │   ├── runtimeStore.ts
│   │   ├── settingsStore.ts
│   │   ├── buildsStore.ts
│   │   └── wizardStore.ts
│   ├── hooks/
│   │   ├── useRuntime.ts
│   │   ├── useContainers.ts
│   │   ├── useImages.ts
│   │   ├── useCompose.ts
│   │   ├── useBuilds.ts
│   │   └── useVolumes.ts
│   ├── lib/
│   │   ├── commands.ts
│   │   ├── parsers.ts
│   │   └── constants.ts
│   └── types/
│       ├── runtime.ts
│       ├── container.ts
│       ├── image.ts
│       ├── compose.ts
│       ├── build.ts
│       └── volume.ts
├── src-tauri/
│   ├── src/
│   │   ├── lib.rs
│   │   └── commands/
│   │       ├── mod.rs
│   │       ├── runtime.rs
│   │       ├── containers.rs
│   │       ├── images.rs
│   │       ├── volumes.rs
│   │       ├── compose.rs
│   │       ├── exec.rs
│   │       ├── builds.rs
│   │       └── downloader.rs
└── src-tauri/Cargo.toml
```

---

## 🔧 Phase 2: Rust Backend — Core Types

### `src-tauri/src/commands/mod.rs`

```rust
pub mod runtime;
pub mod containers;
pub mod images;
pub mod volumes;
pub mod compose;
pub mod exec;
pub mod builds;
pub mod downloader;
```

### Shared types (`src-tauri/src/commands/runtime.rs` — top section)

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RuntimeInfo {
    pub runtime: String,       // "docker" | "podman"
    pub found: bool,
    pub path: String,
    pub version: String,
    pub is_running: bool,      // daemon/service is up
    pub arch: String,          // "aarch64" | "x86_64"
    pub compose_available: bool, // docker compose plugin or podman compose
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Container {
    pub id: String,
    pub short_id: String,
    pub names: Vec<String>,
    pub image: String,
    pub image_id: String,
    pub status: String,
    pub state: String,         // running | exited | paused | created
    pub created: i64,
    pub ports: Vec<PortMapping>,
    pub labels: std::collections::HashMap<String, String>,
    pub runtime: String,
    pub compose_project: Option<String>,  // from label com.docker.compose.project
    pub compose_service: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct PortMapping {
    pub host_ip: String,
    pub host_port: u16,
    pub container_port: u16,
    pub protocol: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Image {
    pub id: String,
    pub repo_tags: Vec<String>,
    pub size: u64,
    pub created: i64,
    pub runtime: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Volume {
    pub name: String,
    pub driver: String,
    pub mountpoint: String,
    pub created: String,
    pub runtime: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ContainerStats {
    pub cpu_percent: f64,
    pub memory_usage: u64,
    pub memory_limit: u64,
    pub memory_percent: f64,
    pub network_rx: u64,
    pub network_tx: u64,
    pub block_read: u64,
    pub block_write: u64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComposeProject {
    pub name: String,
    pub config_files: Vec<String>,  // paths to compose yml files
    pub services: Vec<ComposeService>,
    pub runtime: String,
    pub status: String,             // running | partial | stopped
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ComposeService {
    pub name: String,
    pub image: String,
    pub container_id: Option<String>,
    pub state: String,
    pub ports: Vec<PortMapping>,
}
```

---

## 🔧 Phase 3: Rust Backend — Commands

### 3.1 Runtime (`commands/runtime.rs`)

```rust
// Detect a single runtime — check PATH, well-known paths, custom config path
#[tauri::command]
pub async fn detect_runtime(runtime: String) -> Result<RuntimeInfo, String>

// Detect all configured runtimes at once
#[tauri::command]
pub async fn detect_all_runtimes() -> Result<Vec<RuntimeInfo>, String>

// Get the user's runtime mode from persisted settings
// Returns: "docker" | "podman" | "both"
#[tauri::command]
pub async fn get_runtime_mode() -> Result<String, String>

// Set runtime mode + persist to config file (~/.config/dockman/config.json)
#[tauri::command]
pub async fn set_runtime_mode(mode: String) -> Result<(), String>

// Override the binary path for a runtime (stored in config)
#[tauri::command]
pub async fn set_runtime_path(runtime: String, path: String) -> Result<(), String>

// Get the stored custom path for a runtime (or empty string if none)
#[tauri::command]
pub async fn get_runtime_path(runtime: String) -> Result<String, String>

// Start the runtime daemon (docker daemon or podman machine start)
#[tauri::command]
pub async fn start_runtime_daemon(runtime: String) -> Result<(), String>

// Stop the runtime daemon
#[tauri::command]
pub async fn stop_runtime_daemon(runtime: String) -> Result<(), String>

// Enable/disable start-on-login using tauri-plugin-autostart
#[tauri::command]
pub async fn set_start_on_login(enabled: bool) -> Result<(), String>

#[tauri::command]
pub async fn get_start_on_login() -> Result<bool, String>
```

**Detection logic (implement in this order):**
1. Check config for a user-set custom path → use it if file exists
2. Use `which` crate to find binary in PATH
3. Check well-known paths per platform:
   ```
   macOS Docker:  /Applications/Docker.app/Contents/Resources/bin/docker
   macOS Podman:  /opt/homebrew/bin/podman  |  /usr/local/bin/podman
   Linux Docker:  /usr/bin/docker  |  /usr/local/bin/docker
   Linux Podman:  /usr/bin/podman
   Windows Docker: C:\Program Files\Docker\Docker\resources\bin\docker.exe
   Windows Podman: C:\Program Files\RedHat\Podman\podman.exe
   ```
4. Run `{binary} version --format json` to confirm it works
5. Check `compose_available`:
   - Docker: run `docker compose version` (exit 0 = available)
   - Podman: run `podman compose version` (built-in since v4)
6. Check `is_running`:
   - Docker: `docker info` exit code
   - Podman: `podman info` exit code (rootless, usually always ok)

**⚠️ macOS PATH fix (critical):**
Tauri GUI apps don't inherit shell PATH. Before any command exec, build PATH manually:
```rust
fn get_shell_path() -> String {
    // Read /etc/paths line by line
    // Read ~/.zshrc and ~/.bashrc, extract export PATH=... lines
    // Merge with std::env::var("PATH")
    // Return combined PATH string
}
// Pass as .env("PATH", get_shell_path()) on every Command spawn
```

---

### 3.2 Containers (`commands/containers.rs`)

All commands accept `runtime: String` parameter.

```rust
#[tauri::command]
pub async fn list_containers(runtime: String, all: bool) -> Result<Vec<Container>, String>
// {runtime} ps --format json [--all]
// Parse JSON, add `runtime` field, extract compose labels

#[tauri::command]
pub async fn start_container(runtime: String, id: String) -> Result<(), String>

#[tauri::command]
pub async fn stop_container(runtime: String, id: String) -> Result<(), String>

#[tauri::command]
pub async fn restart_container(runtime: String, id: String) -> Result<(), String>

#[tauri::command]
pub async fn pause_container(runtime: String, id: String) -> Result<(), String>

#[tauri::command]
pub async fn unpause_container(runtime: String, id: String) -> Result<(), String>

#[tauri::command]
pub async fn remove_container(runtime: String, id: String, force: bool) -> Result<(), String>

#[tauri::command]
pub async fn inspect_container(runtime: String, id: String) -> Result<serde_json::Value, String>
// Returns full raw inspect JSON for display

#[tauri::command]
pub async fn get_container_logs(
    runtime: String,
    id: String,
    tail: u32,
    timestamps: bool,
    app: tauri::AppHandle,
) -> Result<(), String>
// Spawns: {runtime} logs --tail {n} --follow [--timestamps] {id}
// Streams each line via event: app.emit("container-logs-{id}", line)
// Frontend listens and appends to xterm.js

#[tauri::command]
pub async fn stop_container_logs(id: String) -> Result<(), String>
// Kill the spawned logs process for this container id

#[tauri::command]
pub async fn get_container_stats(
    runtime: String,
    id: String,
    app: tauri::AppHandle,
) -> Result<(), String>
// Spawns: {runtime} stats {id} --format json (streaming)
// Emits: app.emit("container-stats-{id}", ContainerStats)

#[tauri::command]
pub async fn stop_container_stats(id: String) -> Result<(), String>

#[tauri::command]
pub async fn get_container_env(runtime: String, id: String) -> Result<Vec<String>, String>
// Parses inspect JSON .Config.Env

#[tauri::command]
pub async fn run_container(
    runtime: String,
    image: String,
    name: Option<String>,
    ports: Vec<String>,    // ["8080:80", "443:443"]
    env: Vec<String>,      // ["KEY=value"]
    volumes: Vec<String>,  // ["/host:/container"]
    detach: bool,
) -> Result<String, String>
// Returns container ID
```

---

### 3.3 Container Exec (`commands/exec.rs`)

Terminal into a running container via `docker exec -it`.

```rust
// The exec terminal uses a PTY approach.
// Since xterm.js is in the frontend, we use a pipe-based approach:
// Spawn: {runtime} exec -i {id} {shell}
// stdin comes from frontend events, stdout streams back via events.

#[tauri::command]
pub async fn exec_start(
    runtime: String,
    id: String,
    shell: String,    // "/bin/bash" | "/bin/sh" | "sh"
    app: tauri::AppHandle,
) -> Result<String, String>
// Returns a session_id (UUID)
// Spawns the exec process, stores stdin handle in a global map keyed by session_id
// Emits stdout/stderr via: app.emit("exec-output-{session_id}", data)

#[tauri::command]
pub async fn exec_input(session_id: String, input: String) -> Result<(), String>
// Writes input to the spawned process stdin

#[tauri::command]
pub async fn exec_resize(session_id: String, cols: u32, rows: u32) -> Result<(), String>
// Send TIOCSWINSZ if PTY available, otherwise no-op

#[tauri::command]
pub async fn exec_stop(session_id: String) -> Result<(), String>
// Kill process and clean up from map
```

**Shell detection order:** try `/bin/bash` → `/bin/sh` → `sh`

---

### 3.4 Images (`commands/images.rs`)

```rust
#[tauri::command]
pub async fn list_images(runtime: String) -> Result<Vec<Image>, String>

#[tauri::command]
pub async fn pull_image(
    runtime: String,
    image: String,
    app: tauri::AppHandle,
) -> Result<(), String>
// Spawns: {runtime} pull {image}
// Streams each output line via: app.emit("pull-progress", { runtime, image, line })

#[tauri::command]
pub async fn remove_image(runtime: String, id: String, force: bool) -> Result<(), String>

#[tauri::command]
pub async fn inspect_image(runtime: String, id: String) -> Result<serde_json::Value, String>

#[tauri::command]
pub async fn search_image(runtime: String, term: String) -> Result<Vec<SearchResult>, String>
// {runtime} search {term} --format json --limit 25

#[tauri::command]
pub async fn build_image(
    runtime: String,
    dockerfile_path: String,
    context_path: String,
    tag: String,
    build_args: Vec<String>,   // ["KEY=value"]
    app: tauri::AppHandle,
) -> Result<(), String>
// Spawns: {runtime} build -t {tag} [--build-arg ...] -f {dockerfile} {context}
// Streams build output line by line via: app.emit("build-progress", { line })

#[tauri::command]
pub async fn registry_login(
    runtime: String,
    server: String,
    username: String,
    password: String,
) -> Result<(), String>
// {runtime} login {server} --username {u} --password-stdin
// Pipes password to stdin
```

---

### 3.5 Volumes (`commands/volumes.rs`)

```rust
#[tauri::command]
pub async fn list_volumes(runtime: String) -> Result<Vec<Volume>, String>

#[tauri::command]
pub async fn create_volume(runtime: String, name: String) -> Result<(), String>

#[tauri::command]
pub async fn remove_volume(runtime: String, name: String, force: bool) -> Result<(), String>

#[tauri::command]
pub async fn inspect_volume(runtime: String, name: String) -> Result<serde_json::Value, String>

#[tauri::command]
pub async fn prune_volumes(runtime: String) -> Result<String, String>
// {runtime} volume prune --force
// Returns summary string of what was removed
```

---

### 3.6 Compose (`commands/compose.rs`)

Uses `docker compose` (plugin) or `podman compose` (built-in). No separate binary install needed.

```rust
#[tauri::command]
pub async fn list_compose_projects(runtime: String) -> Result<Vec<ComposeProject>, String>
// {runtime} compose ls --format json
// Then for each project, run: {runtime} compose ps --format json to get service states

#[tauri::command]
pub async fn compose_up(
    runtime: String,
    project_name: String,
    compose_file: String,
    detach: bool,
    app: tauri::AppHandle,
) -> Result<(), String>
// {runtime} compose -f {file} up [--detach]
// Streams output via: app.emit("compose-output", { line })

#[tauri::command]
pub async fn compose_down(
    runtime: String,
    project_name: String,
    compose_file: String,
    remove_volumes: bool,
) -> Result<(), String>

#[tauri::command]
pub async fn compose_restart(
    runtime: String,
    project_name: String,
    compose_file: String,
    service: Option<String>,   // None = all services
) -> Result<(), String>

#[tauri::command]
pub async fn compose_logs(
    runtime: String,
    project_name: String,
    compose_file: String,
    service: Option<String>,
    app: tauri::AppHandle,
) -> Result<(), String>
// Streams via: app.emit("compose-logs-{project_name}", { line })

#[tauri::command]
pub async fn open_compose_file(compose_file: String) -> Result<(), String>
// Opens the .yml file in the system default editor via shell open
```

---

### 3.7 Builds (`commands/builds.rs`)

Dockman tracks every image build it has triggered, persisting a local build history to `~/.config/dockman/builds.json`. Each build record stores what the CLI already tells us — we parse `docker build --progress=plain` output to extract layer timings and cache hits.

```rust
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BuildRecord {
    pub id: String,                   // UUID generated by Dockman
    pub tag: String,                  // e.g. "pier/api-gw:0.14.2"
    pub dockerfile: String,           // absolute path
    pub context_path: String,
    pub runtime: String,
    pub status: String,               // "success" | "failed" | "running" | "cancelled"
    pub started_at: i64,              // unix ms
    pub finished_at: Option<i64>,
    pub duration_secs: Option<u32>,
    pub final_size_bytes: Option<u64>,
    pub layers: Vec<BuildLayer>,
    pub cache_hit_percent: Option<f32>,
    pub build_args: Vec<String>,
    pub platform: Option<String>,     // e.g. "linux/arm64,linux/amd64"
    pub push_on_success: bool,
    pub use_cache: bool,
    pub error_message: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BuildLayer {
    pub step: u32,                    // layer number (01, 02...)
    pub instruction: String,          // e.g. "RUN npm ci"
    pub cached: bool,
    pub duration_ms: Option<u64>,
}

// List all past builds from local history (newest first)
#[tauri::command]
pub async fn list_builds() -> Result<Vec<BuildRecord>, String>
// Reads ~/.config/dockman/builds.json

// Get a single build record by id
#[tauri::command]
pub async fn get_build(id: String) -> Result<BuildRecord, String>

// Trigger a new build — replaces the old build_image command in images.rs
#[tauri::command]
pub async fn start_build(
    runtime: String,
    tag: String,
    dockerfile: String,
    context_path: String,
    build_args: Vec<String>,
    platform: Option<String>,    // None = current arch; "linux/arm64,linux/amd64" = multi
    use_cache: bool,
    push_on_success: bool,
    app: tauri::AppHandle,
) -> Result<String, String>
// 1. Create BuildRecord, save to builds.json with status="running"
// 2. Spawn: {runtime} build --progress=plain [options] -t {tag} -f {dockerfile} {context}
//    --no-cache if use_cache = false
//    --platform {platform} if set
// 3. Parse stdout line by line:
//    - Lines matching "#N CACHED" → layer.cached = true
//    - Lines matching "#N DONE Xs" → layer.duration_ms = X * 1000
//    - Lines matching "writing image sha256:..." → extract final size
// 4. Emit each raw line: app.emit("build-output-{id}", { line })
// 5. Emit parsed layer updates: app.emit("build-layer-{id}", BuildLayer)
// 6. On process exit:
//    - exit 0 → update status="success", finished_at, duration_secs, cache_hit_percent
//    - exit != 0 → status="failed", store last stderr line as error_message
//    - if push_on_success && success → run: {runtime} push {tag}
// 7. Persist final BuildRecord to builds.json
// Returns: build id

// Cancel a running build
#[tauri::command]
pub async fn cancel_build(id: String) -> Result<(), String>
// Kill the child process stored in global build map
// Update record status to "cancelled"

// Delete a build record from history (does not remove the image)
#[tauri::command]
pub async fn delete_build(id: String) -> Result<(), String>

// Read the dockerfile source for display
#[tauri::command]
pub async fn read_dockerfile(path: String) -> Result<String, String>
// fs::read_to_string(path) — just reads the file content

// Clear all build history
#[tauri::command]
pub async fn clear_build_history() -> Result<(), String>
```

**Cache hit % calculation:**
```rust
// After build completes, compute from parsed layers:
let total = layers.len();
let cached = layers.iter().filter(|l| l.cached).count();
let percent = if total > 0 { (cached as f32 / total as f32) * 100.0 } else { 0.0 };
```

**Layer waterfall data:**
Layers are ordered by step number. The frontend uses `duration_ms` to render proportional width bars (like the OrbStack screenshot). Cached layers get a distinct color vs freshly-built layers.

**Multi-platform builds:**
Pass `--platform linux/arm64,linux/amd64` to the build command. This requires `buildx` for Docker (check availability: `docker buildx version`). For Podman, use `--platform` flag directly. Surface a warning in the UI if buildx is not available.

---

### 3.8 Binary Downloader (`commands/downloader.rs`)

Download just the CLI binary — no Docker Desktop, no VM.

```rust
#[derive(Serialize, Deserialize)]
pub struct BinaryRelease {
    pub version: String,
    pub url: String,
    pub checksum_url: Option<String>,
    pub platform: String,
    pub arch: String,
}

#[tauri::command]
pub async fn get_available_releases(runtime: String) -> Result<Vec<BinaryRelease>, String>
// Docker:  https://download.docker.com/mac/static/stable/ (parse index)
//          Platform-specific:
//            macOS arm64: https://download.docker.com/mac/static/stable/aarch64/
//            macOS x86:   https://download.docker.com/mac/static/stable/x86_64/
//            Linux x86:   https://download.docker.com/linux/static/stable/x86_64/
// Podman:  https://api.github.com/repos/containers/podman/releases
//          Filter assets by platform+arch, return top 5 versions

#[tauri::command]
pub async fn download_binary(
    runtime: String,
    version: String,
    install_dir: String,
    app: tauri::AppHandle,
) -> Result<String, String>
// 1. Download .tar.gz or .zip to temp dir
// 2. Emit download-progress events: { percent: f64, downloaded: u64, total: u64 }
// 3. Extract the binary from archive
// 4. Copy to install_dir/{runtime}
// 5. chmod +x on unix
// 6. Return full path to binary

#[tauri::command]
pub async fn add_to_path(dir: String) -> Result<(), String>
// macOS/Linux: append to ~/.zshrc and ~/.bashrc if not already present:
//   export PATH="$PATH:{dir}"
// Windows: update HKCU\Environment\Path registry key

#[tauri::command]
pub async fn get_default_install_dir() -> Result<String, String>
// Returns:
//   macOS/Linux: ~/.local/bin  (create if not exists)
//   Windows:     %LOCALAPPDATA%\dockman\bin

#[tauri::command]
pub async fn verify_binary(path: String) -> Result<String, String>
// Run: {path} version → return version string
// Error if non-zero exit
```

---

## 🎨 Phase 4: Frontend Foundation

### 4.1 Design System

**Aesthetic:** Dark industrial terminal — clean and purposeful. Every element has intent.

```css
/* src/index.css */
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');

:root {
  /* Backgrounds */
  --bg-base:     #0c0d0f;
  --bg-surface:  #13151a;
  --bg-elevated: #1a1d24;
  --bg-hover:    #22262f;
  --bg-active:   #272b35;

  /* Borders */
  --border:        #252830;
  --border-subtle: #1c1f26;
  --border-focus:  #3d4354;

  /* Text */
  --text-primary:   #dde1ea;
  --text-secondary: #8b92a4;
  --text-muted:     #4e5568;
  --text-code:      #a8d8b9;

  /* Runtime accent colors */
  --docker:  #1d76c8;
  --podman:  #7c3aed;

  /* State colors */
  --green:  #22c55e;
  --red:    #ef4444;
  --yellow: #f59e0b;
  --cyan:   #06b6d4;
  --orange: #f97316;

  /* Typography */
  --font-ui:   'IBM Plex Sans', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', 'JetBrains Mono', monospace;

  /* Geometry */
  --radius:    4px;
  --radius-md: 6px;
  --radius-lg: 10px;
}
```

---

### 4.2 TypeScript Types (`src/types/`)

```typescript
// types/runtime.ts
export type RuntimeName = 'docker' | 'podman';
export type RuntimeMode = 'docker' | 'podman' | 'both';

export interface RuntimeInfo {
  runtime: RuntimeName;
  found: boolean;
  path: string;
  version: string;
  isRunning: boolean;
  arch: string;
  composeAvailable: boolean;
}

// types/container.ts
export interface Container {
  id: string;
  shortId: string;
  names: string[];
  image: string;
  status: string;
  state: 'running' | 'exited' | 'paused' | 'created' | 'restarting';
  created: number;
  ports: PortMapping[];
  labels: Record<string, string>;
  runtime: RuntimeName;
  composeProject?: string;
  composeService?: string;
}

export interface PortMapping {
  hostIp: string;
  hostPort: number;
  containerPort: number;
  protocol: string;
}

export interface ContainerStats {
  cpuPercent: number;
  memoryUsage: number;
  memoryLimit: number;
  memoryPercent: number;
  networkRx: number;
  networkTx: number;
}

// types/build.ts
export type BuildStatus = 'running' | 'success' | 'failed' | 'cancelled';

export interface BuildRecord {
  id: string;
  tag: string;
  dockerfile: string;
  contextPath: string;
  runtime: RuntimeName;
  status: BuildStatus;
  startedAt: number;
  finishedAt?: number;
  durationSecs?: number;
  finalSizeBytes?: number;
  layers: BuildLayer[];
  cacheHitPercent?: number;
  buildArgs: string[];
  platform?: string;
  pushOnSuccess: boolean;
  useCache: boolean;
  errorMessage?: string;
}

export interface BuildLayer {
  step: number;
  instruction: string;
  cached: boolean;
  durationMs?: number;
}

export interface NewBuildConfig {
  runtime: RuntimeName;
  tag: string;
  dockerfile: string;
  contextPath: string;
  buildArgs: string[];
  platform?: string;
  useCache: boolean;
  pushOnSuccess: boolean;
}


export interface ComposeProject {
  name: string;
  configFiles: string[];
  services: ComposeService[];
  runtime: RuntimeName;
  status: 'running' | 'partial' | 'stopped';
}

export interface ComposeService {
  name: string;
  image: string;
  containerId?: string;
  state: string;
  ports: PortMapping[];
}
```

---

### 4.3 Zustand Stores

#### `src/store/runtimeStore.ts`

```typescript
interface RuntimeStore {
  mode: RuntimeMode;                         // 'docker' | 'podman' | 'both'
  runtimes: Record<RuntimeName, RuntimeInfo | null>;
  isDetecting: boolean;

  setMode: (mode: RuntimeMode) => void;
  detectAll: () => Promise<void>;
  startDaemon: (runtime: RuntimeName) => Promise<void>;
  stopDaemon: (runtime: RuntimeName) => Promise<void>;
}
// Persist mode and custom paths to localStorage
```

#### `src/store/settingsStore.ts`

```typescript
interface SettingsStore {
  startOnLogin: boolean;
  refreshInterval: number;        // seconds, default 5
  autoFallback: boolean;          // M1 arch fallback
  showSystemContainers: boolean;  // hide infra containers
  defaultShell: string;           // /bin/bash | /bin/sh | sh

  setStartOnLogin: (v: boolean) => void;
  setRefreshInterval: (v: number) => void;
  setAutoFallback: (v: boolean) => void;
  setShowSystemContainers: (v: boolean) => void;
  setDefaultShell: (v: string) => void;
}
```

#### `src/store/wizardStore.ts`

```typescript
interface WizardStore {
  completed: boolean;         // persisted to localStorage
  step: number;
  selectedMode: RuntimeMode;
  setCompleted: (v: boolean) => void;
  setStep: (n: number) => void;
  setSelectedMode: (m: RuntimeMode) => void;
}
```

---

### 4.4 Commands Bridge (`src/lib/commands.ts`)

```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export const RuntimeCommands = {
  detectAll: () => invoke<RuntimeInfo[]>('detect_all_runtimes'),
  getMode: () => invoke<RuntimeMode>('get_runtime_mode'),
  setMode: (mode: RuntimeMode) => invoke<void>('set_runtime_mode', { mode }),
  getPath: (runtime: string) => invoke<string>('get_runtime_path', { runtime }),
  setPath: (runtime: string, path: string) => invoke<void>('set_runtime_path', { runtime, path }),
  startDaemon: (runtime: string) => invoke<void>('start_runtime_daemon', { runtime }),
  stopDaemon: (runtime: string) => invoke<void>('stop_runtime_daemon', { runtime }),
  setStartOnLogin: (enabled: boolean) => invoke<void>('set_start_on_login', { enabled }),
  getStartOnLogin: () => invoke<boolean>('get_start_on_login'),
};

export const ContainerCommands = {
  list: (runtime: string, all = false) =>
    invoke<Container[]>('list_containers', { runtime, all }),
  start: (runtime: string, id: string) => invoke<void>('start_container', { runtime, id }),
  stop: (runtime: string, id: string) => invoke<void>('stop_container', { runtime, id }),
  restart: (runtime: string, id: string) => invoke<void>('restart_container', { runtime, id }),
  pause: (runtime: string, id: string) => invoke<void>('pause_container', { runtime, id }),
  unpause: (runtime: string, id: string) => invoke<void>('unpause_container', { runtime, id }),
  remove: (runtime: string, id: string, force = false) =>
    invoke<void>('remove_container', { runtime, id, force }),
  inspect: (runtime: string, id: string) =>
    invoke<object>('inspect_container', { runtime, id }),
  getLogs: (runtime: string, id: string, tail = 200) =>
    invoke<void>('get_container_logs', { runtime, id, tail, timestamps: true }),
  stopLogs: (id: string) => invoke<void>('stop_container_logs', { id }),
  startStats: (runtime: string, id: string) =>
    invoke<void>('get_container_stats', { runtime, id }),
  stopStats: (id: string) => invoke<void>('stop_container_stats', { id }),
  getEnv: (runtime: string, id: string) =>
    invoke<string[]>('get_container_env', { runtime, id }),
  run: (runtime: string, config: RunContainerConfig) =>
    invoke<string>('run_container', { runtime, ...config }),
};

export const ExecCommands = {
  start: (runtime: string, id: string, shell: string) =>
    invoke<string>('exec_start', { runtime, id, shell }),
  input: (sessionId: string, input: string) =>
    invoke<void>('exec_input', { sessionId, input }),
  resize: (sessionId: string, cols: number, rows: number) =>
    invoke<void>('exec_resize', { sessionId, cols, rows }),
  stop: (sessionId: string) => invoke<void>('exec_stop', { sessionId }),
};

export const ImageCommands = {
  list: (runtime: string) => invoke<Image[]>('list_images', { runtime }),
  pull: (runtime: string, image: string) => invoke<void>('pull_image', { runtime, image }),
  remove: (runtime: string, id: string, force = false) =>
    invoke<void>('remove_image', { runtime, id, force }),
  search: (runtime: string, term: string) =>
    invoke<SearchResult[]>('search_image', { runtime, term }),
  build: (runtime: string, config: BuildConfig) =>
    invoke<void>('build_image', { runtime, ...config }),
  login: (runtime: string, server: string, username: string, password: string) =>
    invoke<void>('registry_login', { runtime, server, username, password }),
};

export const VolumeCommands = {
  list: (runtime: string) => invoke<Volume[]>('list_volumes', { runtime }),
  create: (runtime: string, name: string) => invoke<void>('create_volume', { runtime, name }),
  remove: (runtime: string, name: string, force = false) =>
    invoke<void>('remove_volume', { runtime, name, force }),
  prune: (runtime: string) => invoke<string>('prune_volumes', { runtime }),
};

export const ComposeCommands = {
  list: (runtime: string) => invoke<ComposeProject[]>('list_compose_projects', { runtime }),
  up: (runtime: string, projectName: string, composeFile: string, detach = true) =>
    invoke<void>('compose_up', { runtime, projectName, composeFile, detach }),
  down: (runtime: string, projectName: string, composeFile: string, removeVolumes = false) =>
    invoke<void>('compose_down', { runtime, projectName, composeFile, removeVolumes }),
  restart: (runtime: string, projectName: string, composeFile: string, service?: string) =>
    invoke<void>('compose_restart', { runtime, projectName, composeFile, service }),
  logs: (runtime: string, projectName: string, composeFile: string, service?: string) =>
    invoke<void>('compose_logs', { runtime, projectName, composeFile, service }),
  openFile: (composeFile: string) => invoke<void>('open_compose_file', { composeFile }),
};

export const BuildCommands = {
  list: () => invoke<BuildRecord[]>('list_builds'),
  get: (id: string) => invoke<BuildRecord>('get_build', { id }),
  start: (config: NewBuildConfig) => invoke<string>('start_build', { ...config }),
  cancel: (id: string) => invoke<void>('cancel_build', { id }),
  delete: (id: string) => invoke<void>('delete_build', { id }),
  readDockerfile: (path: string) => invoke<string>('read_dockerfile', { path }),
  clearHistory: () => invoke<void>('clear_build_history'),
};


  getReleases: (runtime: string) =>
    invoke<BinaryRelease[]>('get_available_releases', { runtime }),
  download: (runtime: string, version: string, installDir: string) =>
    invoke<string>('download_binary', { runtime, version, installDir }),
  addToPath: (dir: string) => invoke<void>('add_to_path', { dir }),
  getDefaultDir: () => invoke<string>('get_default_install_dir'),
  verify: (path: string) => invoke<string>('verify_binary', { path }),
};

// Event listeners (Tauri event system)
export const Events = {
  onContainerLogs: (id: string, cb: (line: string) => void) =>
    listen(`container-logs-${id}`, (e) => cb(e.payload as string)),
  onContainerStats: (id: string, cb: (stats: ContainerStats) => void) =>
    listen(`container-stats-${id}`, (e) => cb(e.payload as ContainerStats)),
  onExecOutput: (sessionId: string, cb: (data: string) => void) =>
    listen(`exec-output-${sessionId}`, (e) => cb(e.payload as string)),
  onPullProgress: (cb: (data: { line: string }) => void) =>
    listen('pull-progress', (e) => cb(e.payload as any)),
  onBuildProgress: (cb: (data: { line: string }) => void) =>
    listen('build-progress', (e) => cb(e.payload as any)),
  onBuildOutput: (id: string, cb: (line: string) => void) =>
    listen(`build-output-${id}`, (e) => cb(e.payload as string)),
  onBuildLayerUpdate: (id: string, cb: (layer: BuildLayer) => void) =>
    listen(`build-layer-${id}`, (e) => cb(e.payload as BuildLayer)),
  onDownloadProgress: (cb: (data: { percent: number; downloaded: number; total: number }) => void) =>
    listen('download-progress', (e) => cb(e.payload as any)),
  onComposeOutput: (project: string, cb: (line: string) => void) =>
    listen(`compose-output-${project}`, (e) => cb(e.payload as string)),
};
```

---

## 📱 Phase 5: Frontend Pages

### 5.1 First-Run Setup Wizard (`src/components/wizard/`)

**Trigger:** On app launch, check `wizardStore.completed`. If false, show wizard full-screen before main UI.

**Step 1 — Choose your runtime:**
```
┌─────────────────────────────────────────────┐
│  Welcome to Dockman                          │
│  Let's set up your container runtime.       │
│                                              │
│  ○  Docker only                              │
│     Use existing Docker installation         │
│                                              │
│  ○  Podman only                              │
│     Rootless, daemonless containers          │
│                                              │
│  ○  Both (recommended)                       │
│     Use either runtime, switch per-container │
│                                              │
│                            [Continue →]      │
└─────────────────────────────────────────────┘
```

**Step 2 — Binary detection:**
For each selected runtime, show detection result:
```
┌─────────────────────────────────────────────┐
│  Docker                                      │
│  ✓ Found at /usr/local/bin/docker  v26.1.4  │
│     [Use this]  [Choose different path]      │
│                                              │
│  Podman                                      │
│  ✗ Not found                                │
│     [Download v5.2.2]  [Browse for binary]  │
│     Install to: [~/.local/bin]  [Browse]    │
│     [✓] Add to PATH automatically            │
│                                              │
│  [← Back]                      [Continue →] │
└─────────────────────────────────────────────┘
```

**Step 3 — Preferences:**
```
┌─────────────────────────────────────────────┐
│  Almost done                                 │
│                                              │
│  [✓] Start Dockman on system login           │
│  [✓] Auto-fallback to other runtime on       │
│      architecture errors (M1/Apple Silicon)  │
│  Refresh interval: [5] seconds               │
│                                              │
│  [← Back]              [Launch Dockman →]   │
└─────────────────────────────────────────────┘
```

After wizard completes: set `wizardStore.completed = true`, navigate to Dashboard.

---

### 5.2 Layout Shell (`src/App.tsx`)

```
┌──────────────────────────────────────────────────────────┐
│ TOPBAR: [Dockman]  [Docker ●] [Podman ●]  [⟳]  [🔍]    │
├────────┬─────────────────────────────────────────────────┤
│SIDEBAR │  PAGE CONTENT                                   │
│        │                                                 │
│ Home   │                                                 │
│ ─────  │                                                 │
│ Cont.  │                                                 │
│ Compose│                                                 │
│ Images │                                                 │
│ Builds │                                                 │
│ Volumes│                                                 │
│ ─────  │                                                 │
│ Bins   │                                                 │
│ ⚙ Set  │                                                 │
├────────┴─────────────────────────────────────────────────┤
│ STATUSBAR: Docker v26.1.4 ●  |  12 running  |  5s ago   │
└──────────────────────────────────────────────────────────┘
```

**TopBar runtime indicators:**
- Show only the runtimes configured in `mode`
- Each pill: `[Docker ●]` — color dot = green (running) / red (stopped) / grey (not found)
- Click pill → start/stop daemon toggle
- If mode is "both", show both pills

**Sidebar:**
- Show container running count badge on Containers link
- Show compose project count badge on Compose link
- Show active/running build count badge on Builds link (animating dot when a build is running)

---

### 5.3 Dashboard Page

**Layout:**
- Top row: Runtime status cards (one per configured runtime)
  - Runtime name + version
  - Daemon status with start/stop button
  - Quick stats: N containers, N images, N volumes
- Middle: Running containers quick-view (mini cards, max 6, "View all" link)
- Bottom: Compose projects quick-view (running stacks)
- If no runtime configured: large CTA → Setup Wizard

**Runtime card example:**
```
┌──────────────────────────┐
│ 🐳 Docker  v26.1.4       │
│ ● Running    [Stop]       │
│                           │
│ 12 containers             │
│ 34 images                 │
│  8 volumes                │
│                           │
│ compose: ✓ available      │
└──────────────────────────┘
```

---

### 5.4 Containers Page

**Features:**
- Tab bar: `All` | `Running` | `Stopped` | `Paused`
- Runtime filter (if mode = "both"): `All Runtimes` | `Docker` | `Podman`
- Search by name or image
- Group by compose project (collapsible group headers)
- Show all containers from both runtimes in one unified list when "both" is active

**Container row:**
```
● nginx          nginx:latest    0.0.0.0:80→80   [D]  ⏸ ⏹ 🗑 > 
```
- Colored dot: state indicator
- `[D]` = Docker badge, `[P]` = Podman badge
- Action icons: pause, stop, open terminal (▶), remove

**ContainerDetail slide-over (right panel, 480px wide):**

Tabs inside:
1. **Overview** — name, image, ID, created, status, restart policy
2. **Ports** — table of all port mappings with "Open in browser" button for http ports
3. **Env Vars** — searchable list of KEY=VALUE (values masked by default, click to reveal)
4. **Logs** — xterm.js log viewer, auto-scroll, search, timestamps toggle, download button
5. **Terminal** — xterm.js exec shell into running container
6. **Inspect** — raw JSON with syntax highlighting and copy button

**"Open in browser" logic:** For any port mapping where containerPort is 80/443/3000/4200/8080/etc, show a small "↗" button that calls `open_url("http://localhost:{hostPort}")`.

---

### 5.5 Compose Page

**Features:**
- List all discovered compose projects grouped by runtime
- Each project card shows:
  - Project name + compose file path
  - Services list with individual state dots
  - Overall status badge: Running / Partial / Stopped
  - Actions: `Up` | `Down` | `Restart` | `Logs` | `Open File`

**Compose project card:**
```
┌──────────────────────────────────────────────┐
│ my-webapp                  [D] ● Running      │
│ ~/projects/my-app/docker-compose.yml          │
│                                               │
│ ● web       nginx:latest      :80→80          │
│ ● api       node:20           :3000→3000      │
│ ● db        postgres:16       (internal)      │
│                                               │
│ [Up ↑]  [Down ↓]  [↺ Restart]  [Logs]  [✎]  │
└──────────────────────────────────────────────┘
```

When `Up` / `Down` is clicked — show a terminal-style streaming output panel at the bottom of the page using xterm.js.

---

### 5.6 Images Page

**Features:**
- List with: Name:Tag, Size (human-readable), Created, Runtime badge
- Search/filter by name
- Actions per row: Pull latest, Remove, Inspect, Build container from this image
- Top actions: `[Pull Image]` `[Build from Dockerfile]`

**Pull Image modal:**
- Input: image name (e.g. `nginx:latest`, `ghcr.io/org/app:v2`)
- Runtime selector (if mode = "both")
- Live streaming pull progress in xterm-style output box

**Registry Login modal:**
- Server URL (default: docker.io)
- Username + Password fields
- Runtime selector

> **Note:** "Build from Dockerfile" is now a full page — see section 5.7 Builds. Remove the old BuildImageModal from Images — trigger build via the `[New Build]` button on the Builds page instead. Images page keeps a shortcut `[+ Build]` button that navigates to Builds → NewBuildModal.

---

### 5.7 Builds Page

This is a dedicated page for all image builds. Inspired by OrbStack's Builds section.

**Two-panel layout:**

```
┌─────────────────────────────────────────────────────────────────────┐
│  Builds                                          [+ New Build]       │
├──────────────────────────────┬──────────────────────────────────────┤
│  LEFT: build history list    │  RIGHT: selected build detail        │
│                              │                                      │
│  ● pier/api-gw:0.14.2        │  pier/api-gw:0.14.2                 │
│    2h ago · 12s · 92% cache  │  ─────────────────────────────────  │
│    142 MB         SUCCESS    │  Duration   Layers  Cache   Size     │
│                              │  12s        12      92%     142 MB   │
│  ● pier/worker:0.14.2        │                                      │
│    2h ago · 18s · 88% cache  │  Layer Waterfall                     │
│    138 MB         SUCCESS    │  01 ████████████████████  CACHED     │
│                              │  02 ████████████████████  CACHED     │
│  ● pier/api-gw:0.14.1        │  03 ██████████           CACHED     │
│    1d ago · 64s · 41% cache  │  04 ████████             CACHED     │
│    142 MB         SUCCESS    │  05 ██████               CACHED     │
│                              │  06 ████                 CACHED     │
│  ● pier/api-gw:0.14.0        │  07 █████                CACHED     │
│    4d ago · 32s · 75% cache  │  ...                                 │
│    –                 FAILED  │                                      │
│    "npm ci failed"           │  [Logs] [Dockerfile] [Cache]        │
│                              │                                      │
│  [Clear History]             │                                      │
└──────────────────────────────┴──────────────────────────────────────┘
```

**Left panel — Build history list:**
- Each row: status dot (green=success, red=failed, yellow=running with spinner), tag, time ago, duration, cache%, size, status badge
- Running builds show a pulsing animation and live-updating duration timer
- Failed builds show the first line of error message in muted text below
- Click any row → loads detail in right panel
- Search/filter by tag name
- Runtime filter if mode = "both"

**Right panel — Build detail (3 tabs):**

**Tab 1: Overview**
- Stats row: Duration / Layers / Cache hit % / Final size
- Layer Waterfall:
  - Horizontal bar chart — one row per layer, numbered 01–N
  - Bar width is proportional to layer duration relative to the slowest layer
  - Green bar = freshly built, muted/grey bar = CACHED
  - Each row: layer number | bar | duration label | CACHED badge or nothing
  - Hover on bar → tooltip with full instruction text (e.g. "RUN npm ci --omit=dev")
- Build options used: platform, use_cache, push_on_success — shown as small badges

**Tab 2: Logs**
- Full `docker build --progress=plain` output in xterm.js terminal
- For completed builds: load from stored log (save raw output to `~/.config/dockman/build-logs/{id}.log`)
- For running builds: stream live via `build-output-{id}` events
- Download log button (save to file)
- Cancel button (only for running builds)

**Tab 3: Dockerfile**
- Syntax-highlighted viewer of the dockerfile used for this build
- Read from `build.dockerfile` path via `read_dockerfile` command
- "Open in editor" button → shell open the file
- If file no longer exists at path: show warning + last-known content if cached (cache first 50 lines in BuildRecord)

**Tab 4: Cache** (matches OrbStack's Cache panel)
- Total cache size: `{runtime} system df` → parse build cache row
- "across N cached layers" subtitle
- Base image breakdown: group cached layers by their FROM image
  - e.g. "node:20 — 5 layers", "distroless — 3 layers"
  - Shown as cards with image icon + name + layer count

**New Build Modal (`NewBuildModal.tsx`):**
```
┌──────────────────────────────────────────────┐
│  New Build                                    │
│                                               │
│  Dockerfile: [/path/to/Dockerfile]  [Browse] │
│  Context:    [/path/to/context]     [Browse] │
│  Tag:        [myapp:latest]                  │
│                                               │
│  Build Args: [KEY] [=] [value]  [+ Add]      │
│                                               │
│  Platform:   [Current (arm64) ▼]             │
│              options: current | linux/amd64  │
│                       linux/arm64 | both     │
│                                              │
│  [✓] Use cache from previous build           │
│  [ ] Push to registry on success             │
│  [✓] Multi-platform (linux/arm64,linux/amd64)│
│                       ↑ grayed if no buildx  │
│  Runtime: [Docker ▼]  (if mode = "both")    │
│                                               │
│              [Cancel]     [Start Build →]    │
└──────────────────────────────────────────────┘
```

After clicking "Start Build":
- Modal closes
- Navigate to Builds page
- New build entry appears at top with running state
- Right panel auto-selects the new build and shows live logs

---

### 5.8 Volumes Page

**Features:**
- List: Name, Driver, Size (if available), Mountpoint, Runtime badge
- Actions: Inspect (JSON modal), Remove (with confirm)
- Top action: `[Create Volume]` (name input), `[Prune Unused]`

---

### 5.8 Binary Manager Page

**Full page — accessible from sidebar even after setup.**

```
┌──────────────────────────────────────────────────────┐
│  Binary Manager                                       │
│                                                       │
│  DOCKER                        PODMAN                 │
│  ┌──────────────────────┐  ┌──────────────────────┐  │
│  │ ✓ Found              │  │ ✗ Not Found          │  │
│  │ /usr/bin/docker      │  │                      │  │
│  │ v26.1.4              │  │ Select version:      │  │
│  │                      │  │ [v5.2.2 (latest) ▼]  │  │
│  │ [Change Path]        │  │                      │  │
│  │ [Verify]             │  │ Install to:          │  │
│  └──────────────────────┘  │ [~/.local/bin] [📁]  │  │
│                             │                      │  │
│                             │ [✓] Add to PATH      │  │
│                             │                      │  │
│                             │ [Download Podman]    │  │
│                             └──────────────────────┘  │
│                                                       │
│  Download progress:                                   │
│  ████████████████████░░  92%  podman-5.2.2-aarch64   │
│  Downloaded: 48.2 MB / 52.1 MB                        │
│                                                       │
│  [✓] Done! Binary verified at ~/.local/bin/podman    │
│  PATH updated in ~/.zshrc                             │
└──────────────────────────────────────────────────────┘
```

State machine: `idle → downloading → extracting → verifying → patching_path → done | error`

---

### 5.9 Settings Page

**Sections:**

**Runtime:**
- Runtime mode selector: `Docker only` / `Podman only` / `Both`
- Per-runtime: custom binary path (file picker) + Verify button
- Start on login toggle (uses `tauri-plugin-autostart`)

**Behavior:**
- Refresh interval: slider 2s–60s
- Auto-fallback on arch error: toggle + explanation ("On M1, if Podman fails with exec format error, retry with Docker")
- Show system/infrastructure containers: toggle
- Default exec shell: `/bin/bash` / `/bin/sh` / `sh`

**Compose:**
- Auto-discover compose projects: toggle
- Watch directories for compose files: add/remove paths

**About:**
- Dockman version
- Links: GitHub, Report Issue, License

---

## 🔁 Phase 6: Cross-Cutting Concerns

### 6.1 "Both Runtimes" Mode

When mode is "both":
- `useContainers` hook calls `list_containers` for Docker AND Podman in parallel via `Promise.all`
- Results are merged and sorted by created date
- Each container has `runtime` field → drives the badge display
- Runtime filter tab lets user see only Docker, only Podman, or all

```typescript
// src/hooks/useContainers.ts
export function useContainers(showAll = false) {
  const { mode } = useRuntimeStore();
  const runtimes = mode === 'both' ? ['docker', 'podman'] : [mode];
  const { refreshInterval } = useSettingsStore();

  return useQuery({
    queryKey: ['containers', mode, showAll],
    queryFn: async () => {
      const results = await Promise.allSettled(
        runtimes.map(r => ContainerCommands.list(r, showAll))
      );
      return results
        .filter(r => r.status === 'fulfilled')
        .flatMap(r => (r as PromiseFulfilledResult<Container[]>).value)
        .sort((a, b) => b.created - a.created);
    },
    refetchInterval: refreshInterval * 1000,
  });
}
```

### 6.2 M1 Auto-Fallback

```typescript
// src/lib/fallback.ts
export async function runWithFallback(
  primaryRuntime: RuntimeName,
  action: (runtime: RuntimeName) => Promise<void>,
) {
  const { autoFallback, mode } = /* stores */;

  try {
    await action(primaryRuntime);
  } catch (err) {
    const msg = String(err);
    const isArchError =
      msg.includes('exec format error') ||
      msg.includes('no matching manifest for linux/arm64') ||
      msg.includes('image operating system') ||
      msg.includes('cannot be used on this platform');

    if (isArchError && autoFallback && mode === 'both') {
      const fallback: RuntimeName = primaryRuntime === 'podman' ? 'docker' : 'podman';
      toast.info(`Retrying with ${fallback} (architecture mismatch)`);
      await action(fallback);
    } else {
      throw err;
    }
  }
}
```

### 6.3 First-Run Check in App.tsx

```typescript
function App() {
  const { completed } = useWizardStore();

  if (!completed) {
    return <SetupWizard />;
  }

  return <MainLayout />;
}
```

### 6.4 Tauri Capabilities

`src-tauri/capabilities/main.json`:
```json
{
  "identifier": "main-capability",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "shell:allow-execute",
    "shell:allow-spawn",
    "fs:allow-read-all",
    "fs:allow-write-all",
    "fs:allow-create",
    "http:allow-fetch",
    "dialog:allow-open",
    "notification:default",
    "autostart:allow-enable",
    "autostart:allow-disable",
    "autostart:allow-is-enabled"
  ]
}
```

---

## 📋 Phase 7: Implementation Order for Claude Code

Execute strictly in this sequence:

```
Step 1 — npm create tauri-app@latest → fill in project details → npm install deps

Step 2 — Rust: types + config model
  - src-tauri/src/commands/mod.rs
  - all structs/types in runtime.rs top section
  - config file read/write helpers (~/.config/dockman/config.json)
  - macOS PATH fix helper function

Step 3 — Rust: runtime commands
  - detect_runtime, detect_all_runtimes
  - get/set_runtime_mode, get/set_runtime_path
  - start/stop_runtime_daemon
  - set/get_start_on_login (autostart plugin)
  - Wire into lib.rs

Step 4 — Rust: container + exec commands
  - All container CRUD
  - Streaming logs + stats with app.emit()
  - Exec session management (HashMap<String, Child>)
  - Wire into lib.rs

Step 5 — Rust: images + volumes + compose + builds + downloader
  - All image commands (pull with streaming, remove, search, registry login)
  - Volume commands
  - Compose ls/up/down/restart/logs
  - Builds: start_build (parse --progress=plain output), cancel_build, list/get/delete
  - Build log persistence to ~/.config/dockman/build-logs/{id}.log
  - Downloader with progress events
  - Wire all into lib.rs

Step 6 — Frontend: foundation
  - Tailwind setup + CSS variables (IBM Plex fonts)
  - All TypeScript types
  - All Zustand stores
  - commands.ts with all invoke() wrappers
  - router.tsx with all routes

Step 7 — Frontend: wizard
  - SetupWizard + 3 steps
  - WizardStore integration
  - First-run check in App.tsx

Step 8 — Frontend: layout shell
  - Sidebar, TopBar (runtime pills), StatusBar
  - Main layout with router outlet

Step 9 — Frontend: pages (in this order)
  1. Dashboard
  2. Containers + ContainerDetail (all tabs)
  3. Compose
  4. Images + Pull modal + Registry Login modal
  5. Builds + BuildDetail (all tabs) + NewBuildModal
  6. Volumes
  7. BinaryManager
  8. Settings

Step 10 — Polish
  - Loading skeletons for all lists
  - Toast notifications (success/error/info)
  - Keyboard shortcuts: R = refresh, Ctrl+K = search
  - Empty states with helpful CTAs
  - Error boundary components
```

---

## 🧪 Phase 8: Test Scenarios

Verify each manually:

**Setup:**
- [ ] Fresh install: wizard appears on first launch
- [ ] Wizard: select "Docker only" → skips Podman detection
- [ ] Wizard: select "Both" → detects/downloads both
- [ ] "Start on login" toggle works

**Runtime detection:**
- [ ] Docker found automatically via PATH
- [ ] Podman found via Homebrew path on macOS
- [ ] Custom path override works and persists
- [ ] Daemon start/stop from TopBar pill

**Containers:**
- [ ] List loads from Docker
- [ ] List loads from Podman
- [ ] Both runtimes merged in "Both" mode
- [ ] Start / Stop / Restart works
- [ ] Remove with confirm modal
- [ ] Live logs stream in xterm
- [ ] Terminal exec opens shell
- [ ] Env vars shown (masked)
- [ ] Port "Open in browser" works
- [ ] Compose-grouped containers visible

**Compose:**
- [ ] Projects detected from `docker compose ls`
- [ ] Up / Down work with streaming output
- [ ] Logs per project stream correctly
- [ ] "Open File" opens in system editor

**Builds:**
- [ ] New build modal opens, Dockerfile picker works
- [ ] Build starts, appears in history list with running state
- [ ] Live logs stream in Logs tab during build
- [ ] Layer waterfall populates as layers complete
- [ ] CACHED layers shown in grey, fresh layers in green
- [ ] Cache hit % calculated correctly
- [ ] Build success → status badge turns green, size shown
- [ ] Build failure → status red, error message shown in list
- [ ] Cancel running build stops the process
- [ ] Dockerfile tab shows syntax-highlighted source
- [ ] Cache tab shows total cache size and base image breakdown
- [ ] Multi-platform build option grayed out when buildx unavailable
- [ ] "Push on success" triggers push after build completes
- [ ] Old build logs loadable after app restart
- [ ] Clear history removes all records

**Images:**
- [ ] Pull with streaming progress
- [ ] Search returns results
- [ ] Build from Dockerfile with streaming
- [ ] Registry login succeeds

**Binary Manager:**
- [ ] Download progress bar updates
- [ ] Binary verified after download
- [ ] PATH patched in shell profile
- [ ] Verify button on already-installed binary

**Settings:**
- [ ] Mode switch (docker/podman/both) takes effect immediately
- [ ] Refresh interval change applies
- [ ] Auto-fallback fires on arch error (test with an x86-only image on M1)

---

## 🚀 Phase 9: Build & Ship

```bash
# Dev
npm run tauri dev

# Production build
npm run tauri build
# Output: src-tauri/target/release/bundle/
#   macOS:   .dmg + .app
#   Linux:   .AppImage + .deb
#   Windows: .msi + setup.exe
```

For GitHub Releases, use `tauri-action`:
```yaml
# .github/workflows/release.yml
uses: tauri-apps/tauri-action@v0
with:
  tagName: v__VERSION__
  releaseName: Dockman v__VERSION__
```

---

## ⚡ Implementation Notes

1. **Streaming processes** — For logs/pull/build/compose, store the `Child` handle in a `Mutex<HashMap<String, Child>>` in Tauri state. The stop commands look up by ID and kill the child process.

2. **Exec terminal** — xterm.js on the frontend connects to the Rust exec session via Tauri events. Input flows: `xterm keypress → invoke exec_input → stdin write`. Output flows: `stdout read → app.emit → xterm.write`.

3. **JSON parsing differences** — Docker and Podman's `--format json` output is slightly different between versions. Always wrap parsers in error handling; fall back to parsing `--format "{{json .}}"` per-line if the array format fails.

4. **Podman rootless on Linux** — Must set `XDG_RUNTIME_DIR=/run/user/$(id -u)` as an env var on every Podman command spawn on Linux.

5. **Compose file discovery** — `docker compose ls` only shows projects Docker knows about. Optionally, also scan user-configured watch directories for `docker-compose.yml` / `compose.yml` files and surface them.

6. **Windows named pipes** — Shell out to CLI only; do not use the Docker named pipe socket directly. This keeps the code path identical across platforms.

7. **Binary download checksums** — After downloading, verify the SHA256 checksum against the `.sha256` file from the same source. Reject the binary if checksum fails.

---

*End of plan. This is the complete Claude Code implementation brief for Dockman v1.*