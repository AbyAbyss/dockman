// Pure-SVG chart primitives — sparkline, ring gauge and donut.

interface SparklineProps {
  data: number[];
  w?: number;
  h?: number;
  accent: string;
}

export function Sparkline({ data, w = 120, h = 32, accent }: SparklineProps) {
  const max = Math.max(...data, 1);
  const min = Math.min(...data, 0);
  const range = Math.max(max - min, 1);
  const step = w / (data.length - 1);
  const pts = data.map(
    (v, i) => [i * step, h - ((v - min) / range) * (h - 6) - 3] as const,
  );
  const path = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(' ');
  const area = `${path} L${w} ${h} L0 ${h} Z`;
  const last = pts[pts.length - 1];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <path d={area} fill={accent} opacity="0.14" />
      <path
        d={path}
        fill="none"
        stroke={accent}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={last[0]} cy={last[1]} r="2.4" fill={accent} />
    </svg>
  );
}

interface RingProps {
  pct: number;
  size?: number;
  stroke?: number;
  accent: string;
}

export function Ring({ pct, size = 60, stroke = 4, accent }: RingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--subtle)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={accent}
        strokeWidth={stroke}
        strokeDasharray={`${(pct / 100) * c} ${c}`}
        strokeDashoffset={c * 0.25}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        strokeLinecap="round"
      />
      <text
        x={size / 2}
        y={size / 2 + 4}
        textAnchor="middle"
        fontSize="11"
        fontWeight="600"
        fill="currentColor"
      >
        {pct}%
      </text>
    </svg>
  );
}

interface DonutDatum {
  label: string;
  value: number;
  color: string;
}

interface DonutChartProps {
  data: DonutDatum[];
  size?: number;
  stroke?: number;
}

export function DonutChart({ data, size = 140, stroke = 22 }: DonutChartProps) {
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--subtle)" strokeWidth={stroke} />
      {data.map((d, i) => {
        const len = (d.value / total) * c;
        const seg = (
          <circle
            key={i}
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke={d.color}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${c}`}
            strokeDashoffset={-acc + c * 0.25}
            transform={`rotate(-360 ${size / 2} ${size / 2})`}
          />
        );
        acc += len;
        return seg;
      })}
      <text x={size / 2} y={size / 2 - 4} textAnchor="middle" fontSize="11" fill="var(--dim)">
        total
      </text>
      <text
        x={size / 2}
        y={size / 2 + 14}
        textAnchor="middle"
        fontSize="15"
        fontWeight="600"
        fill="currentColor"
      >
        {(total / 1024).toFixed(1)}GB
      </text>
    </svg>
  );
}
