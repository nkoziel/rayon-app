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
import { whyHTML } from './why.js';
import { openLayer, replaceLayer, closeLayer } from './layers.js';

let current = null;

/* The actual teardown. Only layers.js calls this, from popstate — see the rule in that file. */
function teardownSheet(){ current = null; $("overlay").innerHTML = ""; document.body.style.overflow = ""; }

/* What every control inside the app calls. It goes back through history so the entry the sheet
   pushed is consumed; if no layer is open (nothing pushed), it closes directly. */
export function closeSheet(){ if (!closeLayer()) teardownSheet(); }

export function recoRowHTML(r){
  const meta = [r.type, r.annee, r.chapitres?r.chapitres+" ch.":null, r.statut, r.score?r.score+"/100":null].filter(Boolean).join(" · ");
  return `<div class="rec">
    ${r.cover?`<img class="cover" src="${esc(r.cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
    <div style="min-width:0">
      <div class="rtitle"><button class="titlelink" data-open="${esc(String(r.mb ?? r.id))}">${esc(r.titre)}</button>${isOwned(r)?'<span class="owned">déjà chez toi</span>':''}</div>
      <div class="rmeta">${esc(meta)}</div>
      <div class="rwhy">${whyHTML(r)}</div>
      ${isOwned(r)?"":`<div class="ractions"><button class="btn sm" data-addreco="${r.mb ?? r.id}">${esc(T("reco.add"))}</button></div>`}
    </div>
  </div>`;
}

/* Turn a recommendation into something openSheet() can render.
 *
 * A series you have not added has no entry, so it has no id, no progress and no source. It
 * still has everything the sheet is mostly made of: cover, genres, description, the record and
 * its recommendations. Rather than build a second, thinner screen for it - which is how the
 * two views drifted apart in the first place - the sheet takes a provisional entry and swaps
 * the tracking block for an Add button. One screen, whether the series is yours or not. */
export function previewEntry(r){
  return {
    id: "preview:" + (r.mb ?? r.id),
    t: r.titre, a: r.auteur || "", s: T("preview.notInLibrary"),
    st: r.statut || "", g: r.genres || [],
    r: 0, ownedVol: "", n: r.chapitres || 0, d: "", ad: "",
    al: r.id || null, m: r.type === "Manhwa" ? "Webtoon" : "", origin: "preview",
  };
}

/* Open the sheet for a recommendation that is not in the library. The record is handed in
   directly: MBCACHE only holds series you own, so recordOf() would find nothing. */
export function openPreview(r, onAdded){
  /* recordOf() is what normally stamps `src`, and the credit line the CC BY-NC-SA licence
     requires is built from it. A record handed in directly skips that, and the sheet rendered
     "via" followed by nothing — an attribution failure, not a cosmetic one. */
  const record = r.src ? r : { ...r, src: r.mb ? "mangabaka" : "anilist" };
  openSheet(previewEntry(r), { record, preview: true, onAdded });
}

export function openSheet(d, opts){
  if (!d) return;
  opts = opts || {};
  /* Read before `current` is overwritten: a sheet opened FROM a sheet reuses the history entry
     rather than stacking a second one. */
  const wasOpen = !!current;
  current = d;
  const preview = !!opts.preview;
  /* Source-agnostic: the record handed in for a preview, else MangaBaka, else AniList. */
  const meta = opts.record || recordOf(d);
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
        ${preview
          ? `<div class="trackline"><button class="btn" id="addBtn" style="flex:1 1 auto">${esc(T("reco.add"))}</button>
             <button class="btn ghost" id="skipBtn">${esc(T("discover.skip"))}</button></div>
             <p class="rmeta" style="margin:0 0 4px">${esc(T("preview.hint"))}</p>`
          : `<div class="trackwrap" id="trackwrap">${trackerHTML(d)}</div>`}
        ${mihonAvailable() ? `<button class="btn" id="mihonBtn" style="width:100%">${esc(T("mihon.search"))}</button>
        <p class="rmeta" style="margin:6px 0 0">${esc(T("mihon.hint"))}</p>` : ""}
        <dl>
          ${preview ? "" : `<dt>Dernière fois</dt><dd>${esc(d.d||"—")}</dd>
          <dt>Ajouté le</dt><dd>${esc(d.ad||"—")}</dd>`}
          <dt>Auteur</dt><dd>${esc((meta&&meta.auteur)||d.a||"—")}</dd>
          ${preview ? "" : `<dt>Source</dt><dd>${esc(d.s)}</dd>`}
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
  $("refresh").onclick = () => fillRecos(d, true, opts.record);
  const moreBtn = $("moreBtn");
  if (moreBtn) moreBtn.onclick = () => {
    const el = $("desc"); el.classList.toggle("clamped");
    moreBtn.textContent = el.classList.contains("clamped") ? "Lire la suite" : "Replier";
  };
  if (preview){
    /* Adding re-opens the sheet on the real entry, so the screen the user is looking at becomes
       the tracking one without a second click. */
    $("addBtn").onclick = () => {
      if (!addFromMedia(opts.record, { source: T("preview.fromDiscover") })) return;
      if (opts.onAdded) opts.onAdded();
      const added = LIB.entries.find(x => norm(x.t) === norm(d.t));
      if (added) openSheet(added); else closeSheet();
    };
    $("skipBtn").onclick = () => { closeSheet(); if (opts.onSkip) opts.onSkip(); };
  } else {
    wireTracker(d, closeSheet);   // also wires removeBtn — see REVIEW.md §1.4
  }
  const mb = $("mihonBtn");
  /* The share sheet needs the click's user activation, so this stays in the handler and is not
     awaited into a later tick. A refusal is the user changing their mind, not a failure. */
  if (mb) mb.onclick = () => { openInMihon(d.t).catch(() => toast(T("mihon.failed"))); };
  /* Last, so a throw while rendering cannot leave a history entry with nothing behind it. */
  if (wasOpen) replaceLayer(teardownSheet); else openLayer(teardownSheet);
  fillRecos(d, false, opts.record);
}

export async function fillRecos(d, force, record){
  const box = $("recos");
  box.innerHTML = `<p class="loading">${esc(T("reco.loading"))}</p>`;
  try{
    const payload = await recosFor(d, force, record);
    if (current !== d) return;
    if (!payload.items.length){
      box.innerHTML = `<p class="note">${esc(T("reco.none"))} <a href="${esc(payload.source)}" target="_blank" rel="noreferrer">${esc(T("reco.seeOn", { title: payload.matched }))}</a></p>`;
      return;
    }
    const visible = payload.items.filter(r => !state.hideOwned || !isOwned(r));
    box.innerHTML = visible.length
      ? visible.map(recoRowHTML).join("")
      : `<p class="note">${esc(T("reco.allOwned", { n: payload.items.length }))}</p>`;
    /* Same screen whether the series is yours or not: a recommendation opens the sheet, not a
       tab on someone else's website. */
    [...box.querySelectorAll("[data-open]")].forEach(b=>{
      b.onclick = () => {
        const r = payload.items.find(x => String(x.mb ?? x.id) === b.dataset.open);
        if (!r) return;
        const mine = LIB.entries.find(x => norm(x.t) === norm(r.titre));
        if (mine) openSheet(mine); else openPreview(r);
      };
    });
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
  /* Escape goes through the same door as back, or the entry it pushed would be left behind
     and the next back press would appear to do nothing. */
  if ($("modalHost").innerHTML){ if (!closeLayer()) closeModal(); }
  else if (current) closeSheet();
});
