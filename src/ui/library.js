/* The library grid and its filters. */

import { $, esc } from '../core/dom.js';
import { libraryChanged } from './refresh.js';
import { norm } from '../core/norm.js';
import { LIB, META, state } from '../core/state.js';
import { t as T } from '../core/i18n.js';
import { progressOf } from '../data/totals.js';
import { openSheet } from './sheet.js';

export const SHELVES = ["Tout","En cours","À rattraper","Terminées","Jamais ouvertes","Ajoutées à la main"];
export const SORTS = ["Lecture récente","Titre","Chapitres lus","Progression","Note AniList"];
export const TYPES = ["Tous","Manga","Manhwa","Manhua"];
export const LIBTYPES = ["Tous types","Manga","Manhwa","Manhua","Webtoon"];
export const DSORTS = ["Pertinence","Note","Popularité"];

export function shelfTest(d, shelf){
  const behind = progressOf(d).remain;
  switch(shelf){
    case "En cours": return d.r > 0 && (d.n ? d.r < d.n : true);
    case "À rattraper": return d.r > 0 && behind !== null && behind >= 5;
    case "Terminées": return d.n > 0 && d.r >= d.n;
    case "Jamais ouvertes": return d.r === 0;
    case "Ajoutées à la main": return d.origin === "manuel";
    default: return true;
  }
}

export function typeOf(d){
  const m = META[norm(d.t)];
  if (m && !m.missing && m.type) return m.type;
  return d.m === "Webtoon" ? "Manhwa" : "Manga";
}
export function libTypeTest(d){
  if (state.libType === "Tous types") return true;
  if (state.libType === "Webtoon") return d.m === "Webtoon";
  return typeOf(d) === state.libType;
}

export function libRows(){
  const needle = norm(state.q);
  const out = LIB.entries.filter(d=>{
    if (!libTypeTest(d)) return false;
    if (!shelfTest(d, state.shelf)) return false;
    if (state.source !== "Toutes" && d.s !== state.source) return false;
    if (needle){
      const m = META[norm(d.t)];
      const hay = d.t+" "+d.a+" "+d.g.join(" ")+" "+(m && !m.missing ? m.romaji+" "+m.genres.join(" ") : "");
      if (!norm(hay).includes(needle)) return false;
    }
    return true;
  });
  const score = d => { const m = META[norm(d.t)]; return (m && m.score) || 0; };
  if (state.sort==="Titre") out.sort((a,b)=>a.t.localeCompare(b.t,"fr"));
  if (state.sort==="Chapitres lus") out.sort((a,b)=>b.r-a.r);
  if (state.sort==="Lecture récente") out.sort((a,b)=>(b.d||"").localeCompare(a.d||"")||b.r-a.r);
  if (state.sort==="Progression") out.sort((a,b)=>(b.r/(b.n||1))-(a.r/(a.n||1)));
  if (state.sort==="Note AniList") out.sort((a,b)=>score(b)-score(a));
  return out;
}

export function posterHTML(d){
  const meta = META[norm(d.t)];
  const p = progressOf(d);
  const pct = p.pct;
  const cover = meta && !meta.missing ? meta.cover : "";
  const score = meta && !meta.missing ? meta.score : null;
  const behind = p.remain;
  const tape = d.origin === "manuel" ? "Manuel" : (behind >= 5 ? "+"+behind+" "+(p.unit==="tomes"?"t.":"ch.") : (d.m === "Webtoon" ? "Webtoon" : ""));
  return `<button class="card" data-id="${d.id}">
    <div class="poster">
      ${cover?`<img src="${esc(cover)}" alt="" loading="lazy" decoding="async">`:`<span class="fallback">${esc(d.t)}</span>`}
      ${tape?`<span class="tape">${esc(tape)}</span>`:""}
      ${score?`<span class="score">${score}</span>`:""}
      <span class="prog"><i class="${pct===100?"done":""}" style="width:${pct}%"></i></span>
    </div>
    <div class="ct">${esc(d.t)}</div>
    <div class="sub"><span class="src">${esc(d.s)}</span><span>${esc(p.label)}</span></div>
  </button>`;
}

export function listHTML(d){
  const meta = META[norm(d.t)];
  const cover = meta && !meta.missing ? meta.cover : "";
  return `<button class="lrow" data-id="${d.id}">
    ${cover?`<img src="${esc(cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
    <span style="min-width:0"><span class="lt">${esc(d.t)}</span><br>
    <span class="lm">${esc(d.s)} · ${esc(d.st)}${d.d?" · "+esc(d.d):""}</span></span>
    <span class="lp">${esc(progressOf(d).label)}</span>
  </button>`;
}

export function renderLibrary(){
  if (state.tab !== "library") return;
  const box = $("results");
  if (!LIB.entries.length){ box.innerHTML = ""; return; }
  if ($("filterSum")) updateFilterSummary();
  const list = libRows();
  box.innerHTML = !list.length
    ? `<p class="empty">${esc(T("lib.noMatch"))}</p>`
    : (state.view === "grid"
        ? `<div class="grid">${list.map(posterHTML).join("")}</div>`
        : `<div class="list">${list.map(listHTML).join("")}</div>`);
  [...box.querySelectorAll("[data-id]")].forEach(el=>{
    el.onclick = () => openSheet(LIB.entries.find(x=>x.id===el.dataset.id));
  });
}

export function updateFilterSummary(){
  const active = (state.shelf !== "Tout") + (state.source !== "Toutes") + (state.q ? 1 : 0) + (state.libType !== "Tous types");
  $("filterDot").classList.toggle("hidden", active === 0);
  const parts = [];
  if (state.libType !== "Tous types") parts.push(state.libType);
  if (state.shelf !== "Tout") parts.push(state.shelf);
  if (state.source !== "Toutes") parts.push(state.source);
  parts.push("tri : "+state.sort.toLowerCase());
  $("filterSum").innerHTML = `<b>${libRows().length}</b> séries · ${esc(parts.join(" · "))}`
    + (active ? ` <button class="btn sm ghost" id="clearFilters">Tout afficher</button>` : "");
  const cf = $("clearFilters");
  if (cf) cf.onclick = () => {
    state.shelf = "Tout"; state.source = "Toutes"; state.libType = "Tous types"; state.q = ""; $("q").value = "";
    libraryChanged(); renderLibrary();
  };
}
