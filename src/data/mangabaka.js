/* MangaBaka — the primary metadata source.
 *
 * It already merges AniList, MyAnimeList, MangaUpdates, Kitsu, Anime-Planet, Shikimori and
 * ANN, so Rayon consumes that work rather than re-implementing seven-source aggregation and
 * seven sets of rate limits.
 *
 * Measured against AniList on real series (see the vault note):
 *   - chapter and volume counts for ONGOING series, which is AniList's documented blind spot
 *   - covers in four sizes, each @1x/@2x/@3x, with a blurhash placeholder
 *   - ratings aggregated from up to seven databases
 *   - 24-43 alternative titles per series, which is what makes fuzzy matching work
 *   - recommendations that explain themselves: shared tags with weights, or shared readers
 *
 * Base URL is api.mangabaka.org. `api.mangabaka.dev` returns 500 on every path including its
 * own documentation — much of the public discussion points at it; ignore that.
 *
 * Licence: MangaBaka-original data is CC BY-NC-SA 4.0. Attribution is REQUIRED, and the
 * project must stay non-commercial. See attributionHTML() below.
 */

import { sleep } from '../core/dom.js';
import { norm } from '../core/norm.js';
import { t } from '../core/i18n.js';
import { kvGet, kvSet } from '../core/store.js';

const API = "https://api.mangabaka.org";

/* Rate limiting applies only to UNCACHED requests, so repeating a query is effectively free —
   but a burst of misses is not. This paces politely rather than sleeping blindly between
   every call the way the AniList path does (REVIEW.md §2.2). */
let cooldownUntil = 0;

async function mbGet(path){
  const wait = cooldownUntil - Date.now();
  if (wait > 0) await sleep(wait);

  let res;
  try{ res = await fetch(API + path, { headers: { Accept: "application/json" } }); }
  catch(e){ throw new Error(t("net.mbUnreachable")); }

  if (res.status === 429){
    const retry = parseInt(res.headers.get("Retry-After") || "30", 10);
    cooldownUntil = Date.now() + retry * 1000;
    throw new Error(t("net.mbRateLimited", { s: retry }));
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(t("net.mbStatus", { code: res.status }));

  const json = await res.json().catch(() => null);
  if (!json) throw new Error(t("net.mbBadResponse"));
  /* Every response carries {status, data}; errors add {message}, which is written for
     end users and can be shown as-is. */
  if (json.message && json.status >= 400) throw new Error(json.message);
  return json.data;
}

/* Their cover object is a tree: raw + three widths, each with @1x/@2x/@3x. Pick one width and
   flatten it, but keep the blurhash — it is what lets a card show something before the image
   arrives, which AniList cannot offer at all. */
function shapeCover(cover){
  if (!cover) return { url: "", blurhash: "" };
  const pick = cover.x350 || cover.x250 || cover.x150;
  return {
    url: (pick && (pick.x2 || pick.x1)) || (cover.raw && cover.raw.url) || "",
    blurhash: (cover.raw && cover.raw.blurhash) || "",
  };
}

/* Map a MangaBaka series onto the shape the rest of the app already understands, so nothing
   downstream has to know where a record came from. */
export function shapeSeries(s){
  if (!s) return null;
  const src = s.source || {};
  const rated = Object.values(src).filter(v => v && v.rating_normalized != null);
  const cover = shapeCover(s.cover);
  return {
    mb: s.id,
    id: (src.anilist && src.anilist.id) || null,     // keep the AniList id where one exists
    titre: s.title || s.romanized_title || s.native_title || "",
    romaji: s.romanized_title || s.title || "",
    /* The public page is /{id}. `/series/{id}` looks right and 404s - it is the API path,
       not the site's. The record's own links[] ends with the canonical URL, which is how this
       was settled rather than guessed. */
    url: `https://mangabaka.org/${s.id}`,
    cover: cover.url,
    blurhash: cover.blurhash,
    type: s.type ? s.type[0].toUpperCase() + s.type.slice(1) : "",
    statut: s.status || "",
    chapitres: s.total_chapters != null ? Number(s.total_chapters) : null,
    volumes: s.final_volume != null ? Number(s.final_volume) : null,
    /* The average of every database that has an opinion, not one site's score. */
    score: rated.length ? Math.round(rated.reduce((a, v) => a + v.rating_normalized, 0) / rated.length) : null,
    sources: rated.length,
    pop: s.popularity && s.popularity.global != null ? Number(s.popularity.global) : 0,
    annee: s.year || null,
    genres: (s.genres || []).map(g => (typeof g === "string" ? g : g.name)).filter(Boolean).slice(0, 8),
    /* Deduplicated: when one person both writes and draws - which is most manga - they appear
       in authors AND artists, and the sheet read "Tatsuki Fujimoto, Tatsuki Fujimoto". */
    auteur: [...new Set([...(s.authors || []), ...(s.artists || [])]
      .map(a => (typeof a === "string" ? a : a && a.name)).filter(Boolean))].join(", "),
    desc: (s.description || "").slice(0, 900),
    /* Every alternative title, which is what makes matching a Mihon folder name work. */
    aliases: (s.titles || []).map(x => x && x.title).filter(Boolean),
  };
}

/* The bridge from what the library already stores. Verified to round-trip on every sample:
   the returned series' own source.anilist.id matches what was asked for. */
export async function byAniListId(id){
  const d = await mbGet(`/v1/source/anilist/${encodeURIComponent(id)}?with_series=true`);
  /* `series` is an ARRAY here, unlike the single-series endpoints. */
  const list = d && d.series;
  const s = Array.isArray(list) ? list[0] : list;
  return shapeSeries(s);
}

export async function byId(id){
  const d = await mbGet(`/v1/series/${encodeURIComponent(id)}`);
  return shapeSeries(d);
}

/* Purpose-built for matching a full title, and it handles CJK — verified with 進撃の巨人. */
export async function matchTitle(title){
  const d = await mbGet(`/v1/series/match?q=${encodeURIComponent(String(title).slice(0, 120))}`);
  const first = Array.isArray(d) ? d[0] : d;
  return shapeSeries(first);
}

/* Up to 50 per request — this is what replaces grinding one call per series. */
export async function batch(ids){
  const out = [];
  for (let i = 0; i < ids.length; i += 50){
    const chunk = ids.slice(i, i + 50);
    const q = chunk.map(x => `id=${encodeURIComponent(x)}`).join("&");
    const d = await mbGet(`/v1/series/batch?${q}`);
    (Array.isArray(d) ? d : []).forEach(s => { const m = shapeSeries(s); if (m) out.push(m); });
  }
  return out;
}

/* Two complementary recommendation signals, and unlike AniList's vote count they say WHY:
   `similar` carries the shared tags with their weight, `readers-also-like` the shared readers.
   That reason is worth surfacing — it answers "why should I read this". */
export async function recommendations(mbId, kind = "similar", limit = 12){
  const path = kind === "readers" ? "readers-also-like" : "similar";
  const d = await mbGet(`/v1/series/${encodeURIComponent(mbId)}/${path}?limit=${limit}`);
  return (Array.isArray(d) ? d : []).map(r => {
    const m = shapeSeries(r.series);
    if (!m) return null;
    const tags = (r.shared_tags || []);
    return {
      ...m,
      why: {
        kind: path,
        score: r.score || 0,
        sameAuthor: !!r.matched_author,
        sharedUsers: r.shared_users || 0,
        /* "core" tags define the series; they are the ones worth showing. */
        tags: tags.filter(x => x.weight === "core").map(x => x.name).slice(0, 4),
        tagsTotal: r.shared_tags_total || tags.length,
      },
    };
  }).filter(Boolean);
}

/* CC BY-NC-SA 4.0: attribution is a licence condition, not a courtesy. */
export const ATTRIBUTION_URL = "https://mangabaka.org";
export const attributionHTML = () =>
  `<a href="${ATTRIBUTION_URL}" target="_blank" rel="noreferrer">MangaBaka</a> (CC BY-NC-SA 4.0)`;

/* Cached lookup, so a second visit to a sheet costs nothing. */
export async function cachedByAniListId(id){
  const key = "mb:al:" + id;
  const hit = await kvGet(key);
  if (hit) return hit;
  const m = await byAniListId(id);
  if (m) kvSet(key, m);
  return m;
}

export async function cachedByTitle(title){
  const key = "mb:t:" + norm(title);
  const hit = await kvGet(key);
  if (hit) return hit;
  const m = await matchTitle(title);
  if (m) kvSet(key, m);
  return m;
}
