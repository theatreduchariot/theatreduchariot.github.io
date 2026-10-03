# Mettre en ligne l'appli du Théâtre du Chariot

> **Octobre 2026 : l'appli est maintenant hébergée sur GitHub Pages**, à l'adresse
> https://rgo071028-collab.github.io/appli-chariot/ (statistiques : …/appli-chariot/admin.html).
> Le forfait gratuit de Netlify ne permet qu'une vingtaine de mises en ligne par mois, trop peu pour la synchro horaire.
> La mise en ligne est faite par `.github/workflows/pages.yml` à chaque mise à jour de la branche `main`.
> Les étapes Netlify ci-dessous ne servent plus ; dans Firebase, le domaine autorisé est `rgo071028-collab.github.io`.


Ce dossier contient :

- `outils/` : le programme qui reconstruit la version Netlify à partir de l'appli publiée sur claude.ai.
- `netlify.toml` : indique à Netlify de publier le dossier `site`.
- `site/` : l'application à mettre en ligne (`index.html`), la page de statistiques (`admin.html`), le programme (`shows.js`), les affiches (`posters/`), l'icône de l'écran d'accueil et la configuration (`firebase-config.js`).
- `firestore.rules` : les règles de sécurité de la base de données, à coller dans Firebase.

Les spectateurs gardent leur nom et prénom sur leur téléphone. L'appli envoie seulement, de façon anonyme, leurs favoris et leurs « J'y vais ». La page admin en fait le total par spectacle et par séance.

Comptez environ 30 minutes. Vous n'avez besoin que d'un navigateur et d'un compte Google.

---

## Étape 1 : créer le projet Firebase (gratuit)

1. Allez sur https://console.firebase.google.com et connectez-vous avec le compte Google du théâtre.
2. Cliquez sur **Créer un projet**. Nommez-le par exemple `chariot-appli`. Vous pouvez désactiver Google Analytics.
3. Le plan gratuit (Spark) suffit largement.

## Étape 2 : activer la connexion

1. Dans le menu de gauche : **Créer > Authentication > Commencer**.
2. Onglet **Mode de connexion** : activez **Anonyme**, puis enregistrez.
3. Activez aussi **Google** (adresse e-mail d'assistance : celle du théâtre), puis enregistrez. Ce mode sert uniquement à vous connecter à la page admin.

## Étape 3 : créer la base de données

1. Menu de gauche : **Créer > Firestore Database > Créer une base de données**.
2. Emplacement : **europe-west9 (Paris)** ou un autre emplacement en Europe.
3. Choisissez **Démarrer en mode production**.
4. Ouvrez l'onglet **Règles**. Effacez tout, collez le contenu du fichier `firestore.rules`, puis cliquez sur **Publier**.
5. **Important :** dans les règles, l'adresse administrateur est `lechariot.contact@gmail.com`. Si vous voulez consulter les chiffres avec une autre adresse Google, remplacez-la avant de publier.

## Étape 4 : récupérer la configuration

1. Cliquez sur la roue dentée en haut à gauche, puis **Paramètres du projet**.
2. En bas, dans **Vos applications**, cliquez sur l'icône **Web** `</>`. Nommez l'appli `chariot-web` et ne cochez pas « Hosting ».
3. Firebase affiche un bloc `const firebaseConfig = { ... }`. Le plus simple : **copiez ce bloc et envoyez-le à Claude**, qui le mettra dans `site/firebase-config.js`.
4. Sinon, sur github.com, ouvrez `site/firebase-config.js` dans le dépôt, cliquez sur le crayon (Edit), remplacez chaque `A_REMPLACER` par la valeur correspondante en gardant les guillemets, puis **Commit changes**.

Ces valeurs ne sont pas secrètes. Ce sont les règles de l'étape 3 qui protègent les données.

## Étape 5 : relier Netlify à GitHub

1. Sur https://app.netlify.com, cliquez sur **Add new site** puis **Import an existing project**.
2. Choisissez **GitHub**, autorisez Netlify, puis sélectionnez le dépôt `appli-chariot`.
3. Netlify lit tout seul le fichier `netlify.toml` (dossier publié : `site`). Ne changez rien et cliquez sur **Deploy**.
4. Netlify donne une adresse du type `https://nom-au-hasard.netlify.app`. Vous pouvez la renommer dans **Site configuration > Change site name**, par exemple `theatreduchariot`.

Si vous aviez déjà un site Netlify créé par glisser-déposer, vous pouvez le supprimer ou le garder : c'est ce nouveau site, relié à GitHub, qui se mettra à jour tout seul.

## Étape 6 : autoriser l'adresse du site dans Firebase

1. Firebase > **Authentication > Paramètres > Domaines autorisés**.
2. Cliquez sur **Ajouter un domaine** et collez votre adresse Netlify sans `https://`, par exemple `theatreduchariot.netlify.app`.

## C'est prêt

- **L'appli publique :** `https://votre-site.netlify.app`. Partagez ce lien, ou mettez-le sur le site Wix et sur Instagram. Sur téléphone : menu du navigateur > « Ajouter à l'écran d'accueil ».
- **Les statistiques :** `https://votre-site.netlify.app/admin.html`. Connectez-vous avec l'adresse Google administrateur. Les autres personnes verront « Accès refusé ».

Pour tester, créez un espace dans l'appli, ajoutez un favori, puis ouvrez la page admin : il doit apparaître.

---

## Mises à jour automatiques

Toutes les heures, Claude compare le site du théâtre avec l'appli, met à jour l'appli publiée sur claude.ai, puis régénère `site/index.html` et `site/shows.js` dans ce dépôt avec `outils/build.py`. Netlify voit le changement et remet le site en ligne tout seul, en une minute environ.

- **Nouveaux spectacles, dates, séances complètes :** automatique. Pour bloquer une date, écrivez « COMPLET » à côté de la date sur la fiche du spectacle, dans le site Wix.
- **Affiches :** les affiches de `site/posters/` sont utilisées en priorité. Pour un nouveau spectacle, l'appli affiche directement l'image publiée sur le site Wix.
- **Ne modifiez pas à la main** `site/index.html` ni `site/shows.js` : ils sont régénérés à chaque mise à jour. Les fichiers `site/firebase-config.js`, `site/admin.html` et `site/posters/` ne sont jamais touchés.

## RGPD

Aucune donnée nominative n'est envoyée. Les chiffres sont anonymes : un identifiant technique aléatoire par téléphone, avec ses favoris et ses séances notées. L'appli l'indique au moment de la création de l'espace. Faites tout de même relire ce texte par la personne qui suit ces questions au théâtre.
