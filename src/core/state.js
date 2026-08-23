/* The app's mutable state, and how it is persisted.
 *
 * A note on ES module bindings, because it decides the shape of this file:
 * imports are LIVE views, so `META[k] = v` from another module works, and a reassignment
 * done *here* is visible everywhere. But an importer cannot reassign an imported binding.
 * So anything that gets replaced wholesale (LIB, DISCOVER, the caches) is reassigned only
 * inside this module, through the setters below. Anything mutated in place (state, OWNED,
 * DISMISSED, the cache objects) needs no setter.
 */

import { store, kvGet, kvSet, kvDel } from './store.js';
import { norm } from './norm.js';

/* ---------- the library ----------
   LIB stays in localStorage: small, precious, and needed synchronously at boot. */
export let LIB = store.get("lib:v1") || { label:"Bibliothèque locale", entries:[] };

export function setLib(v){ LIB = v; refreshOwned(); }

export const saveLib = () => { const ok = store.set("lib:v1", LIB); refreshOwned(); return ok; };

/* ---------- caches ----------
   Loaded from IndexedDB by loadCaches() before the first render, never from localStorage:
   they used to overflow it and silently stop the library from saving (REVIEW.md §1.2). */
export let META = {};
export let MDCACHE = {};
/* MangaBaka records, keyed like the others. Primary metadata source since AniList's API was
   disabled upstream (403). */
export let MBCACHE = {};
export let DISCOVER = null;

export function setDiscover(v){ DISCOVER = v; }

let metaDirty = false;
export function markMetaDirty(){ metaDirty = true; }
export const saveMeta = () => { if (metaDirty){ metaDirty = false; kvSet("meta:v2", META); } };

setInterval(saveMeta, 4000);
window.addEventListener("beforeunload", saveMeta);

/* ---------- ownership ----------
   Rebuilt from the library rather than stored, so it can never drift out of sync. */
export let OWNED = new Set();

export function refreshOwned(){
  OWNED = new Set();
  LIB.entries.forEach(e => { OWNED.add(norm(e.t)); if (e.al) OWNED.add("id:"+e.al); });
}
refreshOwned();

export const isOwned = r => OWNED.has("id:"+r.id) || OWNED.has(norm(r.titre)) || OWNED.has(norm(r.romaji));

/* Titles the user dismissed in Discover. Cleared in place, never reassigned. */
export const DISMISSED = new Set(store.get("dismissed:v1") || []);
export const saveDismissed = () => store.set("dismissed:v1", [...DISMISSED]);

/* ---------- view state ----------
   A const object mutated by property, so importers see changes without a setter. */
export const state = {
  q:"", shelf:"all", source:"all", sort:"recent", view:"grid",
  hideOwned:true, tab:"library", type:"all", dsort:"relevance", unit:"ch",
  libType:"all", seeds:25
};

/* ---------- persistence of the caches ---------- */

export const CACHE_KEYS = ["meta:v2", "md:v1", "mb:v1", "discover:v1"];

/* Keys from the removed reader. Never migrated, only dropped: nothing reads them any more. */
export const DEAD_KEYS = ["catalog:v1", "fsprog:v1", "pickindex:v1"];

/* Move the big caches out of localStorage, once (REVIEW.md §1.2).
   Existing installs carry several MB here; copying them across also frees the quota that was
   silently blocking library saves. Anything that fails is only a cache — it regenerates. */
export async function migrateCaches(){
  for (const k of CACHE_KEYS){
    const legacy = store.get(k);
    if (legacy === null || legacy === undefined) continue;
    if (await kvSet(k, legacy)) store.del(k);   // only drop the original once it is safely stored
  }
  for (const k of DEAD_KEYS){ store.del(k); await kvDel(k); }
  /* per-series recommendation caches: the bulk of the overflow */
  let recoKeys = [];
  try{
    for (let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if (k && k.startsWith("reco:v3:")) recoKeys.push(k);
    }
  }catch(e){}
  for (const k of recoKeys){
    const v = store.get(k);
    if (v && await kvSet(k, v)) store.del(k);
    else store.del(k);        // unreadable or unstorable: drop it, it rebuilds on demand
  }
}

export async function loadCaches(){
  META     = (await kvGet("meta:v2"))     || {};
  MDCACHE  = (await kvGet("md:v1"))       || {};
  MBCACHE  = (await kvGet("mb:v1"))       || {};
  DISCOVER = (await kvGet("discover:v1")) || null;
}
