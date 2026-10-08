// Networks — topology from the container inventory, traffic rates from
// `stats` NetIO deltas, port mappings from `ps`, addresses from inspect.

import { useMemo, useState } from 'react';
import { BentoCard } from '@/components/ui/BentoCard';
import { StatTile } from '@/components/ui/StatTile';
import { Glyph } from '@/components/ui/Icon';
import { Pill, StatusDot } from '@/components/ui/Badge';
import { Sparkline } from '@/components/ui/Charts';
import { RuntimeBadge } from '@/components/ui/Runtime';
import { useAppStore } from '@/store/appStore';
import { ACCENTS, useThemeStore } from '@/store/themeStore';
import { useContainerDetails, useNetworks } from '@/hooks/useData';
import { SystemCommands } from '@/lib/commands';
import { formatBytes } from '@/lib/parsers';
import type { Container, Network } from '@/types';

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
        {nodes.length === 0 && (
          <text x={cx} y={cy + 70} textAnchor="middle" fontSize="10" fill="var(--dim)">
            no containers attached
          </text>
        )}
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

function rate(bps: number): string {
  return `${formatBytes(bps)}/s`;
}

export default function Networks() {
  const allContainers = useAppStore((s) => s.containers);
  const history = useAppStore((s) => s.history);
  const runtimeFilter = useAppStore((s) => s.runtimeFilter);
  const accent = ACCENTS[useThemeStore((s) => s.accent)].hex;
  const networksRes = useNetworks(runtimeFilter);
  const details = useContainerDetails(runtimeFilter, 15000);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const containers =
    runtimeFilter === 'all'
      ? allContainers
      : allContainers.filter((c) => c.rt === runtimeFilter);

  const networks = useMemo(
    () =>
      networksRes.data.map((n) => ({
        ...n,
        attached: containers.filter((c) => c.rt === n.rt && c.networks.includes(n.name)).length,
      })),
    [networksRes.data, containers],
  );

  const key = (n: Network) => `${n.rt}/${n.name}`;
  const net = networks.find((n) => key(n) === selectedKey) ?? networks[0];
  const totalAttached = networks.reduce((s, n) => s + n.attached, 0);
  const members = net
    ? containers.filter((c) => c.rt === net.rt && c.networks.includes(net.name))
    : [];

  const latest = history[history.length - 1];
  const inSeries = history.length ? history.map((s) => s.netIn) : [0];
  const outSeries = history.length ? history.map((s) => s.netOut) : [0];
  const pad = (a: number[]) => (a.length < 2 ? [a[0] ?? 0, a[0] ?? 0] : a);

  const addresses = details.data
    .flatMap((c) =>
      c.networks
        .filter((n) => n.ip)
        .map((n) => ({ container: c.name, rt: c.rt, network: n.network, ip: n.ip, status: c.status })),
    )
    .sort((a, b) => a.network.localeCompare(b.network) || a.container.localeCompare(b.container));

  const portRows = containers.flatMap((c) => c.ports.map((p) => ({ c, p })));

  return (
    <div className="bento">
      <div className="stat-trio" style={{ gridColumn: 'span 6' }}>
        <StatTile value={networks.length} label="Networks" section="Total" sectionIcon="network" tone="violet" />
        <StatTile value={totalAttached} label="Attachments" section="Endpoints" sectionIcon="container" tone="default" />
        <StatTile
          value={latest ? rate(latest.netIn + latest.netOut) : '—'}
          label="aggregate now"
          section="Throughput"
          sectionIcon="bolt"
          tone="default"
          suffix=""
        />
      </div>

      <BentoCard section="Telemetry" sectionIcon="bolt" title="Traffic" span={6} headerAlign="left">
        <div className="bw-row">
          <div className="bw-stat">
            <div className="bw-label mono">RECEIVED</div>
            <div className="bw-val">{latest ? rate(latest.netIn) : '—'}</div>
            <Sparkline data={pad(inSeries)} w={220} h={40} accent={accent} />
          </div>
          <div className="bw-stat">
            <div className="bw-label mono">SENT</div>
            <div className="bw-val">{latest ? rate(latest.netOut) : '—'}</div>
            <Sparkline data={pad(outSeries)} w={220} h={40} accent="#e0b265" />
          </div>
        </div>
        <div className="pull-meta mono">
          sum over running containers, from `stats` NetIO sampled every 5 s
        </div>
      </BentoCard>

      <BentoCard section="Topology" sectionIcon="network" title="Map" span={12} headerAlign="left">
        {net ? (
          <>
            <div className="topo-tabs">
              {networks.map((n) => (
                <button
                  key={key(n)}
                  type="button"
                  className={`fchip ${key(net) === key(n) ? 'is-on' : ''}`}
                  onClick={() => setSelectedKey(key(n))}
                >
                  <RuntimeBadge rt={n.rt} size="xs" showLabel={false} /> {n.name}{' '}
                  <span className="mono">{n.attached}</span>
                </button>
              ))}
            </div>
            <Topology net={net} containers={members} accent={accent} />
          </>
        ) : (
          <div className="empty">
            <Glyph name="network" size={24} />
            <div>{networksRes.loading ? 'Loading networks…' : 'No networks found.'}</div>
          </div>
        )}
      </BentoCard>

      <BentoCard section="Routing" sectionIcon="network" title="Port Mappings" span={8} headerAlign="left">
        {portRows.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="network" size={20} />
            <div>No container publishes a port.</div>
          </div>
        ) : (
          <div className="port-table">
            <div className="port-th">
              <div>Container</div>
              <div>Container Port</div>
              <div>Host Port</div>
              <div>Protocol</div>
              <div>Action</div>
            </div>
            {portRows.map(({ c, p }) => (
              <div key={`${c.id}-${p.host}-${p.container}-${p.protocol}`} className="port-row">
                <div className="port-ctr">
                  <StatusDot status={c.status} /> {c.name}
                </div>
                <div className="mono">{p.container}</div>
                <div className="mono">localhost:{p.host}</div>
                <Pill tone="ok">{p.protocol}</Pill>
                {p.protocol === 'tcp' ? (
                  <button
                    className="text-btn"
                    type="button"
                    onClick={() =>
                      SystemCommands.openUrl(`http://localhost:${p.host}`).catch(() => undefined)
                    }
                  >
                    open ↗
                  </button>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        )}
      </BentoCard>

      <BentoCard section="Addresses" sectionIcon="network" title="Container IPs" span={4} headerAlign="left">
        {addresses.length === 0 ? (
          <div className="empty" style={{ padding: '20px 8px' }}>
            <Glyph name="network" size={20} />
            <div>{details.loading ? 'Inspecting containers…' : 'No running container has an address.'}</div>
          </div>
        ) : (
          <div className="dns-list">
            {addresses.map((a) => (
              <div key={`${a.rt}-${a.container}-${a.network}`} className="dns-row">
                <div className="dns-host mono" title={a.network}>
                  {a.container}
                  <span style={{ color: 'var(--dim)' }}>.{a.network}</span>
                </div>
                <span className="dns-ip mono">{a.ip}</span>
              </div>
            ))}
          </div>
        )}
      </BentoCard>
    </div>
  );
}
