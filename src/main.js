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
import { closeModal } from './core/dom.js';
import { store, db, forgetDb, kvGet, kvSet, kvDel, DB_NAME } from './core/store.js';
import {
  LIB, setLib, saveLib, META, MDCACHE, DISCOVER, setDiscover, markMetaDirty, saveMeta,
  OWNED, refreshOwned, isOwned, DISMISSED, saveDismissed, state,
  migrateCaches, loadCaches, CACHE_KEYS, DEAD_KEYS
} from './core/state.js';

/* ============================================================
   Bibliothèque : filtres et rendu
   ============================================================ */
const SHELVES = ["Tout","En cours","À rattraper","Terminées","Jamais ouvertes","Ajoutées à la main"];
const SORTS = ["Lecture récente","Titre","Chapitres lus","Progression","Note AniList"];
const TYPES = ["Tous","Manga","Manhwa","Manhua"];
const LIBTYPES = ["Tous types","Manga","Manhwa","Manhua","Webtoon"];
const DSORTS = ["Pertinence","Note","Popularité"];

function shelfTest(d, shelf){
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

function typeOf(d){
  const m = META[norm(d.t)];
  if (m && !m.missing && m.type) return m.type;
  return d.m === "Webtoon" ? "Manhwa" : "Manga";
}
function libTypeTest(d){
  if (state.libType === "Tous types") return true;
  if (state.libType === "Webtoon") return d.m === "Webtoon";
  return typeOf(d) === state.libType;
}

function libRows(){
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

function progressOf(d){
  const t = totals(d);
  const unit = unitOf(d);
  if (unit === "vol"){
    const read = d.rv || 0, tot = t.vol || 0;
    return {read, tot, pct: tot ? Math.min(100, Math.round(read/tot*100)) : 0,
            label: read + (tot ? "/"+tot : "") + " tomes", remain: tot ? tot-read : null, unit:"tomes", t};
  }
  const read = d.r || 0, tot = t.ch || 0;
  return {read, tot, pct: tot ? Math.min(100, Math.round(read/tot*100)) : 0,
          label: read + (tot ? "/"+tot : "") + " ch.", remain: tot ? Math.round((tot-read)*10)/10 : null, unit:"chapitres", t};
}

function posterHTML(d){
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

function listHTML(d){
  const meta = META[norm(d.t)];
  const cover = meta && !meta.missing ? meta.cover : "";
  return `<button class="lrow" data-id="${d.id}">
    ${cover?`<img src="${esc(cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
    <span style="min-width:0"><span class="lt">${esc(d.t)}</span><br>
    <span class="lm">${esc(d.s)} · ${esc(d.st)}${d.d?" · "+esc(d.d):""}</span></span>
    <span class="lp">${esc(progressOf(d).label)}</span>
  </button>`;
}

function renderLibrary(){
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

/* ============================================================
   Fiche d'une série
   ============================================================ */
let current = null;
function closeSheet(){ current = null; $("overlay").innerHTML = ""; document.body.style.overflow = ""; }

function recoRowHTML(r){
  const meta = [r.type, r.annee, r.chapitres?r.chapitres+" ch.":null, r.statut, r.score?r.score+"/100":null].filter(Boolean).join(" · ");
  return `<div class="rec">
    ${r.cover?`<img class="cover" src="${esc(r.cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
    <div style="min-width:0">
      <div class="rtitle"><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.titre)}</a>${isOwned(r)?'<span class="owned">déjà chez toi</span>':''}</div>
      <div class="rmeta">${esc(meta)}</div>
      <div class="rwhy"><b>${r.votes||0} lecteurs</b> font le rapprochement${r.genres.length?" · "+esc(r.genres.slice(0,3).join(", ")):""}</div>
      ${isOwned(r)?"":`<div class="ractions"><button class="btn sm" data-addreco="${r.id}">Ajouter à ma liste</button></div>`}
    </div>
  </div>`;
}



/* ============================================================
   Suivi détaillé : chapitres ou tomes, totaux et provenance
   ============================================================ */
function provenanceHTML(d){
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
  const p = unit === "vol" ? {read:d.rv||0, tot:t.vol} : {read:d.r||0, tot:t.ch};
  if (p.tot && p.read > p.tot) lines.push(`<span class="warn">Tu es allé plus loin que le total connu (${p.read} > ${p.tot}).</span> Les numérotations diffèrent souvent entre scantrad et édition officielle : saisis le total à la main pour trancher.`);
  return `<div class="prov">${lines.join("<br>")}</div>`;
}

function trackerHTML(d){
  const unit = unitOf(d);
  const p = progressOf(d);
  const read = unit === "vol" ? (d.rv||0) : (d.r||0);
  const remainTxt = p.tot
    ? (p.remain > 0 ? `Reste ${p.remain} ${p.unit}` : "À jour")
    : "Total inconnu";
  return `
    <div class="trackline">
      <div class="seg" role="group" aria-label="Unité de suivi">
        <button data-unit="ch" aria-pressed="${unit==="ch"}">Chapitres</button>
        <button data-unit="vol" aria-pressed="${unit==="vol"}">Tomes</button>
      </div>
      <span class="remain ${p.remain===0?"zero":""}">${esc(remainTxt)}</span>
    </div>
    <div class="trackline">
      <span class="rmeta">${unit==="vol"?"Tomes lus":"Chapitre atteint"}</span>
      <button class="btn sm ghost" id="minus">−</button>
      <input type="number" id="readInput" value="${read}" min="0" step="${unit==="vol"?1:0.5}" aria-label="Progression">
      <button class="btn sm ghost" id="plus">+</button>
      <span class="rmeta">${p.tot ? "/ "+p.tot : "/ ?"}</span>
      <button class="btn sm" id="allRead">Tout lu</button>
    </div>
    <div class="trackline">
      <button class="btn sm ghost" id="mdCheck">Vérifier les sorties</button>
      <button class="btn sm ghost" id="setTotal">Saisir le total</button>
      ${unit==="vol" && MDCACHE[norm(d.t)] && MDCACHE[norm(d.t)].vols && MDCACHE[norm(d.t)].vols.length ? `<button class="btn sm ghost" id="convert">Déduire de mes chapitres</button>` : ""}
      <button class="btn sm ghost" id="removeBtn" style="margin-left:auto">Retirer</button>
    </div>
    ${provenanceHTML(d)}`;
}

function refreshTracker(d){
  $("trackwrap").innerHTML = trackerHTML(d);
  wireTracker(d);
  saveLib(); renderLibrary(); boot();
}

function wireTracker(d){
  const unit = unitOf(d);
  const setRead = v => {
    const val = Math.max(0, unit === "vol" ? Math.round(v)||0 : Math.round((+v||0)*2)/2);
    if (unit === "vol") d.rv = val; else d.r = val;
    d.d = new Date().toISOString().slice(0,10);
    refreshTracker(d);
  };
  const step = unit === "vol" ? 1 : 1;
  $("minus").onclick = () => setRead((unit==="vol"?(d.rv||0):(d.r||0)) - step);
  $("plus").onclick = () => setRead((unit==="vol"?(d.rv||0):(d.r||0)) + step);
  $("readInput").onchange = e => setRead(e.target.value);
  $("allRead").onclick = () => { const p = progressOf(d); if (p.tot) setRead(p.tot); };
  [...$("trackwrap").querySelectorAll("[data-unit]")].forEach(b=>{
    b.onclick = () => { d.unit = b.dataset.unit; refreshTracker(d); };
  });
  $("setTotal").onclick = () => {
    const cur = unit === "vol" ? (d.manVol || totals(d).vol || "") : (d.manCh || totals(d).ch || "");
    const v = prompt(unit === "vol" ? "Nombre de tomes parus :" : "Nombre de chapitres parus :", cur);
    if (v === null) return;
    const n = parseFloat(String(v).replace(",", "."));
    if (isNaN(n) || n < 0){ if (unit==="vol") delete d.manVol; else delete d.manCh; }
    else if (unit === "vol") d.manVol = n; else d.manCh = n;
    refreshTracker(d);
  };
  const conv = $("convert");
  if (conv) conv.onclick = () => {
    const vols = (MDCACHE[norm(d.t)]||{}).vols || [];
    const done = vols.filter(v => v.last !== null && v.last <= (d.r||0)).length;
    d.rv = done;
    toast(done + " tome(s) déduits de tes " + (d.r||0) + " chapitres");
    refreshTracker(d);
  };
  $("mdCheck").onclick = async () => {
    const btn = $("mdCheck");
    btn.disabled = true; btn.textContent = "Vérification…";
    try{
      const info = await mdAggregate(d);
      toast(info.maxCh ? `Dernier chapitre traduit : ${info.maxCh}${info.maxVol?` · ${info.maxVol} tomes`:""}` : "Aucun chapitre recensé");
      refreshTracker(d);
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
    saveLib(); closeSheet(); boot();
    toast(T("toast.seriesRemoved"));
    /* after the UI has closed: the user should not wait on a cleanup they cannot see */
    await purgeSeriesData(d);
  };
}

function openSheet(d){
  if (!d) return;
  current = d;
  const raw = META[norm(d.t)];
  const meta = raw && !raw.missing ? raw : null;
  const pct = d.n ? Math.min(100, Math.round(d.r/d.n*100)) : 0;
  const behind = meta && meta.chapitres ? meta.chapitres - d.r : null;
  const hmeta = [meta&&meta.type, meta&&meta.annee, meta&&meta.statut, meta&&meta.score?meta.score+"/100":null].filter(Boolean).join(" · ");
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
          ${meta?`<dt>Fiche</dt><dd><a href="${esc(meta.url)}" target="_blank" rel="noreferrer">${esc(meta.titre)} sur AniList</a></dd>`:""}
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
  wireTracker(d);   // also wires removeBtn — see REVIEW.md §1.4
  const mb = $("mihonBtn");
  if (mb) mb.onclick = () => openInMihon(d.t);
  fillRecos(d, false);
}

async function fillRecos(d, force){
  const box = $("recos");
  box.innerHTML = `<p class="loading">Interrogation d'AniList</p>`;
  try{
    const payload = await loadRecos(d, force);
    if (current !== d) return;
    if (!payload.items.length){
      box.innerHTML = `<p class="note">Aucun rapprochement voté sur cette fiche. <a href="${esc(payload.source)}" target="_blank" rel="noreferrer">Voir ${esc(payload.matched)} sur AniList</a></p>`;
      return;
    }
    const visible = payload.items.filter(r => !state.hideOwned || !isOwned(r));
    box.innerHTML = visible.length
      ? visible.map(recoRowHTML).join("")
      : `<p class="note">Les ${payload.items.length} titres recommandés ici sont déjà chez toi.</p>`;
    [...box.querySelectorAll("[data-addreco]")].forEach(b=>{
      b.onclick = () => {
        const r = payload.items.find(x=>String(x.id)===b.dataset.addreco);
        if (r && addFromMedia(r)){ b.textContent = "Ajouté"; b.disabled = true; }
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

function updateFilterSummary(){
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
    boot(); renderLibrary();
  };
}

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
  get LIB()      { return LIB; },   set LIB(v) { setLib(v); },
  get META()     { return META; },
  get MDCACHE()  { return MDCACHE; },
  get DISCOVER() { return DISCOVER; },
  get state()    { return state; },
};
