import { create } from 'zustand';

export interface SessionRef {
  projectId: string;
  sessionId: string;
}

export type DrawerTab = 'details' | 'session';

interface DrawerSessionState {
  activeStageSession: SessionRef | null;
  activeTicketSession: SessionRef | null;
  stageActiveTab: DrawerTab;
  ticketActiveTab: DrawerTab;

  setStageSession: (projectId: string, sessionId: string) => void;
  setTicketSession: (projectId: string, sessionId: string) => void;
  setStageActiveTab: (tab: DrawerTab) => void;
  setTicketActiveTab: (tab: DrawerTab) => void;
  reset: () => void;
}

const initialState = {
  activeStageSession: null as SessionRef | null,
  activeTicketSession: null as SessionRef | null,
  stageActiveTab: 'details' as DrawerTab,
  ticketActiveTab: 'details' as DrawerTab,
};

/** Drawer tab state and active session selection. Reset when drawer closes. */
export const useDrawerSessionStore = create<DrawerSessionState>((set) => ({
  ...initialState,

  setStageSession: (projectId, sessionId) =>
    set({ activeStageSession: { projectId, sessionId } }),

  setTicketSession: (projectId, sessionId) =>
    set({ activeTicketSession: { projectId, sessionId } }),

  setStageActiveTab: (tab) => set({ stageActiveTab: tab }),

  setTicketActiveTab: (tab) => set({ ticketActiveTab: tab }),

  reset: () => set({ ...initialState }),
}));
