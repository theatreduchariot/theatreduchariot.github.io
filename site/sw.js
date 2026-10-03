// Service worker de l'appli du Chariot.
// Nécessaire pour qu'Android propose « Installer l'appli ».
// Stratégie « réseau d'abord » : on affiche toujours la version la plus récente,
// et la dernière version enregistrée sert seulement quand il n'y a pas de connexion.
const CACHE = "chariot-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req).then(r => r || caches.match("./")))
  );
});
