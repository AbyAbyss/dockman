// Volumes — inventory with sizes from `system df`, attachments and bind
// mounts from container inspection, and the volume storage summary.

import { useMemo, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Badge';
import { DonutChart } from '@/components/ui/Charts';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { logActivity } from '@/store/activityStore';
import { useContainerDetails, useSystemDf, useVolumeUsage, useVolumes } from '@/hooks/useData';
import { VolumeCommands, runtimesFor } from '@/lib/commands';
import { formatBytes } from '@/lib/parsers';
import { RUNTIME_BRAND } from '@/data/runtimes';
import type { RuntimeName, Volume } from '@/types';

const DONUT_COLORS = ['var(--accent)', '#e0b265', '#8ab4f8', '#d97757', '#a5b950'];

export default function Volumes() {
  const query = useAppStore((s) => s.query);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const accent = ACCENTS[useThemeStore((s) => s.accent)].hex;
  const volumesRes = useVolumes(runtimeFilter);
  const usage = useVolumeUsage(runtimeFilter);
  const details = useContainerDetails(runtimeFilter);
  const df = useSystemDf(runtimeFilter);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [msg, setMsg] = useState<string | null>(null);

  const refetchAll = () => {
    volumesRes.refetch();
    usage.refetch();
    details.refetch();
    df.refetch();
  };

  // Join the three sources: `volume ls` for identity, `system df -v` for
  // size, container mounts for who uses it.
  const volumes: Volume[] = useMemo(() => {
    return volumesRes.data.map((v) => {
      const u = usage.data.find((x) => x.rt === v.rt && x.name === v.name);
      const attachedTo = details.data
        .filter((c) => c.rt === v.rt && c.mounts.some((m) => m.kind === 'volume' && m.name === v.name))
        .map((c) => c.name);
      return {
        ...v,
        sizeBytes: u?.sizeBytes ?? 0,
        size: u ? formatBytes(u.sizeBytes) : '—',
        attachedTo,
      };
    });
  }, [volumesRes.data, usage.data, details.data]);

  const bindMounts = useMemo(
    () =>
      details.data.flatMap((c) =>
        c.mounts
          .filter((m) => m.kind === 'bind')
          .map((m) => ({ ...m, container: c.name, rt: c.rt, status: c.status })),
      ),
    [details.data],
  );

  // New volumes land on the active runtime (Docker unless Podman is filtered).
  const createRt: RuntimeName = runtimeFilter === 'podman' ? 'podman' : 'docker';

  const createVolume = () => {
    const name = newName.trim();
    if (!name) return;
    VolumeCommands.create(createRt, name)
      .then(() => {
        setMsg(`Created ${name} on ${createRt}`);
        refetchAll();
      })
      .catch((e) => setMsg(String(e)));
    setNewName('');
    setCreating(false);
  };

  const deleteVolume = (rt: RuntimeName, name: string) => {
    VolumeCommands.remove(rt, name)
      .then(() => {
        setMsg(`Removed ${name}`);
        logActivity('remove', rt, name, 'volume');
        refetchAll();
      })
      .catch((e) => setMsg(String(e)));
  };

  const pruneVolumes = () => {
    for (const rt of runtimesFor(runtimeFilter)) {
      VolumeCommands.prune(rt)
        .then((out) => {
          const line = out.split('\n').find((l) => l.toLowerCase().includes('reclaimed')) ?? 'done';
          setMsg(`${rt}: ${line.trim()}`);
          logActivity('prune', rt, 'volumes', line.trim());
          refetchAll();
        })
        .catch((e) => setMsg(`${rt}: ${String(e)}`));
    }
  };

  const filtered = volumes.filter(
    (v) => !query || v.name.toLowerCase().includes(query.toLowerCase()),
  );
  const totalBytes = volumes.reduce((s, v) => s + v.sizeBytes, 0);
  const unused = volumes.filter((v) => v.attachedTo.length === 0).length;
  const largest = [...volumes].sort((a, b) => b.sizeBytes - a.sizeBytes).slice(0, 5);
  const dfVolumes = df.data.filter((r) => r.kind === 'volumes');
  const reclaimable = dfVolumes.reduce((s, r) => s + r.reclaimableBytes, 0);

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 6' }}>
        <StatTile value={volumes.length} label="Total volumes" section="Local" sectionIcon="volume" tone="violet" />
        <StatTile value={formatBytes(totalBytes)} label="On disk" section="Storage" sectionIcon="disk" tone="default" suffix="" />
        <StatTile value={unused} label="Unused" section="Reclaim" sectionIcon="trash" tone="warn" suffix="" />
      </div>

      <BentoCard section="Distribution" sectionIcon="disk" title="Largest volumes" span={6} headerAlign="left">
        {largest.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="disk" size={20} />
            <div>No volumes to chart.</div>
          </div>
        ) : (
          <div className="vol-dist">
            <div className="vol-dist-ring">
              <DonutChart
                data={largest.map((v, i) => ({
                  label: v.name,
                  value: v.sizeBytes || 1,
                  color: DONUT_COLORS[i],
                }))}
              />
            </div>
            <div className="vol-dist-legend">
              {largest.map((v, i) => (
                <div key={v.rt + v.name} className="legend-row">
                  <i className="legend-dot" style={{ background: DONUT_COLORS[i] }} />
                  <span className="legend-name">{v.name}</span>
                  <span className="legend-val mono">{v.size}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </BentoCard>

      <BentoCard
        section="Inventory"
        sectionIcon="volume"
        title={`Volumes · ${filtered.length}`}
        span={12}
        headerAlign="left"
        headerAside={
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="action-btn" type="button" onClick={pruneVolumes}>
              <Glyph name="trash" size={12} /> Prune
            </button>
            <button
              className="action-btn primary"
              type="button"
              onClick={() => setCreating((v) => !v)}
            >
              <Glyph name="plus" size={12} /> New volume
            </button>
          </div>
        }
      >
        {msg && <div className="rcm-note mono" style={{ marginBottom: 10 }}>{msg}</div>}
        {creating && (
          <div className="pull-form">
            <div className="pull-input">
              <Glyph name="volume" size={13} />
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createVolume();
                }}
                placeholder={`volume name · creates on ${createRt}`}
                autoFocus
              />
            </div>
            <button className="action-btn primary" type="button" onClick={createVolume}>
              Create
            </button>
            <button className="action-btn" type="button" onClick={() => setCreating(false)}>
              Cancel
            </button>
          </div>
        )}
        {filtered.length === 0 ? (
          <div className="empty">
            <Glyph name="volume" size={24} />
            <div>{volumesRes.loading ? 'Loading volumes…' : 'No volumes found.'}</div>
          </div>
        ) : (
          <div className="vol-grid">
            {filtered.map((v) => (
              <div
                key={v.rt + v.name}
                className={`vol-card ${selected === v.name ? 'is-on' : ''}`}
                onClick={() => setSelected(selected === v.name ? null : v.name)}
              >
                <div className="vol-card-h">
                  <span
                    className="vol-card-icon"
                    style={{ background: RUNTIME_BRAND[v.rt].soft, color: RUNTIME_BRAND[v.rt].accent }}
                  >
                    <Glyph name="volume" size={14} />
                  </span>
                  <div className="vol-card-name">{v.name}</div>
                  <RuntimeBadge rt={v.rt} size="xs" showLabel={false} />
                  {v.attachedTo.length === 0 ? (
                    <Pill tone="dim">unused</Pill>
                  ) : (
                    <Pill tone="ok">attached</Pill>
                  )}
                  <button
                    className="iconbtn danger"
                    type="button"
                    title="Remove volume"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteVolume(v.rt, v.name);
                    }}
                  >
                    <Glyph name="trash" size={12} />
                  </button>
                </div>
                <div className="vol-card-mount mono">{v.mount}</div>
                <div className="vol-card-bar">
                  <div className="vol-bar">
                    <div
                      className="vol-fill"
                      style={{
                        width: `${totalBytes ? (v.sizeBytes / totalBytes) * 100 : 0}%`,
                        background: accent,
                      }}
                    />
                  </div>
                  <span className="mono">{v.size}</span>
                </div>
                <div className="vol-card-foot">
                  <span className="mono">{v.driver}</span>
                  <span className="mono">
                    {v.attachedTo.length ? `→ ${v.attachedTo.join(', ')}` : 'no attachments'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </BentoCard>

      <BentoCard section="Mounts" sectionIcon="volume" title="Bind Mounts" span={7} headerAlign="left">
        {bindMounts.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="volume" size={20} />
            <div>{details.loading ? 'Inspecting containers…' : 'No container mounts a host path.'}</div>
          </div>
        ) : (
          <div className="mount-list">
            {bindMounts.map((m, i) => (
              <div key={i} className="mount-row">
                <div className="mount-host mono" title={m.source}>{m.source}</div>
                <span className="mount-arrow">→</span>
                <div className="mount-target mono">{m.destination}</div>
                <Pill tone={m.rw ? 'ok' : 'warn'}>{m.rw ? 'rw' : 'ro'}</Pill>
                <span className="mono mount-ctr" title={m.status}>{m.container}</span>
              </div>
            ))}
          </div>
        )}
      </BentoCard>

      <BentoCard section="Storage" sectionIcon="disk" title="Volume storage" span={5} headerAlign="left">
        {dfVolumes.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="disk" size={20} />
            <div>{df.loading ? 'Reading system df…' : 'Engine not reachable.'}</div>
          </div>
        ) : (
          <div className="storage-rows">
            {dfVolumes.map((r) => (
              <div key={r.rt} className="storage-row">
                <span>
                  <RuntimeBadge rt={r.rt} size="xs" /> {r.total} volumes · {r.active} in use
                </span>
                <span className="mono">{formatBytes(r.sizeBytes)}</span>
                <span className="mono">{formatBytes(r.reclaimableBytes)} reclaimable</span>
              </div>
            ))}
            <div className="det-actions">
              <button className="action-btn" type="button" onClick={pruneVolumes} disabled={reclaimable === 0 && unused === 0}>
                <Glyph name="trash" size={12} /> Prune unused volumes
              </button>
            </div>
          </div>
        )}
      </BentoCard>
    </div>
  );
}
