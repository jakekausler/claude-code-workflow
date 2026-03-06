import { create } from 'zustand';

export interface DrawerEntry {
  type: 'epic' | 'ticket' | 'stage';
  id: string;
}

interface DrawerState {
  /** Stack of open drawers — last entry is the visible one */
  stack: DrawerEntry[];
  /** Push a new drawer onto the stack */
  open: (entry: DrawerEntry) => void;
  /** Pop the top drawer off the stack (go back) */
  back: () => void;
  /** Close all drawers */
  closeAll: () => void;
  /** Replace the entire stack (used for deep-link entry) */
  setStack: (stack: DrawerEntry[]) => void;
}

export const useDrawerStore = create<DrawerState>((set) => ({
  stack: [],
  open: (entry) =>
    set((state) => ({ stack: [...state.stack, entry] })),
  back: () =>
    set((state) => ({ stack: state.stack.slice(0, -1) })),
  closeAll: () => set({ stack: [] }),
  setStack: (stack) => set({ stack }),
}));
