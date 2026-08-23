#!/usr/bin/env node
/*
 * Copy the built single file to the repo root.
 *
 * The root index.html is a BUILD ARTIFACT that is deliberately committed. It keeps two
 * properties the project depends on: GitHub Pages serves the repo root unchanged, and someone
 * who clones the repo can still open index.html directly with no build step — which is the
 * whole point of the app.
 *
 * Edit src/, never the root index.html: running the build overwrites it.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const built = path.join(ROOT, 'dist', 'index.html');
const target = path.join(ROOT, 'index.html');

if (!fs.existsSync(built)) {
  console.error('publish: dist/index.html absent — lancer `npm run build` d\'abord.');
  process.exit(1);
}

const html = fs.readFileSync(built, 'utf8');

/* A single file with no external <script src> or <link href> is the whole contract.
   If the bundler ever starts emitting side files, fail loudly rather than shipping a page
   that half-loads for everyone. */
const stray = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"']+)["']/g)]
  .map(m => m[1])
  /* Allowed: remote URLs, inlined data URIs, and the PWA files that are separate by design —
     icons and the manifest are fetched by the browser, not part of the page bundle. */
  .filter(u => !/^(https?:|data:|#)/.test(u) && !/^\.?\/?(icons\/|manifest\.webmanifest)/.test(u));
if (stray.length) {
  console.error('publish: le build reference des fichiers externes, il n\'est pas autonome :');
  stray.forEach(u => console.error('  ' + u));
  process.exit(1);
}

fs.writeFileSync(target, html, 'utf8');
console.log(`publish: index.html mis a jour (${(Buffer.byteLength(html, 'utf8') / 1024).toFixed(1)} Ko)`);
