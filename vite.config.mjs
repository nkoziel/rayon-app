import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/*
 * The product promise is "one file you can just open" — no server, no assets to keep together.
 * So the build takes src/ and emits a SINGLE self-contained index.html, which tools/publish.js
 * then copies to the repo root, where GitHub Pages serves it and where cloning the repo and
 * double-clicking the file still works.
 *
 * The PWA files (manifest, service worker, icons) deliberately stay at the repo root rather
 * than going through the build: they are served as separate files by definition, and the
 * service worker must be a top-level script at the scope it controls.
 */
export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,   // inline everything
    cssCodeSplit: false,
    // readable output: this file is committed, and a diff of minified soup is useless
    minify: false,
    rollupOptions: {
      // these live at the repo root and are referenced at runtime, not bundled
      external: [/^\.\/icons\//, /manifest\.webmanifest$/, /sw\.js$/],
    },
  },
  plugins: [viteSingleFile()],
});
