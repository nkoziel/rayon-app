/* Two storage layers, with a deliberate split (REVIEW.md §1.2).

   localStorage  — the library and small preferences ONLY. Synchronous, needed at boot,
                   and capped at roughly 5 MB per origin.
   IndexedDB     — every large, regenerable cache: AniList records, MangaDex data,
                   recommendation caches.

   The split exists because the caches used to live in localStorage and overflow it. Past the
   quota `setItem` throws on every write, `store.set()` returned false to say so, and not one
   caller read it — so the library silently stopped being saved. Never put a growing cache in
   localStorage again, and never ignore what `set()` returns. */

import { toast } from './dom.js';
import { t } from './i18n.js';

let quotaWarned = false;

export const store = {
  get(k){ try{ const v = localStorage.getItem(k); return v ? JSON.parse(v) : null; }catch(e){ return null; } },
  set(k, v){
    try{ localStorage.setItem(k, JSON.stringify(v)); return true; }
    catch(e){
      /* Never swallow this again. Warn once per session rather than on every keystroke. */
      if (!quotaWarned){
        quotaWarned = true;
        toast(t("storage.full"));
      }
      console.error("[rayon] localStorage write refused for", k, e);
      return false;
    }
  },
  del(k){ try{ localStorage.removeItem(k); }catch(e){} }
};

/* ---------- IndexedDB ---------- */

export const DB_NAME = "rayon-reader";
export const DB_VER = 4;

let dbp = null;

export function db(){
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      /* v3: metadata caches moved off localStorage (REVIEW.md §1.2) */
      if (!d.objectStoreNames.contains("cache")) d.createObjectStore("cache", {keyPath:"k"});
      /* v4: the embedded reader is gone — Mihon is the reader. Drop its stores rather than
         leaving them orphaned: "chapters" held whole CBZ pages as Blobs and can be hundreds
         of MB. Exactly the leak §2.5 was about, so do not recreate it by omission. */
      if (d.objectStoreNames.contains("chapters")) d.deleteObjectStore("chapters");
      if (d.objectStoreNames.contains("handles"))  d.deleteObjectStore("handles");
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(new Error(t("storage.unavailable")));
    /* Another tab still holding an older version blocks the upgrade indefinitely.
       Reject instead of hanging — callers must stay able to give up. */
    req.onblocked = () => rej(new Error(t("storage.blocked")));
  });
  return dbp;
}

/* Reset the cached connection, so a caller that deleted the database can reopen it. */
export function forgetDb(){ dbp = null; }

function kv(mode, fn){
  return db().then(d => new Promise((res, rej) => {
    const tx = d.transaction("cache", mode);
    const s = tx.objectStore("cache");
    let out;
    try{ out = fn(s); }catch(e){ rej(e); return; }
    tx.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    tx.onerror = () => rej(tx.error || new Error(t("storage.error")));
  }));
}

let cacheWarned = false;

/* These fail soft on purpose: everything they hold is regenerable, so the app must keep
   working without persistence rather than refusing to start. */
export async function kvGet(k){
  try{ const r = await kv("readonly", s => s.get(k)); return r ? r.v : null; }
  catch(e){ return null; }
}

export async function kvSet(k, v){
  try{ await kv("readwrite", s => s.put({k, v})); return true; }
  catch(e){
    if (!cacheWarned){ cacheWarned = true; toast(t("storage.cacheFull")); }
    console.error("[rayon] IndexedDB cache write failed for", k, e);
    return false;
  }
}

export async function kvDel(k){ try{ await kv("readwrite", s => s.delete(k)); }catch(e){} }
