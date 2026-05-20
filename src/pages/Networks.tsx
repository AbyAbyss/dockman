// Networks — topology map, bandwidth, port mappings and DNS.

import { useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill, StatusDot } from '@/components/ui/Badge';
import { Sparkline } from '@/components/ui/Charts';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { useNetworks } from '@/hooks/useData';
import { SystemCommands } from '@/lib/commands';
import { NET_SPARK } from '@/data/seed';
import type { Container, Network } from '@/types';

const DNS_RECORDS = [
  { host: 'postgres-main.dockman-backend', ip: '172.20.0.4' },
  { host: 'redis-cache.dockman-backend', ip: '172.20.0.5' },
  { host: 'api-gateway.dockman-edge', ip: '172.21.0.2' },
  { host: 'grafana.observability', ip: '172.22.0.3' },
];

/** SVG topology — containers radiating from a central network node. */
function Topology({
  net,
  containers,
  accent,
}: {
  net: Network;
  containers: Container[];
  accent: string;
}) {
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
    <div className="topo-canvas">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="xMidYMid meet">
        {nodes.map((n, i) => (
          <line
            key={`l-${i}`}
            x1={cx}
            y1={cy}
            x2={n.x}
            y2={n.y}
            stroke={accent}
            strokeOpacity="0.3"
            strokeWidth="1"
            strokeDasharray="3 4"
          />
        ))}
        <circle cx={cx} cy={cy} r="44" fill="var(--accent-soft)" stroke={accent} strokeWidth="1.5" />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill={accent}>
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
              stroke={n.c.status === 'running' ? accent : 'var(--line)'}
              strokeWidth="1"
            />
            <circle
              cx={n.x}
              cy={n.y - 6}
              r="3"
              fill={n.c.status === 'running' ? accent : 'var(--dim)'}
            />
            <text x={n.x} y={n.y + 8} textAnchor="middle" fontSize="9" fill="var(--text)">
              {n.c.name.length > 10 ? `${n.c.name.slice(0, 9)}…` : n.c.name}
            </text>
          </g>
        ))}
      </svg>
      <div className="topo-meta">
        <div className="topo-meta-cell">
          <div className="bc-section">
            <span>Driver</span>
          </div>
          <div className="topo-meta-val">{net.driver}</div>
        </div>
        <div className="topo-meta-cell">
          <div className="bc-section">
            <span>Subnet</span>
          </div>
          <div className="topo-meta-val mono">{net.subnet}</div>
        </div>
        <div className="topo-meta-cell">
          <div className="bc-section">
            <span>Gateway</span>
          </div>
          <div className="topo-meta-val mono">{net.gateway}</div>
        </div>
        <div className="topo-meta-cell">
          <div className="bc-section">
            <span>Attached</span>
          </div>
          <div className="topo-meta-val">{net.attached}</div>
        </div>
      </div>
    </div>
  );
}

export default function Networks() {
  const allContainers = useAppStore((s) => s.containers);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const accent = ACCENTS[useThemeStore((s) => s.accent)].hex;
  const networksRes = useNetworks(runtimeFilter);
  const networks = networksRes.data;
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const containers =
    runtimeFilter === 'all'
      ? allContainers
      : allContainers.filter((c) => c.rt === runtimeFilter);

  const net = networks.find((n) => n.name === selectedName) ?? networks[0];
  const totalAttached = networks.reduce((s, n) => s + n.attached, 0);

  // Map containers onto networks by stack convention.
  const nwToCtrs = (nwName: string): Container[] => {
    if (nwName.includes('backend'))
      return containers
        .filter((c) => ['data-store', 'api-platform'].includes(c.stack))
        .slice(0, 6);
    if (nwName.includes('edge'))
      return containers
        .filter((c) => c.name === 'nginx-edge' || c.name === 'api-gateway')
        .slice(0, 2);
    if (nwName === 'observability')
      return containers.filter((c) => c.stack === 'observability').slice(0, 3);
    return containers.slice(0, 4);
  };

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 6' }}>
        <StatTile value={networks.length} label="Networks" section="Total" sectionIcon="network" tone="violet" />
        <StatTile value={totalAttached} label="Attachments" section="Endpoints" sectionIcon="container" tone="default" />
        <StatTile value="14" label="MB/s aggregate" section="Throughput" sectionIcon="bolt" tone="default" suffix="" />
      </div>

      <BentoCard section="Telemetry" sectionIcon="bolt" title="Bandwidth" span={6} headerAlign="left">
        <div className="bw-row">
          <div className="bw-stat">
            <div className="bw-label mono">INBOUND</div>
            <div className="bw-val">
              10.8<span> MB/s</span>
            </div>
            <Sparkline data={NET_SPARK} w={220} h={40} accent={accent} />
          </div>
          <div className="bw-stat">
            <div className="bw-label mono">OUTBOUND</div>
            <div className="bw-val">
              3.2<span> MB/s</span>
            </div>
            <Sparkline data={[...NET_SPARK].reverse()} w={220} h={40} accent="#e0b265" />
          </div>
        </div>
      </BentoCard>

      <BentoCard section="Topology" sectionIcon="network" title="Map" span={12} headerAlign="left">
        {net ? (
          <>
            <div className="topo-tabs">
              {networks.map((n) => (
                <button
                  key={n.name}
                  type="button"
                  className={`fchip ${net.name === n.name ? 'is-on' : ''}`}
                  onClick={() => setSelectedName(n.name)}
                >
                  {n.name} <span className="mono">{n.attached}</span>
                </button>
              ))}
            </div>
            <Topology net={net} containers={nwToCtrs(net.name)} accent={accent} />
          </>
        ) : (
          <div className="empty">
            <Glyph name="network" size={24} />
            <div>{networksRes.loading ? 'Loading networks…' : 'No networks found.'}</div>
          </div>
        )}
      </BentoCard>

      <BentoCard section="Routing" sectionIcon="network" title="Port Mappings" span={8} headerAlign="left">
        <div className="port-table">
          <div className="port-th">
            <div>Container</div>
            <div>Container Port</div>
            <div>Host Port</div>
            <div>Protocol</div>
            <div>Action</div>
          </div>
          {containers
            .filter((c) => c.port !== '—')
            .slice(0, 7)
            .map((c) => {
              const parts = c.port.split(',')[0].split(':');
              const host = parts[0];
              const cport = parts[1] || parts[0];
              return (
                <div key={c.id} className="port-row">
                  <div className="port-ctr">
                    <StatusDot status={c.status} /> {c.name}
                  </div>
                  <div className="mono">{cport}</div>
                  <div className="mono">localhost:{host}</div>
                  <Pill tone="ok">tcp</Pill>
                  <button
                    className="text-btn"
                    type="button"
                    onClick={() =>
                      SystemCommands.openUrl(`http://localhost:${host}`).catch(
                        () => undefined,
                      )
                    }
                  >
                    open ↗
                  </button>
                </div>
              );
            })}
        </div>
      </BentoCard>

      <BentoCard section="Resolution" sectionIcon="network" title="DNS" span={4} headerAlign="left">
        <div className="dns-list">
          {DNS_RECORDS.map((d) => (
            <div key={d.host} className="dns-row">
              <div className="dns-host mono">{d.host}</div>
              <span className="dns-ip mono">{d.ip}</span>
            </div>
          ))}
        </div>
        <div className="det-actions">
          <button className="action-btn" type="button">
            <Glyph name="restart" size={12} /> Flush DNS
          </button>
        </div>
      </BentoCard>
    </div>
  );
}
