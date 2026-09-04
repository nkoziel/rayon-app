/* How many chapters/volumes actually exist, and WHERE that number came from.
   There is no single reliable source, so this is a priority cascade, and the provenance is
   surfaced in the UI rather than hidden — the app says where the figure came from and warns
   when progress exceeds it. Pure logic over META/MDCACHE: a natural test target. */

import { norm } from '../core/norm.js';
import { META, MDCACHE, MBCACHE, state } from '../core/state.js';
import { countVolumes } from '../core/volumes.js';
import { t as T } from '../core/i18n.js';

/* The cascade, weakest first — a later source overwrites an earlier one.
 *
 * The order was WRONG before and produced understated totals: MangaDex sat above AniList, so
 * Berserk showed 386 chapters when 401 exist. MangaDex reports what has been TRANSLATED, not
 * what was PUBLISHED. Measured over six series it yields a usable chapter maximum in 2 cases
 * and a volume structure in 1 — and nothing at all for the manhwa.
 *
 *   backup count  the number of chapters sitting at your reading source; counts duplicates
 *   mangadex      latest TRANSLATED chapter — a different question, and patchy coverage
 *   anilist       published counts, but only filled in for FINISHED series
 *   mangabaka     published counts aggregated from up to seven databases, ongoing included
 *   manual        your own entry, authoritative always
 */
const ORDER = ["mihon", "import", "mangadex", "anilist", "mangabaka", "manuel"];
const rank = src => ORDER.indexOf(src);

export function totals(d){
  const key = norm(d.t);
  const meta = META[key];
  const md = MDCACHE[key];
  const mb = MBCACHE[key];
  const out = { ch:null, chSrc:null, vol:null, volSrc:null, at: md && md.at };

  /* Only ever move to a source that outranks the one already in place. Writing it this way
     means adding a source is a line in ORDER, not a re-reading of the whole cascade. */
  const put = (field, srcField, value, src) => {
    if (!value) return;
    if (out[srcField] && rank(src) <= rank(out[srcField])) return;
    out[field] = value; out[srcField] = src;
  };

  if (d.n) put("ch", "chSrc", d.n, d.origin === "mihon" ? "mihon" : "import");
  if (md){ put("ch", "chSrc", md.maxCh, "mangadex"); put("vol", "volSrc", md.maxVol, "mangadex"); }
  if (meta && !meta.missing){
    /* AniList leaves `chapters` empty for an ongoing series. That emptiness is a database
       limitation, not a fact about the series — never treat it as one. */
    /* "completed" is the token every source is normalised to; the French string is what
       records cached before that normalisation still hold. */
    const fini = meta.statut === "completed" || meta.statut === "Terminé";
    if (fini || !out.ch) put("ch", "chSrc", meta.chapitres, "anilist");
    if (fini || !out.vol) put("vol", "volSrc", meta.volumes, "anilist");
  }
  if (mb){ put("ch", "chSrc", mb.chapitres, "mangabaka"); put("vol", "volSrc", mb.volumes, "mangabaka"); }
  put("ch", "chSrc", d.manCh, "manuel");
  put("vol", "volSrc", d.manVol, "manuel");
  return out;
}

/* Source names and the caveat that goes with each. Looked up at call time rather than frozen
   into a const table, so switching language re-labels a provenance line already on screen. */
export const srcLabel = src => T("src." + src);
export const srcNote  = src => T("srcnote." + src);

/* The unit a series is tracked in, as an internal token — "vol" or "ch". Display labels come
   from unitLabel()/unitShort(); keeping them apart is what stopped a French build comparing
   against the string "tomes". */
export function unitOf(d){ return d.unit || state.unit; }

export const unitLabel = u => T(u === "vol" ? "unit.volLong"  : "unit.chLong");
export const unitShort = u => T(u === "vol" ? "unit.volShort" : "unit.chShort");

/* Reading progress against the effective total, in whichever unit the series uses.
   Lives here rather than with the grid because the tracker needs it too, and putting it in
   the library module would make library -> sheet -> tracker -> library a cycle. */
export function progressOf(d){
  const t = totals(d);
  const unit = unitOf(d);
  if (unit === "vol"){
        /* On the volume axis "read" means OWNED: chapters track reading, volumes track the
       physical collection. See core/volumes.js. */
    const read = countVolumes(d.ownedVol), tot = t.vol || 0;
    return {read, tot, pct: tot ? Math.min(100, Math.round(read/tot*100)) : 0,
            label: read + (tot ? "/"+tot : "") + " " + unitShort("vol"),
            remain: tot ? tot-read : null, unit:"vol", t};
  }
  const read = d.r || 0, tot = t.ch || 0;
  return {read, tot, pct: tot ? Math.min(100, Math.round(read/tot*100)) : 0,
          label: read + (tot ? "/"+tot : "") + " " + unitShort("ch"),
          remain: tot ? Math.round((tot-read)*10)/10 : null, unit:"ch", t};
}
