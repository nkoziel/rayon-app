# Rayon — bibliothèque manga & recommandations

Application web autonome : bibliothèque de séries, fiches AniList, et une section **Découvrir** qui croise les recommandations votées par les lecteurs. Aucun compte, aucun serveur : tout est stocké dans le navigateur.

## Contenu du dossier

```
index.html              l'application
manifest.webmanifest    métadonnées d'installation
sw.js                   service worker (fonctionnement hors ligne)
icons/                  icônes 192, 512, maskable, apple-touch
```

## 1. Essayer tout de suite

Ouvre `index.html` dans un navigateur. Tout fonctionne sauf l'installation et le mode hors ligne, qui exigent une adresse `http(s)://`.

Pour charger une bibliothèque : bouton **Importer** (sauvegarde Mihon `.tachibk` ou export `.json`), ou onglet **Ajouter** pour chercher des titres un par un dans le catalogue AniList.

## 2. La mettre en ligne (nécessaire pour l'installer)

N'importe quel hébergement statique convient. Le plus rapide :

- **Netlify Drop** — va sur `app.netlify.com/drop`, glisse le dossier, l'URL est immédiate.
- **GitHub Pages** — dépose les fichiers dans un dépôt, puis *Settings → Pages → Deploy from branch*.
- **Cloudflare Pages**, **Vercel** — même principe.

Une seule condition : servir en HTTPS, sinon le service worker ne s'enregistre pas.

## 3. L'installer sur Android

Ouvre l'URL dans Chrome → menu ⋮ → **Ajouter à l'écran d'accueil**. L'app se lance en plein écran, sans barre d'adresse, avec son icône. Elle démarre hors ligne ; seules les requêtes AniList ont besoin du réseau.

Sur iPhone : Safari → Partager → **Sur l'écran d'accueil**.

## 4. En faire un vrai APK

Deux voies, toutes deux à partir de l'URL publique.

### PWABuilder (sans rien installer)

1. Va sur `pwabuilder.com`, entre l'URL de l'app.
2. *Package for stores → Android*, choisis **Signed APK** pour un partage direct, ou **App Bundle** pour le Play Store.
3. Télécharge le paquet et partage l'APK. Tes amis devront autoriser l'installation depuis une source inconnue.

L'APK produit est une *Trusted Web Activity* : une coquille Android qui affiche l'app en plein écran. Toute mise à jour du site est répercutée sans réinstaller.

### Bubblewrap (en ligne de commande)

```bash
npm install -g @bubblewrap/cli
bubblewrap init --manifest https://TON-URL/manifest.webmanifest
bubblewrap build          # produit app-release-signed.apk
```

Nécessite le JDK 17 et le SDK Android, que Bubblewrap propose d'installer.

### Capacitor (si tu veux du natif plus tard)

À privilégier seulement si tu comptes ajouter des fonctions natives (notifications, partage système, lecture de fichiers hors navigateur) :

```bash
npm install @capacitor/core @capacitor/cli
npx cap init Rayon com.exemple.rayon --web-dir=.
npx cap add android
npx cap open android      # compile l'APK depuis Android Studio
```

## Suivi chapitre par chapitre, et l'affaire des totaux

Chaque fiche a un bloc de suivi : bascule **Chapitres / Tomes**, compteur, « reste N », et une ligne qui dit **d'où vient le total**. Le réglage est par série ; le bouton de la barre d'outils fixe seulement le défaut.

Il n'existe aucune source unique fiable pour « combien de chapitres sont parus ». L'app applique donc une cascade, dans cet ordre :

| Priorité | Source | Ce qu'elle vaut |
|---|---|---|
| 1 | **Ta saisie manuelle** | Fait autorité, toujours. Bouton *Saisir le total*. |
| 2 | **MangaDex** | Structure en tomes et dernier chapitre traduit. Bonne couverture des manga japonais, partielle pour les manhwa d'Asura ou Flame. Bouton *Vérifier les sorties*. |
| 3 | **AniList** | `chapters` et `volumes` ne sont renseignés que pour les séries **achevées**. Pour une série en cours, ces champs sont vides — c'est une limite de la base, pas un bug. |
| 4 | **Ta sauvegarde Mihon** | Le nombre de chapitres présents chez ta source de lecture. Souvent le chiffre le plus à jour pour les séries hebdomadaires, mais il compte les doublons et les chapitres découpés. |

Conséquences pratiques :

- **Manga japonais en cours** (Kingdom, Sakamoto Days…) : MangaDex donne le dernier chapitre traduit et le découpage en tomes. Attention, la numérotation des scantrad diffère parfois de l'officielle ; l'app te prévient si ta progression dépasse le total connu.
- **Séries achevées** : AniList suffit, les totaux y sont justes.
- **Webtoons et manhwa** : souvent aucun découpage en tomes n'existe — ils ne sont pas publiés en volumes papier. Le mode Tomes affichera « aucun découpage connu », c'est normal. Reste le suivi par chapitres.
- **Séries absentes de MangaDex** : saisie manuelle. Deux clics, et la valeur devient prioritaire pour toujours.

*Déduire de mes chapitres* convertit une progression en chapitres vers un nombre de tomes, en s'appuyant sur le découpage MangaDex.

**Réserve importante** : je n'ai pas pu tester depuis mon environnement si MangaDex autorise les appels directs depuis un navigateur (politique CORS). Si le bouton *Vérifier les sorties* renvoie une erreur de blocage, tout le reste continue de fonctionner — AniList, ta sauvegarde et la saisie manuelle couvrent les besoins. Le cas échéant il faudrait un petit relais côté serveur, que je peux écrire.

## Lire hors ligne

Chaque fiche a une section **Chapitres hors ligne**. Tu y déposes des fichiers de ton appareil — `.cbz`, `.zip` ou une sélection d'images — et ils sont stockés dans le navigateur (IndexedDB), disponibles sans réseau.

Le lecteur reprend les conventions de Mihon :

- **Webtoon** : défilement vertical continu, une image après l'autre
- **Pages** : une page à la fois, zones de tap gauche/droite, flèches du clavier, sens **droite→gauche** commutable pour le manga japonais
- Reprise à la page où tu t'es arrêté
- « Marquer lu » met à jour ta progression : si le nom du fichier contient un numéro (`Chapter 145.cbz`, `one-piece-1102.cbz`), c'est ce numéro qui est enregistré, sinon la progression avance d'un cran
- Enchaînement proposé sur le chapitre suivant

Les archives sont décodées nativement (`DecompressionStream`), sans bibliothèque externe. Formats acceptés : CBZ/ZIP contenant des JPEG, PNG, WebP, GIF ou AVIF. Le CBR (RAR) n'est pas géré — convertis-le en CBZ.

### Relier ton dossier Mihon

Bouton **•••  → Dossier Mihon**. L'app parcourt l'arborescence `source / série / chapitre`, la rapproche de ta bibliothèque par le titre, et les chapitres apparaissent dans chaque fiche avec la mention « dossier Mihon ». Les images sont lues **là où elles sont**, sans copie ni duplication de stockage. Les cartes affichent une pastille « N hors ligne ».

Le dossier reste lié entre les sessions ; le navigateur redemande l'autorisation à la première lecture.

**La contrainte Android, à régler une fois.** Depuis Android 11, aucune application — navigateur compris — ne peut ouvrir `Android/data/`, où Mihon range ses téléchargements par défaut. Le sélecteur de fichiers refuse ce chemin, ce n'est pas contournable.

La solution est dans Mihon : *Paramètres → Téléchargements → Répertoire de téléchargement*, et choisis un dossier accessible, par exemple `Documents/Mihon` ou un dossier `Mihon` à la racine du stockage. Les nouveaux téléchargements y iront, et ce dossier-là, l'app peut le lire. Pour les chapitres déjà téléchargés, déplace l'ancien dossier avec un gestionnaire de fichiers.

**Sur Android : choisis la racine `Mihon/downloads` en une fois.**

Bouton **•••  → Dossier Mihon**, puis navigue jusqu'à `Mihon/downloads` et valide par *Utiliser ce dossier*. L'app lit l'arborescence entière et range chaque chapitre sous la bonne série :

```
downloads/Asura Scans (EN)/Absolute Regression/Ch. 115/001.jpg
           └── source ──┘  └──── série ─────┘  └ chapitre ┘
```

Le rapprochement se fait sur le **nom de source de ta sauvegarde** — « Asura Scans » retrouve « Asura Scans (EN) », le suffixe de langue est ignoré — puis sur le titre. À défaut, l'app retombe sur le titre seul. Les chapitres en dossiers d'images comme en `.cbz` sont pris en charge, `.nomedia` et les fichiers étrangers sont ignorés.

Un résumé s'affiche au-dessus de la grille : nombre de séries, de chapitres, de séries reconnues, et la répartition par source.

| Contexte | Ce qui marche |
|---|---|
| Chrome / Edge sur ordinateur | Lien persistant vers la racine : l'accès survit aux fermetures |
| Chrome sur Android | Sélection de la racine à chaque session ; un bouton *Rouvrir le dossier* est affiché |
| Firefox, Safari | Fichiers `.cbz` ou images, série par série, avec copie |

Sur Android, le navigateur oublie l'autorisation en fermant l'onglet — c'est une limite de la plateforme, pas un réglage. L'inventaire, lui, reste enregistré : les pastilles « N hors ligne » restent visibles, et un clic rend l'accès.

Tu peux aussi utiliser tes propres numérisations ou tes achats en fichiers ouverts.

## Ce que cette app ne fera pas

Elle ne va pas chercher les chapitres toute seule sur les agrégateurs. Pas de moteur d'extensions à la Mihon, pas de scraping d'Asura, Mangakakalot ou consorts. Ce sont des sites qui diffusent des œuvres sans accord des ayants droit, et je ne code pas l'outil qui va les récupérer.

Deux limites techniques s'ajoutent de toute façon :

- Un navigateur ne peut pas récupérer d'images sur un domaine tiers sans autorisation CORS. MangaDex documente explicitement que son CDN d'images n'autorise que ses propres domaines — un client web doit passer par un relais serveur.
- Le téléchargement en masse et le suivi de sorties en tâche de fond réclament un contexte natif, pas une page web.

**Si tu veux le tout-en-un**, la voie réaliste est l'inverse de ce projet : partir de Mihon, qui est libre et déjà excellent en lecture, et lui ajouter l'écran de recommandations. La logique de croisement AniList tient en une centaine de lignes et je peux l'écrire en Kotlin pour un fork. Tu gardes le lecteur, les extensions, les téléchargements, et tu gagnes la découverte.

## 5. Partager avec d'autres

- **Le lien suffit.** Chaque personne arrive sur une bibliothèque vide, avec l'écran d'accueil qui explique quoi faire.
- **Partager une liste** : bouton **Exporter** → fichier `.json`. La personne le charge via **Importer**. Pratique pour offrir une sélection à un ami.
- Rien ne transite par un serveur : deux personnes sur la même URL ont deux bibliothèques indépendantes.

## Notes techniques

- **Sauvegardes Mihon / Tachiyomi** : le `.tachibk` est un protobuf compressé en gzip, décodé dans le navigateur via `DecompressionStream`. Chrome, Edge, Firefox 113+, Safari 16.4+.
- **AniList** : API GraphQL publique, sans clé, limitée à 30 requêtes par minute. L'app groupe ses appels (50 fiches par requête) et met tout en cache.
- **Stockage** : `localStorage`. Compter environ 300 Ko pour 200 séries avec leurs fiches. L'export JSON est la seule sauvegarde — pense à le refaire de temps en temps.
- **Vie privée** : rien n'est envoyé nulle part, hormis les titres interrogés auprès d'AniList.
