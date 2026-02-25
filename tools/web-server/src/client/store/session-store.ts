import { create } from 'zustand';

export interface SessionState {
  activeSessionIds: string[];
  setActiveSessionIds: (ids: string[]) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessionIds: [],
  setActiveSessionIds: (ids) => set({ activeSessionIds: ids }),
}));
