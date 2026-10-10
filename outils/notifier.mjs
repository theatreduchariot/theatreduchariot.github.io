// Notifications automatiques de l'appli du Chariot.
// Lancé par GitHub Actions (.github/workflows/notifs.yml) toutes les 5 minutes et à chaque mise à jour du programme :
//  - programme modifié : nouveau spectacle, nouvelles dates, séance complète, place libérée ;
//  - chaque matin (vers 10h) : rappel « Demain… », avis du lendemain, dernières dates, récap du lundi ;
//  - le jour J : rappel « Dans 1 h : … » ;
//  - messages écrits par l'équipe sur la page des statistiques (collection envois) ;
//  - surveillance de la synchro horaire (site/synchro.json) : alerte sur les appareils de l'équipe.
// Les téléphones abonnés sont dans Firestore (collection tokens, un document anonyme par téléphone).
// Ce qui a déjà été annoncé est noté dans Firestore (document etat/notifs) pour ne jamais envoyer deux fois.
import fs from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

export const APP = "https://theatreduchariot.github.io/";
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

// ---------- dates (heure de Paris) ----------
export function parisNow(d = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("fr-FR", {
    timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short"
  }).formatToParts(d).map(x => [x.type, x.value]));
  const day = `${p.year}-${p.month}-${p.day}`;
  return { day, hour: Number(p.hour) % 24, time: `${String(Number(p.hour) % 24).padStart(2, "0")}:${p.minute}`, weekday: new Date(day + "T12:00:00Z").getUTCDay() };
}
const addDays = (day, n) => { const t = new Date(day + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
// "10-03 16:00" -> { day: "2026-10-03", time: "16:00" }
const ses = (Y, x) => ({ day: `${Y}-${x.slice(0, 5)}`, time: x.slice(6) });
const mins = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
function fmtDay(day) { const t = new Date(day + "T12:00:00Z"); return `${JOURS[t.getUTCDay()]} ${t.getUTCDate() === 1 ? "1er" : t.getUTCDate()} ${MOIS[t.getUTCMonth()]}`; }
const fmtTime = t => t.replace(":", "h").replace(/h00$/, "h");
const fmtSes = (Y, x) => { const s = ses(Y, x); return `${fmtDay(s.day)} ${fmtTime(s.time)}`; };
const listFr = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " et " + a[a.length - 1];
const cut = (s, n = 170) => s.length > n ? s.slice(0, n - 1) + "…" : s;
const remOn = (t, k) => !t.rem || t.rem[k] !== false;
// Lien ouvert en touchant la notification (n = type, pour compter les ouvertures)
export const linkFor = (kind, showId) => APP + "?" + (showId ? "s=" + encodeURIComponent(showId) + "&" : "") + "n=" + encodeURIComponent(kind);

// ---------- programme ----------
export function loadShows(path = "site/shows.js") {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path, "utf8") + "\n;this.SHOWS=SHOWS;this.Y=Y;", ctx);
  return { SHOWS: ctx.SHOWS.filter(s => !s.arch && Array.isArray(s.sessions)), Y: ctx.Y };
}
// Séances complètes cochées par l'équipe : { "id|MM-JJ HH:MM": true | false }
export function applyComplets(SHOWS, m) {
  for (const s of SHOWS) {
    const f = new Set(s.full || []);
    for (const k of s.sessions) { const v = m[s.id + "|" + k]; if (v === true) f.add(k); else if (v === false) f.delete(k); }
    s.full = s.sessions.filter(k => f.has(k));
  }
}
// ---------- billetterie de l'accueil : ajout automatique des représentations du programme ----------
const normT = t => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const sameShow = (a, b) => { if (a.date !== b.date || (a.heure || "") !== (b.heure || "")) return false; const x = normT(a.titre), y = normT(b.titre); return x === y || x.startsWith(y) || y.startsWith(x) || x.slice(0, 8) === y.slice(0, 8); };
// existing : [{titre,date,heure,jauge}] déjà dans la billetterie → renvoie les représentations à créer
export function billetToAdd({ SHOWS, Y, existing, today }) {
  const add = [];
  const jaugeOf = t => { const same = existing.filter(x => normT(x.titre).slice(0, 8) === normT(t).slice(0, 8) && +x.jauge > 0); if (same.length) return +same[same.length - 1].jauge;
    const c = {}; existing.forEach(x => { if (+x.jauge > 0) c[x.jauge] = (c[x.jauge] || 0) + 1; }); const best = Object.entries(c).sort((a, b) => b[1] - a[1])[0]; return best ? +best[0] : 120; };
  for (const s of SHOWS) for (const k of s.sessions) {
    const r = { titre: s.t, date: `${Y}-${k.slice(0, 5)}`, heure: k.slice(6) };
    if (r.date < today || existing.some(x => sameShow(x, r)) || add.some(x => sameShow(x, r))) continue;
    add.push({ ...r, jauge: jaugeOf(s.t), source: "programme" });
  }
  return add;
}
const snapOf = SHOWS => Object.fromEntries(SHOWS.map(s => [s.id, { sessions: [...s.sessions], full: [...(s.full || [])] }]));

// Ce qui est à faire à ce passage (pour ne lire les abonnés que si nécessaire)
export function due({ SHOWS, Y, state, now }) {
  const changed = !state || !state.shows || JSON.stringify(state.shows) !== JSON.stringify(snapOf(SHOWS));
  const daily = now.hour >= 10 && now.hour < 20 && (!state || state.lastDaily !== now.day);
  const n = mins(now.time);
  const jourj = SHOWS.some(s => s.sessions.some(x => { const z = ses(Y, x); const d = mins(z.time) - n; return z.day === now.day && d > 40 && d <= 100; }));
  return { changed, daily, jourj };
}

// ---------- calcul des messages (sans réseau, testable) ----------
// tokens : [{ id, token, favs:[], plans:["id|MM-JJ HH:MM"], alerts:[], rem:{veille,jourj,avis} }]
// votes : { uid: { ratings:{ id:{n} } } } (pour ne pas redemander un avis déjà donné)
// Renvoie { messages:[{ kind, title, body, to: "all" | [token,...], link }], state }
export function plan({ SHOWS, Y, state, tokens, now, votes = {} }) {
  const today = now.day, nowT = now.time || "00:00";
  const future = x => { const s = ses(Y, x); return s.day > today || (s.day === today && s.time > nowT); };
  const byId = Object.fromEntries(SHOWS.map(s => [s.id, s]));
  const messages = [];
  const add = (kind, to, title, body, showId) => messages.push({ kind, to, title, body, link: linkFor(kind, showId) });
  const next = { ...(state || {}), shows: snapOf(SHOWS) };

  if (state && state.shows) {
    const old = state.shows;
    // 1. Nouveaux spectacles
    const added = SHOWS.filter(s => !old[s.id] && s.sessions.some(future));
    if (added.length === 1) {
      const s = added[0], first = s.sessions.filter(future).sort()[0];
      add("nouveau", "all", `Nouveau au Chariot : ${s.t}`, cut(`${s.genre ? s.genre + " · " : ""}à partir du ${fmtSes(Y, first)}. ${s.d || ""}`), s.id);
    } else if (added.length > 1) {
      add("nouveau", "all", `${added.length} nouveaux spectacles au Chariot`, cut(listFr(added.map(s => s.t)) + ". Découvrez-les dans l'appli !"));
    }
    // 2. Nouvelles dates pour un spectacle déjà annoncé
    const newDates = SHOWS.filter(s => old[s.id]).map(s => ({ s, xs: s.sessions.filter(x => future(x) && !old[s.id].sessions.includes(x)).sort() })).filter(o => o.xs.length);
    if (newDates.length === 1 || newDates.length === 2) {
      for (const { s, xs } of newDates) {
        const shown = xs.slice(0, 3).map(x => fmtSes(Y, x));
        add("dates", "all", `${s.t} : nouvelles dates`, cut(listFr(shown) + (xs.length > 3 ? ` (+ ${xs.length - 3} autres)` : "") + "."), s.id);
      }
    } else if (newDates.length > 2) {
      add("dates", "all", "Nouvelles dates au Chariot", cut(`Nouvelles représentations pour ${listFr(newDates.map(o => o.s.t))}.`));
    }
    // 3. Séance devenue complète : prévenir ceux qui ont le spectacle en favori (et n'y vont pas déjà)
    for (const s of SHOWS) {
      if (!old[s.id]) continue;
      const nowFull = (s.full || []).filter(x => future(x) && !old[s.id].full.includes(x)).sort();
      if (!nowFull.length) continue;
      const fans = tokens.filter(t => (t.favs || []).includes(s.id) && !(t.plans || []).some(p => p.startsWith(s.id + "|"))).map(t => t.token);
      if (!fans.length) continue;
      const left = s.sessions.filter(x => future(x) && !(s.full || []).includes(x)).sort().slice(0, 2);
      add("complet", fans, `${s.t} : ça part vite !`,
        cut(`${nowFull.length > 1 ? "Les séances du " + listFr(nowFull.map(x => fmtSes(Y, x))) + " sont complètes" : "La séance du " + fmtSes(Y, nowFull[0]) + " est complète"}. ` +
          (left.length ? `Il reste des places le ${listFr(left.map(x => fmtSes(Y, x)))}.` : "Toutes les séances sont maintenant complètes.")), s.id);
    }
    // 3 bis. Place libérée : la mention « complet » a disparu → ceux qui ont demandé à être prévenus
    for (const s of SHOWS) {
      if (!old[s.id]) continue;
      const freed = old[s.id].full.filter(x => future(x) && s.sessions.includes(x) && !(s.full || []).includes(x));
      for (const x of freed) {
        const k = s.id + "|" + x, who = tokens.filter(t => (t.alerts || []).includes(k)).map(t => t.token);
        if (who.length) add("libere", who, `${s.t} : une place s'est libérée !`, `La séance du ${fmtSes(Y, x)} n'est plus complète. Réservez vite dans l'appli !`, s.id);
      }
    }
  }

  // 4. Le jour J, environ 1 h avant : « Dans 1 h : … » (une seule fois par téléphone et par séance)
  const sent = Object.fromEntries(Object.entries(next.sentJ || {}).filter(([, d]) => d >= addDays(today, -2)));
  const n = mins(nowT);
  for (const t of tokens) {
    if (!remOn(t, "jourj")) continue;
    for (const k of t.plans || []) {
      const [id, x] = k.split("|"), s = byId[id];
      if (!s || !x) continue;
      const z = ses(Y, x), d = mins(z.time) - n, key = t.id + "|" + k;
      if (z.day !== today || d <= 40 || d > 100 || sent[key]) continue;
      sent[key] = today;
      add("jourj", [t.token], `Dans 1 h : ${s.t}`, `Rendez-vous à ${fmtTime(z.time)} au Théâtre du Chariot, 77 rue de Montreuil (Paris 11e). Bon spectacle !`, s.id);
    }
  }
  next.sentJ = sent;

  // 5. Chaque matin (à partir de 10h, une seule fois par jour)
  if (now.hour >= 10 && now.hour < 20 && next.lastDaily !== today) {
    next.lastDaily = today;
    const tomorrow = addDays(today, 1), yesterday = addDays(today, -1);
    // Rappel « Demain… »
    for (const t of tokens) {
      if (!remOn(t, "veille")) continue;
      const mine = (t.plans || []).map(k => k.split("|")).filter(([id, x]) => byId[id] && x && ses(Y, x).day === tomorrow).sort((a, b) => a[1].localeCompare(b[1]));
      if (!mine.length) continue;
      const [id, x] = mine[0], s = byId[id];
      add("demain", [t.token], `Demain ${fmtTime(ses(Y, x).time)} : ${s.t}`,
        mine.length > 1 ? `Et aussi ${listFr(mine.slice(1).map(([i, y]) => `${byId[i].t} à ${fmtTime(ses(Y, y).time)}`))}. À demain au Chariot, 77 rue de Montreuil !` : "À demain au Théâtre du Chariot, 77 rue de Montreuil (Paris 11e) !", id);
    }
    // « Vous avez aimé ? » le lendemain de la séance (sauf avis déjà donné)
    for (const t of tokens) {
      if (!remOn(t, "avis")) continue;
      const rated = ((votes[t.id] || {}).ratings) || {};
      const seen = [...new Set((t.plans || []).map(k => k.split("|")).filter(([id, x]) => byId[id] && x && ses(Y, x).day === yesterday).map(([id]) => id))].filter(id => !rated[id]);
      if (!seen.length) continue;
      const s = byId[seen[0]];
      add("avis", [t.token], `Vous avez aimé ${s.t} ?`, "Donnez votre avis en deux secondes : il sera transmis à la compagnie, sans votre nom.", s.id);
    }
    // Dernières dates : un spectacle (plus de 2 séances au total) dont il ne reste que 1 ou 2 séances
    // avec des places → une seule fois par spectacle, à tous sauf ceux qui y vont déjà.
    next.lastCall = { ...(next.lastCall || {}) };
    const lastCalls = SHOWS.filter(s => s.sessions.length > 2 && !next.lastCall[s.id]).map(s => ({ s, left: s.sessions.filter(x => future(x)).sort(), open: s.sessions.filter(x => future(x) && !(s.full || []).includes(x)).sort() }))
      .filter(o => o.left.length >= 1 && o.left.length <= 2 && o.open.length);
    for (const o of lastCalls) {
      next.lastCall[o.s.id] = today;
      const who = tokens.filter(t => !(t.plans || []).some(k => k.startsWith(o.s.id + "|"))).map(t => t.token);
      if (who.length) add("dernieres", who, `Dernières dates pour ${o.s.t} !`, cut(o.left.length === 1 ? `Dernière représentation le ${fmtSes(Y, o.left[0])}. Ne la manquez pas !` : `Plus que deux représentations : ${listFr(o.left.map(x => fmtSes(Y, x)))}. Ne les manquez pas !`), o.s.id);
    }
    // Le lundi : récap de la semaine (aujourd'hui → lundi prochain inclus, comme « À l'affiche »)
    if (now.weekday === 1 && next.lastWeekly !== today) {
      next.lastWeekly = today;
      const end = addDays(today, 7);
      const week = SHOWS.filter(s => s.sessions.some(x => { const d = ses(Y, x).day; return d >= today && d <= end; }));
      if (week.length) add("recap", "all", "Cette semaine au Chariot", cut(`${listFr(week.map(s => s.t))}. Réservez dans l'appli !`));
    }
  }
  return { messages, state: next };
}

// Destinataires d'un message écrit par l'équipe
export function targetsOf(envoi, tokens) {
  const c = envoi.cible || {};
  if (c.type === "spectacle") return tokens.filter(t => (t.favs || []).includes(c.id) || (t.plans || []).some(k => k.startsWith(c.id + "|"))).map(t => t.token);
  if (c.type === "appareil") return typeof c.token === "string" && c.token ? [c.token] : [];
  if (c.type === "seance") return tokens.filter(t => (t.plans || []).includes(c.id + "|" + c.x)).map(t => t.token);
  return tokens.map(t => t.token);
}

// ---------- envoi ----------
const note = m => console.log("::notice::" + m);
async function main() {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key) { console.log("Clé FIREBASE_SERVICE_ACCOUNT absente : aucune notification envoyée."); return; }
  const admin = (await import("firebase-admin")).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
  const db = admin.firestore(), fcm = admin.messaging(), FV = admin.firestore.FieldValue;
  const test = process.env.NOTIF_TEST === "true", rappel = process.env.NOTIF_RAPPEL === "true";

  const { SHOWS, Y } = loadShows();
  // Séances complètes cochées par l'équipe sur la page admin
  try { applyComplets(SHOWS, ((await db.doc("config/complets").get()).data() || {}).full || {}); } catch (e) { console.log("Séances complètes non lues : " + e.message); }
  const ref = db.doc("etat/notifs");
  const snapState = await ref.get();
  const state = snapState.exists ? snapState.data() : null;
  const now = parisNow();
  const todo = due({ SHOWS, Y, state, now });
  const pending = (await db.collection("envois").where("statut", "==", "en attente").get()).docs;

  // Surveillance de la synchro horaire : synchro.json est réécrit à chaque passage de la synchro
  const alerts = [];
  let syncInfo = null;
  try { syncInfo = JSON.parse(fs.readFileSync("site/synchro.json", "utf8")); } catch (e) {}
  const nextState0 = { ...(state || {}) };
  if (syncInfo && syncInfo.at) {
    const ageH = (Date.now() - Date.parse(syncInfo.at)) / 36e5;
    const bad = ageH > 3 || syncInfo.ok === false;
    const lastA = nextState0.syncAlertAt ? (Date.now() - Date.parse(nextState0.syncAlertAt)) / 36e5 : 1e9;
    if (bad && lastA > 12) {
      alerts.push({ title: "⚠️ Appli du Chariot : synchro en panne", body: syncInfo.ok === false ? cut(`Dernier passage en erreur : ${syncInfo.detail || "erreur inconnue"}`) : `Le programme n'a pas été vérifié depuis ${Math.floor(ageH)} h. L'appli peut être en retard sur le site.` });
      nextState0.syncAlertAt = new Date().toISOString(); nextState0.syncBad = true;
    } else if (!bad && nextState0.syncBad) {
      alerts.push({ title: "✅ Appli du Chariot : synchro rétablie", body: "Le programme est de nouveau vérifié toutes les heures." });
      nextState0.syncBad = false; delete nextState0.syncAlertAt;
    }
  }

  // Billetterie : quand le programme change (ou une fois par jour), on y ajoute les nouvelles représentations
  try {
    const sig = JSON.stringify(SHOWS.map(s => [s.t, s.sessions]));
    if (nextState0.billetSig !== sig || nextState0.billetDay !== now.day) {
      const col = db.collection("billetterie").doc("main").collection("spectacles");
      const existing = (await col.get()).docs.map(d => d.data());
      const add = billetToAdd({ SHOWS, Y, existing, today: now.day });
      for (const r of add) await col.add({ ...r, creeLe: new Date().toISOString() });
      if (add.length) note(`Billetterie : ${add.length} représentation(s) ajoutée(s) depuis le programme (${[...new Set(add.map(r => r.titre))].join(", ")}).`);
      nextState0.billetSig = sig; nextState0.billetDay = now.day;
    }
  } catch (e) { console.log("Billetterie non synchronisée : " + e.message); }

  if (!todo.changed && !todo.daily && !todo.jourj && !pending.length && !alerts.length && !test && !rappel) {
    if (JSON.stringify(nextState0) !== JSON.stringify(state || {})) await ref.set(nextState0);
    console.log("Rien à envoyer.");
    return;
  }

  const tokDocs = (await db.collection("tokens").get()).docs;
  const tokens = tokDocs.map(d => ({ id: d.id, ...d.data() })).filter(t => typeof t.token === "string" && t.token);
  const all = [...new Set(tokens.map(t => t.token))];
  let votes = {};
  if (todo.daily) votes = Object.fromEntries((await db.collection("votes").get()).docs.map(d => [d.id, d.data()]));

  const { messages, state: next } = plan({ SHOWS, Y, state: state ? { ...state, ...nextState0 } : null, tokens, now, votes });
  if (!state) { console.log("Premier passage : programme mémorisé, rien n'est annoncé."); messages.length = 0; }

  // Messages de l'équipe (page des statistiques)
  for (const d of pending) {
    const e = d.data();
    messages.push({ kind: "e:" + d.id, envoi: d.ref, to: targetsOf(e, tokens), title: cut(String(e.titre || "Théâtre du Chariot"), 80), body: cut(String(e.texte || ""), 240), link: linkFor("e:" + d.id, e.cible && e.cible.id) });
  }
  // Lancements manuels d'essai
  if (rappel) {
    const byId = Object.fromEntries(SHOWS.map(s => [s.id, s]));
    for (const t of tokens) {
      const nx = (t.plans || []).map(k => k.split("|")).filter(([id, x]) => byId[id] && x && `${Y}-${x}` >= `${now.day} ${now.time}`).sort((a, b) => a[1].localeCompare(b[1]))[0];
      if (nx) messages.push({ kind: "test", to: [t.token], title: `Demain ${fmtTime(nx[1].slice(6))} : ${byId[nx[0]].t}`, body: "À demain au Théâtre du Chariot, 77 rue de Montreuil (Paris 11e) !", link: linkFor("test", nx[0]) });
    }
  }
  if (test) messages.unshift({ kind: "test", to: "all", title: "Test du Chariot", body: "Les notifications automatiques fonctionnent. À bientôt au théâtre !", link: linkFor("test") });
  let adminDocs = [];
  // Alertes techniques : appareils de l'équipe (collection admins)
  if (alerts.length) {
    adminDocs = (await db.collection("admins").get()).docs;
    const adminTokens = adminDocs.map(d => d.get("token")).filter(Boolean);
    for (const a of alerts) if (adminTokens.length) messages.push({ kind: "alerte", to: adminTokens, title: a.title, body: a.body, link: APP + "admin.html" });
    note(`Surveillance : ${alerts.map(a => a.title).join(" / ")} → ${adminTokens.length} appareil(s) de l'équipe`);
  }
  note(`${all.length} téléphone(s) abonné(s), ${messages.length} message(s) à envoyer.`);

  const dead = new Set(), sentBy = {};
  for (const m of messages) {
    const to = m.to === "all" ? all : [...new Set(m.to)];
    let ok = 0, ko = 0; const errs = {};
    for (let i = 0; i < to.length; i += 500) {
      const batch = to.slice(i, i + 500);
      const res = await fcm.sendEachForMulticast({
        tokens: batch,
        notification: { title: m.title, body: m.body },
        webpush: { notification: { icon: APP + "icon-192.png", badge: APP + "badge-96.png" }, fcmOptions: { link: m.link || APP } }
      });
      ok += res.successCount; ko += res.failureCount;
      res.responses.forEach((r, j) => {
        const c = r.error && r.error.code;
        if (c) errs[c] = (errs[c] || 0) + 1;
        if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token" || c === "messaging/invalid-argument") dead.add(batch[j]);
      });
    }
    const k = m.kind.startsWith("e:") ? "equipe" : m.kind;
    sentBy[k] = (sentBy[k] || 0) + ok;
    if (m.envoi) await m.envoi.update({ statut: "envoyé", envoyes: ok, echecs: ko, envoyeLe: FV.serverTimestamp() }).catch(() => {});
    note(`« ${m.title} » : ${ok} envoyé(s), ${ko} échec(s)${ko ? " (" + Object.entries(errs).map(([k, v]) => k.replace("messaging/", "") + " ×" + v).join(", ") + ")" : ""}.`);
  }
  // Téléphones désabonnés : on efface leur adresse de notification
  for (const d of [...tokDocs, ...adminDocs]) if (dead.has(d.get("token"))) await d.ref.delete().catch(() => {});
  if (dead.size) console.log(`${dead.size} adresse(s) périmée(s) effacée(s).`);

  // Statistiques du jour (lues par la page admin)
  const st = { jour: now.day };
  if (todo.daily) { st.abonnes = all.length; st.espaces = Object.keys(votes).length; st.avis = Object.values(votes).reduce((a, v) => a + Object.keys(v.ratings || {}).length, 0); }
  for (const [k, v] of Object.entries(sentBy)) if (v) st["envoyes_" + k] = FV.increment(v);
  if (Object.keys(st).length > 1) await db.doc("stats/" + now.day).set(st, { merge: true });

  await ref.set(next);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
