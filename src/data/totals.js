/* How many chapters/volumes actually exist, and WHERE that number came from.
   There is no single reliable source, so this is a priority cascade, and the provenance is
   surfaced in the UI rather than hidden — the app says where the figure came from and warns
   when progress exceeds it. Pure logic over META/MDCACHE: a natural test target. */

import { norm } from '../core/norm.js';
import { META, MDCACHE, state } from '../core/state.js';

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

