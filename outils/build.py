#!/usr/bin/env python3
"""Reconstruit la version Netlify (site/index.html et site/shows.js) à partir de
l'appli publiée sur claude.ai.

Utilisation :  python3 outils/build.py chemin/vers/artefact.html

- Le programme (SITE, BILLET, Y, SHOWS) et les profils de recommandation (PROFIL)
  sont extraits dans site/shows.js.
- Les affiches du site Wix (champ img) sont activées (REMOTE_IMG = true).
- Le texte de confidentialité est adapté : la version Netlify envoie les favoris
  et les « J'y vais » de façon anonyme (Firebase).
- La proposition d'installation (outils/install.html) et celle des notifications (outils/notifs.html) sont ajoutées.
- site/firebase-config.js, site/admin.html, site/sw.js et site/posters/ ne sont jamais modifiés.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
SITE = ROOT / "site"


def cut(text, start, end_marker):
    """Retire de text le bloc qui commence à start et finit à end_marker (inclus)."""
    a = text.index(start)
    b = text.index(end_marker, a) + len(end_marker)
    return text[:a] + text[b:], text[a:b]


def main(src_path):
    src = pathlib.Path(src_path).read_text(encoding="utf-8")

    # 1. Retirer l'enveloppe ajoutée par claude.ai : la page commence à <title>
    body = src[src.index("<title>"):]
    body = re.sub(r"</body>\s*</html>\s*$", "", body.rstrip()) + "\n"

    # 2. Séparer l'en-tête (title, polices, style) du reste
    j = body.index("</style>") + len("</style>")
    head, rest = body[:j], body[j:]

    # 3. Extraire les données : programme puis profils
    a = rest.index("const SITE=")
    b = rest.index("const MOIS=")
    data = rest[a:b].rstrip() + "\n"
    rest = rest[:a] + rest[b:]
    rest, profil = cut(rest, "const PROFIL={", "\n};")
    shows_js = (
        "// Programme du Théâtre du Chariot — fichier généré automatiquement par outils/build.py\n"
        "// à partir de l'appli publiée sur claude.ai. Ne pas modifier à la main : vos changements\n"
        "// seraient écrasés à la prochaine mise à jour.\n"
        + data + "\n" + profil + "\n"
    )

    # 4. Activer les affiches du site Wix
    rest = rest.replace("const REMOTE_IMG=false;", "const REMOTE_IMG=true;")

    # 5. Textes de confidentialité adaptés à l'envoi anonyme
    swaps = [
        ("Pas de mot de passe : vos informations restent sur ce téléphone et ne sont envoyées à personne.",
         "Pas de mot de passe. Votre nom et votre prénom restent sur ce téléphone. Le théâtre reçoit seulement, de façon anonyme, vos favoris et vos « J'y vais »."),
        ('<h2 id="welcome-title">Vos données restent chez vous</h2>',
         '<h2 id="welcome-title">Vos données personnelles restent chez vous</h2>'),
        ("<p>Cette application ne collecte aucune donnée personnelle.</p>",
         "<p>Cette application ne collecte aucune donnée personnelle : ni nom, ni e-mail, ni numéro de téléphone.</p>"),
        ("pas de publicité ni de suivi.", "pas de publicité ni de traceur publicitaire."),
        ("vos nom, prénom, favoris et séances notées sont enregistrés <b>uniquement sur ce téléphone</b>. Ils ne sont envoyés ni au théâtre ni à personne.</li>",
         "vos nom et prénom sont enregistrés <b>uniquement sur ce téléphone</b>.</li>\n      <li>Vos favoris et vos « J'y vais » sont transmis au théâtre <b>de façon anonyme</b> (sans nom, avec un identifiant technique aléatoire), pour savoir quels spectacles intéressent le public. Supprimer votre espace efface aussi ces données.</li>"),
    ]
    for old, new in swaps:
        rest = rest.replace(old, new)

    # 6. Branchement de l'envoi anonyme (Firebase)
    rest = rest.replace(
        'function saveAcct(){try{localStorage.setItem("chariot-compte",JSON.stringify(acct));storeOK=true}catch(e){storeOK=false}}',
        'function saveAcct(){try{localStorage.setItem("chariot-compte",JSON.stringify(acct));storeOK=true}catch(e){storeOK=false}if(window.chariotSync)window.chariotSync()}\n'
        'window.chariotState=()=>hasAcct()?{favs:acct.favs.slice(),plans:acct.plans.slice()}:null;')
    rest = rest.replace('try{localStorage.removeItem("chariot-compte")}catch(err){}',
                        'try{localStorage.removeItem("chariot-compte")}catch(err){}if(window.chariotSync)window.chariotSync();')
    if "window.chariotState" not in rest:
        sys.exit("Erreur : impossible de brancher l'envoi anonyme (saveAcct introuvable).")

    firebase = (SITE.parent / "outils" / "firebase-sync.html").read_text(encoding="utf-8")
    k = rest.index("<script>\n")
    rest = rest[:k] + '<script src="firebase-config.js"></script>\n<script src="shows.js"></script>\n' + firebase + rest[k:]

    # Notifications de l'équipe : proposition affichée sous l'en-tête
    notifs = (SITE.parent / "outils" / "notifs.html").read_text(encoding="utf-8")
    if "</header>" not in rest:
        sys.exit("Erreur : en-tête introuvable pour les notifications.")
    rest = rest.replace("</header>", "</header>\n" + notifs, 1)

    # Proposition d'installation (Android : bouton Installer ; iPhone : explications)
    install = (SITE.parent / "outils" / "install.html").read_text(encoding="utf-8")

    html = (
        '<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n'
        '<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icon-192.png">\n'
        '<meta name="apple-mobile-web-app-capable" content="yes">\n'
        # Règles de base fournies par claude.ai autour de l'artefact, à reproduire ici :
        # sans [hidden]{display:none}, les fenêtres (message d'accueil…) ne se ferment pas.
        '<style>:root{box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}'
        'html{scroll-padding-top:env(safe-area-inset-top,0px)}img{max-width:100%}[hidden]{display:none!important}</style>\n'
        + head + "\n</head>\n<body>\n" + rest + install + "</body>\n</html>\n"
    )
    html = html.replace("body{background:var(--bg)", "body{margin:0;background:var(--bg)", 1)

    (SITE / "index.html").write_text(html, encoding="utf-8")
    (SITE / "shows.js").write_text(shows_js, encoding="utf-8")
    print("OK : site/index.html et site/shows.js régénérés.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
