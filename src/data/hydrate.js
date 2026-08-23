/* Filling the library with metadata.
 *
 * MangaBaka first, AniList as the fallback. That order is not a preference — AniList's API
 * returned 403 ("temporarily disabled due to severe stability issues") and it was the app's
 * ONLY source, so a second one is the difference between a working library and a blank one.
 *
 * It is also better on the merits, measured over five series: chapter and volume counts for
 * ONGOING titles (AniList's documented blind spot), covers with a blurhash placeholder,
 * ratings averaged over up to seven databases, and dozens of alternative titles per series.
 *
 * On pacing (REVIEW.md §2.2): the old path slept 700 ms between calls, working out to about
 * 85 req/min against AniList's limit of 30, so 429s arrived in bursts and every series that
 * hit one was skipped for the whole run. MangaBaka takes 50 ids per request and caches server
 * side for 7 days, so a 300-series library is six requests rather than three hundred.
 */

import { $, sleep } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { LIB, META, MBCACHE, markMetaDirty, saveMeta, saveLib } from '../core/state.js';
import { kvSet } from '../core/store.js';
import { t as T } from '../core/i18n.js';
import { byAniListId, matchTitle, batch } from './mangabaka.js';
import { searchBatch, gql, shapeMedia, BY_IDS_Q } from './anilist.js';

let running = false;

const saveMb = () => kvSet("mb:v1", MBCACHE);

/* Resolve one entry to a MangaBaka record: by AniList id when the entry carries one — that
   bridge round-tripped correctly on every sample — otherwise by title, which handles CJK. */
async function resolveOne(d){
  if (d.al){
    const m = await byAniListId(d.al);
    if (m) return m;
  }
  return matchTitle(d.t);
}

export async function hydrate(onBatch = () => {}){
  if (running || !LIB.entries.length) return;
  running = true;
  try{
    const todo = LIB.entries.filter(d => !MBCACHE[norm(d.t)] && !META[norm(d.t)]);
    if (!todo.length){ status(); return; }

    const total = todo.length;
    let done = 0, viaMb = 0;

    /* Entries that already carry an AniList id can be resolved one call at a time, but the
       bridge has no bulk form — so collect the MangaBaka ids first, then batch the details. */
    const pending = [];
    for (const d of todo){
      $("statusline").textContent = T("hydrate.resolving", { done, total });
      try{
        const m = await resolveOne(d);
        if (m){
          MBCACHE[norm(d.t)] = m;
          if (!d.al && m.id) d.al = m.id;      // backfill the AniList id when MangaBaka knows it
          viaMb++;
        } else {
          pending.push(d);                      // nothing on MangaBaka: try AniList below
        }
      }catch(e){
        $("statusline").textContent = e.message;
        pending.push(d);
        await sleep(1500);
      }
      done++;
      if (done % 10 === 0){ saveMb(); onBatch(); }
    }
    saveMb(); onBatch();

    /* Whatever MangaBaka did not have, ask AniList — if it is answering at all. */
    if (pending.length){
      const withId = pending.filter(d => d.al), without = pending.filter(d => !d.al);
      for (let i = 0; i < withId.length; i += 50){
        const chunk = withId.slice(i, i + 50);
        try{
          const data = await gql(BY_IDS_Q, { ids: chunk.map(d => d.al) });
          const byId = {}; (data.Page.media || []).forEach(m => { byId[m.id] = shapeMedia(m); });
          chunk.forEach(d => { META[norm(d.t)] = byId[d.al] || { missing: true }; });
          markMetaDirty();
        }catch(e){
          /* A 403 means the API is switched off, not that this batch failed — stop asking
             rather than grinding through the rest of the library into the same wall. */
          $("statusline").textContent = e.message;
          break;
        }
        onBatch(); await sleep(2100);          // 30 req/min, honestly this time
      }
      for (let i = 0; i < without.length; i += 6){
        try{ await searchBatch(without.slice(i, i + 6)); }
        catch(e){ $("statusline").textContent = e.message; break; }
        onBatch(); await sleep(2100);
      }
    }

    saveMeta(); saveLib();
    status(viaMb);
  } finally { running = false; }
}

function status(viaMb){
  const n = LIB.entries.filter(d => {
    const k = norm(d.t);
    return MBCACHE[k] || (META[k] && !META[k].missing);
  }).length;
  $("statusline").textContent = T("hydrate.done", { n, total: LIB.entries.length });
}

/* Refresh one series on demand, ignoring the cache. */
export async function refreshOne(d){
  const m = await resolveOne(d);
  if (!m) return null;
  MBCACHE[norm(d.t)] = m;
  if (!d.al && m.id) { d.al = m.id; saveLib(); }
  saveMb();
  return m;
}

export { batch };
