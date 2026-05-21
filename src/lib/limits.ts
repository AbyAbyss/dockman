// Shared resource-limit presets, used by the Run and Configure modals.

export interface LimitPreset {
  label: string;
  memory: string;
  memorySwap: string;
  cpus: string;
}

// Each preset pins mem+swap to the memory limit so the cap stays predictable.
export const LIMIT_PRESETS: LimitPreset[] = [
  { label: 'Unlimited', memory: '', memorySwap: '', cpus: '' },
  { label: 'Small', memory: '512m', memorySwap: '512m', cpus: '0.5' },
  { label: 'Medium', memory: '1g', memorySwap: '1g', cpus: '1' },
  { label: 'Large', memory: '2g', memorySwap: '2g', cpus: '2' },
];

/** One-line summary of the active resource limits. */
export function limitSummary(memory: string, cpus: string): string {
  if (!memory && !cpus) return 'Unlimited · uses host defaults';
  const parts: string[] = [];
  if (memory) parts.push(`${memory} memory`);
  if (cpus) parts.push(`${cpus} CPU`);
  return parts.join(' · ');
}
