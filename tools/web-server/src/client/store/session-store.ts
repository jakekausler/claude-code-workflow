import { create } from 'zustand';

// Existing store — tracks which sessions are active across the app
export interface SessionState {
  activeSessionIds: string[];
  setActiveSessionIds: (ids: string[]) => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  activeSessionIds: [],
  setActiveSessionIds: (ids) => set({ activeSessionIds: ids }),
}));

// Session view state for the session detail viewer
interface SessionViewState {
  expandedChunks: Set<number>;
  expandedTools: Set<string>;
  expandedSubagents: Set<string>;
  expandedSubagentTraces: Set<string>;
  isNearBottom: boolean;

  toggleChunk: (index: number) => void;
  toggleTool: (toolCallId: string) => void;
  toggleSubagent: (agentId: string) => void;
  toggleSubagentTrace: (agentId: string) => void;
  setIsNearBottom: (near: boolean) => void;
  resetView: () => void;
}

export const useSessionViewStore = create<SessionViewState>((set) => ({
  expandedChunks: new Set(),
  expandedTools: new Set(),
  expandedSubagents: new Set(),
  expandedSubagentTraces: new Set(),
  isNearBottom: true,

  toggleChunk: (index) =>
    set((state) => {
      const next = new Set(state.expandedChunks);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return { expandedChunks: next };
    }),

  toggleTool: (toolCallId) =>
    set((state) => {
      const next = new Set(state.expandedTools);
      if (next.has(toolCallId)) next.delete(toolCallId);
      else next.add(toolCallId);
      return { expandedTools: next };
    }),

  toggleSubagent: (agentId) =>
    set((state) => {
      const next = new Set(state.expandedSubagents);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return { expandedSubagents: next };
    }),

  toggleSubagentTrace: (agentId) =>
    set((state) => {
      const next = new Set(state.expandedSubagentTraces);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return { expandedSubagentTraces: next };
    }),

  setIsNearBottom: (near) => set({ isNearBottom: near }),

  resetView: () =>
    set({
      expandedChunks: new Set(),
      expandedTools: new Set(),
      expandedSubagents: new Set(),
      expandedSubagentTraces: new Set(),
      isNearBottom: true,
    }),
}));
