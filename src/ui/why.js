/* Why a title is being recommended, as colour-coded badges.
 *
 * Shared by the detail sheet and the Discover tab, which is the whole point: the same evidence
 * should look the same wherever it is shown. It lives in its own module rather than in sheet.js
 * so Discover can use it without importing the sheet, which would close an import cycle.
 *
 * The three reasons are genuinely different kinds of evidence and a reader should be able to
 * tell them apart at a glance:
 *   .why-readers  people who read one read the other - a social signal
 *   .why-tags     shared themes - a content signal
 *   .why-author   same author - the strongest and rarest
 * A title carrying several badges is one where independent signals agree, which is why they are
 * shown together rather than collapsed into a single "best" reason.
 *
 * Colour never carries the meaning on its own: each badge also says what it is in words.
 */

import { esc } from '../core/dom.js';
import { t as T } from '../core/i18n.js';

export function badge(kind, label, title){
  return `<span class="why why-${kind}"${title ? ` title="${esc(title)}"` : ""}>${esc(label)}</span>`;
}

/* Union two `why` objects for the same title seen from two different seeds. Discover crosses
   several series, so the same recommendation can arrive twice with different evidence, and
   throwing the second one away would under-sell it. */
export function mergeWhy(a, b){
  if (!a) return b;
  if (!b) return a;
  return {
    ...a,
    score:       Math.max(a.score || 0, b.score || 0),
    sameAuthor:  !!(a.sameAuthor || b.sameAuthor),
    sharedUsers: Math.max(a.sharedUsers || 0, b.sharedUsers || 0),
    tags:        [...new Set([...(a.tags || []), ...(b.tags || [])])].slice(0, 6),
    tagsTotal:   Math.max(a.tagsTotal || 0, b.tagsTotal || 0),
  };
}

/* A single comparable number for ranking, whatever the source.
   MangaBaka's `score` is a 0..1 similarity; AniList only ever gave a vote count. */
export function strengthOf(r){
  const w = r.why;
  if (!w) return r.votes || 0;
  return (w.sharedUsers || 0) + (w.score || 0) * 100 + (w.sameAuthor ? 25 : 0);
}

export function whyHTML(r){
  const w = r.why;
  /* AniList's fallback knew a vote count and nothing else, so it gets the readers badge alone. */
  if (!w){
    const n = r.votes || 0;
    return badge("readers", T("reco.badgeReaders", { n }))
      + (r.genres && r.genres.length
          ? " " + badge("tags", T("reco.badgeTagsPlain"), r.genres.slice(0, 4).join(", "))
          : "");
  }

  const out = [];
  if (w.sharedUsers) out.push(badge("readers", T("reco.badgeReaders", { n: w.sharedUsers })));
  if (w.tags && w.tags.length)
    /* The tag names go in the tooltip: the badge stays scannable, the detail stays reachable.
       MangaBaka's tag vocabulary is fine-grained, so shared_tags_total runs to dozens and the
       returned list is truncated - the count is real, the names are a sample of it. */
    out.push(badge("tags", T("reco.badgeTags", { n: w.tagsTotal || w.tags.length }), w.tags.join(", ")));
  else if (w.tagsTotal)
    out.push(badge("tags", T("reco.badgeTags", { n: w.tagsTotal })));
  if (w.sameAuthor) out.push(badge("author", T("reco.badgeAuthor")));
  return out.join(" ");
}
