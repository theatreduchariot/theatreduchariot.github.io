// Notifications automatiques de l'appli du Chariot.
// Lancé par GitHub Actions (.github/workflows/notifs.yml) :
//  - à chaque mise à jour du programme (site/shows.js) : nouveau spectacle, nouvelles dates, séance complète ;
//  - chaque matin : rappel « demain » pour les « J'y vais », et le lundi le récap de la semaine.
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
function fmtDay(day) { const t = new Date(day + "T12:00:00Z"); return `${JOURS[t.getUTCDay()]} ${t.getUTCDate() === 1 ? "1er" : t.getUTCDate()} ${MOIS[t.getUTCMonth()]}`; }
const fmtTime = t => t.replace(":", "h").replace(/h00$/, "h");
const fmtSes = (Y, x) => { const s = ses(Y, x); return `${fmtDay(s.day)} ${fmtTime(s.time)}`; };
const listFr = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " et " + a[a.length - 1];
const cut = (s, n = 170) => s.length > n ? s.slice(0, n - 1) + "…" : s;

// ---------- programme ----------
export function loadShows(path = "site/shows.js") {
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path, "utf8") + "\n;this.SHOWS=SHOWS;this.Y=Y;", ctx);
  return { SHOWS: ctx.SHOWS.filter(s => !s.arch && Array.isArray(s.sessions)), Y: ctx.Y };
}

// ---------- calcul des messages (sans réseau, testable) ----------
// tokens : [{ id, token, favs:[], plans:["id|MM-JJ HH:MM"] }]
// Renvoie { messages:[{ title, body, to: "all" | [token,...] }], state }
export function plan({ SHOWS, Y, state, tokens, now }) {
  const today = now.day, nowT = now.time || "00:00";
  const future = x => { const s = ses(Y, x); return s.day > today || (s.day === today && s.time > nowT); };
  const messages = [];
  const snap = Object.fromEntries(SHOWS.map(s => [s.id, { sessions: [...s.sessions], full: [...(s.full || [])] }]));
  const next = { ...(state || {}), shows: snap };

  if (state && state.shows) {
    const old = state.shows;
    // 1. Nouveaux spectacles
    const added = SHOWS.filter(s => !old[s.id] && s.sessions.some(future));
    if (added.length === 1) {
      const s = added[0], first = s.sessions.filter(future).sort()[0];
      messages.push({ to: "all", title: `Nouveau au Chariot : ${s.t}`, body: cut(`${s.genre ? s.genre + " · " : ""}à partir du ${fmtSes(Y, first)}. ${s.d || ""}`) });
    } else if (added.length > 1) {
      messages.push({ to: "all", title: `${added.length} nouveaux spectacles au Chariot`, body: cut(listFr(added.map(s => s.t)) + ". Découvrez-les dans l'appli !") });
    }
    // 2. Nouvelles dates pour un spectacle déjà annoncé
    const newDates = SHOWS.filter(s => old[s.id]).map(s => ({ s, xs: s.sessions.filter(x => future(x) && !old[s.id].sessions.includes(x)).sort() })).filter(o => o.xs.length);
    if (newDates.length === 1 || newDates.length === 2) {
      for (const { s, xs } of newDates) {
        const shown = xs.slice(0, 3).map(x => fmtSes(Y, x));
        messages.push({ to: "all", title: `${s.t} : nouvelles dates`, body: cut(listFr(shown) + (xs.length > 3 ? ` (+ ${xs.length - 3} autres)` : "") + ".") });
      }
    } else if (newDates.length > 2) {
      messages.push({ to: "all", title: "Nouvelles dates au Chariot", body: cut(`Nouvelles représentations pour ${listFr(newDates.map(o => o.s.t))}.`) });
    }
    // 3. Séance devenue complète : prévenir ceux qui ont le spectacle en favori (et n'y vont pas déjà)
    for (const s of SHOWS) {
      if (!old[s.id]) continue;
      const nowFull = (s.full || []).filter(x => future(x) && !old[s.id].full.includes(x)).sort();
      if (!nowFull.length) continue;
      const fans = tokens.filter(t => (t.favs || []).includes(s.id) && !(t.plans || []).some(p => p.startsWith(s.id + "|"))).map(t => t.token);
      if (!fans.length) continue;
      const left = s.sessions.filter(x => future(x) && !(s.full || []).includes(x)).sort().slice(0, 2);
      messages.push({
        to: fans, title: `${s.t} : ça part vite !`,
        body: cut(`${nowFull.length > 1 ? "Les séances du " + listFr(nowFull.map(x => fmtSes(Y, x))) + " sont complètes" : "La séance du " + fmtSes(Y, nowFull[0]) + " est complète"}. ` +
          (left.length ? `Il reste des places le ${listFr(left.map(x => fmtSes(Y, x)))}.` : "Toutes les séances sont maintenant complètes."))
      });
    }
  }

  // 4. Chaque matin (entre 9h et 20h, une seule fois par jour) : rappel « demain »
  if (now.hour >= 9 && now.hour < 20 && next.lastDaily !== today) {
    next.lastDaily = today;
    const tomorrow = addDays(today, 1), byId = Object.fromEntries(SHOWS.map(s => [s.id, s]));
    for (const t of tokens) {
      const mine = (t.plans || []).map(k => k.split("|")).filter(([id, x]) => byId[id] && x && ses(Y, x).day === tomorrow).sort((a, b) => a[1].localeCompare(b[1]));
      if (!mine.length) continue;
      const [id, x] = mine[0], s = byId[id];
      messages.push({
        to: [t.token], title: `Demain ${fmtTime(ses(Y, x).time)} : ${s.t}`,
        body: mine.length > 1 ? `Et aussi ${listFr(mine.slice(1).map(([i, y]) => `${byId[i].t} à ${fmtTime(ses(Y, y).time)}`))}. À demain au Chariot, 77 rue de Montreuil !` : "À demain au Théâtre du Chariot, 77 rue de Montreuil (Paris 11e) !"
      });
    }
    // 5. Le lundi : récap de la semaine (aujourd'hui → lundi prochain inclus, comme « À l'affiche »)
    if (now.weekday === 1 && next.lastWeekly !== today) {
      next.lastWeekly = today;
      const end = addDays(today, 7);
      const week = SHOWS.filter(s => s.sessions.some(x => { const d = ses(Y, x).day; return d >= today && d <= end; }));
      if (week.length) messages.push({ to: "all", title: "Cette semaine au Chariot", body: cut(`${listFr(week.map(s => s.t))}. Réservez dans l'appli !`) });
    }
  }
  return { messages, state: next };
}

// ---------- envoi ----------
const note = m => console.log("::notice::" + m);
async function main() {
  const key = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!key) { console.log("Clé FIREBASE_SERVICE_ACCOUNT absente : aucune notification envoyée."); return; }
  const admin = (await import("firebase-admin")).default;
  admin.initializeApp({ credential: admin.credential.cert(JSON.parse(key)) });
  const db = admin.firestore(), fcm = admin.messaging();

  const { SHOWS, Y } = loadShows();
  const ref = db.doc("etat/notifs");
  const snapState = await ref.get();
  const state = snapState.exists ? snapState.data() : null;
  const tokDocs = (await db.collection("tokens").get()).docs;
  const tokens = tokDocs.map(d => ({ id: d.id, ...d.data() })).filter(t => typeof t.token === "string" && t.token);
  const all = [...new Set(tokens.map(t => t.token))];
  note(`Collection tokens : ${tokDocs.length} document(s) ; champs : ${tokDocs.map(d => Object.keys(d.data()).join(",") + (typeof d.get("token") === "string" ? " (token " + d.get("token").length + " car.)" : "")).join(" / ")}`);

  const now = parisNow();
  const { messages, state: next } = plan({ SHOWS, Y, state, tokens, now });
  // Lancement manuel « test » : un message d'essai à tous les abonnés, en plus du reste.
  if (process.env.NOTIF_TEST === "true") messages.unshift({ to: "all", title: "Test du Chariot", body: "Les notifications automatiques fonctionnent. À bientôt au théâtre !" });
  if (!state) console.log("Premier passage : programme mémorisé, rien n'est annoncé.");
  note(`${all.length} téléphone(s) abonné(s), ${messages.length} message(s) à envoyer. test=${process.env.NOTIF_TEST}`);

  const dead = new Set();
  for (const m of messages) {
    const to = m.to === "all" ? all : [...new Set(m.to)];
    for (let i = 0; i < to.length; i += 500) {
      const batch = to.slice(i, i + 500);
      const res = await fcm.sendEachForMulticast({
        tokens: batch,
        notification: { title: m.title, body: m.body },
        webpush: { notification: { icon: APP + "icon-192.png" }, fcmOptions: { link: APP } }
      });
      res.responses.forEach((r, j) => {
        const c = r.error && r.error.code;
        if (c === "messaging/registration-token-not-registered" || c === "messaging/invalid-registration-token" || c === "messaging/invalid-argument") dead.add(batch[j]);
      });
      const errs = [...new Set(res.responses.filter(r => r.error).map(r => r.error.code + " " + r.error.message))].join(" | ");
      note(`« ${m.title} » : ${res.successCount} envoyé(s), ${res.failureCount} échec(s). ${errs}`);
    }
  }
  // Téléphones désabonnés : on efface leur adresse de notification
  for (const d of tokDocs) if (dead.has(d.get("token"))) await d.ref.delete().catch(() => {});
  if (dead.size) console.log(`${dead.size} adresse(s) périmée(s) effacée(s).`);
  await ref.set(next);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error(e); process.exit(1); });
}
