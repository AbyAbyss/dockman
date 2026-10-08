// Shown when the UI is opened in a plain browser instead of the desktop
// shell: the project website and `npm run dev` both land here. There is no
// engine to talk to, so this page only explains what Dockman is and where
// to get it.

const RELEASES = 'https://github.com/AbyAbyss/dockman/releases/latest';

export function DesktopGate() {
  return (
    <div className="gate">
      <div className="gate-card">
        <div className="gate-brand">
          <div className="gate-mark">
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinejoin="round"
              strokeLinecap="round"
            >
              <rect x="3" y="9" width="5" height="5" rx="1" />
              <rect x="9.5" y="9" width="5" height="5" rx="1" />
              <rect x="16" y="9" width="5" height="5" rx="1" />
              <rect x="9.5" y="3" width="5" height="5" rx="1" />
              <path d="M3 17h18" />
            </svg>
          </div>
          <div>
            <div className="gate-title">Dockman</div>
            <div className="gate-sub">Docker and Podman, side by side, on your desktop</div>
          </div>
        </div>

        <p>
          Dockman is a native desktop app that drives the Docker and Podman CLIs on
          your machine: containers, images, volumes, networks, builds and the runtime
          binaries themselves. It needs the desktop shell to reach your engines, so
          there is nothing to run in a browser. Download it below.
        </p>

        <div className="gate-dl">
          <a href={RELEASES}>
            macOS<span>.dmg · Apple Silicon and Intel</span>
          </a>
          <a href={RELEASES}>
            Windows<span>.msi / .exe</span>
          </a>
          <a href={RELEASES}>
            Linux<span>.AppImage / .deb</span>
          </a>
        </div>

        <div className="gate-features">
          <div>
            <b>Both runtimes</b>Docker and Podman in one window, or filtered to one.
          </div>
          <div>
            <b>Architecture fallback</b>Images Podman can't run on your CPU retry on
            Docker under emulation.
          </div>
          <div>
            <b>Binary manager</b>Installs official CLI releases and verifies them.
          </div>
          <div>
            <b>Open source</b>MIT licensed. No account, no telemetry.
          </div>
        </div>

        <div className="gate-foot">
          <a href="https://github.com/AbyAbyss/dockman">Source on GitHub</a>
          <a href="https://github.com/AbyAbyss/dockman#first-launch">First-launch notes</a>
          <a href="https://github.com/AbyAbyss/dockman/issues">Report an issue</a>
        </div>
      </div>
    </div>
  );
}
