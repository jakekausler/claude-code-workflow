import { create } from 'zustand';

export interface BoardState {
  selectedEpic: string | null;
  setSelectedEpic: (id: string | null) => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  selectedEpic: null,
  setSelectedEpic: (id) => set({ selectedEpic: id }),
}));
