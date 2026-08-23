# Rayon — notes pour Claude Code

Application web autonome (PWA) : bibliothèque manga, suivi de progression, recommandations
croisées AniList. Aucun compte, aucun serveur, tout en local dans le navigateur.

## État du code

`index.html` est un **fichier unique de ~1 970 lignes** (HTML + CSS + JS inline). Le découpage
en modules est prévu (voir `REVUE.md` §8 phase 1) mais **pas encore fait**. Tant qu'il ne l'est
pas : éditer par `Edit` ciblé, jamais par réécriture complète du fichier.

## Invariants — à ne pas violer

1. **La clé d'une entrée est `al` (id AniList) sinon `id` (uid). JAMAIS le titre.**
   Le code actuel indexe par `norm(titre)`, ce qui est le bug bloquant §1.1 de `REVUE.md` :
   `norm()` supprime tout caractère non-ASCII, donc tout titre japonais/coréen/chinois donne
   `""` et toutes ces séries s'écrasent entre elles. Toute nouvelle indexation doit utiliser
   la clé stable, et `norm()` ne doit servir qu'au rapprochement flou (dossier Mihon).

2. **`store.set()` renvoie `false` en cas de quota plein — cette valeur doit être lue.**
   Aujourd'hui elle est ignorée partout, donc la bibliothèque cesse silencieusement d'être
   sauvegardée dès ~5 Mo (§1.2).

3. **`CACHE` dans `sw.js` doit être incrémenté à chaque livraison**, sinon aucun utilisateur
   installé ne recevra jamais la mise à jour (§1.3). `index.html` devrait passer en
   network-first.

4. **Pas de scraping d'agrégateurs.** Position explicite du projet, cf. `LISEZ-MOI.md`.

5. **Ne pas casser l'ouverture directe du fichier.** `index.html` doit rester ouvrable sans
   serveur. Si un build arrive, il produit un fichier unique (`vite-plugin-singlefile`).

## Pièges connus

- `refreshTracker()` remplace `innerHTML` de `#trackwrap` puis appelle `wireTracker()`, qui ne
  recâble **pas** `removeBtn` (câblé une seule fois dans `openSheet`). Tout bouton ajouté à
  `trackerHTML()` doit être câblé dans `wireTracker()`.
- `chapNumOf()` retombe sur « le premier nombre du nom de fichier » : `[2024] Vol.3 - 12.cbz`
  renvoie `2024`, et `finish()` l'écrit dans la progression (§1.6).
- AniList : 30 req/min. Le `sleep(700)` actuel fait ~85 req/min → 429 en rafale.
- `norm()` est appelé des milliers de fois par rendu — mémoïser ou passer à la clé stable.

## Sources de données

| Source | Usage | Contrainte |
|---|---|---|
| AniList GraphQL | fiches, recommandations | 30 req/min, sans clé |
| MangaDex API | totaux, découpage en tomes | CORS OK sur `api.mangadex.org` ; le CDN d'images ne l'est pas |
| MangaBaka | mappings inter-bases, dump nocturne | CC BY-NC-SA 4.0 — attribution obligatoire, non commercial |

## Documents de référence

- `REVUE.md` — revue technique complète, bugs numérotés (§1.1 à §6) et plan en phases.
  Les numéros de section y font autorité dans les commits et discussions.
- `LISEZ-MOI.md` — documentation utilisateur (français).

## Environnement

- Node/npm **ne sont pas installés** sur cette machine à ce jour — toute étape de build en
  dépend et doit être annoncée avant.
- Le projet a été déplacé hors de Google Drive vers `C:\dev\rayon-app` (Drive corrompt `.git`).
