import type { IconName } from '@/components/ui/Icon';
import type { TabKey } from '@/types';

export interface TabDef {
  key: TabKey;
  label: string;
  icon: IconName;
  path: string;
}

/** The eight top-level sections of Dockman, in nav order. */
export const TABS: TabDef[] = [
  { key: 'overview', label: 'Dashboard', icon: 'bolt', path: '/' },
  { key: 'containers', label: 'Containers', icon: 'container', path: '/containers' },
  { key: 'images', label: 'Images', icon: 'image', path: '/images' },
  { key: 'volumes', label: 'Volumes', icon: 'volume', path: '/volumes' },
  { key: 'networks', label: 'Networks', icon: 'network', path: '/networks' },
  { key: 'builds', label: 'Builds', icon: 'build', path: '/builds' },
  { key: 'binary', label: 'Binaries', icon: 'extension', path: '/binaries' },
  { key: 'settings', label: 'Settings', icon: 'settings', path: '/settings' },
];
