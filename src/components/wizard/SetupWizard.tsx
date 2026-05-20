// First-run setup wizard — choose a runtime mode, detect what's installed,
// and land in the app. Shown as a full-screen overlay until completed.

import { useEffect, useState, type CSSProperties } from 'react';
import { Glyph, type IconName } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Badge';
import { RuntimeCommands, type RuntimeInfo } from '@/lib/commands';
import { isTauri } from '@/lib/tauri';
import { RUNTIMES } from '@/data/seed';
import { useWizardStore } from '@/store/wizardStore';
import { useAppStore } from '@/store/appStore';
import type { RuntimeFilter, RuntimeName } from '@/types';

const MODE_OPTIONS: { key: RuntimeFilter; name: string; sub: string; icon: IconName }[] = [
  { key: 'docker', name: 'Docker', sub: 'Work with Docker only', icon: 'container' },
  { key: 'podman', name: 'Podman', sub: 'Work with Podman only', icon: 'extension' },
  { key: 'all', name: 'Both', sub: 'Unified Docker + Podman view', icon: 'bolt' },
];

/** Browser-mode fallback when live detection isn't available. */
function seedRuntimeInfo(): RuntimeInfo[] {
  return (['docker', 'podman'] as RuntimeName[]).map((rt) => ({
    runtime: rt,
    found: RUNTIMES[rt].found,
    path: RUNTIMES[rt].path,
    version: RUNTIMES[rt].version,
    isRunning: RUNTIMES[rt].running,
    arch: RUNTIMES[rt].arch,
    composeAvailable: true,
  }));
}

export function SetupWizard() {
  const setCompleted = useWizardStore((s) => s.setCompleted);
  const setRuntimeFilter = useAppStore((s) => s.setRuntimeFilter);
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState<RuntimeFilter>('all');
  const [detected, setDetected] = useState<RuntimeInfo[] | null>(null);

  // Detect runtimes when the user reaches step 2.
  useEffect(() => {
    if (step !== 1 || detected) return;
    if (!isTauri()) {
      setDetected(seedRuntimeInfo());
      return;
    }
    RuntimeCommands.detectAll()
      .then(setDetected)
      .catch(() => setDetected(seedRuntimeInfo()));
  }, [step, detected]);

  const finish = () => {
    setRuntimeFilter(mode);
    RuntimeCommands.setMode(mode === 'all' ? 'both' : mode).catch(() => undefined);
    setCompleted(true);
  };

  const need: RuntimeName[] = mode === 'all' ? ['docker', 'podman'] : [mode];
  const missing =
    detected?.filter(
      (r) => need.includes(r.runtime as RuntimeName) && !r.found,
    ) ?? [];

  const rtStyle = (key: RuntimeFilter): CSSProperties | undefined => {
    if (key === 'docker')
      return { '--rt': 'var(--rt-docker)', '--rt-soft': 'var(--rt-docker-soft)' } as CSSProperties;
    if (key === 'podman')
      return { '--rt': 'var(--rt-podman)', '--rt-soft': 'var(--rt-podman-soft)' } as CSSProperties;
    return undefined;
  };

  return (
    <div className="wizard-overlay">
      <div className="wizard-panel">
        <div className="wizard-head">
          <div className="wizard-mark">
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
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
            <div className="wizard-title">Welcome to Dockman</div>
            <div className="wizard-sub">First-run setup · step {step + 1} of 3</div>
          </div>
        </div>

        <div className="wizard-steps">
          {[0, 1, 2].map((i) => (
            <div key={i} className={`wizard-step-dot ${i <= step ? 'is-on' : ''}`} />
          ))}
        </div>

        <div className="wizard-body">
          {step === 0 && (
            <>
              <div className="wizard-h2">Choose your runtime</div>
              <div className="wizard-sub">
                Dockman works with whatever you have installed — pick how you'd like
                to start. You can change this later in Settings.
              </div>
              <div className="settings-rt-row">
                {MODE_OPTIONS.map((o) => (
                  <button
                    key={o.key}
                    type="button"
                    className={`settings-rt-card ${o.key === 'all' ? 'both' : ''} ${
                      mode === o.key ? 'is-on' : ''
                    }`}
                    onClick={() => setMode(o.key)}
                    style={rtStyle(o.key)}
                  >
                    <div className="settings-rt-mark">
                      <Glyph name={o.icon} size={16} />
                    </div>
                    <div className="settings-rt-body">
                      <div className="settings-rt-name">{o.name}</div>
                      <div className="settings-rt-v mono">{o.sub}</div>
                    </div>
                    <div className="settings-rt-on">{mode === o.key ? '✓' : ''}</div>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div className="wizard-h2">Detecting container runtimes</div>
              {!detected && <div className="wizard-sub">Scanning your system…</div>}
              {detected?.map((r) => (
                <div key={r.runtime} className="wizard-detect-row">
                  <div className={`rt-card-mark rt-${r.runtime}`}>
                    <Glyph
                      name={r.runtime === 'docker' ? 'container' : 'extension'}
                      size={18}
                    />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, textTransform: 'capitalize' }}>
                      {r.runtime}
                    </div>
                    <div
                      className="wizard-sub mono"
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {r.found ? `v${r.version} · ${r.path}` : 'not installed'}
                    </div>
                  </div>
                  <Pill tone={r.found ? 'ok' : 'warn'}>
                    {r.found ? 'found' : 'missing'}
                  </Pill>
                </div>
              ))}
              {missing.length > 0 && (
                <div className="wizard-sub">
                  {missing.map((r) => r.runtime).join(' & ')} not detected — you can
                  install it later from the Binaries tab.
                </div>
              )}
            </>
          )}

          {step === 2 && (
            <div className="wizard-done">
              <div className="wizard-done-icon">
                <svg
                  viewBox="0 0 32 32"
                  width="30"
                  height="30"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M7 17l6 6 12-14" />
                </svg>
              </div>
              <div className="wizard-h2">You're all set</div>
              <div className="wizard-sub">
                Dockman will open in {mode === 'all' ? 'unified' : mode} mode.
              </div>
            </div>
          )}
        </div>

        <div className="wizard-foot">
          <button
            className="action-btn"
            type="button"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
          >
            Back
          </button>
          {step < 2 ? (
            <button
              className="action-btn primary"
              type="button"
              disabled={step === 1 && !detected}
              onClick={() => setStep((s) => s + 1)}
            >
              {step === 1 && !detected ? 'Detecting…' : 'Continue'}{' '}
              <Glyph name="arrow" size={12} />
            </button>
          ) : (
            <button className="action-btn primary" type="button" onClick={finish}>
              Get started <Glyph name="arrow" size={12} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
