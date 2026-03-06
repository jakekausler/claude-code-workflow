import { create } from 'zustand';

export interface SettingsState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
}));
