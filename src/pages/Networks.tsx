// Networks — table, full-width topology map, port mappings and DNS, beside a
// bandwidth pane. The topology geometry is unchanged from the previous build.

import { useMemo, useState } from 'react';
import { Glyph } from '@/components/ui/Icon';
import { useAppStore } from '@/store/appStore';
import { useNetworks } from '@/hooks/useData';
import { SystemCommands } from '@/lib/commands';
import { NET_SPARK, RUNTIMES } from '@/data/seed';
import type { Container, Network } from '@/types';

/** Resolver entries — the CLI has no command for these yet. */
const DNS_RECORDS = [
  { host: 'postgres-main.dockman-backend', ip: '172.20.0.4' },
  { host: 'redis-cache.dockman-backend', ip: '172.20.0.5' },
  { host: 'api-gateway.dockman-edge', ip: '172.21.0.2' },
  { host: 'grafana.observability', ip: '172.22.0.3' },
];

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
  const networks = useNetworks(runtimeFilter).data;

  const [flushed, setFlushed] = useState(false);

  const visible = useMemo(
    () =>
      runtimeFilter === 'all'
        ? containers
        : containers.filter((c) => c.rt === runtimeFilter),
    [containers, runtimeFilter],
  );

  const active =
    networks.find((n) => n.name === selectedNetwork) ?? networks[0] ?? null;

  // Membership convention carried over from the previous build.
  const membersOf = (nwName: string): Container[] => {
    if (nwName.includes('backend'))
      return visible
        .filter((c) => ['data-store', 'api-platform'].includes(c.stack))
        .slice(0, 6);
    if (nwName.includes('edge'))
      return visible
        .filter((c) => c.name === 'nginx-edge' || c.name === 'api-gateway')
        .slice(0, 2);
    if (nwName === 'observability')
      return visible.filter((c) => c.stack === 'observability').slice(0, 3);
    return visible.slice(0, 4);
  };

  const members = active ? membersOf(active.name) : [];
  const totalAttached = networks.reduce((s, n) => s + n.attached, 0);

  const scopeOf = (n: Network) =>
    n.ext ? 'external' : n.driver === 'host' ? 'host' : n.name.includes('default') ? 'default' : 'internal';

  const published = visible.filter((c) => c.port && c.port !== '—');

  return (
    <div className="split-screen">
      <div className="split-main split-scroll">
        <div className="ctr-toolbar">
          <span className="toolbar-note mono">
            {networks.length} networks · {totalAttached} attachments · 14 MB/s aggregate
          </span>
          <div className="ctr-tools">
            <button
              type="button"
              className="tool-btn"
              onClick={() => {
                setFlushed(true);
                window.setTimeout(() => setFlushed(false), 1600);
              }}
            >
              <Glyph name="restart" size={12} sw={1.8} />
              {flushed ? 'DNS flushed' : 'Flush DNS'}
            </button>
            <button type="button" className="tool-btn is-primary">
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
                  title={n.rt}
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
                    const parts = c.port.split(',')[0].split(':');
                    const host = parts[0];
                    const cport = parts[1] || parts[0];
                    return (
                      <div key={c.id} className="port-row">
                        <span className={`ctr-dot st-${c.status}`} />
                        <span className="port-ctr">{c.name}</span>
                        <span className="port-map mono">
                          {host} → {cport}
                        </span>
                        <span className="proto-chip mono">TCP</span>
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

              <div className="card">
                <div className="card-title">DNS resolution</div>
                <div className="dns-list">
                  {DNS_RECORDS.map((d) => (
                    <div key={d.host} className="dns-row">
                      <span className="dns-host mono">{d.host}</span>
                      <span className="dns-ip mono">{d.ip}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <aside className="side-pane">
        <div className="side-block">
          <div className="section-label">BANDWIDTH</div>
          <div className="bw-row">
            <div className="bw-stat">
              <div className="bw-label mono">INBOUND</div>
              <div className="bw-val">
                10.8<span className="mono"> MB/s</span>
              </div>
            </div>
            <div className="bw-stat">
              <div className="bw-label mono">OUTBOUND</div>
              <div className="bw-val">
                3.2<span className="mono"> MB/s</span>
              </div>
            </div>
          </div>
          <div className="spark" style={{ height: 52 }}>
            {NET_SPARK.map((v, i) => (
              <div
                key={i}
                className="spark-bar"
                style={{ height: `${Math.max(6, (v / Math.max(...NET_SPARK)) * 100)}%` }}
              />
            ))}
          </div>
        </div>

        {active && (
          <div className="side-block">
            <div className="section-label">ATTACHED TO {active.name}</div>
            {members.length === 0 && <div className="det-empty mono">no attachments</div>}
            {members.map((c, i) => (
              <div key={c.id} className="att-row">
                <span className={`ctr-dot st-${c.status}`} />
                <span className="att-name">{c.name}</span>
                <span className="att-ip mono">
                  {active.subnet.replace(/0\/\d+$/, String(i + 2))}
                </span>
              </div>
            ))}
          </div>
        )}
      </aside>
    </div>
  );
}
