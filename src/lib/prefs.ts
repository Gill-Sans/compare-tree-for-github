import { storage } from '#imports';

const sidebarOpenItem = storage.defineItem<boolean>('local:sidebarOpen', { fallback: true });

export interface Prefs {
  getSidebarOpen(): Promise<boolean>;
  setSidebarOpen(open: boolean): Promise<void>;
}

export const prefs: Prefs = {
  getSidebarOpen: () => sidebarOpenItem.getValue(),
  setSidebarOpen: (open) => sidebarOpenItem.setValue(open),
};
