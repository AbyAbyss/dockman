# Dockman engine plan — Docker and Podman side by side

Status: draft · 2026-10-15

## Goal

Dockman is a free replacement for Docker Desktop / OrbStack. The user picks
**Podman**, **Docker**, or **Both**, and Dockman installs and runs each one as
its own engine, using only free, open-source parts. There's no Docker Desktop,
OrbStack, Colima or Lima, and no licence limits.

Rules every phase must follow:

1. **Each engine is separate.** Each has its own VM, socket, containers,
   images and volumes. A container started on podman lives only in podman.
2. **No shared global socket.** Dockman never relies on `/var/run/docker.sock`
   (today that points to podman through `podman-mac-helper`, which is why
   both CLIs see the same containers). Dockman tells every CLI call exactly
   which engine to use.
3. **The UI never misrepresents things.** Every container, image and volume
   is labelled with the engine that holds it. Every engine shows who manages
   it (Dockman or something external) and its real state.

## Requirement: start from nothing, never leave the app

A new user on a clean Mac (no Homebrew, no Docker, no Podman, no Xcode tools,
no admin password needed) downloads Dockman, picks **Podman**, **Docker** or
**Both**, and ends up with working engines. Every feature works (run, logs,
shell, build, compose, pull/push, ports, volumes, Intel images), and they never
have to open a terminal, a browser or System Settings.

### Gaps today (verified in code, 2026-10-15)

| Gap | Effect on a fresh Mac | Fix |
|---|---|---|
| Docker static `.tgz` contains only the `docker` CLI | `docker compose` and `docker buildx` fail, so Compose and Builds are broken | Also download the **compose** and **buildx** plugins (Apache-2.0, GitHub releases) into Dockman's own CLI plugin dir |
| `podman compose` needs an external provider (docker-compose or podman-compose) | Compose is broken for Podman-only users | Point podman's `compose_providers` at the downloaded `docker-compose` binary |
| No Docker engine at all; "Start docker" needs OrbStack / Docker Desktop / Colima | Docker-only users have nothing | The Dockman-managed Docker VM (this plan) |
| vfkit / gvproxy live in `~/.local/libexec/podman`, and *Remove podman* deletes them | Removing Podman would break the Docker engine | Move the shared helpers to `~/.dockman/bin`, owned by Dockman, and remove them only when no engine needs them |
| `podman machine init` downloads a large image with no progress (it's a blocking `run()`) | Setup looks frozen for minutes | Stream its output and show a phase and percentage |
| Release lists come from the GitHub API (60 requests/hour without a token) | Install can fail with a rate-limit error | Cache the list, fall back to a pinned known-good version |
| The app is **unsigned** (`release.yml`: "These builds are unsigned") | macOS blocks the first launch; the user has to find a workaround in System Settings or Terminal | Sign with a Developer ID and notarize in CI (**decision**: needs an Apple Developer account) |
| Rosetta isn't installed on a fresh Apple Silicon Mac | Intel images run on slow QEMU emulation | Offer a one-click install from the app (`softwareupdate --install-rosetta --agree-to-license`); fall back to QEMU, which works without it |
| The app relies on `PATH` edits for some lookups | Fragile for new users | The app always uses absolute paths under `~/.dockman`. Adding to `PATH` is only an option, for the user's own terminal |

### Install flow (inside the app)

Each step is a visible row with a live state:
`waiting → downloading n% → verifying → done` or `failed (reason) [Retry]`.

```
Podman                               Docker
1. podman CLI                        1. docker CLI + compose + buildx plugins
2. vfkit + gvproxy (shared)          2. vfkit + gvproxy (shared, skipped if present)
3. compose provider                  3. Linux VM image
4. machine image (podman machine init)  4. first boot + dockerd install (cloud-init)
5. start machine                     5. socket ready → `docker info` OK
6. hello-world check                 6. hello-world check
```

- Choosing **Both** runs the shared steps once, then both columns in parallel.
- **Nothing needs sudo or an admin password.** Everything goes under
  `~/.dockman` (plus the standard `~/.config/containers` for podman).
- Every download is resumable and checksum-verified, and the install can
  be retried from the step that failed.
- Engine states are always read from the real system, never assumed:
  `not installed · installing (step k/6) · stopped · starting · running · error`.
- Dockman's own install never changes another engine the user manages
  themselves (Docker Desktop, OrbStack, Colima). Those are detected and shown
  as **external**.

### Acceptance test (needed before calling it done)

On a clean macOS user account (new local user, nothing installed):
1. Download the DMG and open it. It launches with no Gatekeeper workaround
   (requires signing).
2. Wizard → **Both** → both engines reach `running` with no terminal use.
3. Run `nginx -p 8080:80` on each engine, then open it in the browser from
   the app. Each container shows only under its own engine.
4. Compose up a two-service file on each engine. Build a Dockerfile on each.
5. Run an amd64-only image on each engine: it's labelled *emulated* and runs.
6. Quit and relaunch the app: states are correct, and containers are still
   running.
7. Remove Docker from the app: Podman keeps working, and vice versa.

## Why a VM is unavoidable

`dockerd` and podman both depend on Linux kernel features (namespaces,
cgroups, overlayfs), and macOS has none of them. Every Mac container tool runs
a small Linux VM. Dockman will own that VM itself, using the two helpers it
already ships for podman:

- **vfkit** (Apache-2.0) boots Linux VMs on Apple's Virtualization.framework.
  It handles EFI boot, virtio disk, virtio-fs file sharing, Rosetta and
  cloud-init. v0.6.4 is installed at `~/.local/libexec/podman/vfkit`.
- **gvproxy** (Apache-2.0) handles user-mode networking, port forwarding and
  forwarding a unix socket from guest to host over SSH.

## Architecture

```
                         Dockman (Tauri app)
                 ┌────────────────┴────────────────┐
          Podman engine                      Docker engine
       (podman machine — exists)        (Dockman-managed VM — new)
                 │                                 │
   podman CLI ──► podman machine socket   docker CLI ──► ~/.dockman/docker/docker.sock
                 │                                 │  (gvproxy socket forward)
        vfkit + gvproxy VM                 vfkit + gvproxy VM
        Fedora CoreOS + podman             Debian cloud image + dockerd
```

### Docker engine VM

| Piece | Choice |
|---|---|
| Base image | Debian 12 `genericcloud` arm64 (amd64 on Intel) **raw** image. It has cloud-init and needs no qcow2 conversion. *Verify it boots under vfkit EFI in phase 1.* Fallback: Fedora Cloud Base raw. |
| Engine | `dockerd` + containerd + runc + buildx + compose plugin from Docker's apt repo (Moby, Apache-2.0), installed by cloud-init on first boot |
| Boot | `vfkit --bootloader efi,... --device virtio-blk,path=disk.raw --cloud-init user-data,meta-data --device virtio-fs,sharedDir=/Users --device rosetta,mountTag=rosetta --device virtio-net,unixSocketPath=gvproxy.sock` |
| Network | `gvproxy -listen-vfkit unixgram://… -ssh-port <free port>` |
| Socket | `gvproxy -forward-sock ~/.dockman/docker/docker.sock -forward-dest /var/run/docker.sock -forward-user dockman -forward-identity <key>` |
| Files | `/Users` is shared at the same path, so `-v ~/project:/app` works as it does on Docker Desktop |
| Lifetime | Detached from the app, as podman machine is: containers keep running after Dockman quits |

On-disk layout:

```
~/.dockman/docker/
  disk.raw  efi-vars  cloud-init/{user-data,meta-data}
  id_ed25519{,.pub}  gvproxy.sock  docker.sock  vm.json (cpus, memGb, diskGb, ports)
  vfkit.pid  gvproxy.pid  logs/
```

### Pointing each CLI at its own engine

- **docker:** every backend call runs with `DOCKER_HOST=unix://~/.dockman/docker/docker.sock`,
  set centrally in `commands::run` / `spawn_streaming` for the docker runtime.
  About 40 `resolve()` call sites go through these two functions. Dockman
  also creates a `dockman` docker context so the user's terminal can target it
  (`docker context use dockman`), and offers to make it the default.
- **podman:** calls use `--connection <machine>` explicitly, so a stray
  `CONTAINER_HOST` or default connection can't redirect them.
- **External engines** (Docker Desktop, OrbStack or Colima already installed)
  are still supported as "external". Dockman shows them and can use them, but
  doesn't manage them.
- **Shared-socket detection:** keep `docker_served_by_podman()`. When
  `/var/run/docker.sock` points to podman, the UI says so and offers to
  remove the link (`podman-mac-helper uninstall`, which needs sudo).

### Port forwarding (main new component)

Podman tells gvproxy about published ports itself. `dockerd` doesn't, so we
need a small **port-forward agent**:

- Run `docker events --filter type=container` against the engine socket on
  the host side.
- On start/stop, read the container's published ports and call gvproxy's HTTP
  API (`/services/forwarder/expose` and `/unexpose`) to map
  `127.0.0.1:<host>` → `<guest ip>:<host>`.
- Re-sync the full list at engine start, and after the Mac wakes from sleep.

Lima's guest agent does the same thing. Ours runs inside the Tauri backend
as a thread per running engine.

### Arch / emulation (the original pain point)

- Turn on **Rosetta** in both VMs: the Docker VM through vfkit's `--device
  rosetta`, and podman through `rosetta = true` in containers.conf
  `[machine]`, which is currently off on this Mac. Register binfmt in the
  guest. QEMU `binfmt` is the fallback; it already works: `podman run
  --platform linux/amd64 alpine uname -m` → `x86_64`.
- **Run flow:** if the image has no variant for the host arch, pass
  `--platform` for the arch it does have, and mark the container
  **emulated**. Never fail silently and never quietly switch engines.

## Engine model (shared by both engines)

Both engines are described by the same structure, so the backend reports them
the same way and the UI renders them the same way.

```ts
type EngineName = 'docker' | 'podman';

type EngineState =
  | 'not_installed'   // no CLI, or no VM/machine for this engine
  | 'installing'      // install flow running (see `install`)
  | 'stopped'         // installed, VM not running
  | 'starting'        // VM booting / engine not answering yet
  | 'running'         // engine API answers (`docker info` / `podman info`)
  | 'stopping'
  | 'error';          // last operation failed; `error` says why

interface Engine {
  name: EngineName;
  state: EngineState;
  managedBy: 'dockman' | 'external';
  externalKind?: 'docker-desktop' | 'orbstack' | 'colima' | 'rancher' | 'other';
  sharedWith?: EngineName;        // e.g. docker's socket is really podman's
  cli: { installed: boolean; version: string; path: string };
  plugins: { compose: boolean; buildx: boolean };   // docker; podman: compose provider
  vm: { exists: boolean; cpus: number; memGb: number; diskGb: number; rosetta: boolean } | null;
  endpoint: string;               // socket the app talks to
  engineVersion: string;          // server version, '' unless running
  install?: { step: number; total: number; label: string; percent: number };
  op?: 'start' | 'stop' | 'reset' | 'remove' | 'resize';  // operation in progress
  error?: { message: string; logTail: string; at: string };
  checkedAt: string;              // time of last real probe
}
```

- **One backend command, `engine_status(name)`, builds this from real probes
  every time**: binary on disk, `--version`, VM/machine inspect, socket
  reachable, `info`. Nothing is cached as truth.
- **Push, not poll.** The backend sends an `engine-changed` event whenever an
  operation moves an engine to a new state, or a background probe sees a
  change. The probe runs every 5 s while a transition is in progress, every
  30 s otherwise, and right away when the window gets focus or the Mac wakes.
- **One frontend store**, `engines: Record<EngineName, Engine>`. It replaces
  the separate `useRuntimes()` and `get_setup_status` views. Every screen
  reads from it, so all screens always agree.

### State transitions

```
not_installed ──install──▶ installing ──ok──▶ stopped ──start──▶ starting ──API up──▶ running
      ▲                        │fail                ▲                │timeout/fail      │stop
      │                        ▼                    │                ▼                  ▼
      └──────remove──────── error ◀───────────── (any op fails) ──── error         stopping ──▶ stopped
                               │retry → repeats the failed op from the failed step
running ──VM dies / Mac sleep breaks socket──▶ probe sees it ──▶ stopped (or error with reason)
```

- **Only one operation per engine at a time.** A per-engine lock stops a
  double Start, or a Stop during an install. The engines don't block each
  other.
- **Every operation has a timeout**: start 180 s (first Docker boot 600 s,
  because cloud-init installs dockerd), stop 60 s, then a forced stop.
- **Errors keep the last 50 log lines** (vfkit/gvproxy/machine logs) for the
  UI's "Details".

## Podman engine — core logic

| Operation | What the backend does |
|---|---|
| **install** | 1. Download the podman CLI → `~/.dockman/bin/podman`. 2. Shared helpers vfkit + gvproxy → `~/.dockman/bin` (skipped if present), registered via `helper_binaries_dir` in `~/.config/containers/containers.conf`. 3. Compose provider: `docker-compose` binary → `~/.dockman/bin`, set as `compose_providers`. 4. `podman machine init dockman-podman --cpus --memory --disk-size --rosetta` (named machine, so the user's own `podman-machine-default` is never touched), with output streamed for progress. 5. Start. 6. `podman run --rm hello-world` check. |
| **start** | `podman machine start dockman-podman`. Wait until `podman --connection dockman-podman info` succeeds. |
| **stop** | `podman machine stop dockman-podman`. |
| **status** | `podman machine inspect dockman-podman` (`State`: running / stopped / starting), then `info` over the connection. |
| **resize** | Engine must be stopped: `podman machine set --cpus --memory --disk-size` (disk can only grow). The UI asks before stopping a running engine. |
| **reset** | `podman machine rm -f` + init again (all podman containers, images and volumes deleted, with an explicit confirmation). |
| **remove** | Reset, then delete the podman CLI and compose provider. Helpers stay if Docker still needs them. |
| **targeting** | Every call passes `--connection dockman-podman`. Ports: podman programs gvproxy itself, so nothing more is needed. |
| **external / existing** | If the user already has their own podman machine, the wizard offers **use existing** (`managedBy: external`, shown but never reset or removed) or **create Dockman's own**. |

## Docker engine — core logic

| Operation | What the backend does |
|---|---|
| **install** | 1. Download the docker CLI → `~/.dockman/bin/docker`, plus the compose + buildx plugins → `~/.dockman/docker-cli-plugins`, plus the credential helper. 2. Shared helpers (as above). 3. Download the Linux VM image → `~/.dockman/docker/disk.raw` (resumable, checksum-verified), resized to the chosen disk size. 4. Generate an SSH key, write cloud-init (user, key, Docker apt repo, `dockerd` config, Rosetta binfmt). 5. First boot (see **start**); cloud-init installs dockerd, and progress is read from the serial log. 6. `docker run --rm hello-world` check. |
| **start** | Clean up stale pid/sock files. Spawn gvproxy (network + docker.sock forward), then vfkit (detached, pids recorded). Wait for SSH, then `docker info` on `~/.dockman/docker/docker.sock`. Start the port-forward agent. |
| **stop** | Stop the port-forward agent. Clean shutdown over SSH (`poweroff`), or vfkit's REST `Stop`. Wait for the vfkit pid to exit, then stop gvproxy. Force-kill after the timeout. |
| **status** | vfkit pid alive? gvproxy alive? socket answers `docker info`? If the pids are alive but the socket doesn't answer: `starting` (inside the timeout) or `error`. |
| **resize** | Engine must be stopped: write `vm.json` (cpus, memory); grow the disk image, then `resize2fs` on the next boot. |
| **reset** | Stop, delete `disk.raw` + `efi-vars`, then install from step 3 (all docker containers, images and volumes deleted, with confirmation). |
| **remove** | Reset files deleted entirely, plus the CLI, plugins and `dockman` context. Helpers stay if Podman still needs them. |
| **targeting** | Every call sets `DOCKER_HOST=unix://~/.dockman/docker/docker.sock` and `DOCKER_CONFIG` so the plugins resolve. Ports: the port-forward agent (below). |
| **external / existing** | If Docker Desktop, OrbStack, Colima or Rancher is running, the wizard offers **use it** (`managedBy: external`, its own socket, no lifecycle control beyond "open the app") or **use Dockman's engine**. |

## Behaviour rules (both engines)

1. **App quit does not stop engines.** Containers keep running. On launch the
   app *reconciles*: it probes each engine and adopts running VMs from their
   pid files, showing exactly what's actually there.
2. **Engines are independent.** Starting, stopping, resetting or removing one
   never changes the other. Shared helpers are reference-counted.
3. **No hidden fallbacks.** If an action targets a stopped engine, it fails
   with "docker engine is stopped — Start" and doesn't quietly run on the
   other engine. The arch fallback is emulation on the *same* engine.
4. **Everything is attributed.** Lists come from each engine's own socket, so
   there's no cross-engine deduping. If `sharedWith` is set (external setup
   where both CLIs reach one engine), the objects are shown once, under the
   engine that owns them, with a "shared" note.
5. **Sleep/wake:** on wake, re-probe both engines, re-sync docker port
   forwards, and fix the VM clock (`hwclock`/chrony in the guest).
6. **Bulk and stack actions only touch the engine(s) the toggle selects**
   (already done in `5d1a214`).
7. **Destructive engine operations** (reset, remove, resize with a restart)
   always confirm and say exactly what will be lost.
8. **Existing installs migrate, never break.** Users from earlier versions
   have CLIs in `~/.local/bin`, helpers in `~/.local/libexec/podman` and
   `podman-machine-default`. On first launch of the new version, Dockman
   adopts them (`managedBy: external` for the existing machine), shows a
   one-time "Move to Dockman-managed engines?" card, and only creates
   `dockman-podman` / the Docker VM when the user agrees. It never deletes
   the old machine without an explicit confirmation.

## UI — every state reflected

All of these surfaces read the single `engines` store, so they can't disagree.

### State → what each surface shows

| Engine state | Engines screen card | Runtime toggle option | Status bar | Containers / Images / Volumes / Networks | Run / Pull / Build / Compose | Dashboard engine card |
|---|---|---|---|---|---|---|
| `not_installed` | "Not installed", **Install** button, size estimate | dimmed, tooltip "Not installed: Install" | `docker —` | "Docker isn't installed": **Install** | engine option disabled ("not installed") | "Not installed" + Install |
| `installing` | step list with the current step, %, and the label of the current download/boot stage | dimmed with spinner | `docker installing 3/6` | "Installing Docker… step 3 of 6" with progress | disabled ("installing") | progress bar |
| `stopped` | "Stopped", **Start**, resources, last-run time | normal, grey dot | `docker 29.9.1 · stopped` | "Docker engine is stopped": **Start docker** (per engine; both buttons in Both mode) | option shows "stopped: Start"; submitting offers to start first | grey dot, counts hidden |
| `starting` | "Starting…" with elapsed time, boot log line | normal, pulsing dot | `docker starting…` | skeleton rows + "Starting docker…" | disabled until running | pulsing dot |
| `running` | "Running", engine version, endpoint, CPU/RAM/disk, **Stop** | normal, green dot | `docker 29.9.1 · running` | live lists | enabled | green dot + live counts |
| `stopping` | "Stopping…" | pulsing dot | `docker stopping…` | rows greyed, actions disabled | disabled | pulsing dot |
| `error` | red "Error: <message>", **Retry** / **Details** (log tail) / **Reset** | red dot | `docker error` | error panel with message + Retry; lists from the other engine unaffected | disabled with reason | red dot + message |

Extra markers, shown together with the state:

- **`managedBy: external`** → "External · OrbStack" chip. Start/Stop are
  replaced with "Open OrbStack"; reset and remove are hidden.
- **`sharedWith`** → banner: "docker is using the podman engine: objects
  appear once, under podman. Set up a separate Docker engine?"
- **Emulated container** → "amd64 · emulated" chip on the row and in the
  details pane.
- **`op` in progress** → the button that started it shows a spinner, and
  the other lifecycle buttons for that engine are disabled.

### Screens

| Where | Change |
|---|---|
| **Engines** (Binaries is renamed and extended) | Two cards built from the matrix above. The CLI version picker and update badge stay, but under "CLI tools" inside each card. Install location becomes `~/.dockman` (read-only, with "Reveal in Finder"). Recent downloads become a real history of install/update events. |
| **Setup wizard** | Step 1: Podman / Docker / Both, with RAM/disk cost shown. Step 2: the live install flow (both columns at once for Both); you can't continue until every chosen engine is `running` or the user skips. Step 3: the hello-world result per engine, then open the app. |
| **Runtime toggle** | Options reflect state (dot colour, dimmed when not installed). Choosing an engine that isn't installed goes to the Engines screen. |
| **Run container modal** | Engine select showing each engine's state. Platform select: auto / amd64 / arm64, with a note when emulation is used. |
| **Settings → Resources** | Per-engine CPU / RAM / disk sliders bound to `vm` values. Apply → confirm the restart if running → `resize` op. Replaces the placeholder sliders. |
| **Status bar** | Both engines, in the format from the matrix. |
| **Toasts** | Every operation that finishes or fails sends one toast ("Docker engine started · 41 s" / "Podman start failed: <reason>" + Details). |

## Phases

Each phase ends with a check run on a real Mac.

0. **Fresh-user groundwork.** Move the shared helpers to `~/.dockman/bin`;
   download compose + buildx plugins; set podman's compose provider; stream
   `podman machine init` progress; cache the release lists. → verify: on a new
   macOS user account, a Podman-only setup gets to a working compose-up
   without a terminal.
1. **Spike: boot the VM by hand.** Script vfkit + gvproxy + Debian raw +
   cloud-init. → verify: `docker -H unix://~/.dockman/docker/docker.sock info`
   works from the Mac, and `/Users` is visible in the guest.
2. **Engine model + lifecycle in Rust, both engines.** New `commands/engine.rs`
   with `engine_status / install / start / stop / resize / reset / remove` for
   **podman** (a named `dockman-podman` machine) and **docker** (the Dockman VM),
   the per-engine lock, timeouts, the `engine-changed` event and the background
   probe. → verify: each engine's install/start/stop/restart works on its own
   (scripted), states match reality after killing a VM by hand, and containers
   survive an app restart.
3. **CLI targeting.** Set `DOCKER_HOST` per runtime in `run`/`spawn_streaming`,
   add the `dockman` context, and use an explicit podman connection.
   → verify: `nginx` started on podman shows **only** under podman, and one
   started on docker shows **only** under docker.
4. **Port-forward agent.** → verify: `docker run -p 8080:80 nginx`, then
   `curl localhost:8080` on the Mac returns the nginx page. Still works after
   a stop/start.
5. **Arch handling.** Rosetta in both VMs, `--platform` fallback, emulated
   badge. → verify: an amd64-only image runs on both engines.
6. **UI.** The single `engines` store; every cell of the state → surface
   matrix; Engines screen, wizard, toggle, banner, Run modal, resources,
   status bar, toasts. → verify: force each engine into each of the 7 states
   (uninstall, mid-install, stopped, starting, running, stopping, error by
   killing vfkit) and screenshot every surface listed in the matrix.
7. **Hardening + acceptance test.** Run the clean-account acceptance test
   above. Also: sleep/wake re-sync, disk resize, uninstall (removes the VM
   and context), Intel Mac image, logs view, error states.

## Open decisions

1. **Base image:** Debian genericcloud (proposed, small and familiar) or
   Fedora CoreOS (same as podman; would allow one shared VM later).
2. **One VM or two:** two VMs to start (simpler, fully separate). A combined
   VM running both engines is possible later to save RAM.
3. **Default resources** for the Docker VM: 2 CPU / 2 GB RAM / 60 GB sparse
   disk is proposed.
4. **Existing `/var/run/docker.sock` link:** leave it alone and use explicit
   sockets (proposed), or offer to remove it.
5. **Signing:** an Apple Developer ID ($99/yr) is needed for a DMG that
   opens without a Gatekeeper workaround. Without one, "never leave the app"
   can't cover the very first launch.
6. **Linux hosts:** no VM is needed there; use native `dockerd` / podman.
   Out of scope until macOS works.
