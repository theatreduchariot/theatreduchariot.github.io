// Configuration du projet Firebase « chariot-appli ».
// Ces valeurs ne sont pas secrètes : ce sont les règles Firestore qui protègent les données.
// (« self » fonctionne à la fois dans la page et dans le service worker des notifications.)
self.FIREBASE_CONFIG = {
  apiKey: "AIzaSyAuxlxDESWq-l0KFUSaNQ1_u67V5DzLkOg",
  authDomain: "chariot-appli.firebaseapp.com",
  projectId: "chariot-appli",
  storageBucket: "chariot-appli.firebasestorage.app",
  messagingSenderId: "1037504565179",
  appId: "1:1037504565179:web:cfa278b9d90314514fbe9e"
};
// Clé publique des notifications (Firebase > Paramètres du projet > Cloud Messaging >
// Configuration Web > Certificats Web Push > Paire de clés). Publique, non secrète.
self.FIREBASE_VAPID_KEY = "BBFtXa-6nkWkRPsOSGWOK0CqtQYuy-8XW-sRwltitFGPFjYZpdGu6c9RYgcUsnKP8cWKbu9iduJoYAV0uFC374M";
