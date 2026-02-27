import { create } from 'zustand';

export interface SessionMapEntry {
  status: 'starting' | 'active' | 'ended';
  waitingType: 'user_input' | 'permission' | 'idle' | null;
  sessionId: string;
  spawnedAt: number;
}

export interface BoardState {
  selectedRepo: string | null;
  selectedEpic: string | null;
  selectedTicket: string | null;
  sessionMap: Map<string, SessionMapEntry>;
  orchestratorConnected: boolean;

  setSelectedRepo: (name: string | null) => void;
  setSelectedEpic: (id: string | null) => void;
  setSelectedTicket: (id: string | null) => void;
  setSessionMap: (map: Map<string, SessionMapEntry>) => void;
  updateSessionStatus: (stageId: string, entry: SessionMapEntry) => void;
  clearSessionMap: () => void;
  getSessionStatus: (stageId: string) => SessionMapEntry | null;
  setOrchestratorConnected: (connected: boolean) => void;
}

export const useBoardStore = create<BoardState>((set, get) => ({
  selectedRepo: null,
  selectedEpic: null,
  selectedTicket: null,
  sessionMap: new Map(),
  orchestratorConnected: false,

  setSelectedRepo: (name) => set({ selectedRepo: name, selectedEpic: null, selectedTicket: null }),
  setSelectedEpic: (id) => set({ selectedEpic: id, selectedTicket: null }),
  setSelectedTicket: (id) => set({ selectedTicket: id }),

  setSessionMap: (map) => set({ sessionMap: new Map(map) }),

  updateSessionStatus: (stageId, entry) =>
    set((state) => {
      const next = new Map(state.sessionMap);
      if (entry.status === 'ended') {
        next.delete(stageId);
      } else {
        next.set(stageId, entry);
      }
      return { sessionMap: next };
    }),

  clearSessionMap: () => set({ sessionMap: new Map() }),

  getSessionStatus: (stageId) => get().sessionMap.get(stageId) ?? null,

  setOrchestratorConnected: (connected) => set({ orchestratorConnected: connected }),
}));
