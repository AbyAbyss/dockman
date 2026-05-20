# Dockman

A unified desktop GUI for managing **Docker** and **Podman** — containers, images, volumes, networks and builds, all in one place.

Built with [Tauri 2](https://tauri.app), React and TypeScript.

## Development

**Prerequisites**

- [Node.js](https://nodejs.org) 20 or newer
- [Rust](https://rustup.rs) (stable toolchain)
- Tauri's platform dependencies — see the [Tauri prerequisites guide](https://tauri.app/start/prerequisites/)

**Run the app**

```bash
npm install
npm run tauri dev
```

**Build locally**

```bash
npm run tauri build
```

The installer for your platform is written to `src-tauri/target/release/bundle/`.

## Releasing

Releases are built automatically by GitHub Actions ([`.github/workflows/release.yml`](.github/workflows/release.yml)) and published as downloadable installers for macOS (Apple Silicon + Intel), Windows and Linux.

To cut a release, run:

```bash
make release VERSION=0.2.0
```

This will:

1. Bump the version in `package.json`, `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json`
2. Commit the bump and create a `v0.2.0` tag
3. Push the commit and the tag to GitHub

Pushing the tag triggers the workflow, which builds every platform and creates a **draft GitHub Release**. Open the draft, review the attached binaries, and click **Publish** to make them public.

Run `make help` to list available commands.

> Builds are unsigned, so on first launch users may see a Gatekeeper warning (macOS) or SmartScreen prompt (Windows). The generated release notes explain how to get past it.
