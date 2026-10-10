// Service worker de la billetterie : rend l'appli installable et l'ouvre même avec un réseau capricieux.
// Réseau d'abord (toujours la dernière version), copie gardée pour un démarrage sans connexion.
const CACHE = "billet-v1", CORE = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "../firebase-config.js", "../shows.js"];
self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {})); });
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const url = new URL(req.url); if (url.origin !== self.location.origin) return;
  e.respondWith(fetch(req).then(res => { if (res.ok) { const c = res.clone(); caches.open(CACHE).then(x => x.put(req, c)); } return res; })
    .catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then(r => r || caches.match("./"))));
});
