# Les 18 Bornes

Une application de pronostics de marathon entre amis, en français, adaptée au téléphone. Les joueurs créent un compte avec pseudo et mot de passe, classent tous les coureurs et prédisent **un temps HH:mm pour chacun**.

**La version à publier utilise désormais Firebase Hosting, Firestore et Firebase Authentication.** Le fichier `.env` est préparé pour le projet `marathon-prono`. Suivre [le guide Firebase](FIREBASE.md) pour compléter les deux valeurs manquantes, activer les services, connecter le compte autorisé et publier. Aucun déploiement n’est implicite.

Les instructions Node/SQLite ci-dessous concernent le **mode local alternatif**, conservé pour le développement et les tests. Les données SQLite et Firebase sont indépendantes ; elles ne sont pas synchronisées automatiquement.

## Ce qui fonctionne

- Plusieurs courses indépendantes, avec des comptes communs et un lien d’invitation par course.
- Ajout, renommage et suppression des coureurs ; photos JPEG, PNG ou WebP, jusqu’à 2 Mo.
- Classement par glisser-déposer sur ordinateur, ou boutons monter/descendre utilisables au clavier et sur téléphone.
- Pronostic modifiable jusqu’à la clôture, sauvegardé en base après validation ; brouillon conservé localement dans le navigateur.
- Pronostics des autres **absents de l’API avant la clôture**, y compris pour l’administrateur.
- Clôture automatique en heure de Paris, ou manuelle. La première course, Lille, est préconfigurée au **25 octobre 2026 à 9 h à Paris**, soit 8 h UTC. Cette date est le choix de l’organisateur, pas une vérification du calendrier officiel.
- Administration : courses, liste des coureurs, résultats, publication/retrait de publication et réinitialisation des mots de passe.
- Résultats en brouillon privé pour l’administrateur, puis publication explicite des deux classements.
- Export JSON d’une course sans mots de passe ; sauvegarde complète SQLite et photos via la ligne de commande.

## Démarrage local

Prérequis : **Node.js 24 ou plus récent**. Le mode local fonctionne sans service externe ; SQLite est intégré à Node. `npm ci` installe aussi les outils nécessaires à la construction et aux tests Firebase.

```sh
cd /workspace/marathon-prono
npm ci --cache /tmp/les-18-bornes-npm-cache
npm run admin -- "Ton pseudo"
npm start
```

La commande `admin` demande un mot de passe de 12 à 128 caractères, sans l’afficher. Elle crée un administrateur ; si le pseudo existe déjà, elle lui donne le rôle administrateur, change son mot de passe et révoque ses sessions. Elle permet aussi de récupérer l’accès administrateur. En automatisation, utiliser une variable `ADMIN_PASSWORD` injectée de manière sécurisée, jamais une valeur dans le dépôt ou dans les arguments de commande.

Le serveur écoute sur le port 3000 par défaut. `npm run dev` redémarre le serveur lors des modifications. Aucun compte administrateur ni mot de passe par défaut n’est créé. Les inscriptions normales ne donnent jamais de droits administrateur.

Dans l’application : se connecter → **Administration** → compléter les coureurs et vérifier la clôture → partager le lien de la course. Pour créer un autre marathon, utiliser « Créer une course », puis le sélecteur de course en haut de page.

## Règles des scores

**Positions** : somme de `|position prédite − position réelle|` pour tous les coureurs. Par exemple, prédire 2e un coureur arrivé 5e coûte 3 points. Le plus petit total gagne.

**Chronos** : moyenne des écarts absolus en minutes, calculés **coureur par coureur** parmi les arrivants. Des erreurs de +10 et −10 minutes donnent un écart moyen de 10 minutes ; elles ne s’annulent pas. Le plus petit écart gagne. L’affichage est arrondi à deux décimales ; le calcul conserve toute sa précision.

Les abandons et non-partants sont tous placés ex æquo à la position suivant le dernier arrivant. Leurs temps ne comptent pas dans le score des chronos. L’organisateur saisit la position dans le **groupe d’amis**, pas le classement général du marathon. Les positions des arrivants doivent être consécutives, de 1 à leur nombre. Les temps sont saisis à la minute (sans secondes), de 00:01 à 24:00. Aucun contrôle de cohérence entre ordre prédit et temps prédits n’est imposé : ce sont deux jeux indépendants.

Les scores égaux partagent le même rang : 1, 1, 3. Il faut renseigner le statut de tous les coureurs, avec au moins un arrivant, avant de publier. Si personne ne finit, aucun classement des temps n’est calculable : ne pas publier de résultats.

Ajouter ou supprimer un coureur avant le départ invalide les pronostics déjà enregistrés. Ils sont conservés, mais doivent être **revalidés** ; l’interface le signale au joueur et à l’administrateur. Renommer un coureur ou changer sa photo conserve les pronostics. La liste est verrouillée après la clôture.

L’administrateur peut rouvrir une course en décochant la clôture manuelle et en repoussant/supprimant la date, après retrait de la publication si nécessaire. Les choix ont alors déjà été dévoilés : l’interface demande confirmation.

## Validation

```sh
npm run check
npm test
```

Les tests utilisent des bases temporaires et ne touchent pas aux vraies données. Ils couvrent les scores, ex æquo, abandons, comptes, droits, sessions, photos, confidentialité, clôture automatique, changements de liste et isolation entre courses.

Le test navigateur facultatif utilise Playwright et Chromium, installés en dehors du projet :

```sh
npm install --prefix /tmp/18-bornes-browser --cache /tmp/18-bornes-npm-cache --no-save playwright
PLAYWRIGHT_MODULE=/tmp/18-bornes-browser/node_modules/playwright/index.mjs \
CHROMIUM_PATH=/usr/bin/chromium node scripts/browser-smoke.mjs
```

Il teste les vrais formulaires, le tri, la conservation des pronostics, l’heure de Paris au changement d’heure, les courses, les résultats et les classements, avec contrôles de mise en page sur ordinateur et mobile. Il crée une base isolée et la supprime à la fin.

## Hébergement

L’application nécessite un serveur Node persistant et un **disque persistant** pour SQLite et les photos. Un hébergement de fichiers statiques seul ne suffit pas. Exécuter une seule instance du serveur sur un disque local ; ne pas placer SQLite sur un partage réseau ni activer plusieurs réplicas indépendants.

Variables de processus :

| Variable | Valeur / usage |
| --- | --- |
| `PORT` | `3000` par défaut ; utiliser le port fourni par l’hébergeur. |
| `HOST` | `0.0.0.0` par défaut. |
| `DATA_DIR` | `.data` par défaut ; chemin du volume persistant en production. |
| `NODE_ENV` | `production` en hébergement public. Active les cookies Secure et HSTS. |
| `APP_ORIGIN` | Obligatoire en production : origine HTTPS exacte, par exemple `https://pronos.exemple.fr`, sans chemin. |

Un `Dockerfile` est fourni, sans installation de paquet à la construction. L’image et son démarrage en mode production ont été vérifiés, avec cookies Secure, volume de données et redémarrage. Exemple, derrière un reverse proxy HTTPS :

```sh
docker build -t les-18-bornes .
docker volume create les-18-bornes-data
docker run -d --name les-18-bornes --restart unless-stopped \
  -p 127.0.0.1:3000:3000 \
  -e APP_ORIGIN=https://pronos.exemple.fr \
  -v les-18-bornes-data:/app/.data les-18-bornes
docker exec -it les-18-bornes npm run admin -- "Ton pseudo"
```

Pour reproduire le contrôle isolé du conteneur : `python scripts/docker-smoke.py` après construction de l’image `les-18-bornes:local`. Ce test utilise des volumes et comptes temporaires, puis les supprime.

Configurer le proxy pour transmettre ce domaine vers le port 3000. Adapter le domaine avant de démarrer. Le conteneur s’exécute avec l’utilisateur `node` ; un volume monté depuis l’hôte doit lui être accessible en écriture. La vérification du conteneur ne constitue pas une mise en ligne publique.

Les mots de passe sont hachés avec scrypt et un sel aléatoire ; les sessions en base ne contiennent que le hash de leur jeton. Cookies HttpOnly/SameSite, contrôle strict d’origine des mutations, requêtes SQL paramétrées, protection contre l’intégration dans une iframe et limitation des tentatives de connexion sont intégrés. Derrière un proxy, la limite par adresse IP peut être partagée entre les utilisateurs.

## Données et sauvegardes

Le dossier `DATA_DIR` contient `marathon.sqlite`, ses fichiers WAL éventuels et `uploads/`. Il est ignoré par Git. Le redémarrage du serveur conserve les données si ce dossier est conservé. Ne jamais utiliser le dossier temporaire des tests comme stockage réel.

Pour une sauvegarde SQLite cohérente pendant que le serveur fonctionne :

```sh
npm run backup -- /chemin/prive/sauvegarde-neuve
```

Cette commande utilise l’API de sauvegarde SQLite et copie les photos. Éviter de modifier les photos pendant la copie si une copie strictement synchronisée est nécessaire. Le dossier cible doit être neuf et extérieur à `DATA_DIR`. La sauvegarde contient les comptes, les hashes de mots de passe et les sessions : elle doit rester privée. L’export JSON dans l’administration est un export de course lisible, **pas** une sauvegarde complète des comptes ni un fichier importable par l’interface.

Pour restaurer : arrêter le serveur, conserver une copie de l’ancien `DATA_DIR`, puis placer le contenu du dossier de sauvegarde dans un nouveau `DATA_DIR`, vérifier les droits d’accès et redémarrer. Ne pas mélanger des fichiers WAL d’une ancienne base avec la base restaurée. Utiliser la même version de l’application.

## Résultats automatiques

La saisie manuelle est opérationnelle et ne dépend d’aucun prestataire. Aucune API de chronométrage officielle n’a été identifiée/validée pour la course. Pour connecter un import fiable, il faudra le lien exact de l’épreuve, le fournisseur et ses conditions d’accès, ainsi que les dossards pour rapprocher les coureurs. L’application ne prétend pas importer des résultats automatiquement.

## Confidentialité

Le lien d’invitation n’est pas une barrière d’accès : après clôture, les pseudos et pronostics sont accessibles à toute personne possédant ce lien. Aucun email, outil de mesure d’audience ou ressource distante n’est utilisé. Prévenir les coureurs avant d’ajouter leurs photos et garder la diffusion dans le cercle prévu. La suppression d’un compte peut être traitée par l’organisateur sur sa base de données, après sauvegarde.

## Structure

- `server.js` : serveur HTTP, API, autorisations et fichiers statiques.
- `db.js` : schéma SQLite, transactions et mots de passe.
- `domain.js` : validation et calcul des deux scores.
- `public/` : interface responsive sans bibliothèque externe.
- `admin.js`, `backup.js` : outils d’administration locaux.
- `test/`, `scripts/browser-smoke.mjs` : validations automatisées.
