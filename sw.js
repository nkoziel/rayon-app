/* Rayon — service worker: offline shell, fresh network for AniList */

/* IMPORTANT — bump VERSION on EVERY release.
   Without it, browsers that already installed the app never receive fixes:
   the SW only reinstalls when its own bytes change. See REVIEW.md §1.3. */
const VERSION = "2026-08-23.2";

const CACHE   = `rayon-shell-${VERSION}`;  // purged on every version bump
const RUNTIME = "rayon-runtime";           // fonts + covers, kept across versions

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
  if (req.method !== "GET") return;                     // les requêtes AniList sont en POST
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Le document : RÉSEAU D'ABORD, cache en repli.
    // C'est ce qui permet à une correction d'atteindre une app déjà installée.
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

    // Reste de la coquille : cache d'abord (purgé au changement de VERSION)
    e.respondWith(
      caches.match(req).then(hit => hit || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Polices et couvertures : cache d'abord, rafraîchi en arrière-plan.
  // Cache séparé, non purgé : une mise à jour de l'app ne jette pas les couvertures.
  if (/fonts\.(googleapis|gstatic)\.com|anilist\.co/.test(url.hostname)) {
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
