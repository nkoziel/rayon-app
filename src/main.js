"use strict";

import { $, esc, stripTags, sleep, uid, toast } from './core/dom.js';
import { norm } from './core/norm.js';
import { t as T, setLocale, locale, AVAILABLE, applyStatic } from './core/i18n.js';
import { gql, shapeMedia, searchBatch, hydrate, loadRecos, RECO_Q, SEARCH_PAGE_Q } from './data/anilist.js';
import { mdResolve, mdAggregate } from './data/mangadex.js';
import { totals, unitOf, SRCLABEL, SRCNOTE } from './data/totals.js';
import { importFile, exportLib, mergeLibraries, purgeSeriesData, resetEverything } from './import/library.js';
import { mihonAvailable, openInMihon } from './ui/mihon.js';
import { addFromMedia, openAddModal } from './ui/add.js';
import { runDiscover, renderDiscover, visibleDiscover } from './ui/discover.js';
import { onLibraryChanged } from './ui/refresh.js';
import { renderLibrary, libRows, shelfTest, typeOf, updateFilterSummary, SHELVES, SORTS, TYPES, LIBTYPES, DSORTS } from './ui/library.js';
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
function chips(el, values, currentVal, onPick, counts){
  el.innerHTML = values.map(v=>{
    const n = counts ? counts(v) : null;
    return `<button class="chip" aria-pressed="${v===currentVal}">${esc(v)}${n!=null?`<span class="n">${n}</span>`:""}</button>`;
  }).join("");
  [...el.children].forEach((b,i)=> b.onclick = () => onPick(values[i]));
}

function setTab(tab){
  state.tab = tab;
  $("viewLibrary").classList.toggle("hidden", tab !== "library");
  $("viewDiscover").classList.toggle("hidden", tab !== "discover");
  $("tabLibrary").setAttribute("aria-selected", String(tab === "library"));
  $("tabDiscover").setAttribute("aria-selected", String(tab === "discover"));
  if (tab === "library") renderLibrary();
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
    <h2>Commence ta bibliothèque</h2>
    <p>Ajoute les séries que tu lis, puis l'onglet <b>Découvrir</b> croise les recommandations votées par les lecteurs d'AniList pour te sortir ce qui revient le plus souvent. Utilisateur de Mihon ou Tachiyomi ? Importe ta sauvegarde <b>.tachibk</b>, elle est décodée ici même, sans rien envoyer sur un serveur.</p>
    <div class="row">
      <button class="btn" id="onbAdd">Chercher un titre</button>
      <button class="btn ghost" id="onbImport">Importer une sauvegarde</button>
    </div>
  </div>`;
}

function boot(){
  const lib = LIB.entries;
  $("kicker").textContent = lib.length ? LIB.label : T("lib.defaultLabel");
  $("vert").textContent = lib.length ? "全"+lib.length+"作品" : "空";
  $("tabLibN").textContent = lib.length;
  $("stats").innerHTML = [
    [lib.length, "Séries"],
    [lib.reduce((s,d)=>s+d.r,0).toLocaleString("fr-FR"), "Chapitres lus"],
    [lib.filter(d=>d.n>0 && d.r>=d.n).length, "Terminées"],
    [lib.filter(d=>d.r>0 && (!d.n || d.r<d.n)).length, "En cours"]
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

  const SOURCES = ["Toutes", ...Array.from(new Set(lib.map(d=>d.s))).sort()];
  const draw = () => {
    chips($("typeLibRow"), LIBTYPES, state.libType, v=>{ state.libType=v; draw(); renderLibrary(); },
      v=> v==="Tous types" ? lib.length : lib.filter(d=> v==="Webtoon" ? d.m==="Webtoon" : typeOf(d)===v).length);
    chips($("shelfRow"), SHELVES, state.shelf, v=>{ state.shelf=v; draw(); renderLibrary(); }, v=>lib.filter(d=>shelfTest(d,v)).length);
    chips($("srcRow"), SOURCES, state.source, v=>{ state.source=v; draw(); renderLibrary(); }, v=> v==="Toutes"?lib.length:lib.filter(d=>d.s===v).length);
    chips($("sortRow"), SORTS, state.sort, v=>{ state.sort=v; draw(); renderLibrary(); });
  };
  draw();
  renderLibrary();
  if (DISCOVER) $("tabDiscN").textContent = visibleDiscover().length || "—";
}

const SEEDCHOICES = [12, 25, 50, "Tout"];
function drawDiscoverChips(){
  chips($("seedRow"), SEEDCHOICES.map(v=>typeof v === "number" ? v+" séries" : "Toutes mes séries"),
    typeof state.seeds === "number" ? state.seeds+" séries" : "Toutes mes séries",
    (v, i) => { state.seeds = SEEDCHOICES[SEEDCHOICES.map(x=>typeof x==="number"?x+" séries":"Toutes mes séries").indexOf(v)]; store.set("seeds:v1", state.seeds); drawDiscoverChips(); });
  chips($("typeRow"), TYPES, state.type, v=>{ state.type=v; drawDiscoverChips(); renderDiscover(); });
  chips($("dsortRow"), DSORTS, state.dsort, v=>{ state.dsort=v; drawDiscoverChips(); renderDiscover(); });
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
  e.target.textContent = state.view === "grid" ? "Vue liste" : "Vue posters";
  renderLibrary();
};
$("unitBtn").onclick = e => {
  state.unit = state.unit === "ch" ? "vol" : "ch";
  e.target.textContent = state.unit === "ch" ? "Suivi : chapitres" : "Suivi : tomes";
  store.set("unit:v1", state.unit);
  renderLibrary();
  toast(state.unit === "ch" ? "Affichage par chapitres" : "Affichage par tomes — chaque série peut être réglée à part dans sa fiche");
};
$("importBtn").onclick = () => $("file").click();
$("exportBtn").onclick = exportLib;
$("resetBtn").onclick = async () => {
  const n = LIB.entries.length;
  /* The JSON export is the only backup there is, so offer it before destroying anything
     rather than mentioning it afterwards. */
  if (n && confirm(`Exporter ta bibliothèque avant de l'effacer ?\n\n${n} série(s). L'export est la seule sauvegarde possible.`))
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
state.seeds = store.get("seeds:v1") || 25;
drawDiscoverChips();
state.unit = store.get("unit:v1") || "ch";
$("unitBtn").textContent = T(state.unit === "ch" ? "unit.chapters" : "unit.volumes");

/* What has to happen after a library is replaced or merged. Passed into importFile so the
   import layer does not have to reach back up into the UI. */
/* One place says what "the library changed" means; ui/refresh.js lets any module ask for it
   without importing this file. */
onLibraryChanged(() => { boot(); });

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
