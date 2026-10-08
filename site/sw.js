// Service worker de l'appli du Chariot.
// 1) Nécessaire pour qu'Android propose « Installer l'appli ».
// 2) Reçoit les notifications envoyées par l'équipe depuis Firebase (Cloud Messaging).
// Stratégie « réseau d'abord » : on affiche toujours la version la plus récente,
// et la dernière version enregistrée sert seulement quand il n'y a pas de connexion.
const CACHE = "chariot-v3", EXT = "chariot-ext-v1";
// Fichiers gardés dès l'installation, pour que l'appli s'ouvre même sans réseau
const CORE = ["./", "index.html", "shows.js", "firebase-config.js", "manifest.webmanifest", "icon-192.png", "icon-512.png", "badge-96.png"];

// Affichage des notifications avec l'icône du Chariot (la roue sur fond rose), y compris pour
// les messages écrits à la main dans la console Firebase, qui n'indiquent pas d'icône.
// Ce gestionnaire passe avant celui de Firebase (déclaré plus bas) et l'empêche d'afficher un doublon.
self.addEventListener("push", e => {
  let p = null;
  try { p = e.data && e.data.json(); } catch (err) { return; }
  const n = p && p.notification;
  if (!n) return; // message sans notification : laissé à Firebase
  e.stopImmediatePropagation();
  const link = (p.fcmOptions && p.fcmOptions.link) || n.click_action || "./";
  e.waitUntil(self.registration.showNotification(n.title || "Théâtre du Chariot", {
    body: n.body || "",
    icon: "icon-192.png",
    badge: "badge-96.png",
    image: n.image || undefined,
    data: { FCM_MSG: { notification: { click_action: link } } }
  }));
});

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

self.addEventListener("install", e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).catch(() => {})); });
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== EXT).map(k => caches.delete(k)))).then(() => self.clients.claim())
));

// Toucher une notification ouvre l'appli (ou la remet au premier plan).
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.FCM_MSG && e.notification.data.FCM_MSG.notification && e.notification.data.FCM_MSG.notification.click_action) || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) { if ("focus" in c) return c.focus(); }
    return self.clients.openWindow(link);
  }));
});

// Affiches du site Wix, polices et bibliothèques : gardées en mémoire (affichage immédiat, et hors connexion).
const EXT_HOSTS = ["static.wixstatic.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) {
    if (!EXT_HOSTS.includes(url.hostname)) return;
    e.respondWith(caches.open(EXT).then(c => c.match(req).then(hit => {
      const net = fetch(req).then(res => { if (res && (res.ok || res.type === "opaque")) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || net;
    })));
    return;
  }
  // Pages et données de l'appli : réseau d'abord (toujours la dernière version), sinon la copie gardée.
  e.respondWith(
    fetch(req)
      .then(res => {
        if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === "navigate" }).then(r => r || caches.match("./")))
  );
});
