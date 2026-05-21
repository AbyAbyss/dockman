// RunContainerModal — compose and launch any image in one place.
//
// Presets for common images, an explicit runtime choice, repeatable port /
// env / volume rows and an optional command override. While the image pulls
// the form is swapped for the LaunchCard scaffolding animation.

import { useEffect, useState } from 'react';
import { Glyph } from './Icon';
import { LaunchCard } from './LaunchCard';
import { RuntimeBadge } from './Runtime';
import { ContainerCommands } from '@/lib/commands';
import { LIMIT_PRESETS, limitSummary } from '@/lib/limits';
import { useAppStore } from '@/store/appStore';
import type { RuntimeName } from '@/types';

interface Pair {
  a: string;
  b: string;
}

const EMPTY: Pair = { a: '', b: '' };

// Quick-pick images, each with a sensible default port / env so a click is
// genuinely one step away from a running service.
const PRESETS: { label: string; image: string; port?: string; env?: string }[] = [
  { label: 'redis', image: 'redis:7-alpine', port: '6379:6379' },
  {
    label: 'postgres',
    image: 'postgres:16-alpine',
    port: '5432:5432',
    env: 'POSTGRES_PASSWORD=postgres',
  },
  { label: 'nginx', image: 'nginx:alpine', port: '8080:80' },
  { label: 'mysql', image: 'mysql:8', port: '3306:3306', env: 'MYSQL_ROOT_PASSWORD=root' },
  { label: 'mongo', image: 'mongo:7', port: '27017:27017' },
  { label: 'node', image: 'node:20-alpine' },
  { label: 'python', image: 'python:3.12-slim' },
  { label: 'alpine', image: 'alpine:latest' },
];

function pairFrom(s: string, sep = ':'): Pair {
  const i = s.indexOf(sep);
  return i >= 0 ? { a: s.slice(0, i), b: s.slice(i + 1) } : { a: s, b: '' };
}

export function RunContainerModal({
  onClose,
  defaultRuntime,
  defaultImage = '',
}: {
  onClose: () => void;
  defaultRuntime: RuntimeName;
  /** Pre-fill the image field — used when launching from the Images page. */
  defaultImage?: string;
}) {
  const refresh = useAppStore((s) => s.refresh);
  const live = useAppStore((s) => s.live);

  const [image, setImage] = useState(defaultImage);
  const [name, setName] = useState('');
  const [rt, setRt] = useState<RuntimeName>(defaultRuntime);
  const [ports, setPorts] = useState<Pair[]>([{ ...EMPTY }]);
  const [env, setEnv] = useState<Pair[]>([{ ...EMPTY }]);
  const [volumes, setVolumes] = useState<Pair[]>([{ ...EMPTY }]);
  const [command, setCommand] = useState('');
  const [memory, setMemory] = useState('');
  const [memorySwap, setMemorySwap] = useState('');
  const [cpus, setCpus] = useState('');
  const [storageSize, setStorageSize] = useState('');
  const [showLimits, setShowLimits] = useState(false);
  const [detach, setDetach] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Escape closes the modal — unless a launch is in flight.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const applyPreset = (p: (typeof PRESETS)[number]) => {
    setImage(p.image);
    setPorts(p.port ? [pairFrom(p.port)] : [{ ...EMPTY }]);
    setEnv(p.env ? [pairFrom(p.env, '=')] : [{ ...EMPTY }]);
    setError(null);
  };

  const applyLimitPreset = (p: (typeof LIMIT_PRESETS)[number]) => {
    setMemory(p.memory);
    setMemorySwap(p.memorySwap);
    setCpus(p.cpus);
  };
  const activeLimitPreset = LIMIT_PRESETS.find(
    (p) => p.memory === memory && p.memorySwap === memorySwap && p.cpus === cpus,
  )?.label;

  const launch = () => {
    if (!image.trim() || busy) return;
    setError(null);
    setBusy(true);
    ContainerCommands.run(rt, {
      image: image.trim(),
      name: name.trim() || undefined,
      ports: ports.filter((p) => p.a && p.b).map((p) => `${p.a}:${p.b}`),
      env: env.filter((p) => p.a).map((p) => `${p.a}=${p.b}`),
      volumes: volumes.filter((p) => p.a && p.b).map((p) => `${p.a}:${p.b}`),
      command: command.trim() ? command.trim().split(/\s+/) : [],
      detach,
      memory: memory.trim() || undefined,
      memorySwap: memorySwap.trim() || undefined,
      cpus: cpus.trim() || undefined,
      storageSize: storageSize.trim() || undefined,
    })
      .then(() => refresh())
      .then(() => onClose())
      .catch((e) => {
        setError(String(e));
        setBusy(false);
      });
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal-panel rcm" onClick={(e) => e.stopPropagation()}>
        <header className="modal-head">
          <span className="modal-mark">
            <Glyph name="play" size={15} />
          </span>
          <div className="modal-head-text">
            <div className="modal-title">Run a container</div>
            <div className="modal-sub">
              Pull and start any image with your own ports, env and volumes.
            </div>
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

        {busy ? (
          <LaunchCard
            rt={rt}
            image={image.trim()}
            note={memory || cpus ? limitSummary(memory, cpus) : undefined}
          />
        ) : (
          <>
            <div className="modal-body rcm-body">
              <div className="rcm-field">
                <label className="rcm-label">Image</label>
                <input
                  className="ti"
                  value={image}
                  onChange={(e) => setImage(e.target.value)}
                  placeholder="e.g. redis:7-alpine"
                  autoFocus
                />
                <div className="rcm-presets">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className={`rcm-chip mono ${image === p.image ? 'is-on' : ''}`}
                      onClick={() => applyPreset(p)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="rcm-grid2">
                <div className="rcm-field">
                  <label className="rcm-label">
                    Name <span className="rcm-opt">optional</span>
                  </label>
                  <input
                    className="ti"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="auto-generated"
                  />
                </div>
                <div className="rcm-field">
                  <label className="rcm-label">Runtime</label>
                  <div className="rcm-seg">
                    {(['docker', 'podman'] as RuntimeName[]).map((r) => (
                      <button
                        key={r}
                        type="button"
                        className={`rcm-seg-btn ${rt === r ? 'is-on' : ''}`}
                        onClick={() => setRt(r)}
                      >
                        <RuntimeBadge rt={r} size="xs" showLabel={false} /> {r}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <PairList
                title="Port mappings"
                hintA="host"
                hintB="container"
                sep=":"
                addLabel="Add port"
                rows={ports}
                setRows={setPorts}
                numeric
                captionA="External · host port"
                captionB="Internal · container port"
              />
              <PairList
                title="Environment"
                hintA="KEY"
                hintB="value"
                sep="="
                addLabel="Add variable"
                rows={env}
                setRows={setEnv}
              />
              <PairList
                title="Volumes"
                hintA="host path"
                hintB="container path"
                sep=":"
                addLabel="Add volume"
                rows={volumes}
                setRows={setVolumes}
              />

              <div className="rcm-field">
                <button
                  type="button"
                  className="rcm-collapse"
                  onClick={() => setShowLimits((v) => !v)}
                  aria-expanded={showLimits}
                >
                  <span className={`rcm-collapse-chv ${showLimits ? 'is-open' : ''}`}>
                    <Glyph name="chevron" size={11} />
                  </span>
                  <span className="rcm-label">Resource limits</span>
                  {!showLimits && (
                    <span className="rcm-collapse-hint">
                      {limitSummary(memory, cpus)}
                    </span>
                  )}
                </button>
                {showLimits && (
                  <div className="rcm-limits">
                    <div className="rcm-presets">
                      {LIMIT_PRESETS.map((p) => (
                        <button
                          key={p.label}
                          type="button"
                          className={`rcm-chip ${
                            activeLimitPreset === p.label ? 'is-on' : ''
                          }`}
                          onClick={() => applyLimitPreset(p)}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>
                    <div className="rcm-limits-grid">
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
                      <div className="rcm-limit">
                        <label className="rcm-label">Disk size</label>
                        <input
                          className="ti mono"
                          value={storageSize}
                          onChange={(e) => setStorageSize(e.target.value)}
                          placeholder="e.g. 10G"
                        />
                      </div>
                    </div>
                    <div className="rcm-limits-note">
                      Memory + swap is the total of memory plus swap — set it
                      equal to Memory to disable swapping. Disk size needs a
                      quota-capable storage driver and is unsupported on most
                      default setups.
                    </div>
                  </div>
                )}
              </div>

              <div className="rcm-field">
                <label className="rcm-label">
                  Command <span className="rcm-opt">optional</span>
                </label>
                <input
                  className="ti mono"
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="override the image's default command"
                />
              </div>

              <label className="rcm-check">
                <input
                  type="checkbox"
                  checked={detach}
                  onChange={(e) => setDetach(e.target.checked)}
                />
                <span>Run detached (in the background)</span>
              </label>

              {!live && (
                <div className="rcm-note">
                  Running containers requires the desktop app.
                </div>
              )}
              {error && <div className="rcm-error mono">{error}</div>}
            </div>

            <footer className="modal-foot">
              <button className="action-btn" type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                className="action-btn primary"
                type="button"
                onClick={launch}
                disabled={!image.trim()}
              >
                <Glyph name="play" size={12} /> Run container
              </button>
            </footer>
          </>
        )}
      </div>
    </div>
  );
}

/** A labelled list of repeatable two-field rows (ports / env / volumes). */
function PairList({
  title,
  hintA,
  hintB,
  sep,
  addLabel,
  rows,
  setRows,
  numeric = false,
  captionA,
  captionB,
}: {
  title: string;
  hintA: string;
  hintB: string;
  sep: string;
  addLabel: string;
  rows: Pair[];
  setRows: (rows: Pair[]) => void;
  /** Restrict both fields to digits and hint a numeric keypad. */
  numeric?: boolean;
  /** Optional captions shown once, aligned under each column. */
  captionA?: string;
  captionB?: string;
}) {
  const update = (i: number, key: keyof Pair, value: string) =>
    setRows(
      rows.map((r, j) =>
        j === i
          ? { ...r, [key]: numeric ? value.replace(/[^0-9]/g, '') : value }
          : r,
      ),
    );
  const add = () => setRows([...rows, { ...EMPTY }]);
  const remove = (i: number) =>
    setRows(rows.length === 1 ? [{ ...EMPTY }] : rows.filter((_, j) => j !== i));

  return (
    <div className="rcm-field">
      <label className="rcm-label">{title}</label>
      {(captionA || captionB) && (
        <div className="rcm-pair rcm-pair-caps">
          <span className="rcm-pair-cap">{captionA}</span>
          <span className="rcm-sep" aria-hidden="true" style={{ visibility: 'hidden' }}>
            {sep}
          </span>
          <span className="rcm-pair-cap">{captionB}</span>
          <span className="iconbtn" aria-hidden="true" />
        </div>
      )}
      {rows.map((r, i) => (
        <div className="rcm-pair" key={i}>
          <input
            className="ti mono"
            value={r.a}
            onChange={(e) => update(i, 'a', e.target.value)}
            placeholder={hintA}
            inputMode={numeric ? 'numeric' : undefined}
          />
          <span className="rcm-sep">{sep}</span>
          <input
            className="ti mono"
            value={r.b}
            onChange={(e) => update(i, 'b', e.target.value)}
            placeholder={hintB}
            inputMode={numeric ? 'numeric' : undefined}
          />
          <button
            type="button"
            className="iconbtn"
            onClick={() => remove(i)}
            aria-label="Remove row"
          >
            <Glyph name="trash" size={13} />
          </button>
        </div>
      ))}
      <button type="button" className="rcm-add" onClick={add}>
        <Glyph name="plus" size={11} /> {addLabel}
      </button>
    </div>
  );
}
