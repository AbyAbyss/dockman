// Volumes — storage management: donut breakdown, volume cards, bind mounts
// and a backup heatmap.

import { useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill } from '@/components/ui/Badge';
import { DonutChart } from '@/components/ui/Charts';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { useVolumes } from '@/hooks/useData';
import { VolumeCommands } from '@/lib/commands';
import { RUNTIMES } from '@/data/seed';
import type { RuntimeName } from '@/types';

const DONUT_COLORS = ['var(--accent)', '#e0b265', '#8ab4f8', '#d97757', '#a5b950'];

const BIND_MOUNTS = [
  { host: '~/work/api-platform/src', ctr: 'api-gateway', target: '/app/src', mode: 'rw' },
  { host: '~/work/worker/src', ctr: 'worker-billing', target: '/app/src', mode: 'rw' },
  { host: '/etc/nginx/conf.d', ctr: 'nginx-edge', target: '/etc/nginx/conf.d', mode: 'ro' },
  { host: '/tmp/build-cache', ctr: 'dockman/api-gw build', target: '/var/cache', mode: 'rw' },
];

function sizeToMB(size: string): number {
  const v = parseFloat(size);
  if (Number.isNaN(v)) return 0;
  return size.includes('GB') ? v * 1024 : v;
}

export default function Volumes() {
  const query = useAppStore((s) => s.query);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const accent = ACCENTS[useThemeStore((s) => s.accent)].hex;
  const volumesRes = useVolumes(runtimeFilter);
  const volumes = volumesRes.data;
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  // New volumes land on the active runtime (Docker unless Podman is filtered).
  const createRt: RuntimeName = runtimeFilter === 'podman' ? 'podman' : 'docker';

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

  const filtered = volumes.filter(
    (v) => !query || v.name.toLowerCase().includes(query.toLowerCase()),
  );
  const totalMB = volumes.reduce((s, v) => s + sizeToMB(v.size), 0);
  const unused = volumes.filter((v) => v.attached === '—').length;

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 6' }}>
        <StatTile value={volumes.length} label="Total volumes" section="Local" sectionIcon="volume" tone="violet" />
        <StatTile value={(totalMB / 1024).toFixed(1)} label="Used capacity" section="Storage" sectionIcon="disk" tone="default" suffix=" GB" />
        <StatTile value={unused} label="Unused" section="Reclaim" sectionIcon="trash" tone="warn" suffix="" />
      </div>

      <BentoCard section="Distribution" sectionIcon="disk" title="By Volume" span={6} headerAlign="left">
        <div className="vol-dist">
          <div className="vol-dist-ring">
            <DonutChart
              data={volumes.slice(0, 5).map((v, i) => ({
                label: v.name,
                value: sizeToMB(v.size) || 1,
                color: DONUT_COLORS[i],
              }))}
            />
          </div>
          <div className="vol-dist-legend">
            {volumes.slice(0, 5).map((v, i) => (
              <div key={v.name} className="legend-row">
                <i className="legend-dot" style={{ background: DONUT_COLORS[i] }} />
                <span className="legend-name">{v.name}</span>
                <span className="legend-val mono">{v.size}</span>
              </div>
            ))}
          </div>
        </div>
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
                key={v.name}
                className={`vol-card ${selected === v.name ? 'is-on' : ''}`}
                onClick={() => setSelected(selected === v.name ? null : v.name)}
              >
                <div className="vol-card-h">
                  <span
                    className="vol-card-icon"
                    style={{ background: RUNTIMES[v.rt].soft, color: RUNTIMES[v.rt].accent }}
                  >
                    <Glyph name="volume" size={14} />
                  </span>
                  <div className="vol-card-name">{v.name}</div>
                  <RuntimeBadge rt={v.rt} size="xs" showLabel={false} />
                  {v.attached === '—' ? (
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
                    <div className="vol-fill" style={{ width: `${v.used}%`, background: accent }} />
                  </div>
                  <span className="mono">{v.size}</span>
                </div>
                <div className="vol-card-foot">
                  <span className="mono">{v.driver}</span>
                  <span className="mono">
                    {v.attached !== '—' ? `→ ${v.attached}` : 'no attachments'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </BentoCard>

      <BentoCard section="Mounts" sectionIcon="volume" title="Active Bind Mounts" span={7} headerAlign="left">
        <div className="mount-list">
          {BIND_MOUNTS.map((m, i) => (
            <div key={i} className="mount-row">
              <div className="mount-host mono">{m.host}</div>
              <span className="mount-arrow">→</span>
              <div className="mount-target mono">{m.target}</div>
              <Pill tone={m.mode === 'ro' ? 'warn' : 'ok'}>{m.mode}</Pill>
              <span className="mono mount-ctr">{m.ctr}</span>
            </div>
          ))}
        </div>
      </BentoCard>

      <BentoCard section="Snapshots" sectionIcon="restart" title="Backup" span={5} headerAlign="left">
        <div className="backup-state">
          <div className="backup-h">
            <div>
              <div className="backup-title">Daily snapshots</div>
              <div className="backup-sub mono">Last run · 04:00 local · success</div>
            </div>
            <Pill tone="ok">on</Pill>
          </div>
          <div className="backup-grid">
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className={`backup-cell ${
                  [1, 5, 9].includes(i) ? 'warn' : i < 13 ? 'ok' : 'pending'
                }`}
                title={`day -${13 - i}`}
              />
            ))}
          </div>
          <div className="backup-legend mono">
            <span>
              <i className="ok" /> success 11
            </span>
            <span>
              <i className="warn" /> partial 3
            </span>
            <span>
              <i className="pending" /> upcoming
            </span>
          </div>
          <div className="det-actions">
            <button className="action-btn" type="button">
              <Glyph name="bolt" size={12} /> Run now
            </button>
            <button className="action-btn" type="button">
              Configure
            </button>
          </div>
        </div>
      </BentoCard>
    </div>
  );
}
