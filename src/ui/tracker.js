/* The per-series tracking block: counter, unit toggle, totals and their provenance.
   Rendered into #trackwrap, and re-rendered wholesale on every change — which is why every
   control it contains must be wired in wireTracker(), never once at sheet-open (REVIEW.md §1.4). */

import { $, esc, toast } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { LIB, MDCACHE, saveLib, state } from '../core/state.js';
import { t as T } from '../core/i18n.js';
import { totals, unitOf, progressOf, SRCLABEL, SRCNOTE } from '../data/totals.js';
import { parseVolumes, toggleVolume, addRange, countVolumes, missingVolumes } from '../core/volumes.js';
import { mdAggregate } from '../data/mangadex.js';
import { purgeSeriesData } from '../import/library.js';
import { libraryChanged } from './refresh.js';

export function provenanceHTML(d){
  const t = totals(d);
  const unit = unitOf(d);
  const md = MDCACHE[norm(d.t)];
  const lines = [];
  if (unit === "vol"){
    lines.push(t.vol
      ? `Total tomes : <b>${t.vol}</b> — ${SRCLABEL[t.volSrc]}${t.volSrc==="mangadex"&&t.at?`, relevé le ${t.at}`:""}. <span>${SRCNOTE[t.volSrc]}.</span>`
      : `<span class="warn">Aucun découpage en tomes connu.</span> Fréquent pour les webtoons, publiés sans édition papier. Vérifie sur MangaDex ou saisis le total à la main.`);
  } else {
    lines.push(t.ch
      ? `Total chapitres : <b>${t.ch}</b> — ${SRCLABEL[t.chSrc]}${t.chSrc==="mangadex"&&t.at?`, relevé le ${t.at}`:""}. <span>${SRCNOTE[t.chSrc]}.</span>`
      : `<span class="warn">Aucun total fiable.</span> Série en cours : AniList ne publie pas de compte tant qu'elle n'est pas achevée. Vérifie sur MangaDex ou saisis le total.`);
  }
  if (md && md.id === null) lines.push(`<span class="warn">Absente de MangaDex</span> — le suivi des sorties doit être manuel.`);
  const p = unit === "vol" ? {read:countVolumes(d.ownedVol), tot:t.vol} : {read:d.r||0, tot:t.ch};
  if (p.tot && p.read > p.tot) lines.push(`<span class="warn">Tu es allé plus loin que le total connu (${p.read} > ${p.tot}).</span> Les numérotations diffèrent souvent entre scantrad et édition officielle : saisis le total à la main pour trancher.`);
  return `<div class="prov">${lines.join("<br>")}</div>`;
}

export function trackerHTML(d){
  const unit = unitOf(d);
  const p = progressOf(d);
  const read = unit === "vol" ? countVolumes(d.ownedVol) : (d.r||0);
  const remainTxt = p.tot
    ? (p.remain > 0 ? `Reste ${p.remain} ${p.unit}` : "À jour")
    : "Total inconnu";
  return `
    <div class="trackline">
      <div class="seg" role="group" aria-label="${esc(T("track.unitLabel"))}">
        <button data-unit="ch" aria-pressed="${unit==="ch"}">${esc(T("track.chapters"))}</button>
        <button data-unit="vol" aria-pressed="${unit==="vol"}">${esc(T("track.volumes"))}</button>
      </div>
      <span class="remain ${p.remain===0?"zero":""}">${esc(remainTxt)}</span>
    </div>
    ${unit === "vol" ? volumeGridHTML(d, p.tot) : `
    <div class="trackline">
      <span class="rmeta">${esc(T("track.chapterReached"))}</span>
      <button class="btn sm ghost" id="minus">−</button>
      <input type="number" id="readInput" value="${read}" min="0" step="0.5" aria-label="${esc(T("track.progress"))}">
      <button class="btn sm ghost" id="plus">+</button>
      <span class="rmeta">${p.tot ? "/ "+p.tot : "/ ?"}</span>
      <button class="btn sm" id="allRead">${esc(T("track.allRead"))}</button>
    </div>`}
    <div class="trackline">
      <button class="btn sm ghost" id="mdCheck">${esc(T("btn.checkReleases"))}</button>
      <button class="btn sm ghost" id="setTotal">${esc(T("track.setTotal"))}</button>
      ${unit==="vol" ? `<button class="btn sm ghost" id="ownRange">${esc(T("vol.ownRange"))}</button>` : ""}
      <button class="btn sm ghost" id="removeBtn" style="margin-left:auto">Retirer</button>
    </div>
    ${provenanceHTML(d)}`;
}

/* One button per volume: tap to say you own it. Big targets, gaps visible at a glance —
   this is meant to be read at arm's length in a shop, not studied. */
function volumeGridHTML(d, total){
  const owned = new Set(parseVolumes(d.ownedVol));
  const n = countVolumes(d.ownedVol);
  if (!total){
    return `<div class="trackline"><span class="rmeta">${esc(T("vol.noTotal"))}</span>
      <span class="rmeta" style="margin-left:auto">${esc(T("vol.ownedCount", { n }))}</span></div>
      ${n ? `<div class="volgrid">${[...owned].sort((a,b)=>a-b).map(v=>volBtn(v,true)).join("")}</div>` : ""}`;
  }
  const cells = [];
  for (let v = 1; v <= total; v++) cells.push(volBtn(v, owned.has(v)));
  const missing = missingVolumes(d.ownedVol, total).length;
  return `
    <div class="trackline">
      <span class="rmeta">${esc(T("vol.ownedOf", { n, total }))}</span>
      <span class="rmeta ${missing ? "" : "zero"}" style="margin-left:auto">${esc(missing ? T("vol.missingCount", { n: missing }) : T("vol.complete"))}</span>
    </div>
    <div class="volgrid" role="group" aria-label="${esc(T("vol.gridLabel"))}">${cells.join("")}</div>`;
}

const volBtn = (v, owned) =>
  `<button class="vol ${owned ? "own" : ""}" data-vol="${v}" aria-pressed="${owned}">${v}</button>`;

export function refreshTracker(d, onRemoved){
  $("trackwrap").innerHTML = trackerHTML(d);
  wireTracker(d, onRemoved);
  saveLib(); libraryChanged();
}

export function wireTracker(d, onRemoved){
  const unit = unitOf(d);
  const setRead = v => {
    const val = Math.max(0, Math.round((+v||0)*2)/2);
    d.r = val;
    d.d = new Date().toISOString().slice(0,10);
    refreshTracker(d, onRemoved);
  };
  if (unit !== "vol"){
    $("minus").onclick = () => setRead((d.r||0) - 1);
    $("plus").onclick = () => setRead((d.r||0) + 1);
    $("readInput").onchange = e => setRead(e.target.value);
    $("allRead").onclick = () => { const p = progressOf(d); if (p.tot) setRead(p.tot); };
  } else {
    [...$("trackwrap").querySelectorAll("[data-vol]")].forEach(b => {
      b.onclick = () => {
        d.ownedVol = toggleVolume(d.ownedVol, +b.dataset.vol);
        refreshTracker(d, onRemoved);
      };
    });
    const or = $("ownRange");
    if (or) or.onclick = () => {
      /* "I own 1 to 12" in one gesture rather than twelve taps. */
      const v = prompt(T("vol.ownRangePrompt"), "1-" + (totals(d).vol || 1));
      if (!v) return;
      const m = String(v).match(/^\s*(\d+)\s*[-–]\s*(\d+)\s*$/);
      if (m) d.ownedVol = addRange(d.ownedVol, +m[1], +m[2]);
      else {
        const one = parseInt(v, 10);
        if (Number.isFinite(one) && one > 0) d.ownedVol = toggleVolume(d.ownedVol, one);
      }
      refreshTracker(d, onRemoved);
    };
  }
  [...$("trackwrap").querySelectorAll("[data-unit]")].forEach(b=>{
    b.onclick = () => { d.unit = b.dataset.unit; refreshTracker(d, onRemoved); };
  });
  $("setTotal").onclick = () => {
    const cur = unit === "vol" ? (d.manVol || totals(d).vol || "") : (d.manCh || totals(d).ch || "");
    const v = prompt(unit === "vol" ? "Nombre de tomes parus :" : "Nombre de chapitres parus :", cur);
    if (v === null) return;
    const n = parseFloat(String(v).replace(",", "."));
    if (isNaN(n) || n < 0){ if (unit==="vol") delete d.manVol; else delete d.manCh; }
    else if (unit === "vol") d.manVol = n; else d.manCh = n;
    refreshTracker(d, onRemoved);
  };
  $("mdCheck").onclick = async () => {
    const btn = $("mdCheck");
    btn.disabled = true; btn.textContent = "Vérification…";
    try{
      const info = await mdAggregate(d);
      toast(info.maxCh ? `Dernier chapitre traduit : ${info.maxCh}${info.maxVol?` · ${info.maxVol} tomes`:""}` : "Aucun chapitre recensé");
      refreshTracker(d, onRemoved);
    }catch(e){
      btn.disabled = false; btn.textContent = "Vérifier les sorties";
      const box = document.createElement("p");
      box.className = "err"; box.style.marginTop = "8px"; box.textContent = e.message;
      $("trackwrap").appendChild(box);
    }
  };
  /* removeBtn lives inside trackerHTML(), so refreshTracker() destroys and recreates it on
     every counter change. It MUST be wired here and not in openSheet(), otherwise it is dead
     after the first "+" click. See REVIEW.md §1.4. Same goes for any button added to
     trackerHTML() later. */
  $("removeBtn").onclick = async () => {
    if (!confirm("Retirer « "+d.t+" » de ta bibliothèque ?\n\nSes données en cache seront également supprimées.")) return;
    LIB.entries = LIB.entries.filter(x=>x.id !== d.id);
    saveLib(); if (onRemoved) onRemoved(); libraryChanged();
    toast(T("toast.seriesRemoved"));
    /* after the UI has closed: the user should not wait on a cleanup they cannot see */
    await purgeSeriesData(d);
  };
}
