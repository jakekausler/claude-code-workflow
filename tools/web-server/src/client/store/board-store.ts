import { create } from 'zustand';

export interface BoardState {
  selectedRepo: string | null;
  selectedEpic: string | null;
  selectedTicket: string | null;
  setSelectedRepo: (name: string | null) => void;
  setSelectedEpic: (id: string | null) => void;
  setSelectedTicket: (id: string | null) => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  selectedRepo: null,
  selectedEpic: null,
  selectedTicket: null,
  setSelectedRepo: (name) => set({ selectedRepo: name, selectedEpic: null, selectedTicket: null }),
  setSelectedEpic: (id) => set({ selectedEpic: id, selectedTicket: null }),
  setSelectedTicket: (id) => set({ selectedTicket: id }),
}));
