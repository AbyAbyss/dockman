// Volumes — storage inventory with usage tracks, beside a pane carrying bind
// mounts and the snapshot schedule.

import { useMemo, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useAppStore } from '@/store/appStore';
import { useVolumes } from '@/hooks/useData';
import { VolumeCommands } from '@/lib/commands';
import { RUNTIMES } from '@/data/seed';
import type { RuntimeName } from '@/types';

/** Bind mounts are read off compose files the app does not parse yet. */
const BIND_MOUNTS = [
  { host: '~/work/api-platform/src', ctr: 'api-gateway', target: '/app/src', mode: 'RW' },
  { host: '~/work/worker/src', ctr: 'worker-billing', target: '/app/src', mode: 'RW' },
  { host: '/etc/nginx/conf.d', ctr: 'nginx-edge', target: '/etc/nginx/conf.d', mode: 'RO' },
  { host: '/tmp/build-cache', ctr: 'dockman/api-gw build', target: '/var/cache', mode: 'RW' },
];

/** Snapshot history — presentational; there is no snapshot command yet. */
const SNAPSHOTS = [
  'ok', 'ok', 'ok', 'part', 'ok', 'ok', 'ok',
  'part', 'ok', 'ok', 'ok', 'part', 'ok', 'next',
] as const;

function sizeToMB(size: string): number {
  const v = parseFloat(size);
  if (Number.isNaN(v)) return 0;
  return size.includes('GB') ? v * 1024 : v;
}

function fmtGB(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

export default function Volumes() {
  const query = useAppStore((s) => s.query);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const volumesRes = useVolumes(runtimeFilter);
  const volumes = volumesRes.data;
  const loading = volumesRes.loading;

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [confirmPrune, setConfirmPrune] = useState(false);

  const createRt: RuntimeName = runtimeFilter === 'podman' ? 'podman' : 'docker';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? volumes.filter((v) => (v.name + v.mount).toLowerCase().includes(q))
      : volumes;
  }, [volumes, query]);

  const totalMB = volumes.reduce((s, v) => s + sizeToMB(v.size), 0);
  const unattached = volumes.filter((v) => !v.attached || v.attached === '—');
  const maxMB = Math.max(1, ...volumes.map((v) => sizeToMB(v.size)));

  const createVolume = () => {
    const name = newName.trim();
    if (!name) return;
    VolumeCommands.create(createRt, name)
      .then(() => volumesRes.refetch())
      .catch(() => undefined);
    setNewName('');
    setCreating(false);
  };

  const deleteVolume = (rt: RuntimeName, name: string) => {
    VolumeCommands.remove(rt, name)
      .then(() => volumesRes.refetch())
      .catch(() => undefined);
  };

  const pruneVolumes = () => {
    VolumeCommands.prune(createRt)
      .then(() => volumesRes.refetch())
      .catch(() => undefined);
  };

  const snapOk = SNAPSHOTS.filter((s) => s === 'ok').length;
  const snapPart = SNAPSHOTS.filter((s) => s === 'part').length;

  return (
    <div className="split-screen">
      <div className="split-main">
        <div className="ctr-toolbar">
          {creating ? (
            <div className="tag-form">
              <input
                className="field mono"
                autoFocus
                placeholder="volume name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createVolume();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
              <button type="button" className="tool-btn is-primary" onClick={createVolume}>
                Create
              </button>
            </div>
          ) : (
            <span className="toolbar-note mono">
              {fmtGB(totalMB)} across {volumes.length} volumes · {unattached.length}{' '}
              unattached
            </span>
          )}

          <div className="ctr-tools">
            <button
              type="button"
              className="tool-btn is-danger"
              disabled={unattached.length === 0}
              onClick={() => setConfirmPrune(true)}
            >
              <Glyph name="trash" size={12} />
              Prune unattached
            </button>
            <button
              type="button"
              className="tool-btn is-primary"
              onClick={() => setCreating(true)}
            >
              <Glyph name="plus" size={12} sw={2} />
              New volume
            </button>
          </div>
        </div>

        <div className="ctr-thead vol-cols mono">
          <span className="col-vname">NAME</span>
          <span className="col-mount">MOUNT POINT</span>
          <span className="col-driver">DRIVER</span>
          <span className="col-att">ATTACHED TO</span>
          <span className="col-vsize">SIZE</span>
          <span className="col-created">CREATED</span>
          <span className="col-vact">ACT</span>
        </div>

        <div className="ctr-body">
          {filtered.length === 0 && loading && (
            <SkeletonRows rows={7} variant="volume" />
          )}
          {filtered.length === 0 && !loading && (
            <div className="empty">
              <Glyph name="volume" size={24} />
              <div>
                {volumes.length === 0
                  ? 'No volumes yet.'
                  : 'No volumes match this search.'}
              </div>
            </div>
          )}
          {filtered.map((v) => {
            const idle = !v.attached || v.attached === '—';
            return (
              <div key={`${v.rt}-${v.name}`} className="vol-row vol-cols">
                <div className="col-vname">
                  <span className={`ctr-dot ${idle ? 'st-stopped' : 'st-running'}`} />
                  <span className="vol-name mono">{v.name}</span>
                  <span
                    className="ctr-rt"
                    title={v.rt}
                    style={{ background: RUNTIMES[v.rt]?.accent }}
                  />
                </div>
                <span className="col-mount mono">{v.mount}</span>
                <span className="col-driver mono">{v.driver}</span>
                <span className={`col-att mono ${idle ? 'is-idle' : ''}`}>
                  {idle ? '—' : v.attached}
                </span>
                <div className="col-vsize">
                  <div className="vol-track">
                    <div
                      className={`vol-fill ${idle ? 'is-idle' : ''}`}
                      style={{ width: `${(sizeToMB(v.size) / maxMB) * 100}%` }}
                    />
                  </div>
                  <span className="vol-size mono">{v.size}</span>
                </div>
                <span className="col-created mono">{v.created}</span>
                <div className="col-vact">
                  <button
                    type="button"
                    className="row-btn is-danger"
                    title="Remove volume"
                    onClick={() => deleteVolume(v.rt, v.name)}
                  >
                    <Glyph name="trash" size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <aside className="side-pane">
        <div className="side-block">
          <div className="section-label">BIND MOUNTS</div>
          {BIND_MOUNTS.map((m) => (
            <div key={m.host} className="det-mount">
              <div className="det-mount-head">
                <span className="det-mount-src mono">{m.host}</span>
                <span className={`det-mount-mode mono ${m.mode === 'RO' ? 'is-ro' : ''}`}>
                  {m.mode}
                </span>
              </div>
              <div className="det-mount-sub mono">
                → {m.target} · {m.ctr}
              </div>
            </div>
          ))}
        </div>

        <div className="side-block">
          <div className="snap-head">
            <span className="section-label">DAILY SNAPSHOTS</span>
            <span className="state-chip mono is-on">ON</span>
          </div>
          <div className="side-sub mono">last run 04:00 local · success</div>
          <div className="snap-strip">
            {SNAPSHOTS.map((s, i) => (
              <div key={i} className={`snap-cell tone-${s}`} />
            ))}
          </div>
          <div className="seg-legend mono">
            <span>
              <i className="tone-a" /> success {snapOk}
            </span>
            <span>
              <i className="tone-c" /> partial {snapPart}
            </span>
          </div>
          <div className="side-actions">
            <button type="button" className="det-action is-accent">
              Run now
            </button>
            <button type="button" className="det-action">
              Configure
            </button>
          </div>
        </div>
      </aside>

      {confirmPrune && (
        <ConfirmDialog
          title="Prune unattached volumes?"
          body={`${unattached.length} volume${unattached.length === 1 ? '' : 's'} not attached to any container will be deleted, along with the data inside them. This cannot be undone.`}
          confirmLabel="Prune"
          onConfirm={pruneVolumes}
          onClose={() => setConfirmPrune(false)}
        />
      )}
    </div>
  );
}
