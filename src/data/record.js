/* One record per series, whichever source has it.
 *
 * The UI should never have to ask "did this come from MangaBaka or AniList" — it asks for the
 * record and gets a consistent shape, with `src` saying where it came from so the sheet can
 * credit it. MangaBaka wins when both exist: measured better on covers, on counts for ongoing
 * series, and on aggregated ratings, and AniList's API is currently returning 403.
 */

import { norm } from '../core/norm.js';
import { META, MBCACHE } from '../core/state.js';

export function recordOf(d){
  if (!d) return null;
  const key = norm(d.t);

  const mb = MBCACHE[key];
  if (mb) return { ...mb, src: "mangabaka" };

  const al = META[key];
  if (al && !al.missing) return { ...al, src: "anilist", sources: 1, blurhash: "" };

  return null;
}

/* Where the record came from, for the credit line the licence requires. */
export const CREDIT = {
  mangabaka: { name: "MangaBaka", url: "https://mangabaka.org", licence: "CC BY-NC-SA 4.0" },
  anilist:   { name: "AniList",   url: "https://anilist.co",    licence: "" },
};
