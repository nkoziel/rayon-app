/* Interface language.
 *
 * English is the DEFAULT so the app is easy to share; French is a complete alternative
 * because the owner uses it in French. French is not a fallback with gaps — a missing key
 * is a bug, and `missingKeys()` below exists so the harness can fail on one.
 *
 * Keys are semantic (`toast.seriesRemoved`), never the English text itself: re-wording the
 * English copy must not silently orphan the French entry.
 *
 * NOTE: interface language and CONTENT language are different axes. This has nothing to do
 * with which scanlation language MangaDex chapters come in.
 */

/* Deliberately imports NOTHING. store.js needs t() for its own messages, so importing store
   here would create a cycle — and since the language is picked at module-init time, the
   evaluation order would leave `store` in its temporal dead zone and throw at boot.
   Reading one preference key directly is cheaper than that coupling. */
const STORAGE_KEY = "lang:v1";

const readPref = () => { try{ return localStorage.getItem(STORAGE_KEY); }catch(e){ return null; } };
const writePref = (v) => { try{ localStorage.setItem(STORAGE_KEY, v); }catch(e){} };

const en = {
  "app.title":              "Rayon",
  "tab.library":            "Library",
  "tab.discover":           "Discover",
  "tab.add":                "Add",

  "btn.import":             "Import",
  "btn.export":             "Export",
  "btn.reset":              "Erase everything",
  "btn.checkReleases":      "Check releases",
  "btn.listView":           "List view",
  "btn.gridView":           "Grid view",
  "btn.searchInMihon":      "Search in Mihon",
  "btn.close":              "Close",
  "btn.cancel":             "Cancel",
  "btn.merge":              "Merge",
  "btn.replace":            "Replace",
  "btn.remove":             "Remove",

  "unit.chapters":          "Tracking: chapters",
  "unit.volumes":           "Tracking: volumes",

  "lib.defaultLabel":       "Local library",
  "lib.dropzone":           "Drop your .tachibk backup or your .json export",
  "lib.noMatch":            "No series matches.",

  "lang.label":             "Language",
  "lang.en":                "English",
  "lang.fr":                "Français",

  "toast.seriesRemoved":    "Series removed",
  "toast.newVersion":       "New version — reload the page",
  "toast.exported":         "Export downloaded — share this file with anyone",
  "toast.erased":           "Data erased — reloading…",
  "toast.imported":         { one: "{n} series imported", other: "{n} series imported" },
  "toast.merged":           "{added} added, {updated} updated",

  "storage.full":           "Storage full — export your library so nothing is lost",
  "storage.cacheFull":      "Cache not saved — the device storage is full",
  "storage.unavailable":    "Local storage unavailable.",
  "storage.error":          "Storage error.",
  "storage.blocked":        "Another Rayon window is blocking the storage upgrade. Close it and reload.",

  "net.anilistUnreachable":   "Could not reach AniList. Check your connection.",
  "net.anilistRateLimited":   "AniList is rate limiting ({s}s to wait).",
  "net.anilistBadResponse":   "Unreadable response from AniList.",
  "net.anilistError":         "AniList error.",
  "net.anilistNoMatch":       "No AniList entry matches this title.",
  "net.anilistNotFound":      "AniList entry not found.",
  "net.mdUnreachable":        "MangaDex unreachable from this browser (CORS or network).",
  "net.mdRateLimited":        "MangaDex is rate limiting, try again in a minute.",
  "net.mdStatus":             "MangaDex answered {code}.",
  "net.mdNotFound":           "This series is not listed on MangaDex.",
  "import.reading":           "Reading {name}…",
  "import.mihonBackup":       "Mihon backup · {name}",
  "import.jsonList":          "Imported list · {name}",
  "import.noSeries":          "No series found in this file.",
  "import.badJson":           "Unrecognised JSON file.",
  "import.noGzip":            "This browser cannot decompress gzip (Chrome, Edge, Firefox 113+, Safari 16.4+ required).",
  "import.failed":            "Import failed: {msg}",
  "import.dialogLabel":       "Import a library",
  "reset.blocked":            "Close the other Rayon tabs and try again — storage is still open elsewhere.",
  "backup.unknownSource":     "Unknown source",
  "filter.type":              "Type",
  "filter.shelf":             "Shelf",
  "filter.source":            "Source",
  "filter.sort":              "Sort",
  "discover.resetDismissed":  "Show dismissed again",
  "discover.seriesAnalysed":  "Series analysed",
  "add.searchPlaceholder":    "Manga, manhwa or webtoon name…",

  "shelf.all":                 "All",
  "shelf.reading":             "Reading",
  "shelf.behind":              "Catching up",
  "shelf.finished":            "Finished",
  "shelf.unopened":            "Never opened",
  "shelf.manual":              "Added by hand",
  "sort.recent":               "Recently read",
  "sort.title":                "Title",
  "sort.chapters":             "Chapters read",
  "sort.progress":             "Progress",
  "sort.score":                "AniList score",
  "libtype.all":               "All types",
  "libtype.manga":             "Manga",
  "libtype.manhwa":            "Manhwa",
  "libtype.manhua":            "Manhua",
  "libtype.webtoon":           "Webtoon",
  "type.all":                  "All",
  "dsort.relevance":           "Relevance",
  "dsort.score":               "Score",
  "dsort.popularity":          "Popularity",
  "source.all":                "All",
  "seeds.count":               "{n} series",
  "seeds.all":                 "All my series",
  "filter.showAll":            "Show all",
  "filter.sortBy":             "sorted by {what}",
  "filter.summary":            { one: "series", other: "series" },

  "btn.postersView":           "Poster view",
  "toast.byChapters":          "Showing chapters",
  "toast.byVolumes":           "Showing volumes — each series can be set separately in its sheet",
  "stats.series":              "Series",
  "stats.chaptersRead":        "Chapters read",
  "stats.finished":            "Finished",
  "stats.reading":             "Reading",
  "onboard.title":             "Start your library",
  "onboard.body":              "Add the series you read, then the <b>Discover</b> tab cross-references the recommendations AniList readers voted on and surfaces what comes up most. A Mihon or Tachiyomi user? Import your <b>.tachibk</b> backup — it is decoded right here, nothing is sent to a server.",
  "onboard.search":            "Search for a title",
  "onboard.import":            "Import a backup",
  "reset.exportFirst":         "Export your library before erasing it?\n\n{n} series. The export is the only possible backup.",

  "tabs.label":                "Main sections",

  "track.chapters":            "Chapters",
  "track.volumes":             "Volumes",
  "track.unitLabel":           "Tracking unit",
  "track.chapterReached":      "Chapter reached",
  "track.progress":            "Progress",
  "track.allRead":             "All read",
  "track.setTotal":            "Set the total",
  "vol.gridLabel":             "Volumes owned",
  "vol.ownedOf":               "{n} of {total} owned",
  "vol.ownedCount":            {"one":"{n} volume owned","other":"{n} volumes owned"},
  "vol.missingCount":          {"one":"{n} missing","other":"{n} missing"},
  "vol.complete":              "Complete",
  "vol.noTotal":               "No known volume count — set it to build a shopping list",
  "vol.ownRange":              "I own 1 to N",
  "vol.ownRangePrompt":        "Which volumes do you own? For example 1-12, or a single number.",

  "net.mbUnreachable":         "MangaBaka unreachable. Check your connection.",
  "net.mbRateLimited":         "MangaBaka is rate limiting ({s}s to wait).",
  "net.mbStatus":              "MangaBaka answered {code}.",
  "net.mbBadResponse":         "Unreadable response from MangaBaka.",

  "hydrate.resolving":         "Fetching records · {done}/{total}",
  "hydrate.done":              "{n} records of {total} · cached",

  "sheet.record":              "Record",
  "sheet.via":                 "via {source}",

  "reco.loading":              "Looking for connections…",
  "reco.readers":              "readers",
  "reco.madeLink":             "made the connection",
  "reco.sameAuthor":           "Same author",
  "reco.shares":               "shares {tags}",
  "reco.sharedReaders":        {"one":"{n} reader has both","other":"{n} readers have both"},
  "reco.sharedTags":           {"one":"{n} shared tag","other":"{n} shared tags"},
  "reco.both":                 "tags and readers agree",
  "reco.none":                 "No connection recorded for this series.",
  "reco.seeOn":                "See {title}",
  "reco.allOwned":             "All {n} titles recommended here are already yours.",
  "reco.add":                  "Add to my list",
  "reco.added":                "Added",

  "tab.shopping":              "Shopping",
  "shop.setPrice":             "Price per volume",
  "shop.pricePrompt":          "Roughly how much does one volume cost? Used only to estimate.",
  "shop.priceSet":             "Estimating at {price} per volume",
  "shop.continue":             "Continue a collection",
  "shop.continueNote":         "{cost} to complete everything",
  "shop.start":                "Start a collection",
  "shop.startNote":            "read, owned in print: nothing yet",
  "shop.missing":              "Missing:",
  "shop.ownedOf":              "{n} of {total} volumes",
  "shop.gap":                  {"one":"{n} gap","other":"{n} gaps"},
  "shop.volumesOwned":         "Volumes owned",
  "shop.volumesMissing":       "Missing",
  "shop.complete":             "Complete",
  "shop.estimatedValue":       "Estimated value",
  "shop.completeNote":         {"one":"{n} collection is complete.","other":"{n} collections are complete."},
  "shop.empty":                "No series is tracked by volume yet. Switch a series to Volumes in its sheet to start a collection.",
  "shop.priceNote":            "Estimated at {price} per volume — no database publishes prices.",
  "foot.sources":              "Records and recommendations: MangaBaka (CC BY-NC-SA 4.0), AniList, MangaDex.",
  "foot.privacy":              "Your library stays in this browser. Nothing is sent anywhere except the titles you look up.",
};

const fr = {
  "app.title":              "Rayon",
  "tab.library":            "Bibliothèque",
  "tab.discover":           "Découvrir",
  "tab.add":                "Ajouter",

  "btn.import":             "Importer",
  "btn.export":             "Exporter",
  "btn.reset":              "Tout effacer",
  "btn.checkReleases":      "Vérifier les sorties",
  "btn.listView":           "Vue liste",
  "btn.gridView":           "Vue grille",
  "btn.searchInMihon":      "Chercher dans Mihon",
  "btn.close":              "Fermer",
  "btn.cancel":             "Annuler",
  "btn.merge":              "Fusionner",
  "btn.replace":            "Remplacer",
  "btn.remove":             "Retirer",

  "unit.chapters":          "Suivi : chapitres",
  "unit.volumes":           "Suivi : tomes",

  "lib.defaultLabel":       "Bibliothèque locale",
  "lib.dropzone":           "Dépose ta sauvegarde .tachibk ou ton export .json",
  "lib.noMatch":            "Aucune série ne correspond.",

  "lang.label":             "Langue",
  "lang.en":                "English",
  "lang.fr":                "Français",

  "toast.seriesRemoved":    "Série retirée",
  "toast.newVersion":       "Nouvelle version — recharge la page",
  "toast.exported":         "Export téléchargé — partage ce fichier à qui tu veux",
  "toast.erased":           "Données effacées — rechargement…",
  "toast.imported":         { one: "{n} série importée", other: "{n} séries importées" },
  "toast.merged":           "{added} ajoutée(s), {updated} mise(s) à jour",

  "storage.full":           "Stockage plein — exporte ta bibliothèque pour ne rien perdre",
  "storage.cacheFull":      "Cache non enregistré — le stockage de l'appareil est plein",
  "storage.unavailable":    "Stockage local indisponible.",
  "storage.error":          "Erreur de stockage.",
  "storage.blocked":        "Une autre fenêtre de Rayon bloque la mise à jour du stockage. Ferme-la puis recharge.",

  "net.anilistUnreachable":   "Impossible de joindre AniList. Vérifie ta connexion.",
  "net.anilistRateLimited":   "AniList limite les requêtes ({s} s d'attente).",
  "net.anilistBadResponse":   "Réponse illisible d'AniList.",
  "net.anilistError":         "Erreur AniList.",
  "net.anilistNoMatch":       "Aucune fiche AniList ne correspond à ce titre.",
  "net.anilistNotFound":      "Fiche AniList introuvable.",
  "net.mdUnreachable":        "MangaDex injoignable depuis ce navigateur (blocage CORS ou réseau).",
  "net.mdRateLimited":        "MangaDex limite les requêtes, réessaie dans une minute.",
  "net.mdStatus":             "MangaDex a répondu {code}.",
  "net.mdNotFound":           "Cette série n'est pas référencée sur MangaDex.",
  "import.reading":           "Lecture de {name}…",
  "import.mihonBackup":       "Sauvegarde Mihon · {name}",
  "import.jsonList":          "Liste importée · {name}",
  "import.noSeries":          "Aucune série trouvée dans ce fichier.",
  "import.badJson":           "Fichier JSON non reconnu.",
  "import.noGzip":            "Ce navigateur ne décompresse pas le gzip (Chrome, Edge, Firefox 113+, Safari 16.4+ requis).",
  "import.failed":            "Import impossible : {msg}",
  "import.dialogLabel":       "Importer une bibliothèque",
  "reset.blocked":            "Ferme les autres onglets de Rayon puis réessaie — le stockage est encore ouvert ailleurs.",
  "backup.unknownSource":     "Source inconnue",
  "filter.type":              "Type",
  "filter.shelf":             "Rayon",
  "filter.source":            "Source",
  "filter.sort":              "Tri",
  "discover.resetDismissed":  "Réafficher les écartés",
  "discover.seriesAnalysed":  "Séries analysées",
  "add.searchPlaceholder":    "Nom du manga, manhwa, webtoon…",

  "shelf.all":                 "Tout",
  "shelf.reading":             "En cours",
  "shelf.behind":              "À rattraper",
  "shelf.finished":            "Terminées",
  "shelf.unopened":            "Jamais ouvertes",
  "shelf.manual":              "Ajoutées à la main",
  "sort.recent":               "Lecture récente",
  "sort.title":                "Titre",
  "sort.chapters":             "Chapitres lus",
  "sort.progress":             "Progression",
  "sort.score":                "Note AniList",
  "libtype.all":               "Tous types",
  "libtype.manga":             "Manga",
  "libtype.manhwa":            "Manhwa",
  "libtype.manhua":            "Manhua",
  "libtype.webtoon":           "Webtoon",
  "type.all":                  "Tous",
  "dsort.relevance":           "Pertinence",
  "dsort.score":               "Note",
  "dsort.popularity":          "Popularité",
  "source.all":                "Toutes",
  "seeds.count":               "{n} séries",
  "seeds.all":                 "Toutes mes séries",
  "filter.showAll":            "Tout afficher",
  "filter.sortBy":             "tri : {what}",
  "filter.summary":            { one: "série", other: "séries" },

  "btn.postersView":           "Vue posters",
  "toast.byChapters":          "Affichage par chapitres",
  "toast.byVolumes":           "Affichage par tomes — chaque série peut être réglée à part dans sa fiche",
  "stats.series":              "Séries",
  "stats.chaptersRead":        "Chapitres lus",
  "stats.finished":            "Terminées",
  "stats.reading":             "En cours",
  "onboard.title":             "Commence ta bibliothèque",
  "onboard.body":              "Ajoute les séries que tu lis, puis l'onglet <b>Découvrir</b> croise les recommandations votées par les lecteurs d'AniList pour te sortir ce qui revient le plus souvent. Utilisateur de Mihon ou Tachiyomi ? Importe ta sauvegarde <b>.tachibk</b>, elle est décodée ici même, sans rien envoyer sur un serveur.",
  "onboard.search":            "Chercher un titre",
  "onboard.import":            "Importer une sauvegarde",
  "reset.exportFirst":         "Exporter ta bibliothèque avant de l'effacer ?\n\n{n} série(s). L'export est la seule sauvegarde possible.",

  "tabs.label":                "Sections principales",

  "track.chapters":            "Chapitres",
  "track.volumes":             "Tomes",
  "track.unitLabel":           "Unité de suivi",
  "track.chapterReached":      "Chapitre atteint",
  "track.progress":            "Progression",
  "track.allRead":             "Tout lu",
  "track.setTotal":            "Saisir le total",
  "vol.gridLabel":             "Tomes possédés",
  "vol.ownedOf":               "{n} tomes sur {total}",
  "vol.ownedCount":            {"one":"{n} tome possédé","other":"{n} tomes possédés"},
  "vol.missingCount":          {"one":"{n} manquant","other":"{n} manquants"},
  "vol.complete":              "Complète",
  "vol.noTotal":               "Nombre de tomes inconnu — saisis-le pour avoir une liste de courses",
  "vol.ownRange":              "Je possède 1 à N",
  "vol.ownRangePrompt":        "Quels tomes possèdes-tu ? Par exemple 1-12, ou un seul numéro.",

  "net.mbUnreachable":         "MangaBaka injoignable. Vérifie ta connexion.",
  "net.mbRateLimited":         "MangaBaka limite les requêtes ({s} s d\u0027attente).",
  "net.mbStatus":              "MangaBaka a répondu {code}.",
  "net.mbBadResponse":         "Réponse illisible de MangaBaka.",

  "hydrate.resolving":         "Récupération des fiches · {done}/{total}",
  "hydrate.done":              "{n} fiches sur {total} · en cache",

  "sheet.record":              "Fiche",
  "sheet.via":                 "via {source}",

  "reco.loading":              "Recherche des rapprochements…",
  "reco.readers":              "lecteurs",
  "reco.madeLink":             "font le rapprochement",
  "reco.sameAuthor":           "Même auteur",
  "reco.shares":               "partage {tags}",
  "reco.sharedReaders":        {"one":"{n} lecteur a les deux","other":"{n} lecteurs ont les deux"},
  "reco.sharedTags":           {"one":"{n} tag en commun","other":"{n} tags en commun"},
  "reco.both":                 "tags et lecteurs concordent",
  "reco.none":                 "Aucun rapprochement recensé pour cette série.",
  "reco.seeOn":                "Voir {title}",
  "reco.allOwned":             "Les {n} titres recommandés ici sont déjà chez toi.",
  "reco.add":                  "Ajouter à ma liste",
  "reco.added":                "Ajouté",

  "tab.shopping":              "Courses",
  "shop.setPrice":             "Prix par tome",
  "shop.pricePrompt":          "Combien coûte un tome environ ? Sert uniquement à estimer.",
  "shop.priceSet":             "Estimation à {price} par tome",
  "shop.continue":             "Continuer une collection",
  "shop.continueNote":         "{cost} pour tout compléter",
  "shop.start":                "Commencer une collection",
  "shop.startNote":            "lus, possédés en papier : rien encore",
  "shop.missing":              "Manquants :",
  "shop.ownedOf":              "{n} tomes sur {total}",
  "shop.gap":                  {"one":"{n} trou","other":"{n} trous"},
  "shop.volumesOwned":         "Tomes possédés",
  "shop.volumesMissing":       "Manquants",
  "shop.complete":             "Complètes",
  "shop.estimatedValue":       "Valeur estimée",
  "shop.completeNote":         {"one":"{n} collection est complète.","other":"{n} collections sont complètes."},
  "shop.empty":                "Aucune série n'est suivie en tomes. Bascule une série sur Tomes dans sa fiche pour commencer une collection.",
  "shop.priceNote":            "Estimé à {price} par tome — aucune base ne publie les prix.",
  "foot.sources":              "Fiches et recommandations : MangaBaka (CC BY-NC-SA 4.0), AniList, MangaDex.",
  "foot.privacy":              "Ta bibliothèque reste dans ce navigateur. Rien n'est envoyé ailleurs, hormis les titres consultés.",
};

const LOCALES = { en, fr };
export const AVAILABLE = Object.keys(LOCALES);

/* THE RULE (decided 2026-08-23): English by default, EXCEPT when the browser is in French.
   In order: a stored choice always wins; failing that a French browser gets French; failing
   that, English. This is deliberate, not an oversight — do not "fix" it into always-English:
   shipping English to a French speaker when a complete French locale exists is worse, and
   English still greets everyone else the app gets shared with. */
function pick(){
  const saved = readPref();
  if (saved && LOCALES[saved]) return saved;
  const nav = (navigator.languages && navigator.languages[0]) || navigator.language || "en";
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current = pick();

export const locale = () => current;

export function setLocale(l){
  if (!LOCALES[l]) return false;
  current = l;
  writePref(l);
  document.documentElement.lang = l;
  return true;
}

const plural = (n, l) => new Intl.PluralRules(l).select(n);

/* Look up a key, interpolate {placeholders}, and pick a plural form when the entry has one.
   An unknown key returns the key itself rather than empty text: visible in the UI, greppable,
   and impossible to mistake for correct output. */
export function t(key, params){
  const table = LOCALES[current] || en;
  let v = table[key];
  if (v === undefined) v = en[key];
  if (v === undefined){ console.warn("[rayon] i18n: cle inconnue", key); return key; }

  if (v && typeof v === "object"){
    const n = params && params.n;
    v = v[plural(Number(n) || 0, current)] || v.other || v.one;
  }
  if (!params) return v;
  return String(v).replace(/\{(\w+)\}/g, (m, k) => (params[k] !== undefined ? params[k] : m));
}

/* Translate static markup: <b data-i18n="tab.library"> and
   <input data-i18n-attr="placeholder:add.searchPlaceholder">. Called at boot and after a
   language change, so the shell does not have to be re-rendered from JS. */
export function applyStatic(root = document){
  root.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  root.querySelectorAll("[data-i18n-attr]").forEach(el => {
    el.getAttribute("data-i18n-attr").split(";").forEach(pair => {
      const [attr, key] = pair.split(":").map(s => s && s.trim());
      if (attr && key) el.setAttribute(attr, t(key));
    });
  });
  document.documentElement.lang = current;
}

/* Every locale must be complete. The harness asserts this so a half-translated release
   cannot ship — French silently falling back to English is a bug, not a graceful degradation. */
export function missingKeys(){
  const out = {};
  const reference = Object.keys(en);
  for (const [name, table] of Object.entries(LOCALES)){
    const missing = reference.filter(k => table[k] === undefined);
    const extra = Object.keys(table).filter(k => !reference.includes(k));
    if (missing.length || extra.length) out[name] = { missing, extra };
  }
  return out;
}
