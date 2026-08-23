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
};

const LOCALES = { en, fr };
export const AVAILABLE = Object.keys(LOCALES);

/* English by default. A French browser starts in French on first run, because defaulting a
   French speaker to English when we have a complete French locale would be perverse — but
   the stored choice always wins once made. */
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
