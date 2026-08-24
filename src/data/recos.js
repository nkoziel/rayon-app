/* Recommendations, whichever source can answer.
 *
 * MangaBaka gives two complementary signals AND says why, which AniList cannot:
 *   /similar             content-based — the tags actually shared, with their weight, and
 *                        a flag when the author is the same
 *   /readers-also-like   social — how many readers have both in their library
 *
 * AniList only ever gave a vote count. "12 readers made the connection" answers *whether*
 * people agree; "shares Pirates, Swordplay, Samurai" answers *why you might like it*, which
 * is the question someone browsing is actually asking.
 *
 * AniList stays as the fallback, because its API being switched off is what started all this.
 */

import { norm } from '../core/norm.js';
import { MBCACHE } from '../core/state.js';
import { kvGet, kvSet } from '../core/store.js';
import { recommendations } from './mangabaka.js';
import { loadRecos as loadAniListRecos } from './anilist.js';

const KEY = d => "recos:v4:" + norm(d.t);

/* Merge the two MangaBaka signals into one list, keeping the reason from whichever matched.
   A title that appears in BOTH is the strongest recommendation there is, so it keeps both
   reasons and sorts first. */
function merge(similar, readers){
  const by = new Map();
  for (const r of similar) by.set(r.mb, r);
  for (const r of readers){
    const seen = by.get(r.mb);
    if (seen){
      seen.why.sharedUsers = r.why.sharedUsers;
      seen.why.both = true;                       // content AND audience agree
    } else by.set(r.mb, r);
  }
  return [...by.values()].sort((a, b) => {
    if (a.why.both !== b.why.both) return a.why.both ? -1 : 1;
    return (b.why.score || 0) - (a.why.score || 0);
  });
}

/* `record` is the caller's own MangaBaka record, for a series that is not in the library and
   therefore not in MBCACHE - the Discover preview. Without it the preview would silently fall
   back to AniList and give a different answer than the same series gives once added. */
export async function recosFor(d, force, record){
  const key = KEY(d);
  if (!force){
    const hit = await kvGet(key);
    if (hit) return hit;
  }

  const mb = (record && record.mb) ? record : MBCACHE[norm(d.t)];
  if (mb && mb.mb){
    const [similar, readers] = await Promise.all([
      recommendations(mb.mb, "similar", 12).catch(() => []),
      recommendations(mb.mb, "readers", 12).catch(() => []),
    ]);
    const items = merge(similar, readers);
    if (items.length){
      const payload = { source: mb.url, matched: mb.titre, provider: "mangabaka", items };
      kvSet(key, payload);
      return payload;
    }
  }

  /* Nothing from MangaBaka — fall back to AniList's vote-count list. */
  const payload = await loadAniListRecos(d, force);
  return { ...payload, provider: "anilist" };
}
