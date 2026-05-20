import type { CSSProperties, ReactNode } from 'react';
import { Glyph, type IconName } from './Icon';

interface BentoCardProps {
  section?: string;
  title?: string;
  sectionIcon?: IconName;
  span?: number;
  rowSpan?: number;
  className?: string;
  headerAlign?: 'center' | 'left';
  headerAside?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

/** The signature bento atom: a card with the two-line header (small section
 *  label + larger title) and a flex body. */
export function BentoCard({
  section,
  title,
  sectionIcon,
  span,
  rowSpan,
  className = '',
  headerAlign = 'center',
  headerAside,
  children,
  style,
}: BentoCardProps) {
  return (
    <section
      className={`bento-card ${className}`}
      style={{
        gridColumn: span ? `span ${span}` : undefined,
        gridRow: rowSpan ? `span ${rowSpan}` : undefined,
        ...style,
      }}
    >
      {(section || title) && (
        <header className={`bc-h align-${headerAlign}`}>
          <div className="bc-h-text">
            <div className="bc-section">
              {sectionIcon && <Glyph name={sectionIcon} size={11} />}
              <span>{section}</span>
            </div>
            {title && <h3>{title}</h3>}
          </div>
          {headerAside && <div className="bc-h-aside">{headerAside}</div>}
        </header>
      )}
      <div className="bc-body">{children}</div>
    </section>
  );
}
