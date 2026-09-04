import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  imports: false,
  modules: ['@wxt-dev/auto-icons'],
  autoIcons: {
    baseIconPath: 'assets/icon.svg',
  },
  manifest: {
    name: 'Compare Tree for GitHub',
    description:
      "Adds a PR-style tree of changed folders and files to GitHub's branch compare page, with per-folder change counts.",
    permissions: ['storage'],
  },
});
