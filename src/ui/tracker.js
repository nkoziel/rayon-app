/* The per-series tracking block: counter, unit toggle, totals and their provenance.
   Rendered into #trackwrap, and re-rendered wholesale on every change — which is why every
   control it contains must be wired in wireTracker(), never once at sheet-open (REVIEW.md §1.4). */

import { $, esc, toast } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { LIB, MDCACHE, saveLib, state } from '../core/state.js';
import { t as T } from '../core/i18n.js';
import { totals, unitOf, progressOf, srcLabel, srcNote, unitLabel } from '../data/totals.js';
import { parseVolumes, toggleVolume, addRange, countVolumes, missingVolumes,
         gapVolumes, gridSize, lastOwned } from '../core/volumes.js';
import { mdAggregate } from '../data/mangadex.js';
import { purgeSeriesData } from '../import/library.js';
import { libraryChanged } from './refresh.js';

export function provenanceHTML(d){
  const t = totals(d);
  const unit = unitOf(d);
  const md = MDCACHE[norm(d.t)];
  const lines = [];
  /* One line, built the same way on both axes: the figure, where it came from, and the caveat
     that source carries. The "checked on" date is MangaDex-only — it is the one source whose
     answer is a snapshot of what has been translated so far, not a published total. */
  const totalLine = (value, src) =>
    `${esc(unit === "vol" ? T("prov.totalVol") : T("prov.totalCh"))} <b>${value}</b> — ${esc(srcLabel(src))}`
    + (src === "mangadex" && t.at ? esc(T("prov.checkedOn", { date: t.at })) : "")
    + `. <span>${esc(srcNote(src))}.</span>`;

  if (unit === "vol"){
    lines.push(t.vol
      ? totalLine(t.vol, t.volSrc)
      : `<span class="warn">${esc(T("prov.noVolSplit"))}</span> ${esc(T("prov.noVolSplitNote"))}`);
  } else {
    lines.push(t.ch
      ? totalLine(t.ch, t.chSrc)
      : `<span class="warn">${esc(T("prov.noTotal"))}</span> ${esc(T("prov.noTotalNote"))}`);
  }
  if (md && md.id === null)
    lines.push(`<span class="warn">${esc(T("prov.notOnMangadex"))}</span> ${esc(T("prov.notOnMangadexNote"))}`);
  const p = unit === "vol" ? {read:countVolumes(d.ownedVol), tot:t.vol} : {read:d.r||0, tot:t.ch};
  if (p.tot && p.read > p.tot)
    lines.push(`<span class="warn">${esc(T("prov.pastTotal", { read: p.read, total: p.tot }))}</span> ${esc(T("prov.pastTotalNote"))}`);
  return `<div class="prov">${lines.join("<br>")}</div>`;
}

export function trackerHTML(d){
  const unit = unitOf(d);
  const p = progressOf(d);
  const read = unit === "vol" ? countVolumes(d.ownedVol) : (d.r||0);
  const remainTxt = p.tot
    ? (p.remain > 0 ? T("track.remaining", { n: p.remain, unit: unitLabel(p.unit) }) : T("track.upToDate"))
    : T("track.unknownTotal");
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
      <button class="btn sm ghost" id="removeBtn" style="margin-left:auto">${esc(T("btn.remove"))}</button>
    </div>
    ${provenanceHTML(d)}`;
}

/* One button per volume: tap to say you own it. Big targets, gaps visible at a glance —
   this is meant to be read at arm's length in a shop, not studied.

   The grid renders whether or not a volume count is known; see gridSize() in core/volumes.js
   for why that matters more than it looks. Cells past what is known to exist are drawn dashed:
   still tappable, because you own what you own, but the app does not claim they were
   published. */
function volumeGridHTML(d, total){
  const list = parseVolumes(d.ownedVol);
  const owned = new Set(list);
  const n = list.length;
  const max = lastOwned(d.ownedVol);
  const size = gridSize(total, max);
  const missing = missingVolumes(d.ownedVol, total).length;
  const gaps = gapVolumes(d.ownedVol).length;

  /* A hole BELOW what you already own is a different fact from a volume you simply have not
     reached yet, and it is the one worth acting on: it is the gap on the shelf. Drawn as such
     they were indistinguishable — volume 10 missing out of 1-14 owned looked exactly like
     volume 40 of 42 not yet bought. */
  const gapSet = new Set(gapVolumes(d.ownedVol));
  const cells = [];
  for (let v = 1; v <= size; v++)
    cells.push(volBtn(v, owned.has(v), total ? v > total : v > max, gapSet.has(v)));

  /* The count on the left, and on the right the one thing worth acting on: what is still
     missing, or that the collection is finished. Nothing on the right when no total is known —
     the line above it already says "total inconnu" and the provenance block below says what to
     do about it. Saying it a third time here only pushes the grid down the screen. */
  const head = total
    ? `<span class="rmeta">${esc(T("vol.ownedOf", { n, total }))}</span>
       <span class="rmeta ${missing ? "" : "zero"}" style="margin-left:auto">${esc(missing ? T("vol.missingCount", { n: missing }) : T("vol.complete"))}</span>`
    : `<span class="rmeta">${esc(T("vol.ownedCount", { n }))}</span>`;

  const pct = total ? Math.min(100, Math.round(n / total * 100)) : 0;

  return `
    <div class="trackline">${head}</div>
    ${total ? `<div class="shelfbar" role="img" aria-label="${esc(T("vol.ownedOf", { n, total }))}"><span style="width:${pct}%"></span></div>` : ""}
    <div class="volgrid" role="group" aria-label="${esc(T("vol.gridLabel"))}">${cells.join("")}</div>
    ${gaps ? `<p class="rmeta zero" style="margin:0 0 6px">${esc(T("vol.gapsHint", { n: gaps }))}</p>` : ""}`;
}

const volBtn = (v, owned, ghost, gap) =>
  `<button class="vol ${owned ? "own" : ""} ${ghost ? "ghosted" : ""} ${gap ? "gap" : ""}" data-vol="${v}" aria-pressed="${owned}">${v}</button>`;

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
      /* "1-1" is a useless suggestion, and it is what a series with no published total used
         to offer. Fall back to the collection's own reach, then to nothing at all. */
      const hint = totals(d).vol || lastOwned(d.ownedVol) || "";
      const v = prompt(T("vol.ownRangePrompt"), "1-" + hint);
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
    const v = prompt(T(unit === "vol" ? "track.setTotalVol" : "track.setTotalCh"), cur);
    if (v === null) return;
    const n = parseFloat(String(v).replace(",", "."));
    if (isNaN(n) || n < 0){ if (unit==="vol") delete d.manVol; else delete d.manCh; }
    else if (unit === "vol") d.manVol = n; else d.manCh = n;
    refreshTracker(d, onRemoved);
  };
  $("mdCheck").onclick = async () => {
    const btn = $("mdCheck");
    btn.disabled = true; btn.textContent = T("track.checking");
    try{
      const info = await mdAggregate(d);
      toast(info.maxCh
        ? T("track.latestChapter", { n: info.maxCh }) + (info.maxVol ? T("track.alsoVolumes", { n: info.maxVol }) : "")
        : T("track.noChapterListed"));
      refreshTracker(d, onRemoved);
    }catch(e){
      btn.disabled = false; btn.textContent = T("btn.checkReleases");
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
    if (!confirm(T("track.removeConfirm", { title: d.t }))) return;
    LIB.entries = LIB.entries.filter(x=>x.id !== d.id);
    saveLib(); if (onRemoved) onRemoved(); libraryChanged();
    toast(T("toast.seriesRemoved"));
    /* after the UI has closed: the user should not wait on a cleanup they cannot see */
    await purgeSeriesData(d);
  };
}
