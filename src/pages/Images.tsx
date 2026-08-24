// Images — local library and registry view: a dense table beside a pane
// carrying the disk breakdown, registries and the reclaim callout.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { RunContainerModal } from '@/components/ui/RunContainerModal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { useAppStore } from '@/store/appStore';
import { useImages } from '@/hooks/useData';
import { ImageCommands } from '@/lib/commands';
import { RUNTIMES } from '@/data/seed';
import type { ImageItem, RuntimeName } from '@/types';

/** Disk allocated to the image store. No backend command reports this yet. */
const ALLOCATED_MB = 4096;

/** Registries are not backed by a command; the list is presentational. */
const REGISTRIES = [
  { name: 'docker.io', account: 'library · anonymous pulls', connected: true },
  { name: 'ghcr.io', account: 'AbyAbyss', connected: true },
  { name: 'gcr.io', account: 'not signed in', connected: false },
];

/** Repository avatars cycle through the palette so rows stay distinguishable. */
const AVATAR_TONES = ['a', 'b', 'c', 'd', 'e'];

function sizeToMB(size: string): number {
  const v = parseFloat(size);
  if (Number.isNaN(v)) return 0;
  return size.includes('GB') ? v * 1024 : v;
}

function fmtGB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export default function Images() {
  const query = useAppStore((s) => s.query);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const containers = useAppStore((s) => s.containers);
  const imagesRes = useImages(runtimeFilter);
  const images = imagesRes.data;

  // USED BY names the containers actually running an image, not its pull count.
  const usersOf = (img: ImageItem) =>
    containers.filter((c) => c.image.split(':')[0] === img.name).map((c) => c.name);

  const [pullInput, setPullInput] = useState('postgres:16-alpine');
  const [pulling, setPulling] = useState<{ name: string; progress: number } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [tagging, setTagging] = useState(false);
  const [tagValue, setTagValue] = useState('');
  const [confirmPrune, setConfirmPrune] = useState(false);
  const [runTarget, setRunTarget] = useState<{ image: string; rt: RuntimeName } | null>(
    null,
  );
  const pullTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (pullTimer.current) clearInterval(pullTimer.current);
    },
    [],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? images.filter((i) => (i.name + i.tag).toLowerCase().includes(q))
      : images;
  }, [images, query]);

  const usedMB = images.filter((i) => i.used).reduce((s, i) => s + sizeToMB(i.size), 0);
  const idleMB = images.filter((i) => !i.used).reduce((s, i) => s + sizeToMB(i.size), 0);
  const totalMB = usedMB + idleMB;
  const unusedCount = images.filter((i) => !i.used).length;

  const detail = selected ? images.find((i) => i.id === selected) : null;

  const startPull = () => {
    if (!pullInput.trim() || pulling) return;
    const name = pullInput;
    setPulling({ name, progress: 0 });

    if (imagesRes.live) {
      const rt = runtimeFilter === 'podman' ? 'podman' : 'docker';
      ImageCommands.pull(rt, name)
        .then(() => imagesRes.refetch())
        .catch(() => undefined);
    }

    // The CLI does not stream a percentage, so the bar is a progress
    // indication rather than a measured one — same as the previous build.
    let p = 0;
    pullTimer.current = window.setInterval(() => {
      p += 8 + Math.random() * 12;
      if (p >= 100) {
        if (pullTimer.current) clearInterval(pullTimer.current);
        pullTimer.current = null;
        setPulling(null);
        return;
      }
      setPulling({ name, progress: Math.round(p) });
    }, 280);
  };

  const removeImage = (img: ImageItem) => {
    if (imagesRes.live) {
      ImageCommands.remove(img.rt, img.id)
        .then(() => imagesRes.refetch())
        .catch(() => undefined);
    }
    if (selected === img.id) setSelected(null);
  };

  const pushImage = () => {
    if (!detail) return;
    ImageCommands.push(detail.rt, `${detail.name}:${detail.tag}`).catch(() => undefined);
  };

  const pruneImages = () => {
    ImageCommands.prune(runtimeFilter === 'podman' ? 'podman' : 'docker')
      .then(() => imagesRes.refetch())
      .catch(() => undefined);
  };

  const applyTag = () => {
    if (!detail || !tagValue.trim()) return;
    ImageCommands.tag(detail.rt, `${detail.name}:${detail.tag}`, tagValue.trim())
      .then(() => imagesRes.refetch())
      .catch(() => undefined);
    setTagging(false);
    setTagValue('');
  };

  return (
    <div className="split-screen">
      <div className="split-main">
        {/* ─── Toolbar ─────────────────────────────────────────────────── */}
        <div className="ctr-toolbar">
          <div className="pull-field">
            <Glyph name="arrow" size={12} sw={1.7} />
            <input
              className="mono"
              value={pullInput}
              placeholder="image:tag"
              onChange={(e) => setPullInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') startPull();
              }}
            />
          </div>
          <button
            type="button"
            className="tool-btn is-primary"
            disabled={!!pulling}
            onClick={startPull}
          >
            <Glyph name="arrow" size={12} sw={2} />
            {pulling ? `Pulling ${pulling.progress}%` : 'Pull image'}
          </button>

          <div className="ctr-tools">
            <span className="toolbar-note mono">
              {unusedCount} unused · {fmtGB(idleMB)} reclaimable
            </span>
            <button
              type="button"
              className="tool-btn is-danger"
              disabled={unusedCount === 0}
              onClick={() => setConfirmPrune(true)}
            >
              <Glyph name="trash" size={12} />
              Prune unused
            </button>
          </div>
        </div>

        {pulling && (
          <div className="pull-strip">
            <span className="mono">pulling {pulling.name}</span>
            <div className="track">
              <div className="track-fill" style={{ width: `${pulling.progress}%` }} />
            </div>
            <span className="mono">{pulling.progress}%</span>
          </div>
        )}

        {/* ─── Table ───────────────────────────────────────────────────── */}
        <div className="ctr-thead img-cols mono">
          <span className="col-repo">REPOSITORY</span>
          <span className="col-tag">TAG</span>
          <span className="col-size">SIZE</span>
          <span className="col-layers">LAYERS</span>
          <span className="col-used">USED BY</span>
          <span className="col-built">BUILT</span>
          <span className="col-iact">ACTIONS</span>
        </div>

        <div className="ctr-body">
          {filtered.length === 0 && (
            <div className="empty">
              <Glyph name="image" size={24} />
              <div>
                {images.length === 0
                  ? 'No images cached yet — pull one to get started.'
                  : 'No images match this search.'}
              </div>
            </div>
          )}
          {filtered.map((img, i) => {
            const leaf = img.name.split('/').pop() || img.name;
            const users = usersOf(img);
            return (
              <div
                key={img.id}
                className={`img-row img-cols ${selected === img.id ? 'is-focused' : ''}`}
                onClick={() => setSelected(selected === img.id ? null : img.id)}
              >
                <div className="col-repo">
                  <span className={`img-avatar tone-${AVATAR_TONES[i % AVATAR_TONES.length]}`}>
                    {leaf.charAt(0).toUpperCase()}
                  </span>
                  <span className="img-name mono">{img.name}</span>
                  <span
                    className="ctr-rt"
                    title={img.rt}
                    style={{ background: RUNTIMES[img.rt]?.accent }}
                  />
                </div>
                <span className="col-tag mono">{img.tag}</span>
                <span className="col-size mono">{img.size}</span>
                <span className="col-layers mono">{img.layers}</span>
                <span
                  className={`col-used mono ${users.length ? '' : 'is-idle'}`}
                  title={users.join(', ')}
                >
                  {users.length === 0
                    ? '—'
                    : users.length === 1
                      ? users[0]
                      : `${users[0]} +${users.length - 1}`}
                </span>
                <span className="col-built mono">{img.built}</span>
                <div className="col-iact" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    className="text-chip"
                    onClick={() =>
                      setRunTarget({ image: `${img.name}:${img.tag}`, rt: img.rt })
                    }
                  >
                    run
                  </button>
                  <button
                    type="button"
                    className="row-btn is-danger"
                    title="Remove image"
                    onClick={() => removeImage(img)}
                  >
                    <Glyph name="trash" size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── Right pane ────────────────────────────────────────────────── */}
      <aside className="side-pane">
        {detail && (
          <div className="side-block">
            <div className="section-label">SELECTED IMAGE</div>
            <div className="side-title mono">
              {detail.name}:{detail.tag}
            </div>
            {tagging ? (
              <div className="tag-form">
                <input
                  className="field mono"
                  autoFocus
                  value={tagValue}
                  placeholder="new:tag"
                  onChange={(e) => setTagValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyTag();
                    if (e.key === 'Escape') setTagging(false);
                  }}
                />
                <button type="button" className="tool-btn is-primary" onClick={applyTag}>
                  Tag
                </button>
              </div>
            ) : (
              <div className="side-actions">
                <button
                  type="button"
                  className="det-action"
                  onClick={() => {
                    setTagValue(`${detail.name}:`);
                    setTagging(true);
                  }}
                >
                  Tag
                </button>
                <button type="button" className="det-action" onClick={pushImage}>
                  Push
                </button>
                <button
                  type="button"
                  className="det-action is-danger"
                  onClick={() => removeImage(detail)}
                >
                  Remove
                </button>
              </div>
            )}
          </div>
        )}

        <div className="side-block">
          <div className="section-label">DISK</div>
          <div className="side-stat">{fmtGB(totalMB)}</div>
          <div className="side-sub mono">of {fmtGB(ALLOCATED_MB)} allocated</div>
          <div className="seg-bar">
            <div
              className="seg tone-a"
              style={{ width: `${(usedMB / ALLOCATED_MB) * 100}%` }}
            />
            <div
              className="seg tone-b"
              style={{ width: `${(idleMB / ALLOCATED_MB) * 100}%` }}
            />
          </div>
          <div className="seg-legend mono">
            <span>
              <i className="tone-a" /> in use {fmtGB(usedMB)}
            </span>
            <span>
              <i className="tone-b" /> idle {fmtGB(idleMB)}
            </span>
            <span>
              <i className="tone-track" /> free {fmtGB(Math.max(0, ALLOCATED_MB - totalMB))}
            </span>
          </div>
        </div>

        <div className="side-block">
          <div className="section-label">REGISTRIES</div>
          {REGISTRIES.map((r) => (
            <div key={r.name} className="reg-row">
              <div className="reg-id">
                <div className="reg-name mono">{r.name}</div>
                <div className="reg-account mono">{r.account}</div>
              </div>
              <span className={`state-chip mono ${r.connected ? 'is-on' : ''}`}>
                {r.connected ? 'CONNECTED' : 'DISCONNECTED'}
              </span>
            </div>
          ))}
        </div>

        {idleMB > 0 && (
          <div className="callout">
            <div className="callout-title">Reclaim {fmtGB(idleMB)}</div>
            <div className="callout-body mono">
              {unusedCount} image{unusedCount === 1 ? '' : 's'} are not referenced by any
              container. Pruning removes them and their unshared layers.
            </div>
            <button
              type="button"
              className="tool-btn is-primary"
              onClick={() => setConfirmPrune(true)}
            >
              Reclaim {fmtGB(idleMB)}
            </button>
          </div>
        )}
      </aside>

      {runTarget && (
        <RunContainerModal
          defaultRuntime={runTarget.rt}
          defaultImage={runTarget.image}
          onClose={() => setRunTarget(null)}
        />
      )}
      {confirmPrune && (
        <ConfirmDialog
          title="Prune unused images?"
          body={`${unusedCount} unreferenced image${unusedCount === 1 ? '' : 's'} and their unshared layers will be deleted, reclaiming about ${fmtGB(idleMB)}. This cannot be undone.`}
          confirmLabel="Prune"
          onConfirm={pruneImages}
          onClose={() => setConfirmPrune(false)}
        />
      )}
    </div>
  );
}
