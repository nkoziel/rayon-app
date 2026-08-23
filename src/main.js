"use strict";

import { $, esc, stripTags, sleep, uid, toast } from './core/dom.js';
import { norm } from './core/norm.js';
import { t as T, setLocale, locale, AVAILABLE, applyStatic } from './core/i18n.js';
import { gql, shapeMedia, searchBatch, loadRecos, RECO_Q, SEARCH_PAGE_Q } from './data/anilist.js';
import { hydrate } from './data/hydrate.js';
import { mdResolve, mdAggregate } from './data/mangadex.js';
import { totals, unitOf, SRCLABEL, SRCNOTE } from './data/totals.js';
import { importFile, exportLib, mergeLibraries, purgeSeriesData, resetEverything } from './import/library.js';
import { mihonAvailable, openInMihon } from './ui/mihon.js';
import { addFromMedia, openAddModal } from './ui/add.js';
import { runDiscover, renderDiscover, visibleDiscover } from './ui/discover.js';
import { onLibraryChanged } from './ui/refresh.js';
import { renderShopping, shoppingRows, askPrice, defaultPrice } from './ui/shopping.js';
import { renderLibrary, libRows, shelfTest, typeOf, updateFilterSummary, SHELVES, SORTS, TYPES, LIBTYPES, DSORTS, MEDIA_TYPE } from './ui/library.js';
import { openSheet, closeSheet } from './ui/sheet.js';
import { progressOf } from './data/totals.js';
import { closeModal } from './core/dom.js';
import { store, db, forgetDb, kvGet, kvSet, kvDel, DB_NAME } from './core/store.js';
import {
  LIB, setLib, saveLib, META, MDCACHE, DISCOVER, setDiscover, markMetaDirty, saveMeta,
  OWNED, refreshOwned, isOwned, DISMISSED, saveDismissed, state,
  migrateCaches, loadCaches, CACHE_KEYS, DEAD_KEYS
} from './core/state.js';

/* ============================================================
   Navigation, amorçage
   ============================================================ */
/* Values are internal keys; `label` turns each into display text. Keeping them separate is
   what lets the language change without altering what the app compares against. */
function chips(el, values, currentVal, onPick, counts, label = v => v){
  el.innerHTML = values.map(v=>{
    const n = counts ? counts(v) : null;
    return `<button class="chip" aria-pressed="${v===currentVal}">${esc(label(v))}${n!=null?`<span class="n">${n}</span>`:""}</button>`;
  }).join("");
  [...el.children].forEach((b,i)=> b.onclick = () => onPick(values[i]));
}

function setTab(tab){
  state.tab = tab;
  $("viewLibrary").classList.toggle("hidden", tab !== "library");
  $("viewDiscover").classList.toggle("hidden", tab !== "discover");
  $("viewShop").classList.toggle("hidden", tab !== "shopping");
  $("tabLibrary").setAttribute("aria-selected", String(tab === "library"));
  $("tabDiscover").setAttribute("aria-selected", String(tab === "discover"));
  $("tabShop").setAttribute("aria-selected", String(tab === "shopping"));
  if (tab === "library") renderLibrary();
  if (tab === "shopping") renderShopping();
  if (tab === "discover"){
    renderDiscover();
    if (!store.get("seenDFilters:v1")){
      store.set("seenDFilters:v1", true);
      $("dFilterPanel").classList.remove("hidden");
      $("dFilterBtn").setAttribute("aria-expanded","true");
    }
    if (!DISCOVER && LIB.entries.length) runDiscover();
  }
  window.scrollTo({top:0});
}

function onboardHTML(){
  return `<div class="onboard">
    <h2>${esc(T("onboard.title"))}</h2>
    <p>${T("onboard.body")}</p>
    <div class="row">
      <button class="btn" id="onbAdd">${esc(T("onboard.search"))}</button>
      <button class="btn ghost" id="onbImport">${esc(T("onboard.import"))}</button>
    </div>
  </div>`;
}

/* The old footer claimed "no data is sent anywhere", which was never true: the page pulls
   its fonts from Google, so Google sees every visitor's IP (REVIEW.md §5). Say so until the
   fonts are self-hosted. It also credited AniList for recommendations that now come from
   MangaBaka, whose licence requires the credit anyway. */
function renderFoot(){
  const f = $("foot");
  if (f) f.innerHTML = esc(T("foot.sources")) + "<br>" + esc(T("foot.privacy"));
}

function boot(){
  const lib = LIB.entries;
  $("kicker").textContent = lib.length ? LIB.label : T("lib.defaultLabel");
  $("vert").textContent = lib.length ? "全"+lib.length+"作品" : "空";
  $("tabLibN").textContent = lib.length;
  $("stats").innerHTML = [
    [lib.length, T("stats.series")],
    [lib.reduce((s,d)=>s+d.r,0).toLocaleString(locale()), T("stats.chaptersRead")],
    [lib.filter(d=>d.n>0 && d.r>=d.n).length, T("stats.finished")],
    [lib.filter(d=>d.r>0 && (!d.n || d.r<d.n)).length, T("stats.reading")]
  ].map(([v,l])=>`<div class="stat"><b>${v}</b><small>${l}</small></div>`).join("");

  const empty = !lib.length;
  $("onboard").innerHTML = empty ? onboardHTML() : "";
  $("libTools").classList.toggle("hidden", empty);
  if (empty){
    $("onbAdd").onclick = () => openAddModal("");
    $("onbImport").onclick = () => $("file").click();
    $("results").innerHTML = "";
    return;
  }

  /* "all" is the internal value; the source names themselves come from the user's data and
     are not translatable. */
  const SOURCES = ["all", ...Array.from(new Set(lib.map(d=>d.s))).sort()];
  const draw = () => {
    chips($("typeLibRow"), LIBTYPES, state.libType, v=>{ state.libType=v; draw(); renderLibrary(); },
      v=> v==="all" ? lib.length : lib.filter(d=> v==="webtoon" ? d.m==="Webtoon" : typeOf(d)===MEDIA_TYPE[v]).length,
      v=>T("libtype."+v));
    chips($("shelfRow"), SHELVES, state.shelf, v=>{ state.shelf=v; draw(); renderLibrary(); },
        v=>lib.filter(d=>shelfTest(d,v)).length, v=>T("shelf."+v));
    chips($("srcRow"), SOURCES, state.source, v=>{ state.source=v; draw(); renderLibrary(); },
        v=> v==="all" ? lib.length : lib.filter(d=>d.s===v).length,
        v=> v==="all" ? T("source.all") : v);
    chips($("sortRow"), SORTS, state.sort, v=>{ state.sort=v; draw(); renderLibrary(); },
        null, v=>T("sort."+v));
  };
  draw();
  renderLibrary();
  renderFoot();
  if (DISCOVER) $("tabDiscN").textContent = visibleDiscover().length || "—";
  const shop = shoppingRows();
  $("tabShopN").textContent = shop.cont.reduce((s, r) => s + r.missing.length, 0) || "—";
}

const SEEDCHOICES = [12, 25, 50, "all"];
function drawDiscoverChips(){
  chips($("seedRow"), SEEDCHOICES, state.seeds,
        v => { state.seeds = v; store.set("seeds:v1", v); drawDiscoverChips(); },
        null, v => typeof v === "number" ? T("seeds.count",{n:v}) : T("seeds.all"));
  chips($("typeRow"), TYPES, state.type, v=>{ state.type=v; drawDiscoverChips(); renderDiscover(); },
        null, v=>T(v==="all"?"type.all":"libtype."+v));
  chips($("dsortRow"), DSORTS, state.dsort, v=>{ state.dsort=v; drawDiscoverChips(); renderDiscover(); },
        null, v=>T("dsort."+v));
}
drawDiscoverChips();

function togglePanel(btn, panel){
  const open = panel.classList.toggle("hidden") === false;
  btn.setAttribute("aria-expanded", String(open));
  return open;
}
$("filterBtn").onclick = () => { togglePanel($("filterBtn"), $("filterPanel")); store.set("panel:v1", !$("filterPanel").classList.contains("hidden")); };
$("moreBtn2").onclick = () => togglePanel($("moreBtn2"), $("moreBar"));
$("dFilterBtn").onclick = () => togglePanel($("dFilterBtn"), $("dFilterPanel"));

$("q").addEventListener("input", e=>{ state.q = e.target.value; renderLibrary(); });
$("viewBtn").onclick = e => {
  state.view = state.view === "grid" ? "list" : "grid";
  e.target.textContent = T(state.view === "grid" ? "btn.listView" : "btn.postersView");
  renderLibrary();
};
$("unitBtn").onclick = e => {
  state.unit = state.unit === "ch" ? "vol" : "ch";
  e.target.textContent = T(state.unit === "ch" ? "unit.chapters" : "unit.volumes");
  store.set("unit:v1", state.unit);
  renderLibrary();
  toast(T(state.unit === "ch" ? "toast.byChapters" : "toast.byVolumes"));
};
$("importBtn").onclick = () => $("file").click();
$("exportBtn").onclick = exportLib;
$("resetBtn").onclick = async () => {
  const n = LIB.entries.length;
  /* The JSON export is the only backup there is, so offer it before destroying anything
     rather than mentioning it afterwards. */
  if (n && confirm(T("reset.exportFirst", { n })))
    exportLib();
  if (!confirm(
    `Effacer DÉFINITIVEMENT toutes les données de Rayon ?\n\n`
    + `• ${n} série(s) et leur progression\n`
    + `• Fiches, totaux et recommandations en cache\n`
    + `• Tes préférences\n\n`
    + `Cette action est irréversible.`)) return;
  const btn = $("resetBtn");
  btn.disabled = true; btn.textContent = "Effacement…";
  const done = await resetEverything();
  if (!done){
    /* The delete was blocked by another tab. Reloading now would queue an open() behind a
       delete that may never run, and wedge the database — resetEverything explains why. */
    btn.disabled = false; btn.textContent = T("btn.reset");
    return;
  }
  toast(T("toast.erased"));
  /* Reload rather than reset the globals by hand: it is the only way to be sure nothing
     stale survives in memory. */
  setTimeout(() => location.reload(), 700);
};
$("mdBatch").onclick = async () => {
  const btn = $("mdBatch");
  const todo = libRows().filter(d => d.r > 0 && !(MDCACHE[norm(d.t)] && MDCACHE[norm(d.t)].at)).slice(0, 40);
  if (!todo.length){ toast("Rien de neuf à vérifier dans ce rayon"); return; }
  btn.disabled = true;
  let ok = 0, ko = 0;
  for (let i=0;i<todo.length;i++){
    $("statusline").textContent = `MangaDex ${i+1}/${todo.length} · ${todo[i].t}`;
    try{ const info = await mdAggregate(todo[i]); if (info.maxCh) ok++; else ko++; }
    catch(e){
      ko++;
      if (/CORS|injoignable/.test(e.message)){ $("statusline").textContent = e.message; break; }
    }
    renderLibrary();
    await sleep(320);
  }
  $("statusline").textContent = `${ok} série(s) mises à jour · ${ko} sans correspondance`;
  btn.disabled = false;
};
$("file").addEventListener("change", e=>{ if (e.target.files && e.target.files[0]) importFile(e.target.files[0], afterImport); e.target.value = ""; });
$("tabLibrary").onclick = () => setTab("library");
$("tabDiscover").onclick = () => setTab("discover");
$("tabShop").onclick = () => setTab("shopping");
$("shopPrice").onclick = () => { if (askPrice()) renderShopping(); };
$("tabAdd").onclick = () => openAddModal("");
$("runDiscover").onclick = runDiscover;
$("resetDismissed").onclick = () => { DISMISSED.clear(); saveDismissed(); renderDiscover(); toast("Titres écartés réaffichés"); };

/* glisser-déposer */
const dz = $("dropzone");
let dragDepth = 0;
window.addEventListener("dragenter", e=>{ e.preventDefault(); dragDepth++; dz.classList.remove("hidden"); });
window.addEventListener("dragover", e=> e.preventDefault());
window.addEventListener("dragleave", ()=>{ if (--dragDepth <= 0){ dragDepth = 0; dz.classList.add("hidden"); } });
window.addEventListener("drop", e=>{
  e.preventDefault(); dragDepth = 0; dz.classList.add("hidden");
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) importFile(f, afterImport);
});

if (store.get("panel:v1")){ $("filterPanel").classList.remove("hidden"); $("filterBtn").setAttribute("aria-expanded","true"); }
/* seeds is the one filter value that IS persisted, so an install from before the
   internal-value split still holds "Tout". Migrate it on read rather than stranding it. */
const savedSeeds = store.get("seeds:v1");
state.seeds = savedSeeds === "Tout" ? "all" : (savedSeeds || 25);
drawDiscoverChips();
state.unit = store.get("unit:v1") || "ch";
$("unitBtn").textContent = T(state.unit === "ch" ? "unit.chapters" : "unit.volumes");

/* What has to happen after a library is replaced or merged. Passed into importFile so the
   import layer does not have to reach back up into the UI. */
/* One place says what "the library changed" means; ui/refresh.js lets any module ask for it
   without importing this file. */
onLibraryChanged(() => {
  boot();
  if (state.tab === "shopping") renderShopping();
});

function afterImport(){ boot(); hydrate(renderLibrary); }

(async function start(){
  /* The app must render even if IndexedDB never answers. It can hang rather than fail —
     an older tab blocking the version upgrade is the common case — and the library itself
     lives in localStorage, so a cold cache is a slow start, not a broken app.
     Never let storage keep the user staring at an empty screen. */
  const CACHE_INIT_TIMEOUT = 5000;
  try{
    await Promise.race([
      (async () => { await migrateCaches(); await loadCaches(); })(),
      new Promise((_, rej) => setTimeout(() => rej(new Error("cache init timed out")), CACHE_INIT_TIMEOUT))
    ]);
  }catch(e){
    console.error("[rayon] cache init failed, starting with cold caches", e);
  }
  applyStatic();
  boot();
  hydrate();
})();

/* Language selector. Changing it re-renders rather than reloading, so nothing in progress
   is lost — the static shell is retranslated and the dynamic views redrawn. */
$("langBtn").onclick = () => {
  const next = AVAILABLE[(AVAILABLE.indexOf(locale()) + 1) % AVAILABLE.length];
  setLocale(next);
  applyStatic();
  $("langBtn").textContent = T("lang." + next);
  $("unitBtn").textContent = T(state.unit === "ch" ? "unit.chapters" : "unit.volumes");
  boot();
};
$("langBtn").textContent = T("lang." + locale());

/* service worker: http(s) only */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")){
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    /* notify when a new version is ready (see REVIEW.md §1.3) */
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller)
          toast(T("toast.newVersion"));
      });
    });
  }).catch(()=>{});
}

/* Deliberate debug handle.
   Module scope means none of this is reachable from the devtools console any more, and every
   behavioural check on this app — the cache migration, the merge rules, the reset — was done
   by calling these directly. Getters rather than values, because loadCaches() reassigns the
   globals and a captured reference would go stale. */
window.__rayon = {
  norm, mergeLibraries, resetEverything, purgeSeriesData,
  store, kvGet, kvSet, kvDel, db,
  importFile, saveLib, boot, hydrate, openSheet,
  addFromMedia, openAddModal, runDiscover, renderDiscover, totals, unitOf,
  get LIB()      { return LIB; },   set LIB(v) { setLib(v); },
  get META()     { return META; },
  get MDCACHE()  { return MDCACHE; },
  get DISCOVER() { return DISCOVER; },
  get state()    { return state; },
};
