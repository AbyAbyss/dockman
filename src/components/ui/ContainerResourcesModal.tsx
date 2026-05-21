// ContainerResourcesModal — adjust an existing container's memory / CPU limits
// via `<runtime> update`. For a stopped container, it can apply and start in
// one step. Disk size is fixed at creation, so it is not offered here.

import { useEffect, useState } from 'react';
import { Glyph } from './Icon';
import { ContainerCommands } from '@/lib/commands';
import { LIMIT_PRESETS } from '@/lib/limits';
import { useAppStore } from '@/store/appStore';
import type { Container } from '@/types';

export function ContainerResourcesModal({
  container,
  onClose,
}: {
  container: Container;
  onClose: () => void;
}) {
  const refresh = useAppStore((s) => s.refresh);
  const [memory, setMemory] = useState('');
  const [memorySwap, setMemorySwap] = useState('');
  const [cpus, setCpus] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const stopped = container.status !== 'running';
  const nothingSet = !memory.trim() && !memorySwap.trim() && !cpus.trim();
  const activePreset = LIMIT_PRESETS.find(
    (p) => p.memory === memory && p.memorySwap === memorySwap && p.cpus === cpus,
  )?.label;

  // Escape closes the modal unless an update is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const apply = (thenStart: boolean) => {
    if (busy || nothingSet) return;
    setError(null);
    setBusy(true);
    ContainerCommands.update(
      container.rt,
      container.id,
      memory.trim() || undefined,
      memorySwap.trim() || undefined,
      cpus.trim() || undefined,
    )
      .then(() =>
        thenStart ? ContainerCommands.start(container.rt, container.id) : undefined,
      )
      .then(() => refresh())
      .then(() => onClose())
      .catch((e) => {
        setError(String(e));
        setBusy(false);
      });
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-panel crm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="modal-mark">
            <Glyph name="cpu" size={15} />
          </span>
          <div className="modal-head-text">
            <div className="modal-title">Configure resources</div>
            <div className="modal-sub mono">{container.name}</div>
          </div>
          <button
            className="modal-x"
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <Glyph name="close" size={15} />
          </button>
        </header>

        <div className="modal-body rcm-body">
          <div className="rcm-field">
            <label className="rcm-label">Preset</label>
            <div className="rcm-presets">
              {LIMIT_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`rcm-chip ${activePreset === p.label ? 'is-on' : ''}`}
                  onClick={() => {
                    setMemory(p.memory);
                    setMemorySwap(p.memorySwap);
                    setCpus(p.cpus);
                  }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="crm-grid">
            <div className="rcm-limit">
              <label className="rcm-label">Memory</label>
              <input
                className="ti mono"
                value={memory}
                onChange={(e) => setMemory(e.target.value)}
                placeholder="e.g. 512m"
              />
            </div>
            <div className="rcm-limit">
              <label className="rcm-label">Memory + swap</label>
              <input
                className="ti mono"
                value={memorySwap}
                onChange={(e) => setMemorySwap(e.target.value)}
                placeholder="e.g. 512m"
              />
            </div>
            <div className="rcm-limit">
              <label className="rcm-label">CPUs</label>
              <input
                className="ti mono"
                value={cpus}
                onChange={(e) => setCpus(e.target.value)}
                placeholder="e.g. 1.5"
              />
            </div>
          </div>

          <div className="rcm-limits-note">
            Applied with <span className="mono">{container.rt} update</span> — a
            blank field is left unchanged. Disk size can't be changed on an
            existing container; recreate it from the image to resize the disk.
          </div>

          {error && <div className="rcm-error mono">{error}</div>}
        </div>

        <footer className="modal-foot">
          <button
            className="action-btn"
            type="button"
            onClick={onClose}
            disabled={busy}
          >
            Cancel
          </button>
          {stopped ? (
            <>
              <button
                className="action-btn"
                type="button"
                onClick={() => apply(false)}
                disabled={busy || nothingSet}
              >
                Apply only
              </button>
              <button
                className="action-btn primary"
                type="button"
                onClick={() => apply(true)}
                disabled={busy || nothingSet}
              >
                <Glyph name="play" size={12} /> Apply &amp; start
              </button>
            </>
          ) : (
            <button
              className="action-btn primary"
              type="button"
              onClick={() => apply(false)}
              disabled={busy || nothingSet}
            >
              Apply
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
