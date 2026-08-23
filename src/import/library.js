/* Importing, merging, exporting and erasing a library.
   The governing rule for merging: progress NEVER moves backwards. Importing a friend's list
   or an older backup of your own must not undo what you have read (REVIEW.md §1.5). */

import { $, esc, toast, uid, closeModal } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { LIB, setLib, saveLib, setDiscover, META, MDCACHE, markMetaDirty, saveMeta } from '../core/state.js';
import { store, db, forgetDb, kvDel, kvSet, DB_NAME } from '../core/store.js';
import { t as T } from '../core/i18n.js';
import { parseBackup } from './tachibk.js';

export function mergeLibraries(current, incoming){
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
export function askImportMode(incoming){
  const cur = LIB.entries.length;
  const p = mergeLibraries(LIB.entries, incoming);
  return new Promise(resolve => {
    $("modalHost").innerHTML = `
      <div class="modal" id="impScrim">
        <div class="modalbox" role="dialog" aria-modal="true" aria-label="${esc(T("import.dialogLabel"))}">
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

/* onImported lets the caller say what happens next (re-render, re-hydrate) so this layer
   never has to reach up into the UI. */
export async function importFile(file, onImported = () => {}){
  try{
    $("statusline").textContent = T("import.reading", { name: file.name });
    const raw = new Uint8Array(await file.arrayBuffer());
    let entries, label;
    if (raw[0]===0x1f && raw[1]===0x8b){
      if (!("DecompressionStream" in window)) throw new Error(T("import.noGzip"));
      const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
      entries = parseBackup(new Uint8Array(await new Response(stream).arrayBuffer()));
      label = T("import.mihonBackup", { name: file.name });
    } else {
      const json = JSON.parse(new TextDecoder().decode(raw));
      const list = Array.isArray(json) ? json : json.entries;
      if (!Array.isArray(list)) throw new Error(T("import.badJson"));
      entries = list.map(e=>Object.assign({id:uid(),a:"",s:"Import",st:"Inconnu",g:[],r:0,n:0,d:"",ad:"",m:"",al:0,f:1,origin:"import"}, e));
      label = json.label || T("import.jsonList", { name: file.name });
    }
    if (!entries.length) throw new Error(T("import.noSeries"));
    entries.sort((a,b)=>(b.f-a.f)||a.t.localeCompare(b.t,"fr"));

    /* An empty library has nothing to lose, so do not nag. Otherwise this is the one gesture
       that can wipe everything — a stray drag-and-drop reaches here directly. */
    let msg;
    if (!LIB.entries.length){
      setLib({ label, entries });
      msg = T("toast.imported", { n: entries.length });
    } else {
      const mode = await askImportMode(entries);
      if (!mode){ $("statusline").textContent = ""; return; }
      if (mode === "merge"){
        const m = mergeLibraries(LIB.entries, entries);
        m.entries.sort((a,b)=>(b.f-a.f)||a.t.localeCompare(b.t,"fr"));
        setLib({ label: LIB.label, entries: m.entries });
        msg = T("toast.merged", { added: m.added, updated: m.updated });
      } else {
        setLib({ label, entries });
        msg = T("toast.imported", { n: entries.length });
      }
    }

    saveLib();
    setDiscover(null); kvDel("discover:v1");   // the previous run's results describe another library
    toast(msg);
    onImported();
  }catch(e){
    $("statusline").textContent = "";
    alert(T("import.failed", { msg: e.message }));
  }
}

export function exportLib(){
  const blob = new Blob([JSON.stringify({label:LIB.label, exported:new Date().toISOString(), entries:LIB.entries}, null, 1)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ma-bibliotheque.json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 4000);
  toast(T("toast.exported"));
}

/* Everything a removed series leaves behind (REVIEW.md §2.5).
   Since the reader was dropped there are no page Blobs to reclaim any more — only cached
   metadata, which is regenerable. Kept as its own function so it stays the one place that
   knows what a series owns. */
export async function purgeSeriesData(entry){
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

/* Returns true when the database is actually gone, false when the delete was blocked.
   The distinction matters — see the warning below. */
export async function resetEverything(){
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

  /* DANGER, learned by wedging a real database.
     A blocked deleteDatabase does not fail — it queues, and EVERY later open() or delete()
     on that database queues behind it, firing no events at all. So a version of this that
     resolved on a timeout and then reloaded could leave the store permanently unopenable:
     the reload's open() joined a queue that would never drain.
     Therefore: close our own connection first, and if the delete is still blocked, say so
     and do NOT pretend it worked. */
  try{
    const d = await db().catch(() => null);
    if (d) d.close();
    forgetDb();

    const outcome = await new Promise(res => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      req.onsuccess = () => res("deleted");
      req.onerror   = () => res("error");
      req.onblocked = () => res("blocked");   // another tab still holds a connection
    });

    if (outcome !== "deleted"){
      toast(T("reset.blocked"));
      return false;
    }
    return true;
  }catch(e){
    console.error("[rayon] reset: IndexedDB", e);
    return false;
  }
}
