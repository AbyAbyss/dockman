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

## Why this app exists: what actually broke (verified 2026-10-15)

The project started because an image (Piston, `ghcr.io/engineer-man/piston`)
failed on podman and ran on Docker/OrbStack. Reproduced on this Mac, that
failure had nothing to do with architecture. There are two separate podman
failure modes behind "obscure images fail on podman, postgres/redis never do":

| # | Failure | Cause | Docker's behaviour | Fix in Dockman |
|---|---|---|---|---|
| A | `podman run amd64/alpine` → `no image found in image index for architecture "arm64"` | Podman refuses to **pull** a manifest list with no host-arch variant unless `--platform` is given. The VM can run amd64 fine: `--platform linux/amd64` prints `x86_64`, and `qemu-x86_64` is registered in the machine. | dockerd pulls the amd64 variant, prints a platform warning, runs it under emulation. | Run/Pull/Build retry with `--platform` for the arch the image has, and label the container **emulated**. Compose shows the error plus the `platform:` hint. |
| B | Piston (single-arch amd64 image) pulls with a warning, starts, then its entrypoint dies: `echo '+cpuset +cpu +io +memory +pids' > cgroup.subtree_control` → `No such file or directory` | **Rootless** podman only sees the controllers systemd delegates to the user session. VM root has `cpuset cpu io memory pids rdma misc dmem`; the user slice has `cpu io memory pids`. No `cpuset` → ENOENT → container exits before the API starts. Emulation worked: `uname -m` = `x86_64`, PID and NET namespaces OK. | dockerd runs as root in its VM, so every controller is there. OrbStack the same. | Keep podman's **rootless** default. When a container dies this way, diagnose it and offer **Run again as root in the VM** as the fix: the same machine's `-root` connection (`podman --connection <machine>-root run …`), for that one container only. Root here means root *inside the VM*, never on the Mac: no sudo, no admin password, and every other container stays rootless. **Verified 2026-10-15:** through the root connection Piston sees `cpuset`, starts, and answers on port 2000; the whole sandkit compose stack comes up the same way over a forwarded root socket; rootless containers untouched. |

Not the cause, despite earlier notes in the sandkit README: the podman VM's
data volume is mounted `rw,relatime,seclabel`, with no `nosuid`/`nodev`.

Lesson for the design: the app must **diagnose** these failures and offer the
one-line fix on the same engine. An "it failed on podman, try Docker?" prompt
would have hidden both root causes. See **Diagnosed problems** below.

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
| Rosetta isn't installed on a fresh Apple Silicon Mac (this Mac too: `arch -x86_64 /usr/bin/true` fails) | Intel images run on slow QEMU emulation. Podman bakes `Rosetta: false` into a machine created while host Rosetta is missing, and only reads it at init. | Install Rosetta **before** any machine/VM is created. Prefer vfkit's `--device rosetta,...,install`, which uses the system prompt and needs no admin password; `softwareupdate --install-rosetta --agree-to-license` only if verified to work unprivileged. Needs macOS 13+. QEMU is the fallback. |
| The app relies on `PATH` edits for some lookups | Fragile for new users | The app always uses absolute paths under `~/.dockman`. Adding to `PATH` is only an option, for the user's own terminal |
| Podman machine is **rootless** (podman's default) | Images that need full cgroup controllers (Piston) die at startup; see failure B above | Keep the default. The failure is diagnosed and the fix is **per container or per stack**: the machine's root connection for `run`, and a Dockman-forwarded root socket for compose (`podman compose` always uses the rootless socket, whatever `--connection` says). The machine-wide switch stays on the Engines card but nothing steers users to it. Nothing on the Mac runs as root in any of this. |
| Podman refuses manifest lists without a host-arch variant | Failure A above | `--platform` retry in Run / Pull / Build, emulated label |
| `podman machine init` only draws its progress bar on a TTY | Streaming a pipe gives little or nothing | Run it under a pty, or poll the image cache size |
| `~/.docker/cli-plugins` may already hold compose/buildx (it does on this Mac) | Duplicate downloads, wrong version used | Detect and skip; see **Pointing each CLI** for where plugins live |

### Install flow (inside the app)

Each step is a visible row with a live state:
`waiting → downloading n% → verifying → done` or `failed (reason) [Retry]`.

```
Shared first: vfkit + gvproxy (skipped if present) · Rosetta (offered, Apple Silicon)

Podman                                   Docker
1. podman CLI                            1. docker CLI + compose + buildx plugins
2. compose provider                      2. Linux VM image + Docker Linux static tarball
3. containers.conf (helpers, rosetta,    3. SSH key + cloud-init (user in `docker` group,
   compose provider)                        unpack dockerd, Rosetta binfmt)
4. podman machine init (rootless,        4. first boot (dockerd from the tarball, no apt)
   output on a pty for progress)
5. start machine                         5. socket ready → `docker info` OK
6. hello-world check                     6. hello-world check
```

- Choosing **Both** runs the shared steps once, then both columns in parallel.
- Rosetta comes before step 4 on purpose: podman reads `rosetta` only at
  `machine init`, and vfkit needs it on the host at boot.
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
8. Compose up `sandkit/docker/piston` on **podman**: the Piston API answers
   on port 2000 (failure B fixed by rootful), and the row shows "amd64 ·
   emulated".
9. Run `amd64/alpine` on podman with no platform set: it runs, labelled
   emulated (failure A).
10. Force each diagnosed problem below and check the app names it and offers
    the listed fix.

## Why a VM is unavoidable

`dockerd` and podman both depend on Linux kernel features (namespaces,
cgroups, overlayfs), and macOS has none of them. Every Mac container tool runs
a small Linux VM. Dockman will own that VM itself, using the two helpers it
already ships for podman:

- **vfkit** (Apache-2.0) boots Linux VMs on Apple's Virtualization.framework.
  It handles EFI boot, virtio disk, virtio-fs file sharing, Rosetta and
  cloud-init (`--cloud-init user-data,meta-data`, `--restful-uri` for Stop;
  both confirmed in the installed v0.6.4 at `~/.local/libexec/podman/vfkit`).
- **gvproxy** (Apache-2.0) handles user-mode networking, port forwarding and
  forwarding a unix socket from guest to host over SSH (`-forward-sock`,
  `-forward-dest`, `-forward-user`, `-forward-identity`, `-listen-vfkit`
  confirmed in the installed build).
- **Minimum macOS: 13** (Rosetta in VMs). virtio-fs needs 12. Intel Macs get
  no Rosetta; the Docker VM uses the amd64 image and QEMU for arm64 images.

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
| Engine | `dockerd` + containerd + runc + docker-proxy + docker-init from **Docker's Linux static tarball** (`download.docker.com/linux/static/stable/<arch>/docker-<ver>.tgz`, Apache-2.0). Downloaded on the Mac, checksum-verified, pinned to the same version as the CLI, copied into the guest over the share and unpacked by cloud-init. No apt repo, no network inside the VM on first boot. buildx and compose are **CLI plugins** and BuildKit is built into dockerd, so nothing else goes in the guest. |
| Boot | `vfkit --bootloader efi,... --device virtio-blk,path=disk.raw --cloud-init user-data,meta-data --device virtio-fs,sharedDir=/Users,mountTag=users --device rosetta,mountTag=rosetta,install --device virtio-net,unixSocketPath=gvproxy.sock --restful-uri unix://…/vfkit.sock` |
| Network | `gvproxy -listen-vfkit unixgram://… -ssh-port <free port>` |
| Socket | `gvproxy -forward-sock ~/.dockman/docker/docker.sock -forward-dest /var/run/docker.sock -forward-user dockman -forward-identity <key>`. The `dockman` guest user is in the `docker` group (cloud-init `groups: [docker]`), or the forward connects but every call is denied. |
| Files | `/Users` is shared at the same path, so `-v ~/project:/app` works as it does on Docker Desktop. **Known differences:** `/tmp`, `/Volumes`, `/private` are not shared (Docker Desktop shares them); files show the host uid, so containers running as a non-root user can hit permission errors. Both are diagnosed problems (below), not silent failures. |
| Lifetime | Detached from the app, as podman machine is: containers keep running after Dockman quits. vfkit and gvproxy are spawned in their **own session** (`setsid` / `process_group(0)`) with stdio redirected to `logs/`, or they die with the Tauri process. |
| Guest binfmt | Rosetta registered with flags `OCF` (the `F` flag is required, or containers can't find the interpreter). QEMU `binfmt-support` as fallback. |

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
- **Plugins and config:** do **not** point `DOCKER_CONFIG` at a Dockman
  directory. That would hide the user's `~/.docker/config.json` (registry
  logins break pull/push to private registries) and the `dockman` context
  has to live in `~/.docker` anyway. Keep `~/.docker` as the config dir and
  either add `~/.dockman/docker-cli-plugins` to `cliPluginsExtraDirs` in
  `config.json`, or link the plugins into `~/.docker/cli-plugins`. If
  compose/buildx are already there, use them and show their version.
- **Shared-socket detection:** keep `docker_served_by_podman()`. When
  `/var/run/docker.sock` points to podman, the UI says so (a diagnosed
  problem). Dockman itself never uses that socket, so the link is **left
  alone**; removing it (`podman-mac-helper uninstall`, needs sudo) is only
  offered as the fix text, never run by the app. This resolves open
  decision 4.

### Port forwarding (main new component)

Podman tells gvproxy about published ports itself. `dockerd` doesn't, so we
need a small **port-forward agent**:

- Run `docker events --filter type=container` against the engine socket on
  the host side.
- On start/stop, read the container's published ports and call gvproxy's HTTP
  API (`/services/forwarder/expose` and `/unexpose`) to map
  `127.0.0.1:<host>` → `<guest ip>:<host>`.
- Subscribe to events **first**, then do the full re-sync, or a container
  started in between is missed. Re-sync again after the Mac wakes from sleep.
- Honour what the user asked for: `-p 8080:80` binds `0.0.0.0` on Docker
  Desktop, so we do the same by default; `-p 127.0.0.1:8080:80` binds
  loopback only. UDP and port ranges are forwarded too.
- A host port already in use is a **diagnosed problem**: the container starts
  fine in the guest, so the agent must report the failed expose on the row,
  not swallow it.

Lima does something similar with an agent *inside* the guest watching
listening sockets. Ours watches docker events from the host side and runs
inside the Tauri backend as a thread per running engine.

### Arch / emulation

Emulation already works on podman (`podman run --platform linux/amd64 alpine
uname -m` → `x86_64`; `qemu-x86_64` is registered in the machine). What was
missing is the pull fallback (failure A) and Rosetta for speed.

- **Rosetta**: install on the host first (see gaps). Docker VM: vfkit's
  `--device rosetta,mountTag=rosetta,install`. Podman: `rosetta = true` in
  containers.conf `[machine]` **before** `machine init`; there is no
  `--rosetta` flag on `podman machine init` or `set` (podman 6.1.4), and
  podman writes `Rosetta: false` into the machine when host Rosetta is
  missing at init. Changing it later means recreating the machine. QEMU
  `binfmt` is the fallback.
- **Run / Pull / Build flow:** on `no image found in image index for
  architecture "<host>"`, read the arch the error names (or inspect the
  manifest), retry with `--platform linux/<that arch>`, and mark the
  container **emulated**. Compose can't be retried safely: show the error
  with the `platform: linux/amd64` service-key fix. Never fail silently and
  never quietly switch engines.

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
  vm: { exists: boolean; cpus: number; memGb: number; diskGb: number;
        rosetta: boolean; rootful: boolean } | null;   // docker VM is always rootful
  endpoint: string;               // socket the app talks to
  engineVersion: string;          // server version, '' unless running
  install?: { step: number; total: number; label: string; percent: number };
  op?: 'start' | 'stop' | 'reset' | 'remove' | 'resize' | 'set_rootful';  // in progress
  error?: { message: string; logTail: string; at: string };
  problems: Problem[];            // diagnosed problems, see below
  checkedAt: string;              // time of last real probe
}

interface Problem {
  code: ProblemCode;              // stable id, see the catalogue
  severity: 'info' | 'warning' | 'error';
  scope: { engine: EngineName; container?: string; image?: string };
  message: string;                // what happened, in plain words
  cause: string;                  // why, one sentence
  fix: { label: string; action?: FixAction; command?: string }[];
  // action = something the app can do with one click; command = shown for the terminal
  at: string;
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
| **install** | 1. Download the podman CLI → `~/.dockman/bin/podman`. 2. Shared helpers vfkit + gvproxy → `~/.dockman/bin` (skipped if present), registered via `helper_binaries_dir` in `~/.config/containers/containers.conf`. 3. Compose provider: `docker-compose` binary → `~/.dockman/bin` (the same file as the docker compose plugin, downloaded once), set as `compose_providers`; write `[machine] rosetta = true` if host Rosetta is installed. 4. `podman machine init dockman-podman --cpus --memory --disk-size` (rootless, podman's default; named machine, so the user's own `podman-machine-default` is never touched), run on a pty so its progress bar renders. 5. Start. 6. `podman run --rm hello-world` check. |
| **run as root in the VM** | The default fix for `engine.rootless_cgroups` / `engine.rootless_port`, and a checkbox in the Run modal. `run` goes through a `podman-root` wrapper (`podman --connection <machine>-root`), so every existing command works unchanged. Lists read both connections and tag root objects with a "root" chip, so they are never hidden. Compose: `podman compose` ignores `--connection`, so Dockman forwards the VM's root socket over the machine's own SSH key to `~/.local/libexec/dockman/podman-root.sock` and drives the compose provider with `DOCKER_HOST`. A rootless `compose up` is checked a few seconds later for a service that died, and the stack is offered again as root. |
| **set rootful** | Machine-wide switch on the Engines card only, either way. Engine must be stopped: `podman machine set --rootful=<bool>`, then start. The UI explains that it only changes which user runs podman inside the VM, and that rootless and rootful stores are **separate**. |
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
| **install** | 1. Download the docker CLI → `~/.dockman/bin/docker`, plus the compose + buildx plugins → `~/.dockman/docker-cli-plugins` (skipped if `~/.docker/cli-plugins` already has them), plus the credential helper. 2. Shared helpers (as above). 3. Download the Linux VM image → `~/.dockman/docker/disk.raw` and the Docker Linux static tarball (both resumable, checksum-verified); grow the disk image to the chosen size (cloud-init `growpart`/`resizefs` run on every boot, so the guest fs follows). 4. Generate an SSH key, write cloud-init (user `dockman` in group `docker`, key, unpack the tarball from the share into `/usr/local/bin`, dockerd systemd unit + `daemon.json`, Rosetta/QEMU binfmt). 5. First boot (see **start**); progress is read from the serial log. 6. `docker run --rm hello-world` check. |
| **start** | Clean up stale pid/sock files. Spawn gvproxy (network + docker.sock forward), then vfkit (detached, pids recorded). Wait for SSH, then `docker info` on `~/.dockman/docker/docker.sock`. Start the port-forward agent. |
| **stop** | Stop the port-forward agent. Clean shutdown over SSH (`poweroff`), or vfkit's REST `Stop`. Wait for the vfkit pid to exit, then stop gvproxy. Force-kill after the timeout. |
| **status** | vfkit pid alive? gvproxy alive? socket answers `docker info`? If the pids are alive but the socket doesn't answer: `starting` (inside the timeout) or `error`. |
| **resize** | Engine must be stopped: write `vm.json` (cpus, memory); grow the disk image, then `resize2fs` on the next boot. |
| **reset** | Stop, delete `disk.raw` + `efi-vars`, then install from step 3 (all docker containers, images and volumes deleted, with confirmation). |
| **remove** | Reset files deleted entirely, plus the CLI, plugins and `dockman` context. Helpers stay if Podman still needs them. |
| **targeting** | Every call sets `DOCKER_HOST=unix://~/.dockman/docker/docker.sock`. Plugins resolve through `cliPluginsExtraDirs` / `~/.docker/cli-plugins`, never a private `DOCKER_CONFIG` (see **Pointing each CLI**). Ports: the port-forward agent (above). |
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
   adopts them as `managedBy: 'legacy'` (they were created by Dockman, so
   calling them "external" would break rule 3), shows a one-time "Move to
   Dockman-managed engines?" card, and only creates `dockman-podman` / the
   Docker VM when the user agrees. It never deletes the old machine without
   an explicit confirmation. The `~/.local/bin` entry earlier versions added
   to the shell rc is left in place and the new location is appended, so
   the user's terminal keeps working either way.
9. **Problems are diagnosed, never guessed.** Every known failure mode has a
   stable code, a plain-words cause and a fix the app can apply or show.
   The app never answers a failure with "try the other engine".

## Diagnosed problems — warnings with suggested fixes

This is the feature the Piston story asked for. A `Problem` (see the engine
model) is produced by three sources:

1. **Engine probes** (`engine_status`): rootless machine, Rosetta missing,
   shared `/var/run/docker.sock`, plugins missing, legacy install, host port
   in use (from the port-forward agent).
2. **Command output**: every `run`/`spawn_streaming` result passes through
   one matcher. A matched stderr line or non-zero exit becomes a `Problem`
   attached to the container/image, with the raw text kept in `logTail`.
3. **Container exit**: a container that exits non-zero within 30 s of start
   gets its last log lines run through the same matcher (this is how Piston's
   `cgroup.subtree_control` line is caught).

### Catalogue (first release)

| Code | Trigger | Message | Fix (one click unless noted) |
|---|---|---|---|
| `image.no_host_arch` | `no image found in image index for architecture` | "This image has no arm64 build." | **Run as amd64 (emulated)** → retry with `--platform`. Compose: show `platform: linux/amd64` to add to the service. |
| `image.emulated` (info) | `image platform (linux/amd64) does not match` warning, or `--platform` used | "Running under emulation, expect it to be slower." | **Install Rosetta** if missing (faster emulation). |
| `engine.rootless_cgroups` | container exits with a cgroup write error; or, on a rootless machine, a quick non-zero exit with a write / permission error (Piston's log says only `echo: write error`) | "Rootless podman can't give this container the cgroup controllers it asked for." | **Run again as root in the VM** (Run modal: remove the dead container, re-run on the root connection; compose: down the rootless stack, up through the root socket). |
| `engine.rootless_port` | `bind: permission denied` on a port < 1024 (rootless) | "Rootless podman can't publish ports below 1024." | **Run again as root in the VM**, or use a host port above 1024. |
| `engine.rosetta_missing` | host Rosetta absent on Apple Silicon | "Rosetta isn't installed; Intel images use slow QEMU." | **Install Rosetta** (system prompt, no password). Podman: note that the machine must be recreated to use it. |
| `engine.shared_socket` | `docker_served_by_podman()` | "docker commands in your terminal go to podman." | Show `podman-mac-helper uninstall` (needs sudo; not run by the app). |
| `engine.plugins_missing` | `docker: 'compose' is not a docker command` | "docker compose / buildx plugin missing." | **Install plugins**. |
| `port.in_use` | port-forward expose fails with address in use | "Port 8080 is already used on your Mac by <process>." | **Stop container** / show `lsof -i :8080`. |
| `mount.not_shared` | bind mount outside `/Users` on the Docker VM | "Only /Users is shared with the Docker VM." | Show the path to move to; (later) **Add shared folder**. |
| `mount.permission` | `permission denied` on a bind-mounted path for a non-root container user | "Files in /Users appear as uid 501 inside the VM." | Show `--user` / `chown` guidance. |
| `engine.legacy` (info) | `podman-machine-default` or `~/.local/bin` install found | "This machine was created by an older Dockman." | **Move to Dockman-managed engines**. |
| `engine.disk_full` | `no space left on device` | "The engine's disk is full." | **Prune** / **Resize disk**. |
| `engine.unknown_failure` | anything unmatched, exit ≠ 0 | message = first stderr line | **Details** (log tail), **Copy report**. Unmatched failures are logged so the catalogue grows from real cases. |

Rules: a `Problem` is shown where it happened (the container row, the image
row, the engine card) **and** in a Problems panel reachable from the status
bar badge ("2 problems"). Each one has the message, the cause, and the fix
buttons. Dismissing hides it until the trigger fires again. Applying a fix
re-runs the original action when that is safe (Run, Pull), or tells the user
what to re-run.

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
- **`vm.rootful`** → "rootful" / "rootless" chip on the podman card with a
  switch either way. Rootless is not flagged as a problem on its own; the
  `engine.rootless_cgroups` card appears only when a container fails for it.
- **`root` on a container / image / volume / network** → "root" chip: the
  object lives on podman's root connection (root inside the VM).
- **`problems`** → warning icon with a count on the engine card and on the
  affected container/image row; status bar badge; Problems panel.

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
| **Problems panel** | New. Opened from the status bar badge. One card per `Problem`: message, cause, fix buttons, "Details" with the log tail, "Copy report". Container and image rows link into it. |

## Phases

Each phase ends with a check run on a real Mac.

0. **Fix the podman story first (the smallest phase, the most value).**
   *Status 2026-10-15: implemented on the default machine (not yet a named
   `dockman-podman`): new machines stay rootless; per-container root in the
   VM (`commands/rootvm.rs`: the `podman-root` wrapper and the SSH-forwarded
   root socket for compose); "run again as root" as the default fix in the
   Run modal, the compose launcher and the Problems panel; root chips on
   rows; a rootless/rootful machine switch on the Engines page; `--platform`
   retry in Run and Pull; the emulated row label; `commands/problems.rs` with
   the matcher, the engine probes and the Problems panel. Matchers and
   parsers are unit-tested against the real output; the mechanism (root
   connection for run, forwarded socket for compose) was verified by hand
   with Piston; the UI has not yet been exercised in the running app.*
   `dockman-podman` created rootless with the rootful switch offered on
   failure; `--platform` retry in Run / Pull / Build; the `Problem` type,
   the output matcher and the first five catalogue entries
   (`image.no_host_arch`, `image.emulated`, `engine.rootless_cgroups`,
   `engine.rosetta_missing`, `engine.unknown_failure`); the Problems panel
   in its simplest form.
   → verify: Piston's compose file comes up on podman and answers on port
   2000; `amd64/alpine` runs with no flags and shows "emulated"; killing a
   rootless Piston shows the rootful fix card.
0b. **Fresh-user groundwork.** Move the shared helpers to `~/.dockman/bin`;
   download compose + buildx plugins (skip if present); set podman's compose
   provider; Rosetta offer before machine init; `podman machine init` on a
   pty; cache the release lists. → verify: on a new macOS user account, a
   Podman-only setup gets to a working compose-up without a terminal.
1. **Spike: boot the VM by hand.** Script vfkit + gvproxy + Debian raw +
   cloud-init + the Linux static tarball. → verify:
   `docker -H unix://$HOME/.dockman/docker/docker.sock info` works from the
   Mac, `/Users` is visible in the guest, and the VM survives closing the
   terminal that started it.
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
5. **Arch handling on the Docker VM.** Rosetta device + guest binfmt, the
   same `--platform` fallback as podman, emulated badge. → verify: an
   amd64-only image runs on both engines, and Piston comes up on docker too.
6. **UI.** The single `engines` store; every cell of the state → surface
   matrix; Engines screen (with the rootful switch), wizard, toggle, banner,
   Run modal, resources, status bar, toasts; the rest of the problem
   catalogue. → verify: force each engine into each of the 7 states
   (uninstall, mid-install, stopped, starting, running, stopping, error by
   killing vfkit) and screenshot every surface listed in the matrix; force
   every catalogue entry and check its card.
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
4. ~~**Existing `/var/run/docker.sock` link**~~ **Resolved:** leave it alone,
   diagnose it, show the removal command, never run it.
5. **Signing:** an Apple Developer ID ($99/yr) is needed for a DMG that
   opens without a Gatekeeper workaround. Without one, "never leave the app"
   can't cover the very first launch.
6. **Linux hosts:** no VM is needed there; use native `dockerd` / podman.
   Out of scope until macOS works.
7. ~~**Rootful by default for `dockman-podman`**~~ **Resolved: no, and the
   fix is per container.** Keep podman's rootless default; most images are
   fine with it and developers should not get the wider mode for everything
   because one image needs it. When an image does (Piston), the failure is
   diagnosed and that one container (or stack) is run again as root inside
   the VM through the machine's root connection. dockerd and OrbStack are
   always root inside their VMs, so this gives nothing Docker Desktop doesn't
   already give. Nothing on the Mac runs as root and no admin password is
   needed. Verified end to end on 2026-10-15.
8. **Minimum macOS 13** (Rosetta in VMs). Older Macs could run without
   Rosetta on QEMU only; decide whether to support that or refuse to install.
9. **Is the Docker VM worth it before the podman work ships?** Phase 0 alone
   fixes the problem the project was created for, on podman, with no Docker
   at all. Phases 1–5 (the Dockman VM) are the largest part of the plan and
   overlap with Colima/Lima, which are also free. Proposed: ship phase 0 and
   0b first and decide on the VM after real users hit something podman
   rootful still can't run.
