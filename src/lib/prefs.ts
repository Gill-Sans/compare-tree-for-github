import { storage } from '#imports';
import { SIDEBAR_WIDTH } from './page';

const sidebarOpenItem = storage.defineItem<boolean>('local:sidebarOpen', { fallback: true });
const sidebarWidthItem = storage.defineItem<number>('local:sidebarWidth', {
  fallback: SIDEBAR_WIDTH.default,
});

export interface Prefs {
  getSidebarOpen(): Promise<boolean>;
  setSidebarOpen(open: boolean): Promise<void>;
  getSidebarWidth(): Promise<number>;
  setSidebarWidth(width: number): Promise<void>;
}

export const prefs: Prefs = {
  getSidebarOpen: () => sidebarOpenItem.getValue(),
  setSidebarOpen: (open) => sidebarOpenItem.setValue(open),
  getSidebarWidth: async () => {
    const width = await sidebarWidthItem.getValue();
    return Number.isFinite(width) ? width : SIDEBAR_WIDTH.default;
  },
  setSidebarWidth: (width) => sidebarWidthItem.setValue(width),
};
