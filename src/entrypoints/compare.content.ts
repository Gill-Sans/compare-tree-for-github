import '../assets/sidebar.css';
import { browser, createShadowRootUi, defineContentScript } from '#imports';
import { createController } from '../lib/controller';
import { HOST_TAG } from '../lib/page';
import { prefs } from '../lib/prefs';
import { createSidebar, type Sidebar } from '../lib/render';

export default defineContentScript({
  // Chrome injects content scripts only on full page loads, but GitHub reaches compare ranges through
  // in-app navigation (for example from the bare /compare branch picker). Run on all of github.com and
  // let the controller stay idle until the URL is a compare range.
  matches: ['https://github.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  async main(ctx) {
    const controller = createController({
      fetch: (url, init) => fetch(url, init),
      prefs,
      version: browser.runtime.getManifest().version,
      mount: async (anchor) => {
        const created: { sidebar?: Sidebar } = {};
        const ui = await createShadowRootUi(ctx, {
          name: HOST_TAG,
          position: 'inline',
          anchor,
          append: 'before',
          // Without this WXT injects ":host { all: initial !important }", which overrides the page-level sticky and grid rules on the host.
          inheritStyles: true,
          onMount: (container) => {
            created.sidebar = createSidebar(container);
            return created.sidebar;
          },
        });
        ui.mount();
        const sidebar = created.sidebar;
        if (!sidebar) throw new Error('The sidebar did not mount');
        return { sidebar, unmount: () => ui.remove() };
      },
    });

    ctx.onInvalidated(() => controller.dispose());
    ctx.addEventListener(window, 'wxt:locationchange', ({ newUrl }) => {
      void controller.sync(newUrl.href);
    });
    // Turbo pushes the new URL before it renders the new body; re-sync once the body is in place.
    ctx.addEventListener(document as EventTarget, 'turbo:load', () => {
      void controller.sync(location.href);
    });
    await controller.sync(location.href);
  },
});
