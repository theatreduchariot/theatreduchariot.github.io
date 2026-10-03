// Service worker de l'appli du Chariot.
// 1) Nécessaire pour qu'Android propose « Installer l'appli ».
// 2) Reçoit les notifications envoyées par l'équipe depuis Firebase (Cloud Messaging).
// Stratégie « réseau d'abord » : on affiche toujours la version la plus récente,
// et la dernière version enregistrée sert seulement quand il n'y a pas de connexion.
const CACHE = "chariot-v1";

try {
  importScripts(
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js",
    "firebase-config.js"
  );
  const cfg = self.FIREBASE_CONFIG;
  if (cfg && cfg.apiKey && !cfg.apiKey.startsWith("A_REMPLACER")) {
    firebase.initializeApp(cfg);
    firebase.messaging(); // affiche automatiquement les notifications reçues en arrière-plan
  }
} catch (e) { /* hors ligne ou Firebase indisponible : l'appli fonctionne quand même */ }

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// Toucher une notification ouvre l'appli (ou la remet au premier plan).
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.notification && e.notification.data.FCM_MSG.notification.click_action) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow(link);
  }));
});

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
