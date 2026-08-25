// Theme + layout preferences, persisted to localStorage.
// Mirrors the design prototype's "tweaks" — palette, accent, geometry and the
// tab-bar layout — but exposed as a typed Zustand store instead of an
// EDITMODE block.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AccentName,
  PaletteName,
  TabKey,
  TabPosition,
  ThemeMode,
} from '@/types';

/**
 * Geometry, density and motion per theme mode. These become CSS custom
 * properties on `.dockman-root`, so switching mode restyles the whole app
 * without any component knowing a mode exists.
 *
 * `serious` reproduces the Console design exactly. `playful` is a looser,
 * rounder, more colourful reading of the same layouts.
 */
export const MODES: Record<
  ThemeMode,
  {
    label: string;
    blurb: string;
    /** Card / control / pill / chip radii. */
    rCard: number;
    rCtl: number;
    rPill: number;
    rChip: number;
    /** Table row heights. */
    rowH: number;
    groupH: number;
    /** Card padding, vertical and horizontal. */
    padY: number;
    padX: number;
    /** Border weight for controls and for cards. */
    bw: number;
    bwCard: number;
    /** Transition duration and easing. */
    dur: number;
    ease: string;
    /** Card elevation. */
    cardShadow: string;
    /** Raised-control elevation, and where it goes on press. */
    btnShadow: string;
    btnShadowActive: string;
  }
> = {
  serious: {
    label: 'Serious',
    blurb: 'dense console · quiet colour',
    rCard: 13,
    rCtl: 8,
    rPill: 6,
    rChip: 4,
    rowH: 40,
    groupH: 36,
    padY: 14,
    padX: 16,
    bw: 1,
    bwCard: 1,
    dur: 120,
    ease: 'ease-out',
    cardShadow: 'none',
    btnShadow: 'none',
    btnShadowActive: 'none',
  },
  // Neo-brutalist: ink outlines, hard offset shadows, flat bright fills.
  playful: {
    label: 'Playful',
    blurb: 'ink outlines · hard shadows · bright',
    rCard: 20,
    rCtl: 999,
    rPill: 999,
    rChip: 999,
    rowH: 52,
    groupH: 50,
    padY: 16,
    padX: 18,
    bw: 2,
    bwCard: 3,
    dur: 90,
    ease: 'ease-out',
    cardShadow: '4px 4px 0 var(--ink)',
    btnShadow: '3px 3px 0 var(--ink)',
    btnShadowActive: '1px 1px 0 var(--ink)',
  },
};

export const PALETTES: Record<
  PaletteName,
  { bg: string; surface: string; text: string; dim: string; line: string; subtle: string; tint: string }
> = {
  ink:   { bg: '#0d0c0a', surface: '#1f1c17', text: '#ece6d6', dim: '#8a8473', line: 'rgba(236,230,214,0.13)', subtle: 'rgba(236,230,214,0.07)', tint: 'rgba(236,230,214,0.025)' },
  paper: { bg: '#ebe6db', surface: '#fbf8f1', text: '#1d1b16', dim: '#7a7464', line: 'rgba(29,27,22,0.10)',    subtle: 'rgba(29,27,22,0.04)',     tint: 'rgba(29,27,22,0.02)' },
  slate: { bg: '#0d1117', surface: '#161b22', text: '#e6edf3', dim: '#7d8590', line: 'rgba(230,237,243,0.10)', subtle: 'rgba(230,237,243,0.05)', tint: 'rgba(230,237,243,0.02)' },
};

/**
 * Playful ships its own palette. The look is built on a cream ground with ink
 * outlines and flat bright fills — it does not survive being recoloured, so it
 * replaces the palette / accent choice rather than layering over it.
 */
export const PLAYFUL_PALETTE = {
  ink: '#1c1a17',
  bg: '#f5f0e4',
  surface: '#fffdf6',
  text: '#1c1a17',
  dim: '#6b6455',
  line: '#1c1a17',
  subtle: '#f5f0e4',
  tint: '#fffdf6',
  accent: '#22c79b',
  accentSoft: '#b9f5e0',
  warn: '#ffd466',
  bad: '#ef5b4c',
  info: '#bfe0ff',
  rtDocker: '#2496ed',
  rtPodman: '#8b3fd9',
};

export const ACCENTS: Record<AccentName, { hex: string; soft: string }> = {
  violet:     { hex: '#a78bfa', soft: 'rgba(167,139,250,0.16)' },
  olive:      { hex: '#a5b950', soft: 'rgba(165,185,80,0.16)' },
  terracotta: { hex: '#d97757', soft: 'rgba(217,119,87,0.16)' },
  cobalt:     { hex: '#6aa5ff', soft: 'rgba(106,165,255,0.18)' },
};

interface ThemeState {
  mode: ThemeMode;
  palette: PaletteName;
  accent: AccentName;
  gap: number;
  radius: number;
  tabPosition: TabPosition;
  tabCollapsed: boolean;
  defaultTab: TabKey;
  m1Fallback: boolean;
  translucent: boolean;
  translucency: number;

  setMode: (m: ThemeMode) => void;
  setPalette: (p: PaletteName) => void;
  setAccent: (a: AccentName) => void;
  setGap: (g: number) => void;
  setRadius: (r: number) => void;
  setTabPosition: (p: TabPosition) => void;
  setTabCollapsed: (c: boolean) => void;
  setDefaultTab: (t: TabKey) => void;
  setM1Fallback: (v: boolean) => void;
  setTranslucent: (v: boolean) => void;
  setTranslucency: (v: number) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      mode: 'serious',
      palette: 'ink',
      accent: 'violet',
      gap: 14,
      radius: 18,
      tabPosition: 'top',
      tabCollapsed: false,
      defaultTab: 'overview',
      m1Fallback: true,
      translucent: false,
      translucency: 35,

      setMode: (mode) => set({ mode }),
      setPalette: (palette) => set({ palette }),
      setAccent: (accent) => set({ accent }),
      setGap: (gap) => set({ gap }),
      setRadius: (radius) => set({ radius }),
      setTabPosition: (tabPosition) => set({ tabPosition }),
      setTabCollapsed: (tabCollapsed) => set({ tabCollapsed }),
      setDefaultTab: (defaultTab) => set({ defaultTab }),
      setM1Fallback: (m1Fallback) => set({ m1Fallback }),
      setTranslucent: (translucent) => set({ translucent }),
      setTranslucency: (translucency) => set({ translucency }),
    }),
    { name: 'dockman-theme' },
  ),
);
