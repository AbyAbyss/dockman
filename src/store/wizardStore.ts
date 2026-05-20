// First-run setup wizard state — completion flag persisted to localStorage so
// the wizard only appears once.

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface WizardState {
  completed: boolean;
  setCompleted: (v: boolean) => void;
}

export const useWizardStore = create<WizardState>()(
  persist(
    (set) => ({
      completed: false,
      setCompleted: (completed) => set({ completed }),
    }),
    { name: 'dockman-wizard' },
  ),
);
