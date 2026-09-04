/* MangaDex: volume structure and the latest translated chapter.
   NOTE: translatedLanguage is hard-coded to English. Content language and UI language are
   different axes — see REVIEW.md §4. */

/* ============================================================
   MangaDex: volume structure and the latest published chapter
   ============================================================ */
const MD = "https://api.mangadex.org";

async function mdGet(path){
  let res;
  try{ res = await fetch(MD+path, {headers:{Accept:"application/json"}}); }
  catch(e){ throw new Error(t("net.mdUnreachable")); }
  if (res.status === 429) throw new Error(t("net.mdRateLimited"));
  if (!res.ok) throw new Error(t("net.mdStatus", { code: res.status }));
  return res.json();
}

/* retrouve l'identifiant MangaDex : par lien AniList si possible, sinon par titre */
export async function mdResolve(entry){
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

/* volume and chapter structure */
export async function mdAggregate(entry){
  const key = norm(entry.t);
  const id = await mdResolve(entry);
  if (!id) throw new Error(t("net.mdNotFound"));
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


import { norm } from '../core/norm.js';
import { t } from '../core/i18n.js';
import { MDCACHE } from '../core/state.js';
import { kvSet } from '../core/store.js';
