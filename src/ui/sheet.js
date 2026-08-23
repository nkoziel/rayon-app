/* The series sheet: metadata, tracking block, and reader-voted recommendations. */

import { $, esc, toast, closeModal } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { recordOf, CREDIT } from '../data/record.js';
import { LIB, META, saveLib, isOwned, state } from '../core/state.js';
import { t as T } from '../core/i18n.js';
import { recosFor } from '../data/recos.js';
import { totals, unitOf, progressOf } from '../data/totals.js';
import { purgeSeriesData } from '../import/library.js';
import { trackerHTML, wireTracker, provenanceHTML } from './tracker.js';
import { addFromMedia } from './add.js';
import { mihonAvailable, openInMihon } from './mihon.js';
import { libraryChanged } from './refresh.js';

let current = null;
export function closeSheet(){ current = null; $("overlay").innerHTML = ""; document.body.style.overflow = ""; }

/* Say WHY this was recommended, not just that it was.
   MangaBaka knows the shared tags and the shared readers; AniList only ever knew a vote
   count, so that is what it falls back to. */
function whyHTML(r){
  const w = r.why;
  if (!w) return `<b>${r.votes||0} ${esc(T("reco.readers"))}</b> ${esc(T("reco.madeLink"))}${r.genres && r.genres.length ? " · " + esc(r.genres.slice(0,3).join(", ")) : ""}`;

  const bits = [];
  if (w.sameAuthor) bits.push(`<b>${esc(T("reco.sameAuthor"))}</b>`);
  if (w.tags && w.tags.length) bits.push(esc(T("reco.shares", { tags: w.tags.join(", ") })));
  if (w.sharedUsers) bits.push(esc(T("reco.sharedReaders", { n: w.sharedUsers })));
  if (!bits.length && w.tagsTotal) bits.push(esc(T("reco.sharedTags", { n: w.tagsTotal })));
  /* The badge is its own element and needs a separator — without one it rendered as
     "…ont les deuxtags et lecteurs concordent". */
  const badge = w.both ? ` <span class="agree">${esc(T("reco.both"))}</span>` : "";
  return bits.join(" · ") + badge;
}

export function recoRowHTML(r){
  const meta = [r.type, r.annee, r.chapitres?r.chapitres+" ch.":null, r.statut, r.score?r.score+"/100":null].filter(Boolean).join(" · ");
  return `<div class="rec">
    ${r.cover?`<img class="cover" src="${esc(r.cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
    <div style="min-width:0">
      <div class="rtitle"><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.titre)}</a>${isOwned(r)?'<span class="owned">déjà chez toi</span>':''}</div>
      <div class="rmeta">${esc(meta)}</div>
      <div class="rwhy">${whyHTML(r)}</div>
      ${isOwned(r)?"":`<div class="ractions"><button class="btn sm" data-addreco="${r.mb ?? r.id}">${esc(T("reco.add"))}</button></div>`}
    </div>
  </div>`;
}

export function openSheet(d){
  if (!d) return;
  current = d;
  /* Source-agnostic: MangaBaka when we have it, AniList otherwise. */
  const meta = recordOf(d);
  const pct = d.n ? Math.min(100, Math.round(d.r/d.n*100)) : 0;
  const behind = meta && meta.chapitres ? meta.chapitres - d.r : null;
    const hmeta = [meta&&meta.type, meta&&meta.annee, meta&&meta.statut,
    meta&&meta.score ? meta.score+"/100" + (meta.sources > 1 ? " ("+meta.sources+")" : "") : null]
    .filter(Boolean).join(" · ");
  $("overlay").innerHTML = `
    <div class="scrim" id="scrim"></div>
    <aside class="sheet" role="dialog" aria-label="Fiche ${esc(d.t)}">
      <div class="sheetbar"><span class="sbt">${esc(d.s)}</span><button class="close" id="closeBtn">Fermer ✕</button></div>
      <div class="hero">
        ${meta && meta.banner ? `<img class="banner" src="${esc(meta.banner)}" alt="">` : '<div class="noban"></div>'}
        <div class="front">
          ${meta && meta.cover ? `<img src="${esc(meta.cover)}" alt="">` : '<span class="ph"></span>'}
          <div><h2>${esc(d.t)}</h2><div class="hmeta">${esc(hmeta || d.s)}</div></div>
        </div>
      </div>
      <div class="sbody">
        <div>
          ${d.m==="Webtoon"?'<span class="pill hi">Webtoon</span>':''}
          ${d.origin==="manuel"?'<span class="pill hi">Ajout manuel</span>':''}
          ${(meta?meta.genres:d.g).slice(0,8).map(g=>`<span class="pill">${esc(g)}</span>`).join("")}
        </div>
        <div class="trackwrap" id="trackwrap">${trackerHTML(d)}</div>
        ${mihonAvailable() ? `<button class="btn" id="mihonBtn" style="width:100%">Chercher dans Mihon</button>` : ""}
        <dl>
          <dt>Dernière fois</dt><dd>${esc(d.d||"—")}</dd>
          <dt>Ajouté le</dt><dd>${esc(d.ad||"—")}</dd>
          <dt>Auteur</dt><dd>${esc((meta&&meta.auteur)||d.a||"—")}</dd>
          <dt>Source</dt><dd>${esc(d.s)}</dd>
          ${meta ? `<dt>${esc(T("sheet.record"))}</dt><dd><a href="${esc(meta.url)}" target="_blank" rel="noreferrer">${esc(meta.titre)}</a> ${esc(T("sheet.via", { source: (CREDIT[meta.src]||{}).name || "" }))}${(CREDIT[meta.src]||{}).licence ? ` <span class="rmeta">(${esc(CREDIT[meta.src].licence)})</span>` : ""}</dd>` : ""}
        </dl>
        ${meta && meta.desc ? `<div class="desc clamped" id="desc">${esc(meta.desc)}</div><button class="more" id="moreBtn">Lire la suite</button>` : ""}
        <div class="seclabel"><span>Ce que lisent ceux qui ont aimé</span><button class="btn ghost sm" id="refresh">Actualiser</button></div>
        <div id="recos"><p class="loading">Interrogation d'AniList</p></div>
      </div>
    </aside>`;
  document.body.style.overflow = "hidden";
  $("scrim").onclick = closeSheet;
  const cb = $("closeBtn"); cb.onclick = closeSheet; cb.focus();
  $("refresh").onclick = () => fillRecos(d, true);
  const moreBtn = $("moreBtn");
  if (moreBtn) moreBtn.onclick = () => {
    const el = $("desc"); el.classList.toggle("clamped");
    moreBtn.textContent = el.classList.contains("clamped") ? "Lire la suite" : "Replier";
  };
  wireTracker(d, closeSheet);   // also wires removeBtn — see REVIEW.md §1.4
  const mb = $("mihonBtn");
  if (mb) mb.onclick = () => openInMihon(d.t);
  fillRecos(d, false);
}

export async function fillRecos(d, force){
  const box = $("recos");
  box.innerHTML = `<p class="loading">${esc(T("reco.loading"))}</p>`;
  try{
    const payload = await recosFor(d, force);
    if (current !== d) return;
    if (!payload.items.length){
      box.innerHTML = `<p class="note">${esc(T("reco.none"))} <a href="${esc(payload.source)}" target="_blank" rel="noreferrer">${esc(T("reco.seeOn", { title: payload.matched }))}</a></p>`;
      return;
    }
    const visible = payload.items.filter(r => !state.hideOwned || !isOwned(r));
    box.innerHTML = visible.length
      ? visible.map(recoRowHTML).join("")
      : `<p class="note">${esc(T("reco.allOwned", { n: payload.items.length }))}</p>`;
    [...box.querySelectorAll("[data-addreco]")].forEach(b=>{
      b.onclick = () => {
        const r = payload.items.find(x => String(x.mb ?? x.id) === b.dataset.addreco);
        if (r && addFromMedia(r)){ b.textContent = T("reco.added"); b.disabled = true; }
      };
    });
  }catch(e){
    if (current !== d) return;
    box.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
}
document.addEventListener("keydown", e => {
  if (e.key !== "Escape") return;
  if ($("modalHost").innerHTML) closeModal();
  else if (current) closeSheet();
});
