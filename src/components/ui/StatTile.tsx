import type { ReactNode } from 'react';
import { Glyph, type IconName } from './Icon';

interface StatTileProps {
  value: ReactNode;
  label: string;
  section?: string;
  sectionIcon?: IconName;
  tone?: 'default' | 'violet' | 'warn' | 'dim';
  sub?: string;
  onClick?: () => void;
  suffix?: string;
}

/** Big-number stat card — the bento dashboard headline atom. */
export function StatTile({
  value,
  label,
  section,
  sectionIcon,
  tone = 'default',
  sub,
  onClick,
  suffix = '+',
}: StatTileProps) {
  return (
    <button className={`stat-tile tone-${tone}`} onClick={onClick} type="button">
      <div className="st-num">
        {value}
        {suffix && <span className="st-plus">{suffix}</span>}
      </div>
      <div className="st-foot">
        <span className="bc-section">
          {sectionIcon && <Glyph name={sectionIcon} size={11} />} {section}
        </span>
        <div className="st-label">{label}</div>
        {sub && <div className="st-sub mono">{sub}</div>}
      </div>
    </button>
  );
}
