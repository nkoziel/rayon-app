/* AniList: the metadata and recommendation source.
   Public GraphQL API, no key, 30 requests/minute — the pacing is still naive (REVIEW.md §2.2):
   sleep(700) works out to ~85 req/min, so 429s arrive in bursts. gql() at least records the
   Retry-After it is given and waits it out before the next call. */

/* ============================================================
   API AniList
   ============================================================ */
const API = "https://graphql.anilist.co";
let cooldownUntil = 0;

export async function gql(query, variables){
  const wait = cooldownUntil - Date.now();
  if (wait > 0) await sleep(wait);
  let res;
  try{
    res = await fetch(API,{method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},body:JSON.stringify({query,variables})});
  }catch(e){ throw new Error(t("net.anilistUnreachable")); }
  if (res.status === 429){
    const retry = parseInt(res.headers.get("Retry-After")||"60",10);
    cooldownUntil = Date.now()+retry*1000;
    throw new Error(t("net.anilistRateLimited", { s: retry }));
  }
  const json = await res.json().catch(()=>null);
  if (!json) throw new Error(t("net.anilistBadResponse"));
  if (json.errors && json.errors.length) throw new Error(json.errors[0].message||t("net.anilistError"));
  return json.data;
}

const FIELDS = `
  id siteUrl format status chapters volumes averageScore popularity genres countryOfOrigin
  startDate{year} title{romaji english} coverImage{large medium} bannerImage description(asHtml:false)
  staff(perPage:2, sort:RELEVANCE){ nodes{ name{full} } }`;
export const BY_IDS_Q = `query ($ids:[Int]){ Page(perPage:50){ media(id_in:$ids, type:MANGA){ ${FIELDS} } } }`;
export const SEARCH_PAGE_Q = `query ($s:String){ Page(perPage:8){ media(search:$s, type:MANGA, sort:SEARCH_MATCH){ ${FIELDS} } } }`;
export const RECO_Q = `query ($id:Int){ Media(id:$id, type:MANGA){ id siteUrl title{romaji english}
  recommendations(sort:RATING_DESC, perPage:12){ nodes{ rating mediaRecommendation{ ${FIELDS} } } } } }`;

const FORMAT = {MANGA:"Manga", NOVEL:"Light novel", ONE_SHOT:"One-shot"};
/* MangaBaka's own vocabulary, adopted here as the canonical one: three sources answering in
   three languages is what let a comparison against "Terminé" pass for a test. statusLabel()
   in core/i18n.js turns a token into text at render time. */
const PSTATUS = {FINISHED:"completed", RELEASING:"releasing", NOT_YET_RELEASED:"upcoming", CANCELLED:"cancelled", HIATUS:"hiatus"};
const COUNTRY = {JP:"Manga", KR:"Manhwa", CN:"Manhua", TW:"Manhua"};

export function shapeMedia(m){
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

export async function searchBatch(entries){
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

export async function loadRecos(entry, force){
  const key = "reco:v3:"+norm(entry.t);
  if (!force){ const hit = await kvGet(key); if (hit) return hit; }
  const meta = META[norm(entry.t)];
  let id = entry.al || (meta && meta.id);
  if (!id){
    await searchBatch([entry]);
    const m = META[norm(entry.t)];
    if (!m || m.missing) throw new Error(t("net.anilistNoMatch"));
    id = m.id;
  }
  const data = await gql(RECO_Q,{id});
  const media = data && data.Media;
  if (!media) throw new Error(t("net.anilistNotFound"));
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

import { sleep } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { norm } from '../core/norm.js';
import { META, markMetaDirty, LIB } from '../core/state.js';
import { kvGet, kvSet } from '../core/store.js';
import { $, stripTags } from '../core/dom.js';
import { saveLib, saveMeta } from '../core/state.js';
