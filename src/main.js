"use strict";

import { $, esc, stripTags, sleep, uid, toast } from './core/dom.js';
import { norm } from './core/norm.js';
import { store, db, forgetDb, kvGet, kvSet, kvDel, DB_NAME } from './core/store.js';
import {
  LIB, setLib, saveLib, META, MDCACHE, DISCOVER, setDiscover, markMetaDirty, saveMeta,
  OWNED, refreshOwned, isOwned, DISMISSED, saveDismissed, state,
  migrateCaches, loadCaches, CACHE_KEYS, DEAD_KEYS
} from './core/state.js';

/* ============================================================
   API AniList
   ============================================================ */
const API = "https://graphql.anilist.co";
let cooldownUntil = 0;

async function gql(query, variables){
  const wait = cooldownUntil - Date.now();
  if (wait > 0) await sleep(wait);
  let res;
  try{
    res = await fetch(API,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({query,variables})});
  }catch(e){ throw new Error("Impossible de joindre AniList. Vérifie ta connexion."); }
  if (res.status === 429){
    const retry = parseInt(res.headers.get("Retry-After")||"60",10);
    cooldownUntil = Date.now()+retry*1000;
    throw new Error("AniList limite les requêtes ("+retry+" s d'attente).");
  }
  const json = await res.json().catch(()=>null);
  if (!json) throw new Error("Réponse illisible d'AniList.");
  if (json.errors && json.errors.length) throw new Error(json.errors[0].message||"Erreur AniList.");
  return json.data;
}

const FIELDS = `
  id siteUrl format status chapters volumes averageScore popularity genres countryOfOrigin
  startDate{year} title{romaji english} coverImage{large medium} bannerImage description(asHtml:false)
  staff(perPage:2, sort:RELEVANCE){ nodes{ name{full} } }`;
const BY_IDS_Q = `query ($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:MANGA){ ${FIELDS} } } }`;
const SEARCH_PAGE_Q = `query ($s:String){ Page(perPage:8){ media(search:$s, type:MANGA, sort:SEARCH_MATCH){ ${FIELDS} } } }`;
const RECO_Q = `query ($id:Int){ Media(id:$id, type:MANGA){ id siteUrl title{romaji english}
  recommendations(sort:RATING_DESC, perPage:12){ nodes{ rating mediaRecommendation{ ${FIELDS} } } } } }`;

const FORMAT = {MANGA:"Manga", NOVEL:"Light novel", ONE_SHOT:"One-shot"};
const PSTATUS = {FINISHED:"Terminé", RELEASING:"En cours", NOT_YET_RELEASED:"À paraître", CANCELLED:"Annulé", HIATUS:"En pause"};
const COUNTRY = {JP:"Manga", KR:"Manhwa", CN:"Manhua", TW:"Manhua"};

function shapeMedia(m){
  if (!m) return null;
  return {
    id:m.id, url:m.siteUrl,
    titre:(m.title.english||m.title.romaji), romaji:m.title.romaji,
    cover:(m.coverImage&&(m.coverImage.large||m.coverImage.medium))||"", banner:m.bannerImage||"",
    type:COUNTRY[m.countryOfOrigin]||FORMAT[m.format]||"Manga",
    format:FORMAT[m.format]||m.format||"", statut:PSTATUS[m.status]||"",
    chapitres:m.chapters||null, volumes:m.volumes||null,
    score:m.averageScore||null, pop:m.popularity||0,
    annee:(m.startDate&&m.startDate.year)||null, genres:m.genres||[],
    auteur:(m.staff&&m.staff.nodes.length)?m.staff.nodes.map(s=>s.name.full).join(", "):"",
    desc:stripTags(m.description).slice(0,900)
  };
}

async function searchBatch(entries){
  const args = entries.map((e,i)=>`$s${i}:String`).join(", ");
  const parts = entries.map((e,i)=>`m${i}: Media(search:$s${i}, type:MANGA, sort:SEARCH_MATCH){ ${FIELDS} }`);
  const vars = {}; entries.forEach((e,i)=>{ vars["s"+i]=e.t; });
  const data = await gql(`query (${args}){ ${parts.join("\n")} }`, vars);
  entries.forEach((e,i)=>{
    const m = shapeMedia(data["m"+i]);
    META[norm(e.t)] = m || {missing:true};
    if (m && !e.al) e.al = m.id;
    markMetaDirty();
  });
  saveLib();
}

let hydrating = false;
async function hydrate(){
  if (hydrating || !LIB.entries.length) return;
  hydrating = true;
  try{
    const todo = LIB.entries.filter(d => !META[norm(d.t)]);
    const withId = todo.filter(d=>d.al), without = todo.filter(d=>!d.al);
    const total = todo.length; let done = 0;
    for (let i=0;i<withId.length;i+=50){
      const chunk = withId.slice(i,i+50);
      $("statusline").textContent = `Fiches AniList · ${done}/${total}`;
      try{
        const data = await gql(BY_IDS_Q,{ids:chunk.map(d=>d.al)});
        const byId = {}; (data.Page.media||[]).forEach(m=>{ byId[m.id]=shapeMedia(m); });
        chunk.forEach(d=>{ META[norm(d.t)] = byId[d.al] || {missing:true}; });
        markMetaDirty();
      }catch(e){ $("statusline").textContent = e.message; await sleep(2500); }
      done += chunk.length; renderLibrary(); await sleep(700);
    }
    for (let i=0;i<without.length;i+=6){
      const chunk = without.slice(i,i+6);
      $("statusline").textContent = `Recherche des fiches · ${done}/${total}`;
      try{ await searchBatch(chunk); }catch(e){ $("statusline").textContent = e.message; await sleep(3000); }
      done += chunk.length; renderLibrary(); await sleep(900);
    }
    saveMeta();
    const found = LIB.entries.filter(d=>{ const m=META[norm(d.t)]; return m && !m.missing; }).length;
    $("statusline").textContent = `${found} fiches AniList sur ${LIB.entries.length} · en cache`;
  } finally { hydrating = false; }
}

async function loadRecos(entry, force){
  const key = "reco:v3:"+norm(entry.t);
  if (!force){ const hit = await kvGet(key); if (hit) return hit; }
  const meta = META[norm(entry.t)];
  let id = entry.al || (meta && meta.id);
  if (!id){
    await searchBatch([entry]);
    const m = META[norm(entry.t)];
    if (!m || m.missing) throw new Error("Aucune fiche AniList ne correspond à ce titre.");
    id = m.id;
  }
  const data = await gql(RECO_Q,{id});
  const media = data && data.Media;
  if (!media) throw new Error("Fiche AniList introuvable.");
  const payload = {
    source: media.siteUrl, matched: media.title.english||media.title.romaji,
    items: (media.recommendations.nodes||[]).map(n=>{
      const m = shapeMedia(n.mediaRecommendation);
      if (!m) return null;
      delete m.banner; m.desc = m.desc.slice(0,200); m.votes = n.rating; return m;
    }).filter(Boolean)
  };
  kvSet(key, payload);
  return payload;
}

/* ============================================================
   MangaDex : structure en tomes et dernier chapitre publié
   ============================================================ */
const MD = "https://api.mangadex.org";

async function mdGet(path){
  let res;
  try{ res = await fetch(MD+path, {headers:{Accept:"application/json"}}); }
  catch(e){ throw new Error("MangaDex injoignable depuis ce navigateur (blocage CORS ou réseau)."); }
  if (res.status === 429) throw new Error("MangaDex limite les requêtes, réessaie dans une minute.");
  if (!res.ok) throw new Error("MangaDex a répondu "+res.status+".");
  return res.json();
}

/* retrouve l'identifiant MangaDex : par lien AniList si possible, sinon par titre */
async function mdResolve(entry){
  const key = norm(entry.t);
  if (MDCACHE[key] && MDCACHE[key].id !== undefined) return MDCACHE[key].id;
  const q = encodeURIComponent(entry.t.slice(0,60));
  const data = await mdGet(`/manga?title=${q}&limit=5&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica`);
  const hits = data.data || [];
  let best = null;
  if (entry.al) best = hits.find(h => h.attributes.links && String(h.attributes.links.al) === String(entry.al));
  if (!best) best = hits.find(h => {
    const titles = [h.attributes.title, ...(h.attributes.altTitles||[])].flatMap(t => Object.values(t||{}));
    return titles.some(t => norm(t) === key);
  });
  const id = best ? best.id : null;
  MDCACHE[key] = Object.assign(MDCACHE[key]||{}, {id, matched: best ? Object.values(best.attributes.title)[0] : null});
  kvSet("md:v1", MDCACHE);
  return id;
}

/* structure tomes / chapitres */
async function mdAggregate(entry){
  const key = norm(entry.t);
  const id = await mdResolve(entry);
  if (!id) throw new Error("Cette série n'est pas référencée sur MangaDex.");
  const data = await mdGet(`/manga/${id}/aggregate?translatedLanguage[]=en`);
  const volumes = data.volumes || {};
  const vols = [];
  let maxCh = 0;
  Object.keys(volumes).forEach(vk => {
    const chapters = Object.keys(volumes[vk].chapters || {})
      .map(c => parseFloat(c)).filter(n => !isNaN(n)).sort((a,b)=>a-b);
    chapters.forEach(c => { if (c > maxCh) maxCh = c; });
    const vnum = parseFloat(vk);
    if (!isNaN(vnum)) vols.push({v:vnum, last: chapters.length ? chapters[chapters.length-1] : null, count: chapters.length});
  });
  vols.sort((a,b)=>a.v-b.v);
  const info = {
    id, vols,
    maxCh: maxCh || null,
    maxVol: vols.length ? vols[vols.length-1].v : null,
    at: new Date().toISOString().slice(0,10),
    matched: (MDCACHE[key]||{}).matched || entry.t
  };
  MDCACHE[key] = Object.assign(MDCACHE[key]||{}, info);
  kvSet("md:v1", MDCACHE);
  return info;
}

/* ---- totaux effectifs, avec provenance ----
   priorité : saisie manuelle > MangaDex > AniList (séries terminées) > chapitres de la source Mihon */
function totals(d){
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

const SRCLABEL = {
  mangadex:"MangaDex", anilist:"AniList", mihon:"chapitres de ta source", import:"fichier importé", manuel:"saisi à la main"
};
const SRCNOTE = {
  mangadex:"structure des tomes et dernier chapitre traduit recensés par MangaDex",
  anilist:"AniList ne renseigne les totaux que pour les séries achevées",
  mihon:"nombre de chapitres présents chez ta source de lecture",
  import:"valeur venue du fichier importé",
  manuel:"ta saisie"
};

/* unité effective d'une série */
function unitOf(d){ return d.unit || state.unit; }

/* ============================================================
   Lecture d'une sauvegarde Mihon (.tachibk : gzip + protobuf)
   ============================================================ */
function pbParse(buf, start, end){
  const out = []; let i = start;
  while (i < end){
    let key=0n, shift=0n;
    while(true){ const b=buf[i++]; key |= BigInt(b&0x7f)<<shift; if(!(b&0x80)) break; shift+=7n; }
    const field=Number(key>>3n), wt=Number(key&7n);
    if (wt===0){ let v=0n,s=0n; while(true){ const b=buf[i++]; v|=BigInt(b&0x7f)<<s; if(!(b&0x80)) break; s+=7n; } out.push({f:field,wt,v}); }
    else if (wt===1){ out.push({f:field,wt,v:buf.slice(i,i+8)}); i+=8; }
    else if (wt===2){ let n=0n,s=0n; while(true){ const b=buf[i++]; n|=BigInt(b&0x7f)<<s; if(!(b&0x80)) break; s+=7n; }
      const len=Number(n); out.push({f:field,wt,v:buf.subarray(i,i+len)}); i+=len; }
    else if (wt===5){ const dv=new DataView(buf.buffer, buf.byteOffset+i, 4); out.push({f:field,wt,v:dv.getFloat32(0,true)}); i+=4; }
    else throw new Error("Format inattendu (wire type "+wt+").");
  }
  return out;
}
const dec = new TextDecoder("utf-8");
const group = fields => { const g={}; fields.forEach(x=>{ (g[x.f]=g[x.f]||[]).push(x); }); return g; };
const MSTATUS = {0:"Inconnu",1:"En cours",2:"Terminé",3:"Sous licence",4:"Publication terminée",5:"Annulé",6:"En pause"};
const MMODE = {0:"",1:"Gauche→Droite",2:"Droite→Gauche",3:"Vertical",4:"Webtoon",5:"Vertical continu"};
const isoDay = ms => ms ? new Date(Number(ms)).toISOString().slice(0,10) : "";

function parseBackup(bytes){
  const top = pbParse(bytes,0,bytes.length);
  const sources = {};
  top.filter(x=>x.f===101).forEach(x=>{
    const g = group(pbParse(x.v,0,x.v.length));
    if (g[2]) sources[String(g[2][0].v)] = (g[1] && dec.decode(g[1][0].v)) || "Source inconnue";
  });
  const entries = [];
  top.filter(x=>x.f===1).forEach(x=>{
    const g = group(pbParse(x.v,0,x.v.length));
    const str = f => g[f] ? dec.decode(g[f][0].v) : "";
    const chapters = (g[16]||[]).map(c=>group(pbParse(c.v,0,c.v.length)));
    const read = chapters.filter(c=>c[4] && Number(c[4][0].v)===1).length;
    const hist = (g[104]||[]).map(h=>group(pbParse(h.v,0,h.v.length))).map(h=>h[2]?Number(h[2][0].v):0).filter(Boolean);
    let al = 0;
    (g[18]||[]).forEach(t=>{
      const tg = group(pbParse(t.v,0,t.v.length));
      const m = (tg[4] ? dec.decode(tg[4][0].v) : "").match(/anilist\.co\/manga\/(\d+)/);
      if (m) al = parseInt(m[1],10);
    });
    entries.push({
      id: uid(), t: str(3), a: str(5)||str(4),
      s: sources[String(g[1]?g[1][0].v:"")] || "Source inconnue",
      st: MSTATUS[g[8]?Number(g[8][0].v):0] || "Inconnu",
      g: (g[7]||[]).map(y=>dec.decode(y.v)).slice(0,6),
      r: read, n: chapters.length,
      d: hist.length ? isoDay(Math.max.apply(null,hist)) : "",
      ad: g[13] ? isoDay(Number(g[13][0].v)) : "",
      m: MMODE[g[14]?Number(g[14][0].v):0] || "",
      al, f: (!g[100] || Number(g[100][0].v)!==0) ? 1 : 0,
      rv: 0, origin: "mihon"
    });
  });
  return entries;
}

/* Merge an incoming library into the current one (REVIEW.md §1.5).
   Match on the AniList id when both sides have one, else on the normalised title.
   The governing rule is that progress NEVER moves backwards: importing a friend's list, or an
   older backup, must not undo what you have read. Everything else is filled in only where the
   current entry has nothing. */
function mergeLibraries(current, incoming){
  const out = current.map(e => Object.assign({}, e));
  /* Index by BOTH id and title. A single composite key would duplicate a series whenever one
     side carries an AniList id and the other does not — the common case, since a Mihon backup
     only has one when AniList tracking was configured. */
  const byAl = new Map(), byTitle = new Map();
  out.forEach(e => {
    if (e.al) byAl.set(String(e.al), e);
    byTitle.set(norm(e.t), e);
  });

  let added = 0, updated = 0;
  incoming.forEach(inc => {
    let cur = inc.al ? byAl.get(String(inc.al)) || null : null;
    if (!cur){
      const t = byTitle.get(norm(inc.t));
      /* two different AniList ids sharing a title are two different series — do not merge */
      if (t && !(t.al && inc.al && String(t.al) !== String(inc.al))) cur = t;
    }
    if (!cur){
      const copy = Object.assign({}, inc);
      out.push(copy);
      if (copy.al) byAl.set(String(copy.al), copy);
      byTitle.set(norm(copy.t), copy);
      added++;
      return;
    }
    let changed = false;
    if ((inc.r||0)  > (cur.r||0)) { cur.r  = inc.r;  changed = true; }
    if ((inc.rv||0) > (cur.rv||0)){ cur.rv = inc.rv; changed = true; }
    if ((inc.n||0)  > (cur.n||0))   cur.n  = inc.n;
    if (!cur.al && inc.al){ cur.al = inc.al; byAl.set(String(inc.al), cur); changed = true; }
    /* a manual total is an explicit user decision — adopt it only if we have none */
    if (cur.manCh  == null && inc.manCh  != null) cur.manCh  = inc.manCh;
    if (cur.manVol == null && inc.manVol != null) cur.manVol = inc.manVol;
    if (inc.d && (!cur.d || inc.d > cur.d)) cur.d = inc.d;
    if (changed) updated++;
  });
  return { entries: out, added, updated };
}

/* Ask before destroying a library. Three outcomes, so this cannot be a confirm(). */
function askImportMode(incoming){
  const cur = LIB.entries.length;
  const p = mergeLibraries(LIB.entries, incoming);
  return new Promise(resolve => {
    $("modalHost").innerHTML = `
      <div class="modal" id="impScrim">
        <div class="modalbox" role="dialog" aria-modal="true" aria-label="Importer une bibliothèque">
          <div class="modalhead">
            <h3>Importer ${incoming.length} série${incoming.length>1?"s":""}</h3>
            <p class="rmeta" style="margin:0">Ta bibliothèque en contient déjà ${cur}.</p>
          </div>
          <div style="padding:14px 15px;display:grid;gap:14px">
            <div>
              <button class="btn" id="impMerge" style="width:100%">Fusionner</button>
              <p class="rmeta" style="margin:6px 0 0">${p.added} nouvelle${p.added>1?"s":""}, ${p.updated} mise${p.updated>1?"s":""} à jour, ${p.entries.length} au total. Ta progression n'est jamais reculée.</p>
            </div>
            <div>
              <button class="btn ghost danger" id="impReplace" style="width:100%">Remplacer</button>
              <p class="rmeta" style="margin:6px 0 0">Tes ${cur} série${cur>1?"s":""} et leur progression seront définitivement perdues.</p>
            </div>
            <button class="btn ghost" id="impCancel" style="width:100%">Annuler</button>
          </div>
        </div>
      </div>`;
    const done = v => { closeModal(); resolve(v); };
    $("impMerge").onclick   = () => done("merge");
    $("impReplace").onclick = () => done("replace");
    $("impCancel").onclick  = () => done(null);
    $("impScrim").onclick   = e => { if (e.target.id === "impScrim") done(null); };
    document.addEventListener("keydown", function esc(e){
      if (e.key === "Escape"){ document.removeEventListener("keydown", esc); done(null); }
    });
    $("impMerge").focus();
  });
}

async function importFile(file){
  try{
    $("statusline").textContent = "Lecture de "+file.name+"…";
    const raw = new Uint8Array(await file.arrayBuffer());
    let entries, label;
    if (raw[0]===0x1f && raw[1]===0x8b){
      if (!("DecompressionStream" in window)) throw new Error("Ce navigateur ne décompresse pas le gzip (Chrome, Edge, Firefox 113+, Safari 16.4+ requis).");
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
      entries = parseBackup(new Uint8Array(await new Response(stream).arrayBuffer()));
      label = "Sauvegarde Mihon · "+file.name;
    } else {
      const json = JSON.parse(new TextDecoder().decode(raw));
      const list = Array.isArray(json) ? json : json.entries;
      if (!Array.isArray(list)) throw new Error("Fichier JSON non reconnu.");
      entries = list.map(e=>Object.assign({id:uid(),a:"",s:"Import",st:"Inconnu",g:[],r:0,n:0,d:"",ad:"",m:"",al:0,f:1,origin:"import"}, e));
      label = json.label || "Liste importée · "+file.name;
    }
    if (!entries.length) throw new Error("Aucune série trouvée dans ce fichier.");
    entries.sort((a,b)=>(b.f-a.f)||a.t.localeCompare(b.t,"fr"));

    /* An empty library has nothing to lose, so do not nag. Otherwise this is the one gesture
       that can wipe everything — a stray drag-and-drop reaches here directly. */
    let msg;
    if (!LIB.entries.length){
      setLib({ label, entries });
      msg = entries.length + " séries importées";
    } else {
      const mode = await askImportMode(entries);
      if (!mode){ $("statusline").textContent = ""; return; }
      if (mode === "merge"){
        const m = mergeLibraries(LIB.entries, entries);
        m.entries.sort((a,b)=>(b.f-a.f)||a.t.localeCompare(b.t,"fr"));
        setLib({ label: LIB.label, entries: m.entries });
        msg = `${m.added} ajoutée(s), ${m.updated} mise(s) à jour`;
      } else {
        setLib({ label, entries });
        msg = entries.length + " séries importées";
      }
    }

    saveLib();
    setDiscover(null); kvDel("discover:v1");   // the previous run's results describe another library
    boot();
    toast(msg);
    hydrate();
  }catch(e){
    $("statusline").textContent = "";
    alert("Import impossible : "+e.message);
  }
}

function exportLib(){
  const blob = new Blob([JSON.stringify({label:LIB.label, exported:new Date().toISOString(), entries:LIB.entries}, null, 1)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ma-bibliotheque.json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  toast("Export téléchargé — partage ce fichier à qui tu veux");
}

/* ---- Handing a title over to Mihon ----
   Rayon does not read anything itself: Mihon is the reader. Its MainActivity declares
   an exported action for exactly this, verified against the source:

     const val INTENT_SEARCH       = "eu.kanade.tachiyomi.SEARCH"
     const val INTENT_SEARCH_QUERY = "query"

   which pushes GlobalSearchScreen(query) — the cross-source search.

   Targets OFFICIAL Mihon (`app.mihon`) explicitly. Pinning the package makes the hand-off
   deterministic — no app chooser — and if Mihon is not installed the browser_fallback_url
   takes over. Forks are deliberately not targeted. */
const MIHON_PACKAGE = "app.mihon";

const isAndroid = () => /android/i.test(navigator.userAgent);

/* There is no way to ask the browser whether an app is installed — that is deliberate, it
   would be a fingerprinting vector. So this is a capability check, not a presence check:
   show the button where the intent *can* work, and rely on browser_fallback_url when
   nothing handles it. */
const mihonAvailable = () => isAndroid();

function openInMihon(title){
  const fallback = "https://mihon.app/";
  const url = "intent://#Intent;action=eu.kanade.tachiyomi.SEARCH"
    + ";package=" + MIHON_PACKAGE
    + ";S.query=" + encodeURIComponent(title)
    + ";S.browser_fallback_url=" + encodeURIComponent(fallback)
    + ";end";
  window.location.href = url;
}

/* Everything a removed series leaves behind (REVIEW.md §2.5).
   Since the reader was dropped there are no page Blobs to reclaim any more — only cached
   metadata, which is regenerable. Kept as its own function so it stays the one place that
   knows what a series owns. */
async function purgeSeriesData(entry){
  const key = norm(entry.t);
  try{
    if (META[key]){ delete META[key]; markMetaDirty(); saveMeta(); }
    if (MDCACHE[key]){ delete MDCACHE[key]; kvSet("md:v1", MDCACHE); }
    await kvDel("reco:v3:"+key);
  }catch(e){ console.error("[rayon] purge: caches", e); }
}

/* Wipe every trace of Rayon and start over.
   Two storage layers now hold data, so clearing one alone would leave a confusing half-state:
   a fresh-looking library still backed by stale cached records. */
/* catalog/fsprog/pickindex belonged to the removed reader — still listed so a reset also
   clears them from installs that predate its removal. */
const RAYON_LS_KEYS = ["lib:v1","meta:v2","md:v1","catalog:v1","fsprog:v1","pickindex:v1",
  "discover:v1","dismissed:v1","seenDFilters:v1","panel:v1","seeds:v1","unit:v1",
  "readmode:v1","rtl:v1"];

async function resetEverything(){
  /* localStorage is per-ORIGIN, and this origin also serves other projects on
     nkoziel.github.io — so remove our own keys, never localStorage.clear(). */
  try{
    const reco = [];
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (k && k.startsWith("reco:v3:")) reco.push(k);
    }
    [...RAYON_LS_KEYS, ...reco].forEach(k => store.del(k));
  }catch(e){ console.error("[rayon] reset: localStorage", e); }

  /* Close our own connection first: deleteDatabase does not fail while one is open,
     it blocks silently and forever. Cap the wait so the UI can never be stuck here. */
  try{
    const d = await db().catch(() => null);
    if (d) d.close();
    forgetDb();
    await new Promise(res => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => res();
      setTimeout(res, 3000);
    });
  }catch(e){ console.error("[rayon] reset: IndexedDB", e); }
}

/* ============================================================
   Ajout manuel
   ============================================================ */
function addFromMedia(m, opts){
  opts = opts || {};
  if (LIB.entries.some(e => (e.al && e.al===m.id) || norm(e.t)===norm(m.titre))){
    toast("Déjà dans ta liste"); return false;
  }
  LIB.entries.unshift({
    id: uid(), t: m.titre, a: m.auteur, s: opts.source || "Ajout manuel",
    st: m.statut || "Inconnu", g: m.genres.slice(0,6),
    r: opts.read || 0, rv: 0, n: m.chapitres || 0, d: "",
    ad: new Date().toISOString().slice(0,10), m: m.type === "Manhwa" ? "Webtoon" : "",
    al: m.id, f: 1, origin: "manuel"
  });
  META[norm(m.titre)] = m; markMetaDirty();
  saveLib(); saveMeta(); boot();
  toast("« "+m.titre+" » ajouté");
  return true;
}

function openAddModal(prefill){
  $("modalHost").innerHTML = `
    <div class="modal" id="modalScrim">
      <div class="modalbox" role="dialog" aria-label="Ajouter un titre">
        <div class="modalhead">
          <h3>Ajouter un titre</h3>
          <div class="row">
            <input type="search" id="addQ" placeholder="Nom du manga, manhwa, webtoon…" aria-label="Chercher un titre" style="flex:1 1 auto">
            <button class="btn ghost" id="addClose">Fermer</button>
          </div>
          <p class="rmeta" style="margin:8px 0 0">Recherche dans le catalogue AniList — plus de 100 000 séries.</p>
        </div>
        <div id="addResults"><p class="note" style="margin:14px 15px">Tape au moins deux lettres pour lancer la recherche.</p></div>
      </div>
    </div>`;
  const input = $("addQ");
  $("addClose").onclick = closeModal;
  $("modalScrim").onclick = e => { if (e.target.id === "modalScrim") closeModal(); };
  let timer = null, seq = 0;
  const run = async () => {
    const term = input.value.trim();
    if (term.length < 2){ $("addResults").innerHTML = `<p class="note" style="margin:14px 15px">Tape au moins deux lettres.</p>`; return; }
    const mine = ++seq;
    $("addResults").innerHTML = `<p class="loading" style="margin:14px 15px">Recherche</p>`;
    try{
      const data = await gql(SEARCH_PAGE_Q, {s: term});
      if (mine !== seq) return;
      const hits = (data.Page.media||[]).map(shapeMedia).filter(Boolean);
      if (!hits.length){ $("addResults").innerHTML = `<p class="note" style="margin:14px 15px">Rien trouvé pour « ${esc(term)} ».</p>`; return; }
      $("addResults").innerHTML = hits.map((h,i)=>{
        const owned = isOwned(h);
        const meta = [h.type, h.annee, h.chapitres?h.chapitres+" ch.":null, h.statut, h.score?h.score+"/100":null].filter(Boolean).join(" · ");
        return `<div class="hit">
          ${h.cover?`<img src="${esc(h.cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
          <span style="min-width:0">
            <span class="ht">${esc(h.titre)}</span>${owned?'<span class="owned">déjà chez toi</span>':''}<br>
            <span class="hm">${esc(meta)}${h.auteur?" · "+esc(h.auteur):""}</span>
          </span>
          <span class="act"><button class="btn sm ${owned?'ghost':''}" data-add="${i}" ${owned?'disabled':''}>${owned?'Ajouté':'Ajouter'}</button></span>
        </div>`;
      }).join("");
      [...$("addResults").querySelectorAll("[data-add]")].forEach(b=>{
        b.onclick = () => { if (addFromMedia(hits[+b.dataset.add])){ b.textContent = "Ajouté"; b.disabled = true; b.classList.add("ghost"); } };
      });
    }catch(e){
      if (mine !== seq) return;
      $("addResults").innerHTML = `<p class="err" style="margin:14px 15px">${esc(e.message)}</p>`;
    }
  };
  input.addEventListener("input", ()=>{ clearTimeout(timer); timer = setTimeout(run, 420); });
  if (prefill){ input.value = prefill; run(); }
  input.focus();
}
function closeModal(){ $("modalHost").innerHTML = ""; }

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
    ? `<p class="empty">Aucune série ne correspond.</p>`
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
    toast("Série retirée");
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
   Découvrir
   ============================================================ */

async function runDiscover(){
  const btn = $("runDiscover");
  const bar = $("discoverProgress");
  btn.disabled = true; bar.classList.remove("hidden");
  // une série par titre exact d'abord (fonctionne même avant l'hydratation AniList),
  // puis fusion des variantes de titre qui pointent vers la même fiche une fois l'identifiant connu
  const byTitle = new Map();
  LIB.entries.filter(d => d.r > 0 || d.origin === "manuel").forEach(d => {
    const k = norm(d.t);
    const prev = byTitle.get(k);
    if (!prev || (d.r||0) > (prev.r||0)) byTitle.set(k, d);
  });
  const byAl = new Map();
  for (const d of byTitle.values()){
    const k = d.al ? "al:"+d.al : "t:"+norm(d.t);
    const prev = byAl.get(k);
    if (!prev || (d.r||0) > (prev.r||0)) byAl.set(k, d);
  }
  const limit = state.seeds === "Tout" ? 999 : state.seeds;
  const seeds = [...byAl.values()].sort((a,b)=> (b.r||1) - (a.r||1)).slice(0, limit);
  if (!seeds.length){
    $("discoverBox").innerHTML = `<p class="note">Ajoute d'abord quelques titres, puis relance l'analyse.</p>`;
    btn.disabled = false; bar.classList.add("hidden"); return;
  }
  const tally = new Map();
  let failures = 0;
  $("discoverStatus").textContent = `${seeds.length} séries à interroger · environ ${Math.ceil(seeds.length*1.4/60)} min`;
  for (let i=0;i<seeds.length;i++){
    $("discoverStatus").textContent = `${i+1}/${seeds.length} · ${seeds[i].t}`;
    bar.firstElementChild.style.width = Math.round((i)/seeds.length*100)+"%";
    let payload;
    try{ payload = await loadRecos(seeds[i], false); }
    catch(e){ failures++; $("discoverStatus").textContent = e.message; await sleep(1200); continue; }
    payload.items.forEach(r=>{
      if (isOwned(r)) return;
      const prev = tally.get(r.id);
      const weight = Math.max(1, seeds[i].r || 1);
      if (prev){
        prev.votes += r.votes;
        prev.weight += r.votes*Math.log10(weight+10);
        if (!prev.from.some(x => norm(x) === norm(seeds[i].t))) prev.from.push(seeds[i].t);
      }
      else tally.set(r.id, Object.assign({}, r, {from:[seeds[i].t], weight: r.votes*Math.log10(weight+10)}));
    });
    renderDiscover(rankTally(tally), true);
    await sleep(700);
  }
  bar.firstElementChild.style.width = "100%";
  setDiscover({ at: new Date().toISOString(), seeds: seeds.map(s=>s.t), items: rankTally(tally).slice(0,60) });
  kvSet("discover:v1", DISCOVER);
  $("discoverStatus").textContent = failures ? `Terminé · ${failures} série(s) sans fiche AniList` : "Analyse terminée";
  bar.classList.add("hidden");
  btn.disabled = false;
  renderDiscover();
  $("tabDiscN").textContent = visibleDiscover().length || "—";
}

function rankTally(tally){
  const seen = new Map();
  for (const r of tally.values()){
    const k = norm(r.romaji || r.titre);
    const prev = seen.get(k);
    if (prev){
      prev.votes += r.votes; prev.weight += r.weight;
      r.from.forEach(f => { if (!prev.from.some(x=>norm(x)===norm(f))) prev.from.push(f); });
    } else seen.set(k, r);
  }
  return [...seen.values()].sort((a,b)=> b.from.length-a.from.length || b.weight-a.weight);
}

function visibleDiscover(){
  if (!DISCOVER) return [];
  return DISCOVER.items.filter(r=>{
    if (DISMISSED.has(r.id)) return false;
    if (isOwned(r)) return false;
    if (state.type !== "Tous" && r.type !== state.type) return false;
    return true;
  }).sort((a,b)=>{
    if (state.dsort === "Note") return (b.score||0)-(a.score||0);
    if (state.dsort === "Popularité") return (b.pop||0)-(a.pop||0);
    return b.from.length-a.from.length || b.weight-a.weight;
  });
}

function discoverCardHTML(r, i){
  const meta = [r.type, r.annee, r.chapitres?r.chapitres+" ch.":null, r.statut].filter(Boolean).join(" · ");
  return `<article class="reccard">
    ${r.cover?`<img class="cov" src="${esc(r.cover)}" alt="" loading="lazy">`:'<span class="ph"></span>'}
    <div class="body">
      <div class="rank">${String(i+1).padStart(2,"0")}${r.score?` · ${r.score}/100`:""}</div>
      <div class="rtitle"><a href="${esc(r.url)}" target="_blank" rel="noreferrer">${esc(r.titre)}</a></div>
      <div class="rmeta">${esc(meta)}</div>
      <div class="rwhy">Parce que tu lis <b>${esc(r.from.slice(0,3).join(", "))}</b>${r.from.length>3?` +${r.from.length-3}`:""} · ${r.votes} votes</div>
      <div class="ractions">
        <button class="btn sm" data-add="${r.id}">Ajouter</button>
        <button class="btn sm ghost" data-skip="${r.id}">Pas pour moi</button>
      </div>
    </div>
  </article>`;
}

function renderDiscover(partial, isPartial){
  if (state.tab !== "discover" && !isPartial) return;
  const box = $("discoverBox");
  const items = isPartial ? partial.filter(r=>!DISMISSED.has(r.id)).slice(0,30) : visibleDiscover();
  if (!LIB.entries.length){
    box.innerHTML = `<p class="note">Ta bibliothèque est vide. Ajoute quelques titres depuis l'onglet <b>Ajouter</b>, ou importe une sauvegarde, puis lance l'analyse.</p>`;
    return;
  }
  if (!items.length){
    box.innerHTML = DISCOVER
      ? `<p class="note">Plus rien à proposer avec ces filtres. Change de type, réaffiche les écartés, ou relance l'analyse après avoir lu de nouveaux titres.</p>`
      : `<p class="note">Lance l'analyse : chaque série que tu lis est envoyée à AniList, et les titres qui reviennent depuis plusieurs d'entre elles remontent en tête.</p>`;
    return;
  }
  const seedLine = DISCOVER && !isPartial
    ? `<p class="note" style="margin-bottom:12px">Croisement de ${DISCOVER.seeds.length} séries : ${esc(DISCOVER.seeds.join(", "))}.</p>` : "";
  box.innerHTML = seedLine + `<div class="recgrid">${items.map(discoverCardHTML).join("")}</div>`;
  [...box.querySelectorAll("[data-add]")].forEach(b=>{
    b.onclick = () => {
      const r = items.find(x=>String(x.id)===b.dataset.add);
      if (r && addFromMedia(r)){ renderDiscover(); }
    };
  });
  [...box.querySelectorAll("[data-skip]")].forEach(b=>{
    b.onclick = () => {
      DISMISSED.add(+b.dataset.skip);
      saveDismissed();
      renderDiscover();
      $("tabDiscN").textContent = visibleDiscover().length || "—";
    };
  });
}

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
  $("kicker").textContent = lib.length ? LIB.label : "Bibliothèque locale";
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
  await resetEverything();
  toast("Données effacées — rechargement…");
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
$("file").addEventListener("change", e=>{ if (e.target.files && e.target.files[0]) importFile(e.target.files[0]); e.target.value = ""; });
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
  if (f) importFile(f);
});

if (store.get("panel:v1")){ $("filterPanel").classList.remove("hidden"); $("filterBtn").setAttribute("aria-expanded","true"); }
state.seeds = store.get("seeds:v1") || 25;
drawDiscoverChips();
state.unit = store.get("unit:v1") || "ch";
$("unitBtn").textContent = state.unit === "ch" ? "Suivi : chapitres" : "Suivi : tomes";

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
  boot();
  hydrate();
})();

/* service worker: http(s) only */
if ("serviceWorker" in navigator && location.protocol.startsWith("http")){
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then(reg => {
    /* notify when a new version is ready (see REVIEW.md §1.3) */
    reg.addEventListener("updatefound", () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener("statechange", () => {
        if (sw.state === "installed" && navigator.serviceWorker.controller)
          toast("Nouvelle version — recharge la page");
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
