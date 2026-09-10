import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { prefs } from '../src/lib/prefs';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('prefs', () => {
  it('defaults the sidebar to open', async () => {
    await expect(prefs.getSidebarOpen()).resolves.toBe(true);
  });

  it('persists the sidebar state in local extension storage', async () => {
    await prefs.setSidebarOpen(false);
    await expect(prefs.getSidebarOpen()).resolves.toBe(false);
    await expect(fakeBrowser.storage.local.get('sidebarOpen')).resolves.toEqual({
      sidebarOpen: false,
    });
  });

  it('defaults the sidebar width to 320', async () => {
    await expect(prefs.getSidebarWidth()).resolves.toBe(320);
  });

  it('persists the sidebar width in local extension storage', async () => {
    await prefs.setSidebarWidth(480);
    await expect(prefs.getSidebarWidth()).resolves.toBe(480);
    await expect(fakeBrowser.storage.local.get('sidebarWidth')).resolves.toEqual({
      sidebarWidth: 480,
    });
  });

  it('falls back to 320 when the stored width is not a number', async () => {
    await fakeBrowser.storage.local.set({ sidebarWidth: 'wide' });
    await expect(prefs.getSidebarWidth()).resolves.toBe(320);
  });
});
