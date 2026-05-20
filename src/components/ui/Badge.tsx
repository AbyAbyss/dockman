import type { ReactNode } from 'react';
import { Glyph, type IconName } from './Icon';

type PillTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'dim' | 'info';

interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  icon?: IconName;
  title?: string;
}

/** Small uppercase status tag. */
export function Pill({ children, tone = 'neutral', icon, title }: PillProps) {
  return (
    <span className={`badge tone-${tone}`} title={title}>
      {icon && <Glyph name={icon} size={10} />}
      {children}
    </span>
  );
}

const DOT_COLORS: Record<string, string> = {
  running: 'var(--ok)',
  paused: 'var(--warn)',
  stopped: 'var(--dim)',
  success: 'var(--ok)',
  failed: 'var(--bad)',
};

/** Status dot with an animated pulse ring when running. */
export function StatusDot({ status }: { status: string }) {
  const color = DOT_COLORS[status] || 'var(--dim)';
  return (
    <span className="dot" style={{ background: color }}>
      {status === 'running' && (
        <span className="dot-pulse" style={{ background: color }} />
      )}
    </span>
  );
}
