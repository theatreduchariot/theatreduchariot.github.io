/* Billetterie du Chariot — version application (Firebase).
   Remplace le stockage de Claude par Firestore et ajoute la connexion Google.
   La page index.html est inchangée : elle appelle window.claude.use("db"), etc. */
(function(){
  window.BILLETTERIE_APP = true;
  const cfg = window.FIREBASE_CONFIG || {};
  const configured = cfg.apiKey && cfg.apiKey !== "A_REMPLACER";

  let app=null, auth=null, fs=null;
  if (configured) {
    app = firebase.initializeApp(cfg);
    auth = firebase.auth();
    fs = firebase.firestore();
    try { fs.settings({ ignoreUndefinedProperties: true, merge: true }); } catch (_) {}
    // Garde une copie locale : l'accueil continue de fonctionner si le wifi coupe quelques minutes.
    fs.enablePersistence({ synchronizeTabs: true }).catch(() => {});
  }

  // ---------- écran de connexion ----------
  const css = `
  #gate{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;padding:16px;background:var(--bg,#f3f0f4)}
  #gate .card{max-width:380px;width:100%;background:var(--surface,#fff);border:1px solid var(--line,#ddd6e2);border-radius:12px;padding:24px;display:flex;flex-direction:column;gap:14px;text-align:center;font-family:var(--f-body,system-ui)}
  #gate h1{margin:0;font:700 1.5rem/1.15 var(--f-display,Georgia,serif);color:var(--ink,#221a2b)}
  #gate p{margin:0;color:var(--muted,#6b6175);font-size:.92rem}
  #gate button{border:0;border-radius:8px;padding:11px 16px;font:600 1rem var(--f-body,system-ui);background:var(--velvet,#6d1f3c);color:#fff;cursor:pointer}
  #gate .err{color:var(--warn,#a4501a);font-size:.88rem}
  .who-am-i{font-size:.78rem;color:var(--muted,#6b6175)}
  .who-am-i button{border:0;background:none;color:inherit;text-decoration:underline;cursor:pointer;font:inherit;padding:0}`;
  function ready(fn){ document.readyState==="loading" ? document.addEventListener("DOMContentLoaded",fn) : fn(); }
  let gate=null;
  function showGate(msg, err){
    ready(()=>{
      if(!document.getElementById("gate-css")){const s=document.createElement("style");s.id="gate-css";s.textContent=css;document.head.append(s)}
      if(!gate){gate=document.createElement("div");gate.id="gate";document.body.append(gate)}
      gate.hidden=false;
      gate.innerHTML="";
      const c=document.createElement("div");c.className="card";
      const h=document.createElement("h1");h.textContent="Billetterie du Chariot";
      const p=document.createElement("p");p.textContent=msg;
      c.append(h,p);
      if(err){const e=document.createElement("p");e.className="err";e.textContent=err;c.append(e)}
      if(configured){
        const b=document.createElement("button");b.type="button";
        b.textContent=auth&&auth.currentUser?"Changer de compte":"Se connecter avec Google";
        b.onclick=async()=>{
          const prov=new firebase.auth.GoogleAuthProvider();prov.setCustomParameters({prompt:"select_account"});
          try{ if(auth.currentUser) await auth.signOut(); await auth.signInWithPopup(prov); }
          catch(e){ if(e&&e.code==="auth/popup-blocked"){ await auth.signInWithRedirect(prov) } else if(!(e&&e.code==="auth/popup-closed-by-user")) showGate(msg,"La connexion n'a pas abouti ("+(e&&e.code||"erreur")+"). Réessayez."); }
        };
        c.append(b);
      }
      gate.append(c);
    });
  }
  function hideGate(){ if(gate) gate.hidden=true; }
  function showWho(user){
    ready(()=>{
      const host=document.querySelector(".topr")||document.querySelector("header");if(!host)return;
      let w=document.getElementById("whoami");
      if(!w){w=document.createElement("div");w.id="whoami";w.className="who-am-i";host.append(w)}
      w.innerHTML="";w.append(document.createTextNode("Connecté : "+(user.email||"")+" · "));
      const b=document.createElement("button");b.type="button";b.textContent="Se déconnecter";
      b.onclick=()=>auth.signOut().then(()=>location.reload());w.append(b);
    });
  }

  // ---------- accès à la base ----------
  let resolveDb; const dbReady=new Promise(r=>resolveDb=r);
  const api = fs ? {
    collection: name => fs.collection(name),
    doc: path => fs.doc(path)
  } : null;

  if(!configured){
    showGate("L'application n'est pas encore reliée à Firebase.","Complétez le fichier firebase-config.js (étape 3 du mode d'emploi).");
  } else {
    auth.getRedirectResult().catch(()=>{});
    auth.onAuthStateChanged(async user=>{
      if(!user){ showGate("Réservé à l'équipe du théâtre. Connectez-vous avec votre compte Google."); return; }
      try{
        await fs.doc("config/tarifs").get();   // vérifie que ce compte figure dans la liste de l'équipe
        hideGate(); showWho(user); resolveDb(api);
      }catch(e){
        if(e&&e.code==="permission-denied") showGate("Le compte "+user.email+" n'a pas accès à la billetterie.","Demandez à l'administratrice d'ajouter cette adresse dans les règles Firestore (étape 5).");
        else { hideGate(); showWho(user); resolveDb(api); } // hors ligne : on continue avec la copie locale
      }
    });
  }

  const userApi = {
    isOwner: () => false,
    canEdit: () => true,
    can: async () => true,
    id: async () => auth && auth.currentUser ? auth.currentUser.uid : null,
    me: async () => ({ id: auth && auth.currentUser ? auth.currentUser.uid : "", name: auth && auth.currentUser ? (auth.currentUser.displayName||"") : "" })
  };

  window.claude = Object.freeze({
    use: async (name) => {
      if (name === "db") return dbReady;
      if (name === "user") { await dbReady; return userApi; }
      return null; // mcp, etc. : indisponibles hors de claude.ai
    }
  });

  // Mode hors ligne / installation sur l'écran d'accueil
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
  }
})();
