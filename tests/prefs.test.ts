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
});
