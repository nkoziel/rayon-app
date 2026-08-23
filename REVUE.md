# Rayon — revue technique

Revue du 23 août 2026, sur l'état livré par l'application Claude Android.
Périmètre : `index.html` (1 967 lignes), `sw.js`, `manifest.webmanifest`, `LISEZ-MOI.md`.

---

## Verdict en trois lignes

Le produit est bon et l'app **fonctionne** : le décodage protobuf du `.tachibk` sans dépendance,
le lecteur CBZ écrit à la main sur `DecompressionStream`, la cascade de provenance des totaux —
c'est du travail sérieux, pas une démo. Ce qui manque, c'est tout ce qui rend un projet **durable** :
pas de versionnement, pas de tests, pas de modules, et une poignée de bugs qui mordent
silencieusement sur les données de l'utilisateur.

Les trois choses à corriger avant toute nouvelle fonctionnalité :
**(1)** les titres non latins cassent l'indexation, **(2)** `localStorage` va saturer sans le dire,
**(3)** le service worker ne livrera jamais de mise à jour.

---

## 1. Bugs bloquants

### 1.1 Tous les titres japonais / coréens / chinois s'écrasent entre eux

`index.html:304`

```js
const norm = s => (s||"").toLowerCase().normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
```

`[^a-z0-9]` supprime tout ce qui n'est pas ASCII. Vérifié :

| Titre | `norm()` |
|---|---|
| `進撃の巨人` | `""` |
| `나 혼자만 레벨업` | `""` |
| `ワンピース` | `""` |
| `One Piece` | `"onepiece"` |

Or `norm(titre)` est **la clé primaire de toute l'application** : `META`, `MDCACHE`,
`OWNED`, `reco:v3:…`, `pickedFor`, `folderChaptersFor`, la déduplication de `addFromMedia`.

Conséquences concrètes, pour une bibliothèque Mihon qui contient des titres en VO :

- toutes ces séries partagent **une seule** fiche AniList (`META[""]`) ;
- `OWNED` contient `""`, donc `isOwned()` renvoie vrai pour n'importe quelle reco
  dont le titre est non latin → l'onglet Découvrir les masque toutes ;
- `addFromMedia` répond « Déjà dans ta liste » et refuse l'ajout ;
- le cache de recommandations `reco:v3:` est partagé entre toutes.

**Correctif** : ne plus indexer par titre. Chaque entrée a déjà un `id` (uid) et souvent un `al`
(id AniList). Clé = `al` si présent, sinon `id`. Et pour le rapprochement flou (dossier Mihon),
un `norm()` qui préserve l'unicode : `.replace(/[^\p{L}\p{N}]/gu,"")`.

### 1.2 `localStorage` sature en silence et la bibliothèque cesse d'être sauvegardée

`index.html:312`

```js
set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); return true; }catch(e){ return false; } },
```

Le `return false` n'est **lu nulle part**. `saveLib()`, `saveMeta()`, `store.set("md:v1", …)`,
`store.set(key, payload)` ignorent tous la valeur de retour.

Volumétrie réelle (le LISEZ-MOI annonce « 300 Ko pour 200 séries », c'est très sous-estimé) :

| Clé | Contenu | ~200 séries | ~800 séries (typique Mihon) |
|---|---|---|---|
| `lib:v1` | entrées | 120 Ko | 480 Ko |
| `meta:v2` | fiches + `desc` à 900 car. | 240 Ko | 960 Ko |
| `reco:v3:*` | 12 recos × ~600 o **par série** | 1,4 Mo | 5,8 Mo |
| `md:v1` | découpage en tomes | 60 Ko | 240 Ko |

Le quota `localStorage` est de ~5 Mo par origine. Une bibliothèque Mihon normale le dépasse
**dès le premier passage dans Découvrir**. À partir de là : chaque incrément de chapitre,
chaque ajout, chaque suppression est perdu au rechargement, sans le moindre message.

**Correctif** : migrer `META`, `MDCACHE` et les caches `reco:` vers IndexedDB (la base
`rayon-reader` existe déjà, il suffit d'un object store `cache`). Garder `localStorage`
uniquement pour les préférences (`unit`, `panel`, `seeds`). Et faire remonter l'échec :
`if (!store.set(...)) toast("Stockage plein — exporte ta bibliothèque")`.

### 1.3 Le service worker ne livrera jamais de mise à jour

`sw.js:2` — `const CACHE = "rayon-v1"`, jamais incrémenté, et `index.html` est servi
**cache-first**. Le SW ne se réinstalle que si les octets de `sw.js` changent ; comme tu ne
touches qu'à `index.html`, le navigateur continuera à servir la version installée le premier jour,
indéfiniment. Un utilisateur qui a installé l'app ne verra plus jamais tes correctifs.

Effet de bord : le TWA produit par PWABuilder hérite du même piège, alors que le LISEZ-MOI
promet « toute mise à jour du site est répercutée sans réinstaller ».

**Correctif** : `index.html` en *network-first* (avec repli cache), les assets immuables en
cache-first, et un numéro de version injecté au build. Plus un `updatefound` → toast
« Nouvelle version — recharger ».

### 1.4 « Retirer » ne fonctionne plus dès qu'on touche au compteur

`index.html:1488` déclare `<button id="removeBtn">` **à l'intérieur** de `trackerHTML()`.
`openSheet` (`index.html:1598`) lui attache son handler **après** `wireTracker(d)`.

Mais `refreshTracker()` (`index.html:1493`) fait :

```js
$("trackwrap").innerHTML = trackerHTML(d);   // le bouton est recréé
wireTracker(d);                              // …et wireTracker ne câble pas removeBtn
```

Reproduction : ouvrir une fiche → cliquer `+` → cliquer **Retirer** → rien.
Le bouton est mort jusqu'à réouverture de la fiche.

**Correctif** : câbler `removeBtn` dans `wireTracker`, ou le sortir de `trackerHTML` (il n'a
rien à faire dans un bloc de suivi de progression — c'est une action destructive, elle mérite
sa place à part).

### 1.5 L'import écrase la bibliothèque sans confirmation

`index.html:647` — `LIB = { label, entries };` puis `saveLib()`.

Un glisser-déposer sur la fenêtre déclenche `importFile` directement (`index.html:1926`).
Un `.json` lâché par erreur remplace instantanément la bibliothèque, sa progression,
les totaux saisis à la main, les unités par série. Aucun `confirm`, aucun undo, et
`store.del("discover:v1")` au passage.

**Correctif** : `confirm()` avec le compte avant/après, et proposer **fusionner** plutôt que
remplacer (rapprochement par `al`, on garde le `max(r)` de chaque côté). C'est aussi ce qui
rend l'échange de listes entre amis réellement utilisable — aujourd'hui recevoir la liste
d'un ami détruit la sienne.

### 1.6 Un numéro dans le nom de fichier peut propulser la progression à 2024

`index.html:1221`

```js
const chapNumOf = name => {
  const m = String(name).match(/(?:ch(?:ap(?:ter|itre)?)?[\s._-]*)(\d+(?:\.\d+)?)/i)
         || String(name).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : null;
};
```

Le repli prend **le premier nombre du nom**. Vérifié :

| Nom de fichier | `chapNumOf` |
|---|---|
| `Chapter 145.cbz` | 145 ✓ |
| `one-piece-1102.cbz` | 1102 ✓ |
| `Solo Leveling 179 (2021).cbz` | 179 ✓ |
| `[2024] Vol.3 - 12.cbz` | **2024** ✗ |
| `Asura Scans 2024 - 05.cbz` | **2024** ✗ |
| `Volume 05.cbz` | **5** (c'est un tome, pas un chapitre) ✗ |

Et `finish()` (`index.html:1386`) applique : `if (n && n > entry.r) entry.r = n;`
→ marquer un chapitre lu peut écrire **2024 chapitres lus** dans la bibliothèque,
irréversiblement.

**Correctif** : plafonner (`n <= (totals(d).ch || n)`), ignorer les nombres à 4 chiffres qui
ressemblent à une année, exclure les motifs `vol`/`tome`, et demander confirmation
au-delà d'un saut de +5.

---

## 2. Bugs sérieux

### 2.1 Le lecteur réécrit tout le chapitre en base à chaque page tournée

`index.html:1379` — dans `go()` : `putChapter(chapter)`.

`chapter.pages` est un tableau de `Blob`. Un chapitre de 40 pages fait 15–40 Mo.
À chaque tap sur la zone gauche/droite, l'app fait un *structured clone* et une écriture
IndexedDB de la totalité. Sur mobile : saccade garantie, batterie, usure du stockage.

**Correctif** : un object store séparé pour la progression (`{chapterId, lastPage, done}`),
et n'écrire que ça. Idéalement en `requestIdleCallback` ou débounce 500 ms.

### 2.2 La cadence AniList dépasse la limite de l'API, et un seed perdu est perdu

AniList : 30 requêtes/minute. Le code attend `sleep(700)` (`index.html:432`, `index.html:1689`)
→ ~85 req/min. Le 429 est bien capté (`gql` pose `cooldownUntil`), mais dans `runDiscover` :

```js
catch(e){ failures++; …; continue; }
```

La série est **définitivement sautée pour ce run**. Sur une analyse de 50 seeds, la plupart
tombent en 429 après les 30 premières et n'entrent jamais dans le croisement. Le résultat
affiché est silencieusement incomplet.

**Correctif** : un vrai ordonnanceur (file d'attente, 2,1 s entre requêtes, retry
exponentiel sur 429 en respectant `Retry-After`). Même chose pour MangaDex
(`mdBatch` fait 2 requêtes par série toutes les 320 ms ≈ 6 req/s, au-delà de leur limite).

### 2.3 `runDiscover` n'est pas annulable

Avec `state.seeds = "Tout"` sur 800 séries : `999` seeds × (requête + 700 ms) ≈ **20 minutes**,
bouton désactivé, aucun bouton Stop, et changer d'onglet ne l'arrête pas.

### 2.4 Le parseur `.tachibk` bloque le thread principal, en BigInt

`pbParse` (`index.html:557`) utilise `BigInt` pour **chaque varint**, y compris les tags de champ.
Un backup de 800 séries × ~200 chapitres = ~160 000 messages imbriqués, soit des millions
d'allocations BigInt. L'onglet gèle pendant l'import, sans indicateur de progression réel.

Idem pour `readZip` → `inflateRaw` : une `Blob` + une `Response` + un `DecompressionStream`
**par page**, en séquentiel.

**Correctif** : `Number` pour les varints < 2^53 (repli BigInt seulement si le 8ᵉ octet arrive),
et déporter le parsing dans un Web Worker. C'est le cas d'école du worker.

### 2.5 Fuite de stockage sur les séries supprimées

`removeBtn` retire l'entrée de `LIB.entries` et rien d'autre. Restent en base, pour toujours :
les chapitres IndexedDB de cette série (potentiellement des centaines de Mo), `META[clé]`,
`MDCACHE[clé]`, `reco:v3:clé`, les entrées `FSPROG`.

### 2.6 `pickDownloadFolder` gèle l'interface

`indexPickedFiles` (`index.html:1041`) itère de façon synchrone sur la `FileList` entière.
Un dossier `Mihon/downloads` complet, c'est facilement 100 000 fichiers. Le `await sleep(20)`
placé avant n'y change rien : la boucle qui suit est bloquante.

### 2.7 Le mode droite→gauche est activé par défaut pour tout

`index.html:1352` — `store.get("rtl:v1") !== false && mode === "paged" && entry.m !== "Webtoon"`.

Un manhwa lu en mode Pages (cas fréquent : les manhwa terminés sortent en CBZ paginés)
démarre en lecture japonaise. Le défaut devrait suivre `typeOf(d)` : RTL pour `Manga` (JP)
uniquement.

### 2.8 Échap ferme la fiche sous le lecteur

Le lecteur écoute `el.onkeydown` sur un `div` avec `tabIndex=-1`. Dès que le focus part
(un clic sur l'image le fait), c'est le listener `document` de `index.html:1631` qui reçoit
la touche : il ferme la **fiche** et laisse le lecteur ouvert par-dessus le vide.
Même cause pour les flèches ← → qui cessent de fonctionner.

**Correctif** : listener au niveau `document` avec une pile de couches modales
(reader > sheet > modal).

---

## 3. Architecture

### 3.1 Ce qui bloque vraiment la suite

- **Aucun versionnement.** `git` n'est pas initialisé. Un fichier de 100 Ko, aucun historique,
  aucun retour arrière possible. C'est le point numéro un.
- **Le projet vit dans `G:\Mon Drive\`** (Google Drive Desktop). Un dépôt `.git` dans un dossier
  synchronisé se corrompt tôt ou tard (Drive réécrit les fichiers de `.git/objects` pendant
  une opération). À déplacer en local, avec GitHub comme synchro.
- **Un seul fichier, 1 670 lignes de JS.** Pour Claude Code c'est le pire format : chaque
  modification recharge 100 Ko de contexte et les diffs sont illisibles. Découper est ce qui
  va le plus accélérer le travail à partir de maintenant.
- **Zéro test.** Or il y a ici de la logique pure, parfaitement testable, et qui *casse en
  silence* quand elle se trompe : `pbParse`, `readZip`, `totals`, `chapNumOf`, `norm`,
  `rankTally`, `indexPickedFiles`, `srcKey`. C'est exactement le genre de code où un test
  vaut dix relectures — les deux bugs 1.1 et 1.6 ci-dessus auraient été trouvés par
  six lignes de test.

### 3.2 Performances de rendu

- `renderLibrary()` reconstruit **tout** le `innerHTML` de la grille, puis rattache un
  `onclick` par carte. Sur 800 séries, à chaque frappe dans la recherche
  (`index.html:1878`, aucun debounce). → debounce 150 ms + délégation d'événement.
- `refreshTracker()` (`index.html:1493`) appelle `saveLib(); renderLibrary(); boot();`
  à **chaque clic sur `+`**. Donc : `JSON.stringify` de toute la bibliothèque, reconstruction
  de `OWNED`, reconstruction de la grille entière, **et** reconstruction des chips de filtre
  (ce qui remet à zéro leur défilement horizontal). Pour incrémenter un compteur.
- `norm()` est appelé des milliers de fois par rendu (`typeOf`, `totals`, `progressOf`,
  `libRows`, `posterHTML`…) et refait à chaque fois `normalize("NFD")` + deux regex.
  Un `Map` de mémoïsation, ou mieux : la clé stable de 1.1, résout les deux problèmes d'un coup.
- `updateFilterSummary()` appelle `libRows()`, et `renderLibrary()` l'appelle une seconde fois.
- `boot()` → `draw()` calcule `shelfTest` pour 6 rayons × N entrées, et `shelfTest`
  appelle `progressOf` → `totals` → 2 `norm()`. Soit ~10 000 `norm()` pour 800 séries,
  à chaque `boot()`.

### 3.3 Points de conception discutables (pas des bugs)

- `state` n'est persisté qu'à moitié : `unit`, `seeds`, `panel` survivent ; `view`, `shelf`,
  `source`, `sort`, `libType` non. Incohérent du point de vue de l'utilisateur.
- `state.hideOwned` est câblé dans `fillRecos` mais aucune UI ne le change. Réglage mort.
- `libRows()` trie « Progression » sur `b.r/(b.n||1)`, avec le `n` brut de l'import — alors que
  la carte affiche le pourcentage issu de `totals()`. Le tri ne correspond pas à l'affichage.
- `renderChapters` concatène `stored + fsList + pfList` sans déduplication : un même chapitre
  présent via le handle FS **et** via le dossier choisi apparaît deux fois.
- `alert` / `confirm` / `prompt` (import, retrait, saisie du total, enchaînement de chapitre).
  Dans un PWA en mode `standalone` c'est visuellement cassé, et sur iOS le `prompt` est
  parfois bloqué. À remplacer par les dialogues maison (le CSS `.modal` existe déjà).
- `openAddModal` ne pose pas `document.body.style.overflow = "hidden"` alors que `openSheet`
  le fait : l'arrière-plan défile derrière la modale d'ajout.

---

## 4. PWA, hors ligne, réseau

| Point | État | Action |
|---|---|---|
| `CACHE = "rayon-v1"` figé | **bloquant** | versionner au build, `index.html` en network-first |
| `start_url: "./index.html"` | incohérent | `"./"` — sinon `/` et `/index.html` sont deux entrées de cache distinctes |
| `manifest.id` absent | mineur | ajouter un `id` stable pour l'identité de l'app |
| `screenshots` absents | mineur | Chrome affiche une invite d'installation bien plus riche avec |
| Cache des couvertures AniList | non borné | grossit sans limite ; éviction LRU ou `Cache` séparé purgeable |
| Google Fonts | dépendance externe | voir §5 |
| Absence de `DecompressionStream` | message clair ✓ | bien géré |

Sur **MangaDex** : la réserve du LISEZ-MOI (« je n'ai pas pu tester la politique CORS »)
est levable en une commande. `api.mangadex.org` renvoie normalement
`Access-Control-Allow-Origin: *` — les appels navigateur passent. C'est le CDN d'images
(`uploads.mangadex.org`) qui est restreint, et l'app ne s'en sert pas. À vérifier une fois
depuis le navigateur, puis à corriger dans la doc : ça enlève un doute inutile.

Une remarque de fond : `translatedLanguage[]=en` est codé en dur alors que l'app est en
français. « Dernier chapitre traduit » veut donc dire « en anglais ». À rendre configurable,
ou au minimum à dire dans l'interface.

---

## 5. Vie privée : une affirmation à corriger

Le LISEZ-MOI dit : *« rien n'est envoyé nulle part, hormis les titres interrogés auprès d'AniList »*,
et le pied de page de l'app : *« Aucune donnée n'est envoyée ailleurs. »*

C'est inexact. `index.html:15` charge une feuille de style depuis `fonts.googleapis.com`,
qui tire ensuite les fichiers depuis `fonts.gstatic.com`. Google reçoit donc l'adresse IP et
l'en-tête `User-Agent` de chaque utilisateur, à chaque ouverture. Requêtes vers des tiers,
au total : AniList (titres), MangaDex (titres), le CDN d'images AniList (couvertures),
Google Fonts (IP).

**Correctif** : héberger les trois polices en local (`.woff2`, ~120 Ko au total avec un
sous-ensemble latin). Bénéfice triple — l'affirmation devient vraie, le premier rendu n'est
plus bloqué par un tiers, et le mode hors ligne fonctionne dès la première ouverture au lieu
de la deuxième. Ajouter `referrerpolicy="no-referrer"` sur les `<img>` de couvertures.

Côté sécurité applicative, rien d'alarmant : `esc()` couvre `& < > "`, tous les attributs
générés sont en guillemets doubles, les liens sortants ont `rel="noreferrer"`, aucun `eval`,
aucun `innerHTML` alimenté par une réponse réseau non échappée. Il manque une CSP
(`default-src 'self'; connect-src https://graphql.anilist.co https://api.mangadex.org; img-src 'self' blob: https:`)
— utile comme filet, pas comme urgence.

---

## 6. Accessibilité

- **Contraste insuffisant.** `--dim: #726F5F` sur `--paper: #D9D7CA` donne **3,49:1**
  (AA exige 4,5:1 pour du texte normal). Or c'est la couleur de `.rmeta`, `.statusline`,
  `.sub`, `.lm`, `.cm`, `.filtersum`, `.prov`, `.empty` — c'est-à-dire de **toute** la
  typographie secondaire, affichée par-dessus le marché en 9,5–10 px. Assombrir à
  ~`#5A5849` (≈ 5,5:1) ne change rien à l'esthétique et rend le texte lisible.
- **Sémantique des onglets fausse.** `<nav role="tablist">` contient trois `role="tab"`,
  mais le troisième (`tabAdd`) ouvre une modale, n'a jamais `aria-selected`, et il n'existe
  ni `aria-controls` ni `role="tabpanel"`. Un lecteur d'écran annonce un widget d'onglets
  qui n'en est pas un. → deux vrais onglets + un bouton d'action séparé.
- **Pas de piège de focus** dans `.sheet`, `.modal` ni le lecteur : la tabulation s'échappe
  vers la page du dessous. Et le focus n'est pas rendu à la carte d'origine à la fermeture.
- **Zones de tap du lecteur** (`.zone.l` / `.zone.r`) : des `div` avec `onclick`, invisibles
  au clavier et aux technologies d'assistance.
- **`aria-live` manquant** sur `#statusline` et `#discoverStatus`, qui sont pourtant les
  seuls retours pendant des opérations de plusieurs minutes.

---

## 7. Ce qui est bien, et qu'il ne faut pas casser

À dire clairement, parce que c'est la partie difficile et qu'elle est réussie :

- **Le décodage `.tachibk`.** Protobuf lu à la main, sans schéma, sans dépendance,
  en identifiant les bons numéros de champ. Du reverse engineering propre.
- **`readZip`.** Lecture du *central directory*, gestion du `method === 0` (stored),
  exclusion de `__MACOSX`, tri numérique naturel, détection du MIME par extension.
  Correct sur tous les points où l'on se trompe habituellement.
- **La cascade de provenance des totaux** (`totals()` + `provenanceHTML`). Rare et honnête :
  l'app dit *d'où vient le chiffre* et prévient quand la progression dépasse le total connu.
  Un choix de conception que la plupart des trackers ne font pas.
- **Le rapprochement dossier Mihon** avec `srcKey()` qui neutralise le suffixe de langue
  (`Asura Scans (EN)` → `asurascans`), et l'indexation par la fin du chemin pour être
  indifférent à la profondeur de la racine choisie. Bien vu.
- **Le LISEZ-MOI**, qui explique la contrainte `Android/data/` et refuse explicitement le
  scraping. Documentation d'un niveau très au-dessus de la moyenne.
- **La direction artistique.** Cohérente, assumée, sans framework.

---

## 8. Le plan « niveau supérieur » avec Claude Code

Ordonné par rapport valeur / effort. Les phases 0 et 1 changent tout ; le reste s'enchaîne.

### Phase 0 — le socle (30 min, à faire en premier)

1. **Déplacer le projet hors de Google Drive** → `C:\dev\rayon-app`.
   Drive + `.git` finissent par se corrompre mutuellement.
2. **`git init`**, `.gitignore`, premier commit de l'état actuel.
   Point de retour avant toute modification.
3. **Dépôt GitHub privé** + déploiement continu (Cloudflare Pages ou Netlify).
   Chaque `push` met l'app en ligne : plus de glisser-déposer manuel.
4. **`CLAUDE.md`** à la racine : conventions, invariants (« la clé d'une entrée est `al` sinon
   `id`, jamais le titre »), commandes, pièges connus. C'est ce fichier qui fait la différence
   entre un Claude Code qui devine et un Claude Code qui sait.

### Phase 1 — découper, sans rien changer d'autre

`index.html` → `src/` en modules ES, build Vite qui reproduit **le même fichier unique** en sortie
(`vite-plugin-singlefile`) pour ne rien perdre du « ça marche en ouvrant le fichier ».

```
src/
  core/     norm.js  key.js  store.js  storage-idb.js
  data/     anilist.js  mangadex.js  rate-limiter.js
  import/   tachibk.js  tachibk.worker.js  cbz.js
  fs/       mihon-folder.js  picked-folder.js
  ui/       library.js  sheet.js  reader.js  discover.js  tracker.js  chips.js
  state.js  boot.js
```

Découpage mécanique, sans refonte : on déplace, on n'améliore pas encore. Un commit par module,
vérifiable à l'œil.

### Phase 2 — les tests qui comptent

Vitest sur la logique pure uniquement. Une dizaine de fichiers, une petite heure :

- `norm` / `keyOf` : les cas CJK de §1.1 ;
- `chapNumOf` : le tableau de §1.6 en table de cas ;
- `totals` : la cascade de priorité, avec la matrice du LISEZ-MOI comme spécification ;
- `readZip` : un CBZ minimal en fixture (stored + deflate) ;
- `pbParse` : un `.tachibk` anonymisé de 3 séries ;
- `rankTally`, `srcKey`, `indexPickedFiles`.

Puis un unique test Playwright de fumée : charger l'app, importer une fixture JSON,
ouvrir une fiche, incrémenter, retirer. Il aurait attrapé le bug 1.4.

### Phase 3 — les correctifs, dans cet ordre

1. §1.1 clé stable (débloque Découvrir pour les bibliothèques VO)
2. §1.2 migration IndexedDB + remontée d'erreur de quota
3. §1.3 versionnement du service worker + invite de mise à jour
4. §1.4 `removeBtn`, §1.5 confirmation + fusion à l'import, §1.6 garde-fou `chapNumOf`
5. §2.1 progression du lecteur, §2.2 ordonnanceur d'API, §2.4 worker de parsing
6. §5 polices auto-hébergées, §6 contraste et sémantique des onglets

### Phase 4 — outillage Claude Code

- `.claude/settings.json` : autoriser `npm run test`, `npm run build`, `git status/diff`
  → beaucoup moins d'interruptions.
- Un *skill* projet `/rayon-fixture` qui génère un `.tachibk` de test à partir d'un JSON.
- Un hook `PostToolUse` sur `Edit` qui lance `npx vitest related` sur les fichiers touchés.
- `/code-review` avant chaque merge.

### Ce que je ne recommande pas

- **Pas de React / framework.** L'app est trop petite et le rendu déclaratif actuel, une fois
  débounced et délégué, suffit largement. Migrer coûterait des semaines pour zéro gain
  utilisateur.
- **Pas de TypeScript tout de suite.** À reconsidérer après la phase 2. JSDoc + `checkJs`
  dans `jsconfig.json` donne 80 % du bénéfice pour 5 % du coût, sans étape de compilation.
- **Pas de backend.** L'absence de serveur est le meilleur argument du produit. Le seul cas
  qui en justifierait un — un relais MangaDex — n'est pas nécessaire (voir §4).

---

## Résumé exécutable

| # | Sujet | Gravité | Effort |
|---|---|---|---|
| 1.1 | Titres non latins → clé vide | Bloquant | M |
| 1.2 | `localStorage` sature en silence | Bloquant | M |
| 1.3 | Service worker jamais mis à jour | Bloquant | S |
| 1.4 | « Retirer » mort après `refreshTracker` | Élevée | XS |
| 1.5 | Import écrase sans confirmation | Élevée | S |
| 1.6 | `chapNumOf` → progression à 2024 | Élevée | S |
| 2.1 | Écriture IndexedDB par page tournée | Élevée | S |
| 2.2 | Cadence API + seeds perdus en 429 | Élevée | M |
| 2.4 | Parsing BigInt bloquant | Moyenne | M |
| 2.5 | Fuite de stockage à la suppression | Moyenne | S |
| 5 | Google Fonts ≠ « rien n'est envoyé » | Moyenne | S |
| 6 | Contraste 3,49:1 sur tout le texte secondaire | Moyenne | XS |
