import type { ReactNode } from 'react';
import { Glyph, type IconName } from './Icon';

interface PillButtonProps {
  icon: IconName | ReactNode;
  label: string;
  sub?: string;
  status?: 'ok' | 'warn';
  onClick?: () => void;
  active?: boolean;
  trailing?: ReactNode;
}

/** Rounded pill button — the core content atom inside bento cards. */
export function PillButton({
  icon,
  label,
  sub,
  status,
  onClick,
  active,
  trailing,
}: PillButtonProps) {
  return (
    <button
      className={`pill-btn ${active ? 'is-active' : ''}`}
      onClick={onClick}
      type="button"
    >
      <span className={`pb-icon ${status ? `s-${status}` : ''}`}>
        {typeof icon === 'string' ? <Glyph name={icon as IconName} size={13} /> : icon}
      </span>
      <span className="pb-text">
        <span className="pb-label">{label}</span>
        {sub && <span className="pb-sub">{sub}</span>}
      </span>
      {trailing && <span className="pb-trailing">{trailing}</span>}
    </button>
  );
}
