/* Rayon — service worker: offline shell, fresh network for AniList */

/* IMPORTANT — bump VERSION on EVERY release.
   Without it, browsers that already installed the app never receive fixes:
   the SW only reinstalls when its own bytes change. See REVIEW.md §1.3. */
const VERSION = "2026-08-23.11";

const CACHE   = `rayon-shell-${VERSION}`;  // purged on every version bump
const RUNTIME = "rayon-runtime";           // cover images, kept across versions

const SHELL = [
  "./", "./index.html", "./manifest.webmanifest",
  "./icons/icon-192.png", "./icons/icon-512.png",
  "./icons/icon-maskable-512.png", "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== RUNTIME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;                     // AniList requests are POST
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // The document: NETWORK FIRST, cache as fallback.
    // This is what lets a fix reach an already-installed app.
    if (req.mode === "navigate" || req.destination === "document") {
      e.respondWith(
        fetch(req)
          .then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put("./index.html", copy)).catch(() => {});
            return res;
          })
          .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
      );
      return;
    }

    // Rest of the shell: cache first (purged whenever VERSION changes)
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Cover images: cache first, refreshed in the background.
  // Separate cache, never purged: an app update must not throw away the covers.
  //
  // Google Fonts is deliberately absent now — the faces are bundled into the page itself
  // (REVIEW.md §5), so there is no third-party font request left to cache, and no visitor IP
  // handed to Google on every open.
  if (/anilist\.co|mangabaka\.(dev|org)/.test(url.hostname)) {
    e.respondWith(
      caches.match(req).then(hit => {
        const net = fetch(req).then(res => {
          const copy = res.clone();
          caches.open(RUNTIME).then(c => c.put(req, copy)).catch(() => {});
          return res;
        }).catch(() => hit);
        return hit || net;
      })
    );
  }
});
