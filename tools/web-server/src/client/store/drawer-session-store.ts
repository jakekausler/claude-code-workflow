import { create } from 'zustand';

interface SessionRef {
  projectId: string;
  sessionId: string;
}

interface DrawerSessionState {
  activeStageSession: SessionRef | null;
  activeTicketSession: SessionRef | null;
  stageActiveTab: string;
  ticketActiveTab: string;

  setStageSession: (projectId: string, sessionId: string) => void;
  setTicketSession: (projectId: string, sessionId: string) => void;
  setStageActiveTab: (tab: string) => void;
  setTicketActiveTab: (tab: string) => void;
  reset: () => void;
}

const initialState = {
  activeStageSession: null as SessionRef | null,
  activeTicketSession: null as SessionRef | null,
  stageActiveTab: 'details',
  ticketActiveTab: 'details',
};

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
