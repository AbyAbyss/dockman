// Minimal stroke-icon set, ported from the design's icons.jsx. No emoji,
// no icon library — every glyph is a single 24×24 stroke path.

export const ICONS = {
  container: 'M3 7l9-4 9 4M3 7v10l9 4 9-4V7M3 7l9 4M21 7l-9 4M12 11v10',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  volume:
    'M4 7c0-1.7 3.6-3 8-3s8 1.3 8 3v10c0 1.7-3.6 3-8 3s-8-1.3-8-3V7zM4 7c0 1.7 3.6 3 8 3s8-1.3 8-3M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  network:
    'M5 7a2 2 0 100-4 2 2 0 000 4zM19 7a2 2 0 100-4 2 2 0 000 4zM12 21a2 2 0 100-4 2 2 0 000 4zM5 7v3a2 2 0 002 2h10a2 2 0 002-2V7M12 12v5',
  build: 'M14 7l4 4M5 19l4-1 10-10-3-3L6 15l-1 4z',
  search: ['M11 19a8 8 0 100-16 8 8 0 000 16z', 'M21 21l-4.3-4.3'],
  play: 'M6 4l14 8-14 8V4z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  stop: 'M6 6h12v12H6z',
  restart: 'M3 12a9 9 0 1015-6.7M21 4v5h-5',
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 13h10l1-13'],
  more: ['M5 12h.01', 'M12 12h.01', 'M19 12h.01'],
  cpu: 'M6 4h12v4M6 16h12v4M4 6v12h4M16 6v12h4M9 9h6v6H9z',
  ram: 'M3 8h18v8H3zM6 11v2M10 11v2M14 11v2M18 11v2',
  disk: 'M4 14a8 4 0 1016 0M4 14V8a8 4 0 0116 0v6M4 8a8 4 0 0016 0',
  net: 'M12 2a14 14 0 010 20M12 2a14 14 0 000 20M2 12h20M4 6c4 2 12 2 16 0M4 18c4-2 12-2 16 0',
  plus: 'M12 5v14M5 12h14',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  settings: [
    'M12 15a3 3 0 100-6 3 3 0 000 6z',
    'M19 12a7 7 0 00-.1-1.2l2-1.6-2-3.5-2.4.9a7 7 0 00-2-1.2L14 3h-4l-.5 2.4a7 7 0 00-2 1.2l-2.4-.9-2 3.5 2 1.6A7 7 0 005 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.5 2.4-.9a7 7 0 002 1.2L10 21h4l.5-2.4a7 7 0 002-1.2l2.4.9 2-3.5-2-1.6c.1-.4.1-.8.1-1.2z',
  ],
  extension:
    'M14 4h-1a2 2 0 10-4 0H8a2 2 0 00-2 2v3a2 2 0 100 4v3a2 2 0 002 2h3a2 2 0 104 0h3a2 2 0 002-2v-3a2 2 0 100-4V6a2 2 0 00-2-2h-1z',
  command: 'M9 6a3 3 0 11-3 3h12a3 3 0 11-3-3v12a3 3 0 11-3-3H6a3 3 0 113 3V6z',
  bolt: 'M13 2L4 14h7l-1 8 9-12h-7l1-8z',
  filter: 'M3 5h18l-7 9v6l-4-2v-4L3 5z',
  dot: 'M12 12h.01',
} as const;

export type IconName = keyof typeof ICONS;

interface IconProps {
  d: string | readonly string[];
  size?: number;
  sw?: number;
  fill?: string;
}

export function Icon({ d, size = 16, sw = 1.5, fill = 'none' }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke="currentColor"
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {Array.isArray(d) ? (
        (d as readonly string[]).map((p, i) => <path key={i} d={p} />)
      ) : (
        <path d={d as string} />
      )}
    </svg>
  );
}

interface GlyphProps {
  name: IconName;
  size?: number;
  sw?: number;
  fill?: string;
}

export function Glyph({ name, ...rest }: GlyphProps) {
  return <Icon d={ICONS[name]} {...rest} />;
}
