/* How many chapters/volumes actually exist, and WHERE that number came from.
   There is no single reliable source, so this is a priority cascade, and the provenance is
   surfaced in the UI rather than hidden — the app says where the figure came from and warns
   when progress exceeds it. Pure logic over META/MDCACHE: a natural test target. */

import { norm } from '../core/norm.js';
import { META, MDCACHE, state } from '../core/state.js';
import { countVolumes } from '../core/volumes.js';

/* ---- totaux effectifs, avec provenance ----
   priorité : saisie manuelle > MangaDex > AniList (séries terminées) > chapitres de la source Mihon */
export function totals(d){
  const meta = META[norm(d.t)];
  const md = MDCACHE[norm(d.t)];
  const out = {ch:null, chSrc:null, vol:null, volSrc:null, at: md && md.at};
  if (md && md.maxCh){ out.ch = md.maxCh; out.chSrc = "mangadex"; }
  if (md && md.maxVol){ out.vol = md.maxVol; out.volSrc = "mangadex"; }
  if (meta && !meta.missing){
    const fini = meta.statut === "Terminé";
    if (meta.chapitres && (!out.ch || (fini && meta.chapitres > out.ch))){ out.ch = meta.chapitres; out.chSrc = "anilist"; }
    if (meta.volumes && (!out.vol || fini)){ out.vol = meta.volumes; out.volSrc = "anilist"; }
  }
  if (!out.ch && d.n){ out.ch = d.n; out.chSrc = d.origin === "mihon" ? "mihon" : "import"; }
  if (d.manCh){ out.ch = d.manCh; out.chSrc = "manuel"; }
  if (d.manVol){ out.vol = d.manVol; out.volSrc = "manuel"; }
  return out;
}

export const SRCLABEL = {
  mangadex:"MangaDex", anilist:"AniList", mihon:"chapitres de ta source", import:"fichier importé", manuel:"saisi à la main"
};
export const SRCNOTE = {
  mangadex:"structure des tomes et dernier chapitre traduit recensés par MangaDex",
  anilist:"AniList ne renseigne les totaux que pour les séries achevées",
  mihon:"nombre de chapitres présents chez ta source de lecture",
  import:"valeur venue du fichier importé",
  manuel:"ta saisie"
};

/* unité effective d'une série */
export function unitOf(d){ return d.unit || state.unit; }

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
            label: read + (tot ? "/"+tot : "") + " tomes", remain: tot ? tot-read : null, unit:"tomes", t};
  }
  const read = d.r || 0, tot = t.ch || 0;
  return {read, tot, pct: tot ? Math.min(100, Math.round(read/tot*100)) : 0,
          label: read + (tot ? "/"+tot : "") + " ch.", remain: tot ? Math.round((tot-read)*10)/10 : null, unit:"chapitres", t};
}
