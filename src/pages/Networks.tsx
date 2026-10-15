// Networks — table, full-width topology map, port mappings and DNS, beside a
// bandwidth pane. The topology geometry is unchanged from the previous build.

import { useMemo, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { useAppStore } from '@/store/appStore';
import { useNetworks } from '@/hooks/useData';
import { NetworkCommands, SystemCommands } from '@/lib/commands';
import { splitPorts } from '@/lib/parsers';
import { RUNTIMES } from '@/data/seed';
import type { Container, Network } from '@/types';

/** SVG topology — containers radiating from a central network node. */
function Topology({ net, containers }: { net: Network; containers: Container[] }) {
  const W = 760;
  const H = 280;
  const cx = W / 2;
  const cy = H / 2;
  const r = Math.min(100, 30 + containers.length * 8);

  const nodes = containers.map((c, i) => {
    const angle = (i / Math.max(containers.length, 1)) * 2 * Math.PI - Math.PI / 2;
    return {
      c,
      x: cx + Math.cos(angle) * r * 1.6,
      y: cy + Math.sin(angle) * r * 1.0,
    };
  });

  return (
    <svg
      className="topo-svg"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      preserveAspectRatio="xMidYMid meet"
    >
      {nodes.map((n, i) => (
        <line
          key={`l-${i}`}
          x1={cx}
          y1={cy}
          x2={n.x}
          y2={n.y}
          stroke="var(--accent)"
          strokeOpacity="0.3"
          strokeWidth="1"
          strokeDasharray="3 4"
        />
      ))}
      <circle
        cx={cx}
        cy={cy}
        r="44"
        fill="var(--accent-soft)"
        stroke="var(--accent)"
        strokeWidth="1.5"
      />
      <text
        x={cx}
        y={cy - 4}
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill="var(--accent)"
      >
        {net.name}
      </text>
      <text
        x={cx}
        y={cy + 12}
        textAnchor="middle"
        fontSize="9.5"
        fill="var(--dim)"
        fontFamily="var(--mono)"
      >
        {net.subnet}
      </text>
      {nodes.map((n, i) => (
        <g key={i}>
          <circle
            cx={n.x}
            cy={n.y}
            r="22"
            fill="var(--bg)"
            stroke={n.c.status === 'running' ? 'var(--accent)' : 'var(--line)'}
            strokeWidth="1"
          />
          <circle
            cx={n.x}
            cy={n.y - 6}
            r="3"
            fill={n.c.status === 'running' ? 'var(--accent)' : 'var(--dim)'}
          />
          <text x={n.x} y={n.y + 8} textAnchor="middle" fontSize="9" fill="var(--text)">
            {n.c.name.length > 10 ? `${n.c.name.slice(0, 9)}…` : n.c.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

export default function Networks() {
  const containers = useAppStore((s) => s.containers);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const selectedNetwork = useAppStore((s) => s.selectedNetwork);
  const setSelectedNetwork = useAppStore((s) => s.setSelectedNetwork);
  const networksRes = useNetworks(runtimeFilter);
  const listed = networksRes.data;

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const reportError = useAppStore((s) => s.reportError);

  const createNetwork = () => {
    const name = newName.trim();
    if (!name) return;
    NetworkCommands.create(runtimeFilter === 'podman' ? 'podman' : 'docker', name)
      .then(() => networksRes.refetch())
      .catch(reportError);
    setNewName('');
    setCreating(false);
  };

  const visible = useMemo(
    () =>
      runtimeFilter === 'all'
        ? containers
        : containers.filter((c) => c.rt === runtimeFilter),
    [containers, runtimeFilter],
  );

  const membersOf = (nw: Network): Container[] =>
    visible.filter((c) => c.rt === nw.rt && c.networks.includes(nw.name));
  const networks = listed.map((n) => ({ ...n, attached: membersOf(n).length }));

  const active =
    networks.find((n) => n.name === selectedNetwork) ?? networks[0] ?? null;
  const members = active ? membersOf(active) : [];
  const totalAttached = networks.reduce((s, n) => s + n.attached, 0);

  const scopeOf = (n: Network) =>
    n.ext ? 'external' : n.driver === 'host' ? 'host' : n.name.includes('default') ? 'default' : 'internal';

  const published = visible.filter((c) => splitPorts(c.port).some((p) => p.host));

  return (
    <div className="split-screen">
      <div className="split-main split-scroll">
        <div className="ctr-toolbar">
          {creating ? (
            <div className="tag-form">
              <input
                className="field mono"
                autoFocus
                placeholder="network name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') createNetwork();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
              <button type="button" className="tool-btn is-primary" onClick={createNetwork}>
                Create
              </button>
            </div>
          ) : (
            <span className="toolbar-note mono">
              {networks.length} networks · {totalAttached} attachments
            </span>
          )}
          <div className="ctr-tools">
            <button
              type="button"
              className="tool-btn is-primary"
              onClick={() => setCreating(true)}
            >
              <Glyph name="plus" size={12} sw={2} />
              New network
            </button>
          </div>
        </div>

        <div className="ctr-thead net-cols mono">
          <span className="col-nname">NAME</span>
          <span className="col-ndriver">DRIVER</span>
          <span className="col-subnet">SUBNET</span>
          <span className="col-gateway">GATEWAY</span>
          <span className="col-nattached">ATTACHED</span>
          <span className="col-nscope">SCOPE</span>
        </div>

        <div className="net-table">
          {networks.map((n) => (
            <div
              key={`${n.rt}-${n.name}`}
              className={`net-row net-cols ${active?.name === n.name ? 'is-focused' : ''}`}
              onClick={() => setSelectedNetwork(n.name)}
            >
              <div className="col-nname">
                <span className="ctr-dot st-running" />
                <span className="net-name mono">{n.name}</span>
                <span
                  className="ctr-rt"
                  title={n.root ? `${n.rt} · root store` : n.rt}
                  style={{ background: RUNTIMES[n.rt]?.accent }}
                />
                <span className="scope-badge mono">{scopeOf(n)}</span>
              </div>
              <span className="col-ndriver mono">{n.driver}</span>
              <span className="col-subnet mono">{n.subnet}</span>
              <span className="col-gateway mono">{n.gateway}</span>
              <span className="col-nattached mono">{n.attached}</span>
              <span className="col-nscope mono">{n.scope}</span>
            </div>
          ))}
        </div>

        {active && (
          <div className="screen-pad">
            <div className="card topo-card">
              <div className="ov-card-head">
                <span className="card-title">Topology</span>
                <div className="net-tabs">
                  {networks.map((n) => (
                    <button
                      key={n.name}
                      type="button"
                      className={`net-tab mono ${active.name === n.name ? 'is-on' : ''}`}
                      onClick={() => setSelectedNetwork(n.name)}
                    >
                      {n.name}
                      <span className="net-tab-n">{n.attached}</span>
                    </button>
                  ))}
                </div>
              </div>
              <Topology net={active} containers={members} />
              <div className="topo-meta">
                {[
                  { k: 'DRIVER', v: active.driver },
                  { k: 'SUBNET', v: active.subnet },
                  { k: 'GATEWAY', v: active.gateway },
                  { k: 'ATTACHED', v: String(active.attached) },
                ].map((m) => (
                  <div key={m.k} className="topo-meta-cell">
                    <div className="section-label">{m.k}</div>
                    <div className="topo-meta-val mono">{m.v}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="net-bottom">
              <div className="card">
                <div className="card-title">Port mappings</div>
                <div className="port-list">
                  {published.length === 0 && (
                    <div className="det-empty mono">no published ports</div>
                  )}
                  {published.map((c) => {
                    const b = splitPorts(c.port).find((p) => p.host)!;
                    const host = b.host;
                    const cport = b.container;
                    return (
                      <div key={c.id} className="port-row">
                        <span className={`ctr-dot st-${c.status}`} />
                        <span className="port-ctr">{c.name}</span>
                        <span className="port-map mono">
                          {host} → {cport}
                        </span>
                        <span className="proto-chip mono">{b.proto.toUpperCase()}</span>
                        <button
                          type="button"
                          className="text-btn"
                          onClick={() =>
                            SystemCommands.openUrl(`http://localhost:${host}`).catch(
                              () => undefined,
                            )
                          }
                        >
                          open
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="side-pane">
        {active && (
          <div className="side-block">
            <div className="section-label">ATTACHED TO {active.name}</div>
            {members.length === 0 && <div className="det-empty mono">no attachments</div>}
            {members.map((c) => (
              <div key={c.id} className="att-row">
                <span className={`ctr-dot st-${c.status}`} />
                <span className="att-name">{c.name}</span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
