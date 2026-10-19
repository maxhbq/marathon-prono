# Publier Les 18 Bornes sur Firebase

Cette version utilise **Firebase Hosting + Cloud Firestore + Firebase Authentication**. Aucun serveur Node, Cloud Function, Firebase Storage, Google Analytics ou service payant n’est nécessaire au fonctionnement du site. Elle vise les quotas gratuits du plan Spark ; surveiller les quotas dans la console. Le développement et la compilation nécessitent Node 24.

## 1. Compléter le .env

Le fichier `.env` est déjà créé dans l’environnement cloud et ignoré par Git. Il n’est donc pas envoyé sur GitHub. Après avoir récupéré le dépôt sur ton ordinateur, crée ton exemplaire local à partir du modèle :

```sh
git clone https://github.com/maxhbq/marathon-prono.git
cd marathon-prono
cp .env.example .env
```

Sous Windows PowerShell, remplacer la dernière commande par `Copy-Item .env.example .env`, puis ouvrir le fichier avec `notepad .env`. Sur les autres systèmes, l’ouvrir avec un éditeur de texte, par exemple VS Code. Ne pas recréer ce fichier si tu as déjà renseigné des valeurs : modifier l’exemplaire existant.

Le modèle contient les deux valeurs connues :

```dotenv
FIREBASE_API_KEY=
FIREBASE_AUTH_DOMAIN=marathon-prono.firebaseapp.com
FIREBASE_PROJECT_ID=marathon-prono
FIREBASE_APP_ID=
FIREBASE_MESSAGING_SENDER_ID=
FIREBASE_USE_EMULATORS=false
FIREBASE_HOSTING_SITE=
```

Dans la console Firebase, ouvrir **Paramètres du projet → Général → Vos applications → Application Web → Configuration du SDK**. Si aucune application Web n’existe, en ajouter une avec l’icône `</>`.

| Configuration SDK | Champ du .env | Nécessaire |
| --- | --- | --- |
| `apiKey` | `FIREBASE_API_KEY` | Oui |
| `authDomain` | `FIREBASE_AUTH_DOMAIN` | Oui, déjà renseigné |
| `projectId` | `FIREBASE_PROJECT_ID` | Oui, déjà renseigné |
| `appId` | `FIREBASE_APP_ID` | Oui |
| `messagingSenderId` | `FIREBASE_MESSAGING_SENDER_ID` | Facultatif |
| `storageBucket` | Aucun | Non : les photos sont dans Firestore |
| `measurementId` | Aucun | Non : pas d’Analytics |

Coller uniquement les valeurs, sans la syntaxe JavaScript `apiKey:`, les virgules ou les accolades. La configuration Web est publique et sera intégrée au site ; elle ne donne pas les droits administrateur ou de déploiement. **Ne pas ajouter de clé privée de compte de service, de mot de passe ou de jeton dans ce fichier.**

`FIREBASE_HOSTING_SITE` peut rester vide pour le site par défaut `marathon-prono`. Le renseigner uniquement pour un autre site Hosting existant du même projet. `.env.example` fournit le modèle sans identifiants privés.

## 2. Activer les services dans la console

1. **Authentication → Méthode de connexion** : activer **Adresse e-mail / Mot de passe**, sans imposer la validation d’un email réel.
2. **Firestore Database** : créer la base **`(default)`**, en mode natif / Standard et en **mode production**, dans la région européenne proposée qui convient. Le déploiement remplacera les règles verrouillées par celles du dépôt. Ne pas utiliser des règles de test ouvertes.
3. **Authentication → Paramètres → Domaines autorisés** : vérifier la présence de `marathon-prono.web.app` et `marathon-prono.firebaseapp.com`, puis ajouter le domaine personnalisé si utilisé.
4. Activer Hosting si la console le demande. Aucun lien avec Storage ou Analytics n’est requis.

Les connexions affichent uniquement **pseudo et mot de passe**. Pour utiliser Firebase Auth sans demander un email aux proches, le pseudo est normalisé en minuscules et associé à un identifiant technique interne `pseudo@pseudos.invalid`. Ce n’est pas une adresse de contact ; aucun email n’est envoyé. Les pseudos autorisés contiennent 3 à 30 lettres sans accents, chiffres, points, tirets ou underscores. Les noms des coureurs peuvent contenir des accents et espaces.

## 3. Connecter le compte autorisé et publier

Dans le terminal du dépôt :

```sh
cd /workspace/marathon-prono
npm ci --cache /tmp/les-18-bornes-npm-cache
npm run firebase:login
npm run firebase:deploy
```

La connexion ouvre un parcours Google dans le navigateur. Utiliser un compte autorisé sur `marathon-prono`. Ne pas coller les codes de connexion, jetons ou mots de passe dans le chat. Le projet ne nécessite pas de fichier JSON de clé de service pour le déploiement normal. L’outil réutilise une authentification CLI existante ou les identifiants Google Application Default utilisables, lorsqu’ils sont fournis par l’environnement.

La commande de publication reconstruit les fichiers avec le vrai `.env`, puis déploie uniquement Hosting, les règles Firestore et les index. Elle refuse le mode émulateur. Hosting a aussi un contrôle `predeploy` : une publication directe par Firebase CLI doit reconstruire le site avec la vraie configuration et ne peut pas réutiliser silencieusement les fichiers de démonstration. Les sources du site ne contiennent aucune clé privée. La construction seule ne publie rien :

```sh
npm run firebase:build
```

L’adresse exacte publiée est celle renvoyée par Firebase CLI après succès. L’adresse habituelle du site par défaut est `https://marathon-prono.web.app` ; **sa présence dans ce guide ne signifie pas qu’une publication a déjà réussi**. Une publication remplace le contenu Hosting et les règles du projet ciblé : utiliser ce projet dédié au jeu.

Dans un environnement cloud à réseau restreint, il faut enregistrer/appliquer les domaines Firebase autorisés dans les paramètres de l’environnement. Les ajouts préparés pour ce projet sont :

```text
storage.googleapis.com
firebasehosting.googleapis.com
upload-firebasehosting.googleapis.com
firestore.googleapis.com
firebaserules.googleapis.com
firebase.googleapis.com
identitytoolkit.googleapis.com
securetoken.googleapis.com
oauth2.googleapis.com
accounts.google.com
www.googleapis.com
cloudresourcemanager.googleapis.com
serviceusage.googleapis.com
auth.firebase.tools
marathon-prono.web.app
marathon-prono.firebaseapp.com
```

Ces domaines ne remplacent pas une authentification ou des droits IAM. Le sous-domaine d’un autre site personnalisé devra être ajouté si nécessaire pour vérifier la publication depuis le cloud.

## 4. Donner les droits d’organisateur

1. Ouvrir le site et créer son compte avec un pseudo et un mot de passe.
2. Dans **Authentication → Utilisateurs**, retrouver l’identifiant technique correspondant au pseudo et copier son **UID**.
3. Dans **Firestore → Données**, créer la collection **`admins`**, puis un document dont l’identifiant est exactement cet UID.
4. Ajouter un champ **`enabled` de type booléen, valeur `true`**.
5. Actualiser le site : l’onglet Administration apparaît. La première course Lille est alors créée automatiquement si elle n’existe pas encore.

Ce rôle ne peut jamais être attribué par une inscription ou par une écriture depuis le site. Pour le retirer, passer `enabled` à `false` ou supprimer le document depuis la console. Les règles prennent en compte la révocation ; l’interface se met à jour au prochain rafraîchissement.

Compléter la liste des coureurs avant d’inviter les joueurs. Vérifier la clôture : **25 octobre 2026 à 09:00 Europe/Paris (08:00 UTC)** pour Lille, modifiable dans Administration. Les nouvelles courses sont en clôture manuelle par défaut.

## 5. Photos, résultats et récupération des comptes

Les photos sont redimensionnées à 256 pixels maximum, converties en JPEG et enregistrées dans les documents des coureurs. La taille finale est limitée à environ 130 Ko d’image binaire (180 000 caractères encodés), loin de la limite d’un document Firestore. Aucun bucket Storage n’est utilisé.

Les résultats sont privés jusqu’à publication. Les pronostics sont inaccessibles aux autres joueurs et au rôle administrateur du site avant la clôture, même par requête directe. Comme pour tout hébergement, les propriétaires du projet Firebase disposent d’un accès privilégié dans leur console.

Sans adresse email réelle, la récupération par email ne fonctionne pas. Un administrateur de confiance peut réinitialiser un mot de passe avec le script local :

```sh
npm run firebase:reset-password -- UID_FIREBASE
```

Ce script nécessite des **Google Application Default Credentials** avec les droits Firebase Auth appropriés sur le projet ; une connexion Firebase CLI seule ne suffit pas pour ce script Admin SDK. Utiliser par exemple Google Cloud Shell avec le bon projet et l’accès Google autorisé, ou `gcloud auth application-default login` sur une machine de confiance. Aucun fichier de clé privée n’est nécessaire si ces identifiants sont disponibles. Le mot de passe est demandé sans affichage et n’est pas sauvegardé. Les jetons de renouvellement sont révoqués ; un jeton d’accès déjà émis peut rester valable jusqu’à son expiration.

L’export JSON d’une course est disponible dans l’administration. Avant la clôture, il exclut les pronostics secrets. Une sauvegarde complète du projet Firebase et de ses comptes doit être gérée avec les outils Firebase/Google appropriés ; l’ancien `npm run backup` concerne uniquement le mode SQLite local et ne sauvegarde pas Firestore.

## 6. Développement et tests sans projet réel

Les émulateurs utilisent uniquement le projet fictif **`demo-les18-bornes`**. Ils ne modifient pas `marathon-prono` et ne nécessitent pas de connexion Google.

```sh
npm run firebase:build:demo
npm run firebase:test
npm run firebase:emulators
```

Java 21 et Node 24 sont utilisés dans cet environnement. Le lanceur ferme uniquement les processus qu’il a créés. Le mode test et les tests navigateur détruisent leurs données de démonstration : ne pas y importer des données personnelles à conserver.

Si le téléchargement habituel de l’émulateur Firebase est bloqué, le projet propose une autre distribution officielle :

```sh
npm run firebase:prepare-emulator
npm run firebase:test
```

Cette préparation télécharge le composant Firestore du **SDK officiel Google Cloud** depuis `dl.google.com`, vérifie le SHA-256 de l’archive contre les métadonnées officielles et conserve le JAR et son empreinte dans `.data/firebase-emulators/`. Sa version doit correspondre à celle attendue par la CLI. Le lanceur utilise la classe Java documentée par Google ; il ne change aucun checksum de Firebase CLI et ne substitue pas ce JAR à son autre distribution binaire. Le cache vérifié est réutilisé lors des prochaines exécutions.

Les règles sont testées par : `npm run firebase:test`. Le parcours navigateur facultatif nécessite Playwright et Chromium, comme décrit dans README.md :

```sh
PLAYWRIGHT_MODULE=/tmp/18-bornes-browser/node_modules/playwright/index.mjs npm run firebase:test:browser
```

Il vérifie Authentication, les rôles, la compression de photo sans Storage, les pronostics, leur conservation après actualisation, la confidentialité, les courses indépendantes, les résultats, les exports et les deux classements. `npm test` et `npm run check` restent disponibles pour les règles de score et le mode local Node/SQLite.

## Structure Firestore

- `users/{uid}` : pseudo, date de création ; aucun mot de passe.
- `admins/{uid}` : rôle attribué uniquement par un propriétaire Firebase, avec `enabled: true`.
- `races/{raceId}` : paramètres, version de liste et compteurs.
- `races/{raceId}/runners/{id}` : nom et petite photo publique.
- `races/{raceId}/predictions/{uid}` : ordre et temps, protégés jusqu’à clôture.
- `races/{raceId}/private/results` : résultats, privés jusqu’à publication.

Les écritures de pronostics et de leurs compteurs sont atomiques. Les règles vérifient tous les coureurs, les temps HH:mm, les doublons, la version de liste, le propriétaire, les compteurs et l’heure serveur. L’interface utilise des abonnements Firestore aux changements plutôt que de relire chaque coureur toutes les 15 secondes.
